import { createFlightSupplier } from './flight-supply.mjs';

import { openResearchCache } from './persistent-research-cache.mjs';
import { researchPublicEvents } from './public-research.mjs';
import { extractPlaceCandidates } from './free-intake.mjs';
import { createPublicSearch } from './public-search.mjs';
import { createGoogleCalendarService } from "./google-calendar.mjs";
import { configureNetworkProxy } from "./network-proxy.mjs";
import { apiError } from "./api-error.mjs";
import { createBusinessTripOptions } from "./business-trip-options.mjs";
import { createCityResourceLookup } from "./city-resources.mjs";
import { cacheTravelServices } from "./research-cache.mjs";
import { readPublicPage } from "./public-page.mjs";
import { createWebHost } from "./web-host.mjs";
import { createRateLimiter, admit, callerKey } from './rate-limit.mjs';
import { createAccountService } from "./accounts.mjs";
import { createTravelServices } from "./travel-services.mjs";
import { createCalendarPlaceResolver } from "./calendar-places.mjs";
import { knownResolveCandidates } from "./known-places.mjs";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env.local")) {
  const envFile = readFileSync(".env.local", "utf8");
  for (const line of envFile.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (!process.env[key]) process.env[key] = valueParts.join("=");
  }
}

configureNetworkProxy(process.env, http.setGlobalProxyFromEnv);
const port = Number(process.env.PORT ?? 8787);

const tiandituToken = process.env.TIANDITU_TOKEN ?? process.env.VITE_TIANDITU_TOKEN;
const publicResearchCache = await openResearchCache(process.env.RESEARCH_DATA_DIR || '.wayline-private/research',{limit:200});
const travelServices = cacheTravelServices({...createTravelServices({ tiandituToken, amapKey: process.env.AMAP_WEB_SERVICE_KEY || process.env.AMAP_KEY || "", minRequestIntervalMs:500 }), findFlights:createFlightSupplier(), searchPublic:createPublicSearch({keyless:true}), publicSearchConfigured:true},{persistent:publicResearchCache});
travelServices.researchPublic = ({notes,places,publicEvents,purpose='venue'}) => {
  const key=JSON.stringify({notes,publicEvents,purpose,searchConfigured:travelServices.publicSearchConfigured,places:places.map(p=>({name:p.name,city:p.city}))});
  const readPage=url=>publicResearchCache.lookup(JSON.stringify({page:url,format:2}),async()=>({html:await readPublicPage(url),observedAt:Date.now()}),{kind:'publicPage'});
  return publicResearchCache.lookup(key,()=>researchPublicEvents(notes,{places,publicEvents,purpose,search:travelServices.searchPublic,readPage}),{kind:'public'});
};
const host = process.env.HOST || '127.0.0.1';
const loopback = ['127.0.0.1','localhost','::1'].includes(host);
if (!loopback && !process.env.WEB_ACCESS_PASSWORD)
  throw new Error('Public hosting requires WEB_ACCESS_PASSWORD');
if (!loopback && process.env.NODE_ENV === 'production' && !process.env.PUBLIC_ORIGIN?.startsWith('https://'))
  throw new Error('Public production hosting requires an HTTPS PUBLIC_ORIGIN');
const serveWeb = createWebHost({ password: process.env.WEB_ACCESS_PASSWORD || '', secure: process.env.PUBLIC_ORIGIN?.startsWith('https://'), publicOrigin: process.env.PUBLIC_ORIGIN });
// The anonymous API routes spend the operator's map quota. Limit each caller, add a
// stricter budget for routes that fetch outside pages, and cap the whole site.
const positiveInt = (value, fallback) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const trustProxy = process.env.TRUST_PROXY === '1';
const authLimiter = createRateLimiter({ limit:60 });
const callerLimiter = createRateLimiter({ limit: positiveInt(process.env.API_RATE_LIMIT_PER_MINUTE, 90) });
const fetchLimiter = createRateLimiter({ limit: positiveInt(process.env.API_FETCH_LIMIT_PER_MINUTE, 10) });
const siteLimiter = createRateLimiter({ limit: positiveInt(process.env.API_SITE_LIMIT_PER_MINUTE, 1500), maxKeys: 1 });
const fetchRoutes = new Set(['/api/extract']);

// City layers request several POI groups together. Space those calls while
// keeping the usual cadence for interactive search and route requests.
const cityResources = createCityResourceLookup(async query => {
  const pacedQuery = { ...query, requestIntervalMs: 1050 };
  try {
    return await travelServices.searchPlaces(pacedQuery);
  } catch (error) {
    if (error?.code !== 'AMAP_RATE_LIMIT' && error?.name !== 'TimeoutError') throw error;
    return travelServices.searchPlaces(pacedQuery);
  }
});
const businessTripOptions = createBusinessTripOptions({ services: travelServices, resources: cityResources });
const calendarPlaces = createCalendarPlaceResolver({ searchPlaces: query => travelServices.searchPlaces({...query,includeDistrict:true}), cacheFile: (process.env.CALENDAR_PLACES_DIR || '.wayline-private') + '/calendar-places.json' });
const accounts = createAccountService();
const googleCalendar=createGoogleCalendarService({accountFor:accounts.accountFor});
googleCalendar.start();


function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let oversized = false;
    request.on("data", chunk => {
      if (oversized) return;
      bytes+=chunk.length;
      if (bytes>1_000_000) {
        oversized=true;
        chunks.length=0;
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (oversized) return;
      try {
        resolve(bytes ? JSON.parse(Buffer.concat(chunks,bytes).toString('utf8')) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

const publicOrigin = new URL(process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`).origin;
const corsOrigin = process.env.WEB_ORIGIN || (loopback && !process.env.PUBLIC_ORIGIN ? 'http://127.0.0.1:3000' : publicOrigin);
const allowedOrigins = new Set([corsOrigin,publicOrigin]);
if (loopback && !process.env.PUBLIC_ORIGIN) allowedOrigins.add(`http://localhost:${port}`);

function send(response, status, payload) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function handleExtract(body) {
  const inputText = await enrichTextWithUrlContent(String(body.text ?? ""));
  const names = extractPlaceCandidates(inputText,String(body.city ?? ""));
  return Promise.all(names.map(async p=>{try{return {...p,...await travelServices.resolvePlace(p),isMatched:true};}catch{return p;}}));
}

async function enrichTextWithUrlContent(text) {
  const urls = Array.from(text.matchAll(/https:\/\/[^\s，。；;）)]+/g)).map((match) => match[0]).slice(0, 3);
  if (!urls.length) return text;
  const fetched = [];
  for (const url of urls) {
    try {
      const raw = await readPublicPage(url);
      const readable = raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 12_000);
      if (readable) fetched.push(`链接内容 ${url}：${readable}`);
    } catch {
      // Some apps block server-side fetches. The original pasted text is still available for local parsing.
    }
  }
  return fetched.length ? `${text}\n\n${fetched.join("\n\n")}` : text;
}

async function handleResolve(body) {
  const searchMode = body.purpose === "search";
  const known = knownResolveCandidates(String(body.keyword ?? ""));
  if (known.length) return known;
  // Coordinate evidence must come from a map provider, never a language model.
  return searchPlaces(String(body.keyword ?? ""), body.city,
    Number(body.lat ?? 39.9042), Number(body.lng ?? 116.4074), searchMode ? 8 : 5).catch(() => []);

}

async function fetchJson(url, timeout = 7000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

function normalizeCityResult(keyword, data) {
  const district = Array.isArray(data?.district) ? data.district[0] : data?.district;
  const center = district?.center ?? district?.latlon ?? district?.lonlat;
  if (typeof center === "string" && center.includes(",")) {
    const [lng, lat] = center.split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { name: district?.name ?? keyword, lat, lng, zoom: 11 };
  }
  if (district?.lat && district?.lon) return { name: district?.name ?? keyword, lat: Number(district.lat), lng: Number(district.lon), zoom: 11 };
  if (district?.lat && district?.lng) return { name: district?.name ?? keyword, lat: Number(district.lat), lng: Number(district.lng), zoom: 11 };
  return null;
}

async function handleGeocode(body) {
  if (!tiandituToken) throw new Error("TIANDITU_TOKEN is missing");
  const keyword = String(body.keyword ?? "").trim();
  if (!keyword) throw new Error("keyword is required");
  const adminUrl = `https://api.tianditu.gov.cn/v2/administrative?keyword=${encodeURIComponent(keyword)}&childLevel=0&extensions=true&tk=${tiandituToken}`;
  const admin = await fetchJson(adminUrl);
  const city = normalizeCityResult(keyword, admin);
  if (city) return city;

  const geocodeUrl = `https://api.tianditu.gov.cn/geocoder?ds=${encodeURIComponent(JSON.stringify({ keyWord: keyword }))}&tk=${tiandituToken}`;
  const geo = await fetchJson(geocodeUrl);
  const location = geo?.location;
  if (location?.lat && location?.lon) return { name: keyword, lat: Number(location.lat), lng: Number(location.lon), zoom: 11 };
  throw new Error(`No geocode result for ${keyword}`);
}

function normalizeSearchResults(data, fallbackCity, fallbackLat, fallbackLng) {
  const pois = data?.pois ?? data?.result?.pois ?? data?.suggests ?? [];
  if (!Array.isArray(pois)) return [];
  return pois.slice(0, 8).map((poi, index) => {
    const lonlat = poi.lonlat ?? poi.lonlatArr ?? poi.location;
    let lng = Number(poi.lon ?? poi.lng);
    let lat = Number(poi.lat);
    if (typeof lonlat === "string" && lonlat.includes(",")) {
      const parts = lonlat.split(",").map(Number);
      lng = parts[0];
      lat = parts[1];
    }
    return {
      name: poi.name ?? poi.hotPointName ?? poi.address ?? `候选地点 ${index + 1}`,
      city: poi.cityName ?? fallbackCity,
      category: guessCategory(poi.name ?? poi.hotPointName ?? poi.address ?? ""),
      source: "imported",
      coordinateSystem: "WGS84",
      isMatched: Number.isFinite(lat) && Number.isFinite(lng),
      lat: Number.isFinite(lat) ? lat : fallbackLat,
      lng: Number.isFinite(lng) ? lng : fallbackLng,
      address: poi.address ?? poi.addressName ?? poi.name ?? "地址待确认",
      reason: "来自天地图地点搜索候选。",
    };
  });
}

function guessCategory(name) {
  if (/站|机场|码头|口岸|客运|枢纽/.test(name)) return "transport";
  if (/大学|学院|学校|校区|研究院|书院/.test(name)) return "university";
  if (/CBD|商务|金融|科技园|产业园|写字楼|中心/.test(name)) return "business";
  if (/商场|广场|万象|购物|百货|奥特莱斯|步行街|商圈/.test(name)) return "shopping";
  if (/餐|咖啡|茶|饭|酒|食|居|店/.test(name)) return "food";
  if (/公园|博物馆|景区|古城|山|湖|塔|寺|宫|街|剧院|美术馆/.test(name)) return "attraction";
  return "custom";
}

async function searchPlaces(keyword, city, lat, lng, count = 8, quick = false) {
  // City is a ranking hint so an explicit POI in another city can still be found.
  let amap;
  try {
    amap = await travelServices.searchPlaces({keyword:keyword.slice(0,100),city:String(city ?? '').slice(0,50),count});
    if (amap.length) return amap.map(place => ({...place, city:place.city || city || '',
      category:guessCategory(place.name), source:'imported', coordinateSystem:'GCJ02',
      isMatched:true, reason:'来自高德地图地点搜索。'}));
  } catch { /* Try the independent map provider. */ }
  try {
    return await searchTianditu(keyword, city, lat, lng, count, quick);
  } catch {
    if (amap) return amap;
    throw new Error('地点搜索暂不可用，请稍后重试');
  }
}

async function searchTianditu(keyword, city, lat, lng, count = 8, quick = false) {
  if (!tiandituToken) throw new Error("TIANDITU_TOKEN is missing");
  const bound = `${lng - 1.6},${lat - 1.6},${lng + 1.6},${lat + 1.6}`;
  const postStr = {
    keyWord: keyword,
    mapBound: bound,
    level: "12",
    queryType: "1",
    start: "0",
    count: String(count),
    specify: city ?? "",
    pointLonlat: `${lng},${lat}`,
    queryRadius: "120000",
  };
  const encoded = encodeURIComponent(JSON.stringify(postStr));
  const urls = [
    `https://api.tianditu.gov.cn/v2/search?postStr=${encoded}&type=query&tk=${tiandituToken}`,
    `https://api.tianditu.gov.cn/search?postStr=${encoded}&type=query&tk=${tiandituToken}`,
  ];
  let lastError;
  for (const url of (quick ? urls.slice(0, 1) : urls)) {
    try {
      const results = normalizeSearchResults(await fetchJson(url, quick ? 1800 : 7000), city, lat, lng);
      if (results.length > 0) return results;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

async function resolvePlaceLocation(place) {
  const cityName = String(place.city ?? "").trim();
  const city = cityName ? await handleGeocode({ keyword: cityName }) : null;
  const lat = Number(city?.lat ?? place.lat ?? 39.9042);
  const lng = Number(city?.lng ?? place.lng ?? 116.4074);
  const keyword = cityName ? `${cityName} ${place.name}` : place.name;
  const results = await searchTianditu(keyword, cityName, lat, lng, 5).catch(() => []);
  const exact = results.find((item) => item.name === place.name || item.name.includes(place.name) || place.name.includes(item.name));
  if (!exact) return { ...place, isMatched: false };
  return {
    ...place,
    city: exact.city || place.city || cityName,
    category: place.category && place.category !== "custom" ? place.category : exact.category,
    isMatched: exact.isMatched,
    coordinateSystem: exact.coordinateSystem,
    lat: exact.lat,
    lng: exact.lng,
    address: exact.address || place.address,
    reason: place.reason || "已用天地图 POI 二次校准位置。",
  };
}

async function resolveExtractedPlaces(places) {
  const ambiguous = /^(新华书店|少年宫|小王村)$/;
  const cleaned = places
    .filter((place) => place?.name && !ambiguous.test(String(place.name).trim()))
    .slice(0, 30);
  const resolved = [];
  for (const place of cleaned) {
    resolved.push(await resolvePlaceLocationWithFallback(place));
  }
  return resolved;
}

async function resolvePlaceLocationWithFallback(place) {
  try {
    return await resolvePlaceLocation(place);
  } catch {
    const keyword = `${place.city ?? ""} ${place.name ?? ""}`.trim();
    const candidates = await handleResolve({ keyword, city: place.city, lat: place.lat, lng: place.lng }).catch(() => []);
    const best = candidates.find((candidate) => Number.isFinite(Number(candidate.lat)) && Number.isFinite(Number(candidate.lng)));
    if (!best) return { ...place, isMatched: false };
    return {
      ...place,
      name: best.name || place.name,
      city: best.city || place.city,
      category: place.category === "custom" ? (best.category || place.category) : place.category,
      isMatched: best.isMatched === true,
      coordinateSystem: best.coordinateSystem,
      lat: Number(best.lat),
      lng: Number(best.lng),
      address: best.address || place.address,
      reason: best.reason || place.reason || "位置已确认。",
    };
  }
}

async function handleSearch(body) {
  const keyword = String(body.keyword ?? "").trim();
  if (!keyword) throw new Error("keyword is required");
  const lng = Number(body.lng ?? 116.4074);
  const lat = Number(body.lat ?? 39.9042);
  let results = [];
  try {
    results = await searchPlaces(keyword, body.city, lat, lng, 8);
  } catch {
    const known = knownResolveCandidates(keyword);
    if (known.length) return known;
    throw new Error("地点搜索暂不可用，请稍后重试");
  }
  if (results.length > 0) return results;
  const geocoded = await handleGeocode({ keyword }).catch(() => null);
  if (!geocoded) return handleResolve({ keyword, city: body.city, lat, lng, purpose: "search" });
  return [{
    name: keyword,
    city: body.city ?? geocoded.name,
    category: guessCategory(keyword),
    source: "imported",
    isMatched: true,
    lat: geocoded.lat,
    lng: geocoded.lng,
    address: geocoded.name,
    reason: "来自天地图地理编码结果。",
  }];
}

const server = http.createServer(async (request, response) => {
  const route = (request.url || '').split('?')[0];
  if (route === '/healthz' && request.method === 'GET') {
    send(response,200,{ok:true});
    return;
  }
  const origin=request.headers.origin;
  if (route.startsWith('/api/') && ['POST','OPTIONS'].includes(request.method) && origin &&
      !allowedOrigins.has(origin)) {
    send(response,403,{error:'请从 Wayline 页面发起请求'});
    return;
  }
  const caller=callerKey(request,{trustProxy});
  if ((route === '/access' && request.method === 'POST') || route.startsWith('/api/auth/') || route.startsWith('/api/calendar/google/')) {
    const admission=authLimiter.take(caller);
    if (!admission.allowed) {
      response.setHeader('Retry-After',String(admission.retryAfterSeconds));
      send(response,429,{error:'请求较频繁，请稍后重试'});
      return;
    }
  }
  try {
    // This callback authenticates its own browser-bound, single-use OAuth state.
    if (request.url?.startsWith("/api/calendar/google/callback?") && await googleCalendar.handle(request,response)) return;
    if (request.url?.startsWith("/api/auth/google/callback?") && await accounts.handle(request, response)) return;
    if (await serveWeb(request, response)) return;
    if (await googleCalendar.handle(request,response)) return;
    if (await accounts.handle(request, response)) return;
  } catch {
    if (!response.headersSent) send(response, 500, { error: "网站暂时无法响应，请稍后重试" });
    else response.end();
    return;
  }
  if (request.method === "OPTIONS") {
    send(response, 204, {});
    return;
  }

  if (request.method !== "POST") {
    send(response, 405, { error: "Method not allowed" });
    return;
  }

  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
    send(response,415,{error:'请求应使用 JSON'});
    return;
  }
  const verdict = admit([[callerLimiter, caller], [siteLimiter, 'site'], ...(fetchRoutes.has(route) ? [[fetchLimiter, caller]] : [])]);
  if (!verdict.allowed) {
    response.setHeader('Retry-After', String(verdict.retryAfterSeconds));
    send(response, 429, { error: '查询较频繁，请稍后重试' });
    return;
  }

  try {
    const body = await readJson(request);
    
    if (request.url === "/api/location") {
      send(response, 200, await travelServices.locate(body));
      return;
    }
    if (request.url === "/api/business-trip/options") {
      send(response, 200, await businessTripOptions(body));
      return;
    }
    if (request.url === "/api/route") {
      send(response, 200, await travelServices.route(body));
      return;
    }
    if (request.url === "/api/extract") {
      send(response, 200, await handleExtract(body));
      return;
    }
    if (request.url === "/api/suggest") {
      const keyword = String(body.keyword ?? "").trim().slice(0, 100);
      const lat = Number(body.lat), lng = Number(body.lng);
      if (!keyword || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180) {
        send(response, 400, {error:"请输入地点名称"}); return;
      }
      // Typing suggestions only query POIs; never run geocoding or model research.
      send(response, 200, await searchPlaces(keyword, String(body.city ?? ""), lat, lng, 8, true));
      return;
    }
    if (request.url === "/api/resolve") {
      send(response, 200, await handleResolve(body));
      return;
    }
    if (request.url === "/api/geocode") {
      send(response, 200, await handleGeocode(body));
      return;
    }
    if (request.url === "/api/calendar/places") {
      try { send(response, 200, { results: await calendarPlaces.resolve(body?.items, (await accounts.accountFor(request))?.id) }); }
      catch (error) { if (error?.status !== 400) throw error; send(response, 400, { error: error.message }); }
      return;
    }
    if (request.url === "/api/search") {
      send(response, 200, await handleSearch(body));
      return;
    }
    if (request.url === "/api/resources") {
      send(response, 200, await cityResources(body));
      return;
    }
    send(response, 404, { error: "Not found" });
  } catch (error) {
    const failure = apiError(error);
    send(response, failure.status, { error: failure.error });
  }
});

server.listen(port, host, () => {
  console.log(`Wayline free planner listening on http://${host}:${port}`);
});

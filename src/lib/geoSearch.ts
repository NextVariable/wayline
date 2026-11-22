import { searchAMapTips } from "./amapSuggestions";
import type { City, CityName, ExtractedPlace, Place } from "../types/place";
import { cityCatalog } from "../data/cities";
import { wgsToGcj, gcjToWgs } from "./trackCoordinates";
import { officialAddressByName } from "../data/systemPlaces";
import { readDemoMode } from "./demoWorkspace";

const apiBase = "";
const tiandituToken = import.meta.env.VITE_TIANDITU_TOKEN as string | undefined;

function distanceText(lat1: number, lng1: number, lat2: number, lng2: number, label = "你") {
  const km = distanceKm(lat1, lng1, lat2, lng2);
  if (!Number.isFinite(km)) return "地图已匹配";
  return km < 1 ? `距${label}约 ${Math.round(km * 1000)}m` : `距${label}约 ${km.toFixed(1)}km`;
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const earthRadiusKm = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Calendar addresses can belong to a different city than the open map. */
export function calendarSearchCity(location: string, fallback: City): City {
  const address = location.trim().replace(/^中国\s*/, "").replace(/^[\u4e00-\u9fff]{2,8}?(?:省|自治区)\s*/, "");
  // Only a leading city is an address scope; city names inside a venue name
  // (for example 南京路) must not silently redirect the query.
  return cityCatalog.find(candidate => address.startsWith(candidate.name + "市"))
    ?? cityCatalog.find(candidate => address.startsWith(candidate.name) && !address.startsWith(candidate.name + "路"))
    ?? fallback;
}

export async function geocodeCity(keyword: string, fallback: City): Promise<City> {
  if (readDemoMode()) return fallback;
  const name = keyword.trim();
  if (!name) return fallback;
  const browser = await geocodeCityStrict(name);
  if (browser) return browser;
  const ai = await resolveWithMap(name, fallback).catch(() => []);
  const best = ai.find((place) => hasCoordinate(place));
  if (best) return { name: best.city || best.name || name, lat: best.lat, lng: best.lng, zoom: 11 };
  return { name, lat: 35.8617, lng: 104.1954, zoom: 5 };
}

type SearchReference = { lat: number; lng: number; label?: string };

const knownPlaceCandidates: ExtractedPlace[] = [
  {
    name: "香港中文大学（深圳）",
    city: "深圳",
    category: "university",
    source: "imported",
    isMatched: true,
    lat: 22.6861,
    lng: 114.2099,
    address: "广东省深圳市龙岗区龙翔大道2001号",
    reason: "深圳校区，位置已确认。",
  },
  {
    name: "大疆天空之城",
    city: "深圳",
    category: "business",
    source: "imported",
    isMatched: true,
    lat: 22.5848,
    lng: 113.9548,
    address: "广东省深圳市南山区西丽街道仙元路55号",
    reason: "大疆深圳总部所在地。",
  },
];

const suggestionCache = new Map<string, {time:number; places:Place[]}>();
export function cachedPlaceSuggestions(keyword:string, city:City, reference?:SearchReference|null):Place[]|undefined {
  const key=JSON.stringify([keyword.trim().toLowerCase(),city.name,city.lat,city.lng,reference?.lat,reference?.lng]);
  const hit=suggestionCache.get(key);
  return hit && Date.now()-hit.time<300000 ? hit.places : undefined;
}
export async function suggestPlaceCandidates(keyword:string,city:City,options:{signal?:AbortSignal;reference?:SearchReference|null}={}):Promise<Place[]> {
  const cached=cachedPlaceSuggestions(keyword,city,options.reference);
  if(cached)return cached;
  const places=await searchPlaceCandidates(keyword,city,{...options,quick:true,aiFallback:false});
  if(options.signal?.aborted)throw new DOMException("Aborted","AbortError");
  const key=JSON.stringify([keyword.trim().toLowerCase(),city.name,city.lat,city.lng,options.reference?.lat,options.reference?.lng]);
  suggestionCache.set(key,{time:Date.now(),places});
  if(suggestionCache.size>128)suggestionCache.delete(suggestionCache.keys().next().value!);
  return places;
}

export async function searchPlaceCandidates(keyword: string, city: City, options: { aiFallback?: boolean; reference?: SearchReference | null; localPlaces?: Place[]; quick?: boolean; signal?: AbortSignal } = {}): Promise<Place[]> {
  if (readDemoMode()) return [];
  const aiFallback = options.aiFallback ?? true;
  const reference = options.reference ?? { lat: city.lat, lng: city.lng, label: "地图中心" };
  const localPlaces = options.localPlaces ?? [];
  const query = keyword.trim();
  if (!query) return [];
  let lookupFailed = false;
  const known = knownPlaceCandidates.filter((place) => matchesKnownPlace(query, place));
  let results: ExtractedPlace[];
  if (options.quick) {
    const fallback = async ():Promise<ExtractedPlace[]> => {
      const response = await fetch("/api/suggest", {
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({keyword:query,city:city.name,lat:city.lat,lng:city.lng}),signal:options.signal,
      });
      if(!response.ok)throw new Error("地点搜索暂不可用");
      const data=await response.json();
      return Array.isArray(data)?data.filter(p=>p&&p.isMatched===true&&hasCoordinate(p)).map(p=>{
        const [lng,lat]=p.coordinateSystem==="WGS84"?wgsToGcj(p.lng,p.lat):[p.lng,p.lat];return {...p,lng,lat};
      }):[];
    };
    const notEmpty = (rows:ExtractedPlace[]) => { if(!rows.length)throw new Error("NO_SUGGESTIONS");return rows; };
    try {
      results=await Promise.any([searchAMapTips(query,city,options.signal).then(notEmpty),fallback().then(notEmpty)]);
    } catch(error) {
      if(options.signal?.aborted)throw new DOMException("Aborted","AbortError");
      const failures=error instanceof AggregateError?error.errors:[];
      if(failures.some(e=>e?.message==="NO_SUGGESTIONS"))results=[];
      else throw new Error("地点搜索暂不可用");
    }
  } else results = await searchTiandituInBrowser(query, city).catch(() => { lookupFailed = true; return []; });
  if (!results.length) results = known;
  // POI geocoding cannot be re-labelled as a city. Only administrative queries qualify.
  const administrative = cityCatalog.some(c => c.name === query || c.name + "市" === query) || /(?:市|县|省|自治州|特别行政区)$/.test(query) || /区$/.test(query) && !/园区|景区|校区|商务区|片区|服务区/.test(query);
  const admin = !options.quick && administrative ? await geocodeCityStrict(query) : null;
  if (admin && admin.name !== city.name && (distanceKm(city.lat, city.lng, admin.lat, admin.lng) > 60 || admin.name.includes(query) || query.includes(admin.name))) {
    results = [
      {
        name: admin.name,
        city: admin.name,
        category: "custom",
        source: "imported",
        isMatched: true,
        lat: admin.lat,
        lng: admin.lng,
        address: admin.name,
        reason: `${admin.name}的位置已匹配。`,
      },
      ...results,
    ];
  }
  if (!options.quick && aiFallback && (results.length === 0 || results.every((place) => !place.isMatched || !hasCoordinate(place)))) {
    const aiResults = await resolveWithMap(query, city, "search").catch(() => { lookupFailed = true; return []; });
    results = [...results, ...aiResults];
  }
  const exact = results.filter(p => p.isMatched && normalizeText(p.name) === normalizeText(query));
  if (exact.length) results = exact;
  const seen = new Set<string>();
  const remotePlaces = results.filter(p => usefulPoiName(p.name) && p.isMatched && hasCoordinate(p)).sort((a, b) => scoreCandidate(b, query, city) - scoreCandidate(a, query, city)).filter((place) => {
    const key = `${place.name}-${Math.round(place.lat * 10000)}-${Math.round(place.lng * 10000)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((place, index): Place => ({
    id: `candidate-${Date.now()}-${index}`,
    name: place.name,
    city: place.city || city.name as CityName,
    category: place.category,
    guideCategories: [place.category],
    type: "system",
    source: "system",
    lat: place.lat,
    lng: place.lng,
    address: officialAddressByName[place.name] ?? place.address,
    openingHours: "以现场营业时间为准",
    description: place.address,
    tags: [],
    reason: place.reason || `${place.name}的位置已匹配。`,
    status: "saved",
    isSaved: false,
    distanceText: place.isMatched ? distanceText(reference.lat, reference.lng, place.lat, place.lng, reference.label) : "待确认位置",
    externalLinks: {
      amap: `https://uri.amap.com/search?keyword=${encodeURIComponent(place.name)}`,
      google: `https://www.google.com/maps/search/?api=1&query=${gcjToWgs(place.lng, place.lat).reverse().join(",")}`,
      apple: `https://maps.apple.com/?q=${encodeURIComponent(place.name)}&ll=${gcjToWgs(place.lng, place.lat).reverse().join(",")}`,
    },
  }));

  if (remotePlaces.length > 0) return remotePlaces;
  const localMatches = matchLocalPlaces(query, localPlaces, city, reference);
  if (localMatches.length) return localMatches;
  if (lookupFailed) throw new Error("地点搜索暂不可用");
  return [];
}

function matchLocalPlaces(query: string, places: Place[], referenceCity: City, reference: SearchReference): Place[] {
  const normalizedQuery = normalizeText(query);
  const seen = new Set<string>();

  return places
    .filter((place) => {
      const nameMatch = normalizeText(place.name).includes(normalizedQuery) || normalizedQuery.includes(normalizeText(place.name));
      const addressMatch = place.address && normalizeText(place.address).includes(normalizedQuery);
      return nameMatch || addressMatch;
    })
    .sort((a, b) => {
      const aNameExact = normalizeText(a.name) === normalizedQuery ? 1 : 0;
      const bNameExact = normalizeText(b.name) === normalizedQuery ? 1 : 0;
      if (aNameExact !== bNameExact) return bNameExact - aNameExact;
      const aCityMatch = a.city === referenceCity.name ? 1 : 0;
      const bCityMatch = b.city === referenceCity.name ? 1 : 0;
      if (aCityMatch !== bCityMatch) return bCityMatch - aCityMatch;
      return distanceKm(reference.lat, reference.lng, a.lat, a.lng) - distanceKm(reference.lat, reference.lng, b.lat, b.lng);
    })
    .slice(0, 8)
    .filter((place) => {
      const key = `${place.name}-${Math.round(place.lat * 10000)}-${Math.round(place.lng * 10000)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((place, index): Place => ({
      ...place,
      id: `candidate-local-${Date.now()}-${index}`,
      guideCategories: place.guideCategories?.length ? place.guideCategories : [place.category],
      distanceText: distanceText(reference.lat, reference.lng, place.lat, place.lng, reference.label ?? "地图中心"),
    }));
}

export async function reverseGeocodeAddress(lat: number, lng: number): Promise<string | null> {
  if (readDemoMode() || !tiandituToken || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const [longitude, latitude] = gcjToWgs(lng, lat);
  const postStr = JSON.stringify({ lon: longitude, lat: latitude, ver: 1 });
  const endpoints = [
    `https://api.tianditu.gov.cn/geocoder?postStr=${encodeURIComponent(postStr)}&type=geocode&tk=${tiandituToken}`,
  ];
  for (const url of endpoints) {
    try {
      const data = await fetchWithTimeout(url).then((response) => response.json());
      const address = normalizeReverseAddress(data);
      if (address) return address;
    } catch {
      // Try the next protocol.
    }
  }
  return null;
}

function normalizeReverseAddress(data: unknown) {
  const payload = data as {
    result?: {
      formatted_address?: string;
      formattedAddress?: string;
      address?: string;
      addressComponent?: Record<string, string>;
    };
  };
  const result = payload?.result;
  if (!result) return null;
  const formatted = String(result.formatted_address ?? result.formattedAddress ?? result.address ?? "").trim();
  if (isDetailedAddress(formatted)) return formatted;
  const component = result.addressComponent ?? {};
  const parts = [
    component.province,
    component.city,
    component.county || component.district,
    component.town,
    component.road || component.street,
    component.street_number || component.streetNumber,
  ].filter(Boolean);
  const combined = Array.from(new Set(parts)).join("");
  return isDetailedAddress(combined) ? combined : null;
}

function isDetailedAddress(value: string) {
  if (!value || /候选|附近|行政中心|行政区/.test(value)) return false;
  return /省|市|区|县|路|街|道|号|镇|乡|村|大道/.test(value) && value.length >= 6;
}

export async function resolveExtractedPlace(place: ExtractedPlace): Promise<ExtractedPlace> {
  const cityFromMap = await geocodeCityStrict(place.city);
  const hasAiCoordinate = Number.isFinite(place.lat) && Number.isFinite(place.lng) && Math.abs(place.lat) > 0.01 && Math.abs(place.lng) > 0.01;
  const city: City = cityFromMap ?? {
    name: place.city,
    lat: hasAiCoordinate ? place.lat : 39.9042,
    lng: hasAiCoordinate ? place.lng : 116.4074,
    zoom: 12,
  };
  const candidates: ExtractedPlace[] = [];
  for (const term of [`${place.city}${place.name}`, `${place.city} ${place.name}`, place.name]) {
    const found = await searchTiandituInBrowser(term, city).catch(() => []);
    candidates.push(...found);
    if (found.some((candidate) => candidate.name === place.name || candidate.name.includes(place.name) || place.name.includes(candidate.name))) break;
  }
  const best =
    candidates.find((candidate) => candidate.name === place.name) ??
    candidates.find((candidate) => candidate.name.includes(place.name) || place.name.includes(candidate.name));
  if (!best) {
    const aiCandidates = await resolveWithMap(`${place.city} ${place.name}`, city).catch(() => []);
    const aiBest =
      aiCandidates.find((candidate) => candidate.name === place.name && candidate.isMatched && hasCoordinate(candidate));
    if (aiBest) {
      return {
        ...place,
        city: aiBest.city || place.city,
        category: place.category === "custom" ? aiBest.category : place.category,
        lat: aiBest.lat,
        lng: aiBest.lng,
        address: aiBest.address,
        isMatched: true,
        reason: aiBest.reason || "来自地图地点查询。",
      };
    }
    return {
      ...place,
      city: place.city,
      isMatched: false,
      reason: "尚未核实位置，请补充完整名称或地址后重试。",
    };
  }
  return {
    ...place,
    city: best.city || place.city,
    category: place.category === "custom" ? best.category : place.category,
    lat: best.lat,
    lng: best.lng,
    address: best.address,
    isMatched: true,
    reason: place.reason || "已用天地图搜索校准位置。",
  };
}

async function resolveWithMap(keyword: string, city: City, purpose: "resolve" | "search" = "resolve"): Promise<ExtractedPlace[]> {
  const response = await fetchWithTimeout(`${apiBase}/api/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword, city: city.name, lat: city.lat, lng: city.lng, purpose }),
  });
  if (!response.ok) throw new Error("Map lookup failed");
  const data = await response.json() as ExtractedPlace[];
  return (Array.isArray(data) ? data : []).filter(p => p && usefulPoiName(p.name) && p.isMatched === true && hasCoordinate(p)).map((place) => ({
    ...place,
    ...(() => { const [lng, lat] = place.coordinateSystem === "WGS84" ? wgsToGcj(place.lng, place.lat) : [place.lng, place.lat]; return { lat, lng }; })(),
    source: "imported",
    isMatched: place.isMatched === true,
    category: place.category || guessCategory(place.name),
  }));
}

function hasCoordinate(place: Pick<ExtractedPlace, "lat" | "lng">) {
  return Number.isFinite(place.lat) && Number.isFinite(place.lng) && Math.abs(place.lat) <= 90 && Math.abs(place.lng) <= 180 && !(place.lat === 0 && place.lng === 0);
}

function matchesKnownPlace(query: string, place: ExtractedPlace) {
  const normalized = normalizeText(query);
  const target = normalizeText(place.name);
  if (normalized.includes("港中深") && target.includes("香港中文大学深圳")) return true;
  if (normalized.includes("香港中文大学") && normalized.includes("深圳") && target.includes("香港中文大学深圳")) return true;
  if ((normalized.includes("大疆") || normalized.includes("dji")) && target.includes("大疆")) return true;
  return target.includes(normalized) || normalized.includes(target);
}

function scoreCandidate(place: ExtractedPlace, query: string, city: City) {
  const normalizedQuery = normalizeText(query);
  const normalizedName = normalizeText(place.name);
  const text = normalizeText(`${place.name} ${place.city} ${place.address} ${place.reason}`);
  let score = 0;
  if (normalizedName === normalizedQuery) score += 80;
  if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) score += 42;
  if (sameCity(place.city, city.name) || text.includes(normalizeText(city.name))) score += 34;
  if (normalizedQuery.includes("深圳") && text.includes("深圳")) score += 36;
  if (normalizedQuery.includes("香港中文大学") && normalizedQuery.includes("深圳") && text.includes("香港本部")) score -= 120;
  if (normalizedQuery.includes("港中深") && text.includes("香港本部")) score -= 120;
  if (normalizedQuery.includes("大疆") && text.includes("深圳")) score += 34;
  return score;
}

function sameCity(a: string, b: string) {
  const clean = (value: string) => normalizeText(value).replace(/市|区|县|自治州|特别行政区/g, "");
  return clean(a).includes(clean(b)) || clean(b).includes(clean(a));
}

function fetchWithTimeout(url: string, timeoutMs: number | RequestInit = 5000): Promise<Response> {
  const controller = new AbortController();
  const ms = typeof timeoutMs === "number" ? timeoutMs : 5000;
  const init: RequestInit = typeof timeoutMs === "object" ? { ...timeoutMs, signal: controller.signal } : { signal: controller.signal };
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, init).finally(() => clearTimeout(timer));
}

function usefulPoiName(value:unknown): value is string {
  return typeof value==='string' && !!value.trim() && !/^(?:image|img|photo|thumbnail|undefined|null|unknown|未命名|暂无名称|未知地点|候选地点\s*\d+)$/i.test(value.trim());
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[（）()·\s]/g, "");
}

async function geocodeCityStrict(keyword: string): Promise<City | null> {
  const name = keyword.trim();
  if (!name || !tiandituToken) return null;
  try {
    const adminUrl = `https://api.tianditu.gov.cn/v2/administrative?keyword=${encodeURIComponent(name)}&childLevel=0&extensions=true&tk=${tiandituToken}`;
    const admin = await fetchWithTimeout(adminUrl).then((response) => response.json());
    const city = normalizeCityResult(name, admin);
    if (city) return city;
    const geocodeUrl = `https://api.tianditu.gov.cn/geocoder?ds=${encodeURIComponent(JSON.stringify({ keyWord: name }))}&tk=${tiandituToken}`;
    const geo = await fetchWithTimeout(geocodeUrl).then((response) => response.json());
    const location = geo?.location;
    if (location?.lat && location?.lon) return { name, lat: Number(location.lat), lng: Number(location.lon), zoom: 11 };
  } catch {
    return null;
  }
  return null;
}

function normalizeCityResult(keyword: string, data: unknown): City | null {
  const payload = data as { district?: { center?: string; latlon?: string; lonlat?: string; lat?: number | string; lon?: number | string; lng?: number | string; name?: string }[] | { center?: string; latlon?: string; lonlat?: string; lat?: number | string; lon?: number | string; lng?: number | string; name?: string } };
  const district = Array.isArray(payload?.district) ? payload.district[0] : payload?.district;
  const center = district?.center ?? district?.latlon ?? district?.lonlat;
  if (typeof center === "string" && center.includes(",")) {
    const [lng, lat] = center.split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { name: (district?.name as CityName) ?? keyword, lat, lng, zoom: 11 };
  }
  const lat = Number(district?.lat);
  const lng = Number(district?.lon ?? district?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { name: (district?.name as CityName) ?? keyword, lat, lng, zoom: 11 };
  return null;
}

async function searchTiandituInBrowser(keyword: string, city: City): Promise<ExtractedPlace[]> {
  if (!tiandituToken) throw new Error("地点查询未配置");
  const bound = `${city.lng - 1.6},${city.lat - 1.6},${city.lng + 1.6},${city.lat + 1.6}`;
  const postStr = {
    keyWord: keyword,
    mapBound: bound,
    level: "12",
    queryType: "1",
    start: "0",
    count: "8",
    specify: city.name,
    pointLonlat: `${city.lng},${city.lat}`,
    queryRadius: "120000",
  };
  const encoded = encodeURIComponent(JSON.stringify(postStr));
  const urls = [
    `https://api.tianditu.gov.cn/v2/search?postStr=${encoded}&type=query&tk=${tiandituToken}`,
    `https://api.tianditu.gov.cn/search?postStr=${encoded}&type=query&tk=${tiandituToken}`,
  ];
  let successfulRequests = 0;
  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) throw new Error("地点查询失败");
      const data = await response.json();
      if (data?.status?.infocode && String(data.status.infocode) !== "1000") throw new Error("地点查询失败");
      successfulRequests++;
      const results = normalizeSearchResults(data, city);
      if (results.length > 0) return results;
    } catch {
      // Try next endpoint variant.
    }
  }
  if (!successfulRequests) throw new Error("地点搜索暂不可用");
  return [];
}

function normalizeSearchResults(data: unknown, fallbackCity: City): ExtractedPlace[] {
  const payload = data as { pois?: Array<Record<string, unknown>>; result?: { pois?: Array<Record<string, unknown>> }; suggests?: Array<Record<string, unknown>> };
  const pois = payload?.pois ?? payload?.result?.pois ?? payload?.suggests ?? [];
  if (!Array.isArray(pois)) return [];
  return pois.slice(0, 8).map((poi, index): ExtractedPlace => {
    const lonlat = poi.lonlat ?? poi.lonlatArr ?? poi.location;
    let lng = Number(poi.lon ?? poi.lng);
    let lat = Number(poi.lat);
    if (typeof lonlat === "string" && lonlat.includes(",")) {
      const parts = lonlat.split(",").map(Number);
      lng = parts[0];
      lat = parts[1];
    }
    if (Number.isFinite(lat) && Number.isFinite(lng)) [lng, lat] = wgsToGcj(lng, lat);
    const name = String(poi.name ?? poi.hotPointName ?? poi.address ?? `候选地点 ${index + 1}`);
    const cityName = inferPoiCity(poi, fallbackCity.name);
    return {
      name,
      city: cityName,
      category: guessCategory(name),
      source: "imported",
      isMatched: Number.isFinite(lat) && Number.isFinite(lng),
      lat: Number.isFinite(lat) ? lat : fallbackCity.lat,
      lng: Number.isFinite(lng) ? lng : fallbackCity.lng,
      address: cleanPoiAddress(poi, name, cityName),
      reason: `${name}的位置已匹配。`,
    };
  }).filter(place=>usefulPoiName(place.name));
}

export function canonicalPoiCity(value: string): CityName {
  value=value.replace(/^中国\s*/,'').replace(/特别行政区$/,'');
  const city = [...value.matchAll(/([^省市区县]+)市/g)].at(-1);
  if (city) return city[1];
  return value.replace(/市$/, "");
}

function inferPoiCity(poi: Record<string, unknown>, fallback: CityName): CityName {
  const county=poi.countyName??poi.county;
  if(typeof county==='string' && /市$/.test(county.trim()))return canonicalPoiCity(county.trim());
  const direct = poi.cityName ?? poi.city;
  if (typeof direct === "string" && direct.trim()) return canonicalPoiCity(direct.trim());
  const address = String(poi.address ?? poi.addressName ?? "");
  if(address.includes('市'))return canonicalPoiCity(address);
  const district=poi.adName??county;
  if(typeof district==='string'&&district.trim())return canonicalPoiCity(district.trim());
  return fallback;
}

function cleanPoiAddress(poi: Record<string, unknown>, name: string, cityName: CityName) {
  const official = officialAddressByName[name];
  if (official) return official;
  const raw = String(poi.address ?? poi.addressName ?? "").trim();
  if (raw && raw !== name && !/候选|附近/.test(raw)) return raw;
  const province = String(poi.provinceName ?? poi.province ?? "").trim();
  const city = String(poi.cityName ?? poi.city ?? cityName ?? "").trim();
  const county = String(poi.countyName ?? poi.county ?? poi.adName ?? "").trim();
  const parts = [province, city, county].filter(Boolean);
  const prefix = Array.from(new Set(parts)).join("");
  return prefix && prefix !== name ? `${prefix}${name}` : "";
}

function guessCategory(name: string): Place["category"] {
  if (/站|机场|码头|口岸|客运|枢纽/.test(name)) return "transport";
  if (/大学|学院|学校|校区|研究院|书院/.test(name)) return "university";
  if (/CBD|商务|金融|科技园|产业园|写字楼|中心/.test(name)) return "business";
  if (/商场|广场|万象|购物|百货|奥特莱斯|步行街|商圈/.test(name)) return "shopping";
  if (/餐|咖啡|茶|饭|酒|食|居|店/.test(name)) return "food";
  if (/公园|博物馆|景区|古城|山|湖|塔|寺|宫|街|剧院|美术馆/.test(name)) return "attraction";
  return "custom";
}

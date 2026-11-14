import caac from "./caac-passenger-airports.json" with { type: "json" };
import mainRail from "./main-passenger-rail.json" with { type: "json" };

import { wgsToGcj } from "./travel-services.mjs";
import { hongKongMacaoResources } from "./hong-kong-macao-resources.mjs";
import { businessDirectory } from "./business-centers.mjs";

const hubTypes = {
  '150104': /机场$/,
  '150200': /站$/,
  '150301': /(?:邮轮中心|邮轮母港|客运港|客运码头)$/,
  '151000': /口岸$/,
  '151200': /(?:轮渡码头|轮渡站|客运码头)$/,
};
// These passenger hubs serve the selected city from a neighbouring municipality.
const regionalAirports = new Map([
  ['西安', ['咸阳', '西安咸阳国际机场', 'https://www.xxia.com.cn/']],
  ['西宁', ['海东', '西宁曹家堡国际机场', 'https://www.cwag.com/info/1030/2279.htm']],
  ['拉萨', ['山南', '拉萨贡嘎国际机场', caac.source]],
]);
const passengerCheckpoints = new Map([
  ['深圳', new Set(['深圳罗湖口岸', '深圳湾口岸', '深圳皇岗口岸', '深圳福田口岸', '莲塘口岸', '深圳文锦渡口岸'])],
  ['珠海', new Set(['珠海拱北口岸', '珠海横琴口岸', '港珠澳大桥珠海公路口岸'])],
]);
const railNames = new Map(Object.entries(mainRail.cities).map(([city, names]) => [city, new Set(names)]));
const railAliases = new Map([
  ['深圳机场站', '深圳机场站(T3)(城际站)'],
]);
const railSources = new Map([
  ['莘庄站', 'https://www.shanghai.gov.cn/nw4411/20250106/4a9c6428b8c0435c838a2bab17e797bf.html'],
  ['金山卫站', 'https://www.shanghai.gov.cn/nw17239/20260313/cc9fe6e3e47a47aca3a55b29cd0fb089.html'],
  ['深圳机场站', 'https://jtys.sz.gov.cn/ydmh/jtcx/hccx/hczfb/content/post_9979892.html'],
  ['广州新塘站', 'https://jtj.gz.gov.cn/xwdt/gzdt/content/post_10050166.html'],
  ['天府机场站', 'https://www.sctyzx.gov.cn/scyw/202312/54301809.html'],
  ['天河机场站', 'https://jtj.wuhan.gov.cn/jtzx/zwdt/202502/t20250227_2541193.shtml'],
  ['吴圩机场站', 'https://zn.caac.gov.cn/ZN_XXGK/ZN_HYDT/202211/t20221107_216363.html'],
]);
const documentedTransport = new Map([
  ['北京', ['大兴机场站', 39.512492, 116.410712, '北京大兴国际机场地下铁路车站', 'Q120142108',
    'https://zdzqgw.beijing.gov.cn/zqfw/bjdxgjjc/bjdxgjjcjb/202410/t20241012_3917918.html']],
]);
const qiongzhouFerry = 'https://lwj.sanya.gov.cn/wljsite/hygq/202604/a6ace804098445b2b916dbd91b6af70a.shtml';
const dalianFerry = 'https://www.yantai.gov.cn/col/col118136/art/2026/art_b97a71c0ffe6477291c579839c886955.html';
const namedFerries = new Map([
  ['海口', [
    ['新海港码头', '新海港码头', '150301', qiongzhouFerry],
    ['秀英港客运站', '秀英港客运站(旅客出岛)', '150306', qiongzhouFerry],
  ]],
  ['大连', [
    ['大连港客运站', '大连港客运站(轮渡站)', '151200', dalianFerry],
    ['大连港大连湾客运站', '大连港大连湾客运站', '150301', dalianFerry],
  ]],
]);
const hubQueries = [
  ['150200', 25, 12],
  ['150104', 15, 4],
  ['151000', 20, 6],
  ['150301|151200', 18, 4],
];
const normalizeCity = (value) => String(value ?? '').trim().replace(/(?:特别行政区|市)$/, '');
const normalizeName = (value) => value.normalize('NFKC').replace(/\s/g, '');
const airportIdentity = (name) => normalizeName(name).replace(/(?:国际|民用)?机场$/, '');
const passengerAirports = new Set(caac.airports.flatMap(entry => {
  const [city, airport] = entry.split('/');
  return airport ? [airportIdentity(city + airport), airportIdentity(airport)] : [airportIdentity(city)];
}));
// Require a city's own airport name in these cities. County-level airports in
// the municipality may use a different, explicitly recognised prefix.
const airportPrefixes = new Map([
  ['重庆', ['重庆', '万州', '黔江']],
  ['大连', ['大连', '长海']],
]);
const isPassengerAirport = (city, name) => passengerAirports.has(airportIdentity(name)) &&
  (!railNames.has(city) || (airportPrefixes.get(city) ?? [city]).some(prefix => name.startsWith(prefix)));
const hasType = (point, type) => point.typecode?.split('|').includes(type);
const validPoint = (point, city) => typeof point.id === 'string' && point.id &&
  normalizeCity(point.city) === city && Number.isFinite(point.lat) && Number.isFinite(point.lng) &&
  Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180 && (point.lat !== 0 || point.lng !== 0);

export function createCityResourceLookup(searchPlaces) {
  const cached = new Map();
  async function resolveExact(city, keyword, type, district) {
    const rows = await searchPlaces({ city, keyword, types: type, count: 15, cityLimit: true });
    const matches = rows.filter(point => validPoint(point, city) && hasType(point, type) &&
      normalizeName(point.name) === normalizeName(keyword) && (!district || district.test(point.district)));
    const unique = [...new Map(matches.map(point => [point.id, point])).values()];
    return unique.length === 1 ? unique[0] : undefined;
  }
  async function load(city, category) {
    const queriedAt = new Date().toISOString();
    const toPlace = (point, name, officialUrl, coordinateUrl, coordinateProvider = 'Wikidata') => ({
      id: `resource-${category}-${point.id}`,
      name, city, category, type: 'system', source: 'system',
      lat: point.lat, lng: point.lng, address: point.address || '',
      openingHours: '', description: '', reason: '', tags: [],
      status: 'saved', isSaved: false, distanceText: '',
      externalLinks: { amap: `https://uri.amap.com/marker?position=${point.lng},${point.lat}&name=${encodeURIComponent(name)}` },
      resourceEvidence: coordinateUrl
        ? { provider: coordinateProvider, officialUrl, coordinateUrl }
        : { provider: '高德地图', retrievedAt: queriedAt, ...(officialUrl ? { officialUrl } : {}) },
    });
    const fromDocumentedPoint = ([name, latitude, longitude, address, id, officialUrl, officialMapUrl]) => {
      const [lng, lat] = wgsToGcj(longitude, latitude);
      return toPlace({ id, lat, lng, address }, name, officialUrl,
        officialMapUrl ?? `https://www.wikidata.org/wiki/${id}`, officialMapUrl ? '官方地图' : 'Wikidata');
    };
    const documented = hongKongMacaoResources.get(city);
    if (documented) return {
      places: documented.filter(([layer]) => layer === category).map(([, ...point]) => fromDocumentedPoint(point)),
      incomplete: false,
    };
    const selectedRail = railNames.get(city);
    let railIncomplete = false;
    const searches = category === 'business'
      ? (businessDirectory.get(city) ?? []).map(async ([name, keyword, types, officialUrl, district]) => {
          const point = await resolveExact(city, keyword, types, district);
          return point ? [toPlace(point, name, officialUrl)] : [];
        })
      : hubQueries.filter(([types]) => types !== '151000' || passengerCheckpoints.has(city)).map(async ([types, count, limit]) => {
          const codes = types.split('|');
          const rows = await searchPlaces({ city, keyword: '', types, count, cityLimit: true });
          if (types === '150200' && selectedRail) {
            const byMapName = new Map();
            for (const point of rows) {
              if (validPoint(point, city) && hasType(point, types)) {
                const name = normalizeName(point.name);
                if (!byMapName.has(name)) byMapName.set(name, point);
              }
            }
            const matches = await Promise.allSettled([...selectedRail].map(async name => {
              const keyword = railAliases.get(name) ?? name;
              const point = byMapName.get(keyword) ?? await resolveExact(city, keyword, types);
              return point && toPlace(point, name, railSources.get(name) ?? mainRail.source);
            }));
            railIncomplete = matches.some(result => result.status === 'rejected');
            const places = matches.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
            if (!places.length && railIncomplete) throw new Error('铁路车站暂时无法加载');
            return places;
          }
          return rows.filter(point => validPoint(point, city) && codes.includes(point.typecode) &&
            hubTypes[point.typecode].test(point.name) &&
            (point.typecode !== '150104' || isPassengerAirport(city, point.name)) &&
            (point.typecode !== '151000' || passengerCheckpoints.get(city)?.has(point.name)) &&
            !/[()（）]|地铁|公交|货运|保养|通用机场|水上机场|直升机|训练机场|试飞机场|军用机场|在建|建设中|停运|铁路局|信号|停车|航站楼|售票|进站|出站/.test(point.name))
            .map(point => {
              // Shenzhen's official place-name gazetteer identifies the two POIs as one terminal.
              const name = city === '深圳' && /^(招商蛇口邮轮中心|深圳蛇口国际邮轮母港)$/.test(point.name)
                ? '蛇口邮轮中心' : point.name;
              return toPlace(point, name, point.typecode === '150104' ? caac.source : undefined);
            }).filter((place, index, places) => places.findIndex(other => other.name === place.name) === index)
            .slice(0, limit);
        });
    const regionalAirport = category === 'transport' ? regionalAirports.get(city) : undefined;
    const documentedHub = category === 'transport' ? documentedTransport.get(city) : undefined;
    const independentPlaces = documentedHub ? [fromDocumentedPoint(documentedHub)] : [];
    for (const [name, keyword, type, source] of (category === 'transport' ? namedFerries.get(city) ?? [] : [])) {
      searches.push(resolveExact(city, keyword, type).then(point => point ? [toPlace(point, name, source)] : []));
    }
    if (regionalAirport) {
      const [airportCity, name, officialUrl] = regionalAirport;
      searches.push(resolveExact(airportCity, name, '150104').then(point => point
        ? [toPlace({ ...point, address: point.address?.startsWith(airportCity) ? point.address : [`${airportCity}市`, point.address].filter(Boolean).join(' · ') }, name, officialUrl)]
        : []));
    }
    const results = await Promise.allSettled(searches);
    const incomplete = railIncomplete || results.some(result => result.status === 'rejected');
    if (!independentPlaces.length && incomplete && results.every(result => result.status === 'rejected')) {
      throw new Error('地图地点暂时无法加载');
    }
    const byName = new Map(independentPlaces.map(place => [normalizeName(place.name), place]));
    const ids = new Set(independentPlaces.map(place => place.id));
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const place of result.value) {
        const name = normalizeName(place.name);
        if (!byName.has(name) && !ids.has(place.id)) {
          byName.set(name, place);
          ids.add(place.id);
        }
      }
    }
    return { places: [...byName.values()], incomplete };
  }
  return async (input) => {
    const city = normalizeCity(input?.city);
    const category = input?.category;
    if (!city || city.length > 40 || !['transport', 'business'].includes(category)) {
      return { places: [], incomplete: false };
    }
    const key = JSON.stringify([city, category]);
    const existing = cached.get(key);
    if (existing && existing.expires > Date.now()) return existing.result;
    const entry = { expires: Date.now() + 15 * 60_000, result: load(city, category) };
    if (cached.size >= 80) cached.delete(cached.keys().next().value);
    cached.set(key, entry);
    try {
      const result = await entry.result;
      if (result.incomplete) entry.expires = Date.now() + 30_000;
      return result;
    } catch (error) {
      if (cached.get(key) === entry) cached.delete(key);
      throw error;
    }
  };
}

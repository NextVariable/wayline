import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const airports = {
  SZX: { city: '深圳', name: '深圳宝安国际机场' },
  SHA: { city: '上海', name: '上海虹桥国际机场' },
  PVG: { city: '上海', name: '上海浦东国际机场' },
};
const cityName = value => typeof value === 'string' ? value.trim().replace(/市$/, '') : '';
const numberPattern = /^[A-Z0-9]{2}\d{2,4}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/;
const at = value => typeof value === 'string' ? value.replace(' ', 'T') + '+08:00' : '';
const validTimestamp = value => timestampPattern.test(value) && Number.isFinite(Date.parse(value)) &&
  new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 19) === value.slice(0, 19);
export const flightKey = flight => [flight.number, flight.from, flight.to, flight.departure, flight.arrival].join('|');

export function validFlightIdentity(flight) {
  return flight && typeof flight.number === 'string' && numberPattern.test(flight.number) &&
    typeof flight.from === 'string' && Object.hasOwn(airports, flight.from) &&
    typeof flight.to === 'string' && Object.hasOwn(airports, flight.to) &&
    airports[flight.from].city !== airports[flight.to].city &&
    typeof flight.departure === 'string' && typeof flight.arrival === 'string' &&
    validTimestamp(flight.departure) && validTimestamp(flight.arrival) &&
    Date.parse(flight.arrival) > Date.parse(flight.departure) &&
    Date.parse(flight.arrival) - Date.parse(flight.departure) <= 5 * 3600000;
}

export function validateFlightPreference(body) {
  if (body.flight === undefined) return;
  const flight = body.flight;
  if (!flight || !['flight', 'compare'].includes(flight.mode) || typeof flight.checkedBag !== 'boolean' ||
      !Number.isInteger(flight.travelers) || flight.travelers < 1 || flight.travelers > 20 ||
      (body.party && body.party.travelers !== flight.travelers)) {
    throw new Error('请确认航班人数和托运行李');
  }
  for (const direction of ['outbound', 'return']) {
    const booked = flight.booked?.[direction];
    if (booked !== undefined && !validFlightIdentity(booked)) throw new Error('已订航班信息无效');
    const focus = flight.focus?.[direction];
    if (focus !== undefined && !validFlightIdentity(focus)) throw new Error('关注的航班信息无效');
    if (booked && focus) throw new Error('已订航班无需关注价格');
  }
}

function publicBookingUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.host === 'router.feizhu.com' && !url.username && !url.password) return url.href;
  } catch { /* The fare remains usable as a reference without a link. */ }
  return null;
}

/** FlyAI ticketPrice does not establish checkout total, baggage, or inventory. */
export function readFlightOffers(raw, query, observedAt = Date.now()) {
  if (!Array.isArray(raw?.data?.itemList)) throw new Error('航班来源没有返回可读取的结果');
  const offers = new Map();
  for (const item of raw.data.itemList.slice(0, 80)) {
    const journey = item?.journeys?.[0];
    const segment = journey?.segments?.[0];
    if (item?.journeys?.length !== 1 || journey.journeyType !== '直达' || journey.segments?.length !== 1 ||
        segment?.transportType !== '飞机' || segment.seatClassName !== '经济舱' ||
        (segment.stopInfos && (!Array.isArray(segment.stopInfos) || segment.stopInfos.length))) continue;
    const flight = {
      number: segment.marketingTransportNo,
      from: segment.depStationCode,
      to: segment.arrStationCode,
      departure: at(segment.depDateTime),
      arrival: at(segment.arrDateTime),
    };
    if (!validFlightIdentity(flight) || airports[flight.from].city !== query.origin ||
        airports[flight.to].city !== query.destination || flight.departure.slice(0, 10) !== query.date ||
        (query.number && flight.number !== query.number) || Date.parse(flight.departure) <= observedAt) continue;
    const price = /^\d{1,6}(?:\.\d{1,2})?$/.test(item.ticketPrice) ? Number(item.ticketPrice) : null;
    const row = { ...flight, referencePrice: price > 0 ? price : null, totalPrice: null,
      bookingUrl: publicBookingUrl(item.jumpUrl), observedAt, source: '飞猪 FlyAI' };
    const key = flightKey(flight);
    if (!offers.has(key) || (row.referencePrice ?? Infinity) < (offers.get(key).referencePrice ?? Infinity)) offers.set(key, row);
  }
  return { candidates: [...offers.values()] };
}

export function createFlightSupplier({ dataDir = '.wayline-private/flyai' } = {}) {
  return async query => {
    const require = createRequire(new URL('./provider-runtime/package.json', import.meta.url));
    const cli = require.resolve('@fly-ai/flyai-cli/dist/flyai-bundle.cjs');
    const profile = resolve(dataDir);
    await mkdir(profile, { recursive: true, mode: 0o700 });
    const args = ['search-flight', '--origin', query.origin, '--destination', query.destination,
      '--dep-date', query.date, '--journey-type', '1', '--seat-class-name', 'economy',
      '--sort-type', query.number ? '3' : '6'];
    if (query.number) args.push('--transport-no', query.number);
    if (query.earliestDeparture) args.push('--dep-hour-start', query.earliestDeparture.slice(11, 13));
    if (query.latestArrival) args.push('--arr-hour-end', query.latestArrival.slice(11, 13));
    // A dedicated client profile avoids inheriting any account or API key.
    const env = { HOME: profile, PATH: process.env.PATH || '/usr/bin:/bin' };
    for (const name of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY', 'NODE_EXTRA_CA_CERTS']) {
      if (process.env[name]) env[name] = process.env[name];
    }
    const { stdout } = await exec(process.execPath, [cli, ...args], { env, timeout: 14000, maxBuffer: 512000 });
    return readFlightOffers(JSON.parse(stdout), query);
  };
}

export async function researchFlights({ body, brief, origin, destination, services }) {
  const config = body.flight;
  const result = { outbound: [], returning: [], pending: [] };
  if (!config) return result;
  const fromCity = cityName(origin?.city || brief.origin_city);
  const toCity = cityName(brief.destination_city);
  const returnCity = cityName(destination?.city || fromCity);
  if (![fromCity, toCity, returnCity].every(city => city === '上海' || city === '深圳') ||
      fromCity === toCity || returnCity === toCity) {
    result.pending.push('航班试点支持深圳与上海，请核对出发和目的城市。');
    return result;
  }

  const endpoints = new Map();
  function airportPlace(code) {
    const airport = airports[code];
    if (!endpoints.has(code)) {
      endpoints.set(code, Promise.resolve().then(() => services.resolvePlace?.(airport)).then(place => {
        if (!place || cityName(place.city) !== airport.city || !Number.isFinite(place.lat) || !Number.isFinite(place.lng) ||
            !place.name.includes(airport.name.slice(2, 4)) || !/机场/.test(place.name)) return null;
        return { ...place, name: airport.name };
      }).catch(() => null));
    }
    return endpoints.get(code);
  }

  async function find(direction, from, to, date) {
    const pinned = config.booked?.[direction] || config.focus?.[direction];
    const booked = !!config.booked?.[direction];
    if (pinned && (airports[pinned.from].city !== from || airports[pinned.to].city !== to ||
        pinned.departure.slice(0, 10) !== date)) {
      result.pending.push('已选航班的日期或机场与当前行程不一致。');
      return [];
    }
    const daily = brief.events.filter(event => event.start.slice(0, 10) === date);
    const latestArrival = direction === 'outbound' ? daily[0]?.start : brief.journey.deadline;
    const earliestDeparture = direction === 'outbound' ? brief.journey.earliest : daily.at(-1)?.end;
    const raw = booked ? [{ ...pinned, observedAt: Date.now(), source: '用户确认已订', totalPrice: null, referencePrice: null }] :
      (await services.findFlights?.({ origin: from, destination: to, date, number: pinned?.number,
        latestArrival, earliestDeparture }))?.candidates || [];
    const rows = raw.filter(row => validFlightIdentity(row) &&
      airports[row.from].city === from && airports[row.to].city === to && row.departure.slice(0, 10) === date &&
      (booked || Date.parse(row.departure) > Date.now()) &&
      (!pinned || flightKey(row) === flightKey(pinned)));
    const eligible = rows.filter(row => (!latestArrival || Date.parse(row.arrival) <= Date.parse(latestArrival)) &&
      (!earliestDeparture || Date.parse(row.departure) >= Date.parse(earliestDeparture)));
    const pool = eligible.length ? eligible : rows;
    // Represent both airports before filling remaining slots by price.
    const sorted = [...pool].sort((a, b) => (a.totalPrice ?? a.referencePrice ?? Infinity) - (b.totalPrice ?? b.referencePrice ?? Infinity));
    const airport = direction === 'outbound' ? 'to' : 'from';
    const firstPerAirport = [...new Set(sorted.map(row => row[airport]))].map(code => sorted.find(row => row[airport] === code));
    const chosen = [...new Set([...firstPerAirport, ...sorted])].slice(0, 4);
    return Promise.all(chosen.map(async row => ({
      ...row, kind: 'air', booked, origin: airports[row.from].name, destination: airports[row.to].name,
      originPlace: await airportPlace(row.from), destinationPlace: await airportPlace(row.to),
      // Future adapters may supply a total only when the exact party and baggage match.
      totalPrice: !booked && row.priceScope?.travelers === config.travelers &&
        row.priceScope?.checkedBag === config.checkedBag && row.priceScope?.currency === 'CNY' &&
        row.priceScope?.available === true && Number.isFinite(row.totalPrice) && row.totalPrice > 0
        ? row.totalPrice : null,
    })));
  }

  const fetchDirection = async (direction, from, to, date) => {
    try {
      if (brief.journey.rail?.[direction]?.booked && !config.booked?.[direction] && !config.focus?.[direction]) return [];
      const rows = await find(direction, from, to, date);
      if (!rows.length) result.pending.push(direction === 'outbound' ? '暂无匹配的去程航班。' : '暂无匹配的返程航班。');
      return rows;
    } catch {
      result.pending.push(direction === 'outbound' ? '去程航班暂时查不到。' : '返程航班暂时查不到。');
      return [];
    }
  };
  [result.outbound, result.returning] = await Promise.all([
    fetchDirection('outbound', fromCity, toCity, brief.departure_date),
    brief.journey.deadline || config.booked?.return || config.focus?.return
      ? fetchDirection('return', toCity, returnCity, brief.return_date) : [],
  ]);
  return result;
}

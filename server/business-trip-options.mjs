import rail from './main-passenger-rail.json' with { type: 'json' };

const highSpeedStations = { 上海:['上海虹桥站','上海站'], 北京:['北京南站','北京西站','北京朝阳站'],
  深圳:['深圳北站','福田站'], 杭州:['杭州东站','杭州西站'], 广州:['广州南站','广州东站'],
  武汉:['武汉站','汉口站'], 成都:['成都东站','成都南站'] };
const supportedFlight = new Set(['深圳', '上海']);
const bookingSites = {
  CA: 'https://www.airchina.com.cn/', CZ: 'https://www.csair.com/',
  MU: 'https://www.ceair.com/', FM: 'https://www.shanghai-air.com/',
  HO: 'https://www.juneyaoair.com/', ZH: 'https://www.shenzhenair.com/',
  HU: 'https://www.hainanairlines.com/', '9C': 'https://www.ch.com/',
};
const datePattern = /^20\d{2}-\d\d-\d\d$/;
const validCity = city => typeof city === 'string' && city.trim().length > 0 && city.length <= 80;
const chinaDay = value => new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Shanghai' }).format(value);
const safePlace = p => typeof p?.name === 'string' && p.name.length <= 120 &&
  Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180;

export function createBusinessTripOptions({ services, resources, now = Date.now }) {
  return async function options(input) {
    const fail = () => { throw Object.assign(new Error('出差查询条件无效'), { status: 400 }); };
    if (input?.kind === 'stay') {
      const {city, anchors} = input;
      if (!validCity(city) || !Array.isArray(anchors) || !anchors.length || anchors.length > 3 || !anchors.every(safePlace)) return fail();
      if (!Object.hasOwn(rail.cities, city)) return { areaState:'unsupported' };
      const directory = await resources({ city, category:'business' });
      const areas = directory.places.filter(place => !/会展|博览|展览|会议中心/.test(place.name)).slice(0,3);
      const scores = await Promise.all(areas.map(async area => {
        const timings = await Promise.allSettled(anchors.map(anchor =>
          services.route({ places:[area, anchor], mode:'driving' })));
        const legs = timings.map(row => row.status === 'fulfilled' && row.value?.legs?.[0]);
        if (legs.some(leg => !leg || !Number.isFinite(leg.duration))) return null;
        return { place:area, minutes:Math.max(...legs.map(leg => Math.ceil(leg.duration/60))),
          total:legs.reduce((sum, leg) => sum+leg.duration,0), count:anchors.length,
          checkedAt:new Date(Math.min(...timings.map(row => Number(row.value.observedAt) || now()))).toISOString() };
      }));
      const area = scores.filter(Boolean).sort((a,b) => a.minutes-b.minutes || a.total-b.total)[0];
      return { area:area ?? null };
    }
    if (input?.kind !== 'transport') return fail();
    const { from, to, date, before, after, buffer = 60 } = input;
    if (!validCity(from) || !validCity(to) || from === to || typeof date !== 'string' || !datePattern.test(date) ||
        !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date ||
        !Number.isInteger(buffer) || buffer < 30 || buffer > 120 ||
        [before,after].some(value => value !== undefined && (typeof value !== 'string' || !Number.isFinite(Date.parse(value))))) return fail();
    const floor = Math.max(now(), after ? Date.parse(after)+buffer*60000 : -Infinity);
    const ceiling = before ? Date.parse(before)-buffer*60000 : Infinity;
    const lowerArrival = before ? Date.parse(before)-(buffer+120)*60000 : -Infinity;
    const fit = row => Date.parse(row.departure) >= floor && Date.parse(row.arrival) <= ceiling &&
      Date.parse(row.arrival) >= lowerArrival && Date.parse(row.arrival)>Date.parse(row.departure);
    const flightSupported = supportedFlight.has(from) && supportedFlight.has(to);
    const railSupported = Object.hasOwn(rail.cities, from) && Object.hasOwn(rail.cities, to);
    if (!railSupported && !flightSupported) return { options:[], railState:'unsupported', flightState:'unsupported' };
    const days = (Date.parse(date)-Date.parse(chinaDay(now())))/86400000;
    if (days < 0 || days > 30 || floor > ceiling) return { options:[], railState:days >= 15 ? 'outside' : 'empty', flightState: flightSupported ? 'empty' : 'unsupported' };
    const queryRail = async () => {
      const stations = city => highSpeedStations[city] ?? rail.cities[city].slice(0,2);
      const fromStations = stations(from), toStations = stations(to);
      const pairs = [[fromStations[0],toStations[0]], [fromStations[1] ?? fromStations[0],toStations[0]],
        [fromStations[0],toStations[1] ?? toStations[0]]];
      const seen = new Set();
      const queries = pairs.flatMap(([origin,destination]) => {
        const key = origin+'|'+destination;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{origin,destination,date, ...(Number.isFinite(ceiling) && {latestArrival:new Date(ceiling+8*3600000).toISOString().slice(0,19)+'+08:00'}),
          ...(after && {earliestDeparture:new Date(floor+8*3600000).toISOString().slice(0,19)+'+08:00'})}];
      });
      let completed = 0;
      for (const query of queries) {
        try {
          const result = await services.findTrains(query);
          completed++;
          const candidates = (result?.candidates ?? []).filter(fit);
          if (candidates.length) return { candidates };
        } catch { /* Try the next audited station pair. */ }
      }
      if (!completed) throw new Error('车次暂时无法查询');
      return { candidates:[] };
    };
    const [train, flight] = await Promise.allSettled([
      !railSupported || days >= 15 ? null : queryRail(),
      flightSupported ? services.findFlights({ origin:from, destination:to, date }) : null,
    ]);
    const choices = (row, kind) => {
      if (row.status !== 'fulfilled') return [];
      return (row.value?.candidates ?? []).filter(fit).sort((a,b) => before ?
        Date.parse(b.arrival)-Date.parse(a.arrival) : Date.parse(a.departure)-Date.parse(b.departure))
        .slice(0, 3).map(item => ({
          kind, number:item.number, from:item.origin ?? item.from, to:item.destination ?? item.to,
          departure:item.departure, arrival:item.arrival, source:item.source,
          checkedAt:item.checkedAt ?? new Date(item.observedAt ?? now()).toISOString(),
          bookingUrl:kind === 'rail' ? 'https://www.12306.cn/' : bookingSites[item.number.slice(0,2)] ?? item.bookingUrl ?? null,
        }));
    };
    const trains = choices(train,'rail'), flights = choices(flight,'flight');
    return { options:[...trains.slice(0,flights.length ? 2 : 3), ...flights.slice(0,trains.length ? 1 : 3)],
      railState:!railSupported ? 'unsupported' : days>=15 ? 'outside' : train.status === 'rejected' ? 'unavailable' : trains.length ? 'ready' : 'empty',
      flightState:!flightSupported ? 'unsupported' : flight.status === 'rejected' ? 'unavailable' : flights.length ? 'ready' : 'empty' };
  };
}

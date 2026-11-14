import {it, expect} from 'vitest';
import {initialUserPlaces} from '../data/userPlaces';
import type {CalendarEntry} from '../lib/calendarEvents';
import {normalizeLocationText, type PlaceAliases} from '../lib/placeAliases';
import {
  toCalendarPlace, classifyLocation, planResolution, applyResults, confirmPlace,
  acceptSuggestion, rejectSuggestion, ignorePlace, pendingPlaces, calendarMapPlaces,
} from '../lib/calendarPlaces';

const now = new Date('2026-11-13T08:00:00+08:00');
const found = (name: string, lat = 39.9, lng = 116.46) => ({name, city: '北京', address: name + '1号', lat, lng});
const office = toCalendarPlace(found('国贸大厦'));
let n = 0;
const event = (patch: Partial<CalendarEntry> = {}): CalendarEntry => {
  n += 1;
  return {
    id: 'e' + n, uid: 'e' + n, title: '会议 ' + n, location: '国贸大厦', description: '',
    start: '2026-11-14T09:00:00+08:00', end: '2026-11-14T10:00:00+08:00',
    allDay: false, timezone: 'Asia/Shanghai', calendar: '工作', ...patch,
  };
};
const opts = {now, city: '北京'};
const statusOf = (events: CalendarEntry[], id: string) => events.find(e => e.id === id)?.placeResolution?.status;

it('builds the same calendar place for the same result, marked as imported from the calendar', () => {
  const a = toCalendarPlace(found('国贸大厦')), b = toCalendarPlace(found('国贸大厦'));
  expect(a.id).toBe(b.id);
  expect(a.id.startsWith('calendar:')).toBe(true);
  expect(a).toMatchObject({category: 'custom', type: 'user', source: 'imported', tags: ['日程'], name: '国贸大厦', lat: 39.9, lng: 116.46});
  expect(toCalendarPlace(found('国贸大厦', 39.91)).id).not.toBe(a.id);
  expect(initialUserPlaces.length).toBeGreaterThan(0);
});

it('treats meeting links as online, never geocoded or counted', () => {
  for (const text of ['https://meeting.tencent.com/dm/abc', 'zoom.us/j/123', '线上', '腾讯会议', 'Zoom', 'https://teams.microsoft.com/l/x', 'vc.feishu.cn/j/1'])
    expect(classifyLocation(text)).toBe('online');
  expect(classifyLocation('  ')).toBe('empty');
  expect(classifyLocation('国贸大厦')).toBe('text');
  const online = event({location: 'https://meeting.tencent.com/dm/abc'});
  const {lookups, updated} = planResolution([online], Object.fromEntries([]), opts);
  expect(lookups).toEqual([]);
  expect(statusOf(updated, online.id)).toBe('online');
  expect(pendingPlaces(updated, {now})).toEqual([]);
});

it('marks an event without location text as missing', () => {
  const empty = event({location: ''});
  const {lookups, updated} = planResolution([empty], Object.fromEntries([]), opts);
  expect(lookups).toEqual([]);
  expect(updated[0].placeResolution).toEqual({status: 'missing', text: ''});
});

it('plans at most 40 distinct texts inside the window', () => {
  const inside = Array.from({length: 100}, (_, i) => event({location: '地点' + (i % 60)}));
  const outside = [event({location: '远方', start: '2027-03-01T09:00:00+08:00', end: '2027-03-01T10:00:00+08:00'}),
    event({location: '过去', start: '2026-11-01T09:00:00+08:00', end: '2026-11-01T10:00:00+08:00'})];
  const done = event({location: '已解析', place: office, placeResolution: {status: 'auto', text: '已解析'}});
  const {lookups, updated} = planResolution([...inside, ...outside, done], Object.fromEntries([]), opts);
  expect(lookups).toHaveLength(40);
  expect(new Set(lookups.map(l => l.text)).size).toBe(40);
  expect(lookups.every(l => l.city === '北京')).toBe(true);
  expect(lookups.map(l => l.text)).not.toContain('远方');
  expect(lookups.map(l => l.text)).not.toContain('过去');
  expect(lookups.map(l => l.text)).not.toContain('已解析');
  expect(updated.find(e => e.location === '远方')?.placeResolution).toBeUndefined();
});

it('uses the city written at the start of the location', () => {
  const {lookups} = planResolution([event({location: '上海市虹桥站'})], Object.fromEntries([]), opts);
  expect(lookups).toEqual([{text: '上海市虹桥站', city: '上海'}]);
});

it('asks before reusing a remembered phrase and forgets the suggestion on no', () => {
  const aliases: PlaceAliases = {[normalizeLocationText('公司')]: office};
  const e = event({location: '公司'});
  const {lookups, updated} = planResolution([e], aliases, opts);
  expect(lookups).toEqual([]);
  expect(updated[0].place).toBeUndefined();
  expect(updated[0].placeResolution).toEqual({status: 'ask', text: '公司', suggestion: office});
  const yes = acceptSuggestion(updated, e.id);
  expect(yes[0].place).toEqual(office);
  expect(statusOf(yes, e.id)).toBe('confirmed');
  const no = rejectSuggestion(updated, e.id);
  expect(no[0].place).toBeUndefined();
  expect(no[0].placeResolution).toEqual({status: 'none', text: '公司'});
  expect(planResolution(no, aliases, opts).updated[0].placeResolution?.status).toBe('none');
});

it('applies found, ambiguous and none, and leaves unavailable untouched', () => {
  const a = event({location: '国贸大厦'}), b = event({location: '星巴克'}), c = event({location: '张三家'}), d = event({location: '某地'});
  const results = [
    {text: '国贸大厦', status: 'found' as const, place: found('国贸大厦')},
    {text: '星巴克', status: 'ambiguous' as const, candidates: [found('星巴克A'), found('星巴克B')]},
    {text: '张三家', status: 'none' as const},
    {text: '某地', status: 'unavailable' as const},
  ];
  const out = applyResults([a, b, c, d], results);
  expect(out[0].place).toEqual(office);
  expect(out[0].placeResolution).toEqual({status: 'auto', text: '国贸大厦'});
  expect(out[1].placeResolution?.status).toBe('ambiguous');
  expect(out[1].placeResolution?.candidates?.map(p => p.name)).toEqual(['星巴克A', '星巴克B']);
  expect(out[2].placeResolution).toEqual({status: 'none', text: '张三家'});
  expect(out[3]).toEqual(d);
});

it('remembers a confirmed phrase and offers it to other events with the same text', () => {
  const first = {...event({location: '公司'}), placeResolution: {status: 'none' as const, text: '公司'}};
  const second = {...event({location: '公司 '}), placeResolution: {status: 'ambiguous' as const, text: '公司 ', candidates: [office]}};
  const other = {...event({location: '家'}), placeResolution: {status: 'none' as const, text: '家'}};
  const {events, aliases} = confirmPlace([first, second, other], Object.fromEntries([]), first.id, office);
  expect(events[0].place).toEqual(office);
  expect(statusOf(events, first.id)).toBe('confirmed');
  expect(aliases[normalizeLocationText('公司')]).toEqual(office);
  expect(events[1].placeResolution).toEqual({status: 'ask', text: '公司 ', suggestion: office});
  expect(events[1].place).toBeUndefined();
  expect(statusOf(events, other.id)).toBe('none');
});

it('counts pending places inside the window only, never ignored or online ones', () => {
  const ask = {...event({start: '2026-11-15T09:00:00+08:00'}), placeResolution: {status: 'ask' as const, text: '国贸大厦', suggestion: office}};
  const none = {...event({start: '2026-11-14T08:00:00+08:00'}), placeResolution: {status: 'none' as const, text: '张三家'}};
  const missing = {...event({location: ''}), placeResolution: {status: 'missing' as const, text: ''}};
  const ignored = ignorePlace([{...event(), placeResolution: {status: 'none' as const, text: 'x'}}], 'e' + n);
  const online = {...event(), placeResolution: {status: 'online' as const, text: '线上'}};
  const late = {...event({start: '2027-02-01T09:00:00+08:00', end: '2027-02-01T10:00:00+08:00'}), placeResolution: {status: 'none' as const, text: 'y'}};
  expect(ignored[0].placeResolution?.status).toBe('ignored');
  const pending = pendingPlaces([ask, none, missing, ...ignored, online, late], {now});
  expect(pending.map(e => e.id)).toEqual([none.id, missing.id, ask.id].sort((x, y) => {
    const s = (id: string) => [ask, none, missing].find(e => e.id === id)!.start;
    return s(x).localeCompare(s(y));
  }));
});

it('puts this week\'s resolved events on the map once per place', () => {
  const a = {...event({title: '早会', start: '2026-11-14T09:00:00+08:00'}), place: office, placeResolution: {status: 'auto' as const, text: '国贸大厦'}};
  const b = {...event({title: '午餐', start: '2026-11-16T12:00:00+08:00', end: '2026-11-16T13:00:00+08:00'}), place: office, placeResolution: {status: 'confirmed' as const, text: '国贸大厦'}};
  const later = {...event({start: '2026-11-25T09:00:00+08:00', end: '2026-11-25T10:00:00+08:00'}), place: office, placeResolution: {status: 'auto' as const, text: '国贸大厦'}};
  const places = calendarMapPlaces([a, b, later], {now});
  expect(places).toHaveLength(1);
  expect(places[0].id).toBe(office.id);
  expect(places[0].calendarEventIds).toEqual([a.id, b.id]);
  expect(places[0].tags).toContain('日程');
});

it('leaves out unresolved, ignored and online events', () => {
  const unresolved = {...event(), placeResolution: {status: 'none' as const, text: '张三家'}};
  const ignored = {...event(), place: office, placeResolution: {status: 'ignored' as const, text: '国贸大厦'}};
  const online = {...event({location: '线上'}), placeResolution: {status: 'online' as const, text: '线上'}};
  const asking = {...event(), placeResolution: {status: 'ask' as const, text: '公司', suggestion: office}};
  expect(calendarMapPlaces([unresolved, ignored, online, asking], {now})).toEqual([]);
});

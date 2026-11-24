// The "local day" rules depend on the device's zone, so the suite pins one before any date is built.
process.env.TZ = 'Asia/Shanghai';
import {describe, it, expect} from 'vitest';
import {initialUserPlaces} from './fixtures/userPlaces';
import type {CalendarEntry} from '../lib/calendarEvents';
import {pickDay, stopsOfDay, legPairs, defaultMode, haversineKm, modeName, placePairKey} from '../lib/todayMap';

// Fixed clock: 13 Nov 2026, 10:00 in Shanghai.
const now = new Date('2026-11-13T10:00:00+08:00');
const at = (name: string, lat: number, lng: number, city = '北京') =>
  ({...initialUserPlaces[0], id: 'p:' + name, name, city, lat, lng});
const guomao = at('国贸大厦', 39.9087, 116.4605);
const beijingSouth = at('北京南站', 39.8652, 116.3786);
const shanghai = at('虹桥站', 31.1944, 121.3205, '上海');
const near = at('国贸三期', 39.9091, 116.4611);
let n = 0;
const event = (patch: Partial<CalendarEntry> = {}): CalendarEntry => {
  n += 1;
  return {
    id: 'e' + n, uid: 'e' + n, title: '会议 ' + n, location: '', description: '',
    start: '2026-11-13T14:00:00+08:00', end: '2026-11-13T15:00:00+08:00',
    allDay: false, timezone: 'Asia/Shanghai', calendar: '工作', ...patch,
  };
};
const placed = (place: ReturnType<typeof at>, start: string, end: string, patch: Partial<CalendarEntry> = {}) =>
  event({start, end, location: place.name, place, placeResolution: {status: 'auto', text: place.name}, ...patch});

describe('which day the today map shows', () => {
  it('shows today when it has placed events, otherwise the next day that has some', () => {
    const today = placed(guomao, '2026-11-13T14:00:00+08:00', '2026-11-13T15:00:00+08:00');
    const later = placed(guomao, '2026-11-16T09:00:00+08:00', '2026-11-16T10:00:00+08:00');
    expect(pickDay([today, later], now)).toEqual({dateKey: '2026-11-13', isToday: true});
    const day = pickDay([later], now);
    expect(day).toMatchObject({dateKey: '2026-11-16', isToday: false});
    expect(day?.nextLabel).toBe('11 月 16 日');
  });

  it('returns null when nothing is placed from today on', () => {
    const past = placed(guomao, '2026-11-10T09:00:00+08:00', '2026-11-10T10:00:00+08:00');
    const unplaced = event({location: '张三家', placeResolution: {status: 'none', text: '张三家'}});
    expect(pickDay([past, unplaced], now)).toBeNull();
    expect(pickDay([], now)).toBeNull();
  });

  it('leaves out all-day, ignored, online and unplaced events from the stops', () => {
    const ok = placed(guomao, '2026-11-13T14:00:00+08:00', '2026-11-13T15:00:00+08:00');
    const allDay = placed(guomao, '2026-11-13T00:00:00+08:00', '2026-11-14T00:00:00+08:00', {allDay: true});
    const ignored = placed(guomao, '2026-11-13T16:00:00+08:00', '2026-11-13T17:00:00+08:00', {placeResolution: {status: 'ignored', text: 'x'}});
    const online = placed(guomao, '2026-11-13T17:00:00+08:00', '2026-11-13T18:00:00+08:00', {placeResolution: {status: 'online', text: 'x'}});
    const none = event({placeResolution: {status: 'none', text: 'x'}});
    expect(stopsOfDay([ok, allDay, ignored, online, none], '2026-11-13').map(s => s.event.id)).toEqual([ok.id]);
  });

  it('groups by the device\'s local day, not UTC', () => {
    // 23:30 on the 13th in Shanghai is 15:30 UTC on the 13th; 00:30 on the 14th in Shanghai is 16:30 UTC on the 13th.
    const late = placed(guomao, '2026-11-13T23:30:00+08:00', '2026-11-13T23:50:00+08:00');
    const early = placed(guomao, '2026-11-14T00:30:00+08:00', '2026-11-14T01:00:00+08:00');
    expect(stopsOfDay([late, early], '2026-11-13').map(s => s.event.id)).toEqual([late.id]);
    expect(stopsOfDay([late, early], '2026-11-14').map(s => s.event.id)).toEqual([early.id]);
  });
});

describe('neighbouring events', () => {
  it('pairs neighbouring stops in start order', () => {
    const c = placed(shanghai, '2026-11-13T18:00:00+08:00', '2026-11-13T19:00:00+08:00');
    const a = placed(guomao, '2026-11-13T09:00:00+08:00', '2026-11-13T10:00:00+08:00');
    const b = placed(beijingSouth, '2026-11-13T12:00:00+08:00', '2026-11-13T13:00:00+08:00');
    const pairs = legPairs([c, a, b], '2026-11-13');
    expect(pairs.map(p => p.id)).toEqual([a.id + '>' + b.id, b.id + '>' + c.id]);
  });

  it('does not bridge across an event that has no place', () => {
    const a = placed(guomao, '2026-11-13T09:00:00+08:00', '2026-11-13T10:00:00+08:00');
    const gap = event({start: '2026-11-13T11:00:00+08:00', end: '2026-11-13T12:00:00+08:00', location: '张三家', placeResolution: {status: 'none', text: '张三家'}});
    const c = placed(beijingSouth, '2026-11-13T14:00:00+08:00', '2026-11-13T15:00:00+08:00');
    expect(legPairs([a, gap, c], '2026-11-13')).toEqual([]);
  });

  it('is not broken by an online meeting, which is not a place', () => {
    const a = placed(guomao, '2026-11-13T09:00:00+08:00', '2026-11-13T10:00:00+08:00');
    const online = event({start: '2026-11-13T11:00:00+08:00', end: '2026-11-13T12:00:00+08:00', location: '线上', placeResolution: {status: 'online', text: '线上'}});
    const c = placed(beijingSouth, '2026-11-13T14:00:00+08:00', '2026-11-13T15:00:00+08:00');
    expect(legPairs([a, online, c], '2026-11-13')).toHaveLength(1);
  });

  it('marks two events at the same place as one spot', () => {
    const a = placed(guomao, '2026-11-13T09:00:00+08:00', '2026-11-13T10:00:00+08:00');
    const b = placed({...guomao, id:'another-provider-id', city:'北京市'}, '2026-11-13T11:00:00+08:00', '2026-11-13T12:00:00+08:00');
    expect(legPairs([a, b], '2026-11-13')[0]).toMatchObject({sameSpot:true, crossCity:false});
  });

  it('keeps stale events off the map without connecting across their unknown location', () => {
    const a = placed(guomao, '2026-11-13T09:00:00+08:00', '2026-11-13T10:00:00+08:00');
    const stale = placed(near, '2026-11-13T11:00:00+08:00', '2026-11-13T12:00:00+08:00', {
      google: {connectionId:'test', calendarId:'test', eventId:'stale', updated:'', originalStart:null, stale:true},
    });
    const c = placed(beijingSouth, '2026-11-13T13:00:00+08:00', '2026-11-13T14:00:00+08:00');
    expect(pickDay([stale], now)).toBeNull();
    expect(stopsOfDay([a, stale, c], '2026-11-13').map(stop => stop.event.id)).toEqual([a.id, c.id]);
    expect(legPairs([a, stale, c], '2026-11-13')).toEqual([]);
  });

  it('defaults to transit in a city, road reference across cities', () => {
    expect(haversineKm(guomao, near)).toBeLessThan(0.2);
    expect(defaultMode(0.5, false)).toBe('transit');
    expect(defaultMode(1.19, false)).toBe('transit');
    expect(defaultMode(8, false)).toBe('transit');
    expect(defaultMode(0.5, true)).toBe('driving');
    expect(defaultMode(1200, true)).toBe('driving');
    const a = placed(guomao, '2026-11-13T09:00:00+08:00', '2026-11-13T10:00:00+08:00');
    const b = placed(shanghai, '2026-11-13T15:00:00+08:00', '2026-11-13T16:00:00+08:00');
    const [pair] = legPairs([a, b], '2026-11-13');
    expect(pair).toMatchObject({crossCity: true, defaultMode: 'driving'});
    expect(pair.directKm).toBeGreaterThan(1000);
  });

  it('reports the gap in minutes between one event\'s end and the next one\'s start', () => {
    const a = placed(guomao, '2026-11-13T09:00:00+08:00', '2026-11-13T10:00:00+08:00');
    const b = placed(beijingSouth, '2026-11-13T10:45:00+08:00', '2026-11-13T11:30:00+08:00');
    expect(legPairs([a, b], '2026-11-13')[0].gapMinutes).toBe(45);
  });
});

describe('leg labels', () => {
  it('names the modes people use', () => {
    expect([modeName('walking'), modeName('transit'), modeName('driving'), modeName('selfDrive')]).toEqual(['步行', '地铁公交', '打车', '自驾']);
  });

  it('builds a stable key from the two places, not the times', () => {
    const a = placed(guomao, '2026-11-13T09:00:00+08:00', '2026-11-13T10:00:00+08:00');
    const b = placed(beijingSouth, '2026-11-13T12:00:00+08:00', '2026-11-13T13:00:00+08:00');
    const [pair] = legPairs([a, b], '2026-11-13');
    const moved = {...pair, gapMinutes: 99};
    expect(placePairKey(moved)).toBe(placePairKey(pair));
  });
});

import {it, expect, vi} from 'vitest';
import type {CalendarEntry} from '../lib/calendarEvents';
import {resolveCalendarPlaces, createCalendarPlaceRunner} from '../lib/useCalendarPlaces';

const now = new Date('2026-11-13T08:00:00+08:00');
let n = 0;
const event = (location: string): CalendarEntry => {
  n += 1;
  return {id: 'e' + n, uid: 'e' + n, title: '会议', location, description: '', start: '2026-11-14T09:00:00+08:00', end: '2026-11-14T10:00:00+08:00',
    allDay: false, timezone: 'Asia/Shanghai', calendar: '工作'};
};
const none = Object.fromEntries([]);
const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}}));
const found = (name: string) => ({name, city: '北京', address: name + '1号', lat: 39.9, lng: 116.46});

it('sends one batched request and applies its results', async () => {
  const a = event('国贸大厦'), b = event('国贸大厦'), c = event('张三家');
  const fetchImpl = vi.fn(() => reply({results: [{text: '国贸大厦', status: 'found', place: found('国贸大厦')}, {text: '张三家', status: 'none'}]}));
  const out = await resolveCalendarPlaces([a, b, c], none, {now, city: '北京', fetchImpl});
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/calendar/places');
  expect(init.method).toBe('POST');
  expect(init.credentials).toBe('same-origin');
  expect(JSON.parse(String(init.body))).toEqual({items: [{text: '国贸大厦', city: '北京'}, {text: '张三家', city: '北京'}]});
  expect(out[0].place?.name).toBe('国贸大厦');
  expect(out[1].place?.name).toBe('国贸大厦');
  expect(out[2].placeResolution).toEqual({status: 'none', text: '张三家'});
});

it('keeps events unresolved when the resolver is unavailable', async () => {
  const a = event('国贸大厦');
  for (const fetchImpl of [vi.fn(() => Promise.reject(new TypeError('offline'))), vi.fn(() => reply({error: 'busy'}, 503)), vi.fn(() => reply({results: [{text: '国贸大厦', status: 'unavailable'}]}))]) {
    const out = await resolveCalendarPlaces([a], none, {now, city: '北京', fetchImpl});
    expect(out[0].place).toBeUndefined();
    expect(out[0].placeResolution).toBeUndefined();
  }
});

it('still records online and missing events when nothing needs a request', async () => {
  const online = event('线上'), empty = event('');
  const fetchImpl = vi.fn();
  const out = await resolveCalendarPlaces([online, empty], none, {now, city: '北京', fetchImpl});
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(out.map(e => e.placeResolution?.status)).toEqual(['online', 'missing']);
});

it('does not request when nothing is planned', async () => {
  const fetchImpl = vi.fn();
  const done = {...event('国贸大厦'), placeResolution: {status: 'ignored' as const, text: '国贸大厦'}};
  const out = await resolveCalendarPlaces([done], none, {now, city: '北京', fetchImpl});
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(out).toEqual([done]);
});

it('ignores a late response after the owner changed', async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    await gate;
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return reply({results: [{text: '国贸大厦', status: 'found', place: found('国贸大厦')}]});
  });
  const commit = vi.fn();
  const runner = createCalendarPlaceRunner({fetchImpl, now: () => now});
  const pending = runner.run({owner: 'a', events: [event('国贸大厦')], aliases: none, city: '北京', commit});
  runner.run({owner: 'b', events: [], aliases: none, city: '北京', commit});
  release();
  await pending;
  expect(commit).not.toHaveBeenCalled();
});

it('commits only when something changed', async () => {
  const commit = vi.fn();
  const runner = createCalendarPlaceRunner({fetchImpl: vi.fn(() => reply({results: [{text: '国贸大厦', status: 'found', place: found('国贸大厦')}]})), now: () => now});
  await runner.run({owner: 'a', events: [event('国贸大厦')], aliases: none, city: '北京', commit});
  expect(commit).toHaveBeenCalledTimes(1);
  const resolvedEvents = commit.mock.calls[0][0] as CalendarEntry[];
  await runner.run({owner: 'a', events: resolvedEvents, aliases: none, city: '北京', commit});
  expect(commit).toHaveBeenCalledTimes(1);
});

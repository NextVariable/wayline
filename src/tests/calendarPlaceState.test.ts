import {it, expect} from 'vitest';
import {initialUserPlaces} from './fixtures/userPlaces';
import {isCalendarEntry, mergeCalendarEntries, type CalendarEntry} from '../lib/calendarEvents';
import {mergeGoogleSnapshot} from '../lib/googleCalendarSync';
import {createWorkspaceBackup, parseWorkspaceBackup, restoreWorkspaceRecords} from '../lib/workspaceBackup';
import {normalizeLocationText, placeAliasKey, readPlaceAliases, writePlaceAliases, isPlaceAliases} from '../lib/placeAliases';
// @ts-expect-error Server ESM exercised directly.
import {normalizeLocationText as serverNormalize} from '../../server/calendar-places.mjs';

const place = {...initialUserPlaces[0], id: 'calendar:office', name: '国贸大厦', city: '北京', lat: 39.9, lng: 116.46};
const event = (patch: Partial<CalendarEntry> = {}): CalendarEntry => ({
  id: 'e1', uid: 'e1', title: '客户会议', location: '国贸大厦', description: '', start: '2026-11-13T09:00:00+08:00', end: '2026-11-13T10:00:00+08:00',
  allDay: false, timezone: 'Asia/Shanghai', calendar: '工作', ...patch,
});
const google = {connectionId: 'c', calendarId: 'cal', eventId: 'e1', updated: 'u', originalStart: null};
class MemoryStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  clear() { this.data.clear(); }
}

it('accepts a calendar entry with a valid place resolution and rejects an unknown status', () => {
  expect(isCalendarEntry(event({place, placeResolution: {status: 'auto', text: '国贸大厦'}}))).toBe(true);
  expect(isCalendarEntry(event({placeResolution: {status: 'ask', text: '公司', suggestion: place}}))).toBe(true);
  expect(isCalendarEntry(event({placeResolution: {status: 'ambiguous', text: '星巴克', candidates: [place, place]}}))).toBe(true);
  expect(isCalendarEntry(event({placeResolution: {status: 'guessed', text: 'x'} as never}))).toBe(false);
  expect(isCalendarEntry(event({placeResolution: {status: 'ambiguous', text: 'x', candidates: Array(6).fill(place)}}))).toBe(false);
});

it('keeps place and resolution when the location text is unchanged', () => {
  const resolved = event({place, placeResolution: {status: 'confirmed', text: '国贸大厦'}});
  expect(mergeCalendarEntries([resolved], [event()])[0].placeResolution?.status).toBe('confirmed');
  const synced = mergeGoogleSnapshot([{...resolved, google}], [event({google})], 'c')[0];
  expect(synced.place?.id).toBe(place.id);
  expect(synced.placeResolution?.status).toBe('confirmed');
});

it('drops place and resolution when the location text changes', () => {
  const resolved = event({place, placeResolution: {status: 'confirmed', text: '国贸大厦'}});
  const imported = mergeCalendarEntries([resolved], [event({location: '望京SOHO'})])[0];
  expect(imported.place).toBeUndefined();
  expect(imported.placeResolution).toBeUndefined();
  const synced = mergeGoogleSnapshot([{...resolved, google}], [event({google, location: '望京SOHO'})], 'c')[0];
  expect(synced.place).toBeUndefined();
  expect(synced.placeResolution).toBeUndefined();
});

it('normalizes location text the same way on both sides', () => {
  for (const text of [' 国贸 大厦 ', '国贸（大厦）', 'Zoom: Weekly', '公司。']) expect(normalizeLocationText(text)).toBe(serverNormalize(text));
  expect(normalizeLocationText(' 国贸（大厦） ')).toBe('国贸大厦');
});

it('round-trips remembered phrases through workspace backup', () => {
  const storage = new MemoryStorage() as unknown as Storage;
  writePlaceAliases('guest', {[normalizeLocationText('公司')]: place}, storage);
  expect(storage.getItem(placeAliasKey('guest'))).not.toBeNull();
  const backup = parseWorkspaceBackup(createWorkspaceBackup({id: 'guest', label: '默认空间', method: 'guest'} as never, {format: 'whereto-footprints', version: 1, tracks: [], visits: [], activeId: null} as never, storage));
  restoreWorkspaceRecords(backup, 'restored', storage);
  expect(readPlaceAliases('restored', storage)['公司'].id).toBe(place.id);
});

it('rejects a backup whose remembered phrases are malformed', () => {
  expect(isPlaceAliases({'公司': {name: 'x'}})).toBe(false);
  const text = JSON.stringify({format: 'whereto-workspace', version: 1, name: 'x', records: {'whatto.placeAliases.': {'公司': {name: 'x'}}}, footprints: {tracks: [], visits: [], activeId: null}});
  expect(() => parseWorkspaceBackup(text)).toThrow();
});

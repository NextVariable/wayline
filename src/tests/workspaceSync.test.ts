import {expect, it, vi} from 'vitest';
import {pullWorkspace, pushWorkspace, guestDataWorthMigrating, migrateGuestWorkspace} from '../lib/workspaceSync';
import {replaceWorkspaceRecords, type WorkspaceBackup} from '../lib/workspaceBackup';
import {initialUserPlaces} from '../data/userPlaces';
import {guestUser} from '../lib/userStorage';

const owner = 'google:abc';
const user = {id: owner, label: 'a@example.com', method: 'google' as const};
const noFootprints = {format: 'whereto-footprints', version: 1, tracks: [], visits: [], activeId: null} as any;
const place = {...initialUserPlaces[0], isSaved: true};

function memoryStorage(seed: Record<string, string> = Object.create(null)) {
  const values = new Map(Object.entries(seed));
  let failOn = '';
  return {
    values,
    failWritesTo: (key: string) => { failOn = key; },
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { if (k === failOn) throw new Error('quota'); values.set(k, v); },
    removeItem: (k: string) => { values.delete(k); },
    key: (i: number) => [...values.keys()][i] ?? null,
    get length() { return values.size; },
    clear: () => values.clear(),
  } as unknown as Storage & {values: Map<string, string>; failWritesTo(k: string): void};
}
const backupWith = (places: unknown[]): WorkspaceBackup => ({format: 'whereto-workspace', version: 1, name: 'cloud', records: {'whatto.userPlaces.': places}, footprints: noFootprints});
const reply = (status: number, data: unknown) => vi.fn(async (_url: string, _init?: RequestInit) => ({ok: status === 200, status, json: async () => data}) as Response);

it('pulls the cloud workspace into the signed-in owner', async () => {
  const storage = memoryStorage();
  const result = await pullWorkspace(owner, reply(200, {version: 4, workspace: backupWith([place]), updatedAt: 1}), storage);
  expect(result).toMatchObject({version: 4, empty: false});
  expect(JSON.parse(storage.getItem('whatto.userPlaces.' + owner)!)).toHaveLength(1);
});

it('reports an empty account without touching local data', async () => {
  const storage = memoryStorage({['whatto.userPlaces.' + owner]: '[]'});
  expect(await pullWorkspace(owner, reply(200, {version: 0, workspace: null, updatedAt: null}), storage)).toMatchObject({version: 0, empty: true});
  expect(storage.getItem('whatto.userPlaces.' + owner)).toBe('[]');
});

it('pushes local changes with the last known version', async () => {
  const storage = memoryStorage({['whatto.userPlaces.' + owner]: JSON.stringify([place])});
  const fetchImpl = reply(200, {version: 5, updatedAt: 2});
  expect(await pushWorkspace(user, noFootprints, 4, fetchImpl, storage)).toEqual({version: 5});
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe('/api/workspace');
  expect(init).toMatchObject({method: 'PUT', credentials: 'same-origin'});
  const body = JSON.parse(String(init!.body));
  expect(body.baseVersion).toBe(4);
  expect(body.workspace).toMatchObject({format: 'whereto-workspace', version: 1});
  expect(body.workspace.records['whatto.userPlaces.']).toHaveLength(1);
});

it('reports a conflict instead of overwriting another device', async () => {
  const storage = memoryStorage({['whatto.userPlaces.' + owner]: '[]'});
  expect(await pushWorkspace(user, noFootprints, 2, reply(409, {error: '另一台设备有更新', version: 3}), storage)).toEqual({conflict: true, version: 3});
});

it('keeps local edits when offline', async () => {
  const storage = memoryStorage({['whatto.userPlaces.' + owner]: JSON.stringify([place])});
  const offline = vi.fn(async () => { throw new Error('offline'); });
  await expect(pushWorkspace(user, noFootprints, 1, offline, storage)).rejects.toThrow();
  await expect(pullWorkspace(owner, offline, storage)).rejects.toThrow();
  expect(JSON.parse(storage.getItem('whatto.userPlaces.' + owner)!)).toHaveLength(1);
});

it('offers migration only when the guest has something worth keeping', () => {
  expect(guestDataWorthMigrating(memoryStorage(), noFootprints)).toBe(false);
  expect(guestDataWorthMigrating(memoryStorage({['whatto.userPlaces.' + guestUser.id]: JSON.stringify([place])}), noFootprints)).toBe(true);
  expect(guestDataWorthMigrating(memoryStorage(), {...noFootprints, visits: [{id: 'v'}]})).toBe(true);
});

it('migrates guest data once into an empty account and leaves the guest copy in place', async () => {
  const storage = memoryStorage({['whatto.userPlaces.' + guestUser.id]: JSON.stringify([place])});
  const fetchImpl = reply(200, {version: 1, updatedAt: 3});
  expect(await migrateGuestWorkspace(user, noFootprints, fetchImpl, storage)).toEqual({version: 1});
  const body = JSON.parse(String(fetchImpl.mock.calls[0][1]!.body));
  expect(body.baseVersion).toBe(0);
  expect(body.workspace.records['whatto.userPlaces.']).toHaveLength(1);
  expect(storage.getItem('whatto.userPlaces.' + guestUser.id)).not.toBeNull();
  expect(JSON.parse(storage.getItem('whatto.userPlaces.' + owner)!)).toHaveLength(1);
});

it('never overwrites existing cloud data with guest data', async () => {
  const storage = memoryStorage({['whatto.userPlaces.' + guestUser.id]: JSON.stringify([place])});
  expect(await migrateGuestWorkspace(user, noFootprints, reply(409, {error: '另一台设备有更新', version: 2}), storage)).toEqual({conflict: true, version: 2});
  expect(storage.getItem('whatto.userPlaces.' + owner)).toBeNull();
});

it('replaceWorkspaceRecords rolls back on a failed write', () => {
  const storage = memoryStorage({['whatto.userPlaces.' + owner]: '["old"]', ['whatto.cities.' + owner]: '["keep"]'});
  storage.failWritesTo('whatto.planner.' + owner);
  const backup = {...backupWith([place]), records: {'whatto.userPlaces.': [place], 'whatto.planner.': {date: '2026-11-13', days: '1', notes: '', preferences: []}}} as WorkspaceBackup;
  expect(() => replaceWorkspaceRecords(backup, owner, storage)).toThrow();
  expect(storage.getItem('whatto.userPlaces.' + owner)).toBe('["old"]');
  expect(storage.getItem('whatto.cities.' + owner)).toBe('["keep"]');
});

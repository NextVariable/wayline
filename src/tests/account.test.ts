import {expect, it, vi} from 'vitest';
import {accountUser, chooseActiveUser, fetchAccount, startSignIn, signOut} from '../lib/account';
import {guestUser, loadActiveUser, saveActiveUser} from '../lib/userStorage';

const reply = (status: number, data: unknown) => vi.fn(async () => ({ok: status === 200, status, json: async () => data}) as Response);

it('maps a signed-in account to its own storage owner', () => {
  expect(accountUser({id: 'abc', email: 'a@example.com'})).toEqual({id: 'google:abc', label: 'a@example.com', method: 'google'});
});

it('reads the signed-in account from the server', async () => {
  const account = {id: 'abc', email: 'a@example.com', name: 'Ada'};
  expect(await fetchAccount(reply(200, {configured: true, signedIn: true, account}))).toEqual({configured: true, signedIn: true, account});
  expect(await fetchAccount(reply(200, {configured: false, signedIn: false}))).toEqual({configured: false, signedIn: false});
});

it('treats 401 and network failure as signed out', async () => {
  expect(await fetchAccount(reply(401, {error: 'x'}))).toEqual({configured: true, signedIn: false});
  expect(await fetchAccount(vi.fn(async () => { throw new Error('offline'); }))).toEqual({configured: true, signedIn: false});
});

it('returns null sign-in url when Google is not configured', async () => {
  expect(await startSignIn(reply(200, {configured: false}))).toBeNull();
  expect(await startSignIn(reply(200, {url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1'}))).toBe('https://accounts.google.com/o/oauth2/v2/auth?x=1');
});

it('signs out with a same-origin JSON request', async () => {
  const fetchImpl = reply(200, {ok: true});
  await signOut(fetchImpl);
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/auth/signout');
  expect(init).toMatchObject({method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}});
});

it('does not report a failed logout as successful', async () => {
  await expect(signOut(reply(503, {error: 'offline'}))).rejects.toThrow('退出未完成');
  await expect(signOut(reply(401, {}))).resolves.toBeUndefined();
});

it('signing out switches owner back to guest', () => {
  const local = {id: 'local:工作', label: '工作', method: 'local' as const};
  const account = {id: 'abc', email: 'a@example.com', name: 'Ada'};
  expect(chooseActiveUser({status: 'signed-in', account}, local)).toEqual(accountUser(account));
  expect(chooseActiveUser({status: 'guest'}, local)).toEqual(local);
  expect(chooseActiveUser({status: 'guest'}, accountUser(account))).toEqual(guestUser);
  expect(chooseActiveUser({status: 'loading'}, local)).toEqual(local);
});

it('never remembers a Google account as the local active user', () => {
  const values = new Map<string, string>();
  (globalThis as any).localStorage = {getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v), removeItem: (k: string) => void values.delete(k)};
  try {
    saveActiveUser({id: 'google:abc', label: 'a@example.com', method: 'google'});
    expect(loadActiveUser()).toEqual(guestUser);
  } finally { delete (globalThis as any).localStorage; }
});

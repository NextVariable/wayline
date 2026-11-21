import {it, expect, vi} from 'vitest';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
// @ts-expect-error Server ESM exercised directly.
import {createAccountService} from '../../server/accounts.mjs';

const ORIGIN = 'http://127.0.0.1:8787';
const CALENDAR = ['https://www.googleapis.com/auth/calendar.events.readonly', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
const GMAIL = 'https://www.googleapis.com/auth/gmail.readonly';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function response() {
  return {status: 200, headers: {} as Record<string, any>, body: '', headersSent: false,
    setHeader(k: string, v: any) { this.headers[k] = v; },
    writeHead(status: number, headers: object = {}) { this.status = status; Object.assign(this.headers, headers); this.headersSent = true; },
    end(value = '') { this.body = value; }};
}
const cookiesOf = (res: {headers: Record<string, any>}) => ([] as string[]).concat(res.headers['Set-Cookie'] ?? []);
const cookieValue = (res: {headers: Record<string, any>}, name: string) => cookiesOf(res).find(c => c.startsWith(name + '='))?.split(';')[0];

function setup({configured = true, gmail = false, sub = 'g-123', email = 'a@example.com', name = 'Ada', maxWorkspaceBytes = undefined as number | undefined} = {}) {
  let clock = Date.parse('2026-11-12T01:00:00Z'), failSave = false, user = {sub, email, name};
  const store = {data: {} as any, save: vi.fn(async () => { if (failSave) throw new Error('disk'); })};
  const openVault = vi.fn(async () => store);
  const fetcher = vi.fn(async (input: string, options?: {body?: URLSearchParams}) => {
    const url = new URL(input);
    const result = (data: any, status = 200) => ({ok: status === 200, status, json: async () => data});
    if (url.hostname === 'oauth2.googleapis.com') return result({access_token: 'PRIVATE_ACCESS', refresh_token: 'PRIVATE_REFRESH', expires_in: 3600, scope: ['openid', 'email', 'profile', ...(options?.body?.get('code') === 'gmail-code' ? [GMAIL] : CALENDAR)].join(' ')});
    if (url.hostname === 'openidconnect.googleapis.com') return result(user);
    return result({}, 404);
  });
  const env = configured ? {GOOGLE_CLIENT_ID: 'test-id', GOOGLE_CLIENT_SECRET: 'test-secret', PUBLIC_ORIGIN: ORIGIN,
    ...(gmail && {GMAIL_ORDERS_ENABLED: '1'})} : {PUBLIC_ORIGIN: ORIGIN};
  const service = createAccountService({env, fetcher, now: () => clock, openVault, maxWorkspaceBytes});
  const call = async (path: string, {method = 'GET', body, cookie = '', origin = ORIGIN, type = 'application/json'}: {method?: string; body?: unknown; cookie?: string; origin?: string; type?: string} = {}) => {
    const raw = body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)];
    const req = Readable.from(raw) as any;
    req.url = path; req.method = method;
    req.headers = {cookie, ...(method !== 'GET' ? {origin, 'content-type': type} : {})};
    const res = response();
    const handled = await service.handle(req, res);
    return {...res, handled, json: () => JSON.parse(res.body)};
  };
  const signIn = async () => {
    const start = await call('/api/auth/google/start', {method: 'POST', body: {}});
    const flowCookie = cookieValue(start, 'wayline_signin')!;
    const auth = new URL(start.json().url);
    const callback = await call(`/api/auth/google/callback?state=${auth.searchParams.get('state')}&code=code`, {cookie: flowCookie});
    return {start, auth, callback, flowCookie, session: cookieValue(callback, 'wayline_session')!};
  };
  return {store, fetcher, openVault, service, call, signIn,
    advance: (ms: number) => { clock += ms; }, failSave: (v: boolean) => { failSave = v; }, setUser: (u: typeof user) => { user = u; }};
}

it('requires a separate Gmail grant and binds it to the signed-in account', async () => {
  const s = setup({ gmail: true });
  const { session } = await s.signIn();
  expect((await s.call('/api/auth/gmail/start', {method: 'POST'})).status).toBe(401);
  expect((await s.call('/api/auth/gmail/status', {cookie: session})).json()).toMatchObject({enabled: true, connected: false});
  const start = await s.call('/api/auth/gmail/start', {method: 'POST', cookie: session});
  const auth = new URL(start.json().url);
  expect(auth.searchParams.get('scope')).toBe(`openid email ${GMAIL}`);
  expect(auth.searchParams.get('include_granted_scopes')).toBe('true');
  const callback = await s.call(`/api/auth/google/callback?state=${auth.searchParams.get('state')}&code=gmail-code`,
    {cookie: [session, cookieValue(start, 'wayline_signin')].join('; ')});
  expect(callback.headers.Location).toBe('/?gmail=connected');
  expect(cookieValue(callback, 'wayline_session')).toBeUndefined();
  const status = await s.call('/api/auth/gmail/status', {cookie: session});
  expect(status.json()).toMatchObject({connected: true, orders: []});
  expect(status.body).not.toContain('PRIVATE_REFRESH');
  const disconnected = await s.call('/api/auth/gmail/disconnect', {method: 'POST', cookie: session});
  expect(disconnected.json()).toMatchObject({connected: false, orders: []});
  expect((await s.call('/api/auth/me', {cookie: session})).json().signedIn).toBe(true);
});

it('rejects a different Google identity and does not connect when the Gmail scope is declined', async () => {
  const s = setup({ gmail: true });
  const { session } = await s.signIn();
  const grant = async (code: string) => {
    const start = await s.call('/api/auth/gmail/start', {method: 'POST', cookie: session});
    const state = new URL(start.json().url).searchParams.get('state');
    return s.call(`/api/auth/google/callback?state=${state}&code=${code}`,
      {cookie: [session, cookieValue(start, 'wayline_signin')].join('; ')});
  };
  expect((await grant('scope-declined')).headers.Location).toBe('/?gmail=denied');
  s.setUser({sub: 'different-google-account', email: 'b@example.com', name: 'Other'});
  expect((await grant('gmail-code')).status).toBe(403);
  expect((await s.call('/api/auth/gmail/status', {cookie: session})).json().connected).toBe(false);
});

it('signs in with Google using state and PKCE, then reports the account', async () => {
  const s = setup();
  const {auth, callback, session} = await s.signIn();
  expect(auth.origin + auth.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(auth.searchParams.get('client_id')).toBe('test-id');
  expect(auth.searchParams.get('redirect_uri')).toBe(ORIGIN + '/api/auth/google/callback');
  expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
  expect(auth.searchParams.has('access_type')).toBe(false);
  expect(auth.searchParams.has('prompt')).toBe(false);
  expect(s.store.data.accounts[sha('g-123')]).not.toHaveProperty('token');
  const scopes = auth.searchParams.get('scope')!.split(' ');
  expect(scopes).toEqual(['openid', 'email', 'profile']);
  expect(scopes.some(scope => scope.includes('gmail'))).toBe(false);
  expect(callback.status).toBe(303);
  expect(callback.headers.Location).toBe('/');
  expect(cookiesOf(callback).find(c => c.startsWith('wayline_session='))).toMatch(/HttpOnly/);
  expect(cookiesOf(callback).find(c => c.startsWith('wayline_session='))).toMatch(/SameSite=Lax/);
  const me = await s.call('/api/auth/me', {cookie: session});
  expect(me.json()).toMatchObject({configured: true, signedIn: true, account: {id: sha('g-123'), email: 'a@example.com', name: 'Ada'}});
  for (const res of [callback, me]) expect(res.body + JSON.stringify(res.headers)).not.toMatch(/PRIVATE_ACCESS|PRIVATE_REFRESH/);
  const token = s.fetcher.mock.calls.find(([url]) => String(url).includes('oauth2.googleapis.com'))!;
  expect(new URLSearchParams((token as any)[1].body).get('code_verifier')).toBeTruthy();
});

it('does not store the account when the session limit rejects the sign-in', async () => {
  const s = setup();
  await s.call('/api/auth/google/start', {method: 'POST', body: {}});
  const until = Date.parse('2026-11-12T01:00:00Z') + 86400000;
  for (let i = 0; i < 10000; i++) s.store.data.sessions['filler' + i] = {account: 'other', until};
  const {callback} = await s.signIn();
  expect(callback.status).toBe(503);
  expect(s.store.data.accounts[sha('g-123')]).toBeUndefined();
  expect(cookieValue(callback, 'wayline_session')).toBeUndefined();
});

it('rejects a replayed or foreign state', async () => {
  const s = setup();
  const {auth, flowCookie} = await s.signIn();
  const replay = await s.call(`/api/auth/google/callback?state=${auth.searchParams.get('state')}&code=code`, {cookie: flowCookie});
  expect(replay.status).toBe(400);
  const start = await s.call('/api/auth/google/start', {method: 'POST', body: {}});
  const state = new URL(start.json().url).searchParams.get('state');
  const otherBrowser = await s.call(`/api/auth/google/callback?state=${state}&code=code`);
  expect(otherBrowser.status).toBe(400);
  expect((await s.call('/api/auth/google/callback?state=unknown&code=code', {cookie: flowCookie})).status).toBe(400);
});

it('redirects to /?signin=denied when the user declines', async () => {
  const s = setup();
  const start = await s.call('/api/auth/google/start', {method: 'POST', body: {}});
  const state = new URL(start.json().url).searchParams.get('state');
  const denied = await s.call(`/api/auth/google/callback?state=${state}&error=access_denied`, {cookie: cookieValue(start, 'wayline_signin')});
  expect(denied.status).toBe(303);
  expect(denied.headers.Location).toBe('/?signin=denied');
  expect(cookieValue(denied, 'wayline_session')).toBeUndefined();
});

it('expired session reads as signed out', async () => {
  const s = setup();
  const {session} = await s.signIn();
  s.advance(31 * 86400000);
  expect((await s.call('/api/auth/me', {cookie: session})).json()).toMatchObject({configured: true, signedIn: false});
});

it('signs out and forgets the session', async () => {
  const s = setup();
  const {session} = await s.signIn();
  const out = await s.call('/api/auth/signout', {method: 'POST', body: {}, cookie: session});
  expect(out.json()).toEqual({ok: true});
  expect(cookiesOf(out).find(c => c.startsWith('wayline_session='))).toMatch(/Max-Age=0/);
  expect((await s.call('/api/auth/me', {cookie: session})).json().signedIn).toBe(false);
});

it('keeps the session valid when logout cannot be saved', async () => {
  const s = setup();
  const {session} = await s.signIn();
  s.failSave(true);
  const result = await s.call('/api/auth/signout', {method:'POST',body:{},cookie:session});
  expect(result.status).toBe(500);
  expect(cookieValue(result, 'wayline_session')).toBeUndefined();
  expect((await s.call('/api/auth/me',{cookie:session})).json().signedIn).toBe(true);
});

it('rejects cross-origin or non-JSON mutations', async () => {
  const s = setup();
  expect((await s.call('/api/auth/google/start', {method: 'POST', body: {}, origin: 'https://evil.test'})).status).toBe(403);
  const {session} = await s.signIn();
  expect((await s.call('/api/auth/signout', {method: 'POST', body: 'x', cookie: session, type: 'text/plain'})).status).toBe(403);
  expect((await s.call('/api/auth/me', {cookie: session})).json().signedIn).toBe(true);
});

it('reports not configured without contacting Google', async () => {
  const s = setup({configured: false});
  expect((await s.call('/api/auth/me')).json()).toEqual({configured: false, signedIn: false});
  const started = await s.call('/api/auth/google/start', {method: 'POST', body: {}});
  expect(started.json()).toEqual({configured: false});
  expect(s.fetcher).not.toHaveBeenCalled();
  expect(s.openVault).not.toHaveBeenCalled();
});

it('keeps two Google accounts apart', async () => {
  const s = setup();
  const first = await s.signIn();
  s.setUser({sub: 'g-456', email: 'b@example.com', name: 'Bo'});
  const second = await s.signIn();
  const a = (await s.call('/api/auth/me', {cookie: first.session})).json().account;
  const b = (await s.call('/api/auth/me', {cookie: second.session})).json().account;
  expect(a.email).toBe('a@example.com');
  expect(b.email).toBe('b@example.com');
  expect(a.id).not.toBe(b.id);
});

it('leaves requests outside its routes to other handlers', async () => {
  const s = setup();
  expect((await s.call('/api/plan', {method: 'POST', body: {}})).handled).toBe(false);
});

const workspace = (name: string) => ({format: 'whereto-workspace', version: 1, name, records: EMPTY, footprints: EMPTY});
const EMPTY = Object.freeze(Object.create(null)) as Record<string, unknown>;

it('stores one workspace per account and bumps its version', async () => {
  const s = setup();
  const {session} = await s.signIn();
  const first = await s.call('/api/workspace', {cookie: session});
  expect(first.json()).toEqual({version: 0, workspace: null, updatedAt: null});
  const saved = await s.call('/api/workspace', {method: 'PUT', cookie: session, body: {baseVersion: 0, workspace: workspace('甲')}});
  expect(saved.json()).toMatchObject({version: 1});
  const again = await s.call('/api/workspace', {cookie: session});
  expect(again.json()).toMatchObject({version: 1, workspace: {name: '甲'}});
});

it('rejects a stale write instead of overwriting', async () => {
  const s = setup();
  const {session} = await s.signIn();
  await s.call('/api/workspace', {method: 'PUT', cookie: session, body: {baseVersion: 0, workspace: workspace('甲')}});
  const stale = await s.call('/api/workspace', {method: 'PUT', cookie: session, body: {baseVersion: 0, workspace: workspace('乙')}});
  expect(stale.status).toBe(409);
  expect(stale.json()).toMatchObject({version: 1});
  expect((await s.call('/api/workspace', {cookie: session})).json().workspace.name).toBe('甲');
});

it('accepts only one of two concurrent writes based on the same version', async () => {
  const s = setup();
  const {session} = await s.signIn();
  const results = await Promise.all(['甲','乙'].map(name => s.call('/api/workspace', {
    method:'PUT', cookie:session, body:{baseVersion:0,workspace:workspace(name)},
  })));
  expect(results.map(result=>result.status).sort()).toEqual([200,409]);
  expect((await s.call('/api/workspace',{cookie:session})).json()).toMatchObject({version:1});
});

it('isolates workspaces between accounts and refuses signed-out access', async () => {
  const s = setup();
  const first = await s.signIn();
  await s.call('/api/workspace', {method: 'PUT', cookie: first.session, body: {baseVersion: 0, workspace: workspace('甲')}});
  s.setUser({sub: 'g-456', email: 'b@example.com', name: 'Bo'});
  const second = await s.signIn();
  expect((await s.call('/api/workspace', {cookie: second.session})).json().workspace).toBeNull();
  expect((await s.call('/api/workspace')).status).toBe(401);
  expect((await s.call('/api/workspace', {method: 'PUT', body: {baseVersion: 0, workspace: workspace('x')}})).status).toBe(401);
});

it('rejects oversized, malformed or cross-origin workspace writes', async () => {
  const s = setup({maxWorkspaceBytes: 2000});
  const {session} = await s.signIn();
  const malformed = await s.call('/api/workspace', {method: 'PUT', cookie: session, body: {baseVersion: 0, workspace: {format: 'other', version: 1}}});
  expect(malformed.status).toBe(400);
  const big = await s.call('/api/workspace', {method: 'PUT', cookie: session, body: {baseVersion: 0, workspace: {...workspace('甲'), padding: 'x'.repeat(5000)}}});
  expect(big.status).toBe(413);
  const foreign = await s.call('/api/workspace', {method: 'PUT', cookie: session, origin: 'https://evil.test', body: {baseVersion: 0, workspace: workspace('甲')}});
  expect(foreign.status).toBe(403);
  expect((await s.call('/api/workspace', {cookie: session})).json().version).toBe(0);
});

it('rolls back the version when saving fails', async () => {
  const s = setup();
  const {session} = await s.signIn();
  await s.call('/api/workspace', {method: 'PUT', cookie: session, body: {baseVersion: 0, workspace: workspace('甲')}});
  s.failSave(true);
  const failed = await s.call('/api/workspace', {method: 'PUT', cookie: session, body: {baseVersion: 1, workspace: workspace('乙')}});
  expect(failed.status).toBe(500);
  s.failSave(false);
  expect((await s.call('/api/workspace', {cookie: session})).json()).toMatchObject({version: 1, workspace: {name: '甲'}});
});

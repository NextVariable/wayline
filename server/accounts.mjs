/** Google sign-in, browser sessions and one stored workspace per account. */
import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import {resolve} from 'node:path';
import {openCalendarVault} from './calendar-vault.mjs';
import {createGmailOrders, GMAIL_READONLY} from './gmail-rail-orders.mjs';

const SCOPES = ['openid', 'email', 'profile'];
const DAY = 86400000;
const SESSION_MS = 30 * DAY;
const FLOW_MS = 600000;
const MAX_SESSIONS = 10000;
export const MAX_WORKSPACE_BYTES = 30_000_000;

const hash = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
// Arguments are already sha256 hex digests; compare directly without hashing twice.
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
class AccountFailure extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new AccountFailure(status, message); };
const tokenPattern = /^[A-Za-z0-9_-]{20,100}$/;

function readCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(/;\s*/)) {
    const at = part.indexOf('=');
    if (at > 0) out[part.slice(0, at)] = part.slice(at + 1);
  }
  return out;
}

export function createAccountService({env = process.env, fetcher = fetch, now = Date.now, openVault = openCalendarVault, maxWorkspaceBytes = MAX_WORKSPACE_BYTES, onOwnerDeleted = async () => {}} = {}) {
  const base = new URL(env.PUBLIC_ORIGIN || `http://127.0.0.1:${env.PORT || 8787}`);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
  if (base.pathname !== '/' || base.search || base.hash || base.username || base.password || (!local && base.protocol !== 'https:')) throw new Error('登录需要 HTTPS 或本机地址');
  const redirectUri = env.GOOGLE_SIGNIN_REDIRECT_URI || `${base.origin}/api/auth/google/callback`;
  const redirect = new URL(redirectUri);
  if (redirect.href !== `${base.origin}/api/auth/google/callback`) throw new Error('Google 登录回调地址必须属于本站');
  const configured = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const secure = base.protocol === 'https:' ? '; Secure' : '';

  let vaultPromise;
  async function vault() {
    const store = await (vaultPromise ??= openVault(env.ACCOUNT_DATA_DIR || resolve('.wayline-private/accounts')));
    store.data.sessions ??= {};
    store.data.flows ??= {};
    store.data.accounts ??= {};
    store.data.workspaces ??= {};
    return store;
  }
  const gmail = createGmailOrders({vault, fetcher, now, env});

  const securityHeaders = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'};
  function send(res, status, payload, cookies = []) {
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', ...securityHeaders});
    res.end(JSON.stringify(payload));
  }
  function goTo(res, location, cookies = []) {
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    res.writeHead(303, {Location: location, ...securityHeaders});
    res.end();
  }
  function guardMutation(req) {
    if (req.headers.origin !== base.origin || !String(req.headers['content-type'] || '').startsWith('application/json')) fail(403, '请从本站操作账号');
  }
  async function jsonFetch(url, options = {}) {
    const response = await fetcher(url, {...options, signal: AbortSignal.timeout(15000)});
    let body;
    try { body = await response.json(); } catch { fail(502, 'Google 暂时无法完成登录'); }
    if (!response.ok) fail(response.status === 400 || response.status === 401 ? 401 : 502, 'Google 未能确认登录，请重试');
    return body;
  }

  /** The signed-in account for this request, or null. Never opens storage when Google is not configured. */
  async function accountFor(req) {
    if (!configured) return null;
    const token = readCookies(req).wayline_session;
    if (!token || !tokenPattern.test(token)) return null;
    const store = await vault();
    const session = store.data.sessions[hash(token)];
    if (!session || session.until <= now()) return null;
    const account = store.data.accounts[session.account];
    return account ? {id: session.account, email: account.email, name: account.name} : null;
  }

  async function start(req, res, purpose = 'signin') {
    guardMutation(req);
    const mailbox = purpose === 'gmail';
    if (mailbox && !gmail.enabled) return send(res, 200, {enabled: false});
    if (!configured) return send(res, 200, {configured: false});
    const account = mailbox ? await accountFor(req) : null;
    if (mailbox && !account) fail(401, '请先登录 Wayline');
    const store = await vault();
    for (const [id, flow] of Object.entries(store.data.flows)) if (flow.until <= now()) delete store.data.flows[id];
    const existing = readCookies(req).wayline_signin;
    const browser = existing && tokenPattern.test(existing) ? existing : random();
    const bind = hash(browser);
    if (Object.values(store.data.flows).filter(flow => flow.bind === bind).length >= 5) fail(429, '请稍后重试登录');
    const state = random(), verifier = random();
    const mailBinding = account ? {account: account.id, session: hash(readCookies(req).wayline_session)} : null;
    store.data.flows[hash(state)] = {bind, verifier, until: now() + FLOW_MS, ...(mailBinding && {mailBinding})};
    await store.save();
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code',
      scope: (mailbox ? ['openid', 'email', GMAIL_READONLY] : SCOPES).join(' '),
      state,
      ...(mailbox && {access_type:'offline', prompt:'consent', include_granted_scopes: 'true', login_hint: account.email}),
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    }).toString();
    send(res, 200, {url: auth.href}, [`wayline_signin=${browser}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600${secure}`]);
  }

  async function callback(req, res, url) {
    if (!configured) fail(404, 'Google 登录尚未配置');
    const store = await vault();
    const state = url.searchParams.get('state') || '';
    const flowId = hash(state);
    const flow = store.data.flows[flowId];
    const browser = readCookies(req).wayline_signin;
    if (!flow || flow.until <= now() || !browser || !same(flow.bind, hash(browser))) fail(400, '登录链接已过期，请返回重新登录');
    delete store.data.flows[flowId];
    await store.save();
    const clearFlow = `wayline_signin=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
    if (url.searchParams.has('error')) return goTo(res, flow.mailBinding ? '/?gmail=denied' : '/?signin=denied', [clearFlow]);
    if (flow.mailBinding) {
      const session = readCookies(req).wayline_session;
      if (!gmail.enabled || !session || !same(hash(session), flow.mailBinding.session) || (await accountFor(req))?.id !== flow.mailBinding.account)
        fail(401, '登录状态已变化，请重新连接 Gmail');
    }
    const code = url.searchParams.get('code');
    if (!code) fail(400, 'Google 未返回授权码');
    const token = await jsonFetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code, code_verifier: flow.verifier, grant_type: 'authorization_code', redirect_uri: redirectUri}),
    });
    if (!token.access_token) fail(502, 'Google 未返回有效登录');
    const profile = await jsonFetch('https://openidconnect.googleapis.com/v1/userinfo', {headers: {Authorization: `Bearer ${token.access_token}`}});
    if (typeof profile.sub !== 'string' || !profile.sub) fail(502, 'Google 未返回账号信息');
    const id = hash(profile.sub);
    if (flow.mailBinding) {
      if (!same(id, flow.mailBinding.account)) fail(403, '请使用与 Wayline 登录一致的 Google 账号');
      if (!String(token.scope || '').split(/\s+/).includes(GMAIL_READONLY))
        return goTo(res, '/?gmail=denied', [clearFlow]);
      try { await gmail.connect(id, token); }
      catch (error) { fail(error.status || 500, error.status ? error.message : 'Gmail 连接暂时无法保存'); }
      return goTo(res, '/?gmail=connected', [clearFlow]);
    }
    if (profile.email_verified !== true || typeof profile.email !== 'string' || !profile.email.trim())
      fail(403, '请使用已验证邮箱的 Google 账号登录');
    // Check capacity before touching the account so a rejected sign-in leaves no partial state.
    for (const [key, session] of Object.entries(store.data.sessions)) if (session.until <= now()) delete store.data.sessions[key];
    if (Object.keys(store.data.sessions).length >= MAX_SESSIONS) fail(503, '登录暂时繁忙，请稍后重试');
    const previous = store.data.accounts[id];
    store.data.accounts[id] = {
      email: String(profile.email || '').slice(0, 320), name: String(profile.name || '').slice(0, 200),
      createdAt: previous?.createdAt ?? now(),
    };
    const sessionToken = random();
    store.data.sessions[hash(sessionToken)] = {account: id, until: now() + SESSION_MS};
    await store.save();
    goTo(res, '/', [`wayline_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure}`, clearFlow]);
  }

  async function signout(req, res) {
    guardMutation(req);
    const token = readCookies(req).wayline_session;
    if (configured && token && tokenPattern.test(token)) {
      const store = await vault();
      const key = hash(token);
      const session = store.data.sessions[key];
      if (session) {
        delete store.data.sessions[key];
        try { await store.save(); }
        catch (error) { store.data.sessions[key] = session; throw error; }
      }
    }
    send(res, 200, {ok: true}, [`wayline_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`]);
  }

  async function me(res, req) {
    if (!configured) return send(res, 200, {configured: false, signedIn: false});
    const account = await accountFor(req);
    send(res, 200, account ? {configured: true, signedIn: true, account} : {configured: true, signedIn: false});
  }

  async function gmailRequest(req, res, action) {
    const account = await accountFor(req);
    if (!account) fail(401, '请先登录 Wayline');
    if (action === 'status' && req.method === 'GET') return send(res, 200, await gmail.status(account.id));
    if (req.method !== 'POST') fail(405, '不支持的请求');
    guardMutation(req);
    if (!gmail.enabled && action !== 'disconnect') fail(404, 'Gmail 订单尚未启用');
    try {
      if (action === 'sync') return send(res, 200, await gmail.sync(account.id));
      if (action === 'enable-sync') return send(res, 200, await gmail.enableFullSync(account.id));
      if (action === 'disconnect') return send(res, 200, await gmail.disconnect(account.id));
    } catch (error) { fail(error.status || 500, error.status ? error.message : 'Gmail 订单暂时无法同步'); }
    fail(404, 'Gmail 接口不存在');
  }

    async function readLimitedJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxWorkspaceBytes) fail(413, '数据超过 30MB，未保存');
      chunks.push(Buffer.from(chunk));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { fail(400, '数据格式无效'); }
  }

  const workspaceWrites = new Map();
  async function workspace(req, res) {
    if (req.method === 'PUT') guardMutation(req);
    else if (req.method !== 'GET') fail(405, '不支持的请求');
    const account = await accountFor(req);
    if (!account) fail(401, '请先登录');
    const body = req.method === 'PUT' ? await readLimitedJson(req) : null;
    const store = await vault();
    const next = body?.workspace;
    if (req.method === 'PUT' && (!Number.isInteger(body?.baseVersion) || !next || typeof next !== 'object' ||
        Array.isArray(next) || next.format !== 'whereto-workspace' || next.version !== 1)) fail(400, '数据格式无效');
    if (req.method === 'GET') {
      await workspaceWrites.get(account.id)?.catch(() => {});
      const current = store.data.workspaces[account.id];
      return send(res, 200, {version:current?.version ?? 0, workspace:current?.workspace ?? null, updatedAt:current?.updatedAt ?? null});
    }
    const previous = workspaceWrites.get(account.id);
    const write = (previous ?? Promise.resolve()).catch(() => {}).then(async () => {
      const current = store.data.workspaces[account.id];
      const version = current?.version ?? 0;
      if (body.baseVersion !== version) return send(res, 409, {error:'另一台设备有更新', version});
      const updatedAt = now();
      store.data.workspaces[account.id] = {version:version + 1, workspace:next, updatedAt};
      try { await store.save(); }
      catch (error) {
        if (current) store.data.workspaces[account.id] = current;
        else delete store.data.workspaces[account.id];
        throw error;
      }
      send(res, 200, {version:version + 1, updatedAt});
    });
    workspaceWrites.set(account.id, write);
    try { await write; }
    finally { if (workspaceWrites.get(account.id) === write) workspaceWrites.delete(account.id); }
  }

  async function deleteAccount(req, res) {
    guardMutation(req);
    const account = await accountFor(req);
    if (!account) fail(401, '请先登录');
    const body = await readLimitedJson(req);
    if (body?.confirm !== 'DELETE' || body?.acknowledge !== 'permanent') fail(400, '请明确确认永久删除');
    // Stop external sync and remove provider credentials before removing the local account.
    await onOwnerDeleted(`google:${account.id}`);
    const store = await vault();
    const previous = {account:store.data.accounts[account.id],workspace:store.data.workspaces[account.id],
      gmail:store.data.gmailOrders?.[account.id],sessions:{}};
    for (const [key, session] of Object.entries(store.data.sessions))
      if (session.account === account.id) { previous.sessions[key] = session; delete store.data.sessions[key]; }
    delete store.data.accounts[account.id];
    delete store.data.workspaces[account.id];
    if (store.data.gmailOrders) delete store.data.gmailOrders[account.id];
    try { await store.save(); }
    catch (error) {
      if (previous.account) store.data.accounts[account.id] = previous.account;
      if (previous.workspace) store.data.workspaces[account.id] = previous.workspace;
      if (previous.gmail) store.data.gmailOrders[account.id] = previous.gmail;
      Object.assign(store.data.sessions, previous.sessions);
      throw error;
    }
    send(res, 200, {ok: true, deletedAt: now(), purgeBy: now() + 24 * 3600_000},
      [`wayline_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`]);
  }

  function failurePage(res, status, message) {
    const escape = value => value.replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
    res.writeHead(status, {'Content-Type': 'text/html; charset=utf-8', ...securityHeaders, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"});
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录未完成 · Wayline</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 20px}</style><h1>登录未完成</h1><p>${escape(message)}</p><p><a href="/">返回 Wayline</a></p></html>`);
  }

  async function handle(req, res) {
    const url = new URL(req.url, base);
    if (!url.pathname.startsWith('/api/auth/') && url.pathname !== '/api/workspace') return false;
    try {
      if (url.pathname === '/api/workspace') await workspace(req, res);
      else if (url.pathname === '/api/auth/me' && req.method === 'GET') await me(res, req);
      else if (url.pathname === '/api/auth/google/start' && req.method === 'POST') await start(req, res);
      else if (url.pathname === '/api/auth/gmail/start' && req.method === 'POST') await start(req, res, 'gmail');
      else if (/^\/api\/auth\/gmail\/(status|sync|enable-sync|disconnect)$/.test(url.pathname)) await gmailRequest(req, res, url.pathname.split('/').at(-1));
      else if (url.pathname === '/api/auth/google/callback' && req.method === 'GET') await callback(req, res, url);
      else if (url.pathname === '/api/auth/signout' && req.method === 'POST') await signout(req, res);
      else if (url.pathname === '/api/auth/delete-account' && req.method === 'POST') await deleteAccount(req, res);
      else fail(404, '账号接口不存在');
    } catch (error) {
      if (res.headersSent) return true;
      const status = error instanceof AccountFailure ? error.status : 500;
      const message = error instanceof AccountFailure ? error.message : '登录暂时不可用，请稍后重试';
      if (url.pathname === '/api/auth/google/callback') failurePage(res, status, message);
      else send(res, status, {error: message});
    }
    return true;
  }

  return {handle, accountFor, configured};
}

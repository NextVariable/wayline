import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const equal = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
export function createWebHost({ root = resolve('dist'), password = '', secret = randomBytes(32).toString('hex'), secure = false, publicOrigin = '' } = {}) {
  root = resolve(root);
  const sign = value => createHmac('sha256', secret).update(value).digest('hex');
  const authorized = request => {
    if (!password) return true;
    const token = /(?:^|;\s*)whereto_access=([^;]+)/.exec(request.headers.cookie || '')?.[1] || '';
    const [until, signature] = token.split('.');
    return Number(until) > Date.now() && Number(until) < Date.now() + 13 * 3600_000 && equal(signature, sign(until));
  };
  return async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (!authorized(request)) {
      if (pathname === '/access' && request.method === 'POST') {
        let sameOrigin = false;
        try {
          const origin = new URL(request.headers.origin);
          const expected = publicOrigin ? new URL(publicOrigin).origin : `${secure ? 'https' : 'http'}://${request.headers.host}`;
          sameOrigin = origin.origin === expected;
        }
        catch { sameOrigin = false; }
        if (!sameOrigin) { response.writeHead(403); response.end(); return true; }
        let body = '';
        for await (const chunk of request) { body += chunk; if (body.length > 4096) break; }
        const submitted = new URLSearchParams(body).get('password') || '';
        if (body.length <= 4096 && equal(submitted, password)) {
          const until = String(Date.now() + 12 * 3600_000);
          response.writeHead(303, { Location: '/', 'Set-Cookie': `whereto_access=${until}.${sign(until)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure ? '; Secure' : ''}`, 'Cache-Control': 'no-store' });
          response.end(); return true;
        }
      }
      if (pathname.startsWith('/api/')) { response.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ error: '访问已过期，请刷新页面重新输入访问密码' })); return true; }
      response.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
      response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>出行工作台</title><style>body{font:15px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f7;color:#171719;display:grid;place-items:center;min-height:100vh;margin:0}form{background:white;padding:32px;border-radius:16px;max-width:320px;width:calc(100% - 96px)}h1{font-size:22px;margin:0 0 24px}label{display:block;font-size:14px}input,button{box-sizing:border-box;width:100%;padding:12px;border-radius:8px;font:inherit;margin-top:12px}input{border:1px solid #ccc}button{background:#171719;color:white;border:0;cursor:pointer}</style><form action="/access" method="post"><h1>出行工作台</h1>${pathname === '/access' && request.method === 'POST' ? '<p role="alert">密码不正确，请重新输入。</p>' : ''}<label>访问密码<input name="password" type="password" autocomplete="current-password" required autofocus maxlength="256"></label><button>进入</button></form></html>`);
      return true;
    }
    if (!['GET', 'HEAD'].includes(request.method) || pathname.startsWith('/api/')) return false;
    let file;
    try { file = resolve(root, '.' + decodeURIComponent(pathname)); }
    catch { response.writeHead(400); response.end(); return true; }
    if (file !== root && !file.startsWith(root + sep)) { response.writeHead(404); response.end(); return true; }
    try {
      let info;
      try { info = await stat(file); } catch { /* SPA route below. */ }
      if (!info?.isFile()) {
        if (pathname.split('/').at(-1).includes('.')) { response.writeHead(404); response.end(); return true; }
        file = resolve(root, 'index.html'); info = await stat(file);
      }
      const actualRoot = await realpath(root);
      const actualFile = await realpath(file);
      if (!actualFile.startsWith(actualRoot + sep)) {
        response.writeHead(404);
        response.end();
        return true;
      }
      const ext = file.split('.').at(-1);
      const mime = { html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json',png:'image/png',svg:'image/svg+xml',woff2:'font/woff2',ico:'image/x-icon' }[ext] || 'application/octet-stream';
      const tag = `"${info.size}-${Math.round(info.mtimeMs)}"`;
      const headers = { 'Content-Type':mime, 'X-Content-Type-Options':'nosniff', 'Cache-Control':pathname.startsWith('/assets/')?'public,max-age=31536000,immutable':'no-cache', ETag:tag };
      response.writeHead(request.headers['if-none-match'] === tag ? 304 : 200, headers);
      response.end(request.method === 'HEAD' || request.headers['if-none-match'] === tag ? undefined : await readFile(actualFile));
    } catch { response.writeHead(404); response.end('页面暂不可用，请先构建网站'); }
    return true;
  };
}

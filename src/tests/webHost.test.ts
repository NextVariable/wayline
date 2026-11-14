import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
// @ts-expect-error Node server module is executed directly.
import { createWebHost } from '../../server/web-host.mjs';
let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'whereto-web-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<html>workspace</html>');
  await writeFile(join(root, 'assets', 'main-abc.js'), 'window.ready=true');
});
afterAll(() => rm(root, { recursive: true, force: true }));
async function call(host: ReturnType<typeof createWebHost>, url: string, method = 'GET', headers: Record<string,string> = {}, body = '') {
  const request = Object.assign(Readable.from([body]), { url, method, headers: { host: 'travel.example', ...headers } });
  const result = { status: 0, headers: {} as Record<string, string>, body: '' };
  const response = { writeHead(status: number, values = {}) { result.status = status; result.headers = values; }, end(value?: string | Buffer) { result.body = value?.toString() || ''; } };
  const handled = await host(request, response);
  return { ...result, handled };
}
describe('website hosting and private preview access', () => {
  it('serves built pages, SPA routes and immutable assets', async () => {
    const host = createWebHost({ root });
    expect(await call(host, '/')).toMatchObject({ status: 200, body: '<html>workspace</html>' });
    expect(await call(host, '/trips')).toMatchObject({ status: 200, body: '<html>workspace</html>' });
    const asset = await call(host, '/assets/main-abc.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['Cache-Control']).toContain('immutable');
    expect(await call(host, '/assets/main-abc.js', 'GET', { 'if-none-match': asset.headers.ETag })).toMatchObject({ status: 304, body: '' });
    expect(await call(host, '/', 'HEAD')).toMatchObject({ status: 200, body: '' });
  });
  it('rejects malformed paths, traversal and missing assets', async () => {
    const host = createWebHost({ root });
    expect((await call(host, '/%ZZ')).status).toBe(400);
    expect((await call(host, '/%2e%2e%2fsecret')).status).toBe(404);
    expect((await call(host, '/assets/missing.js')).status).toBe(404);
  });
  it('protects both pages and paid APIs, accepts a signed session and rejects tampering', async () => {
    const host = createWebHost({ root, password: 'private-preview', secret: 'test-signing-secret', secure: true });
    expect((await call(host, '/')).status).toBe(401);
    expect(await call(host, '/api/plan', 'POST')).toMatchObject({ status: 401, handled: true });
    expect((await call(host, '/access', 'POST', {}, 'password=wrong')).body).toContain('密码不正确');
    const login = await call(host, '/access', 'POST', { origin: 'https://travel.example' }, 'password=private-preview');
    expect(login.status).toBe(303);
    const cookie = login.headers['Set-Cookie'];
    expect(cookie).toContain('HttpOnly; SameSite=Strict');
    expect(cookie).toContain('; Secure');
    expect((await call(host, '/', 'GET', { cookie })).status).toBe(200);
    expect((await call(host, '/api/plan', 'POST', { cookie })).handled).toBe(false);
    expect((await call(host, '/', 'GET', { cookie: cookie.replace(/\.[a-f0-9]+;/, '.invalid;') })).status).toBe(401);
  });
  it.each(['https://other.example', 'invalid origin'])('rejects login from %s', async origin => {
    expect((await call(createWebHost({ root, password: 'secret' }), '/access', 'POST', { origin }, 'password=secret')).status).toBe(403);
  });
});

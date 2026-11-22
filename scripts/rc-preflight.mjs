import assert from 'node:assert/strict';

const target = new URL(process.argv[2] ?? 'http://127.0.0.1:8787');
const preview = process.argv.includes('--preview');
if (target.username || target.password || target.pathname !== '/' || target.search || target.hash ||
    !['http:','https:'].includes(target.protocol)) throw new Error('Use a plain staging origin');
if (target.protocol === 'http:' && !['127.0.0.1','localhost','[::1]'].includes(target.hostname))
  throw new Error('Use HTTPS outside loopback');
const call = (path,options) => fetch(new URL(path,target),{...options,redirect:'manual',signal:AbortSignal.timeout(5000)});
const health=await call('/healthz');
assert.equal(health.status,200);
assert.equal(health.headers.get('cache-control'),'no-store');
assert.deepEqual(await health.json(),{ok:true});
const denied=await call('/api/route',{method:'POST',headers:{Origin:'https://invalid-origin.example','Content-Type':'application/json'},body:'{}'});
assert.equal(denied.status,403);
assert.equal(denied.headers.get('cache-control'),'no-store');
const homepage=await call('/');
assert.equal(homepage.status,preview ? 401 : 200);
if (!preview) {
  const badType=await call('/api/route',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'});
  assert.equal(badType.status,415);
  const badJson=await call('/api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
  assert.equal(badJson.status,400);
  const oversized=await call('/api/route',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({padding:'路'.repeat(350_000)})});
  assert.equal(oversized.status,413);
}
console.log('PASS: process health, API origin guard, no-store and expected access status');

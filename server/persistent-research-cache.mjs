import { mkdir, readFile, writeFile, rename, chmod, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';

// Mixed success/failure lists must not freeze failed pages behind a successful neighbour.
const usable = value => Array.isArray(value) ? value.length>0 && value.every(row=>row?.status==='retrieved') : value && value.status!=='unavailable' && value.availability!=='unknown' && (!Array.isArray(value.candidates)||value.candidates.length>0);

/** Encrypted short-lived research. Query text, credentials and error bodies are never journalled. */
export async function openResearchCache(directory, { now = Date.now, ttl = 600000, limit = 40 } = {}) {
  const dir = resolve(directory);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await lstat(dir)).isSymbolicLink()) throw new Error('研究缓存目录不能是链接');
  await chmod(dir, 0o700);
  const keyPath = resolve(dir, 'research.key'), file = resolve(dir, 'research.enc');
  let key;
  try { await writeFile(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  if ((await lstat(keyPath)).isSymbolicLink()) throw new Error('研究缓存密钥不能是链接');
  key = await readFile(keyPath); if (key.length !== 32) throw new Error('研究缓存密钥无效');
  await chmod(keyPath, 0o600);
  const entries = new Map();
  const journal = new Map();
  try {
    const raw = await readFile(file); if (raw.length > 5000000) throw new Error('oversize');
    const envelope = JSON.parse(raw.toString('utf8'));
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    cipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const decoded = JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.body, 'base64')), cipher.final()]).toString('utf8'));
    const rows=Array.isArray(decoded)?decoded:decoded.entries;
    for(const row of (decoded.journal || []).slice(-limit))if(row && /^[a-f0-9]{64}$/.test(row.id) && Number.isInteger(row.attempts) && ['running','failed','found','partial','not_found'].includes(row.outcome))journal.set(row.id,row);
    for (const [id, row] of rows.slice(-limit)) if (/^[a-f0-9]{64}$/.test(id) && Number.isFinite(row.time) && now() >= row.time && now() - row.time < ttl) entries.set(id, row);
  } catch (e) { if (e.code !== 'ENOENT') throw new Error('研究缓存无法解密，原文件已保留'); }
  let writes = Promise.resolve();
  const save = () => {
    const snapshot = JSON.stringify({entries:[...entries],journal:[...journal.values()]});
    const task = writes.then(async () => {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(snapshot), cipher.final()]);
      const temp = resolve(dir, randomBytes(8).toString('hex') + '.tmp');
      await writeFile(temp, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: body.toString('base64') }), { mode: 0o600 });
      await rename(temp, file);
    });
    writes = task.catch(() => {}); return task;
  };
  const inFlight = new Map();
  return {history:()=>[...journal.values()].map(row=>({...row})), async lookup(query, run, options={}) {
    const id = createHash('sha256').update(query).digest('hex');
    const hit = entries.get(id);
    const lifetime=Math.min(ttl,Number.isFinite(options.ttl)&&options.ttl>0?options.ttl:ttl);
    if (hit && now() >= hit.time && now() - hit.time < lifetime && usable(hit.value)) return hit.value;
    if (inFlight.has(id)) return inFlight.get(id);
    const pending = (async () => {
      const previous=journal.get(id);
      const attempt={id,kind:/^[a-zA-Z]{1,30}$/.test(options.kind || '')?options.kind:'public',attempts:(previous?.attempts || 0)+1,outcome:'running',lastAttempt:now()};
      journal.delete(id);journal.set(id,attempt);
      while(journal.size>limit)journal.delete(journal.keys().next().value);
      await save();
      let value;
      try {value=await run();}catch(error){attempt.outcome='failed';await save();throw error;}
      const useful = usable(value);
      attempt.outcome=useful?'found':Array.isArray(value)&&value.some(row=>row?.status==='retrieved')?'partial':'not_found';
      if (useful && JSON.stringify(value).length < 100000) {
        entries.delete(id); entries.set(id, { time: now(), value });
        while (entries.size > limit) entries.delete(entries.keys().next().value);
      }
      await save();
      return value;
    })();
    inFlight.set(id, pending);
    try { return await pending; } finally { inFlight.delete(id); }
  } };
}

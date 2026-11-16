import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19));
  }
  // IPv6 global unicast only. Mapped IPv4, loopback and link-local are excluded.
  // 6to4 (2002::/16) and Teredo (2001:0::/32) embed an IPv4 address that may be private,
  // and 2001:db8::/32 is documentation-only, so all three are rejected.
  return isIP(address) === 6 && /^[23][\da-f]{3}:/i.test(address) && !/^2001:(?:db8|0{0,4}):|^2002:/i.test(address);
}
export async function readPublicPage(value, { resolveHost = lookup, requestImpl = request } = {}, redirects = 0) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') throw new Error('只读取公开的HTTPS页面');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const answers = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolveHost(host, { all: true });
  if (!answers.length || answers.some(a => !isPublicAddress(a.address))) throw new Error('不读取本机或内部网络地址');
  const target = answers[0];
  return new Promise((resolve, reject) => {
    const req = requestImpl(url, { agent: false, headers: { Accept: 'text/html,text/plain', 'User-Agent': 'Whereto/1.0' },
      // Pin the validated resolution; a second DNS lookup cannot redirect into a private network.
      lookup: (_host, options, callback) => options.all ? callback(null, [target]) : callback(null, target.address, target.family),
      signal: AbortSignal.timeout(8000) }, response => {
      if ([301,302,303,307,308].includes(response.statusCode)) {
        response.resume();
        if (redirects >= 2 || !response.headers.location) return reject(new Error('页面跳转过多'));
        readPublicPage(new URL(response.headers.location, url).href, { resolveHost, requestImpl }, redirects + 1).then(resolve, reject); return;
      }
      if (response.statusCode !== 200 || !/text\/html|text\/plain/.test(response.headers['content-type'] || '')) { response.resume(); reject(new Error('页面无法读取')); return; }
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 256000) { response.destroy(); reject(new Error('页面过大')); } else chunks.push(chunk); });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); response.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
}

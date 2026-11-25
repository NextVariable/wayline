import { readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { mkdir, writeFile, rename, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';

/** Same rule as src/lib/placeAliases.ts normalizeLocationText. */
export const normalizeLocationText = text => String(text ?? '').toLowerCase().replace(/[\s，,、。.（）()【】\[\]·・\-—_:：;；'"“”‘’]/g, '');

const MAX_ITEMS = 40, MAX_TEXT = 200, MAX_CACHE = 5000, MAX_CANDIDATES = 5;

/** Same rule as classifyLocation in src/lib/calendarPlaces.ts: a meeting link or a bare word like 线上 is not a place. */
const ONLINE_LINK = /https?:\/\/|meeting\.tencent\.com|zoom\.us|teams\.microsoft|feishu\.cn|larksuite/i;
const ONLINE_WORDS = new Set(['线上', '视频会议', '电话', '腾讯会议', 'zoom']);
export const isOnlineLocation = text => { const value = String(text ?? '').trim(); return ONLINE_LINK.test(value) || ONLINE_WORDS.has(value.toLowerCase()); };
const invalid = message => Object.assign(new Error(message), { status: 400 });
const placeOf = p => ({ name: p.name, city: p.city, address: typeof p.address === 'string' ? p.address : '', lat: p.lat, lng: p.lng, ...(p.routeAccess && {routeAccess:p.routeAccess}) });

/** A random secret kept beside the cache (0600). Without it the cached keys cannot be matched against guessed text. */
function cacheSecret(cacheFile) {
  if (!cacheFile) return randomBytes(32);
  const file = cacheFile + '.key';
  try {
    const value = readFileSync(file);
    if (value.length === 32) return value;
  } catch { /* created below */ }
  const value = randomBytes(32);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, value, { mode: 0o600 });
  chmodSync(file, 0o600);
  return value;
}

/**
 * Calendar location text → one map place, a short candidate list, or nothing.
 * Signed-in lookups are cached per account under a keyed hash of account, text and city; the raw text, which may be private,
 * is never stored, and one account's lookups never answer another's. Guests are not cached.
 */
export function createCalendarPlaceResolver({ searchPlaces, cacheFile }) {
  const secret = cacheSecret(cacheFile);
  const keyOf = (owner, text, city) => createHmac('sha256', secret).update(owner + '\u0000' + normalizeLocationText(text) + '\u0000' + String(city || '')).digest('hex');
  const cache = new Map();
  if (cacheFile) {
    try {
      const rows = JSON.parse(readFileSync(cacheFile, 'utf8'));
      // Entries written before keys were account-scoped and secret are unreadable under the new key and simply dropped.
      if (rows && rows.version === 5 && Array.isArray(rows.entries)) {
 for (const [key, value] of rows.entries.slice(-MAX_CACHE)) if (/^[a-f0-9]{64}$/.test(key) && value && typeof value.status === 'string') cache.set(key, value);
      }
    } catch { /* missing or unreadable cache starts empty */ }
  }
  let writing = Promise.resolve();
  const persist = () => {
    if (!cacheFile) return writing;
    writing = writing.then(async () => {
      await mkdir(dirname(cacheFile), { recursive: true, mode: 0o700 });
      const tmp = cacheFile + '.' + process.pid + '.tmp';
      await writeFile(tmp, JSON.stringify({ version: 5, entries: [...cache.entries()] }), { mode: 0o600 });
      await chmod(tmp, 0o600);
      await rename(tmp, cacheFile);
    }).catch(() => { /* a failed write only costs a repeat lookup later */ });
    return writing;
  };
  const remember = (key, value) => {
    cache.delete(key); cache.set(key, value);
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  };
  const lookup = async (text, city) => {
    let rows;
    try { rows = await searchPlaces({ keyword: text.trim(), city: city || '', count: 10 }); }
    catch { return { status: 'unavailable' }; }
    if (!Array.isArray(rows)) return { status: 'unavailable' };
    const valid = rows.filter(p => p && typeof p.name === 'string' && p.name.trim() &&
      typeof p.city === 'string' && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 &&
      Number.isFinite(p.lng) && Math.abs(p.lng) <= 180);
    if (rows.length && !valid.length) return { status: 'unavailable' };
    rows = valid;
    const wanted = normalizeLocationText(text);
    const cityKey = value => normalizeLocationText(value).replace(/市$/, '');
    const scope = cityKey(city);
    const inCity = place => !!scope && cityKey(place.city) === scope;
    const exact = rows.filter(p => normalizeLocationText(p.name) === wanted);
    const localName = scope && wanted.startsWith(scope) ? wanted.slice(scope.length).replace(/^市/, '') : wanted;
    const vague = localName.length < 3 || /^(?:公司|办公室|会议室|大会议室|总部|分公司|园区|客户公司|客户办公室|楼下|前台|大厅|门口|咖啡馆|会展|会展中心|待定|地点待定|[a-z0-9一二三四五六七八九]+号?会议室)$/u.test(localName);
    const branch = rows.some(p => p !== exact[0] && normalizeLocationText(p.name).startsWith(wanted) &&
      /(?:店|分公司|分部|校区|园区|院区|分中心)$/u.test(normalizeLocationText(p.name)));
    if (!vague && !branch && exact.length === 1 && inCity(exact[0])) return { status: 'found', place: placeOf(exact[0]) };
    const cityPrefix = scope ? new RegExp('^(?:[\u4e00-\u9fff]{2,8}?(?:省|自治区))?' + scope.replace(/[^\p{L}\d]/gu, '') + '市?') : null;
    const localAddress = value => cityPrefix ? normalizeLocationText(value).replace(cityPrefix, '') : normalizeLocationText(value);
    const matchingAddress = rows.filter(p => {
      if (vague || !inCity(p) || !/\d+号(?:$|[a-zA-Z0-9一二三四五六七八九]+[楼栋幢座])/u.test(wanted)) return false;
      const district=normalizeLocationText(p.district);
      const stripDistrict = value => district && value.startsWith(district) ? value.slice(district.length) : value;
      return stripDistrict(localAddress(p.address)) === stripDistrict(localAddress(wanted));
    });
    if (matchingAddress.length === 1) return { status: 'found', place: placeOf(matchingAddress[0]) };
    if (!rows.length) return { status: 'none' };
    return { status: 'ambiguous', candidates: [...exact, ...rows.filter(p => !exact.includes(p))].slice(0, MAX_CANDIDATES).map(placeOf) };
  };
  return {
    /** owner: the signed-in account id; omitted for guests, whose lookups are never cached. */
    async resolve(items, owner) {
      if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) throw invalid('每次需要 1 到 40 个地点');
      for (const item of items) {
 if (!item || typeof item.text !== 'string' || !item.text.trim() || item.text.length > MAX_TEXT || (item.city !== undefined && typeof item.city !== 'string')) throw invalid('地点文字无效');
      }
      const cached = typeof owner === 'string' && owner.length > 0;
      const pending = new Map();
      let changed = false;
      const results = await Promise.all(items.map(async ({ text, city }) => {
        if (isOnlineLocation(text)) return { text, status: 'online' };
        const dedupe = normalizeLocationText(text) + '\u0000' + String(city || '');
 const key = cached ? keyOf(owner, text, city) : null;
 let value = key ? cache.get(key) : undefined;
 if (!value) {
          if (!pending.has(dedupe)) pending.set(dedupe, lookup(text, city));
          value = await pending.get(dedupe);
   if (key && value.status !== 'unavailable' && !cache.has(key)) { remember(key, value); changed = true; }
        }
 return { text, ...value };
      }));
      if (changed) await persist();
      return results;
    },
  };
}

import { createHash } from 'node:crypto';
import { orderKind, serviceNumber, namedRoute } from '../shared/travel-order.mjs';

export const GMAIL_READONLY = 'https://www.googleapis.com/auth/gmail.readonly';
const sender = '12306@rails.com.cn';
const bookingDomains = ['trip.com', 'ctrip.com', 'ceair.com', 'csair.com', 'airchina.com', 'huazhu.com'];
const DAY = 86400000;
const gmailRoot = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const trainPattern = '(?:[GDCZTKSLY]\\d{1,5}|\\d{4})';
const stationPattern = '[\\p{Script=Han}A-Za-z0-9·（）()]{2,22}';
const subjectOK = /购票成功|订票成功|车票购买成功|电子客票通知|改签成功|退票成功|取消成功|停运通知|变更到站成功/;
const uncertainty = /改签|退票|停运|取消|变更到站/;

const digest = text => createHash('sha256').update(text).digest('hex');
const field = (headers, name) => headers?.find(item => item.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

function bodyText(part) {
  if (!part) return '';
  const collect = (node, type, depth = 0) => {
    if (!node || depth > 12) return '';
    if (node.mimeType === type && !node.filename && typeof node.body?.data === 'string')
      return Buffer.from(node.body.data.slice(0, 160_000), 'base64url').toString('utf8');
    if (node.mimeType === 'message/rfc822') return '';
    return (node.parts ?? []).slice(0, 24).map(child => collect(child, type, depth + 1)).filter(Boolean).join('\n').slice(0, 100_000);
  };
  return (collect(part, 'text/plain') || collect(part, 'text/html')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(?:br|p|div|tr|td|li)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&ndash;|&mdash;/gi, '—')
    .replace(/&#(\d{2,6});/g, (entity, digits) => Number(digits) <= 0x10FFFF ? String.fromCodePoint(Number(digits)) : entity)).slice(0, 100_000);
}

function dateFrom(text) {
  const match = /\b(20\d{2})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})(?:日|\b)/.exec(text);
  if (!match) return null;
  const date = [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-');
  const stamp = new Date(date + 'T00:00:00Z');
  return Number.isFinite(+stamp) && stamp.toISOString().slice(0, 10) === date ? date : null;
}

const station = text => text?.replace(/站$/, '') || '';
const clock = /(?:[01]?\d|2[0-3]):[0-5]\d/;
const timeStamp = (date, time) => date + 'T' + time.padStart(5, '0') + ':00+08:00';

/** Keep only structured travel fields. Unknown and amended formats never become confirmed journeys. */
export function parseRailMessage(message) {
  const payload = message?.payload;
  const from = String(field(payload?.headers, 'From')).trim();
  const address = from.match(/<([^<>]+)>\s*$/)?.[1] ?? from;
  const subject = String(field(payload?.headers, 'Subject')).normalize('NFKC');
  if (address.toLowerCase() !== sender || !subjectOK.test(subject)) return null;
  const content = bodyText(payload).normalize('NFKC').replace(/[\t\r]+/g, ' ');
  const orderNo = /(?:订单(?:号|号码)|取票号)\s*[:：为]?\s*([A-Z][A-Z0-9]{7,19})\b/i.exec(content)?.[1];
  const reference = orderNo ? digest(orderNo.toUpperCase()) : '';
  const receivedAt = Number(message.internalDate);
  if (!Number.isFinite(receivedAt) || receivedAt <= 0) return null;
  const authentication = field(payload.headers, 'Authentication-Results').trim();
  if (!/^mx\.google\.com\s*;/i.test(authentication) ||
      !/(?:\bdmarc=pass\b[^;]*\bheader\.from=rails\.com\.cn(?=[;\s]|$)|\bdkim=pass\b[^;]*\bheader\.(?:i=@|d=)rails\.com\.cn(?=[;\s]|$)|\bspf=pass\b[^;]*\bsmtp\.mailfrom=[^;\s]*@rails\.com\.cn(?=[;\s]|$))/i.test(authentication))
    return { kind: 'review', reference, receivedAt };
  if (uncertainty.test(subject)) return { kind: 'change', reference, receivedAt, state: /退票|取消|停运/.test(subject) ? 'cancelled' : 'changed' };
  if (/待支付|未支付|候补兑现失败/.test(subject) || /(?:订单状态\s*[:：]\s*(?:待支付|未支付)|请在[^\n。]{0,24}(?:分钟|小时)内[^\n。]{0,16}支付)/.test(content))
    return { kind: 'review', reference, receivedAt };

  const journeys = new Map();
  // Each occurrence is parsed in its own block so one passenger or train cannot supply fields to another.
  const blocks = content.split(/(?=乘车日期\s*[:：]|发车日期\s*[:：]|(?<=\n)\s*\d{1,2}[、.．]\s*)/);
  for (const block of blocks) {
    const candidates = [...new Set(Array.from(block.matchAll(new RegExp(
      `(?:车次\\s*[:：]?\\s*(${trainPattern})(?![A-Z0-9])|(?:^|[^A-Z0-9])(${trainPattern})\\s*次(?:列车)?)`, 'gi'
    )), match => (match[1] ?? match[2]).toUpperCase()))];
    if (candidates.length !== 1) continue;
    const dateLabel = /(?:乘车日期|出发日期|发车日期)\s*[:：]?\s*([^\n,，;；]{8,24})/.exec(block)?.[1];
    const ticketLine = block.split('\n').find(line =>
      new RegExp(`${trainPattern}\\s*次`, 'i').test(line) && new RegExp(`${clock.source}\\s*开`).test(line));
    const date = dateFrom(dateLabel ?? ticketLine ?? '');
    const route = new RegExp(`(${stationPattern})站\\s*(?:至|到|—|→|-)\\s*(${stationPattern})站`, 'u').exec(block);
    const labelled = (labels, value) => new RegExp(`(?:${labels})\\s*[:：]?\\s*(${value})`, 'u').exec(block)?.[1];
    const origin = station(labelled('出发站|发站|始发站|上车站', stationPattern) ?? route?.[1]);
    const destination = station(labelled('到达站|到站|下车站|终到站', stationPattern) ?? route?.[2]);
    const leave = labelled('出发时间|开车时间|发车时间', clock.source)
      ?? new RegExp(`(${clock.source})\\s*开(?:车)?`).exec(block)?.[1];
    if (!date || !origin || !destination || origin === destination || !leave) continue;
    const departAt = timeStamp(date, leave);
    const arrival = labelled('到达时间|到站时间', clock.source);
    const arriveAt = arrival && timeStamp(date, arrival) > departAt ? timeStamp(date, arrival) : undefined;
    const train = candidates[0];
    const id = digest([train, origin, destination, departAt].join('|'));
    journeys.set(id, { id, train, origin, destination, departAt, ...(arriveAt ? { arriveAt } : {}) });
  }
  return journeys.size ? { kind: 'confirmed', reference, receivedAt, journeys: [...journeys.values()] }
    : { kind: 'review', reference, receivedAt };
}

// Only authenticated first-party confirmations with explicit fields become fixed bookings.
export function parseBookingMessage(message) {
  const payload = message?.payload;
  const address = String(field(payload?.headers, 'From')).trim().replace(/^.*<([^<>]+)>$/, '$1').toLowerCase();
  const domain = address.split('@').at(-1);
  if (!bookingDomains.includes(domain)) return null;
  const auth = field(payload.headers, 'Authentication-Results');
  if (!/^mx\.google\.com\s*;/i.test(auth) ||
      !auth.split(';').some(part => /\bdmarc=pass\b/i.test(part) && part.match(/\bheader\.from=([^\s;]+)/i)?.[1].toLowerCase() === domain)) return null;
  const subject = field(payload.headers, 'Subject').normalize('NFKC');
  if (!/已确认|预订成功|出票成功|订单确认|取消|退款|退订|退票|改签/.test(subject)) return null;
  const content = bodyText(payload).normalize('NFKC');
  const get = re => re.exec(content)?.[1]?.trim() ?? '';
  const ref = get(/(?:订单号|预订编号)\s*:\s*([A-Z0-9-]{5,40})/i);
  const reference = ref ? digest(domain + ':' + ref) : '';
  const receivedAt = Number(message.internalDate);
  if (!Number.isFinite(receivedAt) || receivedAt <= 0) return null;
  if (/取消|退款|退订|退票|改签/.test(subject)) return { kind:'booking-change', domain, reference, receivedAt, state: /取消|退款|退订|退票/.test(subject) ? 'cancelled' : 'changed' };
  if (/待支付|未支付|尚未确认/.test(content)) return { kind:'review', reference, receivedAt };
  const kind = orderKind(subject) ?? (/酒店|住宿|客房/.test(subject) ? 'stay' : /航班|机票/.test(subject) ? 'flight' : null);
  const readDateTime = value => {
    const date = dateFrom(value);
    const time = value.match(clock)?.[0];
    return date && time ? timeStamp(date, time) : '';
  };
  const start = kind === 'stay' ? dateFrom(get(/(?:入住日期|入住时间)\s*:\s*([^\n]+)/))
    : readDateTime(get(/(?:起飞时间|出发时间)\s*:\s*([^\n]+)/));
  const end = kind === 'stay' ? dateFrom(get(/(?:退房日期|离店日期|退房时间)\s*:\s*([^\n]+)/))
    : readDateTime(get(/(?:到达时间|抵达时间)\s*:\s*([^\n]+)/));
  const [routeFrom, routeTo] = namedRoute(subject);
  const to = kind === 'stay' ? get(/(?:酒店名称|酒店)\s*:\s*([^\n]+)/)
    : get(/(?:到达机场|抵达机场|目的机场)\s*:\s*([^\n]+)/) || routeTo;
  const from = kind === 'flight' ? get(/(?:出发机场|起飞机场)\s*:\s*([^\n]+)/) || routeFrom : undefined;
  const number = kind === 'flight' ? serviceNumber(get(/(?:航班号|航班)\s*:\s*([^\n]+)/) || subject, 'flight') : undefined;
  if (!start || !end || end <= start || !to || to.length > 100 || kind === 'flight' && (!number || !from || from.length > 100 || from === to) ||
      !['stay','flight'].includes(kind)) return { kind:'review', reference, receivedAt };
  const city = kind === 'stay' ? get(/(?:入住城市|酒店城市|城市)\s*:\s*([\p{Script=Han}]{2,12})(?=\s|$)/u) : '';
  const id = digest([kind, number, from, to, city, start].join('|'));
  return { kind:'booking', domain, reference, receivedAt, booking:{ id, kind, number, start, end, from, to, ...(city && {city}) } };
}

export function collectMailBookings(messages, now) {
  const changes = messages.filter(row => row?.kind === 'booking-change');
  const bookings = new Map();
  for (const row of [...messages].sort((a,b)=>(a?.receivedAt ?? 0)-(b?.receivedAt ?? 0))) {
    if (row?.kind !== 'booking' || Date.parse(row.booking.end) < now - DAY) continue;
    if (changes.some(change => change.domain === row.domain && change.receivedAt >= row.receivedAt &&
        (!change.reference || !row.reference || change.reference === row.reference))) continue;
    bookings.set(row.booking.id, row.booking);
  }
  return [...bookings.values()];
}

export function collectRailOrders(messages, now, { includePast = false } = {}) {
  const changes = messages.filter(row => row?.kind === 'change');
  const orders = new Map();
  let reviewCount = messages.filter(row => row?.kind === 'review' || row?.kind === 'change').length;
  for (const row of [...messages].sort((a,b)=>(a?.receivedAt ?? 0)-(b?.receivedAt ?? 0))) {
    if (row?.kind !== 'confirmed') continue;
    // Without an order reference we cannot safely match amendments. Show the uncertainty, not a fixed departure.
    if (changes.some(change => change.receivedAt >= row.receivedAt && (!change.reference || !row.reference || change.reference === row.reference))) {
      reviewCount += 1;
      continue;
    }
    for (const order of row.journeys) {
      if (includePast || Date.parse(order.departAt) >= now - DAY) orders.set(order.id, order);
    }
  }
  return { orders: [...orders.values()].sort((a, b) => a.departAt.localeCompare(b.departAt)), reviewCount };
}

// Return only normalized itinerary fields and the notice time. References stay in the private vault.
export function collectBookingChanges(messages, now) {
  const changes = messages.filter(row => row?.kind === 'change' || row?.kind === 'booking-change');
  const affected = new Map();
  for (const row of messages) {
    if (!['confirmed', 'booking'].includes(row?.kind)) continue;
    const notice = changes.filter(item => item.receivedAt >= row.receivedAt &&
      (row.kind === 'confirmed' ? item.kind === 'change' : item.kind === 'booking-change' && item.domain === row.domain) &&
      (!item.reference || !row.reference || item.reference === row.reference))
      .sort((a,b) => b.receivedAt - a.receivedAt)[0];
    if (!notice) continue;
    const historical = row.kind === 'booking' ? [row.booking] : row.journeys.map(journey => ({
      id:journey.id, kind:'rail', number:journey.train, start:journey.departAt, end:journey.arriveAt,
      from:journey.origin, to:journey.destination,
    }));
    for (const booking of historical) {
      if (Date.parse(booking.end ?? booking.start) < now - DAY) continue;
      const matchingReference = !!notice.reference && notice.reference === row.reference;
      const state = matchingReference ? notice.state ?? 'review' : 'review';
      const known = affected.get(booking.id);
      if (!known || known.observedAt < notice.receivedAt)
        affected.set(booking.id, {...booking, state, observedAt:notice.receivedAt});
    }
  }
  const activeIds = new Set([...collectMailBookings(messages, now), ...collectRailOrders(messages, now).orders].map(row => row.id));
  return [...affected.values()].filter(row => !activeIds.has(row.id));
}

export function createGmailOrders({ vault, fetcher, now, env }) {
  const enabled = env.GMAIL_ORDERS_ENABLED === '1' && !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const defaultSingleSample = env.GMAIL_ORDERS_SINGLE_SAMPLE === '1';
  const locks = new Map();
  const error = (status, message) => Object.assign(new Error(message), { status });
  const bucket = async () => (await vault()).data.gmailOrders ??= Object.create(null);
  const save = async (id, next, previous) => {
    const rows = await bucket();
    if (rows[id] !== previous) throw error(409, 'Gmail 连接已变更，请重试');
    if (next) rows[id] = next; else delete rows[id];
    try { await (await vault()).save(); }
    catch (err) {
      if (rows[id] === next) { if (previous) rows[id] = previous; else delete rows[id]; }
      throw err;
    }
  };

  async function connect(id, token) {
    const previous = (await bucket())[id];
    const refresh = token.refresh_token || previous?.token.refresh;
    if (!refresh) throw error(400, 'Google 未提供持续读取权限，请重新授权 Gmail');
    await save(id, {
      token: { access: token.access_token, refresh, expiresAt: now() + Number(token.expires_in || 3600) * 1000 },
      messages: {}, lastSync: null, partial: false, fullSync:previous?.fullSync === true,
    }, previous);
  }

  async function status(id) {
    const entry = enabled && id ? (await bucket())[id] : undefined;
    const messages = Object.values(entry?.messages ?? {});
    const singleSample = defaultSingleSample && entry?.fullSync !== true;
    return { enabled, connected: !!entry, lastSync: entry?.lastSync ?? null, partial: entry?.partial ?? false, singleSample, needsReconnect: !!entry?.needsReconnect,
      ...(singleSample && { sampleRead: messages.length > 0 }),
      ...collectRailOrders(messages, now(), { includePast: singleSample }),
      bookings: singleSample ? [] : collectMailBookings(messages, now()),
      changes: singleSample ? [] : collectBookingChanges(messages, now()) };
  }

  async function request(url, options = {}) {
    let res;
    try { res = await fetcher(url, { ...options, signal: AbortSignal.timeout(10_000) }); }
    catch { throw error(502, '暂时无法连接 Gmail，请稍后重试'); }
    if (res.status === 401) throw error(401, 'Gmail 授权已失效，请重新连接');
    if (res.status === 403) throw error(403, 'Gmail API 尚未启用或该账号没有读取权限');
    if (!res.ok) {
      if (res.status === 400 && url === 'https://oauth2.googleapis.com/token') {
        const body = await res.json().catch(() => null);
        if (body?.error === 'invalid_grant') throw error(401, 'Gmail 授权已失效，请重新连接');
      }
      throw error(502, 'Gmail 暂时无法读取，请稍后重试');
    }
    try { return await res.json(); }
    catch { throw error(502, 'Gmail 返回的数据不完整'); }
  }

  async function perform(id) {
    const rows = await bucket();
    const current = rows[id];
    if (!current) throw error(409, '请先连接 Gmail');
    if (current.needsReconnect) throw error(401, 'Gmail 授权已失效，请重新连接');
    const singleSample = defaultSingleSample && current.fullSync !== true;
    if (current.lastSync && now() - current.lastSync < 60_000) return status(id);
    let token = current.token;
    if (token.expiresAt < now() + 60_000) {
      const refreshed = await request('https://oauth2.googleapis.com/token', {
        method: 'POST', body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
          grant_type: 'refresh_token', refresh_token: token.refresh }),
      });
      if (!refreshed.access_token) throw error(401, 'Gmail 授权已失效，请重新连接');
      token = { ...token, access: refreshed.access_token, expiresAt: now() + Number(refreshed.expires_in || 3600) * 1000 };
    }

    const headers = { Authorization: `Bearer ${token.access}` };
    const ids = new Set();
    let pageToken = '';
    const query = singleSample
      ? `from:${sender} newer_than:90d {subject:"购票成功" subject:"订票成功" subject:"电子客票通知"}`
      : `newer_than:90d {from:${sender} ${bookingDomains.map(domain => 'from:' + domain).join(' ')}} {subject:购票 subject:订票 subject:电子客票 subject:出票 subject:预订 subject:订单 subject:退票 subject:改签 subject:取消 subject:退订 subject:退款 subject:停运 subject:变更到站}`;
    for (let page = 0; page < (singleSample ? 1 : 2); page++) {
      if (rows[id] !== current) throw error(409, 'Gmail 连接已变更，请重试');
      const params = new URLSearchParams({ q: query, maxResults: singleSample ? '1' : '50',
        fields: 'messages/id,nextPageToken,resultSizeEstimate', ...(pageToken ? { pageToken } : {}) });
      const result = await request(gmailRoot + '?' + params, { headers });
      for (const row of result.messages ?? []) if (typeof row.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(row.id)) ids.add(row.id);
      pageToken = typeof result.nextPageToken === 'string' ? result.nextPageToken : '';
      if (!pageToken) break;
    }

    const messages = Object.create(null);
    const list = [...ids].slice(0, singleSample ? 1 : 100);
    for (let offset = 0; offset < list.length; offset += 5) {
      if (rows[id] !== current) throw error(409, 'Gmail 连接已变更，请重试');
      await Promise.all(list.slice(offset, offset + 5).map(async messageId => {
        const key = digest(messageId);
        if (Object.hasOwn(current.messages, key) && (current.parserVersion === 3 || (current.messages[key] && !['change','booking-change'].includes(current.messages[key].kind)))) {
          messages[key] = current.messages[key];
        } else {
          const message = await request(`${gmailRoot}/${encodeURIComponent(messageId)}?format=full&fields=internalDate,payload`, { headers });
          messages[key] = parseRailMessage(message) ?? (!singleSample ? parseBookingMessage(message) : null);
        }
      }));
    }
    if (rows[id] !== current) throw error(409, 'Gmail 连接已变更，请重试');
    await save(id, { token, messages, lastSync: now(), partial: !!pageToken, parserVersion:3, fullSync:current.fullSync === true }, current);
    return status(id);
  }

  async function enableFullSync(id) {
    const entry = (await bucket())[id];
    if (!entry) throw error(409, '请先连接 Gmail');
    if (defaultSingleSample && !entry.fullSync)
      await save(id, { ...entry, fullSync:true, lastSync:null }, entry);
    return sync(id);
  }

  function sync(id) {
    if (!locks.has(id)) locks.set(id, (async () => {
      const entry = (await bucket())[id];
      try { return await perform(id); }
      catch (failure) {
        if (failure.status === 401 && entry && !entry.needsReconnect && (await bucket())[id] === entry)
          await save(id, {...entry,needsReconnect:true},entry);
        throw failure;
      }
    })().finally(() => locks.delete(id)));
    return locks.get(id);
  }
  async function disconnect(id) {
    const entry = (await bucket())[id];
    if (entry) await save(id, undefined, entry);
    return status(id);
  }
  return { enabled, status, connect, sync, enableFullSync, disconnect };
}

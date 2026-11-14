// Only explicit booking/itinerary data enters this parser. It never geocodes or guesses dates.
export const orderText = value => String(value ?? '').normalize('NFKC').trim();
export const orderKind = value => {
  const text = orderText(value);
  if (/待定|未订|未购|待支付|未支付|取消|退票|停运|候补|查询|推荐|接驳|班车/.test(text)) return null;
  if (/(?:入住|退房|住宿|酒店订单|客房预订|订房)/.test(text)) return 'stay';
  if (/(?:^|[^A-Z0-9])[GDCZTKSLY]\d{1,5}(?![A-Z0-9])/i.test(text) && /高铁|火车|车票|车次|列车|站|[→➝]/.test(text)) return 'rail';
  if (/(?:^|[^A-Z0-9])(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\d{3,4}(?![A-Z0-9])/i.test(text) && /航班|航空|机场|[→➝]/.test(text)) return 'flight';
  return null;
};
export const serviceNumber = (value, kind) => orderText(value)
  .match(kind === 'rail' ? /(?:^|[^A-Z0-9])([GDCZTKSLY]\d{1,5})(?![A-Z0-9])/i : /(?:^|[^A-Z0-9])((?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\d{3,4})(?![A-Z0-9])/i)?.[1].toUpperCase() ?? '';
export function namedRoute(value) {
  const text = orderText(value);
  const match = text.match(/([^\n｜|：:，,；;]+?)\s*[→➝]\s*([^\n｜|，,；;]+)/);
  if (!match) return [];
  const clean = name => name.replace(/^.*?(?:[A-Z0-9]{1,2}\d{1,5})\s*(?:次|航班)?\s*/i, '')
    .replace(/\s*[（(](?:已订|已出票|已确认)[）)]\s*$/, '').trim();
  return [clean(match[1]), clean(match[2])];
}

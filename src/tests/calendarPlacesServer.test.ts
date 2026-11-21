import {it, expect, vi} from 'vitest';
import {mkdtemp, readFile, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error Server ESM exercised directly.
import {createCalendarPlaceResolver} from '../../server/calendar-places.mjs';

const poi = (name: string, address = name + '1号', lat = 31.2, lng = 121.4) => ({name, city: '上海', address, lat, lng});

async function setup(rows: Record<string, ReturnType<typeof poi>[] | Error>) {
  const dir = await mkdtemp(join(tmpdir(), 'cal-places-'));
  const cacheFile = join(dir, 'calendar-places.json');
  const searchPlaces = vi.fn(async ({keyword}: {keyword: string}) => {
    const value = rows[keyword];
    if (value instanceof Error) throw value;
    return value ?? [];
  });
  const resolver = createCalendarPlaceResolver({searchPlaces, cacheFile});
  return {resolver, searchPlaces, cacheFile};
}

it('returns the single exact match as found', async () => {
  const {resolver} = await setup({'上海虹桥站': [poi('上海虹桥站'), poi('虹桥站停车场')]});
  const [result] = await resolver.resolve([{text: '上海虹桥站', city: '上海'}]);
  expect(result).toEqual({text: '上海虹桥站', status: 'found', place: poi('上海虹桥站')});
});

it('returns candidates when several places match', async () => {
  const many = ['A', 'B', 'C', 'D', 'E', 'F'].map(n => poi('星巴克' + n));
  const {resolver} = await setup({'星巴克': many});
  const [result] = await resolver.resolve([{text: '星巴克', city: '上海'}]);
  expect(result.status).toBe('ambiguous');
  expect(result.candidates).toHaveLength(5);
});

it('returns none when the search is empty', async () => {
  const {resolver} = await setup({});
  expect((await resolver.resolve([{text: '老王家', city: '上海'}]))[0]).toEqual({text: '老王家', status: 'none'});
});

it('reports unavailable without caching', async () => {
  const {resolver, searchPlaces} = await setup({'上海虹桥站': new Error('quota')});
  expect((await resolver.resolve([{text: '上海虹桥站', city: '上海'}]))[0]).toEqual({text: '上海虹桥站', status: 'unavailable'});
  await resolver.resolve([{text: '上海虹桥站', city: '上海'}]);
  expect(searchPlaces).toHaveBeenCalledTimes(2);
});

it('caches by hashed text and city, never the raw text', async () => {
  const {resolver, searchPlaces, cacheFile} = await setup({'上海虹桥站': [poi('上海虹桥站')]});
  await resolver.resolve([{text: '上海虹桥站', city: '上海'}, {text: '张三家', city: '上海'}], 'acct-1');
  const again = await resolver.resolve([{text: '上海虹桥站', city: '上海'}, {text: '张三家', city: '上海'}], 'acct-1');
  expect(again.map((r: {status: string}) => r.status)).toEqual(['found', 'none']);
  expect(searchPlaces).toHaveBeenCalledTimes(2);
  const stored = await readFile(cacheFile, 'utf8');
  expect(stored).not.toContain('张三家');
  const reopened = createCalendarPlaceResolver({searchPlaces, cacheFile});
  await reopened.resolve([{text: '张三家', city: '上海'}], 'acct-1');
  expect(searchPlaces).toHaveBeenCalledTimes(2);
});

it('looks each distinct text up once per request', async () => {
  const {resolver, searchPlaces} = await setup({'公司': []});
  const results = await resolver.resolve([{text: '公司', city: '上海'}, {text: ' 公司 ', city: '上海'}]);
  expect(results.map((r: {text: string}) => r.text)).toEqual(['公司', ' 公司 ']);
  expect(searchPlaces).toHaveBeenCalledTimes(1);
});

it('rejects more than 40 items or text over 200 characters', async () => {
  const {resolver} = await setup({});
  await expect(resolver.resolve(Array.from({length: 41}, (_, i) => ({text: '地点' + i, city: '上海'})))).rejects.toThrow();
  await expect(resolver.resolve([{text: '长'.repeat(201), city: '上海'}])).rejects.toThrow();
  await expect(resolver.resolve([])).rejects.toThrow();
});

it('keeps one account\'s cached lookups away from another', async () => {
  const {resolver, searchPlaces} = await setup({'张三家': []});
  await resolver.resolve([{text: '张三家', city: '上海'}], 'acct-1');
  await resolver.resolve([{text: '张三家', city: '上海'}], 'acct-2');
  expect(searchPlaces).toHaveBeenCalledTimes(2);
});

it('does not cache lookups for guests', async () => {
  const {resolver, searchPlaces, cacheFile} = await setup({'张三家': []});
  await resolver.resolve([{text: '张三家', city: '上海'}]);
  await resolver.resolve([{text: '张三家', city: '上海'}]);
  expect(searchPlaces).toHaveBeenCalledTimes(2);
  await expect(readFile(cacheFile, 'utf8')).rejects.toThrow();
});

it('keys the cache with a private secret kept beside it, not a plain hash', async () => {
  const {resolver, cacheFile} = await setup({'张三家': []});
  await resolver.resolve([{text: '张三家', city: '上海'}], 'acct-1');
  const plain = createHash('sha256').update('张三家' + '\u0000' + '上海').digest('hex');
  expect(await readFile(cacheFile, 'utf8')).not.toContain(plain);
  const secret = await stat(cacheFile + '.key');
  expect(secret.mode & 0o777).toBe(0o600);
});

it('answers an online-meeting location as online without searching or caching it', async () => {
  const {resolver, searchPlaces, cacheFile} = await setup({});
  const texts = ['https://meet.google.com/abc-defg-hij', 'https://zoom.us/j/123456789', 'Zoom', '腾讯会议', '线上', '视频会议', '电话'];
  const results = await resolver.resolve(texts.map(text => ({text, city: '上海'})), 'account-1');
  expect(results.map((r: {status: string}) => r.status)).toEqual(texts.map(() => 'online'));
  expect(searchPlaces).not.toHaveBeenCalled();
  await expect(readFile(cacheFile, 'utf8')).rejects.toThrow();
});

it('still searches a street address that merely contains a meeting word', async () => {
  const {resolver, searchPlaces} = await setup({'电话路12号': [poi('电话路12号')]});
  const [result] = await resolver.resolve([{text: '电话路12号', city: '上海'}]);
  expect(searchPlaces).toHaveBeenCalledTimes(1);
  expect(result.status).toBe('found');
});

it('agrees with the browser on which locations are online', async () => {
  // @ts-expect-error Server ESM exercised directly.
  const {isOnlineLocation} = await import('../../server/calendar-places.mjs');
  const {classifyLocation} = await import('../lib/calendarPlaces');
  const samples = ['', '上海虹桥站', 'https://meet.google.com/x', 'zoom.us/j/1', 'Zoom', 'ZOOM', '线上', '视频会议', '电话', '电话路12号', '腾讯会议', 'meeting.tencent.com/dm/x', '飞书会议 feishu.cn/x', '深圳湾科技生态园'];
  for (const text of samples) expect([text, isOnlineLocation(text)]).toEqual([text, classifyLocation(text) === 'online']);
});

it('asks before placing an exact name in a different city or a partial address', async () => {
  const {resolver} = await setup({'会展中心': [poi('会展中心')], '人民路': [poi('营业部', '人民路88号')]});
  const result = await resolver.resolve([{text:'会展中心',city:'深圳'}, {text:'人民路',city:'上海'}]);
  expect(result.map((item: {status:string}) => item.status)).toEqual(['ambiguous','ambiguous']);
});

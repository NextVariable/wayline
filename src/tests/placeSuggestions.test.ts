import { afterEach, expect, it, vi } from "vitest";
import { cachedPlaceSuggestions, suggestPlaceCandidates } from "../lib/geoSearch";
import { cityCatalog } from "../data/cities";
import { normalizeAMapTips } from "../lib/amapSuggestions";
const city = cityCatalog.find(c => c.name === "上海")!;
const poi = {name:"测试会场",city:"上海",category:"business",isMatched:true,lat:31.23,lng:121.47,address:"测试路1号",coordinateSystem:"WGS84"};
afterEach(() => vi.unstubAllGlobals());
it("rejects input tips without real coordinates and preserves cross-city districts",()=>{
 const rows=normalizeAMapTips([{name:"苏州"},{name:"无坐标",location:[]},{name:"苏州会场",district:"江苏省苏州市工业园区",address:"会展路1号",location:{getLng:()=>120.6,getLat:()=>31.3}}],city);
 expect(rows).toHaveLength(1);expect(rows[0].city).toBe("苏州");expect(rows[0].lng).toBe(120.6);
});
it("uses a single POI suggestion request and converts provider coordinates", async () => {
  const fetcher=vi.fn(async (_url: string)=>new Response(JSON.stringify([poi,{...poi,lat:NaN}])));
  vi.stubGlobal("fetch",fetcher);
  const places=await suggestPlaceCandidates("测试一",city);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/suggest");
  expect(places).toHaveLength(1);
  expect(Math.abs(places[0].lng-poi.lng)).toBeGreaterThan(.001);
});
it("reuses completed suggestions but isolates city and location reference",async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify([poi])));vi.stubGlobal("fetch",fetcher);
  await suggestPlaceCandidates("缓存测试",city,{reference:{lat:31,lng:121}});
  expect(cachedPlaceSuggestions("缓存测试",city,{lat:31,lng:121})).toHaveLength(1);
  await suggestPlaceCandidates("缓存测试",city,{reference:{lat:31,lng:121}});
  expect(fetcher).toHaveBeenCalledTimes(1);
  await suggestPlaceCandidates("缓存测试",city,{reference:{lat:32,lng:121}});
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(cachedPlaceSuggestions("缓存测试",{...city,name:"广州"},{lat:31,lng:121})).toBeUndefined();
});
it("does not cache failures and permits retry without model lookup",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response("{}",{status:503})).mockResolvedValueOnce(new Response("[]"));vi.stubGlobal("fetch",fetcher);
  await expect(suggestPlaceCandidates("失败测试",city)).rejects.toThrow();
  expect(cachedPlaceSuggestions("失败测试",city)).toBeUndefined();
  expect(await suggestPlaceCandidates("失败测试",city)).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("passes cancellation through and never caches a cancelled response",async()=>{
  const abort=new AbortController();
  const fetcher=vi.fn(async (_url:unknown,init:RequestInit)=>{expect(init.signal).toBe(abort.signal);abort.abort();return new Response(JSON.stringify([poi]));});vi.stubGlobal("fetch",fetcher);
  await expect(suggestPlaceCandidates("取消测试",city,{signal:abort.signal})).rejects.toThrow();
  expect(cachedPlaceSuggestions("取消测试",city)).toBeUndefined();
});

import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Server ESM is exercised directly in Node.
import { isPublicAddress, readPublicPage } from "../../server/public-page.mjs";
// @ts-expect-error Server ESM is exercised directly in Node.
import { cacheTravelServices } from "../../server/research-cache.mjs";
describe("public research boundaries", () => {
  it.each(["127.0.0.1","10.0.0.2","192.168.0.1","169.254.169.254","172.16.0.1","100.64.0.1","0.0.0.0","::1","::ffff:127.0.0.1","fe80::1","fd00::1","2002:7f00:1::1","2002:c0a8:101::1","2001::1","2001:0:4136:e378::1","2001:db8::1"])("blocks private address %s", address => expect(isPublicAddress(address)).toBe(false));
  it("allows public unicast addresses", () => {expect(isPublicAddress("8.8.8.8")).toBe(true);expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);});
  it.each(["http://example.org", "https://user:pass@example.org", "https://example.org:8000", "https://127.0.0.1"])("rejects unsafe URL %s before contacting it", async url => {
    const requestImpl = vi.fn(); await expect(readPublicPage(url,{requestImpl})).rejects.toThrow(); expect(requestImpl).not.toHaveBeenCalled();
  });
  it("rejects a public hostname resolving to a private network", async () => {
    const requestImpl = vi.fn(); await expect(readPublicPage("https://example.org",{requestImpl,resolveHost:async()=>[{address:"192.168.1.1",family:4}]})).rejects.toThrow();expect(requestImpl).not.toHaveBeenCalled();
  });
});
describe("research continuation", () => {
  it("reuses successful queries when only notes change, invalidates coordinate changes and expiry", async () => {
    let time = 0; const route = vi.fn(async () => ({source:"amap",observedAt:time}));
    const service = cacheTravelServices({route},{now:()=>time,ttl:100});
    const body = {places:[{name:"A",city:"上海",lat:31,lng:121},{name:"B",city:"上海",lat:32,lng:121}]};
    await service.route(body); await service.route({...body,notes:"新增条件"}); expect(route).toHaveBeenCalledTimes(1);
    await service.route({places:[body.places[0],{...body.places[1],lng:122}]}); expect(route).toHaveBeenCalledTimes(2);
    time = 101; await service.route(body); expect(route).toHaveBeenCalledTimes(3);
  });
  it("retries failed providers instead of caching failure", async () => {
    const route = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue({source:"amap"});
    const service = cacheTravelServices({route}); await expect(service.route({places:[]})).rejects.toThrow(); await service.route({places:[]}); expect(route).toHaveBeenCalledTimes(2);
  });
});

// @ts-expect-error Server ESM boundary.
import { researchPublicEvents } from "../../server/public-research.mjs";
it("reads actual user-supplied event links, preserves source, and tolerates failure or malformed URLs", async () => {
  const result = await researchPublicEvents("会议 https://example.org/event",{readPage:async()=>"<title>公开活动</title><script>bad()</script><p>11月2日</p>"});
  expect(result[0]).toMatchObject({status:"retrieved",title:"公开活动",url:"https://example.org/event"});
  expect(result[0].excerpt).not.toContain("bad()");
  expect(await researchPublicEvents("https://")).toEqual([]);
  expect((await researchPublicEvents("https://example.org/event",{readPage:async()=>{throw new Error("down");}}))[0].status).toBe("unavailable");
});

// @ts-expect-error Server ESM boundary.
import { apiError } from "../../server/api-error.mjs";
it("distinguishes invalid input from unavailable providers and redacts credentials", () => {
  expect(apiError(new Error("出发日期无效"))).toMatchObject({status:400});
  expect(apiError(new Error("真实路线服务未配置"))).toMatchObject({status:503,error:"真实路线服务未配置"});
  expect(JSON.stringify(apiError(new Error("fetch https://provider/?key=secret")))).not.toContain("secret");
});
it('shares identical concurrent queries and retries after a shared failure',async()=>{
 let release!:(value:unknown)=>void;
 const route=vi.fn(()=>new Promise(resolve=>{release=resolve;}));
 const services=cacheTravelServices({route});const input={places:[]};
 const a=services.route(input),b=services.route(input);expect(route).toHaveBeenCalledOnce();
 release({source:'amap',observedAt:1});expect(await a).toEqual(await b);
 const failing=vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({source:'amap'});
 const retry=cacheTravelServices({route:failing});const failed=await Promise.allSettled([retry.route(input),retry.route(input)]);
 expect(failed.every(r=>r.status==='rejected')).toBe(true);await retry.route(input);expect(failing).toHaveBeenCalledTimes(2);
});

it("returns a generic message for raw provider errors and classifies oversized bodies",()=>{
  expect(apiError(new Error("No geocode result for QA private venue"))).toEqual({status:503,error:"查询暂时无法完成，请稍后重试"});
  expect(apiError(new Error("Request body too large")).status).toBe(413);
});

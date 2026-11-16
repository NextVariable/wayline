import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {vi.unstubAllGlobals();vi.unstubAllEnvs();vi.resetModules();});
it("does not treat an ordinary POI as a city, add static duplicates, or invent model coordinates", async () => {
  vi.stubEnv("VITE_TIANDITU_TOKEN","test-token"); vi.resetModules();
  const fetchMock = vi.fn(async () => ({ok:true,json:async()=>({pois:[{name:"大疆天空之城",lonlat:"113.9548,22.5848",address:"广东省深圳市南山区仙元路55号"}]})}));
  vi.stubGlobal("fetch",fetchMock);
  const {searchPlaceCandidates} = await import("../lib/geoSearch");
  const result = await searchPlaceCandidates("大疆天空之城",{name:"苏州",lat:31,lng:120,zoom:11});
  expect(result).toHaveLength(1); expect(result[0].city).toBe("深圳");
  expect(result[0].lat).not.toBe(22.5848); // Tianditu WGS84 converted exactly once at the boundary.
  const requests = fetchMock.mock.calls as unknown as [string][];
  expect(requests.every(([url]) => new URL(url,"http://test").pathname === "/v2/search")).toBe(true);
});
it("never imports a claimed model match after map verification fails",async()=>{
  vi.stubEnv("VITE_TIANDITU_TOKEN","test-token"); vi.resetModules();
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({pois:[]})})));
  const {resolveExtractedPlace} = await import("../lib/geoSearch");
  const result = await resolveExtractedPlace({name:"未确认地点",city:"上海",category:"business",source:"imported",isMatched:true,lat:31,lng:121,address:"模型猜测",reason:"已确认"});
  expect(result.isMatched).toBe(false);
});
it("does not merge a same-name branch merely because it shares a city", async () => {
  const {samePlace} = await import("../lib/placeIdentity");
  const {initialUserPlaces} = await import("./fixtures/userPlaces");
  const place = initialUserPlaces[0];
  expect(samePlace(place,{...place,id:"branch",address:"另一条街100号",lat:place.lat+.03})).toBe(false);
  expect(samePlace(place,{...place,id:"provider",lat:place.lat+.002})).toBe(true);
});
it("uses the administrative city instead of storing an entire province/city/district path", async () => {
  const {canonicalPoiCity} = await import("../lib/geoSearch");
  expect(canonicalPoiCity("广东省深圳市龙岗区")).toBe("深圳");
  expect(canonicalPoiCity("上海市闵行区")).toBe("上海");
  expect(canonicalPoiCity("沧州市黄骅市")).toBe("黄骅");
});

it("rejects provider placeholder names while preserving real English business names",async()=>{
 vi.stubEnv("VITE_TIANDITU_TOKEN","test-token");vi.resetModules();
 const names=['image','IMG','undefined','候选地点 1','Image Studio','深圳腾讯滨海大厦'];
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({pois:names.map(name=>({name,lonlat:'113.9548,22.5848',address:'广东省深圳市南山区'}))})})));
 const {searchPlaceCandidates}=await import('../lib/geoSearch');
 const results=await searchPlaceCandidates('腾讯滨海大厦',{name:'深圳',lat:22.5,lng:114,zoom:11});
 expect(results.map(p=>p.name).sort()).toEqual(['Image Studio','深圳腾讯滨海大厦'].sort());
});

for (const failure of ["network", "http", "provider"] as const) {
  it(`reports ${failure} outages instead of a successful empty public lookup`, async () => {
    vi.stubEnv("VITE_TIANDITU_TOKEN", "test-token"); vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (failure === "network") throw new Error("offline");
      return {ok: failure !== "http", json: async () => failure === "provider" ? {status:{infocode:1004}} : {}};
    }));
    const {searchPlaceCandidates} = await import("../lib/geoSearch");
    await expect(searchPlaceCandidates("深圳会展中心", {name:"深圳",lat:22.5,lng:114,zoom:11}, {aiFallback:false})).rejects.toThrow("地点搜索暂不可用");
  });
}

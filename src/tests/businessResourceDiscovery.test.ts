import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The server module runs directly in Node.
import { createCityResourceLookup } from "../../server/city-resources.mjs";

// @ts-expect-error Server catalog is shared with the Node runtime.
import { businessDirectory } from "../../server/business-centers.mjs";
import { cityCatalog, cityShortcuts } from "../data/cities";

const point = (name: string, typecode: string, city = "苏州市", id = name) => ({
  id, name, typecode, city, lat: 31.3, lng: 120.6, address: "示例地址", district: "苏州工业园区",
});

describe("city resource lookup", () => {
  it("requires a unique exact map match of the documented type for each business resource", async () => {
    const search = vi.fn(async ({ keyword }) => keyword === "高铁新城" ? [
      { ...point(keyword, "120300"), district: "相城区" },
      point(keyword, "120302"),
    ] : keyword === "苏州国际博览中心" ? [
      point(keyword, "140200"), point(keyword, "140200"),
      point(keyword + "停车场", "150904"), point(keyword, "140200", "无锡市", "wrong-city"),
    ] : [
      point(keyword, "120201"), point(keyword, "120100"),
      point("CBD家居", "120100"), point("某某总部基地", "120100"),
    ]);
    const lookup = createCityResourceLookup(search);
    const result = await lookup({ city: "苏州", category: "business" });
    expect(result.places.map((p: { name: string }) => p.name)).toEqual(["金鸡湖商务区", "苏州高铁新城", "苏州国际博览中心"]);
    expect(result.places[0].resourceEvidence).toMatchObject({ provider: "高德地图", officialUrl: expect.stringContaining("suzhou.gov.cn") });
    expect(search.mock.calls).toHaveLength(3);
    expect(search.mock.calls[0][0]).toMatchObject({ city: "苏州", cityLimit: true, types: "120100" });
  });

  it("leaves a business pin out when two provider IDs match or a city lacks documented destinations", async () => {
    const search = vi.fn(async ({ keyword, types }) => [point(keyword, types), point(keyword, types, "苏州市", "another")]);
    const lookup = createCityResourceLookup(search);
    expect(await lookup({ city: "苏州", category: "business" })).toEqual({ places: [], incomplete: false });
    search.mockClear();
    expect(await lookup({ city: "黄骅", category: "business" })).toEqual({ places: [], incomplete: false });
    expect(search).not.toHaveBeenCalled();
  });

  it("keeps principal passenger facilities and removes unrelated POIs, wrong cities and duplicate rows", async () => {
    const search = vi.fn(async ({ types }) => {
      if (types === "150200") return [
        point("苏州北站", "150200"), point("苏州北站", "150200", "苏州市", "second"),
        point("苏州北站(南进站口)", "150202"), point("苏州火车站汽车保养站", "150200"),
        point("货场站", "150200"),
        point("无锡站", "150200", "无锡市"), point("新区站", "150500"),
        { ...point("无坐标站", "150200"), lat: NaN },
      ];
      if (types === "150104") return [
        point("上海虹桥国际机场", "150104"), point("上海虹桥国际机场2号航站楼", "150104"), point("苏州通用机场", "150104"), point("上海金山水上机场", "150104"), point("北京八达岭机场", "150104"),
      ];
      return types === "150400" ? [point("苏州北广场汽车客运站", "150400"), point("汽车客运站售票处", "150401")] : [];
    });
    const lookup = createCityResourceLookup(search);
    const request = { city: "苏州", category: "transport" };
    const [result, duplicate] = await Promise.all([lookup(request), lookup(request)]);
    expect(result).toEqual(duplicate);
    expect(result.places.map((p: { name: string }) => p.name)).toEqual(["苏州北站"]);
    expect(search.mock.calls.some(([query]) => query.types.includes("150400"))).toBe(false);
    expect(search.mock.calls.filter(([query]) => query.types === "150200" && query.keyword === "")).toHaveLength(1);
  });

  it("looks up a missing principal railway station by its exact map alias", async () => {
    const name = "深圳机场站(T3)(城际站)";
    const search = vi.fn(async ({ keyword, types }) => keyword === name ? [
      point(name, "150200", "深圳市"),
      point("深圳机场北站(城际站)(暂停营业)", "150200", "深圳市"),
    ] : !keyword && types === "150200" ? [point("深圳北站", "150200", "深圳市")] : []);
    const result = await createCityResourceLookup(search)({ city: "深圳", category: "transport" });
    expect(result.places.map((p: { name: string }) => p.name)).toEqual(["深圳北站", "深圳机场站"]);
    expect(result.places[1].resourceEvidence.officialUrl).toContain("jtys.sz.gov.cn");
  });

  it("keeps the Daxing Airport railway station distinct from Beijing Daxing station", async () => {
    const search = vi.fn(async ({ types }) => types === "150200" ? [point("北京大兴站", types, "北京市")] : []);
    const result = await createCityResourceLookup(search)({ city: "北京", category: "transport" });
    expect(result.places.map((p: { name: string }) => p.name)).toEqual(["大兴机场站", "北京大兴站"]);
    expect(result.places[0].resourceEvidence).toMatchObject({
      provider: "Wikidata", officialUrl: expect.stringContaining("beijing.gov.cn"),
    });
  });

  it("includes every common city and makes every documented city selectable", () => {
    expect(cityShortcuts.every(city => businessDirectory.has(city.name))).toBe(true);
    for (const [city, entries] of businessDirectory) {
      expect(cityCatalog.some(candidate => candidate.name === city)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);
      for (const [, , , url] of entries) expect(new URL(url).protocol).toBe("https:");
    }
  });

  it("uses official evidence and local coordinates for Hong Kong and Macao when map search is unavailable", async () => {
    const search = vi.fn().mockRejectedValue(new Error("quota"));
    const lookup = createCityResourceLookup(search);
    for (const [city, venue, airport] of [
      ["香港", "中环商务区", "香港国际机场"],
      ["澳门", "南湾商务区 · 中国银行大厦", "澳门国际机场"],
    ]) {
      const business = await lookup({ city, category: "business" });
      const transport = await lookup({ city, category: "transport" });
      expect(business.places[0]).toMatchObject({ name: venue, city, resourceEvidence: { provider: "Wikidata", officialUrl: expect.stringMatching(/^https:/) } });
      expect(transport.places).toEqual(expect.arrayContaining([expect.objectContaining({ name: airport, city })]));
      expect(transport.incomplete).toBe(false);
      if (city === "澳门") {
        expect(transport.places.find((place: { name: string }) => place.name === airport)).toMatchObject({
          address: "氹仔伟龙马路客运大楼",
          resourceEvidence: { provider: "官方地图", officialUrl: "https://www.macau-airport.com/cn/contact-us" },
        });
      }
    }
    expect(search).not.toHaveBeenCalled();
  });

  it("finds the officially named airport serving a city across its administrative boundary", async () => {
    const name = "西安咸阳国际机场";
    const search = vi.fn(async ({ city, keyword }) => city === "咸阳" && keyword === name ? [
      point(name, "150104", "咸阳市"), point(name + "T5航站楼", "150104", "咸阳市"),
    ] : []);
    const lookup = createCityResourceLookup(search);
    const result = await lookup({ city: "西安", category: "transport" });
    expect(result.places).toEqual([expect.objectContaining({ name, city: "西安", address: "咸阳市 · 示例地址" })]);
  });

  it("separates a partial outage from an empty search, and retries after a total failure", async () => {
    const search = vi.fn().mockRejectedValue(new Error("offline"));
    const lookup = createCityResourceLookup(search);
    const request = { city: "苏州", category: "transport" };
    await expect(lookup(request)).rejects.toThrow("暂时无法加载");
    search.mockResolvedValueOnce([point("苏州站", "150200")]);
    const result = await lookup(request);
    expect(result.incomplete).toBe(true);
    expect(result.places[0].name).toBe("苏州站");
  });
});

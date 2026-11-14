import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
  cityKey,
  cityMatches,
  cityPickerGroups,
  uniqueCities,
  cityScopeNames,
  parseAdministrativeCities,
  parseAmapCities,
  searchAdministrativeCities,
} from "../lib/citySelection";
import { readCityView } from "../lib/useCityView";
import { cityCatalog, cityShortcuts } from "../data/cities";
const city = (name: string) => ({ name, lat: 31, lng: 121, zoom: 11 });
beforeEach(() => {
  vi.stubEnv("VITE_AMAP_KEY", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("explicit city scope", () => {
  it("shows only the explicitly selected cities and their saved aliases", () => {
    expect(cityScopeNames("selected", "深圳", ["深圳", "广州市", "上海"], ["广州", "深圳"]))
      .toEqual(["广州", "深圳", "广州市"]);
  });
  it("never expands the selected city when new city data arrives", () => {
    expect(cityScopeNames("current", "深圳", ["上海", "苏州"])).toEqual([
      "深圳",
    ]);
  });
  it("includes every known city only in all mode and keeps the reference city", () => {
    expect(cityScopeNames("all", "深圳", ["上海", "上海", "苏州"])).toEqual([
      "深圳",
      "上海",
      "苏州",
    ]);
  });
  it("has no empty selection and no duplicates", () => {
    expect(cityScopeNames("all", "深圳", [])).toEqual(["深圳"]);
    expect(cityScopeNames("current", "苏州", [])).toEqual(["苏州"]);
  });
});
describe("city discovery", () => {
  it("keeps known cities searchable without promoting them into default shortcuts", () => {
    const cities = [...cityCatalog, city("宁波")];
    const groups = cityPickerGroups(cities, cityShortcuts, []);

    expect(groups.preferred).toEqual([]);
    expect(groups.shortcuts.map(({ name }) => name)).toEqual([
      "北京", "上海", "广州", "深圳", "杭州", "苏州", "南京", "成都", "武汉", "西安", "重庆", "天津",
    ]);
    expect(cities.find((item) => cityMatches(item, "黄骅"))?.name).toBe("黄骅");
  });

  it("shows selected and saved cities once, ahead of common shortcuts", () => {
    const groups = cityPickerGroups([...cityCatalog, city("宁波")], cityShortcuts, [
      "宁波市", "上海市", "宁波", "未收录城市",
    ]);

    expect(groups.preferred.map(({ name }) => name)).toEqual(["宁波", "上海"]);
    expect(groups.shortcuts.map(({ name }) => name)).not.toContain("上海");
  });
  it.each(["深圳", "深圳市", " shenzhen ", "SHEN", "sz"])(
    "finds Shenzhen with %s",
    (query) => {
      expect(
        cityMatches(
          cityCatalog.find((c) => c.name === "深圳")!,
          query,
        ),
      ).toBe(true);
    },
  );
  it("keeps ambiguous initials as multiple choices", () => {
    expect(
      cityCatalog.filter((c) => cityMatches(c, "sz")).map((c) => c.name),
    ).toEqual(["深圳", "苏州"]);
  });
  it("ignores unrelated cities", () =>
    expect(cityMatches(city("深圳"), "南京")).toBe(false));
  it.each([" ", "市", "江苏省", "特别行政区"])(
    "does not turn %j into a match for every city",
    query => expect(cityCatalog.filter(city => cityMatches(city, query))).toEqual([]),
  );
  it("does not turn a venue query into its city or suppress administrative lookup", () => {
    expect(cityMatches(city("深圳"), "深圳湾")).toBe(false);
    expect(cityMatches(city("上海"), "上海虹桥站")).toBe(false);
    expect(cityMatches(city("苏州"), "苏州工业园区")).toBe(false);
    expect(cityMatches(city("深圳"), "广东省深圳市")).toBe(true);
  });
  it("normalizes optional city suffix", () =>
    expect(cityKey(" 苏州市 ")).toBe("苏州"));
  it("deduplicates catalog, saved data and city suffixes while preserving reliable first coordinates", () => {
    expect(
      uniqueCities([
        city("苏州"),
        { ...city("苏州市"), lat: 32 },
        city("深圳"),
      ]),
    ).toEqual([city("苏州"), city("深圳")]);
  });
  it("rejects invalid coordinates", () =>
    expect(uniqueCities([{ ...city("测试"), lat: NaN }])).toEqual([]));
});
describe("verified administrative search", () => {
  it("parses returned administrative points without inventing coordinates", () => {
    expect(
      parseAdministrativeCities({
        data: [{ name: "宁波市", point: { lon: "121.55", lat: "29.87" } }],
      }),
    ).toEqual([{ name: "宁波", lng: 121.55, lat: 29.87, zoom: 11 }]);
  });
  it("supports legacy district centers", () => {
    expect(
      parseAdministrativeCities({
        district: { name: "南京市", center: "118.79,32.06" },
      })[0]?.name,
    ).toBe("南京");
  });
  it.each([
    null,
    {},
    { data: [{ name: "未知城市" }] },
    { location: { lat: 30, lon: 120 } },
    { data: [{ name: "错误", point: { lon: 999, lat: 30 } }] },
    { data: [{ name: "错误", point: { lon: 0, lat: 0 } }] },
  ])("rejects missing, invalid or POI-only results: %j", (value) => {
    expect(parseAdministrativeCities(value)).toEqual([]);
  });
  it("returns ambiguous district choices instead of selecting the first", () => {
    expect(
      parseAdministrativeCities({
        data: [
          { name: "朝阳区", point: { lon: 116, lat: 39 } },
          { name: "朝阳市", point: { lon: 120, lat: 41 } },
        ],
      }),
    ).toHaveLength(2);
  });
  it("does not silently substitute a fallback when unavailable", async () => {
    vi.stubEnv("VITE_TIANDITU_TOKEN", "");
    await expect(
      searchAdministrativeCities("不存在", new AbortController().signal),
    ).rejects.toThrow();
  });
  it("passes cancellation through and exposes query errors", async () => {
    vi.stubEnv("VITE_TIANDITU_TOKEN", "test");
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    await expect(searchAdministrativeCities("宁波", signal)).rejects.toThrow();
    expect(fetchMock.mock.calls[0][1]).toEqual({ signal });
  });
});

describe("remembered city navigation", () => {
  it("restores a selected city set without silently broadening to all cities", () => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ activeCity: "深圳", scope: "selected", selectedCities: ["广州", "深圳", "广州"] }) });
    expect(readCityView("one")).toMatchObject({ activeCity: "深圳", scope: "selected", selectedCities: ["广州", "深圳"], restored: true });
  });
  it("does not keep a reference city outside the restored selection", () => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ activeCity: "上海", scope: "selected", selectedCities: ["广州", "深圳"] }) });
    expect(readCityView("one")).toMatchObject({ activeCity: "广州", scope: "selected" });
  });
  it.each([
    null,
    "broken",
    '{"activeCity":"","scope":"current"}',
    '{"activeCity":"上海","scope":"invalid"}',
  ])("recovers from missing or corrupt preferences: %s", (raw) => {
    vi.stubGlobal("localStorage", { getItem: () => raw });
    expect(readCityView("one")).toEqual({
      activeCity: "深圳",
      scope: "current",
      restored: false,
    });
  });
  it("restores explicit scope only from the requested local space", () => {
    const getItem = vi
      .fn()
      .mockReturnValue('{"activeCity":"苏州","scope":"all"}');
    vi.stubGlobal("localStorage", { getItem });
    expect(readCityView("two")).toEqual({
      activeCity: "苏州",
      scope: "all",
      restored: true,
    });
    expect(getItem).toHaveBeenCalledWith("whereto:city-view:two");
  });
  it("continues to work when browser storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readCityView("two").restored).toBe(false);
  });
  it("supports classic administrative coordinates", () => {
    expect(
      parseAdministrativeCities({
        data: [{ name: "宁波市", lnt: "121.55", lat: "29.87" }],
      })[0]?.name,
    ).toBe("宁波");
  });
  it("does not turn API authorization errors into an empty result", async () => {
    vi.stubEnv("VITE_TIANDITU_TOKEN", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: 301012, msg: "denied" }),
      }),
    );
    await expect(
      searchAdministrativeCities("宁波", new AbortController().signal),
    ).rejects.toThrow();
  });
});

it("accepts validated AMap districts but rejects POIs and missing centers", () => {
  expect(
    parseAmapCities({
      districtList: [
        { name: "宁波市", level: "city", center: { lng: 121.55, lat: 29.87 } },
      ],
    }),
  ).toEqual([{ name: "宁波", lat: 29.87, lng: 121.55, zoom: 11 }]);
  expect(
    parseAmapCities({
      districtList: [
        { name: "宁波站", level: "biz_area", center: { lng: 121, lat: 29 } },
        { name: "未知", level: "city" },
      ],
    }),
  ).toEqual([]);
});
it("does not offer a province as a city, while retaining direct municipalities", () => {
  expect(parseAmapCities({ districtList: [
    { name: "浙江省", level: "province", center: { lng: 120, lat: 30 } },
    { name: "北京市", level: "province", center: { lng: 116.4, lat: 39.9 } },
  ] }).map(city => city.name)).toEqual(["北京"]);
});

it("retains saved city suffix variants without adding unrelated cities", () => {
  expect(cityScopeNames("current", "上海", ["上海市", "苏州"])).toEqual([
    "上海",
    "上海市",
  ]);
});

it("folds historical district labels into their parent city without deleting stored records", () => {
  expect(cityKey("江苏省苏州市虎丘区")).toBe("苏州");
  expect(cityKey("沧州渤海新区")).toBe("沧州");
  expect(uniqueCities([city("苏州"), city("江苏省苏州市虎丘区")])).toEqual([
    city("苏州"),
  ]);
  expect(cityScopeNames("current", "苏州", ["江苏省苏州市虎丘区"])).toEqual([
    "苏州",
    "江苏省苏州市虎丘区",
  ]);
});

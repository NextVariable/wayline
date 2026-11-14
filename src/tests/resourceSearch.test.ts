import { afterEach, describe, expect, it, vi } from "vitest";
import { searchCitySystemPlaces } from "../lib/resourceSearch";

afterEach(() => vi.unstubAllGlobals());

describe("city resource response", () => {
  it("rejects old, cross-city and undocumented business results", async () => {
    const business = { id: "accepted", city: "苏州", category: "business", type: "system",
      resourceEvidence: { provider: "高德地图", officialUrl: "https://www.suzhou.gov.cn/example" } };
    const documented = { ...business, id: "official", resourceEvidence: { provider: "Wikidata",
      officialUrl: "https://www.suzhou.gov.cn/example", coordinateUrl: "https://www.wikidata.org/wiki/Q1" } };
    const fetch = vi.fn(async () => Response.json({ incomplete: true, places: [
      business, documented,
      { ...business, city: "上海" },
      { ...business, category: "transport" },
      { ...business, resourceEvidence: { provider: "高德地图" } },
      { ...business, resourceEvidence: { provider: "天地图" } },
    ] }));
    vi.stubGlobal("fetch", fetch);
    const { signal } = new AbortController();
    expect(await searchCitySystemPlaces("苏州", "business", signal)).toEqual({ places: [business, documented], incomplete: true });
    expect(fetch).toHaveBeenCalledWith("/api/resources", expect.objectContaining({ signal, body: '{"city":"苏州","category":"business"}' }));
  });
});

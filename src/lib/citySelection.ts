import type { City } from "../types/place";

export type CityScope = "current" | "all" | "selected";
const aliases: Record<string, string> = {
  北京: "beijing bj",
  上海: "shanghai sh",
  广州: "guangzhou gz",
  深圳: "shenzhen sz",
  杭州: "hangzhou hz",
  苏州: "suzhou sz",
  南京: "nanjing nj",
  成都: "chengdu cd",
  武汉: "wuhan wh",
  西安: "xian xa",
  重庆: "chongqing cq",
  天津: "tianjin tj",
  沧州: "cangzhou cz",
  黄骅: "huanghua hh",
  十堰: "shiyan sy",
  佛山: "foshan fs",
  珠海: "zhuhai zh",
  香港: "hongkong hk",
};
export function cityKey(name: string) {
  const trimmed = name
    .trim()
    .toLowerCase()
    .replace(/^.*?(?:省|自治区)/, "");
  const city = trimmed.match(/^(.+?)市/);
  if (city) return city[1];
  return (
    Object.keys(aliases).find((known) => trimmed.startsWith(known)) ??
    trimmed.replace(/市$/, "")
  );
}
export function cityMatches(city: City, query: string) {
  // Identity normalization accepts saved address-like names. Search must not:
  // "深圳湾" is a place query, not an exact match for "深圳".
  const key = query.trim().toLowerCase().replace(/\s/g, "")
    .replace(/^.*?(?:省|自治区)/, "").replace(/市$|特别行政区$/, "");
  if (!key) return false;
  return (
    cityKey(city.name).includes(key) ||
    (aliases[cityKey(city.name)] ?? "")
      .split(" ")
      .some((alias) => alias.startsWith(key))
  );
}
export function uniqueCities(items: City[]) {
  const seen = new Set<string>();
  return items.filter((city) => {
    const key = cityKey(city.name);
    if (
      !key ||
      seen.has(key) ||
      !Number.isFinite(city.lat) ||
      !Number.isFinite(city.lng)
    )
      return false;
    seen.add(key);
    return true;
  });
}
export function cityPickerGroups(cities: City[], shortcuts: City[], preferredNames: string[]) {
  const byName = new Map(uniqueCities(cities).map(city => [cityKey(city.name), city]));
  const preferred = uniqueCities(preferredNames.flatMap(name => {
    const city = byName.get(cityKey(name));
    return city ? [city] : [];
  }));
  const preferredKeys = new Set(preferred.map(city => cityKey(city.name)));
  return { preferred, shortcuts: shortcuts.filter(city => !preferredKeys.has(cityKey(city.name))) };
}
export function cityScopeNames(
  scope: CityScope,
  active: string,
  names: string[],
  selection: string[] = [],
) {
  if (scope === "selected") {
    const chosen = selection.length ? selection : [active];
    const keys = new Set(chosen.map(cityKey));
    return Array.from(new Set([...chosen, ...names.filter(name => keys.has(cityKey(name)))]));
  }
  return scope === "current"
    ? Array.from(
        new Set([
          active,
          ...names.filter((name) => cityKey(name) === cityKey(active)),
        ]),
      )
    : Array.from(new Set([active, ...names]));
}
// Administrative results only: never turn a POI or a fallback coordinate into a city.
export function parseAdministrativeCities(payload: unknown): City[] {
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const raw = data.data ?? data.district;
  const nodes = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? [raw]
      : [];
  return uniqueCities(
    nodes.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const node = value as Record<string, unknown>;
      if (typeof node.name !== "string" || !node.name.trim()) return [];
      const point = node.point as { lon?: unknown; lat?: unknown } | undefined;
      const center = node.center ?? node.lonlat ?? node.latlon;
      const pair = typeof center === "string" ? center.split(",") : [];
      const lng = Number(
        point?.lon ?? node.lon ?? node.lng ?? node.lnt ?? pair[0],
      );
      const lat = Number(point?.lat ?? node.lat ?? pair[1]);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180 ||
        (lat === 0 && lng === 0)
      )
        return [];
      return [{ name: node.name.replace(/市$/, ""), lat, lng, zoom: 11 }];
    }),
  );
}
export function parseAmapCities(payload: {
  districtList?: Array<{
    name: string;
    level?: string;
    center?: { lng?: number; lat?: number };
  }>;
}) {
  return uniqueCities(
    (payload.districtList ?? []).flatMap((node) => {
      const lat = Number(node.center?.lat),
        lng = Number(node.center?.lng);
      if (
        !node.name ||
        !["city", "district", "province"].includes(node.level ?? "") ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      )
        return [];
      return [
        {
          name: node.name.replace(/市$|特别行政区$/g, ""),
          lat,
          lng,
          zoom: node.level === "district" ? 12 : 11,
        },
      ];
    }),
  );
}
async function searchAmapCities(
  query: string,
  signal: AbortSignal,
): Promise<City[]> {
  const key = import.meta.env.VITE_AMAP_KEY as string | undefined;
  if (!key) throw new Error("城市查询暂不可用");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value?: City[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      if (value) resolve(value);
      else reject(new Error("城市查询暂不可用"));
    };
    const cancel = () => finish();
    const timer = setTimeout(cancel, 3500);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    import("@amap/amap-jsapi-loader")
      .then(({ default: loader }) =>
        loader.load({ key, version: "2.0", plugins: ["AMap.DistrictSearch"] }),
      )
      .then((AMap) => {
        if (settled) return;
        const search = new AMap.DistrictSearch({
          level: "city",
          subdistrict: 0,
          extensions: "base",
          showbiz: false,
        });
        search.search(
          query.trim(),
          (status: string, result: Parameters<typeof parseAmapCities>[0]) => {
            if (status === "complete") finish(parseAmapCities(result));
            else if (status === "no_data") finish([]);
            else finish();
          },
        );
      })
      .catch(cancel);
  });
}
export async function searchAdministrativeCities(
  query: string,
  signal: AbortSignal,
): Promise<City[]> {
  try {
    return await searchAmapCities(query, signal);
  } catch {
    if (signal.aborted) throw new Error("已取消查询");
  }
  const token = import.meta.env.VITE_TIANDITU_TOKEN as string | undefined;
  if (!token) throw new Error("城市查询暂不可用");
  const params = new URLSearchParams({
    postStr: JSON.stringify({
      searchWord: query.trim(),
      searchType: "1",
      needSubInfo: "false",
      needAll: "false",
      needPolygon: "false",
      needPre: "false",
    }),
    tk: token,
  });
  const response = await fetch(
    "https://api.tianditu.gov.cn/administrative?" + params,
    { signal },
  );
  if (!response.ok) throw new Error("城市查询失败");
  const payload = await response.json();
  if (payload.code && !["0", "100", "200"].includes(String(payload.code)))
    throw new Error("城市查询服务暂不可用");
  return parseAdministrativeCities(payload);
}

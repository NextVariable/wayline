import type { GeoSource } from "./footprintRecorder";
export interface CurrentPosition {
  lat: number;
  lng: number;
  accuracy: number;
  time: number;
}
export interface LocatedCity {
  name: string;
  address: string;
}
export interface CurrentLocationState {
  status: "idle" | "loading" | "success" | "error";
  position: CurrentPosition | null;
  city: LocatedCity | null;
  message: string;
  requestId: number;
  startedAt: number;
  source: "auto" | "manual";
}
interface Options {
  geo?: GeoSource;
  resolveCity: (position: CurrentPosition) => Promise<LocatedCity | null>;
  now?: () => number;
}
export class CurrentLocationController {
  private state: CurrentLocationState = {
    status: "idle",
    position: null,
    city: null,
    message: "",
    requestId: 0,
    startedAt: 0,
    source: "auto",
  };
  private listeners = new Set<() => void>();
  private watch: number | null = null;
  private generation = 0;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private options: Options) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private update(patch: Partial<CurrentLocationState>) {
    this.state = { ...this.state, ...patch };
    if (!this.disposed) this.listeners.forEach((fn) => fn());
  }
  private clear() {
    if (this.watch !== null) {
      this.options.geo?.clearWatch(this.watch);
      this.watch = null;
    }
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
  request = (source: "auto" | "manual" = "auto"): number | undefined => {
    if (this.disposed || this.state.status === "loading") return undefined;
    const now = this.options.now ?? Date.now;
    this.clear();
    const generation = ++this.generation;
    this.update({
      status: "loading",
      position: this.state.position,
      city: null,
      message: "正在定位…",
      requestId: generation,
      startedAt: now(),
      source,
    });
    const fail = (message: string) => {
      if (this.disposed || generation !== this.generation) return;
      this.generation++;
      this.clear();
      this.update({ status: "error", message });
    };
    if (!this.options.geo) {
      fail("当前浏览器无法定位，请更换浏览器重试。");
      return generation;
    }
    let received = false;
    this.timer = setTimeout(() => {
      if (!received) fail("定位超时，请检查系统定位后重试。");
    }, 22000);
    try {
      const watch = this.options.geo.watchPosition(
        (position) => {
          if (this.disposed || received || generation !== this.generation)
            return;
          const raw = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            time: position.timestamp,
          };
          if (
            ![raw.lat, raw.lng, raw.accuracy, raw.time].every(
              Number.isFinite,
            ) ||
            Math.abs(raw.lat) > 90 ||
            Math.abs(raw.lng) > 180 ||
            raw.accuracy < 0 ||
            raw.accuracy > 50000 ||
            raw.time > now() + 10000 ||
            now() - raw.time > 60000
          ) {
            this.update({ message: "定位精度不足，等待更准确的位置…" });
            return;
          }
          received = true;
          this.clear();
          this.update({
            status: "success",
            position: raw,
            city: null,
            message: raw.accuracy > 1000
              ? `已获得大致位置，精度约 ${Math.round(raw.accuracy / 1000)} 公里`
              : "已获得当前位置",
          });
          // A second deadline bounds city lookup even if a provider never responds.
          this.timer = setTimeout(() => complete(null), 9000);
          const complete = (city: LocatedCity | null) => {
            if (this.disposed || generation !== this.generation) return;
            this.generation++;
            this.clear();
            this.update({
              status: "success",
              position: raw,
              city,
              message: city
                ? "已定位到" + city.name + (raw.accuracy > 1000 ? "附近（大致位置）" : "")
                : raw.accuracy > 1000
                  ? `已获得大致位置，精度约 ${Math.round(raw.accuracy / 1000)} 公里，暂未识别城市`
                  : "已获得位置，暂未识别城市",
            });
          };
          void Promise.resolve()
            .then(() => this.options.resolveCity(raw))
            .then(complete, () => complete(null));
        },
        (error) => {
          if (received) return;
          fail(
            error.code === 1
              ? "请允许访问位置后重试。"
              : error.code === 2
                ? "暂时无法定位，请稍后重试。"
                : "定位超时，请重试。",
          );
        },
        { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 },
      );
      if (received || generation !== this.generation)
        this.options.geo.clearWatch(watch);
      else this.watch = watch;
    } catch {
      fail("无法定位，请开启定位权限后重试。");
      return generation;
    }
    return generation;
  };
  revoke = () => {
    if (this.disposed) return;
    this.generation++;
    this.clear();
    this.update({
      requestId: this.generation,
      status: "error",
      position: null,
      city: null,
      message: "定位权限已关闭，请重新允许访问位置。",
    });
  };
  dispose() {
    this.disposed = true;
    this.generation++;
    this.clear();
    this.listeners.clear();
  }
}
export function normalizeLocatedCity(data: unknown): LocatedCity | null {
  const result = (
    data as {
      result?: {
        addressComponent?: Record<string, unknown>;
        formatted_address?: unknown;
      };
    } | null
  )?.result;
  if (!result) return null;
  const component = result.addressComponent ?? {};
  const text = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  let name = text(component.city);
  const province = text(component.province);
  if (
    (!name || name === "市辖区") &&
    /^(北京市|上海市|天津市|重庆市|香港特别行政区|澳门特别行政区)$/.test(
      province,
    )
  )
    name = province;
  if (
    !name ||
    name.length > 60 ||
    /^(市辖区|省直辖县级行政区划|自治区直辖县级行政区划)$/.test(name)
  )
    return null;
  name = name.replace(/特别行政区$|市$/g, "");
  return { name, address: text(result.formatted_address) };
}

export function shouldApplyLocation(
  explicit: boolean,
  overlay: unknown,
  selectedPlace: unknown,
  manualCityAt: number,
  startedAt: number,
) {
  return explicit || (!overlay && !selectedPlace && manualCityAt <= startedAt);
}

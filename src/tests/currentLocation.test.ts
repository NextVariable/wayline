import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  CurrentLocationController,
  normalizeLocatedCity,
  shouldApplyLocation,
} from "../lib/currentLocation";
const now = 1700000000000;
function setup(
  options: {
    geo?: boolean;
    resolve?: () => Promise<{ name: string; address: string } | null>;
  } = {},
) {
  let success: PositionCallback | undefined,
    error: PositionErrorCallback | null | undefined;
  const geo = {
    watchPosition: vi.fn(
      (s: PositionCallback, e?: PositionErrorCallback | null) => {
        success = s;
        error = e;
        return 0;
      },
    ),
    clearWatch: vi.fn(),
  };
  const resolve = vi.fn(
    options.resolve ??
      (async () => ({ name: "苏州", address: "江苏省苏州市" })),
  );
  const controller = new CurrentLocationController({
    geo: options.geo === false ? undefined : geo,
    resolveCity: resolve,
    now: () => now,
  });
  const fix = (patch: Partial<Record<string, number>> = {}) =>
    success?.({
      timestamp: patch.time ?? now,
      coords: {
        latitude: patch.lat ?? 31.3,
        longitude: patch.lng ?? 120.6,
        accuracy: patch.accuracy ?? 12,
      },
    } as GeolocationPosition);
  const fail = (code: number) =>
    error?.({
      code,
      message: "error",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    });
  return { controller, geo, resolve, fix, fail, late: () => success };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("one-shot automatic location", () => {
  it("does not acquire before requested", () => {
    const s = setup();
    expect(s.geo.watchPosition).not.toHaveBeenCalled();
    s.controller.dispose();
  });
  it("acquires and recognizes the actual city", async () => {
    const s = setup();
    s.controller.request();
    s.fix();
    await settle();
    expect(s.controller.getSnapshot().status).toBe("success");
    expect(s.controller.getSnapshot().city?.name).toBe("苏州");
    expect(s.controller.getSnapshot().position?.lng).toBe(120.6);
    expect(s.geo.clearWatch).toHaveBeenCalledWith(0);
    s.controller.dispose();
  });
  it("does not request twice while awaiting permission", () => {
    const s = setup();
    s.controller.request();
    s.controller.request();
    expect(s.geo.watchPosition).toHaveBeenCalledTimes(1);
    s.controller.dispose();
  });
  it.each([1, 2, 3])(
    "reports location failure %i without a fabricated position",
    (code) => {
      const s = setup();
      s.controller.request();
      s.fail(code);
      expect(s.controller.getSnapshot().status).toBe("error");
      expect(s.controller.getSnapshot().position).toBeNull();
      expect(s.resolve).not.toHaveBeenCalled();
      s.controller.dispose();
    },
  );
  it("supports retry after denial", async () => {
    const s = setup();
    s.controller.request();
    s.fail(1);
    s.controller.request();
    s.fix();
    await settle();
    expect(s.controller.getSnapshot().status).toBe("success");
    expect(s.geo.watchPosition).toHaveBeenCalledTimes(2);
    s.controller.dispose();
  });
  it("reports unsupported or insecure contexts", () => {
    const s = setup({ geo: false });
    s.controller.request();
    expect(s.controller.getSnapshot().status).toBe("error");
    expect(s.controller.getSnapshot().message).toContain("当前浏览器无法定位");
  });
  it.each([
    { lat: NaN },
    { lat: 91 },
    { lng: 181 },
    { accuracy: 50001 },
    { accuracy: -1 },
    { time: now - 60001 },
    { time: now + 10001 },
  ])("rejects unreliable fix %j", (patch) => {
    const s = setup();
    s.controller.request();
    s.fix(patch);
    expect(s.resolve).not.toHaveBeenCalled();
    expect(s.controller.getSnapshot().position).toBeNull();
    s.controller.dispose();
  });
  it("times out if the browser never calls back", () => {
    const s = setup();
    s.controller.request();
    vi.advanceTimersByTime(22000);
    expect(s.controller.getSnapshot().status).toBe("error");
    expect(s.geo.clearWatch).toHaveBeenCalled();
  });
  it("keeps valid GPS when city lookup fails", async () => {
    const s = setup({
      resolve: async () => {
        throw Error("offline");
      },
    });
    s.controller.request();
    s.fix();
    await settle();
    expect(s.controller.getSnapshot().status).toBe("success");
    expect(s.controller.getSnapshot().position).not.toBeNull();
    expect(s.controller.getSnapshot().city).toBeNull();
    s.controller.dispose();
  });
  it("bounds a city provider that never resolves", async () => {
    const s = setup({ resolve: () => new Promise(() => {}) });
    s.controller.request();
    s.fix();
    vi.advanceTimersByTime(9000);
    expect(s.controller.getSnapshot().status).toBe("success");
    expect(s.controller.getSnapshot().city).toBeNull();
    s.controller.dispose();
  });
  it("shows coordinates immediately while city recognition is still pending", () => {
    const s = setup({ resolve: () => new Promise(() => {}) });
    s.controller.request();
    s.fix();
    expect(s.controller.getSnapshot()).toMatchObject({ status: "success", position: { lat: 31.3, lng: 120.6 }, city: null });
    s.controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("accepts an honest coarse desktop fix instead of discarding it", async () => {
    const s = setup();
    s.controller.request();
    s.fix({ accuracy: 5000 });
    expect(s.controller.getSnapshot().position?.accuracy).toBe(5000);
    expect(s.controller.getSnapshot().message).toContain("大致位置");
    await settle();
    expect(s.controller.getSnapshot().message).toContain("大致位置");
    s.controller.dispose();
  });
  it("keeps the last known fix when a fresh request fails", async () => {
    const s = setup();
    s.controller.request(); s.fix(); await settle();
    s.controller.request(); s.fail(2);
    expect(s.controller.getSnapshot()).toMatchObject({ status: "error", position: { time: now } });
    s.controller.dispose();
  });
  it("allows retry during city lookup and ignores the older city response", async () => {
    let finish: ((value: { name: string; address: string }) => void) | undefined;
    const s = setup({ resolve: () => new Promise(resolve => { finish = resolve; }) });
    s.controller.request(); s.fix(); await settle();
    s.controller.request();
    finish?.({ name: "旧城市", address: "旧地址" }); await settle();
    expect(s.controller.getSnapshot().status).toBe("loading");
    expect(s.controller.getSnapshot().city).toBeNull();
    s.controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not let late callbacks overwrite a newer request", async () => {
    const s = setup();
    s.controller.request();
    const old = s.late();
    s.fail(1);
    s.controller.request();
    old?.({
      timestamp: now,
      coords: { latitude: 1, longitude: 1, accuracy: 1 },
    } as GeolocationPosition);
    expect(s.resolve).not.toHaveBeenCalled();
    s.fix();
    await settle();
    expect(s.controller.getSnapshot().position?.lat).toBe(31.3);
    s.controller.dispose();
  });
  it("removes position after permission revocation", async () => {
    const s = setup();
    s.controller.request();
    s.fix();
    await settle();
    s.controller.revoke();
    expect(s.controller.getSnapshot().position).toBeNull();
    expect(s.controller.getSnapshot().city).toBeNull();
    expect(s.controller.getSnapshot().status).toBe("error");
    s.controller.dispose();
  });
  it("ignores callbacks after unmount and clears timers", async () => {
    const s = setup();
    s.controller.request();
    s.controller.dispose();
    s.fix();
    await settle();
    expect(s.resolve).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stops location sampling after first usable fix", async () => {
    const s = setup();
    s.controller.request();
    s.fix();
    s.fix({ lat: 32 });
    await settle();
    expect(s.resolve).toHaveBeenCalledTimes(1);
    expect(s.controller.getSnapshot().position?.lat).toBe(31.3);
    s.controller.dispose();
  });
});
describe("city recognition", () => {
  it("normalizes a prefecture city", () =>
    expect(
      normalizeLocatedCity({
        result: {
          addressComponent: { city: "苏州市" },
          formatted_address: "江苏省苏州市",
        },
      }),
    ).toEqual({ name: "苏州", address: "江苏省苏州市" }));
  it("handles direct municipalities", () =>
    expect(
      normalizeLocatedCity({
        result: { addressComponent: { city: "市辖区", province: "北京市" } },
      })?.name,
    ).toBe("北京"));
  it("handles Hong Kong", () =>
    expect(
      normalizeLocatedCity({
        result: { addressComponent: { province: "香港特别行政区" } },
      })?.name,
    ).toBe("香港"));
  it.each([
    null,
    {},
    { result: {} },
    { result: { addressComponent: { city: 123 } } },
    { result: { addressComponent: { city: "市辖区", province: "江苏省" } } },
  ])("does not invent a city for %j", (input) =>
    expect(normalizeLocatedCity(input)).toBeNull(),
  );
});
describe("camera intent", () => {
  it("allows initial automatic positioning", () =>
    expect(shouldApplyLocation(false, null, null, 0, 100)).toBe(true));
  it("preserves a manual city choice made while GPS was pending", () =>
    expect(shouldApplyLocation(false, null, null, 200, 100)).toBe(false));
  it("does not interrupt an open place", () =>
    expect(shouldApplyLocation(false, null, {}, 0, 100)).toBe(false));
  it("does not interrupt a trip or footprint view", () =>
    expect(shouldApplyLocation(false, "footprints", null, 0, 100)).toBe(false));
  it("honors an explicit locate button", () =>
    expect(shouldApplyLocation(true, "planner", {}, 200, 100)).toBe(true));
});

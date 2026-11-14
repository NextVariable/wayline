import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { FootprintRecorder, type GeoSource } from "../lib/footprintRecorder";
import type { FootprintStore } from "../lib/footprintStore";
import type { FootprintData, FootprintTrack } from "../lib/footprints";
function setup(
  options: {
    geo?: boolean;
    initial?: FootprintData;
    fail?: boolean;
    lock?: boolean;
  } = {},
) {
  let now = 1700000000000;
  let id = 0;
  let success: PositionCallback | undefined;
  let error: PositionErrorCallback | null | undefined;
  const data: FootprintData = structuredClone(
    options.initial ?? { tracks: [], visits: [] },
  );
  let fail = options.fail ?? false;
  const store: FootprintStore = {
    load: vi.fn(async () => structuredClone(data)),
    saveTrack: vi.fn(async (t) => {
      if (fail) throw Error("quota");
      data.tracks = [
        ...data.tracks.filter((e) => e.id !== t.id),
        structuredClone(t),
      ];
    }),
    saveVisit: vi.fn(async (v) => {
      if (fail) throw Error("quota");
      data.visits = [
        ...data.visits.filter((e) => e.id !== v.id),
        structuredClone(v),
      ];
    }),
    importData: vi.fn(async (d: FootprintData) => {
      const tracks = d.tracks.filter(
        (t) => !data.tracks.some((e) => e.id === t.id),
      );
      data.tracks.push(...tracks);
      return { tracks, visits: [] };
    }),
    close: vi.fn(),
  };
  const geo: GeoSource = {
    watchPosition: vi.fn((s, e) => {
      success = s;
      error = e;
      return 0;
    }),
    clearWatch: vi.fn(),
  };
  const release = vi.fn();
  const recorder = new FootprintRecorder({
    store,
    geo: options.geo === false ? undefined : geo,
    now: () => now,
    id: () => "t" + ++id,
    acquire: async () => (options.lock === false ? null : release),
  });
  const fix = (lng = 114, accuracy = 10, dt = 1000) => {
    now += dt;
    success?.({
      timestamp: now,
      coords: {
        latitude: 22.5,
        longitude: lng,
        accuracy,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      },
      toJSON: () => ({}),
    });
  };
  const failGeo = (code: number) =>
    error?.({
      code,
      message: "denied",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    });
  return {
    recorder,
    geo,
    store,
    data,
    fix,
    failGeo,
    release,
    advance: (ms: number) => {
      now += ms;
    },
    failSave: (value: boolean) => {
      fail = value;
    },
    late: () => success,
  };
}
describe("recording lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("never starts GPS while loading history", async () => {
    const s = setup();
    await s.recorder.load();
    expect(s.geo.watchPosition).not.toHaveBeenCalled();
  });
  it("starts only after initial record is durable", async () => {
    const s = setup();
    await s.recorder.start();
    expect(s.store.saveTrack).toHaveBeenCalled();
    expect(s.geo.watchPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    expect(s.recorder.getSnapshot().tracks[0].points).toHaveLength(0);
  });
  it("saves accepted fixes with original coordinates", async () => {
    const s = setup();
    await s.recorder.start();
    s.fix();
    s.fix(114.001);
    await s.recorder.flush();
    expect(s.data.tracks[0].points).toHaveLength(2);
    expect(s.data.tracks[0].points[0].lng).toBe(114);
  });
  it("does not launch a second watch from double click", async () => {
    const s = setup();
    await Promise.all([s.recorder.start(), s.recorder.start()]);
    expect(s.geo.watchPosition).toHaveBeenCalledTimes(1);
  });
  it("clears watch id zero on pause", async () => {
    const s = setup();
    await s.recorder.start();
    s.recorder.pause();
    expect(s.geo.clearWatch).toHaveBeenCalledWith(0);
    expect(s.release).toHaveBeenCalledOnce();
  });
  it("ignores late fixes from a cleared watcher", async () => {
    const s = setup();
    await s.recorder.start();
    const old = s.late();
    s.recorder.pause();
    old?.({
      timestamp: 1700000001000,
      coords: { latitude: 22.5, longitude: 114, accuracy: 10 },
    } as GeolocationPosition);
    expect(s.recorder.getSnapshot().tracks[0].points).toHaveLength(0);
  });
  it("resumes in a separate segment", async () => {
    const s = setup();
    await s.recorder.start();
    s.fix();
    s.recorder.pause();
    await s.recorder.start("t1");
    s.fix(114.02);
    expect(
      s.recorder.getSnapshot().tracks[0].points.map((p) => p.segment),
    ).toEqual([0, 1]);
  });
  it("prevents starting another session before finishing paused one", async () => {
    const s = setup();
    await s.recorder.start();
    s.recorder.pause();
    await s.recorder.start();
    expect(s.recorder.getSnapshot().tracks).toHaveLength(1);
    expect(s.recorder.getSnapshot().message).toContain("先结束");
  });
  it("finishes and allows a fresh session", async () => {
    const s = setup();
    await s.recorder.start();
    s.fix();
    await s.recorder.finish();
    await s.recorder.start();
    expect(s.recorder.getSnapshot().tracks).toHaveLength(2);
    expect(
      s.recorder.getSnapshot().tracks.find((t) => t.id === "t1")?.endedAt,
    ).not.toBeNull();
  });
  it("does not announce completion or start a new session before the final write", async () => {
    const s = setup();
    await s.recorder.start();
    let release!: () => void;
    const original = s.store.saveTrack;
    vi.mocked(s.store.saveTrack).mockImplementationOnce(track => new Promise<void>(resolve => {
      release = () => { void original(track).then(resolve); };
    }));
    const finished = s.recorder.finish();
    await Promise.resolve();
    expect(s.recorder.getSnapshot().busy).toBe(true);
    expect(s.recorder.getSnapshot().message).toBe("正在保存记录…");
    await s.recorder.start();
    expect(s.recorder.getSnapshot().tracks).toHaveLength(1);
    release();
    await finished;
    expect(s.data.tracks[0].status).toBe("completed");
    expect(s.recorder.getSnapshot().busy).toBe(false);
    expect(s.recorder.getSnapshot().message).toBe("记录已结束");
  });
  it("keeps a final write failure visible instead of reporting completion", async () => {
    const s = setup();
    await s.recorder.start();
    s.failSave(true);
    expect(await s.recorder.finish()).toBe(false);
    expect(s.recorder.getSnapshot().storageError).toBe(true);
    expect(s.recorder.getSnapshot().message).toContain("保存失败");
  });
  it.each([1, 2, 3])("interrupts on location error %i", async (code) => {
    const s = setup();
    await s.recorder.start();
    s.failGeo(code);
    await s.recorder.flush();
    expect(s.data.tracks[0].status).toBe("interrupted");
    expect(s.geo.clearWatch).toHaveBeenCalled();
    expect(s.recorder.getSnapshot().message).not.toBe("");
  });
  it("interrupts if no valid fix arrives", async () => {
    const s = setup();
    await s.recorder.start();
    vi.advanceTimersByTime(35000);
    expect(s.recorder.getSnapshot().tracks[0].status).toBe("interrupted");
  });
  it("a stationary accurate fix keeps the session alive without duplicate points", async () => {
    const s = setup();
    await s.recorder.start();
    s.fix();
    vi.advanceTimersByTime(30000);
    s.fix(114, 10, 30000);
    vi.advanceTimersByTime(10000);
    expect(s.recorder.getSnapshot().tracks[0].status).toBe("recording");
    expect(s.recorder.getSnapshot().tracks[0].points).toHaveLength(1);
    s.recorder.dispose();
  });
  it("weak fixes are not stored and cannot fake a healthy session", async () => {
    const s = setup();
    await s.recorder.start();
    s.fix(114, 500);
    expect(s.recorder.getSnapshot().message).toContain("精度");
    vi.advanceTimersByTime(35000);
    expect(s.recorder.getSnapshot().tracks[0].status).toBe("interrupted");
  });
  it("missing geolocation produces useful error without creating track", async () => {
    const s = setup({ geo: false });
    await s.recorder.start();
    expect(s.recorder.getSnapshot().tracks).toHaveLength(0);
    expect(s.recorder.getSnapshot().message).toContain("不支持");
  });
  it("rejects competing browser-tab lock", async () => {
    const s = setup({ lock: false });
    await s.recorder.start();
    expect(s.geo.watchPosition).not.toHaveBeenCalled();
    expect(s.recorder.getSnapshot().message).toContain("另一个页面");
  });
  it("cancels an in-flight start on page interruption", async () => {
    const s = setup();
    const pending = s.recorder.start();
    s.recorder.pause("hidden", true);
    await pending;
    expect(s.geo.watchPosition).not.toHaveBeenCalled();
    expect(s.recorder.getSnapshot().busy).toBe(false);
  });
  it("does not delete the active session", async () => {
    const s = setup();
    await s.recorder.start();
    expect(await s.recorder.setDeleted("track", "t1", true)).toBe(false);
  });
  it("supports reversible deletion", async () => {
    const s = setup();
    await s.recorder.start();
    s.fix();
    s.recorder.finish();
    expect(await s.recorder.setDeleted("track", "t1", true)).toBe(true);
    expect(s.recorder.getSnapshot().tracks[0].deletedAt).toBeDefined();
    await s.recorder.setDeleted("track", "t1", false);
    expect(s.recorder.getSnapshot().tracks[0].points).toHaveLength(1);
    expect(s.recorder.getSnapshot().tracks[0].deletedAt).toBeUndefined();
  });
  it("flushes before closing the store and ignores future callbacks", async () => {
    const s = setup();
    await s.recorder.start();
    s.fix();
    s.recorder.dispose();
    s.fix(114.001);
    await s.recorder.flush();
    await Promise.resolve();
    expect(s.data.tracks[0].points).toHaveLength(1);
    expect(s.data.tracks[0].status).toBe("interrupted");
    expect(s.store.close).toHaveBeenCalled();
  });
});
describe("persistence failure and recovery", () => {
  it("never watches if initial save failed", async () => {
    const s = setup({ fail: true });
    await s.recorder.start();
    expect(s.geo.watchPosition).not.toHaveBeenCalled();
    expect(s.recorder.getSnapshot().storageError).toBe(true);
  });
  it("retains unsaved fixes, stops acquisition and permits retry", async () => {
    const s = setup();
    await s.recorder.start();
    s.failSave(true);
    s.fix();
    await s.recorder.flush();
    expect(s.recorder.getSnapshot().storageError).toBe(true);
    expect(s.recorder.getSnapshot().tracks[0].points).toHaveLength(1);
    expect(s.geo.clearWatch).toHaveBeenCalled();
    s.failSave(false);
    expect(await s.recorder.retrySave()).toBe(true);
    expect(s.data.tracks[0].points).toHaveLength(1);
    expect(s.data.tracks[0].status).toBe("interrupted");
  });
  it("marks recovered recording interrupted and never auto starts GPS", async () => {
    const initial: FootprintTrack = {
      id: "old",
      name: "old",
      startedAt: 1700000000000,
      endedAt: null,
      status: "recording",
      coordinateSystem: "WGS84",
      source: "browser",
      points: [],
      gaps: [],
    };
    const s = setup({ initial: { tracks: [initial], visits: [] } });
    await s.recorder.load();
    expect(s.recorder.getSnapshot().tracks[0].status).toBe("interrupted");
    expect(s.recorder.getSnapshot().activeId).toBeNull();
    expect(s.geo.watchPosition).not.toHaveBeenCalled();
  });
  it("keeps two visits to the same place separately", async () => {
    const s = setup();
    const visit = {
      placeId: "p",
      name: "地点",
      city: "深圳",
      lat: 22,
      lng: 114,
      date: null,
      note: "",
      createdAt: 1700000000000,
      coordinateSystem: "GCJ02" as const,
    };
    await s.recorder.saveVisit({ ...visit, id: "v1" });
    await s.recorder.saveVisit({ ...visit, id: "v2" });
    expect(s.recorder.getSnapshot().visits).toHaveLength(2);
  });
  it("does not show a failed visit as saved", async () => {
    const s = setup({ fail: true });
    expect(
      await s.recorder.saveVisit({
        id: "v",
        placeId: "p",
        name: "地点",
        city: "深圳",
        lat: 22,
        lng: 114,
        date: null,
        note: "",
        createdAt: 1700000000000,
        coordinateSystem: "GCJ02",
      }),
    ).toBe(false);
    expect(s.recorder.getSnapshot().visits).toHaveLength(0);
  });
});

describe("recovered-session completion", () => {
  const prior: FootprintTrack = {
    id: "old",
    name: "old",
    startedAt: 1700000000000,
    endedAt: null,
    status: "paused",
    coordinateSystem: "WGS84",
    source: "browser",
    points: [],
    gaps: [],
  };
  it("can finish recovered history without starting GPS", async () => {
    const s = setup({ initial: { tracks: [prior], visits: [] } });
    await s.recorder.load();
    s.recorder.finish("old");
    await s.recorder.flush();
    expect(s.data.tracks[0].status).toBe("completed");
    expect(s.geo.watchPosition).not.toHaveBeenCalled();
  });
  it("does not resume a full session and append beyond the limit", async () => {
    const points = Array.from({ length: 20000 }, (_, i) => ({
      lat: 22,
      lng: 114,
      time: prior.startedAt + i,
      accuracy: 10,
      segment: 0,
    }));
    const s = setup({
      initial: { tracks: [{ ...prior, points }], visits: [] },
    });
    await s.recorder.load();
    await s.recorder.start("old");
    await s.recorder.flush();
    expect(s.data.tracks[0].status).toBe("completed");
    expect(s.data.tracks[0].points).toHaveLength(20000);
    expect(s.geo.watchPosition).not.toHaveBeenCalled();
  });
  it("completing an old session does not stop a separate active session", async () => {
    const s = setup({ initial: { tracks: [prior], visits: [] } });
    await s.recorder.load();
    await s.recorder.start();
    s.recorder.finish("old");
    expect(s.recorder.getSnapshot().activeId).toBe("t1");
    expect(s.geo.clearWatch).not.toHaveBeenCalled();
    s.recorder.dispose();
  });
});

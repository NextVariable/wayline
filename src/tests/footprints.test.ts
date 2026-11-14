import { describe, it, expect } from "vitest";
import {
  acceptPoint,
  distanceMeters,
  exportFootprints,
  localDate,
  parseFootprints,
  trackDistance,
  trackSegments,
  validDate,
  legacyFootprintVisits,
  type FootprintTrack,
  type FootprintVisit,
} from "../lib/footprints";
import { wgsToGcj, gcjToWgs } from "../lib/trackCoordinates";
const now = 1700000000000;
const point = { lat: 22.5, lng: 114, time: now, accuracy: 10, segment: 0 };
export const fixtureTrack: FootprintTrack = {
  id: "synthetic-track",
  name: "测试轨迹",
  startedAt: now,
  status: "completed",
  endedAt: now + 10000,
  source: "browser",
  coordinateSystem: "WGS84",
  gaps: [],
  points: [
    point,
    { ...point, lng: 114.001, time: now + 1000 },
    { ...point, lng: 114.1, time: now + 9000, segment: 1 },
    { ...point, lng: 114.101, time: now + 10000, segment: 1 },
  ],
};
export const fixtureVisit: FootprintVisit = {
  id: "visit",
  placeId: "place",
  name: "会场",
  city: "深圳",
  lat: 22.5,
  lng: 114,
  date: "2023-11-14",
  note: "一次到访",
  createdAt: now,
  coordinateSystem: "GCJ02",
};
const backup = () =>
  JSON.parse(
    exportFootprints({ tracks: [fixtureTrack], visits: [fixtureVisit] }),
  );
describe("track point quality and gaps", () => {
  it("keeps raw GPS coordinates and precision", () =>
    expect(acceptPoint([], point, 2, now)).toEqual({ ...point, segment: 2 }));
  it.each([
    { lat: NaN },
    { lng: Infinity },
    { lat: 91 },
    { lng: -181 },
    { accuracy: -1 },
    { accuracy: 151 },
    { time: now - 30001 },
    { time: now + 10001 },
  ])("rejects invalid fix %j", (patch) =>
    expect(acceptPoint([], { ...point, ...patch }, 0, now)).toBeNull(),
  );
  it("rejects duplicate time", () =>
    expect(acceptPoint([point], point, 0, now)).toBeNull());
  it("rejects older points", () =>
    expect(
      acceptPoint([point], { ...point, time: now - 1 }, 0, now),
    ).toBeNull());
  it("does not accumulate stationary jitter", () =>
    expect(
      acceptPoint(
        [point],
        { ...point, lng: 114.00001, time: now + 1000 },
        0,
        now + 1000,
      ),
    ).toBeNull());
  it("rejects an implausible teleported fix", () =>
    expect(
      acceptPoint(
        [point],
        { ...point, lng: 115, time: now + 1000 },
        0,
        now + 1000,
      ),
    ).toBeNull());
  it("starts another segment after 2 minutes", () =>
    expect(
      acceptPoint(
        [point],
        { ...point, lng: 115, time: now + 120000 },
        0,
        now + 120000,
      )?.segment,
    ).toBe(1));
  it("allows a new location after explicit resume without joining gap", () =>
    expect(
      acceptPoint(
        [point],
        { ...point, lng: 115, time: now + 1000 },
        1,
        now + 1000,
      )?.segment,
    ).toBe(1));
  it("does not count gaps as traveled distance", () => {
    expect(trackSegments(fixtureTrack.points)).toHaveLength(2);
    expect(trackDistance(fixtureTrack.points)).toBeCloseTo(
      distanceMeters(point, fixtureTrack.points[1]) * 2,
      3,
    );
  });
  it("handles empty and single point tracks", () => {
    expect(trackDistance([])).toBe(0);
    expect(trackDistance([point])).toBe(0);
    expect(trackSegments([])).toEqual([]);
  });
  it("uses the short great circle distance at the antimeridian", () =>
    expect(
      distanceMeters({ lat: 0, lng: 179.99 }, { lat: 0, lng: -179.99 }),
    ).toBeLessThan(2300));
});
describe("strict backup validation", () => {
  it("round trips real segments and visits", () => {
    const parsed = parseFootprints(JSON.stringify(backup()));
    expect(parsed.tracks[0].points).toEqual(fixtureTrack.points);
    expect(parsed.visits[0]).toEqual(fixtureVisit);
  });
  it("imports unfinished sessions interrupted, never recording", () => {
    const b = backup();
    b.tracks[0].status = "recording";
    expect(parseFootprints(JSON.stringify(b)).tracks[0].status).toBe(
      "interrupted",
    );
  });
  it.each([
    null,
    {},
    { format: "other", version: 1, tracks: [], visits: [] },
    { format: "whereto-footprints", version: 2, tracks: [], visits: [] },
  ])("rejects wrong envelopes %j", (data) =>
    expect(() => parseFootprints(JSON.stringify(data))).toThrow(),
  );
  it.each(["lat", "lng", "time", "accuracy", "segment"])(
    "rejects wrong point field %s",
    (field) => {
      const b = backup();
      b.tracks[0].points[0][field] = "bad";
      expect(() => parseFootprints(JSON.stringify(b))).toThrow();
    },
  );
  it("rejects decreasing segments", () => {
    const b = backup();
    b.tracks[0].points[3].segment = 0;
    expect(() => parseFootprints(JSON.stringify(b))).toThrow();
  });
  it("rejects duplicate point timestamps", () => {
    const b = backup();
    b.tracks[0].points[1].time = now;
    expect(() => parseFootprints(JSON.stringify(b))).toThrow();
  });
  it("rejects points after end", () => {
    const b = backup();
    b.tracks[0].endedAt = now + 1;
    expect(() => parseFootprints(JSON.stringify(b))).toThrow();
  });
  it("rejects mixed coordinate systems", () => {
    const b = backup();
    b.tracks[0].coordinateSystem = "GCJ02";
    expect(() => parseFootprints(JSON.stringify(b))).toThrow();
  });
  it("rejects duplicate record identifiers", () => {
    const b = backup();
    b.tracks.push(b.tracks[0]);
    expect(() => parseFootprints(JSON.stringify(b))).toThrow();
  });
  it("rejects invalid calendar dates", () => {
    const b = backup();
    b.visits[0].date = "2023-02-29";
    expect(() => parseFootprints(JSON.stringify(b))).toThrow();
  });
  it("preserves unknown visit date", () => {
    const b = backup();
    b.visits[0].date = null;
    expect(parseFootprints(JSON.stringify(b)).visits[0].date).toBeNull();
  });
  it("does not discard soft-deleted history", () => {
    const b = backup();
    b.tracks[0].deletedAt = now;
    expect(parseFootprints(JSON.stringify(b)).tracks[0].deletedAt).toBe(now);
  });
  it("limits input size", () =>
    expect(() => parseFootprints(" ".repeat(20000001))).toThrow("20MB"));
  it("limits total points before parsing", () => {
    const b = backup();
    b.tracks[0].points = Array(100001).fill(point);
    expect(() => parseFootprints(JSON.stringify(b))).toThrow("10万个");
  });
  it("validates leap years", () => {
    expect(validDate("2024-02-29")).toBe(true);
    expect(validDate("2024-13-01")).toBe(false);
    expect(validDate("bad")).toBe(false);
  });
  it("formats local calendar dates", () =>
    expect(localDate(new Date(2026, 9, 24, 1).getTime())).toBe("2026-10-24"));
});
describe("map coordinate separation", () => {
  it("matches a published Beijing conversion", () => {
    const p = wgsToGcj(116.404, 39.915);
    expect(p[0]).toBeCloseTo(116.41024449916938, 7);
    expect(p[1]).toBeCloseTo(39.91640428150164, 7);
  });
  it("returns mainland coordinates to WGS84 without double offset", () => {
    const gcj = wgsToGcj(114.06, 22.55);
    const wgs = gcjToWgs(...gcj);
    expect(wgs[0]).toBeCloseTo(114.06, 6);
    expect(wgs[1]).toBeCloseTo(22.55, 6);
  });
  it("keeps out-of-region coordinates unchanged", () =>
    expect(wgsToGcj(-73.98, 40.75)).toEqual([-73.98, 40.75]));
});

describe("malformed backup records", () => {
  it.each(["tracks", "visits"])(
    "rejects null in %s with a readable message",
    (key) => {
      const b = backup();
      b[key] = [null];
      expect(() => parseFootprints(JSON.stringify(b))).toThrow(
        key === "tracks" ? "轨迹信息无效" : "到访记录无效",
      );
    },
  );
  it("rejects null points", () => {
    const b = backup();
    b.tracks[0].points = [null];
    expect(() => parseFootprints(JSON.stringify(b))).toThrow("定位点无效");
  });
  it("rejects null gap records", () => {
    const b = backup();
    b.tracks[0].gaps = [null];
    expect(() => parseFootprints(JSON.stringify(b))).toThrow("中断信息无效");
  });
  it("completed record requires an end time", () => {
    const b = backup();
    b.tracks[0].endedAt = null;
    expect(() => parseFootprints(JSON.stringify(b))).toThrow("轨迹信息无效");
  });
});

describe("legacy visited records", () => {
  const place = {
    id: "legacy",
    name: "会场",
    city: "深圳",
    lat: 22,
    lng: 114,
    status: "visited",
    tags: [],
  };
  it("migrates without inventing a visit date", () => {
    const visits = legacyFootprintVisits([place], [], now);
    expect(visits[0].date).toBeNull();
    expect(visits[0].placeId).toBe(place.id);
  });
  it("does not migrate completed schedules", () =>
    expect(
      legacyFootprintVisits([{ ...place, tags: ["日程助手"] }], [], now),
    ).toEqual([]));
  it("does not recreate a deleted legacy visit", () => {
    const visits = legacyFootprintVisits([place], [], now);
    expect(
      legacyFootprintVisits([place], [{ ...visits[0], deletedAt: now }], now),
    ).toEqual([]);
  });
  it("does not count saved but unvisited places", () =>
    expect(
      legacyFootprintVisits([{ ...place, status: "saved" }], [], now),
    ).toEqual([]));
});

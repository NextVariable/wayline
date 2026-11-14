import { describe, it, expect } from "vitest";
import { entriesToTracks, type NativeEntry } from "../lib/nativeFootprints";

const T = new Date(2026, 9, 24, 9, 0, 0).getTime();
const fix = (id: number, sec: number, lat: number, seg: number): NativeEntry => ({
  id, time: T + sec * 1000, kind: "fix", lat, lng: 121.4, accuracy: 10, segment: seg,
});

describe("entriesToTracks", () => {
  it("keeps segments and records gaps without bridging them", () => {
    const tracks = entriesToTracks(
      [
        fix(1, 0, 31.2, 0),
        fix(2, 10, 31.2005, 0),
        { id: 3, time: T + 20000, kind: "gap:用户暂停", segment: 0 },
        fix(4, 600, 31.25, 1),
      ],
      { enabled: true, paused: true, running: false },
      T + 700000,
    );
    expect(tracks).toHaveLength(1);
    expect(tracks[0].points.map((p) => p.segment)).toEqual([0, 0, 1]);
    expect(tracks[0].gaps).toEqual([{ time: T + 20000, reason: "用户暂停" }]);
    expect(tracks[0].status).toBe("paused");
    expect(tracks[0].source).toBe("device");
  });

  it("reports interrupted when enabled but not running", () => {
    const [t] = entriesToTracks([fix(1, 0, 31.2, 0)], { enabled: true, paused: false, running: false }, T + 5000);
    expect(t.status).toBe("interrupted");
  });

  it("drops malformed and out-of-order fixes", () => {
    const [t] = entriesToTracks(
      [fix(1, 10, 31.2, 0), fix(2, 5, 31.3, 0), { ...fix(3, 20, 0, 0), lat: NaN }],
      null,
      T + 30000,
    );
    expect(t.points).toHaveLength(1);
  });

  it("closes past days as completed", () => {
    const [t] = entriesToTracks([fix(1, 0, 31.2, 0)], { enabled: true, paused: false, running: true }, T + 3 * 86400000);
    expect(t.status).toBe("completed");
    expect(t.endedAt).not.toBeNull();
  });
});

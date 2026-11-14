import { describe, expect, it } from "vitest";
import { completeFootprintBackup } from "../lib/footprintBackup";
import { parseFootprints, type FootprintTrack } from "../lib/footprints";

const track = (id: string, points: number): FootprintTrack => ({
  id,
  name: "测试轨迹",
  startedAt: 1792803600000,
  endedAt: 1792803900000,
  status: "completed",
  coordinateSystem: "WGS84",
  source: "browser",
  points: Array.from({ length: points }, (_, i) => ({
    lng: 113.91 + i * 0.0001,
    lat: 22.485,
    time: 1792803600000 + i * 1000,
    accuracy: 12,
    segment: 0,
  })),
  gaps: [{ time: 1792803700000, reason: "暂停" }],
});

describe("footprint backups", () => {
  it("exports a backup the importer can restore", () => {
    const restored = parseFootprints(
      completeFootprintBackup({ tracks: [track("a", 2)], visits: [] }),
    );
    expect(restored.tracks).toHaveLength(1);
    expect(restored.tracks[0].points).toHaveLength(2);
    expect(restored.tracks[0].gaps[0].reason).toBe("暂停");
  });
  it("keeps the latest copy when two tracks share an ID", () => {
    const restored = parseFootprints(
      completeFootprintBackup({ tracks: [track("a", 0), track("a", 3)], visits: [] }),
    );
    expect(restored.tracks).toHaveLength(1);
    expect(restored.tracks[0].points).toHaveLength(3);
  });
  it("keeps distinct IDs apart", () => {
    const restored = parseFootprints(
      completeFootprintBackup({ tracks: [track("a", 1), track("b", 1)], visits: [] }),
    );
    expect(restored.tracks).toHaveLength(2);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  NativeFootprintReader,
  StaleNativeRead,
} from "../lib/nativeFootprintReader";
import { completeFootprintBackup } from "../lib/footprintBackup";
import {
  entriesToTracks,
  type NativeStatus,
  type NativeEntry,
} from "../lib/nativeFootprints";
import { parseFootprints } from "../lib/footprints";
const now = new Date(2026, 9, 25, 10).getTime();
const status = (owner: string): NativeStatus => ({
  owner,
  occupied: false,
  installationId: "phone-1",
  platform: "android",
  enabled: true,
  paused: false,
  running: true,
  still: false,
  lastFixAt: now,
  foregroundPermission: true,
  alwaysPermission: true,
});
const fix = (id = 1): NativeEntry => ({
  id,
  time: now,
  kind: "fix",
  segment: 0,
  lat: 31.2,
  lng: 121.4,
  accuracy: 10,
});
describe("native reader ownership and concurrency", () => {
  it("sends the current owner on every read and clears the old cursor when switching", async () => {
    const read = vi.fn(async (o: { owner: string; afterId: number }) => ({
      entries: o.afterId ? [] : [fix(o.owner === "a" ? 10 : 1)],
    }));
    const r = new NativeFootprintReader({
      status: async (o) => status(o.owner),
      read,
    });
    r.selectOwner("a");
    expect((await r.refresh()).tracks[0].id).toContain(":a:");
    r.selectOwner("b");
    expect((await r.refresh()).tracks[0].id).toContain(":b:");
    expect(read.mock.calls[1][0]).toMatchObject({ owner: "b", afterId: 0 });
  });
  it("rejects a mismatched native response before publishing any tracks", async () => {
    const r = new NativeFootprintReader({
      status: async () => status("a"),
      read: async () => ({ entries: [fix()] }),
    });
    r.selectOwner("b");
    await expect(r.refresh()).rejects.toThrow("mismatch");
  });
  it("drops an in-flight result from a space that has since been closed", async () => {
    let release!: (v: { entries: NativeEntry[] }) => void;
    const r = new NativeFootprintReader({
      status: async (o) => status(o.owner),
      read: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    r.selectOwner("a");
    const pending = r.refresh();
    await Promise.resolve();
    r.selectOwner("b");
    release({ entries: [fix()] });
    await expect(pending).rejects.toBeInstanceOf(StaleNativeRead);
  });
  it("deduplicates concurrent refresh and export requests", async () => {
    const read = vi.fn(async () => ({ entries: [fix()] }));
    const r = new NativeFootprintReader({
      status: async (o) => status(o.owner),
      read,
    });
    r.selectOwner("a");
    const [a, b] = await Promise.all([r.refresh(), r.refresh()]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a.tracks[0].points).toHaveLength(1);
  });
  it("does not loop or duplicate points when the native cursor goes backwards", async () => {
    const r = new NativeFootprintReader({
      status: async (o) => status(o.owner),
      read: async () => ({ entries: [fix(), fix()] }),
    });
    r.selectOwner("a");
    await expect(r.refresh()).rejects.toThrow("cursor");
  });
});
describe("complete footprint backups", () => {
  it("includes device points and gaps in a restorable backup", () => {
    const tracks = entriesToTracks(
      [fix(), { id: 2, time: now + 100, kind: "gap:暂停", segment: 0 }],
      status("a"),
      now,
    );
    const restored = parseFootprints(
      completeFootprintBackup({ tracks: [], visits: [] }, tracks),
    );
    expect(restored.tracks[0].points).toHaveLength(1);
    expect(restored.tracks[0].gaps[0].reason).toBe("暂停");
  });
  it("exports a disabled track from today with a valid end time", () => {
    const tracks = entriesToTracks(
      [fix()],
      { ...status("a"), enabled: false, running: false },
      now,
    );
    expect(() =>
      parseFootprints(
        completeFootprintBackup({ tracks: [], visits: [] }, tracks),
      ),
    ).not.toThrow();
    expect(tracks[0].endedAt).toBe(now);
  });
  it("replaces an older restored copy instead of exporting duplicate IDs", () => {
    const live = entriesToTracks([fix()], status("a"), now);
    const old = { ...live[0], points: [] };
    const restored = parseFootprints(
      completeFootprintBackup({ tracks: [old], visits: [] }, live),
    );
    expect(restored.tracks).toHaveLength(1);
    expect(restored.tracks[0].points).toHaveLength(1);
  });
  it("keeps records from separate phones distinct on the same date", () => {
    const first = entriesToTracks([fix()], status("a"), now);
    const second = entriesToTracks(
      [fix()],
      { ...status("a"), installationId: "phone-2" },
      now,
    );
    expect(
      parseFootprints(
        completeFootprintBackup({ tracks: first, visits: [] }, second),
      ).tracks,
    ).toHaveLength(2);
  });
});

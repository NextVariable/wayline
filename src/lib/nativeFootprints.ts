import { Capacitor, registerPlugin } from "@capacitor/core";
import { localDate, type FootprintTrack, type TrackPoint } from "./footprints";

export interface NativeStatus {
  platform: "android" | "ios";
  owner: string;
  occupied: boolean;
  installationId: string;
  enabled: boolean;
  paused: boolean;
  running: boolean;
  still: boolean;
  lastFixAt: number;
  foregroundPermission: boolean;
  alwaysPermission: boolean;
}
export interface NativeEntry {
  id: number;
  time: number;
  kind: string;
  segment: number;
  lat?: number;
  lng?: number;
  accuracy?: number;
}
export interface NativePlugin {
  status(options: { owner: string }): Promise<NativeStatus>;
  enable(options: { owner: string }): Promise<NativeStatus>;
  pause(options: { owner: string }): Promise<NativeStatus>;
  resume(options: { owner: string }): Promise<NativeStatus>;
  disable(options: { owner: string }): Promise<NativeStatus>;
  openSettings(): Promise<void>;
  read(options: {
    owner: string;
    afterId: number;
    limit: number;
  }): Promise<{ entries: NativeEntry[] }>;
}
export const nativeFootprints =
  registerPlugin<NativePlugin>("NativeFootprints");
/** 只有原生壳内才有后台采集；浏览器和 PWA 不显示自动足迹开关。 */
export const hasNativeFootprints = () =>
  Capacitor.isNativePlatform() &&
  Capacitor.isPluginAvailable("NativeFootprints");

/**
 * 把设备本地库的流水按本地日期归并成只读轨迹。
 * 缺口只作为标记保留，相邻定位点不会被补线；段号来自采集端。
 */
export function entriesToTracks(
  entries: NativeEntry[],
  status:
    | (Pick<NativeStatus, "running" | "paused" | "enabled"> &
        Partial<Pick<NativeStatus, "owner" | "installationId">>)
    | null,
  now: number,
): FootprintTrack[] {
  const byDay = new Map<string, FootprintTrack>();
  const day = (time: number) => {
    const date = localDate(time);
    let track = byDay.get(date);
    if (!track) {
      track = {
        id: status?.installationId
          ? `device:${status.installationId}:${encodeURIComponent(status.owner || "")}:${date}`
          : "device:" + date,
        name: date + " 自动足迹",
        startedAt: time,
        endedAt: null,
        status: "completed",
        coordinateSystem: "WGS84",
        source: "device",
        points: [],
        gaps: [],
      };
      byDay.set(date, track);
    }
    return track;
  };
  for (const e of entries) {
    if (!Number.isFinite(e.time)) continue;
    const track = day(e.time);
    track.startedAt = Math.min(track.startedAt, e.time);
    if (e.kind === "fix") {
      if (
        !Number.isFinite(e.lat) ||
        !Number.isFinite(e.lng) ||
        !Number.isFinite(e.accuracy)
      )
        continue;
      const last = track.points.at(-1);
      if (last && e.time <= last.time) continue;
      const point: TrackPoint = {
        lat: e.lat as number,
        lng: e.lng as number,
        time: e.time,
        accuracy: e.accuracy as number,
        segment: e.segment,
      };
      track.points.push(point);
    } else if (e.kind.startsWith("gap:")) {
      track.gaps.push({ time: e.time, reason: e.kind.slice(4) });
    } else if (e.kind === "resume") {
      track.gaps.push({ time: e.time, reason: "应用被系统重新启动" });
    }
  }
  const today = localDate(now);
  const tracks = [...byDay.values()];
  for (const track of tracks) {
    const lastTime = Math.max(
      track.points.at(-1)?.time ?? 0,
      track.gaps.at(-1)?.time ?? 0,
    );
    track.endedAt = Math.max(track.startedAt, lastTime);
    if (localDate(track.startedAt) === today) {
      track.status = !status?.enabled
        ? "completed"
        : status.paused
          ? "paused"
          : status.running
            ? "recording"
            : "interrupted";
      if (track.status !== "completed") track.endedAt = null;
    }
  }
  return tracks.sort((a, b) => b.startedAt - a.startedAt);
}

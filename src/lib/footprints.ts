export type TrackStatus = "recording" | "paused" | "interrupted" | "completed";
export interface TrackPoint {
  lat: number;
  lng: number;
  time: number;
  accuracy: number;
  segment: number;
}
export interface TrackGap {
  time: number;
  reason: string;
}
export interface FootprintTrack {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  status: TrackStatus;
  coordinateSystem: "WGS84";
  source: "browser" | "backup" | "device";
  points: TrackPoint[];
  gaps: TrackGap[];
  deletedAt?: number;
}
export interface FootprintVisit {
  id: string;
  placeId: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  date: string | null;
  note: string;
  createdAt: number;
  deletedAt?: number;
  coordinateSystem: "GCJ02";
}
export interface FootprintData {
  tracks: FootprintTrack[];
  visits: FootprintVisit[];
}
export function legacyFootprintVisits(
  places: {
    id: string;
    name: string;
    city: string;
    lat: number;
    lng: number;
    status: string;
    tags: string[];
  }[],
  visits: FootprintVisit[],
  now: number,
): FootprintVisit[] {
  return places
    .filter(
      (p) =>
        p.status === "visited" &&
        !p.tags.includes("日程助手") &&
        !visits.some((v) => v.placeId === p.id),
    )
    .map((p) => ({
      id: "legacy-visit:" + p.id,
      placeId: p.id,
      name: p.name,
      city: p.city,
      lat: p.lat,
      lng: p.lng,
      date: null,
      note: "从原有已到访标记迁移，原记录没有日期。",
      createdAt: now,
      coordinateSystem: "GCJ02",
    }));
}
export function localDate(time = Date.now()) {
  const d = new Date(time);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function distanceMeters(
  a: Pick<TrackPoint, "lat" | "lng">,
  b: Pick<TrackPoint, "lat" | "lng">,
) {
  const rad = Math.PI / 180;
  const lat = Math.sin(((b.lat - a.lat) * rad) / 2);
  const lng = Math.sin(((b.lng - a.lng) * rad) / 2);
  return (
    6371008.8 *
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          lat * lat + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * lng * lng,
        ),
      ),
    )
  );
}
export function trackSegments(points: TrackPoint[]) {
  const segments: TrackPoint[][] = [];
  for (const point of points) {
    if (
      !segments.length ||
      segments[segments.length - 1][0].segment !== point.segment
    )
      segments.push([]);
    segments[segments.length - 1].push(point);
  }
  return segments;
}
export function trackDistance(points: TrackPoint[]) {
  return points.reduce(
    (sum, p, i) =>
      i && p.segment === points[i - 1].segment
        ? sum + distanceMeters(points[i - 1], p)
        : sum,
    0,
  );
}
export function acceptPoint(
  points: TrackPoint[],
  raw: Omit<TrackPoint, "segment">,
  segment: number,
  now: number,
): TrackPoint | null {
  const { lat, lng, time, accuracy } = raw;
  if (
    ![lat, lng, time, accuracy].every(Number.isFinite) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180 ||
    accuracy < 0 ||
    accuracy > 150 ||
    time > now + 10000 ||
    now - time > 30000
  )
    return null;
  const last = points.at(-1);
  if (last) {
    if (time <= last.time) return null;
    const dt = (time - last.time) / 1000;
    const distance = distanceMeters(last, raw);
    if (
      segment === last.segment &&
      dt < 120 &&
      distance > Math.max(300, dt * 120 + accuracy + last.accuracy)
    )
      return null;
    if (
      segment === last.segment &&
      dt < 120 &&
      distance < Math.max(5, Math.min(accuracy, last.accuracy) / 2)
    )
      return null;
    if (dt >= 120 && segment === last.segment) segment++;
  }
  return { ...raw, segment };
}
export function exportFootprints(data: FootprintData) {
  return JSON.stringify(
    {
      format: "whereto-footprints",
      version: 1,
      exportedAt: Date.now(),
      ...data,
    },
    null,
    2,
  );
}
// Backups are untrusted: validate the entire file before any database write.
export function parseFootprints(text: string): FootprintData {
  if (text.length > 20_000_000) throw new Error("备份超过20MB，请拆分后导入");
  const data = JSON.parse(text);
  if (
    data?.format !== "whereto-footprints" ||
    data.version !== 1 ||
    !Array.isArray(data.tracks) ||
    !Array.isArray(data.visits) ||
    data.tracks.length > 1000 ||
    data.visits.length > 10000
  )
    throw new Error("不是受支持的足迹备份");
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  const epoch = (n: unknown) =>
    finite(n) && (n as number) >= 0 && (n as number) <= 8.64e15;
  const coord = (p: any) =>
    p !== null &&
    typeof p === "object" &&
    finite(p.lat) &&
    Math.abs(p.lat) <= 90 &&
    finite(p.lng) &&
    Math.abs(p.lng) <= 180;
  const str = (s: unknown, max = 200) =>
    typeof s === "string" && s.length > 0 && s.length <= max;
  const ids = new Set<string>();
  let total = 0;
  const tracks: FootprintTrack[] = data.tracks.map((t: any) => {
    if (
      !t ||
      typeof t !== "object" ||
      !str(t.id) ||
      ids.has(t.id) ||
      !str(t.name) ||
      !epoch(t.startedAt) ||
      !(t.endedAt === null || (epoch(t.endedAt) && t.endedAt >= t.startedAt)) ||
      (t.status === "completed" && t.endedAt === null) ||
      !["recording", "paused", "interrupted", "completed"].includes(t.status) ||
      t.coordinateSystem !== "WGS84" ||
      !Array.isArray(t.points) ||
      !Array.isArray(t.gaps) ||
      t.gaps.length > 10000 ||
      (t.deletedAt !== undefined && !epoch(t.deletedAt))
    )
      throw new Error("轨迹信息无效");
    ids.add(t.id);
    total += t.points.length;
    if (total > 100000) throw new Error("备份最多包含10万个定位点");
    let previousTime = -1,
      previousSegment = -1;
    const points = t.points.map((p: any) => {
      if (
        !coord(p) ||
        !epoch(p.time) ||
        p.time < t.startedAt ||
        (t.endedAt !== null && p.time > t.endedAt) ||
        !finite(p.accuracy) ||
        p.accuracy < 0 ||
        p.accuracy > 150 ||
        !Number.isInteger(p.segment) ||
        p.segment < 0 ||
        p.segment < previousSegment ||
        p.time <= previousTime
      )
        throw new Error("轨迹定位点无效");
      previousTime = p.time;
      previousSegment = p.segment;
      return {
        lat: p.lat,
        lng: p.lng,
        time: p.time,
        accuracy: p.accuracy,
        segment: p.segment,
      };
    });
    const gaps = t.gaps.map((g: any) => {
      if (!g || !epoch(g.time) || !str(g.reason, 200))
        throw new Error("轨迹中断信息无效");
      return { time: g.time, reason: g.reason };
    });
    return {
      id: t.id,
      name: t.name,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
      status: t.status === "completed" ? "completed" : "interrupted",
      coordinateSystem: "WGS84",
      source: "backup",
      points,
      gaps,
      ...(t.deletedAt === undefined ? {} : { deletedAt: t.deletedAt }),
    };
  });
  const visits: FootprintVisit[] = data.visits.map((v: any) => {
    if (
      !v ||
      typeof v !== "object" ||
      !str(v.id) ||
      ids.has(v.id) ||
      !str(v.placeId) ||
      !str(v.name) ||
      !str(v.city) ||
      !coord(v) ||
      v.coordinateSystem !== "GCJ02" ||
      !(v.date === null || (typeof v.date === "string" && validDate(v.date))) ||
      typeof v.note !== "string" ||
      v.note.length > 2000 ||
      !epoch(v.createdAt) ||
      (v.deletedAt !== undefined && !epoch(v.deletedAt))
    )
      throw new Error("到访记录无效");
    ids.add(v.id);
    return {
      id: v.id,
      placeId: v.placeId,
      name: v.name,
      city: v.city,
      lat: v.lat,
      lng: v.lng,
      date: v.date,
      note: v.note,
      createdAt: v.createdAt,
      coordinateSystem: "GCJ02",
      ...(v.deletedAt === undefined ? {} : { deletedAt: v.deletedAt }),
    };
  });
  return { tracks, visits };
}

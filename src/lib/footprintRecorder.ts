import {
  acceptPoint,
  distanceMeters,
  localDate,
  type FootprintData,
  type FootprintTrack,
  type TrackPoint,
} from "./footprints";
import type { FootprintStore } from "./footprintStore";
export interface GeoSource {
  watchPosition(
    success: PositionCallback,
    error?: PositionErrorCallback | null,
    options?: PositionOptions,
  ): number;
  clearWatch(id: number): void;
}
export interface RecorderSnapshot extends FootprintData {
  activeId: string | null;
  busy: boolean;
  message: string;
  storageError: boolean;
  fix: Omit<TrackPoint, "segment"> | null;
}
interface Dependencies {
  store: FootprintStore;
  geo?: GeoSource;
  now?: () => number;
  id?: () => string;
  acquire?: () => Promise<(() => void) | null>;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}
/** Location acquisition is injectable so errors, late callbacks and interruptions can be tested without real GPS. */
export class FootprintRecorder {
  private snapshot: RecorderSnapshot = {
    tracks: [],
    visits: [],
    activeId: null,
    busy: false,
    message: "",
    storageError: false,
    fix: null,
  };
  private listeners = new Set<() => void>();
  private watch: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private segment = 0;
  private disposed = false;
  private release: (() => void) | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private now: () => number;
  private makeId: () => string;
  constructor(private deps: Dependencies) {
    this.now = deps.now ?? Date.now;
    this.makeId = deps.id ?? (() => crypto.randomUUID());
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<RecorderSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    if (!this.disposed) this.listeners.forEach((fn) => fn());
  }
  private track() {
    return this.snapshot.tracks.find((t) => t.id === this.snapshot.activeId);
  }
  private replace(track: FootprintTrack) {
    this.update({
      tracks: this.snapshot.tracks.map((t) => (t.id === track.id ? track : t)),
    });
  }
  async load() {
    const data = await this.deps.store.load();
    if (this.disposed) return;
    const tracks = data.tracks.map((t) =>
      t.status === "recording"
        ? {
            ...t,
            status: "interrupted" as const,
            gaps: [
              ...t.gaps,
              { time: this.now(), reason: "页面关闭或刷新，记录已中断" },
            ],
          }
        : t,
    );
    this.update({ ...data, tracks });
    for (const t of tracks)
      if (
        t.status === "interrupted" &&
        data.tracks.find((old) => old.id === t.id)?.status === "recording"
      )
        await this.persist(t);
  }
  private stopWatch() {
    this.generation++;
    if (this.watch !== null) {
      this.deps.geo?.clearWatch(this.watch);
      this.watch = null;
    }
    if (this.timer !== null) {
      (this.deps.clearTimer ?? clearTimeout)(this.timer);
      this.timer = null;
    }
    this.release?.();
    this.release = null;
  }
  private persist(track: FootprintTrack) {
    const task = this.writes.then(() => this.deps.store.saveTrack(track));
    this.writes = task.catch(() => {
      this.stopWatch();
      const current = this.track();
      if (current?.status === "recording")
        this.replace({
          ...current,
          status: "interrupted",
          gaps: [...current.gaps, { time: this.now(), reason: "本机保存失败" }],
        });
      this.update({
        storageError: true,
        busy: false,
        message: "本机保存失败，已停止采集。请导出备份或重试保存，勿关闭页面。",
      });
    });
    return task.then(
      () => true,
      () => false,
    );
  }
  async retrySave() {
    this.update({ storageError: false });
    for (const track of this.snapshot.tracks)
      if (!(await this.persist(track))) return false;
    try {
      for (const visit of this.snapshot.visits)
        await this.deps.store.saveVisit(visit);
    } catch {
      this.update({
        storageError: true,
        message: "保存仍不可用，请先导出备份",
      });
      return false;
    }
    this.update({ message: "已重新保存，请手动继续记录" });
    return true;
  }
  async start(id?: string) {
    if (
      this.disposed ||
      this.snapshot.busy ||
      this.snapshot.storageError ||
      this.track()?.status === "recording"
    )
      return;
    if (!this.deps.geo) {
      this.update({
        message:
          "当前浏览器不支持定位，请使用 HTTPS 或本机地址，在系统浏览器中打开。",
      });
      return;
    }
    if (this.track() && this.snapshot.activeId !== id) {
      this.update({ message: "请先结束当前记录，再开始新轨迹" });
      return;
    }
    const candidate = id
      ? this.snapshot.tracks.find(
          (t) => t.id === id && !t.deletedAt && t.status !== "completed",
        )
      : null;
    if (id && !candidate) return;
    if (candidate && candidate.points.length >= 20000) {
      if (await this.finish(candidate.id))
        this.update({ message: "这条轨迹已达到2万个点并已结束，请开始新记录" });
      return;
    }
    this.update({ busy: true, message: "正在请求定位…" });
    const generation = ++this.generation;
    let release: (() => void) | null;
    try {
      release = this.deps.acquire ? await this.deps.acquire() : () => {};
    } catch {
      this.update({ busy: false, message: "无法启动定位，请重试" });
      return;
    }
    if (this.disposed || generation !== this.generation) {
      release?.();
      return;
    }
    if (!release) {
      this.update({
        busy: false,
        message: "另一个页面正在记录，请先暂停那里的记录",
      });
      return;
    }
    this.release = release;
    const track: FootprintTrack = candidate
      ? {
          ...candidate,
          status: "recording",
          gaps: [
            ...candidate.gaps,
            { time: this.now(), reason: "继续记录，新开轨迹段" },
          ],
        }
      : {
          id: this.makeId(),
          name: localDate(this.now()) + " 出行记录",
          startedAt: this.now(),
          endedAt: null,
          status: "recording",
          coordinateSystem: "WGS84",
          source: "browser",
          points: [],
          gaps: [],
        };
    this.segment = (track.points.at(-1)?.segment ?? -1) + 1;
    this.update({
      activeId: track.id,
      tracks: candidate
        ? this.snapshot.tracks.map((t) => (t.id === track.id ? track : t))
        : [track, ...this.snapshot.tracks],
      fix: null,
    });
    if (
      !(await this.persist(track)) ||
      this.disposed ||
      generation !== this.generation
    )
      return;
    this.update({ busy: false, message: "等待定位，尚未采集到位置" });
    const armTimeout = () => {
      if (this.timer !== null)
        (this.deps.clearTimer ?? clearTimeout)(this.timer);
      this.timer = (this.deps.setTimer ?? setTimeout)(
        () => this.pause("长时间未获得有效位置，记录已中断", true),
        35000,
      );
    };
    armTimeout();
    try {
      const watch = this.deps.geo.watchPosition(
        (position) => {
          if (this.disposed || generation !== this.generation) return;
          const current = this.track();
          if (!current || current.status !== "recording") return;
          const raw = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            time: position.timestamp,
            accuracy: position.coords.accuracy,
          };
          if (
            raw.time < current.startedAt ||
            !acceptPoint([], raw, 0, this.now())
          ) {
            this.update({
              message:
                raw.accuracy > 150
                  ? "定位精度较低，等待更准确的位置…"
                  : "收到无效或过期位置，等待重新定位…",
            });
            return;
          }
          if (this.snapshot.fix && raw.time <= this.snapshot.fix.time) return;
          const point = acceptPoint(
            current.points,
            raw,
            this.segment,
            this.now(),
          );
          const last = current.points.at(-1);
          if (
            !point &&
            last &&
            distanceMeters(last, raw) >=
              Math.max(5, Math.min(raw.accuracy, last.accuracy) / 2)
          ) {
            this.update({ message: "已忽略疑似漂移的位置，等待稳定定位…" });
            return;
          }
          armTimeout();
          this.update({ fix: raw, message: "" });
          if (!point) return;
          this.segment = point.segment;
          const next = { ...current, points: [...current.points, point] };
          this.replace(next);
          void this.persist(next);
          if (next.points.length >= 20000) {
            void this.finish().then(saved => {
              if (saved) this.update({ message: "已达到2万个定位点并结束保存，请开始新记录" });
            });
          }
        },
        (error) => {
          if (this.disposed || generation !== this.generation) return;
          const message =
            error.code === 1
              ? "定位权限被拒绝。请在浏览器的网站权限中允许定位，再继续记录。"
              : error.code === 2
                ? "暂时无法获得位置，请检查系统定位和信号后继续记录。"
                : "定位超时，请到信号较好的位置后继续记录。";
          this.pause(message, true);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      );
      // A synchronous provider error may have invalidated the generation already.
      if (generation !== this.generation) this.deps.geo.clearWatch(watch);
      else this.watch = watch;
    } catch {
      this.pause("浏览器未能启动定位，请检查定位权限后重试", true);
    }
  }
  pause(reason = "已暂停，继续时将新开轨迹段", interrupted = false) {
    this.stopWatch();
    const track = this.track();
    this.update({ busy: false });
    if (!track || track.status !== "recording") return;
    const next = {
      ...track,
      status: interrupted ? ("interrupted" as const) : ("paused" as const),
      gaps: [...track.gaps, { time: this.now(), reason }],
    };
    this.replace(next);
    this.update({ message: reason });
    void this.persist(next);
  }
  async finish(id = this.snapshot.activeId) {
    const track = this.snapshot.tracks.find((t) => t.id === id && !t.deletedAt);
    if (!track || track.status === "completed") return;
    const wasActive = track.id === this.snapshot.activeId;
    if (wasActive) this.stopWatch();
    const next = {
      ...track,
      status: "completed" as const,
      endedAt: Math.max(this.now(), track.points.at(-1)?.time ?? 0),
    };
    this.replace(next);
    this.update(
      wasActive
        ? { activeId: null, busy: true, message: "正在保存记录…", fix: null }
        : { message: "正在保存记录…" },
    );
    const saved = await this.persist(next);
    if (saved) this.update({ ...(wasActive ? { busy: false } : {}), message: "记录已结束" });
    return saved;
  }
  async saveVisit(visit: FootprintData["visits"][number]) {
    try {
      await this.deps.store.saveVisit(visit);
      this.update({
        visits: [
          ...this.snapshot.visits.filter((v) => v.id !== visit.id),
          visit,
        ],
      });
      return true;
    } catch {
      this.update({ message: "到访记录未能保存，输入已保留，请重试" });
      return false;
    }
  }
  async setDeleted(kind: "track" | "visit", id: string, deleted: boolean) {
    const deletedAt = deleted ? this.now() : undefined;
    if (kind === "track") {
      const track = this.snapshot.tracks.find((t) => t.id === id);
      if (!track || track.id === this.snapshot.activeId) return false;
      const next = { ...track, deletedAt };
      if (!(await this.persist(next))) return false;
      this.replace(next);
    } else {
      const visit = this.snapshot.visits.find((v) => v.id === id);
      if (!visit) return false;
      if (!(await this.saveVisit({ ...visit, deletedAt }))) return false;
    }
    return true;
  }
  async importData(data: FootprintData) {
    await this.writes;
    const added = await this.deps.store.importData(data);
    if (this.disposed) return 0;
    this.update({
      tracks: [...this.snapshot.tracks, ...added.tracks],
      visits: [...this.snapshot.visits, ...added.visits],
    });
    return added.tracks.length + added.visits.length;
  }
  async flush() {
    await this.writes;
  }
  dispose() {
    this.pause("离开页面或切换空间，记录已中断", true);
    this.disposed = true;
    this.listeners.clear();
    void this.writes.finally(() => this.deps.store.close());
  }
}

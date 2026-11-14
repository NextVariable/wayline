import type {
  FootprintData,
  FootprintTrack,
  FootprintVisit,
} from "./footprints";
export interface FootprintStore {
  load(): Promise<FootprintData>;
  saveTrack(track: FootprintTrack): Promise<void>;
  saveVisit(visit: FootprintVisit): Promise<void>;
  importData(data: FootprintData): Promise<FootprintData>;
  close(): void;
}
export async function openFootprintStore(
  userId: string,
): Promise<FootprintStore> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("whereto-footprints-v1", 1);
    request.onupgradeneeded = () => {
      const tracks = request.result.createObjectStore("tracks", {
        keyPath: ["owner", "id"],
      });
      tracks.createIndex("owner", "owner");
      const points = request.result.createObjectStore("points", {
        keyPath: ["owner", "trackId", "index"],
      });
      points.createIndex("owner", "owner");
      const visits = request.result.createObjectStore("visits", {
        keyPath: ["owner", "id"],
      });
      visits.createIndex("owner", "owner");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("请关闭其他旧版本页面后重试"));
  });
  db.onversionchange = () => db.close();
  const lengths = new Map<string, number>();
  const done = (tx: IDBTransaction) =>
    new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("保存已中断"));
    });
  const all = <T>(store: IDBObjectStore) =>
    new Promise<T[]>((resolve, reject) => {
      const r = store.index("owner").getAll(userId);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  const load = async () => {
    const tx = db.transaction(["tracks", "points", "visits"], "readonly");
    const completed = done(tx);
    const [metas, points, visits] = await Promise.all([
      all<any>(tx.objectStore("tracks")),
      all<any>(tx.objectStore("points")),
      all<any>(tx.objectStore("visits")),
      completed,
    ]);
    const grouped = new Map<string, any[]>();
    for (const p of points) {
      const list = grouped.get(p.trackId) ?? [];
      list.push(p);
      grouped.set(p.trackId, list);
    }
    const tracks: FootprintTrack[] = metas.map(({ owner: _, ...meta }) => {
      const list = (grouped.get(meta.id) ?? [])
        .sort((a, b) => a.index - b.index)
        .map(({ owner: __, trackId: ___, index: ____, ...p }) => p);
      lengths.set(meta.id, list.length);
      return { ...meta, points: list };
    });
    return {
      tracks,
      visits: visits.map(({ owner: _, ...v }) => v) as FootprintVisit[],
    };
  };
  return {
    load,
    async saveTrack(track) {
      const tx = db.transaction(["tracks", "points"], "readwrite");
      const completed = done(tx);
      const { points, ...meta } = track;
      tx.objectStore("tracks").put({ ...meta, owner: userId });
      const start = lengths.get(track.id) ?? 0;
      for (let index = start; index < points.length; index++)
        tx.objectStore("points").put({
          ...points[index],
          owner: userId,
          trackId: track.id,
          index,
        });
      await completed;
      lengths.set(track.id, points.length);
    },
    async saveVisit(visit) {
      const tx = db.transaction("visits", "readwrite");
      const completed = done(tx);
      tx.objectStore("visits").put({ ...visit, owner: userId });
      await completed;
    },
    async importData(data) {
      // Add only; never overwrite an existing record or its soft-deletion state.
      const existing = await load();
      const tracks = data.tracks.filter(
        (t) => !existing.tracks.some((e) => e.id === t.id),
      );
      const visits = data.visits.filter(
        (v) => !existing.visits.some((e) => e.id === v.id),
      );
      const tx = db.transaction(["tracks", "points", "visits"], "readwrite");
      const completed = done(tx);
      for (const { points, ...meta } of tracks) {
        tx.objectStore("tracks").add({ ...meta, owner: userId });
        points.forEach((p, index) =>
          tx
            .objectStore("points")
            .add({ ...p, owner: userId, trackId: meta.id, index }),
        );
      }
      for (const v of visits)
        tx.objectStore("visits").add({ ...v, owner: userId });
      await completed;
      tracks.forEach((t) => lengths.set(t.id, t.points.length));
      return { tracks, visits };
    },
    close: () => db.close(),
  };
}

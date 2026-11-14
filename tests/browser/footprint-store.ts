import { acquireRecordingLock } from "../../src/lib/useFootprints";
import { openFootprintStore } from "../../src/lib/footprintStore";
import { FootprintRecorder } from "../../src/lib/footprintRecorder";
import {
  exportFootprints,
  parseFootprints,
  type FootprintTrack,
} from "../../src/lib/footprints";
const owner = "browser-test-" + crypto.randomUUID();
const stores: Awaited<ReturnType<typeof openFootprintStore>>[] = [];
const open = async (id = owner) => {
  const store = await openFootprintStore(id);
  stores.push(store);
  return store;
};
let passed = 0,
  failed = 0;
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const test = async (name: string, run: () => Promise<void>) => {
  const li = document.createElement("li");
  document.querySelector("#tests")!.append(li);
  try {
    await run();
    passed++;
    li.textContent = "通过 · " + name;
  } catch (error) {
    failed++;
    li.className = "fail";
    li.textContent = "失败 · " + name + " · " + String(error);
  }
};
const now = Date.now();
const track: FootprintTrack = {
  id: "track",
  name: "合成轨迹",
  status: "completed",
  source: "browser",
  coordinateSystem: "WGS84",
  startedAt: now,
  endedAt: now + 2000,
  gaps: [],
  points: [
    { lat: 22.5, lng: 114, time: now, accuracy: 10, segment: 0 },
    { lat: 22.501, lng: 114.001, time: now + 2000, accuracy: 10, segment: 0 },
  ],
};
const store = await open();
await test("新空间为空", async () => {
  const d = await store.load();
  assert(!d.tracks.length && !d.visits.length, "空间不为空");
});
await test("真实 IndexedDB 事务保存定位点", async () => {
  await store.saveTrack(track);
  const d = await store.load();
  assert(d.tracks[0].points.length === 2, "定位点未保存");
});
await test("增量追加只新增定位点", async () => {
  await store.saveTrack({
    ...track,
    endedAt: now + 3000,
    points: [
      ...track.points,
      { ...track.points[1], time: now + 3000, lng: 114.002 },
    ],
  });
  assert((await store.load()).tracks[0].points.length === 3, "追加数量错误");
});
await test("只修改元数据不会重复追加", async () => {
  const t = (await store.load()).tracks[0];
  await store.saveTrack({ ...t, name: "更新名称" });
  assert((await store.load()).tracks[0].points.length === 3, "重复定位点");
});
await test("关闭并重新打开可恢复历史", async () => {
  const s = await open();
  assert((await s.load()).tracks[0].name === "更新名称", "记录丢失");
  s.close();
});
await test("不同本机空间相互隔离", async () => {
  const other = await open(owner + "-other");
  assert(!(await other.load()).tracks.length, "跨空间泄漏");
});
await test("同一地点多次到访独立保存", async () => {
  const v = {
    placeId: "place",
    name: "会场",
    city: "深圳",
    lat: 22,
    lng: 114,
    date: null,
    note: "",
    createdAt: now,
    coordinateSystem: "GCJ02" as const,
  };
  await store.saveVisit({ ...v, id: "visit-1" });
  await store.saveVisit({ ...v, id: "visit-2" });
  const d = await store.load();
  assert(
    d.visits.length === 2 && d.visits.every((v) => v.date === null),
    "到访被覆盖或日期被伪造",
  );
});
await test("导出恢复保留分段与日期不详", async () => {
  const backup = parseFootprints(exportFootprints(await store.load()));
  const fresh = await open(owner + "-restore");
  await fresh.importData(backup);
  const restored = await fresh.load();
  assert(
    restored.tracks[0].points.length === 3 && restored.visits.length === 2,
    "恢复不完整",
  );
});
await test("重复导入不重复添加", async () => {
  const data = parseFootprints(exportFootprints(await store.load()));
  const added = await store.importData(data);
  assert(!added.tracks.length && !added.visits.length, "重复添加");
});
await test("导入旧备份不覆盖较新记录", async () => {
  await store.importData({ tracks: [track], visits: [] });
  assert(
    (await store.load()).tracks[0].name === "更新名称",
    "名称被旧备份覆盖",
  );
});
await test("移除仅改变状态，恢复保留全部定位点", async () => {
  const t = (await store.load()).tracks[0];
  await store.saveTrack({ ...t, deletedAt: now });
  assert((await store.load()).tracks[0].points.length === 3, "移除破坏定位点");
  await store.saveTrack({ ...t, deletedAt: undefined });
  assert(!(await store.load()).tracks[0].deletedAt, "未恢复");
});
await test("批量导入冲突时整笔回滚", async () => {
  let rejected = false;
  try {
    await store.importData({
      tracks: [
        { ...track, id: "conflict" },
        { ...track, id: "conflict" },
      ],
      visits: [],
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "冲突未拒绝");
  assert(
    !(await store.load()).tracks.some((t) => t.id === "conflict"),
    "留下半条数据",
  );
});
await test("2000点及分段保存恢复", async () => {
  const points = Array.from({ length: 2000 }, (_, i) => ({
    lat: 22.5,
    lng: 114 + i * 0.000001,
    time: now + i * 1000,
    accuracy: 10,
    segment: i < 1000 ? 0 : 1,
  }));
  await store.saveTrack({
    ...track,
    id: "large",
    points,
    endedAt: now + 1999000,
  });
  const result = (await store.load()).tracks.find((t) => t.id === "large")!;
  assert(
    result.points.length === 2000 && result.points[1000].segment === 1,
    "大记录损坏",
  );
});
await test("采集器和真实存储端到端：采集、暂停、继续、结束", async () => {
  const s = await open(owner + "-recorder");
  let clock = now;
  let callback: PositionCallback | undefined;
  const recorder = new FootprintRecorder({
    store: s,
    now: () => clock,
    id: () => "session",
    geo: {
      watchPosition: (success) => {
        callback = success;
        return 0;
      },
      clearWatch: () => {},
    },
  });
  await recorder.load();
  await recorder.start();
  const fix = (lng: number) => {
    clock += 1000;
    callback?.({
      timestamp: clock,
      coords: { latitude: 22.5, longitude: lng, accuracy: 10 },
    } as GeolocationPosition);
  };
  fix(114);
  fix(114.001);
  recorder.pause();
  await recorder.start("session");
  fix(114.1);
  recorder.finish();
  await recorder.flush();
  const result = (await s.load()).tracks[0];
  assert(
    result.points.length === 3 &&
      result.points[2].segment === 1 &&
      result.status === "completed",
    "闭环记录有误",
  );
  recorder.dispose();
});
await test("同源页面不能同时持有记录锁", async () => {
  const release = await acquireRecordingLock();
  assert(!!release, "首次加锁失败");
  const second = await acquireRecordingLock();
  assert(second === null, "并发锁未互斥");
  release?.();
  for (let attempt = 0; attempt < 20; attempt++) {
    const next = await acquireRecordingLock();
    assert(!!next, "第" + (attempt + 1) + "次释放后不能立即重获锁");
    next?.();
  }
});
for (const s of stores) s.close();
const status = document.querySelector("#result")!;
status.textContent = passed + " 项通过，" + failed + " 项失败";
status.setAttribute("data-failed", String(failed));

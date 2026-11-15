import { userFacingError } from "../lib/userFacingError";
import { parseGpxFootprints } from "../lib/gpxImport";
import { ActionMenu } from "./ActionMenu";
import { completeFootprintBackup } from "../lib/footprintBackup";
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  Download,
  Upload,
  LocateFixed,
  Pause,
  Play,
  Square,
  Trash2,
  Plus,
  RotateCcw,
  Pencil,
  X,
} from "lucide-react";
import type { Place } from "../types/place";
import type {
  FootprintRecorder,
  RecorderSnapshot,
} from "../lib/footprintRecorder";
import {
  localDate,
  parseFootprints,
  trackDistance,
  validDate,
  type FootprintTrack,
  type FootprintVisit,
} from "../lib/footprints";
import { usePanelFocus } from "../lib/usePanelFocus";
import { useToast } from "./Toast";
export interface FootprintSelection {
  id: string | null;
  date: string;
  nonce: number;
}
const time = (n: number) =>
  new Date(n).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
export function FootprintsPanel({
  active,
  recorder,
  snapshot,
  loading,
  error,
  places,
  selection,
  onSelection,
  onBack,
}: {
  onBack?: () => void;
  active: boolean;
  recorder: FootprintRecorder | null;
  snapshot: RecorderSnapshot;
  loading: boolean;
  error: string;
  places: Place[];
  selection: FootprintSelection;
  onSelection: (selection: FootprintSelection) => void;
}) {
  const ref = usePanelFocus<HTMLElement>(active);
  const visitToggle = useRef<HTMLButtonElement>(null);
  const { addToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [visitOpen, setVisitOpen] = useState(false);
  const [recorderOptionsOpen, setRecorderOptionsOpen] = useState(false);
  const [showEmptyTracks, setShowEmptyTracks] = useState(false);
  const [editingVisit, setEditingVisit] = useState<FootprintVisit | null>(null);
  const visitFormRef = useRef<HTMLFormElement>(null);
  const [placeId, setPlaceId] = useState("");
  const [visitDate, setVisitDate] = useState(localDate());
  const [note, setNote] = useState("");
  const [savingVisit, setSavingVisit] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const live = snapshot.tracks.find((t) => t.id === snapshot.activeId);
  const tracks = snapshot.tracks.filter(
    (t) => !t.deletedAt,
  );
  const onDate = (date: string) =>
    onSelection({ date, id: null, nonce: selection.nonce + 1 });
  const visibleTracks = tracks.filter(track => track.points.length > 0 || track.status === "recording" || showEmptyTracks || selection.id === track.id);
  const list = visibleTracks
    .filter(
      (t) =>
        !selection.date ||
        localDate(t.startedAt) === selection.date ||
        t.points.some((p) => localDate(p.time) === selection.date),
    )
    .sort((a, b) => b.startedAt - a.startedAt);
  const cityVisits = [...new Map(snapshot.visits.filter(v => !v.deletedAt && !!v.city).map(v => [v.city,v])).values()];
  const visits = snapshot.visits
    .filter(
      (v) => !v.deletedAt && (!selection.date || v.date === selection.date),
    )
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const selected = tracks.find((t) => t.id === selection.id);
  const [exporting, setExporting] = useState(false);
  const download = async () => {
    setExporting(true);
    try {
      await recorder?.flush();
      const latest = recorder?.getSnapshot() ?? snapshot;
      const text = completeFootprintBackup({ tracks: latest.tracks, visits: latest.visits });
      const url = URL.createObjectURL(
        new Blob([text], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "footprints-" + localDate() + ".json";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "备份未能完成，请重试",
        "error",
      );
    } finally {
      setExporting(false);
    }
  };
  const remove = async (kind: "track" | "visit", id: string) => {
    if (!recorder || !(await recorder.setDeleted(kind, id, true))) return;
    addToast("已移到最近移除，可随时恢复", "info", {
      label: "撤销",
      onClick: () => {
        void recorder.setDeleted(kind, id, false);
      },
    });
  };
  const start = async (t?: FootprintTrack) => {
    if (!recorder) return;
    await recorder.start(t?.id);
    const next = recorder.getSnapshot();
    if (next.activeId)
      onSelection({
        id: next.activeId,
        date: localDate(),
        nonce: selection.nonce + 1,
      });
  };
  const selectedPoints =
    selected?.points.filter(
      (p) => !selection.date || localDate(p.time) === selection.date,
    ) ?? [];
  return (
    <section
      className="workspace-panel footprints-panel"
      aria-label="足迹"
      hidden={!active}
      ref={ref}
    >
      <div className="panel-heading workflow-heading">
        {onBack && <button className="icon-button workflow-back" aria-label="返回地点" title="返回地点" onClick={onBack}><ChevronLeft size={18}/></button>}
        <h1>足迹</h1>
        <ActionMenu label="足迹操作" actions={[
          { label: exporting ? "导出中…" : "导出足迹", icon: <Download size={16} />, disabled: loading || !!error || exporting, onSelect: () => void download() },
          { label: importing ? "导入中…" : "导入轨迹或备份", icon: <Upload size={16} />, disabled: !recorder || importing, onSelect: () => fileRef.current?.click() },
          { label: "临时记录（仅当前页面）", icon: <Play size={16}/>, onSelect: () => setRecorderOptionsOpen(value => !value) },
          ...(tracks.some(track=>!track.points.length && track.status!=="recording") ? [{label:showEmptyTracks?"隐藏空记录":"显示空记录",onSelect:()=>setShowEmptyTracks(value=>!value)}] : []),
        ]} />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json,.gpx,application/gpx+xml"
        aria-label="选择GPX轨迹或足迹备份"
        className="footprint-file"
        onChange={async (event) => {
          const input = event.currentTarget,
            file = input.files?.[0];
          if (!file || !recorder) return;
          setImporting(true);
          setImportError("");
          try {
            if (file.size > 20_000_000)
              throw new Error("备份超过20MB，请拆分后导入");
            const text = await file.text();
            const data = file.name.toLowerCase().endsWith(".gpx") ? await parseGpxFootprints(text) : parseFootprints(text);
            const count = await recorder.importData(data);
            addToast(
              count
                ? "已导入 " + count + " 条记录"
                : "没有新记录，重复备份不会重复添加",
              "success",
            );
            onDate("");
          } catch (e) {
            setImportError(e instanceof Error && (e.name === "QuotaExceededError" || /配额|空间不足/.test(e.message))
              ? "存储空间不足，请先导出备份或清理后重试。"
              : userFacingError(e, "文件无法读取，请选择有效的 GPX 轨迹或足迹备份。原记录未改变。"));
          } finally {
            setImporting(false);
            input.value = "";
          }
        }}
      />
      {importError && <p role="alert" className="footprint-warning">{importError}</p>}
      {loading && <p role="status">正在读取足迹…</p>}
      {error && (
        <p role="alert" className="footprint-warning">
          {error}
        </p>
      )}
      {!loading && !error && (
        <>
          {!!cityVisits.length && <details className="visited-cities"><summary>已到访 {cityVisits.length} 座城市</summary><div>{cityVisits.map(v => <button className="text-action" key={v.city} onClick={() => onSelection({date:"",id:"visit:"+v.id,nonce:selection.nonce+1})}>{v.city}</button>)}</div></details>}
          {(recorderOptionsOpen || live?.status === "recording") && (
            <details className="footprint-recorder-options" open={recorderOptionsOpen || live?.status === "recording"} onToggle={event => setRecorderOptionsOpen(event.currentTarget.open)}>
              <summary>临时记录</summary>
            <div className="footprint-recorder">
              <p className="footprint-help">
                仅在此页面打开时记录，锁屏后暂停。
              </p>
              <div className="footprint-record-actions">
                {live?.status === "recording" ? (
                  <button
                    className="secondary-action"
                    onClick={() => recorder?.pause()}
                  >
                    <Pause size={16} />
                    暂停
                  </button>
                ) : (
                  <button
                    className="primary-action"
                    disabled={
                      !recorder || snapshot.busy || snapshot.storageError
                    }
                    onClick={() => void start(live)}
                  >
                    <Play size={16} />
                    {snapshot.busy
                      ? "正在启动…"
                      : live
                        ? "继续记录"
                        : "开始记录"}
                  </button>
                )}
                {live && (
                  <button
                    className="secondary-action"
                    disabled={snapshot.busy}
                    onClick={() => recorder?.finish()}
                  >
                    <Square size={14} />
                    结束
                  </button>
                )}
              </div>
              {snapshot.message && (
                <p role="status" className="footprint-message">
                  {snapshot.message}
                </p>
              )}
              {snapshot.fix && live?.status === "recording" && (
                <p className="footprint-fix" aria-live="off">
                  {now - snapshot.fix.time > 20000 ? "位置更新较慢 · " : ""}
                  精度约 {Math.round(snapshot.fix.accuracy)} 米 ·{" "}
                  {time(snapshot.fix.time)} 更新
                </p>
              )}
              {snapshot.storageError && (
                <button
                  className="text-action"
                  onClick={() => void recorder?.retrySave()}
                >
                  重试保存
                </button>
              )}
            </div>
            </details>
          )}
          {(visibleTracks.length > 0 || snapshot.visits.some(v => !v.deletedAt)) && <details className="footprint-date-filter"><summary>{selection.date || "全部时间"}</summary><div className="footprint-date">
            <label className="sr-only" htmlFor="footprint-date">筛选足迹日期</label>
            <input
              id="footprint-date"
              type="date"
              value={selection.date}
              onChange={(e) => onDate(e.target.value)}
            />
            <button
              className="text-action"
              onClick={() => onDate(selection.date ? "" : localDate())}
            >
              {selection.date ? "全部日期" : "今天"}
            </button>
          </div></details>}
          {list.length > 0 && <div className="footprint-section-heading">
            <h2>轨迹</h2>
          </div>}
          {!list.length && !visits.length && <div className="footprint-review-empty">
            <strong>{selection.date ? "这一天没有足迹" : "还没有足迹"}</strong>
            <button className="text-action" disabled={!recorder || importing} onClick={()=>fileRef.current?.click()}><Upload size={16}/>导入轨迹</button>
          </div>}
          <div className="footprint-history">
            {list.map((track) => (
              <div
                key={track.id}
                className={
                  selection.id === track.id
                    ? "footprint-history-row is-selected"
                    : "footprint-history-row"
                }
              >
                <button
                  className="footprint-history-main"
                  aria-pressed={selection.id === track.id}
                  onClick={() =>
                    onSelection({
                      ...selection,
                      id: track.id,
                      nonce: selection.nonce + 1,
                    })
                  }
                >
                  <strong>{track.name}</strong>
                  <span>
                    {new Date(track.startedAt).toLocaleDateString("zh-CN",{month:"long",day:"numeric"})} · {time(track.startedAt)}
                    {track.endedAt ? ` — ${time(track.endedAt)}` : ""}
                    {track.points.length > 0 ? ` · ${(trackDistance(track.points)/1000).toFixed(1)} 公里` : " · 无定位点"}
                  </span>
                </button>
                {track.source !== "device" && <ActionMenu label={`${track.name}操作`} actions={[
                  ...(track.status !== "completed" && (!live || live.id === track.id) ? [{label:"临时继续记录",icon:<Play size={16}/>,disabled:snapshot.busy || snapshot.storageError,onSelect:()=>{setRecorderOptionsOpen(true);void start(track);}}] : []),
                  ...(track.status !== "completed" ? [{label:"结束记录",icon:<Square size={15}/>,onSelect:()=>{void recorder?.finish(track.id);}}] : []),
                  ...(track.id !== snapshot.activeId ? [{label:"移除记录",icon:<Trash2 size={16}/>,danger:true,onSelect:()=>{void remove("track",track.id);}}] : []),
                ]}/>}
              </div>
            ))}
          </div>
          {selected && (
            <div className="footprint-track-detail">
              {selectedPoints.length > 0 ? <p>约 {(trackDistance(selectedPoints) / 1000).toFixed(2)} 公里</p>
                : <p className="footprint-help">{selected.points.length ? "这一天没有轨迹点" : selected.status === "recording" ? "等待首次定位" : "这段记录尚未采集到位置"}</p>}
              {selected.gaps.slice(-3).filter(g => selected.id !== live?.id || g.reason !== snapshot.message || (!recorderOptionsOpen && live?.status !== "recording")).map((g, i) => (
                <p className="footprint-help" key={i}>
                  {time(g.time)} {g.reason}
                </p>
              ))}
              <button
                className="text-action"
                disabled={!selectedPoints.length}
                onClick={() =>
                  onSelection({ ...selection, nonce: selection.nonce + 1 })
                }
              >
                <LocateFixed size={16} />
                查看这段轨迹
              </button>
            </div>
          )}
          <div className="footprint-section-heading">
            {visits.length > 0 && <h2>到访地点</h2>}
            <button
              className="text-action"
              ref={visitToggle}
              aria-expanded={visitOpen}
              aria-controls="footprint-visit-form"
              onClick={() => {
                setVisitOpen(!visitOpen);
                if (!visitOpen)
                  requestAnimationFrame(() =>
                    visitFormRef.current
                      ?.querySelector("select")
                      ?.focus({ preventScroll: true }),
                  );
                if (editingVisit) {
                  setEditingVisit(null);
                  setPlaceId("");
                  setNote("");
                  setVisitDate(localDate());
                }
              }}
            >
              {visitOpen ? <X size={15} /> : <Plus size={15} />}
              {visitOpen
                ? editingVisit
                  ? "取消编辑"
                  : "收起表单"
                : "补记到访"}
            </button>
          </div>
          {visitOpen && (
            <form
              ref={visitFormRef}
              id="footprint-visit-form"
              className="footprint-visit-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const p =
                  places.find((p) => p.id === placeId) ??
                  (editingVisit?.placeId === placeId
                    ? { ...editingVisit, id: editingVisit.placeId }
                    : null);
                if (
                  !p ||
                  !recorder ||
                  savingVisit ||
                  (visitDate &&
                    (!validDate(visitDate) || visitDate > localDate()))
                )
                  return;
                setSavingVisit(true);
                const saved = await recorder.saveVisit({
                  id: editingVisit?.id ?? crypto.randomUUID(),
                  placeId: p.id,
                  name: p.name,
                  city: p.city,
                  lat: p.lat,
                  lng: p.lng,
                  date: visitDate || null,
                  note: note.trim(),
                  createdAt: editingVisit?.createdAt ?? Date.now(),
                  coordinateSystem: "GCJ02",
                });
                setSavingVisit(false);
                if (saved) {
                  addToast(
                    editingVisit ? "已保存修改" : "已记录到访",
                    "success",
                  );
                  setNote("");
                  setVisitOpen(false);
                  visitToggle.current?.focus({ preventScroll: true });
                  setEditingVisit(null);
                  onDate(visitDate);
                }
              }}
            >
              <label>
                地点
                <select
                  aria-label="到访地点"
                  required
                  value={placeId}
                  onChange={(e) => setPlaceId(e.target.value)}
                >
                  <option value="">从地点库选择</option>
                  {editingVisit &&
                    !places.some((p) => p.id === editingVisit.placeId) && (
                      <option value={editingVisit.placeId}>
                        {editingVisit.city} · {editingVisit.name}（历史地点）
                      </option>
                    )}
                  {places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.city} · {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {!places.length && (
                <p className="footprint-help">
                  先到“地点”保存一个地点，再回来记录到访。
                </p>
              )}
              <label>
                到访日期
                <input
                  type="date"
                  value={visitDate}
                  max={localDate()}
                  onChange={(e) => setVisitDate(e.target.value)}
                />
              </label>
              <p className="footprint-help">
                日期留空表示日期不详；同一地点可以多次记录。
              </p>
              <label>
                备注
                <textarea
                  value={note}
                  maxLength={2000}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                />
              </label>
              <button
                className="primary-action"
                disabled={!placeId || savingVisit}
              >
                {savingVisit
                  ? "正在保存…"
                  : editingVisit
                    ? "保存修改"
                    : "保存到访"}
              </button>
            </form>
          )}
          {visits.map((v) => (
            <div className="footprint-visit-row" key={v.id}>
              <div>
                <button
                  className="footprint-visit-focus"
                  aria-label={"在地图查看到访" + v.name}
                  onClick={() =>
                    onSelection({
                      ...selection,
                      id: "visit:" + v.id,
                      nonce: selection.nonce + 1,
                    })
                  }
                >
                  <strong>{v.name}</strong>
                  <span>
                    {v.city} · {v.date ?? "日期不详"}
                  </span>
                </button>
                {v.note && <p>{v.note}</p>}
              </div>
              <button
                className="icon-button"
                aria-label={"编辑到访" + v.name}
                onClick={() => {
                  setEditingVisit(v);
                  setPlaceId(v.placeId);
                  setVisitDate(v.date ?? "");
                  setNote(v.note);
                  setVisitOpen(true);
                  requestAnimationFrame(() => {
                    visitFormRef.current?.scrollIntoView({ block: "start" });
                    visitFormRef.current
                      ?.querySelector("select")
                      ?.focus({ preventScroll: true });
                  });
                }}
              >
                <Pencil size={16} />
              </button>
              <button
                className="icon-button"
                aria-label={"移除到访" + v.name}
                onClick={() => void remove("visit", v.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {snapshot.tracks.some(t => t.deletedAt) || snapshot.visits.some(v => v.deletedAt) ? <details className="footprint-removed">
            <summary>
              最近移除（
              {snapshot.tracks.filter((t) => t.deletedAt).length +
                snapshot.visits.filter((v) => v.deletedAt).length}
              ）
            </summary>
            <p className="footprint-help">
              移除的记录保留在本机备份中，可随时恢复。
            </p>
            {snapshot.tracks
              .filter((t) => t.deletedAt)
              .map((t) => (
                <div key={t.id}>
                  <span>{t.name}</span>
                  <button
                    className="text-action"
                    onClick={() =>
                      void recorder?.setDeleted("track", t.id, false)
                    }
                  >
                    <RotateCcw size={14} />
                    恢复
                  </button>
                </div>
              ))}
            {snapshot.visits
              .filter((v) => v.deletedAt)
              .map((v) => (
                <div key={v.id}>
                  <span>{v.name}</span>
                  <button
                    className="text-action"
                    onClick={() =>
                      void recorder?.setDeleted("visit", v.id, false)
                    }
                  >
                    <RotateCcw size={14} />
                    恢复
                  </button>
                </div>
              ))}
          </details> : null}
        </>
      )}
    </section>
  );
}

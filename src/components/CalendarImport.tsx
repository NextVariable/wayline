import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { parseCalendarFile, type CalendarFilePreview } from "../lib/calendarImport";
import { planCalendarImport } from "../lib/calendarImportPlan";
import type { CalendarEntry } from "../lib/calendarEvents";

const time = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
type ImportResult = Pick<ReturnType<typeof planCalendarImport>, "added" | "updated" | "duplicates">;
export const importSummary = ({added, updated, duplicates, skipped}: ImportResult & {skipped: number}) =>
  `新增 ${added} · 更新 ${updated} · 重复 ${duplicates} · 跳过 ${skipped}`;

export function CalendarImport({existing, onImport, onDone}: {
  existing: CalendarEntry[];
  onImport: (events: CalendarEntry[]) => ImportResult;
  onDone: (events: CalendarEntry[], summary: string) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const revision = useRef(0);
  const [text, setText] = useState("");
  const [range, setRange] = useState({from: "", through: ""});
  const [preview, setPreview] = useState<CalendarFilePreview>();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const chosen = preview?.events.filter(event => selected.includes(event.id)) ?? [];
  const plan = planCalendarImport(existing, chosen);
  const skipped = preview ? preview.skipped + preview.outside + preview.events.length - chosen.length : 0;

  function read(content: string, {from, through} = range) {
    try {
      const result = parseCalendarFile(content, from, through);
      setPreview(result);
      setSelected(result.events.map(event => event.id));
      setError("");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "日历无法读取");
      setPreview(undefined);
      setSelected([]);
    }
  }

  function changeRange(next: typeof range) {
    setRange(next);
    read(text, next);
  }

  return <section className="calendar-import-panel" aria-label="导入日历文件">
    <button type="button" className="secondary-action" onClick={() => file.current?.click()}><Upload size={16} />选择日历文件</button>
    <input hidden ref={file} type="file" accept=".ics,text/calendar" aria-label="选择日历文件" onChange={async event => {
      const picked = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!picked) return;
      const current = ++revision.current;
      setText("");
      setPreview(undefined);
      setSelected([]);
      setRange({from: "", through: ""});
      setError("");
      if (picked.size > 2_000_000) { setError("日历文件超过 2 MB，请分别导出"); return; }
      try {
        const content = await picked.text();
        if (current !== revision.current) return;
        setText(content);
        read(content, {from: "", through: ""});
      } catch { if (current === revision.current) setError("无法读取文件，请重新选择日历文件"); }
    }} />
    {text && <details className="calendar-import-range">
      <summary>导入范围 · {range.from || "不限开始日期"} 至 {range.through || "不限结束日期"}</summary>
      <div className="calendar-range">
        <label>从<input type="date" aria-label="日历导入开始日期" value={range.from} onChange={event => changeRange({...range, from: event.target.value})} /></label>
        <label>至<input type="date" aria-label="日历导入结束日期" value={range.through} onChange={event => changeRange({...range, through: event.target.value})} /></label>
      </div>
    </details>}
    {preview && <>
      <p className="field-help" role="status">
        文件中读到 {preview.readCount} 条记录{preview.outside > 0 ? ` · 至少 ${preview.outside} 条在范围外` : ""}
        <br />{importSummary({...plan, duplicates: plan.duplicates + preview.fileDuplicates, skipped})}
      </p>
      {preview.recurrenceThrough && <p className="field-help">重复日程展开至 {preview.recurrenceThrough}，更远的日期可通过调整范围导入。</p>}
      {preview.events.length > 0 ? <>
        <div className="calendar-selection">
          <span>选择要导入的日程</span>
          <button type="button" className="text-action" onClick={() => setSelected(selected.length === preview.events.length ? [] : preview.events.map(event => event.id))}>{selected.length === preview.events.length ? "取消全选" : "全选"}</button>
        </div>
        <div className="calendar-preview">{preview.events.map(event => <label key={event.id}>
          <input type="checkbox" checked={selected.includes(event.id)} onChange={change => setSelected(ids => change.target.checked ? [...ids, event.id] : ids.filter(id => id !== event.id))} />
          <span><strong>{event.title}</strong><small>{event.allDay ? `${event.start} · 全天` : time.format(new Date(event.start))}</small>
            {event.location.trim() && event.location.trim() !== event.title.trim() && <small>{event.location}</small>}
          </span>
        </label>)}</div>
        {plan.changes.length === 0 && selected.length > 0 && <p className="field-help">所选日程已存在，无需再次导入。</p>}
        <button type="button" className="primary-action" disabled={plan.changes.length === 0} onClick={() => {
          try {
            const result = onImport(chosen);
            onDone(chosen, importSummary({...result, duplicates: result.duplicates + preview.fileDuplicates, skipped}));
          } catch { setError("保存失败，原记录未改变，请重试"); }
        }}>确认导入</button>
      </> : <p role="status">所选范围内没有可导入日程。</p>}
      {!!preview.warnings.length && <details><summary>{preview.warnings.length} 条日程无法读取</summary>{preview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
    </>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}

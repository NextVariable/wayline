import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { parseCalendarFile } from "../lib/calendarImport";
import { localDay } from "../lib/quickIntent";
import type { CalendarEntry } from "../lib/calendarEvents";

const time = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export function CalendarImport({ onChange, onDone }: { onChange: (events: CalendarEntry[]) => void; onDone: (events: CalendarEntry[]) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [from, setFrom] = useState(localDay);
  const [through, setThrough] = useState(() => {
    const later = new Date();
    later.setDate(later.getDate() + 90);
    return localDay(later);
  });
  const [preview, setPreview] = useState<CalendarEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");

  function read(content: string, start = from, end = through) {
    setWarnings([]);
    try {
      const result = parseCalendarFile(content, start, end);
      setPreview(result.events);
      setSelected(result.events.map(event => event.id));
      setWarnings(result.warnings);
      setError("");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "日历无法读取");
      setPreview([]);
      setSelected([]);
    }
  }

  return <section className="calendar-import-panel" aria-label="导入日历文件">
    <button type="button" className="secondary-action" onClick={() => file.current?.click()}><Upload size={16} />选择日历文件</button>
    <input hidden ref={file} type="file" accept=".ics,text/calendar" aria-label="选择日历文件" onChange={async event => {
      const chosen = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!chosen) return;
      setText("");
      setPreview([]);
      setSelected([]);
      setWarnings([]);
      if (chosen.size > 2_000_000) { setError("日历文件超过 2MB，请分别导出"); return; }
      try {
        const content = await chosen.text();
        setText(content);
        read(content);
      } catch { setError("无法读取文件，请重新选择日历文件"); }
    }} />
    {text && <details className="calendar-import-range">
      <summary>导入范围 · {from} 至 {through}</summary>
      <div className="calendar-range">
        <label>从<input type="date" aria-label="日历导入开始日期" value={from} onChange={event => { setFrom(event.target.value); read(text, event.target.value, through); }} /></label>
        <label>至<input type="date" aria-label="日历导入结束日期" value={through} onChange={event => { setThrough(event.target.value); read(text, from, event.target.value); }} /></label>
      </div>
    </details>}
    {preview.length > 0 && <>
      <div className="calendar-selection">
        <span>选择要导入的事件</span>
        <button type="button" className="text-action" onClick={() => setSelected(selected.length === preview.length ? [] : preview.map(event => event.id))}>{selected.length === preview.length ? "取消全选" : "全选"}</button>
      </div>
      <div className="calendar-preview">{preview.map(event => <label key={event.id}>
        <input type="checkbox" checked={selected.includes(event.id)} onChange={change => setSelected(ids => change.target.checked ? [...ids, event.id] : ids.filter(id => id !== event.id))} />
        <span><strong>{event.title}</strong><small>{event.allDay ? `${event.start} · 全天` : time.format(new Date(event.start))}</small>
          {event.location.trim() && event.location.trim() !== event.title.trim() && <small>{event.location}</small>}
        </span>
      </label>)}</div>
      <button type="button" className="primary-action" disabled={!selected.length} onClick={() => {
        try {
          const chosen = preview.filter(event => selected.includes(event.id));
          onChange(chosen);
          onDone(chosen);
        } catch (issue) { setError(issue instanceof Error ? issue.message : "保存失败，原记录未改变"); }
      }}>导入 {selected.length} 条事件</button>
    </>}
    {text && !preview.length && !error && <p role="status">所选范围内没有可导入事件。</p>}
    {!!warnings.length && <details><summary>{warnings.length} 条事件无法导入</summary>{warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}

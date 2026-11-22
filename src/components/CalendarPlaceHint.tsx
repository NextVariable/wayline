import { useRef, useState, type FormEvent } from "react";
import { MapPin } from "lucide-react";
import type { CalendarEntry } from "../lib/calendarEvents";
import type { Place } from "../types/place";

type Props = {
  pending: CalendarEntry[];
  onConfirm: (eventId: string, place: Place) => void;
  onAccept: (eventId: string) => void;
  onReject: (eventId: string) => void;
  onIgnore: (eventId: string) => void;
  onSearch: (text: string) => Promise<Place[]>;
  /** Tests render the open list directly. */
  initiallyOpen?: boolean;
};

const when = (e: CalendarEntry) => {
  const d = new Date(e.start);
  const day = e.allDay && /^\d{4}-\d{2}-\d{2}$/.test(e.start) ? e.start.slice(5).replace("-", "/") : `${d.getMonth() + 1}/${d.getDate()}`;
  return e.allDay ? day : `${day} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function SearchPlace({ event, onSearch, onConfirm }: { event: CalendarEntry; onSearch: Props["onSearch"]; onConfirm: Props["onConfirm"] }) {
  const [results, setResults] = useState<Place[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (form: FormEvent<HTMLFormElement>) => {
    form.preventDefault();
    const text = String(new FormData(form.currentTarget).get("q") ?? "").trim();
    if (!text) return;
    setBusy(true);
    setFailed(false);
    setResults(null);
    try { setResults(await onSearch(text)); } catch { setFailed(true); } finally { setBusy(false); }
  };
  return <>
    <form className="calendar-hint-search" role="search" onSubmit={submit}>
      <input type="search" name="q" defaultValue={event.location} placeholder="搜索地点" aria-label={`为「${event.title}」搜索地点`} />
      <button type="submit" disabled={busy}>{busy ? "搜索中" : "搜索"}</button>
    </form>
    {failed && <p className="calendar-hint-empty" role="status">地点搜索暂不可用，请重试</p>}
    {results && (results.length
      ? <div className="calendar-hint-choices">{results.slice(0, 5).map(place =>
 <button key={place.id} type="button" onClick={() => onConfirm(event.id, place)}>{place.name}{(place.address || place.city) && <small>{[place.city, place.address].filter(Boolean).join(" · ")}</small>}</button>)}</div>
      : <p className="calendar-hint-empty" role="status">没有找到</p>)}
  </>;
}

/** A quiet corner note: the count only, opened on demand. No popups, no explanations. */
export function CalendarPlaceHint({ pending, onConfirm, onAccept, onReject, onIgnore, onSearch, initiallyOpen = false }: Props) {
  const [open, setOpen] = useState(initiallyOpen);
  const toggle=useRef<HTMLButtonElement>(null);
  const complete=(id:string,action:()=>void)=>{
    action();
    requestAnimationFrame(()=>{
      if (toggle.current) { toggle.current.focus({preventScroll:true}); return; }
      const stop=Array.from(document.querySelectorAll<HTMLButtonElement>("[data-calendar-stop]"))
        .find(button=>button.dataset.calendarStop===id);
      (stop ?? document.querySelector<HTMLButtonElement>(".today-panel .text-action"))?.focus({preventScroll:true});
    });
  };
  if (!pending.length) return null;
  return <section className={`calendar-place-hint${open ? " is-open" : ""}`} aria-label="没有地点的日程"
      onKeyDown={event=>{ if (event.key==="Escape" && open) { event.stopPropagation(); setOpen(false); toggle.current?.focus(); } }}>
    <button type="button" ref={toggle} className="calendar-hint-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <MapPin size={15} aria-hidden="true" />{pending.length} 个日程没有地点
    </button>
    {open && <ul className="calendar-hint-list">
      {pending.map(e => {
 const r = e.placeResolution;
        return <li key={JSON.stringify([e.id, e.location])}>
   <div className="calendar-hint-event">
            <strong>{e.title}</strong>
     <span><time dateTime={e.start}>{when(e)}</time>{e.location && <span className="calendar-hint-text">{e.location}</span>}</span>
          </div>
   {r?.status === "ask" && r.suggestion && <div className="calendar-hint-ask">
     <span>还是那里吗？{r.suggestion.name}</span>
            <div className="calendar-hint-choices">
<button type="button" onClick={() => complete(e.id,()=>onAccept(e.id))}>是</button>
       <button type="button" onClick={() => onReject(e.id)}>不是</button>
     </div>
          </div>}
   {r?.status === "ambiguous" && <div className="calendar-hint-choices">
     {(r.candidates ?? []).map(place => <button key={place.id} type="button" onClick={() => complete(e.id,()=>onConfirm(e.id,place))}>{place.name}{(place.address || place.city) && <small>{[place.city, place.address].filter(Boolean).join(" · ")}</small>}</button>)}
          </div>}
          {(!r || r.status === "none" || r?.status === "missing" || r?.status === "ambiguous") && <SearchPlace event={e} onSearch={onSearch} onConfirm={(id,place)=>complete(id,()=>onConfirm(id,place))} />}
   <button type="button" className="calendar-hint-ignore" onClick={() => complete(e.id,()=>onIgnore(e.id))}>忽略</button>
 </li>;
      })}
    </ul>}
  </section>;
}

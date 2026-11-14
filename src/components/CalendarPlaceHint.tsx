import { useState, type FormEvent } from "react";
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
  const day = `${d.getMonth() + 1}/${d.getDate()}`;
  return e.allDay ? day : `${day} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function SearchPlace({ event, onSearch, onConfirm }: { event: CalendarEntry; onSearch: Props["onSearch"]; onConfirm: Props["onConfirm"] }) {
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (form: FormEvent<HTMLFormElement>) => {
    form.preventDefault();
    const text = String(new FormData(form.currentTarget).get("q") ?? "").trim();
    if (!text) return;
    setBusy(true);
    try { setResults(await onSearch(text)); } catch { setResults([]); } finally { setBusy(false); }
  };
  return <>
    <form className="calendar-hint-search" role="search" onSubmit={submit}>
      <input type="search" name="q" defaultValue={event.location} placeholder="搜索地点" aria-label={`为「${event.title}」搜索地点`} />
      <button type="submit" disabled={busy}>{busy ? "搜索中" : "搜索"}</button>
    </form>
    {results && (results.length
      ? <div className="calendar-hint-choices">{results.slice(0, 5).map(place =>
 <button key={place.id} type="button" onClick={() => onConfirm(event.id, place)}>{place.name}</button>)}</div>
      : <p className="calendar-hint-empty" role="status">没有找到</p>)}
  </>;
}

/** A quiet corner note: the count only, opened on demand. No popups, no explanations. */
export function CalendarPlaceHint({ pending, onConfirm, onAccept, onReject, onIgnore, onSearch, initiallyOpen = false }: Props) {
  const [open, setOpen] = useState(initiallyOpen);
  if (!pending.length) return null;
  return <section className={`calendar-place-hint${open ? " is-open" : ""}`} aria-label="没有地点的日程">
    <button type="button" className="calendar-hint-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <MapPin size={15} aria-hidden="true" />{pending.length} 个日程没有地点
    </button>
    {open && <ul className="calendar-hint-list">
      {pending.map(e => {
 const r = e.placeResolution;
        return <li key={e.id}>
   <div className="calendar-hint-event">
            <strong>{e.title}</strong>
     <span><time dateTime={e.start}>{when(e)}</time>{e.location && <span className="calendar-hint-text">{e.location}</span>}</span>
          </div>
   {r?.status === "ask" && r.suggestion && <div className="calendar-hint-ask">
     <span>还是那里吗？{r.suggestion.name}</span>
            <div className="calendar-hint-choices">
<button type="button" onClick={() => onAccept(e.id)}>是</button>
       <button type="button" onClick={() => onReject(e.id)}>不是</button>
     </div>
          </div>}
   {r?.status === "ambiguous" && <div className="calendar-hint-choices">
     {(r.candidates ?? []).map(place => <button key={place.id} type="button" onClick={() => onConfirm(e.id, place)}>{place.name}</button>)}
          </div>}
          {(r?.status === "none" || r?.status === "missing" || r?.status === "ambiguous") && <SearchPlace event={e} onSearch={onSearch} onConfirm={onConfirm} />}
   <button type="button" className="calendar-hint-ignore" onClick={() => onIgnore(e.id)}>忽略</button>
 </li>;
      })}
    </ul>}
  </section>;
}

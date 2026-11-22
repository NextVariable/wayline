import { useEffect, useRef, useState } from "react";
import type { BusinessTrip } from "../lib/businessTrips";
import { fetchLeg, type LegResult } from "../lib/useTodayLegs";
import { legPairs, modeName, type TravelMode } from "../lib/todayMap";
import { routeMapLink } from "../lib/navigationLinks";

const queryTime = new Intl.DateTimeFormat("zh-CN", {hour:"2-digit", minute:"2-digit", hour12:false});

export type CommuteChoice = { id:string; mode:TravelMode };

export function BusinessTripCommute({ trip, onRoute, initialChoice, onNavigate }: {
  trip: BusinessTrip;
  initialChoice?: CommuteChoice;
  onNavigate: (choice:CommuteChoice) => void;
  onRoute: (route: { id:string; points:LegResult["points"]; late:false } | null) => void;
}) {
  const [selection, setSelection] = useState<(CommuteChoice & { result?:LegResult|null }) | undefined>(initialChoice);
  const latestRoute = useRef(onRoute);
  latestRoute.current = onRoute;
  useEffect(() => {
    const retry = () => setSelection(current => current?.result === null ? {id:current.id,mode:current.mode} : current);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);
  useEffect(() => {
    if (!selection || selection.result !== undefined) return;
    const pair = trip.days.flatMap(day => legPairs(day.events, day.date)).find(pair => pair.id === selection.id);
    if (!pair) return;
    const controller = new AbortController();
    void fetchLeg(pair, selection.mode, { signal:controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setSelection({ ...selection, result });
      latestRoute.current(result ? { id:pair.id, points:result.points, late:false } : null);
    });
    return () => controller.abort();
  }, [trip, selection]);
  return <>{trip.days.flatMap(day => legPairs(day.events, day.date)).filter(pair => !pair.crossCity && !pair.sameSpot)
    .map(pair => {
      const current = selection?.id === pair.id ? selection : undefined;
      const link = current && routeMapLink(pair.from.place, pair.to.place, current.mode);
      return <section className="business-trip-day" key={pair.id}>
        <h3>{pair.from.place.name} → {pair.to.place.name}</h3>
        <div className="business-trip-modes">
          {(["walking","transit","selfDrive"] as const).map(mode => <button key={mode} type="button" className="text-action"
            aria-pressed={current?.mode === mode} disabled={current?.mode === mode && current.result === undefined} onClick={() => { onRoute(null); setSelection({id:pair.id, mode}); }}>
            {mode === "selfDrive" ? "驾车" : modeName(mode)}</button>)}
        </div>
        {current && <small role="status">{current.result === undefined ? "查询中…" : current.result ?
          `约 ${current.result.minutes} 分钟 · 高德${current.result.observedAt ? ` ${queryTime.format(current.result.observedAt)} 查询` : "查询参考"}` : "暂未查到路线"} {current.result && link &&
          <a className="business-commute-navigation" href={link.href} target={link.target} rel="noreferrer" onClick={() => { if (!link.target) onNavigate({ id:pair.id, mode:current.mode }); }}>导航</a>}</small>}
      </section>;
    })}</>;
}

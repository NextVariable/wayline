import { useEffect, useRef, useState } from "react";
import type { Trip } from "../lib/tripDomain";
import { assessCommute, isCurrentRoute, type Freshness } from "../lib/tripFeasibility";
import { fetchLeg, type LegResult } from "../lib/useTodayLegs";
import { placePairKey, type TravelMode } from "../lib/todayMap";
import { routeMapLink } from "../lib/navigationLinks";
import { sourceLabel } from "../lib/smartRoutes";
import { RouteLeg } from "./RouteLeg";

export type CommuteChoice = { id:string; mode:TravelMode };

export function BusinessTripCommute({ trip, onRoute, initialChoice, onNavigate, freshness, bufferOverrides = {} }: {
  trip: Trip;
  freshness:Freshness;
  initialChoice?: CommuteChoice;
  onNavigate: (choice:CommuteChoice) => void;
  onRoute: (route: { id:string; points:LegResult["points"]; late:boolean } | null) => void;
  bufferOverrides?: Record<string,number>;
}) {
  const [selection, setSelection] = useState<(CommuteChoice & { result?:LegResult|null }) | undefined>(initialChoice);
  const latestRoute = useRef(onRoute);
  latestRoute.current = onRoute;
  useEffect(() => {
    const retry = () => setSelection(current => current?.result === null ? {id:current.id,mode:current.mode} : current);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);
  const segment = selection && trip.segments.find(segment => segment.kind === "commute" && segment.id === selection.id);
  const pair = segment?.kind === "commute" ? segment.pair : undefined;
  const result = selection?.result;
  const assessment = pair && selection && result
    ? assessCommute(pair,[result],selection.mode,freshness,{ bufferOverride:bufferOverrides[placePairKey(pair)] })
    : undefined;
  const plan = assessment?.plan;
  const risk = assessment?.risk;
  const activeId = pair?.id;
  const late = plan?.status === "insufficient" || plan?.status === "overlap";
  useEffect(() => {
    latestRoute.current(result && activeId && isCurrentRoute(result,freshness.now) ? {id:activeId,points:result.points,late} : null);
  }, [result, activeId, late, freshness.now]);
  useEffect(() => {
    if (!pair || !selection || selection.result !== undefined) return;
    const controller = new AbortController();
    void fetchLeg(pair, selection.mode, { signal:controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setSelection({ ...selection, result });

    });
    return () => controller.abort();
  }, [pair, selection]);
  const links = trip.segments.flatMap(segment => segment.kind === "commute" && !segment.pair.sameSpot ? [segment.pair] : []);
  if (!links.length) return null;
  return <section className="business-trip-connections">
    <h2>路段</h2>
    {links.map(pair => {
      const current = selection?.id === pair.id ? selection : undefined;
      const currentPlan = current ? plan : undefined;
      const routeRisk = current ? risk : undefined;
      const link = current?.result ? routeMapLink(pair.from.place, pair.to.place, current.mode) : null;
      return <div className="trip-leg-row" key={pair.id}>
        <p className="trip-leg-route">{pair.from.place.name}<span aria-hidden="true"> → </span>{pair.to.place.name}</p>
        <RouteLeg
          mode={current?.mode ?? "transit"}
          minutes={current?.result?.minutes}
          plan={currentPlan}
          loading={Boolean(current && current.result === undefined)}
          failed={Boolean(current && current.result === null)}
          focused={Boolean(current)}
          risk={routeRisk}
          source={current?.result ? sourceLabel(current.result, current.mode) : undefined}
          observedAt={current?.result?.observedAt}
          bufferOverride={pair ? bufferOverrides[placePairKey(pair)] : undefined}
          options={(["walking","transit","driving","selfDrive"] as const).map(mode => ({
            mode,
            minutes: mode === current?.mode ? current?.result?.minutes : undefined,
          }))}
          onChooseMode={mode => { onRoute(null); setSelection({ id: pair.id, mode }); }}
          onRetry={() => { onRoute(null); setSelection({ id: pair.id, mode: current?.mode ?? "transit" }); }}
          onToggle={open => { if (!open) onRoute(null); }}
          navigation={link ? { href: link.href, label: "导航", target: link.target } : null}
          onNavigate={() => { if (current && !link?.target) onNavigate({ id: pair.id, mode: current.mode }); }}
          note={current?.result?.source === "synthetic"
            ? <p className="leg-note">演示路线 · 仅供体验。</p>
            : null}
        />
      </div>;
    })}
  </section>;
}

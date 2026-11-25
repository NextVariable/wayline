import { useEffect, useMemo, useRef, useState } from "react";
import type { Trip } from "../lib/tripDomain";
import { assessCommute, type Freshness } from "../lib/tripFeasibility";
import { pairDeparture, useTodayLegs, type LegResult } from "../lib/useTodayLegs";
import { placePairKey, routeProviderMode, type TodayLegPair, type TravelMode } from "../lib/todayMap";
import { routeMapLink } from "../lib/navigationLinks";
import { roadAccessMode, sourceLabel, type RoadAccessMode } from "../lib/smartRoutes";
import { copilotCommute, type CopilotCommuteInput } from "../lib/aiContext";
import { demoLegResults } from "../lib/demoWorkspace";
import { RouteLeg } from "./RouteLeg";

export type CommuteChoice = { id:string; mode:TravelMode };

export function BusinessTripCommute({ trip, onRoute, initialChoice, onNavigate, freshness, owner, bufferOverrides = {}, accessOverrides, onBufferChange, onAccessChange, onAssessment }: {
  trip: Trip;
  freshness:Freshness;
  owner:string;
  accessOverrides?: Partial<Record<RoadAccessMode, number>>;
  onAssessment?: (commute:CopilotCommuteInput | undefined) => void;
  onAccessChange?: (mode:RoadAccessMode, minutes:number | undefined) => void;
  onBufferChange?: (pair:TodayLegPair, minutes:number | undefined) => void;
  initialChoice?: CommuteChoice;
  onNavigate: (choice:CommuteChoice) => void;
  onRoute: (route: { id:string; points:LegResult["points"]; late:boolean } | null) => void;
  bufferOverrides?: Record<string,number>;
}) {
  const [selection, setSelection] = useState<CommuteChoice | undefined>(initialChoice);
  const [retry,setRetry] = useState(0);
  const latestRoute = useRef(onRoute);
  latestRoute.current = onRoute;
  const segment = selection && trip.segments.find(segment => segment.kind === "commute" && segment.id === selection.id);
  const pair = segment?.kind === "commute" ? segment.pair : undefined;
  const {legs,loading} = useTodayLegs({
    pairs: pair && !owner.startsWith("demo:") ? [pair] : [], owner, retryCount:retry,
    choices:pair && selection ? {[pair.id]:selection.mode} : {}, compare:pair?.id,
  });
  const demo = owner.startsWith("demo:");
  const demonstration = useMemo(() => pair && demo ? demoLegResults([pair],freshness.now)[pair.id] : undefined, [pair,demo,freshness.now]);
  const values = pair ? demonstration ?? legs[pair.id] : undefined;
  const result = selection && (values?.[selection.mode] ?? values?.[routeProviderMode(selection.mode)]);
  const safety = pair ? bufferOverrides[placePairKey(pair)] : undefined;
  const access = selection && roadAccessMode(selection.mode) ? accessOverrides?.[selection.mode] : undefined;
  const assessment = useMemo(() => pair && selection
    ? assessCommute(pair,Object.values(values ?? {}),selection.mode,freshness,{bufferOverride:safety,accessOverride:access})
    : undefined, [pair,selection,values,freshness,safety,access]);
  const reportAssessment=useRef(onAssessment);
  reportAssessment.current=onAssessment;
  useEffect(() => {
    reportAssessment.current?.(pair && assessment ? copilotCommute(pair,assessment.plan,result) : undefined);
  },[pair,assessment,result]);
  const plan = assessment?.plan;
  const risk = assessment?.risk;
  const activeId = pair?.id;
  const routeState = plan?.routeState;
  const late = plan?.status === "insufficient" || plan?.status === "overlap";
  useEffect(() => {
    latestRoute.current(result && activeId && (routeState === "fresh" || routeState === "reference")
      ? {id:activeId,points:result.points,late} : null);
  }, [result, activeId, late, routeState]);
  const links = trip.segments.flatMap(segment => segment.kind === "commute" && !segment.pair.sameSpot ? [segment.pair] : []);
  if (!links.length) return null;
  return <section className="business-trip-connections">
    <h2>路段</h2>
    {links.map(pair => {
      const current = selection?.id === pair.id ? selection : undefined;
      const currentPlan = current ? plan : undefined;
      const routeRisk = current ? risk : undefined;
      const currentResult = current ? result : undefined;
      const link = current && currentResult ? routeMapLink(pair.from.place, pair.to.place, current.mode) : null;
      return <div className="trip-leg-row" key={pair.id}>
        <p className="trip-leg-route">{pair.from.place.name}<span aria-hidden="true"> → </span>{pair.to.place.name}</p>
        <RouteLeg
          mode={current?.mode ?? "transit"}
          minutes={currentResult?.minutes}
          plan={currentPlan}
          loading={Boolean(current && loading && !currentResult)}
          failed={Boolean(current && !loading && !currentResult && !owner.startsWith("demo:"))}
          focused={Boolean(current)}
          risk={routeRisk}
          source={current && currentResult ? sourceLabel(currentResult, current.mode) : undefined}
          observedAt={currentResult?.observedAt}
          plannedAt={pairDeparture(pair)}
          bufferOverride={pair ? bufferOverrides[placePairKey(pair)] : undefined}
          options={(["walking","transit","driving","selfDrive"] as const).map(mode => ({
            mode,
            minutes: current ? (values?.[mode] ?? values?.[routeProviderMode(mode)])?.minutes : undefined,
          }))}
          onChooseMode={mode => { onRoute(null); setSelection({ id: pair.id, mode }); }}
          accessOverride={current && roadAccessMode(current.mode) ? accessOverrides?.[current.mode] : undefined}
          onBufferChange={onBufferChange && (minutes => onBufferChange(pair,minutes))}
          onAccessChange={onAccessChange}
          onRetry={() => { setSelection({ id: pair.id, mode: current?.mode ?? pair.defaultMode }); setRetry(value => value+1); }}
          onToggle={open => {
            if (open && !current) setSelection({id:pair.id,mode:pair.defaultMode});
            if (!open && current) { setSelection(undefined); onRoute(null); }
          }}
          navigation={link ? { href: link.href, label: "导航", target: link.target } : null}
          onNavigate={() => { if (current && !link?.target) onNavigate({ id: pair.id, mode: current.mode }); }}
          note={demo && !currentResult ? <p className="leg-note">此段暂无演示路线。</p> : null}
        />
      </div>;
    })}
  </section>;
}

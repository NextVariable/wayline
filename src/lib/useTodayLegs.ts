import { useEffect, useRef, useState } from "react";
import { apiEndpoint } from "./apiEndpoint";
import { normalizeRouteEvidence } from "./plannerEvidence";
import { judgeLeg, routeProviderMode, type LegOption, type TodayLegPair, type TravelMode } from "./todayMap";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type LegResult = LegOption & { points: { latitude: number; longitude: number }[]; observedAt?: number };
type Legs = Record<string, Partial<Record<TravelMode, LegResult>>>;
const emptyLegs: Legs = {};
export const ALL_MODES: TravelMode[] = ["walking", "transit", "driving"];

/**
 * One leg, one mode. Public transport needs a departure time, so it leaves when the previous event ends.
 * A failure of any kind is null: the leg stays "not looked up" and is never shown as late.
 */
export async function fetchLeg(pair: TodayLegPair, mode: TravelMode, { fetchImpl = fetch, signal }: { fetchImpl?: FetchLike; signal?: AbortSignal } = {}): Promise<LegResult | null> {
  try {
    const response = await fetchImpl(apiEndpoint("route"), {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({
        places: [pair.from.place, pair.to.place].map(({ id, name, lat, lng }) => ({ id, name, lat, lng })),
        mode: routeProviderMode(mode), ...(mode === "transit" ? { departure: pair.from.event.end } : {}),
      }),
    });
    if (!response.ok) return null;
    const evidence = normalizeRouteEvidence(await response.json());
    if (evidence?.mode !== routeProviderMode(mode) || evidence.legs.length !== 1) return null;
    const [leg] = evidence.legs;
    if (leg.points.length < 2 || (leg.distance > 0 && leg.duration === 0)) return null;
    return { mode, minutes: Math.ceil(leg.duration / 60), source: "amap", points: leg.points, observedAt: evidence.observedAt };
  } catch {
    return null;
  }
}

interface RunInput {
  pairs: TodayLegPair[];
  choices: Record<string, TravelMode>;
  onLeg: (pairId: string, mode: TravelMode, leg: LegResult | null) => void;
}

/**
 * Looks up the day with as few requests as it can: each leg once in the mode in use, and only a leg that turns out
 * late is looked up in the other two modes, so a fix can be suggested. Successes are remembered for the page's life;
 * failures are not, so the next run tries again.
 */
export function createTodayLegsRunner({ fetchImpl = fetch }: { fetchImpl?: FetchLike } = {}) {
  const done = new Map<string, LegResult>();
  let active: AbortController | null = null;
  const cancel = () => { active?.abort(); active = null; };
  const key = (pair: TodayLegPair, mode: TravelMode) => JSON.stringify([
    ...[pair.from.place, pair.to.place].map(p => [p.id, p.city, p.lat, p.lng]),
    routeProviderMode(mode), mode === "transit" ? pair.from.event.end : null,
  ]);
  return {
    cancel,
    async run({ pairs, choices, onLeg }: RunInput) {
      cancel();
      const controller = new AbortController();
      active = controller;
      const live = () => active === controller && !controller.signal.aborted;
      const look = async (pair: TodayLegPair, mode: TravelMode) => {
        const cached = done.get(key(pair, mode));
        const leg = cached ? (cached.mode === mode ? cached : { ...cached, mode }) : await fetchLeg(pair, mode, { fetchImpl, signal: controller.signal });
        if (!live()) return null;
        if (leg) {
          done.set(key(pair, mode), leg);
          if (done.size > 96) done.delete(done.keys().next().value!);
        }
        onLeg(pair.id, mode, leg);
        return leg;
      };
      await Promise.all(pairs.filter(pair => !pair.sameSpot).map(async pair => {
        const chosen = choices[pair.id] ?? pair.defaultMode;
        const first = await look(pair, chosen);
        if (!first || !live() || judgeLeg(pair, [first], chosen).status !== "late") return;
        await Promise.all(ALL_MODES.filter(mode => mode !== routeProviderMode(chosen)).map(mode => look(pair, mode)));
      }));
      if (active === controller) active = null;
    },
  };
}

/** Looks up the day's legs as the events or the chosen modes change; results from an older day or choice never land. */
export function useTodayLegs({ pairs, choices, owner, retryCount }: {
  pairs: TodayLegPair[]; choices: Record<string, TravelMode>; owner: string; retryCount: number;
}) {
  const runner = useRef<{ owner: string; lookup: ReturnType<typeof createTodayLegsRunner> } | null>(null);
  const [result, setResult] = useState<{ signature: string; legs: Legs; pending: boolean }>();
  const signature = JSON.stringify([owner, pairs.map(p => [
    p.id, ...[p.from.place, p.to.place].map(place => [place.id, place.city, place.lat, place.lng]),
    p.from.event.end, p.to.event.start, p.sameSpot, p.defaultMode,
  ])]);
  const chosenModes = JSON.stringify(choices);
  const hasRoutes = pairs.some(pair => !pair.sameSpot);
  const input = useRef({ pairs, choices });
  input.current = { pairs, choices };
  useEffect(() => {
    if (!hasRoutes) return;
    if (runner.current?.owner !== owner) runner.current = { owner, lookup: createTodayLegsRunner() };
    const current = runner.current.lookup;
    let live = true;
    setResult(old => ({ signature, legs: old?.signature === signature ? old.legs : emptyLegs, pending: true }));
    void current.run({
      ...input.current,
      onLeg: (id, mode, leg) => {
        if (live) setResult(old => {
          if (old?.signature !== signature || old.legs[id]?.[mode] === (leg ?? undefined)) return old;
          return { ...old, legs: { ...old.legs, [id]: { ...old.legs[id], [mode]: leg ?? undefined } } };
        });
      },
    }).then(() => {
      if (live) setResult(old => old?.signature === signature ? { ...old, pending: false } : old);
    });
    return () => { live = false; current.cancel(); };
  }, [signature, chosenModes, retryCount, owner, hasRoutes]);
  return { legs: result?.signature === signature ? result.legs : emptyLegs,
    loading: hasRoutes && (result?.signature !== signature || result.pending) };
}

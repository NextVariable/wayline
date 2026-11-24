import { useEffect, useRef, useState } from "react";
import { apiEndpoint } from "./apiEndpoint";
import type { Place, RouteEvidence } from "./tripDomain";
import { normalizeRouteEvidence } from "./plannerEvidence";
import { routeProviderMode, type TodayLegPair, type TravelMode } from "./todayMap";
import { ROUTE_TTLS, assessLeg, isFutureLeg } from "./smartRoutes";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type LegResult = RouteEvidence;
type Legs = Record<string, Partial<Record<TravelMode, LegResult>>>;
const emptyLegs: Legs = {};
export const ALL_MODES: TravelMode[] = ["walking", "transit", "driving"];

/**
 * 仅用于演示/验收的合成路线。必须由测试或演示显式注入，界面上始终标注「合成演示路线」，
 * 不会被当作高德真实结果。
 */
export type SyntheticRoutes =
  | Record<string, number>
  | ((input: { fromId: string; toId: string; mode: string; departure?: string }) => number | undefined);
declare global {
  interface Window { __WAYLINE_SYNTHETIC_ROUTES__?: SyntheticRoutes }
}
function syntheticMinutes(places: [Place, Place], mode: TravelMode, departure?: string) {
  if (typeof window === "undefined") return undefined;
  const table = window.__WAYLINE_SYNTHETIC_ROUTES__;
  if (!table) return undefined;
  const providerMode = routeProviderMode(mode);
  if (typeof table === "function") return table({ fromId: places[0].id, toId: places[1].id, mode: providerMode, departure });
  return table[`${places[0].id}>${places[1].id}:${providerMode}`] ?? table[`${places[0].name}>${places[1].name}:${providerMode}`];
}

/**
 * One leg, one mode. Public transport needs a departure time, so it leaves when the previous event ends.
 * A failure of any kind is null: the leg stays "not looked up" and is never shown as late.
 */
type LookupOptions = {fetchImpl?:FetchLike; signal?:AbortSignal};

export function fetchLeg(pair: TodayLegPair, mode: TravelMode, options?:LookupOptions) {
  return fetchRoute([pair.from.place,pair.to.place],mode,pair.departure ?? pair.from.event.end,options);
}

export async function fetchRoute(places:[Place,Place], mode:TravelMode, departure?:string,
  {fetchImpl=fetch,signal}:LookupOptions = {}):Promise<LegResult|null> {
  const synthetic = syntheticMinutes(places, mode, departure);
  if (synthetic !== undefined && Number.isFinite(synthetic) && synthetic >= 0) {
    return {
      mode, minutes: Math.ceil(synthetic), source: "synthetic", observedAt: Date.now(),
      points: [{ latitude: places[0].lat, longitude: places[0].lng }, { latitude: places[1].lat, longitude: places[1].lng }],
    };
  }
  try {
    const response = await fetchImpl(apiEndpoint("route"), {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({
        places: places.map(({ id, name, lat, lng }) => ({ id, name, lat, lng })),
        mode: routeProviderMode(mode), ...(mode === "transit" ? { departure } : {}),
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
  force?: boolean;
  /** 用户展开的路段：按需补查其余模式，用于比较，不为整天的每段都发请求。 */
  compare?: string | null;
  onLeg: (pairId: string, mode: TravelMode, leg: LegResult | null) => void;
}

/**
 * Looks up the day with as few requests as it can: each leg once in the mode in use, other modes only when a leg
 * does not fit or the person opens the comparison. Successes are remembered for the page's life using per-mode TTLs;
 * failures are not, so the next run tries again.
 */
export function createTodayLegsRunner({ fetchImpl = fetch }: { fetchImpl?: FetchLike } = {}) {
  const done = new Map<string, {leg:LegResult; fetchedAt:number; ttl:number}>();
  let active: AbortController | null = null;
  const cancel = () => { active?.abort(); active = null; };
  const key = (pair: TodayLegPair, mode: TravelMode) => JSON.stringify([
    ...[pair.from.place, pair.to.place].map(p => [p.id, p.city, p.lat, p.lng]),
    routeProviderMode(mode), mode === "transit" ? pair.departure ?? pair.from.event.end : null,
  ]);
  return {
    cancel,
    async run({ pairs, choices, compare, onLeg, force }: RunInput) {
      cancel();
      const controller = new AbortController();
      active = controller;
      const live = () => active === controller && !controller.signal.aborted;
      const look = async (pair: TodayLegPair, mode: TravelMode) => {
        const entry = done.get(key(pair, mode));
        const ttl = isFutureLeg(pair, Date.now()) ? ROUTE_TTLS.walking : ROUTE_TTLS[mode];
        const cached = !force && entry && Date.now()-entry.fetchedAt < Math.min(entry.ttl, ttl) ? entry.leg : undefined;
        const leg = cached ? (cached.mode === mode ? cached : { ...cached, mode }) : await fetchLeg(pair, mode, { fetchImpl, signal: controller.signal });
        if (!live()) return null;
        if (leg) {
          if (!cached) done.set(key(pair, mode), {leg,fetchedAt:Date.now(),ttl});
          if (done.size > 96) done.delete(done.keys().next().value!);
        }
        onLeg(pair.id, mode, leg);
        return leg;
      };
      await Promise.all(pairs.filter(pair => !pair.sameSpot).map(async pair => {
        const chosen = choices[pair.id] ?? pair.defaultMode;
        const first = await look(pair, chosen);
        if (!first || !live()) return;
        const wantsCompare = compare === pair.id;
        const short = assessLeg({ pair, route: first, mode: chosen, now: Date.now(), bufferOverride: 0 }).status === "insufficient";
        if (!wantsCompare && !short) return;
        const providerModes = new Set<"walking" | "transit" | "driving">(["walking", "transit", "driving"]);
        providerModes.delete(routeProviderMode(chosen));
        await Promise.all([...providerModes].map(mode => look(pair, mode)));
      }));
      if (active === controller) active = null;
    },
  };
}

/** Looks up the day's legs as the events or the chosen modes change; results from an older day or choice never land. */
export function useTodayLegs({ pairs, choices, owner, retryCount, compare }: {
  pairs: TodayLegPair[]; choices: Record<string, TravelMode>; owner: string; retryCount: number; compare?: string | null;
}) {
  const [networkRevision, setNetworkRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setNetworkRevision(value => value + 1);
    window.addEventListener("online", refresh);
    return () => window.removeEventListener("online", refresh);
  }, []);
  const requestedRetry = useRef(retryCount);
  const runner = useRef<{ owner: string; lookup: ReturnType<typeof createTodayLegsRunner> } | null>(null);
  const [result, setResult] = useState<{ signature: string; legs: Legs; pending: boolean }>();
  const signature = JSON.stringify([owner, pairs.map(p => [
    p.id, ...[p.from.place, p.to.place].map(place => [place.id, place.city, place.lat, place.lng]),
    p.departure ?? p.from.event.end, p.to.event.start, p.sameSpot, p.defaultMode,
  ])]);
  const chosenModes = JSON.stringify(choices);
  const hasRoutes = pairs.some(pair => !pair.sameSpot);
  const input = useRef({ pairs, choices, compare });
  input.current = { pairs, choices, compare };
  useEffect(() => {
    if (!hasRoutes) return;
    if (runner.current?.owner !== owner) runner.current = { owner, lookup: createTodayLegsRunner() };
    const current = runner.current.lookup;
    let live = true;
    setResult(old => ({ signature, legs: old?.signature === signature ? old.legs : emptyLegs, pending: true }));
    const force = requestedRetry.current !== retryCount;
    requestedRetry.current = retryCount;
    void current.run({
      ...input.current, force,
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
  }, [signature, chosenModes, retryCount, owner, hasRoutes, networkRevision, compare]);
  return { legs: result?.signature === signature ? result.legs : emptyLegs,
    loading: hasRoutes && (result?.signature !== signature || result.pending) };
}

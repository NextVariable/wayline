import { useEffect, useRef } from "react";
import type { CalendarEntry } from "./calendarEvents";
import type { PlaceAliases } from "./placeAliases";
import { applyResults, planResolution, type ResolveResult } from "./calendarPlaces";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const DEBOUNCE_MS = 800;

/**
 * One plan, at most one batched request, results applied. When the resolver is unreachable, busy or out of quota,
 * events keep their text and stay unresolved for the next try: nothing is marked "not found" and no error is shown.
 */
export async function resolveCalendarPlaces(
  events: CalendarEntry[], aliases: PlaceAliases,
  { now, city, fetchImpl = fetch, signal }: { now: Date; city: string; fetchImpl?: FetchLike; signal?: AbortSignal },
): Promise<CalendarEntry[]> {
  const { lookups, updated } = planResolution(events, aliases, { now, city });
  if (!lookups.length) return updated;
  try {
    const response = await fetchImpl("/api/calendar/places", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: lookups }), signal,
    });
    if (!response.ok) return updated;
    const data = await response.json() as { results?: ResolveResult[] };
    return Array.isArray(data?.results) ? applyResults(updated, data.results) : updated;
  } catch {
    return updated;
  }
}

interface RunInput { owner: string; events: CalendarEntry[]; aliases: PlaceAliases; city: string; commit: (events: CalendarEntry[]) => void }

/** Only the latest run may commit: a newer run, an account switch or cancel() aborts the one in flight. */
export function createCalendarPlaceRunner({ fetchImpl = fetch, now = () => new Date() }: { fetchImpl?: FetchLike; now?: () => Date } = {}) {
  let active: AbortController | null = null;
  const cancel = () => { active?.abort(); active = null; };
  return {
    cancel,
    async run({ owner, events, aliases, city, commit }: RunInput) {
      cancel();
      const controller = new AbortController();
      active = controller;
      const next = await resolveCalendarPlaces(events, aliases, { now: now(), city, fetchImpl, signal: controller.signal });
      if (active !== controller || controller.signal.aborted || !owner) return;
      active = null;
      if (JSON.stringify(next) !== JSON.stringify(events)) commit(next);
    },
  };
}

/** After calendar events change (sync, import, edits), resolve their places in the background. */
export function useCalendarPlaces({ owner, events, aliases, city, day, commit }: RunInput & { day?: string }) {
  const runner = useRef(createCalendarPlaceRunner());
  const latestCommit = useRef(commit);
  latestCommit.current = commit;
  useEffect(() => {
    const current = runner.current;
    const timer = window.setTimeout(() => {
      void current.run({ owner, events, aliases, city, commit: next => latestCommit.current(next) });
    }, DEBOUNCE_MS);
    // Any change of events, aliases, city or account makes an in-flight result stale; never let it overwrite newer data.
    return () => { window.clearTimeout(timer); current.cancel(); };
  }, [owner, events, aliases, city, day]);
}

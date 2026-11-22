import { pathToFileURL } from "node:url";
import { expect, it, vi } from "vitest";
import samples from "../../tests/fixtures/calendar-place-evaluation.json";
import { applyResults, planResolution, type ResolveResult } from "../lib/calendarPlaces";
import type { CalendarEntry } from "../lib/calendarEvents";
// @ts-expect-error Server ESM exercised directly.
import { createCalendarPlaceResolver } from "../../server/calendar-places.mjs";

it("evaluates 120 synthetic locations through browser planning, server matching and pin application", async () => {
  const baseline = process.env.WAYLINE_BASELINE_RESOLVER;
  const resolverFactory = baseline ? (await import(/* @vite-ignore */ pathToFileURL(baseline).href)).createCalendarPlaceResolver : createCalendarPlaceResolver;
  const counts: Record<string, {total:number; correct:number; wrong:number; pending:number; failure:number; excluded:number}> = {};
  for (const sample of samples) {
    const search = vi.fn(async () => {
      if (!sample.candidates) throw new Error("synthetic supplier outage");
      return sample.candidates;
    });
    const resolver = resolverFactory({ searchPlaces:search });
    const event:CalendarEntry = { id:sample.id, uid:sample.id, title:"样本", location:sample.query, description:"",
      start:"2026-11-20T12:00:00.000Z", end:"2026-11-20T13:00:00.000Z", timezone:"UTC", allDay:false, calendar:"样本" };
    const {lookups, updated} = planResolution([event], {}, {now:new Date("2026-11-19T12:00:00Z"),city:sample.scope});
    const results:ResolveResult[] = lookups.length ? await resolver.resolve(lookups) : [];
    const [applied] = applyResults(updated, results);
    const status = results.at(0)?.status ?? applied.placeResolution?.status;
    const correct = !!applied.place && applied.place.lat === sample.answer?.lat && applied.place.lng === sample.answer?.lng;
    const row = counts[sample.category] ??= {total:0,correct:0,wrong:0,pending:0,failure:0,excluded:0};
    row.total++;
    if (correct) row.correct++;
    else if (applied.place) row.wrong++;
    else if (status === "online" || status === "missing") row.excluded++;
    else if (status === "ambiguous") row.pending++;
    else row.failure++;
    if (!baseline) {
      expect(status, sample.id).toBe(sample.expected);
      if (sample.answer) expect(correct, sample.id).toBe(true);
      if (sample.expected === "online" || sample.expected === "missing") expect(search).not.toHaveBeenCalled();
    }
  }
  expect(samples.length).toBe(120);
  console.table(counts);
});

import { expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import samples from "../../tests/fixtures/public-calendar-pois.json";
// @ts-expect-error Tests the Node resolver with controlled provider rows.
import { createCalendarPlaceResolver } from "../../server/calendar-places.mjs";

it("scores public address cases separately from real map results", async () => {
  const baseline=process.env.WAYLINE_BASELINE_RESOLVER;
  const factory=baseline?(await import(/* @vite-ignore */ pathToFileURL(baseline).href)).createCalendarPlaceResolver:createCalendarPlaceResolver;
  const counts={found:0,wrong:0,pending:0,failed:0};
  for (const sample of samples) {
    const resolver=factory({searchPlaces:async()=>sample.simulated});
    const [result]=await resolver.resolve([{text:sample.query,city:sample.city}]);
    if (result.status==="found") {
      const key=sample.expected==="found" && result.place.name===sample.acceptableName ? "found" : "wrong";
      counts[key]++;
    } else if (result.status==="ambiguous") counts.pending++;
    else counts.failed++;
    if (!baseline) expect(result.status,sample.id).toBe(sample.expected);
  }
  expect(samples).toHaveLength(12);
  if (!baseline) expect(counts).toEqual({found:8,wrong:0,pending:4,failed:0});
  console.log("Public POI fixture simulation",counts);
});

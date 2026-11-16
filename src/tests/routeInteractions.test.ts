import { describe, expect, it } from "vitest";
import { routeCandidates, restoreRouteStops } from "../lib/routeInteractions";
import { initialUserPlaces } from "./fixtures/userPlaces";
const [a, b, c] = initialUserPlaces;
describe("direct route additions", () => {
  it("offers saved places immediately and excludes route members", () =>
    expect(routeCandidates([a, b], [], [a], "")).toEqual([b]));
  it("matches saved names, addresses and cities", () => {
    expect(routeCandidates([a, b], [], [], a.name)).toContain(a);
    expect(routeCandidates([a], [], [], a.city)).toEqual([a]);
    expect(routeCandidates([a], [], [], a.address)).toEqual([a]);
  });
  it("combines online and saved results without duplicating a location", () => {
    expect(
      routeCandidates([a], [{ ...a, id: "remote" }, b], [], a.name),
    ).toEqual([a, b]);
  });
  it("does not display stale online results for an empty query", () =>
    expect(routeCandidates([], [a], [], "")).toEqual([]));
  it("excludes invalid coordinates and already added online locations", () => {
    expect(routeCandidates([], [a, { ...b, lat: NaN }], [a], "查询")).toEqual(
      [],
    );
  });
});
describe("safe route undo", () => {
  it("restores a cleared route without losing subsequent additions", () =>
    expect(restoreRouteStops([c], [a, b])).toEqual([a, b, c]));
  it("restores a removed stop at its old position without reverting a changed stop", () => {
    const edited = { ...a, reason: "new note" };
    expect(restoreRouteStops([edited, c], [b], 1)).toEqual([edited, b, c]);
  });
  it("never inserts duplicates after manually readding a stop", () => {
    expect(restoreRouteStops([{ ...a, id: "new" }], [a])).toEqual([
      { ...a, id: "new" },
    ]);
  });
  it("preserves reordering and does not mutate either input", () => {
    const current = [c, a];
    const previous = [b];
    expect(restoreRouteStops(current, previous, 1)).toEqual([c, b, a]);
    expect(current).toEqual([c, a]);
    expect(previous).toEqual([b]);
  });
  it("clamps insertion positions", () => {
    expect(restoreRouteStops([a], [b], 99)).toEqual([a, b]);
    expect(restoreRouteStops([a], [b], -1)).toEqual([b, a]);
  });
});

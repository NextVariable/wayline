import { describe, expect, it } from "vitest";
import {
  moveRoutePlace,
  reorderRoutePlace,
  tripStorageKey,
  validRoutePlaces,
} from "../lib/tripWorkspace";
import { initialUserPlaces } from "./fixtures/userPlaces";

describe("route draft boundaries", () => {
  it("restores only valid, distinct locations from browser storage", () => {
    const place = initialUserPlaces[0];
    expect(
      validRoutePlaces([
        place,
        { ...place, id: "duplicate" },
        { ...place, id: "bad", lat: "not-a-coordinate" },
        null,
      ]),
    ).toEqual([place]);
    expect(validRoutePlaces({ places: [] })).toEqual([]);
  });
  it("reorders the selected route without mutating saved places and respects ends", () => {
    const places = initialUserPlaces.slice(0, 2);
    expect(moveRoutePlace(places, 0, 1)).toEqual([places[1], places[0]]);
    expect(places[0]).toBe(initialUserPlaces[0]);
    expect(moveRoutePlace(places, 0, -1)).toBe(places);
    expect(moveRoutePlace(places, places.length - 1, 1)).toBe(places);
  });
  it("moves a dragged stop to an arbitrary position without altering the source", () => {
    const route = initialUserPlaces.slice(0, 3);
    expect(reorderRoutePlace(route, 0, 2)).toEqual([
      route[1],
      route[2],
      route[0],
    ]);
    expect(reorderRoutePlace(route, 2, 0)).toEqual([
      route[2],
      route[0],
      route[1],
    ]);
    expect(route).toEqual(initialUserPlaces.slice(0, 3));
    expect(reorderRoutePlace(route, -1, 1)).toBe(route);
    expect(reorderRoutePlace(route, 0, 99)).toBe(route);
    expect(reorderRoutePlace(route, 1, 1)).toBe(route);
  });
  it("keeps guest and account drafts in separate spaces", () => {
    expect(tripStorageKey("guest")).not.toBe(
      tripStorageKey("email:person@example.com"),
    );
  });
});

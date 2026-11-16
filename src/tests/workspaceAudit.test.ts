import { afterEach, describe, expect, it, vi } from "vitest";
import { initialUserPlaces } from "./fixtures/userPlaces";
import { isSchedule, samePlace } from "../lib/placeIdentity";
import {
  createUser,
  guestUser,
  loadActiveUser,
  saveActiveUser,
  saveUserPlaces,
} from "../lib/userStorage";
afterEach(() => vi.unstubAllGlobals());
describe("reviewed workspace behavior boundaries", () => {
  it("keeps two meetings at the same venue separate from the saved location", () => {
    const venue = initialUserPlaces[0];
    const meeting = { ...venue, id: "meeting-1", tags: ["日程助手"] };
    expect(isSchedule(meeting)).toBe(true);
    expect(samePlace(venue, { ...venue, id: "search-result" })).toBe(true);
    expect(samePlace(venue, meeting)).toBe(false);
    expect(samePlace(meeting, { ...meeting, id: "meeting-2" })).toBe(false);
    expect(samePlace(meeting, { ...meeting, status: "visited" })).toBe(true);
  });
  it("opens the same named local space without inventing authentication", () => {
    expect(createUser("local", " Work ")).toEqual({
      id: "local:work",
      label: "Work",
      method: "local",
    });
    expect(createUser("local", "work").id).toBe(createUser("local", "Work").id);
    expect(createUser("local", "work").id).not.toBe(guestUser.id);
  });
  it("recovers a malformed active space and reports failed browser saves", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => '{"id":null}',
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });
    expect(loadActiveUser()).toEqual(guestUser);
    expect(saveActiveUser(guestUser)).toBe(false);
    expect(saveUserPlaces(guestUser, initialUserPlaces)).toBe(false);
  });
});
it("starts a new browser with an empty personal library, not sample user data", async () => {
  vi.stubGlobal("localStorage",{getItem:()=>null});
  const {loadUserPlaces} = await import("../lib/userStorage");
  expect(loadUserPlaces(guestUser)).toEqual([]);
});

import type { Place } from "../types/place";
import { isStoredPlace } from "./placeValidation";

/** Phrases the user has pinned to a place, keyed by normalized location text. Synced with the workspace. */
export type PlaceAliases = Record<string, Place>;

const MAX_ALIASES = 2000;
export const placeAliasKey = (owner: string) => `whatto.placeAliases.${owner}`;

/** Same rule as server/calendar-places.mjs normalizeLocationText. */
export const normalizeLocationText = (text: string) =>
  String(text ?? "").toLowerCase().replace(/[\s，,、。.（）()【】[\]·・\-—_:：;；'"“”‘’]/g, "");

export function isPlaceAliases(value: unknown): value is PlaceAliases {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rows = Object.entries(value as Record<string, unknown>);
  return rows.length <= MAX_ALIASES && rows.every(([key, place]) => key.length > 0 && key.length <= 200 && isStoredPlace(place));
}

export function readPlaceAliases(owner: string, storage: Storage = localStorage): PlaceAliases {
  try {
    const value = JSON.parse(storage.getItem(placeAliasKey(owner)) ?? "null");
    return isPlaceAliases(value) ? value : Object.fromEntries([]);
  } catch {
    return Object.fromEntries([]);
  }
}

export function writePlaceAliases(owner: string, aliases: PlaceAliases, storage: Storage = localStorage) {
  const rows = Object.entries(aliases).slice(-MAX_ALIASES);
  storage.setItem(placeAliasKey(owner), JSON.stringify(Object.fromEntries(rows)));
}

import { isStoredPlace } from "./placeValidation";
import { samePlace } from "./placeIdentity";
import { useEffect, useRef, useState } from "react";
import type { City, Place } from "../types/place";
import { loadUserPlaces, type AppUser } from "./userStorage";

export function tripStorageKey(userId: string) {
  return `whatto.tripDraft.${userId}`;
}
export function validRoutePlaces(value: unknown): Place[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isStoredPlace)
    .filter(
      (p, i, rows) =>
        rows.findIndex((q) => samePlace(q, p)) === i,
    );
}
export function moveRoutePlace(
  places: Place[],
  index: number,
  direction: -1 | 1,
) {
  const target = index + direction;
  if (
    index < 0 ||
    index >= places.length ||
    target < 0 ||
    target >= places.length
  )
    return places;
  const next = [...places];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
export function reorderRoutePlace(places: Place[], from: number, to: number) {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= places.length ||
    to >= places.length ||
    from === to
  )
    return places;
  const next = [...places];
  const [place] = next.splice(from, 1);
  next.splice(to, 0, place);
  return next;
}

function readDraft(userId: string) {
  try {
    return validRoutePlaces(
      JSON.parse(localStorage.getItem(tripStorageKey(userId)) ?? "[]"),
    );
  } catch {
    return [];
  }
}
export function useTripDraft(userId: string) {
  const [places, setPlaces] = useState<Place[]>(() => readDraft(userId));
  const [saved, setSaved] = useState(true);
  const owner = useRef(userId);
  useEffect(() => {
    if (owner.current !== userId) {
      owner.current = userId;
      setPlaces(readDraft(userId));
      return;
    }
    try {
      localStorage.setItem(tripStorageKey(userId), JSON.stringify(places));
      setSaved(true);
    } catch {
      setSaved(false);
      /* Keep the in-memory draft if browser storage is full or blocked. */
    }
  }, [userId, places]);
  return [places, setPlaces, saved] as const;
}



export function useUserCities(user: AppUser) {
  const key = `whatto.cities.${user.id}`;
  const read = (): City[] => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(raw)
        ? raw.filter(
            (c) =>
              c &&
              typeof c.name === "string" &&
              Number.isFinite(c.lat) &&
              Math.abs(c.lat) <= 90 &&
              Number.isFinite(c.lng) &&
              Math.abs(c.lng) <= 180 &&
              Number.isFinite(c.zoom),
          )
        : [];
    } catch {
      return [];
    }
  };
  const [cities, setCities] = useState<City[]>(read);
  const [saved, setSaved] = useState(true);
  const owner = useRef(user.id);
  useEffect(() => {
    if (owner.current !== user.id) {
      owner.current = user.id;
      setCities(read());
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(cities));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [user.id, key, cities]);
  return [cities, setCities, saved] as const;
}

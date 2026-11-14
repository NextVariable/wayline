import type { Place } from "../types/place";
import { samePlace } from "./placeIdentity";
export function routeCandidates(
  saved: Place[],
  remote: Place[],
  route: Place[],
  query: string,
): Place[] {
  const keyword = query.trim().toLowerCase();
  const seen: Place[] = [];
  return [
    ...saved.filter(
      (place) =>
        !keyword ||
        `${place.name} ${place.city} ${place.address}`
          .toLowerCase()
          .includes(keyword),
    ),
    ...(keyword ? remote : []),
  ].filter((place) => {
    if (
      route.some(p => samePlace(p, place)) ||
      seen.some(p => samePlace(p, place)) ||
      !Number.isFinite(place.lat) ||
      !Number.isFinite(place.lng) ||
      Math.abs(place.lat) > 90 ||
      Math.abs(place.lng) > 180
    )
      return false;
    seen.push(place);
    return true;
  });
}
/** Restore only removed stops; never overwrite work done after removal. */
export function restoreRouteStops(
  current: Place[],
  removed: Place[],
  index = 0,
): Place[] {
  const restored = [...current];
  let insertion = Math.max(0, Math.min(index, restored.length));
  for (const place of removed) {
    if (
      restored.some(
        (item) => samePlace(item, place),
      )
    )
      continue;
    restored.splice(insertion++, 0, place);
  }
  return restored;
}

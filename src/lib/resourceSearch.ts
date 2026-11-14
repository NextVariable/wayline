import type { Place, SystemLayer } from "../types/place";

export async function searchCitySystemPlaces(city: string, category: SystemLayer, signal: AbortSignal) {
  const response = await fetch("/api/resources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ city, category }),
    signal,
  });
  if (!response.ok) throw new Error("地点暂时无法加载");
  const result = await response.json() as { places: Place[]; incomplete: boolean };
  if (!Array.isArray(result.places)) throw new Error("地点暂时无法加载");
  return {
    incomplete: result.incomplete,
    places: result.places.filter(place =>
      place.city === city.trim().replace(/(?:特别行政区|市)$/, "") && place.category === category && place.type === "system" &&
      (place.resourceEvidence?.provider === "高德地图" || place.resourceEvidence?.provider === "Wikidata" ||
        place.resourceEvidence?.provider === "官方地图") &&
      (category !== "business" || !!place.resourceEvidence.officialUrl)),
  };
}

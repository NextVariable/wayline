import type { CityName, Place, PlaceCategory } from "../types/place";
import { cityKey } from "./citySelection";

export function groupSavedPlacesByCity(places: Place[]) {
  const groups = new Map<string, { key: string; label: string; places: Place[] }>();
  for (const place of places) {
    const key = cityKey(place.city);
    const group = groups.get(key) ?? {
      key,
      label: !key ? "城市未识别" : /[\u4e00-\u9fff]/.test(key) ? key : place.city.trim(),
      places: [],
    };
    group.places.push(place);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Number(!a.key) - Number(!b.key) || a.label.localeCompare(b.label, "zh-CN"));
}

export function savedPlaceAddress(place: Place, city: string) {
  const address = place.address.trim();
  if (!address || address === place.name || /候选/.test(address)) return "";
  if (!city) return address;
  const cityPrefix = city.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
  const prefix = new RegExp(`^(?:[^省市区]+省|[^市]+自治区)?${cityPrefix}(?:市|特别行政区|[\\s,，·]+|$)[\\s,，·]*`, "iu");
  const short = address.replace(prefix, "").trim();
  return short === place.name ? "" : short;
}



export function getGuideCategories(place: Place): PlaceCategory[] {
  if (place.guideCategories) return place.guideCategories;
  return [place.category];
}

export function placeBelongsToGuide(place: Place, category: PlaceCategory) {
  return getGuideCategories(place).includes(category);
}

export function getCityGuidePlaces(places: Place[], city: CityName) {
  return places.filter((place) => place.city === city);
}

export function getCityGuideCategoryPlaces(places: Place[], city: CityName, category: PlaceCategory) {
  return getCityGuidePlaces(places, city).filter((place) => placeBelongsToGuide(place, category));
}

export function getCitiesGuidePlaces(places: Place[], cities: CityName[]) {
  const selected = new Set(cities);
  return places.filter((place) => selected.has(place.city));
}

export function getCitiesGuideCategoryPlaces(places: Place[], cities: CityName[], category: PlaceCategory) {
  return getCitiesGuidePlaces(places, cities).filter((place) => placeBelongsToGuide(place, category));
}

export function getCitiesGuideCategoriesPlaces(places: Place[], cities: CityName[], categories: PlaceCategory[]) {
  return getCitiesGuidePlaces(places, cities).filter((place) =>
    categories.some((category) => placeBelongsToGuide(place, category)),
  );
}



/** A place type is independent from collection/category memberships. */
export function getCitiesPlacesByType(places: Place[], cities: CityName[], category: PlaceCategory) {
  return getCitiesGuidePlaces(places, cities).filter(place => place.category === category);
}

import seedData from "./whereto_city_resources_seed_v0_1.json";
import type { City, CityName, Place, PlaceCategory } from "../types/place";

type SeedCategory = "business" | "transport";

type SeedResource = {
  id: string;
  name: string;
  city: string;
  category: SeedCategory;
  lat: number;
  lng: number;
  address?: string;
  tags?: string[];
  reason?: string;
};

type SeedCity = {
  name: string;
  center: { lat: number; lng: number; zoom?: number };
  resources: SeedResource[];
};

const categoryMap: Record<SeedCategory, PlaceCategory> = {
  business: "business",
  transport: "transport",
};

const categoryOpeningHours: Record<PlaceCategory, string> = {
  business: "以园区或写字楼官方公告为准",
  transport: "以车站、机场或口岸官方运营时间为准",
  university: "以校方开放管理公告为准",
  attraction: "以景区或场馆官方公告为准",
  food: "以门店当日营业时间为准",
  shopping: "以商场或街区官方公告为准",
  custom: "以现场公告为准",
};

const linkFor = (name: string, lat: number, lng: number) => ({
  amap: `https://uri.amap.com/search?keyword=${encodeURIComponent(name)}`,
  google: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
  apple: `https://maps.apple.com/?q=${encodeURIComponent(name)}&ll=${lat},${lng}`,
});

const cities = (seedData.cities ?? []) as SeedCity[];

export const seedCities: City[] = cities.map((city) => ({
  name: city.name as CityName,
  lat: city.center.lat,
  lng: city.center.lng,
  zoom: city.center.zoom ?? 11,
}));

// Archived UI fixtures with approximate coordinates. Never use as live POI data.
export const seedSystemPlaces: Place[] = cities.flatMap((city) =>
  city.resources.map((resource): Place => {
    const category = categoryMap[resource.category];
    const name = cleanSeedText(resource.name);
    const reason = cleanSeedText(resource.reason || "");
    return {
      id: `seed-${resource.id}`,
      name,
      city: city.name as CityName,
      category,
      type: "system",
      source: "system",
      lat: resource.lat,
      lng: resource.lng,
      address: cleanSeedText(resource.address || ""),
      openingHours: categoryOpeningHours[category],
      description: reason,
      tags: (resource.tags ?? []).map(cleanSeedText).filter(Boolean),
      reason,
      status: "saved",
      isSaved: false,
      distanceText: "城市资源",
      externalLinks: linkFor(name, resource.lat, resource.lng),
    };
  }),
);

export function getSeedResourcesForCity(cityName: CityName) {
  return seedSystemPlaces.filter((place) => place.city === cityName);
}

function cleanSeedText(value: string) {
  return value
    .replace(/\s*mock\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

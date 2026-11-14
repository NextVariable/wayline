import type { Place } from "../types/place";
import { haversineKm, routeProviderMode, type TravelMode } from "./todayMap";
import { gcjToWgs } from "./trackCoordinates";
import { cityCatalog } from "../data/cities";
import { cityKey } from "./citySelection";
import amapCoverage from "../data/amap-coverage.json";

const amapMode = { walking: "walk", transit: "bus", driving: "car" };

/**
 * Wayline never navigates itself: these links open Amap or Google Maps with both ends filled in.
 * Built with URLSearchParams so a place name can never add or override a parameter.
 */
export function amapNavigationUrl(from: Place, to: Place, mode: TravelMode, mobile = false) {
  const url = new URL("https://uri.amap.com/navigation");
  // Wayline coordinates are GCJ-02, which is what Amap expects.
  url.searchParams.set("from", `${from.lng},${from.lat},${from.name}`);
  url.searchParams.set("to", `${to.lng},${to.lat},${to.name}`);
  url.searchParams.set("mode", amapMode[routeProviderMode(mode)]);
  url.searchParams.set("coordinate", "gaode");
  url.searchParams.set("callnative", mobile ? "1" : "0");
  return url.toString();
}

export function prefersMapApp(device = typeof navigator === "undefined" ? undefined : navigator) {
  return !!device && (/Android|iPhone|iPad|iPod/i.test(device.userAgent) ||
    (/Macintosh/.test(device.userAgent) && device.maxTouchPoints > 1));
}

function insideRing(lng: number, lat: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, previous = ring.length - 1; i < ring.length; previous = i++) {
    const [x, y] = ring[i];
    const [px, py] = ring[previous];
    if ((y > lat) !== (py > lat) && lng < (px - x) * (lat - y) / (py - y) + x)
      inside = !inside;
  }
  return inside;
}

/** Natural Earth 5.1.2, 1:50m Admin 0. Used for link routing only. */
function usesAmap(place: Place) {
  const { lng, lat } = place;
  if (lng < 73 || lng > 135.1 || lat < 18 || lat > 54) return false;
  const city = cityKey(place.city);
  if (/^(香港|澳门|台北|台湾)/.test(city)) return false;
  // The simplified polygon can cut through coastal cities (e.g. Shenzhen's
  // civic centre). A known mainland city and a nearby coordinate resolve that case.
  const mainlandCity = cityCatalog.find(candidate => cityKey(candidate.name) === city);
  if (mainlandCity && haversineKm(mainlandCity, place) < 25) return true;
  return amapCoverage.some(([outline, ...holes]) => insideRing(lng, lat, outline) &&
    !holes.some(hole => insideRing(lng, lat, hole)));
}

const mapLink = (amap: boolean, href: string, mobile: boolean) => ({
  label: amap ? "高德地图" : "Google 地图",
  href,
  target: mobile ? undefined : "_blank",
});

export function placeMapLink(place: Place, mobile = prefersMapApp()) {
  const amap = usesAmap(place);
  const url = new URL(amap ? "https://uri.amap.com/marker" : "https://www.google.com/maps/search/");
  if (amap) {
    url.searchParams.set("position", `${place.lng},${place.lat}`);
    url.searchParams.set("name", place.name);
    url.searchParams.set("coordinate", "gaode");
    url.searchParams.set("callnative", mobile ? "1" : "0");
  } else {
    const [lng, lat] = gcjToWgs(place.lng, place.lat);
    url.searchParams.set("api", "1");
    url.searchParams.set("query", `${lat},${lng}`);
  }
  return mapLink(amap, url.toString(), mobile);
}

export function routeMapLink(from: Place, to: Place, mode: TravelMode, mobile = prefersMapApp()) {
  const amap = usesAmap(from) && usesAmap(to);
  return mapLink(amap, amap ? amapNavigationUrl(from, to, mode, mobile) : googleNavigationUrl(from, to, mode), mobile);
}

export function googleNavigationUrl(from: Place, to: Place, mode: TravelMode) {
  const point = (place: Place) => {
    // Google Maps uses WGS-84; sending GCJ-02 would land the pin a few hundred metres off.
    const [lng, lat] = gcjToWgs(place.lng, place.lat);
    return `${lat},${lng}`;
  };
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", point(from));
  url.searchParams.set("destination", point(to));
  url.searchParams.set("travelmode", routeProviderMode(mode));
  return url.toString();
}

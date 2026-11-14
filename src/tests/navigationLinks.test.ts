import { describe, it, expect } from "vitest";
import { initialUserPlaces } from "../data/userPlaces";
import { gcjToWgs } from "../lib/trackCoordinates";
import { amapNavigationUrl, googleNavigationUrl, placeMapLink, routeMapLink } from "../lib/navigationLinks";

const from = { ...initialUserPlaces[0], id: "a", name: "国贸大厦", lat: 39.9087, lng: 116.4605 };
const to = { ...initialUserPlaces[0], id: "b", name: "北京南站", lat: 39.8652, lng: 116.3786 };

describe("links out to turn-by-turn navigation", () => {
  it.each([
    ["苏州", 31.33, 120.57, "uri.amap.com"],
    ["海口", 20.02, 110.35, "uri.amap.com"],
    ["香港中环", 22.28, 114.16, "www.google.com"],
    ["澳门半岛", 22.197, 113.548, "www.google.com"],
    ["台北", 25.03, 121.56, "www.google.com"],
    ["首尔", 37.56, 126.97, "www.google.com"],
    ["河内", 21.03, 105.85, "www.google.com"],
    ["东京", 35.68, 139.76, "www.google.com"],
  ])("chooses the map provider for %s from the destination coordinates", (name, lat, lng, host) => {
    const place = { ...from, name, lat, lng };
    const link = placeMapLink(place, false);
    expect(new URL(link.href).hostname).toBe(host);
    expect(link.target).toBe("_blank");
  });

  it("requests the Amap app on mobile and uses Google Maps when a route leaves Amap coverage", () => {
    expect(new URL(placeMapLink(from, true).href).searchParams.get("callnative")).toBe("1");
    expect(placeMapLink(from, true).target).toBeUndefined();
    expect(new URL(routeMapLink(from, to, "walking", true).href).searchParams.get("callnative")).toBe("1");
    const tokyo = { ...to, lat: 35.68, lng: 139.76 };
    const link = routeMapLink(from, tokyo, "driving", true);
    expect(link.target).toBeUndefined();
    expect(new URL(link.href).searchParams.get("destination")).toBe("35.68,139.76");
  });
  it("uses mainland navigation in central Shenzhen and Google in Hong Kong across the coast", () => {
    const civic = { ...from, city:"广东省深圳市", lat:22.543, lng:114.059 };
    const station = { ...to, city:"深圳", lat:22.609, lng:114.029 };
    const hongKong = { ...to, city:"香港", lat:22.315, lng:114.18 };
    expect(new URL(routeMapLink(civic, station, "selfDrive", true).href).hostname).toBe("uri.amap.com");
    expect(new URL(routeMapLink(civic, hongKong, "selfDrive", true).href).hostname).toBe("www.google.com");
  });
  it("builds an Amap navigation link in GCJ-02 with the right mode", () => {
    const url = new URL(amapNavigationUrl(from, to, "transit"));
    expect(url.origin + url.pathname).toBe("https://uri.amap.com/navigation");
    expect(url.searchParams.get("from")).toBe("116.4605,39.9087,国贸大厦");
    expect(url.searchParams.get("to")).toBe("116.3786,39.8652,北京南站");
    expect(url.searchParams.get("coordinate")).toBe("gaode");
    expect(url.searchParams.get("callnative")).toBe("0");
    expect(url.searchParams.get("mode")).toBe("bus");
    expect(new URL(amapNavigationUrl(from, to, "driving")).searchParams.get("mode")).toBe("car");
    expect(new URL(amapNavigationUrl(from, to, "walking")).searchParams.get("mode")).toBe("walk");
  });

  it("builds a Google Maps link in WGS-84 with the right travel mode", () => {
    const url = new URL(googleNavigationUrl(from, to, "transit"));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    const [fromLng, fromLat] = gcjToWgs(from.lng, from.lat);
    const [toLng, toLat] = gcjToWgs(to.lng, to.lat);
    expect(url.searchParams.get("origin")).toBe(`${fromLat},${fromLng}`);
    expect(url.searchParams.get("destination")).toBe(`${toLat},${toLng}`);
    expect(url.searchParams.get("travelmode")).toBe("transit");
    expect(new URL(googleNavigationUrl(from, to, "driving")).searchParams.get("travelmode")).toBe("driving");
    expect(new URL(googleNavigationUrl(from, to, "walking")).searchParams.get("travelmode")).toBe("walking");
    // WGS-84 differs from GCJ-02 inside China, so the conversion must actually have happened.
    expect(url.searchParams.get("origin")).not.toBe(`${from.lat},${from.lng}`);
  });

  it("encodes names and never lets raw user text break out of the query", () => {
    const nasty = { ...from, name: "公司&mode=car#x?y=1 /\\ 张三家" };
    const url = new URL(amapNavigationUrl(nasty, to, "walking"));
    expect(url.searchParams.get("mode")).toBe("walk");
    expect(url.searchParams.get("from")).toBe("116.4605,39.9087,公司&mode=car#x?y=1 /\\ 张三家");
    expect(url.hash).toBe("");
    expect(amapNavigationUrl(nasty, to, "walking")).not.toContain("&mode=car");
  });

  it("only ever links to https pages on the two map sites", () => {
    for (const make of [amapNavigationUrl, googleNavigationUrl])
      for (const mode of ["walking", "transit", "driving"] as const) {
        const url = new URL(make(from, to, mode));
        expect(url.protocol).toBe("https:");
        expect(["uri.amap.com", "www.google.com"]).toContain(url.hostname);
      }
  });
});

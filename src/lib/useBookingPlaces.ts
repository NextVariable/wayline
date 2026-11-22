import { useEffect, useMemo, useState } from "react";
import type { Place } from "../types/place";
import type { OrderPoint } from "./businessOrders";
import { cityKey } from "./citySelection";

export const bookingPlaceKey = (point: OrderPoint) => JSON.stringify([point.city, point.name]);
const nameKey = (name: string) => name.normalize("NFKC").replace(/[\s（）()]/g, "").replace(/(T[1-9])(?:号?航站楼)?$/i, "$1").replace(/火车站$|站$/g, "").toUpperCase();
export function useBookingPlaces(points: OrderPoint[], owner: string) {
  const queries = JSON.stringify([...new Set(points.filter(point => !point.place && point.city).map(bookingPlaceKey))].sort());
  const [view, setView] = useState<{ owner: string; queries: string; places: Record<string, Place> }>();
  useEffect(() => {
    const keys = (JSON.parse(queries) as string[]).slice(0, 18);
    if (!keys.length) return;
    const controller = new AbortController();
    void Promise.allSettled(keys.map(async key => {
      const [city, name] = JSON.parse(key);
      const response = await fetch("/api/suggest", {
        method:"POST", headers:{"Content-Type":"application/json"}, signal:controller.signal,
        body:JSON.stringify({ keyword:name, city, lat:0, lng:0 }),
      });
      if (!response.ok) return [];
      const raw = await response.json();
      const rows: { name: string; city: string; lat: number; lng: number; address: string; coordinateSystem?: string; isMatched?: boolean }[] = Array.isArray(raw) ? raw : raw.results ?? [];
      const exact = rows.filter(row => typeof row.name === "string" && typeof row.city === "string" &&
        cityKey(row.city) === cityKey(city) && nameKey(row.name) === nameKey(name) &&
        row.isMatched === true && row.coordinateSystem === "GCJ02" &&
        Number.isFinite(row.lat) && Number.isFinite(row.lng) && (row.lat !== 0 || row.lng !== 0));
      if (!exact.length || exact.some(row => Math.abs(row.lat-exact[0].lat) > 0.0002 ||
        Math.abs(row.lng-exact[0].lng) > 0.0002)) return [];
      const row = exact[0];
      const place: Place = { id:"booking:"+key, name, city, lat:row.lat, lng:row.lng, address:row.address,
        type:"user", source:"imported", category:"transport", openingHours:"", description:"", tags:[], reason:"",
        status:"saved", isSaved:false, distanceText:"", externalLinks:{} };
      return [[key, place] as const];
    })).then(rows => {
      if (!controller.signal.aborted) setView({ owner, queries, places:Object.fromEntries(rows.flatMap(row => row.status === "fulfilled" ? row.value : [])) });
    });
    return () => controller.abort();
  }, [owner, queries]);
  return useMemo(() => view?.owner === owner && view.queries === queries ? view.places : {}, [view, owner, queries]);
}

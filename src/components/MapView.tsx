import "leaflet/dist/leaflet.css"; // 备用地图样式

import AMapLoader from "@amap/amap-jsapi-loader";
import L from "leaflet";
import { Loader2 } from "lucide-react";
import {
  MapContainer,
  Circle,
  CircleMarker,
  Marker as LeafletMarker,
  Polyline,
  TileLayer,
  useMap,
} from "react-leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChinaMiniMap, type MapViewport } from './ChinaMiniMap';
import { installMapLongPress } from '../lib/mapLongPress';
import type { City, MapMode, Place } from "../types/place";
// categoryGlyph / categoryTone 已迁至 PlacePin.tsx 的 renderPlacePinHTML
import { renderPlacePinHTML } from "./PlacePin";
import { trackSegments, type TrackPoint } from "../lib/footprints";
import { wgsToGcj, gcjToWgs } from "../lib/trackCoordinates";
import { resetMapNorth, subscribeMapOrientation } from "../lib/mapOrientation";
import { createSmoothMapZoom, zoomAvailability, type MapZoomState } from "../lib/mapZoom";
import type { AMapInstance, AMapMarker, AMapOverlay, AMapSdk } from "../lib/amapTypes";
import type { CurrentPosition } from "../lib/currentLocation";
type PlaceMarker = AMapMarker & { __place?: Place; __selected?: boolean; __mode?: string; __routeIndex?: number };

interface TodayRouteLine {
  id: string;
  points: { latitude: number; longitude: number }[];
  late: boolean;
}

const routeColor = (late: boolean, focused: boolean, dark: boolean) =>
  late ? (dark ? "#ff788a" : "#c82d46") : focused ? (dark ? "#82b6ff" : "#155bd0") : "#527390";

const roadToLeaflet = (point: {latitude:number;longitude:number}): [number, number] => {
  const [lng, lat] = gcjToWgs(point.longitude, point.latitude);
  return [lat, lng];
};

interface FootprintMap {
  points: TrackPoint[];
  focusKey: string;
  label: string;
}

function mapPadding(detail: boolean) {
  const mobile = window.matchMedia("(max-width:700px)").matches;
  const header = document.querySelector<HTMLElement>(".workspace-header");
  const railInset = header ? parseFloat(getComputedStyle(header).left) || 24 : 24;
  const railWidth =
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--sidebar-width",
      ),
    ) || 380;
  return {
    top: mobile ? 152 : 48,
    bottom: mobile
      ? Math.round(window.innerHeight * (detail ? 0.61 : 0.54)) + 64
      : 64,
    left: mobile ? 40 : railWidth + railInset + 24,
    right: mobile ? 72 : 80,
  };
}

function onMapResize(
  fit: () => void,
  map: {
    on: (type: string, handler: () => void) => unknown;
    off: (type: string, handler: () => void) => unknown;
  },
) {
  let frame = 0;
  const resize = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  };
  window.addEventListener("resize", resize);
  map.on("resize", resize);
  const container = document.querySelector(".workspace-map");
  const initial = container?.getBoundingClientRect();
  let size = initial ? `${initial.width}:${initial.height}` : "";
  const observer = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect;
    if (!rect) return;
    const next = `${rect.width}:${rect.height}`;
    if (next !== size) {
      size = next;
      resize();
    }
  });
  if (container) observer.observe(container);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    map.off("resize", resize);
    window.removeEventListener("resize", resize);
  };
}

const worldBounds: [[number, number], [number, number]] = [
  [-85, -180],
  [85, 180],
];
// ── Leaflet 降级组件（高德加载失败时使用）────────────────────────

function placeInWgs(place: Place): Place {
  const [lng,lat] = gcjToWgs(place.lng,place.lat);
  return {...place,lat,lng};
}

function makeFallbackIcon(
  place: Place,
  selected: boolean,
  mode: "young" | "business",
  routeIndex: number,
) {
  return L.divIcon({
    html: renderPlacePinHTML(place, selected, mode, routeIndex),
    className: "whereto-pin-shell",
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

function FallbackLeafletMap({
  city,
  places,
  selectedPlace,
  onSelectPlace,
  mode,
  mapMode,
  focusNonce,
  zoomCommand,
  onZoomStateChange,
  onRotationChange,
  routePlaces,
  routeOverview,
  routeFitCommand,
  footprint,
  myPosition,
  locationFocus,
  scopeCities,
  roadPoints,
  focusedLeg,
  todayRoutes,
  todayFocus,
  stayArea,
  onViewport,
  onMapReady,
}: {
  city: City;
  places: Place[];
  selectedPlace?: Place | null;
  onSelectPlace: (p: Place) => void;
  mode: "young" | "business";
  mapMode: MapMode;
  focusNonce: number;
  zoomCommand: number;
  onZoomStateChange?: (state: MapZoomState) => void;
  onRotationChange?: (rotation: number) => void;
  routePlaces: Place[];
  roadPoints?: {latitude:number;longitude:number}[][];
  focusedLeg?: number;
  todayRoutes?: TodayRouteLine[];
  todayFocus?: string | null;
  stayArea?: Place;
  onViewport:(viewport:MapViewport)=>void;
  onMapReady:(map:L.Map)=>void;
  routeOverview: boolean;
  routeFitCommand: number;
  footprint?: FootprintMap;
  myPosition?: CurrentPosition | null;
  locationFocus: number;
  scopeCities?: City[];
}) {
  useEffect(() => { onRotationChange?.(0); }, [onRotationChange]);
  const initialCenter = useMemo(
    () => [city.lat, city.lng] as [number, number],
    [city.lat, city.lng],
  );

  const fallbackTileUrl =
    mapMode === "satellite"
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      : mode === "business"
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

  const fallbackAttr =
    mapMode === "satellite"
      ? "Esri World Imagery"
      : mode === "business"
        ? "&copy; OpenStreetMap &copy; CARTO"
        : "&copy; OpenStreetMap &copy; CARTO";

  return (
    <MapContainer
      center={initialCenter}
      zoom={city.zoom}
      minZoom={2}
      maxZoom={18}
      zoomSnap={0.1}
      zoomDelta={1}
      maxBounds={worldBounds}
      maxBoundsViscosity={1}
      preferCanvas
      zoomControl={false}
      scrollWheelZoom
      className="h-full w-full"
    >
      <FallbackMapBridge onViewport={onViewport} onReady={onMapReady}/>
      <FallbackFlyTo
        city={city}
        selectedPlace={selectedPlace}
        focusNonce={focusNonce}
      />
      <FallbackOverviewFit
        places={places}
        selected={!!selectedPlace}
        hasRoute={routePlaces.length > 0}
        overview={routeOverview}
      />
      <FallbackRouteFit
        places={routePlaces}
        roadPoints={roadPoints}
        overview={routeOverview}
        selected={!!selectedPlace}
        command={routeFitCommand}
      />
      {stayArea && <Circle center={[stayArea.lat, stayArea.lng]} radius={850} pathOptions={{ color:"#367cc7", fillOpacity:0.12, weight:2 }} />}
      {todayRoutes?.map(route => (
        <Polyline
          key={route.id}
          positions={route.points.map(roadToLeaflet)}
          pathOptions={{ color: routeColor(route.late, route.id === todayFocus, mode === "business"),
            weight: route.id === todayFocus ? 5 : 3, opacity: 0.92, className: "today-map-route" }}
        />
      ))}
      <FallbackTodayFocus route={todayRoutes?.find(route => route.id === todayFocus)} />
      {!todayRoutes && (routePlaces.length > 1 || !!roadPoints?.length) && (
        <Polyline
          positions={roadPoints?.length ? roadPoints.map(leg => leg.map(point => {const [lng,lat] = gcjToWgs(point.longitude,point.latitude); return [lat,lng] as [number,number];})) : routePlaces.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{
            color: "#527390",
            weight: 2,
            dashArray: roadPoints?.length ? undefined : "6 8",
     opacity: focusedLeg === undefined ? 0.8 : 0.3,
          }}
        />
      )}
      {focusedLeg !== undefined && roadPoints?.[focusedLeg] && (
 <Polyline
   positions={roadPoints[focusedLeg].map(point => {const [lng,lat] = gcjToWgs(point.longitude,point.latitude); return [lat,lng] as [number,number];})}
          pathOptions={{ color: mode === "business" ? "#82b6ff" : "#155bd0", weight: 5, opacity: 1 }}
 />
      )}
      <FallbackZoomCommand value={zoomCommand} onZoomStateChange={onZoomStateChange} />
      {footprint && <FallbackFootprint footprint={footprint} />}
      <FallbackCurrentPosition position={myPosition} focus={locationFocus} />
      {!selectedPlace && !!scopeCities?.length && <FallbackCityScopeFit cities={scopeCities} focusNonce={focusNonce} />}
      <TileLayer
        key={`fallback-${mapMode}-${mode}`}
        attribution={fallbackAttr}
        url={fallbackTileUrl}
        noWrap
        updateWhenIdle={false}
        updateWhenZooming
        keepBuffer={24}
        updateInterval={80}
      />
      {places.map((place) => (
        <LeafletMarker
          key={`${place.type}-${place.id}`}
          title={place.name}
          alt={place.name}
          position={[place.lat, place.lng]}
          icon={makeFallbackIcon(
            place,
            selectedPlace?.id === place.id,
            mode,
            routePlaces.findIndex((p) => p.id === place.id),
          )}
          eventHandlers={{ click: () => onSelectPlace(place) }}
        />
      ))}
    </MapContainer>
  );
}

function FallbackTodayFocus({ route }: { route?: TodayRouteLine }) {
  const map = useMap();
  const points = route?.points;
  useEffect(() => {
    if (!points?.length) return;
    const padding = mapPadding(false);
    map.fitBounds(points.map(roadToLeaflet), {
      paddingTopLeft: [padding.left, padding.top], paddingBottomRight: [padding.right, padding.bottom], maxZoom: 17,
    });
  }, [map, points]);
  return null;
}

function FallbackMapBridge({onViewport,onReady}:{onViewport:(v:MapViewport)=>void;onReady:(map:L.Map)=>void}){
 const map=useMap();
 useEffect(()=>{
  onReady(map);
  const report=()=>{const c=map.getCenter(),b=map.getBounds();onViewport({center:{lat:c.lat,lng:c.lng},bounds:{north:b.getNorth(),south:b.getSouth(),east:b.getEast(),west:b.getWest()}});};
  report();map.on('moveend zoomend',report);
  const stop=installMapLongPress(map.getContainer(),p=>{const r=map.getContainer().getBoundingClientRect();map.flyTo(map.containerPointToLatLng([p.x-r.left,p.y-r.top]),Math.max(10,Math.min(18,map.getZoom()+2)),{duration:.5});});
  return ()=>{map.off('moveend zoomend',report);stop();};
 },[map,onViewport,onReady]);return null;
}

function FallbackFootprint({ footprint }: { footprint: FootprintMap }) {
  const map = useMap();
  const pointsRef = useRef(footprint.points);
  pointsRef.current = footprint.points;
  useEffect(() => {
    const fit = () => {
      const points = pointsRef.current;
      if (!points.length) return;
      const padding = mapPadding(true);
      map.fitBounds(
        points.map((p) => [p.lat, p.lng] as [number, number]),
        {
          animate: false,
          maxZoom: 16,
          paddingTopLeft: [padding.left, padding.top],
          paddingBottomRight: [padding.right, padding.bottom],
        },
      );
    };
    fit();
    return onMapResize(fit, map);
  }, [map, footprint.focusKey]);
  const last = footprint.points.at(-1);
  return (
    <>
      {trackSegments(footprint.points)
        .filter((segment) => segment.length > 1)
        .map((segment, index) => (
          <Polyline
            key={index}
            positions={segment.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: "#155bd0", weight: 4, opacity: 0.9 }}
          />
        ))}
      {trackSegments(footprint.points).filter(segment => segment.length === 1).map((segment, index) => <CircleMarker key={`visit-${index}`} center={[segment[0].lat, segment[0].lng]} radius={5} pathOptions={{color:"white",weight:2,fillColor:"#155bd0",fillOpacity:1}} />)}
      {last && (
        <>
          {last.accuracy > 0 && (
            <Circle
              center={[last.lat, last.lng]}
              radius={last.accuracy}
              pathOptions={{ color: "#155bd0", weight: 1, fillOpacity: 0.08 }}
            />
          )}
          <CircleMarker
            center={[last.lat, last.lng]}
            radius={7}
            pathOptions={{
              color: "white",
              weight: 3,
              fillColor: "#155bd0",
              fillOpacity: 1,
            }}
          />
        </>
      )}
    </>
  );
}
function FallbackCurrentPosition({
  position,
  focus,
}: {
  position?: CurrentPosition | null;
  focus: number;
}) {
  const map = useMap();
  const positionRef = useRef(position);
  positionRef.current = position;
  useEffect(() => {
    if (!focus) return;
    const fit = () => {
      const p = positionRef.current;
      if (!p) return;
      const padding = mapPadding(true);
      map.fitBounds(
        L.circle([p.lat, p.lng], {
          radius: Math.max(20, p.accuracy),
        }).getBounds(),
        {
          animate: false,
          maxZoom: 16,
          paddingTopLeft: [padding.left, padding.top],
          paddingBottomRight: [padding.right, padding.bottom],
        },
      );
    };
    fit();
    return onMapResize(fit, map);
  }, [map, focus]);
  return position ? (
    <>
      <Circle
        center={[position.lat, position.lng]}
        radius={position.accuracy}
        pathOptions={{ color: "#155bd0", weight: 1, fillOpacity: 0.08 }}
      />
      <CircleMarker
        center={[position.lat, position.lng]}
        radius={7}
        pathOptions={{
          color: "white",
          weight: 3,
          fillColor: "#155bd0",
          fillOpacity: 1,
        }}
      />
    </>
  ) : null;
}

// ── Leaflet 降级辅助组件 ──────────────────────────────────────────

function FallbackCityScopeFit({ cities, focusNonce }: { cities: City[]; focusNonce: number }) {
  const map = useMap();
  const key = JSON.stringify(cities.map(city => [city.lat, city.lng]));
  useEffect(() => {
    const points: L.LatLngTuple[] = JSON.parse(key);
    if (points.length < 2) return;
    const fit = () => {
      const padding = mapPadding(true);
      map.fitBounds(points, {
        animate: false, maxZoom: 12,
        paddingTopLeft: [padding.left, padding.top], paddingBottomRight: [padding.right, padding.bottom],
      });
    };
    fit();
    return onMapResize(fit, map);
  }, [map, key, focusNonce]);
  return null;
}

function FallbackFlyTo({
  city,
  selectedPlace,
  focusNonce,
}: {
  city: City;
  selectedPlace?: Place | null;
  focusNonce: number;
}) {
  const map = useMap();
  const previous = useRef<{ nonce: number; city: string } | null>(null);
  const { id: selectedId, lat: selectedLat, lng: selectedLng } = selectedPlace ?? {};
  useEffect(() => {
    const refocusCity =
      !previous.current ||
      previous.current.nonce !== focusNonce ||
      previous.current.city !== city.name;
    previous.current = { nonce: focusNonce, city: city.name };
    if (selectedId && selectedLat !== undefined && selectedLng !== undefined) {
      const fit = () => {
        const padding = mapPadding(true);
        map.fitBounds([[selectedLat, selectedLng]], {
          animate: false,
          paddingTopLeft: [padding.left, padding.top],
          paddingBottomRight: [padding.right, padding.bottom],
          maxZoom: 15,
        });
      };
      fit();
      return onMapResize(fit, map);
    } else if (refocusCity)
      map.setView([city.lat, city.lng], city.zoom, { animate: false });
  }, [city.name, city.lat, city.lng, city.zoom, selectedId, selectedLat, selectedLng, focusNonce, map]);
  return null;
}

function FallbackRouteFit({
  places,
  overview,
  selected,
  roadPoints,
  command,
}: {
  places: Place[];
  overview: boolean;
  selected: boolean;
  roadPoints?:{latitude:number;longitude:number}[][];
  command: number;
}) {
  const map = useMap();
  const geometryKey=JSON.stringify([places.map(p=>[p.lat,p.lng]),roadPoints]);
  useEffect(() => {
    const [points, roads]: [L.LatLngTuple[], typeof roadPoints] = JSON.parse(geometryKey);
    const fit = () => {
      if (selected || points.length === 0) return;
      const padding = mapPadding(overview);
      map.fitBounds(
        roads?.length ? roads.flatMap(leg => leg.map(roadToLeaflet)) : points,
        {
          paddingTopLeft: [padding.left, padding.top],
          paddingBottomRight: [padding.right, padding.bottom],
          maxZoom: 14,
        },
      );
    };
    fit();
    return onMapResize(fit, map);
  }, [geometryKey, map, overview, selected, command]);
  return null;
}

function FallbackOverviewFit({
  places,
  selected,
  hasRoute,
  overview,
}: {
  places: Place[];
  selected: boolean;
  hasRoute: boolean;
  overview: boolean;
}) {
  const map = useMap();
  const last = useRef("");
  const key = JSON.stringify(places.map((p) => [p.lat, p.lng]));
  useEffect(() => {
    const points: L.LatLngTuple[] = JSON.parse(key);
    if (selected || hasRoute || !points.length) return;
    const fit = () => {
      const padding = mapPadding(overview);
      map.fitBounds(
        points,
        {
          animate: false,
          paddingTopLeft: [padding.left, padding.top],
          paddingBottomRight: [padding.right, padding.bottom],
          maxZoom: 14,
        },
      );
    };
    if (last.current !== `${key}:${overview}`) {
      last.current = `${key}:${overview}`;
      fit();
    }
    return onMapResize(fit, map);
  }, [key, selected, hasRoute, overview, map]);
  return null;
}

function FallbackZoomCommand({ value, onZoomStateChange }: { value: number; onZoomStateChange?: (state: MapZoomState) => void }) {
  const map = useMap();
  const previous = useRef(value);
  const target = useRef<number|null>(null);
  const issuing = useRef(false);
  useEffect(() => {
    let last:MapZoomState|undefined;
    const report = () => {
      const state=zoomAvailability(map.getZoom(),2,18);
      if(!last || state.canZoomIn!==last.canZoomIn || state.canZoomOut!==last.canZoomOut){last=state;onZoomStateChange?.(state);}
      if(target.current!==null && Math.abs(map.getZoom()-target.current)<.001)target.current=null;
    };
    const interrupt=()=>{if(!issuing.current)target.current=null;};
    report();map.on("zoomend",report);map.on("movestart",interrupt);
    return ()=>{map.off("zoomend",report);map.off("movestart",interrupt);map.stop();};
  },[map,onZoomStateChange]);
  useEffect(()=>{
    const delta=value-previous.current;previous.current=value;if(!delta)return;
    target.current=Math.max(2,Math.min(18,(target.current??map.getZoom())+delta));
    issuing.current=true;
    map.flyTo(map.getCenter(),target.current,{duration:.3,animate:!window.matchMedia("(prefers-reduced-motion: reduce)").matches});
    issuing.current=false;
  },[map,value]);
  return null;
}

// ── 主组件：高德地图（+ 降级）────────────────────────────────────

export function MapView({
  city,
  places,
  selectedPlace,
  onSelectPlace,
  mode,
  mapMode,
  focusNonce,
  zoomCommand,
  onZoomStateChange,
  northCommand = 0,
  onRotationChange,
  routePlaces = [],
  routeOverview = false,
  routeFitCommand = 0,
  footprint,
  myPosition,
  locationFocus = 0,
  scopeCities,
  roadPoints,
  focusedLeg,
  todayRoutes,
  todayFocus,
  stayArea,
}: {
  city: City;
  places: Place[];
  selectedPlace?: Place | null;
  onSelectPlace: (place: Place) => void;
  mode: "young" | "business";
  mapMode: MapMode;
  focusNonce: number;
  zoomCommand: number;
  northCommand?: number;
  onZoomStateChange?: (state: MapZoomState) => void;
  onRotationChange?: (rotation: number) => void;
  routePlaces?: Place[];
  roadPoints?: {latitude:number;longitude:number}[][];
  /** Leg of roadPoints to emphasise; the others dim and the camera frames it. */
  focusedLeg?: number;
  todayRoutes?: TodayRouteLine[];
  todayFocus?: string | null;
  stayArea?: Place;
  routeOverview?: boolean;
  routeFitCommand?: number;
  footprint?: FootprintMap;
  myPosition?: CurrentPosition | null;
  locationFocus?: number;
  scopeCities?: City[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapInstance | null>(null);
  const routeLineRef = useRef<AMapOverlay[] | null>(null);
  const satelliteLayerRef = useRef<AMapOverlay | null>(null);
  const previousZoomCommand = useRef(zoomCommand);
  const previousNorthCommand = useRef(northCommand);
  const markersMapRef = useRef(new Map<string, PlaceMarker>());
  const amapRef = useRef<AMapSdk | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [viewport,setViewport]=useState<MapViewport>({center:{lat:city.lat,lng:city.lng}});
  const fallbackRef=useRef<L.Map|null>(null);
  const fallbackReady=useCallback((map:L.Map)=>{fallbackRef.current=map;},[]);
  const jumpTo=useCallback((lat:number,lng:number)=>{
    const map=mapRef.current;
    if(map){map.__smoothZoom?.stop();map.setZoomAndCenter(10,wgsToGcj(lng,lat));}
    else fallbackRef.current?.flyTo([lat,lng],10,{duration:.5});
  },[]);
  useEffect(()=>{
    const map=mapRef.current;if(!map||!mapReady)return;
    const report=()=>{
      const c=map.getCenter(),b=map.getBounds(),sw=b.getSouthWest(),ne=b.getNorthEast();
      const [lng,lat]=gcjToWgs(c.lng,c.lat),[west,south]=gcjToWgs(sw.lng,sw.lat),[east,north]=gcjToWgs(ne.lng,ne.lat);
      setViewport({center:{lat,lng},bounds:{west,south,east,north}});
    };
    report();map.on('moveend',report);map.on('zoomend',report);
    const container=map.getContainer();
    const stop=installMapLongPress(container,p=>{const r=container.getBoundingClientRect(),c=map.containerToLngLat([p.x-r.left,p.y-r.top]);map.__smoothZoom?.stop();map.setZoomAndCenter(Math.max(10,Math.min(18,map.getZoom()+2)),c);});
    return ()=>{map.off('moveend',report);map.off('zoomend',report);stop();};
  },[mapReady]);

  // ── 稳定化回调引用，避免每次渲染触发 effect ──
  const onSelectPlaceRef = useRef(onSelectPlace);
  onSelectPlaceRef.current = onSelectPlace;

  const amapKey = (import.meta.env.VITE_AMAP_KEY as string) || "";
  const mapStyle =
    mode === "business" ? "amap://styles/dark" : "amap://styles/whitesmoke";

  const mapOptions = useRef({ city, mapStyle });
  mapOptions.current = { city, mapStyle };

  // 1) 初始化高德地图
  useEffect(() => {
    setMapReady(false);
    if (!amapKey) {
      setMapError(true);
      return;
    }
    const markers = markersMapRef.current;
    let cancelled = false;
    let expired = false;
    const loadTimeout = window.setTimeout(() => {
      expired = true;
      if (!cancelled) setMapError(true);
    }, 12000);
    AMapLoader.load({ key: amapKey, version: "2.0", plugins: ["AMap.AutoComplete"] })
      .then((AMap: AMapSdk) => {
        window.clearTimeout(loadTimeout);
        if (cancelled || expired || !containerRef.current) return;
        amapRef.current = AMap;
        const { city, mapStyle } = mapOptions.current;
        const map = new AMap.Map(containerRef.current, {
          zoom: city.zoom,
          zooms: [2, 18],
          center: [city.lng, city.lat],
          viewMode: "2D",
          scrollWheel: false, // AMap 原生滚轮缩放不流畅，自行实现
          mapStyle,
          features: ["bg", "point", "road", "building"],
        });
        mapRef.current = map;

        // ── 触控板手势：捏合/缩放/平移 ──
        // AMap 原生 scrollWheel 缩放卡顿 → 自行实现：RAF 批处理 + 缩放 lerp 动画
        let rafId = 0;
        let pendingPanX = 0;
        let pendingPanY = 0;
        let pendingScale = 1;
        const smoothZoom = createSmoothMapZoom({getZoom:()=>map.getZoom(),setZoom:zoom=>map.setZoom(zoom,true)},2,18,{
          reducedMotion:()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        });
        map.__smoothZoom = smoothZoom;
        const interruptZoom = () => { smoothZoom.stop(); pendingScale=1; };
        map.getContainer().addEventListener("pointerdown",interruptZoom);

        const flush = () => {
          rafId = 0;
          if (Math.abs(pendingScale - 1) > 0.0001) {
            smoothZoom.step(Math.log2(pendingScale));
            pendingScale = 1;
          }
          if (pendingPanX !== 0 || pendingPanY !== 0) {
            map.panBy(pendingPanX, pendingPanY);
            pendingPanX = 0;
            pendingPanY = 0;
          }
        };

        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.ctrlKey || Math.abs(e.deltaZ) > 0) {
            const scale = Math.exp(-e.deltaY * 0.016);
            pendingScale *= Math.max(0.72, Math.min(1.38, scale));
          } else {
            pendingPanX += -e.deltaX * 2.0;
            pendingPanY += -e.deltaY * 2.0;
          }
          if (!rafId) rafId = requestAnimationFrame(flush);
        };
        map
          .getContainer()
          .addEventListener("wheel", onWheel, { passive: false });

        map.__wheelCleanup = () => {
          map.getContainer()?.removeEventListener("wheel", onWheel);
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
          }
          map.getContainer()?.removeEventListener("pointerdown",interruptZoom);
          smoothZoom.stop();
        };

        setMapReady(true);
      })
      .catch(() => {
        window.clearTimeout(loadTimeout);
        if (!cancelled) setMapError(true);
      });
    return () => {
      window.clearTimeout(loadTimeout);
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.__wheelCleanup?.();
        mapRef.current.destroy();
      }
      mapRef.current = null;
      satelliteLayerRef.current = null;
      routeLineRef.current = null;
      markers.clear();
      overviewFit.current = "";
    };
  }, [amapKey]);

  // 2) 同步 places → AMap markers（增量 diff：只增删变化的，不动没变的）
  useEffect(() => {
    if (!mapRef.current || !amapRef.current) return;
    const AMap = amapRef.current;
    const map = mapRef.current;
    const existing = markersMapRef.current;

    const markerContent = (place: Place, selected: boolean) => {
      const index = routePlaces.findIndex((p) => p.id === place.id);
      const element = document.createElement("button");
      element.type = "button";
      element.className = "map-marker-button";
      element.setAttribute("aria-label", `地图地点：${place.name}`);
      element.title = `查看${place.name}详情`;
      element.innerHTML = renderPlacePinHTML(place, selected, mode, index);
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onSelectPlaceRef.current(place);
        }
      });
      return element;
    };

    // 计算新 places 的 key 集合
    const nextKeys = new Set(places.map((p) => `${p.type}-${p.id}`));

    // ① 删除已移除的 marker
    existing.forEach((marker, key) => {
      if (!nextKeys.has(key)) {
        map.remove(marker);
        existing.delete(key);
      }
    });

    // ② 新增或更新 marker（不重建没变的）
    places.forEach((place) => {
      const key = `${place.type}-${place.id}`;
      const isSelected = selectedPlace?.id === place.id;
      const old = existing.get(key);

      if (old) {
        // 更新已有 marker（content / zIndex 随 mode / selected 变化）
        const routeIndex = routePlaces.findIndex((p) => p.id === place.id);
        if (
          old.__place !== place ||
          old.__selected !== isSelected ||
          old.__mode !== mode ||
          old.__routeIndex !== routeIndex
        ) {
          old.setContent(markerContent(place, isSelected));
          old.setPosition([place.lng, place.lat]);
          old.setzIndex(isSelected ? 200 : 100);
        }
        old.__place = place;
        old.__selected = isSelected;
        old.__mode = mode;
        old.__routeIndex = routeIndex;
      } else {
        // 创建新 marker
        const content = markerContent(place, isSelected);
        const marker: PlaceMarker = new AMap.Marker({
          position: [place.lng, place.lat],
          content,
          offset: new AMap.Pixel(-22, -22),
          zIndex: isSelected ? 200 : 100,
        });
        marker.__place = place;
        marker.__selected = isSelected;
        marker.__mode = mode;
        marker.__routeIndex = routePlaces.findIndex((p) => p.id === place.id);
        marker.on("click", () => onSelectPlaceRef.current(marker.__place ?? place));
        map.add(marker);
        existing.set(key, marker);
      }
    });
  }, [places, selectedPlace, mode, mapReady, routePlaces]);

  const previousFocus = useRef<{
    nonce: number;
    city: string;
    map: unknown;
  } | null>(null);
  // Preserve the camera when closing details; only explicit focus commands reset a city.
  const { id: selectedId, lat: selectedLat, lng: selectedLng } = selectedPlace ?? {};
  const { name: cityName, lat: cityLat, lng: cityLng, zoom: cityZoom } = city;
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const firstFocus =
      !previousFocus.current || previousFocus.current.map !== map;
    const animate =
      !firstFocus &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const refocusCity =
      !previousFocus.current ||
      previousFocus.current.nonce !== focusNonce ||
      previousFocus.current.city !== cityName ||
      previousFocus.current.map !== mapRef.current;
    previousFocus.current = {
      nonce: focusNonce,
      city: cityName,
      map: mapRef.current,
    };
    const AMap = amapRef.current;
    if (selectedId && selectedLat !== undefined && selectedLng !== undefined && AMap) {
      const fit = (transition = false) => {
        const padding = mapPadding(true);
        const marker = new AMap.Marker({
          position: [selectedLng, selectedLat],
        });
        const avoid = [
          padding.top,
          padding.bottom,
          padding.left,
          padding.right,
        ];
        if (
          transition &&
          typeof map.getFitZoomAndCenterByOverlays === "function"
        ) {
          const [zoom, center] = map.getFitZoomAndCenterByOverlays(
            [marker],
            avoid,
            15,
          );
          map.__smoothZoom?.stop();
          map.setZoomAndCenter(zoom, center, false, 180);
        } else { map.__smoothZoom?.stop(); map.setFitView([marker], true, avoid, 15); }
      };
      fit(animate);
      return onMapResize(fit, map);
    } else if (refocusCity) {
      map.__smoothZoom?.stop();
      map.setZoomAndCenter(
        cityZoom,
        [cityLng, cityLat],
        !animate,
        animate ? 180 : 0,
      );
    }
  }, [focusNonce, selectedId, selectedLat, selectedLng, cityName, cityLat, cityLng, cityZoom, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || mapError || !onRotationChange) return;
    return subscribeMapOrientation(map, onRotationChange);
  }, [mapReady, mapError, onRotationChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || mapError || previousNorthCommand.current === northCommand) return;
    previousNorthCommand.current = northCommand;
    resetMapNorth(map);
    onRotationChange?.(0);
  }, [northCommand, mapReady, mapError, onRotationChange]);

  // Keep controls synchronized with mouse, keyboard and programmatic zoom changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || mapError) return;
    let last:MapZoomState|undefined;
    const report=()=>{const next=zoomAvailability(map.getZoom(),2,18);if(!last||last.canZoomIn!==next.canZoomIn||last.canZoomOut!==next.canZoomOut){last=next;onZoomStateChange?.(next);}};
    report();
    map.on("zoomend", report);
    return () => { map.off("zoomend", report); };
  }, [mapReady, mapError, onZoomStateChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || mapError) return;
    const delta = zoomCommand - previousZoomCommand.current;
    previousZoomCommand.current = zoomCommand;
    if (!delta) return;
    map.__smoothZoom?.step(delta);
    onZoomStateChange?.(zoomAvailability(map.getZoom(), 2, 18));
  }, [zoomCommand, mapReady, mapError, onZoomStateChange]);

  // Updating order redraws the line but preserves the user's map position.
  useEffect(() => {
    const map = mapRef.current,
      AMap = amapRef.current;
    if (!map || !AMap) return;
    const previous=Array.isArray(routeLineRef.current)?routeLineRef.current:routeLineRef.current?[routeLineRef.current]:[];
    if(previous.length)map.remove(previous);
    const paths=todayRoutes ? todayRoutes.map(leg=>leg.points.map(p=>[p.longitude,p.latitude]))
      : roadPoints?.length ? roadPoints.map(leg=>leg.map(p=>[p.longitude,p.latitude]))
      : routePlaces.length>1 ? [routePlaces.map(p=>[p.lng,p.lat])] : [];
    routeLineRef.current=paths.map((path,index)=>({path,index})).filter(({path})=>path.length>1).map(({path,index})=>{
      const focused=todayRoutes ? todayRoutes[index].id === todayFocus : focusedLeg===index;
      const dimmed=!todayRoutes && focusedLeg!==undefined&&!focused;
      return new AMap.Polyline({path,strokeColor:routeColor(!!todayRoutes?.[index].late,focused,mode==="business"),strokeWeight:focused?6:3,strokeStyle:todayRoutes||roadPoints?.length?'solid':'dashed',strokeOpacity:dimmed?0.3:focused?1:0.85,zIndex:focused?95:90});
    });
    if(routeLineRef.current.length)map.add(routeLineRef.current);
  }, [routePlaces, roadPoints, todayRoutes, todayFocus, mapReady, focusedLeg, mode]);

  // Frame the focused leg so the timeline and the map point at the same segment.
  useEffect(() => {
    const map = mapRef.current, AMap = amapRef.current;
    const points = todayRoutes?.find(route => route.id === todayFocus)?.points
      ?? (focusedLeg === undefined ? undefined : roadPoints?.[focusedLeg]);
    if (!map || !AMap || !points || points.length < 2) return;
    const padding = mapPadding(!todayRoutes);
    map.__smoothZoom?.stop();
    map.setFitView([new AMap.Polyline({ path: points.map(p => [p.longitude, p.latitude]) })], false, [padding.top, padding.bottom, padding.left, padding.right], 17);
  }, [focusedLeg, roadPoints, todayRoutes, todayFocus, mapReady]);

  const routeBoundsKey = JSON.stringify([
    roadPoints?.map(leg=>[leg[0],leg.at(-1)]),routePlaces
      .map((p) => [p.lng, p.lat])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
  ]);
  const routeFitInput = useRef({ routePlaces, todayRoutes });
  routeFitInput.current = { routePlaces, todayRoutes };
  useEffect(() => {
    const { routePlaces, todayRoutes } = routeFitInput.current;
    const map = mapRef.current,
      AMap = amapRef.current;
    if (!map || !AMap || !routePlaces.length || selectedId) return;
    const targets = !todayRoutes && routeLineRef.current?.length
      ? routeLineRef.current
      : routePlaces.map(
          (p) =>
            markersMapRef.current.get(`${p.type}-${p.id}`) ??
            new AMap.Marker({ position: [p.lng, p.lat] }),
        );
    const fit = () => {
      const padding = mapPadding(routeOverview);
      map.__smoothZoom?.stop();
      map.setFitView(
        targets,
        true,
        [padding.top, padding.bottom, padding.left, padding.right],
        14,
      );
    };
    fit();
    return onMapResize(fit, map);
  }, [routeBoundsKey, mapReady, routeOverview, selectedId, routeFitCommand]);

  const overviewFit = useRef("");
  const hasSelectedPlace = !!selectedPlace;
  const overviewKey = JSON.stringify(places.map((p) => [p.type, p.id, p.lat, p.lng]));
  useEffect(() => {
    const map = mapRef.current,
      AMap = amapRef.current;
    const points: [Place["type"], string, number, number][] = JSON.parse(overviewKey);
    if (!map || !AMap || hasSelectedPlace || routePlaces.length || !points.length) return;
    const targets = points.map(([type, id, lng, lat]) =>
      markersMapRef.current.get(`${type}-${id}`) ?? new AMap.Marker({ position: [lng, lat] }),
    );
    const fit = () => {
      const padding = mapPadding(routeOverview);
      map.__smoothZoom?.stop();
      map.setFitView(
        targets,
        true,
        [padding.top, padding.bottom, padding.left, padding.right],
        14,
      );
    };
    if (overviewFit.current !== `${overviewKey}:${routeOverview}`) {
      overviewFit.current = `${overviewKey}:${routeOverview}`;
      fit();
    }
    return onMapResize(fit, map);
  }, [
    overviewKey,
    mapReady,
    hasSelectedPlace,
    routePlaces.length,
    routeOverview,
  ]);

  const scopeCitiesKey = JSON.stringify(scopeCities?.map(city => [city.lat, city.lng]) ?? []);
  useEffect(() => {
    const map = mapRef.current, AMap = amapRef.current;
    const points: [number, number][] = JSON.parse(scopeCitiesKey);
    if (!map || !AMap || hasSelectedPlace || points.length < 2) return;
    const fit = () => {
      const padding = mapPadding(true);
      map.__smoothZoom?.stop();
      map.setFitView(points.map(([lat, lng]) => new AMap.Marker({ position: [lng, lat] })), true,
        [padding.top, padding.bottom, padding.left, padding.right], 12);
    };
    fit();
    return onMapResize(fit, map);
  }, [scopeCitiesKey, focusNonce, mapReady, hasSelectedPlace]);

  // 5) mapMode 变化 → 切换图层
  useEffect(() => {
    if (!mapRef.current || !amapRef.current) return;
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (mapMode === "satellite" && !satelliteLayerRef.current) {
      satelliteLayerRef.current = new AMap.TileLayer.Satellite();
      map.add(satelliteLayerRef.current);
    } else if (mapMode !== "satellite" && satelliteLayerRef.current) {
      map.remove(satelliteLayerRef.current);
      satelliteLayerRef.current = null;
    }
  }, [mapMode, mapReady]);

  // 6) mode 变化 → 切换 mapStyle（young / business 暗色）
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const applyStyle = () => {
      map.setMapStyle(mapStyle);
      map.getContainer?.().setAttribute("data-map-style", mode);
    };
    applyStyle();
    map.on?.("complete", applyStyle);
    const timer = window.setTimeout(applyStyle, 300);
    return () => {
      window.clearTimeout(timer);
      map.off?.("complete", applyStyle);
    };
  }, [mapStyle, mode, mapReady]);

  // ── MiniMap 跳转 ──
  const { points: footprintPoints, label: footprintLabel, focusKey: footprintFocus } = footprint ?? {};
  const footprintOverlays = useRef<AMapOverlay[]>([]);
  useEffect(() => {
    const map = mapRef.current,
      AMap = amapRef.current;
    if (!map || !AMap) return;
    if (footprintOverlays.current.length) map.remove(footprintOverlays.current);
    const overlays: AMapOverlay[] = [];
    if (footprintPoints && footprintLabel !== undefined) {
      for (const segment of trackSegments(footprintPoints)) {
        if (segment.length === 1) overlays.push(new AMap.CircleMarker({ center:wgsToGcj(segment[0].lng,segment[0].lat),radius:5,strokeColor:"#fff",strokeWeight:2,fillColor:"#155bd0",fillOpacity:1,zIndex:150 }));
        if (segment.length > 1)
          overlays.push(
            new AMap.Polyline({
              path: segment.map((p) => wgsToGcj(p.lng, p.lat)),
              strokeColor: "#155bd0",
              strokeWeight: 4,
              strokeOpacity: 0.9,
              zIndex: 120,
            }),
          );
      }
      const last = footprintPoints.at(-1);
      if (last) {
        const center = wgsToGcj(last.lng, last.lat);
        if (last.accuracy > 0)
          overlays.push(
            new AMap.Circle({
              center,
              radius: last.accuracy,
              strokeColor: "#155bd0",
              strokeWeight: 1,
              strokeOpacity: 0.3,
              fillColor: "#155bd0",
              fillOpacity: 0.08,
              zIndex: 110,
            }),
          );
        const markerElement = document.createElement("div");
        markerElement.className = "footprint-position";
        markerElement.setAttribute("role", "img");
        markerElement.setAttribute("aria-label", footprintLabel);
        overlays.push(
          new AMap.Marker({
            position: center,
            title: footprintLabel,
            content: markerElement,
            offset: new AMap.Pixel(-9, -9),
            zIndex: 200,
          }),
        );
      }
    }
    if (overlays.length) map.add(overlays);
    footprintOverlays.current = overlays;
    return () => {
      if (overlays.length) map.remove(overlays);
      footprintOverlays.current = [];
    };
  }, [footprintPoints, footprintLabel, mapReady]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || footprintFocus === undefined) return;
    const fit = () => {
      if (!footprintOverlays.current.length) return;
      const p = mapPadding(true);
      map.__smoothZoom?.stop();
      map.setFitView(
        footprintOverlays.current,
        true,
        [p.top, p.bottom, p.left, p.right],
        16,
      );
    };
    fit();
    return onMapResize(fit, map);
  }, [footprintFocus, mapReady]);

  useEffect(() => {
    const map = mapRef.current, AMap = amapRef.current;
    if (!map || !AMap || !stayArea) return;
    const area = new AMap.Circle({ center:[stayArea.lng,stayArea.lat], radius:850, strokeColor:"#367cc7",
      strokeWeight:2, fillColor:"#367cc7", fillOpacity:0.12, bubble:true });
    map.add(area);
    return () => map.remove(area);
  }, [mapReady, stayArea]);

  const currentPositionOverlays = useRef<AMapOverlay[]>([]);
  useEffect(() => {
    const map = mapRef.current,
      AMap = amapRef.current;
    if (!map || !AMap) return;
    const overlays: AMapOverlay[] = [];
    if (myPosition) {
      const center = wgsToGcj(myPosition.lng, myPosition.lat);
      const dot = document.createElement("div");
      const locationLabel =
        "我的位置，定位于" +
        new Date(myPosition.time).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        });
      dot.className = "my-location-position";
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", locationLabel);
      overlays.push(
        new AMap.Circle({
          center,
          radius: myPosition.accuracy,
          strokeColor: "#155bd0",
          strokeWeight: 1,
          strokeOpacity: 0.3,
          fillColor: "#155bd0",
          fillOpacity: 0.08,
          zIndex: 220,
        }),
      );
      overlays.push(
        new AMap.Marker({
          position: center,
          content: dot,
          title: locationLabel,
          offset: new AMap.Pixel(-9, -9),
          zIndex: 230,
        }),
      );
      map.add(overlays);
    }
    currentPositionOverlays.current = overlays;
    return () => {
      if (overlays.length) map.remove(overlays);
      currentPositionOverlays.current = [];
    };
  }, [myPosition, mapReady]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !locationFocus) return;
    const fit = () => {
      if (!currentPositionOverlays.current.length) return;
      const p = mapPadding(true);
      map.__smoothZoom?.stop();
      map.setFitView(
        currentPositionOverlays.current,
        true,
        [p.top, p.bottom, p.left, p.right],
        16,
      );
    };
    fit();
    return onMapResize(fit, map);
  }, [locationFocus, mapReady]);
  return (
    <>
      {/* 高德地图容器 */}
      {!mapError && (
        <div ref={containerRef} className="amap-container h-full w-full" />
      )}

      {/* 降级 Leaflet 地图 */}
      {mapError && (
        <FallbackLeafletMap
          city={city}
          places={places.map(placeInWgs)}
          selectedPlace={selectedPlace ? placeInWgs(selectedPlace) : null}
          onSelectPlace={place => { const original = places.find(p => p.id === place.id); if (original) onSelectPlace(original); }}
          mode={mode}
          mapMode={mapMode}
          focusNonce={focusNonce}
          zoomCommand={zoomCommand}
          onZoomStateChange={onZoomStateChange}
          onRotationChange={onRotationChange}
          routePlaces={routePlaces.map(placeInWgs)}
          roadPoints={roadPoints}
   focusedLeg={focusedLeg}
          todayRoutes={todayRoutes}
          todayFocus={todayFocus}
          stayArea={stayArea ? placeInWgs(stayArea) : undefined}
          routeOverview={routeOverview}
          routeFitCommand={routeFitCommand}
          footprint={footprint}
          myPosition={myPosition}
          locationFocus={locationFocus}
          scopeCities={scopeCities}
          onViewport={setViewport}
          onMapReady={fallbackReady}
        />
      )}

      {(mapReady||mapError)&&<ChinaMiniMap mainMapCenter={viewport.center} mainMapBounds={viewport.bounds} onJumpToLocation={jumpTo} amap={mapReady&&!mapError?amapRef.current ?? undefined:undefined} appearance={mode}/>}

      {/* 加载中 */}
      {!mapReady && !mapError && (
        <div className="map-loading" role="status" aria-label="地图加载中">
          <Loader2 className="animate-spin text-slate-400" size={28} />
        </div>
      )}

      {/* 高德加载失败提示 */}
      {mapError && (
        <div className="map-error-note" role="status">
          已切换至备用地图
        </div>
      )}
    </>
  );
}

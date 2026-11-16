import type { OrientationMap } from "./mapOrientation";
import type { createSmoothMapZoom } from "./mapZoom";

type Coordinates = [number, number] | { lng: number; lat: number };
type Options = Record<string, unknown>;
export type AMapOverlay = object;

export interface AMapMarker extends AMapOverlay {
  on(event: "click", handler: () => void): void;
  setContent(content: HTMLElement): void;
  setPosition(position: Coordinates): void;
  setzIndex(index: number): void;
}

export interface AMapInstance extends OrientationMap {
  on(event: string, handler: (event: { lnglat: { lng: number; lat: number } }) => void): void;
  off(event: string, handler: () => void): void;
  add(overlays: AMapOverlay | AMapOverlay[]): void;
  remove(overlays: AMapOverlay | AMapOverlay[]): void;
  destroy(): void;
  getContainer(): HTMLElement;
  getCenter(): { lng: number; lat: number };
  getBounds(): { getSouthWest(): { lng: number; lat: number }; getNorthEast(): { lng: number; lat: number } };
  containerToLngLat(point: [number, number]): { lng: number; lat: number };
  getZoom(): number;
  setZoom(zoom: number, immediately: boolean): void;
  setZoomAndCenter(zoom: number, center: Coordinates, immediately?: boolean, duration?: number): void;
  getFitZoomAndCenterByOverlays?(overlays: AMapOverlay[], padding: number[], maxZoom?: number): [number, Coordinates];
  setFitView(overlays: AMapOverlay[], immediately: boolean, padding: number[], maxZoom?: number): void;
  setMapStyle(style: string): void;
  panBy(x: number, y: number): void;
  __smoothZoom?: ReturnType<typeof createSmoothMapZoom>;
  __wheelCleanup?: () => void;
}

// The loader provides the browser SDK dynamically. This is the surface used by the two maps.
export interface AMapSdk {
  Map: new (element: HTMLElement, options: Options) => AMapInstance;
  Marker: new (options: Options) => AMapMarker;
  Pixel: new (x: number, y: number) => object;
  Polyline: new (options: Options) => AMapOverlay;
  Circle: new (options: Options) => AMapOverlay;
  CircleMarker: new (options: Options) => AMapOverlay;
  Polygon: new (options: Options) => AMapOverlay;
  TileLayer: { Satellite: new () => AMapOverlay };
}

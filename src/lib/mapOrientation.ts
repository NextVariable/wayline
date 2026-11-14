export interface OrientationMap {
  getRotation(): number;
  setRotation(rotation: number, immediately: boolean): unknown;
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
}

export function normalizeRotation(rotation: number) {
  return Number.isFinite(rotation) ? ((rotation % 360) + 360) % 360 : 0;
}

export function subscribeMapOrientation(map: OrientationMap, onChange: (rotation: number) => void) {
  const report = () => onChange(normalizeRotation(map.getRotation()));
  report();
  map.on("rotatechange", report);
  return () => { map.off("rotatechange", report); };
}

export function resetMapNorth(map: OrientationMap) {
  map.setRotation(0, true);
}

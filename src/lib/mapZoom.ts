export interface MapZoomState {
  canZoomIn: boolean;
  canZoomOut: boolean;
}

export interface ZoomableMap {
  getZoom(): number;
  setZoom(zoom: number): unknown;
}

export function zoomAvailability(zoom: number, min: number, max: number): MapZoomState {
  return { canZoomIn: zoom < max - 0.001, canZoomOut: zoom > min + 0.001 };
}

/** Apply the entire click delta, including clicks batched in one render. */
export function applyMapZoom(map: ZoomableMap, delta: number, min: number, max: number) {
  if (!delta) return;
  const current = map.getZoom();
  const target = Math.max(min, Math.min(max, current + delta));
  if (Math.abs(target - current) > 0.001) map.setZoom(target);
}

/** One shared camera target: clicks and pinches retarget motion, never queue jumps. */
export function createSmoothMapZoom(map: ZoomableMap, min: number, max: number, options: {
  frame?: (callback: FrameRequestCallback) => number;
  cancel?: (id: number) => void;
  reducedMotion?: () => boolean;
} = {}) {
  const frame = options.frame ?? requestAnimationFrame;
  const cancel = options.cancel ?? cancelAnimationFrame;
  let pending: number | null = null;
  let target = map.getZoom();
  let position = target;
  let velocity = 0;
  let previousTime: number | null = null;
  const clamp = (zoom: number) => Math.max(min, Math.min(max, zoom));
  const stop = () => {
    if (pending !== null) cancel(pending);
    pending = null; velocity = 0; previousTime = null;
    target = map.getZoom(); position = target;
  };
  const tick: FrameRequestCallback = time => {
    pending = null;
    const dt = previousTime === null ? 1 / 60 : Math.min(.032, Math.max(0, (time - previousTime) / 1000));
    previousTime = time;
    const current = position;
    const offset = current - target;
    const omega = 18;
    const impulse = velocity + omega * offset;
    const decay = Math.exp(-omega * dt);
    const next = clamp(target + (offset + impulse * dt) * decay);
    velocity = (velocity - omega * impulse * dt) * decay;
    if (Math.abs(next - target) < .001 && Math.abs(velocity) < .015) {
      position = target; map.setZoom(target); velocity = 0; previousTime = null;
      return;
    }
    position = next; map.setZoom(next);
    pending = frame(tick);
  };
  return {
    stop,
    step(delta: number) {
      if (!Number.isFinite(delta) || !delta) return;
      if (pending === null) { target = map.getZoom(); position = target; velocity = 0; previousTime = null; }
      target = clamp(target + delta);
      if (options.reducedMotion?.()) { const end = target; stop(); target = end; map.setZoom(end); return; }
      if (pending === null && Math.abs(target - map.getZoom()) > .001) pending = frame(tick);
    },
  };
}

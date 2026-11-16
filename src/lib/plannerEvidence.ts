import type { PlannerResult } from "../types/place";

type RouteEvidence = NonNullable<PlannerResult["routeEvidence"]>;
type RouteLeg = RouteEvidence["legs"][number];
type RoutePoint = RouteLeg["points"][number];

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length < 4000;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;

function isRoutePoint(value: unknown): value is RoutePoint {
  return record(value) && finite(value.latitude) && Math.abs(value.latitude) <= 90 &&
    finite(value.longitude) && Math.abs(value.longitude) <= 180;
}

function isRouteLeg(value: unknown): value is RouteLeg {
  return record(value) && text(value.from) && text(value.to) &&
    nonnegative(value.duration) && nonnegative(value.distance) &&
    Array.isArray(value.points) && value.points.length <= 100000 && value.points.every(isRoutePoint);
}

export function normalizeRouteEvidence(value: unknown): RouteEvidence | undefined {
  if (!record(value) || value.source !== "amap" || !nonnegative(value.observedAt)) return;
  const { legs, mode, scope, observedAt } = value;
  if (!Array.isArray(legs) || legs.length > (scope === "joint" ? 64 : 11) || !legs.every(isRouteLeg)) return;
  return {
    source: "amap",
    observedAt,
    legs,
    ...(scope === "joint" ? { scope } : {}),
    ...(mode === "driving" || mode === "walking" || mode === "transit" ? { mode } : {}),
  };
}

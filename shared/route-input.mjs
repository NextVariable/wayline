const point = value => {
  if (!value || !Number.isFinite(value.lat) || !Number.isFinite(value.lng) ||
      Math.abs(value.lat) > 90 || Math.abs(value.lng) > 180 || (!value.lat && !value.lng)) return undefined;
  return {lat:value.lat,lng:value.lng};
};
const poi = value => typeof value === 'string' && /^B[A-Z0-9]{5,19}$/i.test(value) ? value : undefined;

export function routeAccess(value) {
  if (!value || typeof value !== 'object') return undefined;
  const poiId=poi(value.poiId), entrance=point(value.entrance), exit=point(value.exit), vehicle=point(value.vehicle);
  const citycode=typeof value.citycode === 'string' && /^\d{3,4}$/.test(value.citycode) ? value.citycode : undefined;
  if (poiId || citycode || entrance || exit || vehicle) return {poiId,citycode,entrance,exit,vehicle};
}

export function routeEndpoint(place, mode, side) {
  const access=routeAccess(place.routeAccess);
  const poiId=access?.poiId ?? poi(typeof place.id === 'string' && place.id.startsWith('amap:') ? place.id.slice(5) : undefined);
  const gate=side === 'from' ? access?.exit : access?.entrance;
  const candidate=(mode === 'driving' ? access?.vehicle : undefined) ?? gate;
  // A stale or mismatched entrance must not move the route to another neighbourhood.
  const usable=candidate && Math.hypot(candidate.lat-place.lat,candidate.lng-place.lng) <= 0.03;
  return {lat:usable ? candidate.lat : place.lat, lng:usable ? candidate.lng : place.lng,
    poiId, citycode:access?.citycode ?? place.citycode, anchor:usable ? 'access' : poiId ? 'poi' : 'coordinate'};
}

export function plannedDeparture(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) return undefined;
  const time=Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

export function chinaDeparture(value) {
  const iso=plannedDeparture(value);
  if (!iso) return undefined;
  const local=new Date(Date.parse(iso)+8*3600000).toISOString();
  return {date:local.slice(0,10),time:local.slice(11,16)};
}

export const routeMinutes = seconds => Math.ceil(seconds / 60);

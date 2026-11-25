export interface RoutePoint { lat:number; lng:number }
export interface RouteAccess {
  poiId?:string;
  citycode?:string;
  entrance?:RoutePoint;
  exit?:RoutePoint;
  vehicle?:RoutePoint;
}
export function routeAccess(value: unknown): RouteAccess | undefined;
export function routeEndpoint(place: RoutePoint & { id?:string; citycode?:string; routeAccess?:RouteAccess }, mode:string, side:'from'|'to'):
  RoutePoint & { poiId?:string; citycode?:string; anchor:'access'|'poi'|'coordinate' };
export function plannedDeparture(value:unknown): string | undefined;
export function chinaDeparture(value:unknown): {date:string;time:string} | undefined;
export function routeMinutes(seconds:number): number;

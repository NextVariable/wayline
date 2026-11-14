import { isStoredPlace } from "./placeValidation";
import { validDate } from "./footprints";
import type { Place } from "../types/place";
export interface SavedTrip { id: string; name: string; updatedAt: number; places: Place[]; draft: { date: string; days: string; notes: string; preferences: string[]; [key: string]: unknown } }
export function validPlannerDraft(value: unknown): value is SavedTrip["draft"] {
  if (!value || typeof value !== "object") return false;
  const d = value as SavedTrip["draft"];
  if(d.party!==undefined){const p=d.party as Record<string,unknown>;if(!p||!Number.isInteger(p.travelers)||Number(p.travelers)<1||Number(p.travelers)>20||!Number.isInteger(p.rooms)||Number(p.rooms)<1||Number(p.rooms)>Number(p.travelers)||!['twin','double'].includes(p.roomType as string))return false;}
  if (d.departureName !== undefined && (typeof d.departureName !== 'string' || d.departureName.length>120)) return false;
  if (d.earliestDeparture !== undefined && (typeof d.earliestDeparture !== 'string' || d.earliestDeparture!=='' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(d.earliestDeparture))) return false;
  if (d.hotelGroup !== undefined && !['none','huazhu'].includes(d.hotelGroup as string)) return false;
  if (d.nightlyBudget !== undefined && (typeof d.nightlyBudget !== 'string' || d.nightlyBudget!=='' && (!Number.isFinite(Number(d.nightlyBudget)) || Number(d.nightlyBudget)<=0 || Number(d.nightlyBudget)>100000))) return false;
  return typeof d.notes === "string" && d.notes.length <= 12000 && typeof d.date === "string" && (d.date === "" || validDate(d.date)) && typeof d.days === "string" && /^[1-7]$/.test(d.days) && Array.isArray(d.preferences) && d.preferences.length <= 20 && d.preferences.every(p => typeof p === "string" && p.length <= 100) && (d.notesAnchor === undefined || typeof d.notesAnchor === "string" && validDate(d.notesAnchor)) && (d.daysEdited === undefined || typeof d.daysEdited === "boolean");
}
export function savedTripsKey(owner: string) { return `whatto.savedTrips.${owner}`; }
export function readSavedTrips(owner: string): SavedTrip[] {
  try {
    const raw = JSON.parse(localStorage.getItem(savedTripsKey(owner)) ?? "[]");
    return Array.isArray(raw) ? raw.filter(t => t && typeof t.id === "string" && typeof t.name === "string" && Number.isFinite(t.updatedAt) && Array.isArray(t.places) && t.places.every(isStoredPlace) && validPlannerDraft(t.draft)).slice(0, 100) : [];
  } catch { return []; }
}
export function writeSavedTrips(owner: string, trips: SavedTrip[]) {
  if (trips.length > 100) throw new Error("最多保存100份行程，请先移除不需要的行程");
  localStorage.setItem(savedTripsKey(owner), JSON.stringify(trips));
}

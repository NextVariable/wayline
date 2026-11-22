import type { CalendarEntry } from "./calendarEvents";
import type { Place } from "../types/place";
import type { BusinessTrip } from "./businessTrips";
import type { TripBooking, TravelGap, StayNight } from "./businessOrders";
import type { LegOption, TodayLegPair } from "./todayMap";

export type CalendarEvent = CalendarEntry;
export type { Place };
export type Booking = TripBooking;
export interface SourceProvenance {
  source: "google-calendar" | "calendar-file" | "gmail" | "amap" | "wayline";
  recordId: string;
  observedAt?: number;
  confidence: "recorded" | "inferred";
  stale?: boolean;
}
export type RouteEvidence = LegOption & {
  points: { latitude:number; longitude:number }[];
  observedAt?: number;
};
export interface TravelConstraint {
  eventId: string;
  kind: "depart-after" | "arrive-before";
  at: string;
}
export type TripSegment =
  | { kind:"commute"; id:string; pair:TodayLegPair }
  | { kind:"intercity"; id:string; leg:TravelGap; constraints:TravelConstraint[] }
  | { kind:"stay"; id:string; night:StayNight };
export type RiskType = "overlap" | "commute-time" | "intercity" | "missing-location" |
  "booking-conflict" | "booking-change" | "missing-transport" | "missing-stay";
export interface ActionItem {
  kind:"review-calendar" | "confirm-place" | "review-booking" | "compare-transport" | "confirm-stay" | "review-route";
  label: string;
}
export interface TravelRisk {
  id: string;
  type: RiskType;
  severity: "high" | "medium" | "info";
  status: "confirmed" | "uncertain";
  eventIds: string[];
  segmentId?: string;
  evidence: SourceProvenance[];
  basis: string;
  title: string;
  stale: boolean;
  action: ActionItem;
}
export type Trip = BusinessTrip & {
  segments: TripSegment[];
  timeline: ({kind:"event";event:CalendarEvent} | {kind:"booking";booking:Booking})[];
};

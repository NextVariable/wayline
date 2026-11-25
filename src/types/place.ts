export type CoreCityName = "北京" | "上海" | "广州" | "深圳";
export type CityName = CoreCityName | (string & {});

export type PlaceCategory =
  | "food"
  | "business"
  | "university"
  | "transport"
  | "shopping"
  | "attraction"
  | "custom";

export type SystemLayer = Exclude<PlaceCategory, "custom">;

export type MapMode = "explore" | "satellite";
export type AppLanguage = "zh-CN" | "zh-HK" | "zh-TW" | "en" | "ja" | "es" | "ar" | "fr";

export type PlaceStatus = "want_to_go" | "visited" | "saved";

export type PlaceSource = "manual" | "imported" | "saved" | "system";

export interface ExternalLinks {
  amap?: string;
  baidu?: string;
  google?: string;
  apple?: string;
}

/** Timing captured when a schedule is written, kept separate from external calendars. */
export interface ScheduleTiming {
  startTime?: string;
  endTime?: string;
  /** End date when the arrangement crosses midnight; normally the next day. */
  endDate?: string;
  /** IANA zone; local schedules currently use Asia/Shanghai. */
  timezone?: string;
}

export interface Place {
  id: string;
  name: string;
  city: CityName;
  category: PlaceCategory;
  guideCategories?: PlaceCategory[];
  customGuideNames?: string[];
  type: "user" | "system";
  source: PlaceSource;
  lat: number;
  lng: number;
  address: string;
  openingHours: string;
  description: string;
  tags: string[];
  reason: string;
  status: PlaceStatus;
  isSaved: boolean;
  distanceText: string;
  externalLinks: ExternalLinks;
  schedule?: ScheduleTiming;
  calendarEventIds?: string[];
  resourceEvidence?:
    | { provider: "天地图"; query: string; retrievedAt: string; verification: "unverified" }
    | { provider: "高德地图"; retrievedAt: string; officialUrl?: string }
    | { provider: "Wikidata" | "官方地图"; officialUrl: string; coordinateUrl: string };
}

export interface City {
  name: CityName;
  lat: number;
  lng: number;
  zoom: number;
}

export interface ExtractedPlace {
  coordinateSystem?: "GCJ02" | "WGS84";
  name: string;
  city: CityName;
  category: PlaceCategory;
  source: "imported";
  isMatched: boolean;
  lat: number;
  lng: number;
  address: string;
  reason: string;
}

export interface PlannerInput {
  origin: string;
  destinationCity: CityName;
  placesText: string;
  sameDayReturn: boolean;
  preferences: string[];
  physicalLimit: string;
}

export interface TravelPlan {
  id: string;
  title: string;
  route: string[];
  duration: string;
  bestFor: string;
  reason: string;
  risk: string;
  rating: string;
}

export interface PlannerResult {
  
  recommendation: string;
  assumptions: string[];
  plans: TravelPlan[];
  decision?: TripDecision;
  departureWindows?: DepartureWindow[];
  routeEvidence?: {scope?:"joint";mode?: "driving" | "walking" | "transit"; source: string; observedAt: number; legs: {from:string;to:string;duration:number;distance:number;points:{latitude:number;longitude:number}[];
    /** Timeline node ids the leg connects (joint plans only), used to highlight it from the timeline. */
    fromNode?:string;toNode?:string}[]};
}

export interface DepartureWindow {
  from:string; to:string; latestDeparture:string; bufferMinutes:number; travelSeconds:number; caveat:string;
}
export interface HotelTerms {
  cancellation:{kind:"unknown"|"non_refundable"|"free_before";deadline?:string};
  meals:number|null;checkIn:string|null;checkOut:string|null;
  arrivalNotice:string|null;propertyFeeNotice:string|null;paymentFeeNotice:string|null;
}
export interface FlightIdentity {
  number:string; from:string; to:string; departure:string; arrival:string;
}
export interface FlightOffer extends FlightIdentity {
  key:string; direction:"outbound"|"return"; feasible:boolean; booked:boolean;
  referencePrice:number|null; totalPrice:number|null; observedAt:number; bookingUrl:string|null;
}
export interface JointDecision {
  flightRequested?:boolean;
  flightOffers?:FlightOffer[];
  railRequested?:boolean;
  railOptions?: {number:string;origin:string;destination:string;departure:string;direction:"outbound"|"return";checkedAt:string;seatOptions:{name:string;price:number|null;count:number|null;status:"available"|"unavailable"|"unknown"}[]}[];
  status: "conditional" | "unranked" | "conflict" | "unavailable" | "needs_input" | "not_applicable";
  coverage?: {evaluated:number;rejected:number;conditional:number;verified:number};
  plans: {conservativeStatus?:"feasible_under_inputs"|"infeasible"|"unknown";mapEvidence?:PlannerResult["routeEvidence"];id:string;ranked:boolean;status:string;hotel:string;outbound:string|null;returning:string|null;hotelTerms?:HotelTerms|null;hotelFit?:{group:"matched"|"unmatched"|"none";nightly:number|null;budget:number|null}|null;hotelQuote?:{amount:number;rooms:number;nights:number;roomType:string}|null;transportMinutes:number|null;totalCost:number|null;knownCost:number;timeline:{id:string;name:string;kind:string;minutes:number;nextTransfer?:{mode:"driving"|"walking"|"transit";minutes:number;to:string};start:string|null;deadline:string|null;latestStart?:string|null;conservativeLatestDeparture?:string|null;latestDeparture:string|null}[];issues:string[]}[];
  rejected: {id:string;hotel:string;reason:string}[];
  pending:string[]; assumptions:string[];
}
export interface TripDecision {
  inputNeeds?:{party:boolean};
  publicResearch?: {status:"retrieved"|"unavailable"|"not_configured";searched:boolean};
  joint?: JointDecision;
  status: "conditional" | "conflict";
  engine: string;
  questions: {prompt:string;why:string}[];
  sources?: {url:string;title:string;status:string;observedAt:number}[];
  hotels: {id:string;name:string;address:string;near:string;url:string;commuteMinutes?:number;commuteDays?:number}[];
  missing: string[];
  observedAt: number;
  schedule: {status:string;conflicts?:string[];nodes?:{id:string;name:string;latest_departure:string|null;slack_minutes:number|null}[]};
}

import type { CalendarEntry, PlaceResolution } from "./calendarEvents";
import { calendarKey } from "./calendarEvents";
import type { BusinessTripSettings } from "./businessTrips";
import { writeBusinessTripSettings } from "./businessTrips";
import type { Mailbox } from "./useTripMailbox";
import type { AppUser } from "./userStorage";
import type { Place } from "../types/place";
import type { LegResult } from "./useTodayLegs";
import { ALL_MODES } from "./useTodayLegs";
import type { TodayLegPair, TravelMode } from "./todayMap";
import type { BookingChange, RailOrder } from "./businessOrders";

/** A local-only owner. Nothing here is ever written to a signed-in account. */
export const DEMO_OWNER = "demo:wayline";
export const DEMO_USER: AppUser = { id: DEMO_OWNER, label: "演示工作区", method: "local" };
export const DEMO_HOME = "上海";
const DEMO_FLAG = "wayline.demo.active";

export function readDemoMode() {
  try { return sessionStorage.getItem(DEMO_FLAG) === "1"; } catch { return false; }
}

function setDemoFlag(on: boolean) {
  try {
    if (on) sessionStorage.setItem(DEMO_FLAG, "1");
    else sessionStorage.removeItem(DEMO_FLAG);
  } catch { /* the workspace still works for this page view */ }
}

const pad = (value: number) => String(value).padStart(2, "0");
export function demoDay(offset: number, now = Date.now()) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
const at = (day: string, time: string) => `${day}T${time}:00+08:00`;

function place(id: string, name: string, city: string, lat: number, lng: number, address: string, category: Place["category"] = "business"): Place {
  return {
    id, name, city, category, type: "system", source: "system", lat, lng, address,
    openingHours: "", description: "演示工作区合成地点", tags: [], reason: "演示数据",
    status: "saved", isSaved: false, distanceText: "", externalLinks: {},
  };
}

const pudong = place("demo-pudong", "陆家嘴会议中心", DEMO_HOME, 31.245, 121.505, "浦东新区陆家嘴环路", "business");
const peoplesSquare = place("demo-peoples", "人民广场会议厅", DEMO_HOME, 31.232, 121.475, "黄浦区人民大道", "business");
const hongqiao = place("demo-hongqiao", "虹桥商务区", DEMO_HOME, 31.2, 121.32, "闵行区申长路", "business");
const shanghaiStation = place("demo-sh-station", "上海站", DEMO_HOME, 31.249, 121.455, "静安区秣陵路", "transport");
const suzhouStation = place("demo-sz-station", "苏州站", "苏州", 31.33, 120.61, "姑苏区苏站路", "transport");
const suzhouCenter = place("demo-sz-center", "苏州中心", "苏州", 31.32, 120.67, "工业园区苏绣路", "business");
const suzhouHighTech = place("demo-sz-high-tech", "苏州高新区管委会", "苏州", 31.3, 120.55, "虎丘区科普路", "business");
const jinjiLake = place("demo-jinji", "金鸡湖", "苏州", 31.31, 120.7, "工业园区金鸡湖大道", "food");
const sipGeneric = place("demo-sip", "苏州工业园区", "苏州", 31.31, 120.72, "工业园区（地点待确认）", "business");
const expo = place("demo-sip-expo", "苏州国际博览中心", "苏州", 31.315, 120.72, "工业园区苏州大道东", "business");
const culture = place("demo-sip-culture", "苏州文化艺术中心", "苏州", 31.32, 120.7, "工业园区观枫街", "business");
const ambiguousPlace: PlaceResolution = { status: "ambiguous", text: "苏州工业园区某中心", candidates: [expo, culture] };

interface DemoEventInput {
  id: string; title: string; day: string; start: string; end: string;
  location: string; place?: Place; resolution?: PlaceResolution; description?: string;
}
function event(input: DemoEventInput): CalendarEntry {
  return {
    id: input.id, uid: input.id, title: input.title, location: input.location,
    description: input.description ?? "演示工作区合成日程",
    start: at(input.day, input.start), end: at(input.day, input.end),
    allDay: false, timezone: "Asia/Shanghai", calendar: "演示日历",
    ...(input.place && { place: input.place }),
    ...(input.resolution && { placeResolution: input.resolution }),
  };
}

/** Synthetic calendar. Dates are relative to the day the demo is opened. */
export function demoCalendarEntries(now = Date.now()): CalendarEntry[] {
  const today = demoDay(0, now);
  const tomorrow = demoDay(1, now);
  const dayAfter = demoDay(2, now);
  return [
    event({ id: "demo-d0-1", title: "客户例会", day: today, start: "09:30", end: "10:30", location: "陆家嘴会议中心", place: pudong }),
    event({ id: "demo-d0-2", title: "产品评审", day: today, start: "11:00", end: "12:00", location: "人民广场会议厅", place: peoplesSquare }),
    event({ id: "demo-d0-3", title: "签约会", day: today, start: "11:45", end: "12:45", location: "虹桥商务区", place: hongqiao }),
    event({ id: "demo-d1-train", title: "G7002 上海→苏州", day: tomorrow, start: "07:30", end: "08:10", location: "上海站", place: shanghaiStation, description: "演示用铁路行程，同时存在于 Gmail 订单中" }),
    event({ id: "demo-d1-1", title: "苏州园区客户拜访", day: tomorrow, start: "10:00", end: "11:30", location: "苏州工业园区某中心", place: sipGeneric, resolution: ambiguousPlace }),
    event({ id: "demo-d1-2", title: "方案评审", day: tomorrow, start: "14:00", end: "15:30", location: "苏州中心", place: suzhouCenter }),
    event({ id: "demo-d1-3", title: "客户晚宴", day: tomorrow, start: "18:30", end: "20:00", location: "金鸡湖", place: jinjiLake }),
    event({ id: "demo-d2-1", title: "项目复盘", day: dayAfter, start: "09:30", end: "10:30", location: "苏州中心", place: suzhouCenter }),
    event({ id: "demo-d2-2", title: "供应商会议", day: dayAfter, start: "11:00", end: "12:00", location: "苏州高新区管委会", place: suzhouHighTech }),
    event({ id: "demo-d2-3", title: "收尾沟通", day: dayAfter, start: "17:00", end: "18:00", location: "苏州中心", place: suzhouCenter }),
  ].sort((a, b) => a.start.localeCompare(b.start));
}

export const demoBusinessSettings: BusinessTripSettings = { home: DEMO_HOME, boundaries: {} };

export function createDemoMailbox(now = Date.now()): Mailbox {
  const tomorrow = demoDay(1, now);
  const dayAfter = demoDay(2, now);
  const orders: RailOrder[] = [
    { id: "demo-order-g7002", train: "G7002", origin: "上海", destination: "苏州", departAt: at(tomorrow, "07:30"), arriveAt: at(tomorrow, "08:10") },
    { id: "demo-order-g7010", train: "G7010", origin: "苏州", destination: "上海", departAt: at(dayAfter, "16:00"), arriveAt: at(dayAfter, "16:45") },
    { id: "demo-order-g7026", train: "G7026", origin: "苏州", destination: "上海", departAt: at(dayAfter, "17:30"), arriveAt: at(dayAfter, "18:15") },
  ];
  const changes: BookingChange[] = [
    { id: "demo-change-g7010", kind: "rail", state: "cancelled", observedAt: now - 30_000, from: "苏州", to: "上海", number: "G7010", start: at(dayAfter, "16:00") },
  ];
  return { connected: true, lastSync: now - 60_000, orders, bookings: [], changes, singleSample: false };
}

function distanceKm(a: Place, b: Place) {
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

const speed: Record<TravelMode, number> = { walking: 4.5, transit: 18, driving: 24, selfDrive: 24 };

/** Estimates only: they are labelled 估算 and never prove a leg is late. */
export function demoLegResults(pairs: TodayLegPair[], now = Date.now()): Record<string, Partial<Record<TravelMode, LegResult>>> {
  const result: Record<string, Partial<Record<TravelMode, LegResult>>> = {};
  for (const pair of pairs) {
    const from = pair.from.place;
    const to = pair.to.place;
    const km = pair.sameSpot ? 0 : distanceKm(from, to);
    for (const mode of ALL_MODES) {
      const minutes = Math.max(km === 0 ? 0 : 4, Math.round((km / speed[mode]) * 60) + (km === 0 ? 0 : 4));
      result[pair.id] ??= {};
      result[pair.id][mode] = {
        mode, minutes, source: "estimate", observedAt: now,
        points: [{ latitude: from.lat, longitude: from.lng }, { latitude: to.lat, longitude: to.lng }],
      };
    }
  }
  return result;
}

function removeDemoKeys() {
  try {
    // 覆盖所有以演示 owner 结尾的键（含 whereto:city-view:demo:wayline 这类非点号分隔的键）。
    const keys = Object.keys(localStorage).filter(key => key.endsWith(DEMO_OWNER));
    for (const key of keys) localStorage.removeItem(key);
  } catch { /* storage may be blocked; demo still runs in memory */ }
}

/** Writes only demo-owned keys. Safe to call repeatedly. */
export function seedDemoWorkspace(now = Date.now()) {
  const events = demoCalendarEntries(now);
  localStorage.setItem(calendarKey(DEMO_OWNER), JSON.stringify(events));
  writeBusinessTripSettings(DEMO_OWNER, demoBusinessSettings);
  try { localStorage.removeItem(`whatto.userPlaces.${DEMO_OWNER}`); } catch { /* ignore */ }
  return events;
}

export function enterDemo(now = Date.now()) {
  seedDemoWorkspace(now);
  setDemoFlag(true);
}

export function resetDemo(now = Date.now()) {
  removeDemoKeys();
  const events = seedDemoWorkspace(now);
  setDemoFlag(true);
  return events;
}

export function exitDemo() {
  removeDemoKeys();
  setDemoFlag(false);
}

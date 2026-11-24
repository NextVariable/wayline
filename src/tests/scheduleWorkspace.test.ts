import { expect, it } from "vitest";
import type { CalendarEntry } from "../lib/calendarEvents";
import type { Place } from "../types/place";
import { buildTravelWorkspace } from "../lib/tripIntelligence";
import { calendarRisks } from "../lib/tripFeasibility";
import { judgeLeg, legPairs, localDateKey } from "../lib/todayMap";
import {
  localScheduleEvent,
  mergeWorkspaceEvents,
  schedulesToEvents,
} from "../lib/scheduleEvents";
import { initialUserPlaces } from "./fixtures/userPlaces";

const today = new Date("2026-11-25T01:00:00Z");
const freshness = { now: +today, calendarCurrent: true, mailboxCurrent: true };
const at = (day: string, time: string) => `2026-11-${day}T${time}:00+08:00`;

const place = (id: string, name: string, n: number): Place => ({
  ...initialUserPlaces[0],
  id,
  name,
  city: "苏州",
  lat: 31.25 + n / 100,
  lng: 120.71 + n / 100,
});

function schedule(id: string, name: string, n: number, tags: string[], timing: Place["schedule"], reasonTime: string): Place {
  return {
    ...place(id, name, n),
    type: "user",
    source: "manual",
    category: "custom",
    tags: ["日程助手", "待办事项", ...tags],
    reason: `待办事项 · ${reasonTime} · ${name}`,
    status: "want_to_go",
    isSaved: true,
    schedule: timing,
    distanceText: reasonTime,
  };
}

const googleEvent: CalendarEntry = {
  id: "g-client",
  uid: "g-client",
  title: "客户拜访（日历测试数据）",
  location: "苏州中心",
  description: "",
  start: at("25", "09:00"),
  end: at("25", "10:00"),
  allDay: false,
  timezone: "Asia/Shanghai",
  calendar: "测试日历",
  place: place("suzhou-center", "苏州中心", 1),
  google: { connectionId: "test", calendarId: "test", eventId: "g-client", updated: "2026-11-20T00:00:00Z", originalStart: null },
};

const intakeSchedule = schedule(
  "schedule-intake-s1-0",
  "苏州园区客户",
  2,
  ["智能录入"],
  { startTime: "15:00", endTime: "16:00", timezone: "Asia/Shanghai" },
  "2026-11-25 15:00",
);

const manualSchedule = schedule(
  "schedule-manual-1",
  "苏州北站",
  3,
  [],
  { startTime: "12:00", endTime: "", timezone: "Asia/Shanghai" },
  "2026-11-25 12:00",
);

it("turns a local schedule into a calendar-shaped event with Wayline identity", () => {
  const event = localScheduleEvent(intakeSchedule)!;
  expect(event).toMatchObject({
    start: at("25", "15:00"),
    end: at("25", "16:00"),
    allDay: false,
    timezone: "Asia/Shanghai",
    local: { source: "schedule", origin: "intake", sourcePlaceId: "schedule-intake-s1-0", endPending: false },
  });
  expect(event.google).toBeUndefined();
  expect(event.place?.id).toBe("schedule-intake-s1-0");
});

it("keeps an unknown end time unknown instead of inventing one", () => {
  const event = localScheduleEvent(manualSchedule)!;
  expect(event.end).toBe(event.start);
  expect(event.local).toMatchObject({ origin: "manual", endPending: true });
  const [pair] = legPairs(
    [localScheduleEvent(manualSchedule)!, localScheduleEvent(intakeSchedule)!],
    "2026-11-25",
  );
  expect(pair.endPending).toBe(true);
  expect(judgeLeg(pair, [], "transit").status).toBe("unknown");
});

it("puts Google, Smart Intake and manual arrangements in one workspace", () => {
  const localEvents = schedulesToEvents([intakeSchedule, manualSchedule]);
  const events = mergeWorkspaceEvents([googleEvent], [intakeSchedule, manualSchedule]);
  expect(localEvents).toHaveLength(2);
  expect(events).toHaveLength(3);

  const model = buildTravelWorkspace({
    events,
    day: today,
    todayKey: "2026-11-25",
    settings: { home: "上海", boundaries: {} },
    cities: ["上海", "苏州"],
  });
  expect(model.today?.dateKey).toBe("2026-11-25");
  expect(model.stops.map((stop) => stop.event.id)).toEqual([
    "g-client",
    "wayline-schedule:schedule-manual-1",
    "wayline-schedule:schedule-intake-s1-0",
  ]);
  expect(model.pairs.map((pair) => [pair.from.event.id, pair.to.event.id])).toEqual([
    ["g-client", "wayline-schedule:schedule-manual-1"],
    ["wayline-schedule:schedule-manual-1", "wayline-schedule:schedule-intake-s1-0"],
  ]);
  expect(model.pairs[0].gapMinutes).toBe(120);
  expect(model.pairs[1].endPending).toBe(true);

  const trip = model.trips[0];
  expect(trip.cities).toEqual(["苏州"]);
  expect(trip.days[0].events.map((event) => event.id)).toEqual([
    "g-client",
    "wayline-schedule:schedule-manual-1",
    "wayline-schedule:schedule-intake-s1-0",
  ]);
});

it("re-derives the workspace after a local schedule changes, leaving calendar data untouched", () => {
  const originalCalendar = JSON.stringify(googleEvent);
  const first = buildTravelWorkspace({
    events: mergeWorkspaceEvents([googleEvent], [manualSchedule, intakeSchedule]),
    day: today,
    todayKey: "2026-11-25",
    settings: { home: "上海", boundaries: {} },
    cities: ["上海", "苏州"],
  });
  expect(first.stops[2].event.start).toBe(at("25", "15:00"));

  const moved = {
    ...intakeSchedule,
    schedule: { ...intakeSchedule.schedule, startTime: "13:00", endTime: "14:00" },
    distanceText: "2026-11-25 13:00",
  };
  const next = buildTravelWorkspace({
    events: mergeWorkspaceEvents([googleEvent], [manualSchedule, moved]),
    day: today,
    todayKey: "2026-11-25",
    settings: { home: "上海", boundaries: {} },
    cities: ["上海", "苏州"],
  });
  expect(next.stops.map((stop) => stop.event.start)).toEqual([
    at("25", "09:00"),
    at("25", "12:00"),
    at("25", "13:00"),
  ]);
  expect(next.pairs[1].from.event.local?.origin).toBe("manual");
  expect(next.pairs[1].to.event.local?.origin).toBe("intake");
  expect(JSON.stringify(googleEvent)).toBe(originalCalendar);
});

it("labels local evidence with the Wayline source, not an external calendar", () => {
  const overlap = schedule(
    "schedule-overlap",
    "日程冲突",
    4,
    ["智能录入"],
    { startTime: "09:30", endTime: "10:30", timezone: "Asia/Shanghai" },
    "2026-11-25 09:30",
  );
  const risks = calendarRisks(
    mergeWorkspaceEvents([googleEvent], [overlap]),
    freshness,
    "2026-11-25",
  );
  const risk = risks.find((item) => item.type === "overlap")!;
  expect(risk.eventIds).toEqual(["g-client", "wayline-schedule:schedule-overlap"]);
  expect(risk.evidence.map((item) => item.source)).toEqual(["google-calendar", "wayline"]);
  expect(legPairs(schedulesToEvents([overlap]), localDateKey(googleEvent.start))).toHaveLength(0);
});

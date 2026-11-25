import type { CalendarEntry } from "./calendarEvents";
import type { Place } from "../types/place";
import { isSchedule } from "./placeIdentity";
import { localDay } from "./quickIntent";

export const LOCAL_CALENDAR = "Wayline 日程";
const LOCAL_PREFIX = "wayline-schedule:";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

function dayAfter(date: string, days: number) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + days);
  return localDay(next);
}

/**
 * Turn a local schedule place into a calendar-shaped event.
 * The event keeps an explicit Wayline identity (`local`) so it is never
 * presented as a Google or imported calendar item. Missing fields stay empty:
 * an unknown end time becomes a zero-length event marked `endPending`.
 */
export function localScheduleEvent(place: Place): CalendarEntry | null {
  if (!isSchedule(place)) return null;
  const [storedDate, storedTime = ""] = place.distanceText.split(" ");
  if (!DATE.test(storedDate)) return null;
  const timezone = place.schedule?.timezone || "Asia/Shanghai";
  const startTime = place.schedule?.startTime ?? storedTime;
  const endTime = place.schedule?.endTime ?? "";
  const validStart = TIME.test(startTime) ? startTime : "";
  const allDay = !validStart;
  const start = allDay ? storedDate : `${storedDate}T${validStart}:00+08:00`;
  let end = start;
  let endPending = false;
  if (!allDay) {
    if (TIME.test(endTime)) {
      const explicitEndDate = place.schedule?.endDate ?? "";
      const crossesMidnight = endTime <= validStart;
      const endDate =
        DATE.test(explicitEndDate) && explicitEndDate > storedDate
          ? explicitEndDate
          : crossesMidnight
            ? dayAfter(storedDate, 1)
            : storedDate;
      end = `${endDate}T${endTime}:00+08:00`;
    } else {
      endPending = true;
    }
  }
  const title =
    place.reason.split(" · ").slice(2).join(" · ").trim() || place.name;
  return {
    id: `${LOCAL_PREFIX}${place.id}`,
    uid: `${LOCAL_PREFIX}${place.id}`,
    title,
    location: place.name,
    description: place.description,
    start,
    end,
    allDay,
    timezone,
    calendar: LOCAL_CALENDAR,
    place,
    placeResolution: { status: "confirmed", text: place.name },
    local: {
      source: "schedule",
      origin: place.tags.includes("智能录入") ? "intake" : "manual",
      sourcePlaceId: place.id,
      endPending,
    },
  };
}

/** Local schedules that can sit on a timeline, as calendar-shaped events. */
export function schedulesToEvents(places: Place[]): CalendarEntry[] {
  return places.flatMap((place) => {
    const event = localScheduleEvent(place);
    return event ? [event] : [];
  });
}

/** External calendar events plus local schedules, in start order. Deleted source records stay out of active views. */
export function mergeWorkspaceEvents(
  calendarEvents: CalendarEntry[],
  schedules: Place[],
  options: { includeDeleted?: boolean } = {},
): CalendarEntry[] {
  return [...(options.includeDeleted ? calendarEvents : calendarEvents.filter(event => !event.google?.deletedAt)), ...schedulesToEvents(schedules)].sort((left, right) =>
    left.start.localeCompare(right.start),
  );
}

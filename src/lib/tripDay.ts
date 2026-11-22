import type { CalendarEvent } from "./tripDomain";
import { localDateKey } from "./todayMap";

/**
 * Calendar day of an event in the time zone the calendar gave it, not the device's.
 * Trips cross zones; grouping by the device zone can split one trip into two days
 * (or move an early-morning arrival back a day).
 */
export function eventDay(event: Pick<CalendarEvent, "start" | "timezone">): string {
  const timeZone = event.timezone?.trim();
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
        .format(new Date(event.start));
    } catch {
      // An unknown zone falls back to the device day rather than dropping the event.
    }
  }
  return localDateKey(event.start);
}

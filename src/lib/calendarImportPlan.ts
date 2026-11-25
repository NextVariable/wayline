import { applyCalendarOverrides } from "./googleCalendarSync";
import type { CalendarEntry, CalendarField } from "./calendarEvents";

const sourceFields = ["title", "location", "description", "start", "end", "allDay", "timezone"] as const;

export function planCalendarImport(previous: CalendarEntry[], incoming: CalendarEntry[]) {
  const current = new Map(previous.map(event => [event.id, event]));
  const byUid = new Map<string, CalendarEntry[]>();
  for (const event of previous) {
    if (!event.id.startsWith("ical:")) continue;
    const matches = byUid.get(event.uid) ?? [];
    matches.push(event);
    byUid.set(event.uid, matches);
  }
  const occurrenceCounts = new Map<string, number>();
  for (const event of incoming) occurrenceCounts.set(event.uid, (occurrenceCounts.get(event.uid) ?? 0) + 1);

  const changes: CalendarEntry[] = [];
  let added = 0, updated = 0, duplicates = 0;
  for (const event of incoming) {
    const matches = byUid.get(event.uid);
    const old = current.get(event.id) ?? (event.id.endsWith(":single") && matches?.length === 1 && occurrenceCounts.get(event.uid) === 1 ? matches[0] : undefined);
    if (old && sourceFields.every(field => {
      const override = old.overrides?.[field as CalendarField];
      const currentSource = override
        ? old.sourceChange?.find(change => change.field === field)?.to ?? override.sourceValue
        : old[field];
      return currentSource === event[field];
    })) {
      duplicates++;
      continue;
    }
    if (old) {
      updated++;
      changes.push(applyCalendarOverrides({ ...event, id: old.id }, old));
    } else {
      added++;
      changes.push(event);
    }
  }
  return { changes, added, updated, duplicates };
}

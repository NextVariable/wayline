import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ScheduleAgenda } from "../components/ScheduleAgenda";
import { initialUserPlaces } from "../data/userPlaces";
import type { CalendarEntry } from "../lib/calendarEvents";

const today = new Date(2026, 10, 13, 12);
const iso = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString();
const event = (id: string, start: string, end: string, allDay = false): CalendarEntry => ({
  id, uid: id, title: id, location: "", description: "", calendar: "测试", timezone: "", start, end, allDay,
});
const events = [
  event("下午活动", iso(13, 15), iso(13, 16)),
  event("上午活动", iso(13, 9), iso(13, 10)),
  event("昨天结束的全天安排", "2026-11-12", "2026-11-13", true),
  event("仍在进行的跨日活动", iso(12, 9), iso(13, 17)),
];
const local = { ...initialUserPlaces[0], id: "manual", distanceText: "2026-11-13 11:00", reason: "待办事项 · 2026-11-13 11:00 · 手动安排" };
const noop = () => {};
const render = (past = false) => {
  vi.useFakeTimers();
  vi.setSystemTime(today);
  return renderToStaticMarkup(<ScheduleAgenda events={events} schedules={[local]} past={past} onPeriodChange={noop}
    connected={true} onSearch={async () => []} onSelectPlace={noop} onEdit={noop} onDelete={noop} onToggleCompleted={noop} />);
};
afterEach(() => vi.useRealTimers());

it("shows today's calendar and manual schedules together in time order", () => {
  const html = render();
  expect(html.indexOf("上午活动")).toBeLessThan(html.indexOf("手动安排"));
  expect(html.indexOf("手动安排")).toBeLessThan(html.indexOf("下午活动"));
  expect(html).toContain("仍在进行的跨日活动");
  expect(html).not.toContain("昨天结束的全天安排");
});

it("separates past events using the exclusive end of all-day entries", () => {
  const html = render(true);
  expect(html).toContain("昨天结束的全天安排");
  expect(html).not.toContain("仍在进行的跨日活动");
  expect(html).not.toContain("手动安排");
});

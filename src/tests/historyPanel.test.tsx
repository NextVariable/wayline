import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { HistoryPanel } from "../components/HistoryPanel";
import { groupBusinessTrips } from "../lib/businessTrips";
import type { CalendarEntry } from "../lib/calendarEvents";
import { initialUserPlaces } from "./fixtures/userPlaces";

const event = (id: string, day: string, city: string): CalendarEntry => ({
  id, uid: id, title: id, location: city, description: "", calendar: "验收",
  start: `2026-10-${day}T10:00:00+08:00`, end: `2026-10-${day}T11:00:00+08:00`,
  allDay: false, timezone: "Asia/Shanghai", place: { ...initialUserPlaces[0], id: city, city },
});
const trips = groupBusinessTrips([event("上海评审", "12", "上海"), event("杭州复盘", "13", "杭州")], { home: "苏州", boundaries: {} }, "2026-10-20", { includePast: true });
const noop = () => {};
const render = (selected?: typeof trips[number]) => renderToStaticMarkup(
  <HistoryPanel trips={trips} selected={selected} selectedEventIds={[]} mapIndices={{ 上海评审: 1, 杭州复盘: 2 }}
    onTrip={noop} onBack={noop} onEvent={noop} onOverview={noop} onSchedule={noop} />,
);

it("lists past trips as plans, not as an actual footprint", () => {
  const markup = render();
  expect(markup).toContain("历史");
  expect(markup).toContain("上海 → 杭州");
  expect(markup).toContain("10月12日–10月13日");
  expect(markup).toContain("不代表实际足迹");
  expect(markup).not.toContain("GPS");
});

it("reuses the trip timeline in read-only history detail", () => {
  const markup = render(trips[0]);
  expect(markup).toContain("计划行程，未记录实际到访");
  expect(markup).toContain("上海评审");
  expect(markup).toContain("wayline-timeline");
  expect(markup).toContain("地图点位 1");
});

it("shows confirmed and cancelled orders in the history timeline", () => {
  const booking = { id: "rail-1", kind: "rail" as const, source: "Gmail" as const, number: "G102",
    start: "2026-10-12T08:00:00+08:00", from: { name: "苏州站", city: "苏州" }, to: { name: "上海虹桥站", city: "上海" },
    state: "confirmed" as const };
  const cancelled = { ...booking, id: "rail-2", number: "G103", state: "cancelled" as const };
  const markup = renderToStaticMarkup(<HistoryPanel trips={trips} selected={trips[0]} selectedEventIds={[]}
    mapIndices={{}} timeline={[{ kind: "booking", booking }, { kind: "booking", booking: cancelled }]}
    onTrip={noop} onBack={noop} onEvent={noop} onOverview={noop} onSchedule={noop} />);
  expect(markup).toContain("G102 · 苏州站 · 上海虹桥站");
  expect(markup).toContain("收到取消通知");
  expect(markup).toContain("计划行程");
  expect(markup).not.toContain("GPS");
});

it("filters history by city and month without inventing visits", () => {
  const markup = renderToStaticMarkup(<HistoryPanel trips={trips} selectedEventIds={[]} mapIndices={{}}
    onTrip={noop} onBack={noop} onEvent={noop} onOverview={noop} onSchedule={noop} />);
  expect(markup).toContain("历史筛选");
  expect(markup).toContain("全部城市");
  expect(markup).toContain("全部月份");
});

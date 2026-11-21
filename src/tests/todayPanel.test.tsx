import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TodayPanel } from "../components/TodayPanel";
import { initialUserPlaces } from "./fixtures/userPlaces";
import type { CalendarEntry } from "../lib/calendarEvents";
import { judgeLeg, legPairs, stopsOfDay, type TravelMode } from "../lib/todayMap";
import type { LegResult } from "../lib/useTodayLegs";

const day = "2026-11-13";
const events: CalendarEntry[] = ["项目会", "客户会"].map((title, index) => {
  const place = { ...initialUserPlaces[0], id: String(index), name: index ? "深圳北站" : "市民中心", lat: 22.55 + index * 0.03 };
  return {
    id: String(index), uid: String(index), title, location: place.name, description: "",
    start: day + (index ? "T10:25:00+08:00" : "T09:00:00+08:00"),
    end: day + (index ? "T11:00:00+08:00" : "T10:00:00+08:00"),
    allDay: false, timezone: "Asia/Shanghai", calendar: "验收", place,
  };
});
const stops = stopsOfDay(events, day);
const [pair] = legPairs(events, day);
const options: LegResult[] = [
  { mode: "transit", minutes: 30, points: [], source: "amap" },
  { mode: "driving", minutes: 21, points: [], source: "amap" },
];
const render = (mode: TravelMode, loading = false, routes = options) => renderToStaticMarkup(
  <TodayPanel heading="今天 · 11月13日" stops={stops}
    segments={[{ pair, mode, result: routes.find(route => route.mode === mode), verdict: judgeLeg(pair, routes, mode) }]}
    loading={loading} focused={null} onOpenSchedule={() => {}} onSelectStop={() => {}} onChooseMode={() => {}} onFocus={() => {}} onRetry={() => {}} />,
);

it("renders the selected route and its verdict together", () => {
  const transit = render("transit");
  expect(transit).toContain(">查看日程<");
  expect(transit).toContain("地铁公交 30 分钟");
  expect(transit).toContain("差 5 分钟");
  expect(transit).toContain("改用打车约 21 分钟");
  expect(transit).toContain('data-status="late"');
  const taxi = render("driving");
  expect(taxi).toContain("打车 21 分钟");
  expect(taxi).toContain('data-status="ok"');
  expect(taxi).not.toContain("差 5 分钟");
  expect(taxi).toContain('aria-pressed="true">打车');
  expect(taxi).toContain("mode=car");
  expect(taxi).toContain('aria-label="用高德地图导航"');
  expect(taxi).not.toContain("google.com/maps");
});

it("offers a retry for an unavailable route without inventing a time", () => {
  expect(render("transit", true, [])).toContain("正在查路线");
  const unavailable = render("transit", false, []);
  expect(unavailable).toContain("暂未查到路线");
  expect(unavailable).toContain(">重试<");
  expect(unavailable).toContain('data-status="unknown"');
  expect(unavailable).not.toContain('data-status="late"');
});

it('shows when the selected route was observed', () => {
  const markup=render('driving',false,options.map(route=>({...route,observedAt:Date.UTC(2026,10,13,9)})));
  expect(markup).toContain('查询</small>');
});

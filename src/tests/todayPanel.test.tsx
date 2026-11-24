import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TodayPanel } from "../components/TodayPanel";
import { initialUserPlaces } from "./fixtures/userPlaces";
import type { CalendarEntry } from "../lib/calendarEvents";
import { assessLeg } from "../lib/smartRoutes";
import { legPairs, stopsOfDay, type TravelMode } from "../lib/todayMap";
import type { LegResult } from "../lib/useTodayLegs";

const day = "2026-11-13";
const NOW = Date.UTC(2026, 10, 13, 2);
const events: CalendarEntry[] = ["项目会", "客户会"].map((title, index) => {
  const place = { ...initialUserPlaces[0], id: String(index), name: index ? "深圳湾创业广场" : "市民中心", lat: 22.55 + index * 0.03 };
  return {
    id: String(index), uid: String(index), title, location: place.name, description: "",
    start: day + (index ? "T10:45:00+08:00" : "T09:00:00+08:00"),
    end: day + (index ? "T11:30:00+08:00" : "T10:00:00+08:00"),
    allDay: false, timezone: "Asia/Shanghai", calendar: "验收", place,
  };
});
const stops = stopsOfDay(events, day);
const [pair] = legPairs(events, day);
const options: LegResult[] = [
  { mode: "transit", minutes: 38, points: [], source: "amap", observedAt: NOW },
  { mode: "driving", minutes: 20, points: [], source: "amap", observedAt: NOW },
];
const render = (mode: TravelMode, loading = false, routes = options) => renderToStaticMarkup(
  <TodayPanel heading="今天 · 11月13日" stops={stops}
    segments={[{ pair, mode, result: routes.find(route => route.mode === mode), plan: assessLeg({ pair, route: routes.find(route => route.mode === mode), mode, now: NOW }) }]}
    loading={loading} focused={null} now={NOW} onOpenSchedule={() => {}} onSelectStop={() => {}} onChooseMode={() => {}} onFocus={() => {}} onRetry={() => {}} />,
);

it("renders the selected route and its verdict together", () => {
  const transit = render("transit");
  expect(transit).toContain(">查看日程<");
  expect(transit).toContain("地铁公交 38 分钟");
  expect(transit).toContain("时间不足 3 分钟");
  expect(transit).toContain('data-status="insufficient"');
  const taxi = render("driving");
  expect(taxi).toContain("打车 20 分钟");
  expect(taxi).toContain("时间充足 · 余 15 分钟");
  expect(taxi).toContain('data-status="sufficient"');
  expect(taxi).not.toContain("时间不足");
  expect(taxi).toContain('aria-pressed="true">打车');
});

it("offers a retry for an unavailable route without inventing a time", () => {
  expect(render("transit", true, [])).toContain("正在查路线");
  const unavailable = render("transit", false, []);
  expect(unavailable).toContain("路线暂不可用");
  expect(unavailable).toContain("重试路线");
  expect(unavailable).not.toContain("分钟</");
  expect(unavailable).toContain('data-status="pending"');
  expect(unavailable).not.toContain('data-status="insufficient"');
});

it('shows when the selected route was observed', () => {
  const markup=render('driving',false,options);
  expect(markup).toContain('查询</small>');
});

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
const render = (mode: TravelMode, loading = false, routes = options, focused?: string) => renderToStaticMarkup(
  <TodayPanel heading="今天 · 11月13日" stops={stops}
    segments={[{ pair, mode, result: routes.find(route => route.mode === mode), plan: assessLeg({ pair, route: routes.find(route => route.mode === mode), mode, now: NOW }) }]}
    loading={loading} focused={focused ?? null} now={NOW} onOpenSchedule={() => {}} onSelectStop={() => {}} onChooseMode={() => {}} onFocus={() => {}} onRetry={() => {}} />,
);

it("keeps the default leg to mode, duration and the necessary risk", () => {
  const transit = render("transit");
  expect(transit).toContain(">查看日程<");
  expect(transit).toContain("地铁公交 38 分钟");
  expect(transit).toContain("时间不足 3 分钟");
  expect(transit).toContain('data-status="insufficient"');
  const taxi = render("driving");
  expect(taxi).toContain("打车 20 分钟");
  expect(taxi).toContain('data-status="reference"');
  expect(taxi).not.toContain("时间不足");
  // 缓冲、余量与来源默认收起，按需展开。
  expect(taxi).not.toContain("剩余时间");
  expect(taxi).not.toContain("缓冲组成");
  expect(taxi).not.toContain("查询");
});

it("reveals buffer, remaining time and mode comparison only when opened", () => {
  const open = render("driving", false, options, pair.id);
  expect(open).toContain("门到门估算");
  expect(open).toContain("预计余量");
  expect(open).toContain("7 分钟");
  expect(open).toContain("安全缓冲");
  expect(open).toContain('aria-pressed="true">打车');
  expect(open).toContain("高德");
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

it('shows when the selected route was observed after expanding', () => {
  const markup = render("driving", false, options, pair.id);
  expect(markup).toContain("查询");
  expect(markup).toContain("高德");
});

import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TodayPanel, type TodaySegment } from "../components/TodayPanel";
import type { CalendarEntry } from "../lib/calendarEvents";
import type { TravelRisk } from "../lib/tripDomain";
import type { TripAction } from "../lib/actionItems";
import { initialUserPlaces } from "./fixtures/userPlaces";

const place = { ...initialUserPlaces[0], id: "venue", name: "国家会展中心", city: "上海", lat: 31.191, lng: 121.305 };
const event = (id: string, start: string, end: string): CalendarEntry => ({
  id, uid: id, title: "客户会议", location: "国家会展中心", description: "", calendar: "工作",
  start, end, allDay: false, timezone: "Asia/Shanghai", place,
});
const first = event("a", "2026-11-24T10:00:00+08:00", "2026-11-24T11:00:00+08:00");
const second = event("b", "2026-11-24T12:00:00+08:00", "2026-11-24T13:00:00+08:00");
const segment: TodaySegment = {
  pair: {
    id: "a-b", from: { event: first, place }, to: { event: second, place },
    sameSpot: false, crossCity: false, directKm: 2, gapMinutes: 60, defaultMode: "driving",
  },
  mode: "driving",
  verdict: { status: "ok" },
};

const noop = () => {};

it("names a failed route lookup plainly and offers one retry", () => {
  const html = renderToStaticMarkup(<TodayPanel heading="今天" stops={[{ event: first, place }, { event: second, place }]}
    segments={[segment]} loading={false} focused={null} onSelectStop={noop} onChooseMode={noop}
    onFocus={noop} onRetry={noop} />);
  expect(html).toContain("路线暂不可用");
  expect(html).toContain("重试路线");
  expect(html).toContain('aria-busy="false"');
});

it("marks unresolved conflicts as pending instead of certain", () => {
  const conflict: TravelRisk = {
    id: "risk-1", type: "commute-time", severity: "info", status: "uncertain",
    title: "通勤时间待核实", basis: "尚无可用于判断的路线", action: { kind: "review-route", label: "查询路线" },
    eventIds: ["a"], evidence: [], stale: false,
  };
  const html = renderToStaticMarkup(<TodayPanel heading="今天" stops={[{ event: first, place }]}
    segments={[]} loading={false} focused={null} onSelectStop={noop} onChooseMode={noop}
    onFocus={noop} onRetry={noop} conflicts={[conflict]} />);
  expect(html).toContain("待确认 · 通勤时间待核实");
});

it("shows a risk once when unified actions already carry it", () => {
  const conflict: TravelRisk = {
    id: "risk-1", type: "commute-time", severity: "info", status: "uncertain",
    title: "通勤时间待核实", basis: "尚无可用于判断的路线", action: { kind: "review-route", label: "查询路线" },
    eventIds: ["a"], evidence: [], stale: false,
  };
  const action: TripAction = {
    id: "action-1", riskIds: ["risk-1"], type: "commute-time", severity: "info", status: "uncertain",
    title: "通勤时间待核实", problem: "尚无可用于判断的路线", evidence: [], eventIds: ["a"],
    events: [{ id: "a", title: "客户会议", start: first.start, end: first.end, location: first.location }],
    nextStep: { kind: "review-route", label: "查询路线" }, uncertain: true, lifecycle: "upcoming", stale: false,
  };
  const html = renderToStaticMarkup(<TodayPanel heading="今天" stops={[{ event: first, place }]}
    segments={[]} loading={false} focused={null} onSelectStop={noop} onChooseMode={noop}
    onFocus={noop} onRetry={noop} conflicts={[conflict]} actions={[action]} onAction={noop} />);
  expect(html).not.toContain("待确认 · 通勤时间待核实");
  expect(html.split("通勤时间待核实").length - 1).toBe(1);
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarPlaceHint } from "../components/CalendarPlaceHint";
import { initialUserPlaces } from "./fixtures/userPlaces";
import type { CalendarEntry } from "../lib/calendarEvents";

const office = { ...initialUserPlaces[0], id: "calendar:office", name: "国贸大厦" };
const branch = { ...office, id: "calendar:branch", name: "国贸二期" };
const event = (id: string, patch: Partial<CalendarEntry>): CalendarEntry => ({
  id, uid: id, title: "会议 " + id, location: "公司", description: "", start: "2026-11-14T09:00:00+08:00", end: "2026-11-14T10:00:00+08:00",
  allDay: false, timezone: "Asia/Shanghai", calendar: "工作", ...patch,
});
const ask = event("a", { placeResolution: { status: "ask", text: "公司", suggestion: office } });
const ambiguous = event("b", { location: "国贸", placeResolution: { status: "ambiguous", text: "国贸", candidates: [office, branch] } });
const none = event("c", { location: "张三家", placeResolution: { status: "none", text: "张三家" } });
const missing = event("d", { location: "", placeResolution: { status: "missing", text: "" } });
const noop = () => {};
const handlers = { onConfirm: noop, onAccept: noop, onReject: noop, onIgnore: noop, onSearch: async () => [] };
const render = (pending: CalendarEntry[], open = false) =>
  renderToStaticMarkup(<CalendarPlaceHint pending={pending} {...handlers} initiallyOpen={open} />);

describe("quiet calendar place hint", () => {
  it("shows only the count until opened", () => {
    const html = render([none, missing]);
    expect(html).toContain("2 个日程没有地点");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("张三家");
    expect(html).not.toContain("忽略");
  });

  it("asks 还是那里吗？ with yes and no for a remembered phrase", () => {
    const html = render([ask], true);
    expect(html).toContain("还是那里吗？");
    expect(html).toContain("国贸大厦");
    expect(html).toMatch(/>是</);
    expect(html).toMatch(/>不是</);
  });

  it("offers candidates for an ambiguous place and a search for none or missing", () => {
    const html = render([ambiguous, none, missing], true);
    expect(html).toContain("国贸二期");
    // Every unplaced item can be searched, including ambiguous ones whose candidates are all wrong.
    expect(html.match(/type="search"/g)).toHaveLength(3);
    expect(html).toContain('value="张三家"');
  });

  it("lets every item be ignored", () => {
    const html = render([ask, ambiguous, none, missing], true);
    expect(html.match(/>忽略</g)).toHaveLength(4);
  });

  it("renders nothing when nothing is pending", () => {
    expect(render([])).toBe("");
  });

  it("does not explain how places were worked out", () => {
    const html = render([none], true);
    expect(html).not.toMatch(/因为|推算|由于/);
  });
});

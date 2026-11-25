import { describe, expect, it } from "vitest";
// @ts-expect-error AI harness modules are shared with the Node server.
import { sanitizeCopilotContext } from "../../server/ai/context.mjs";
// @ts-expect-error AI harness modules are shared with the Node server.
import { AI_TOOL_MATRIX, createToolRunner, toolDefinitions } from "../../server/ai/tools.mjs";
// @ts-expect-error AI harness modules are shared with the Node server.
import { shanghaiDay } from "../../server/ai/schemas.mjs";

const now = Date.now();
const later = new Date(now + 36_000_000).toISOString();
const today = shanghaiDay(now);
const tomorrow = shanghaiDay(now + 86_400_000);
const dayAfter = shanghaiDay(now + 2 * 86_400_000);

const context = sanitizeCopilotContext({
  owner: "u1",
  revision: "rev-1",
  activeCity: "深圳",
  events: [
    { id: "e1", title: "早餐", start: new Date(now).toISOString(), end: later, local: true, placeName: "酒店", placeId: "p1" },
    { id: "e2", title: "客户会议", start: later, end: later, placeName: "客户办公室", placeId: "p2" },
    { id: "e3", title: "外部日历会议", start: later, end: later, source: "google-calendar", local: false, placeName: "机场", placeId: "p2" },
  ],
  places: [
    { id: "p1", name: "酒店", city: "深圳", address: "望海路", lat: 22.48, lng: 113.94 },
    { id: "p2", name: "客户办公室", city: "深圳", address: "科技园", lat: 22.54, lng: 113.95 },
    { id: "p3", name: "无坐标地点", city: "深圳", address: "", lat: null, lng: null },
  ],
  commutes: [{
    fromEventId: "e1", toEventId: "e2", mode: "transit", status: "ok",
    availableMinutes: 45, routeMinutes: 25, bufferMinutes: 10, remainingMinutes: 10,
    advice: "按当前路况可准时", source: "amap",
  }],
  actions: [{ id: "a1", type: "commute-risk", severity: "medium", title: "通勤偏紧", problem: "余量 10 分钟", eventIds: ["e1", "e2"], nextStep: { kind: "open-leg", label: "查看路段" } }],
  bookings: [{ id: "b1", kind: "stay", title: "酒店 · 2 晚", from: "", to: "酒店", start: later, end: later, state: "confirmed", source: "日历" }],
  trips: [{ id: "t1", title: "深圳出差", cities: ["深圳"], startDate: today, endDate: tomorrow, eventCount: 3 }],
}, { owner: "u1", now });

const services = {
  searchPlaces: async () => [
    { name: "海上世界", city: "深圳", address: "南山", category: "attraction" },
    { name: "海上世界文化艺术中心", city: "深圳", address: "南山", category: "attraction" },
  ],
  route: async () => ({ duration: 1500, source: "amap", observedAt:now }),
};

describe("Tool registry and permission gateway", () => {
  it("exposes copilot tools only and denies unknown names", async () => {
    const runner = createToolRunner({ context, services, now });
    expect(toolDefinitions("copilot").map((tool: { function: { name: string } }) => tool.function.name))
      .toEqual(expect.arrayContaining(["get_schedule", "assess_commute", "propose_schedule_change"]));
    expect(toolDefinitions("intake")).toHaveLength(0);
    expect(AI_TOOL_MATRIX.propose_schedule_change.scope).toBe("propose");
    expect(await runner.run("delete_everything", {}, { task: "copilot" }))
      .toMatchObject({ ok: false, code: "tool_not_registered" });
    expect(await runner.run("get_schedule", {}, { task: "intake" }))
      .toMatchObject({ ok: false, code: "tool_not_allowed" });
  });

  it("reads schedules and real routes without inventing coordinates", async () => {
    const runner = createToolRunner({ context, services, now });
    const schedule = await runner.run("get_schedule", { day: "today" }, { task: "copilot" });
    expect(schedule.ok).toBe(true);
    expect(schedule.result.events[0]).toMatchObject({ id: "e1" });

    const route = await runner.run("query_route", { fromPlaceId: "p1", toPlaceId: "p2", mode: "transit" }, { task: "copilot" });
    expect(route.ok).toBe(true);
    expect(route.result).toMatchObject({ minutes: 25, source: "amap" });
    expect(await runner.run("query_route", { fromPlaceId: "p1", toPlaceId: "p3", mode: "transit" }, { task: "copilot" }))
      .toMatchObject({ ok: false, code: "missing_coordinates" });
    expect(await runner.run("query_route", { fromPlaceId: "p1", toPlaceId: "nope", mode: "transit" }, { task: "copilot" }))
      .toMatchObject({ ok: false, code: "unknown_place" });
  });

  it("sends a departure for transit and maps self-drive to driving", async () => {
    const calls: { mode: string; departure?: string }[] = [];
    const spy = {
      route: async (args: { mode: string; departure?: string }) => {
        calls.push(args);
        return { duration: 600, source: "amap", observedAt:now };
      },
    };
    const runner = createToolRunner({ context, services: spy, now });
    expect(await runner.run("query_route", { fromPlaceId: "p1", toPlaceId: "p2", mode: "transit" }, { task: "copilot" })).toMatchObject({ ok: true });
    expect(calls[0]).toMatchObject({ mode: "transit", departure: later });
    expect(await runner.run("query_route", { fromPlaceId: "p1", toPlaceId: "p2", mode: "selfDrive" }, { task: "copilot" })).toMatchObject({ ok: true });
    expect(calls[1]).toMatchObject({ mode: "driving" });
    expect(calls[1].departure).toBeUndefined();
  });

  it("reuses Smart Routes assessments instead of computing its own", async () => {
    const runner = createToolRunner({ context, services, now });
    const result = await runner.run("assess_commute", { fromEventId: "e1", toEventId: "e2" }, { task: "copilot" });
    expect(result.result).toMatchObject({ status: "ok", availableMinutes: 45, routeMinutes: 25 });
    expect(await runner.run("assess_commute", { fromEventId: "e2", toEventId: "e3" }, { task: "copilot" }))
      .toMatchObject({ ok: false, code: "not_in_context" });
  });

  it("only proposes local schedule changes and never writes", async () => {
    const runner = createToolRunner({ context, services, now });
    const created = await runner.run("propose_schedule_change", {
      operation: "create", placeId: "p2", date: tomorrow, startTime: "09:00", title: "客户拜访",
    }, { task: "copilot" });
    expect(created.result).toMatchObject({
      kind: "schedule-change", operation: "create", placeId: "p2", date: tomorrow,
      baseVersion: "rev-1", requiresConfirmation: true,
    });
    expect(await runner.run("propose_schedule_change", {
      operation: "update", targetId: "e3", startTime: "10:00",
    }, { task: "copilot" })).toMatchObject({ ok: false, code: "external_source" });
    expect(await runner.run("propose_schedule_change", {
      operation: "update", targetId: "e1", endTime: "08:00", startTime: "09:00",
    }, { task: "copilot" })).toMatchObject({ ok: false, code: "invalid_range" });
    expect(await runner.run("propose_schedule_change", {
      operation: "create", placeId: "p2", date: tomorrow,
      startTime: "22:00", endTime: "01:00", endDate: dayAfter, title: "夜间值班",
    }, { task: "copilot" })).toMatchObject({
      ok: true,
      result: { endTime: "01:00", endDate: dayAfter },
    });
    expect(await runner.run("propose_schedule_change", {
      operation: "create", placeId: "p9", date: tomorrow,
    }, { task: "copilot" })).toMatchObject({ ok: false, code: "unknown_place" });
  });

  it("searches places through the map service and caps results", async () => {
    const runner = createToolRunner({ context, services, now });
    const found = await runner.run("search_place", { query: "海上世界", city: "深圳" }, { task: "copilot" });
    expect(found.result.results).toHaveLength(2);
    expect(found.result.results[0]).not.toHaveProperty("lat");
    expect(await runner.run("search_place", { query: "海" }, { task: "copilot" }))
      .toMatchObject({ ok: false, code: "invalid_arguments" });
  });
});

it("rejects a transit query without a confirmed departure, and resolves repeated pairs by event ID", async () => {
  const args={fromPlaceId:"p1",toPlaceId:"p2",mode:"transit"};
  const query=(routePairs:unknown[], ids:Record<string,string>={}) => createToolRunner({
    context:{...context,routePairs},services,now,
  }).run("query_route",{...args,...ids},{task:"copilot"});
  expect(await query([{fromEventId:"e1",toEventId:"e2"}])).toMatchObject({ok:false,code:"departure_required"});
  const pairs=[{fromEventId:"e1",toEventId:"e2",departure:later},{fromEventId:"e1",toEventId:"e3",departure:later}];
  expect(await query(pairs)).toMatchObject({ok:false,code:"ambiguous_departure"});
  expect(await query(pairs,{fromEventId:"e1",toEventId:"e2"})).toMatchObject({
    ok:true,result:{departure:later,observedAt:new Date(now).toISOString(),reference:true},
  });
});

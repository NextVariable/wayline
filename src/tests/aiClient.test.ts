import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCopilotContext } from "../lib/aiContext";
import {
  OFFLINE_AI_STATUS,
  callAiIntake,
  fetchAiStatus,
  resetAiStatusCache,
} from "../lib/aiClient";
import { createServerIntakeModel, parseIntakeWithFallback } from "../lib/intakeModel";
import type { Place } from "../types/place";

const place = (id: string, name: string, city: string): Place => ({
  id,
  name,
  city,
  address: `${city}地址`,
  lat: 22.5,
  lng: 114,
  category: "business",
  type: "user",
  source: "saved",
  externalLinks: {},
  openingHours: "",
  description: "",
  tags: [],
  reason: "",
  status: "saved",
  isSaved: true,
  distanceText: "",
});

const status = (enabled: boolean) => ({
  ...OFFLINE_AI_STATUS,
  configured: enabled,
  enabled,
  reason: enabled ? "ready" : "budget_not_configured",
  budget: { dailyUsd: enabled ? 2 : 0, spentUsd: 0, remainingUsd: enabled ? 2 : 0, calls: { used: 0, limit: 40 } },
});

const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), { status: code, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  resetAiStatusCache();
});

describe("copilot context builder", () => {
  it("sends only minimal workspace fields and a stable revision", () => {
    const context = buildCopilotContext({
      owner: "u1",
      activeCity: "深圳",
      events: [{
        id: "e1", title: "客户会议", start: "2026-11-26T01:00:00.000Z", end: "2026-11-26T02:00:00.000Z",
        placeName: "海上世界", placeId: "p1", source: "google-calendar",
      }],
      places: [place("p1", "海上世界", "深圳")],
      actions: [{
        id: "a1", type: "missing-place", severity: "medium", status: "open", title: "缺少地点",
        problem: "请补充会议地点", eventIds: ["e1"], nextStep: { kind: "edit", label: "补充地点" },
      }],
      commutes: [{
        fromEventId: "e1", toEventId: "e2", mode: "transit", status: "ok",
        availableMinutes: 40, routeMinutes: 20, bufferMinutes: 5, remainingMinutes: 15,
      }],
      bookings: [],
      trips: [],
    });
    expect(context.events[0]).not.toHaveProperty("notes");
    expect(context.events[0]).toMatchObject({ id: "e1", placeId: "p1" });
    expect(context.revision).toMatch(/^[0-9a-f]{8}$/);
    const changed = buildCopilotContext({
      owner: "u1",
      activeCity: "深圳",
      events: [{ ...context.events[0], start: "2026-11-26T03:00:00.000Z" }],
      places: [place("p1", "海上世界", "深圳")],
      actions: [],
      commutes: [],
      bookings: [],
      trips: [],
    });
    expect(changed.revision).not.toBe(context.revision);
  });

  it("caps oversized workspaces", () => {
    const events = Array.from({ length: 40 }, (_, index) => ({
      id: `e${index}`, title: `安排 ${index}`,
      start: "2026-11-26T01:00:00.000Z", end: "2026-11-26T02:00:00.000Z",
    }));
    const context = buildCopilotContext({
      owner: "u1", activeCity: "深圳", events, places: [], actions: [], commutes: [], bookings: [], trips: [],
    });
    expect(context.events).toHaveLength(24);
  });
});

describe("server intake model", () => {
  it("is available only when the server reports an enabled budget", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(status(false))));
    expect(await createServerIntakeModel("u1").available()).toBe(false);
    resetAiStatusCache();
    vi.stubGlobal("fetch", vi.fn(async () => json(status(true))));
    expect(await createServerIntakeModel("u1").available()).toBe(true);
    expect(await fetchAiStatus("u1")).toMatchObject({ enabled: true, model: "deepseek-flash" });
  });

  it("posts text and place names only, then labels the result as a real model", async () => {
    const calls: { body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ body });
      if (body.text === undefined) return json(status(true));
      return json({
        ok: true,
        model: "deepseek-flash",
        items: [{ id: "ai-0", title: "客户会议", date: "2026-11-26", time: "09:00", endTime: "", timezone: "Asia/Shanghai", placeQuery: "海上世界", placeId: "p1", pending: ["end"], warnings: [] }],
        warnings: [],
        usage: { inputTokens: 10, outputTokens: 5 },
        costUsd: 0.00001,
      });
    }));
    const result = await callAiIntake({
      owner: "u1", text: "明天九点去海上世界", now: new Date(), activeCity: "深圳",
      places: [{ id: "p1", name: "海上世界", city: "深圳", lat: 22.5, lng: 114 } as never],
    });
    expect(result.ok).toBe(true);
    const intakeCall = calls.find(call => call.body.text !== undefined)!;
    expect(intakeCall.body.places).toEqual([{ id: "p1", name: "海上世界", city: "深圳" }]);
    const parsed = await createServerIntakeModel("u1").parse({
      text: "明天九点去海上世界", now: new Date(), places: [place("p1", "海上世界", "深圳")],
      activeCity: "深圳", owner: "u1",
    });
    expect(parsed).toMatchObject({ provider: "model", model: "deepseek-flash" });
  });

  it("falls back to local rules when the model is unavailable or fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(status(false))));
    const model = createServerIntakeModel("u1");
    const run = await parseIntakeWithFallback(
      "明天下午三点去海上世界见客户",
      { now: new Date("2026-11-25T02:00:00Z"), places: [place("p1", "海上世界", "深圳")], activeCity: "深圳" },
      model,
    );
    expect(run.usedFallback).toBe(true);
    expect(run.result.provider).toBe("rule");
    expect(run.result.items.length).toBeGreaterThan(0);
  });

  it("returns an offline status instead of throwing when the server is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fetchAiStatus()).toMatchObject({ enabled: false, reason: "unreachable" });
  });
});

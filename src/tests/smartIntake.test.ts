import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { Place } from "../types/place";
import {
  buildIntakeSchedules,
  draftIntakeItems,
  parseIntakeText,
  pendingLabels,
  readIntakeDrafts,
  readyIntakeItems,
  splitIntakeText,
  writeIntakeDrafts,
} from "../lib/smartIntake";

const now = new Date(2026, 10, 24, 9);
const places: Place[] = [
  {
    id: "p-seaworld",
    name: "海上世界",
    city: "深圳",
    category: "attraction",
    type: "user",
    source: "saved",
    lat: 22.485,
    lng: 113.915,
    address: "深圳南山区蛇口海上世界",
    openingHours: "全天",
    description: "",
    tags: [],
    reason: "",
    status: "saved",
    isSaved: true,
    distanceText: "",
    externalLinks: {},
  },
  {
    id: "p-shenzhenbay",
    name: "深圳湾",
    city: "深圳",
    category: "attraction",
    type: "user",
    source: "saved",
    lat: 22.515,
    lng: 113.945,
    address: "深圳南山区深圳湾",
    openingHours: "全天",
    description: "",
    tags: [],
    reason: "",
    status: "saved",
    isSaved: true,
    distanceText: "",
    externalLinks: {},
  },
];

describe("smart intake parsing", () => {
  it("splits one paragraph into multiple arrangements", () => {
    expect(
      splitIntakeText(
        "明天下午三点去海上世界见客户，后天上午十点去深圳湾开会",
      ),
    ).toHaveLength(2);
  });

  it("reads two arrangements with date, time and place", () => {
    const result = parseIntakeText(
      "明天下午三点去海上世界见客户，后天上午十点去深圳湾开会",
      { now, places },
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      title: "见客户",
      date: "2026-11-25",
      time: "15:00",
      placeId: "p-seaworld",
      pending: ["end"],
    });
    expect(result.items[1]).toMatchObject({
      title: "开会",
      date: "2026-11-26",
      time: "10:00",
      placeId: "p-shenzhenbay",
      pending: ["end"],
    });
  });

  it("keeps a reminder clause out of the next arrangement title", () => {
    const result = parseIntakeText(
      "明天上午十点在上海中心见客户，下午两点去虹桥机场 T2，提前十分钟提醒",
      { now },
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toMatchObject({ time: "14:00", title: "前往虹桥机场 T2" });
  });

  it("reads an explicit start and end time, keeping the timezone", () => {
    const result = parseIntakeText(
      "明天下午三点到五点去海上世界见客户",
      { now, places },
    );
    expect(result.items[0]).toMatchObject({
      date: "2026-11-25",
      time: "15:00",
      endTime: "17:00",
      timezone: "Asia/Shanghai",
      pending: [],
    });
    const numeric = parseIntakeText("明天 09:30-11:00 去深圳湾开会", {
      now,
      places,
    });
    expect(numeric.items[0]).toMatchObject({ time: "09:30", endTime: "11:00" });
  });

  it("inherits the date when a later arrangement omits it", () => {
    const result = parseIntakeText(
      "明天上午十点去海上世界开会，下午三点去深圳湾见客户",
      { now, places },
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[1].date).toBe("2026-11-25");
  });

  it("marks missing time and place as pending", () => {
    const result = parseIntakeText("下周三拜访客户", { now, places });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].date).toBe("2026-12-02");
    expect(result.items[0].time).toBe("");
    expect(result.items[0].placeId).toBe("");
    expect(pendingLabels(result.items[0])).toEqual(["时间", "地点"]);
    expect(readyIntakeItems(result.items)).toHaveLength(0);
  });

  it("keeps a non-temporal comma inside one arrangement", () => {
    const result = parseIntakeText(
      "明天上午十点去海上世界见客户，记得带上合同",
      { now, places },
    );
    expect(result.items).toHaveLength(1);
  });

  it("creates no schedules until the confirmation builder runs", () => {
    const result = parseIntakeText("明天上午十点去海上世界见客户", {
      now,
      places,
    });
    expect(result.items).toHaveLength(1);
    expect(readyIntakeItems(result.items)).toHaveLength(1);
  });

  it("uses deterministic ids so repeated confirmation cannot duplicate", () => {
    const result = parseIntakeText("明天上午十点去海上世界见客户", {
      now,
      places,
    });
    const first = buildIntakeSchedules(result.items, places, {
      sessionId: "s1",
    });
    const second = buildIntakeSchedules(result.items, places, {
      sessionId: "s1",
    });
    const other = buildIntakeSchedules(result.items, places, {
      sessionId: "s2",
    });
    expect(first[0].id).toBe(second[0].id);
    expect(first[0].id).not.toBe(other[0].id);
  });

  it("saves a missing-time arrangement as a memo marked pending", () => {
    const result = parseIntakeText("明天去海上世界见客户", { now, places });
    const [schedule] = buildIntakeSchedules(result.items, places, {
      sessionId: "s1",
    });
    expect(schedule.tags).toContain("备忘录");
    expect(schedule.tags).toContain("时间待确认");
    expect(schedule.reason).toContain("时间待确认");
    expect(schedule.distanceText).toBe("2026-11-25");
  });

  it("keeps start, end and timezone on the saved schedule", () => {
    const result = parseIntakeText("明天下午三点到五点去海上世界见客户", {
      now,
      places,
    });
    const [schedule] = buildIntakeSchedules(result.items, places, {
      sessionId: "s1",
    });
    expect(schedule.schedule).toEqual({
      startTime: "15:00",
      endTime: "17:00",
      timezone: "Asia/Shanghai",
    });
    expect(schedule.distanceText).toBe("2026-11-25 15:00");
    expect(schedule.tags).not.toContain("结束时间待确认");
  });

  it("persists drafts per account and restores them", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    });
    try {
      const result = parseIntakeText("下周三拜访客户", { now, places });
      const drafts = draftIntakeItems(result.items);
      expect(drafts).toHaveLength(1);
      writeIntakeDrafts("guest", drafts);
      expect(readIntakeDrafts("guest")).toHaveLength(1);
      expect(readIntakeDrafts("demo:wayline")).toHaveLength(0);
      expect(readIntakeDrafts("")).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("intake model contract", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("ships no live model by default", async () => {
    const { resolveIntakeModel } = await import("../lib/intakeModel");
    expect(resolveIntakeModel()).toBeNull();
  });

  it("fixture model returns a fixed provider label and two items", async () => {
    const { createFixtureIntakeModel, FIXTURE_MODEL_LABEL } = await import(
      "../lib/intakeModel"
    );
    const model = createFixtureIntakeModel();
    const result = await model.parse({
      text: "任意输入",
      now,
      places,
      activeCity: "深圳",
    });
    expect(model.label).toBe(FIXTURE_MODEL_LABEL);
    expect(result.provider).toBe("fixture");
    expect(result.items).toHaveLength(2);
  });

  it("counts model calls against the daily budget", async () => {
    const { readIntakeBudget, recordIntakeModelCall, canCallPaidModel } =
      await import("../lib/intakeModel");
    expect(readIntakeBudget("u1", now, 2)).toMatchObject({
      limit: 2,
      used: 0,
      remaining: 2,
    });
    recordIntakeModelCall("u1", now);
    expect(readIntakeBudget("u1", now, 2).used).toBe(1);
    recordIntakeModelCall("u1", now);
    expect(readIntakeBudget("u1", now, 2).remaining).toBe(0);
    expect(canCallPaidModel("u1", now)).toBe(false);
  });

  it("falls back to local parsing when the model throws", async () => {
    const { parseIntakeWithFallback } = await import("../lib/intakeModel");
    const failing = {
      id: "fixture" as const,
      label: "failing",
      paid: false,
      available: () => true,
      parse: async () => {
        throw new Error("model offline");
      },
    };
    const { result, usedFallback } = await parseIntakeWithFallback(
      "明天上午十点去海上世界见客户",
      { now, places, activeCity: "深圳" },
      failing,
    );
    expect(usedFallback).toBe(true);
    expect(result.provider).toBe("rule");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].placeId).toBe("p-seaworld");
  });

  it("keeps local parsing when no model is configured", async () => {
    const { parseIntakeWithFallback } = await import("../lib/intakeModel");
    const { result, usedFallback } = await parseIntakeWithFallback(
      "明天上午十点去海上世界见客户",
      { now, places, activeCity: "深圳" },
      null,
    );
    expect(usedFallback).toBe(false);
    expect(result.provider).toBe("rule");
    expect(result.items).toHaveLength(1);
  });
});

import { describe, it, expect } from "vitest";
import {
  parseQuickIntent,
  matchIntentPlaces,
  matchingSchedules,
  scheduleContext,
  changedIntentFields,
} from "../lib/quickIntent";
import { initialUserPlaces } from "../data/userPlaces";
const now = new Date(2026, 9, 24, 10);
describe("one sentence scheduling", () => {
  it("reads date, time and venue without inventing a meeting", () =>
    expect(parseQuickIntent("明天下午三点去海上世界见客户", now)).toMatchObject(
      {
        date: "2026-10-25",
        time: "15:00",
        placeQuery: "海上世界",
        warnings: [],
      },
    ));
  it.each([
    ["上午九点半", "09:30"],
    ["晚上八点一刻", "20:15"],
    ["中午十二点", "12:00"],
    ["凌晨十二点", "00:00"],
    ["15:45", "15:45"],
    ["下午3点", "15:00"],
  ])("reads %s", (text, time) =>
    expect(parseQuickIntent(text, now).time).toBe(time),
  );
  it("does not assume a time or a date not present", () =>
    expect(parseQuickIntent("去见客户", now)).toMatchObject({
      time: null,
      date: null,
    }));
  it("asks about ambiguous 3 oclock", () => {
    const value = parseQuickIntent("三点见客户", now);
    expect(value.time).toBeNull();
    expect(value.warnings).not.toHaveLength(0);
  });
  it("handles month and year boundaries using local calendar dates", () =>
    expect(
      parseQuickIntent("后天上午九点", new Date(2026, 11, 31, 23)).date,
    ).toBe("2027-01-02"));
  it("accepts explicit dates", () =>
    expect(parseQuickIntent("2026年10月25日15:00见客户", now).date).toBe(
      "2026-10-25",
    ));
  it("recognizes weekdays", () => {
    expect(parseQuickIntent("下周一下午三点", now).date).toBe("2026-10-26");
    expect(parseQuickIntent("周日", now).date).toBe("2026-10-25");
  });
  it("rejects nonexistent dates and times", () => {
    expect(parseQuickIntent("2月30日25:80", now)).toMatchObject({
      date: null,
      time: null,
    });
    expect(
      parseQuickIntent("2月30日25:80", now).warnings.length,
    ).toBeGreaterThan(0);
  });
  it("asks instead of silently picking one of several meetings", () =>
    expect(
      parseQuickIntent("明天15:00见客户，后天16:00返回", now),
    ).toMatchObject({ date: null, time: null }));
  it("reads an explicit trip duration", () =>
    expect(parseQuickIntent("明天出差两天", now).days).toBe(2));
  it("does not truncate an unsupported long trip", () =>
    expect(parseQuickIntent("出差十天", now).days).toBeNull());
  it("does not treat a year or a travel duration as a time", () =>
    expect(parseQuickIntent("2026年出差2天", now).time).toBeNull());
});
describe("reuse known places safely", () => {
  const a = initialUserPlaces[0];
  it("matches a known venue directly", () =>
    expect(matchIntentPlaces(`明天下午三点去${a.name}见客户`, [a])).toEqual([
      a,
    ]));
  it("does not pick the first saved place for a vague request", () =>
    expect(matchIntentPlaces("明天见客户", initialUserPlaces)).toEqual([]));
  it("leaves multiple venues for selection", () =>
    expect(
      matchIntentPlaces(
        initialUserPlaces
          .slice(0, 2)
          .map((p) => p.name)
          .join("和"),
        initialUserPlaces,
      ),
    ).toHaveLength(2));
  it("does not use completed schedules as place candidates", () =>
    expect(matchIntentPlaces(a.name, [{ ...a, tags: ["日程助手"] }])).toEqual(
      [],
    ));
  it("does not guess a branch when same-name venues occur in different cities", () =>
    expect(
      matchIntentPlaces(a.name, [a, { ...a, id: "other", city: "其他市" }]),
    ).toEqual([]));
  it("deduplicates route and saved representations", () =>
    expect(matchIntentPlaces(a.name, [a, { ...a, id: "route" }])).toEqual([a]));
});

describe("saved context and missing information", () => {
  it("handles everyday relative phrases", () =>
    expect(parseQuickIntent("明早九点去海上世界", now)).toMatchObject({
      date: "2026-10-25",
      time: "09:00",
    }));
  it("does not turn an incomplete next-week request into today", () => {
    const value = parseQuickIntent("下周去见客户", now);
    expect(value.date).toBeNull();
    expect(value.warnings.some((message) => message.includes("日期"))).toBe(
      true,
    );
  });
});

describe("reuse existing arrangements in planning", () => {
  const place = initialUserPlaces[0];
  const event = {
    ...place,
    id: "schedule",
    tags: ["日程助手", "待办事项"],
    status: "want_to_go" as const,
    distanceText: "2026-10-25 15:00",
    reason: "待办事项 · 2026-10-25 15:00 · 见客户",
  };
  it("uses only unfinished arrangements for the same venue and city", () => {
    expect(
      matchingSchedules(
        [place],
        [
          event,
          { ...event, id: "done", status: "visited" },
          { ...event, id: "memo", tags: ["日程助手", "备忘录"] },
          { ...event, id: "elsewhere", city: "其他城市" },
        ],
        "2026-10-24",
      ),
    ).toEqual([event]);
  });
  it("does not carry old or unrelated meetings into a new trip", () => {
    expect(
      matchingSchedules(
        [place],
        [
          { ...event, distanceText: "2026-10-23 10:00" },
          { ...event, name: "其他地点" },
        ],
        "2026-10-24",
      ),
    ).toEqual([]);
  });
  it("supplies existing time and content without requesting duplicate entry", () => {
    expect(scheduleContext([event], "2026-10-25", 1)).toEqual([
      `${place.name}（${place.city}） 2026-10-25 15:00：见客户`,
    ]);
  });
  it("omits constraints outside the chosen date range", () =>
    expect(scheduleContext([event], "2026-10-26", 2)).toEqual([]));
  it("handles a multiday trip across a year boundary", () => {
    expect(
      scheduleContext(
        [{ ...event, distanceText: "2027-01-01 15:00" }],
        "2026-12-31",
        2,
      ),
    ).toHaveLength(1);
  });
});

describe("corrections without stale manual fields", () => {
  it("recognizes a changed meeting time", () =>
    expect(
      changedIntentFields("明天15:00见客户", "明天16:00见客户", now),
    ).toMatchObject({ date: false, time: true }));
  it("preserves explicit corrections when only a note is appended", () =>
    expect(
      changedIntentFields("明天15:00见客户", "明天15:00见客户，带方案", now),
    ).toMatchObject({ date: false, time: false, days: false, place: false }));
  it("recognizes newly entered dates and duration", () =>
    expect(changedIntentFields("保留条件", "明天出发两天", now)).toMatchObject({
      date: true,
      days: true,
    }));
  it("can resolve relative dates against the saved input day", () =>
    expect(parseQuickIntent("明天出发", new Date(2026, 9, 24, 12)).date).toBe(
      "2026-10-25",
    ));
  it("flags unsupported durations instead of silently using one day", () =>
    expect(parseQuickIntent("出差一百天", now).unsupportedDays).toBe(true));
});

describe("conflicting and longer relative expressions", () => {
  it("does not silently shorten 大后天 to 后天", () =>
    expect(
      parseQuickIntent("大后天去见客户", new Date(2026, 9, 24, 12)).date,
    ).toBe("2026-10-27"));
  it("asks for a duration when the text conflicts", () =>
    expect(
      parseQuickIntent("两天或者三天", new Date(2026, 9, 24, 12))
        .unsupportedDays,
    ).toBe(true));
});

it("interprets a stay of one night as a two-day trip without overriding explicit days", () => {
 expect(parseQuickIntent("去上海开会，住一晚").days).toBe(2);
 expect(parseQuickIntent("住宿两晚").days).toBe(3);
 expect(parseQuickIntent("三天，住一晚").days).toBe(3);
 expect(parseQuickIntent("住八晚").unsupportedDays).toBe(true);
 expect(parseQuickIntent("晚上开会").days).toBe(null);
});

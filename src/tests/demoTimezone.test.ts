import { afterEach, expect, it } from "vitest";
import { createDemoMailbox, demoCalendarEntries, demoDay } from "../lib/demoWorkspace";
import { eventDay } from "../lib/tripDay";

// 2026-11-24 00:30 in Shanghai, still 2026-11-23 in Los Angeles.
const NOW = Date.parse("2026-11-23T16:30:00Z");
const originalTZ = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTZ;
});

for (const zone of ["Asia/Shanghai", "Asia/Tokyo", "America/Los_Angeles"]) {
  it(`keeps demo days, timeline and grouping aligned in ${zone}`, () => {
    process.env.TZ = zone;
    // Generation is anchored to Shanghai no matter where the host clock is.
    expect(demoDay(0, NOW)).toBe("2026-11-24");
    expect(demoDay(1, NOW)).toBe("2026-11-25");
    expect(demoDay(2, NOW)).toBe("2026-11-26");

    const events = demoCalendarEntries(NOW);
    const counts = new Map<string, number>();
    for (const event of events) {
      const key = eventDay(event);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // Grouping follows the event timezone, so the host zone cannot split or merge a demo day.
    expect([...counts.keys()].sort()).toEqual(["2026-11-24", "2026-11-25", "2026-11-26"]);
    expect([counts.get("2026-11-24"), counts.get("2026-11-25"), counts.get("2026-11-26")]).toEqual([3, 4, 3]);
    expect(events.map(event => event.start)).toEqual([...events.map(event => event.start)].sort());
    expect(events.every(event => event.timezone === "Asia/Shanghai")).toBe(true);

    const mailbox = createDemoMailbox(NOW);
    expect(mailbox.orders.map(order => eventDay({ start: order.departAt, timezone: "Asia/Shanghai" })))
      .toEqual(["2026-11-25", "2026-11-26", "2026-11-26"]);
  });
}

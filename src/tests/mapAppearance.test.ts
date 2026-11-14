import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mapAppearanceAt,
  nextAppearanceChange,
  startMapAppearanceClock,
} from "../lib/mapAppearance";
const at = (h: number, m = 0, s = 0, ms = 0) =>
  new Date(2026, 9, 24, h, m, s, ms);
afterEach(() => vi.useRealTimers());
describe("scheduled map appearance", () => {
  it.each([
    [0, "business"],
    [5, "business"],
    [6, "young"],
    [12, "young"],
    [17, "young"],
    [18, "business"],
    [23, "business"],
  ] as const)("hour %i uses %s", (hour, mode) =>
    expect(mapAppearanceAt(at(hour))).toBe(mode),
  );
  it("switches exactly at six, including the final millisecond before it", () => {
    expect(mapAppearanceAt(at(5, 59, 59, 999))).toBe("business");
    expect(mapAppearanceAt(at(6))).toBe("young");
    expect(nextAppearanceChange(at(5, 59, 59, 999))).toBe(1);
  });
  it("switches exactly at eighteen", () => {
    expect(mapAppearanceAt(at(17, 59, 59, 999))).toBe("young");
    expect(mapAppearanceAt(at(18))).toBe("business");
    expect(nextAppearanceChange(at(17, 59, 59, 999))).toBe(1);
  });
  it("uses next local morning after evening", () =>
    expect(nextAppearanceChange(at(23))).toBe(7 * 3600000));
  it("handles the end of the year", () =>
    expect(nextAppearanceChange(new Date(2026, 11, 31, 23))).toBe(7 * 3600000));
  it("initializes without waiting for a timer", () => {
    vi.useFakeTimers();
    const change = vi.fn();
    const clock = startMapAppearanceClock(change, { now: () => at(20) });
    expect(change).toHaveBeenLastCalledWith("business");
    clock.dispose();
  });
  it("updates at the boundary instead of waiting for the minute check", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(17, 59, 59, 500));
    const change = vi.fn();
    const clock = startMapAppearanceClock(change);
    vi.advanceTimersByTime(499);
    expect(change).toHaveBeenLastCalledWith("young");
    vi.advanceTimersByTime(1);
    expect(change).toHaveBeenLastCalledWith("business");
    clock.dispose();
  });
  it("recomputes immediately after a long page sleep", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(17));
    const change = vi.fn();
    const clock = startMapAppearanceClock(change);
    vi.setSystemTime(at(21));
    clock.refresh();
    expect(change).toHaveBeenLastCalledWith("business");
    expect(vi.getTimerCount()).toBe(1);
    clock.dispose();
  });
  it("notices system clock or zone changes within one minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(10));
    const change = vi.fn();
    const clock = startMapAppearanceClock(change);
    vi.setSystemTime(at(22));
    vi.advanceTimersByTime(60000);
    expect(change).toHaveBeenLastCalledWith("business");
    clock.dispose();
  });
  it("disposes timers and ignores late refresh", () => {
    vi.useFakeTimers();
    const change = vi.fn();
    const clock = startMapAppearanceClock(change);
    clock.dispose();
    clock.refresh();
    vi.advanceTimersByTime(3600000);
    expect(change).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

import { afterEach, expect, it, vi } from "vitest";
import { createHoverIntent } from "../lib/useHoverPopover";
afterEach(() => vi.useRealTimers());
it("ignores a quick pass over a trigger", () => {
  vi.useFakeTimers();
  const show = vi.fn(), hide = vi.fn(), hover = createHoverIntent(show, hide);
  hover.enter(); vi.advanceTimersByTime(60); hover.leave(); vi.advanceTimersByTime(200);
  expect(show).not.toHaveBeenCalled(); expect(hide).toHaveBeenCalledOnce();
});
it("keeps the menu open while crossing the gap, then closes after leaving", () => {
  vi.useFakeTimers();
  const show = vi.fn(), hide = vi.fn(), hover = createHoverIntent(show, hide);
  hover.enter(); vi.advanceTimersByTime(120); expect(show).toHaveBeenCalledOnce();
  hover.leave(); vi.advanceTimersByTime(80); hover.enter(); vi.advanceTimersByTime(120);
  expect(hide).not.toHaveBeenCalled();
  hover.leave(); vi.advanceTimersByTime(180); expect(hide).toHaveBeenCalledOnce();
});
it("cancels a pending open or close when clicked, dismissed or unmounted", () => {
  vi.useFakeTimers();
  const show = vi.fn(), hide = vi.fn(), hover = createHoverIntent(show, hide);
  hover.enter(); hover.cancel(); vi.runAllTimers(); expect(show).not.toHaveBeenCalled();
  hover.leave(); hover.cancel(); vi.runAllTimers(); expect(hide).not.toHaveBeenCalled();
});

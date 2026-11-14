export type MapAppearance = "young" | "business";
/** Local device time: day includes 06:00, night includes 18:00. */
export function mapAppearanceAt(date: Date): MapAppearance {
  return date.getHours() >= 6 && date.getHours() < 18 ? "young" : "business";
}
export function nextAppearanceChange(date: Date): number {
  const next = new Date(date);
  const hour = date.getHours();
  if (hour < 6) next.setHours(6, 0, 0, 0);
  else if (hour < 18) next.setHours(18, 0, 0, 0);
  else {
    next.setDate(next.getDate() + 1);
    next.setHours(6, 0, 0, 0);
  }
  return next.getTime() - date.getTime();
}
interface ClockOptions {
  now?: () => Date;
  setTimer?: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
}
export function startMapAppearanceClock(
  onChange: (mode: MapAppearance) => void,
  options: ClockOptions = {},
) {
  const now = options.now ?? (() => new Date());
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const refresh = () => {
    if (stopped) return;
    if (timer !== undefined) clearTimer(timer);
    const date = now();
    onChange(mapAppearanceAt(date));
    // Recheck the clock at least every minute for manual time/zone changes,
    // while scheduling an exact callback when a boundary is closer.
    timer = setTimer(
      refresh,
      Math.max(1, Math.min(60000, nextAppearanceChange(date))),
    );
  };
  refresh();
  return {
    refresh,
    dispose: () => {
      stopped = true;
      if (timer !== undefined) clearTimer(timer);
    },
  };
}

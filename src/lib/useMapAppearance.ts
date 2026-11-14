import { useEffect, useState } from "react";
import { mapAppearanceAt, startMapAppearanceClock } from "./mapAppearance";
export function useMapAppearance() {
  const [mode, setMode] = useState(() => mapAppearanceAt(new Date()));
  useEffect(() => {
    const clock = startMapAppearanceClock(setMode);
    const visible = () => {
      if (document.visibilityState === "visible") clock.refresh();
    };
    window.addEventListener("focus", clock.refresh);
    window.addEventListener("pageshow", clock.refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clock.dispose();
      window.removeEventListener("focus", clock.refresh);
      window.removeEventListener("pageshow", clock.refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return mode;
}

import { useEffect, useState } from "react";

/**
 * Tracks the browser's connectivity so the workspace can say plainly that routes and calendar sync
 * may be out of date instead of presenting the last known data as current.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine !== false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

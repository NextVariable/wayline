import { useEffect, useRef, useState } from "react";
import {
  CurrentLocationController,
  normalizeLocatedCity,
  type CurrentLocationState,
} from "./currentLocation";
const initial: CurrentLocationState = {
  status: "idle",
  position: null,
  city: null,
  message: "",
  requestId: 0,
  startedAt: 0,
  source: "auto",
};
const token = import.meta.env.VITE_TIANDITU_TOKEN as string | undefined;
export function useCurrentLocation() {
  const controller = useRef<CurrentLocationController | null>(null);
  const [state, setState] = useState(initial);
  useEffect(() => {
    let cancelled = false;
    let permission: PermissionStatus | undefined;
    const current = new CurrentLocationController({
      geo: window.isSecureContext ? navigator.geolocation : undefined,
      resolveCity: async (position) => {
        if (!token) return null;
        const params = new URLSearchParams({
          postStr: JSON.stringify({
            lon: position.lng,
            lat: position.lat,
            ver: 1,
          }),
          type: "geocode",
          tk: token,
        });
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 8000);
        try {
          const response = await fetch(
            "https://api.tianditu.gov.cn/geocoder?" + params,
            { signal: abort.signal },
          );
          if (!response.ok) return null;
          return normalizeLocatedCity(await response.json());
        } finally {
          clearTimeout(timer);
        }
      },
    });
    controller.current = current;
    const unsubscribe = current.subscribe(() =>
      setState(current.getSnapshot()),
    );
    // StrictMode's cancelled setup must not trigger a second permission request.
    queueMicrotask(() => {
      if (!cancelled) current.request();
    });
    const changed = () => {
      if (permission?.state === "granted") current.request();
      else if (permission?.state === "denied") current.revoke();
    };
    void navigator.permissions
      ?.query({ name: "geolocation" })
      .then((result) => {
        if (cancelled) return;
        permission = result;
        permission.addEventListener("change", changed);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unsubscribe();
      current.dispose();
      permission?.removeEventListener("change", changed);
      if (controller.current === current) controller.current = null;
    };
  }, []);
  return {
    ...state,
    message: state.status === "error" && !window.isSecureContext
      ? "定位需要通过 HTTPS 打开 Wayline。"
      : state.message,
    request: (source: "auto" | "manual" = "manual") =>
      controller.current?.request(source),
  };
}

import { useEffect, useRef, useState } from "react";
import type { Place } from "../types/place";
import { legacyFootprintVisits } from "./footprints";
import { openFootprintStore } from "./footprintStore";
import { FootprintRecorder, type RecorderSnapshot } from "./footprintRecorder";
const empty: RecorderSnapshot = {
  tracks: [],
  visits: [],
  activeId: null,
  busy: false,
  message: "",
  storageError: false,
  fix: null,
};
let pendingLockRelease: Promise<void> = Promise.resolve();
export async function acquireRecordingLock(): Promise<(() => void) | null> {
  if (!navigator.locks) return () => {};
  await pendingLockRelease;
  return new Promise((resolve, reject) => {
    const request = navigator.locks.request(
      "whereto-location-recorder",
      { ifAvailable: true },
      (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        return new Promise<void>((release) =>
          resolve(() => {
            pendingLockRelease = request.then(
              () => {},
              () => {},
            );
            release();
          }),
        );
      },
    );
    void request.catch(reject);
  });
}
export function useFootprints(userId: string, places: Place[]) {
  const placesRef = useRef(places);
  placesRef.current = places;
  const [state, setState] = useState<{
    owner: string;
    recorder: FootprintRecorder | null;
    snapshot: RecorderSnapshot;
    error: string;
    loading: boolean;
  }>({
    owner: userId,
    recorder: null,
    snapshot: empty,
    error: "",
    loading: true,
  });
  useEffect(() => {
    let cancelled = false;
    let recorder: FootprintRecorder | undefined;
    let unsubscribe: (() => void) | undefined;
    setState({
      owner: userId,
      recorder: null,
      snapshot: empty,
      error: "",
      loading: true,
    });
    void openFootprintStore(userId)
      .then(async (store) => {
        if (cancelled) {
          store.close();
          return;
        }
        recorder = new FootprintRecorder({
          store,
          geo: window.isSecureContext ? navigator.geolocation : undefined,
          acquire: acquireRecordingLock,
        });
        await recorder.load();
        if (cancelled) {
          recorder.dispose();
          return;
        }
        const current = recorder;
        for (const visit of legacyFootprintVisits(
          placesRef.current,
          current.getSnapshot().visits,
          Date.now(),
        )) {
          if (cancelled) return;
          if (!(await current.saveVisit(visit))) break;
        }
        const update = () =>
          setState({
            owner: userId,
            recorder: current,
            snapshot: current.getSnapshot(),
            error: "",
            loading: false,
          });
        unsubscribe = current.subscribe(update);
        update();
      })
      .catch(() => {
        if (!cancelled)
          setState({
            owner: userId,
            recorder: null,
            snapshot: empty,
            error: "无法打开足迹存储。请检查浏览器存储权限，刷新后重试。",
            loading: false,
          });
      });
    const hide = () => {
      if (document.visibilityState !== "visible")
        recorder?.pause("页面进入后台，记录已中断；返回后请继续记录", true);
    };
    const pagehide = () => recorder?.pause("页面离开，记录已中断", true);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", pagehide);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (recorder?.getSnapshot().storageError || recorder?.getSnapshot().busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      cancelled = true;
      unsubscribe?.();
      recorder?.dispose();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [userId]);
  return state.owner === userId
    ? state
    : {
        owner: userId,
        recorder: null,
        snapshot: empty,
        error: "",
        loading: true,
      };
}

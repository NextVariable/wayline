import { useCallback, useEffect, useRef, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import type { FootprintTrack } from "./footprints";
import {
  hasNativeFootprints,
  nativeFootprints,
  type NativeStatus,
} from "./nativeFootprints";
import {
  NativeFootprintReader,
  StaleNativeRead,
} from "./nativeFootprintReader";

export interface NativeFootprintsState {
  available: boolean;
  status: NativeStatus | null;
  tracks: FootprintTrack[];
  busy: boolean;
  error: string;
  enable: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  disable: () => Promise<void>;
  openSettings: () => Promise<void>;
  exportTracks: () => Promise<FootprintTrack[]>;
}
export function useNativeFootprints(userId: string): NativeFootprintsState {
  const available = hasNativeFootprints();
  const reader = useRef<NativeFootprintReader | null>(null);
  if (!reader.current)
    reader.current = new NativeFootprintReader(nativeFootprints);
  reader.current.selectOwner(userId);
  const currentOwner = useRef(userId);
  currentOwner.current = userId;
  const [view, setView] = useState<{
    owner: string;
    status: NativeStatus | null;
    tracks: FootprintTrack[];
    error: string;
  }>({ owner: userId, status: null, tracks: [], error: "" });
  const [action, setAction] = useState({
    owner: userId,
    busy: false,
    error: "",
  });
  const readNow = useCallback(async () => {
    if (!available) return [];
    try {
      const next = await reader.current!.refresh();
      if (next.owner !== userId || currentOwner.current !== userId)
        throw new StaleNativeRead();
      setView({ ...next, error: "" });
      return next.tracks;
    } catch (e) {
      if (!(e instanceof StaleNativeRead) && currentOwner.current === userId)
        setView((v) => ({
          owner: userId,
          status: v.owner === userId ? v.status : null,
          tracks: v.owner === userId ? v.tracks : [],
          error: "无法读取本机足迹，请重试",
        }));
      throw e;
    }
  }, [available, userId]);
  const refresh = useCallback(() => {
    void readNow().catch(() => {});
  }, [readNow]);
  useEffect(() => {
    refresh();
    if (!available) return;
    const listener = CapApp.addListener("appStateChange", (s) => {
      if (s.isActive) refresh();
    });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 15000);
    return () => {
      clearInterval(timer);
      void listener.then((h) => h.remove());
    };
  }, [available, refresh]);
  const run = async (operation: () => Promise<unknown>, failure: string) => {
    setAction({ owner: userId, busy: true, error: "" });
    let error = "";
    try {
      await operation();
    } catch (e) {
      const code = (e as { code?: string }).code;
      error =
        code === "denied"
          ? "需要在系统设置中允许定位"
          : code === "owner_conflict"
            ? "另一空间正在记录，请切回原空间关闭后再启用"
            : failure;
    }
    if (currentOwner.current === userId)
      setAction({ owner: userId, busy: false, error });
    refresh();
  };
  const own = view.owner === userId;
  return {
    available,
    status: own ? view.status : null,
    tracks: own ? view.tracks : [],
    busy: action.owner === userId && action.busy,
    error:
      (action.owner === userId ? action.error : "") || (own ? view.error : ""),
    enable: () =>
      run(() => nativeFootprints.enable({ owner: userId }), "未能启用自动足迹"),
    pause: () =>
      run(() => nativeFootprints.pause({ owner: userId }), "未能暂停"),
    resume: () =>
      run(() => nativeFootprints.resume({ owner: userId }), "未能恢复"),
    disable: () =>
      run(() => nativeFootprints.disable({ owner: userId }), "未能关闭"),
    openSettings: () => nativeFootprints.openSettings(),
    exportTracks: readNow,
  };
}

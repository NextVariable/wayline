import { useLayoutEffect, useRef } from "react";

/** Move focus into a newly opened work panel, then return to its trigger. */
export function usePanelFocus<T extends HTMLElement = HTMLElement>(
  open: boolean,
) {
  const ref = useRef<T | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const scrollPosition = useRef(0);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const panel = ref.current;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      !panel.contains(active)
    )
      triggerRef.current = active;
    const trigger = triggerRef.current;
    const target =
      scrollPosition.current > 0
        ? panel
        : (panel.querySelector<HTMLElement>("[data-autofocus]") ??
          panel.querySelector<HTMLElement>("h1, h2"));
    if (target) {
      if (!target.matches("input,textarea,select,button")) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
    panel.scrollTop = scrollPosition.current;
    const rememberScroll = () => {
      scrollPosition.current = panel.scrollTop;
    };
    panel.addEventListener("scroll", rememberScroll, { passive: true });
    return () => {
      panel.removeEventListener("scroll", rememberScroll);
      queueMicrotask(() => {
        // StrictMode replays effects while the same panel is still open.
        if (ref.current === panel && panel.isConnected && !panel.hidden) return;
        if (
          (document.activeElement === document.body ||
            panel.contains(document.activeElement)) &&
          trigger?.isConnected &&
          !trigger.closest("[inert]") &&
          trigger.getClientRects().length
        )
          trigger.focus({ preventScroll: true });
      });
    };
  }, [open]);
  return ref;
}

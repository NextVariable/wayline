import { useEffect, useMemo, useRef, type PointerEvent, type RefObject } from "react";

/** A short grace period lets the pointer cross the gap to a floating menu. */
export function createHoverIntent(show: () => void, hide: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  return {
    cancel,
    enter() { cancel(); timer = setTimeout(show, 120); },
    leave() { cancel(); timer = setTimeout(hide, 180); },
  };
}

export function useHoverPopover(
  open: boolean,
  setOpen: (value: boolean) => void,
  trigger: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  suppliedOrigin?: RefObject<boolean>,
) {
  const ownOrigin = useRef(false);
  const origin = suppliedOrigin ?? ownOrigin;
  const current = useRef({ open, setOpen });
  current.current = { open, setOpen };
  const intent = useMemo(() => createHoverIntent(() => {
    if (current.current.open) return;
    origin.current = true;
    current.current.setOpen(true);
  }, () => {
    if (!origin.current) return;
    if (panel.current?.contains(document.activeElement))
      trigger.current?.focus({ preventScroll: true });
    current.current.setOpen(false);
  }), [origin, panel, trigger]);
  useEffect(() => () => intent.cancel(), [intent]);
  useEffect(() => {
    if (!open) { intent.cancel(); origin.current = false; }
  }, [open, intent, origin]);
  const mouse = (event: PointerEvent) => event.pointerType === "mouse" &&
    window.matchMedia("(any-hover: hover) and (any-pointer: fine)").matches;
  return {
    origin,
    cancel: intent.cancel,
    props: {
      onPointerEnter(event: PointerEvent) { if (mouse(event)) intent.enter(); },
      onPointerLeave(event: PointerEvent) { if (mouse(event) && origin.current) intent.leave(); },
    },
  };
}

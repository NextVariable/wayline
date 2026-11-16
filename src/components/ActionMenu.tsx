import { MoreHorizontal } from "lucide-react";
import {
  useLayoutEffect,
  useId,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useHoverPopover } from "../lib/useHoverPopover";

export type MenuAction = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};
export function ActionMenu({
  label,
  actions,
  children,
  className = "",
}: {
  label: string;
  actions: MenuAction[];
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const hover = useHoverPopover(open, setOpen, trigger, menu);
  const close = (restore = false) => {
    setOpen(false);
    if (restore) trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    const anchor = trigger.current;
    const panel = menu.current;
    if (!open || !anchor || !panel) return;
    const viewport = window.visualViewport;
    const scrollPanel = anchor.closest(".sidebar-scroll, .workspace-panel");
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const clip = scrollPanel?.getBoundingClientRect();
      const x = viewport?.offsetLeft ?? 0;
      const y = viewport?.offsetTop ?? 0;
      const right = x + (viewport?.width ?? window.innerWidth);
      const bottom = y + (viewport?.height ?? window.innerHeight);
      if (!rect.width || !rect.height || rect.bottom <= Math.max(y, clip?.top ?? y) || rect.top >= Math.min(bottom, clip?.bottom ?? bottom)) {
        setOpen(false);
        return;
      }
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const below = rect.bottom + height + 18 <= bottom;
      const top = below ? rect.bottom + 6 : rect.top - height - 6;
      const next = {
        left: Math.max(x + 12, Math.min(right - width - 12, rect.right - width)),
        top: Math.max(y + 12, Math.min(bottom - height - 12, top)),
      };
      setPosition(previous => previous.left === next.left && previous.top === next.top ? previous : next);
    };
    let frame = 0;
    const follow = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; update(); });
    };
    update();
    const resize = new ResizeObserver(follow);
    resize.observe(panel);
    resize.observe(anchor);
    window.addEventListener("resize", follow);
    document.addEventListener("scroll", follow, true);
    viewport?.addEventListener("resize", follow);
    viewport?.addEventListener("scroll", follow);
    if (!hover.origin.current) panel
      .querySelector<HTMLButtonElement>("button:not([disabled])")
      ?.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("resize", follow);
      document.removeEventListener("scroll", follow, true);
      viewport?.removeEventListener("resize", follow);
      viewport?.removeEventListener("scroll", follow);
    };
  }, [open, hover.origin]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return (
    <>
      <button
        type="button"
        ref={trigger}
        {...hover.props}
        className={`action-menu-trigger ${className}`}
        aria-label={label}
        title={label}
        aria-controls={open ? menuId : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          hover.cancel();
          const hovered = hover.origin.current;
          hover.origin.current = false;
          if (open && hovered) menu.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
          else setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            hover.cancel();
            hover.origin.current = false;
            setOpen(true);
            menu.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
          }
        }}
      >
        {children ?? <MoreHorizontal size={18} />}
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            {...hover.props}
            className="action-menu"
            id={menuId}
            role="menu"
            aria-label={label}
            style={position}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close(true);
                return;
              }
              if (event.key === "Tab") {
                event.preventDefault();
                const targets = Array.from(
                  document.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
                  ),
                ).filter(
                  (element) =>
                    element.tabIndex >= 0 &&
                    element.getClientRects().length &&
                    getComputedStyle(element).visibility === "visible" &&
                    !element.closest("[inert], [hidden]") &&
                    !menu.current?.contains(element),
                );
                const index = targets.indexOf(trigger.current!);
                const target =
                  targets[
                    (index + (event.shiftKey ? -1 : 1) + targets.length) %
                      targets.length
                  ];
                close();
                queueMicrotask(() => target?.focus());
                return;
              }
              if (
                event.key === "/" ||
                ((event.metaKey || event.ctrlKey) &&
                  event.key.toLowerCase() === "k")
              ) {
                close();
                return;
              }
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
                return;
              event.preventDefault();
              const buttons = Array.from(
                menu.current?.querySelectorAll<HTMLButtonElement>(
                  "button:not([disabled])",
                ) ?? [],
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            }}
          >
            {actions.map((action) => (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={action.danger ? "is-danger" : ""}
                disabled={action.disabled}
                key={action.label}
                onClick={() => {
                  close(true);
                  action.onSelect();
                }}
              >
                {action.icon}
                <span>{action.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

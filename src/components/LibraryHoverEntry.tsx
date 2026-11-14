import { cloneElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode, type ButtonHTMLAttributes } from "react";
import { createPortal } from "react-dom";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;
/** Desktop cascading preview; touch and Enter keep the original navigation. */
export function LibraryHoverEntry({ label, children, preview }: {label: string; children: ReactElement<ButtonProps>; preview: ReactNode}) {
  const [position, setPosition] = useState<{left:number;top:number;width:number}|null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const cancel = () => clearTimeout(timer.current);
  const close = () => { cancel(); setPosition(null); };
  const show = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect || !window.matchMedia("(min-width: 701px) and (hover: hover) and (pointer: fine)").matches) return;
    const width = Math.min(320, window.innerWidth - rect.right - 24);
    if (width < 220) return;
    setPosition({left:rect.right + 12,top:Math.max(12,Math.min(rect.top,window.innerHeight - 340)),width});
  };
  const leave = () => { cancel(); timer.current = setTimeout(() => {
    setPosition(null);
  },180); };
  useEffect(() => {
    return () => clearTimeout(timer.current);
  },[]);
  useEffect(() => {
    if (!position) return;
    const dismiss = (e: PointerEvent) => {
      if (e.target instanceof Node && !panel.current?.contains(e.target) && !trigger.current?.contains(e.target)) close();
    };
    const resize = (event: Event) => {
      if (event.type === "scroll" && event.target instanceof Node && panel.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener("pointerdown",dismiss);
    window.addEventListener("resize",resize);
    window.addEventListener("scroll",resize,true);
    return () => {document.removeEventListener("pointerdown",dismiss);window.removeEventListener("resize",resize);window.removeEventListener("scroll",resize,true);};
  },[!!position]);
  return <>{cloneElement(children, {
    ref: trigger,
    "aria-expanded":!!position,
    "aria-controls":position?id:undefined,
    onPointerEnter: event => { if (event.pointerType === "mouse") {cancel();timer.current=setTimeout(show,120);} },
    onPointerLeave:leave,
    onBlur:event=>{if (!(event.relatedTarget instanceof Node) || !panel.current?.contains(event.relatedTarget)) close();},
    onClick:event=>{close();children.props.onClick?.(event);},
    onKeyDown:event=>{
      if (event.key === "ArrowRight") {event.preventDefault();cancel();show();requestAnimationFrame(()=>panel.current?.querySelector<HTMLButtonElement>("button")?.focus());}
      else if (event.key === "Escape" && position) {event.preventDefault();event.stopPropagation();close();}
      else children.props.onKeyDown?.(event);
    },
  } as ButtonProps)}
  {position && createPortal(<div ref={panel} id={id} className="library-hover-panel" role="region" aria-label={`${label}预览`}
    style={{...position,maxHeight:window.innerHeight-position.top-12}} onPointerEnter={cancel} onPointerLeave={leave}
    onBlur={event=>{if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) close();}}
    onKeyDown={event=>{if(event.key === "Escape" || event.key === "ArrowLeft") {event.preventDefault();event.stopPropagation();close();trigger.current?.focus();}}}
    onClick={close}>
    <h2>{label}</h2><div className="library-hover-content">{preview}</div>
  </div>,document.body)}</>;
}

/** Long hold on bare map only. Dragging, controls and multi-touch retain their normal actions. */
export function installMapLongPress(container: HTMLElement, onHold: (point: {
    x: number;
    y: number;
}) => void) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: {
        x: number;
        y: number;
        id: number;
    } | undefined;
    const pointers = new Set<number>();
    const cancel = () => { clearTimeout(timer); timer = undefined; start = undefined; };
    const down = (event: Event) => {
        const e = event as PointerEvent;
        pointers.add(e.pointerId);
        cancel();
        const target = e.target as Element;
        if (e.button !== 0 || pointers.size !== 1 || target.closest?.('button,a,input,textarea,.amap-marker,.leaflet-marker-icon'))
            return;
        start = { x: e.clientX, y: e.clientY, id: e.pointerId };
        timer = setTimeout(() => { if (!start)
            return; const p = start; cancel(); onHold({ x: p.x, y: p.y }); }, 650);
    };
    const move = (event: Event) => { const e = event as PointerEvent; if (start && (e.pointerId !== start.id || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 9))
        cancel(); };
    const up = (event: Event) => { pointers.delete((event as PointerEvent).pointerId); cancel(); };
    const leave = (event: Event) => {
        // A mouse release outside the map may never bubble to this element.
        up(event);
    };
    const events: [
        string,
        EventListener
    ][] = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['pointerleave', leave]];
    for (const [name, fn] of events)
        container.addEventListener(name, fn);
    return () => { cancel(); pointers.clear(); for (const [name, fn] of events)
        container.removeEventListener(name, fn); };
}

import { afterEach, expect, it, vi } from 'vitest';
import { installMapLongPress } from '../lib/mapLongPress';
function pointer(target: EventTarget, type: string, x = 20, y = 30, extra = {}) {
    target.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y, pointerId: 1, button: 0, ...extra }));
}
afterEach(() => vi.useRealTimers());
it('jumps once at the held point, while a short click does not jump', () => {
    vi.useFakeTimers();
    const target = new EventTarget(), points: unknown[] = [];
    const stop = installMapLongPress(target as HTMLElement, p => points.push(p));
    pointer(target, 'pointerdown');
    vi.advanceTimersByTime(300);
    pointer(target, 'pointerup');
    vi.advanceTimersByTime(700);
    expect(points).toEqual([]);
    pointer(target, 'pointerdown');
    vi.advanceTimersByTime(700);
    expect(points).toEqual([{ x: 20, y: 30 }]);
    vi.advanceTimersByTime(900);
    expect(points).toHaveLength(1);
    stop();
});
it.each(['drag', 'pinch', 'cancel', 'cleanup'])('does not jump after %s', kind => {
    vi.useFakeTimers();
    const target = new EventTarget(), jump = vi.fn();
    const stop = installMapLongPress(target as HTMLElement, jump);
    pointer(target, 'pointerdown');
    if (kind === 'drag') pointer(target, 'pointermove', 40, 30);
    if (kind === 'pinch') pointer(target, 'pointerdown', 20, 30, { pointerId: 2 });
    if (kind === 'cancel') pointer(target, 'pointercancel');
    if (kind === 'cleanup') stop();
    vi.advanceTimersByTime(700);
    expect(jump).not.toHaveBeenCalled();
    stop();
});
it('does not hijack a long hold on map controls or place markers', () => {
    vi.useFakeTimers();
    const target = Object.assign(new EventTarget(), { closest: () => ({}) }), jump = vi.fn();
    const stop = installMapLongPress(target as unknown as HTMLElement, jump);
    pointer(target, 'pointerdown'); vi.advanceTimersByTime(700);
    expect(jump).not.toHaveBeenCalled(); stop();
});
it('allows another long hold after a pointer leaves and releases outside the map', () => {
    vi.useFakeTimers();
    const target = new EventTarget(), jump = vi.fn();
    const stop = installMapLongPress(target as HTMLElement, jump);
    pointer(target, 'pointerdown');
    pointer(target, 'pointerleave');
    pointer(target, 'pointerdown', 40, 45, { pointerId: 2 });
    vi.advanceTimersByTime(700);
    expect(jump).toHaveBeenCalledExactlyOnceWith({ x: 40, y: 45 });
    stop();
});

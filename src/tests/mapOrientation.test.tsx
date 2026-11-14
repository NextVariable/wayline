import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MapCompass } from "../components/MapCompass";
import { normalizeRotation, resetMapNorth, subscribeMapOrientation } from "../lib/mapOrientation";

describe("map compass", () => {
  it("displays north and remains unavailable until the map reports its direction", () => {
    const loading = renderToStaticMarkup(<MapCompass rotation={null} onReset={() => {}} />);
    expect(loading).toContain('disabled=""');
    expect(loading).toContain("地图加载中");
    const north = renderToStaticMarkup(<MapCompass rotation={0} onReset={() => {}} />);
    expect(north).toContain("指南针，正北朝上");
    expect(north).not.toContain("disabled");
    expect(north).toContain(">N</text>");
  });
  it("rotates the north indicator opposite to the map bearing and offers north reset", () => {
    const html = renderToStaticMarkup(<MapCompass rotation={90} onReset={() => {}} />);
    expect(html).toContain("指南针，恢复正北朝上");
    expect(html).toContain('transform="rotate(-90 16 16)"');
  });
  it("normalizes wrapped and invalid SDK angles", () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(NaN)).toBe(0);
  });
  it("reads the actual map direction initially and on rotation, then unsubscribes", () => {
    let angle = 25;
    const listeners = new Map<string, () => void>();
    const map = {
      getRotation: () => angle,
      setRotation: vi.fn((next: number) => { angle = next; listeners.get("rotatechange")?.(); }),
      on: (name: string, fn: () => void) => listeners.set(name, fn),
      off: (name: string) => listeners.delete(name),
    };
    const onChange = vi.fn();
    const dispose = subscribeMapOrientation(map, onChange);
    expect(onChange).toHaveBeenLastCalledWith(25);
    angle = -90;
    listeners.get("rotatechange")?.();
    expect(onChange).toHaveBeenLastCalledWith(270);
    resetMapNorth(map);
    expect(map.setRotation).toHaveBeenCalledWith(0, true);
    expect(onChange).toHaveBeenLastCalledWith(0);
    dispose();
    expect(listeners.has("rotatechange")).toBe(false);
  });
});

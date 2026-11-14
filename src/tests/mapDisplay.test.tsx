import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MapDisplayOptions } from "../components/MapDisplayOptions";
import { renderPlacePinHTML } from "../components/PlacePin";
import { initialUserPlaces } from "../data/userPlaces";

const base = { mapMode: "explore" as const, activeLayers: ["business" as const], onMapModeChange: () => {}, onToggleLayers: () => {}, showLayers: true };
describe("compact map display choices", () => {
  it("shows two basemaps and the business layers with their current state", () => {
    const html = renderToStaticMarkup(<MapDisplayOptions {...base} />);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/role="switch"/g)).toHaveLength(2);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain("标准");
    expect(html).toContain("卫星");
    expect(html).toContain("商务中心");
    expect(html).toContain("交通枢纽");
    expect(html).not.toMatch(/精度|重新定位|定位帮助|城市资源|自动 ·/);
  });
  it("does not present current-city results as nationwide coverage", () => {
    const html = renderToStaticMarkup(<MapDisplayOptions {...base} multiCity />);
    expect(html).not.toContain('role="switch"');
    expect(html).toContain("选择一个城市后可查看商务中心和交通枢纽");
  });
  it("keeps the satellite selection and hides irrelevant layers in footprints", () => {
    const html = renderToStaticMarkup(<MapDisplayOptions {...base} mapMode="satellite" showLayers={false} />);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("商务中心");
  });
});

describe("calendar places layer", () => {
  it("offers a 日程地点 switch in the map options", () => {
    const off = renderToStaticMarkup(<MapDisplayOptions {...base} calendarLayer={false} onCalendarLayerChange={() => {}} />);
    expect(off).toContain("日程地点");
    expect(off).toContain('aria-label="日程地点"');
    const on = renderToStaticMarkup(<MapDisplayOptions {...base} multiCity calendarLayer onCalendarLayerChange={() => {}} />);
    expect(on).toContain("日程地点");
    expect(on.match(/checked=""/g)).toHaveLength(1);
  });
  it("draws calendar places with their own shape, not only a colour", () => {
    const html = renderPlacePinHTML({...initialUserPlaces[0], id: "calendar:x", tags: ["日程"], source: "imported"}, false, "business");
    expect(html).toContain("is-calendar");
    expect(renderPlacePinHTML(initialUserPlaces[0], false, "business")).not.toContain("is-calendar");
  });
});

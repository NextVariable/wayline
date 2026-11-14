import { describe, expect, it } from "vitest";
import { applyMapZoom, createSmoothMapZoom, zoomAvailability } from "../lib/mapZoom";
function fakeMap(initial: number) {
  let zoom = initial;
  const changes: number[] = [];
  return { getZoom: () => zoom, setZoom: (next: number) => { changes.push(next); zoom = next; }, changes };
}
describe("map zoom commands", () => {
  it("moves one full level per click and reverses cleanly", () => {
    const map = fakeMap(12);
    applyMapZoom(map, 1, 2, 18);
    applyMapZoom(map, -1, 2, 18);
    expect(map.changes).toEqual([13, 12]);
  });
  it("retains every click when React batches several commands", () => {
    const map = fakeMap(12);
    applyMapZoom(map, 4, 2, 18);
    applyMapZoom(map, -3, 2, 18);
    expect(map.changes).toEqual([16, 13]);
  });
  it("uses the current view after a gesture or a city change", () => {
    const map = fakeMap(12.4);
    applyMapZoom(map, 1, 2, 18);
    map.setZoom(7.2);
    applyMapZoom(map, -1, 2, 18);
    expect(map.getZoom()).toBeCloseTo(6.2);
  });
  it("clamps at the bounds and does not request redundant zoom animations", () => {
    const map = fakeMap(17.7);
    applyMapZoom(map, 3, 2, 18);
    applyMapZoom(map, 1, 2, 18);
    applyMapZoom(map, -30, 2, 18);
    applyMapZoom(map, -1, 2, 18);
    expect(map.changes).toEqual([18, 2]);
  });
  it("does not change the view for cancelled or initial commands", () => {
    const map = fakeMap(12);
    applyMapZoom(map, 0, 2, 18);
    expect(map.changes).toEqual([]);
  });
  it("reports which controls remain usable at either limit", () => {
    expect(zoomAvailability(2, 2, 18)).toEqual({ canZoomIn: true, canZoomOut: false });
    expect(zoomAvailability(18, 2, 18)).toEqual({ canZoomIn: false, canZoomOut: true });
    expect(zoomAvailability(12.4, 2, 18)).toEqual({ canZoomIn: true, canZoomOut: true });
  });
});

function animated(initial=12, reducedMotion=false) {
  const map=fakeMap(initial);
  let callback:FrameRequestCallback|undefined;
  let time=0;
  const controller=createSmoothMapZoom(map,2,18,{frame:fn=>{callback=fn;return 1;},cancel:()=>{callback=undefined;},reducedMotion:()=>reducedMotion});
  const advance=(frames=1,step=16)=>{for(let i=0;i<frames;i++){const current=callback;callback=undefined;time+=step;current?.(time);}};
  return {map,controller,advance};
}
describe("continuous zoom camera",()=>{
 it("moves through intermediate levels rather than jumping to the next integer",()=>{
  const {map,controller,advance}=animated();controller.step(1);
  expect(map.changes).toEqual([]);advance();expect(map.getZoom()).toBeGreaterThan(12);expect(map.getZoom()).toBeLessThan(12.2);
  advance(80);expect(map.getZoom()).toBe(13);expect(map.changes.length).toBeGreaterThan(10);
 });
 it("retains rapid clicks and retargets without changing the current view immediately",()=>{
  const {map,controller,advance}=animated();controller.step(1);advance(4);const mid=map.getZoom();
  controller.step(2);expect(map.getZoom()).toBe(mid);advance(90);expect(map.getZoom()).toBe(15);
 });
 it("reverses smoothly and settles at the requested level",()=>{
  const {map,controller,advance}=animated();controller.step(2);advance(8);const mid=map.getZoom();controller.step(-3);
  expect(map.getZoom()).toBe(mid);advance(100);expect(map.getZoom()).toBe(11);
 });
 it("stops when a new map gesture or city command takes over",()=>{
  const {map,controller,advance}=animated();controller.step(3);advance(3);controller.stop();map.setZoom(7);advance(80);expect(map.getZoom()).toBe(7);
  controller.step(1);advance(80);expect(map.getZoom()).toBe(8);
 });
 it("clamps at camera bounds and supports reduced motion",()=>{
  const {map,controller,advance}=animated(17.8);controller.step(9);advance(80);expect(map.getZoom()).toBe(18);expect(map.changes.every(z=>z<=18&&z>=2)).toBe(true);
  const reduced=animated(12,true);reduced.controller.step(1);expect(reduced.map.changes).toEqual([13]);reduced.advance(80);expect(reduced.map.changes).toEqual([13]);
 });
 it("finishes precisely even when the SDK rounds reported intermediate zoom",()=>{
  let zoom=12;let callback:FrameRequestCallback|undefined;let time=0;
  const controller=createSmoothMapZoom({getZoom:()=>zoom,setZoom:value=>{zoom=Math.round(value*100)/100;}},2,18,{frame:fn=>{callback=fn;return 1;},cancel:()=>{callback=undefined;}});
  controller.step(1);
  for(let i=0;i<100;i++){const fn=callback;callback=undefined;time+=16;fn?.(time);}
  expect(zoom).toBe(13);expect(callback).toBeUndefined();
 });
});

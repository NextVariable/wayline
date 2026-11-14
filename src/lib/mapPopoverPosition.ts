type Rect={left:number;right:number;top:number;height:number};
/** Prefer the left of the map control, vertically centred, then clamp to the viewport. */
export function mapPopoverPosition(anchor:Rect,panel:{width:number;height:number},viewport:{width:number;height:number}) {
  const margin=12,gap=12;
  const preferred=anchor.left-gap-panel.width;
  const left=preferred>=margin?preferred:Math.min(anchor.right+gap,viewport.width-panel.width-margin);
  return {left:Math.max(margin,left),top:Math.max(margin,Math.min(anchor.top+(anchor.height-panel.height)/2,viewport.height-panel.height-margin))};
}

import { useLayoutEffect, useRef, type RefObject } from "react";

export function advanceWorkspaceMotion(position:number,velocity:number,target:number,dt:number) {
  const omega=target===1?23:27;
  const offset=position-target,impulse=velocity+omega*offset,decay=Math.exp(-omega*dt);
  const next=target+(offset+impulse*dt)*decay;
  return {position:Math.max(0,Math.min(1,next)),velocity:next<0||next>1?0:(velocity-omega*impulse*dt)*decay};
}
/** A single damped spring drives both the panel and its handle, retaining velocity on reversal. */
export function useWorkspaceMotion(root:RefObject<HTMLElement|null>,collapsed:boolean) {
  const motion=useRef({position:collapsed?0:1,velocity:0,target:collapsed?0:1});
  const frame=useRef<number|null>(null),last=useRef<number|null>(null);
  useLayoutEffect(()=>{
    const element=root.current;if(!element)return;
    const preference=window.matchMedia("(prefers-reduced-motion: reduce)");
    const write=(settled:boolean)=>{
      element.style.setProperty("--workspace-progress",String(motion.current.position));
      element.dataset.workspaceMotion=settled?(motion.current.target?"open":"closed"):"moving";
    };
    motion.current.target=collapsed?0:1;
    const tick:FrameRequestCallback=time=>{
      frame.current=null;
      const dt=last.current===null?1/60:Math.min(.032,Math.max(0,(time-last.current)/1000));last.current=time;
      Object.assign(motion.current,advanceWorkspaceMotion(motion.current.position,motion.current.velocity,motion.current.target,dt));
      const settled=Math.abs(motion.current.position-motion.current.target)<.001 && Math.abs(motion.current.velocity)<.02;
      if(settled){motion.current.position=motion.current.target;motion.current.velocity=0;last.current=null;}
      write(settled);if(!settled)frame.current=requestAnimationFrame(tick);
    };
    const start=()=>{
      if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;
      if(preference.matches){motion.current.position=motion.current.target;motion.current.velocity=0;last.current=null;write(true);}
      else {write(false);frame.current=requestAnimationFrame(tick);}
    };
    start();preference.addEventListener("change",start);
    return ()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;preference.removeEventListener("change",start);};
  },[collapsed]);
}

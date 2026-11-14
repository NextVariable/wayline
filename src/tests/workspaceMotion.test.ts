import {expect,it} from "vitest";
import {advanceWorkspaceMotion} from "../lib/useWorkspaceMotion";
it("settles without rubber band overshoot",()=>{
 for(const target of [0,1]){let s={position:1-target,velocity:0};let previous=s.position;
 for(let i=0;i<90;i++){s=advanceWorkspaceMotion(s.position,s.velocity,target,1/60);expect(s.position).toBeGreaterThanOrEqual(0);expect(s.position).toBeLessThanOrEqual(1);expect(target===1?s.position>=previous:s.position<=previous).toBe(true);previous=s.position;}
 expect(Math.abs(s.position-target)).toBeLessThan(.001);}
});
it("retains momentum when a close is reversed",()=>{
 let s={position:1,velocity:0};for(let i=0;i<5;i++)s=advanceWorkspaceMotion(s.position,s.velocity,0,1/60);
 const before=s;s=advanceWorkspaceMotion(s.position,s.velocity,1,1/120);
 expect(Math.abs(s.position-before.position)).toBeLessThan(.05);expect(s.velocity).toBeLessThan(0);
 for(let i=0;i<90;i++)s=advanceWorkspaceMotion(s.position,s.velocity,1,1/60);expect(s.position).toBeCloseTo(1,3);
});

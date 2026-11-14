import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FootprintsPanel } from "../components/FootprintsPanel";
import { ToastProvider } from "../components/Toast";
import type { RecorderSnapshot } from "../lib/footprintRecorder";
const noop=async()=>{};
const native={available:false,status:null,tracks:[],busy:false,error:"",enable:noop,pause:noop,resume:noop,disable:noop,openSettings:noop,exportTracks:async()=>[]};
const empty:RecorderSnapshot={tracks:[],visits:[],activeId:null,busy:false,message:"",storageError:false,fix:null};
const render=(snapshot=empty, selectedId:string|null=null)=>renderToStaticMarkup(<ToastProvider><FootprintsPanel active recorder={null} snapshot={snapshot} loading={false} error="" places={[]} selection={{id:selectedId,date:"",nonce:0}} onSelection={()=>{}} native={native}/></ToastProvider>);
it("makes web footprints a review and import view without recording controls",()=>{
 const html=render();
 expect(html).not.toContain('class="footprint-recorder-options"');
 expect(html).toContain("导入轨迹");
 expect(html).not.toContain("开始记录");
 expect((html.match(/还没有足迹/g)||[])).toHaveLength(1);
 expect(html).not.toContain('id="footprint-date"');expect(html).not.toContain('>轨迹</h2>');expect(html).not.toContain('>到访地点</h2>');
 expect(html).not.toContain("锁屏后暂停");
});
it("keeps live recording controls visible and can still stop the session",()=>{
 const html=render({...empty,activeId:"live",tracks:[{id:"live",name:"实际出行",status:"recording",startedAt:Date.now(),endedAt:null,coordinateSystem:"WGS84",source:"browser",points:[],gaps:[]}]});
 expect(html).toContain('class="footprint-recorder-options" open');expect(html).toContain("暂停");expect(html).toContain("结束");
});

it("does not invent distance or waiting after location permission is denied",()=>{
 const message="定位权限被拒绝，请允许定位后重试。";
 const track={id:"failed",name:"未采到位置",status:"interrupted" as const,startedAt:Date.now(),endedAt:null,coordinateSystem:"WGS84" as const,source:"browser" as const,points:[],gaps:[{time:Date.now(),reason:message}]};
 const html=render({...empty,activeId:"failed",message,tracks:[track]},"failed");
 expect(html).toContain("这段记录尚未采集到位置");
 expect(html).not.toContain("0.00");expect(html).not.toContain("等待位置更新");
 expect(html.split(message).length-1).toBe(1);
});

it("keeps empty historical attempts out of the default archive without deleting them",()=>{
 const track={id:"old-empty",name:"旧的空记录",status:"paused" as const,startedAt:Date.now(),endedAt:null,coordinateSystem:"WGS84" as const,source:"browser" as const,points:[],gaps:[]};
 expect(render({...empty,activeId:track.id,tracks:[track]})).not.toContain("旧的空记录");
 expect(render({...empty,activeId:track.id,tracks:[track]},track.id)).toContain("旧的空记录");
});
it("retains the native automatic-recording entry instead of web manual recording",()=>{
 const html=renderToStaticMarkup(<ToastProvider><FootprintsPanel active recorder={null} snapshot={empty} loading={false} error="" places={[]} selection={{id:null,date:"",nonce:0}} onSelection={()=>{}} native={{...native,available:true}}/></ToastProvider>);
 expect(html).toContain("启用自动足迹");expect(html).not.toContain("开始记录");expect(html).not.toContain("导入已有轨迹");
});

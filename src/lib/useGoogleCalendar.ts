import {useEffect,useRef,useState} from 'react';
import type {CalendarEntry} from './calendarEvents';
export interface GoogleCalendarStatus {configured:boolean;connected:boolean;connectionId?:string|null;calendars?:{id:string;summary:string;primary:boolean}[];selected?:string[];events?:CalendarEntry[];lastSync?:number|null;error?:string;needsReconnect?:boolean;}
export function useGoogleCalendar(owner:string,onSnapshot:(events:CalendarEntry[],connectionId:string,signal:AbortSignal)=>Promise<void>){
  const callback=useRef(onSnapshot);callback.current=onSnapshot;
  const currentOwner=useRef(owner);currentOwner.current=owner;
  const [view,setView]=useState<{owner:string;status:GoogleCalendarStatus|null;error:string}>({owner,status:null,error:''});
  const [busy,setBusy]=useState(false);const generation=useRef(0),controller=useRef<AbortController|null>(null),running=useRef<Promise<void>|null>(null);
  const mutating=useRef(false);
  const refreshRef=useRef<()=>Promise<void>>(async()=>{});
  // Background polling backs off after failures (30s → 10min) so an offline
  // sync service is not hit every 30s; manual refresh is never throttled.
  const failures=useRef(0),pausedUntil=useRef(0);
  useEffect(()=>{
    failures.current=0;pausedUntil.current=0;
    const version=++generation.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;running.current=null;mutating.current=false;setBusy(false);
    const refresh=()=>{
      if(mutating.current)return Promise.resolve();
      if(running.current)return running.current;
      const task=(async()=>{try{const response=await fetch(`/api/calendar/google/status?owner=${encodeURIComponent(owner)}`,{credentials:'same-origin',signal:abort.signal,cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'日历暂时无法同步');if(abort.signal.aborted||version!==generation.current)return;
        if(data.connected&&data.connectionId&&data.lastSync&&data.selected?.length&&!data.error)await callback.current(data.events,data.connectionId,abort.signal);
        if(abort.signal.aborted||version!==generation.current)return;failures.current=0;pausedUntil.current=0;setView({owner,status:data,error:data.error||''});
      }catch(e){if(!abort.signal.aborted&&version===generation.current){failures.current+=1;pausedUntil.current=Date.now()+Math.min(30000*2**failures.current,600000);}if(!abort.signal.aborted&&version===generation.current)setView(previous=>({owner,status:previous.owner===owner?previous.status:null,error:e instanceof Error?e.message:'日历暂时无法同步'}));}})();
      running.current=task;task.finally(()=>{if(version===generation.current)running.current=null;});return task;
    };
    refreshRef.current=refresh;void refresh();const poll=()=>{if(document.visibilityState==='visible'&&Date.now()>=pausedUntil.current)void refresh();};
    const timer=setInterval(poll,30000);
    document.addEventListener('visibilitychange',poll);
    const online=()=>void refresh();window.addEventListener('online',online);
    return()=>{abort.abort();clearInterval(timer);document.removeEventListener('visibilitychange',poll);window.removeEventListener('online',online);};
  },[owner]);
  const action=async(kind:'connect'|'select'|'sync'|'disconnect',body:object={})=>{
    if(mutating.current)return;
    const version=generation.current,abort=controller.current;mutating.current=true;setBusy(true);
    try{if(running.current)await running.current;if(version!==generation.current)return;const response=await fetch(`/api/calendar/google/${kind}?owner=${encodeURIComponent(owner)}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:abort?.signal});const data=await response.json();if(!response.ok)throw new Error(data.error||'日历操作未完成');if(version!==generation.current||currentOwner.current!==owner)return;
      if(kind==='connect'){if(!data.url)throw new Error(data.error||'Google 日历尚未配置');const url=new URL(data.url);if(url.origin!=='https://accounts.google.com')throw new Error('授权地址无效');window.location.assign(url.href);return;}
      if(kind==='disconnect'&&view.status?.connectionId&&abort)await callback.current([],view.status.connectionId,abort.signal);
      mutating.current=false;
      if(version===generation.current)await refreshRef.current();
    }catch(e){if(version===generation.current&&!controller.current?.signal.aborted)setView(previous=>({owner,status:previous.owner===owner?previous.status:null,error:e instanceof Error?e.message:'日历操作未完成'}));}finally{if(version===generation.current){mutating.current=false;setBusy(false);}}
  };
  return {status:view.owner===owner?view.status:null,error:view.owner===owner?view.error:'',busy,action,refresh:()=>refreshRef.current()};
}
export type GoogleCalendarState=ReturnType<typeof useGoogleCalendar>;

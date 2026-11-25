import type { City, ExtractedPlace } from "../types/place";
import { routeAccess } from "../../shared/route-input.mjs";
import { cityKey } from "./citySelection";

export function normalizeAMapTips(tips: unknown, city: City): ExtractedPlace[] {
  if (!Array.isArray(tips)) return [];
  return tips.flatMap(tip => {
    const location=tip?.location;
    const lng=Number(typeof location?.getLng === "function" ? location.getLng() : location?.lng);
    const lat=Number(typeof location?.getLat === "function" ? location.getLat() : location?.lat);
    if(typeof tip?.name!=="string" || !tip.name.trim() || !Number.isFinite(lng)||!Number.isFinite(lat)||Math.abs(lng)>180||Math.abs(lat)>90||(lng===0&&lat===0))return [];
    const district=typeof tip.district==="string"?tip.district:"";
    const address=typeof tip.address==="string"?tip.address:"";
    return [{name:tip.name,city:district?cityKey(district):city.name,category:"custom" as const,source:"imported" as const,isMatched:true,lat,lng,routeAccess:routeAccess({poiId:tip.id}),address:district+address,coordinateSystem:"GCJ02" as const,reason:""}];
  }).slice(0,8);
}

export function searchAMapTips(keyword:string,city:City,signal?:AbortSignal):Promise<ExtractedPlace[]> {
  const key=import.meta.env.VITE_AMAP_KEY as string|undefined;
  if(typeof window==="undefined"||!key)return Promise.reject(new Error("地图输入提示未连接"));
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(error:Error|null,places:ExtractedPlace[]=[])=>{
      if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener("abort",abort);
      if(error)reject(error);else resolve(places);
    };
    const abort=()=>finish(new DOMException("Aborted","AbortError"));
    const timer=setTimeout(()=>finish(new Error("输入提示超时")),2200);
    if(signal?.aborted){abort();return;}
    signal?.addEventListener("abort",abort,{once:true});
    import("@amap/amap-jsapi-loader").then(({default:loader})=>loader.load({key,version:"2.0",plugins:["AMap.AutoComplete"]})).then(AMap=>{
      if(done)return;
      const autocomplete=new AMap.AutoComplete({city:city.name,citylimit:false});
      autocomplete.search(keyword,(status:string,result:{tips?:unknown})=>{
        if(status==="complete")finish(null,normalizeAMapTips(result?.tips,city));
        else if(status==="no_data")finish(null,[]);
        else finish(new Error("输入提示暂不可用"));
      });
    }).catch(()=>finish(new Error("输入提示暂不可用")));
  });
}

import { chinaDeparture, plannedDeparture, routeAccess, routeEndpoint } from '../shared/route-input.mjs';
import { createJourneySuppliers } from './journey-suppliers.mjs';
const accessPoint = value => {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(value)) return undefined;
  const [lng,lat]=value.split(',').map(Number);
  return {lat,lng};
};
const accessOf = poi => routeAccess({poiId:poi.id,citycode:poi.citycode,
  entrance:accessPoint(poi.entr_location),exit:accessPoint(poi.exit_location),
  vehicle:accessPoint(poi.navi_location)});

/** Provider-backed lookup; errors never include credential-bearing request URLs. */
export function createTravelServices({ fetchImpl = fetch, tiandituToken = '', amapKey = '', minRequestIntervalMs = 0 } = {}) {
  let nextRequestAt=0;
  const get = async (url, timeout = 10000, interval = minRequestIntervalMs) => {
    if(interval>0) {
      const now=Date.now(),wait=Math.max(0,nextRequestAt-now);
      nextRequestAt=now+wait+interval;
      if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
    }
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error(response.status === 403 ? '地图服务密钥权限不匹配' : '地图服务暂时不可用');
    return response.json();
  };
  const coordinate = (lat, lng) => {
    if (![lat, lng].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('定位坐标无效');
  };
  const services = {
    async searchPlaces({ keyword, city, count, types, cityLimit = false, includeDistrict = false, requestIntervalMs }) {
      if (!amapKey) throw new Error('地点查询暂不可用');
      const params = new URLSearchParams({key:amapKey, keywords:keyword, city, citylimit:String(cityLimit),
        offset:String(count), page:'1', extensions:'all', output:'JSON'});
      if (types) params.set('types', types);
      const raw = await get('https://restapi.amap.com/v3/place/text?' + params, 3500, requestIntervalMs);
      if (raw?.status !== '1' || !Array.isArray(raw.pois)) {
        const error = new Error('地点查询暂不可用');
        if (String(raw?.infocode) === '10021') error.code = 'AMAP_RATE_LIMIT';
        throw error;
      }
      return raw.pois.slice(0,count).flatMap(poi => {
        const parts = typeof poi.location === 'string' ? poi.location.split(',') : [];
        if (parts.length !== 2 || parts.some(part => !part.trim()) || typeof poi.name !== 'string' || !poi.name.trim()) return [];
        const [lng, lat] = parts.map(Number);
        try { coordinate(lat,lng); } catch { return []; }
        const text = value => typeof value === 'string' ? value : '';
        const routeAccess=accessOf(poi);
        return [{name:poi.name, city:text(poi.cityname)||text(poi.pname), address:text(poi.address)||poi.name, lat, lng,
          ...(routeAccess && {routeAccess}),
          ...(types ? { id:text(poi.id), typecode:text(poi.typecode), district:text(poi.adname) } : includeDistrict ? {district:text(poi.adname)} : {})}];
      });
    },
    async findStations({ city }) {
      if (!amapKey || typeof city !== 'string' || !city.trim()) throw new Error('车站查询暂不可用');
      const params = new URLSearchParams({ key: amapKey, keywords: '火车站', types: '150200', city, citylimit: 'true', offset: '10', page: '1', output: 'JSON' });
      const raw = await get('https://restapi.amap.com/v3/place/text?' + params);
      if (raw.status !== '1' || !Array.isArray(raw.pois)) throw new Error('车站查询暂不可用');
      const candidates = raw.pois.filter(p => p.typecode === '150200' && typeof p.name === 'string' && p.name.endsWith('站') && !/地铁|公交|售票|出站|进站|停车/.test(p.name)).flatMap(p => {
        const [lng, lat] = String(p.location || '').split(',').map(Number);
        try { coordinate(lat, lng); } catch { return []; }
        return [{ id: 'amap:' + p.id, name: p.name, city: p.cityname, citycode: p.citycode, address: p.address, lat, lng, routeAccess:accessOf(p) }];
      }).slice(0, 2);
      return { candidates, observedAt: Date.now(), source: 'amap' };
    },
    async resolvePlace({name,city}) {
      if(!amapKey) throw new Error('地点查询暂不可用');
      const params=new URLSearchParams({key:amapKey,keywords:name,city:city||'',citylimit:'false',offset:'5',output:'JSON'});
      const raw=await get('https://restapi.amap.com/v3/place/text?'+params);
      const canon=s=>String(s||'').replace(/\s|站$/g,'');
      const rows=(raw.pois||[]).filter(p=>canon(p.name)===canon(name));
      if(raw.status!=='1'||rows.length!==1)throw new Error('地点尚未唯一匹配');
      const p=rows[0],[lng,lat]=String(p.location||'').split(',').map(Number);coordinate(lat,lng);
      return {id:'amap:'+p.id,name:p.name,city:p.cityname,citycode:p.citycode,address:p.address,lat,lng,routeAccess:accessOf(p)};
    },
    async findHotels({place,keywords}) {
      coordinate(place.lat, place.lng);
      if (!amapKey) throw new Error('住宿地点查询未配置');
      const params = new URLSearchParams({key:amapKey,location:`${place.lng},${place.lat}`,radius:'3000',types:'100000',sortrule:'distance',offset:'10',page:'1',extensions:'base',output:'JSON'});
      if(keywords)params.set('keywords',keywords);
      let raw;
      try { raw = await get('https://restapi.amap.com/v3/place/around?' + params); }
      catch { throw new Error('住宿地点查询暂不可用'); }
      if (raw.status !== '1' || !Array.isArray(raw.pois)) throw new Error('住宿地点查询暂不可用');
      const candidates = raw.pois.filter(poi=>typeof poi.name==='string' && !/酒店管理|公司$|集团总部|办公室|旅行社|(?:大堂|前台|接待处|停车场|餐厅|咖啡厅|宴会厅|会议室|健身房|泳池|游泳池|充电站|售楼处|[东西南北]门|出入口|入口|出口)$/.test(poi.name)).slice(0,3).flatMap(poi => {
        const [lng,lat] = String(poi.location || '').split(',').map(Number);
        if (!poi.id || typeof poi.name !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180) return [];
        return [{id:`amap:${poi.id}`,name:poi.name,address:String(poi.address || ''),lat,lng,
          near:place.name,city:poi.cityname||place.city,citycode:poi.citycode,source:'amap',url:`https://uri.amap.com/marker?position=${lng},${lat}&name=${encodeURIComponent(poi.name)}`,
          availability:'unknown',quote:null}];
      });
      return {candidates,observedAt:Date.now()};
    },
    async locate({ lat, lng }) {
      coordinate(lat, lng);
      if (!tiandituToken) throw new Error('城市识别服务未配置');
      const [longitude, latitude] = gcjToWgs(lng, lat);
      const params = new URLSearchParams({ postStr: JSON.stringify({ lon: longitude, lat: latitude, ver: 1 }), type: 'geocode', tk: tiandituToken });
      let raw;
      try { raw = await get('https://api.tianditu.gov.cn/geocoder?' + params); }
      catch (e) { throw new Error(e.message === '地图服务密钥权限不匹配' ? e.message : '城市识别暂时不可用'); }
      const components = raw?.result?.addressComponent;
      const city = components?.city || components?.province;
      if (raw.status !== '0' && raw.status !== 0 || typeof city !== 'string' || !city.trim()) throw new Error('未能识别当前城市');
      return { city: city.replace(/市$/, ''), address: raw.result.formatted_address || '', lat, lng,
        source: 'tianditu', observedAt: Date.now() };
    },
    async route({ places, mode = 'driving', departure, plannedAt }) {
      if (!['driving', 'walking', 'transit'].includes(mode)) throw new Error('不支持此交通方式');
      if (departure && mode !== 'transit') throw new Error('此道路接口不支持未来出发时间，不能作为未来路况保证');
      if (!Array.isArray(places) || places.length < 2 || places.length > 12) throw new Error('请选择2至12个地点');
      for (const p of places) coordinate(p?.lat, p?.lng);
      const planned = plannedDeparture(mode === 'transit' ? departure : plannedAt);
      const observedAt=Date.now();
      if (!amapKey) throw new Error('真实路线服务未配置');
      if(mode==='transit' && (places.length!==2 || !planned)) throw new Error('公交查询需要两个地点和明确的出发时间');
      const legs = await Promise.all(places.slice(1).map(async (_, offset) => {
        const i = offset + 1;
        let a = {...places[i-1],...routeEndpoint(places[i-1],mode,'from')};
        let b = {...places[i],...routeEndpoint(places[i],mode,'to')};
        if(mode==='transit') {
          const resolveCity=async p=>{
            if(p.citycode!=null && !(typeof p.citycode==='string' && /^\d{3,4}$/.test(p.citycode)))throw new Error('公交查询需要供应商城市编码');
            if(typeof p.citycode==='string' && /^\d{3,4}$/.test(p.citycode))return p;
            const query=new URLSearchParams({key:amapKey,location:`${p.lng},${p.lat}`,extensions:'base',output:'JSON'});
            let geo;try{geo=await get('https://restapi.amap.com/v3/geocode/regeo?'+query);}catch{throw new Error('公交城市识别失败，请重试');}
            const citycode=geo?.regeocode?.addressComponent?.citycode;
            if(geo.status!=='1'||typeof citycode!=='string'||!/^\d{3,4}$/.test(citycode))throw new Error('公交城市识别失败，请重试');
            return {...p,citycode};
          };
          [a,b]=await Promise.all([resolveCity(a),resolveCity(b)]);
        }
        const params = new URLSearchParams({ key: amapKey, origin: `${a.lng.toFixed(6)},${a.lat.toFixed(6)}`, destination: `${b.lng.toFixed(6)},${b.lat.toFixed(6)}`, show_fields: 'cost,polyline', output: 'JSON' });
        if (a.poiId) params.set(mode === 'transit' ? 'originpoi' : 'origin_id',a.poiId);
        if (b.poiId) params.set(mode === 'transit' ? 'destinationpoi' : 'destination_id',b.poiId);
        if (mode === 'driving') params.set('strategy','32');
        if(mode==='transit') {
          if(![a.citycode,b.citycode].every(c=>typeof c==='string' && /^\d{3,4}$/.test(c))) throw new Error('公交查询需要供应商城市编码');
          const {date,time}=chinaDeparture(planned);
          params.set('city1',a.citycode);params.set('city2',b.citycode);params.set('date',date);params.set('time',time);params.set('strategy','0');
        }
        let raw;
        try { raw = await get('https://restapi.amap.com/v5/direction/' + (mode==='transit'?'transit/integrated':mode) + '?' + params); }
        catch { throw new Error('地图路线查询失败，请重试'); }
        const path = mode==='transit'?raw?.route?.transits?.[0]:raw?.route?.paths?.[0];
        const numeric = value => {
          if (typeof value !== 'number' && !(typeof value === 'string' && value.trim())) return null;
          const number = Number(value);
          return Number.isFinite(number) && number >= 0 ? number : null;
        };
        // v5 cost.duration is the entire itinerary in seconds, including transit waiting.
        const distance = numeric(path?.distance), duration = numeric(path?.cost?.duration);
        if (raw?.status !== '1' || distance === null || duration === null || (distance > 0 && duration === 0))
          throw new Error('地图未返回有效路线');
        const steps = mode==='transit'?(path.segments || []).flatMap(segment=>[...(segment.walking?.steps || []),...(segment.bus?.buslines?.slice(0,1) || [])]):path.steps || [];
        const points = steps.flatMap(s => String(typeof s.polyline==='string'?s.polyline:s.polyline?.polyline || '').split(';').filter(Boolean).map(pair => {
          const parts = pair.split(',');
          if (parts.length !== 2 || parts.some(part => !part.trim())) throw new Error('地图未返回路线形状');
          const [longitude, latitude] = parts.map(Number);
          coordinate(latitude, longitude);
          return { latitude, longitude };
        }));
        if (points.length < 2) throw new Error('地图未返回路线形状');
        const walkingParts=(path.segments || []).filter(segment=>segment.walking).map(segment=>numeric(segment.walking.cost?.duration));
        const walkingDuration=mode==='walking'?duration:mode==='transit' && walkingParts.length>0 && walkingParts.every(v=>v!==null)?walkingParts.reduce((sum,v)=>sum+v,0):null;
        const buses=(path.segments || []).filter(segment=>segment.bus?.buslines?.length).length;
        const fare=numeric(path.cost?.transit_fee);
        return { from:a.name, to:b.name, distance, duration, points, endpointAnchors:[a.anchor,b.anchor],
          instructions: steps.map(step=>step.instruction || step.name).filter(v=>typeof v==='string' && v.trim()).slice(0,80),
          walkingDuration, transfers:mode==='transit'?(buses>0?Math.max(0,buses-1):null):0,
          cost:mode==='transit' && fare!==null?{amount:fare,currency:'CNY',basis:'per_person'}:null };
      }));
      return { mode, source: 'amap', observedAt, plannedDeparture:planned,
        timing:mode === 'transit' ? 'scheduled-transit' : mode === 'driving' ? 'query-time-road' : 'walking', legs,
        distance: legs.reduce((sum, leg) => sum + leg.distance, 0), duration: legs.reduce((sum, leg) => sum + leg.duration, 0) };
    },
  };
  return {...services,...createJourneySuppliers({fetchImpl,resolvePlace:services.resolvePlace})};
}
// Same MIT-licensed transformation used by src/lib/trackCoordinates.ts; see THIRD_PARTY_NOTICES.md.
export function wgsToGcj(lng, lat) {
  if (lng <= 73.66 || lng >= 135.05 || lat <= 3.86 || lat >= 53.55) return [lng, lat];
  const x = lng - 105, y = lat - 35, p = Math.PI;
  const common = (20 * Math.sin(6 * x * p) + 20 * Math.sin(2 * x * p)) * 2 / 3;
  let dy = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x)) + common;
  dy += (20*Math.sin(y*p)+40*Math.sin(y*p/3))*2/3;
  dy += (160*Math.sin(y*p/12)+320*Math.sin(y*p/30))*2/3;
  let dx = 300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x))+common;
  dx += (20*Math.sin(x*p)+40*Math.sin(x*p/3))*2/3;
  dx += (150*Math.sin(x*p/12)+300*Math.sin(x*p/30))*2/3;
  const r=lat*p/180, m=1-.006693421622965943*Math.sin(r)**2;
  return [lng+dx*180/((6378245/Math.sqrt(m))*Math.cos(r)*p),lat+dy*180/((6378245*(1-.006693421622965943)/(m*Math.sqrt(m)))*p)];
}
function gcjToWgs(lng, lat) { let x=lng,y=lat; for(let i=0;i<3;i++){const s=wgsToGcj(x,y);x-=s[0]-lng;y-=s[1]-lat;}return [x,y]; }

import { expect, it, vi } from 'vitest';
// @ts-expect-error Provider module is also consumed directly by the Node server.
import { createTravelServices } from '../../server/travel-services.mjs';
import { gcjToWgs } from '../lib/trackCoordinates';
it('uses a real geocoder response, converts GCJ02 and never substitutes a nearest city', async () => {
  let requested: URL;
  const api = createTravelServices({ tiandituToken: 'private-test-key', fetchImpl: async (url: string) => {
    requested = new URL(url);
    return { ok: true, json: async () => ({ status: '0', result: { addressComponent: { city: '深圳市' }, formatted_address: '深圳市' } }) };
  } });
  const result = await api.locate({ lat: 22.54, lng: 114.05 });
  expect(result.city).toBe('深圳');
  const post = JSON.parse(requested!.searchParams.get('postStr')!);
  const [lng, lat] = gcjToWgs(114.05, 22.54);
  expect(post.lon).toBeCloseTo(lng, 6);
  expect(post.lat).toBeCloseTo(lat, 6);
});
it('does not leak credential-bearing upstream errors', async () => {
  const api = createTravelServices({ tiandituToken: 'secret', fetchImpl: async () => { throw new Error('https://provider?tk=secret'); } });
  await expect(api.locate({ lat: 22.54, lng: 114.05 })).rejects.toThrow('城市识别暂时不可用');
});
it('rejects invalid coordinates and missing route configuration before network access', async () => {
  const fetchImpl = vi.fn();
  const api = createTravelServices({ fetchImpl });
  await expect(api.locate({ lat: NaN, lng: 1 })).rejects.toThrow('坐标');
  await expect(api.route({ places: [{ lat: 1, lng: 2 }, { lat: 2, lng: 3 }] })).rejects.toThrow('未配置');
  expect(fetchImpl).not.toHaveBeenCalled();
});
it('preserves provider travel time and polyline rather than drawing a straight estimated route', async () => {
  const api = createTravelServices({ amapKey: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ status: '1', route: { paths: [{ distance: '1200', cost: { duration: '600' }, steps: [{ polyline: '114.05,22.54;114.06,22.55' }] }] } }) }) });
  const result = await api.route({ places: [{ name: 'A', lat: 22.54, lng: 114.05 }, { name: 'B', lat: 22.55, lng: 114.06 }] });
  expect(result.duration).toBe(600);
  expect(result.legs[0].points[1]).toEqual({ latitude: 22.55, longitude: 114.06 });
});
it('uses hotel POIs for identity only, without inventing quotes, room types or supply', async () => {
  const api = createTravelServices({amapKey:'test',fetchImpl:async () => ({ok:true,json:async () => ({status:'1',pois:[{id:'h1',name:'酒店 A',address:'测试地址',location:'121.4,31.2'}]})})});
  const result = await api.findHotels({place:{name:'会场',lat:31.2,lng:121.4}});
  expect(result.candidates[0].availability).toBe('unknown');
  expect(result.candidates[0].quote).toBeNull();
  expect(result.candidates[0].roomType).toBeUndefined();
  expect(result.candidates[0].url).toMatch(/^https:\/\/uri.amap.com\//);
});
it('queries walking as walking and rejects future driving dates rather than silently ignoring them', async()=>{
  let requested='';
  const api=createTravelServices({amapKey:'test',fetchImpl:async(url:string)=>{requested=url;return {ok:true,json:async()=>({status:'1',route:{paths:[{distance:'500',cost:{duration:'420'},steps:[{polyline:'121.4,31.2;121.41,31.21'}]}]}})};}});
  const places=[{name:'A',lat:31.2,lng:121.4},{name:'B',lat:31.21,lng:121.41}];
  expect((await api.route({places,mode:'walking'})).mode).toBe('walking');
  expect(requested).toContain('/walking?');
  await expect(api.route({places,mode:'driving',departure:'2026-11-02T09:00:00+08:00'})).rejects.toThrow('未来');
});
it('does not interpret missing provider durations as zero-minute journeys',async()=>{
  const api=createTravelServices({amapKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({status:'1',route:{paths:[{distance:'100',cost:{duration:null},steps:[{polyline:'121.4,31.2'}]}]}})})});
  await expect(api.route({places:[{lat:31.2,lng:121.4},{lat:31.21,lng:121.41}]})).rejects.toThrow('有效路线');
});
it('queries transit using provider city codes and Shanghai departure time, preserving fare and transfer units',async()=>{
 let url:URL;
 const api=createTravelServices({amapKey:'test',fetchImpl:async(value:string)=>{url=new URL(value);return {ok:true,json:async()=>({status:'1',route:{transits:[{distance:'3000',cost:{duration:'1800',transit_fee:'5'},segments:[{walking:{cost:{duration:'300'},steps:[{polyline:{polyline:'121.4,31.2;121.41,31.21'}}]},bus:{buslines:[{polyline:{polyline:'121.41,31.21;121.42,31.22'}}]}}]}]}})};}});
 const places=[{name:'A',lat:31.2,lng:121.4,citycode:'021'},{name:'B',lat:31.22,lng:121.42,citycode:'021'}];
 const result=await api.route({places,mode:'transit',departure:'2026-11-02T01:00:00+00:00'});
 expect(url!.pathname).toContain('transit/integrated');expect(url!.searchParams.get('time')).toBe('09:00');
 expect(url!.searchParams.get('city1')).toBe('021');expect(result.duration).toBe(1800);
 expect(result.legs[0]).toMatchObject({walkingDuration:300,transfers:0,cost:{amount:5,currency:'CNY',basis:'per_person'}});
 await expect(api.route({places:places.map(p=>({...p,citycode:'上海'})),mode:'transit',departure:'2026-11-02T09:00:00+08:00'})).rejects.toThrow('城市编码');
});
it('filters hotel lobbies and ancillary facilities before selecting actual lodging candidates',async()=>{
 const pois=[{id:'lobby',name:'洲际酒店-大堂',location:'121.4,31.2'},{id:'parking',name:'洲际酒店停车场',location:'121.4,31.2'},{id:'company',name:'上海某酒店管理有限责任公司',location:'121.4,31.2'},{id:'hotel',name:'洲际酒店',location:'121.41,31.21'}];
 const api=createTravelServices({amapKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({status:'1',pois})})});
 const result=await api.findHotels({place:{name:'会场',city:'上海',lat:31.2,lng:121.4}});
 expect(result.candidates.map((h:any)=>h.name)).toEqual(['洲际酒店']);
});
it('resolves transit city codes from coordinates instead of guessing from the selected UI city',async()=>{
  const urls:string[]=[];
  const api=createTravelServices({amapKey:'test',fetchImpl:async(url:string)=>{urls.push(url);return {ok:true,json:async()=>url.includes('/regeo?')?{status:'1',regeocode:{addressComponent:{citycode:'021'}}}:{status:'1',route:{transits:[{distance:'2400',cost:{duration:'1200',transit_fee:'3'},segments:[{bus:{buslines:[{name:'地铁测试线',polyline:'121.4,31.2;121.41,31.21'}]}}]}]}}};}});
  const result=await api.route({mode:'transit',departure:'2026-11-09T09:00:00+08:00',places:[{name:'A',lat:31.2,lng:121.4},{name:'B',lat:31.21,lng:121.41}]});
  expect(urls.filter(u=>u.includes('/regeo?'))).toHaveLength(2);
  expect(new URL(urls.at(-1)!).searchParams.get('city1')).toBe('021');
  expect(result.legs[0].cost.amount).toBe(3);
});
it('does not substitute guessed city codes when reverse geocoding fails',async()=>{
  const api=createTravelServices({amapKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({status:'1',regeocode:{addressComponent:{citycode:[]}}})})});
  await expect(api.route({mode:'transit',departure:'2026-11-09T09:00:00+08:00',places:[{lat:31.2,lng:121.4},{lat:31.21,lng:121.41}]})).rejects.toThrow('城市识别失败');
});

it('keeps cross-city place results and discards entries with missing coordinates', async () => {
  const fetchImpl = vi.fn(async (_url:string) => ({ok:true,json:async()=>({status:'1',pois:[
    {name:'上海站',cityname:'上海市',location:'121.455,31.249',address:'秣陵路'},
    {name:'无坐标车站',cityname:'上海市',location:'121.455,'},
  ]})}));
  const service = createTravelServices({amapKey:'test',fetchImpl});
  const result = await service.searchPlaces({keyword:'上海站',city:'深圳',count:8});
  expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get('citylimit')).toBe('false');
  expect(result).toEqual([{name:'上海站',city:'上海市',lat:31.249,lng:121.455,address:'秣陵路'}]);
});

it.each(['   ', [], false, 0])('rejects invalid travel times for nonzero distances (%j)', async duration => {
  const api = createTravelServices({amapKey:'test', fetchImpl:async () => ({
    ok:true, json:async () => ({status:'1',route:{paths:[{distance:'2500',cost:{duration},steps:[{polyline:'121,31;121.1,31.1'}]}]}})
  })});
  await expect(api.route({places:[{lat:31,lng:121},{lat:31.1,lng:121.1}]})).rejects.toThrow('有效路线');
});

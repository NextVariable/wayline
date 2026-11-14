import {expect,it,vi,afterEach} from 'vitest';
import {storedPlaceCity} from '../lib/placeCity';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.resetModules();});
it('preserves the administrative city over bank names, university brands and map scope',()=>{
 const known=['北京','上海','广州','深圳','杭州','南京'];
 expect(storedPlaceCity({city:'杭州',name:'上海银行杭州支行',address:'浙江省杭州市',reason:'靠近上海方向'} as any,known,'上海')).toBe('杭州');
 expect(storedPlaceCity({city:'南京',name:'北京某大学南京校区',address:'江苏省南京市'} as any,known,'北京')).toBe('南京');
 expect(storedPlaceCity({city:'昆山市',name:'上海某公司',address:'江苏省苏州市昆山市'} as any,known,'上海')).toBe('昆山');
});
it('uses an explicit address city when the city field is malformed, never a generic district keyword',()=>{
 expect(storedPlaceCity({city:'大疆公司',name:'大疆',address:'广东省深圳市南山区',reason:''} as any,['北京','深圳'],'北京')).toBe('深圳');
 expect(storedPlaceCity({city:'',name:'朝阳国际商务中心',address:'',reason:'北京方向'} as any,['北京','长春'],'长春')).toBe('长春');
});
it('prefers provider city over an ordinary district, and recognizes an explicit county-level city',async()=>{
 vi.stubEnv('VITE_TIANDITU_TOKEN','test-token');vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({pois:[{name:'办公楼甲',adName:'南山区',address:'广东省深圳市南山区',lonlat:'113.9,22.5'},{name:'办公楼乙',cityName:'苏州市',countyName:'昆山市',address:'江苏省苏州市昆山市',lonlat:'120.9,31.3'}]})})));
 const {searchPlaceCandidates}=await import('../lib/geoSearch');const rows=await searchPlaceCandidates('办公楼',{name:'上海',lat:31,lng:121,zoom:11},{aiFallback:false});
 expect(rows.find(p=>p.name==='办公楼甲')?.city).toBe('深圳');expect(rows.find(p=>p.name==='办公楼乙')?.city).toBe('昆山');
});

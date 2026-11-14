/** Candidate names are search queries, never generated coordinates or verified places. */
export function mentionsPlaceName(text,place){
 const compact=v=>String(v||'').replace(/\s/g,'').replace(/（/g,'(').replace(/）/g,')');
 const context=compact(text),name=compact(place.name),city=compact(place.city).replace(/市$/,'');
 if(name&&context.includes(name))return true;
 const plain=name.replace(/\(([^)]+)\)/g,(whole,part)=>part.replace(/市$/,'')===city?'':whole);
 const stem=city&&plain.startsWith(city+'市')?plain.slice(city.length+1):city&&plain.startsWith(city)?plain.slice(city.length):plain;
 return stem.length>=3&&context.includes(stem);
}
export function extractPlaceCandidates(text,fallbackCity=''){
 const cities=['上海','北京','广州','深圳','苏州','杭州','南京','成都','武汉','西安','重庆','天津','香港','长沙','青岛','宁波','厦门','无锡','济南','合肥','郑州'];
 const rows=[];
 for(let clause of String(text).slice(0,12000).split(/[，,。；;\n、]/)){
  if(/(?:不去|不用去|无需去|取消前往|不再前往)/.test(clause))continue;
  if(/^(?:从|最后从|返程|回到|返回)/.test(clause.trim())&&!/开会|会面|拜访|参会/.test(clause))continue;
  const city=cities.find(c=>clause.includes(c))||fallbackCity;
  clause=clause.replace(/^.*?(?:前往|拜访|去|在|到)\s*/,'').replace(/^(?:今天|明天|后天|第[一二三四五六七]天)?\s*(?:20\d\d[-/年]\d{1,2}[-/月]\d{1,2}日?)?\s*/,'');
  if(city)clause=clause.replace(new RegExp('^'+city+'(?:市|的)?'),'');
  const name=clause.split(/(?:\d{1,2}[:：]\d{2}|上午|下午|晚上|早上|开会|会面|参会|参加|出席|拜访客户|住一晚|住宿)/)[0]?.trim();
  if(name&&name.length>=3&&name.length<=80&&city&&/(?:中心|公司|园区|大学|校区|大厦|酒店|宾馆|车站|机场|餐厅|会场|研究院|基地|会馆|广场)(?:[（(][^）)]+[）)])?$/.test(name)&&!rows.some(p=>p.name===name&&p.city===city))rows.push({name,city,source:'imported',isMatched:false,category:'custom'});
 }
 return rows.slice(0,12);
}

import {expect,it} from 'vitest';
import {readRecentPlaceSearches,writeRecentPlaceSearches,addRecentPlaceSearch} from '../lib/recentPlaceSearches';
import {initialUserPlaces} from '../data/userPlaces';
function memory(){const data=new Map<string,string>();return{getItem:(k:string)=>data.get(k)||null,setItem:(k:string,v:string)=>{data.set(k,v);}};}
it('keeps recent searches isolated by workspace and clears only the selected owner',()=>{
 const s=memory(),p=initialUserPlaces[0];writeRecentPlaceSearches('a',[p],s);writeRecentPlaceSearches('b',[p],s);writeRecentPlaceSearches('a',[],s);
 expect(readRecentPlaceSearches('a',s)).toEqual([]);expect(readRecentPlaceSearches('b',s)).toHaveLength(1);
});
it('deduplicates the same location while preserving different branches and bounded history',()=>{
 const p=initialUserPlaces[0],branch={...p,id:'branch',address:'别的地址100号',lat:p.lat+.1};
 expect(addRecentPlaceSearch(p,[p,branch])).toHaveLength(2);
 let list=[] as typeof initialUserPlaces;for(let i=0;i<12;i++)list=addRecentPlaceSearch({...p,id:`p${i}`,name:`地点${i}`,lat:p.lat+i*.01},list);
 expect(list).toHaveLength(6);expect(list[0].name).toBe('地点11');
});
it('ignores malformed storage, invalid places and blocked storage',()=>{
 expect(readRecentPlaceSearches('a',{getItem:()=>'{broken'})).toEqual([]);
 expect(readRecentPlaceSearches('a',{getItem:()=>JSON.stringify([{name:'incomplete'}])})).toEqual([]);
 expect(writeRecentPlaceSearches('a',[],{setItem:()=>{throw Error();}})).toBe(false);
 expect(readRecentPlaceSearches('ssr')).toEqual([]);
});

it('does not preserve an outdated saved flag or guide membership as current ownership',()=>{
 const p={...initialUserPlaces[0],isSaved:true,customGuideNames:['过去的指南']};const recent=addRecentPlaceSearch(p,[]);
 expect(recent[0].isSaved).toBe(false);expect(recent[0].customGuideNames).toEqual([]);expect(p.isSaved).toBe(true);
});

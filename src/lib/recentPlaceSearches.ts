import type { Place } from '../types/place';
import { isStoredPlace } from './placeValidation';
import { samePlace } from './placeIdentity';
const recentCopy=(place:Place):Place=>({...place,isSaved:false,status:'want_to_go',customGuideNames:[],guideCategories:[]});
const browserStorage=()=>typeof window==='undefined'?undefined:window.localStorage;
const key=(owner:string)=>`whereto:recent-place-searches:${owner}`;
export function readRecentPlaceSearches(owner:string,storage?:Pick<Storage,'getItem'>):Place[]{
  try{const raw=JSON.parse((storage??browserStorage())?.getItem(key(owner))||'[]');return Array.isArray(raw)?raw.filter(isStoredPlace).slice(0,6).map(recentCopy):[];}catch{return [];}
}
export function addRecentPlaceSearch(place:Place,previous:Place[]):Place[]{
  return [place,...previous.filter(p=>!samePlace(p,place))].filter(isStoredPlace).slice(0,6).map(recentCopy);
}
export function writeRecentPlaceSearches(owner:string,places:Place[],storage?:Pick<Storage,'setItem'>):boolean{
  try{(storage??browserStorage())!.setItem(key(owner),JSON.stringify(places));return true;}catch{return false;}
}

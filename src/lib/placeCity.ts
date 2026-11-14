import type {CityName,Place} from '../types/place';
import {canonicalPoiCity} from './geoSearch';
/** A bank or campus name does not override a provider/user-supplied administrative city. */
export function storedPlaceCity(place:Place,knownCities:CityName[],fallback:CityName):CityName {
  const valid=(value:string)=>!!value&&value.length<=24&&!/公司|大学|学院|中心|酒店|园区|商场|候选|未知|全部|跨城市/.test(value);
  const explicit=canonicalPoiCity(String(place.city||'').trim());
  if(valid(explicit))return explicit;
  if(/市/.test(place.address||'')){
    const addressCity=canonicalPoiCity(place.address.trim());if(valid(addressCity))return addressCity;
  }
  const found=knownCities.filter(c=>place.address?.startsWith(c+'市'));
  return found.length===1?found[0]:fallback;
}

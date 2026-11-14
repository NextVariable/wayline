import {expect,it,vi} from "vitest";
// @ts-expect-error server module
import {validateHotelRecheck,createJourneySuppliers,readLuggagePolicy,readTrainSeatOptions} from '../../server/journey-suppliers.mjs';
import {normalizeJoint} from '../lib/plannerEvidence';
const t=(day:number,clock:string)=>`2026-11-0${day}T${clock}:00+08:00`;
const p=(name:string)=>({name,city:'上海',lat:31,lng:121});
const hotels=[{...p('酒店甲'),id:'hotel-a'},{...p('酒店乙'),id:'hotel-b'}];
it('checks exact rate/date/occupancy/allotment/currency before exposing a room quote',()=>{
 const q={check_in_date:'2026-11-02',check_out_date:'2026-11-03',rate_code:'r1',adults:2,room_count:2};
 const rate={rateCode:'r1',currencyCode:'CNY',isOnRequest:false,totalPrice:500,allotment:2,maxOccupancy:2,dailyPrices:[{stayDate:'2026-11-02'}]};
 const raw={room_types:[{rateInfos:[rate]}]};expect(validateHotelRecheck(raw,q)).toEqual({amount:null});expect(validateHotelRecheck(raw,{...q,room_count:1})).toEqual({amount:500});
 for(const patch of [{rateCode:'other'},{currencyCode:'USD'},{isOnRequest:true},{allotment:1},{maxOccupancy:1},{dailyPrices:[]},{totalPrice:-1}])expect(validateHotelRecheck({room_types:[{rateInfos:[{...rate,...patch}]}]},q)).toBeNull();
});
it('keeps public hotel transport failure and mixed room occupancy unknown',async()=>{
 const fetchImpl=vi.fn(async()=>{throw Error('secret')});const svc=createJourneySuppliers({fetchImpl});
 await expect(svc.hotelOffer({hotel:hotels[0],checkIn:'2026-11-02',checkOut:'2026-11-03',travelers:3,rooms:2,roomType:'twin'})).rejects.toThrow('每间入住人数');expect(fetchImpl).not.toHaveBeenCalled();
});
it('reads luggage facilities without inventing free storage, opening hours or post-checkout permission',()=>{
 const policy=readLuggagePolicy({hotel:{amenities:['免费停车','行李寄存服务'],policies:['退房时间12:00']}});
 expect(policy.status).toBe('listed');expect(policy.text).toBe('行李寄存服务');expect(policy.fee).toBeNull();expect(policy.hours).toBeNull();expect(readLuggagePolicy(null).status).toBe('unknown');
});
it('retains queried seat counts and fares without inventing numbers for 有 or 候补',()=>{
 expect(readTrainSeatOptions({prices:[{seat_name:'二等座',num:'8',price:66},{seat_name:'一等座',num:'有',price:88},{seat_name:'硬座',num:'0',price:33},{seat_name:'商务座',num:'候补',price:NaN}]})).toEqual([
  {name:'二等座',count:8,price:66,status:'available'},{name:'一等座',count:null,price:88,status:'available'},{name:'硬座',count:0,price:33,status:'unavailable'},{name:'商务座',count:null,price:null,status:'unknown'}]);
 expect(readTrainSeatOptions({prices:[null,{seat_name:{bad:true},num:'10'}, {seat_name:'二等座',num:'-1',price:-5}]})).toEqual([{name:'二等座',count:null,price:null,status:'unknown'}]);
});
it('removes malformed seat observations before rendering',()=>{
 const joint=normalizeJoint({status:'conditional',plans:[],railOptions:[{number:'G101',origin:'A',destination:'B',direction:'outbound',departure:t(2,'08:00'),checkedAt:new Date().toISOString(),seatOptions:[{name:'bad',price:{bad:true},count:8,status:'available'}]}, {number:'G2',departure:'invalid',checkedAt:'invalid',direction:'return',seatOptions:[]}]});
 expect(joint!.railOptions).toHaveLength(1);expect(joint!.railOptions![0].seatOptions).toEqual([]);
});

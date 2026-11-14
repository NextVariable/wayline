import {expect,it,vi} from 'vitest';
// @ts-expect-error server
import {readLuggagePolicy,readHotelTerms,createJourneySuppliers} from '../../server/journey-suppliers.mjs';
import {normalizeHotelTerms} from '../lib/plannerEvidence';
it('reads actual provider amenities_hotel/descriptions without inventing hours or post-checkout permission',()=>{
 const p=readLuggagePolicy({hotel:{amenities_hotel:[{id:'4003',name:'Luggage storage'}],descriptions:{BusinessAmenities:'Luggage storage'}}});
 expect(p.status).toBe('listed');expect(p.hours).toBeNull();expect(p.fee).toBeNull();
});
it('keeps cancellation deadlines, property hours and deposits separate from room price',()=>{
 const terms=readHotelTerms({hotel:{checkin:{begin_time:'12:00 PM',end_time:'midnight',special_instructions:'Contact property in advance'},checkout:{time:'12:00 PM'},fees:{mandatory:'<p>Deposit: CNY 500</p>'}}},{cancellation_policy:{type:'free_cancel_before_deadline',free_cancel_deadline:'2026-11-01T06:00:00+08:00',effective_non_refundable:false},meal_count:2});
 expect(terms).toMatchObject({checkIn:'12:00',checkOut:'12:00',cancellation:{kind:'free_before',deadline:'2026-11-01T06:00:00+08:00'},meals:2});expect(terms.propertyFeeNotice).toContain('Deposit: CNY 500');expect(JSON.stringify(terms)).not.toContain('<p>');
 expect(readHotelTerms(null,{cancellation_policy:{type:'non_refundable',effective_non_refundable:true}}).cancellation.kind).toBe('non_refundable');
 expect(readHotelTerms(null,null).cancellation.kind).toBe('unknown');
});
it('does not select a non-refundable room when the traveller requires free cancellation',async()=>{
 const fetchImpl=vi.fn(async(url:string)=>({ok:true,text:async()=>JSON.stringify({ok:true,data:url.endsWith('query_room_rates')?{room_types:[{name_cn:'行政双床房',products:[{max_occupancy:2,cancellation_policy:{type:'non_refundable',effective_non_refundable:true},rate:{currency:'CNY',is_on_request:false,rate_code:'nonrefund',total_price:500}}]}]}:{hotel:{}}})}));
 const service=createJourneySuppliers({fetchImpl});const offer=await service.hotelOffer({hotel:{name:'酒店甲',supplierId:'id'},checkIn:'2026-11-02',checkOut:'2026-11-03',travelers:2,rooms:1,roomType:'twin',freeCancellationRequired:true});
 expect(offer.quote).toBeNull();expect(offer.availability).not.toBe('available');expect(fetchImpl.mock.calls.some(([u])=>u.endsWith('check_room_availability'))).toBe(false);
});
it('removes malformed hotel terms from saved plans before they reach the UI',()=>{
 const terms=normalizeHotelTerms({cancellation:{kind:'free_before',deadline:'not a date'},meals:-1,checkIn:'30:99',propertyFeeNotice:'x'.repeat(351)});
 expect(terms).toMatchObject({cancellation:{kind:'unknown'},meals:null,checkIn:null,propertyFeeNotice:null});
});
it('retries one transient read outage but does not retry long rate limits or failed input',async()=>{
 const success={ok:true,text:async()=>JSON.stringify({ok:true,data:{hotels:[]}})};
 const fetchImpl=vi.fn().mockResolvedValueOnce({ok:false,status:503}).mockResolvedValue(success);
 await createJourneySuppliers({fetchImpl}).discoverHotels({place:{name:'会场',city:'上海'}});expect(fetchImpl).toHaveBeenCalledTimes(2);
 for(const response of [{ok:false,status:400},{ok:false,status:429,headers:{get:()=> '60'}}]){
  const fail=vi.fn(async()=>response);await expect(createJourneySuppliers({fetchImpl:fail}).discoverHotels({place:{name:'会场',city:'上海'}})).rejects.toThrow();expect(fail).toHaveBeenCalledOnce();
 }
});

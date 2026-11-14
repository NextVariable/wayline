import {it,expect} from 'vitest';
import {validPlannerDraft} from '../lib/savedTrips';
it('keeps old saved trips readable while rejecting malformed new departure and preference fields',()=>{
 const d={date:'2026-11-02',days:'2',notes:'会议',preferences:['省时间']};
 expect(validPlannerDraft(d)).toBe(true);
 expect(validPlannerDraft({...d,departureName:{},earliestDeparture:'09:00'})).toBe(false);
 expect(validPlannerDraft({...d,earliestDeparture:'25:00'})).toBe(false);
 expect(validPlannerDraft({...d,nightlyBudget:'600.50',hotelGroup:'huazhu'})).toBe(true);
 expect(validPlannerDraft({...d,nightlyBudget:'-10'})).toBe(false);
});
it('rejects a saved party with more rooms than travellers',()=>{
 expect(validPlannerDraft({date:'',days:'2',notes:'',preferences:[],party:{travelers:2,rooms:1,roomType:'twin'}})).toBe(true);
 expect(validPlannerDraft({date:'',days:'2',notes:'',preferences:[],party:{travelers:1,rooms:2,roomType:'twin'}})).toBe(false);
});

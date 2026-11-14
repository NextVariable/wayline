export type CommuteMode = 'driving' | 'walking' | 'transit';
type Point = {id?:string;name:string;lat:number;lng:number};
export function commuteKey(from:Point,to:Point):string;
export function activeCommuteChoices(choices:unknown,places:Point[]):Record<string,CommuteMode>;

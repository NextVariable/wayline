export interface IntentPlaceCandidate {
  name:string; city:string; source:'imported'; isMatched:false; category:'custom';
}
export function extractPlaceCandidates(text:string,fallbackCity?:string):IntentPlaceCandidate[];
export function mentionsPlaceName(text:string,place:{name:string;city?:string}):boolean;

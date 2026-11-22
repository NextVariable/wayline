import { readFile } from 'node:fs/promises';
import { createCalendarPlaceResolver, normalizeLocationText } from '../server/calendar-places.mjs';
import { createTravelServices } from '../server/travel-services.mjs';

const key=process.env.AMAP_WEB_SERVICE_KEY;
if (!process.argv.includes('--live') || !key)
  throw new Error('Requires --live and an authorized staging AMAP_WEB_SERVICE_KEY');
const samples=JSON.parse(await readFile(new URL('../tests/fixtures/public-calendar-pois.json',import.meta.url),'utf8'));
const provider=createTravelServices({amapKey:key,minRequestIntervalMs:1200});
const resolver=createCalendarPlaceResolver({searchPlaces:request=>provider.searchPlaces({...request,includeDistrict:true})});
const counts={verifiedAddress:0,review:0,ambiguous:0,unavailable:0};
for (const sample of samples) {
  const [row]=await resolver.resolve([{text:sample.query,city:sample.city}]);
  let grade;
  if (row.status==='found') {
    const normalized=normalizeLocationText(row.place.address);
    const hasAddress=normalized.includes(normalizeLocationText(sample.street));
    const hasName=normalizeLocationText(row.place.name)===normalizeLocationText(sample.acceptableName);
    grade=sample.expected==='found' && hasAddress && hasName ? 'verifiedAddress' : 'review';
  } else {
    grade=row.status==='ambiguous'?'ambiguous':'unavailable';
  }
  counts[grade]++;
  console.log(JSON.stringify({id:sample.id,category:sample.category,observedStatus:row.status,grade,
    ...(row.status==='found' && {place:row.place})}));
}
console.log(JSON.stringify({mode:'real Amap',timestamp:new Date().toISOString(),counts,note:'Review coordinates and permitted map usage before sign-off.'}));

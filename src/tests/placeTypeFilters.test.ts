import { expect, it } from "vitest";
import { getCitiesPlacesByType } from "../lib/guideFilters";
import { initialUserPlaces } from "../data/userPlaces";
it("filters actual place type independently of guide membership and visit state", () => {
  const base = initialUserPlaces[0];
  const station = {...base,id:"station",city:"上海",category:"transport" as const,guideCategories:["business" as const],status:"visited" as const};
  const office = {...base,id:"office",city:"上海",category:"business" as const,guideCategories:["transport" as const]};
  const otherCity = {...station,id:"other",city:"北京"};
  expect(getCitiesPlacesByType([station,office,otherCity],["上海"],"transport").map(p=>p.id)).toEqual(["station"]);
  expect(getCitiesPlacesByType([station,office],["上海"],"business").map(p=>p.id)).toEqual(["office"]);
});

import { expect, it, vi } from "vitest";
// @ts-expect-error The server module runs directly in Node.
import { createBusinessTripOptions } from "../../server/business-trip-options.mjs";
const now = () => Date.parse("2026-11-13T08:00:00+08:00");
const stamp = (clock: string) => "2026-11-14T" + clock + ":00+08:00";
const area = { name:"办公区", lat:31.23, lng:121.47 };
it("distinguishes unsupported cities from service failure without calling providers", async () => {
  const findTrains = vi.fn(), findFlights = vi.fn(), resources = vi.fn();
  const options = createBusinessTripOptions({now, services:{findTrains,findFlights}, resources});
  expect(await options({kind:"transport",from:"上海",to:"新加坡",date:"2026-11-14"}))
    .toEqual({options:[],railState:"unsupported",flightState:"unsupported"});
  expect(await options({kind:"stay",city:"新加坡",anchors:[area]})).toEqual({areaState:"unsupported"});
  expect(findTrains).not.toHaveBeenCalled();
  expect(findFlights).not.toHaveBeenCalled();
  expect(resources).not.toHaveBeenCalled();
});
it("returns only timetable options inside the meeting window, from supported providers", async () => {
  const findTrains = vi.fn(async () => ({candidates:[
    {number:"G1",departure:stamp("07:00"),arrival:stamp("10:00")},
    {number:"G2",departure:stamp("09:00"),arrival:stamp("11:30")},
  ]}));
  const findFlights = vi.fn(async () => ({candidates:[{number:"MU1234", departure:stamp("08:00"), arrival:stamp("10:15")}]}));
  const options = createBusinessTripOptions({now, services:{findTrains,findFlights}});
  const result = await options({kind:"transport",from:"深圳",to:"上海",date:"2026-11-14",before:stamp("12:00")});
  expect(result.options).toMatchObject([{number:"G1",bookingUrl:"https://www.12306.cn/"},{number:"MU1234",bookingUrl:"https://www.ceair.com/"}]);
  const tighter = await options({kind:"transport",from:"苏州",to:"上海",date:"2026-11-14",before:stamp("12:00"),buffer:120});
  expect(tighter.options.map((option: { number: string }) => option.number)).toEqual(["G1"]);
  await options({kind:"transport",from:"苏州",to:"上海",date:"2026-11-14",before:stamp("12:00")});
  expect(findFlights).toHaveBeenCalledTimes(1);
});
it("requires real route evidence from every anchor and never looks for hotels", async () => {
  const route = vi.fn(async ({places}) => {
    if(places[0].name==="未知") throw Error("no route");
    return {observedAt:now(),legs:[{duration:1200}]};
  });
  const options = createBusinessTripOptions({now, services:{route},resources:async()=>({places:[area,{...area,name:"未知"},{...area,name:"会展中心"}]})});
  expect(await options({kind:"stay",city:"上海",anchors:[{...area,name:"活动"}]})).toMatchObject({area:{place:area,minutes:20,count:1}});
  expect(route).toHaveBeenCalledTimes(2);
});

import { expect, it } from "vitest";
// @ts-expect-error Node server modules run directly as ESM
import { readFlightOffers } from "../../server/flight-supply.mjs";

const date = "2032-11-16";
const time = (clock:string) => date + "T" + clock + ":00+08:00";
const flight = {number:"MU5350",from:"SZX",to:"SHA",departure:time("10:00"),arrival:time("12:00")};

it("takes only exact-date direct airport segments and leaves ambiguous prices out of total",()=>{
  const item = (day:string) => ({
    ticketPrice:"550.00",jumpUrl:"https://router.feizhu.com/ws/test",
    journeys:[{journeyType:"直达",segments:[{marketingTransportNo:flight.number,
      transportType:"飞机",seatClassName:"经济舱",depStationCode:"SZX",arrStationCode:"SHA",
      depDateTime:day+" 10:00:00",arrDateTime:day+" 12:00:00"}]}],
  });
  const output = readFlightOffers({data:{itemList:[item(date),item("2032-11-17"),null]}},
    {origin:"深圳",destination:"上海",date},Date.parse(time("06:00")));
  expect(output.candidates).toHaveLength(1);
  expect(output.candidates[0]).toMatchObject({...flight,referencePrice:550,totalPrice:null});
});

import { useEffect, useRef, useState } from "react";
import { safeExternalUrl } from "../lib/externalUrl";
import { cityKey } from "../lib/citySelection";
import type { Place } from "../types/place";
import { bookingPlaceKey } from "../lib/useBookingPlaces";
import type { OrderPoint, StayNight, TravelGap, TripBooking } from "../lib/businessOrders";
import type { BusinessTrip } from "../lib/businessTrips";
import { fetchRoute, type LegResult } from "../lib/useTodayLegs";
import type { TripTransfer } from "../lib/tripTransfers";
import { localDateKey } from "../lib/todayMap";

interface Option { kind:"rail"|"flight"; number:string; from:string; to:string; departure:string; arrival:string; source:string; checkedAt:string; bookingUrl:string|null }
interface Recommendation {
  options?: Option[]; railState?: string; flightState?: string; areaState?: "unsupported";
  area?: { place: Place; minutes:number; count:number; checkedAt:string } | null;
}
const time = new Intl.DateTimeFormat("zh-CN", {timeZone:"Asia/Shanghai", hour:"2-digit", minute:"2-digit", hourCycle:"h23"});
/**
 * M1 product scope: train/flight purchase lookups and hotel-area suggestions
 * are removed from the user flow. Booked orders keep rendering below.
 */
const RECOMMENDATIONS_VISIBLE: boolean = false;
const when = (value: string) => time.format(new Date(value));
const date = (value: string) => value.slice(5).replace("-", "/");
const routeLabel = (leg: TravelGap) => leg.from + " → " + leg.to;

function RecommendationAction({ label, input, children }: {
  label: string; input: object; children: (value: Recommendation) => React.ReactNode;
}) {
  const [result, setResult] = useState<Recommendation>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [controller, setController] = useState<AbortController>();
  useEffect(() => () => controller?.abort(), [controller]);
  const run = async () => {
    const request = new AbortController();
    setController(request);
    setBusy(true); setFailed(false);
    try {
      const response = await fetch("/api/business-trip/options", { method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify(input), signal:request.signal });
      if (!response.ok) throw new Error();
      setResult(await response.json() as Recommendation);
    } catch { if (!request.signal.aborted) setFailed(true); }
    finally { if (!request.signal.aborted) setBusy(false); }
  };
  return <>
    {result && children(result)}
    {(!result || result.railState === "unavailable" || result.flightState === "unavailable" || result.area === null) && <button className="text-action" type="button" disabled={busy} onClick={() => void run()}>
      {busy ? "查询中…" : failed ? "查询失败，重试" : result ? "重新查询" : label}
    </button>}
  </>;
}
function TransportOptions({ leg }: {leg: TravelGap}) {
  const [buffer, setBuffer] = useState(60);
  return <>
    <details className="transport-window">
      <summary>{leg.before ? `提前 ${buffer}–${buffer+120} 分钟到站` : `活动结束后至少 ${buffer} 分钟发车`}</summary>
      <label>接驳预留 <select value={buffer} onChange={event => setBuffer(Number(event.target.value))}>
        {[30, 45, 60, 90, 120].map(minutes => <option key={minutes} value={minutes}>{minutes} 分钟</option>)}
      </select></label>
    </details>
    <RecommendationAction key={buffer} label="查车次和航班" input={{kind:"transport", from:leg.from, to:leg.to, date:leg.date, after:leg.after, before:leg.before, buffer}}>
      {value => <>
        {!!value.options?.length && <><small>时刻参考 · 余票以购票页为准</small><ul>{value.options.map(option => {
          const bookingUrl = safeExternalUrl(option.bookingUrl);
          return <li key={option.kind+option.number+option.departure}>
          <strong>{option.number}</strong> {option.from} → {option.to}
          <small>{when(option.departure)} 出发 · {when(option.arrival)} 到达</small>
          <small>{leg.before ? `约提前 ${Math.floor((Date.parse(leg.before)-Date.parse(option.arrival))/60000)} 分钟到达` :
            `约在活动后 ${Math.floor((Date.parse(option.departure)-Date.parse(leg.after!))/60000)} 分钟出发`} · {option.source.startsWith("12306") ? "12306 参考" : option.source}</small>
          {bookingUrl && <a className="text-action" href={bookingUrl} target="_blank" rel="noreferrer">{option.kind === "rail" ? "打开 12306" : "查看购票入口"}</a>}
        </li>; })}</ul></>}
        {value.railState === "outside" && <p>车票尚未进入预售期</p>}
        {value.railState === "unsupported" && <p>这条线路暂未覆盖车次查询</p>}
        {value.railState === "unavailable" && <p>车次暂时无法查询</p>}
        {value.flightState === "unsupported" && <p>航班查询仅支持深圳往返上海</p>}
        {value.flightState === "unavailable" && <p>航班暂时无法查询</p>}
        {!value.options?.length && (value.railState === "empty" || value.flightState === "empty") && <p>未查到符合时间的班次</p>}
      </>}
    </RecommendationAction>
  </>;
}
function TransferLookup({ transfer, onTransfer }: {transfer:TripTransfer; onTransfer:(key:string,route:LegResult|null)=>void}) {
  const pending=useRef<AbortController|null>(null);
  const [state,setState]=useState<"ready"|"loading"|"failed"|"found">("ready");
  useEffect(()=>()=>pending.current?.abort(),[]);
  const run=async()=>{
    if (pending.current) return;
    const request=new AbortController();
    pending.current=request;
    setState("loading");
    onTransfer(transfer.key,null);
    const route=await fetchRoute([transfer.from,transfer.to],"driving",transfer.departure,{signal:request.signal});
    if (request.signal.aborted) return;
    pending.current=null;
    onTransfer(transfer.key,route);
    setState(route?"found":"failed");
  };
  const label=transfer.kind==="arrive-before"?"查到站后接驳":"查出发前接驳";
  return <div className="trip-transfer-lookup">
    <button type="button" className="text-action" disabled={state==="loading"} onClick={()=>void run()}>
      {state==="loading"?"正在查接驳…":state==="failed"?"重试接驳查询":state==="found"?"更新接驳参考":label}
    </button>
    {state==="failed" && <small role="status">高德暂未返回有效路线</small>}
    {state==="found" && <small role="status">接驳参考已更新，见行程待确认</small>}
  </div>;
}

export function BusinessTripConnections({ trip, legs, nights, places, onPlace, onArea, transfers = [], onTransfer }: {
  trip: BusinessTrip; legs: TravelGap[]; nights: StayNight[]; places: Record<string, Place>;
  transfers?:TripTransfer[]; onTransfer:(key:string,route:LegResult|null)=>void;
  onPlace: (place: Place) => void; onArea: (place: Place) => void;
}) {
  const renderPoint = (point: OrderPoint) => {
    const place = point.place ?? places[bookingPlaceKey(point)];
    return place ? <button type="button" className="text-action" onClick={() => onPlace(place)}>{point.name}</button> : <span>{point.name}</span>;
  };
  const orderRow = (order: TripBooking) => <li key={order.id}>
    <strong>{order.number ?? "住宿"}</strong>{" "}{order.from && <>{renderPoint(order.from)} → </>}{renderPoint(order.to)}
    {order.kind !== "stay" && <small>{when(order.start)} 出发{order.end && ` · ${when(order.end)} 到达`}</small>}
    <small className="source-tag">{order.source}{order.state && order.state !== "confirmed" ? " · 待核对" : ""}</small>
  </li>;
  return <section className="business-trip-connections" aria-label="交通与住宿">
    <h2>交通与住宿</h2>
    {legs.map((leg, index) => {
      const status = index === 0 ? "去程" : index === legs.length-1 ? "返程" : "城际接驳";
      const active = leg.orders.some(order => !order.state || order.state === "confirmed");
      return <section key={leg.id} data-trip-segment={leg.id} className="business-trip-day">
        <header><h3>{routeLabel(leg)}</h3><small>{date(leg.date)} · {status}{active ? "已有安排" : leg.orders.length ? "待核对" : "未定"}</small></header>
        {leg.orders.length > 0 && <ul>{leg.orders.map(orderRow)}</ul>}
        {transfers.filter(transfer=>transfer.segmentId===leg.id).map(transfer=>
          <TransferLookup key={transfer.key} transfer={transfer} onTransfer={onTransfer} />)}
        {RECOMMENDATIONS_VISIBLE && !active && leg.date >= localDateKey(new Date()) && <TransportOptions key={JSON.stringify([leg.date,leg.before,leg.after])} leg={leg} />}
      </section>;
    })}
    {nights.map(night => {
      const events = trip.days.filter(day => day.date === night.date || day.date > night.date).slice(0,2)
        .flatMap(day => day.events).filter(event => cityKey(event.place.city) === night.city);
      const nearbyStations = legs.flatMap(leg => leg.orders).flatMap(order => [order.from, order.to])
        .filter((point): point is OrderPoint => !!point?.city && cityKey(point.city) === night.city)
        .map(point => point.place ?? places[bookingPlaceKey(point)]).filter((place): place is Place => !!place);
      const candidates = [...events.map(event => event.place), ...nearbyStations];
      const anchors = candidates.filter((place, index) => candidates.findIndex(item => item.lat === place.lat && item.lng === place.lng) === index).slice(0,3);
      return <section key={night.date} data-trip-segment={`stay:${night.date}:${night.city}`} className="business-trip-day">
        <header><h3>{date(night.date)} · {night.city}</h3><small>{night.orders.some(order => !order.state || order.state === "confirmed") ? "已有住宿安排" : night.orders.length ? "住宿待核对" : "住宿未定"}</small></header>
        {night.orders.length > 0 && <ul>{night.orders.map(orderRow)}</ul>}
        {RECOMMENDATIONS_VISIBLE && !night.orders.some(order => !order.state || order.state === "confirmed") && night.date >= localDateKey(new Date()) && anchors.length > 0 &&
          <RecommendationAction key={JSON.stringify(anchors.map(p=>[p.id,p.lat,p.lng]))} label="看住哪一带" input={{kind:"stay", city:night.city, anchors}}>
            {value => value.area ? <div>
              <button type="button" className="text-action" onClick={() => onArea(value.area!.place)}>{value.area.place.name}附近 · 地图</button>
              <small>到本次核对的 {value.area.count} 个地点，最长驾车约 {value.area.minutes} 分钟 · 高德 {when(value.area.checkedAt)} 查询</small>
            </div> : <p>{value.areaState === "unsupported" ? "这座城市暂未覆盖住宿区域推荐" : "暂时没有查到可比较的住宿区域"}</p>}
          </RecommendationAction>}
      </section>;
    })}
  </section>;
}

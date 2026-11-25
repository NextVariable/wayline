import type { Trip } from "../lib/tripDomain";

const timeLabel = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

/** A booking row shared by the Trips and History timelines. */
export function TripBookingRow({ order, now = Date.now() }: { order: Extract<Trip["timeline"][number], { kind: "booking" }>["booking"]; now?: number }) {
  const state = order.state === "cancelled" ? "收到取消通知" : order.state === "changed" ? "收到改签通知" :
    order.state === "review" ? "待核对" : !!order.end && Date.parse(order.end) < now ? "时段已过" : order.source === "日历" ? "日历安排" : "订单记录";
  const source = order.provenance?.some(item => item.source === "gmail") && order.provenance.some(item => item.source !== "gmail")
    ? "日历 / Gmail" : order.source;
  return (
    <li className="timeline-item is-booking trip-order-row" data-state={order.state ?? "confirmed"}>
      <span className="tl-time">{order.start.length === 10 ? "住宿" : timeLabel.format(new Date(order.start))}</span>
      <span className="tl-rail" aria-hidden="true" />
      <span className="tl-body">
        <strong>{[order.number, order.from?.name, order.to.name].filter(Boolean).join(" · ")}</strong>
        <small className="trip-order-state" data-state={order.state ?? "confirmed"}>{state} · {source}</small>
      </span>
    </li>
  );
}

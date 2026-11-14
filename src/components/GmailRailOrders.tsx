import { TrainFront } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GmailBooking } from "../lib/businessOrders";
import type { CalendarEntry } from "../lib/calendarEvents";
import { userFacingError } from "../lib/userFacingError";

interface RailOrder {
  id: string;
  train: string;
  origin: string;
  destination: string;
  departAt: string;
  arriveAt?: string;
}
interface Mailbox {
  enabled: boolean;
  connected: boolean;
  lastSync: number | null;
  partial: boolean;
  singleSample?: boolean;
  sampleRead?: boolean;
  orders: RailOrder[];
  bookings?: GmailBooking[];
  reviewCount: number;
}

const departureFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});
const syncTime = new Intl.DateTimeFormat("zh-CN", {hour:"2-digit", minute:"2-digit", hour12:false});
const minutes = (value: string) => Math.floor(Date.parse(value) / 60_000);

export function hasCalendarRailOrder(order: RailOrder, events: CalendarEntry[]) {
  return events.some(event => !event.allDay && !event.google?.stale &&
    event.title.toUpperCase().split(/[^A-Z0-9]+/).includes(order.train) &&
    minutes(event.start) === minutes(order.departAt));
}

async function request(action: "status" | "start" | "sync" | "enable-sync" | "disconnect", signal?: AbortSignal) {
  const response = await fetch(`/api/auth/gmail/${action}`, {
    cache: "no-store", signal, ...(action !== "status" && {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || "Gmail 暂时不可用"), { status: response.status });
  return data;
}

export function GmailRailOrders({ email, events }: { email: string; events: CalendarEntry[] }) {
  const [mailbox, setMailbox] = useState<Mailbox>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reconnect, setReconnect] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const pending = new AbortController();
    controller.current = pending;
    void (async () => {
      try {
        const status: Mailbox = await request("status", pending.signal);
        if (pending.signal.aborted) return;
        setMailbox(status);
        if (!status.connected || status.lastSync && Date.now() - status.lastSync < 15 * 60_000) return;
        setBusy(true);
        const fresh: Mailbox = await request("sync", pending.signal);
        if (!pending.signal.aborted) { setMailbox(fresh); window.dispatchEvent(new Event("wayline:gmail-change")); }
      } catch (issue) {
        if (!pending.signal.aborted) {
          setError(userFacingError(issue, "Gmail 暂时不可用"));
          setReconnect((issue as { status?: number })?.status === 401);
        }
      } finally {
        if (!pending.signal.aborted) setBusy(false);
      }
    })();
    return () => { pending.abort(); };
  }, []);

  const run = async (action: "start" | "sync" | "enable-sync" | "disconnect") => {
    const signal = controller.current?.signal;
    setBusy(true);
    setError("");
    try {
      const data = await request(action, signal);
      if (signal?.aborted) return;
      if (action === "start") {
        const url = new URL(data.url);
        if (url.origin !== "https://accounts.google.com") throw new Error("Gmail 授权地址无效");
        window.location.assign(url.href);
        return;
      }
      setMailbox(data);
      window.dispatchEvent(new Event("wayline:gmail-change"));
      setReconnect(false);
      setConfirmDisconnect(false);
    } catch (issue) {
      if (!signal?.aborted) {
        setError(userFacingError(issue, "Gmail 操作未完成"));
        if ((issue as { status?: number })?.status === 401) setReconnect(true);
      }
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  };

  if (!mailbox?.enabled) return null;
  const orders = mailbox.orders.filter(order => !hasCalendarRailOrder(order, events));
  const gmailSearch = `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#search/${encodeURIComponent("from:12306@rails.com.cn newer_than:90d")}`;
  return (
    <section className="gmail-rail-orders" aria-label="Gmail 订单">
      <div className="calendar-import-heading">
        <strong><TrainFront size={16} aria-hidden="true" />Gmail 订单</strong>
        {!mailbox.connected ? <button type="button" className="text-action" disabled={busy} onClick={() => void run("start")}>连接 Gmail</button>
          : <button type="button" className="text-action" disabled={busy} onClick={() => void run(reconnect ? "start" : "sync")}>{busy ? "正在读取…" : reconnect ? "重新连接" : "更新"}</button>}
      </div>
      {mailbox.connected && mailbox.lastSync && <small className="gmail-rail-time" role="status">上次读取 {syncTime.format(mailbox.lastSync)}</small>}
      {!mailbox.connected && <p className="field-help">Google 会请求邮箱只读权限。Wayline 读取支持来源的车票、航班和住宿确认邮件。</p>}
      {mailbox.connected && <>
        {!!orders.length && <ul className="gmail-rail-list">{orders.map(order => (
          <li key={order.id}>
            <strong>{order.train} · {order.origin} → {order.destination}</strong>
            <span className="gmail-rail-time">
              <time dateTime={order.departAt}>{departureFormat.format(new Date(order.departAt))} 出发</time>
              {order.arriveAt && <> · <time dateTime={order.arriveAt}>{departureFormat.format(new Date(order.arriveAt))} 到达</time></>}
              {" · Gmail"}
            </span>
          </li>
        ))}</ul>}
        {!!mailbox.bookings?.length && <ul className="gmail-rail-list">{mailbox.bookings.map(booking => <li key={booking.id}>
          <strong>{booking.kind === "stay" ? booking.to : `${booking.number} · ${booking.from} → ${booking.to}`}</strong>
          <span className="gmail-rail-time">{booking.kind === "stay" ? `${booking.start} 至 ${booking.end}` :
            departureFormat.format(new Date(booking.start)) + " 出发"} · Gmail</span>
        </li>)}</ul>}
        {!orders.length && !mailbox.bookings?.length && !busy && <p className="field-help">{mailbox.orders.length ? "已在日历中显示"
          : !mailbox.lastSync ? "等待首次读取"
          : mailbox.singleSample ? mailbox.sampleRead ? "已读取一封，车票信息待核对" : "最近 90 天内没有匹配的购票确认"
          : "未识别到近期订单"}</p>}
        {!!mailbox.reviewCount && <p className="field-help">{mailbox.reviewCount} 封通知待核对 · <a href={gmailSearch} target="_blank" rel="noopener noreferrer">查看邮件</a></p>}
        {mailbox.singleSample ? <div className="google-calendar-actions">
          <button type="button" className="text-action" disabled={busy} onClick={() => void run("enable-sync")}>启用订单同步</button>
          <small>读取最近 90 天内支持来源的订单确认邮件</small>
        </div>
          : mailbox.partial && <p className="field-help">仅检查最近 100 封匹配通知。</p>}
        {confirmDisconnect ? <div className="google-calendar-actions">
          <button type="button" className="text-action" disabled={busy} onClick={() => void run("disconnect")}>断开并清除已识别订单</button>
          <button type="button" className="text-action" disabled={busy} onClick={() => setConfirmDisconnect(false)}>保留连接</button>
        </div> : <button type="button" className="text-action" disabled={busy} onClick={() => setConfirmDisconnect(true)}>断开 Gmail</button>}
      </>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </section>
  );
}

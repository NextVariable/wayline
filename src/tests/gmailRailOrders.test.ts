import { expect, it, vi } from "vitest";
// @ts-expect-error Server ESM exercised directly.
import { collectBookingChanges, collectRailOrders, collectMailBookings, createGmailOrders, parseRailMessage, parseBookingMessage } from "../../server/gmail-rail-orders.mjs";
import { hasCalendarRailOrder } from "../lib/businessOrders";
import type { CalendarEntry } from "../lib/calendarEvents";

const now = Date.parse("2026-11-13T02:00:00Z");
const ticket = "订单号 E123456789\n乘车日期：2026年11月16日\n车次：G123\n出发站：苏州站\n到达站：上海虹桥站\n出发时间：09:00\n到达时间：09:38\n乘车人：合成样本";
const mail = (content = ticket, { subject = "铁路12306购票成功通知", from = "铁路12306 <12306@rails.com.cn>",
  authentication = "mx.google.com; dmarc=pass header.from=rails.com.cn", html = false, timestamp = now - 1000 } = {}) => ({
  internalDate: String(timestamp), payload: { mimeType: html ? "text/html" : "text/plain", headers: [
    { name: "From", value: from }, { name: "Subject", value: subject }, { name: "Authentication-Results", value: authentication },
  ], body: { data: Buffer.from(content).toString("base64url") } },
});

it("keeps only route fields from authenticated plain and HTML messages", () => {
  const expected = { train: "G123", origin: "苏州", destination: "上海虹桥",
    departAt: "2026-11-16T09:00:00+08:00", arriveAt: "2026-11-16T09:38:00+08:00" };
  for (const message of [mail(), mail("<p>" + ticket.replaceAll("\n", "</p><p>") + "</p>", { html: true })]) {
    const result = parseRailMessage(message);
    expect(result).toMatchObject({ kind: "confirmed", journeys: [expected] });
    expect(JSON.stringify(result)).not.toMatch(/E123456789|合成样本|rails\.com\.cn/);
  }
});

it("rejects unrelated senders and leaves spoofed, unpaid or ambiguous notifications unconfirmed", () => {
  expect(parseRailMessage(mail(ticket, { from: "12306@rails.com.cn.example.org" }))).toBeNull();
  for (const message of [
    mail(ticket, { authentication: "mx.google.com; dmarc=fail header.from=rails.com.cn" }),
    mail(ticket, { subject: "订票成功，待支付" }),
    mail(ticket.replace("出发站：苏州站\n", "")),
    mail(ticket.replace("乘车日期：2026年11月16日", "购买日期：2026年11月16日")),
    mail(ticket.replace("11月16日", "02月30日")),
    mail(ticket.replace("车次：G123", "车次：G123，另有G124次")),
  ]) expect(parseRailMessage(message).kind).toBe("review");
});

it("deduplicates identical tickets and suppresses a booking after an authenticated refund", () => {
  const booking = parseRailMessage(mail());
  const duplicate = parseRailMessage(mail(ticket, { timestamp: now - 2000 }));
  const refund = parseRailMessage(mail("订单号 E123456789", { subject: "12306退票成功", timestamp: now }));
  expect(collectRailOrders([booking, duplicate], now).orders).toHaveLength(1);
  expect(collectRailOrders([booking, duplicate, refund], now)).toMatchObject({ orders: [], reviewCount: 3 });
});

it("suppresses duplicates only when a calendar event has the same train and departure minute", () => {
  const [order] = parseRailMessage(mail()).journeys;
  const event = { title: "高铁 G123 苏州→上海虹桥", start: "2026-11-16T01:00:00Z" } as CalendarEntry;
  expect(hasCalendarRailOrder(order, [event])).toBe(true);
  expect(hasCalendarRailOrder(order, [{ ...event, title: "高铁 G1234" }])).toBe(false);
  expect(hasCalendarRailOrder(order, [{ ...event, title: "高铁 G123 苏州→上海站" }])).toBe(false);
  expect(hasCalendarRailOrder(order, [{ ...event, start: "2026-11-16T01:01:00Z" }])).toBe(false);
});

function setup(singleSample = false) {
  let clock = now;
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes("/messages?")) return Response.json({ messages: [{ id: "a" }] });
    if (url.includes("/messages/a?")) return Response.json(mail());
    return Response.json({}, { status: 404 });
  });
  const vault = { data: {} as Record<string, any>, save: vi.fn(async () => {}) };
  const service = createGmailOrders({ vault: async () => vault, fetcher, now: () => clock,
    env: { GMAIL_ORDERS_ENABLED: "1", GOOGLE_CLIENT_ID: "demo", GOOGLE_CLIENT_SECRET: "demo",
      ...(singleSample && { GMAIL_ORDERS_SINGLE_SAMPLE: "1" }) } });
  return { service, fetcher, vault, advance: (ms: number) => { clock += ms; } };
}

it("fetches the body of only one matching confirmation and can show a past test ticket", async () => {
  const { service, fetcher, advance } = setup(true);
  advance(7 * 86_400_000);
  fetcher.mockResolvedValueOnce(Response.json({ messages: [{ id: "a" }, { id: "b" }], nextPageToken: "unused" }));
  await service.connect("owner-a", { access_token: "SECRET", refresh_token: "REFRESH" });
  expect(await service.sync("owner-a")).toMatchObject({ singleSample: true, sampleRead: true, orders: [{ train: "G123" }] });
  expect(fetcher.mock.calls).toHaveLength(2);
  const list = new URL(fetcher.mock.calls[0][0]);
  expect(list.searchParams.get("maxResults")).toBe("1");
  expect(list.searchParams.get("q")).toContain('subject:"购票成功"');
});

it("keeps an empty Gmail search distinguishable from a request failure", async () => {
  const { service, fetcher } = setup(true);
  fetcher.mockImplementationOnce(async (input: string) => {
    const fields = new URL(input).searchParams.get("fields")?.split(",");
    return fields?.includes("resultSizeEstimate")
      ? Response.json({ resultSizeEstimate: 0 })
      : new Response(null, { status: 204 });
  });
  await service.connect("owner-a", { access_token: "SECRET", refresh_token: "REFRESH" });
  expect(await service.sync("owner-a")).toMatchObject({ singleSample: true, sampleRead: false, orders: [] });
  expect(fetcher.mock.calls).toHaveLength(1);
});

it("queries only supported booking senders, reuses parsed results and keeps accounts separate", async () => {
  const { service, fetcher, vault, advance } = setup();
  await service.connect("owner-a", { access_token: "SECRET", refresh_token: "PRIVATE_REFRESH", expires_in: 3600 });
  const results = await service.sync("owner-a");
  expect(results.orders).toHaveLength(1);
  expect(await service.status("owner-b")).toMatchObject({ connected: false, orders: [] });
  expect(JSON.stringify(results)).not.toMatch(/SECRET|PRIVATE_REFRESH|合成样本/);
  const query = new URL(fetcher.mock.calls[0][0]).searchParams.get("q");
  expect(query).toContain("from:12306@rails.com.cn");
  expect(query).toContain("from:trip.com");
  expect(query).toContain("subject:订单");
  expect(JSON.stringify(vault.data)).not.toMatch(/合成样本|E123456789/);
  advance(60_001);
  await service.sync("owner-a");
  expect(fetcher.mock.calls.filter(([url]) => url.includes("/messages/a?"))).toHaveLength(1);
  await service.disconnect("owner-a");
  expect(await service.status("owner-a")).toMatchObject({ connected: false, orders: [] });
  expect(JSON.stringify(vault.data)).not.toContain("PRIVATE_REFRESH");
});

it("leaves the previous snapshot intact after a provider failure", async () => {
  const { service, fetcher, advance } = setup();
  await service.connect("owner-a", { access_token: "SECRET", refresh_token: "REFRESH" });
  const snapshot = await service.sync("owner-a");
  advance(60_001);
  fetcher.mockResolvedValueOnce(Response.json({}, { status: 503 }));
  await expect(service.sync("owner-a")).rejects.toMatchObject({ status: 502 });
  expect(await service.status("owner-a")).toEqual(snapshot);
});

it("does not reattach a disconnected account after an in-flight read", async () => {
  const { service, fetcher } = setup();
  await service.connect("owner-a", { access_token: "SECRET", refresh_token: "REFRESH" });
  let finish!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const sync = service.sync("owner-a");
  const observed = expect(sync).rejects.toMatchObject({ status: 409 });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await service.disconnect("owner-a");
  finish(Response.json({ messages: [{ id: "a" }] }));
  await observed;
  expect(await service.status("owner-a")).toMatchObject({ connected: false, orders: [] });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("recognizes authenticated flight and stay confirmations and removes cancelled bookings", () => {
  const options = { from:"Travel <booking@trip.com>", authentication:"mx.google.com; dmarc=pass header.from=trip.com" };
  const flight = parseBookingMessage(mail("航班号：MU1234\n出发机场：SHA\n到达机场：SZX\n起飞时间：2026-11-16 14:00\n到达时间：2026-11-16 17:00", { ...options, subject:"机票出票成功" }));
  expect(flight).toMatchObject({kind:"booking", booking:{kind:"flight", from:"SHA", to:"SZX", number:"MU1234"}});
  const stay = parseBookingMessage(mail("订单号：E123456789\n酒店名称：上海虹桥示例酒店\n入住日期：2026-11-16\n退房日期：2026-11-17", { ...options, subject:"酒店预订成功" }));
  expect(stay).toMatchObject({kind:"booking", booking:{kind:"stay", to:"上海虹桥示例酒店"}});
  const cancelled = parseBookingMessage(mail("订单号：E123456789", { ...options, subject:"住宿订单取消", timestamp:now }));
  expect(collectMailBookings([stay,cancelled],now)).toEqual([]);
  expect(parseBookingMessage(mail("订单号：E123456789", { ...options, subject:"住宿订单取消", authentication:"mx.google.com; dmarc=pass header.from=example.org" }))).toBeNull();
});

it("expands the one-message trial only for the account that enables sync", async () => {
  const { service, fetcher } = setup(true);
  const token = { access_token: "ACCESS", refresh_token: "REFRESH" };
  await service.connect("first", token);
  await service.connect("second", token);
  expect(await service.status("first")).toMatchObject({singleSample:true});
  expect(await service.enableFullSync("first")).toMatchObject({singleSample:false});
  expect(await service.status("second")).toMatchObject({singleSample:true});
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("q")).toContain("from:trip.com");
});

it("exposes a matched cancellation, a provisional change without a reference and a newer replacement", () => {
  const booking = parseRailMessage(mail());
  const refund = parseRailMessage(mail("订单号 E123456789", {subject:"12306退票成功",timestamp:now}));
  const unclear = parseRailMessage(mail("", {subject:"12306改签成功",timestamp:now}));
  expect(collectBookingChanges([booking, refund],now)).toMatchObject([{kind:"rail",state:"cancelled",number:"G123",observedAt:now}]);
  expect(collectBookingChanges([booking, unclear],now)).toMatchObject([{state:"review"}]);
  const replacement=parseRailMessage(mail(ticket,{timestamp:now+1000}));
  expect(collectBookingChanges([booking,refund,replacement],now+1000)).toEqual([]);
  expect(JSON.stringify(collectBookingChanges([booking,refund],now))).not.toMatch(/reference|E123456789/);
});

it("keeps the last orders with a reauthorization flag after Gmail revokes access", async()=>{
  const {service,fetcher,advance}=setup();
  await service.connect("test",{access_token:"fixture",refresh_token:"fixture"});
  await service.sync("test");
  advance(61_000);
  fetcher.mockResolvedValueOnce(Response.json({}, {status:401}));
  await expect(service.sync("test")).rejects.toMatchObject({status:401});
  expect(await service.status("test")).toMatchObject({needsReconnect:true,orders:[{train:"G123"}]});
  const previous=fetcher.mock.calls.length;
  await expect(service.sync("test")).rejects.toMatchObject({status:401});
  expect(fetcher.mock.calls).toHaveLength(previous);
});

it("preserves an existing inbox snapshot on incomplete list data and accepts a genuine empty result",async()=>{
  const {service,fetcher,advance}=setup();
  await service.connect("test",{access_token:"fixture",refresh_token:"fixture"});
  await service.sync("test");
  advance(61_000);
  fetcher.mockResolvedValueOnce(Response.json({nextPageToken:"unusable"}));
  await expect(service.sync("test")).rejects.toMatchObject({status:502});
  expect(await service.status("test")).toMatchObject({orders:[{train:"G123"}]});
  fetcher.mockResolvedValueOnce(Response.json({resultSizeEstimate:0}));
  expect(await service.sync("test")).toMatchObject({orders:[]});
});

it("does not mark every rail leg in a shared reference as definitely cancelled",()=>{
  const single=parseRailMessage(mail());
  const confirmation={...single,journeys:[single.journeys[0],{...single.journeys[0],id:"second"}]};
  const refund=parseRailMessage(mail("订单号 E123456789",{subject:"12306退票成功",timestamp:now}));
  expect(collectBookingChanges([confirmation,refund],now).map((row:{state:string})=>row.state)).toEqual(["review","review"]);
});

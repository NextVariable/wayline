process.env.TZ = "Asia/Shanghai";
import { describe, it, expect, vi } from "vitest";
import { initialUserPlaces } from "./fixtures/userPlaces";
import type { CalendarEntry } from "../lib/calendarEvents";
import { legPairs } from "../lib/todayMap";
import { fetchLeg, createTodayLegsRunner, type LegResult } from "../lib/useTodayLegs";

const at = (name: string, lat: number, lng: number, city = "北京") => ({ ...initialUserPlaces[0], id: "p:" + name, name, city, lat, lng });
const guomao = at("国贸大厦", 39.9087, 116.4605);
const south = at("北京南站", 39.8652, 116.3786);
const airport = at("首都机场", 40.0799, 116.6031);
let n = 0;
const event = (place: ReturnType<typeof at>, start: string, end: string): CalendarEntry => {
  n += 1;
  return { id: "e" + n, uid: "e" + n, title: "会议 " + n, location: place.name, description: "", start, end, allDay: false, timezone: "Asia/Shanghai", calendar: "工作", place, placeResolution: { status: "auto", text: place.name } };
};
const day = (...rows: [ReturnType<typeof at>, string, string][]) => legPairs(rows.map(r => event(...r)), "2026-11-13");
const three = () => day(
  [guomao, "2026-11-13T09:00:00+08:00", "2026-11-13T10:00:00+08:00"],
  [south, "2026-11-13T10:30:00+08:00", "2026-11-13T11:30:00+08:00"],
  [airport, "2026-11-13T12:00:00+08:00", "2026-11-13T13:00:00+08:00"],
  [guomao, "2026-11-13T15:00:00+08:00", "2026-11-13T16:00:00+08:00"],
);
const routeBody = (seconds: number) => ({
  mode: "transit", source: "amap", observedAt: Date.now(),
  legs: [{ from: "a", to: "b", duration: seconds, distance: 3000, points: [{ latitude: 39.9, longitude: 116.4 }, { latitude: 39.8, longitude: 116.3 }] }],
});
const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const requestOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body)) as { places: { id: string }[]; mode: string; departure?: string };

const routeReply = (seconds: number, init?: RequestInit) =>
  reply({ ...routeBody(seconds), mode: requestOf(["", init]).mode });

describe("looking up one leg", () => {
  it("returns minutes rounded up, with the route shape", async () => {
    const [pair] = three();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => routeReply(1501, init));
    const leg = await fetchLeg(pair, "transit", { fetchImpl });
    expect(leg).toMatchObject({ mode: "transit", minutes: 26, source: "amap" });
    expect(leg?.points).toHaveLength(2);
  });

  it("sends the previous event's end as the transit departure, with its offset", async () => {
    const [pair] = three();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => routeReply(600, init));
    await fetchLeg(pair, "transit", { fetchImpl });
    await fetchLeg(pair, "walking", { fetchImpl });
    const transit = requestOf(fetchImpl.mock.calls[0] as unknown[]), walking = requestOf(fetchImpl.mock.calls[1] as unknown[]);
    expect(transit.departure).toBe("2026-11-13T10:00:00+08:00");
    expect(transit.places.map(p => p.id)).toEqual([guomao.id, south.id]);
    expect(walking.departure).toBeUndefined();
  });

  it("is null when the route service fails or answers badly", async () => {
    const [pair] = three();
    expect(await fetchLeg(pair, "driving", { fetchImpl: vi.fn(() => Promise.reject(new TypeError("offline"))) })).toBeNull();
    expect(await fetchLeg(pair, "driving", { fetchImpl: vi.fn(() => reply({ error: "busy" }, 503)) })).toBeNull();
    expect(await fetchLeg(pair, "driving", { fetchImpl: vi.fn(() => reply({ nonsense: true })) })).toBeNull();
  });
});

describe("looking up the day", () => {
  const collect = () => {
    const seen: Record<string, Partial<Record<string, LegResult>>> = {};
    return { seen, onLeg: (id: string, mode: string, leg: LegResult | null) => { if (leg) (seen[id] ??= {})[mode] = leg; } };
  };

  it("queries only the default mode first", async () => {
    const pairs = three().filter(p => !p.sameSpot);
    expect(pairs).toHaveLength(3);
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => routeReply(600, init));
    const runner = createTodayLegsRunner({ fetchImpl });
    const { onLeg } = collect();
    await runner.run({ pairs, choices: {}, onLeg });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map(c => requestOf(c as unknown[]).mode)).toEqual(pairs.map(p => p.defaultMode));
  });

  it("honours a mode the person chose for a leg", async () => {
    const pairs = three().filter(p => !p.sameSpot).slice(0, 1);
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => routeReply(600, init));
    await createTodayLegsRunner({ fetchImpl }).run({ pairs, choices: { [pairs[0].id]: "walking" }, onLeg: collect().onLeg });
    expect(requestOf(fetchImpl.mock.calls[0] as unknown[]).mode).toBe("walking");
  });

  it("looks up the other two modes only for legs that are late", async () => {
    const pairs = three().filter(p => !p.sameSpot);
    // First leg has a 30 minute gap and takes 45: late. The others fit.
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { places: { id: string }[] };
      const late = body.places[0].id === pairs[0].from.place.id && body.places[1].id === pairs[0].to.place.id;
      return routeReply(late ? 45 * 60 : 5 * 60, init);
    });
    const { seen, onLeg } = collect();
    await createTodayLegsRunner({ fetchImpl }).run({ pairs, choices: {}, onLeg });
    const modes = (id: string) => Object.keys(seen[id] ?? {}).sort();
    expect(modes(pairs[0].id)).toEqual(["driving", "transit", "walking"]);
    expect(modes(pairs[1].id)).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3 + 2);
  });

  it("keeps a leg unknown when the route service fails and never blocks the others", async () => {
    const pairs = three().filter(p => !p.sameSpot);
    let calls = 0;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => { calls += 1; return calls === 1 ? Promise.reject(new TypeError("offline")) : routeReply(300, init); });
    const { seen, onLeg } = collect();
    await createTodayLegsRunner({ fetchImpl }).run({ pairs, choices: {}, onLeg });
    expect(seen[pairs[0].id]).toBeUndefined();
    expect(seen[pairs[1].id]).toBeDefined();
    expect(seen[pairs[2].id]).toBeDefined();
  });

  it("asks for the same leg and mode only once", async () => {
    const pairs = three().filter(p => !p.sameSpot).slice(0, 1);
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => routeReply(600, init));
    const runner = createTodayLegsRunner({ fetchImpl });
    await runner.run({ pairs, choices: {}, onLeg: collect().onLeg });
    await runner.run({ pairs, choices: {}, onLeg: collect().onLeg });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reuses the road query for self-driving while keeping the selected mode", async () => {
    const [pair] = three();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => routeReply(60, init));
    const runner = createTodayLegsRunner({ fetchImpl });
    const { seen, onLeg } = collect();
    await runner.run({ pairs:[pair], choices:{[pair.id]:"driving"}, onLeg });
    await runner.run({ pairs:[pair], choices:{[pair.id]:"selfDrive"}, onLeg });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(seen[pair.id]?.selfDrive).toMatchObject({ mode:"selfDrive", minutes:1 });
  });

  it("looks up a corrected location even when both calendar event IDs stay the same", async () => {
    const [pair] = three();
    const moved = { ...pair, to: { ...pair.to, place: { ...pair.to.place, lng: pair.to.place.lng + 0.02 } } };
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => routeReply(600, init));
    const runner = createTodayLegsRunner({ fetchImpl });
    for (const leg of [pair, moved]) {
      await runner.run({ pairs: [leg], choices: {}, onLeg: collect().onLeg });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("tries a failed leg again on the next run instead of remembering the failure", async () => {
    const pairs = three().filter(p => !p.sameSpot).slice(0, 1);
    const fetchImpl = vi.fn(() => reply({ error: "busy" }, 503));
    const runner = createTodayLegsRunner({ fetchImpl });
    await runner.run({ pairs, choices: {}, onLeg: collect().onLeg });
    await runner.run({ pairs, choices: {}, onLeg: collect().onLeg });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("skips legs at the same spot", async () => {
    const pairs = day(
      [guomao, "2026-11-13T09:00:00+08:00", "2026-11-13T10:00:00+08:00"],
      [guomao, "2026-11-13T11:00:00+08:00", "2026-11-13T12:00:00+08:00"],
    );
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => routeReply(600, init));
    await createTodayLegsRunner({ fetchImpl }).run({ pairs, choices: {}, onLeg: collect().onLeg });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ignores a late response after events changed", async () => {
    const pairs = three().filter(p => !p.sameSpot).slice(0, 1);
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      await gate;
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return routeReply(600, init);
    });
    const runner = createTodayLegsRunner({ fetchImpl });
    const onLeg = vi.fn();
    const first = runner.run({ pairs, choices: {}, onLeg });
    runner.cancel();
    release();
    await first;
    expect(onLeg).not.toHaveBeenCalled();
  });

  it("drops a result that arrives after a newer run started", async () => {
    const [pair] = three().filter(p => !p.sameSpot);
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const slow = vi.fn(async (_url: string, init?: RequestInit) => { await gate; return routeReply(600, init); });
    const runner = createTodayLegsRunner({ fetchImpl: slow });
    const stale = vi.fn();
    const firstRun = runner.run({ pairs: [pair], choices: {}, onLeg: stale });
    const fast = createTodayLegsRunner({ fetchImpl: vi.fn((_url: string, init?: RequestInit) => routeReply(300, init)) });
    await fast.run({ pairs: [pair], choices: {}, onLeg: vi.fn() });
    runner.cancel();
    release();
    await firstRun;
    expect(stale).not.toHaveBeenCalled();
  });
});


it("rejects evidence for a different mode, multiple routes or an impossible duration", async () => {
  const [pair] = three();
  const base = routeBody(600);
  for (const payload of [base, { ...base, mode:"walking", legs:[...base.legs, ...base.legs] }, { ...routeBody(0), mode:"walking" }]) {
    expect(await fetchLeg(pair, "walking", { fetchImpl: () => reply(payload) })).toBeNull();
  }
});

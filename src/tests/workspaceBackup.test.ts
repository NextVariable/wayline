import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceBackup, parseWorkspaceBackup, restoreWorkspaceRecords } from "../lib/workspaceBackup";
import { initialUserPlaces } from "../data/userPlaces";
import { guestUser, loadUserPlaces } from "../lib/userStorage";
import { samePlace } from "../lib/placeIdentity";
import { validRoutePlaces } from "../lib/tripWorkspace";
import { readSavedTrips, writeSavedTrips } from "../lib/savedTrips";
function memoryStorage() { const values = new Map<string,string>(); return { getItem: (key:string) => values.get(key) ?? null, setItem: (key:string,value:string) => { values.set(key,value); }, removeItem: (key:string) => {values.delete(key);}, clear: () => values.clear(), key: () => null, get length() {return values.size;} }; }
const make = () => ({format:"whereto-workspace",version:1,name:"工作",records:{"whatto.userPlaces.":[initialUserPlaces[0]],"whatto.customGuides.":["客户拜访"]},footprints:{tracks:[],visits:[]}});
afterEach(() => vi.unstubAllGlobals());
describe("whole-workspace migration", () => {
  it("round trips guides, schedules, drafts and footprints without copying credentials", () => {
    const store = memoryStorage();
    store.setItem("whatto.userPlaces.guest", JSON.stringify(initialUserPlaces));
    store.setItem("whatto.customGuides.guest", '["客户拜访"]');
    store.setItem("irrelevant-key", "private");
    const parsed = parseWorkspaceBackup(createWorkspaceBackup(guestUser,{tracks:[],visits:[]},store));
    expect(parsed.records["whatto.userPlaces."]).toHaveLength(initialUserPlaces.length);
    expect(Object.keys(parsed.records)).toEqual(["whatto.userPlaces.","whatto.customGuides."]);
    restoreWorkspaceRecords(parsed,"local:restored",store);
    expect(store.getItem("whatto.customGuides.local:restored")).toBe('["客户拜访"]');
    expect(store.getItem("whatto.userPlaces.guest")).toBe(JSON.stringify(initialUserPlaces));
  });
  it("retains two appointments at one venue", () => {
    const b = make(); b.records["whatto.userPlaces."] = [0,1].map(i => ({...initialUserPlaces[0],id:`meeting-${i}`,tags:["日程助手"]}));
    expect(parseWorkspaceBackup(JSON.stringify(b)).records["whatto.userPlaces."]).toHaveLength(2);
  });
  it.each(["token", "whatto.activeUser", "__proto__"])("rejects unexpected storage prefix %s before writes", key => {
    const b = make(); Object.defineProperty(b.records,key,{value:"bad",enumerable:true});
    expect(() => parseWorkspaceBackup(JSON.stringify(b))).toThrow();
  });
  it.each([{lat:Infinity},{lat:99},{tags:[{}]},{reason:{}},{externalLinks:{amap:"javascript:alert(1)"}},{customGuideNames:[{}]}])("rejects malformed place fields %j", patch => {
    const b = make(); Object.assign(b.records["whatto.userPlaces."][0] = {...initialUserPlaces[0]},patch);
    expect(() => parseWorkspaceBackup(JSON.stringify(b))).toThrow();
  });
  it("rolls back partially written records when browser storage fills", () => {
    const store = memoryStorage(), write = store.setItem; let writes = 0;
    store.setItem = (k,v) => { if (++writes === 2) throw new Error("quota"); write(k,v); };
    expect(() => restoreWorkspaceRecords(parseWorkspaceBackup(JSON.stringify(make())),"new",store)).toThrow("quota");
    expect(store.length).toBe(0);
  });
  it("refuses to overwrite an existing restore owner", () => {
    const store = memoryStorage(); store.setItem("whatto.userPlaces.new","existing");
    expect(() => restoreWorkspaceRecords(parseWorkspaceBackup(JSON.stringify(make())),"new",store)).toThrow();
    expect(store.getItem("whatto.userPlaces.new")).toBe("existing");
  });
  it("keeps the current workspace intact and restores business-trip settings into a separate space", () => {
    const store = memoryStorage();
    const settings = {home: "上海", boundaries: {next: "split"}, inferHome: false};
    store.setItem("wayline.businessTrips.guest", JSON.stringify(settings));
    const backup = parseWorkspaceBackup(createWorkspaceBackup(guestUser, {tracks:[],visits:[]}, store));
    restoreWorkspaceRecords(backup, "local:restored", store);
    expect(JSON.parse(store.getItem("wayline.businessTrips.local:restored")!)).toEqual(settings);
    expect(() => restoreWorkspaceRecords(backup, "guest", store)).toThrow("恢复空间已存在");
    expect(JSON.parse(store.getItem("wayline.businessTrips.guest")!)).toEqual(settings);
  });
  it("rejects incomplete footprint backup rather than silently dropping tracks", () => {
    const b = make(); (b.footprints.tracks as unknown[]) = [{id:"bad"}];
    expect(() => parseWorkspaceBackup(JSON.stringify(b))).toThrow();
  });
  it("recovers malformed stored places without crashing the application", () => {
    const store = memoryStorage(); vi.stubGlobal("localStorage",store);
    store.setItem("whatto.userPlaces.guest",JSON.stringify([null,{name:{}},initialUserPlaces[0]]));
    expect(loadUserPlaces(guestUser)).toEqual([initialUserPlaces[0]]);
  });
});
describe("branch and trip identity", () => {
  it("preserves same-name branches at distinct coordinates", () => {
    const p = initialUserPlaces[0], branch = {...p,id:"branch",lat:p.lat + .1};
    expect(samePlace(p,branch)).toBe(false); expect(validRoutePlaces([p,branch])).toHaveLength(2);
    expect(samePlace(p,{...p,id:"provider",city:p.city + "市"})).toBe(true);
  });
  it("keeps named trips isolated, durable and bounded", () => {
    const store = memoryStorage(); vi.stubGlobal("localStorage",store);
    const trip = {id:"a",name:"上海拜访",updatedAt:1,places:[initialUserPlaces[0]],draft:{date:"",days:"1",notes:"带行李",preferences:["省时间"]}};
    writeSavedTrips("a",[trip]); expect(readSavedTrips("a")).toEqual([trip]); expect(readSavedTrips("b")).toEqual([]);
    expect(() => writeSavedTrips("a",Array(101).fill(trip))).toThrow(); expect(readSavedTrips("a")).toEqual([trip]);
  });
});
it("restores planning conditions but invalidates imported live-query evidence", () => {
  const store = memoryStorage(), b = make() as ReturnType<typeof make> & {records:Record<string,unknown>};
  b.records["whatto.planner."] = {date:"",days:"1",notes:"保留说明",preferences:[],result:{recommendation:"旧结果"},generatedFor:"old"};
  restoreWorkspaceRecords(parseWorkspaceBackup(JSON.stringify(b)),"restored",store);
  expect(JSON.parse(store.getItem("whatto.planner.restored")!)).toMatchObject({notes:"保留说明",result:null,generatedFor:""});
});

it("exports and restores imported calendar events without fabricating a mapped place",()=>{
 const store=memoryStorage();const event={id:"ical:test",uid:"test",title:"会议",location:"待定",description:"",start:"2026-10-30T01:00:00.000Z",end:"2026-10-30T02:00:00.000Z",allDay:false,timezone:"UTC",calendar:"测试日历"};
 store.setItem("whatto.calendarEvents.guest",JSON.stringify([event]));
 const backup=parseWorkspaceBackup(createWorkspaceBackup(guestUser,{tracks:[],visits:[]},store));
 restoreWorkspaceRecords(backup,"restored",store);
 expect(JSON.parse(store.getItem("whatto.calendarEvents.restored")!)).toEqual([event]);
});

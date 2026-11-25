import { planCalendarImport } from "./lib/calendarImportPlan";
import { BusinessTripCommute, type CommuteChoice } from "./components/BusinessTripCommute";
import { BusinessTripConnections } from "./components/BusinessTripConnections";
import { tripTransfers } from "./lib/tripTransfers";
import { buildTravelWorkspace, tripTimeline } from "./lib/tripIntelligence";
import { assignTripBookings, collectTripBookings } from "./lib/businessOrders";
import { assessCommute, assessTrip, calendarRisks, isCurrentRoute } from "./lib/tripFeasibility";
import { useBookingPlaces, bookingPlaceKey } from "./lib/useBookingPlaces";
import { useTripMailbox } from "./lib/useTripMailbox";
import {storedPlaceCity} from "./lib/placeCity";
import { useGoogleCalendar } from "./lib/useGoogleCalendar";
import { mergeGoogleSnapshot, reconcileCalendarRoute, persistCalendarState, suppressCalendarEntry } from "./lib/googleCalendarSync";
import { useWorkspaceMotion } from "./lib/useWorkspaceMotion";
import { mapPopoverPosition } from "./lib/mapPopoverPosition";
import { readCalendarEntries, mergeCalendarEntries } from "./lib/calendarEvents";
import { readPlaceAliases, writePlaceAliases, type PlaceAliases } from "./lib/placeAliases";
import { useCalendarPlaces } from "./lib/useCalendarPlaces";
import { calendarMapPlaces, pendingPlaces, confirmPlace, acceptSuggestion, rejectSuggestion, ignorePlace } from "./lib/calendarPlaces";
import { GoogleCalendarConnection } from "./components/GoogleCalendarConnection";
import { CalendarPlaceHint } from "./components/CalendarPlaceHint";
import { TodayPanel, type TodaySegment } from "./components/TodayPanel";
import { CopilotPanel } from "./components/CopilotPanel";
import { OFFLINE_AI_STATUS, fetchAiStatus, type AiProposal, type AiStatus } from "./lib/aiClient";
import { buildCopilotContext } from "./lib/aiContext";
import { OfflineNotice } from "./components/OfflineNotice";
import { localDateKey, placePairKey, routeProviderMode, type TodayLegPair, type TravelMode } from "./lib/todayMap";
import { useTodayLegs, type LegResult } from "./lib/useTodayLegs";
import { BusinessTripsPanel } from "./components/BusinessTripsPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { groupBusinessTrips, readBusinessTripSettings, tripPlaces, writeBusinessTripSettings, type BusinessTripSettings } from "./lib/businessTrips";
import { DEMO_USER, DEMO_HOME, createDemoMailbox, demoDay, demoLegResults, enterDemo, exitDemo, readDemoMode, resetDemo } from "./lib/demoWorkspace";
import { eventDay } from "./lib/tripDay";
import { buildTripActions, type TripAction } from "./lib/actionItems";
import { deleteAccount } from "./lib/account";
import { mergeWorkspaceEvents } from "./lib/scheduleEvents";
import { addDays } from "./lib/smartIntake";
import { moveToTrash, restoreFromTrash, TRASH_DAYS } from "./lib/deletion";
const calendarLayerKey = (owner: string) => `whatto.mapCalendarLayer.${owner}`;
const readCalendarLayer = (owner: string) => { try { return localStorage.getItem(calendarLayerKey(owner)) !== "off"; } catch { return true; } };
const dayLabel = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" });
const noTripLines: [] = [];
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { MapZoomState } from "./lib/mapZoom";
import { MapCompass } from "./components/MapCompass";
import { MapDisplayOptions } from "./components/MapDisplayOptions";
import { MapBoundary } from "./components/MapBoundary";
import { PlaceCard } from "./components/PlaceCard";
import { accountUser, chooseActiveUser, useAccount } from "./lib/account";
import { useWorkspaceSync } from "./lib/workspaceSync";
import { openFootprintStore } from "./lib/footprintStore";
import { CityPicker } from "./components/CityPicker";
import { DeferredWorkflow, preloadableWorkflow } from "./components/DeferredWorkflow";
import { Sidebar, type UserFilter } from "./components/Sidebar";
import { useToast } from "./components/Toast";
import {
  Crosshair,
  Navigation,
  Loader2,
  Layers2,
  MessageCircle,
  Minus,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { usePanelFocus } from "./lib/usePanelFocus";
import { useHoverPopover } from "./lib/useHoverPopover";
import { useMapAppearance } from "./lib/useMapAppearance";
import { useCurrentLocation } from "./lib/useCurrentLocation";
import { shouldApplyLocation } from "./lib/currentLocation";
import type { City } from "./types/place";
import { useFootprints } from "./lib/useFootprints";
import { localDate } from "./lib/footprints";
import { gcjToWgs, wgsToGcj } from "./lib/trackCoordinates";
import type { FootprintSelection } from "./components/FootprintsPanel";
import { isSchedule, samePlace } from "./lib/placeIdentity";
import {
  useTripDraft,
  
  useUserCities,
} from "./lib/tripWorkspace";
import { cities, cityCatalog } from "./data/cities";
import { cityKey, cityScopeNames, uniqueCities } from "./lib/citySelection";
import { useCityView } from "./lib/useCityView";
import { officialAddressByName } from "./data/systemPlaces";
import {
  
  getCitiesGuideCategoriesPlaces,
  getCitiesPlacesByType,
  getCitiesGuidePlaces,
  
} from "./lib/guideFilters";
import { searchCitySystemPlaces } from "./lib/resourceSearch";
import { calendarSearchCity, reverseGeocodeAddress, searchPlaceCandidates, suggestPlaceCandidates, cachedPlaceSuggestions } from "./lib/geoSearch";
import {
  loadActiveUser,
  loadUserPlaces,
  saveActiveUser,
  saveUserPlaces,
  type AppUser,
} from "./lib/userStorage";
import type {
  CityName,
  MapMode,
  Place,
  SystemLayer,
} from "./types/place";

const MapView = lazy(() =>
  import("./components/MapView").then((m) => ({ default: m.MapView })),
);
const scheduleWorkflow = preloadableWorkflow(async () =>
  (await import("./components/ScheduleAssistant")).ScheduleAssistant,
);

const accountWorkflow = preloadableWorkflow(async () =>
  (await import("./components/AuthPanel")).AuthPanel,
);
const PlaceEditor = lazy(() =>
  import("./components/PlaceEditor").then((m) => ({ default: m.PlaceEditor })),
);
const footprintsWorkflow = preloadableWorkflow(async () =>
  (await import("./components/FootprintsPanel")).FootprintsPanel,
);
const { View: ScheduleAssistant } = scheduleWorkflow;
const { View: AuthPanel } = accountWorkflow;
const { View: FootprintsPanel } = footprintsWorkflow;
const workspaceWorkflows = { schedule: scheduleWorkflow, account: accountWorkflow, footprints: footprintsWorkflow };

const defaultFilter: UserFilter = {
  kind: "status",
  value: "all",
  label: "地点",
};
type OverlayPanel =
  "account" | "schedule" | "footprints" | "business-trips" | "history";

export default function App() {
  const mode = useMapAppearance();
  const [mapMode, setMapMode] = useState<MapMode>("explore");
  const [activeOverlay, commitOverlay] = useState<OverlayPanel | null>(null);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const mobileAssistant = useRef<HTMLButtonElement>(null);
  const [copilotStatus, setCopilotStatus] = useState<AiStatus>(OFFLINE_AI_STATUS);
  const [copilotSeed, setCopilotSeed] = useState<{ id: number; text: string; example?: string } | null>(null);
  const appliedProposals = useRef<Set<string>>(new Set());
  const [loadingWorkflow, setLoadingWorkflow] = useState<keyof typeof workspaceWorkflows | null>(null);
  const workflowRequest = useRef(0);
  const panelTransition = useRef<ViewTransition | null>(null);
  const cancelPendingWorkflow = useCallback(() => {
    workflowRequest.current++;
    setLoadingWorkflow(null);
  }, []);
  const setActiveOverlay = useCallback((panel: OverlayPanel | null) => {
    cancelPendingWorkflow();
    commitOverlay(panel);
  }, [cancelPendingWorkflow]);
  const presentWorkspace = (update: () => void, direction?: "forward" | "back") => {
    cancelPendingWorkflow();
    if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      update();
      return;
    }
    panelTransition.current?.skipTransition();
    const root = document.documentElement;
    root.classList.add("wayline-panel-transition");
    if (direction) root.dataset.waylinePanelDirection = direction;
    else delete root.dataset.waylinePanelDirection;
    const transition = document.startViewTransition(() => {
      if (panelTransition.current === transition) flushSync(update);
    });
    panelTransition.current = transition;
    const cleanup = () => {
      if (panelTransition.current !== transition) return;
      panelTransition.current = null;
      root.classList.remove("wayline-panel-transition");
      delete root.dataset.waylinePanelDirection;
    };
    void transition.finished.then(cleanup, cleanup);
  };
  const openWorkflow = (name: keyof typeof workspaceWorkflows, update: () => void, direction?: "forward") => {
    const workflow = workspaceWorkflows[name];
    const request = ++workflowRequest.current;
    const show = () => {
      if (workflowRequest.current === request) presentWorkspace(update, direction);
    };
    if (workflow.ready()) show();
    else {
      setLoadingWorkflow(name);
      void workflow.preload().then(show, () => {
        // The existing error boundary supplies recovery for a failed download.
        show();
      });
    }
  };
  useEffect(() => {
    const warm = () => Object.values(workspaceWorkflows).forEach(workflow => { void workflow.preload().catch(() => {}); });
    const timer = window.setTimeout(warm, 400);
    return () => window.clearTimeout(timer);
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  useWorkspaceMotion(workspaceRef,workspaceCollapsed);
  useLayoutEffect(()=>{
    // Hidden panels stop accepting keyboard input immediately, while their exit is still visible.
    for(const child of Array.from(workspaceRef.current?.children ?? [])) {
      if(child instanceof HTMLElement && child.matches(".workspace-header,.workspace-nav,.workspace-sidebar,.workspace-panel")) child.inert=workspaceCollapsed;
    }
  },[workspaceCollapsed]);
  const [guidesHomeRequest, setGuidesHomeRequest] = useState(0);
  const settingsHoverOrigin = useRef(false);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const settingsRef = usePanelFocus<HTMLDivElement>(settingsOpen && !settingsHoverOrigin.current);
  const settingsHover = useHoverPopover(settingsOpen, setSettingsOpen, settingsTrigger, settingsRef, settingsHoverOrigin);
  const closeMapSettings = useCallback(() => {
    setSettingsOpen(false);
    settingsTrigger.current?.focus({ preventScroll: true });
  }, []);
  const [settingsPosition, setSettingsPosition] = useState({left:0,top:0});
  useLayoutEffect(()=>{
    if(!settingsOpen || !settingsTrigger.current || !settingsRef.current)return;
    const update=()=>{
      if(!settingsTrigger.current || !settingsRef.current)return;
      const next=mapPopoverPosition(settingsTrigger.current.getBoundingClientRect(),{width:settingsRef.current.offsetWidth,height:settingsRef.current.offsetHeight},{width:window.innerWidth,height:window.innerHeight});
      setSettingsPosition(previous=>previous.left===next.left&&previous.top===next.top?previous:next);
    };
    update();
    const observer=new ResizeObserver(update);
    observer.observe(settingsRef.current);observer.observe(settingsTrigger.current);
    window.addEventListener("resize",update);window.visualViewport?.addEventListener("resize",update);
    return ()=>{observer.disconnect();window.removeEventListener("resize",update);window.visualViewport?.removeEventListener("resize",update);};
  }, [settingsOpen, settingsRef]);
  const [editPlace, setEditPlace] = useState<Place | null>(null);
  const [storageHealthy, setStorageHealthy] = useState(true);
  const [detailOrigin, setDetailOrigin] = useState<
    "schedule" | null
  >(null);
  const [scheduleEdit, setScheduleEdit] = useState<Place | null>(null);
  const [scheduleOrigin, setScheduleOrigin] = useState<OverlayPanel | null>(
    null,
  );
  useEffect(() => {
    if (!settingsOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest(".settings-popover, [data-map-settings]"))
        setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [settingsOpen]);
  const account = useAccount();
  const [localUser, setActiveUser] = useState<AppUser>(() => loadActiveUser());
  const [showLocalSpace, setShowLocalSpace] = useState(false);
  const [demoBoot] = useState(() => {
    const active = readDemoMode();
    const now = Date.now();
    // 刷新后重新锚定演示日期，避免继续显示上次进入时的相对日程。
    if (active) resetDemo(now);
    return { active, now };
  });
  const [demoActive, setDemoActive] = useState(demoBoot.active);
  const [demoNow, setDemoNow] = useState(demoBoot.now);
  // 手机上的底部面板会随内容长高盖住地图角标，缺地点提示因此移入面板内渲染。
  const [compactLayout, setCompactLayout] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const sync = () => setCompactLayout(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  // Signed in → the account's own owner; otherwise the local space or guest (never a stale account).
  const accountKey = account.status === "signed-in" ? account.account.id : "";
  const accountEmail = account.status === "signed-in" ? account.account.email : "";
  const signedInUser = useMemo(() => accountKey ? accountUser({ id: accountKey, email: accountEmail }) : null,
    [accountKey, accountEmail]);
  // Bumped whenever the shown owner's data changes; drives the debounced cloud push.
  const [dataRevision, setDataRevision] = useState(0);
  const workspaceSync = useWorkspaceSync({
    account: signedInUser,
    pausePush: showLocalSpace || demoActive,
    changeKey: String(dataRevision),
    readFootprints: async owner => { const store = await openFootprintStore(owner); try { return await store.load(); } finally { store.close(); } },
    writeFootprints: async (owner, data) => { const store = await openFootprintStore(owner); try { await store.importData(data); } finally { store.close(); } },
    onReloaded: () => { try { sessionStorage.setItem("wayline.syncNotice", "1"); } catch { /* notice is optional */ } window.location.reload(); },
    onSignedOut: () => void account.refresh(),
  });
  // The account becomes the shown owner only once its cloud copy is in local storage.
  const accountReady = !!signedInUser && workspaceSync.readyOwner === signedInUser.id;
  const activeUser = demoActive
    ? DEMO_USER
    : accountReady && !showLocalSpace && signedInUser
      ? signedInUser
      : chooseActiveUser({status: "loading"}, localUser);
  const liveMailbox = useTripMailbox(!demoActive && activeUser.method === "google" ? accountKey : undefined);
  const demoMailbox = useMemo(() => demoActive ? createDemoMailbox(demoNow) : undefined, [demoActive, demoNow]);
  const mailbox = demoActive ? demoMailbox : liveMailbox;
  const [calendarState, setCalendarState] = useState(() => ({ owner:activeUser.id, events:readCalendarEntries(activeUser.id) }));
  const calendarEvents = useMemo(() => calendarState.owner === activeUser.id
    ? calendarState.events : readCalendarEntries(activeUser.id), [calendarState, activeUser.id]);
  const [tripSettingsOverride, setTripSettingsOverride] = useState<{ owner: string; settings: BusinessTripSettings }>();
  const [businessSelection, setBusinessSelection] = useState<{ owner: string; id: string } | null>(null);
  const [historySelection, setHistorySelection] = useState<{ owner: string; id: string } | null>(null);
  const businessSettings = useMemo(() => tripSettingsOverride?.owner === activeUser.id
    ? tripSettingsOverride.settings : readBusinessTripSettings(activeUser.id), [activeUser.id, tripSettingsOverride]);
  const saveBusinessSettings = (settings: BusinessTripSettings) => {
    try { writeBusinessTripSettings(activeUser.id, settings); }
    catch { addToast("出差设置暂时无法保存，关闭页面后可能丢失", "error"); }
    setTripSettingsOverride({ owner: activeUser.id, settings });
    if (activeUser.method === "google") setDataRevision(value => value + 1);
  };
  const [todayKey, setTodayKey] = useState(() => localDateKey(new Date()));
  // 演示工作区固定按 Asia/Shanghai 生成与归组，避免宿主时区把同一天拆到不同的本地日期。
  const effectiveTodayKey = demoActive ? demoDay(0, demoNow) : todayKey;
  useEffect(() => {
    const update = () => setTodayKey(localDateKey(new Date()));
    const timer = window.setInterval(update, 30_000);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, []);
  const [legPreference, setLegPreference] = useState<{ owner: string; values: Record<string, TravelMode> }>();
  const [bufferPreference, setBufferPreference] = useState<{ owner: string; values: Record<string, number> }>();
  const [compareLeg, setCompareLeg] = useState<string | null>(null);
  const [legFocus, setLegFocus] = useState<{ owner: string; id: string | null }>();
  const legFocusKey = `whatto.legFocus.${activeUser.id}`;
  const restoredLegFocus = useMemo(() => {
    try { return sessionStorage.getItem(legFocusKey); } catch { return null; }
  }, [legFocusKey]);
  const requestedLegFocus = legFocus?.owner === activeUser.id ? legFocus.id : restoredLegFocus;
  const rememberLegFocus = (id: string | null) => {
    setLegFocus({owner:activeUser.id, id});
    try { if (id) sessionStorage.setItem(legFocusKey, id); else sessionStorage.removeItem(legFocusKey); } catch { /* keep the in-page focus */ }
  };
  const [retryTodayRoutes, setRetryTodayRoutes] = useState(0);
  // Phrases the user pinned to a place ("公司" → 国贸大厦). Pulled cloud data reloads the page, so reading here stays current.
  const [placeAliases, setPlaceAliases] = useState(()=>readPlaceAliases(activeUser.id));
  // The 日程地点 map layer, per account, on unless turned off.
  const [calendarLayer, setCalendarLayer] = useState(()=>readCalendarLayer(activeUser.id));
  const changeCalendarLayer = (on: boolean) => { setCalendarLayer(on); try { localStorage.setItem(calendarLayerKey(activeUser.id), on ? "on" : "off"); } catch { /* the choice still applies for this visit */ } };
  const [placeLayers, setPlaceLayers] = useState({ saved: true, visited: false, booked: true });
  const [footprintSelection, setFootprintSelection] =
    useState<FootprintSelection>({ id: null, date: "", nonce: 0 });
  useEffect(
    () => setFootprintSelection({ id: null, date: "", nonce: 0 }),
    [activeUser.id],
  );
  const {
    activeCity,
    scope: cityScope,
    setActiveCity,
    setCityScope,
    selectedCities: selectedCityNames,
    selectCities,
    restored: cityRestored,
  } = useCityView(activeUser.id);
  const [userPlaces, setUserPlaces] = useState<Place[]>(() =>
    loadUserPlaces(loadActiveUser()),
  );
  // Local schedules join synced calendar events as workspace events, keeping
  // their Wayline identity instead of pretending to be external calendar data.
  const workspaceEvents = useMemo(
    () => mergeWorkspaceEvents(calendarEvents, userPlaces),
    [calendarEvents, userPlaces],
  );
  useEffect(() => {
    if (!demoActive) return;
    setActiveCity(DEMO_HOME);
    setCityScope("current");
  }, [demoActive, setActiveCity, setCityScope]);
  const footprints = useFootprints(activeUser.id, userPlaces);
  const visitedResourcePlaces = useMemo(() => footprints.snapshot.visits
    .filter(v => !v.deletedAt)
    .filter((v, i, rows) => rows.findIndex(q => q.name === v.name && q.city === v.city && Math.abs(q.lat-v.lat) < .001 && Math.abs(q.lng-v.lng) < .001) === i)
    .map((v): Place => ({ id: v.placeId, name: v.name, city: v.city,
      lat: v.lat, lng: v.lng, category: "custom", type: "user", source: "manual",
      status: "visited", isSaved: false, address: "", openingHours: "", description: "",
      tags: [], reason: "", distanceText: "", externalLinks: {} })), [footprints.snapshot.visits]);
  const [routePlaces, setRoutePlaces, routeSaved] = useTripDraft(activeUser.id);
  useEffect(() => { setDataRevision(value => value + 1); }, [userPlaces, routePlaces, calendarEvents, placeAliases, footprints.snapshot]);
  const skipNextPersist = useRef(false);
  const [activeFilter, setActiveFilter] = useState<UserFilter>(defaultFilter);
  const [activeLayers, setActiveLayers] = useState<SystemLayer[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [zoomCommand, setZoomCommand] = useState(0);
  const [northCommand, setNorthCommand] = useState(0);
  const [mapRotation, setMapRotation] = useState<number | null>(null);
  const [zoomState, setZoomState] = useState<MapZoomState>({ canZoomIn: false, canZoomOut: false });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [customCities, setCustomCities, citiesSaved] =
    useUserCities(activeUser);
  
  const currentLocation = useCurrentLocation(!demoActive);
  const userLocation = useMemo(
    () =>
      currentLocation.position
        ? {
            lat: currentLocation.position.lat,
            lng: currentLocation.position.lng,
            label: "你",
          }
        : null,
    [currentLocation.position],
  );
  const [detectedCity, setDetectedCity] = useState<City | null>(null);
  const [locationFocus, setLocationFocus] = useState(0);
  const appliedLocation = useRef("");
  const locationIntent = useRef<{ id: number; apply: boolean; manualAt: number; overlay: string | null } | null>(null);
  const explicitLocation = useRef(false);
  const manualCityAt = useRef(cityRestored ? Infinity : 0);
  const { addToast } = useToast();
  // One-off notices around sign-in and sync.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("signin") === "denied") {
      addToast("已取消登录", "info");
      url.searchParams.delete("signin");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    try {
      if (sessionStorage.getItem("wayline.syncNotice")) {
 sessionStorage.removeItem("wayline.syncNotice");
        addToast("另一台设备有更新，已载入最新内容", "info");
      }
    } catch { /* storage unavailable */ }
  }, [addToast]);
  const { offerMigration, dismissMigration, migrateGuest } = workspaceSync;
  useEffect(() => {
    if (!offerMigration) return;
    dismissMigration();
    addToast("这台浏览器里有游客数据，要迁入你的账号吗？", "info", { label: "迁入", onClick: () => void migrateGuest(), dismissLabel: "不用" });
  }, [offerMigration, dismissMigration, migrateGuest, addToast]);
  useEffect(() => {
    if (workspaceSync.state !== "conflict") return;
    addToast("云端有更新。本机修改已保留，可在「资料与备份」处理。", "info");
  }, [workspaceSync.state, addToast]);

  const allCities = useMemo(
    () =>
      uniqueCities([
        ...cityCatalog,
        ...customCities,
        ...(detectedCity ? [detectedCity] : []),
        ...[...userPlaces, ...routePlaces].map((place) => ({
          name: place.city,
          lat: place.lat,
          lng: place.lng,
          zoom: 12,
        })),
      ]),
    [customCities, detectedCity, userPlaces, routePlaces],
  );
  const selectedCities = useMemo(
    () =>
      cityScopeNames(cityScope, activeCity, [
        ...allCities.map((item) => item.name),
        ...userPlaces.map((place) => place.city),
      ], selectedCityNames),
    [cityScope, activeCity, allCities, userPlaces, selectedCityNames],
  );
  const [cityResources, setCityResources] = useState<{
    city: string;
    layers: Partial<Record<SystemLayer, { places: Place[]; message: string }>>;
  }>({ city: "", layers: {} });
  const city =
    allCities.find((item) => cityKey(item.name) === cityKey(activeCity)) ??
    cities[3];
  const calendarCurrent=useRef({owner:activeUser.id,events:calendarEvents,route:routePlaces,city});
  calendarCurrent.current={owner:activeUser.id,events:calendarEvents,route:routePlaces,city};
  const commitCalendarEvents=(events:typeof calendarEvents,route=calendarCurrent.current.route)=>{
    const current=calendarCurrent.current;
    const next=reconcileCalendarRoute(route,current.events,events);
    persistCalendarState(current.owner,next.events,next.route);
    calendarCurrent.current={...current,...{events:next.events,route:next.route}};
    setCalendarState({owner:current.owner, events:next.events});setRoutePlaces(next.route);
  };
  const googleCalendar=useGoogleCalendar(activeUser.id,async(incoming,connectionId,signal,deleted)=>{
    if(signal.aborted)return;
    // Places are resolved afterwards by useCalendarPlaces; a changed location drops its old coordinates in the merge.
    const current=calendarCurrent.current;
    const next=mergeGoogleSnapshot(current.events,incoming,connectionId,deleted);
    if(JSON.stringify(next)!==JSON.stringify(current.events)||JSON.stringify(reconcileCalendarRoute(current.route,current.events,next).route)!==JSON.stringify(current.route))commitCalendarEvents(next);
  });
  const awaitingFirstSync = useRef<string | null>(null);
  const calendarStatus = googleCalendar.status;
  useEffect(() => {
    if (!calendarStatus?.connected) {
      awaitingFirstSync.current = null;
    } else if (!calendarStatus.lastSync) {
      awaitingFirstSync.current = activeUser.id;
    } else if (awaitingFirstSync.current === activeUser.id && !googleCalendar.error) {
      awaitingFirstSync.current = null;
      if (calendarStatus.events?.length) addToast("Google 日历已同步", "success");
    }
  }, [calendarStatus, activeUser.id, addToast, googleCalendar.error]);
  useEffect(() => {
    if (!selectedPlace?.calendarEventIds?.length) return;
    const eventIds = selectedPlace.calendarEventIds.filter(id =>
      workspaceEvents.some(event => event.id === id && event.place && samePlace(event.place, selectedPlace)));
    if (!eventIds.length) {
      setSelectedPlace(null);
      setDetailOrigin(null);
    } else if (eventIds.length !== selectedPlace.calendarEventIds.length) {
      setSelectedPlace({ ...selectedPlace, calendarEventIds: eventIds });
    }
  }, [workspaceEvents, selectedPlace]);
  const todayDate = useMemo(() => new Date(`${effectiveTodayKey}T00:00:00`), [effectiveTodayKey]);
  useCalendarPlaces({owner:activeUser.id,events:calendarEvents,aliases:placeAliases,city:String(city.name),day:effectiveTodayKey,commit:events=>commitCalendarEvents(events)});
  const pendingCalendarPlaces = useMemo(() => pendingPlaces(calendarEvents, { now: todayDate }), [calendarEvents, todayDate]);
  // Fixing a place writes the calendar and, when a phrase is remembered, the aliases; a failed write is reported, never hidden.
  const fixCalendarPlace = (update: (events: typeof calendarEvents) => { events: typeof calendarEvents; aliases?: PlaceAliases }) => {
    try {
      const next = update(calendarCurrent.current.events);
      if (next.aliases) { writePlaceAliases(activeUser.id, next.aliases); setPlaceAliases(next.aliases); }
      commitCalendarEvents(next.events);
    } catch (error) {
      addToast(error instanceof Error ? error.message : "未能保存，请重试", "error");
    }
  };
  useEffect(()=>{
    const url=new URL(window.location.href);
    const gmailResult = url.searchParams.get("gmail");
    const calendarResult = url.searchParams.get("calendar");
    if (calendarResult === "denied") addToast("未连接 Google 日历，可重新授权", "info");
    if (calendarResult || gmailResult) {
      if (gmailResult) {
        setScheduleOrigin("business-trips");
        setActiveOverlay("schedule");
        if (gmailResult === "denied") addToast("未连接 Gmail", "info");
      }
      url.searchParams.delete("calendar");
      url.searchParams.delete("gmail");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, [addToast, setActiveOverlay]);
  const resourceCity = cityScope === "current" && activeOverlay !== "footprints" ? city.name : "";
  useEffect(() => {
    if (demoActive) return;
    if (!resourceCity || !activeLayers.length) return;
    const controller = new AbortController();
    setCityResources(previous => previous.city === resourceCity ? previous : { city: resourceCity, layers: {} });
    for (const layer of activeLayers) {
      const label = layer === "business" ? "商务中心" : "交通枢纽";
      const update = (places: Place[], message: string) => {
        if (!controller.signal.aborted) setCityResources(previous => ({
          city: resourceCity,
          layers: { ...(previous.city === resourceCity ? previous.layers : {}), [layer]: { places, message } },
        }));
      };
      void searchCitySystemPlaces(resourceCity, layer, controller.signal).then(({ places, incomplete }) => {
        update(places, incomplete ? `部分${label}暂时无法加载` :
          places.length ? "" : `本市暂无可显示的${label}`);
      }).catch(() => update([], `${label}暂时无法加载`));
    }
    return () => controller.abort();
  }, [resourceCity, activeLayers, demoActive]);
  const resourceSearchError = cityResources.city === resourceCity
    ? activeLayers.map(layer => cityResources.layers[layer]?.message).filter(Boolean).join("。")
    : "";
  const auxiliaryOrigin = useRef<
    {
      overlay: OverlayPanel | null;
      place: Place | null;
      detail: "schedule" | null;
    }[]
  >([]);
  useEffect(() => {
    // A city change starts a new location context; never reopen an old city's detail.
    auxiliaryOrigin.current = auxiliaryOrigin.current.map((origin) => ({
      ...origin,
      place: null,
      detail: null,
    }));
  }, [activeCity]);
  const closeAuxiliary = useCallback(() => {
    const origin = auxiliaryOrigin.current.pop();
    setActiveOverlay(origin?.overlay ?? null);
    setSelectedPlace(origin?.place ?? null);
    setDetailOrigin(origin?.detail ?? null);
  }, [setActiveOverlay]);
  const openOverlay = () => openWorkflow("account", () => {
    const panel = "account";
    setWorkspaceCollapsed(false);
    setSettingsOpen(false);
    if (activeOverlay === panel) {
      closeAuxiliary();
      return;
    }
    auxiliaryOrigin.current.push({
      overlay: activeOverlay,
      place: selectedPlace,
      detail: detailOrigin,
    });
    setSelectedPlace(null);
    setActiveOverlay(panel);
  });
  const savedLocations = useMemo(
    () => userPlaces.filter((p) => !isSchedule(p) && p.isSaved !== false),
    [userPlaces],
  );
  const visibleUserPlaces = useMemo(() => {
    if (activeFilter.kind === "category")
      return getCitiesPlacesByType(
        savedLocations,
        selectedCities,
        activeFilter.value,
      );
    
    if (activeFilter.kind === "combined")
      return getCitiesGuideCategoriesPlaces(
        savedLocations,
        selectedCities,
        activeFilter.categories,
      );
    if (activeFilter.kind === "status" && activeFilter.value === "visited")
      return getCitiesGuidePlaces(
        [...savedLocations.filter(p => !visitedResourcePlaces.some(v => samePlace(v, p))), ...visitedResourcePlaces],
        selectedCities,
      ).filter((place) => place.status === "visited");
    if (activeFilter.kind === "status" && activeFilter.value !== "all")
      return getCitiesGuidePlaces(savedLocations, selectedCities).filter(
        (place) => place.status === activeFilter.value,
      );
    if (activeFilter.kind === "routes") return [];
    return getCitiesGuidePlaces(savedLocations, selectedCities);
  }, [activeFilter, selectedCities, savedLocations, visitedResourcePlaces]);

  const visibleSystemPlaces = useMemo(() => {
    if (!resourceCity || cityResources.city !== resourceCity) return [];
    return activeLayers.flatMap(layer => cityResources.layers[layer]?.places ?? []).map(place => {
      const visited = visitedResourcePlaces.some(item => samePlace(item, place));
      return visited ? { ...place, status: "visited" as const } : place;
    });
  }, [resourceCity, activeLayers, cityResources, visitedResourcePlaces]);


  const tripActive =
    activeOverlay === "schedule" ||
    !!(selectedPlace && detailOrigin) ||
    (activeOverlay === "account" && auxiliaryOrigin.current.some( (origin) =>
          origin.overlay === "schedule" ||
          !!origin.detail,
      ));


  const bookingCities = useMemo(() => allCities.map(city => city.name), [allCities]);
  const model = useMemo(() => buildTravelWorkspace({events:workspaceEvents,settings:businessSettings,day:todayDate,mailbox:mailbox?.singleSample ? undefined : mailbox,cities:bookingCities,todayKey:effectiveTodayKey,dayOf:demoActive ? eventDay : undefined}),
    [workspaceEvents,businessSettings,todayDate,effectiveTodayKey,demoActive,mailbox,bookingCities]);
  const {today,stops:todayStops,pairs,trips:businessTrips,plans:bookingPlan} = model;
  const effectiveBusinessSettings = {...businessSettings,home:model.home};
  const [clockNow, setClockNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setClockNow(Date.now());
    const timer = window.setInterval(update,30_000);
    document.addEventListener("visibilitychange",update);
    return () => {window.clearInterval(timer); document.removeEventListener("visibilitychange",update);};
  }, []);
  const focusedTodayLeg = pairs.some(pair => pair.id === requestedLegFocus) ? requestedLegFocus : null;
  const legModeKey = `whatto.legModes.${activeUser.id}`;
  const preferences = useMemo(() => {
    if (legPreference?.owner === activeUser.id) return legPreference.values;
    try {
      const stored = JSON.parse(localStorage.getItem(legModeKey) ?? "{}");
      return Object.fromEntries(Object.entries(stored ?? {}).filter(([, mode]) =>
        mode === "walking" || mode === "transit" || mode === "driving" || mode === "selfDrive")) as Record<string, TravelMode>;
    } catch { return {}; }
  }, [legPreference, legModeKey, activeUser.id]);
  const choices = useMemo(() => Object.fromEntries(pairs.map(pair =>
    [pair.id, preferences[placePairKey(pair)] ?? pair.defaultMode])), [pairs, preferences]);
  const bufferKey = `wayline.routeBuffers.${activeUser.id}`;
  const bufferOverrides = useMemo(() => {
    if (bufferPreference?.owner === activeUser.id) return bufferPreference.values;
    try {
      const stored = JSON.parse(localStorage.getItem(bufferKey) ?? "{}");
      return Object.fromEntries(Object.entries(stored ?? {}).filter(([, minutes]) =>
        typeof minutes === "number" && Number.isFinite(minutes) && minutes >= 0 && minutes <= 360)) as Record<string, number>;
    } catch { return {}; }
  }, [bufferPreference, bufferKey, activeUser.id]);
  const chooseBuffer = (pair: TodayLegPair, minutes: number | undefined) => {
    const values = { ...bufferOverrides };
    const key = placePairKey(pair);
    if (minutes === undefined) delete values[key]; else values[key] = minutes;
    setBufferPreference({ owner: activeUser.id, values });
    try { localStorage.setItem(bufferKey, JSON.stringify(values)); } catch { /* retain the selection for this session */ }
  };
  const chooseTodayMode = (pair: TodayLegPair, mode: TravelMode) => {
    const values = { ...preferences, [placePairKey(pair)]: mode };
    setLegPreference({ owner: activeUser.id, values });
    try { localStorage.setItem(legModeKey, JSON.stringify(values)); } catch { /* retain the selection for this session */ }
  };
  const todayVisible = !activeOverlay && !tripActive;
  const { legs: liveTodayLegs, loading: todayLoading } = useTodayLegs({
    pairs: todayVisible && !demoActive ? pairs : [], choices, owner: activeUser.id, retryCount: retryTodayRoutes, compare: compareLeg,
  });
  const demoTodayLegs = useMemo(() => demoActive && todayVisible ? demoLegResults(pairs, demoNow) : {},
    [demoActive, todayVisible, pairs, demoNow]);
  const todayLegResults = demoActive ? demoTodayLegs : liveTodayLegs;
  const freshness = useMemo(() => {
    // 演示工作区使用合成数据，不声称连接了真实 Google/Gmail。
    if (demoActive) return { calendarCurrent: true, mailboxCurrent: true, now: demoNow };
    return {
      calendarCurrent: !!googleCalendar.status?.connected && !!googleCalendar.status.lastSync &&
        clockNow - googleCalendar.status.lastSync < 10 * 60_000 && !googleCalendar.error,
      mailboxCurrent: !!mailbox?.lastSync && clockNow-mailbox.lastSync < 30 * 60_000 && !mailbox.uncertain && !mailbox.needsReconnect && !mailbox.partial && !mailbox.singleSample,
      now:clockNow,
    };
  }, [demoActive,demoNow,clockNow,googleCalendar.status,googleCalendar.error,mailbox]);
  const todaySegments = useMemo<TodaySegment[]>(() => pairs.map(pair => {
    const mode = choices[pair.id];
    const values = todayLegResults[pair.id] ?? {};
    const options = values;
    const result = values[mode] ?? values[routeProviderMode(mode)];
    const bufferOverride = bufferOverrides[placePairKey(pair)];
    const assessment = assessCommute(pair, Object.values(values), mode, freshness, { bufferOverride });
    return {pair, mode, result, options, bufferOverride, ...assessment};
  }), [pairs, choices, todayLegResults, freshness, bufferOverrides]);
  const todayConflicts = useMemo(() => calendarRisks(workspaceEvents,freshness,today?.dateKey ?? effectiveTodayKey)
    .filter(risk => risk.type === "overlap" && !todaySegments.some(({pair,plan}) =>
      plan.status === "overlap" && pair.from.event.id === risk.eventIds[0] && pair.to.event.id === risk.eventIds[1])),
    [workspaceEvents,freshness,today,effectiveTodayKey,todaySegments]);
  const todayEventIds = useMemo(() => new Set(workspaceEvents
    .filter(event => (demoActive ? eventDay(event) : localDateKey(event.start)) === effectiveTodayKey).map(event => event.id)),
  [workspaceEvents, effectiveTodayKey, demoActive]);
  // 今天的订单风险需要同时出现在 Today 与 Trips，避免两个入口结论不一致。
  const todayTripRisks = useMemo(() => {
    if (!todayEventIds.size) return [];
    return [...model.tripModels.values()].flatMap(trip => assessTrip(trip, freshness, [], {})
      .filter(risk => risk.eventIds.some(id => todayEventIds.has(id)) &&
        ["booking-change", "booking-conflict", "missing-stay", "missing-transport"].includes(risk.type)));
  }, [model, freshness, todayEventIds]);
  const todayActions = useMemo(() => buildTripActions({
    risks: [
      ...todayConflicts,
      ...todayTripRisks,
      ...todaySegments.flatMap(segment => segment.risk ? [segment.risk] : []),
    ],
    events: workspaceEvents,
    now: clockNow,
  }), [todayConflicts, todayTripRisks, todaySegments, workspaceEvents, clockNow]);
  const showTodayOnMap = todayVisible && calendarLayer && todayStops.length > 0;
  const todayRoutes = useMemo(() => showTodayOnMap ? todaySegments.flatMap(({ pair, result, plan }) =>
    result && isCurrentRoute(result,clockNow) ? [{ id: pair.id, points: result.points, late: plan.status === "insufficient" || plan.status === "overlap" }] : []
  ) : undefined, [showTodayOnMap, todaySegments, clockNow]);
  const todayPlaces = useMemo(() => showTodayOnMap ? todayStops
    .filter((stop, index, stops) => stops.findIndex(item => samePlace(item.place, stop.place)) === index)
    .map(stop => ({ ...stop.place, calendarEventIds: todayStops.filter(item => samePlace(item.place, stop.place)).map(item => item.event.id) })) : [], [showTodayOnMap, todayStops]);
  const businessNavKey = `whatto.businessNav.${activeUser.id}`;
  const [resumedCommute, setResumedCommute] = useState<{ owner: string; tripId: string; choice: CommuteChoice }>();
  useEffect(() => {
    if (!businessTrips.length) return;
    try {
      const raw = sessionStorage.getItem(businessNavKey);
      if (!raw) return;
      sessionStorage.removeItem(businessNavKey);
      const data = JSON.parse(raw);
      if (!businessTrips.some(trip => trip.id === data?.tripId) || typeof data?.choice?.id !== "string" ||
        !["walking", "transit", "selfDrive"].includes(data.choice.mode)) return;
      setBusinessSelection({owner:activeUser.id, id:data.tripId});
      setResumedCommute({owner:activeUser.id, tripId:data.tripId, choice:data.choice});
      setActiveOverlay("business-trips");
    } catch { /* recovery is optional if tab storage is unavailable */ }
  }, [activeUser.id, businessNavKey, businessTrips, setActiveOverlay]);
  useEffect(() => {
    const clear = (event: PageTransitionEvent) => {
      if (event.persisted) try { sessionStorage.removeItem(businessNavKey); } catch { /* current page already retains its state */ }
    };
    window.addEventListener("pageshow", clear);
    return () => window.removeEventListener("pageshow", clear);
  }, [businessNavKey]);
  const selectedBusinessTrip = businessSelection?.owner === activeUser.id
    ? businessTrips.find(item => item.id === businessSelection.id) : undefined;
  const selectedModel = selectedBusinessTrip && model.tripModels.get(selectedBusinessTrip.id);
  const selectedPlan = selectedBusinessTrip && bookingPlan.get(selectedBusinessTrip.id);
  const copilotContext = useMemo(() => {
    const tomorrow = demoActive ? demoDay(1, demoNow) : localDateKey(new Date(clockNow + 86_400_000).toISOString());
    const days = new Set([effectiveTodayKey, tomorrow]);
    const events = workspaceEvents
      .filter(event => days.has(demoActive ? eventDay(event) : localDateKey(event.start)))
      .map(event => ({
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        placeName: event.place?.name || event.location,
        placeId: event.place?.id,
        source: event.local ? "wayline" : event.google ? "google-calendar" : "calendar-file",
        local: !!event.local,
        stale: !!event.google?.stale,
      }));
    const physicalPlaces = [...todayPlaces, ...userPlaces.filter(place => place.city === city.name)]
      .filter(place => !place.tags?.includes("日程助手"));
    const bookings = [...(selectedPlan?.legs ?? []), ...(selectedPlan?.nights ?? [])]
      .flatMap(entry => entry.orders)
      .map(order => ({
        id: order.id,
        kind: order.kind,
        title: [order.number, order.from?.name, order.to?.name].filter(Boolean).join(" · ") ||
          (order.kind === "stay" ? "住宿" : order.kind === "flight" ? "航班" : "铁路"),
        from: order.from?.name,
        to: order.to?.name,
        start: order.start,
        end: order.end,
        state: order.state ?? "confirmed",
        source: order.source,
      }));
    return buildCopilotContext({
      owner: activeUser.id,
      activeCity: city.name,
      events,
      places: physicalPlaces,
      actions: todayActions.map(action => ({
        id: action.id,
        type: action.type,
        severity: action.severity,
        status: action.status ?? "open",
        title: action.title,
        problem: action.problem,
        eventIds: action.eventIds,
        nextStep: { kind: action.nextStep.kind, label: action.nextStep.label },
      })),
      commutes: todaySegments.map(({ pair, mode, plan, result }) => ({
        fromEventId: pair.from.event.id,
        toEventId: pair.to.event.id,
        mode,
        status: plan.status,
        availableMinutes: plan.availableMinutes,
        routeMinutes: result?.minutes ?? null,
        bufferMinutes: plan.bufferMinutes,
        remainingMinutes: plan.remainingMinutes,
        latestDeparture: plan.latestDeparture,
        advice: plan.advice,
        reference: plan.status === "reference",
        pending: plan.status === "pending",
        source: result?.source,
      })),
      bookings,
      trips: businessTrips.map(trip => ({
        id: trip.id,
        title: trip.cities.join(" → ") || "商务出行",
        cities: trip.cities,
        startDate: trip.days[0]?.date ?? "",
        endDate: trip.days.at(-1)?.date ?? "",
        eventCount: trip.days.reduce((count, day) => count + day.events.length, 0),
      })),
    });
  }, [activeUser.id, businessTrips, city.name, clockNow, demoActive, demoNow, effectiveTodayKey,
    selectedPlan, todayActions, todayPlaces, todaySegments, userPlaces, workspaceEvents]);
  useEffect(() => {
    if (demoActive) return;
    let live = true;
    void fetchAiStatus(activeUser.id).then(status => {
      if (live) setCopilotStatus(status);
    });
    return () => { live = false; };
  }, [activeUser.id, demoActive]);
  const bookingPoints = useMemo(() => [...(selectedPlan?.legs ?? []), ...(selectedPlan?.nights ?? [])]
        .flatMap(entry => entry.orders.filter(order => (!order.state || order.state === "confirmed") &&
      (order.source === "Gmail" ? freshness.mailboxCurrent : order.provenance?.some(item => item.source !== "google-calendar" && item.source !== "gmail") ||
        freshness.calendarCurrent || (freshness.mailboxCurrent && order.provenance?.some(item=>item.source==="gmail"))))
      .flatMap(order => order.from ? [order.from, order.to] : [order.to])), [selectedPlan,freshness.calendarCurrent,freshness.mailboxCurrent]);
  const bookingLocations = useBookingPlaces(activeOverlay === "business-trips" ? bookingPoints : [], activeUser.id);
  const transfers = useMemo(() => selectedModel ? tripTransfers(selectedModel,bookingLocations) : [],[selectedModel,bookingLocations]);
  const [transferState,setTransferState] = useState<{owner:string;routes:Record<string,LegResult>}>();
  const tripRisks = useMemo(() => selectedModel ? assessTrip(selectedModel,freshness,transfers,
    transferState?.owner===activeUser.id?transferState.routes:{}) : [],
    [selectedModel,freshness,transfers,transferState,activeUser.id]);
  const tripActions = useMemo(() => buildTripActions({ risks: tripRisks, events: workspaceEvents, now: clockNow }),
    [tripRisks, workspaceEvents, clockNow]);
  const storeTransfer = (key:string,route:LegResult|null) => {
    setTransferState(previous => {
      const routes = previous?.owner===activeUser.id ? {...previous.routes} : {};
      delete routes[key];
      if (route) routes[key]=route;
      return {owner:activeUser.id,routes:Object.fromEntries(Object.entries(routes).slice(-32))};
    });
  };
  const businessRevision = selectedBusinessTrip ? JSON.stringify(selectedBusinessTrip.days.map(day =>
    day.events.map(event => [event.id,event.start,event.end,event.place.lat,event.place.lng]))) : "";
  const stayRevision = JSON.stringify([businessRevision, selectedPlan?.nights, bookingLocations]);
  const [stayArea, setStayArea] = useState<{ revision: string; place: Place } | null>(null);
  const activeStayArea = activeOverlay === "business-trips" && stayArea?.revision === stayRevision ? stayArea?.place : undefined;
  const [businessOverviewCommand, setBusinessOverviewCommand] = useState(0);
  const [businessRoad, setBusinessRoad] = useState<{ revision:string; route:{ id:string; points:LegResult["points"]; late:boolean } } | null>(null);
  const activeBusinessRoad = businessRoad?.revision === businessRevision ? businessRoad.route : null;
  const businessPlaces = useMemo(() => tripPlaces(selectedBusinessTrip), [selectedBusinessTrip]);
  const bookingMapPlaces = useMemo(() => bookingPoints.flatMap(point => point.place ?? bookingLocations[bookingPlaceKey(point)] ?? []),
    [bookingPoints, bookingLocations]);
  const businessMapPlaces = useMemo(() => {
    return [...businessPlaces, ...bookingMapPlaces].filter((place, index, all) => all.findIndex(other => samePlace(place, other)) === index);
  }, [businessPlaces, bookingMapPlaces]);
  const tripVisiblePlaces = useMemo(() => {
    if (!selectedBusinessTrip) return [];
    const withinTrip = (place: Place) => selectedBusinessTrip.cities.some(city => cityKey(city) === cityKey(place.city));
    const pins = [
      ...(calendarLayer ? businessPlaces : []),
      ...(placeLayers.booked ? bookingMapPlaces : []),
      ...(placeLayers.saved ? savedLocations.filter(withinTrip) : []),
      ...(placeLayers.visited ? visitedResourcePlaces.filter(withinTrip) : []),
    ];
    return pins.filter((place, index) => pins.findIndex(other => samePlace(place, other)) === index);
  }, [selectedBusinessTrip, calendarLayer, businessPlaces, placeLayers, bookingMapPlaces, savedLocations, visitedResourcePlaces]);
  const showingBusinessTrip = activeOverlay === "business-trips" && !!selectedBusinessTrip;
  const businessHome = effectiveBusinessSettings.home;
  const businessBoundaries = businessSettings.boundaries;
  const pastTrips = useMemo(() => {
    if (!businessHome) return [];
    // Source-deleted records leave the active workspace but stay readable in History.
    return groupBusinessTrips(mergeWorkspaceEvents(calendarEvents, userPlaces, { includeDeleted: true }),
      { home: businessHome, boundaries: businessBoundaries }, "0000-01-01", { includePast: true })
      .filter(trip => trip.days.at(-1)!.date < effectiveTodayKey)
      .sort((a, b) => b.days[0].date.localeCompare(a.days[0].date));
  }, [calendarEvents, userPlaces, businessHome, businessBoundaries, effectiveTodayKey]);
  const historyBookings = useMemo(() => collectTripBookings(
    mergeWorkspaceEvents(calendarEvents, userPlaces, { includeDeleted: true }),
    mailbox?.singleSample ? [] : mailbox?.orders ?? [], mailbox?.singleSample ? [] : mailbox?.bookings ?? [],
    bookingCities, mailbox?.singleSample ? [] : mailbox?.changes, mailbox?.lastSync),
  [calendarEvents, userPlaces, mailbox, bookingCities]);
  const historyPlans = useMemo(() => assignTripBookings(pastTrips, businessHome, historyBookings),
    [pastTrips, businessHome, historyBookings]);
  const selectedHistoryTrip = historySelection?.owner === activeUser.id
    ? pastTrips.find(trip => trip.id === historySelection.id) : undefined;
  const historyTimeline = selectedHistoryTrip
    ? tripTimeline(selectedHistoryTrip, historyPlans.get(selectedHistoryTrip.id) ?? { legs: [], nights: [] })
    : undefined;
  const showingHistoryTrip = activeOverlay === "history" && !!selectedHistoryTrip;
  const historyPlaces = useMemo(() => tripPlaces(selectedHistoryTrip), [selectedHistoryTrip]);
  const historyMapPlaces = useMemo(() => showingHistoryTrip ? historyPlaces : pastTrips.flatMap(tripPlaces), [showingHistoryTrip, historyPlaces, pastTrips]);
  const historyMapIndices = useMemo(() => Object.fromEntries(historyPlaces.flatMap((place, index) =>
    (place.calendarEventIds ?? []).map(id => [id, index + 1]))), [historyPlaces]);
  const [historyOverviewCommand, setHistoryOverviewCommand] = useState(0);
  const selectBusinessPlace = (place: Place, keepArea = false) => {
    if (!keepArea) setStayArea(null);
    setLocationFocus(0);
    setSelectedPlace(place);
    setFocusNonce(value => value + 1);
  };

  const calendarOnMap = useMemo(
    () => (calendarLayer ? calendarMapPlaces(workspaceEvents, { now: todayDate }) : []),
    [workspaceEvents, calendarLayer, todayDate],
  );
  const mapPlaces = useMemo(() => {
    const places = [
      ...todayPlaces,
      ...visibleSystemPlaces,
      ...(placeLayers.saved ? visibleUserPlaces : []),
      ...(placeLayers.visited ? getCitiesGuidePlaces(visitedResourcePlaces, selectedCities) : []),
      ...calendarOnMap,
    ].filter(
      (place, index, items) =>
        items.findIndex((item) => samePlace(item, place)) === index,
    );
    if (selectedPlace && !places.some((place) => place.id === selectedPlace.id))
      return [selectedPlace, ...places];
    return places;
  }, [
    selectedPlace,
    visibleSystemPlaces,
    visibleUserPlaces,
    calendarOnMap,
    todayPlaces,
    placeLayers,
    selectedCities,
    visitedResourcePlaces,
  ]);

  useEffect(() => {
    if (!selectedPlace || !needsOfficialAddress(selectedPlace.address)) return;
    let cancelled = false;
    const referenceCity =
      allCities.find((item) => item.name === selectedPlace.city) ?? city;
    const officialAddress = officialAddressByName[selectedPlace.name];
    Promise.resolve(officialAddress ?? null)
      .then(
        (address) =>
          address ??
          reverseGeocodeAddress(selectedPlace.lat, selectedPlace.lng),
      )
      .then(async (address) => {
        if (cancelled) return;
        if (address && !needsOfficialAddress(address)) {
          setSelectedPlace((current) =>
            current && samePlace(current, selectedPlace)
              ? {
                  ...current,
                  address,
                  openingHours: normalizeOpeningHours(current),
                }
              : current,
          );
          return;
        }
        const candidates = await searchPlaceCandidates(
          selectedPlace.name,
          referenceCity,
          { aiFallback: false, reference: userLocation },
        );
        if (cancelled) return;
        const exact =
          candidates.find(
            (candidate) =>
              samePlace(candidate, selectedPlace) ||
              candidate.name.includes(selectedPlace.name) ||
              selectedPlace.name.includes(candidate.name),
          ) ?? candidates[0];
        if (
          !exact ||
          needsOfficialAddress(exact.address) ||
          /行政区|城市候选|候选/.test(exact.address)
        )
          return;
        setSelectedPlace((current) =>
          current && samePlace(current, selectedPlace)
            ? {
                ...current,
                address: exact.address,
                distanceText: exact.distanceText || current.distanceText,
                openingHours: normalizeOpeningHours(current),
              }
            : current,
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [allCities, city, selectedPlace, userLocation]);

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      cancelPendingWorkflow();
      if (settingsOpen) {
        if (settingsRef.current?.contains(document.activeElement)) closeMapSettings();
        else setSettingsOpen(false);
      }
      else if (activeOverlay === "account") closeAuxiliary();
      else if (activeOverlay === "schedule") setActiveOverlay(scheduleOrigin);
      else if (activeOverlay === "business-trips") {
        if (businessSelection) { setBusinessSelection(null); setSelectedPlace(null); }
        else setActiveOverlay(null);
      }
      else if (activeOverlay === "history") {
        if (historySelection) { setHistorySelection(null); setSelectedPlace(null); }
        else setActiveOverlay(null);
      }
      else if (activeOverlay) setActiveOverlay(null);
      else {
        setSelectedPlace(null);
        if (detailOrigin) setActiveOverlay(detailOrigin);
        setDetailOrigin(null);
      }
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [activeOverlay, settingsOpen, detailOrigin, scheduleOrigin, businessSelection, historySelection,
    cancelPendingWorkflow, closeAuxiliary, closeMapSettings, setActiveOverlay, settingsRef]);

  const togglePlaceSelection = (place: Place) => {
    if (selectedPlace?.id === place.id && !activeOverlay) return;
    presentWorkspace(() => {
      setWorkspaceCollapsed(false);
      setLocationFocus(0);
      auxiliaryOrigin.current = [];
      setDetailOrigin(activeOverlay === "schedule" ? activeOverlay : null);
      setActiveOverlay(null);
      setFocusNonce((value) => value + 1);
      setSelectedPlace(place);
    });
  };

  useEffect(() => {
    if (!demoActive) saveActiveUser(activeUser);
    setEditPlace(null);
    setScheduleEdit(null);
    skipNextPersist.current = true;
    setUserPlaces(loadUserPlaces(activeUser));
    setCalendarState({owner:activeUser.id, events:readCalendarEntries(activeUser.id)});
    setPlaceAliases(readPlaceAliases(activeUser.id));
    setCalendarLayer(readCalendarLayer(activeUser.id));
    setPlaceLayers({ saved: true, visited: false, booked: true });
    setSelectedPlace(null);
    setActiveFilter(defaultFilter);
  }, [activeUser, demoActive]);

  useEffect(() => {
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    if (demoActive) return;
    setStorageHealthy(saveUserPlaces(activeUser, userPlaces));
  }, [activeUser, userPlaces, demoActive]);

  const changeCity = (nextCity: CityName) => {
    explicitLocation.current = false;
    manualCityAt.current = Date.now();
    setLocationFocus(0);
    setActiveCity(nextCity);
    setCityScope("current");
    setSelectedPlace(null);
    setFocusNonce((value) => value + 1);
  };

  const toggleLayers = (targetLayers: SystemLayer[]) => {
    setActiveLayers((layers) => {
      const enabled = targetLayers.every((layer) => layers.includes(layer));
      if (enabled)
        return layers.filter((layer) => !targetLayers.includes(layer));
      return Array.from(new Set([...layers, ...targetLayers]));
    });
  };

  const savePlace = (place: Place) => {
    const normalizedPlace = normalizePlace(place);
    if (
      userPlaces.some(
        (item) =>
          samePlace(item, normalizedPlace),
      )
    ) {
      return;
    }

    const saved: Place = {
      ...normalizedPlace,
      id: `saved-${place.id}-${Date.now()}`,
      type: "user",
      source: "saved",
      status: normalizedPlace.status === "visited" ? "visited" : "saved",
      isSaved: true,
      guideCategories: place.guideCategories?.length
        ? place.guideCategories
        : [place.category],
    };
    setUserPlaces((places) => [saved, ...places]);
    setSelectedPlace(saved);
    addToast(`已添加「${saved.name}」到地点库`, "success");
  };

  const markVisited = async (rawPlace: Place) => {
    const place = normalizePlace(rawPlace);
    const recorder = footprints.recorder;
    if (!recorder) { addToast("足迹尚未就绪，请稍后重试", "error"); return; }
    const today = localDate();
    const existing = recorder.getSnapshot().visits.find(v => !v.deletedAt &&
      v.name === place.name && v.city === place.city && Math.abs(v.lat-place.lat) < .001 && Math.abs(v.lng-place.lng) < .001 && v.date === today);
    if (existing) { addToast("今天已记录到访，可在足迹中修改日期和备注", "info"); return; }
    const saved = await recorder.saveVisit({ id: crypto.randomUUID(), placeId: place.id,
      name: place.name, city: place.city, lat: place.lat, lng: place.lng,
      date: today, note: "", createdAt: Date.now(), coordinateSystem: "GCJ02" });
    if (!saved) { addToast("到访未能保存，请重试", "error"); return; }
    setUserPlaces(items => items.map(p => samePlace(p, place) ? { ...p, status: "visited" } : p));
    setRoutePlaces(items => items.map(p => samePlace(p, place) ? { ...p, status: "visited" } : p));
    setSelectedPlace(current => current && samePlace(current, place) ? { ...current, status: "visited" } : current);
    addToast("已记录今天的到访", "success");
  };

  

  

  

  function normalizePlace(place: Place): Place {
    const inferredCity = inferCityFromPlace(
      place,
      allCities.map((item) => item.name),
      activeCity,
    );
    return inferredCity === place.city
      ? place
      : { ...place, city: inferredCity };
  }

  const createPlace = (place: Place) => {
    const normalized = normalizePlace(place);
    addMissingCitiesFromPlaces([normalized]);
    setUserPlaces((places) => [normalized, ...places]);
  };

  const createSchedulePlace = (place: Place) => {
    const normalized = normalizePlace(place);
    addMissingCitiesFromPlaces([normalized]);
    setUserPlaces((places) => [normalized, ...places]);
    setActiveCity(normalized.city);
    setSelectedPlace(normalized);
    setActiveFilter(defaultFilter);
    setFocusNonce((value) => value + 1);
    addToast(`已添加日程「${normalized.name}」`, "success");
  };

  const createSchedulePlaces = (places: Place[]) => {
    const normalized = places.map(normalizePlace);
    if (!normalized.length) return;
    addMissingCitiesFromPlaces(normalized);
    setUserPlaces((current) => {
      const existing = new Set(current.map((place) => place.id));
      return [
        ...normalized.filter((place) => !existing.has(place.id)),
        ...current,
      ];
    });
    setActiveCity(normalized[0].city);
    setSelectedPlace(normalized[0]);
    setActiveFilter(defaultFilter);
    setFocusNonce((value) => value + 1);
    addToast(`已添加 ${normalized.length} 条安排`, "success");
  };

  const updatePlace = (place: Place, reveal = false) => {
    setUserPlaces((places) =>
      places.map((item) => (item.id === place.id ? place : item)),
    );
    setRoutePlaces((items) =>
      items.map((item) => (samePlace(item, place) ? place : item)),
    );
    setSelectedPlace((current) =>
      current && samePlace(current, place) ? place : reveal ? place : current,
    );
  };

  /**
   * Applies a confirmed copilot proposal to local state only.
   * The server has already checked owner, one-time use and version; this final
   * guard prevents a stale preview from touching a changed workspace.
   */
  const applyCopilotProposal = async (proposal: AiProposal): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (demoActive) return { ok: false, error: "演示工作区不会写入真实数据" };
    if (appliedProposals.current.has(proposal.proposalId)) return { ok: true };
    if (proposal.baseVersion !== copilotContext.revision)
      return { ok: false, error: "来源已更新，请重新生成预览" };
    const change = proposal.payload;
    if (change.operation === "create") {
      const place = userPlaces.find(item => item.id === change.placeId) ?? todayPlaces.find(item => item.id === change.placeId);
      if (!place || !change.date) return { ok: false, error: "地点或日期已不存在，请重新预览" };
      const time = change.startTime ?? "";
      const schedulePlace: Place = {
        ...place,
        id: `schedule-${Date.now()}-${place.id}`,
        type: "user",
        source: "manual",
        category: "custom",
        guideCategories: ["custom"],
        tags: ["日程助手", "待办事项", "智能录入", ...(time ? (change.endTime ? [] : ["结束时间待确认"]) : ["时间待确认"])],
        reason: `智能录入 · ${change.date}${time ? ` ${time}` : ""} · ${change.title || `前往${place.name}`}`,
        description: `关联地点：${place.name}`,
        status: "want_to_go",
        isSaved: true,
        schedule: {
          startTime: time,
          endTime: change.endTime ?? "",
          ...(change.endDate ? { endDate: change.endDate } : {}),
          timezone: "Asia/Shanghai",
        },
        distanceText: `${change.date}${time ? ` ${time}` : ""}`,
      };
      createSchedulePlaces([schedulePlace]);
    } else {
      const targetEvent = workspaceEvents.find(event => event.id === change.targetId);
      const sourceId = targetEvent?.local?.sourcePlaceId;
      const existing = sourceId ? userPlaces.find(item => item.id === sourceId) : undefined;
      if (!existing) return { ok: false, error: "只能修改 Wayline 本地安排，请重新选择" };
      const date = change.date || existing.distanceText.split(" ")[0];
      const time = change.startTime ?? existing.schedule?.startTime ?? "";
      const endTime = change.endTime ?? existing.schedule?.endTime ?? "";
      const crossesMidnight = !!time && !!endTime && endTime <= time;
      const endDate = crossesMidnight ? (change.endDate || addDays(date, 1)) : "";
      updatePlace({
        ...existing,
        name: change.title || existing.name,
        schedule: {
          startTime: time,
          endTime,
          ...(endDate ? { endDate } : {}),
          timezone: "Asia/Shanghai",
        },
        distanceText: `${date}${time ? ` ${time}` : ""}`,
        reason: `智能录入 · ${date}${time ? ` ${time}` : ""} · ${change.reason || change.title || "日程调整"}`,
      });
    }
    appliedProposals.current.add(proposal.proposalId);
    return { ok: true };
  };

  

  const deletePlace = (placeId: string) => {
    const target = userPlaces.find((place) => place.id === placeId);
    // Ordinary deletion is recoverable for 30 days and stays out of active views.
    if (target) { try { moveToTrash(activeUser.id, target); } catch { addToast("未能保存最近删除记录，请重试", "error"); return; } }
    setUserPlaces((places) => places.filter((place) => place.id !== placeId));
    setSelectedPlace((place) => (place?.id === placeId ? null : place));
    if (target)
      addToast(
        isSchedule(target)
          ? `已删除日程「${target.name}」，${TRASH_DAYS} 天内可恢复`
          : `已从地点库移除「${target.name}」，${TRASH_DAYS} 天内可恢复`,
        "info",
        {
          label: "撤销",
          onClick: () => {
            const restored = restoreFromTrash(activeUser.id, target.id);
            if (restored) setUserPlaces((items) => items.some((p) => samePlace(p, restored)) ? items : [restored, ...items]);
          },
        },
      );
  };

  const addMissingCitiesFromPlaces = (places: Place[]) => {
    const known = new Set([
      ...allCities.map((item) => item.name),
      ...customCities.map((item) => item.name),
    ]);
    const missing = places.filter((place) => !known.has(place.city));
    if (!missing.length) return;
    const nextCities = missing.map((place) => ({
      name: place.city,
      lat: place.lat,
      lng: place.lng,
      zoom: 12,
    }));
    setCustomCities((items) => [
      ...items,
      ...nextCities.filter(
        (city) => !items.some((item) => item.name === city.name),
      ),
    ]);
  };

  const showPlaces = () => {
    setWorkspaceCollapsed(false);
    setLocationFocus(0);
    if (cityScope === "selected" && selectedCityNames?.length) selectCities(selectedCityNames);
    auxiliaryOrigin.current = [];
    setActiveOverlay(null);
    setSelectedPlace(null);
    setDetailOrigin(null);
    setSettingsOpen(false);
    setSidebarOpen(true);
  };
  const returnFromWorkflow = (destination: "footprints" | "business-trips" | "history") => presentWorkspace(() => {
    if (destination === "business-trips") setBusinessSelection(null);
    if (destination === "history") setHistorySelection(null);
    showPlaces();
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-library-destination="${destination}"]`)?.focus({ preventScroll: true });
    });
  }, "back");
  const showTrip = () => {
    setWorkspaceCollapsed(false);
    setLocationFocus(0);
    auxiliaryOrigin.current = [];
    setActiveOverlay("business-trips");
    setSelectedPlace(null);
    setDetailOrigin(null);
    setSettingsOpen(false);
    setSidebarOpen(true);
  };
  const showHistory = () => {
    setWorkspaceCollapsed(false);
    setLocationFocus(0);
    auxiliaryOrigin.current = [];
    setActiveOverlay("history");
    setSelectedPlace(null);
    setDetailOrigin(null);
    setSettingsOpen(false);
    setSidebarOpen(true);
  };
  const enterDemoWorkspace = (fresh = false) => {
    const now = Date.now();
    if (fresh) resetDemo(now); else enterDemo(now);
    setDemoNow(now);
    setDemoActive(true);
    setShowLocalSpace(false);
    setBusinessSelection(null);
    setSelectedPlace(null);
    setDetailOrigin(null);
    setScheduleOrigin(null);
    setSettingsOpen(false);
    setActiveOverlay(null);
    setActiveCity(DEMO_HOME);
    setCityScope("current");
    setLocationFocus(0);
    setSidebarOpen(true);
  };
  const leaveDemoWorkspace = () => {
    exitDemo();
    setDemoActive(false);
    setBusinessSelection(null);
    setSelectedPlace(null);
    setDetailOrigin(null);
    setScheduleOrigin(null);
    setSettingsOpen(false);
    setActiveOverlay(null);
  };
  const runAction = (action: TripAction) => {
    const kind = action.nextStep.kind;
    if (kind === "review-calendar" || kind === "confirm-place") {
      openWorkflow("schedule", () => {
        setScheduleOrigin(activeOverlay === "business-trips" ? "business-trips" : null);
        setActiveOverlay("schedule");
      }, "forward");
      return;
    }
    if (kind === "review-route") {
      setRetryTodayRoutes(count => count + 1);
      if (action.segmentId) rememberLegFocus(action.segmentId);
      return;
    }
    const trip = [...model.tripModels.values()].find(candidate => candidate.days
      .some(day => day.events.some(event => action.eventIds.includes(event.id))));
    if (trip) setBusinessSelection({ owner: activeUser.id, id: trip.id });
    if (activeOverlay !== "business-trips") presentWorkspace(showTrip, "forward");
  };
  const footprintActive =
    activeOverlay === "footprints" ||
    (activeOverlay === "account" && auxiliaryOrigin.current.some((o) => o.overlay === "footprints"));
  const footprintTrack = footprints.snapshot.tracks.find(
    (t) =>
      !t.deletedAt &&
      t.id === (footprintSelection.id ?? footprints.snapshot.activeId),
  );
  const footprintVisit = footprintSelection.id?.startsWith("visit:")
    ? footprints.snapshot.visits.find(
        (v) => !v.deletedAt && "visit:" + v.id === footprintSelection.id,
      )
    : undefined;
  const footprintPoints = useMemo(
    () =>
      footprintVisit
        ? (() => {
            const [lng, lat] = gcjToWgs(footprintVisit.lng, footprintVisit.lat);
            return [
              {
                lng,
                lat,
                time: footprintVisit.createdAt,
                accuracy: 0,
                segment: 0,
              },
            ];
          })()
        : (footprintTrack?.points.filter(
            (p) =>
              !footprintSelection.date ||
              localDate(p.time) === footprintSelection.date,
          ) ?? footprints.snapshot.visits.filter(v => !v.deletedAt && (!footprintSelection.date || v.date === footprintSelection.date)).map((v, index) => {
            const [lng,lat] = gcjToWgs(v.lng,v.lat);
            return {lng,lat,time:v.createdAt,accuracy:0,segment:index};
          })),
    [footprintVisit, footprintTrack, footprintSelection.date, footprints.snapshot.visits],
  );
  const requestCurrentLocation = () => {
    explicitLocation.current = true;
    currentLocation.request("manual");
  };
  useEffect(() => {
    if (
      (currentLocation.status !== "success" &&
        currentLocation.status !== "error") ||
      appliedLocation.current === `${currentLocation.requestId}:${currentLocation.status}:${currentLocation.city?.name ?? ""}`
    )
      return;
    appliedLocation.current = `${currentLocation.requestId}:${currentLocation.status}:${currentLocation.city?.name ?? ""}`;
    if (currentLocation.status === "error") {
      explicitLocation.current = false;
      return;
    }
    const previousIntent = locationIntent.current;
    const firstFix = previousIntent?.id !== currentLocation.requestId;
    const shouldFocus = firstFix
      ? shouldApplyLocation(explicitLocation.current, activeOverlay, selectedPlace, manualCityAt.current, currentLocation.startedAt)
      : !!previousIntent?.apply && previousIntent.manualAt === manualCityAt.current && previousIntent.overlay === activeOverlay && !selectedPlace;
    if (firstFix) locationIntent.current = {
      id: currentLocation.requestId, apply: shouldFocus,
      manualAt: manualCityAt.current, overlay: activeOverlay,
    };
    explicitLocation.current = false;
    const position = currentLocation.position;
    if (!position) return;
    if (shouldFocus) {
      if (currentLocation.city) {
        const name = currentLocation.city.name;
        if (!allCities.some((c) => c.name === name)) {
          const [lng, lat] = wgsToGcj(position.lng, position.lat);
          setDetectedCity({ name, lng, lat, zoom: 12 });
        }
        setActiveCity(name);
        setCityScope("current");
      }
      setSelectedPlace(null);
      setDetailOrigin(null);
      setLocationFocus((n) => n + 1);
    }
  }, [
    currentLocation.status,
    currentLocation.requestId,
    currentLocation.position,
    currentLocation.city,
    currentLocation.startedAt,
    setActiveCity,
    setCityScope,
    activeOverlay,
    selectedPlace,
    allCities,
  ]);

  const demoBannerNode = demoActive ? (
    <div className="demo-banner" role="status">
      <span><strong>演示工作区</strong> 使用示例安排和路线。</span>
      <div className="demo-banner-actions">
        <button type="button" onClick={() => enterDemoWorkspace(true)}>重置演示</button>
        <button type="button" onClick={leaveDemoWorkspace}>退出演示</button>
      </div>
    </div>
  ) : null;

  const calendarHintNode = !footprintActive ? (
    <CalendarPlaceHint
      pending={pendingCalendarPlaces}
      onConfirm={(id, place) => fixCalendarPlace(events => confirmPlace(events, placeAliases, id, place))}
      onAccept={id => fixCalendarPlace(events => ({ events: acceptSuggestion(events, id) }))}
      onReject={id => fixCalendarPlace(events => ({ events: rejectSuggestion(events, id) }))}
      onIgnore={id => fixCalendarPlace(events => ({ events: ignorePlace(events, id) }))}
      onSearch={text => searchPlaceCandidates(text, calendarSearchCity(text, city), {quick:true, aiFallback:false})}
    />
  ) : null;

  return (
    <main
      ref={workspaceRef}
      
      className={`workspace theme-${mode} ${copilotOpen ? "assistant-open" : ""} ${!tripActive && !footprintActive && !activeOverlay ? "map-library-mode" : ""} ${workspaceCollapsed ? "workspace-is-collapsed" : ""} ${sidebarOpen ? "sheet-expanded" : "sheet-collapsed"} ${selectedPlace && !activeOverlay ? "has-detail" : ""} ${selectedPlace && !activeOverlay && !detailOrigin ? "has-place-detail" : ""} ${activeOverlay ? `overlay-${activeOverlay}` : ""}`}
    >
      <button
        className="workspace-collapse-toggle"
        aria-label={workspaceCollapsed ? "展开左侧面板" : "收起左侧面板"}
        title={workspaceCollapsed ? "展开左侧面板" : "收起左侧面板"}
        aria-expanded={!workspaceCollapsed}
        onClick={() => {
          cancelPendingWorkflow();
          setSettingsOpen(false);
          setWorkspaceCollapsed((value) => !value);
        }}
      >
        {workspaceCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
      </button>
      <div className="workspace-rail-surface" aria-hidden="true" />
      <OfflineNotice />
      {demoBannerNode && !compactLayout && demoBannerNode}
      <header className="workspace-header">
        {loadingWorkflow && <span className="workspace-loading-indicator" role="status"><span className="sr-only">正在打开页面</span></span>}
        <a
          className="wordmark"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setActiveFilter(defaultFilter);
            setGuidesHomeRequest(value => value + 1);
            showPlaces();
          }}
        >
          <svg className="wordmark-icon" aria-hidden="true" width="22" height="17" viewBox="0 1 32 23" fill="currentColor">
            <path d="M1.5 7.25 11.8 3l8.15 4.25v8l-1.25.5V8l-6.95-3.6L2.75 8v12l9.65-3.75 9.35 4.15 7.5-3.25V4.8l-8.3 3.15.58-1.47L30.5 3v15l-8.78 3.8-9.34-4.16L1.5 21.9Z" />
          </svg>
          <span>Wayline</span>
        </a>
        {!footprintActive && (
          <CityPicker
            activeCity={city.name}
            scope={tripActive ? "current" : cityScope}
            allowAll={!tripActive}
            cities={allCities}
            savedCityNames={Array.from(
              new Set(savedLocations.map((place) => place.city)),
            )}
            selection={selectedCityNames ?? [activeCity]}
            onSelectionChange={(chosen) => {
              explicitLocation.current = false;
              manualCityAt.current = Date.now();
              setLocationFocus(0);
              setSelectedPlace(null);
              setCustomCities(items => uniqueCities([...items, ...chosen.filter(c => !allCities.some(known => cityKey(known.name) === cityKey(c.name)))]));
              selectCities(chosen.map(c => c.name));
              setFocusNonce(n => n + 1);
            }}
            onChange={(chosen) => {
              if (!allCities.some((item) => item.name === chosen.name))
                setCustomCities((items) => [...items, chosen]);
              changeCity(chosen.name);
            }}
            onAll={() => {
              explicitLocation.current = false;
              manualCityAt.current = Date.now();
              setCityScope("all");
              setSelectedPlace(null);
              setLocationFocus(0);
            }}
            locating={currentLocation.status === "loading"}
            onLocate={requestCurrentLocation}
          />
        )}
        {demoActive && compactLayout && activeOverlay && (
          <button
            type="button"
            className="demo-exit-chip"
            onClick={leaveDemoWorkspace}
            aria-label="退出演示工作区"
          >
            退出演示
          </button>
        )}
        <button ref={mobileAssistant} type="button" className="mobile-assistant-entry icon-button" aria-label="问 Wayline"
          aria-expanded={copilotOpen} onClick={() => { setCopilotSeed(null); setCopilotOpen(true); }}>
          <MessageCircle size={19} aria-hidden="true" />
        </button>
      </header>
      <nav className="workspace-nav" aria-label="工作区">
        <button
          className={!tripActive && !footprintActive && activeOverlay !== "business-trips" && activeOverlay !== "history" ? "is-active" : ""}
          aria-current={!tripActive && !footprintActive && activeOverlay !== "business-trips" && activeOverlay !== "history" ? "page" : undefined}
          onClick={() => {
            setActiveFilter(defaultFilter);
            setGuidesHomeRequest(value => value + 1);
            showPlaces();
          }}
        >
          今天
        </button>
        <button
          className={tripActive || activeOverlay === "business-trips" ? "is-active" : ""}
          aria-current={tripActive || activeOverlay === "business-trips" ? "page" : undefined}
          onClick={showTrip}
        >
          行程
        </button>
        <button
          className={activeOverlay === "history" ? "is-active" : ""}
          aria-current={activeOverlay === "history" ? "page" : undefined}
          onClick={showHistory}
        >
          历史
        </button>
        <button
          className="is-aux"
          title="地点搜索与收藏"
          onClick={() => {
            setActiveFilter(defaultFilter);
            setGuidesHomeRequest(value => value + 1);
            showPlaces();
          }}
        >
          地点
        </button>
      </nav>
      <div className="workspace-map">
        <MapBoundary>
          <Suspense
            fallback={
              <div
                className="map-loading"
                role="status"
                aria-label="正在加载地图"
              >
                正在加载地图…
              </div>
            }
          >
            <MapView
              key={demoActive ? "demo-map" : "live-map"}
              demo={demoActive}
              city={city}
              places={footprintActive ? [] : showingBusinessTrip ? tripVisiblePlaces : activeOverlay === "history" ? historyMapPlaces : mapPlaces}
              selectedPlace={selectedPlace}
              onSelectPlace={showingBusinessTrip || showingHistoryTrip ? selectBusinessPlace : togglePlaceSelection}
              mode={mode}
              mapMode={mapMode}
              focusNonce={focusNonce}
              northCommand={northCommand}
              onRotationChange={setMapRotation}
              zoomCommand={zoomCommand}
              onZoomStateChange={setZoomState}
              routePlaces={showingBusinessTrip ? businessMapPlaces : showingHistoryTrip ? historyPlaces : activeOverlay === "history" ? historyMapPlaces : todayPlaces}
              todayRoutes={showingBusinessTrip ? (activeBusinessRoad ? [activeBusinessRoad] : noTripLines) : showingHistoryTrip ? noTripLines : todayRoutes}
              stayArea={activeStayArea}
              todayFocus={showingBusinessTrip ? activeBusinessRoad?.id : showingHistoryTrip ? null : focusedTodayLeg}
              routeOverview={!!activeOverlay || !!selectedPlace}
              routeFitCommand={showingBusinessTrip ? businessOverviewCommand : showingHistoryTrip ? historyOverviewCommand : 0}
              scopeCities={!tripActive && !showingBusinessTrip && !showingHistoryTrip && !showTodayOnMap && !footprintActive && cityScope === "selected"
                ? allCities.filter(city => selectedCityNames?.some(name => cityKey(name) === cityKey(city.name))) : undefined}
              myPosition={currentLocation.position}
              locationFocus={locationFocus}
              footprint={
                footprintActive
                  ? {
                      points: footprintPoints,
                      focusKey:
                        (footprintSelection.id ??
                          footprintTrack?.id ??
                          "empty") +
                        ":" +
                        footprintSelection.date +
                        ":" +
                        footprintSelection.nonce +
                        ":" +
                        (footprintPoints.length > 0),
                      label: footprintVisit?.name ?? (footprintTrack ? "最后记录位置" : "到访地点"),
                    }
                  : undefined
              }
            />
          </Suspense>
        </MapBoundary>
        {currentLocation.status === "error" &&
          currentLocation.source === "manual" &&
          !settingsOpen && (
            <div className="location-error-hint" role="status">
              <span>{currentLocation.message}</span>
              <button onClick={requestCurrentLocation}>重试</button>
            </div>
          )}
        {calendarHintNode && !compactLayout && calendarHintNode}
        <div className="map-controls">
          <MapCompass rotation={mapRotation} onReset={() => setNorthCommand(n => n + 1)} />
          <div className="map-control-group">
            <button
              aria-label={
                currentLocation.status === "loading"
                  ? "正在定位"
                  : "定位到我的位置"
              }
              title="定位到我的位置"
              disabled={currentLocation.status === "loading"}
              onClick={requestCurrentLocation}
            >
              {currentLocation.status === "loading" ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <Navigation size={18} strokeWidth={1.7} />
              )}
            </button>
            {!footprintActive && (
              <button
                aria-label={tripActive ? "回到搜索城市" : "回到当前城市"}
                title={
                  tripActive ? `回到搜索城市：${city.name}` : `回到${city.name}`
                }
                onClick={() => {
                  setSelectedPlace(null);
                  setFocusNonce((n) => n + 1);
                }}
              >
                <Crosshair size={18} />
              </button>
            )}
          </div>
          <div className="map-control-group map-zoom-controls">
            <button
              aria-label="放大地图"
              title="放大地图"
              disabled={!zoomState.canZoomIn}
              onClick={() => setZoomCommand((n) => n + 1)}
            >
              <Plus size={18} strokeWidth={1.7} aria-hidden="true" />
            </button>
            <button
              aria-label="缩小地图"
              title="缩小地图"
              disabled={!zoomState.canZoomOut}
              onClick={() => setZoomCommand((n) => n - 1)}
            >
              <Minus size={18} strokeWidth={1.7} aria-hidden="true" />
            </button>
          </div>
          <div className="map-control-group">
            <button
              aria-label="地图显示"
              data-map-settings
              aria-haspopup="dialog"
              aria-controls={settingsOpen ? "map-display-popover" : undefined}
              ref={settingsTrigger}
              {...settingsHover.props}
              aria-expanded={settingsOpen}
              title="地图显示"
              onClick={() => {
                settingsHover.cancel();
                const hovered = settingsHoverOrigin.current;
                settingsHoverOrigin.current = false;
                if (settingsOpen && hovered) settingsRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
                else setSettingsOpen(!settingsOpen);
              }}
            >
              <Layers2 size={20} />
            </button>
          </div>
        </div>
      </div>
      <DeferredWorkflow
        key={`footprints-${activeUser.id}`}
        active={activeOverlay === "footprints"}
      >
        <FootprintsPanel
          active={activeOverlay === "footprints"}
          recorder={footprints.recorder}
          snapshot={footprints.snapshot}
          loading={footprints.loading}
          error={footprints.error}
          places={savedLocations.filter((p) => !isSchedule(p))}
          selection={footprintSelection}
          onSelection={setFootprintSelection}
          onBack={() => returnFromWorkflow("footprints")}
        />
      </DeferredWorkflow>
      <Sidebar
        key={`sidebar-${activeUser.id}`}
        ownerId={activeUser.id}
        calendarHint={compactLayout ? calendarHintNode : undefined}
        demoBanner={compactLayout ? demoBannerNode : undefined}
        storageHealthy={
          storageHealthy && routeSaved && citiesSaved
        }
        onEditPlace={setEditPlace}
        
        
        
        activeCity={activeCity}
        selectedCities={selectedCities}
        activeFilter={activeFilter}
        detailOpen={!!selectedPlace && !activeOverlay && !detailOrigin}
        overviewRequest={guidesHomeRequest}
        onFilterChange={(filter) => {
          setActiveFilter(filter);
          setSelectedPlace(null);
        }}
        userPlaces={savedLocations}
        visitedPlaces={visitedResourcePlaces}
        onSelectPlace={togglePlaceSelection}
        placeAliases={placeAliases}
        onRemovePlaceAlias={phrase => {
          const next = {...placeAliases};
          delete next[phrase];
          try {
            writePlaceAliases(activeUser.id,next);
            setPlaceAliases(next);
            setDataRevision(value=>value+1);
          } catch { addToast("未能保存地点别名，请重试","error"); }
        }}
        todayPanel={todayVisible && <>
          {(googleCalendar.status?.configured || (googleCalendar.error && activeUser.method === "google")) && !googleCalendar.status?.lastSync && <div className="calendar-first-use">
            {account.status === "guest" && !googleCalendar.status?.connected
              ? <button type="button" className="text-action" onClick={() => void account.signIn().catch(error => addToast(error instanceof Error ? error.message : "暂时无法登录，请重试", "error"))}>用 Google 登录，连接日历</button>
              : (activeUser.method === "google" || googleCalendar.status?.connected) &&
                <GoogleCalendarConnection key={activeUser.id} connection={googleCalendar} />}
          </div>}
          {googleCalendar.status?.connected && googleCalendar.status.lastSync && !today && <p className="calendar-first-use field-help" role="status">
            {googleCalendar.error ? "日历同步未完成" : googleCalendar.status.events?.length ? "已同步 · 暂无可上图的日程" : "已同步 · 此时间范围内没有日程"}
          </p>}
          {(today || todayConflicts.length > 0) && <TodayPanel
          heading={!today ? "今天" : today.isToday ? `今天 · ${dayLabel.format(new Date(today.dateKey + "T00:00:00"))}`
            : `${workspaceEvents.some(event => !event.google?.stale && (demoActive ? eventDay(event) : localDateKey(event.start)) === effectiveTodayKey)
              ? "下一个有地点的日程" : "今天没有安排 · 下一天是"} ${today.nextLabel}`}
          onOpenSchedule={() => openWorkflow("schedule", () => {
            setScheduleOrigin(null);
            setActiveOverlay("schedule");
          }, "forward")}
          stops={todayStops}
          segments={todaySegments}
          loading={todayLoading}
          focused={focusedTodayLeg}
          onSelectStop={({ event, place }) => togglePlaceSelection(todayPlaces.find(item => samePlace(item, place)) ?? { ...place, calendarEventIds: [event.id] })}
          onChooseMode={chooseTodayMode}
          onRetry={() => setRetryTodayRoutes(count => count + 1)}
          conflicts={todayConflicts}
          actions={todayActions}
          onAction={runAction}
          now={demoActive ? demoNow : clockNow}
          onCompare={setCompareLeg}
          onBufferChange={chooseBuffer}
          nextStopId={todayStops.find(stop => Date.parse(stop.event.start)>=clockNow)?.event.id}
          syncWarning={!freshness.calendarCurrent && todayStops.some(stop => stop.event.google)}
          onNavigate={rememberLegFocus}
          onExplainAction={copilotStatus.enabled || demoActive ? (action) => {
            setCopilotSeed({ id: Date.now(), text: `请解释这条提醒：${action.title}`, example: demoActive ? `${action.problem} ${action.nextStep.label}` : undefined });
            setCopilotOpen(true);
          } : undefined}
          onFocus={id => {
            if (!calendarLayer) changeCalendarLayer(true);
            rememberLegFocus(focusedTodayLeg === id ? null : id);
          }}
        />}
        </>}
        isOpen={sidebarOpen}
        onToggleOpen={() => setSidebarOpen((v) => !v)}
        onSearchCity={(chosen) => {
          if (!allCities.some(item => item.name === chosen.name)) setCustomCities(items => [...items, chosen]);
          changeCity(chosen.name);
        }}
        getCachedSuggestions={keyword => cachedPlaceSuggestions(keyword, city, userLocation)}
        onSearchPlaces={(keyword, signal) => suggestPlaceCandidates(keyword, city, { reference: userLocation, signal })}
        onCreatePlace={createPlace}
        onDeletePlace={deletePlace}
        
        
        onOpenWorkspace={openOverlay}
        accountStatus={account.status}
 accountEmail={account.status === "signed-in" ? account.account.email : undefined}
        onNavigatePanel={presentWorkspace}
        openingEntry={loadingWorkflow}
        onOpenBusinessTrips={() => presentWorkspace(showTrip, "forward")}
        onOpenHistory={() => presentWorkspace(showHistory, "forward")}
        onHome={() => {
          setActiveFilter(defaultFilter);
          setGuidesHomeRequest(value => value + 1);
          showPlaces();
        }}
        onOpenSearch={showPlaces}
      />
      {activeOverlay === "business-trips" && <BusinessTripsPanel
        key={selectedBusinessTrip?.id ?? "trips"}
        home={effectiveBusinessSettings.home}
        onSchedule={() => openWorkflow("schedule", () => {
          setScheduleOrigin("business-trips");
          setActiveOverlay("schedule");
        })}
        timeline={selectedModel?.timeline}
        actions={tripActions}
        now={clockNow}
        openConnections={resumedCommute?.owner === activeUser.id && resumedCommute.tripId === selectedModel?.id}
        connections={selectedModel && selectedPlan && <>
          <BusinessTripCommute key={`${businessRevision}:${businessOverviewCommand}`} trip={selectedModel} freshness={freshness}
            bufferOverrides={bufferOverrides}
            initialChoice={resumedCommute?.owner === activeUser.id && resumedCommute.tripId === selectedModel.id ? resumedCommute.choice : undefined}
            onNavigate={choice => {
              try { sessionStorage.setItem(businessNavKey, JSON.stringify({tripId:selectedModel.id, choice})); } catch { /* retain the current view */ }
            }}
            onRoute={route => setBusinessRoad(route ? { revision:businessRevision, route } : null)} />
          <BusinessTripConnections key={activeUser.id}
          trip={selectedModel} legs={selectedPlan.legs} nights={selectedPlan.nights} places={bookingLocations}
          transfers={transfers} onTransfer={storeTransfer}
          onPlace={selectBusinessPlace}
          onArea={place => { setStayArea({ revision:stayRevision, place }); selectBusinessPlace(place, true); }} /></>}
        cities={uniqueCities([city, ...workspaceEvents.flatMap(event => event.place ? [{
          name: event.place.city, lat: event.place.lat, lng: event.place.lng, zoom: 12,
        }] : []), ...allCities])}
        trips={businessTrips}
        selected={selectedBusinessTrip}
        selectedEventIds={selectedPlace?.calendarEventIds}
        mapIndices={Object.fromEntries(businessPlaces.flatMap((place, index) =>
          (place.calendarEventIds ?? []).map(id => [id, index + 1])))}
        onHome={home => {
          if (cityKey(home) === cityKey(businessSettings.home) && (home || !effectiveBusinessSettings.home)) return;
          saveBusinessSettings({ home, boundaries: {}, inferHome: !!home });
          setBusinessSelection(null);
          setSelectedPlace(null);
        }}
        onTrip={id => presentWorkspace(() => {
          setSelectedPlace(null);
          setStayArea(null);
          setBusinessRoad(null);
          setBusinessSelection(id ? { owner: activeUser.id, id } : null);
        }, id ? "forward" : "back")}
        onBack={() => returnFromWorkflow("business-trips")}
        onEvent={id => {
          const place = businessPlaces.find(item => item.calendarEventIds?.includes(id));
          if (place) selectBusinessPlace(place);
        }}
        onOverview={() => {
          setStayArea(null);
          setBusinessRoad(null);
          setSelectedPlace(null);
          setResumedCommute(undefined);
          setBusinessOverviewCommand(value => value + 1);
        }}
        onBoundary={(id, value) => {
          const previous = selectedBusinessTrip && businessTrips[businessTrips.indexOf(selectedBusinessTrip) - 1];
          saveBusinessSettings({ ...businessSettings, boundaries: { ...businessSettings.boundaries, [id]: value } });
          setSelectedPlace(null);
          if (value === "join" && previous) setBusinessSelection({ owner: activeUser.id, id: previous.id });
        }}
      />}
      {activeOverlay === "history" && <HistoryPanel
        key={selectedHistoryTrip?.id ?? "history"}
        trips={pastTrips}
        selected={selectedHistoryTrip}
        selectedEventIds={selectedPlace?.calendarEventIds}
        mapIndices={historyMapIndices}
        timeline={historyTimeline}
        now={clockNow}
        onTrip={id => presentWorkspace(() => {
          setSelectedPlace(null);
          setHistorySelection(id ? { owner: activeUser.id, id } : null);
        }, id ? "forward" : "back")}
        onBack={() => returnFromWorkflow("history")}
        onEvent={id => {
          const place = historyPlaces.find(item => item.calendarEventIds?.includes(id));
          if (place) selectBusinessPlace(place);
        }}
        onOverview={() => {
          setSelectedPlace(null);
          setHistoryOverviewCommand(value => value + 1);
        }}
        onSchedule={() => openWorkflow("schedule", () => {
          setScheduleOrigin(null);
          setActiveOverlay("schedule");
        }, "forward")}
      />}
      {selectedPlace && !activeOverlay && (
        <Suspense
          fallback={
            <section className="workspace-panel workflow-loading" role="status">
              正在打开地点…
            </section>
          }
        >
          <PlaceCard
            key={selectedPlace.id}
            place={selectedPlace}
            calendarEvents={selectedPlace.calendarEventIds ? calendarEvents.filter(e => selectedPlace.calendarEventIds!.includes(e.id)) : []}
            returnLabel={
              detailOrigin === "schedule"
                  ? "返回日程"
                  : "返回地点列表"
            }
            onClose={() => presentWorkspace(() => {
              setSelectedPlace(null);
              if (detailOrigin) setActiveOverlay(detailOrigin);
              setDetailOrigin(null);
            })}
            onViewSchedule={() => openWorkflow("schedule", () => {
              setSelectedPlace(null);
              setActiveOverlay("schedule");
            })}
            onEdit={() =>
              isSchedule(selectedPlace)
                ? openWorkflow("schedule", () => {
                    setScheduleEdit(selectedPlace);
                    setActiveOverlay("schedule");
                    setSelectedPlace(null);
                  })
                : setEditPlace(
                    userPlaces.find((p) => samePlace(p, selectedPlace)) ??
                      selectedPlace,
                  )
            }
            savedPlace={userPlaces.find((p) => samePlace(p, selectedPlace))}
            onSave={() => savePlace(selectedPlace)}
            onMarkVisited={markVisited}
          />
        </Suspense>
      )}
      <DeferredWorkflow
        key={`account-workflow-${activeUser.id}`}
        active={activeOverlay === "account"}
      >
        <AuthPanel
          user={activeUser}
   accountStatus={account.status}
   accountEmail={account.status === "signed-in" ? account.account.email : undefined}
          syncState={workspaceSync.state}
          onUseCloudVersion={() => void workspaceSync.useCloudVersion()}
   onSignIn={() => void account.signIn().catch(error => addToast(error instanceof Error ? error.message : "暂时无法登录，请稍后重试", "error"))}
          onSignOut={() => void account.signOut().catch(() => addToast("退出未完成，请重试", "error"))}
          onReturnToAccount={() => {
            auxiliaryOrigin.current = [];
            setShowLocalSpace(false);
            setActiveOverlay(null);
          }}
          onDemo={() => enterDemoWorkspace()}
          onDeleteAccount={async () => {
            await deleteAccount();
            try {
              for (const key of Object.keys(localStorage)) {
                if (key.endsWith(`.${activeUser.id}`) || key === `wayline.businessTrips.${activeUser.id}` ||
                    key === `wayline.trash.${activeUser.id}`) localStorage.removeItem(key);
              }
            } catch { /* Online deletion already completed by the server. */ }
            await account.refresh();
            setActiveOverlay(null);
          }}
          onRestoreTrash={(place) => setUserPlaces(items => items.some(item => samePlace(item, place)) ? items : [place, ...items])}
          getFootprints={async () => {
            if (!footprints.recorder || footprints.snapshot.storageError) throw new Error("足迹尚未就绪");
            await footprints.recorder.flush();
            const data = footprints.recorder.getSnapshot();
            return { tracks: data.tracks, visits: data.visits };
          }}
          onLogin={(user) => {
            if (demoActive) { exitDemo(); setDemoActive(false); }
            if (user.id !== activeUser.id && footprints.snapshot.storageError) {
              addToast(
                "足迹尚未保存，请先导出备份并重试保存，再切换空间",
                "error",
              );
              return false;
            }
            if (user.id !== activeUser.id) auxiliaryOrigin.current = [];
            if (accountReady) setShowLocalSpace(true);
            if (user.id !== activeUser.id) setActiveUser(user);
            return true;
          }}
          open={activeOverlay === "account"}
          onClose={() => presentWorkspace(closeAuxiliary)}
        />
      </DeferredWorkflow>
      
      <DeferredWorkflow
        key={`schedule-workflow-${activeUser.id}`}
        active={activeOverlay === "schedule"}
      >
        <ScheduleAssistant
          open={activeOverlay === "schedule"}
          activeCity={activeCity}
          key={`schedule-${activeUser.id}`}
          places={userPlaces}
          contextPlaces={routePlaces}
          calendarEvents={calendarEvents}
          googleCalendar={googleCalendar}
          onGoogleSignIn={account.signIn}
          gmailAccount={activeUser.method === "google" && account.status === "signed-in" ? account.account.email : undefined}
          onCalendarChange={incoming=>commitCalendarEvents(mergeCalendarEntries(calendarCurrent.current.events,incoming))}
          onCalendarImport={incoming => {
            const current = calendarCurrent.current.events;
            const result = planCalendarImport(current, incoming);
            if (result.changes.length) commitCalendarEvents(mergeCalendarEntries(current, result.changes));
            return result;
          }}
          onCalendarRemove={id=>{
            const target=calendarCurrent.current.events.find(event=>event.id===id);
            // An imported event is suppressed by source key; a local schedule is removed outright.
            commitCalendarEvents(target?.google
              ? calendarCurrent.current.events.map(event=>event.id===id?suppressCalendarEntry(event,"user"):event)
              : calendarCurrent.current.events.filter(event=>event.id!==id));
          }}
          onClose={() => presentWorkspace(() => setActiveOverlay(scheduleOrigin))}
          backLabel={scheduleOrigin === "business-trips" ? "返回行程" : "返回地点"}
          editSchedule={scheduleEdit}
          onEditSchedule={setScheduleEdit}
          onSelectPlace={(place) => presentWorkspace(() => {
            setSelectedPlace(place);
            setActiveOverlay(null);
            setDetailOrigin("schedule");
            setActiveCity(place.city);
            setFocusNonce((n) => n + 1);
          }, "forward")}
          onDeletePlace={deletePlace}
          onUpdateSchedule={(place) => updatePlace(place)}
          onCreateSchedule={createSchedulePlace}
          onCreateSchedules={createSchedulePlaces}
          owner={activeUser.id}
          onSearchPlaces={async (keyword) =>
            searchPlaceCandidates(keyword, calendarSearchCity(keyword, city))
          }
        />
      </DeferredWorkflow>
      {settingsOpen && (
        <section
          ref={settingsRef}
          {...settingsHover.props}
          className="settings-popover surface-popover"
          id="map-display-popover"
          style={{position:"fixed",...settingsPosition,right:"auto",bottom:"auto"}}
          role="dialog"
          aria-label="地图显示"
        >
          <div className="panel-heading">
            <h2>地图显示</h2>
            <button
              className="icon-button"
              aria-label="关闭地图显示"
              onClick={closeMapSettings}
            >
              <X size={17} />
            </button>
          </div>
          <MapDisplayOptions
            mapMode={mapMode}
            onMapModeChange={setMapMode}
            activeLayers={activeLayers}
            onToggleLayers={toggleLayers}
            showLayers={!footprintActive}
            multiCity={cityScope !== "current"}
            calendarLayer={calendarLayer}
            onCalendarLayerChange={changeCalendarLayer}
            trip={showingBusinessTrip}
            placeLayers={placeLayers}
            onPlaceLayerChange={(layer, on) => setPlaceLayers(previous => ({...previous, [layer]:on}))}
          />
          {!footprintActive && !showingBusinessTrip && resourceSearchError && <p className="field-help" role="status">{resourceSearchError}</p>}
        </section>
      )}
      {editPlace && (
        <Suspense
          fallback={
            <div className="editor-backdrop" role="status">
              正在打开编辑…
            </div>
          }
        >
          <PlaceEditor
            key={editPlace.id}
            place={editPlace}
            
            onClose={() => setEditPlace(null)}
            onSave={(place) => {
              updatePlace(place);
              setEditPlace(null);
              addToast("地点已更新", "success");
            }}
          />
        </Suspense>
      )}
      <CopilotPanel
        key={activeUser.id}
        open={copilotOpen}
        onOpenChange={open => {
          if (open) setCopilotSeed(null);
          setCopilotOpen(open);
          if (!open && compactLayout) requestAnimationFrame(() => mobileAssistant.current?.focus());
        }}
        status={copilotStatus}
        context={copilotContext}
        owner={activeUser.id}
        demo={demoActive}
        seed={copilotSeed}
        onApply={applyCopilotProposal}
      />
    </main>
  );
}

function inferCityFromPlace(
  place: Place,
  knownCities: CityName[],
  fallback: CityName,
): CityName {
  return storedPlaceCity(place,knownCities,fallback);
}





function needsOfficialAddress(address: string) {
  return (
    !address ||
    /附近|候选|行政区|行政中心区域|官方交通枢纽|核心商务片区|官方校区|核心商业片区|官方景区|餐饮门店|地点$/.test(
      address,
    )
  );
}

function normalizeOpeningHours(place: Place) {
  if (place.openingHours && !/以现场|全天开放/.test(place.openingHours))
    return place.openingHours;
  if (place.category === "transport")
    return "以车站、机场或口岸当日运营时间为准";
  if (place.category === "shopping") return "以商场或街区官方公告为准";
  if (place.category === "university") return "以校方开放管理公告为准";
  if (place.category === "attraction") return "以景区或场馆官方公告为准";
  if (place.category === "food") return "以门店当日营业时间为准";
  return "以官方公告为准";
}

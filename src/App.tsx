import { BusinessTripCommute } from "./components/BusinessTripCommute";
import { BusinessTripConnections } from "./components/BusinessTripConnections";
import { assignTripBookings, collectTripBookings, inferBookingHome } from "./lib/businessOrders";
import { useBookingPlaces, bookingPlaceKey } from "./lib/useBookingPlaces";
import { useTripMailbox } from "./lib/useTripMailbox";
import {storedPlaceCity} from "./lib/placeCity";
import { useGoogleCalendar } from "./lib/useGoogleCalendar";
import { mergeGoogleSnapshot, reconcileCalendarRoute, persistCalendarState } from "./lib/googleCalendarSync";
import { useWorkspaceMotion } from "./lib/useWorkspaceMotion";
import { mapPopoverPosition } from "./lib/mapPopoverPosition";
import { readCalendarEntries, mergeCalendarEntries } from "./lib/calendarEvents";
import { readPlaceAliases, writePlaceAliases, type PlaceAliases } from "./lib/placeAliases";
import { useCalendarPlaces } from "./lib/useCalendarPlaces";
import { calendarMapPlaces, pendingPlaces, confirmPlace, acceptSuggestion, rejectSuggestion, ignorePlace } from "./lib/calendarPlaces";
import { CalendarPlaceHint } from "./components/CalendarPlaceHint";
import { TodayPanel, type TodaySegment } from "./components/TodayPanel";
import { judgeLeg, legPairs, localDateKey, pickDay, stopsOfDay, type TodayLegPair, type TravelMode } from "./lib/todayMap";
import { useTodayLegs, type LegResult } from "./lib/useTodayLegs";
import { BusinessTripsPanel } from "./components/BusinessTripsPanel";
import { groupBusinessTrips, readBusinessTripSettings, tripPlaces, writeBusinessTripSettings, type BusinessTripSettings } from "./lib/businessTrips";
const calendarLayerKey = (owner: string) => `whatto.mapCalendarLayer.${owner}`;
const readCalendarLayer = (owner: string) => { try { return localStorage.getItem(calendarLayerKey(owner)) !== "off"; } catch { return true; } };
const placePairKey = (pair: TodayLegPair) => JSON.stringify([pair.from.place.id, pair.to.place.id]);
const dayLabel = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" });
const noTripLines: [] = [];
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  seedCities,
} from "./data/seedCityResources";
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
  "account" | "schedule" | "footprints" | "business-trips";

export default function App() {
  const mode = useMapAppearance();
  const [mapMode, setMapMode] = useState<MapMode>("explore");
  const [activeOverlay, commitOverlay] = useState<OverlayPanel | null>(null);
  const [loadingWorkflow, setLoadingWorkflow] = useState<keyof typeof workspaceWorkflows | null>(null);
  const workflowRequest = useRef(0);
  const panelTransition = useRef<ViewTransition | null>(null);
  const cancelPendingWorkflow = () => {
    workflowRequest.current++;
    setLoadingWorkflow(null);
  };
  const setActiveOverlay = (panel: OverlayPanel | null) => {
    cancelPendingWorkflow();
    commitOverlay(panel);
  };
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
  const closeMapSettings = () => {
    setSettingsOpen(false);
    settingsTrigger.current?.focus({ preventScroll: true });
  };
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
  },[settingsOpen]);
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
  // Signed in → the account's own owner; otherwise the local space or guest (never a stale account).
  const accountKey = account.status === "signed-in" ? account.account.id : "";
  const signedInUser = useMemo(() => (account.status === "signed-in" ? accountUser(account.account) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountKey]);
  // Bumped whenever the shown owner's data changes; drives the debounced cloud push.
  const [dataRevision, setDataRevision] = useState(0);
  const workspaceSync = useWorkspaceSync({
    account: signedInUser,
    pausePush: showLocalSpace,
    changeKey: String(dataRevision),
    readFootprints: async owner => { const store = await openFootprintStore(owner); try { return await store.load(); } finally { store.close(); } },
    writeFootprints: async (owner, data) => { const store = await openFootprintStore(owner); try { await store.importData(data); } finally { store.close(); } },
    onReloaded: () => { try { sessionStorage.setItem("wayline.syncNotice", "1"); } catch { /* notice is optional */ } window.location.reload(); },
    onSignedOut: () => void account.refresh(),
  });
  // The account becomes the shown owner only once its cloud copy is in local storage.
  const accountReady = !!signedInUser && workspaceSync.readyOwner === signedInUser.id;
  const activeUser = useMemo(() => chooseActiveUser(accountReady && !showLocalSpace ? account : {status: "loading"}, localUser),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountReady, accountKey, localUser, showLocalSpace]);
  const mailbox = useTripMailbox(activeUser.method === "google" ? accountKey : undefined);
  const [calendarEvents, setCalendarEvents] = useState(()=>readCalendarEntries(activeUser.id));
  const [tripSettingsOverride, setTripSettingsOverride] = useState<{ owner: string; settings: BusinessTripSettings }>();
  const [businessSelection, setBusinessSelection] = useState<{ owner: string; id: string } | null>(null);
  const businessSettings = useMemo(() => tripSettingsOverride?.owner === activeUser.id
    ? tripSettingsOverride.settings : readBusinessTripSettings(activeUser.id), [activeUser.id, tripSettingsOverride]);
  const saveBusinessSettings = (settings: BusinessTripSettings) => {
    try { writeBusinessTripSettings(activeUser.id, settings); }
    catch { addToast("出差设置暂时无法保存，关闭页面后可能丢失", "error"); }
    setTripSettingsOverride({ owner: activeUser.id, settings });
    if (activeUser.method === "google") setDataRevision(value => value + 1);
  };
  const [todayKey, setTodayKey] = useState(() => localDateKey(new Date()));
  useEffect(() => {
    const update = () => setTodayKey(localDateKey(new Date()));
    const timer = window.setInterval(update, 30_000);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, []);
  const [legPreference, setLegPreference] = useState<{ owner: string; values: Record<string, TravelMode> }>();
  const [focusedTodayLeg, setFocusedTodayLeg] = useState<string | null>(null);
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
  
  const currentLocation = useCurrentLocation();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!workspaceSync.offerMigration) return;
    workspaceSync.dismissMigration();
    addToast("这台浏览器里有游客数据，要迁入你的账号吗？", "info", { label: "迁入", onClick: () => void workspaceSync.migrateGuest(), dismissLabel: "不用" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSync.offerMigration]);
  useEffect(() => {
    if (workspaceSync.state !== "conflict") return;
    addToast("另一台设备有更新，已载入最新内容", "info");
    workspaceSync.acknowledgeConflict();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSync.state]);

  const seededExtraCities = useMemo(
    () =>
      seedCities.filter(
        (seedCity) =>
          !cities.some((coreCity) => coreCity.name === seedCity.name),
      ),
    [],
  );
  const allCities = useMemo(
    () =>
      uniqueCities([
        ...cityCatalog,
        ...seededExtraCities,
        ...customCities,
        ...(detectedCity ? [detectedCity] : []),
        ...[...userPlaces, ...routePlaces].map((place) => ({
          name: place.city,
          lat: place.lat,
          lng: place.lng,
          zoom: 12,
        })),
      ]),
    [customCities, seededExtraCities, detectedCity, userPlaces, routePlaces],
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
    setCalendarEvents(next.events);setRoutePlaces(next.route);
  };
  const googleCalendar=useGoogleCalendar(activeUser.id,async(incoming,connectionId,signal)=>{
    if(signal.aborted)return;
    // Places are resolved afterwards by useCalendarPlaces; a changed location drops its old coordinates in the merge.
    const current=calendarCurrent.current;
    const next=mergeGoogleSnapshot(current.events,incoming,connectionId);
    if(JSON.stringify(next)!==JSON.stringify(current.events)||JSON.stringify(reconcileCalendarRoute(current.route,current.events,next).route)!==JSON.stringify(current.route))commitCalendarEvents(next);
  });
  useEffect(() => {
    if (!selectedPlace?.calendarEventIds?.length) return;
    const eventIds = selectedPlace.calendarEventIds.filter(id =>
      calendarEvents.some(event => event.id === id && event.place && samePlace(event.place, selectedPlace)));
    if (!eventIds.length) {
      setSelectedPlace(null);
      setDetailOrigin(null);
    } else if (eventIds.length !== selectedPlace.calendarEventIds.length) {
      setSelectedPlace({ ...selectedPlace, calendarEventIds: eventIds });
    }
  }, [calendarEvents, selectedPlace]);
  const todayDate = useMemo(() => new Date(todayKey + "T00:00:00"), [todayKey]);
  useCalendarPlaces({owner:activeUser.id,events:calendarEvents,aliases:placeAliases,city:String(city.name),day:todayKey,commit:events=>commitCalendarEvents(events)});
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
    if (url.searchParams.has("calendar") || gmailResult) {
      setScheduleOrigin("business-trips");
      setActiveOverlay("schedule");
      if (gmailResult === "denied") addToast("未连接 Gmail", "info");
      url.searchParams.delete("calendar");
      url.searchParams.delete("gmail");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  },[]);
  const resourceCity = cityScope === "current" && activeOverlay !== "footprints" ? city.name : "";
  useEffect(() => {
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
  }, [resourceCity, activeLayers]);
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
  const closeAuxiliary = () => {
    const origin = auxiliaryOrigin.current.pop();
    setActiveOverlay(origin?.overlay ?? null);
    setSelectedPlace(origin?.place ?? null);
    setDetailOrigin(origin?.detail ?? null);
  };
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


  const today = useMemo(() => pickDay(calendarEvents, todayDate), [calendarEvents, todayDate]);
  const todayStops = useMemo(() => today ? stopsOfDay(calendarEvents, today.dateKey) : [], [calendarEvents, today]);
  const pairs = useMemo(() => today ? legPairs(calendarEvents, today.dateKey) : [], [calendarEvents, today]);
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
  const chooseTodayMode = (pair: TodayLegPair, mode: TravelMode) => {
    const values = { ...preferences, [placePairKey(pair)]: mode };
    setLegPreference({ owner: activeUser.id, values });
    try { localStorage.setItem(legModeKey, JSON.stringify(values)); } catch { /* retain the selection for this session */ }
  };
  const todayVisible = !activeOverlay && !tripActive;
  const { legs: todayLegResults, loading: todayLoading } = useTodayLegs({
    pairs: todayVisible ? pairs : [], choices, owner: activeUser.id, retryCount: retryTodayRoutes,
  });
  const todaySegments = useMemo<TodaySegment[]>(() => pairs.map(pair => {
    const mode = choices[pair.id];
    const options = Object.values(todayLegResults[pair.id] ?? {});
    return { pair, mode, result: todayLegResults[pair.id]?.[mode], verdict: judgeLeg(pair, options, mode) };
  }), [pairs, choices, todayLegResults]);
  const showTodayOnMap = todayVisible && calendarLayer && todayStops.length > 0;
  const todayRoutes = useMemo(() => showTodayOnMap ? todaySegments.flatMap(({ pair, result, verdict }) =>
    result ? [{ id: pair.id, points: result.points, late: verdict.status === "late" || verdict.status === "overlap" }] : []
  ) : undefined, [showTodayOnMap, todaySegments]);
  const todayPlaces = useMemo(() => showTodayOnMap ? todayStops
    .filter((stop, index, stops) => stops.findIndex(item => samePlace(item.place, stop.place)) === index)
    .map(stop => ({ ...stop.place, calendarEventIds: todayStops.filter(item => samePlace(item.place, stop.place)).map(item => item.event.id) })) : [], [showTodayOnMap, todayStops]);
  const bookingCities = useMemo(() => allCities.map(city => city.name), [allCities]);
  const tripBookings = useMemo(() => collectTripBookings(calendarEvents, mailbox?.orders ?? [], mailbox?.bookings ?? [], bookingCities),
    [calendarEvents, mailbox, bookingCities]);
  const effectiveBusinessSettings = useMemo(() => ({ ...businessSettings,
    home: businessSettings.home || (businessSettings.inferHome !== false ? inferBookingHome(tripBookings) : "") || "" }), [businessSettings, tripBookings]);
  const businessTrips = useMemo(() => groupBusinessTrips(calendarEvents, effectiveBusinessSettings, todayKey),
    [calendarEvents, effectiveBusinessSettings, todayKey]);
  const bookingPlan = useMemo(() => assignTripBookings(businessTrips, effectiveBusinessSettings.home, tripBookings),
    [businessTrips, effectiveBusinessSettings.home, tripBookings]);
  const selectedBusinessTrip = businessSelection?.owner === activeUser.id
    ? businessTrips.find(item => item.id === businessSelection.id) : undefined;
  const selectedPlan = selectedBusinessTrip && bookingPlan.get(selectedBusinessTrip.id);
  const bookingPoints = useMemo(() => [...(selectedPlan?.legs ?? []), ...(selectedPlan?.nights ?? [])]
    .flatMap(entry => entry.orders.flatMap(order => order.from ? [order.from, order.to] : [order.to])), [selectedPlan]);
  const bookingLocations = useBookingPlaces(activeOverlay === "business-trips" ? bookingPoints : [], activeUser.id);
  const businessRevision = selectedBusinessTrip ? JSON.stringify(selectedBusinessTrip.days.map(day =>
    day.events.map(event => [event.id,event.start,event.end,event.place.lat,event.place.lng]))) : "";
  const stayRevision = JSON.stringify([businessRevision, selectedPlan?.nights, bookingLocations]);
  const [stayArea, setStayArea] = useState<{ revision: string; place: Place } | null>(null);
  const activeStayArea = activeOverlay === "business-trips" && stayArea?.revision === stayRevision ? stayArea?.place : undefined;
  const [businessOverviewCommand, setBusinessOverviewCommand] = useState(0);
  const [businessRoad, setBusinessRoad] = useState<{ revision:string; route:{ id:string; points:LegResult["points"]; late:false } } | null>(null);
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
  const selectBusinessPlace = (place: Place, keepArea = false) => {
    if (!keepArea) setStayArea(null);
    setLocationFocus(0);
    setSelectedPlace(place);
    setFocusNonce(value => value + 1);
  };

  const calendarOnMap = useMemo(
    () => (calendarLayer ? calendarMapPlaces(calendarEvents, { now: todayDate }) : []),
    [calendarEvents, calendarLayer, todayDate],
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
      else if (activeOverlay) setActiveOverlay(null);
      else {
        setSelectedPlace(null);
        if (detailOrigin) setActiveOverlay(detailOrigin);
        setDetailOrigin(null);
      }
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [activeOverlay, settingsOpen, detailOrigin, scheduleOrigin, businessSelection]);

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
    saveActiveUser(activeUser);
    setEditPlace(null);
    setScheduleEdit(null);
    skipNextPersist.current = true;
    setUserPlaces(loadUserPlaces(activeUser));
    setCalendarEvents(readCalendarEntries(activeUser.id));
    setPlaceAliases(readPlaceAliases(activeUser.id));
    setCalendarLayer(readCalendarLayer(activeUser.id));
    setPlaceLayers({ saved: true, visited: false, booked: true });
    setSelectedPlace(null);
    setActiveFilter(defaultFilter);
  }, [activeUser]);

  useEffect(() => {
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    setStorageHealthy(saveUserPlaces(activeUser, userPlaces));
  }, [activeUser, userPlaces]);

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

  

  const deletePlace = (placeId: string) => {
    const target = userPlaces.find((place) => place.id === placeId);
    setUserPlaces((places) => places.filter((place) => place.id !== placeId));
    setSelectedPlace((place) => (place?.id === placeId ? null : place));
    if (target)
      addToast(
        isSchedule(target)
          ? `已删除日程「${target.name}」`
          : `已从地点库移除「${target.name}」`,
        "info",
        {
          label: "撤销",
          onClick: () =>
            setUserPlaces((items) =>
              items.some((p) => samePlace(p, target))
                ? items
                : [target, ...items],
            ),
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
  const returnFromWorkflow = (destination: "footprints" | "business-trips") => presentWorkspace(() => {
    if (destination === "business-trips") setBusinessSelection(null);
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
  const showFootprints = (fromLibrary = false) => openWorkflow("footprints", () => {
    setWorkspaceCollapsed(false);
    setLocationFocus(0);
    auxiliaryOrigin.current = [];
    setSelectedPlace(null);
    setDetailOrigin(null);
    setSettingsOpen(false);
    setActiveOverlay("footprints");
  }, fromLibrary ? "forward" : undefined);
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
    activeOverlay,
    selectedPlace,
    allCities,
  ]);

  return (
    <main
      ref={workspaceRef}
      
      className={`workspace theme-${mode} ${!tripActive && !footprintActive && !activeOverlay ? "map-library-mode" : ""} ${workspaceCollapsed ? "workspace-is-collapsed" : ""} ${sidebarOpen ? "sheet-expanded" : "sheet-collapsed"} ${selectedPlace && !activeOverlay ? "has-detail" : ""} ${selectedPlace && !activeOverlay && !detailOrigin ? "has-place-detail" : ""} ${activeOverlay ? `overlay-${activeOverlay}` : ""}`}
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

      </header>
      <nav className="workspace-nav" aria-label="工作区">
        <button
          className={!tripActive && !footprintActive && activeOverlay !== "business-trips" ? "is-active" : ""}
          aria-current={!tripActive && !footprintActive && activeOverlay !== "business-trips" ? "page" : undefined}
          onClick={() => {
            setActiveFilter(defaultFilter);
            setGuidesHomeRequest(value => value + 1);
            showPlaces();
          }}
        >
          地点
        </button>
        <button
          className={tripActive || activeOverlay === "business-trips" ? "is-active" : ""}
          aria-current={tripActive || activeOverlay === "business-trips" ? "page" : undefined}
          onClick={showTrip}
        >
          行程
        </button>
        <button
          className={footprintActive ? "is-active" : ""}
          aria-current={footprintActive ? "page" : undefined}
          onClick={() => showFootprints()}
        >
          足迹
          {footprints.snapshot.tracks.some(
            (t) =>
              t.id === footprints.snapshot.activeId && t.status === "recording",
          ) && (
            <span
              className="recording-dot is-recording"
              aria-label="正在记录"
            />
          )}
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
              city={city}
              places={footprintActive ? [] : showingBusinessTrip ? tripVisiblePlaces : mapPlaces}
              selectedPlace={selectedPlace}
              onSelectPlace={showingBusinessTrip ? selectBusinessPlace : togglePlaceSelection}
              mode={mode}
              mapMode={mapMode}
              focusNonce={focusNonce}
              northCommand={northCommand}
              onRotationChange={setMapRotation}
              zoomCommand={zoomCommand}
              onZoomStateChange={setZoomState}
              routePlaces={showingBusinessTrip ? businessMapPlaces : todayPlaces}
              todayRoutes={showingBusinessTrip ? (activeBusinessRoad ? [activeBusinessRoad] : noTripLines) : todayRoutes}
              stayArea={activeStayArea}
              todayFocus={showingBusinessTrip ? activeBusinessRoad?.id : focusedTodayLeg}
              routeOverview={!!activeOverlay || !!selectedPlace}
              routeFitCommand={showingBusinessTrip ? businessOverviewCommand : 0}
              scopeCities={!tripActive && !showingBusinessTrip && !showTodayOnMap && !footprintActive && cityScope === "selected"
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
        {!footprintActive && (
          <CalendarPlaceHint
            pending={pendingCalendarPlaces}
            onConfirm={(id, place) => fixCalendarPlace(events => confirmPlace(events, placeAliases, id, place))}
            onAccept={id => fixCalendarPlace(events => ({ events: acceptSuggestion(events, id) }))}
            onReject={id => fixCalendarPlace(events => ({ events: rejectSuggestion(events, id) }))}
            onIgnore={id => fixCalendarPlace(events => ({ events: ignorePlace(events, id) }))}
            onSearch={text => searchPlaceCandidates(text, calendarSearchCity(text, city))}
          />
        )}
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
        todayPanel={todayVisible && today && <TodayPanel
          heading={today.isToday ? `今天 · ${dayLabel.format(new Date(today.dateKey + "T00:00:00"))}`
            : `${calendarEvents.some(event => !event.google?.stale && localDateKey(event.start) === todayKey)
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
          onFocus={id => {
            if (!calendarLayer) changeCalendarLayer(true);
            setFocusedTodayLeg(current => current === id ? null : id);
          }}
        />}
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
        onOpenFootprints={() => showFootprints(true)}
        onOpenSearch={showPlaces}
      />
      {activeOverlay === "business-trips" && <BusinessTripsPanel
        key={selectedBusinessTrip?.id ?? "trips"}
        home={effectiveBusinessSettings.home}
        onSchedule={() => openWorkflow("schedule", () => {
          setScheduleOrigin("business-trips");
          setActiveOverlay("schedule");
        })}
        connections={selectedBusinessTrip && selectedPlan && <>
          <BusinessTripCommute key={`${businessRevision}:${businessOverviewCommand}`} trip={selectedBusinessTrip}
            onRoute={route => setBusinessRoad(route ? { revision:businessRevision, route } : null)} />
          <BusinessTripConnections
          trip={selectedBusinessTrip} legs={selectedPlan.legs} nights={selectedPlan.nights} places={bookingLocations}
          onPlace={selectBusinessPlace}
          onArea={place => { setStayArea({ revision:stayRevision, place }); selectBusinessPlace(place, true); }} /></>}
        cities={uniqueCities([city, ...calendarEvents.flatMap(event => event.place ? [{
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
          setBusinessOverviewCommand(value => value + 1);
        }}
        onBoundary={(id, value) => {
          const previous = selectedBusinessTrip && businessTrips[businessTrips.indexOf(selectedBusinessTrip) - 1];
          saveBusinessSettings({ ...businessSettings, boundaries: { ...businessSettings.boundaries, [id]: value } });
          setSelectedPlace(null);
          if (value === "join" && previous) setBusinessSelection({ owner: activeUser.id, id: previous.id });
        }}
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
   onSignIn={() => void account.signIn().catch(error => addToast(error instanceof Error ? error.message : "暂时无法登录，请稍后重试", "error"))}
          onSignOut={() => void account.signOut().catch(() => addToast("退出未完成，请重试", "error"))}
          onReturnToAccount={() => {
            auxiliaryOrigin.current = [];
            setShowLocalSpace(false);
            setActiveOverlay(null);
          }}
          getFootprints={async () => {
            if (!footprints.recorder || footprints.snapshot.storageError) throw new Error("足迹尚未就绪");
            await footprints.recorder.flush();
            const data = footprints.recorder.getSnapshot();
            return { tracks: data.tracks, visits: data.visits };
          }}
          onLogin={(user) => {
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
          gmailAccount={activeUser.method === "google" && account.status === "signed-in" ? account.account.email : undefined}
          onCalendarChange={incoming=>commitCalendarEvents(mergeCalendarEntries(calendarCurrent.current.events,incoming))}
          onCalendarRemove={id=>commitCalendarEvents(calendarCurrent.current.events.filter(e=>e.id!==id))}
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

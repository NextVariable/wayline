import { readRecentPlaceSearches, addRecentPlaceSearch, writeRecentPlaceSearches } from "../lib/recentPlaceSearches";
import { AccountEntry } from "./AccountEntry";
import type { AccountState } from "../lib/account";
import { cityCatalog } from "../data/cities";
import { cityMatches } from "../lib/citySelection";
import { samePlace } from "../lib/placeIdentity";
import {
  Bookmark,
  Check,
  Loader2,
  MapPin,
  Pencil,
  Search,
  Trash2,
  
  X,
  Building2,
  GraduationCap,
  TrainFront,
  Utensils,
  ShoppingBag,
  Trees,
  ChevronLeft,
  ChevronRight,
  ListFilter,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getCitiesGuidePlaces, groupSavedPlacesByCity, placeBelongsToGuide, savedPlaceAddress } from "../lib/guideFilters";
import type {
  CityName,
  Place,
  PlaceCategory,
  PlaceStatus,
  City,
} from "../types/place";
import { useToast } from "./Toast";
import { ActionMenu } from "./ActionMenu";
import { LibraryHoverEntry } from "./LibraryHoverEntry";
export type UserFilter =
  | { kind: "status"; value: PlaceStatus | "all"; label: string }
  | { kind: "category"; value: PlaceCategory; label: string }
  | {
      kind: "combined";
      value: "food_shopping";
      categories: PlaceCategory[];
      label: string;
    }
  
  | { kind: "routes"; value: "routes"; label: string };

const filters: UserFilter[] = [
  { kind: "status", value: "all", label: "全部地点" },
  { kind: "category", value: "business", label: "商务办公" },
  { kind: "category", value: "transport", label: "交通枢纽" },
  { kind: "status", value: "visited", label: "已到访" },
];

const categoryIcons = {
  business: Building2,
  university: GraduationCap,
  transport: TrainFront,
  food: Utensils,
  shopping: ShoppingBag,
  attraction: Trees,
  custom: MapPin,
};

type Props = {
  todayPanel?: React.ReactNode;
  calendarHint?: React.ReactNode;
  demoBanner?: React.ReactNode;
  placeAliases?: Record<string, Place>;
  onRemovePlaceAlias?: (phrase:string) => void;
  ownerId: string;
  activeCity: CityName;
  selectedCities: CityName[];
  activeFilter: UserFilter;
  detailOpen: boolean;
  overviewRequest: number;
  onFilterChange: (filter: UserFilter) => void;
  userPlaces: Place[];
  visitedPlaces: Place[];
  onSelectPlace: (place: Place) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  onSearchPlaces: (query: string, signal?: AbortSignal) => Promise<Place[]>;
  onSearchCity?: (city: City) => void;
  getCachedSuggestions?: (query: string) => Place[] | undefined;
  onCreatePlace: (place: Place) => void;
  onDeletePlace: (id: string) => void;
  onEditPlace: (place: Place) => void;
  
  storageHealthy: boolean;
  
  
  onOpenWorkspace?: () => void;
  accountStatus?: AccountState["status"];
  accountEmail?: string;
  onOpenBusinessTrips?: () => void;
  onOpenHistory?: () => void;
  onHome?: () => void;
  onOpenSearch: () => void;
  onNavigatePanel: (update: () => void, direction?: "forward" | "back") => void;
  openingEntry?: string | null;
};
export function Sidebar(props: Props) {
    const { activeCity, selectedCities, userPlaces } = props;
  // A filter kind this version no longer offers (e.g. an old user guide) falls back to all saved places.
  const activeFilter: UserFilter = ["status", "category", "combined", "routes"].includes(props.activeFilter.kind) ? props.activeFilter : filters[0];
  const [recent, setRecent] = useState<Place[]>(() => readRecentPlaceSearches(props.ownerId));
  
  const [query, setQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [searchAttempt, setSearchAttempt] = useState(0);
  
  const [composing, setComposing] = useState(false);
  const [browsingAll, setBrowsingAll] = useState(false);
  
  useEffect(() => {
    setBrowsingAll(false);
    setQuery("");
  }, [props.overviewRequest]);
  const input = useRef<HTMLInputElement>(null);
  const suggestionsId = useId();
  const openSearch = useRef(props.onOpenSearch);
  openSearch.current = props.onOpenSearch;
  const search = useRef(props.onSearchPlaces);
  search.current = props.onSearchPlaces;
  const cachedSuggestions = useRef(props.getCachedSuggestions);
  cachedSuggestions.current = props.getCachedSuggestions;
  const { addToast } = useToast();
  useEffect(() => {
    let frame = 0;
    const focus = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.isComposing ||
        (target instanceof Element && target.closest('[aria-modal="true"]'))
      )
        return;
      const editing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (!(
        (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) ||
        (event.key === "/" && !editing && !event.metaKey && !event.ctrlKey)
      ))
        return;
      event.preventDefault();
      openSearch.current();
      frame = requestAnimationFrame(() => input.current?.focus());
    };
    document.addEventListener("keydown", focus);
    return () => {
      document.removeEventListener("keydown", focus);
      cancelAnimationFrame(frame);
    };
  }, []);
  const citySuggestions = query.trim() && props.onSearchCity
    ? cityCatalog.filter(city => cityMatches(city, query)).slice(0, 4) : [];
  const exactCity = citySuggestions.find(city => city.name === query.trim().replace(/市$/, ""));
  const chooseSearchCity = (city: City) => {
    setQuery(""); setResults([]); setSearching(false); setSearchFailed(false);
    props.onSearchCity?.(city); input.current?.blur();
  };
  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    const cached = cachedSuggestions.current?.(query.trim());
    setResults(cached ?? []);
    setSearchFailed(false);
    if (composing || query.trim().length < 2 || cached) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(
      () =>
        search
          .current(query.trim(), abort.signal)
          .then((items) => {
            if (!cancelled) setResults(items);
          })
          .catch(() => {
            if (!cancelled) setSearchFailed(true);
          })
          .finally(() => {
            if (!cancelled) setSearching(false);
          }),
      100,
    );
    return () => {
      cancelled = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [query, activeCity, selectedCities, composing, searchAttempt]);
  const localMatches = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return [];
    return userPlaces.filter(
      (p) =>
        `${p.name} ${p.address}`.toLowerCase().includes(keyword),
    );
  }, [query, userPlaces]);
  const scoped = getCitiesGuidePlaces(userPlaces, selectedCities);
  const showingVisited = activeFilter.kind === "status" && activeFilter.value === "visited";
  const displayed =
    activeFilter.kind === "category"
      ? userPlaces.filter(place => place.category === activeFilter.value)
      : activeFilter.kind === "combined"
        ? userPlaces.filter(place => activeFilter.categories.some(category => placeBelongsToGuide(place, category)))
        : showingVisited
          ? [...userPlaces.filter(p => p.status === "visited"), ...props.visitedPlaces].filter((p,i,rows) => rows.findIndex(q => samePlace(q,p)) === i)
          : userPlaces;
  const items = query.trim()
    ? [...localMatches, ...results].filter(
        (p, i, rows) =>
          rows.findIndex((q) => samePlace(q, p)) === i,
      )
    : displayed;
  const guideHome = !query.trim() && !browsingAll && activeFilter.kind === "status" && activeFilter.value === "all";
  
  const scrollArea = useRef<HTMLDivElement>(null);
  const savedHeading = useRef<HTMLHeadingElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const detailReturn = useRef<{ key: string; top: number; trigger: HTMLElement; search: boolean } | null>(null);
  const scrollKey = JSON.stringify([props.ownerId, guideHome || query.trim() ? selectedCities : null, guideHome ? "home" : [activeFilter.kind, activeFilter.value], query.trim()]);
  useLayoutEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = scrollPositions.current.get(scrollKey) ?? 0;
  }, [scrollKey]);
  useLayoutEffect(() => {
    if (props.detailOpen) return;
    const previous = detailReturn.current;
    if (!previous) return;
    detailReturn.current = null;
    if (previous.key !== scrollKey) return;
    if (previous.search) setSuggestionsOpen(true);
    const frame = requestAnimationFrame(() => {
      if (scrollArea.current) scrollArea.current.scrollTop = previous.top;
      const trigger = previous.trigger.getClientRects().length ? previous.trigger : input.current;
      trigger?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [props.detailOpen, scrollKey]);
  function showHome() {
    props.onNavigatePanel(() => {
      setQuery("");
      setBrowsingAll(false);
      props.onFilterChange(filters[0]);
      requestAnimationFrame(() => scrollArea.current?.querySelector<HTMLButtonElement>('[data-library-destination="saved"]')?.focus({ preventScroll: true }));
    }, "back");
  }

  function openSavedPlaces() {
    props.onNavigatePanel(() => {
      openGuide(filters[0]);
      requestAnimationFrame(() => savedHeading.current?.focus({ preventScroll: true }));
    }, "forward");
  }
  function openGuide(filter: UserFilter) {
    setBrowsingAll(true);
    props.onFilterChange(filter);
  }
  function rememberSearch(place:Place) {
    const next=addRecentPlaceSearch(place,recent);
    setRecent(next);
    writeRecentPlaceSearches(props.ownerId,next);
  }
  function selectPlace(place: Place, trigger: HTMLElement) {
    const search = Boolean(query.trim());
    detailReturn.current = { key: scrollKey, top: scrollArea.current?.scrollTop ?? 0, trigger, search };
    if (search) rememberSearch(place);
    setSuggestionsOpen(false);
    
    props.onSelectPlace(place);
  }
  function clearRecent() {
    const previous = recent;
    if (!writeRecentPlaceSearches(props.ownerId, [])) { addToast("最近搜索未能清除，请重试", "error"); return; }
    setRecent([]);
    addToast("已清除最近搜索", "info", {label:"撤销",onClick:()=>{
      const restored=[...readRecentPlaceSearches(props.ownerId),...previous].filter((p,i,rows)=>rows.findIndex(other=>samePlace(other,p))===i).slice(0,6);
      if(writeRecentPlaceSearches(props.ownerId,restored))setRecent(restored);
      else addToast("恢复失败，请重试", "error");
    }});
  }
  
  
  
  function saveCandidate(place: Place) {
    if (userPlaces.some(p => samePlace(p,place))) return;
    props.onCreatePlace({
      ...place,
      id: `saved-${Date.now()}-${place.id}`,
      type: "user",
      source: "saved",
      isSaved: true,
      status: "saved",
      guideCategories: [place.category],
    });
    addToast(`已保存「${place.name}」`, "success");
  }
  return (
    <aside
      className={`workspace-sidebar ${props.isOpen ? "is-expanded" : ""} ${query.trim() ? "is-searching" : ""} ${query.trim() && !suggestionsOpen ? "suggestions-dismissed" : ""} `}
      aria-label="工作区与地点"
      onBlurCapture={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setSuggestionsOpen(false);
      }}
      onClickCapture={() => {
        if (scrollArea.current) scrollPositions.current.set(scrollKey, scrollArea.current.scrollTop);
      }}
      onKeyDown={(event) => {
                if (event.key === "Escape" && !query && !props.detailOpen && !guideHome) {
          event.preventDefault(); event.stopPropagation();
          showHome();
        }
      }}
    >
      <button
        className="sheet-handle"
        onClick={props.onToggleOpen}
        aria-label={props.isOpen ? "收起地点面板" : "展开地点面板"}
        aria-expanded={props.isOpen}
      >
        <span />
      </button>
      {props.demoBanner}
      {props.calendarHint}
      <div className="places-search-toolbar">
        <div className="place-search">
          {searching ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <Search size={17} />}
          <input
            ref={input}
            aria-label="搜索地点"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={!!query.trim() && suggestionsOpen && !props.detailOpen}
            aria-controls={query.trim() ? suggestionsId : undefined}
            aria-keyshortcuts="Control+k Meta+k /"
            placeholder="搜索地点或地址"
            value={query}
            onFocus={() => {
              setSuggestionsOpen(true);
              if (props.detailOpen) props.onOpenSearch();
              if (!props.isOpen) props.onToggleOpen();
            }}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.stopPropagation();
                if (query) setQuery("");
                else input.current?.blur();
              } else if (event.key === "Enter" && exactCity) {
                event.preventDefault(); chooseSearchCity(exactCity);
              } else if (event.key === "Enter" && query.trim() && items.length > 0) {
                event.preventDefault();
                selectPlace(items[0], event.currentTarget);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                event.currentTarget
                  .closest("aside")
                  ?.querySelector<HTMLButtonElement>(".search-city-suggestion, .search-poi-suggestion, .place-row-main, .recent-place-row")
                  ?.focus();
              }
            }}
            onChange={(event) => {
              setSuggestionsOpen(true);
              setQuery(event.target.value);
              if (!props.isOpen) props.onToggleOpen();
            }}
          />
          {query ? (
            <button
              aria-label="清空搜索"
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
            >
              <X size={15} />
            </button>
          ) : (
            <kbd title="按 / 或 ⌘K 搜索">/</kbd>
          )}
        </div>
 {props.onOpenWorkspace && <AccountEntry status={props.accountStatus ?? "unavailable"} email={props.accountEmail} onOpen={props.onOpenWorkspace} />}
      </div>
      
      {!query.trim() && !guideHome && <div className="places-list-toolbar">
          <div className="guide-list-heading">
            <button type="button" className="icon-button saved-places-back" aria-label="返回地点" title="返回地点" onClick={showHome}><ChevronLeft size={17} aria-hidden="true" /></button>
            <h1 ref={savedHeading} tabIndex={-1}>{activeFilter.kind === "status" && activeFilter.value === "all" ? "已存地点" : activeFilter.label}</h1>
          </div>
        <ActionMenu label="筛选已存地点" className="saved-place-filter" actions={filters.map(filter=>({
          label:filter.kind === "category" ? `类型：${filter.label}` : filter.value === "visited" ? "状态：已到访" : "全部地点",
          icon:activeFilter.kind === filter.kind && activeFilter.value === filter.value ? <Check size={15}/> : undefined,
          onSelect:()=>openGuide(filter),
        }))}><ListFilter size={15}/><span>筛选</span></ActionMenu>
      </div>}
      {searchFailed && !citySuggestions.length && (
        <div className="search-status search-retry" role="status">
          <span>{items.length ? "在线搜索暂不可用，已显示本地地点" : "搜索暂不可用"}</span>
          <button className="text-action" onClick={() => {
            setSearchFailed(false);
            setSearching(true);
            setSearchAttempt(attempt => attempt + 1);
          }}>重试</button>
        </div>
      )}
      <div className="sidebar-scroll" ref={scrollArea} aria-busy={searching}
        id={query.trim() ? suggestionsId : undefined}
        role={query.trim() ? "listbox" : undefined}
        aria-label={query.trim() ? "地点建议" : undefined}
        onScroll={event => {
          if (props.detailOpen) return;
          scrollPositions.current.set(scrollKey, event.currentTarget.scrollTop);
          if (scrollPositions.current.size > 80) scrollPositions.current.delete(scrollPositions.current.keys().next().value!);
        }}>
        {!query.trim() && !guideHome && !!Object.keys(props.placeAliases ?? {}).length && <details className="trip-connections saved-place-aliases">
          <summary>日程地点别名</summary>
          <ul>{Object.entries(props.placeAliases ?? {}).map(([phrase,place])=><li key={phrase}>
            <span>{phrase} → {place.name}</span>
            <button type="button" className="text-action" aria-label={`移除「${phrase}」的地点别名`}
              onClick={() => props.onRemovePlaceAlias?.(phrase)}>移除</button>
          </li>)}</ul>
        </details>}
        {!!citySuggestions.length && <div className="search-city-suggestions" aria-label="城市推荐">
          {citySuggestions.map(city => <button key={city.name} className="search-city-suggestion" role="option" aria-selected={false} onClick={() => chooseSearchCity(city)} onKeyDown={event => {
            if (!["ArrowDown", "ArrowUp", "Escape"].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const rows=Array.from(scrollArea.current?.querySelectorAll<HTMLButtonElement>(".search-city-suggestion, .search-poi-suggestion") ?? []);
            const index=rows.indexOf(event.currentTarget);
            if(event.key==="Escape" || event.key==="ArrowUp" && index===0) input.current?.focus();
            else rows[Math.min(rows.length-1, Math.max(0,index+(event.key==="ArrowDown"?1:-1)))]?.focus();
          }}>
            <MapPin size={19}/><span><strong>{city.name}</strong><small>城市</small></span><ChevronRight size={15}/>
          </button>)}
        </div>}
        {!!query.trim() && items.map(place => {
          const Icon=categoryIcons[place.category] ?? MapPin;
          const distance=place.distanceText?.match(/约\s*(\d+(?:\.\d+)?)(km|m)/);
          return <button className="search-poi-suggestion" role="option" aria-selected={false} key={place.id} onClick={event=>selectPlace(place,event.currentTarget)} onKeyDown={event=>{
            if(!["ArrowDown","ArrowUp","Escape"].includes(event.key))return;
            event.preventDefault();event.stopPropagation();
            const rows=Array.from(scrollArea.current?.querySelectorAll<HTMLButtonElement>(".search-city-suggestion, .search-poi-suggestion")??[]);
            const selected=rows.indexOf(event.currentTarget);
            if(event.key==="Escape" || event.key==="ArrowUp"&&selected===0)input.current?.focus();
            else rows[Math.max(0,Math.min(rows.length-1,selected+(event.key==="ArrowDown"?1:-1)))]?.focus();
          }}>
            <span className="search-suggestion-icon"><Icon size={18}/></span>
            <span className="search-suggestion-copy"><strong>{place.name}</strong><small>{place.address && place.address!==place.name ? place.address : place.city}</small></span>
            {distance&&<span className="search-suggestion-distance">{distance[1]}{distance[2]==="km"?"公里":"米"}</span>}
          </button>;
        })}
        
        {guideHome && <div className="guide-library is-library-home">
          <>
            <nav className="workspace-tabs" aria-label="工作区">
              <button type="button" className="is-active" aria-current="page" onClick={props.onHome}>今天</button>
              {props.onOpenBusinessTrips && <button type="button" data-library-destination="business-trips" onClick={props.onOpenBusinessTrips}>行程</button>}
              {props.onOpenHistory && <button type="button" data-library-destination="history" onClick={props.onOpenHistory}>历史</button>}
            </nav>
            {props.todayPanel}
            <nav className="place-home-navigation is-aux" aria-label="地点">
              <LibraryHoverEntry label="已存地点" preview={<>{scoped.map(place=><button key={place.id} onClick={()=>props.onSelectPlace(place)}><strong>{place.name}</strong>{place.city !== place.name && <small>{place.city}</small>}</button>)}<button className="text-action" onClick={openSavedPlaces}>查看全部地点</button></>}><button type="button" data-library-destination="saved" onClick={openSavedPlaces}><span>地点搜索与收藏</span><span className="place-count">{scoped.length}</span><ChevronRight size={14}/></button></LibraryHoverEntry>
              {!!scoped.length && <div className="saved-place-preview" aria-label="已存地点快捷访问">
                {scoped.slice(0,3).map(place => <button className="recent-place-row" key={place.id} onClick={()=>props.onSelectPlace(place)}>
                  <span><strong>{place.name}</strong><small>{place.address && place.address!==place.name ? place.address : place.city}</small></span>
                </button>)}
              </div>}

            </nav>
            {!!recent.length&&<section className="recent-place-searches" aria-label="最近搜索">
              <div className="library-section-heading"><h2>最近搜索</h2><button className="text-action" onClick={clearRecent}>清除</button></div>
              {recent.map((place,index)=>{const Icon=categoryIcons[place.category]||MapPin;return <button className="recent-place-row" key={place.id} onClick={()=>{
                const recentCity=cityCatalog.find(city=>city.name===place.name&&(place.address===place.name||place.address===city.name));
                if(recentCity&&props.onSearchCity){chooseSearchCity(recentCity);return;}
                rememberSearch(place);props.onSelectPlace(userPlaces.find(p=>samePlace(p,place))??place);
              }} onKeyDown={event=>{
                if(!['ArrowUp','ArrowDown','Escape'].includes(event.key))return;
                event.preventDefault();event.stopPropagation();
                if(event.key==='Escape'||event.key==='ArrowUp'&&index===0)input.current?.focus();
                else event.currentTarget.closest('section')?.querySelectorAll<HTMLButtonElement>('.recent-place-row')[event.key==='ArrowDown'?Math.min(index+1,recent.length-1):index-1]?.focus();
              }}><span className="recent-place-symbol"><Icon size={17}/></span><span><strong>{place.name}</strong><small>{place.city}{place.address?` · ${place.address}`:""}</small></span></button>;})}
            </section>}
          </>
          
        </div>}
        {!guideHome && !items.length && !citySuggestions.length && !searchFailed && (
          <div className="places-empty">
            <p>
              {searching
                ? "正在搜索地点…"
                : query
                  ? "没有找到匹配地点"
                      : activeFilter.kind === "status" &&
                        activeFilter.value === "visited"
                      ? "暂无已到访地点"
                      : activeFilter.kind === "category" ||
                          activeFilter.kind === "combined"
                        ? "此分类暂无地点"
                        : "暂无保存地点"}
            </p>
            {query && !searching && (
              <span>
                {query.trim().length < 2
                  ? "请输入至少两个字"
                  : "试试完整名称，或切换城市"}
              </span>
            )}
            {!query && <button className="text-action" onClick={() => input.current?.focus()}><Search size={15} />搜索地点</button>}
            

          </div>
        )}
        {!query.trim() && !guideHome && groupSavedPlacesByCity(items).map(group => (
          <section className="saved-city-group" aria-label={group.label} key={group.key}>
            <h2>{group.label}</h2>
            {group.places.map(place => {
              const existing = userPlaces.find(p => samePlace(p,place));
              const CategoryIcon = categoryIcons[place.category] ?? MapPin;
              const address = savedPlaceAddress(place, group.key);
              const visited = !showingVisited && place.status === "visited";
              return (
                <article className="place-row" key={place.id}>
                  <button
                    className="place-row-main"
                    title={`查看${place.name}详情`}
                    onClick={event => selectPlace(existing ?? place, event.currentTarget)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Escape") return;
                      event.preventDefault();
                      event.stopPropagation();
                      const rows = Array.from(scrollArea.current?.querySelectorAll<HTMLButtonElement>(".place-row-main") ?? []);
                      const index = rows.indexOf(event.currentTarget);
                      if (event.key === "Escape" || (event.key === "ArrowUp" && index === 0)) input.current?.focus();
                      else rows?.[event.key === "ArrowDown" ? Math.min(index + 1, items.length - 1) : index - 1]?.focus();
                    }}
                  >
                    <span className="place-row-symbol" aria-hidden="true">
                      <CategoryIcon size={20} />
                    </span>
                    <span className="place-row-copy">
                      <strong>{place.name}</strong>
                      {(address || visited) && <span className="saved-place-meta">
                        {address && <span title={place.address}>{address}</span>}
                        {visited && <small>已到访</small>}
                      </span>}
                    </span>
                  </button>
                  <div className="place-row-actions">
                    {!existing && (
                      <button
                        title="保存地点"
                        aria-label={`保存${place.name}`}
                        onClick={(event) => {
                          const row = event.currentTarget.closest(".place-row");
                          saveCandidate(place);
                          requestAnimationFrame(() => row?.querySelector<HTMLButtonElement>(".place-row-main, .recent-place-row")?.focus({ preventScroll: true }));
                        }}
                      >
                        <Bookmark size={17} />
                      </button>
                    )}
                    {existing && (
                      <ActionMenu
                        label={`${place.name}操作`}
                        actions={[
                          {
                            label: "编辑地点",
                            icon: <Pencil size={15} />,
                            onSelect: () => props.onEditPlace(existing),
                          },
                          {
                            label: "从地点库移除",
                            icon: <Trash2 size={15} />,
                            danger: true,
                            onSelect: () => props.onDeletePlace(existing.id),
                          },
                        ]}
                      />
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        ))}
      </div>
      {!props.storageHealthy && (
        <p className="storage-error" role="alert">
          保存失败，请勿关闭页面。
        </p>
      )}
    </aside>
  );
}

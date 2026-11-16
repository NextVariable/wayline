import {
  Check,
  ChevronDown,
  Crosshair,
  Globe2,
  Loader2,
  MapPin,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useHoverPopover } from "../lib/useHoverPopover";
import { cityShortcuts } from "../data/cities";
import type { City } from "../types/place";
import {
  cityMatches,
  cityPickerGroups,
  cityKey,
  searchAdministrativeCities,
  type CityScope,
} from "../lib/citySelection";

export function CityPicker({
  activeCity,
  scope = "current",
  allowAll = false,
  cities,
  savedCityNames = [],
  onChange,
  onAll,
  locating,
  onLocate,
  selection = [],
  onSelectionChange,
  onClearHome,
}: {
  activeCity: string;
  scope?: CityScope;
  allowAll?: boolean;
  cities: City[];
  savedCityNames?: string[];
  onChange: (city: City) => void;
  onAll?: () => void;
  locating?: boolean;
  onLocate?: () => void;
  selection?: string[];
  onSelectionChange?: (cities: City[]) => void;
  onClearHome?: () => void;
}) {
  const [multiple, setMultiple] = useState(false);
  const [chosen, setChosen] = useState<City[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<City[]>([]);
  const [remoteQuery, setRemoteQuery] = useState("");
  const [status, setStatus] = useState("");
  const [searching, setSearching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  const hover = useHoverPopover(open, setOpen, trigger, panel);
  const choosingHome = Boolean(onClearHome);
  const dialogLabel = choosingHome ? "选择常驻城市" : "选择城市";
  const searchingByName = !!query.trim();
  const results = searchingByName ? cities.filter((city) => cityMatches(city, query)) : [];
  const groups = cityPickerGroups(multiple ? [...cities, ...chosen] : cities, cityShortcuts, [
    ...(scope === "current" ? [activeCity] : scope === "selected" ? selection : []),
    ...(multiple ? chosen.map((city) => city.name) : []),
    ...savedCityNames,
  ]);
  const visible = searchingByName
    ? [...results, ...(remoteQuery === query ? remote : []).filter(
      (city) => !results.some((item) => cityKey(item.name) === cityKey(city.name)),
    )]
    : [...groups.preferred, ...groups.shortcuts];
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (city: City) => {
    if (multiple) {
      setChosen(items => items.some(item => cityKey(item.name) === cityKey(city.name))
        ? items.filter(item => cityKey(item.name) !== cityKey(city.name)) : [...items, city]);
      return;
    }
    onChange(city);
    close();
  };
  const openingSelection = useRef({ allowAll, scope, cities, selection, activeCity });
  openingSelection.current = { allowAll, scope, cities, selection, activeCity };
  useEffect(() => {
    if (!open) return;
    const { allowAll, scope, cities, selection, activeCity } = openingSelection.current;
    setQuery("");
    setMultiple(allowAll && scope === "selected");
    setChosen(cities.filter(city => (scope === "selected" ? selection : [activeCity]).some(name => cityKey(name) === cityKey(city.name))));
    if (!hover.origin.current) input.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, hover.origin]);
  useEffect(() => {
    setRemote([]);
    setStatus("");
    setSearching(false);
    if (
      !open ||
      query.trim().length < 2 ||
      results.length > 0 ||
      !/[\u4e00-\u9fff]/.test(query)
    )
      return;
    setSearching(true);
    const abort = new AbortController();
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      abort.abort();
      setSearching(false);
      setStatus("查询超时，请修改关键词重试");
    }, 8500);
    const timer = setTimeout(() => {
      setSearching(true);
      searchAdministrativeCities(query, abort.signal)
        .then((items) => {
          if (abort.signal.aborted) return;
          setRemoteQuery(query);
          setRemote(items);
          setStatus(items.length ? "" : "未找到城市，试试完整名称或加上省名");
        })
        .catch(() => {
          if (!abort.signal.aborted) setStatus("暂时无法查询，请稍后重试");
        })
        .finally(() => {
          clearTimeout(timeout);
          if (!expired && !abort.signal.aborted) setSearching(false);
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      clearTimeout(timeout);
      abort.abort();
    };
  }, [query, open, results.length]);
  const renderCity = (city: City) => (
    <button
      key={city.name}
      type="button"
      className="city-option"
      aria-pressed={multiple ? chosen.some(c => cityKey(c.name) === cityKey(city.name)) : scope === "current" && cityKey(city.name) === cityKey(activeCity)}
      onClick={() => choose(city)}
    >
      <span>{city.name}</span>
      {(multiple ? chosen.some(c => cityKey(c.name) === cityKey(city.name)) : scope === "current" && cityKey(city.name) === cityKey(activeCity)) && <Check size={15} />}
    </button>
  );
  const preferred = searchingByName ? [] : groups.preferred;
  const rest = searchingByName ? visible : groups.shortcuts;
  return (
    <div
      className={choosingHome ? "global-city-picker business-trip-home" : "global-city-picker"}
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        className="global-city-trigger"
        ref={trigger}
        {...(choosingHome ? {} : hover.props)}
        aria-label={choosingHome ? `常驻城市，${activeCity || "未设置"}` : `选择城市，当前${scope === "all" ? "跨城市查看" : scope === "selected" ? selection.join("、") : activeCity}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          hover.cancel();
          const hovered = hover.origin.current;
          hover.origin.current = false;
          if (open && hovered) input.current?.focus();
          else setOpen(value => !value);
        }}
      >
        {choosingHome ? <span>常驻城市</span> : <MapPin size={15} />}
        <span>{scope === "all" ? "跨城市查看" : scope === "selected" ? `${selection.length} 个城市` : activeCity || "选择城市"}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <section
          ref={panel}
          {...(choosingHome ? {} : hover.props)}
          className="global-city-menu"
          role="dialog"
          aria-label={dialogLabel}
        >
          {!choosingHome && <div className="section-heading">
            <h2>{choosingHome || allowAll ? dialogLabel : "行程搜索城市"}</h2>
            <button
              className="icon-button"
              aria-label="关闭城市选择"
              onClick={close}
            >
              <X size={16} />
            </button>
          </div>}
          <div className="city-search-field">
            <Search size={16} />
            <input
              ref={input}
              aria-label="搜索城市"
              placeholder="搜索城市、拼音或首字母"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  visible.length === 1
                ) {
                  event.preventDefault();
                  choose(visible[0]);
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  panel.current
                    ?.querySelector<HTMLButtonElement>(".city-results .city-option")
                    ?.focus();
                }
              }}
            />
            {query && (
              <button
                aria-label="清除城市搜索"
                onClick={() => {
                  setQuery("");
                  input.current?.focus();
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          {allowAll && (
            <button className="text-action city-selection-mode" onClick={() => {
              if (!multiple) setChosen(cities.filter(city => (scope === "selected" ? selection : [activeCity]).some(name => cityKey(name) === cityKey(city.name))));
              setMultiple(value => !value);
            }}>{multiple ? "取消多选" : "选择多个城市"}</button>
          )}
          {!query.trim() && !multiple && onLocate && (
            <div className="city-scope-actions">
              <button
                className="city-option"
                disabled={locating}
                onClick={() => {
                  onLocate();
                  close();
                }}
              >
                {locating ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Crosshair size={16} />
                )}
                <span>{locating ? "正在定位…" : "使用当前位置"}</span>
              </button>
              {allowAll && onAll && (
                <button
                  className="city-option"
                  aria-pressed={scope === "all"}
                  onClick={() => {
                    onAll();
                    close();
                  }}
                >
                  <Globe2 size={16} />
                  <span>跨城市查看</span>
                  {scope === "all" && <Check size={15} />}
                </button>
              )}
            </div>
          )}
          <div
            className="city-results"
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
                return;
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  ".city-option",
                ),
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              if (buttons[next]) {
                event.preventDefault();
                buttons[next].focus();
              }
            }}
          >
            {preferred.length > 0 && (
              <>
                <p className="city-group-label">{choosingHome ? "当前设置" : "当前与收藏"}</p>
                <div className="city-options-grid">
                  {preferred.map(renderCity)}
                </div>
              </>
            )}
            {rest.length > 0 && (
              <>
                <p className="city-group-label">
                  {searchingByName ? "搜索结果" : "常见城市"}
                </p>
                <div className="city-options-grid">{rest.map(renderCity)}</div>
              </>
            )}
            {query.trim() && !visible.length && (
              <p className="city-search-status" role="status">
                {searching
                  ? "正在查询城市…"
                  : status ||
                    (query.trim().length < 2
                      ? "请输入至少两个字"
                      : "未找到匹配城市")}
              </p>
            )}
          </div>
          {multiple && (
            <div className="city-selection-footer">
              <p>{chosen.length ? chosen.map(city => city.name).join("、") : "请选择城市"}</p>
              <button className="primary-action" disabled={!chosen.length} onClick={() => {
                onSelectionChange?.(chosen);
                close();
              }}>查看 {chosen.length} 个城市</button>
            </div>
          )}
          {onClearHome && activeCity && !searchingByName && (
            <button type="button" className="text-action" onClick={() => { onClearHome(); close(); }}>
              清除常驻城市
            </button>
          )}
        </section>
      )}
    </div>
  );
}

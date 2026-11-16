import type { GoogleCalendarState } from "../lib/useGoogleCalendar";
import { CalendarImport } from "./CalendarImport";
import { GmailRailOrders } from "./GmailRailOrders";
import { GoogleCalendarConnection } from "./GoogleCalendarConnection";
import { calendarEventIsPast, ScheduleAgenda } from "./ScheduleAgenda";
import type { CalendarEntry } from "../lib/calendarEvents";

import { ChevronLeft, MapPin, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CityName, Place } from "../types/place";
import {
  localDay,
  parseQuickIntent,
  matchIntentPlaces,
  changedIntentFields,
} from "../lib/quickIntent";
import { routeCandidates } from "../lib/routeInteractions";
import { usePanelFocus } from "../lib/usePanelFocus";

export function ScheduleAssistant({
  open,
  calendarEvents = [], onCalendarChange, onCalendarRemove, googleCalendar, gmailAccount,
  activeCity,
  places,
  contextPlaces,
  onClose,
  backLabel,
  onCreateSchedule,
  onSearchPlaces,
  onSelectPlace,
  onDeletePlace,
  onUpdateSchedule,
  editSchedule,
  onEditSchedule,
}: {
  open: boolean;
  calendarEvents?:CalendarEntry[];
  googleCalendar?:GoogleCalendarState;
  gmailAccount?: string;
  onCalendarChange?:(events:CalendarEntry[])=>void;
  onCalendarRemove?:(id:string)=>void;
  activeCity: CityName;
  places: Place[];
  contextPlaces: Place[];
  onClose: () => void;
  backLabel: string;
  onCreateSchedule: (place: Place) => void;
  onSearchPlaces: (keyword: string) => Promise<Place[]>;
  onSelectPlace: (place: Place) => void;
  onDeletePlace: (id: string) => void;
  onUpdateSchedule: (place: Place) => void;
  editSchedule: Place | null;
  onEditSchedule: (place: Place | null) => void;
}) {
  const ref = usePanelFocus(open);
  const heading = useRef<HTMLHeadingElement>(null);
  const [view, setView] = useState<"agenda" | "sources" | "import" | "compose">("agenda");
  const [notice, setNotice] = useState("");
  const [showPast, setShowPast] = useState(false);
  const screen = editSchedule ? "compose" : view;
  const composingSchedule = screen === "compose";
  const moveTo = (next: typeof view) => {
    setView(next);
    requestAnimationFrame(() => {
      if (ref.current) ref.current.scrollTop = 0;
      if (next === "compose") document.getElementById("schedule-content")?.focus({ preventScroll: true });
      else heading.current?.focus({ preventScroll: true });
    });
  };
  const back = () => {
    if (screen === "agenda") { onClose(); return; }
    if (editSchedule) onEditSchedule(null);
    moveTo(screen === "import" ? "sources" : "agenda");
  };
  const [type, setType] = useState<"todo" | "memo">("todo");
  const [placeId, setPlaceId] = useState("");
  const [candidate, setCandidate] = useState<Place | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [quickField, setQuickField] = useState<
    "date" | "time" | "place" | null
  >(null);
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Place[]>([]);
  const [candidateFor, setCandidateFor] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchRef = useRef(onSearchPlaces);
  searchRef.current = onSearchPlaces;
  const cityPlaces = useMemo(
    () =>
      places.filter(
        (p) => p.city === activeCity && !p.tags.includes("日程助手"),
      ),
    [places, activeCity],
  );
  const schedules = places.filter((place) => place.tags.includes("日程助手"));
  const intent = useMemo(() => parseQuickIntent(content), [content]);
  const knownMatches = useMemo(
    () => matchIntentPlaces(content, [...contextPlaces, ...places]),
    [content, contextPlaces, places],
  );
  const inferredPlace = knownMatches.length === 1 ? knownMatches[0] : null;
  const selected =
    candidate ??
    cityPlaces.find((place) => place.id === placeId) ??
    (!query.trim() ? inferredPlace : null);
  const effectiveDate = date || intent.date || localDay();
  const effectiveTime = time || intent.time || "";
  const effectiveQuery = query.trim() || (!selected ? intent.placeQuery : "");
  const visibleCandidates = candidateFor === effectiveQuery ? candidates : [];
  const dateIssue =
    !date && intent.warnings.some((message) => message.includes("日期"));
  const timeIssue =
    type === "todo" &&
    !time &&
    intent.warnings.some((message) => !message.includes("日期"));
  const reveal = (id: string) => {
    const field =
      id === "schedule-date"
        ? "date"
        : id === "schedule-time"
          ? "time"
          : "place";
    setQuickField(field);
    requestAnimationFrame(() =>
      document
        .getElementById(
          `quick-schedule-${field === "place" ? "search" : field}`,
        )
        ?.focus(),
    );
  };
  const suggestedPlaces = routeCandidates(
    [
      ...contextPlaces,
      ...places.filter((place) => !place.tags.includes("日程助手")),
    ],
    visibleCandidates,
    [],
    effectiveQuery,
  );
  useEffect(() => {
    setCandidates([]);
    setSearchError(false);
    setSearching(false);
    if (!open || !composingSchedule || effectiveQuery.trim().length < 2) return;
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(
      () =>
        searchRef
          .current(effectiveQuery.trim())
          .then((items) => {
            if (!cancelled) {
              setCandidateFor(effectiveQuery);
              setCandidates(items);
            }
          })
          .catch(() => {
            if (!cancelled) setSearchError(true);
          })
          .finally(() => {
            if (!cancelled) setSearching(false);
          }),
      250,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, composingSchedule, effectiveQuery, activeCity]);
  const newDraft = useRef<{
    type: "todo" | "memo";
    placeId: string;
    candidate: Place | null;
    date: string;
    time: string;
    content: string;
    query: string;
  } | null>(null);
  const editing = useRef(false);
  const currentDraft = useRef({ type, placeId, candidate, date, time, content, query, cityPlaces });
  currentDraft.current = { type, placeId, candidate, date, time, content, query, cityPlaces };
  useLayoutEffect(() => {
    (
      document.getElementById("schedule-content") as HTMLTextAreaElement | null
    )?.setCustomValidity("");
    if (!editSchedule) {
      if (editing.current && newDraft.current) {
        const previous = newDraft.current;
        setType(previous.type);
        setPlaceId(previous.placeId);
        setCandidate(previous.candidate);
        setDate(previous.date);
        setTime(previous.time);
        setContent(previous.content);
        setQuery(previous.query);
      }
      editing.current = false;
      return;
    }
    if (!editing.current) newDraft.current = currentDraft.current;
    editing.current = true;
    const linked = currentDraft.current.cityPlaces.find(
      (place) =>
        place.name === editSchedule.name && place.city === editSchedule.city,
    );
    setCandidate(linked ? null : editSchedule);
    setPlaceId(linked?.id ?? "");
    setQuery("");
    setType(editSchedule.tags.includes("备忘录") ? "memo" : "todo");
    const [d, t] = editSchedule.distanceText.split(" ");
    if (d) setDate(d);
    setTime(t ?? "");
    setContent(
      editSchedule.reason.split(" · ").slice(2).join(" · ") ||
        editSchedule.reason,
    );
  }, [editSchedule]);
  if (!open) return null;
  return (
    <section
      ref={ref}
      className="schedule-assistant-panel workspace-panel"
      aria-label="地点日程"
      id="trip-schedule-panel"
      role="region"
      onKeyDown={event => {
        if (event.key === "Escape" && screen !== "agenda") {
          event.stopPropagation();
          back();
        }
      }}
    >
      <div className="schedule-intro panel-heading">
        <button type="button" className="icon-button" aria-label={screen === "agenda" ? backLabel : screen === "import" ? "返回日历来源" : "返回日程"} onClick={back}><ChevronLeft size={17} aria-hidden="true" /></button>
        <h1 ref={heading} tabIndex={-1}>{screen === "compose" ? editSchedule ? "编辑安排" : "新建安排" : screen === "import" ? "导入日历" : screen === "sources" ? "日历来源" : "日程"}</h1>
        {screen === "agenda" && <>
          {(googleCalendar || onCalendarChange || gmailAccount) && <button type="button" className="text-action" onClick={() => moveTo("sources")}>来源</button>}
          <button type="button" className="text-action" onClick={() => { setNotice(""); moveTo("compose"); }}><Plus size={15} aria-hidden="true" />新建</button>
        </>}
      </div>
      {screen === "agenda" && <>
        {notice && <p className="field-help" role="status">{notice}</p>}
        <ScheduleAgenda events={calendarEvents} schedules={schedules} past={showPast} onPeriodChange={setShowPast} connected={!!googleCalendar?.status?.connected}
          onRemove={onCalendarRemove} onChange={onCalendarChange} onSearch={onSearchPlaces} onSelectPlace={onSelectPlace}
          onEdit={place => { onEditSchedule(place); moveTo("compose"); }} onDelete={onDeletePlace}
          onToggleCompleted={place => onUpdateSchedule({ ...place, status: place.status === "visited" ? "want_to_go" : "visited" })} />
      </>}
      {screen === "sources" && <div className="schedule-sources">
        {googleCalendar && <GoogleCalendarConnection connection={googleCalendar} />}
        {gmailAccount && <GmailRailOrders email={gmailAccount} events={calendarEvents} />}
        {onCalendarChange && <button type="button" className="text-action" onClick={() => moveTo("import")}>导入 .ics 文件</button>}
      </div>}
      {screen === "import" && onCalendarChange && <CalendarImport onChange={onCalendarChange} onDone={imported => {
        const today = localDay();
        setShowPast(imported.every(event => calendarEventIsPast(event, today)));
        setNotice(`已导入 ${imported.length} 条日程`);
        moveTo("agenda");
      }} />}
      {composingSchedule && <form
        className="workspace-form quick-schedule-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!content.trim()) {
            const field = document.getElementById(
              "schedule-content",
            ) as HTMLTextAreaElement | null;
            field?.setCustomValidity("写下要安排的事即可");
            field?.reportValidity();
            return;
          }
          if (!selected) {
            reveal(cityPlaces.length ? "schedule-place" : "schedule-search");
            return;
          }
          if (dateIssue || timeIssue || (type === "todo" && !effectiveTime)) {
            reveal(dateIssue ? "schedule-date" : "schedule-time");
            return;
          }
          const scheduleTime = `${effectiveDate}${effectiveTime ? " " + effectiveTime : ""}`;
          const next: Place = {
            ...selected,
            id: editSchedule?.id ?? `schedule-${Date.now()}-${selected.id}`,
            type: "user",
            source: "manual",
            category: "custom",
            guideCategories: ["custom"],
            tags: ["日程助手", type === "todo" ? "待办事项" : "备忘录"],
            reason: `${type === "todo" ? "待办事项" : "备忘录"} · ${scheduleTime} · ${content.trim()}`,
            description: `关联地点：${selected.name}`,
            status: editSchedule?.status ?? "want_to_go",
            isSaved: true,
            distanceText: scheduleTime,
          };
          if (editSchedule) onUpdateSchedule(next);
          else onCreateSchedule(next);
          onEditSchedule(null);
          setContent("");
          setPlaceId("");
          setCandidate(null);
          setQuery("");
          setDetailsOpen(false);
          setQuickField(null);
          if (!editSchedule) {
            setDate("");
            setTime("");
          }
          setNotice(editSchedule ? "已保存修改" : "");
          setShowPast(effectiveDate < localDay());
          moveTo("agenda");
        }}
      >
        <label className="sr-only" htmlFor="schedule-content">写下你的安排</label>
        <textarea
          id="schedule-content"
          required
          rows={2}
          value={content}
          onChange={(event) => {
            event.currentTarget.setCustomValidity("");
            const next = event.target.value;
            const changed = changedIntentFields(content, next);
            if (changed.date) setDate("");
            if (changed.time) setTime("");
            const parsedNext = parseQuickIntent(next);
            if (
              (quickField === "time" && parsedNext.time) ||
              (quickField === "date" && parsedNext.date)
            )
              setQuickField(null);
            const nextPlaces = matchIntentPlaces(next, [
              ...contextPlaces,
              ...places,
            ]);
            if (
              changed.place ||
              nextPlaces.map((place) => place.city + place.name).join("|") !==
                knownMatches.map((place) => place.city + place.name).join("|")
            ) {
              setPlaceId("");
              setCandidate(null);
              setQuery("");
            }
            if (quickField === "place" && nextPlaces.length === 1)
              setQuickField(null);
            setContent(next);
          }}
          placeholder="明天下午三点去海上世界见客户"
        />
        {(content.trim() || editSchedule) && (
          <div className="intent-preview" aria-label="本条安排的信息">
            <button type="button" onClick={() => reveal("schedule-date")}>
              {dateIssue
                ? "确认日期"
                : effectiveDate === localDay()
                  ? "今天"
                  : effectiveDate}
            </button>
            <button type="button" onClick={() => reveal("schedule-time")}>
              {timeIssue
                ? "确认时间"
                : effectiveTime || (type === "memo" ? "时间不限" : "补充时间")}
            </button>
            <button
              type="button"
              onClick={() =>
                reveal(cityPlaces.length ? "schedule-place" : "schedule-search")
              }
            >
              <MapPin size={13} />
              {selected?.name ??
                (knownMatches.length > 1 ? "选择本条地点" : "补充地点")}
            </button>
          </div>
        )}
        {content.trim() && (dateIssue || timeIssue) && (
          <p className="field-help" role="status">
            {intent.warnings.join("；")}
          </p>
        )}
        {quickField === "date" && (
          <label htmlFor="quick-schedule-date">
            确认日期
            <input
              id="quick-schedule-date"
              type="date"
              value={effectiveDate}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
        )}
        {quickField === "date" && dateIssue && (
          <button
            type="button"
            className="text-action"
            onClick={() => setDate(effectiveDate)}
          >
            使用{effectiveDate}
          </button>
        )}
        {quickField === "time" && (
          <label htmlFor="quick-schedule-time">
            这条安排几点开始？
            <input
              id="quick-schedule-time"
              type="time"
              value={effectiveTime}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
        )}
        {quickField === "place" && (
          <label htmlFor="quick-schedule-search">
            选择或搜索地点
            <input
              id="quick-schedule-search"
              value={query}
              placeholder="输入名称，或点选下方地点"
              onChange={(event) => {
                setQuery(event.target.value);
                setPlaceId("");
                setCandidate(null);
              }}
            />
          </label>
        )}
        {((effectiveQuery.length >= 2 && !selected) ||
          quickField === "place") && (
          <div className="schedule-candidates" aria-label="日程地点搜索结果">
            <p className="field-help" role="status">
              {searching
                ? `正在匹配${effectiveQuery}…`
                : searchError
                  ? "暂未找到地点，可从收藏中选择"
                  : suggestedPlaces.length
                    ? "选择正确的位置"
                    : "未找到地点，请换个名称或从收藏中选择"}
            </p>
            {suggestedPlaces.slice(0, 5).map((place) => (
              <button
                type="button"
                key={place.id}
                onClick={() => {
                  setCandidate(place);
                  setPlaceId("");
                  setQuery("");
                  setQuickField(null);
                }}
              >
                <MapPin size={15} />
                <span>
                  {place.name}
                  <small>{place.address || place.city}</small>
                </span>
              </button>
            ))}
          </div>
        )}
        <button className="primary-action" disabled={!content.trim()}>
          {content.trim() && !selected
            ? "选择地点"
            : content.trim() &&
                (dateIssue || timeIssue || (type === "todo" && !effectiveTime))
              ? "补充时间信息"
              : editSchedule
                ? "保存修改"
                : "保存安排"}
        </button>
        <details
          className="smart-options"
          open={detailsOpen}
          onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        >
          <summary>修改地点、日期或类型</summary>
          <div className="smart-options-body">
            {cityPlaces.length > 0 && (
              <label htmlFor="schedule-place">
                已保存地点
                <select
                  id="schedule-place"
                  value={placeId}
                  onChange={(event) => {
                    setPlaceId(event.target.value);
                    setCandidate(null);
                    setQuery("");
                  }}
                >
                  <option value="">
                    {selected ? `当前：${selected.name}` : "选择一个地点"}
                  </option>
                  {cityPlaces.map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label htmlFor="schedule-search">
              搜索其他地点
              <input
                id="schedule-search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPlaceId("");
                  setCandidate(null);
                }}
                placeholder={`输入${activeCity}地点名称或完整地址`}
              />
            </label>
            {selected && (
              <p className="field-help">当前地点：{selected.name}</p>
            )}
            <div className="form-grid">
              <label htmlFor="schedule-date">
                日期
                <input
                  id="schedule-date"
                  type="date"
                  value={effectiveDate}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <label htmlFor="schedule-time">
                时间{type === "memo" && "（选填）"}
                <input
                  id="schedule-time"
                  type="time"
                  value={effectiveTime}
                  onChange={(event) => setTime(event.target.value)}
                />
              </label>
            </div>
            {dateIssue && (
              <button
                type="button"
                className="text-action"
                onClick={() => setDate(effectiveDate)}
              >
                使用{effectiveDate}
              </button>
            )}
            <fieldset>
              <legend>类型</legend>
              <div className="segmented-control">
                {(
                  [
                    ["todo", "固定安排"],
                    ["memo", "地点备忘"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    type="button"
                    key={id}
                    aria-pressed={type === id}
                    onClick={() => setType(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </details>
      </form>}
    </section>
  );
}

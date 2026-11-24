import type { GoogleCalendarState } from "../lib/useGoogleCalendar";
import { CalendarImport } from "./CalendarImport";
import { GmailRailOrders } from "./GmailRailOrders";
import { GoogleCalendarConnection } from "./GoogleCalendarConnection";
import { calendarEventIsPast, ScheduleAgenda } from "./ScheduleAgenda";
import type { CalendarEntry } from "../lib/calendarEvents";

import { ChevronLeft, MapPin, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CityName, Place } from "../types/place";
import { systemPlaces } from "../data/systemPlaces";
import { localDay, matchIntentPlaces } from "../lib/quickIntent";
import {
  FIXTURE_MODEL_LABEL,
  RULE_PROVIDER_LABEL,
  parseIntakeWithFallback,
  recordIntakeModelCall,
  resolveIntakeModel,
} from "../lib/intakeModel";
import {
  buildIntakeSchedules,
  draftIntakeItems,
  intakeSessionId,
  pendingLabels,
  readIntakeDrafts,
  readSavedIntakeSessions,
  readyIntakeItems,
  rememberIntakeSession,
  writeIntakeDrafts,
  type IntakeItem,
  type IntakePendingField,
} from "../lib/smartIntake";
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
  onCreateSchedules,
  owner = "",
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
  onCreateSchedules?: (places: Place[]) => void;
  owner?: string;
  onSearchPlaces: (keyword: string) => Promise<Place[]>;
  onSelectPlace: (place: Place) => void;
  onDeletePlace: (id: string) => void;
  onUpdateSchedule: (place: Place) => void;
  editSchedule: Place | null;
  onEditSchedule: (place: Place | null) => void;
}) {
  const ref = usePanelFocus(open);
  const heading = useRef<HTMLHeadingElement>(null);
  const [view, setView] = useState<"agenda" | "sources" | "import" | "compose" | "intake">("agenda");
  const [notice, setNotice] = useState("");
  const [showPast, setShowPast] = useState(false);
  const screen = editSchedule ? "compose" : view;
  const composingSchedule = screen === "compose";
  const moveTo = (next: typeof view) => {
    setView(next);
    requestAnimationFrame(() => {
      if (ref.current) ref.current.scrollTop = 0;
      if (next === "compose") document.getElementById("schedule-content")?.focus({ preventScroll: true });
      else if (next === "intake") document.getElementById("intake-text")?.focus({ preventScroll: true });
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
  const [endTime, setEndTime] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Place[]>([]);
  const [candidateFor, setCandidateFor] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchRef = useRef(onSearchPlaces);
  searchRef.current = onSearchPlaces;
  const [intakeText, setIntakeText] = useState("");
  const [intakeItems, setIntakeItems] = useState<IntakeItem[]>([]);
  const [intakeWarnings, setIntakeWarnings] = useState<string[]>([]);
  const [intakeProvider, setIntakeProvider] = useState<"" | "rule" | "fixture">("");
  const [intakeParsing, setIntakeParsing] = useState(false);
  const [intakeSession, setIntakeSession] = useState("");
  const [intakeNotice, setIntakeNotice] = useState("");
  const [savedIntakeSessions, setSavedIntakeSessions] = useState<string[]>(
    () => readSavedIntakeSessions(owner),
  );
  const intakeSaving = useRef(false);
  const cityPlaces = useMemo(
    () =>
      places.filter(
        (p) => p.city === activeCity && !p.tags.includes("日程助手"),
      ),
    [places, activeCity],
  );
  const schedules = places.filter((place) => place.tags.includes("日程助手"));
  const selected =
    candidate ?? cityPlaces.find((place) => place.id === placeId) ?? null;
  const effectiveDate = date || localDay();
  const effectiveTime = time;
  const effectiveQuery = query.trim();
  const visibleCandidates = candidateFor === effectiveQuery ? candidates : [];
  const reveal = (id: string) => {
    setDetailsOpen(true);
    requestAnimationFrame(() => document.getElementById(id)?.focus());
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
  const intakePool = useMemo(() => {
    const pool = [...systemPlaces, ...contextPlaces, ...places].filter(
      (place) => !place.tags.includes("日程助手"),
    );
    return pool.filter(
      (place, index) => pool.findIndex((other) => other.id === place.id) === index,
    );
  }, [contextPlaces, places]);
  const intakePlaceOptions = useMemo(() => {
    const preferred = [
      ...intakeItems.flatMap((item) => matchIntentPlaces(item.raw, intakePool)),
      ...intakePool.filter((place) => place.city === activeCity),
    ];
    return preferred
      .filter(
        (place, index) =>
          preferred.findIndex((other) => other.id === place.id) === index,
      )
      .slice(0, 80);
  }, [intakeItems, intakePool, activeCity]);
  const intakeReady = readyIntakeItems(intakeItems);
  const updateIntakeItem = (id: string, patch: Partial<IntakeItem>) => {
    setIntakeItems((items) =>
      items.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        const pending: IntakePendingField[] = [];
        if (!next.date) pending.push("date");
        if (!next.time) pending.push("time");
        else if (!next.endTime) pending.push("end");
        if (!next.placeId) pending.push("place");
        return { ...next, pending };
      }),
    );
  };
  const runIntake = async () => {
    if (!intakeText.trim() || intakeParsing) return;
    setIntakeParsing(true);
    setIntakeNotice("");
    const now = new Date();
    const model = resolveIntakeModel();
    const { result, usedFallback } = await parseIntakeWithFallback(
      intakeText,
      { now, places: intakePool, activeCity, idPrefix: `intake-${intakeSessionId(now)}` },
      model,
    );
    if (model && !usedFallback) recordIntakeModelCall(owner);
    const kept = [...draftIntakeItems(intakeItems), ...readIntakeDrafts(owner)];
    const merged = [...result.items];
    for (const item of kept)
      if (!merged.some((existing) => existing.id === item.id)) merged.push(item);
    setIntakeItems(merged);
    setIntakeWarnings(result.warnings);
    setIntakeProvider(result.provider);
    setIntakeSession(intakeSessionId(now));
    if (usedFallback)
      setIntakeNotice("模型暂不可用，已改用本地规则解析，可继续手动调整。");
    else if (result.provider === "fixture")
      setIntakeNotice("当前为固定测试响应，预览内容与输入无关。");
    setIntakeParsing(false);
  };
  const removeIntakeItem = (id: string) =>
    setIntakeItems((items) => items.filter((item) => item.id !== id));
  const saveIntake = () => {
    if (intakeSaving.current) return;
    if (!intakeSession || savedIntakeSessions.includes(intakeSession)) return;
    if (!intakeReady.length) return;
    intakeSaving.current = true;
    const created = buildIntakeSchedules(intakeItems, intakePool, {
      sessionId: intakeSession,
    });
    if (created.length) {
      if (onCreateSchedules) onCreateSchedules(created);
      else created.forEach(onCreateSchedule);
      rememberIntakeSession(owner, intakeSession);
      setSavedIntakeSessions(readSavedIntakeSessions(owner));
      const undated = created.filter((place) =>
        place.tags.includes("时间待确认"),
      ).length;
      const drafts = draftIntakeItems(intakeItems);
      writeIntakeDrafts(owner, drafts);
      setIntakeItems(drafts);
      setIntakeWarnings([]);
      const summary = `已保存 ${created.length} 条安排${undated ? `，其中 ${undated} 条时间待确认` : ""}`;
      if (drafts.length) {
        setIntakeSession(intakeSessionId());
        setIntakeNotice(`${summary}；${drafts.length} 条待确认草稿已保留`);
        moveTo("intake");
      } else {
        setNotice(summary);
        setIntakeText("");
        setIntakeSession("");
        moveTo("agenda");
      }
    }
    intakeSaving.current = false;
  };
  const saveDrafts = () => {
    const drafts = draftIntakeItems(intakeItems);
    if (!drafts.length) return;
    writeIntakeDrafts(owner, drafts);
    setIntakeNotice(`已保存 ${drafts.length} 条待确认草稿，补全后可再确认`);
    setNotice(`已保存 ${drafts.length} 条待确认草稿`);
  };
  useEffect(() => {
    if (!open || view !== "intake" || intakeItems.length) return;
    const drafts = readIntakeDrafts(owner);
    if (!drafts.length) return;
    setIntakeItems(drafts);
    setIntakeNotice(`已恢复 ${drafts.length} 条待确认草稿`);
  }, [open, view, owner, intakeItems.length]);
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
    endTime: string;
    content: string;
    query: string;
  } | null>(null);
  const editing = useRef(false);
  const currentDraft = useRef({ type, placeId, candidate, date, time, endTime, content, query, cityPlaces });
  currentDraft.current = { type, placeId, candidate, date, time, endTime, content, query, cityPlaces };
  useLayoutEffect(() => {
    (
      document.getElementById("schedule-content") as HTMLInputElement | null
    )?.setCustomValidity("");
    if (!editSchedule) {
      if (editing.current && newDraft.current) {
        const previous = newDraft.current;
        setType(previous.type);
        setPlaceId(previous.placeId);
        setCandidate(previous.candidate);
        setDate(previous.date);
        setTime(previous.time);
        setEndTime(previous.endTime);
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
    setEndTime(editSchedule.schedule?.endTime ?? "");
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
        <h1 ref={heading} tabIndex={-1}>{screen === "compose" ? editSchedule ? "编辑安排" : "新建安排" : screen === "import" ? "导入日历" : screen === "sources" ? "日历来源" : screen === "intake" ? "智能录入" : "日程"}</h1>
        {screen === "agenda" && <>
          {(googleCalendar || onCalendarChange || gmailAccount) && <button type="button" className="text-action" onClick={() => moveTo("sources")}>来源</button>}
          <button type="button" className="text-action" onClick={() => { setNotice(""); moveTo("intake"); }}>智能录入</button>
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
      {screen === "intake" && <div className="intake-panel">
        <label htmlFor="intake-text">用一句话或一段话描述安排</label>
        <textarea
          id="intake-text"
          rows={4}
          value={intakeText}
          onChange={(event) => setIntakeText(event.target.value)}
          placeholder="例如：明天下午三点去海上世界见客户，后天上午十点去深圳湾开会"
        />
        <div className="intake-actions">
          <button type="button" className="primary-action" onClick={runIntake} disabled={!intakeText.trim() || intakeParsing}>
            {intakeParsing ? "解析中…" : "解析安排"}
          </button>
          <button type="button" className="text-action" onClick={() => { setNotice(""); moveTo("compose"); }}>改用手动录入</button>
        </div>
        <p className="field-help" role="status">
          {intakeProvider === "fixture"
            ? FIXTURE_MODEL_LABEL
            : intakeProvider === "rule"
              ? RULE_PROVIDER_LABEL
              : "模型未配置，解析将使用本地规则"}
        </p>
        {intakeNotice && <p className="field-help" role="status">{intakeNotice}</p>}
        {intakeWarnings.length > 0 && (
          <ul className="field-help" aria-label="解析提示">
            {intakeWarnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        )}
        {intakeItems.length === 0 && intakeProvider !== "" ? (
          <p className="field-help" role="status">未识别到安排，请补充日期、时间或地点后重试，或改用手动录入。</p>
        ) : null}
        {intakeItems.length > 0 && <>
          <p className="field-help">识别到 {intakeItems.length} 条安排；确认前不会写入日程。</p>
          <ul className="intake-preview">
            {intakeItems.map((item, index) => (
              <li className="intake-item" key={item.id} data-pending={item.pending.length > 0 || undefined}>
                <div className="intake-item-head">
                  <strong>#{index + 1}</strong>
                  <input
                    aria-label={`第 ${index + 1} 条安排名称`}
                    value={item.title}
                    onChange={(event) => updateIntakeItem(item.id, { title: event.target.value })}
                  />
                  <button type="button" className="text-action" onClick={() => removeIntakeItem(item.id)}>移除</button>
                </div>
                <div className="intake-fields">
                  <label>日期
                    <input type="date" value={item.date} onChange={(event) => updateIntakeItem(item.id, { date: event.target.value })} />
                  </label>
                  <label>时间
                    <input type="time" value={item.time} onChange={(event) => updateIntakeItem(item.id, { time: event.target.value })} />
                  </label>
                  <label>结束
                    <input type="time" value={item.endTime} onChange={(event) => updateIntakeItem(item.id, { endTime: event.target.value })} />
                  </label>
                  <label className="intake-place">地点
                    <select value={item.placeId} onChange={(event) => updateIntakeItem(item.id, { placeId: event.target.value })}>
                      <option value="">待确认地点</option>
                      {item.placeId && !intakePlaceOptions.some((place) => place.id === item.placeId) && (
                        <option value={item.placeId}>已选地点</option>
                      )}
                      {intakePlaceOptions.map((place) => (
                        <option key={place.id} value={place.id}>{place.name} · {place.city}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {item.pending.length > 0 && (
                  <p className="field-help">待确认：{pendingLabels(item).join("、")}</p>
                )}
                <p className="field-help">时区：{item.timezone}（北京时间）；未知字段不会自动补全</p>
                {item.raw && <p className="field-help">原文：{item.raw}</p>}
              </li>
            ))}
          </ul>
          <p className="field-help">
            将保存 {intakeReady.length} 条
            {intakeItems.length - intakeReady.length > 0
              ? `；${intakeItems.length - intakeReady.length} 条待确认草稿会保留在本机`
              : ""}
            。
          </p>
          <button
            type="button"
            className="primary-action"
            onClick={saveIntake}
            disabled={
              intakeReady.length === 0 ||
              !intakeSession ||
              savedIntakeSessions.includes(intakeSession)
            }
          >
            确认保存 {intakeReady.length} 条
          </button>
          {intakeReady.length === 0 && (
            <button type="button" className="text-action" onClick={saveDrafts}>
              保存 {intakeItems.length} 条待确认草稿
            </button>
          )}
        </>}
      </div>}
      {composingSchedule && <form
        className="workspace-form quick-schedule-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!content.trim()) {
            const field = document.getElementById(
              "schedule-content",
            ) as HTMLInputElement | null;
            field?.setCustomValidity("写下要安排的事即可");
            field?.reportValidity();
            return;
          }
          if (!selected) {
            reveal(cityPlaces.length ? "schedule-place" : "schedule-search");
            return;
          }
          if (type === "todo" && !effectiveTime) {
            reveal("schedule-time");
            return;
          }
          const scheduleTime = `${effectiveDate}${effectiveTime ? " " + effectiveTime : ""}`;
          const carried = editSchedule?.tags.includes("智能录入") ? ["智能录入"] : [];
          const pendingTags = effectiveTime
            ? (endTime ? [] : ["结束时间待确认"])
            : ["时间待确认"];
          const next: Place = {
            ...selected,
            id: editSchedule?.id ?? `schedule-${Date.now()}-${selected.id}`,
            type: "user",
            source: "manual",
            category: "custom",
            guideCategories: ["custom"],
            tags: ["日程助手", type === "todo" ? "待办事项" : "备忘录", ...carried, ...pendingTags],
            reason: `${type === "todo" ? "待办事项" : "备忘录"} · ${scheduleTime} · ${content.trim()}`,
            description: `关联地点：${selected.name}`,
            status: editSchedule?.status ?? "want_to_go",
            isSaved: true,
            schedule: {
              startTime: effectiveTime,
              endTime: effectiveTime ? endTime : "",
              timezone: editSchedule?.schedule?.timezone ?? "Asia/Shanghai",
            },
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
          if (!editSchedule) {
            setDate("");
            setTime("");
            setEndTime("");
          }
          setNotice(editSchedule ? "已保存修改" : "");
          setShowPast(effectiveDate < localDay());
          moveTo("agenda");
        }}
      >
        <label htmlFor="schedule-content">安排名称</label>
        <input
          id="schedule-content"
          type="text"
          required
          value={content}
          onChange={(event) => {
            event.currentTarget.setCustomValidity("");
            setContent(event.target.value);
          }}
          placeholder="例如：客户拜访"
        />
        {effectiveQuery.length >= 2 && !selected && (
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
            : content.trim() && type === "todo" && !effectiveTime
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
              <label htmlFor="schedule-end-time">
                结束（选填）
                <input
                  id="schedule-end-time"
                  type="time"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </label>
            </div>
            <p className="field-help">时区：Asia/Shanghai（北京时间）</p>
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

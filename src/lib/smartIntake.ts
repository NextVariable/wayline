import type { Place } from "../types/place";
import { localDay, matchIntentPlaces, parseQuickIntent } from "./quickIntent";

export type IntakePendingField = "date" | "time" | "end" | "place";

export interface IntakeItem {
  id: string;
  raw: string;
  title: string;
  date: string;
  time: string;
  endTime: string;
  /** IANA zone used to place the arrangement on a timeline. */
  timezone: string;
  placeQuery: string;
  placeId: string;
  pending: IntakePendingField[];
  warnings: string[];
}

export interface IntakeParseOptions {
  now?: Date;
  places?: Place[];
  idPrefix?: string;
}

export interface IntakeParseResult {
  items: IntakeItem[];
  warnings: string[];
  provider: "rule" | "fixture";
}

export interface IntakeScheduleOptions {
  sessionId: string;
  now?: Date;
}

const temporalStart =
  /^(?:然后|接着|再|之后|随后|另外|还有|明早|明晚|今早|今晚|明天|后天|大后天|今天|下周|本周|这周|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}[月/.年-]|\d{1,2}\s*[点时]|上午|下午|晚上|中午|早上|凌晨)/;

/** Split a free-form paragraph into one segment per arrangement. */
export function splitIntakeText(text: string): string[] {
  return text
    .split(/\n+|。|；|;/)
    .flatMap((line) => {
      const parts = line.split(/，|,/);
      const segments: string[] = [];
      let current = parts[0] ?? "";
      for (const part of parts.slice(1)) {
        const clean = part
          .trim()
          .replace(/^(然后|接着|再|之后|随后|另外|还有)\s*/, "");
        if (temporalStart.test(clean)) {
          if (current.trim()) segments.push(current);
          current = clean;
        } else {
          current += `，${part}`;
        }
      }
      if (current.trim()) segments.push(current);
      return segments;
    })
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function titleFromSegment(segment: string, placeName: string): string {
  const cleaned = segment
    .replace(/(?:(20\d{2})[-/.年])?\d{1,2}[月/-]\d{1,2}(?:日|号)?/g, "")
    .replace(
      /大后天|今天|明天|后天|下周|本周|这周|周[一二三四五六日天]|星期[一二三四五六日天]/g,
      "",
    )
    .replace(
      /(?:上午|下午|晚上|中午|早上|凌晨)?\s*[\d零〇一二两三四五六七八九十]{1,3}[点时](?:(?:半|一刻|三刻)|[\d零〇一二两三四五六七八九十]{1,3}分?)?/g,
      "",
    )
    .replace(/\d{1,2}[:：]\d{2}/g, "")
    .replace(
      /(?:去|在|到|拜访)\s*[^，,。；;\n]+?(?=见|会面|拜访|开会|参加|商谈|讨论|，|,|。|；|;|$)/g,
      "",
    )
    .replace(/(?:提前|提早)\s*[\d零〇一二两三四五六七八九十]+分钟?提醒/g, "")
    .replace(/^(然后|接着|再|之后|随后|另外|还有)\s*/, "")
    .replace(/^[，,、\s]+|[，,、\s]+$/g, "")
    .trim();
  const action = cleaned.match(
    /(见[^，,。；;\n]{0,12}|开会|参加会议|客户拜访|项目复盘|培训|面试|签约|洽谈)/,
  )?.[1];
  const title = (action ?? cleaned).trim();
  if (title) return title.slice(0, 30);
  const destination = segment.match(/(?:去|前往|飞往)\s*([^，,。；;\n]+)/)?.[1]?.trim();
  if (destination) return `前往${destination}`.slice(0, 30);
  return placeName ? `拜访${placeName}` : "商务安排";
}

function resolvePlace(segment: string, places: Place[]) {
  const matches = matchIntentPlaces(segment, places);
  return matches.length === 1 ? matches[0] : null;
}

const DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

function clockNumber(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  if (text.includes("十")) {
    const [tens, ones] = text.split("十");
    return (tens ? (DIGITS[tens] ?? NaN) : 1) * 10 + (ones ? (DIGITS[ones] ?? NaN) : 0);
  }
  return DIGITS[text] ?? NaN;
}

function clockHour(hour: number, period?: string) {
  if (["下午", "晚上", "中午"].includes(period ?? "") && hour < 12) return hour + 12;
  if (["上午", "早上", "凌晨"].includes(period ?? "") && hour === 12) return 0;
  return hour;
}

function clockText(period: string | undefined, hourText: string, minute: string | undefined, marker: string | undefined) {
  const rawHour = clockNumber(hourText);
  const minutes = marker ? ({ 半: 30, 一刻: 15, 三刻: 45 }[marker] ?? 0) : minute ? clockNumber(minute) : 0;
  const hour = clockHour(rawHour, period);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23 || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const numericRange =
  /(?<!\d)(\d{1,2})[:：](\d{2})\s*(?:到|至|~|～|-|—)\s*(\d{1,2})[:：](\d{2})(?!\d)/;
const spokenRange =
  /(?:(上午|下午|晚上|中午|早上|凌晨)\s*)?([零〇一二两三四五六七八九十\d]{1,3})[点时](?:(半|一刻|三刻)|([零〇一二两三四五六七八九十\d]{1,3})分?)?\s*(?:到|至|~|～|-|—)\s*(?:(上午|下午|晚上|中午|早上|凌晨)\s*)?([零〇一二两三四五六七八九十\d]{1,3})[点时](?:(半|一刻|三刻)|([零〇一二两三四五六七八九十\d]{1,3})分?)?/;

/**
 * Reads an explicit start and end time. The matched phrase is removed from the
 * segment so the single-time fallback parser cannot report two conflicting times.
 * Unknown parts stay empty.
 */
export function extractIntakeRange(segment: string) {
  const numeric = segment.match(numericRange);
  if (numeric) {
    const start = `${numeric[1].padStart(2, "0")}:${numeric[2]}`;
    const end = `${numeric[3].padStart(2, "0")}:${numeric[4]}`;
    if (Number(numeric[1]) < 24 && Number(numeric[2]) < 60 && Number(numeric[3]) < 24 && Number(numeric[4]) < 60)
      return { start, end, rest: segment.replace(numeric[0], " ") };
  }
  const spoken = segment.match(spokenRange);
  if (spoken) {
    const start = clockText(spoken[1], spoken[2], spoken[4], spoken[3]);
    // "下午三点到五点": an end without its own period shares the start period.
    const end = clockText(spoken[5] ?? spoken[1], spoken[6], spoken[8], spoken[7]);
    if (start && end) return { start, end, rest: segment.replace(spoken[0], " ") };
  }
  return null;
}

function intakeTimezone(segment: string) {
  const warnings: string[] = [];
  if (/(?:东京|日本)时间|UTC\+9|GMT\+9/.test(segment))
    warnings.push("时区暂只支持北京时间，已按 Asia/Shanghai 解析");
  return { timezone: "Asia/Shanghai", warnings };
}

export function parseIntakeText(
  text: string,
  options: IntakeParseOptions = {},
): IntakeParseResult {
  const now = options.now ?? new Date();
  const places = options.places ?? [];
  const prefix = options.idPrefix ?? "intake";
  const segments = splitIntakeText(text);
  const items: IntakeItem[] = [];
  let inheritedDate = "";
  for (const [index, segment] of segments.entries()) {
    const range = extractIntakeRange(segment);
    const intent = parseQuickIntent(range?.rest ?? segment, now);
    const place = resolvePlace(segment, places);
    const date = intent.date ?? inheritedDate;
    if (intent.date) inheritedDate = intent.date;
    const placeQuery = intent.placeQuery || place?.name || "";
    const time = range?.start ?? intent.time ?? "";
    const endTime = range?.end ?? "";
    const zone = intakeTimezone(segment);
    const pending: IntakePendingField[] = [];
    if (!date) pending.push("date");
    if (!time) pending.push("time");
    else if (!endTime) pending.push("end");
    if (!place) pending.push("place");
    const title = titleFromSegment(segment, place?.name ?? placeQuery);
    items.push({
      id: `${prefix}-${index}`,
      raw: segment,
      title,
      date,
      time,
      endTime,
      timezone: zone.timezone,
      placeQuery,
      placeId: place?.id ?? "",
      pending,
      warnings: [...intent.warnings, ...zone.warnings],
    });
  }
  return {
    items,
    warnings: items
      .flatMap((item) => item.warnings)
      .filter((message, index, all) => all.indexOf(message) === index),
    provider: "rule",
  };
}

export function pendingLabels(item: IntakeItem): string[] {
  return item.pending
    .map((field) =>
      field === "date"
        ? "日期"
        : field === "time"
          ? "时间"
          : field === "end"
            ? "结束时间"
            : "地点",
    )
    .filter(Boolean);
}

/** Items that can create a schedule: a date and a resolved place are required. */
export function readyIntakeItems(items: IntakeItem[]): IntakeItem[] {
  return items.filter((item) => !!item.date && !!item.placeId);
}

/**
 * Build schedule places from confirmed intake items.
 * IDs are deterministic for a session, so a repeated confirmation cannot
 * create a second copy of the same arrangement.
 */
export function buildIntakeSchedules(
  items: IntakeItem[],
  places: Place[],
  options: IntakeScheduleOptions,
): Place[] {
  const created: Place[] = [];
  for (const [index, item] of readyIntakeItems(items).entries()) {
    const place = places.find((candidate) => candidate.id === item.placeId);
    if (!place) continue;
    const scheduleTime = `${item.date}${item.time ? ` ${item.time}` : ""}${item.endTime ? `-${item.endTime}` : ""}`;
    const kind = item.time ? "待办事项" : "备忘录";
    const endNote = item.time && !item.endTime ? "（结束时间待确认）" : "";
    created.push({
      ...place,
      id: `schedule-intake-${options.sessionId}-${index}`,
      type: "user",
      source: "manual",
      category: "custom",
      guideCategories: ["custom"],
      tags: [
        "日程助手",
        kind,
        "智能录入",
        ...(item.time ? [] : ["时间待确认"]),
        ...(item.time && !item.endTime ? ["结束时间待确认"] : []),
      ],
      reason: `${kind} · ${scheduleTime} · ${item.title}${item.time ? endNote : "（时间待确认）"}`,
      description: `关联地点：${place.name}`,
      status: "want_to_go",
      isSaved: true,
      schedule: {
        startTime: item.time,
        endTime: item.endTime,
        timezone: item.timezone,
      },
      distanceText: `${item.date}${item.time ? ` ${item.time}` : ""}`,
    });
  }
  return created;
}

const savedKey = (owner: string) => `wayline.intake.saved.${owner}`;

export function readSavedIntakeSessions(owner: string): string[] {
  if (!owner || typeof localStorage === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(savedKey(owner)) ?? "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function rememberIntakeSession(owner: string, sessionId: string) {
  if (!owner || typeof localStorage === "undefined") return;
  const next = Array.from(
    new Set([sessionId, ...readSavedIntakeSessions(owner)]),
  ).slice(0, 50);
  try {
    localStorage.setItem(savedKey(owner), JSON.stringify(next));
  } catch {
    // storage full or unavailable: the in-memory guard still blocks repeats
  }
}

export function intakeSessionId(now = new Date()) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${now.getTime()}`;
  return `${localDay(now)}-${random.slice(0, 8)}`;
}

/** Items that still miss a date or place stay as drafts instead of becoming schedules. */
export function draftIntakeItems(items: IntakeItem[]): IntakeItem[] {
  const ready = new Set(readyIntakeItems(items).map((item) => item.id));
  return items.filter((item) => !ready.has(item.id));
}

const draftsKey = (owner: string) => `wayline.intake.drafts.${owner}`;
const PENDING_FIELDS: IntakePendingField[] = ["date", "time", "end", "place"];

function isIntakeItem(value: unknown): value is IntakeItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    ["id", "raw", "title", "date", "time", "endTime", "timezone", "placeQuery", "placeId"].every(
      (key) => typeof item[key] === "string",
    ) &&
    Array.isArray(item.pending) &&
    item.pending.every((field) => PENDING_FIELDS.includes(field as IntakePendingField)) &&
    Array.isArray(item.warnings) &&
    item.warnings.every((warning) => typeof warning === "string")
  );
}

export function readIntakeDrafts(owner: string): IntakeItem[] {
  if (!owner || typeof localStorage === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(draftsKey(owner)) ?? "[]");
    return Array.isArray(value) ? value.filter(isIntakeItem).slice(0, 50) : [];
  } catch {
    return [];
  }
}

export function writeIntakeDrafts(owner: string, items: IntakeItem[]) {
  if (!owner || typeof localStorage === "undefined") return;
  try {
    if (items.length === 0) localStorage.removeItem(draftsKey(owner));
    else localStorage.setItem(draftsKey(owner), JSON.stringify(items.slice(0, 50)));
  } catch {
    // storage unavailable: drafts stay in memory for this session
  }
}

export function clearIntakeDrafts(owner: string) {
  writeIntakeDrafts(owner, []);
}

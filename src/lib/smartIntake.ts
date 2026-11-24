import type { Place } from "../types/place";
import { localDay, matchIntentPlaces, parseQuickIntent } from "./quickIntent";

export type IntakePendingField = "date" | "time" | "place";

export interface IntakeItem {
  id: string;
  raw: string;
  title: string;
  date: string;
  time: string;
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
    .replace(/^(然后|接着|再|之后|随后|另外|还有)\s*/, "")
    .replace(/^[，,、\s]+|[，,、\s]+$/g, "")
    .trim();
  const action = cleaned.match(
    /(见[^，,。；;\n]{0,12}|开会|参加会议|客户拜访|项目复盘|培训|面试|签约|洽谈)/,
  )?.[1];
  const title = (action ?? cleaned).trim();
  if (title) return title.slice(0, 30);
  return placeName ? `拜访${placeName}` : "商务安排";
}

function resolvePlace(segment: string, places: Place[]) {
  const matches = matchIntentPlaces(segment, places);
  return matches.length === 1 ? matches[0] : null;
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
    const intent = parseQuickIntent(segment, now);
    const place = resolvePlace(segment, places);
    const date = intent.date ?? inheritedDate;
    if (intent.date) inheritedDate = intent.date;
    const placeQuery = intent.placeQuery || place?.name || "";
    const pending: IntakePendingField[] = [];
    if (!date) pending.push("date");
    if (!intent.time) pending.push("time");
    if (!place) pending.push("place");
    const title = titleFromSegment(segment, place?.name ?? placeQuery);
    items.push({
      id: `${prefix}-${index}`,
      raw: segment,
      title,
      date,
      time: intent.time ?? "",
      placeQuery,
      placeId: place?.id ?? "",
      pending,
      warnings: intent.warnings,
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
      field === "date" ? "日期" : field === "time" ? "时间" : "地点",
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
    const scheduleTime = `${item.date}${item.time ? ` ${item.time}` : ""}`;
    const kind = item.time ? "待办事项" : "备忘录";
    created.push({
      ...place,
      id: `schedule-intake-${options.sessionId}-${index}`,
      type: "user",
      source: "manual",
      category: "custom",
      guideCategories: ["custom"],
      tags: ["日程助手", kind, "智能录入", ...(item.time ? [] : ["时间待确认"])],
      reason: `${kind} · ${scheduleTime} · ${item.title}${item.time ? "" : "（时间待确认）"}`,
      description: `关联地点：${place.name}`,
      status: "want_to_go",
      isSaved: true,
      distanceText: scheduleTime,
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

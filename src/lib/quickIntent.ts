import type { Place } from "../types/place";
export const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const digits: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
function number(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  if (text.includes("十")) {
    const [a, b] = text.split("十");
    return (a ? (digits[a] ?? NaN) : 1) * 10 + (b ? (digits[b] ?? NaN) : 0);
  }
  return digits[text] ?? NaN;
}
function dateValue(year: number, month: number, day: number) {
  const value = new Date(year, month - 1, day, 12);
  return value.getFullYear() === year &&
    value.getMonth() === month - 1 &&
    value.getDate() === day
    ? localDay(value)
    : null;
}
function clockHour(hour: number, period?: string) {
  if (["下午", "晚上", "中午"].includes(period ?? "") && hour < 12) return hour + 12;
  if (["上午", "早上", "凌晨"].includes(period ?? "") && hour === 12) return 0;
  return hour;
}

export function parseQuickIntent(text: string, now = new Date()) {
  text = text
    .replace(/明早/g, "明天早上")
    .replace(/明晚/g, "明天晚上")
    .replace(/今早/g, "今天早上")
    .replace(/今晚/g, "今天晚上");
  const dates: string[] = [],
    times: string[] = [];
  const warnings: string[] = [];
  const addDate = (value: string | null) => {
    if (value) dates.push(value);
    else warnings.push("日期不存在，请修改");
  };
  const explicitDates = Array.from(
    text.matchAll(/(?:(20\d{2})[-/.年])?(\d{1,2})[月/-](\d{1,2})(?:日|号)?/g),
  );
  for (const match of explicitDates)
    addDate(
      dateValue(
        Number(match[1] ?? now.getFullYear()),
        Number(match[2]),
        Number(match[3]),
      ),
    );
  for (const match of text.matchAll(/大后天|今天|明天|后天/g)) {
    const value = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      12,
    );
    value.setDate(
      value.getDate() +
        ({ 今天: 0, 明天: 1, 后天: 2, 大后天: 3 }[match[0]] ?? 0),
    );
    dates.push(localDay(value));
  }
  for (const match of text.matchAll(
    /(?:(下周|本周|这周)|周|星期)([一二三四五六日天])/g,
  )) {
    const target = "日一二三四五六".indexOf(match[2].replace("天", "日"));
    const today = now.getDay() || 7,
      weekday = target || 7;
    let delta =
      match[1] === "下周"
        ? 7 - today + weekday
        : match[1]
          ? weekday - today
          : (target - now.getDay() + 7) % 7;
    const value = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + delta,
      12,
    );
    dates.push(localDay(value));
  }
  for (const match of text.matchAll(/(?<!\d)(?:(上午|下午|晚上|中午|早上|凌晨)\s*)?(\d{1,2})[:：](\d{2})(?!\d)/g)) {
    const hour = clockHour(Number(match[2]), match[1]),
      minute = Number(match[3]);
    if (hour <= 23 && minute <= 59)
      times.push(
        `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      );
    else warnings.push("时间无效，请修改");
  }
  for (const match of text.matchAll(
    /(?:(上午|下午|晚上|中午|早上|凌晨)\s*)?([零〇一二两三四五六七八九十\d]{1,3})[点时](?:(半|一刻|三刻)|([零〇一二两三四五六七八九十\d]{1,3})分?)?/g,
  )) {
    const rawHour = number(match[2]);
    const minute = match[3]
      ? ({ 半: 30, 一刻: 15, 三刻: 45 }[match[3]] ?? 0)
      : match[4]
        ? number(match[4])
        : 0;
    if (!match[1] && rawHour >= 1 && rawHour <= 12) {
      warnings.push("请说明上午或下午，或用24小时制时间");
      continue;
    }
    const hour = clockHour(rawHour, match[1]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)
      times.push(
        `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      );
    else warnings.push("时间无效，请修改");
  }
  if (!dates.length && /下周|本周|这周|星期|下(?:个)?月|明年|后年/.test(text))
    warnings.push("请补充具体日期");
  const uniqueDates = Array.from(new Set(dates)),
    uniqueTimes = Array.from(new Set(times));
  if (uniqueDates.length > 1)
    warnings.push("包含多个日期，请一次保存一条安排或手动指定");
  if (uniqueTimes.length > 1)
    warnings.push("包含多个时间，请指定本条安排的时间");
  const days = Array.from(
    text.matchAll(/([一二两三四五六七八九十百\d]+)天/g),
  ).map((match) => number(match[1]));
  if (!days.length) {
    const nights = Array.from(text.matchAll(/(?:住|住宿|停留)\s*([一二两三四五六七八九十百\d]+)晚/g), match => number(match[1]));
    days.push(...nights.map(night => night + 1));
  }
  const placeQuery =
    text
      .match(
        /(?:去|在|到|拜访)\s*([^，,。；;\n]+?)(?=见|会面|拜访|开会|参加|商谈|讨论|，|,|。|；|;|$)/,
      )?.[1]
      ?.trim() ?? "";
  return {
    date: uniqueDates.length === 1 ? uniqueDates[0] : null,
    time: uniqueTimes.length === 1 ? uniqueTimes[0] : null,
    days: days.length === 1 && days[0] >= 1 && days[0] <= 7 ? days[0] : null,
    unsupportedDays:
      new Set(days).size > 1 ||
      days.some((value) => !Number.isFinite(value) || value < 1 || value > 7),
    placeQuery:
      placeQuery.length >= 2 && placeQuery.length <= 60 ? placeQuery : "",
    warnings: Array.from(new Set(warnings)),
  };
}
export function matchIntentPlaces(text: string, places: Place[]): Place[] {
  const normalized = text.toLowerCase().replace(/\s+/g, "");
  const matches = places.filter(
    (place) =>
      !place.tags.includes("日程助手") &&
      place.name.length >= 2 &&
      normalized.includes(place.name.toLowerCase().replace(/\s+/g, "")),
  );
  const unique = matches.filter(
    (place, index) =>
      matches.findIndex(
        (other) => other.name === place.name && other.city === place.city,
      ) === index,
  );
  return unique
    .filter(
      (place) =>
        !unique.some(
          (other) =>
            other.name !== place.name && other.name.includes(place.name),
        ),
    )
    .filter((place) => {
      const sameName = unique.filter((other) => other.name === place.name);
      return sameName.length === 1 || normalized.includes(place.city);
    });
}

export function matchingSchedules(
  route: Place[],
  schedules: Place[],
  today = localDay(),
) {
  return schedules.filter(
    (schedule) =>
      schedule.tags.includes("日程助手") &&
      schedule.tags.includes("待办事项") &&
      schedule.status !== "visited" &&
      /^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?$/.test(schedule.distanceText) &&
      schedule.distanceText.slice(0, 10) >= today &&
      route.some(
        (place) => place.name === schedule.name && place.city === schedule.city,
      ),
  );
}
export function scheduleContext(
  schedules: Place[],
  date: string,
  days: number,
) {
  const [year, month, day] = date.split("-").map(Number);
  const end = localDay(new Date(year, month - 1, day + days - 1, 12));
  return schedules
    .filter(
      (schedule) =>
        schedule.distanceText.slice(0, 10) >= date &&
        schedule.distanceText.slice(0, 10) <= end,
    )
    .map(
      (schedule) =>
        `${schedule.name}（${schedule.city}） ${schedule.distanceText}：${schedule.reason.split(" · ").slice(2).join(" · ")}`,
    );
}

export function changedIntentFields(
  previous: string,
  next: string,
  base = new Date(),
) {
  const before = parseQuickIntent(previous, base),
    after = parseQuickIntent(next, base);
  const warnings = (
    value: ReturnType<typeof parseQuickIntent>,
    date: boolean,
  ) =>
    value.warnings
      .filter((message) => message.includes("日期") === date)
      .join("|");
  return {
    date:
      before.date !== after.date ||
      warnings(before, true) !== warnings(after, true),
    time:
      before.time !== after.time ||
      warnings(before, false) !== warnings(after, false),
    days:
      before.days !== after.days ||
      before.unsupportedDays !== after.unsupportedDays,
    place: before.placeQuery !== after.placeQuery,
  };
}

/** A trip may span several explicit dates; a single schedule entry may not. */
export function tripWindowFromText(text:string, now=new Date()):{date:string;days:number}|null {
  const matches=[...text.matchAll(/(?:(20\d{2})[-/.年])?(\d{1,2})[月/-](\d{1,2})(?:日|号)?/g)];
  if(!matches.length)return null;
  const dates=matches.map(m=>dateValue(Number(m[1]??now.getFullYear()),Number(m[2]),Number(m[3])));
  if(dates.some(d=>!d))return null;
  const sorted=[...new Set(dates as string[])].sort();
  const days=(Date.parse(sorted.at(-1)!)-Date.parse(sorted[0]))/86400000+1;
  return days>=1&&days<=7?{date:sorted[0],days}:null;
}

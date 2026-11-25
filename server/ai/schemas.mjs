/**
 * Business-schema validation for model output.
 * A JSON response is not proof of valid data: every field is re-validated here
 * before it can reach the preview or a proposal. Unknown information stays empty.
 */

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FORBIDDEN_ITEM_KEYS = ["lat", "lng", "latitude", "longitude", "coordinate", "coordinates", "booking", "bookingId", "order", "orderId", "price", "confirmation"];
const FORBIDDEN_PROPOSAL_KEYS = ["lat", "lng", "latitude", "longitude", "booking", "order", "calendar", "gmail", "email", "payment", "gps"];

const DAY_MS = 86_400_000;
const shanghaiDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function shanghaiDay(now = Date.now()) {
  return shanghaiDate.format(new Date(now));
}

function dayNumber(date) {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / DAY_MS) : NaN;
}

/** Accepts a real calendar date without the "future window" restriction. */
function calendarDate(value) {
  const text = String(value ?? "").trim();
  if (!DATE.test(text)) return "";
  const [year, month, day] = text.split("-").map(Number);
  const parsed = new Date(`${text}T00:00:00Z`);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day)
    return "";
  return text;
}

/** Next calendar day, used only for an explicit cross-midnight end. */
function nextDate(date) {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) ? new Date(parsed + DAY_MS).toISOString().slice(0, 10) : "";
}

export function validDate(value, now = Date.now()) {
  const text = String(value ?? "").trim();
  if (!DATE.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  if (parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) return false;
  const today = dayNumber(shanghaiDay(now));
  const target = dayNumber(text);
  return target >= today - 1 && target <= today + 366;
}

export function validTime(value) {
  return TIME.test(String(value ?? "").trim());
}

export function normalizeTime(value) {
  const text = String(value ?? "").trim();
  const match = text.match(TIME);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

const normalizeName = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[\s·•,，。;；()（）\-—_]/g, "")
    .trim();

export function matchPlace(placeQuery, city, places = []) {
  const query = normalizeName(placeQuery);
  if (!query) return { place: null, ambiguous: [] };
  const pool = places.filter((place) => place && typeof place.id === "string" && typeof place.name === "string");
  const sameCity = (place) => !city || !place.city || place.city === city;
  const exact = pool.filter((place) => normalizeName(place.name) === query);
  const preferredExact = exact.filter(sameCity);
  const exactPool = preferredExact.length ? preferredExact : exact;
  if (exactPool.length === 1) return { place: exactPool[0], ambiguous: [] };
  if (exactPool.length > 1) return { place: null, ambiguous: exactPool.slice(0, 5) };
  const partial = pool.filter((place) => {
    const name = normalizeName(place.name);
    return name.includes(query) || query.includes(name);
  });
  const preferred = partial.filter(sameCity);
  const candidates = preferred.length ? preferred : partial;
  if (candidates.length === 1) return { place: candidates[0], ambiguous: [] };
  if (candidates.length > 1) {
    // Prefer a city match only if it is unique; otherwise leave the ambiguity to the user.
    const uniqueCities = new Set(candidates.map((place) => place.city));
    if (preferred.length === 1 && uniqueCities.size > 1) return { place: preferred[0], ambiguous: [] };
    return { place: null, ambiguous: candidates.slice(0, 5) };
  }
  return { place: null, ambiguous: [] };
}

function cleanText(value, max = 60) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Strips markdown fences and finds the outermost JSON object. */
export function parseModelJson(content) {
  const text = String(content ?? "").trim();
  if (!text) return null;
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function validateIntakeOutput(raw, { now = Date.now(), places = [], prefix = "ai" } = {}) {
  const warnings = [];
  const rows = Array.isArray(raw?.items) ? raw.items
    : Array.isArray(raw?.arrangements) ? raw.arrangements
      : Array.isArray(raw) ? raw
        : [];
  if (!rows.length) return { items: [], warnings: ["模型未返回可用的安排"] };
  if (rows.length > 8) warnings.push("单次最多预览 8 条安排，其余已省略");

  for (const row of rows.slice(0, 8)) {
    for (const key of FORBIDDEN_ITEM_KEYS) {
      if (row && typeof row === "object" && Object.prototype.hasOwnProperty.call(row, key))
        warnings.push("模型返回了地理或订单字段，已忽略；坐标与订单只能来自真实来源");
    }
  }

  const items = rows.slice(0, 8).map((row, index) => {
    const source = row && typeof row === "object" ? row : {};
    const itemWarnings = [];
    const title = cleanText(source.title ?? source.summary ?? source.activity, 40) || "商务安排";
    if (title === "商务安排") itemWarnings.push("标题缺失，已留待确认");
    const rawDate = cleanText(source.date ?? source.startDate, 10);
    let date = "";
    if (!rawDate) itemWarnings.push("日期缺失");
    else if (!validDate(rawDate, now)) itemWarnings.push("日期超出可接受范围，已留空");
    else date = rawDate;
    const start = normalizeTime(source.startTime ?? source.time ?? source.start);
    const end = normalizeTime(source.endTime ?? source.end);
    if ((source.startTime || source.time) && !start) itemWarnings.push("开始时间格式无效，已留空");
    if ((source.endTime || source.end) && !end) itemWarnings.push("结束时间格式无效，已留空");
    let endTime = end;
    let endDate = "";
    if (start && end) {
      if (end > start) {
        // Same-day range; an end date is only meaningful when the end crosses midnight.
        endDate = "";
      } else {
        const explicit = calendarDate(source.endDate ?? source.end_date);
        const next = date ? nextDate(date) : "";
        if (!date) {
          // The start date is unknown, so the end date cannot be inferred.
          endTime = "";
          itemWarnings.push("缺少开始日期，跨日结束时间已留待确认");
        } else if (explicit && explicit !== date && explicit !== next) {
          endTime = "";
          itemWarnings.push("结束日期超出单次日程范围，已留待确认");
        } else {
          endDate = next;
          if (!explicit) itemWarnings.push("结束时间早于开始时间，已按次日处理，请确认");
        }
      }
    }
    const zone = cleanText(source.timezone, 40);
    if (zone && zone !== "Asia/Shanghai") itemWarnings.push("仅按北京时间解析，已使用 Asia/Shanghai");
    const placeQuery = cleanText(source.placeQuery ?? source.place ?? source.location, 60);
    const matched = placeQuery ? matchPlace(placeQuery, cleanText(source.city, 20), places) : { place: null, ambiguous: [] };
    if (matched.ambiguous.length)
      itemWarnings.push(`地点「${placeQuery}」有多个候选，请在预览中选择`);
    const pending = [];
    if (!date) pending.push("date");
    if (!start) pending.push("time");
    else if (!endTime) pending.push("end");
    if (!matched.place) pending.push("place");
    return {
      id: `${prefix}-${index}`,
      raw: "",
      title,
      date,
      time: start,
      endTime,
      endDate,
      timezone: "Asia/Shanghai",
      placeQuery,
      placeId: matched.place?.id ?? "",
      pending,
      warnings: itemWarnings,
    };
  });

  return {
    items,
    warnings: [...new Set([...warnings, ...items.flatMap((item) => item.warnings)])],
  };
}

const PROPOSAL_OPERATIONS = new Set(["create", "update"]);
const PROPOSAL_TEXT_FIELDS = ["title", "reason"];

/**
 * Accepts only local schedule changes the product already supports.
 * External mail, calendar, booking, payment and coordinate effects are dropped.
 */
export function validateCopilotOutput(raw, { now = Date.now() } = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const warnings = [];
  const message = cleanText(source.message ?? source.reply ?? source.answer, 1200);
  if (!message) return { message: "", warnings: ["模型未返回可读回答"], proposal: null };

  const candidate = source.proposal ?? source.proposedAction ?? null;
  if (!candidate || typeof candidate !== "object") return { message, warnings, proposal: null };
  for (const key of FORBIDDEN_PROPOSAL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(candidate, key)) {
      warnings.push("模型尝试修改外部来源或携带坐标，已拒绝该部分");
      return { message, warnings, proposal: null };
    }
  }
  const operation = cleanText(candidate.operation ?? candidate.op, 20);
  if (!PROPOSAL_OPERATIONS.has(operation)) {
    warnings.push("模型提出的操作不在允许范围内，已忽略");
    return { message, warnings, proposal: null };
  }
  const targetId = cleanText(candidate.targetId ?? candidate.eventId, 120);
  if (operation === "update" && !targetId) {
    warnings.push("修改提案缺少目标安排，已忽略");
    return { message, warnings, proposal: null };
  }
  const placeId = cleanText(candidate.placeId, 120);
  const date = cleanText(candidate.date, 10);
  if (date && !validDate(date, now)) {
    warnings.push("提案日期超出允许范围，已忽略该提案");
    return { message, warnings, proposal: null };
  }
  const startTime = normalizeTime(candidate.startTime ?? candidate.time);
  let endTime = normalizeTime(candidate.endTime);
  let endDate = "";
  if (startTime && endTime && endTime <= startTime) {
    const explicit = calendarDate(candidate.endDate ?? candidate.end_date);
    const next = date ? nextDate(date) : "";
    if (next && explicit === next) endDate = next;
    else {
      endTime = "";
      warnings.push("提案结束时间不晚于开始时间，已留待确认");
    }
  }
  if (operation === "update" && !placeId && !date && !startTime && !endTime && !candidate.title) {
    warnings.push("提案没有可执行的修改内容");
    return { message, warnings, proposal: null };
  }
  const proposal = { kind: "schedule-change", operation, targetId, placeId, date, startTime, endTime, endDate };
  for (const field of PROPOSAL_TEXT_FIELDS) {
    const value = cleanText(candidate[field], field === "reason" ? 160 : 40);
    if (value) proposal[field] = value;
  }
  return { message, warnings, proposal };
}

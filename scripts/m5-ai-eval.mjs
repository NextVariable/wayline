#!/usr/bin/env node
/**
 * M5 intake evaluation: 100 labelled Chinese cases covering absolute/relative
 * dates, colloquial times, duplicate places, missing fields, complex multi-item
 * input and cross-midnight ranges. Writes raw items plus per-field checks.
 *
 * Run: node scripts/m5-ai-eval.mjs [--json docs/m5-ai-eval.json]
 */
import fs from "node:fs";
import { readAiConfig } from "../server/ai/config.mjs";
import { createAiBudget, createFileUsageStore } from "../server/ai/budget.mjs";
import { createDeepSeekProvider } from "../server/ai/provider.mjs";
import { runIntake } from "../server/ai/harness.mjs";
import { shanghaiDay } from "../server/ai/schemas.mjs";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const index = trimmed.indexOf("=");
  if (index < 1) continue;
  const key = trimmed.slice(0, index).trim();
  if (key && !process.env[key]) process.env[key] = trimmed.slice(index + 1).trim();
}

const config = readAiConfig(process.env);
if (!config.enabled) {
  console.error(`AI disabled: ${config.reason}`);
  process.exit(2);
}
const usageFile = process.env.AI_USAGE_FILE || ".wayline-private/ai-usage.json";
const budget = createAiBudget({ config, store: createFileUsageStore(usageFile) });
const provider = createDeepSeekProvider({ config });
const now = Date.now();
const DAY = 86_400_000;
const day = (offset) => shanghaiDay(now + offset * DAY);
const dateIndex = (offset) => {
  const iso = day(offset);
  const [, month, date] = iso.split("-");
  return `${Number(month)}月${Number(date)}日`;
};
const dow = new Date(now + 8 * 3_600_000).getUTCDay();
const nextFridayOffset = ((5 - dow + 7) % 7) || 7;
const nextWeekWednesdayOffset = (() => {
  const toNextMonday = ((8 - dow) % 7) || 7;
  return toNextMonday + 2;
})();

const places = [
  { id: "p-sh-tower", name: "上海中心大厦", city: "上海" },
  { id: "p-jingan", name: "静安嘉里中心", city: "上海" },
  { id: "p-raffles", name: "人民广场来福士", city: "上海" },
  { id: "p-hongqiao", name: "虹桥机场T2", city: "上海" },
  { id: "p-rail", name: "虹桥火车站", city: "上海" },
  { id: "p-sz-center", name: "深圳湾体育中心", city: "深圳" },
  { id: "p-sea-sz", name: "海上世界", city: "深圳" },
  { id: "p-sea-sh", name: "海上世界", city: "上海" },
  { id: "p-office", name: "客户办公室", city: "深圳" },
];
const byId = new Map(places.map((place) => [place.id, place]));
const placeNames = places.map((place) => place.name);

const cases = [];
const push = (category, text, activeCity, expect) => cases.push({ id: `c${cases.length + 1}`, category, text, activeCity, expect });

// A. 20 absolute dates, single item.
const activities = ["见客户", "开会", "产品评审", "培训", "面试", "签约", "复盘", "接客户"];
const clockTexts = [
  ["上午", "九点", "09:00"], ["上午", "十点", "10:00"], ["上午", "十一点半", "11:30"],
  ["下午", "两点", "14:00"], ["下午", "三点", "15:00"], ["下午", "四点半", "16:30"],
  ["晚上", "七点", "19:00"], ["晚上", "八点", "20:00"],
];
for (let i = 0; i < 20; i++) {
  const offset = 1 + (i % 14);
  const [period, spoken, time] = clockTexts[i % clockTexts.length];
  const place = places[(i + 1) % 5]; // 上海 places only
  const activity = activities[i % activities.length];
  push("absolute", `${dateIndex(offset)}${period}${spoken}在${place.name}${activity}`, place.city,
    [{ date: day(offset), start: time, end: "", place: place.id, keywords: [activity] }]);
}

// B. 15 relative dates.
const relative = [
  ["明天", 1], ["后天", 2], ["周五", nextFridayOffset], ["下周三", nextWeekWednesdayOffset],
];
for (let i = 0; i < 15; i++) {
  const [label, offset] = relative[i % relative.length];
  const [period, spoken, time] = clockTexts[(i + 2) % clockTexts.length];
  const place = places[(i + 2) % 5];
  const activity = activities[(i + 3) % activities.length];
  push("relative", `${label}${period}${spoken}在${place.name}${activity}`, place.city,
    [{ date: day(offset), start: time, end: "", place: place.id, keywords: [activity] }]);
}

// C. 15 colloquial/fuzzy times. Noon/dusk stay unknown, not 12:00/18:00.
const colloquial = [
  ["上午十点", "10:00"], ["下午三点半", "15:30"], ["晚上七点", "19:00"],
  ["早上八点", "08:00"], ["晚上八点半", "20:30"], ["下午四点", "16:00"],
  ["上午十一点", "11:00"], ["中午", ""], ["傍晚", ""], ["下午三点左右", "15:00"],
];
for (let i = 0; i < 15; i++) {
  const [spoken, time] = colloquial[i % colloquial.length];
  const place = places[(i + 3) % 5];
  const activity = activities[(i + 5) % activities.length];
  push("colloquial", `明天${spoken}在${place.name}${activity}`, place.city,
    [{ date: day(1), start: time, end: "", place: place.id, keywords: [activity] }]);
}

// D. 10 duplicate place names across cities; active city decides the ID.
for (let i = 0; i < 10; i++) {
  const city = i % 2 === 0 ? "深圳" : "上海";
  const placeId = city === "深圳" ? "p-sea-sz" : "p-sea-sh";
  const activity = activities[(i + 1) % activities.length];
  push("duplicate", `明天上午十点去海上世界${activity}`, city,
    [{ date: day(1), start: "10:00", end: "", place: placeId, keywords: [activity] }]);
}

// E. 15 missing-field cases.
const missing = [
  ["明天下午两点和供应商开会", "深圳", { date: day(1), start: "14:00", end: "", place: "", keywords: ["开会"] }],
  ["明天上午十点去上海中心大厦", "上海", { date: day(1), start: "10:00", end: "", place: "p-sh-tower", keywords: ["上海中心大厦"] }],
  ["明天去客户办公室", "深圳", { date: day(1), start: "", end: "", place: "p-office", keywords: ["客户办公室"] }],
  ["明天上午十点见客户", "深圳", { date: day(1), start: "10:00", end: "", place: "", keywords: ["见客户"] }],
  ["后天下午三点在深圳湾体育中心", "深圳", { date: day(2), start: "15:00", end: "", place: "p-sz-center", keywords: ["深圳湾体育中心"] }],
];
for (let i = 0; i < 15; i++) {
  const [text, city, expected] = missing[i % missing.length];
  push("missing", text, city, [{ ...expected }]);
}

// F. 15 complex multi-item cases.
for (let i = 0; i < 15; i++) {
  const city = i % 2 === 0 ? "上海" : "深圳";
  const [p1, p2, p3] = city === "上海"
    ? [byId.get("p-sh-tower"), byId.get("p-jingan"), byId.get("p-raffles")]
    : [byId.get("p-sz-center"), byId.get("p-sea-sz"), byId.get("p-office")];
  const secondDate = i % 3 === 0 ? "后天" : "明天";
  const secondOffset = secondDate === "明天" ? 1 : 2;
  push("complex", `明天上午十点在${p1.name}见客户，${secondDate}下午三点在${p2.name}开会，${secondDate}晚上七点在${p3.name}吃饭`, city, [
    { date: day(1), start: "10:00", end: "", place: p1.id, keywords: ["见客户"] },
    { date: day(secondOffset), start: "15:00", end: "", place: p2.id, keywords: ["开会"] },
    { date: day(secondOffset), start: "19:00", end: "", place: p3.id, keywords: ["吃饭"] },
  ]);
}

// G. 10 cross-midnight cases. One arrangement per range with an explicit
// next-day endDate; splitting into two items fails the count check.
const crossMidnight = [
  ["今晚十一点到明天凌晨一点在上海中心大厦加班", "上海", "p-sh-tower", "加班", "23:00", "01:00"],
  ["今晚十点到明天早上六点在客户办公室值班", "深圳", "p-office", "值班", "22:00", "06:00"],
  ["周五晚上十点到周六凌晨两点在深圳湾体育中心布置会场", "深圳", "p-sz-center", "布置会场", "22:00", "02:00"],
  ["明天晚上十一点到后天凌晨三点在虹桥机场T2接客户", "上海", "p-hongqiao", "接客户", "23:00", "03:00"],
  ["今晚九点半到明天凌晨零点在静安嘉里中心复盘", "上海", "p-jingan", "复盘", "21:30", "00:00"],
];
for (let i = 0; i < 10; i++) {
  const [text, city, placeId, activity, start, end] = crossMidnight[i % crossMidnight.length];
  const startOffset = text.startsWith("周五") ? nextFridayOffset : text.startsWith("明天") ? 1 : 0;
  push("cross-midnight", text, city,
    [{ date: day(startOffset), start, end, endDate: day(startOffset + 1), place: placeId, keywords: [activity] }]);
}

const owners = ["eval-m5-a", "eval-m5-b", "eval-m5-c", "eval-m5-d"];
const ownerFor = (index) => owners[Math.floor(index / 25) % owners.length];
// Targeted rerun: one fresh eval account per case, so the per-account daily
// call guard is never the reason a sample fails. Evidence goes to its own file.
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : "";
const selected = only ? cases.filter((test) => test.category === only) : cases;
const usedOwners = new Set();
const report = {
  generatedAt: new Date().toISOString(),
  model: config.model,
  thinking: config.thinking,
  totalCases: selected.length,
  cases: [],
  accuracy: {},
  categories: {},
  usage: {},
};
const tally = (bucket, key, ok) => {
  bucket[key] ??= { ok: 0, total: 0 };
  bucket[key].total += 1;
  if (ok) bucket[key].ok += 1;
};
const overall = { date: { ok: 0, total: 0 }, start: { ok: 0, total: 0 }, end: { ok: 0, total: 0 }, endDate: { ok: 0, total: 0 }, place: { ok: 0, total: 0 }, title: { ok: 0, total: 0 }, count: { ok: 0, total: 0 } };
const byCategory = {};

for (let index = 0; index < selected.length; index++) {
  const test = selected[index];
  const owner = only ? `eval-m5r-${test.id}` : ownerFor(cases.indexOf(test));
  usedOwners.add(owner);
  const result = await runIntake({
    provider, budget, config,
    input: { owner, text: test.text, activeCity: test.activeCity },
    places, now,
  });
  const record = { ...test, ok: result.ok, code: result.ok ? "ok" : result.code, items: result.ok ? result.items : [], expected: test.expect };
  report.cases.push(record);
  const category = (byCategory[test.category] ??= { date: { ok: 0, total: 0 }, start: { ok: 0, total: 0 }, end: { ok: 0, total: 0 }, endDate: { ok: 0, total: 0 }, place: { ok: 0, total: 0 }, title: { ok: 0, total: 0 }, count: { ok: 0, total: 0 } });
  const countOk = result.ok && result.items.length === test.expect.length;
  tally(overall, "count", countOk); tally(category, "count", countOk);
  if (!result.ok) continue;
  const rows = Math.min(result.items.length, test.expect.length);
  for (let i = 0; i < rows; i++) {
    const item = result.items[i];
    const expected = test.expect[i];
    const resolved = byId.get(item.placeId);
    const checks = {
      date: item.date === expected.date,
      start: (item.time || "") === (expected.start || ""),
      end: (item.endTime || "") === (expected.end || ""),
      place: expected.place
        ? item.placeId === expected.place
        : !item.placeId && !item.placeQuery,
      title: expected.keywords.some((keyword) => String(item.title || "").includes(keyword)),
    };
    item._checks = checks;
    for (const key of ["date", "start", "end", "place", "title"]) {
      tally(overall, key, checks[key]); tally(category, key, checks[key]);
    }
    if (expected.endDate) {
      // Only cross-midnight cases carry an explicit end date.
      const ok = item.endDate === expected.endDate;
      item._checks.endDate = ok;
      tally(overall, "endDate", ok); tally(category, "endDate", ok);
    }
    if (!checks.place) item._resolvedPlace = resolved?.name ?? null;
  }
}

const rate = (bucket) => Object.fromEntries(Object.entries(bucket).map(([key, value]) => [
  key, { ok: value.ok, total: value.total, rate: value.total ? Math.round(value.ok / value.total * 1000) / 10 : null },
]));
report.accuracy = rate(overall);
report.categories = Object.fromEntries(Object.entries(byCategory).map(([key, value]) => [key, rate(value)]));
for (const owner of usedOwners) report.usage[owner] = budget.snapshot(owner);
report.dailySpentUsd = budget.snapshot().spentUsd;

const arg = process.argv.indexOf("--json");
const output = arg >= 0 ? process.argv[arg + 1] : "docs/m5-ai-eval.json";
fs.mkdirSync(output.split("/").slice(0, -1).join("/") || ".", { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ cases: report.totalCases, accuracy: report.accuracy, categories: report.categories, usage: report.usage, dailySpentUsd: report.dailySpentUsd }, null, 2));

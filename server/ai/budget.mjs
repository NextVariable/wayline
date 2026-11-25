/**
 * Server-authoritative usage and budget ledger for paid model calls.
 *
 * - Per-account daily call limit
 * - Global daily spend limit (USD, computed from recorded tokens)
 * - Per-task token ceiling is enforced by the adapter's max_tokens request
 * - Records tasks for the delivery report
 *
 * The browser never decides whether a paid call is allowed; localStorage is not
 * used as a budget control. When no approved budget exists every call is refused.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const CURRENCY_SCALE = 1_000_000;
const KEEP_DAYS = 14;

const shanghaiDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function usageDay(now = Date.now()) {
  return shanghaiDay.format(new Date(now));
}

function emptyDay() {
  return { calls: {}, inputTokens: 0, outputTokens: 0, costUsd: 0, tasks: {} };
}

export function emptyUsage() {
  return { version: 1, days: {} };
}

/** In-memory store used by tests and by a server running without a data dir. */
export function createMemoryUsageStore(seed = emptyUsage()) {
  let data = structuredClone(seed);
  return {
    read: () => structuredClone(data),
    write: (next) => { data = structuredClone(next); },
  };
}

/** Small JSON ledger kept outside the web root, next to the other private state. */
export function createFileUsageStore(file) {
  let cache;
  const read = () => {
    if (cache) return structuredClone(cache);
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      cache = parsed && typeof parsed === "object" && parsed.days ? parsed : emptyUsage();
    } catch {
      cache = emptyUsage();
    }
    return structuredClone(cache);
  };
  const write = (data) => {
    cache = structuredClone(data);
    try {
      mkdirSync(dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, JSON.stringify(data, null, 2));
      renameSync(temporary, file);
    } catch {
      // A read-only disk must not break chat flows; the in-process ledger still applies.
    }
  };
  return { read, write };
}

export function createAiBudget({ config, store = createMemoryUsageStore(), now = Date.now }) {
  const readDay = (data, day) => {
    data.days[day] ??= emptyDay();
    return data.days[day];
  };
  const day = () => readDay(store.read(), usageDay(now()));
  const prune = (data) => {
    const days = Object.keys(data.days).sort();
    for (const stale of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete data.days[stale];
  };

  const costOf = (usage = {}) =>
    ((usage.inputTokens ?? 0) * config.inputPricePerMTok +
      (usage.outputTokens ?? 0) * config.outputPricePerMTok) / CURRENCY_SCALE;

  const snapshot = (owner) => {
    const current = day();
    const spentUsd = Math.max(0, current.costUsd);
    return {
      spentUsd: Math.round(spentUsd * 1_000_000) / 1_000_000,
      remainingUsd: Math.max(0, Math.round((config.dailyBudgetUsd - spentUsd) * 1_000_000) / 1_000_000),
      callsUsed: owner ? current.calls[owner] ?? 0 : Object.values(current.calls).reduce((sum, count) => sum + count, 0),
      tokens: { input: current.inputTokens, output: current.outputTokens },
      tasks: { ...current.tasks },
    };
  };

  /**
   * Charges one call before the request leaves the server, so a failing upstream
   * still cannot be retried without limit. Returns a refusal instead of throwing.
   */
  const begin = ({ owner, task }) => {
    if (!config.enabled) {
      return {
        allowed: false,
        code: config.reason,
        status: 503,
        message:
          config.reason === "budget_not_configured" || config.reason === "budget_not_acknowledged"
            ? "模型预算尚未确认，已停止付费调用"
            : "模型未配置或已停用，已停止付费调用",
      };
    }
    const data = store.read();
    const current = readDay(data, usageDay(now()));
    const used = current.calls[owner] ?? 0;
    if (used >= config.dailyCallLimit) {
      return { allowed: false, code: "daily_limit", status: 429, message: "今日模型调用次数已达上限" };
    }
    // The worst-case cost of this task must fit in the remaining daily budget.
    const estimate = costOf({ inputTokens: config.taskTokenLimit, outputTokens: config.maxOutputTokens });
    if (current.costUsd + estimate > config.dailyBudgetUsd) {
      return { allowed: false, code: "budget_exceeded", status: 429, message: "今日模型预算已用完" };
    }
    current.calls[owner] = used + 1;
    current.tasks[task] = (current.tasks[task] ?? 0) + 1;
    prune(data);
    store.write(data);
    return { allowed: true, code: "ok", status: 200, message: "" };
  };

  const record = ({ usage }) => {
    const data = store.read();
    const current = readDay(data, usageDay(now()));
    current.inputTokens += usage?.inputTokens ?? 0;
    current.outputTokens += usage?.outputTokens ?? 0;
    current.costUsd = Math.round((current.costUsd + costOf(usage)) * 1_000_000) / 1_000_000;
    prune(data);
    store.write(data);
    return costOf(usage);
  };

  const forgetOwner = (owner) => {
    const data = store.read();
    for (const day of Object.values(data.days)) delete day.calls?.[owner];
    store.write(data);
  };

  return { begin, record, snapshot, costOf, day: usageDay(now()), forgetOwner };
}

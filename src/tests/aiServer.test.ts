import { describe, expect, it } from "vitest";
// @ts-expect-error AI harness modules are shared with the Node server.
import { aiStatusPayload, readAiConfig } from "../../server/ai/config.mjs";
// @ts-expect-error AI harness modules are shared with the Node server.
import { createAiBudget, createFileUsageStore, createMemoryUsageStore, usageDay } from "../../server/ai/budget.mjs";
// @ts-expect-error AI harness modules are shared with the Node server.
import { AiProviderError, createDeepSeekProvider, describeProviderError } from "../../server/ai/provider.mjs";
// @ts-expect-error AI harness modules are shared with the Node server.
import { matchPlace, parseModelJson, shanghaiDay, validateCopilotOutput, validateIntakeOutput } from "../../server/ai/schemas.mjs";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const approved = () => readAiConfig({
  DEEPSEEK_API_KEY: "test-key-not-real",
  AI_DAILY_BUDGET_USD: "1",
  AI_BUDGET_ACKNOWLEDGED: "1",
  AI_DAILY_CALL_LIMIT: "3",
});

const places = [
  { id: "p1", name: "深圳湾万丽酒店", city: "深圳" },
  { id: "p2", name: "海上世界", city: "深圳" },
  { id: "p3", name: "海上世界", city: "上海" },
  { id: "p4", name: "深圳湾体育中心", city: "深圳" },
];

describe("AI config", () => {
  it("stays disabled without a key, budget and acknowledgement", () => {
    expect(readAiConfig({})).toMatchObject({ enabled: false, reason: "missing_key" });
    expect(readAiConfig({ DEEPSEEK_API_KEY: "x" })).toMatchObject({ enabled: false, reason: "budget_not_configured" });
    expect(readAiConfig({ DEEPSEEK_API_KEY: "x", AI_DAILY_BUDGET_USD: "2" }))
      .toMatchObject({ enabled: false, reason: "budget_not_acknowledged" });
  });
  it("enables paid calls only with approval and keeps the key out of status", () => {
    const config = approved();
    expect(config).toMatchObject({ enabled: true, model: "deepseek-flash", thinking: "disabled" });
    const status = aiStatusPayload(config, { spentUsd: 0, remainingUsd: 1, callsUsed: 0 });
    expect(JSON.stringify(status)).not.toContain("test-key-not-real");
    expect(status).toMatchObject({ provider: "deepseek", enabled: true, budget: { dailyUsd: 1 } });
    expect(readAiConfig({
      DEEPSEEK_API_KEY: "x", AI_DAILY_BUDGET_USD: "2", AI_BUDGET_ACKNOWLEDGED: "1", AI_DISABLED: "1",
    })).toMatchObject({ enabled: false, reason: "ai_disabled" });
  });
});

describe("AI budget ledger", () => {
  it("refuses every call while the budget is not approved", () => {
    const config = readAiConfig({ DEEPSEEK_API_KEY: "x" });
    const budget = createAiBudget({ config, store: createMemoryUsageStore() });
    expect(budget.begin({ owner: "u1", task: "intake" })).toMatchObject({ allowed: false, code: "budget_not_configured" });  });

  it("enforces a per-account daily call limit and records usage", () => {
    const config = approved();
    const budget = createAiBudget({ config, store: createMemoryUsageStore(), now: () => Date.parse("2026-11-25T02:00:00Z") });
    expect(budget.begin({ owner: "u1", task: "intake" }).allowed).toBe(true);
    expect(budget.begin({ owner: "u1", task: "copilot" }).allowed).toBe(true);
    expect(budget.begin({ owner: "u1", task: "copilot" }).allowed).toBe(true);
    expect(budget.begin({ owner: "u1", task: "copilot" })).toMatchObject({ allowed: false, code: "daily_limit" });
    const cost = budget.record({ usage: { inputTokens: 1000, outputTokens: 500 } });
    expect(cost).toBeGreaterThan(0);
    expect(budget.snapshot("u1")).toMatchObject({ callsUsed: 3, tokens: { input: 1000, output: 500 } });
  });

  it("stops before a call whose worst case exceeds the remaining budget", () => {
    const config = { ...approved(), dailyBudgetUsd: 0.0001 };
    const budget = createAiBudget({ config, store: createMemoryUsageStore() });
    expect(budget.begin({ owner: "u1", task: "intake" })).toMatchObject({ allowed: false, code: "budget_exceeded" });
  });

  it("persists usage outside the web root", () => {
    const dir = mkdtempSync(join(tmpdir(), "wayline-ai-"));
    const file = join(dir, "ai-usage.json");
    const config = approved();
    const budget = createAiBudget({ config, store: createFileUsageStore(file) });
    budget.begin({ owner: "u1", task: "intake" });
    budget.record({ usage: { inputTokens: 10, outputTokens: 10 } });
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.days[usageDay()]).toMatchObject({ inputTokens: 10, outputTokens: 10 });
    expect(saved.days[usageDay()].calls.u1).toBe(1);
  });
});

describe("DeepSeek adapter", () => {
  const config = { ...approved(), timeoutMs: 1000 };

  it("calls the OpenAI-compatible endpoint with thinking disabled", async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    const provider = createDeepSeekProvider({
      config,
      fetchImpl: async (url: string, init: RequestInit) => {
        captured = { url, init };
        return new Response(JSON.stringify({
          model: "deepseek-flash",
          choices: [{ message: { content: "{\"items\":[]}" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    const result = await provider.chat({
      messages: [{ role: "user", content: "hi" }],
      responseFormat: "json",
    });
    expect(captured.url).toBe("https://api.deepseek.com/chat/completions");
    const body = JSON.parse(String(captured.init?.body));
    expect(body).toMatchObject({
      model: "deepseek-flash",
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
    });
    expect(String(captured.init?.headers && JSON.stringify(captured.init.headers))).toContain("Bearer");
    expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 7 });
  });

  it("maps upstream failures without leaking credentials", async () => {
    const provider = createDeepSeekProvider({
      config,
      fetchImpl: async () => new Response("too many", { status: 429 }),
    });
    await expect(provider.chat({ messages: [] })).rejects.toMatchObject({ code: "rate_limited" });
    const described = describeProviderError(new AiProviderError("auth_failed", "bad Bearer sk-secret-value-12345"));
    expect(described.message).not.toContain("sk-secret-value-12345");
  });
});

describe("business schema validation", () => {
  const now = Date.parse("2026-11-25T04:00:00Z");
  const tomorrow = shanghaiDay(now + 86_400_000);
  const farFuture = shanghaiDay(now + 4 * 365 * 86_400_000);

  it("keeps unknown fields empty and never accepts coordinates or bookings", () => {
    const result = validateIntakeOutput({
      items: [{
        title: "客户会议",
        date: tomorrow,
        startTime: "9:05",
        endTime: "09:00",
        placeQuery: "海上世界",
        lat: 22.5,
        bookingId: "X1",
      }],
    }, { now, places });
    expect(result.items[0]).toMatchObject({
      title: "客户会议",
      date: tomorrow,
      time: "09:05",
      endTime: "",
      placeId: "",
    });
    expect(result.items[0].pending).toContain("end");
    expect(result.items[0].pending).toContain("place");
    expect(result.warnings.join("")).toContain("地理或订单字段");
    expect(result.warnings.join("")).toContain("多个候选");
  });

  it("rejects dates outside the window and invalid times", () => {
    const result = validateIntakeOutput({
      items: [{ title: "远期会议", date: farFuture, startTime: "25:00", placeQuery: "深圳湾体育中心" }],
    }, { now, places });
    expect(result.items[0].date).toBe("");
    expect(result.items[0].time).toBe("");
    expect(result.items[0].placeId).toBe("p4");
  });

  it("matches unique cities and strips markdown fences", () => {
    expect(matchPlace("深圳湾万丽酒店", "深圳", places).place?.id).toBe("p1");
    expect(parseModelJson("```json\n{\"items\":[]}\n```")).toEqual({ items: [] });
    expect(parseModelJson("not json")).toBeNull();
  });

  it("drops proposals that touch external sources or unsupported operations", () => {
    expect(validateCopilotOutput({
      message: "好",
      proposal: { operation: "update", targetId: "e1", calendar: "primary" },
    }, { now })).toMatchObject({ proposal: null });
    expect(validateCopilotOutput({
      message: "好",
      proposal: { operation: "delete", targetId: "e1" },
    }, { now }).proposal).toBeNull();
    expect(validateCopilotOutput({
      message: "好",
      proposal: { operation: "update", targetId: "e1", startTime: "10:00", endTime: "09:00" },
    }, { now })).toMatchObject({ proposal: { operation: "update", startTime: "10:00", endTime: "" } });
  });
});

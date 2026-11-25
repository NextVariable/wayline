/**
 * M4 model configuration. Secrets stay on the server: the browser only ever
 * receives the provider name, model id and budget status.
 *
 * A real paid call requires all of: an API key, a positive daily budget and the
 * explicit acknowledgement that the operator approved that budget. Without all
 * three the harness stays off and the client falls back to local rules.
 */

const positive = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const nonNegative = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};

export const AI_DEFAULTS = Object.freeze({
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash",
  thinking: "disabled",
  maxOutputTokens: 2048,
  taskTokenLimit: 12_000,
  toolRoundLimit: 3,
  timeoutMs: 25_000,
  dailyCallLimit: 40,
  rateLimitPerMinute: 6,
  // DeepSeek's published pay-as-you-go prices are a safe default; override with
  // AI_INPUT_PRICE_PER_MTOK / AI_OUTPUT_PRICE_PER_MTOK if your contract differs.
  inputPricePerMTok: 0.28,
  outputPricePerMTok: 0.42,
});

export function readAiConfig(env = process.env) {
  const apiKey = String(env.DEEPSEEK_API_KEY ?? "").trim();
  const dailyBudgetUsd = nonNegative(env.AI_DAILY_BUDGET_USD, 0);
  const budgetAcknowledged = env.AI_BUDGET_ACKNOWLEDGED === "1";
  const disabled = env.AI_DISABLED === "1";
  const thinking = ["disabled", "enabled", "auto"].includes(String(env.DEEPSEEK_THINKING ?? "").trim())
    ? String(env.DEEPSEEK_THINKING).trim()
    : AI_DEFAULTS.thinking;
  const config = {
    provider: "deepseek",
    apiKey,
    configured: !!apiKey,
    disabled,
    dailyBudgetUsd,
    budgetAcknowledged,
    baseUrl: String(env.DEEPSEEK_BASE_URL || AI_DEFAULTS.baseUrl).replace(/\/+$/, ""),
    model: String(env.DEEPSEEK_MODEL || AI_DEFAULTS.model).trim(),
    thinking,
    sendThinking: env.AI_SEND_THINKING !== "0",
    maxOutputTokens: positive(env.AI_MAX_OUTPUT_TOKENS, AI_DEFAULTS.maxOutputTokens),
    taskTokenLimit: positive(env.AI_TASK_TOKEN_LIMIT, AI_DEFAULTS.taskTokenLimit),
    toolRoundLimit: positive(env.AI_TOOL_ROUND_LIMIT, AI_DEFAULTS.toolRoundLimit),
    timeoutMs: positive(env.AI_TIMEOUT_MS, AI_DEFAULTS.timeoutMs),
    dailyCallLimit: positive(env.AI_DAILY_CALL_LIMIT, AI_DEFAULTS.dailyCallLimit),
    rateLimitPerMinute: positive(env.AI_RATE_LIMIT_PER_MINUTE, AI_DEFAULTS.rateLimitPerMinute),
    inputPricePerMTok: nonNegative(env.AI_INPUT_PRICE_PER_MTOK, AI_DEFAULTS.inputPricePerMTok),
    outputPricePerMTok: nonNegative(env.AI_OUTPUT_PRICE_PER_MTOK, AI_DEFAULTS.outputPricePerMTok),
  };
  config.enabled = !config.disabled && config.configured && config.dailyBudgetUsd > 0 && config.budgetAcknowledged;
  config.reason = config.disabled
    ? "ai_disabled"
    : !config.configured
      ? "missing_key"
      : dailyBudgetUsd <= 0
        ? "budget_not_configured"
        : !budgetAcknowledged
          ? "budget_not_acknowledged"
          : "ready";
  return config;
}

/** Status payload safe for the browser: no key, no upstream URL. */
export function aiStatusPayload(config, budget) {
  return {
    provider: config.provider,
    model: config.model,
    configured: config.configured,
    enabled: config.enabled,
    disabled: config.disabled,
    thinking: config.thinking,
    reason: config.reason,
    budget: {
      dailyUsd: config.dailyBudgetUsd,
      spentUsd: budget?.spentUsd ?? 0,
      remainingUsd: budget?.remainingUsd ?? 0,
      calls: { used: budget?.callsUsed ?? 0, limit: config.dailyCallLimit },
    },
    limits: {
      maxOutputTokens: config.maxOutputTokens,
      taskTokenLimit: config.taskTokenLimit,
      toolRoundLimit: config.toolRoundLimit,
      timeoutMs: config.timeoutMs,
      rateLimitPerMinute: config.rateLimitPerMinute,
    },
  };
}

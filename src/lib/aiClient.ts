/**
 * Browser client for the server AI harness.
 * The API key never reaches this module: the server reports only whether the
 * model is configured and how much of the approved budget is left.
 */
import type { IntakeItem } from "./smartIntake";

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
}

export interface AiStatus {
  provider: "deepseek";
  model: string;
  configured: boolean;
  enabled: boolean;
  disabled: boolean;
  thinking: string;
  reason: string;
  budget: {
    dailyUsd: number;
    spentUsd: number;
    remainingUsd: number;
    calls: { used: number; limit: number };
  };
  limits: {
    maxOutputTokens: number;
    taskTokenLimit: number;
    toolRoundLimit: number;
    timeoutMs: number;
    rateLimitPerMinute: number;
  };
}

export const OFFLINE_AI_STATUS: AiStatus = {
  provider: "deepseek",
  model: "deepseek-flash",
  configured: false,
  enabled: false,
  disabled: false,
  thinking: "disabled",
  reason: "unreachable",
  budget: { dailyUsd: 0, spentUsd: 0, remainingUsd: 0, calls: { used: 0, limit: 0 } },
  limits: { maxOutputTokens: 0, taskTokenLimit: 0, toolRoundLimit: 0, timeoutMs: 0, rateLimitPerMinute: 0 },
};

export interface AiFailure {
  ok: false;
  code: string;
  error: string;
  status: number;
}

export interface AiIntakeSuccess {
  ok: true;
  items: IntakeItem[];
  warnings: string[];
  model: string;
  usage?: AiUsage;
  costUsd?: number;
}

export type AiIntakeResult = AiIntakeSuccess | AiFailure;

export interface AiScheduleChange {
  kind: "schedule-change";
  operation: "create" | "update";
  targetId?: string;
  placeId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  endDate?: string;
  title?: string;
  reason?: string;
  baseVersion?: string;
  proposalId?: string;
}

export interface AiProposal {
  proposalId: string;
  payload: AiScheduleChange;
  baseVersion: string;
  payloadHash: string;
  summary: string;
  expiresAt: number;
}

export interface AiToolTrace {
  tool: string;
  ok: boolean;
  code: string;
}

export interface AiCopilotSuccess {
  ok: true;
  message: string;
  proposal?: AiProposal | null;
  trace?: AiToolTrace[];
  usage?: AiUsage;
  costUsd?: number;
  warnings?: string[];
}

export type AiCopilotResult = AiCopilotSuccess | AiFailure;

export class AiRequestError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = "AiRequestError";
    this.code = code;
    this.status = status;
  }
}

let statusCache: { value: AiStatus; at: number } | null = null;
const STATUS_TTL = 30_000;

async function postAi(route: string, body: unknown, timeoutMs = 35_000): Promise<{ status: number; data: unknown }> {
  const response = await fetch(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

export async function fetchAiStatus(owner = "", { force = false } = {}): Promise<AiStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < STATUS_TTL) return statusCache.value;
  try {
    const { status, data } = await postAi("/api/ai/status", { owner }, 5000);
    const value = status === 200 && data && typeof data === "object" && "model" in data
      ? (data as AiStatus)
      : OFFLINE_AI_STATUS;
    statusCache = { value, at: Date.now() };
    return value;
  } catch {
    statusCache = { value: OFFLINE_AI_STATUS, at: Date.now() };
    return OFFLINE_AI_STATUS;
  }
}

export function resetAiStatusCache() {
  statusCache = null;
}

const failure = (status: number, data: unknown, fallback: string): AiFailure => {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return {
    ok: false,
    code: typeof record.code === "string" ? record.code : "ai_error",
    error: typeof record.error === "string" ? record.error : fallback,
    status,
  };
};

export async function callAiIntake(input: {
  owner: string;
  text: string;
  now: Date;
  activeCity: string;
  places: { id: string; name: string; city?: string }[];
}): Promise<AiIntakeResult> {
  // Keep the text-mentioned and active-city places inside the server cap; the
  // raw pool starts with system places from every city and would push them out.
  const priority = (place: { name: string; city?: string }) => {
    if (input.text.includes(place.name)) return 0;
    if (place.city === input.activeCity) return 1;
    return 2;
  };
  const places = [...input.places]
    .sort((a, b) => priority(a) - priority(b))
    .slice(0, 120)
    .map(({ id, name, city }) => ({ id, name, city: city ?? "" }));
  const { status, data } = await postAi("/api/ai/intake", {
    owner: input.owner,
    text: input.text,
    activeCity: input.activeCity,
    places,
  });
  if (status === 200 && data && typeof data === "object" && (data as { ok?: boolean }).ok) {
    const record = data as { items: IntakeItem[]; warnings?: string[]; model?: string; usage?: AiUsage; costUsd?: number };
    return {
      ok: true,
      items: Array.isArray(record.items) ? record.items : [],
      warnings: Array.isArray(record.warnings) ? record.warnings : [],
      model: record.model ?? "deepseek",
      usage: record.usage,
      costUsd: record.costUsd,
    };
  }
  return failure(status, data, "模型暂时不可用，已回退本地规则");
}

export async function callAiCopilot(input: {
  owner: string;
  messages: { role: "user" | "assistant"; content: string }[];
  context: unknown;
}): Promise<AiCopilotResult> {
  const { status, data } = await postAi("/api/ai/copilot", input, 40_000);
  if (status === 200 && data && typeof data === "object" && (data as { ok?: boolean }).ok) {
    const record = data as AiCopilotSuccess;
    return { ...record, ok: true };
  }
  return failure(status, data, "模型暂时不可用，请稍后再试");
}

export async function confirmAiProposal(input: {
  owner: string;
  proposalId: string;
  baseVersion: string;
}): Promise<{ ok: true } | AiFailure> {
  const { status, data } = await postAi("/api/ai/confirm", input, 8000);
  if (status === 200 && data && typeof data === "object" && (data as { ok?: boolean }).ok) return { ok: true };
  return failure(status, data, "无法确认修改，请重新预览");
}

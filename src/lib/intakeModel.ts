import type { Place } from "../types/place";
import { localDay } from "./quickIntent";
import {
  parseIntakeText,
  type IntakeParseResult,
} from "./smartIntake";

export interface IntakeModelRequest {
  text: string;
  now: Date;
  places: Place[];
  activeCity: string;
  idPrefix?: string;
}

export interface IntakeModel {
  id: "fixture";
  /** Shown in the preview so a test response can never be mistaken for a live model. */
  label: string;
  paid: boolean;
  available(): boolean;
  parse(request: IntakeModelRequest): Promise<IntakeParseResult>;
}

export const FIXTURE_MODEL_LABEL = "固定测试响应（未接入真实模型）";
export const RULE_PROVIDER_LABEL = "本地规则解析（未调用模型）";

const fixtureText =
  "明天下午三点去海上世界见客户，后天上午十点去深圳湾开会";

/**
 * A deterministic response used for UI/E2E verification only.
 * It never reads the user text and never performs a network request.
 */
export function createFixtureIntakeModel(): IntakeModel {
  return {
    id: "fixture",
    label: FIXTURE_MODEL_LABEL,
    paid: false,
    available: () => true,
    async parse(request) {
      const result = parseIntakeText(fixtureText, {
        now: request.now,
        places: request.places,
        idPrefix: "fixture",
      });
      return { ...result, provider: "fixture" };
    },
  };
}

/**
 * M1 ships no live provider. Only an explicitly enabled fixture response is
 * allowed until a vendor, credentials and spend are approved.
 */
export function resolveIntakeModel(): IntakeModel | null {
  const flag = import.meta.env.VITE_INTAKE_MODEL;
  return flag === "fixture" ? createFixtureIntakeModel() : null;
}

export interface IntakeRun {
  result: IntakeParseResult;
  usedFallback: boolean;
}

/**
 * Runs the selected model and falls back to deterministic local parsing when
 * no model is configured or the model fails. The intake flow never depends on
 * a model being available.
 */
export async function parseIntakeWithFallback(
  text: string,
  request: Omit<IntakeModelRequest, "text">,
  model: IntakeModel | null,
): Promise<IntakeRun> {
  if (model?.available()) {
    try {
      return { result: await model.parse({ ...request, text }), usedFallback: false };
    } catch {
      // fall through to the local rule parser
    }
  }
  return {
    result: parseIntakeText(text, {
      now: request.now,
      places: request.places,
      idPrefix: request.idPrefix,
    }),
    usedFallback: !!model,
  };
}

export function configuredDailyLimit() {
  const value = Number(import.meta.env.VITE_INTAKE_DAILY_LIMIT ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

const budgetKey = (owner: string, day: string) =>
  `wayline.intake.budget.${owner}.${day}`;

export interface IntakeBudget {
  limit: number;
  used: number;
  remaining: number;
}

export function readIntakeBudget(
  owner: string,
  now = new Date(),
  limit = configuredDailyLimit(),
): IntakeBudget {
  let used = 0;
  if (owner && typeof localStorage !== "undefined") {
    try {
      used = Number(
        localStorage.getItem(budgetKey(owner, localDay(now))) ?? 0,
      );
    } catch {
      used = 0;
    }
  }
  if (!Number.isFinite(used) || used < 0) used = 0;
  return { limit, used, remaining: Math.max(0, limit - used) };
}

export function canCallPaidModel(owner: string, now = new Date()) {
  const budget = readIntakeBudget(owner, now);
  return budget.limit > 0 && budget.remaining > 0;
}

export function recordIntakeModelCall(owner: string, now = new Date()) {
  if (!owner || typeof localStorage === "undefined") return;
  const budget = readIntakeBudget(owner, now);
  try {
    localStorage.setItem(
      budgetKey(owner, localDay(now)),
      String(budget.used + 1),
    );
  } catch {
    // a full or blocked storage must not break the intake flow
  }
}

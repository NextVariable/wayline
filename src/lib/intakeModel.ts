import type { Place } from "../types/place";
import {
  parseIntakeText,
  type IntakeParseResult,
} from "./smartIntake";
import { callAiIntake, fetchAiStatus } from "./aiClient";

export interface IntakeModelRequest {
  text: string;
  now: Date;
  places: Place[];
  activeCity: string;
  idPrefix?: string;
  owner?: string;
}

export interface IntakeModel {
  id: "fixture" | "deepseek";
  /** Shown in the preview so a test response can never be mistaken for a live model. */
  label: string;
  paid: boolean;
  available(): boolean | Promise<boolean>;
  parse(request: IntakeModelRequest): Promise<IntakeParseResult>;
}

export const FIXTURE_MODEL_LABEL = "固定测试响应（未接入真实模型）";
export const RULE_PROVIDER_LABEL = "本地规则解析（未调用模型）";
export const DEEPSEEK_MODEL_LABEL = "DeepSeek 真实模型";

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
 * The DeepSeek model runs entirely on the Node server. The browser only learns
 * whether it is configured (and how much approved budget is left), then posts
 * the text to /api/ai/intake. If anything fails the caller falls back to rules.
 */
export function createServerIntakeModel(owner: string): IntakeModel {
  return {
    id: "deepseek",
    label: DEEPSEEK_MODEL_LABEL,
    paid: true,
    async available() {
      const status = await fetchAiStatus(owner);
      return status.enabled;
    },
    async parse(request) {
      const response = await callAiIntake({
        owner: request.owner || owner || "guest",
        text: request.text,
        now: request.now,
        activeCity: request.activeCity,
        places: request.places.map(({ id, name, city }) => ({ id, name, city })),
      });
      if (!response.ok) throw new Error(response.error || "模型暂时不可用");
      return {
        items: response.items,
        warnings: response.warnings,
        provider: "model",
        model: response.model,
        usage: response.usage,
        costUsd: response.costUsd,
      };
    },
  };
}

/**
 * `VITE_INTAKE_MODEL=fixture` keeps the deterministic test response,
 * `off` forces local rules, anything else uses DeepSeek when the server has an
 * approved budget. The browser cannot enable paid calls on its own.
 */
export function resolveIntakeModel(owner = ""): IntakeModel | null {
  const flag = import.meta.env.VITE_INTAKE_MODEL;
  if (flag === "fixture") return createFixtureIntakeModel();
  if (flag === "off" || flag === "rule") return null;
  return createServerIntakeModel(owner);
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
  if (model && (await model.available())) {
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

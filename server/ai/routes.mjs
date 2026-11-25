/**
 * HTTP surface for the AI harness. Kept separate from server/index.mjs so the
 * same handlers can be exercised in tests with a mock provider.
 */
import { aiStatusPayload } from "./config.mjs";
import { ContextError, sanitizeCopilotContext } from "./context.mjs";
import { runCopilot, runIntake } from "./harness.mjs";

const INVALID_MODEL_CODES = new Set(["invalid_output", "empty_result", "empty_input", "invalid_arguments"]);

function intakeStatus(result) {
  if (result.ok) return 200;
  if (result.code === "daily_limit" || result.code === "budget_exceeded" || result.code === "rate_limited") return 429;
  if (INVALID_MODEL_CODES.has(result.code)) return 422;
  return result.status ?? 503;
}

export function createAiRoutes({ config, budget, provider, proposals, services, accountFor, now = Date.now }) {
  return async function handleAiRoute({ route, body, request }) {
    if (!route.startsWith("/api/ai/")) return null;
    const payload = body && typeof body === "object" ? body : {};
    const account = accountFor ? await accountFor(request) : null;
    const owner = typeof payload.owner === "string" ? payload.owner.trim().slice(0, 120) : "";

    if (route === "/api/ai/status") {
      return { status: 200, payload: aiStatusPayload(config, budget.snapshot(owner || undefined)) };
    }
    if (!owner) return { status: 400, payload: { ok: false, code: "owner_required", error: "缺少账号标识" } };
    if (account?.id && account.id !== owner)
      return { status: 403, payload: { ok: false, code: "owner_mismatch", error: "上下文不属于当前账号" } };

    if (route === "/api/ai/intake") {
      // The client sends the full local pool (system + saved places); truncating
      // too early dropped the user's own places and silently lost place matches.
      const places = (Array.isArray(payload.places) ? payload.places : []).slice(0, 120).flatMap((place) => {
        if (!place || typeof place !== "object") return [];
        const id = String(place.id ?? "").slice(0, 120);
        const name = String(place.name ?? "").slice(0, 80);
        const city = String(place.city ?? "").slice(0, 40);
        return id && name ? [{ id, name, city }] : [];
      });
      const result = await runIntake({
        provider,
        budget,
        config,
        input: { owner, text: payload.text, activeCity: payload.activeCity },
        places,
        now: now(),
      });
      return { status: intakeStatus(result), payload: result };
    }

    if (route === "/api/ai/copilot") {
      let context;
      try {
        context = sanitizeCopilotContext(payload.context, { owner, now: now() });
      } catch (error) {
        if (error instanceof ContextError)
          return { status: error.status ?? 400, payload: { ok: false, code: error.code, error: error.message } };
        return { status: 400, payload: { ok: false, code: "invalid_context", error: "上下文格式无效" } };
      }
      const result = await runCopilot({
        provider,
        budget,
        config,
        proposals,
        input: { owner, messages: payload.messages },
        context,
        services,
        now: now(),
      });
      const status = result.ok ? 200
        : result.code === "daily_limit" || result.code === "budget_exceeded" || result.code === "rate_limited" ? 429
          : INVALID_MODEL_CODES.has(result.code) ? 422
            : result.status ?? 503;
      return { status, payload: result };
    }

    if (route === "/api/ai/confirm") {
      const result = proposals.confirm({
        owner,
        proposalId: payload.proposalId,
        baseVersion: payload.baseVersion,
        payloadHash: payload.payloadHash,
      });
      return { status: result.status ?? (result.ok ? 200 : 409), payload: result };
    }

    return { status: 404, payload: { ok: false, code: "not_found", error: "未知的 AI 接口" } };
  };
}

/**
 * Minimal OpenAI-compatible Chat Completions adapter for DeepSeek.
 * It owns transport details only: prompts, validation and permissions live in
 * the harness. The API key is read from server config and never leaves here.
 */

export class AiProviderError extends Error {
  constructor(code, message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const redact = (text) =>
  String(text ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9]{8,}/g, "sk-[redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 240);

function mapStatus(status) {
  if (status === 401 || status === 403) return new AiProviderError("auth_failed", "模型凭证未通过验证", { status });
  if (status === 402) return new AiProviderError("payment_required", "模型账户余额不足", { status });
  if (status === 429) return new AiProviderError("rate_limited", "模型服务繁忙，请稍后重试", { status, retryable: true });
  if (status >= 500) return new AiProviderError("provider_unavailable", "模型服务暂时不可用", { status, retryable: true });
  return new AiProviderError("request_rejected", "模型未接受本次请求", { status });
}

export function createDeepSeekProvider({ config, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available");
  return {
    name: "deepseek",
    model: config.model,
    async chat({ messages, tools, responseFormat, maxOutputTokens }) {
      const payload = {
        model: config.model,
        messages,
        max_tokens: Math.min(maxOutputTokens ?? config.maxOutputTokens, config.maxOutputTokens),
        temperature: 0.1,
        stream: false,
      };
      if (responseFormat === "json") payload.response_format = { type: "json_object" };
      if (tools?.length) {
        payload.tools = tools;
        payload.tool_choice = "auto";
      }
      // DeepSeek's thinking switch is optional; omit it for gateways that reject
      // unknown fields, or when the operator disables it explicitly.
      if (config.sendThinking && config.thinking === "disabled") payload.thinking = { type: "disabled" };
      if (config.sendThinking && config.thinking === "enabled") payload.thinking = { type: "enabled" };

      let response;
      try {
        response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (error) {
        if (error?.name === "TimeoutError" || error?.name === "AbortError")
          throw new AiProviderError("timeout", "模型响应超时", { retryable: true });
        throw new AiProviderError("network_error", "无法连接模型服务", { retryable: true });
      }
      if (!response.ok) throw mapStatus(response.status);

      let data;
      try {
        data = await response.json();
      } catch {
        throw new AiProviderError("invalid_response", "模型返回了无法读取的内容", { status: response.status });
      }
      const choice = data?.choices?.[0];
      const message = choice?.message;
      if (!message) throw new AiProviderError("invalid_response", "模型未返回消息");
      const content = typeof message.content === "string" ? message.content : "";
      const toolCalls = Array.isArray(message.tool_calls)
        ? message.tool_calls
            .filter((call) => typeof call?.function?.name === "string" && call.function.name.length <= 64)
            .slice(0, 8)
            .map((call, index) => ({
              id: typeof call.id === "string" ? call.id.slice(0, 120) : `call_${index}`,
              name: call.function.name,
              arguments: typeof call.function.arguments === "string" ? call.function.arguments.slice(0, 4000) : "{}",
            }))
        : [];
      const usage = data?.usage ?? {};
      return {
        content,
        toolCalls,
        finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "",
        usage: {
          inputTokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : 0,
          outputTokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : 0,
          totalTokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : 0,
        },
        model: typeof data?.model === "string" ? data.model : config.model,
      };
    },
  };
}

export function describeProviderError(error) {
  if (error instanceof AiProviderError) return { code: error.code, message: redact(error.message), retryable: error.retryable };
  return { code: "provider_error", message: "模型调用未完成", retryable: false };
}

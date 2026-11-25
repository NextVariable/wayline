import { ChevronDown, MessageCircle, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { callAiCopilot, confirmAiProposal, type AiProposal, type AiStatus, type AiToolTrace } from "../lib/aiClient";
import type { CopilotContext } from "../lib/aiContext";

interface ChatEntry {
  id: number;
  role: "user" | "assistant";
  content: string;
  proposal?: AiProposal | null;
  trace?: AiToolTrace[];
  tone?: "error" | "notice";
}

const SUGGESTIONS = ["今天还有哪些安排？", "当前出行的通勤风险？", "酒店到会议地点要多久？"];

const statusLine = (status: AiStatus, demo: boolean) => {
  if (demo) return "演示工作区 · 合成说明，不调用模型";
  if (status.enabled) {
    return `DeepSeek · ${status.model} · 今日剩余 $${status.budget.remainingUsd.toFixed(2)}`;
  }
  if (status.reason === "missing_key") return "DeepSeek 未配置，Copilot 暂不可用";
  if (status.reason === "budget_not_configured" || status.reason === "budget_not_acknowledged")
    return "模型预算未确认，已停用付费调用";
  if (status.reason === "ai_disabled") return "模型已由管理员停用";
  return "模型服务暂不可用，请稍后再试";
};

export function CopilotPanel({
  open,
  onOpenChange,
  status,
  context,
  owner,
  demo,
  seed,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: AiStatus;
  context: CopilotContext;
  owner: string;
  demo: boolean;
  seed: { id: number; text: string } | null;
  onApply: (proposal: AiProposal) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<Record<string, "done" | "error">>({});
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !seed) return;
    setDraft(seed.text);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, seed]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
  }, [entries, open]);

  const push = (entry: Omit<ChatEntry, "id">) => {
    const id = nextId.current++;
    setEntries((items) => [...items, { ...entry, id }]);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (demo) {
      push({ role: "user", content: text });
      push({ role: "assistant", content: "演示工作区只使用合成说明，不会发送真实数据或调用付费模型。", tone: "notice" });
      setDraft("");
      return;
    }
    if (!status.enabled) {
      push({ role: "assistant", content: statusLine(status, demo), tone: "notice" });
      return;
    }
    const history = [...entries.filter((entry) => entry.role === "user" || (entry.role === "assistant" && !entry.tone)).map((entry) => ({ role: entry.role, content: entry.content })), { role: "user" as const, content: text }];
    push({ role: "user", content: text });
    setDraft("");
    setBusy(true);
    const response = await callAiCopilot({ owner, messages: history, context });
    setBusy(false);
    if (!response.ok) {
      push({ role: "assistant", content: response.error, tone: "error" });
      return;
    }
    push({
      role: "assistant",
      content: response.message,
      proposal: response.proposal ?? null,
      trace: response.trace,
    });
  };

  const confirm = async (proposal: AiProposal) => {
    if (confirmed[proposal.proposalId] === "done") return;
    const server = await confirmAiProposal({
      owner,
      proposalId: proposal.proposalId,
      baseVersion: proposal.baseVersion,
    });
    if (!server.ok) {
      setConfirmed((state) => ({ ...state, [proposal.proposalId]: "error" }));
      push({ role: "assistant", content: server.error, tone: "error" });
      return;
    }
    const applied = await onApply(proposal);
    if (!applied.ok) {
      setConfirmed((state) => ({ ...state, [proposal.proposalId]: "error" }));
      push({ role: "assistant", content: applied.error, tone: "error" });
      return;
    }
    setConfirmed((state) => ({ ...state, [proposal.proposalId]: "done" }));
    push({ role: "assistant", content: "已按预览保存到本机日程，未修改任何外部日历或订单。", tone: "notice" });
  };

  if (!open) {
    return (
      <button
        type="button"
        className="copilot-launcher"
        aria-expanded={false}
        onClick={() => onOpenChange(true)}
      >
        <MessageCircle size={16} aria-hidden="true" />
        问 Wayline
      </button>
    );
  }

  return (
    <aside className="copilot-panel" aria-label="Wayline Copilot">
      <header className="copilot-head">
        <div>
          <strong>问 Wayline</strong>
          <p className="field-help">{statusLine(status, demo)}</p>
        </div>
        <button type="button" className="icon-button" aria-label="收起 Copilot" onClick={() => onOpenChange(false)}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="copilot-thread" ref={listRef} aria-live="polite">
        {entries.length === 0 && (
          <div className="copilot-empty">
            <p>只读取当前出行所需的最小上下文。回答中的时间与通勤结论来自 Smart Routes。</p>
            <div className="copilot-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" className="text-action" onClick={() => { setDraft(suggestion); inputRef.current?.focus(); }}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {entries.map((entry) => {
          const proposal = entry.proposal;
          const state = proposal ? confirmed[proposal.proposalId] : undefined;
          return (
          <div key={entry.id} className={`copilot-entry copilot-${entry.role}`} data-tone={entry.tone}>
            <p>{entry.content}</p>
            {entry.trace && entry.trace.length > 0 && (
              <details className="copilot-trace">
                <summary><ChevronDown size={13} aria-hidden="true" />依据 · {entry.trace.length} 个工具</summary>
                <ul>
                  {entry.trace.map((item, index) => (
                    <li key={`${item.tool}-${index}`}>{item.tool} · {item.ok ? "已读取" : item.code}</li>
                  ))}
                </ul>
              </details>
            )}
            {proposal && (
              <div className="copilot-proposal" data-state={state ?? "pending"}>
                <p className="copilot-proposal-title">待确认的本地修改</p>
                <p>{proposal.summary || proposal.payload.reason || "日程调整"}</p>
                <dl>
                  {proposal.payload.title && <><dt>标题</dt><dd>{proposal.payload.title}</dd></>}
                  {proposal.payload.date && <><dt>日期</dt><dd>{proposal.payload.date}</dd></>}
                  {proposal.payload.startTime && <><dt>开始</dt><dd>{proposal.payload.startTime}</dd></>}
                  {proposal.payload.endTime && <><dt>结束</dt><dd>{proposal.payload.endTime}</dd></>}
                </dl>
                <div className="copilot-proposal-actions">
                  <button
                    type="button"
                    className="primary-action"
                    disabled={state !== undefined}
                    onClick={() => void confirm(proposal)}
                  >
                    {state === "done" ? "已保存" : "确认修改"}
                  </button>
                  <button type="button" className="text-action" onClick={() => setConfirmed((all) => ({ ...all, [proposal.proposalId]: "error" }))} disabled={state !== undefined}>稍后处理</button>
                </div>
                {state === "error" && <p className="field-help">预览已失效或未执行，请重新生成。</p>}
              </div>
            )}
          </div>
          );
        })}
        {busy && <p className="field-help" role="status">正在读取当前出行…</p>}
      </div>
      <form
        className="copilot-compose"
        onSubmit={(event) => { event.preventDefault(); void send(); }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={demo ? "演示工作区不发送请求" : "询问今天、通勤或本地安排"}
          aria-label="向 Copilot 提问"
          disabled={demo}
        />
        <button type="submit" className="icon-button" aria-label="发送" disabled={busy || !draft.trim() || demo}>
          <Send size={16} aria-hidden="true" />
        </button>
      </form>
      <p className="copilot-foot field-help">不会修改 Google Calendar、Gmail 或外部订单。</p>
    </aside>
  );
}

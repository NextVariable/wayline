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

const toolLabels: Record<string, string> = {
  read_events: "日程", read_trip: "出差安排", query_route: "高德路线", assess_commute: "通勤时间",
  read_bookings: "已订订单", check_conflicts: "日程冲突", propose_schedule_change: "修改预览",
  get_schedule: "当天日程", get_trip_context: "行程安排", get_booking_context: "已订订单",
  get_insights: "待核对事项", find_place: "地点查询",
};

const SUGGESTIONS = ["今天还有哪些安排？", "当前出行的通勤风险？", "酒店到会议地点要多久？"];

const statusLine = (status: AiStatus, demo: boolean) => {
  if (demo) return "演示回答 · 使用示例安排";
  if (status.enabled) return "";
  if (!status.enabled && status.budget.remainingUsd <= 0 && status.reason === "")
    return "今天的询问次数已用完，请稍后再试。";
  return "行程助手暂时不可用，可以继续查看日程与路线。";
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
  seed: { id: number; text: string; example?: string } | null;
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
    if (!open) return;
    if (seed) setDraft(seed.text);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, seed]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
  }, [entries, open]);

  const push = (entry: Omit<ChatEntry, "id">) => {
    const id = nextId.current++;
    setEntries((items) => [...items, { ...entry, id }]);
  };

  const send = async (question = draft) => {
    const text = question.trim();
    if (!text || busy) return;
    if (demo) {
      push({ role: "user", content: text });
      const matchesSeed = seed?.text === text && seed.example;
      const answer = matchesSeed || (text === SUGGESTIONS[0]
        ? context.events.slice(0, 3).map(event => event.title).join("、") || "今天还没有安排。"
        : text === SUGGESTIONS[1] ? context.actions[0]?.problem || "示例安排目前没有需要核对的通勤提醒。"
        : text === SUGGESTIONS[2] ? "示例行程还没有确定酒店。确认住宿后再查看路线。"
        : "可试问今天的安排、通勤风险，或从日程中打开一条提醒。");
      push({ role: "assistant", content: answer });
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
    try {
      const response = await callAiCopilot({ owner, messages: history, context });
      if (!response.ok) {
        push({ role: "assistant", content: response.status === 429 ? "询问次数较多，请稍后再试。" : "暂时无法回答，请稍后重试。", tone: "error" });
        return;
      }
      push({ role: "assistant", content: response.message, proposal: response.proposal ?? null, trace: response.trace });
    } catch {
      push({ role: "assistant", content: "暂时无法连接，请检查网络后重试。", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (proposal: AiProposal) => {
    if (confirmed[proposal.proposalId] === "done") return;
    const server = await confirmAiProposal({
      owner,
      proposalId: proposal.proposalId,
      baseVersion: proposal.baseVersion,
    }).catch(() => ({ok: false as const}));
    if (!server.ok) {
      setConfirmed((state) => ({ ...state, [proposal.proposalId]: "error" }));
      push({ role: "assistant", content: "暂时无法确认修改，请返回日程核对后重试。", tone: "error" });
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

  const close = () => onOpenChange(false);
  const compact = typeof window !== "undefined" && window.matchMedia("(max-width:700px)").matches;

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
    <aside className="copilot-panel" aria-label="行程助手" role={compact ? "dialog" : undefined} aria-modal={compact || undefined}
      onKeyDown={event => {
        if (event.key === "Escape") close();
        if (!compact || event.key !== "Tab") return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), summary");
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <header className="copilot-head">
        <div>
          <strong>问 Wayline</strong>
          {statusLine(status, demo) && <p className="field-help">{statusLine(status, demo)}</p>}
        </div>
        <button type="button" className="icon-button" aria-label="关闭助手" onClick={close}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="copilot-thread" ref={listRef} aria-live="polite">
        {entries.length === 0 && (
          <div className="copilot-empty">
            <p>可以问今天去哪、怎么走，或哪段行程需要核对。</p>
            <div className="copilot-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" className="text-action" onClick={() => { if (demo) void send(suggestion); else { setDraft(suggestion); inputRef.current?.focus(); } }}>
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
                <summary><ChevronDown size={13} aria-hidden="true" />查看依据</summary>
                <ul>
                  {entry.trace.map((item, index) => (
                    <li key={`${item.tool}-${index}`}>{toolLabels[item.tool] || "行程资料"} · {item.ok ? "已读取" : "暂不可用"}</li>
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
          placeholder="询问今天、通勤或安排"
          aria-label="提问"
        />
        <button type="submit" className="icon-button" aria-label="发送" disabled={busy || !draft.trim()}>
          <Send size={16} aria-hidden="true" />
        </button>
      </form>
      <p className="copilot-foot field-help">Google 日历和 Gmail 只读。</p>
    </aside>
  );
}

import type { TripAction } from "../lib/actionItems";

const SOURCE_LABEL: Record<string, string> = {
  "google-calendar": "Google 日历",
  "calendar-file": "导入日历",
  gmail: "Gmail",
  amap: "高德",
  wayline: "Wayline",
};

const clock = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

const LIFECYCLE_LABEL: Partial<Record<TripAction["lifecycle"], string>> = {
  overdue: "已逾期",
  imminent: "即将发生",
  expired: "已过期",
};

function evidenceLabel(action: TripAction): string {
  const sources = [...new Set(action.evidence.map(item => SOURCE_LABEL[item.source] ?? item.source))];
  const stale = action.evidence.some(item => item.stale);
  return [sources.join(" · ") || "暂无来源", stale ? "来源待更新" : ""].filter(Boolean).join(" · ");
}

interface Props {
  actions: TripAction[];
  onAction: (action: TripAction) => void;
  title?: string;
  limit?: number;
  compact?: boolean;
}

export function TripActions({ actions, onAction, title, limit, compact }: Props) {
  const shown = typeof limit === "number" ? actions.slice(0, limit) : actions;
  if (!shown.length) return null;
  const high = actions.some(action => action.severity === "high");
  const summary = title ?? (high ? "有时间冲突" : "行程待确认");
  if (compact) {
    return (
      <section className="today-actions" aria-label={summary}>
        <div className="today-actions-heading">
          <strong>{summary}</strong>
          <small>{actions.length} 项待处理</small>
        </div>
        <ul>
          {shown.map(action => <li key={action.id} data-severity={action.severity} data-lifecycle={action.lifecycle}>
            <button type="button" className="today-action-row" onClick={() => onAction(action)}>
              <span>
                <strong>{LIFECYCLE_LABEL[action.lifecycle] && <small className="trip-action-lifecycle" role="note">{LIFECYCLE_LABEL[action.lifecycle]} · </small>}{action.title}</strong>
                <small>{action.problem}</small>
              </span>
              <span className="today-action-next">{action.nextStep.label}</span>
            </button>
          </li>)}
        </ul>
        {actions.length > shown.length && <small className="field-help">还有 {actions.length - shown.length} 项，可在行程中查看</small>}
      </section>
    );
  }
  return (
    <details className="trip-risk-list trip-actions" open={high || undefined}>
      <summary>{summary} · {actions.length} 项</summary>
      <ul>
        {shown.map(action => <li key={action.id} data-severity={action.severity} data-status={action.status} data-lifecycle={action.lifecycle}>
          <strong>{action.title}</strong>
          {LIFECYCLE_LABEL[action.lifecycle] && <small className="trip-action-lifecycle" role="note">{LIFECYCLE_LABEL[action.lifecycle]}</small>}
          <span>{action.problem}</span>
          {action.events.length > 0 && <small className="trip-action-events">
            {action.events.map(event => `${event.title} · ${clock.format(new Date(event.start))}`).join("；")}
          </small>}
          <small>{evidenceLabel(action)}</small>
          {action.uncertain && <small className="trip-action-uncertain" role="note">待确认：{action.uncertainty}</small>}
          <button type="button" className="text-action" onClick={() => onAction(action)}>{action.nextStep.label}</button>
        </li>)}
      </ul>
    </details>
  );
}

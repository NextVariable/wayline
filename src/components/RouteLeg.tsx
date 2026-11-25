import { readDemoMode } from "../lib/demoScope";
import { useEffect, useState, type ReactNode } from "react";
import { Navigation } from "lucide-react";
import type { TravelRisk } from "../lib/tripDomain";
import { modeName, routeProviderMode, type TravelMode } from "../lib/todayMap";
import { legClock, type LegAssessment } from "../lib/smartRoutes";

export interface RouteLegOption { mode: TravelMode; minutes?: number | null }

export interface RouteLegProps {
  mode: TravelMode;
  minutes?: number | null;
  plan?: LegAssessment;
  sameSpot?: boolean;
  loading?: boolean;
  failed?: boolean;
  focused?: boolean;
  risk?: TravelRisk;
  options?: RouteLegOption[];
  bufferOverride?: number;
  reminder?: string;
  source?: string;
  observedAt?: number;
  onChooseMode?: (mode: TravelMode) => void;
  onRetry?: () => void;
  onToggle?: (open: boolean) => void;
  onBufferChange?: (minutes: number | undefined) => void;
  navigation?: { href: string; label: string; target?: string } | null;
  onNavigate?: () => void;
  /** 例如合成路线、订单来源等这一段特有的补充说明。 */
  note?: ReactNode;
}

type Status = LegAssessment["status"];

const clock = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

function riskLabel(status: Status, plan: LegAssessment): { text: string; tone?: "danger" | "warn" | "reference" } {
  switch (status) {
    case "insufficient": return { text: `时间不足 ${plan.shortBy} 分钟`, tone: "danger" };
    case "overlap": return { text: `日程重叠 ${plan.shortBy} 分钟`, tone: "danger" };
    case "tight": return { text: "时间紧张", tone: "warn" };
    case "stale": return { text: "路线已过期", tone: "warn" };
    case "pending": return { text: "待确认", tone: "warn" };
    case "reference": return { text: "参考", tone: "reference" };
    default: return { text: "" };
  }
}

/**
 * Today 与 Trips 共用的路段展示：默认只给交通方式、耗时与必要风险，
 * 缓冲、余量、来源与时效都在展开后出现。
 */
export function RouteLeg({
  mode, minutes, plan, sameSpot, loading, failed, focused, risk, options,
  bufferOverride, reminder, source, observedAt, onChooseMode, onRetry, onToggle, onBufferChange, navigation, onNavigate, note,
}: RouteLegProps) {
  const [open, setOpen] = useState(Boolean(focused));
  useEffect(() => { if (focused) setOpen(true); }, [focused]);
  const status = plan?.status;
  const label = plan ? riskLabel(status!, plan) : { text: failed ? "待确认" : "", tone: undefined as undefined | "warn" };
  const primary = sameSpot ? "同一地点"
    : loading ? "正在查路线…"
    : failed ? "路线暂不可用"
    : minutes != null ? `${modeName(mode)} ${minutes} 分钟`
    : "未查询";
  const toggle = () => {
    const next = !open;
    setOpen(next);
    onToggle?.(next);
  };
  const driving = routeProviderMode(mode) === "driving";
  const synthetic = Boolean(source?.includes("演示"));
  return (
    <div className={`route-leg${status === "insufficient" || status === "overlap" ? " is-late" : ""}`} data-status={sameSpot ? "same-spot" : status ?? (loading ? "loading" : failed ? "pending" : "idle")} aria-busy={loading}>
      <div className="leg-head">
        <button type="button" className="leg-summary" aria-expanded={open} onClick={toggle}>
          <span className="leg-primary">{primary}</span>
          {synthetic && <span className="leg-synthetic">示例</span>}
          {label.text && <span className="leg-state" data-tone={label.tone}>{label.text}</span>}
        </button>
        {failed && <button type="button" className="leg-retry" onClick={onRetry}>重试路线</button>}
      </div>
      {reminder && <p className="leg-reminder" role="status">{reminder}</p>}
      {open && (
        <div className="leg-detail">
          {plan && (
            <dl className="leg-metrics">
              <div><dt>可用时间</dt><dd>{plan.availableMinutes === null ? "待确认" : `${plan.availableMinutes} 分钟`}</dd></div>
              <div><dt>路线耗时</dt><dd>{plan.routeMinutes === null ? "未查询" : `${plan.routeMinutes} 分钟`}</dd></div>
              <div><dt>额外缓冲</dt><dd>{plan.bufferMinutes} 分钟{plan.bufferOverridden ? "（本段）" : ""}</dd></div>
              <div><dt>剩余时间</dt><dd data-negative={plan.remainingMinutes !== null && plan.remainingMinutes < 0}>{plan.remainingMinutes === null ? "待确认" : `${plan.remainingMinutes} 分钟`}</dd></div>
              <div><dt>最迟出发</dt><dd>{plan.latestDeparture ? legClock(plan.latestDeparture) : "待确认"}</dd></div>
            </dl>
          )}
          {plan && (
            <div className="leg-buffer">
              <strong>缓冲组成</strong>
              <ul>{plan.bufferParts.map(part => <li key={part.label}>{part.label} {part.minutes} 分钟{part.pending ? " · 建议预留，待确认" : ""}</li>)}</ul>
              <small>路线服务已包含的步行、候车不会重复扣除。</small>
            </div>
          )}
          {onBufferChange && (
            <div className="leg-buffer-change" role="group" aria-label="调整这段的额外缓冲">
              {[0, 5, 10, 15, 20].map(minutesValue => <button type="button" key={minutesValue} aria-pressed={(bufferOverride ?? -1) === minutesValue}
                onClick={() => onBufferChange(minutesValue)}>{minutesValue} 分</button>)}
              {bufferOverride !== undefined && <button type="button" onClick={() => onBufferChange(undefined)}>恢复默认</button>}
            </div>
          )}
          {onChooseMode && (
            <div className="leg-modes" role="group" aria-label="切换交通方式">
              {options?.map(option => <button type="button" key={option.mode} aria-pressed={mode === option.mode}
                onClick={() => onChooseMode(option.mode)}>
                {modeName(option.mode)}{option.minutes != null ? ` ${option.minutes} 分` : loading ? "" : " 未查询"}
              </button>)}
            </div>
          )}
          {risk && <p className="leg-risk"><strong>{risk.title}</strong> · {risk.basis}</p>}
          {plan?.advice && <p className="leg-advice" data-bad={plan.status === "insufficient"}>{plan.advice}</p>}
          {note}
          {(source || observedAt) && <p className="leg-note">
            {source}{observedAt ? ` · ${clock.format(new Date(observedAt))} 查询` : ""}
          </p>}
          {plan && (driving || plan.routeState === "reference") && <p className="leg-note">
            {plan.routeState === "reference" ? "未来或估算路线，仅作参考" : ""}
            {plan.routeState === "reference" && driving ? " · " : ""}
            {driving ? "驾车数据不含等车/停车时间" : ""}
          </p>}
          <div className="leg-actions">
            <button type="button" className="text-action" onClick={onRetry}>刷新路线</button>
            {navigation && !readDemoMode() && <a className="leg-nav" href={navigation.href} target={navigation.target} rel="noopener noreferrer"
              onClick={onNavigate}><Navigation size={13} aria-hidden="true" />{navigation.label}</a>}
          </div>
        </div>
      )}
    </div>
  );
}

export { clock as routeClock };

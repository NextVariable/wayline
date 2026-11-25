import { useEffect, useState, type ReactNode } from "react";
import { Navigation } from "lucide-react";
import type { TravelRisk } from "../lib/tripDomain";
import { modeName, type TravelMode } from "../lib/todayMap";
import { legClock, ROAD_ACCESS_DEFAULTS, roadAccessLabel, roadAccessMode, type RoadAccessMode, type LegAssessment } from "../lib/smartRoutes";

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
  accessOverride?: number;
  onAccessChange?: (mode:RoadAccessMode, minutes:number | undefined) => void;
  reminder?: string;
  source?: string;
  observedAt?: number;
  plannedAt?: string;
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

const clock = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" });

function riskLabel(status: Status, plan: LegAssessment): { text: string; tone?: "danger" | "warn" | "reference" } {
  switch (status) {
    case "insufficient": return { text: `时间不足 ${plan.shortBy} 分钟`, tone: "danger" };
    case "overlap": return { text: `日程重叠 ${plan.shortBy} 分钟`, tone: "danger" };
    case "tight": return { text: "时间紧张", tone: "warn" };
    case "stale": return { text: "路线已过期", tone: "warn" };
    case "pending": return { text: "待确认", tone: "warn" };
    case "reference": return { text: plan.shortBy > 0 ? `参考 · 可能差 ${plan.shortBy} 分` : "参考", tone: "reference" };
    default: return { text: "" };
  }
}

/**
 * Today 与 Trips 共用的路段展示：默认只给交通方式、耗时与必要风险，
 * 缓冲、余量、来源与时效都在展开后出现。
 */
export function RouteLeg({
  mode, minutes, plan, sameSpot, loading, failed, focused, risk, options,
  bufferOverride, accessOverride, onAccessChange, reminder, source, observedAt, plannedAt, onChooseMode, onRetry, onToggle, onBufferChange, navigation, onNavigate, note,
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
  const roadMode = roadAccessMode(mode) && !sameSpot ? mode : null;
  const synthetic = Boolean(source?.includes("合成"));
  return (
    <div className={`route-leg${status === "insufficient" || status === "overlap" ? " is-late" : ""}`} data-status={sameSpot ? "same-spot" : status ?? (loading ? "loading" : failed ? "pending" : "idle")} aria-busy={loading}>
      <div className="leg-head">
        <button type="button" className="leg-summary" aria-expanded={open} onClick={toggle}>
          <span className="leg-primary">{primary}</span>
          {synthetic && <span className="leg-synthetic">合成</span>}
          {label.text && <span className="leg-state" data-tone={label.tone}>{label.text}</span>}
        </button>
        {failed && <button type="button" className="leg-retry" onClick={onRetry}>重试路线</button>}
      </div>
      {reminder && <p className="leg-reminder" role="status">{reminder}</p>}
      {open && (
        <div className="leg-detail">
          {onChooseMode && (
            <div className="leg-modes" role="group" aria-label="切换交通方式">
              {options?.map(option => <button type="button" key={option.mode} aria-pressed={mode === option.mode}
                onClick={() => onChooseMode(option.mode)}>
                {modeName(option.mode)}{option.minutes != null ? ` ${option.minutes} 分` : loading ? "" : " 未查询"}
              </button>)}
            </div>
          )}
          {plan && (
            <>
              <dl className="leg-metrics">
                <div><dt>路线预计</dt><dd>{plan.routeMinutes === null ? "未查询" : `${plan.routeMinutes} 分钟`}</dd></div>
                {plan.accessMinutes > 0 && <div><dt>门到门估算</dt><dd>{plan.doorToDoorMinutes === null ? "待确认" : `${plan.doorToDoorMinutes} 分钟`}</dd></div>}
                <div><dt>安全缓冲</dt><dd>{plan.bufferMinutes} 分钟</dd></div>
                <div><dt>建议最迟出发</dt><dd>{plan.latestDeparture ? legClock(plan.latestDeparture) : "待确认"}{plan.reference && plan.latestDeparture ? "（参考）" : ""}</dd></div>
                {plan.remainingMinutes !== null && <div><dt>{plan.remainingMinutes < 0 ? "预计差" : "预计余量"}</dt><dd data-negative={plan.remainingMinutes < 0}>{Math.abs(plan.remainingMinutes)} 分钟</dd></div>}
              </dl>
              {roadMode && <p className="leg-note">{roadAccessLabel(roadMode)} {plan.accessMinutes} 分钟{plan.accessEstimated ? " · 默认估算" : " · 你设置的预留"}</p>}
              {mode === "transit" && plan.routeMinutes !== null && <p className="leg-note">公交总耗时包含方案内步行、等车和换乘。</p>}
            </>
          )}
          {(onBufferChange || (roadMode && onAccessChange)) && <details className="leg-buffer">
            <summary>调整预留</summary>
            {roadMode && onAccessChange && <label>
              {roadAccessLabel(roadMode)}（分钟）
              <input key={`${roadMode}:${accessOverride}`} type="number" min={0} max={120} step={1}
                defaultValue={accessOverride} placeholder={String(ROAD_ACCESS_DEFAULTS[roadMode])}
                onBlur={event => {
                  const {value,valueAsNumber,validity}=event.currentTarget;
                  if (!value && !validity.badInput) onAccessChange(roadMode, undefined);
                  else if (validity.valid) onAccessChange(roadMode, valueAsNumber);
                }}
                onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
            </label>}
            {onBufferChange && <div className="leg-buffer-change" role="group" aria-label="调整安全缓冲">
              {[0, 5, 10, 15, 20].map(minutesValue => <button type="button" key={minutesValue}
                aria-pressed={bufferOverride === minutesValue} onClick={() => onBufferChange(minutesValue)}>{minutesValue} 分</button>)}
              {bufferOverride !== undefined && <button type="button" onClick={() => onBufferChange(undefined)}>恢复默认</button>}
            </div>}
            {plan?.bufferPending && <small>车站或机场的预留为建议值，需要确认。</small>}
          </details>}
          {risk && !plan?.advice && <p className="leg-risk">{risk.basis}</p>}
          {plan?.advice && !["sufficient","tight"].includes(plan.status) &&
            <p className="leg-advice" data-bad={plan.status === "insufficient"}>{plan.advice}</p>}
          {note}
          {mode === "transit" && plannedAt && <p className="leg-note">计划出发 {clock.format(new Date(plannedAt))}</p>}
          {(source || observedAt) && <p className="leg-note">
            {source}{observedAt ? ` · ${clock.format(new Date(observedAt))} 查询` : ""}
          </p>}
          <div className="leg-actions">
            <button type="button" className="text-action" onClick={onRetry}>刷新路线</button>
            {navigation && <a className="leg-nav" href={navigation.href} target={navigation.target} rel="noopener noreferrer"
              onClick={onNavigate}><Navigation size={13} aria-hidden="true" />{navigation.label}</a>}
          </div>
        </div>
      )}
    </div>
  );
}

export { clock as routeClock };

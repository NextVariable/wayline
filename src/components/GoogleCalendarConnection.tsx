import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import type { GoogleCalendarState, GoogleCalendarStatus } from "../lib/useGoogleCalendar";

export function suggestedCalendar(status?: GoogleCalendarStatus | null) {
  const calendars = status?.calendars ?? [];
  const primary = calendars.filter(calendar => calendar.primary);
  return primary.length === 1 ? primary[0] : calendars.length === 1 ? calendars[0] : undefined;
}

export function GoogleCalendarConnection({ connection }: { connection: GoogleCalendarState }) {
  const { status, error, busy, action } = connection;
  const [choosing, setChoosing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const first = !!status?.connected && !status.selected?.length;
  const suggestion = first ? suggestedCalendar(status) : undefined;
  const selectedKey = JSON.stringify(first && suggestion ? [suggestion.id] : status?.selected ?? []);

  useEffect(() => { setSelected(JSON.parse(selectedKey)); }, [selectedKey]);
  useEffect(() => {
    if (!status?.connected) { setChoosing(false); setConfirming(false); }
  }, [status?.connected]);

  const showChoices = choosing || (first && !suggestion);
  const syncLabel = status?.needsReconnect ? "需要重新授权"
    : error && !busy ? "同步未完成"
    : busy ? first ? "正在首次同步…" : "正在同步…"
    : status?.lastSync ? status.events?.length ? `已同步 · ${status.events.length} 条日程` : "已同步 · 此时间范围内没有日程"
    : "选择要同步的日历";

  return <section className="google-calendar-connection" aria-label="Google 日历同步" aria-busy={busy}>
    <div className="calendar-import-heading">
      <strong><CalendarDays size={16} aria-hidden="true" />Google 日历</strong>
      {!status && error ? <button type="button" className="text-action" onClick={connection.refresh}>重试连接</button> : !status?.connected
        ? <button type="button" className="text-action" disabled={busy || !status?.configured} onClick={() => void action("connect")}>{busy ? "正在连接…" : "连接 Google 日历"}</button>
        : (!first || suggestion) && <button type="button" className="text-action" disabled={busy} aria-expanded={showChoices}
          onClick={() => { setChoosing(!choosing); setConfirming(false); }}>{choosing ? "收起" : first ? "选择其他日历" : "管理"}</button>}
    </div>
    {!status && !error && <p className="field-help" role="status">正在检查连接…</p>}
    {status?.configured === false && <p className="field-help">Google 日历暂不可用</p>}
    {status?.connected && <>
      <div className="google-sync-state">
        <span role="status">{syncLabel}</span>
        {!first && !status.needsReconnect && <button type="button" className="text-action" disabled={busy}
          onClick={() => void action("sync")}>{error ? "重试同步" : "立即同步"}</button>}
      </div>
      {first && suggestion && !showChoices && !status.needsReconnect && <div className="google-calendar-actions">
        <button type="button" className="primary-action" disabled={busy}
          onClick={() => void action("select", { calendarIds: [suggestion.id] })}>{error ? "重试同步" : `同步「${suggestion.summary}」`}</button>
      </div>}
      {showChoices && <div className="google-calendar-choices" role="group" aria-label="要同步的日历">
        {!status.calendars?.length && <p className="field-help">没有可读取的日历</p>}
        {(status.calendars ?? []).map(calendar => <label key={calendar.id}>
          <input type="checkbox" disabled={busy} checked={selected.includes(calendar.id)}
            onChange={event => setSelected(ids => event.target.checked ? [...ids, calendar.id] : ids.filter(id => id !== calendar.id))} />
          <span>{calendar.summary}{calendar.primary ? "（主日历）" : ""}</span>
        </label>)}
        <div className="google-calendar-actions">
          <button type="button" className="primary-action" disabled={busy || status.needsReconnect || !selected.length || selected.length > 10}
            onClick={() => void action("select", { calendarIds: selected })}>{first && error ? "重试同步" : "同步所选日历"}</button>
          {confirming ? <>
            <p className="field-help">断开后，Wayline 会移除这里的同步日程。</p>
            <button type="button" className="text-action" disabled={busy} onClick={() => setConfirming(false)}>取消</button>
            <button type="button" className="text-action" disabled={busy} onClick={() => void action("disconnect")}>确认断开</button>
          </> : <button type="button" className="text-action" disabled={busy} onClick={() => setConfirming(true)}>断开连接</button>}
        </div>
      </div>}
      {status.needsReconnect && <button type="button" className="text-action" disabled={busy} onClick={() => void action("connect")}>重新授权</button>}
    </>}
    {error && status?.configured !== false && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}

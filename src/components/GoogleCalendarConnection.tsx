import { useEffect, useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import type { GoogleCalendarState } from "../lib/useGoogleCalendar";

export function GoogleCalendarConnection({ connection }: { connection: GoogleCalendarState }) {
  const { status, error, busy, action } = connection;
  const [choosing, setChoosing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const selectedKey = JSON.stringify(status?.selected ?? []);

  useEffect(() => { setSelected(JSON.parse(selectedKey)); }, [selectedKey]);
  useEffect(() => {
    if (!status?.connected) { setChoosing(false); setConfirming(false); }
  }, [status?.connected]);

  return <section className="google-calendar-connection" aria-label="Google 日历同步">
    <div className="calendar-import-heading">
      <strong><CalendarDays size={16} aria-hidden="true" />Google 日历</strong>
      {!status && error ? <button type="button" className="text-action" onClick={connection.refresh}>重试连接</button> : !status?.connected
        ? <button type="button" className="text-action" disabled={busy || !status?.configured} onClick={() => void action("connect")}>{busy ? "正在连接…" : "连接"}</button>
        : <button type="button" className="text-action" aria-expanded={choosing} onClick={() => { setChoosing(!choosing); setConfirming(false); }}>{choosing ? "收起" : "管理"}</button>}
    </div>
    {!status && !error && <p className="field-help">正在检查连接…</p>}
    {status?.configured === false && <p className="field-help">Google 日历暂不可用</p>}
    {status?.connected && <>
      <div className="google-sync-state">
        <span>{status.needsReconnect ? "需要重新连接" : status.lastSync
          ? "上次同步 " + new Date(status.lastSync).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
          : "请选择要同步的日历"}</span>
        <button type="button" className="text-action" disabled={busy || !status.selected?.length || status.needsReconnect}
          onClick={() => void action("sync")}><RefreshCw size={14} aria-hidden="true" />{busy ? "同步中…" : "立即同步"}</button>
      </div>
      {(choosing || !status.selected?.length) && <div className="google-calendar-choices">
        {(status.calendars ?? []).map(calendar => <label key={calendar.id}>
          <input type="checkbox" checked={selected.includes(calendar.id)}
            onChange={event => setSelected(ids => event.target.checked ? [...ids, calendar.id] : ids.filter(id => id !== calendar.id))} />
          <span>{calendar.summary}</span>
        </label>)}
        <div className="google-calendar-actions">
          <button type="button" className="primary-action" disabled={busy || !selected.length || selected.length > 10}
            onClick={() => void action("select", { calendarIds: selected })}>同步所选日历</button>
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

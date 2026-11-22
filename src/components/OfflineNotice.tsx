import { useEffect, useState } from "react";
import { useOnlineStatus } from "../lib/useOnlineStatus";

/**
 * One calm line while the device is offline, and a short confirmation once routes, calendar sync and
 * place lookups can resume. It never blocks the map or the panel underneath.
 */
export function OfflineNoticeView({ online, wasOffline }: { online: boolean; wasOffline: boolean }) {
  if (online && !wasOffline) return null;
  return (
    <div className="offline-notice" role="status" aria-live="polite">
      {online ? "网络已恢复，正在重新查询路线并同步" : "当前离线，路线、日历同步与地点识别可能不是最新"}
    </div>
  );
}

export function OfflineNotice() {
  const online = useOnlineStatus();
  const [wasOffline, setWasOffline] = useState(false);
  useEffect(() => {
    if (!online) {
      setWasOffline(true);
      return;
    }
    if (!wasOffline) return;
    const timer = window.setTimeout(() => setWasOffline(false), 4000);
    return () => window.clearTimeout(timer);
  }, [online, wasOffline]);
  return <OfflineNoticeView online={online} wasOffline={wasOffline} />;
}

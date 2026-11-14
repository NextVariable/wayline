import { userFacingError } from "../lib/userFacingError";
import { Check, FolderOpen, LogOut, X } from "lucide-react";
import { useMemo, useState, useRef } from "react";
import { createUser, guestUser, type AppUser } from "../lib/userStorage";
import type { AccountState } from "../lib/account";
import type { SyncState } from "../lib/workspaceSync";

const SYNC_LABEL: Record<SyncState, string> = { off: "", syncing: "同步中", idle: "已同步", offline: "未同步（离线）", conflict: "已载入另一台设备的更新" };
import { createWorkspaceBackup, parseWorkspaceBackup, restoreWorkspaceRecords, type WorkspaceBackup } from "../lib/workspaceBackup";
import { openFootprintStore } from "../lib/footprintStore";
import type { FootprintData } from "../lib/footprints";
import { useToast } from "./Toast";
import { usePanelFocus } from "../lib/usePanelFocus";

export function AuthPanel({
  user,
  onLogin,
  open,
  onClose,
  getFootprints,
  accountStatus,
  accountEmail,
  syncState,
  onSignIn,
  onSignOut,
  onReturnToAccount,
}: {
  accountStatus: AccountState["status"];
  accountEmail?: string;
  syncState: SyncState;
  onSignIn: () => void;
  onSignOut: () => void;
  onReturnToAccount?: () => void;
  user: AppUser;
  onLogin: (user: AppUser) => boolean | void;
  open: boolean;
  onClose: () => void;
  getFootprints: () => Promise<FootprintData>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<WorkspaceBackup | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const { addToast } = useToast();
  
  const ref = usePanelFocus(open);
  const spaces = useMemo(() => {
    if (!open) return [];
    const entries: AppUser[] = [guestUser, user];
    try {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith("whatto.userPlaces.")) continue;
        const id = key.slice("whatto.userPlaces.".length);
        const split = id.indexOf(":");
        if (split < 0) continue;
        const method = id.slice(0, split) as AppUser["method"];
        if (!["local", "phone", "wechat", "email"].includes(method)) continue;
        entries.push({ id, method, label: id.slice(split + 1) });
      }
    } catch {
      /* The current space remains available when storage is blocked. */
    }
    return entries.filter(
      (item, i) => entries.findIndex((other) => other.id === item.id) === i,
    );
  }, [open, user]);
  
  if (!open) return null;
  return (
    <section
      ref={ref}
      className="account-panel workspace-panel"
      aria-label="资料与备份"
    >
      <div className="panel-heading">
        <h1>资料与备份</h1>
        <button
          className="icon-button"
          aria-label="关闭资料与备份"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="account-section" aria-label="账号">
        {accountStatus === "signed-in" ? <>
          <div className="account-identity"><strong>{accountEmail}</strong>{user.method === "google"
            ? SYNC_LABEL[syncState] && <small role="status">{SYNC_LABEL[syncState]}</small>
            : <small>当前查看本机空间</small>}</div>
          {user.method !== "google" && onReturnToAccount && <button type="button" className="text-action" onClick={onReturnToAccount}>返回账号空间</button>}
          <button type="button" className="text-action account-sign-out" onClick={onSignOut}><LogOut size={15} />退出</button>
 </> : accountStatus === "loading" ? <p className="field-help" role="status">正在确认登录…</p> : <>
          <button type="button" className="primary-action" disabled={accountStatus === "unavailable"} onClick={onSignIn}>{accountStatus === "unavailable" ? "登录暂不可用" : "用 Google 登录"}</button>
          <p className="field-help">登录后可跨设备恢复资料，并在日历来源中连接 Google 日历。</p>
        </>}
      </div>
      {spaces.some(space => space.method === "local") && <div className="space-list" aria-label="本机空间">
        {spaces.filter(space => space.method !== "google").map((space) => (
          <button
            key={space.id}
            aria-pressed={space.id === user.id}
            onClick={() => {
              if (space.id === user.id || onLogin(space) !== false) onClose();
            }}
          >
            <FolderOpen size={17} />
            <span>{space.id === "guest" ? "默认空间" : space.label}</span>
            {space.id === user.id && (
              <>
                <Check size={15} />
              </>
            )}
          </button>
        ))}
      </div>}
      <details className="workspace-backup">
        <summary>备份与迁移</summary>
        <p className="field-help">可将地点、日程和足迹带到其他浏览器。恢复时创建独立空间。</p>
        <div className="backup-actions">
          <button className="secondary-action" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const text = createWorkspaceBackup(user, await getFootprints());
              const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
              const a = document.createElement("a"); a.href = url; a.download = "wayline-workspace-" + new Date().toISOString().slice(0, 10) + ".json"; a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch { addToast("备份未能生成，请重试", "error"); } finally { setBusy(false); }
          }}>导出全部资料</button>
          <button className="secondary-action" disabled={busy} onClick={() => fileRef.current?.click()}>恢复备份</button>
        </div>
        <input hidden type="file" accept="application/json,.json" ref={fileRef} aria-label="选择空间备份" onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
          setRestoreError("");
          setPending(null);
          try { if (file.size > 30_000_000) throw new Error("备份超过30MB"); setPending(parseWorkspaceBackup(await file.text())); }
          catch (error) { setRestoreError(userFacingError(error, "备份无法读取，请选择从本产品导出的 JSON 备份。")); }
        }} />
        {restoreError && <p className="inline-error" role="alert">{restoreError}</p>}
        {pending && <div className="backup-preview" role="status">
          <p>恢复「{pending.name === "游客" ? "默认空间" : pending.name}」：{(pending.records["whatto.userPlaces."] as unknown[] | undefined)?.length ?? 0} 个地点与日程，{pending.footprints.tracks.length} 条轨迹，{pending.footprints.visits.length} 次到访。</p>
          <div className="backup-actions"><button className="primary-action" disabled={busy} onClick={async () => {
            setBusy(true); let rollback: (() => void) | undefined;
            const restored = createUser("local", (pending.name === "游客" ? "默认空间" : pending.name) + " 恢复 " + crypto.randomUUID().slice(0, 8));
            try {
              rollback = restoreWorkspaceRecords(pending, restored.id);
              const store = await openFootprintStore(restored.id);
              try { await store.importData(pending.footprints); } finally { store.close(); }
              if (onLogin(restored) === false) throw new Error("暂时无法切换空间，请重试。原空间未改变。");
              setPending(null); onClose(); addToast("已恢复到独立空间", "success");
            } catch { rollback?.(); addToast("恢复失败，当前空间未改变，请重试", "error"); } finally { setBusy(false); }
          }}>恢复到新空间</button><button className="secondary-action" disabled={busy} onClick={() => setPending(null)}>取消</button></div>
        </div>}
      </details>
      
      {accountStatus !== "signed-in" && <p className="field-help storage-note">资料保存在此浏览器，换设备前请导出备份。</p>}
    </section>
  );
}

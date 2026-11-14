import { FolderOpen } from "lucide-react";
import type { AccountState } from "../lib/account";

/** Workspace entry in the sidebar: invites guests to sign in, shows the account once signed in. */
export function AccountEntry({
  status,
  email,
  onOpen,
}: {
  status: AccountState["status"];
  email?: string;
  onOpen: () => void;
}) {
  if (status === "signed-in" && email) {
    const initial = email.trim().charAt(0).toUpperCase() || "?";
    return (
      <button type="button" className="account-entry is-signed-in" aria-label={`账号 ${email}`} title={email} onClick={onOpen}>
 <span className="account-avatar" aria-hidden="true">{initial}</span>
      </button>
    );
  }
  if (status === "guest") {
    return (
      <button type="button" className="account-entry is-guest" aria-label="登录，资料与备份" title="登录，资料与备份" onClick={onOpen}>
 登录
      </button>
    );
  }
  return (
    <button type="button" className="action-menu-trigger" aria-label="资料与备份" title="资料与备份" onClick={onOpen}>
      <FolderOpen size={15} />
    </button>
  );
}

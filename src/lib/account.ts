import { useCallback, useEffect, useState } from "react";
import { guestUser, type AppUser } from "./userStorage";

export type Account = { id: string; email: string; name: string };
export type AccountInfo = { configured: boolean; signedIn: boolean; account?: Account };
export type AccountState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "unavailable" }
  | { status: "signed-in"; account: Account };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const json = { "Content-Type": "application/json" };
const SIGNED_OUT: AccountInfo = { configured: true, signedIn: false };

/** Network trouble or an expired session both read as signed out; local data stays usable. */
export async function fetchAccount(fetchImpl: FetchLike = fetch): Promise<AccountInfo> {
  try {
    const response = await fetchImpl("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return SIGNED_OUT;
    const data = await response.json();
    if (data?.configured === false) return { configured: false, signedIn: false };
    const account = data?.account;
    if (data?.signedIn === true && typeof account?.id === "string" && typeof account?.email === "string")
      return { configured: true, signedIn: true, account: { id: account.id, email: account.email, name: String(account.name ?? "") } };
    return SIGNED_OUT;
  } catch {
    return SIGNED_OUT;
  }
}

/** The Google authorization URL, or null when sign-in is not configured on this server. */
export async function startSignIn(fetchImpl: FetchLike = fetch): Promise<string | null> {
  const response = await fetchImpl("/api/auth/google/start", { method: "POST", credentials: "same-origin", headers: json, body: "{}" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "暂时无法登录，请稍后重试");
  if (data?.configured === false) return null;
  const url = typeof data?.url === "string" ? new URL(data.url) : null;
  if (!url || url.origin !== "https://accounts.google.com") throw new Error("登录地址无效");
  return url.href;
}

export async function signOut(fetchImpl: FetchLike = fetch): Promise<void> {
  const response = await fetchImpl("/api/auth/signout", { method: "POST", credentials: "same-origin", headers: json, body: "{}" });
  if (!response.ok && response.status !== 401) throw new Error("退出未完成");
}

export function accountUser(account: Pick<Account, "id" | "email">): AppUser {
  return { id: `google:${account.id}`, label: account.email, method: "google" };
}

/** Which storage owner the app shows: the account when signed in, otherwise the local space (never a stale account). */
export function chooseActiveUser(state: { status: AccountState["status"]; account?: Account }, localUser: AppUser): AppUser {
  if (state.status === "signed-in" && state.account) return accountUser(state.account);
  return localUser.method === "google" ? guestUser : localUser;
}

export function useAccount() {
  const [state, setState] = useState<AccountState>({ status: "loading" });
  const refresh = useCallback(async () => {
    const info = await fetchAccount();
    setState(!info.configured ? { status: "unavailable" } : info.signedIn && info.account ? { status: "signed-in", account: info.account } : { status: "guest" });
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const signIn = useCallback(async () => {
    const url = await startSignIn();
    if (!url) { setState({ status: "unavailable" }); return; }
    window.location.assign(url);
  }, []);
  const leave = useCallback(async () => {
    await signOut();
    setState({ status: "guest" });
  }, []);
  return { ...state, refresh, signIn, signOut: leave };
}
export type AccountController = ReturnType<typeof useAccount>;

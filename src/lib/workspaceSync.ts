import { useCallback, useEffect, useRef, useState } from "react";
import { createWorkspaceBackup, parseWorkspaceBackup, replaceWorkspaceRecords } from "./workspaceBackup";
import { guestUser, type AppUser } from "./userStorage";
import type { FootprintData } from "./footprints";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export class SignedOutError extends Error { constructor() { super("登录已失效"); } }
export type PullResult = { version: number; empty: boolean; footprints?: FootprintData };
export type PushResult = { version: number } | { conflict: true; version: number };

const JSON_HEADERS = { "Content-Type": "application/json" };
const conflictKey = (owner: string) => `wayline.workspaceConflict.${owner}`;
const GUEST_RECORDS = ["whatto.userPlaces.", "whatto.calendarEvents.", "whatto.tripDraft.", "whatto.savedTrips."];

/** Load the account's cloud workspace into local storage for `owner`. Empty accounts leave local data untouched. */
export async function pullWorkspace(owner: string, fetchImpl: FetchLike = fetch, storage: Storage = localStorage): Promise<PullResult> {
  const response = await fetchImpl("/api/workspace", { credentials: "same-origin", cache: "no-store" });
  if (response.status === 401) throw new SignedOutError();
  if (!response.ok) throw new Error("暂时无法读取云端数据");
  const data = await response.json();
  const version = Number.isInteger(data?.version) ? data.version : 0;
  if (!data?.workspace) return { version, empty: true };
  const backup = parseWorkspaceBackup(JSON.stringify(data.workspace));
  replaceWorkspaceRecords(backup, owner, storage);
  return { version, empty: false, footprints: backup.footprints };
}

async function put(baseVersion: number, workspace: unknown, fetchImpl: FetchLike): Promise<PushResult> {
  const response = await fetchImpl("/api/workspace", {
    method: "PUT", credentials: "same-origin", headers: JSON_HEADERS, body: JSON.stringify({ baseVersion, workspace }),
  });
  if (response.status === 401) throw new SignedOutError();
  const data = await response.json().catch(() => null);
  if (response.status === 409) return { conflict: true, version: Number(data?.version) || 0 };
  if (!response.ok) throw new Error(data?.error || "暂时无法保存到云端");
  return { version: Number(data?.version) };
}

/** Send the owner's local records with the last version this device saw; a 409 means another device saved first. */
export function pushWorkspace(user: AppUser, footprints: FootprintData, baseVersion: number, fetchImpl: FetchLike = fetch, storage: Storage = localStorage): Promise<PushResult> {
  return put(baseVersion, JSON.parse(createWorkspaceBackup(user, footprints, storage)), fetchImpl);
}

export function guestDataWorthMigrating(storage: Storage = localStorage, guestFootprints?: FootprintData): boolean {
  if (guestFootprints && (guestFootprints.tracks.length > 0 || guestFootprints.visits.length > 0)) return true;
  return GUEST_RECORDS.some(prefix => {
    try { const value = JSON.parse(storage.getItem(prefix + guestUser.id) ?? "null"); return Array.isArray(value) && value.length > 0; }
    catch { return false; }
  });
}

/** Copy the guest workspace into an empty account (base version 0). A non-empty account answers 409 and nothing is written. */
export async function migrateGuestWorkspace(user: AppUser, guestFootprints: FootprintData, fetchImpl: FetchLike = fetch, storage: Storage = localStorage): Promise<PushResult> {
  const backup = parseWorkspaceBackup(createWorkspaceBackup({ ...guestUser, label: user.label }, guestFootprints, storage));
  const result = await put(0, backup, fetchImpl);
  if (!("conflict" in result)) replaceWorkspaceRecords(backup, user.id, storage);
  return result;
}

export type SyncState = "off" | "syncing" | "idle" | "offline" | "conflict";
type SyncOptions = {
  /** The signed-in account user, or null when signed out. */
  account: AppUser | null;
  pausePush?: boolean;
  /** Changes whenever the owner's local data changes; drives the debounced push. */
  changeKey: string;
  readFootprints(owner: string): Promise<FootprintData>;
  writeFootprints(owner: string, data: FootprintData): Promise<void>;
  /** Called when a conflict or migration replaced data the app already shows. */
  onReloaded(): void;
  onSignedOut(): void;
};

export function useWorkspaceSync({ account, pausePush, changeKey, readFootprints, writeFootprints, onReloaded, onSignedOut }: SyncOptions) {
  const signedIn = !!account;
  const user = account ?? guestUser;
  const currentAccount = useRef(account?.id);
  currentAccount.current = account?.id;
  /** Owner whose local copy is up to date; the app switches to the account only then, so no reload is needed. */
  const [readyOwner, setReadyOwner] = useState<string | null>(null);
  const [state, setState] = useState<SyncState>("off");
  const [offerMigration, setOfferMigration] = useState(false);
  const version = useRef(0);
  const ready = useRef(false);
  const conflictOwners = useRef(new Set<string>());
  const pendingPush = useRef<Promise<void> | undefined>(undefined);
  const skipNextChange = useRef(false);
  const callbacks = useRef({ readFootprints, writeFootprints, onReloaded, onSignedOut });
  callbacks.current = { readFootprints, writeFootprints, onReloaded, onSignedOut };

  const pull = useCallback(async (owner: string, alreadyShown: boolean) => {
    const result = await pullWorkspace(owner);
    if (result.footprints) await callbacks.current.writeFootprints(owner, result.footprints);
    version.current = result.version;
    skipNextChange.current = true;
    if (!result.empty && alreadyShown) callbacks.current.onReloaded();
    return result;
  }, []);

  const fail = useCallback((error: unknown) => {
    if (error instanceof SignedOutError) { callbacks.current.onSignedOut(); setState("off"); }
    else setState("offline");
  }, []);

  useEffect(() => {
    ready.current = false;
    setOfferMigration(false);
    setReadyOwner(null);
    if (!signedIn) { setState("off"); return; }
    let current = true;
    setState("syncing");
    void (async () => {
      try {
        if (conflictOwners.current.has(user.id) || localStorage.getItem(conflictKey(user.id))) {
          conflictOwners.current.add(user.id);
          ready.current = true;
          setReadyOwner(user.id);
          setState("conflict");
          return;
        }
        const result = await pull(user.id, false);
        if (!current) return;
        if (result.empty) setOfferMigration(guestDataWorthMigrating(localStorage, await callbacks.current.readFootprints(guestUser.id)));
        ready.current = true;
        setReadyOwner(user.id);
        setState("idle");
      } catch (error) {
        if (!current) return;
        fail(error);
        // Offline: still show the cached copy of this account.
        if (!(error instanceof SignedOutError)) { ready.current = true; setReadyOwner(user.id); }
      }
    })();
    return () => { current = false; };
  }, [signedIn, user.id, pull, fail]);

  useEffect(() => {
    if (!signedIn || !ready.current || pausePush || conflictOwners.current.has(user.id)) return;
    if (skipNextChange.current) { skipNextChange.current = false; return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const job = (pendingPush.current ?? Promise.resolve()).then(async () => {
        if (controller.signal.aborted || conflictOwners.current.has(user.id)) return;
        setState("syncing");
        try {
          const footprints = await callbacks.current.readFootprints(user.id);
          if (controller.signal.aborted) return;
          const result = await pushWorkspace(user, footprints, version.current);
          if ("conflict" in result) {
            conflictOwners.current.add(user.id);
            try { localStorage.setItem(conflictKey(user.id), "1"); } catch { /* Keep the in-memory lock if storage is unavailable. */ }
            if (currentAccount.current === user.id) setState("conflict");
            return;
          }
          if (currentAccount.current !== user.id) return;
          version.current = result.version;
          setState("idle");
        } catch (error) { if (currentAccount.current === user.id) fail(error); }
      });
      pendingPush.current = job;
      await job;
      if (pendingPush.current === job) pendingPush.current = undefined;
    }, 2000);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [signedIn, user, changeKey, fail, pausePush]);

  const migrateGuest = useCallback(async () => {
    if (!signedIn) return;
    setOfferMigration(false);
    setState("syncing");
    try {
      const result = await migrateGuestWorkspace(user, await callbacks.current.readFootprints(guestUser.id));
      if ("conflict" in result) { await pull(user.id, true); setState("idle"); return; }
      await callbacks.current.writeFootprints(user.id, await callbacks.current.readFootprints(guestUser.id));
      version.current = result.version;
      skipNextChange.current = true;
      callbacks.current.onReloaded();
      setState("idle");
    } catch (error) { fail(error); }
  }, [signedIn, user, pull, fail]);

  const useCloudVersion = useCallback(async () => {
    if (!signedIn || !conflictOwners.current.has(user.id)) return;
    setState("syncing");
    try {
      const result = await pull(user.id, false);
      if (result.empty) throw new Error("没有可恢复的云端数据");
      localStorage.removeItem(conflictKey(user.id));
      conflictOwners.current.delete(user.id);
      callbacks.current.onReloaded();
    } catch {
      if (currentAccount.current === user.id) setState("conflict");
    }
  }, [signedIn, user.id, pull]);

  return {
    state, offerMigration, migrateGuest, readyOwner, useCloudVersion,
    dismissMigration: () => setOfferMigration(false),
  };
}
export type WorkspaceSync = ReturnType<typeof useWorkspaceSync>;

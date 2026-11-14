import { isStoredPlace } from "./placeValidation";
import type { Place } from "../types/place";

export type AuthMethod = "guest" | "local" | "phone" | "wechat" | "email" | "google";

export interface AppUser {
  id: string;
  label: string;
  method: AuthMethod;
}

const userKey = "whatto.activeUser";

export const guestUser: AppUser = {
  id: "guest",
  label: "游客",
  method: "guest",
};

export function storageKey(userId: string) {
  return `whatto.userPlaces.${userId}`;
}

export function loadActiveUser(): AppUser {
  try {
    const raw = localStorage.getItem(userKey);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object") return guestUser;
    const user = value as AppUser;
    return typeof user.id === "string" &&
      typeof user.label === "string" &&
      ["guest", "local", "phone", "wechat", "email"].includes(user.method)
      ? user
      : guestUser;
  } catch {
    return guestUser;
  }
}

/** Only local spaces are remembered here; a Google account is restored from its server session. */
export function saveActiveUser(user: AppUser) {
  if (user.method === "google") return true;
  try {
    localStorage.setItem(userKey, JSON.stringify(user));
    return true;
  } catch {
    return false;
  }
}

export function loadUserPlaces(user: AppUser): Place[] {
  try {
    const raw = localStorage.getItem(storageKey(user.id));
    if (raw) { const value: unknown = JSON.parse(raw); return Array.isArray(value) ? value.filter(isStoredPlace) : []; }
  } catch {
    // Ignore broken local state and fall back safely.
  }
  return [];
}

export function saveUserPlaces(user: AppUser, places: Place[]) {
  try {
    localStorage.setItem(storageKey(user.id), JSON.stringify(places));
    return true;
  } catch {
    return false;
  }
}

export function createUser(method: AuthMethod, value: string): AppUser {
  const normalized = value.trim() || method;
  return {
    id: `${method}:${normalized.toLowerCase()}`,
    label: method === "wechat" ? "微信用户" : normalized,
    method,
  };
}

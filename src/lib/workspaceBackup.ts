import { isCalendarEntry } from "./calendarEvents";
import { validPlannerDraft } from "./savedTrips";
import { isStoredPlace } from "./placeValidation";
import { isPlaceAliases } from "./placeAliases";
import { parseFootprints, type FootprintData } from "./footprints";
import type { AppUser } from "./userStorage";

const businessSettingsPrefix = "wayline.businessTrips.";
const prefixes = ["whatto.userPlaces.", "whatto.tripDraft.", "whatto.customGuides.", "whatto.cities.", "whatto.planner.", "whatto.savedTrips.", "whereto:city-view:", "whatto.calendarEvents.", "whatto.placeAliases.", businessSettingsPrefix] as const;
function withoutFlightAccess(draft: Record<string, unknown>) {
  const copy = { ...draft };
  delete copy.flightWatch;
  if (copy.result && typeof copy.result === "object") {
    const result = { ...(copy.result as Record<string, unknown>) };
    delete result.flightWatchToken;
    copy.result = result;
  }
  return copy;
}

export interface WorkspaceBackup { format: "whereto-workspace"; version: 1; name: string; records: Record<string, unknown>; footprints: FootprintData }
export function createWorkspaceBackup(user: AppUser, footprints: FootprintData, storage: Storage = localStorage) {
  const records: Record<string, unknown> = {};
  for (const prefix of prefixes) {
    const raw = storage.getItem(prefix + user.id);
    if (raw !== null) records[prefix] = JSON.parse(raw);
  }
  const backup: WorkspaceBackup = { format: "whereto-workspace", version: 1, name: user.label, records, footprints };
  return JSON.stringify(parseWorkspaceBackup(JSON.stringify(backup)), null, 2);
}
export function parseWorkspaceBackup(text: string): WorkspaceBackup {
  if (text.length > 30_000_000) throw new Error("备份超过30MB");
  const value = JSON.parse(text);
  if (value?.format !== "whereto-workspace" || value.version !== 1 || typeof value.name !== "string" || !value.records || typeof value.records !== "object" || Array.isArray(value.records)) throw new Error("不是完整空间备份，请选择正确的文件");
  for (const [key, record] of Object.entries(value.records)) {
    if (!prefixes.includes(key as typeof prefixes[number])) throw new Error("备份包含不支持的数据");
    if ([prefixes[0], prefixes[1]].includes(key as typeof prefixes[0])) {
      if (!Array.isArray(record) || record.length > 10000 || record.some(p => !isStoredPlace(p))) throw new Error("地点记录不完整，未导入任何内容");
      for (const p of record) if (typeof p.address !== "string" || !p.tags.every((t: unknown) => typeof t === "string") || !["user", "system"].includes(p.type) || !["food", "business", "university", "transport", "shopping", "attraction", "custom"].includes(p.category)) throw new Error("地点信息无效");
    } else if (key === prefixes[2]) {
      if (!Array.isArray(record) || record.some(v => typeof v !== "string" || v.length > 200)) throw new Error("指南信息无效");
    } else if (key === prefixes[3]) {
      if (!Array.isArray(record) || record.some(c => !c || typeof c.name !== "string" || !Number.isFinite(c.lat) || Math.abs(c.lat) > 90 || !Number.isFinite(c.lng) || Math.abs(c.lng) > 180 || !Number.isFinite(c.zoom))) throw new Error("城市信息无效");
    } else if (key === prefixes[4]) {
      if (!validPlannerDraft(record)) throw new Error("规划条件无效");
      value.records[key] = withoutFlightAccess(record as Record<string, unknown>);
    } else if (key === prefixes[5]) {
      if (!Array.isArray(record) || record.length > 100 || record.some(t => !t || typeof t.id !== "string" || typeof t.name !== "string" || !Number.isFinite(t.updatedAt) || !Array.isArray(t.places) || t.places.some((p: unknown) => !isStoredPlace(p)) || !validPlannerDraft(t.draft))) throw new Error("已存行程无效");
      value.records[key] = record.map(trip=>({...trip,draft:withoutFlightAccess(trip.draft)}));
    } else if (key === "whatto.calendarEvents.") {
      if (!Array.isArray(record) || record.length > 7000 || !record.every(isCalendarEntry)) throw new Error("日历事件无效");
    } else if (key === "whatto.placeAliases.") {
      if (!isPlaceAliases(record)) throw new Error("记住的地点无效");
    } else if (key === businessSettingsPrefix) {
      const settings = record as { home?: unknown; inferHome?: unknown; boundaries?: unknown } | null;
      if (!settings || typeof settings.home !== "string" || settings.home.length > 160 ||
          (settings.inferHome !== undefined && typeof settings.inferHome !== "boolean") ||
          !settings.boundaries || typeof settings.boundaries !== "object" || Array.isArray(settings.boundaries) ||
          Object.values(settings.boundaries).some(value => value !== "split" && value !== "join")) throw new Error("行程设置无效");
    } else {
      const r = record as Record<string, unknown>;
      if (!r || typeof r.activeCity !== "string" || !["all", "current", "selected"].includes(String(r.scope))) throw new Error("城市范围无效");
    }
  }
  const footprints = parseFootprints(JSON.stringify({ ...value.footprints, format: "whereto-footprints", version: 1 }));
  return { format: "whereto-workspace", version: 1, name: value.name.slice(0, 100), records: value.records, footprints };
}
/** Restore into a new owner only. The current workspace is never overwritten. */
export function restoreWorkspaceRecords(backup: WorkspaceBackup, owner: string, storage: Storage = localStorage) {
  if (prefixes.some(prefix => storage.getItem(prefix + owner) !== null)) throw new Error("恢复空间已存在");
  const written: string[] = [];
  try {
    for (const [prefix, record] of Object.entries(backup.records)) {
      const key = prefix + owner;
      const restored = prefix === "whatto.planner." ? { ...(record as Record<string, unknown>), result: null, generatedFor: "" } : record;
      storage.setItem(key, JSON.stringify(restored)); written.push(key);
    }
    if (!backup.records[prefixes[0]]) { const key = prefixes[0] + owner; storage.setItem(key, "[]"); written.push(key); }
  } catch (error) { written.forEach(key => storage.removeItem(key)); throw error; }
  return () => written.forEach(key => storage.removeItem(key));
}
/** Replace every record of one owner with a backup (used by account sync). All-or-nothing: a failed write restores the previous values. */
export function replaceWorkspaceRecords(backup: WorkspaceBackup, owner: string, storage: Storage = localStorage) {
  const previous = prefixes.map(prefix => [prefix + owner, storage.getItem(prefix + owner)] as const);
  try {
    for (const prefix of prefixes) {
      const key = prefix + owner;
      if (!(prefix in backup.records)) {
        // Older cloud snapshots never captured this setting.
        if (prefix !== businessSettingsPrefix) storage.removeItem(key);
        continue;
      }
      const record = backup.records[prefix];
      const value = prefix === "whatto.planner." ? { ...(record as Record<string, unknown>), result: null, generatedFor: "" } : record;
      storage.setItem(key, JSON.stringify(value));
    }
    if (!(prefixes[0] in backup.records)) storage.setItem(prefixes[0] + owner, "[]");
  } catch (error) {
    for (const [key, value] of previous) { if (value === null) storage.removeItem(key); else storage.setItem(key, value); }
    throw error;
  }
}

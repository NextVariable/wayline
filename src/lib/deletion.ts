import type { Place } from "../types/place";

export const TRASH_DAYS = 30;
const RECOVERABLE_MS = TRASH_DAYS * 86_400_000;
export const trashKey = (owner: string) => `wayline.trash.${owner}`;

export interface TrashEntry { place: Place; deletedAt: number; purgeAt: number }

function read(owner: string, storage: Storage = localStorage): TrashEntry[] {
  try {
    const rows = JSON.parse(storage.getItem(trashKey(owner)) ?? "[]");
    return Array.isArray(rows) ? rows.filter((row): row is TrashEntry =>
      !!row && !!row.place && typeof row.place === "object" && typeof row.place.id === "string" &&
      Number.isFinite(row.deletedAt) && Number.isFinite(row.purgeAt)) : [];
  } catch { return []; }
}

function write(owner: string, rows: TrashEntry[], storage: Storage = localStorage) {
  if (rows.length) storage.setItem(trashKey(owner), JSON.stringify(rows));
  else storage.removeItem(trashKey(owner));
}

/** Expired entries are removed when the workspace is read; no background job is required. */
export function purgeExpiredTrash(owner: string, now = Date.now(), storage: Storage = localStorage) {
  const rows = read(owner, storage);
  const kept = rows.filter(row => row.purgeAt > now);
  if (kept.length !== rows.length) write(owner, kept, storage);
  return kept;
}

export function readTrash(owner: string, now = Date.now(), storage: Storage = localStorage) {
  return purgeExpiredTrash(owner, now, storage).sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Move a local place or schedule into the 30-day recovery area. */
export function moveToTrash(owner: string, place: Place, now = Date.now(), storage: Storage = localStorage) {
  const rows = purgeExpiredTrash(owner, now, storage).filter(row => row.place.id !== place.id);
  rows.push({ place, deletedAt: now, purgeAt: now + RECOVERABLE_MS });
  write(owner, rows, storage);
  return rows;
}

export function restoreFromTrash(owner: string, placeId: string, storage: Storage = localStorage): Place | undefined {
  const rows = read(owner, storage);
  const entry = rows.find(row => row.place.id === placeId);
  if (!entry) return undefined;
  write(owner, rows.filter(row => row.place.id !== placeId), storage);
  return entry.place;
}

/** Immediate permanent deletion of one recoverable record. */
export function deleteTrashEntry(owner: string, placeId: string, storage: Storage = localStorage) {
  write(owner, read(owner, storage).filter(row => row.place.id !== placeId), storage);
}

export function emptyTrash(owner: string, storage: Storage = localStorage) {
  write(owner, [], storage);
}

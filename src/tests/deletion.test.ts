import { expect, it } from "vitest";
import { deleteTrashEntry, moveToTrash, purgeExpiredTrash, readTrash, restoreFromTrash, TRASH_DAYS } from "../lib/deletion";
import { initialUserPlaces } from "./fixtures/userPlaces";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } as unknown as Storage;
}
const place = initialUserPlaces[0];

it("keeps an ordinary deletion recoverable for 30 days without touching active data", () => {
  const store = storage(), now = Date.parse("2026-11-25T00:00:00Z");
  moveToTrash("guest", place, now, store);
  const rows = readTrash("guest", now, store);
  expect(rows).toHaveLength(1);
  expect(rows[0].purgeAt - rows[0].deletedAt).toBe(TRASH_DAYS * 86_400_000);
  expect(restoreFromTrash("guest", place.id, store)).toEqual(place);
  expect(readTrash("guest", now, store)).toHaveLength(0);
});

it("purges expired entries and supports immediate permanent deletion", () => {
  const store = storage(), now = Date.parse("2026-11-25T00:00:00Z");
  moveToTrash("guest", place, now, store);
  expect(purgeExpiredTrash("guest", now + 31 * 86_400_000, store)).toHaveLength(0);
  moveToTrash("guest", place, now, store);
  deleteTrashEntry("guest", place.id, store);
  expect(readTrash("guest", now, store)).toHaveLength(0);
});

it("does not duplicate the same record when deleted twice", () => {
  const store = storage(), now = Date.parse("2026-11-25T00:00:00Z");
  moveToTrash("guest", place, now, store);
  moveToTrash("guest", place, now + 1000, store);
  expect(readTrash("guest", now + 1000, store)).toHaveLength(1);
});

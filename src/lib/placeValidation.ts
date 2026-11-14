import type { Place } from "../types/place";
const categories = ["food", "business", "university", "transport", "shopping", "attraction", "custom"];
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length < 1000 && v.every(s => typeof s === "string" && s.length <= 12000);
export function isStoredPlace(value: unknown): value is Place {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Place;
  return [p.id, p.name, p.city, p.address, p.openingHours, p.description, p.reason, p.distanceText].every(s => typeof s === "string" && s.length <= 12000) && !!p.id && !!p.name &&
    Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180 && categories.includes(p.category) &&
    ["user", "system"].includes(p.type) && ["manual", "imported", "saved", "system"].includes(p.source) && ["want_to_go", "saved", "visited"].includes(p.status) && typeof p.isSaved === "boolean" && strings(p.tags) &&
    (p.customGuideNames === undefined || strings(p.customGuideNames)) && (p.guideCategories === undefined || strings(p.guideCategories) && p.guideCategories.every(c => categories.includes(c))) &&
    (p.calendarEventIds === undefined || strings(p.calendarEventIds)) &&
    !!p.externalLinks && typeof p.externalLinks === "object" && !Array.isArray(p.externalLinks) && Object.values(p.externalLinks).every(url => {
      if (typeof url !== "string" || url.length > 4000) return false;
      try { const u = new URL(url); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
    });
}

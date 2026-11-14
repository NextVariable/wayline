import type { Place, PlaceCategory } from "../types/place";

// Map symbols describe the place, rather than the action used to save it.
const symbols: Record<PlaceCategory, string> = {
  food: '<path d="M5 3v7m3-7v7M5 7h3M6.5 10v11M17 3c-3 3-3 8 0 8h2M19 3v18"/>',
  business: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M10 21v-5h4v5"/>',
  university: '<path d="m2 9 10-5 10 5-10 5-10-5Zm4 3v5c4 3 8 3 12 0v-5M22 9v7"/>',
  transport: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 10h14M9 18l-2 3m8-3 2 3M9 14h.01M15 14h.01M12 3v7"/>',
  shopping: '<path d="M5 8h14l1 13H4L5 8Zm3 0V6a4 4 0 0 1 8 0v2"/>',
  attraction: '<path d="M5 21V3m0 1h14l-3 5 3 5H5"/>',
  custom: '<circle cx="12" cy="12" r="3"/>',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Both map providers share small, escaped markers without a server-rendering runtime. */
export function renderPlacePinHTML(
  place: Place,
  selected: boolean,
  mode: "young" | "business",
  routeIndex = -1,
): string {
  const schedule = place.tags.includes("日程助手");
  // Calendar places get their own square bubble, so they are told apart by shape and not only by colour.
  const calendar = !schedule && place.tags.includes("日程");
  const classes = [
    "whereto-pin",
    selected ? "is-selected" : "",
    place.type === "user" ? "is-user" : "is-system",
    mode === "business" ? "is-business" : "",
    schedule ? "is-schedule" : "",
    calendar ? "is-calendar" : "",
    routeIndex >= 0 ? "is-route" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const symbol =
    routeIndex >= 0
      ? `<span class="pin-sequence">${routeIndex + 1}</span>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${schedule || calendar ? '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4m8-4v4M4 10h16"/>' : symbols[place.category] || symbols.custom}</svg>`;
  const match = place.distanceText.match(
    /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/,
  );
  const time = match
    ? `${Number(match[2])}/${Number(match[3])} ${match[4]}`
    : place.distanceText;
  const label = schedule
    ? `<span class="schedule-label-time">${escapeHtml(time)}</span><span>${escapeHtml(place.name)}</span>`
    : escapeHtml(place.name);
  return `<div class="${classes}"><span class="pin-bubble">${symbol}</span><span class="pin-label${schedule ? " schedule-label" : ""}">${label}</span></div>`;
}

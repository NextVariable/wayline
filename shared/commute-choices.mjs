const modes = new Set(['driving', 'walking', 'transit']);

export function commuteKey(from, to) {
  return JSON.stringify([from, to].map(place => [place.id ?? null, place.name, place.lat, place.lng]));
}

export function activeCommuteChoices(choices, places) {
  if (!choices || typeof choices !== 'object' || Array.isArray(choices)) return {};
  const result = {};
  for (let i = 1; i < places.length; i++) {
    const key = commuteKey(places[i-1], places[i]);
    if (modes.has(choices[key])) result[key] = choices[key];
  }
  return result;
}

export function commuteDeparture(brief, place) {
  const events = brief.events.filter(event => event.place === place.name);
  // The engine stores one duration per directional edge. Repeated events at
  // different times cannot safely share a time-dependent transit estimate.
  const ends = new Set(events.map(event => event.end));
  const end = [...ends][0];
  return ends.size === 1 && end && Number.isFinite(Date.parse(end)) ? end : undefined;
}

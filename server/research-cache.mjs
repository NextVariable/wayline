/** Bounded, short-lived provider evidence. Failures are never cached. */
export function cacheTravelServices(services, { now = Date.now, ttl = 600000, limit = 150, persistent } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const cached = async (kind, input, run, lifetime=ttl) => {
    const key = kind + JSON.stringify(input);
    const hit = cache.get(key);
    if (hit && now() >= hit.time && now() - hit.time < lifetime) return hit.value;
    if (inFlight.has(key)) return inFlight.get(key);
    const pending=(async()=>{
      const value=await (persistent?persistent.lookup(key,run,{kind,ttl:lifetime}):run());
      if (value && value.status !== 'unavailable' && value.availability !== 'unknown' && (!Array.isArray(value.candidates)||value.candidates.length>0)) {
        cache.delete(key); cache.set(key, { time: now(), value });
        while (cache.size > limit) cache.delete(cache.keys().next().value);
      }
      return value;
    })();
    inFlight.set(key,pending);
    try { return await pending; } finally { if(inFlight.get(key)===pending)inFlight.delete(key); }
  };
  return { ...services,
    ...(services.route ? {route: input => cached('route', [input.mode || 'driving', input.departure || null, input.city || null, input.cityd || null, input.places.map(p => [p.id, p.name, p.city, p.citycode, p.lat, p.lng])], () => services.route(input))}:{}),
    ...(services.findHotels ? { findHotels: input => cached('hotels', [input.place.name, input.place.lat, input.place.lng,input.keywords||null], () => services.findHotels(input)) } : {}),
    ...(services.findStations ? {findStations:input=>cached('stations',[input.city],()=>services.findStations(input))}:{}),
    ...(services.resolvePlace ? {resolvePlace:input=>cached('identity',[input.name,input.city],()=>services.resolvePlace(input))}:{}),
    ...(services.hotelOffer ? {hotelOffer:input=>cached('hotelOffer',[input.hotel.id,input.hotel.supplierId,input.hotel.name,input.checkIn,input.checkOut,input.travelers,input.rooms,input.roomType,input.freeCancellationRequired===true],()=>services.hotelOffer(input),120000)}:{}),
    ...(services.findTrains ? {findTrains:input=>cached('rail',[input.origin,input.destination,input.date,input.earliestDeparture,input.latestArrival],()=>services.findTrains(input),120000)}:{}),
  };
}

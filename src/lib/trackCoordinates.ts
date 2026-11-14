/** Local WGS84/GCJ02 display transform. Adapted from wandergis/coordtransform (MIT).
 * Copyright (c) 2015 记忆的残骸. See THIRD_PARTY_NOTICES.md.
 * Original coordinates always remain WGS84 in storage and backups.
 */
export function wgsToGcj(lng: number, lat: number): [number, number] {
  if (lng <= 73.66 || lng >= 135.05 || lat <= 3.86 || lat >= 53.55)
    return [lng, lat];
  const x = lng - 105,
    y = lat - 35,
    p = Math.PI;
  const common =
    ((20 * Math.sin(6 * x * p) + 20 * Math.sin(2 * x * p)) * 2) / 3;
  let dy =
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x)) +
    common;
  dy += ((20 * Math.sin(y * p) + 40 * Math.sin((y * p) / 3)) * 2) / 3;
  dy += ((160 * Math.sin((y * p) / 12) + 320 * Math.sin((y * p) / 30)) * 2) / 3;
  let dx =
    300 +
    x +
    2 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x)) +
    common;
  dx += ((20 * Math.sin(x * p) + 40 * Math.sin((x * p) / 3)) * 2) / 3;
  dx += ((150 * Math.sin((x * p) / 12) + 300 * Math.sin((x * p) / 30)) * 2) / 3;
  const radians = (lat * p) / 180,
    magic = 1 - 0.006693421622965943 * Math.sin(radians) ** 2;
  return [
    lng + (dx * 180) / ((6378245 / Math.sqrt(magic)) * Math.cos(radians) * p),
    lat +
      (dy * 180) /
        (((6378245 * (1 - 0.006693421622965943)) / (magic * Math.sqrt(magic))) *
          p),
  ];
}
export function gcjToWgs(lng: number, lat: number): [number, number] {
  let x = lng,
    y = lat;
  for (let i = 0; i < 3; i++) {
    const shifted = wgsToGcj(x, y);
    x -= shifted[0] - lng;
    y -= shifted[1] - lat;
  }
  return [x, y];
}

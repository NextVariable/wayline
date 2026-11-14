import { validDate, type FootprintData, type TrackPoint } from "./footprints";
/** Import timed track points only. No interpolation or invented location history. */
export async function parseGpxFootprints(text: string): Promise<FootprintData> {
  if (text.length > 20_000_000) throw new Error("轨迹文件超过20MB");
  if (!/<(?:\w+:)?gpx\b/i.test(text) || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("不是受支持的GPX轨迹文件");
  const points: TrackPoint[] = [];
  const segments = [...text.matchAll(/<(?:\w+:)?trkseg\b[^>]*>([\s\S]*?)<\/(?:\w+:)?trkseg>/gi)];
  if (!segments.length) throw new Error("文件中没有轨迹段");
  for (let segment = 0; segment < segments.length; segment++) {
    const originalCount = (segments[segment][1].match(/<(?:\w+:)?trkpt\b/gi) || []).length;
    let parsedCount = 0;
    for (const match of segments[segment][1].matchAll(/<(?:\w+:)?trkpt\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?trkpt>/gi)) {
      parsedCount++;
      const get = (key: string) => match[1].match(new RegExp(`\\b${key}\\s*=\\s*["']([^"']+)["']`,"i"))?.[1];
      const lat = Number(get("lat")), lng = Number(get("lon"));
      const stamp = match[2].match(/<(?:\w+:)?time\b[^>]*>([^<]+)<\/(?:\w+:)?time>/i)?.[1]?.trim();
      if (get("lat") === undefined || get("lon") === undefined || !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) throw new Error("轨迹含有无效坐标");
      if (!stamp || !validDate(stamp.slice(0,10)) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(stamp) || !Number.isFinite(Date.parse(stamp))) throw new Error("请导出包含时间与时区的GPX轨迹，不能推测实际经过时间");
      const time = Date.parse(stamp);
      if (time < 0) throw new Error("轨迹时间不受支持");
      if (points.length && time <= points.at(-1)!.time) throw new Error("轨迹时间重复或倒序，请先检查原文件");
      if (points.length >= 100000) throw new Error("轨迹最多包含10万个定位点");
      // GPX does not guarantee accuracy metadata. Use the conservative upper bound, never imply a precise fix.
      points.push({lat,lng,time,segment,accuracy:150});
    }
    if (parsedCount !== originalCount) throw new Error("轨迹点不完整，未导入任何记录");
  }
  if (!points.length) throw new Error("文件中没有带时间的轨迹点");
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  const id = "gpx:" + [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2,"0")).join("");
  const rawName = text.match(/<(?:\w+:)?name\b[^>]*>([^<]{1,200})<\/(?:\w+:)?name>/i)?.[1];
  const name = rawName ? rawName.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">") : "导入的路线";
  return {tracks:[{id,name,startedAt:points[0].time,endedAt:points.at(-1)!.time,status:"completed",coordinateSystem:"WGS84",source:"backup",points,gaps:[]}],visits:[]};
}

import { describe, expect, it } from "vitest";
import { parseGpxFootprints } from "../lib/gpxImport";
import { exportFootprints, parseFootprints, trackSegments } from "../lib/footprints";
const point = (time:string,lat="31",lng="121") => `<trkpt lat="${lat}" lon="${lng}"><time>${time}</time></trkpt>`;
const gpx = (points:string) => `<gpx><trk><name>测试路线</name><trkseg>${points}</trkseg></trk></gpx>`;
describe("actual GPX history", () => {
  it("preserves real coordinates, time, segments, stable import identity and backup compatibility", async () => {
    const text = gpx(point("2026-10-27T10:00:00Z") + point("2026-10-27T10:01:00Z","31.001"));
    const data = await parseGpxFootprints(text);
    expect(data.tracks[0].points[0]).toMatchObject({lat:31,lng:121,time:Date.parse("2026-10-27T10:00:00Z")});
    expect((await parseGpxFootprints(text)).tracks[0].id).toBe(data.tracks[0].id);
    expect(parseFootprints(exportFootprints(data)).tracks[0].points).toEqual(data.tracks[0].points);
  });
  it("does not draw a fake connection across separate track segments", async () => {
    const text = `<gpx><trk><trkseg>${point("2026-10-27T10:00:00Z")}</trkseg><trkseg>${point("2026-10-27T12:00:00Z","32")}</trkseg></trk></gpx>`;
    expect(trackSegments((await parseGpxFootprints(text)).tracks[0].points)).toHaveLength(2);
  });
  it.each(["<trkpt lat='31' lon='121'></trkpt>",point("2026-10-27T10:00:00"),point("2026-10-27T10:00:00Z","99"),point("2026-10-27T10:00:00Z")+point("2026-10-27T09:00:00Z")])("rejects invented, invalid or unordered track data",async text => {await expect(parseGpxFootprints(gpx(text))).rejects.toThrow();});
  it("rejects external XML entities",async()=> {await expect(parseGpxFootprints('<!DOCTYPE gpx SYSTEM "file:///etc/passwd">'+gpx(point("2026-10-27T10:00:00Z")))).rejects.toThrow();});
});

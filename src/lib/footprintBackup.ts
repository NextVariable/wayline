import {
  exportFootprints,
  parseFootprints,
  type FootprintData,
  type FootprintTrack,
} from "./footprints";

/** A fresh device track replaces an older restored copy with the same stable ID. */
export function mergeFootprintTracks(
  saved: FootprintTrack[],
  device: FootprintTrack[],
) {
  return [
    ...new Map(
      [...saved, ...device].map((track) => [track.id, track]),
    ).values(),
  ];
}
export function completeFootprintBackup(
  data: FootprintData,
  device: FootprintTrack[],
) {
  const text = exportFootprints({
    tracks: mergeFootprintTracks(data.tracks, device),
    visits: data.visits,
  });
  parseFootprints(text); // Never hand out a backup that the importer cannot restore.
  return text;
}

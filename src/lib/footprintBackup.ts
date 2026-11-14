import {
  exportFootprints,
  parseFootprints,
  type FootprintData,
} from "./footprints";

/** Exports a backup with unique track IDs, and refuses one the importer cannot restore. */
export function completeFootprintBackup(data: FootprintData) {
  const text = exportFootprints({
    tracks: [...new Map(data.tracks.map((track) => [track.id, track])).values()],
    visits: data.visits,
  });
  parseFootprints(text); // Never hand out a backup that the importer cannot restore.
  return text;
}

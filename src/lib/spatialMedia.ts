export const spatialMedia = {
  compact: "(max-width: 760px), (pointer: coarse)",
  reduced: "(prefers-reduced-motion: reduce)",
};

export const isDesktopShowcase = typeof window !== "undefined" &&
  /^\/showcase\/?$/.test(window.location?.pathname ?? "") &&
  !window.matchMedia?.(spatialMedia.compact).matches;

/** Device pixel ratio measured on the physical Galaxy Z Fold 8 (non-Ultra). */
export const FOLD8_DPR = 2.625;

export const FOLD8_UNFOLDED_PORTRAIT = Object.freeze({
  name: "unfolded-portrait",
  width: 704,
  height: 783,
});

export const FOLD8_UNFOLDED_LANDSCAPE = Object.freeze({
  name: "unfolded-landscape",
  width: 932,
  height: 553,
});

export const FOLD8_FOLDED_PORTRAIT = Object.freeze({
  name: "folded-portrait",
  width: 475,
  height: 638,
});

export const FOLD8_FOLDED_LANDSCAPE = Object.freeze({
  name: "folded-landscape",
  width: 711,
  height: 374,
});

/** Acceptance order: unfolded orientations first, then folded orientations. */
export const FOLD8_POSTURES = Object.freeze([
  FOLD8_UNFOLDED_PORTRAIT,
  FOLD8_UNFOLDED_LANDSCAPE,
  FOLD8_FOLDED_PORTRAIT,
  FOLD8_FOLDED_LANDSCAPE,
]);

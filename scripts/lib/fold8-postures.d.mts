export interface Fold8Posture {
  readonly name: "unfolded-portrait" | "unfolded-landscape" | "folded-portrait" | "folded-landscape";
  readonly width: number;
  readonly height: number;
}

export const FOLD8_DPR: 2.625;
export const FOLD8_UNFOLDED_PORTRAIT: Readonly<Fold8Posture>;
export const FOLD8_UNFOLDED_LANDSCAPE: Readonly<Fold8Posture>;
export const FOLD8_FOLDED_PORTRAIT: Readonly<Fold8Posture>;
export const FOLD8_FOLDED_LANDSCAPE: Readonly<Fold8Posture>;
export const FOLD8_POSTURES: readonly Readonly<Fold8Posture>[];

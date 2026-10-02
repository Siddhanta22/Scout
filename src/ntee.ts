// ProPublica filters search by NTEE "major group" ids 1-10. Cause areas are
// derived from the first letter of the NTEE code (null when the IRS has none).
export const CAUSE_AREAS: Record<number, string> = {
  1: "Arts, Culture & Humanities",
  2: "Education",
  3: "Environment & Animals",
  4: "Health",
  5: "Human Services",
  6: "International",
  7: "Public & Societal Benefit",
  8: "Religion",
  9: "Mutual & Membership Benefit",
  10: "Unknown",
};

const LETTER_TO_GROUP: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 3,
  E: 4,
  F: 4,
  G: 4,
  H: 4,
  I: 5,
  J: 5,
  K: 5,
  L: 5,
  M: 5,
  N: 5,
  O: 5,
  P: 5,
  Q: 6,
  R: 7,
  S: 7,
  T: 7,
  U: 7,
  V: 7,
  W: 7,
  X: 8,
  Y: 9,
  Z: 10,
};

export function causeAreaFor(nteeCode: string | null | undefined): string | null {
  if (!nteeCode) return null;
  const group = LETTER_TO_GROUP[nteeCode[0].toUpperCase()];
  return group ? CAUSE_AREAS[group] : null;
}

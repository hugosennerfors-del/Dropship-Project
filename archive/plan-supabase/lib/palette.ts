/**
 * Diagrampalett. Validerad för färgblindhet mot ljus yta:
 * värsta intilliggande par ΔE 9,2 (deutan) och 27,6 (normalseende) — båda över golvet.
 * Aqua ligger under 3:1 kontrast, därför har varje diagram synliga direktetiketter.
 *
 * Statusfärgerna är reserverade. De används ALDRIG som serie­färg.
 */
export const SERIES = {
  s1: "#2a78d6", // blå   — vinst, primär serie
  s2: "#eb6834", // orange— annonskostnad
  s3: "#1baf7a", // aqua  — bidrag
} as const;

export const CHART = {
  surface: "#fcfcfb",
  grid: "#ecebe7",
  ink: "#0b0b0b",
  ink2: "#52514e",
  muted: "#c5c4be",
} as const;

export const STATUS = {
  good: "#1a7f5a",
  warning: "#b7791f",
  critical: "#b4452f",
} as const;

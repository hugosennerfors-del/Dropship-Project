// Provenance: every value in the database says how much it can be trusted.
//
//   V  Verified           observed directly in a primary source (a register,
//                          a court record, the user's own sales) or entered
//                          by the user with a source.
//   E  Estimated          derived from data: a formula over other values, or
//                          a figure reported by a secondary source.
//   A  AI estimated       a model's judgement with no direct data behind it.
//   N  Insufficient data  nothing reliable is known.
//
// A field value is stored as { v, s, src?, note? }. `src` lists evidence ids
// (ev:...) or a short method label. The UI shows the status next to every
// number, and the confidence score is computed from these statuses.

export const STATUS = {
  V: { code: "V", label: "Verified", short: "Verified", rank: 4 },
  E: { code: "E", label: "Estimated", short: "Estimated", rank: 3 },
  A: { code: "A", label: "AI estimated", short: "AI est.", rank: 2 },
  N: { code: "N", label: "Insufficient data", short: "No data", rank: 1 },
};

// How much a value of each kind is worth when computing data confidence.
// Estimated values are graded by the evidence level of their source.
export const QUALITY = {
  V: 1,
  E_A: 0.85,
  E_B: 0.75,
  E_C: 0.6,
  E_D: 0.45,
  E_E: 0.35,
  E_model: 0.5,
  A: 0.25,
  N: 0,
};

export const EVIDENCE_LEVELS = {
  A: "Primary: register, regulator, court, official statistics, own data",
  B: "Industry data with stated method",
  C: "Modelled estimate tool or company self-report",
  D: "Trade media, vendor blog, product test",
  E: "Single claim without traceable method",
};

export function val(v, s = "A", src, note) {
  const out = { v, s };
  if (src) out.src = Array.isArray(src) ? src : [src];
  if (note) out.note = note;
  return out;
}

export const none = (note) => ({ v: null, s: "N", ...(note ? { note } : {}) });

export function isVal(x) {
  return x && typeof x === "object" && "s" in x && "v" in x;
}

export function v(x) {
  return isVal(x) ? x.v : x;
}

export function known(x) {
  return isVal(x) ? x.s !== "N" && x.v != null : x != null;
}

// The weakest status among inputs, used when a value is derived from several.
export function weakest(...xs) {
  let worst = "V";
  for (const x of xs) {
    const s = isVal(x) ? x.s : "V";
    if (STATUS[s].rank < STATUS[worst].rank) worst = s;
  }
  return worst;
}

// Status for a value computed from inputs: a formula over verified data is
// still an estimate; over AI estimates it stays an AI estimate.
export function derivedStatus(...xs) {
  const w = weakest(...xs);
  if (w === "N") return "N";
  if (w === "A") return "A";
  return "E";
}

export function quality(x, evidenceIndex) {
  if (!isVal(x)) return QUALITY.N;
  if (x.s === "V") return QUALITY.V;
  if (x.s === "A") return QUALITY.A;
  if (x.s === "N") return QUALITY.N;
  // Estimated: grade by the best evidence level cited.
  const levels = (x.src || [])
    .map((id) => (evidenceIndex && evidenceIndex[id] ? evidenceIndex[id].level : null))
    .filter(Boolean)
    .sort();
  if (levels.length) return QUALITY["E_" + levels[0]] ?? QUALITY.E_model;
  return QUALITY.E_model;
}

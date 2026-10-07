// Authoring helpers for the AI-analysis layer.
//
//   A(v, note)        AI estimated: the analyst's judgement, no direct data
//   E(v, src, note)   Estimated from evidence (src = evidence ids)
//   V(v, src, note)   Verified: observed in a primary source or own data
//   N(note)           Insufficient data
//
// Scores are 0–100. Competition, saturation and every *Risk / *Difficulty
// field is "higher = worse". Money is in the market's currency, incl. VAT
// for consumer prices. Supplier prices are in USD.

import { val, none } from "../../src/core/provenance.js";

export const A = (v, note) => val(v, "A", null, note);
export const E = (v, src, note) => val(v, "E", src, note);
export const V = (v, src, note) => val(v, "V", src, note);
export const N = (note) => none(note);

// Shorthand for the many 0–100 marketing judgements.
export function marketing({ social, tiktok, instagram, meta, google, seo, organic, influencer, ugc }, note) {
  const out = {};
  for (const [k, x] of Object.entries({ social, tiktok, instagram, meta, google, seo, organic, influencer, ugc })) {
    if (x != null) out[k] = A(x, note);
  }
  return out;
}

export const UNCONNECTED = "No marketplace data connected yet.";

// Stage 3 — economics and scores, per product and market.
//
// The same core modules run in the page, so the numbers in the database
// export and on screen come from one implementation.

import { buildProduct, rowOf } from "../../src/core/profile.js";

export function scoreAll({ products, evidenceIndex }, settings) {
  const built = products.map((p) => buildProduct(p, evidenceIndex, settings));
  const rows = [];
  const scores = {};
  for (const b of built) {
    scores[b.id] = {};
    for (const [code, m] of Object.entries(b.built)) {
      const row = rowOf(b, code);
      rows.push(row);
      const d = m.scored._detail;
      scores[b.id][code] = {
        opportunity: m.scored.opportunity, evidenceWeighted: m.scored.evidenceWeighted, confidence: m.scored.confidence,
        risk: m.scored.risk, stage: m.scored.stage, stageWhy: d.stage.why,
        components: d.components, base: d.base, interactions: d.interactions, riskFactor: d.riskFactor,
        caps: d.caps, cap: d.cap, redFlags: d.redFlags, validation: {
          commercial: d.validation.commercial.grade, interest: d.validation.interest.grade, notes: d.validation.notes,
        },
        confidenceMix: d.confidence.mix, why: m.why,
      };
    }
  }
  return { built, rows, scores };
}

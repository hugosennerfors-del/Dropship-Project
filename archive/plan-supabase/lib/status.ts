import type { Metrics } from "./types";

export type Verdict = "SKALA" | "OPTIMERA" | "PAUSA" | "TESTA";

export interface Thresholds {
  scalePoas: number;          // 1.60 — grönt över
  optimizePoas: number;       // 1.15 — gult över, rött under
  minOrdersForVerdict: number;// 15 — färre order = för lite data
  maxReturnRate: number;      // 0.25
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  scalePoas: 1.6,
  optimizePoas: 1.15,
  minOrdersForVerdict: 15,
  maxReturnRate: 0.25,
};

export interface StatusResult {
  verdict: Verdict;
  color: "green" | "amber" | "red" | "grey";
  reason: string;
  /** Hur mycket CPA får stiga innan produkten faller ur grönt. */
  cpaHeadroom: number;
}

/**
 * Ampeln bygger på POAS, inte ROAS.
 *
 * ROAS-tröskeln är olika för varje produkt eftersom den beror på marginalen,
 * så "ROAS 2,4" betyder utmärkt för en produkt och förlust för en annan.
 * POAS är bruttovinst delat på annonskostnad: break-even är alltid exakt 1,00,
 * och då går produkter att jämföra rakt av i samma kolumn.
 */
export function productStatus(
  m: Metrics,
  orders: number,
  returnRate: number,
  t: Thresholds = DEFAULT_THRESHOLDS,
): StatusResult {
  const cpaHeadroom = m.contributionPerOrder / t.scalePoas - m.cpa;

  if (orders < t.minOrdersForVerdict) {
    return {
      verdict: "TESTA",
      color: "grey",
      reason: `Bara ${orders} order. Under ${t.minOrdersForVerdict} är utfallet brus, inte signal.`,
      cpaHeadroom,
    };
  }

  if (m.adSpend === 0) {
    return {
      verdict: "TESTA",
      color: "grey",
      reason: "Ingen annonskostnad registrerad. Kontrollera kampanjmappningen.",
      cpaHeadroom,
    };
  }

  if (returnRate > t.maxReturnRate) {
    return {
      verdict: "OPTIMERA",
      color: "amber",
      reason:
        `Returgrad ${(returnRate * 100).toFixed(0)} % över taket ${(t.maxReturnRate * 100).toFixed(0)} %. ` +
        `POAS ${m.poas.toFixed(2)} är på pappret ${m.poas >= t.scalePoas ? "bra" : "svagt"}, ` +
        `men returerna äter upp det. Fixa storleksguide eller produktsida före skalning.`,
      cpaHeadroom,
    };
  }

  if (m.poas >= t.scalePoas) {
    return {
      verdict: "SKALA",
      color: "green",
      reason:
        `POAS ${m.poas.toFixed(2)} (mål ${t.scalePoas.toFixed(2)}). ` +
        `CPA ${m.cpa.toFixed(0)} kr mot bidrag ${m.contributionPerOrder.toFixed(0)} kr. ` +
        `Tål ${cpaHeadroom.toFixed(0)} kr högre CPA innan den faller ur grönt.`,
      cpaHeadroom,
    };
  }

  if (m.poas >= t.optimizePoas) {
    return {
      verdict: "OPTIMERA",
      color: "amber",
      reason:
        `POAS ${m.poas.toFixed(2)} — över break-even men under ${t.scalePoas.toFixed(2)}. ` +
        `Sänk CPA med ${Math.abs(cpaHeadroom).toFixed(0)} kr eller höj AOV innan du ökar budget.`,
      cpaHeadroom,
    };
  }

  return {
    verdict: "PAUSA",
    color: "red",
    reason:
      `POAS ${m.poas.toFixed(2)} — ${m.poas < 1 ? "under break-even, varje order kostar pengar" : "för tunt för att bära fasta kostnader"}. ` +
      `CPA ${m.cpa.toFixed(0)} kr mot bidrag ${m.contributionPerOrder.toFixed(0)} kr.`,
    cpaHeadroom,
  };
}

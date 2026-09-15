import type { Candidate } from "./types";

/**
 * Chansscore för research-kandidater.
 *
 * Varför inte bara sortera på expectedPoas? För att alla kandidatsiffror är
 * AI-gissningar. 1,23 är inte säkrare än 1,21, och en sortering på den kolumnen
 * ensam låtsas om en precision som inte finns.
 *
 * Fyra axlar som mäter olika saker. CPA-tolerans är medvetet INTE en egen axel:
 * POAS faller till 1,00 exakt när CPA stigit med (expectedPoas − 1), så den är
 * redan inbakad i axel 1. Att poängsätta den separat vore dubbelräkning.
 */

const VAT = 0.25;

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const band = (v: number, low: number, high: number) => clamp(((v - low) / (high - low)) * 100);

export const WEIGHTS = { profit: 0.35, margin: 0.25, cpaRealism: 0.25, buffer: 0.15 } as const;

/**
 * Vad Meta faktiskt kostar per order i Sverige på kall trafik, fysisk produkt.
 * Under ~80 kr inkl moms händer det sällan; 150 kr och uppåt är vanligt.
 * Banden används för att bedöma om en ANTAGEN CPA är trovärdig.
 */
export const CPA_OPTIMISTIC_INCL = 60;
export const CPA_CONSERVATIVE_INCL = 160;

export interface Axis {
  key: "profit" | "margin" | "cpaRealism" | "buffer";
  label: string;
  value: number;
  weight: number;
  note: string;
}

export interface StressPoint {
  /** Hur mycket CPA:n höjts mot gissningen, 0.25 = +25 %. */
  bump: number;
  poas: number;
  netPerOrder: number;
  survives: boolean;
}

export interface SuccessResult {
  score: number;
  label: string;
  axes: Axis[];
  stress: StressPoint[];
  /** Hur mycket CPA får stiga innan ordern går back, som andel. */
  cpaHeadroom: number;
  strongest: Axis;
  weakest: Axis;
}

const cpaExOf = (c: Candidate) => c.inputs.expectedCpaInclVat / (1 + VAT);

/** POAS om CPA blir `bump` högre än gissat. */
export function poasAtBump(c: Candidate, bump: number): number {
  const cpa = cpaExOf(c) * (1 + bump);
  return cpa > 0 ? c.calc.contributionPerOrder / cpa : 0;
}

export function successScore(c: Candidate): SuccessResult {
  const { contributionPerOrder: contrib, grossMargin, expectedPoas } = c.calc;
  const assumedCpaIncl = c.inputs.expectedCpaInclVat;

  // 1. Förväntad lönsamhet. Break-even 1,00, full pott vid 1,50.
  const profit = band(expectedPoas, 1.0, 1.5);

  // 2. Marginal. Buffert mot fel i inköpspris och utpris — inte mot fel i CPA.
  const margin = band(grossMargin, 0.3, 0.6);

  // 3. CPA-realism. Den kontraintuitiva axeln: en LÅGT gissad CPA är sämre, inte
  //    bättre. Hela kalkylen vilar på det talet, och ligger det under vad Meta
  //    faktiskt kostar i Sverige är expectedPoas byggd på en förhoppning.
  const cpaRealism = band(assumedCpaIncl, CPA_OPTIMISTIC_INCL, CPA_CONSERVATIVE_INCL);

  // 4. Bidrag i kronor. Ett bidrag på 50 kr tål inget fel alls, oavsett kvot.
  const buffer = band(contrib, 40, 200);

  const axes: Axis[] = [
    {
      key: "profit", label: "Förväntad lönsamhet", value: profit, weight: WEIGHTS.profit,
      note: `Förväntad POAS ${expectedPoas.toFixed(2)} mot break-even 1,00.`,
    },
    {
      key: "margin", label: "Marginal", value: margin, weight: WEIGHTS.margin,
      note: `Bruttomarginal ${(grossMargin * 100).toFixed(0)} % — buffert mot fel i inköps- och utpris.`,
    },
    {
      key: "cpaRealism", label: "CPA-realism", value: cpaRealism, weight: WEIGHTS.cpaRealism,
      note: `Kalkylen antar ${Math.round(assumedCpaIncl)} kr per order. Lågt antagande sänker betyget: hela utfallet hänger på det talet.`,
    },
    {
      key: "buffer", label: "Bidrag per order", value: buffer, weight: WEIGHTS.buffer,
      note: `${Math.round(contrib)} kr ex moms att betala annonsen med.`,
    },
  ];

  const score = Math.round(axes.reduce((a, x) => a + x.value * x.weight, 0));

  const stress: StressPoint[] = [0, 0.25, 0.5].map((bump) => {
    const poas = poasAtBump(c, bump);
    return {
      bump,
      poas,
      netPerOrder: contrib - cpaExOf(c) * (1 + bump),
      survives: poas >= 1,
    };
  });

  const sorted = [...axes].sort((a, b) => a.value - b.value);

  return {
    score,
    label: score >= 70 ? "Stark" : score >= 50 ? "Rimlig" : score >= 30 ? "Svag" : "Undvik",
    axes,
    stress,
    cpaHeadroom: expectedPoas - 1,
    weakest: sorted[0],
    strongest: sorted[sorted.length - 1],
  };
}

/**
 * Rangordnar kandidater. Kandidater som inte bär sin egen annonskostnad ens på
 * gissade siffror sorteras alltid sist, oavsett score — de är inte ett vad med
 * dåliga odds, de är ett vad med negativa odds.
 */
export function rankCandidates(list: Candidate[]): { candidate: Candidate; result: SuccessResult }[] {
  return list
    .map((candidate) => ({ candidate, result: successScore(candidate) }))
    .sort((a, b) => {
      const aViable = a.candidate.calc.expectedPoas >= 1 && a.candidate.calc.contributionPerOrder > 0;
      const bViable = b.candidate.calc.expectedPoas >= 1 && b.candidate.calc.contributionPerOrder > 0;
      if (aViable !== bViable) return aViable ? -1 : 1;
      return b.result.score - a.result.score;
    });
}

/* ── Verklighetskoll mot dina egna liveprodukter ────────────────────────── */

export interface RealityCheck {
  /** Antagen CPA omräknad till ex moms, jämförbar med produkternas CAC. */
  assumedCpaEx: number;
  observedCacLow: number | null;
  observedCacHigh: number | null;
  observedMarginLow: number | null;
  observedMarginHigh: number | null;
  /** Sant när kandidaten antar en billigare order än något du faktiskt uppnått. */
  cpaBelowAnythingAchieved: boolean;
  /** Antagen marginal över allt du faktiskt haft. */
  marginAboveAnythingAchieved: boolean;
  basis: number;
}

/**
 * Ställer kandidatens antaganden mot vad dina liveprodukter faktiskt presterar.
 *
 * ENHETER: produkternas cac är ex moms (ad_spend räknas rakt mot bruttovinsten
 * i POAS), kandidatens expectedCpaInclVat är inkl moms. De måste räknas om
 * innan de jämförs — annars ser varje kandidat 25 % dyrare ut än den är.
 */
export function realityCheck(c: Candidate, products: { financials: { cac: number; adSpend: number; grossMargin: number } }[]): RealityCheck {
  const live = products.filter((p) => p.financials.adSpend > 0 && p.financials.cac > 0);
  const cacs = live.map((p) => p.financials.cac);
  const margins = live.map((p) => p.financials.grossMargin);
  const assumedCpaEx = c.inputs.expectedCpaInclVat / (1 + VAT);

  const low = cacs.length ? Math.min(...cacs) : null;
  const high = cacs.length ? Math.max(...cacs) : null;
  const mLow = margins.length ? Math.min(...margins) : null;
  const mHigh = margins.length ? Math.max(...margins) : null;

  return {
    assumedCpaEx,
    observedCacLow: low,
    observedCacHigh: high,
    observedMarginLow: mLow,
    observedMarginHigh: mHigh,
    cpaBelowAnythingAchieved: low != null && assumedCpaEx < low,
    marginAboveAnythingAchieved: mHigh != null && c.calc.grossMargin > mHigh,
    basis: live.length,
  };
}

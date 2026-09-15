/**
 * Typer för Plan-vy Intelligence-API:t.
 *
 * VIKTIGT — dessa typer är skrivna mot vad n8n-backenden FAKTISKT skickar
 * (workflow "Plan-vy · Intelligence-API", nod "Bygg datalager"/"Slå ihop svar"),
 * inte mot den förenklade spec som cirkulerat. Fyra skillnader som spelar roll:
 *
 *  1. products[].status är 'scale' | 'profit' | 'watch' | 'cut'.
 *     Backend: poas>=1.5 -> 'scale', >=1 -> 'profit', >=0.8 -> 'watch', annars 'cut'.
 *     Värdet 'winner' skickas ALDRIG. En uppslagstabell på 'winner' ger tom pill.
 *  2. sku och campaign kan vara null (backend gör `r.sku || null`).
 *     sku används i produktsidans URL — därför får en produkt utan sku
 *     aldrig länkas. Se productHref().
 *  3. breakEvenRoas är null när bruttomarginalen <= 0 (division skulle spräcka).
 *  4. Hela ai-blocket är nullbart per fält (backend gör `a.verdict || null`).
 *
 * Allt som kan vara null är typat som null här. Det är avsiktligt: det tvingar
 * varje komponent att rendera ett tomt läge i stället för att skriva ut "null".
 */

export type Origin = "real" | "computed" | "ai-generated" | "ai-estimated";

export type InsightLink = {
  label: string;
  href: string;
  kind: "product" | "research" | "none";
};

/** Backendens fyra faktiska värden. 'winner' finns inte — se filhuvudet. */
export type ProductStatus = "scale" | "profit" | "watch" | "cut";

export type Trend = "up" | "down" | "flat" | "unknown";

export type Verdict = "SATSA" | "TESTA" | "UNDVIK";

export interface DataSource {
  key: string;
  label: string;
  origin: Origin;
  note: string;
}

export interface SourceRef {
  section: string;
  origin: Origin;
  note: string;
}

export interface DemandPoint {
  month: string;
  orders: number;
  units: number;
  revenueExVat: number;
}

export interface Demand {
  series: DemandPoint[];
  monthsOfData: number;
  momGrowth: number | null;
  trendScore: number;
  trend: Trend;
}

export interface ProductFinancials {
  revenueExVat: number;
  revenueInclVat: number;
  orders: number;
  units: number;
  aov: number;
  adSpend: number;
  cac: number;
  contribution: number;
  contributionPerOrder: number;
  netProfit: number;
  grossMargin: number;
  poas: number;
  roas: number;
  breakEvenRoas: number | null;
  returnRate: number;
}

export interface ProductAi {
  verdict: string | null;
  verdictReason: string | null;
  scoreSummary: string | null;
  customerVoice: string | null;
  competition: string | null;
  market: string | null;
  opportunities: string[];
  risks: string[];
}

export interface Product {
  name: string;
  sku: string | null;
  campaign: string | null;
  status: ProductStatus;
  financials: ProductFinancials;
  demand: Demand;
  opportunityScore: number;
  opportunityLabel: string;
  opportunityBreakdown: { profitability: number; margin: number; demand: number };
  sources: SourceRef[];
  ai: ProductAi;
}

export interface Candidate {
  id: string;
  name: string;
  source: string | null;
  supplierUrl: string | null;
  notes: string | null;
  status: string;
  createdAt: string | null;
  inputs: {
    costPerUnitInclVat: number;
    salePriceInclVat: number;
    shippingCostPerOrder: number;
    transactionFeePerOrder: number;
    expectedCpaInclVat: number;
    expectedUnitsPerOrder: number;
  };
  calc: {
    contributionPerOrder: number;
    grossMargin: number;
    breakEvenRoas: number | null;
    expectedPoas: number;
    netPerOrder: number;
  };
  verdict: Verdict;
}

export interface Alert {
  severity: "critical" | "warning";
  product: string | null;
  type: string;
  message: string;
}

export interface Opportunity {
  product: string;
  type: string;
  message: string;
}

export interface Recommendation {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
  /** Kan saknas — AI:n fyller bara i den när en produkt är relevant. */
  product?: string;
  links: InsightLink[];
}

export interface RiskItem {
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
  links: InsightLink[];
}

export interface ApiResponse {
  ok: boolean;
  /** Sant när svaret kom från snabbvägen och AI-texten ännu inte hämtats. */
  aiPending?: boolean;
  meta: {
    period: string | null;
    generatedAt: string;
    currency: string;
    vatRate: number;
    dataSources: DataSource[];
  };
  overview: {
    healthScore: number;
    healthLabel: string;
    healthBreakdown: { poas: number; margin: number; winShare: number };
    kpis: {
      revenueExVat: number;
      orders: number;
      units: number;
      aov: number;
      adSpend: number;
      contribution: number;
      netProfit: number;
      poas: number;
      roas: number;
      netMargin: number;
      contribMargin: number;
      winners: number;
      losers: number;
      productCount: number;
      candidateCount: number;
    };
  };
  products: Product[];
  candidates: Candidate[];
  alerts: Alert[];
  opportunities: Opportunity[];
  ai: {
    healthNarrative: string | null;
    recommendations: Recommendation[];
    risks: RiskItem[];
    nextActions: string[];
  };
}

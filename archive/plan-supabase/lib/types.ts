export interface Settings {
  currency: string;
  vatRate: number;          // 0.25 för svensk moms
  txnFeePct: number;        // andel av bruttobelopp inkl moms
  txnFeeFixed: number;      // fast avgift per transaktion, i valutan
  monthlyFixedCost: number; // Shopify-abb, appar, domän — slås ut per order
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  unitCost: number;            // inköp per st, ex moms
  landedAdder: number;         // frakt in + tull + EPR per st, ex moms
  price: number;               // säljpris INKL moms
  returnRate: number;          // 0–1
  returnHandlingCost: number;  // kostnad per retur (returfrakt + hantering)
  returnResaleRate: number;    // 0–1, andel returer som kan säljas igen
}

/** Aggregerade råsiffror för en produkt eller hela butiken under en period. */
export interface PeriodInput {
  grossRevenue: number;     // inkl moms, inkl fraktintäkt, efter rabatter
  grossShipping: number;    // vad kunden betalade i frakt, inkl moms
  refundedGross: number;    // inkl moms
  shippingCost: number;     // vad frakten kostade dig, ex moms
  cogs: number;             // (unitCost + landedAdder) × sålda enheter, ex moms
  txnFee: number;           // faktisk eller beräknad
  orders: number;
  units: number;
  adSpend: number;
  impressions: number;
  clicks: number;
  sessions: number;
}

export interface Metrics {
  // Intäkt
  netRevenueExVat: number;
  grossRevenueInclVat: number;
  // Kostnad
  cogs: number;
  shippingCost: number;
  txnFee: number;
  adSpend: number;
  // Resultat
  grossProfit: number;            // före annons — detta är bidraget
  contributionPerOrder: number;   // grossProfit / orders
  netProfit: number;              // efter annons och fasta kostnader
  netProfitPerOrder: number;
  // Marginal
  grossMarginPct: number;
  netMarginPct: number;
  // Annonsnyckeltal
  roas: number;
  poas: number;
  breakEvenRoas: number;
  roi: number;
  cpa: number;
  aov: number;
  cvr: number;
  cpc: number;
  ctr: number;
  cpm: number;
  // Returjusterat
  effectiveContributionPerOrder: number;
  breakEvenRoasAdjusted: number;
}

import type { Metrics, PeriodInput, Product, Settings } from "./types";

/**
 * ALLA FORMLER PÅ ETT STÄLLE.
 *
 * Tre saker som nästan alla svenska DS-dashboards får fel, och som är
 * rättade här. Läs dem innan du ändrar något i filen.
 *
 * 1. MOMS. Shopify rapporterar intäkt INKLUSIVE moms. Räknar du ROAS och
 *    marginal på det talet överskattar du båda med 25 %. All intäkt räknas
 *    om till ex moms först, en gång, i toExVat().
 *
 * 2. BIDRAG FÖRE ELLER EFTER ANNONS. Contribution margin är per definition
 *    FÖRE annonskostnad. Drar du av annonsen först och sedan räknar
 *    break-even ROAS = 1 / marginal blir det cirkulärt och fel. Här finns
 *    båda talen, med olika namn: grossProfit (före annons) och
 *    netProfit (efter annons).
 *
 * 3. RETURER. Ett bidrag på 89 EUR vid 25 % returgrad är i praktiken 63 EUR.
 *    Det finns som eget fält, effectiveContributionPerOrder.
 */

const safeDiv = (a: number, b: number): number => (b === 0 ? 0 : a / b);

/** Inkl moms -> ex moms. 1250 kr vid 25 % moms blir 1000 kr. */
export const toExVat = (inclVat: number, vatRate: number): number =>
  inclVat / (1 + vatRate);

/** Transaktionsavgift räknas på BRUTTObeloppet, alltså inkl moms. */
export const txnFeeFor = (grossInclVat: number, orders: number, s: Settings): number =>
  grossInclVat * s.txnFeePct + s.txnFeeFixed * orders;

/** Landad styckkostnad: inköp + inkommande frakt + tull + EPR. Ex moms. */
export const landedUnitCost = (p: Product): number => p.unitCost + p.landedAdder;

/**
 * Effektivt bidrag per order när returer räknas in.
 *
 *   per 100 order:  100 × C
 *                 − R × 100 × C                (förlorat bidrag på returerna)
 *                 − R × 100 × handlingCost     (returfrakt och hantering)
 *                 − R × 100 × (1 − resale) × landedCost  (osäljbara enheter)
 *
 * Dividerat med 100 order ger uttrycket nedan.
 */
export const returnAdjustedContribution = (
  contributionPerOrder: number,
  p: Pick<Product, "returnRate" | "returnHandlingCost" | "returnResaleRate" | "unitCost" | "landedAdder">,
): number => {
  const r = Math.min(Math.max(p.returnRate, 0), 1);
  const landed = p.unitCost + p.landedAdder;
  return (
    contributionPerOrder * (1 - r) -
    r * p.returnHandlingCost -
    r * (1 - p.returnResaleRate) * landed
  );
};

export function computeMetrics(i: PeriodInput, s: Settings, p?: Product): Metrics {
  // --- Intäkt, alltid ex moms -------------------------------------------
  const grossRevenueInclVat = i.grossRevenue - i.refundedGross;
  const netRevenueExVat = toExVat(grossRevenueInclVat, s.vatRate);

  // --- Kostnader, ex moms -----------------------------------------------
  const txnFee = i.txnFee || txnFeeFor(grossRevenueInclVat, i.orders, s);
  const fixedShare = s.monthlyFixedCost > 0 ? (s.monthlyFixedCost / 30) : 0;

  // --- Resultat ----------------------------------------------------------
  // Bruttovinst = bidrag FÖRE annons. Det är detta tal break-even bygger på.
  const grossProfit = netRevenueExVat - i.cogs - i.shippingCost - txnFee;
  const contributionPerOrder = safeDiv(grossProfit, i.orders);

  const netProfit = grossProfit - i.adSpend - fixedShare;
  const netProfitPerOrder = safeDiv(netProfit, i.orders);

  // --- Marginal ----------------------------------------------------------
  const grossMarginPct = safeDiv(grossProfit, netRevenueExVat);
  const netMarginPct = safeDiv(netProfit, netRevenueExVat);

  // --- Annonsnyckeltal ---------------------------------------------------
  // ROAS på intäkt EX MOMS. Metas eget ROAS räknar inkl moms och är därför
  // alltid ~25 % högre. Jämför aldrig de två talen rakt av.
  const roas = safeDiv(netRevenueExVat, i.adSpend);

  // POAS — vinst på annonskostnad. Break-even är alltid exakt 1,00 oavsett
  // produkt, vilket gör den jämförbar mellan produkter på ett sätt som
  // ROAS aldrig är.
  const poas = safeDiv(grossProfit, i.adSpend);

  // Break-even ROAS = 1 / bruttomarginal. Vid 40 % marginal: 2,50×.
  const breakEvenRoas = grossMarginPct > 0 ? 1 / grossMarginPct : Infinity;

  // ROI på annonsinvesteringen. Investeringen är annonskostnaden;
  // avkastningen är bruttovinsten den genererade.
  const roi = safeDiv(grossProfit - i.adSpend, i.adSpend);

  const cpa = safeDiv(i.adSpend, i.orders);
  const aov = safeDiv(netRevenueExVat, i.orders);
  const cvr = safeDiv(i.orders, i.sessions);
  const cpc = safeDiv(i.adSpend, i.clicks);
  const ctr = safeDiv(i.clicks, i.impressions);
  const cpm = safeDiv(i.adSpend, i.impressions) * 1000;

  // --- Returjusterat ------------------------------------------------------
  const effectiveContributionPerOrder = p
    ? returnAdjustedContribution(contributionPerOrder, p)
    : contributionPerOrder;

  const effectiveMargin = safeDiv(effectiveContributionPerOrder * i.orders, netRevenueExVat);
  const breakEvenRoasAdjusted = effectiveMargin > 0 ? 1 / effectiveMargin : Infinity;

  return {
    netRevenueExVat, grossRevenueInclVat,
    cogs: i.cogs, shippingCost: i.shippingCost, txnFee, adSpend: i.adSpend,
    grossProfit, contributionPerOrder, netProfit, netProfitPerOrder,
    grossMarginPct, netMarginPct,
    roas, poas, breakEvenRoas, roi, cpa, aov, cvr, cpc, ctr, cpm,
    effectiveContributionPerOrder, breakEvenRoasAdjusted,
  };
}

/** Teoretiskt bidrag för EN enhet till fullpris. Används i produktanalysen. */
export function unitEconomics(p: Product, s: Settings, outboundShipping: number) {
  const priceExVat = toExVat(p.price, s.vatRate);
  const txn = p.price * s.txnFeePct + s.txnFeeFixed;
  const landed = landedUnitCost(p);
  const contribution = priceExVat - landed - outboundShipping - txn;
  const marginPct = safeDiv(contribution, priceExVat);
  const effective = returnAdjustedContribution(contribution, p);
  const effectiveMarginPct = safeDiv(effective, priceExVat);
  return {
    priceExVat, landed, txn, outboundShipping,
    contribution, marginPct,
    breakEvenRoas: marginPct > 0 ? 1 / marginPct : Infinity,
    effective, effectiveMarginPct,
    breakEvenRoasAdjusted: effectiveMarginPct > 0 ? 1 / effectiveMarginPct : Infinity,
    maxCpaAtTargetPoas: (targetPoas = 1.5) => contribution / targetPoas,
  };
}

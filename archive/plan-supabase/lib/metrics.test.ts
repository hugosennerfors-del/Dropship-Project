import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMetrics, toExVat, unitEconomics, returnAdjustedContribution } from "./metrics.ts";
import { productStatus, DEFAULT_THRESHOLDS } from "./status.ts";
import type { Product, Settings } from "./types.ts";

const S: Settings = {
  currency: "SEK", vatRate: 0.25,
  txnFeePct: 0.019, txnFeeFixed: 1.8, monthlyFixedCost: 0,
};

test("moms räknas bort en gång, inte noll och inte två", () => {
  assert.equal(toExVat(1250, 0.25), 1000);
  assert.equal(toExVat(125, 0.25), 100);
});

test("bruttovinst är FÖRE annons och break-even = 1/marginal", () => {
  // 100 order à 1395 kr inkl moms. Landad kostnad 370 kr/st, frakt ut 70 kr/st.
  const m = computeMetrics({
    grossRevenue: 139_500, grossShipping: 0, refundedGross: 0,
    shippingCost: 7_000, cogs: 37_000, txnFee: 0,
    orders: 100, units: 100, adSpend: 30_000,
    impressions: 500_000, clicks: 7_500, sessions: 6_000,
  }, S);

  assert.equal(Math.round(m.netRevenueExVat), 111_600);        // 139500 / 1.25
  // bruttovinst = 111600 − 37000 − 7000 − txn
  const txn = 139_500 * 0.019 + 1.8 * 100;                     // 2830.5
  assert.ok(Math.abs(m.txnFee - txn) < 0.01);
  assert.equal(Math.round(m.grossProfit), Math.round(111_600 - 37_000 - 7_000 - txn));

  // Break-even ROAS ska vara exakt inversen av bruttomarginalen.
  assert.ok(Math.abs(m.breakEvenRoas - 1 / m.grossMarginPct) < 1e-9);

  // Nettovinst drar av annonsen. Bruttovinsten gör det inte.
  assert.ok(m.netProfit < m.grossProfit);
  assert.equal(Math.round(m.netProfit), Math.round(m.grossProfit - 30_000));
});

test("POAS har break-even 1,00 oavsett produkt — ROAS har det inte", () => {
  const base = {
    grossShipping: 0, refundedGross: 0, impressions: 0, clicks: 0, sessions: 0,
    txnFee: 0, units: 100,
  };
  // Högmarginalprodukt
  const hi = computeMetrics({ ...base, grossRevenue: 100_000, cogs: 20_000, shippingCost: 5_000, orders: 100, adSpend: 20_000 }, S);
  // Lågmarginalprodukt
  const lo = computeMetrics({ ...base, grossRevenue: 100_000, cogs: 55_000, shippingCost: 5_000, orders: 100, adSpend: 20_000 }, S);

  // Samma ROAS, helt olika verklighet.
  assert.ok(Math.abs(hi.roas - lo.roas) < 1e-9);
  assert.ok(hi.poas > lo.poas);
  assert.ok(hi.breakEvenRoas < lo.breakEvenRoas);
});

test("returjustering: 89 EUR bidrag vid 25 % returer blir ca 63 EUR", () => {
  // Siffrorna från omklädningsrocken i kapitel 14.
  const p = { returnRate: 0.25, returnHandlingCost: 12, returnResaleRate: 0.9, unitCost: 33, landedAdder: 0 };
  const eff = returnAdjustedContribution(89, p);
  assert.ok(eff > 61 && eff < 65, `fick ${eff}`);
});

test("unitEconomics ger maxCPA som håller målet", () => {
  const p: Product = {
    id: "1", sku: "ROCK-M", name: "Omklädningsrock",
    unitCost: 370, landedAdder: 0, price: 1395,
    returnRate: 0.25, returnHandlingCost: 135, returnResaleRate: 0.9,
  };
  const u = unitEconomics(p, S, 70);
  assert.ok(u.marginPct > 0.5 && u.marginPct < 0.8);
  // Vid mål-POAS 1,5 får CPA vara bidraget delat på 1,5.
  assert.ok(Math.abs(u.maxCpaAtTargetPoas(1.5) - u.contribution / 1.5) < 1e-9);
});

test("ampeln kräver data innan den dömer", () => {
  const m = computeMetrics({
    grossRevenue: 13_950, grossShipping: 0, refundedGross: 0, shippingCost: 700,
    cogs: 3_700, txnFee: 0, orders: 10, units: 10, adSpend: 2_000,
    impressions: 0, clicks: 0, sessions: 0,
  }, S);
  const s = productStatus(m, 10, 0.1, DEFAULT_THRESHOLDS);
  assert.equal(s.verdict, "TESTA");
  assert.equal(s.color, "grey");
});

test("hög returgrad kan inte döljas av bra POAS", () => {
  const m = computeMetrics({
    grossRevenue: 139_500, grossShipping: 0, refundedGross: 0, shippingCost: 7_000,
    cogs: 37_000, txnFee: 0, orders: 100, units: 100, adSpend: 25_000,
    impressions: 0, clicks: 0, sessions: 0,
  }, S);
  assert.ok(m.poas >= DEFAULT_THRESHOLDS.scalePoas);          // ser grönt ut
  const s = productStatus(m, 100, 0.32, DEFAULT_THRESHOLDS);  // men 32 % returer
  assert.equal(s.verdict, "OPTIMERA");
  assert.match(s.reason, /Returgrad/);
});

// Unit economics, break-even and scenarios.
//
// All money is in the market's own currency. Every derived value carries a
// status computed from its inputs (provenance.derivedStatus), so a margin
// built on an AI-estimated supplier price is shown as AI estimated, however
// precise the arithmetic is.

import { val, v, known, derivedStatus, isVal } from "./provenance.js";

// Inbound freight per unit when no quote is known, by size class, in USD.
const INBOUND_USD_BY_SIZE = { S: 0.8, M: 1.8, L: 4, XL: 9 };
// Share of returned units that cannot be resold, by product kind.
const UNSELLABLE = { textile: 0.1, electrical: 0.3, default: 0.15 };
// Assumed gross margin on upsell items.
const UPSELL_MARGIN = 0.6;
// Baseline creative cost to launch a test (3 UGC-style videos), in GBP.
const CREATIVE_GBP = 450;
const SAMPLES_SHIP_GBP = 25;

// CAC heuristic: CAC as a share of the consumer price falls as price rises.
// Calibrated on the user's own Swedish Meta campaigns (CAC was 42 % and 58 %
// of price for two products, ev:own-sales) and the median CPA/price of 46 %
// in the earlier candidate pool. Prices on the curve are GBP incl. VAT.
const CAC_CURVE = [
  [10, 0.6], [20, 0.5], [40, 0.42], [80, 0.35], [150, 0.3], [300, 0.26],
];

function interpLog(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    const [x0, y0] = curve[i - 1];
    if (x <= x1) {
      const t = (Math.log(x) - Math.log(x0)) / (Math.log(x1) - Math.log(x0));
      return y0 + t * (y1 - y0);
    }
  }
  return curve[curve.length - 1][1];
}

const num = (x, d = 0) => {
  const n = v(x);
  return typeof n === "number" && Number.isFinite(n) ? n : d;
};

export function cacModel(priceLocal, cfg, adPotential, impulse) {
  const priceGBP = priceLocal * cfg.fxToGBP;
  const k = interpLog(CAC_CURVE, Math.max(priceGBP, 1));
  let adj = 1 - 0.15 * ((adPotential - 50) / 50) - 0.1 * ((impulse - 50) / 50);
  adj = Math.min(1.3, Math.max(0.7, adj));
  return { cac: priceLocal * k * adj * (cfg.adCostIndex || 1), share: k * adj };
}

// The economics of one product in one market.
//
// core      core fields ({v,s} values)
// mk        market fields ({v,s} values)
// cfg       market config (markets.js, with user overrides)
// over      plain-number overrides from the calculator UI (optional)
export function computeEconomics(core, mk, cfg, over = {}) {
  const o = (k, x) => (over[k] != null && over[k] !== "" ? val(Number(over[k]), "V", "user") : x);
  const size = v(core.size) || "M";
  const kind = v(core.kind) || "default";

  const units = o("unitsPerOrder", mk.unitsPerOrder || val(1, "A"));
  const price = o("price", mk.price);

  // Supplier price arrives in USD from sourcing and is converted.
  const supplierUSD = core.supplierPriceUSD;
  const supplierPrice = o("supplierPrice", known(supplierUSD)
    ? val(num(supplierUSD) * cfg.fxFromUSD, supplierUSD.s === "V" ? "E" : supplierUSD.s, supplierUSD.src, "Converted from USD at an assumed rate.")
    : val(null, "N"));
  const inboundUSD = known(core.inboundUSD) ? core.inboundUSD
    : val(INBOUND_USD_BY_SIZE[size], "A", "assumption:inbound-by-size", "Assumed sea/air consolidation cost for this size class.");
  const inbound = o("inbound", val(num(inboundUSD) * cfg.fxFromUSD, inboundUSD.s === "V" ? "E" : inboundUSD.s, inboundUSD.src));
  const duty = o("dutyRate", mk.dutyRate || val(4, "A", "assumption:duty", "Assumed average duty rate."));

  const landedUnit = (num(supplierPrice) + num(inbound)) * (1 + num(duty) / 100);
  const landedCost = val(round(landedUnit * num(units, 1)), derivedStatus(supplierPrice, inbound, duty), null,
    "Supplier price + inbound freight, plus duty.");

  const shipping = o("shipping", val(cfg.shippingBySize[size], cfg.sources.shippingBySize?.startsWith("ev:") ? "E" : "A",
    cfg.sources.shippingBySize?.startsWith("ev:") ? [cfg.sources.shippingBySize] : ["assumption"],
    `Outbound parcel, size class ${size}.`));
  const packaging = o("packaging", val(cfg.packaging, "A", "assumption"));

  const upsellValue = mk.upsellValue || val(0, "A");
  const attach = mk.attachRate || val(0, "A");
  const upsellRevIncl = num(upsellValue) * num(attach) / 100;
  const orderIncl = num(price) * num(units, 1) + upsellRevIncl;
  const aov = val(round(orderIncl), derivedStatus(price, attach), null, "Price × units + expected upsell.");

  const feeV = orderIncl * cfg.paymentPct + cfg.paymentFixed;
  const paymentFees = o("paymentFees", val(round(feeV), "A", "assumption", `${(cfg.paymentPct * 100).toFixed(1)} % + ${cfg.paymentFixed} per order.`));

  const revenueExV = (num(price) * num(units, 1)) / (1 + cfg.vat);
  const revenueEx = val(round(revenueExV), price.s === "V" ? "E" : price.s);

  // Cost basis. A product the user already sells carries its observed cost
  // per order (product, shipping, fees and packaging, ex VAT) as
  // `variableCost`; that replaces the modelled components.
  const vcOver = over.variableCost != null && over.variableCost !== "" ? val(Number(over.variableCost), "V", "user") : null;
  const useVC = !!vcOver || known(mk.variableCost);
  const variableCost = useVC
    ? (vcOver || mk.variableCost)
    : val(round(landedUnit * num(units, 1) + num(shipping) + num(paymentFees) + num(packaging)),
      derivedStatus(landedCost, shipping), null, "Landed cost + shipping + payment fees + packaging.");
  const costBasis = useVC ? variableCost : landedCost;

  const grossV = revenueExV - num(variableCost);
  const priceKnown = known(price) && num(price) > 0;
  const gross = val(round(grossV), derivedStatus(price, costBasis, useVC ? null : shipping));
  const margin = val(priceKnown ? round((grossV / revenueExV) * 100, 1) : null, priceKnown ? derivedStatus(price, costBasis) : "N", null,
    "Before ad spend and returns.");

  // Returns: refunded revenue, lost outbound shipping and fees, handling,
  // and a share of units that cannot be resold. When the return rate is
  // unknown, an assumed rate is used and named in the note; it does not
  // downgrade the status of values otherwise built on observed data.
  const rrKnown = known(mk.returnRate);
  const rr = o("returnRate", rrKnown ? mk.returnRate
    : val(num(mk.returnRateAssumed, 8), "A", "assumption:returns",
      isVal(mk.returnRate) && mk.returnRate.note ? `Assumed: ${mk.returnRate.note}` : "Assumed return rate."));
  const rrAssumed = !rrKnown && !(over.returnRate != null && over.returnRate !== "");
  const r = num(rr) / 100;
  const handling = cfg.returnHandlingBySize[size];
  const unsellable = UNSELLABLE[kind] ?? UNSELLABLE.default;
  const upsellContribution = (upsellRevIncl / (1 + cfg.vat)) * UPSELL_MARGIN;
  // A returned unit that can be resold gives its product cost back.
  const contribV = revenueExV * (1 - r) - num(variableCost) + landedUnit * num(units, 1) * r * (1 - unsellable)
    - r * handling + upsellContribution * (1 - r);
  const contribution = val(round(contribV), derivedStatus(price, costBasis, rrAssumed ? null : rr), null,
    rrAssumed ? `Expected profit per order after returns, before ads. Uses an assumed ${num(rr)} % return rate.`
      : "Expected profit per order after returns, before ads.");

  // CAC: the user's own figure, an authored estimate, or the model.
  const adPot = adPotentialOf(mk);
  const impulse = num(core.impulse, 50);
  let cac;
  if (over.cac != null && over.cac !== "") cac = val(Number(over.cac), "V", "user");
  else if (known(mk.cac)) cac = mk.cac;
  else {
    const m = cacModel(num(price), cfg, adPot, impulse);
    cac = val(round(m.cac), derivedStatus(price, mk.meta, core.impulse), ["model:cac-curve"],
      `Modelled at ${(m.share * 100).toFixed(0)} % of price from the CAC curve (calibrated on your own campaigns).`);
  }

  const profitV = contribV - num(cac);
  const profit = val(round(profitV), derivedStatus(contribution, cac), null, "Contribution after returns and estimated CAC.");
  const netMargin = val(priceKnown ? round((profitV / revenueExV) * 100, 1) : null, derivedStatus(profit));
  const maxCac = val(round(contribV), contribution.s, null, "The CAC at which an order breaks even.");
  const roas = val(num(cac) > 0 ? round(orderIncl / num(cac), 2) : null, derivedStatus(cac, price), null,
    "Order value incl. VAT ÷ CAC, as Meta reports it.");
  const breakEvenRoas = val(contribV > 0 ? round(orderIncl / contribV, 2) : null, contribution.s);

  // Launch cost: first inventory at MOQ, samples, compliance and creative.
  const moq = num(core.moq, 50);
  const inventory = moq * landedUnit;
  const samples = 3 * landedUnit + SAMPLES_SHIP_GBP / cfg.fxToGBP;
  const fixed = num(mk.fixedLaunchCost, 0);
  const creative = CREATIVE_GBP / cfg.fxToGBP;
  const startupV = inventory + samples + fixed + creative;
  const startupCost = val(round(startupV), derivedStatus(landedCost, core.moq), null,
    "First inventory at MOQ + 3 samples + compliance + three UGC-style videos. Excludes ad budget.");
  const breakEvenOrdersV = profitV > 0 ? Math.ceil(startupV / profitV) : null;
  const breakEvenOrders = val(breakEvenOrdersV, profit.s, null, profitV > 0 ? "Orders needed to recover the launch cost." : "Never breaks even at the estimated CAC.");

  // Lifetime value: first-order profit plus repeat orders at contribution
  // (no acquisition cost), scaled by repeat-purchase potential.
  const repeat = num(core.repeat, 20);
  const expectedRepeats = (repeat / 100) * 1.2;
  const clv = val(round(profitV + expectedRepeats * contribV * 0.85), derivedStatus(profit, core.repeat), null,
    `Assumes about ${expectedRepeats.toFixed(1)} repeat orders per customer.`);

  return {
    unitsPerOrder: units, price, supplierPrice, inbound, dutyRate: duty, landedCost, shipping, packaging, paymentFees,
    variableCost, revenueEx, aov, grossProfit: gross, margin, returnRate: rr, contribution, cac, profit, netMargin,
    maxCac, roas, breakEvenRoas, startupCost, breakEvenOrders, clv,
    profitGBP: val(round(profitV * cfg.fxToGBP), profit.s),
    _breakdown: {
      inventory: round(inventory), samples: round(samples), fixed: round(fixed), creative: round(creative),
      landedUnit: round(landedUnit), orderIncl: round(orderIncl), revenueExV: round(revenueExV),
      returnHandling: handling, unsellable, upsellContribution: round(upsellContribution), moq,
      costBasis: useVC ? "observed" : "components", returnsAssumed: rrAssumed,
    },
  };
}

export function adPotentialOf(mk) {
  const n = (k, d = 50) => num(mk[k], d);
  return 0.35 * n("meta") + 0.3 * n("tiktok") + 0.15 * n("instagram") + 0.1 * n("google") + 0.1 * n("influencer");
}

// Profit at a given number of orders, after the launch cost.
export function profitAt(e, orders) {
  return round(orders * num(e.profit) - num(e.startupCost));
}

// Revenue incl. VAT needed to break even on the launch cost.
export function breakEvenRevenue(e) {
  const n = v(e.breakEvenOrders);
  return n == null ? null : round(n * num(e.aov));
}

// The ROAS needed to hit a target net margin on each order.
export function targetRoas(e, targetNetMarginPct) {
  const allowed = num(e.contribution) - (targetNetMarginPct / 100) * num(e.revenueEx);
  return allowed > 0 ? round(num(e.aov) / allowed, 2) : null;
}

// Best / base / worst: the same product under different assumptions.
export const SCENARIOS = {
  best: { label: "Best case", cac: 0.75, returns: 0.7, price: 1, cost: 1,
    story: "Strong creative, high conversion, lower CAC and fewer returns." },
  base: { label: "Base case", cac: 1, returns: 1, price: 1, cost: 1,
    story: "Average conversion and CAC as estimated." },
  worst: { label: "Worst case", cac: 1.5, returns: 1.5, price: 0.92, cost: 1.1,
    story: "CAC 50 % higher, returns 50 % higher, 8 % discounting to convert, 10 % cost increase." },
};

export function scenario(core, mk, cfg, kind, base) {
  const s = SCENARIOS[kind];
  const e0 = base || computeEconomics(core, mk, cfg);
  const over = {
    cac: num(e0.cac) * s.cac,
    returnRate: num(e0.returnRate) * s.returns,
    price: num(e0.price) * s.price,
  };
  if (e0._breakdown.costBasis === "observed") over.variableCost = num(e0.variableCost) * s.cost;
  else over.supplierPrice = num(e0.supplierPrice) * s.cost;
  const e = computeEconomics(core, mk, cfg, over);
  return { kind, ...s, economics: e, profit100: profitAt(e, 100) };
}

export function round(x, d = 2) {
  if (x == null || !Number.isFinite(x)) return null;
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

export { isVal };

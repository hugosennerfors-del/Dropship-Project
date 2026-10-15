// Unit economics for a brand: what one order earns after VAT, landed cost,
// shipping, payment fees and returns, and how much an ad may cost before the
// order loses money. Plain functions, shared by the editor, the publish
// dialog and the tests.
//
// One item per order. Returns: a refunded order brings in nothing but has
// still cost the goods, the shipping and the payment fee, so the expected
// contribution per order is (1 − r)·net − cost − shipping − fees.

const VAT = { UK: 0.2, SE: 0.25 };

// Assumptions the user can change. Payment fees differ by plan and country;
// these are starting values, labelled as such on the page.
export const ECON_DEFAULTS = {
  UK: { shipping: null, adCost: null, returnPct: 3, feePct: 2.9, feeFixed: 0.3, targetPct: 20 },
  SE: { shipping: null, adCost: null, returnPct: 3, feePct: 2.9, feeFixed: 0, targetPct: 20 },
};

const num = (x) => (x === null || x === undefined || x === "" ? null : Number(String(x).replace(",", ".")));
const r2 = (x) => Math.round(x * 100) / 100;

// The brand's settings merged over the market's defaults, as numbers.
export function econSettings(concept) {
  const market = concept?.market === "SE" ? "SE" : "UK";
  const d = ECON_DEFAULTS[market];
  const e = concept?.economics || {};
  const pick = (k) => { const v = num(e[k]); return Number.isFinite(v) ? v : d[k]; };
  return {
    market, vat: VAT[market],
    shipping: pick("shipping"), adCost: pick("adCost"), returnPct: pick("returnPct"),
    feePct: pick("feePct"), feeFixed: pick("feeFixed"), targetPct: pick("targetPct"),
    assumed: ["feePct", "feeFixed", "returnPct"].filter((k) => !Number.isFinite(num(e[k]))),
  };
}

// Problems with the settings, as messages (empty when they can be used).
export function econProblems(e) {
  const out = [];
  for (const [k, label, lo, hi] of [["shipping", "Shipping per order", 0, 1e6], ["adCost", "Ad cost per order", 0, 1e6], ["returnPct", "Returns", 0, 90], ["feePct", "Payment fee", 0, 20], ["feeFixed", "Fixed payment fee", 0, 1e4], ["targetPct", "Target margin", 0, 90]]) {
    const v = e[k];
    if (v === null) continue;
    if (!Number.isFinite(v) || v < lo || v > hi) out.push(`${label} must be a number from ${lo} to ${hi}.`);
  }
  return out;
}

// One price: everything per order. `cost` is the landed unit cost.
export function orderEconomics({ price, cost, settings: e }) {
  const p = num(price), c = num(cost);
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(c) || c < 0) return null;
  const r = (e.returnPct || 0) / 100, fp = (e.feePct || 0) / 100, ff = e.feeFixed || 0, s = e.shipping || 0;
  const net = p / (1 + e.vat);
  const fees = p * fp + ff;
  const contribution = (1 - r) * net - c - s - fees;      // before ads
  const breakEvenCpa = contribution;                       // ad cost per order that leaves nothing
  const profit = e.adCost === null ? null : contribution - e.adCost;
  // ROAS: order value incl. VAT per unit of ad spend at break-even.
  const breakEvenRoas = contribution > 0 ? p / contribution : null;
  // Price at which the order breaks even (or makes the target margin of
  // net revenue) after the expected ad cost.
  const fixed = c + s + ff + (e.adCost || 0);
  const solve = (m) => { const k = (1 - r - m) / (1 + e.vat) - fp; return k > 0 ? fixed / k : null; };
  const breakEvenPrice = solve(0);
  const targetPrice = solve((e.targetPct || 0) / 100);
  return {
    price: r2(p), net: r2(net), cost: r2(c), shipping: r2(s), fees: r2(fees), returns: r2(r * net),
    contribution: r2(contribution), breakEvenCpa: r2(breakEvenCpa), profit: profit === null ? null : r2(profit),
    marginPct: net > 0 && profit !== null ? Math.round((profit / net) * 1000) / 10 : null,
    breakEvenRoas: breakEvenRoas === null ? null : Math.round(breakEvenRoas * 100) / 100,
    breakEvenPrice: breakEvenPrice === null ? null : r2(breakEvenPrice),
    targetPrice: targetPrice === null ? null : r2(targetPrice),
  };
}

// Every product of a concept at its first variant's price (the price shown
// first in the store). Products without a landed cost are listed as such.
export function conceptEconomics(concept) {
  const e = econSettings(concept);
  const rows = (concept?.products || []).map((p) => {
    const price = p.variants?.[0]?.price;
    const x = p.costEstimate ? orderEconomics({ price, cost: p.costEstimate, settings: e }) : null;
    return { title: p.title, handle: p.handle || null, price: num(price), hasCost: !!p.costEstimate, ...(x ? { econ: x } : {}) };
  });
  const priced = rows.filter((r) => r.econ);
  const losing = priced.filter((r) => (r.econ.profit ?? r.econ.contribution) < 0);
  return { settings: e, problems: econProblems(e), rows, priced: priced.length, losing: losing.map((r) => r.title), missingCost: rows.filter((r) => !r.hasCost).map((r) => r.title) };
}

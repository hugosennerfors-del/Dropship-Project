// Research-inbox ideas: rows of public.product_candidates, written by the n8n
// Research generator. Their prices, costs and CPA are a language model's
// guesses, so they are shown as AI estimates and stay out of the rankings
// until an idea is analysed into a full profile.

const CURRENCY = { SE: "SEK", GB: "GBP", UK: "GBP", US: "USD" };
const VAT = { SE: 0.25, UK: 0.2 };
const num = (x) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));

// The generator calls the United Kingdom "GB"; this tool calls it "UK".
export const toMarket = (country) => (country === "GB" ? "UK" : country);
export const toCountry = (market) => (market === "UK" ? "GB" : market);

// An inbox row as intel.api_read returns it (camelCase, inputs object) →
// the shape the views use. Money is per order, incl. VAT where the market
// has it; margin is before ad cost, profit after the model's CPA guess.
export function normaliseCandidate(c, analysedNames) {
  const market = toMarket(c.country);
  const i = c.inputs || {};
  const vat = VAT[market] || 0;
  const price = num(i.salePriceInclVat), cost = num(i.costPerUnitInclVat);
  const shipping = num(i.shippingCostPerOrder), fees = num(i.transactionFeePerOrder), cpa = num(i.expectedCpaInclVat);
  const units = num(i.expectedUnitsPerOrder) || 1;
  let margin = null, profit = null;
  if (price && cost != null) {
    const revEx = (price * units) / (1 + vat);
    const before = revEx - (cost * units) / (1 + vat) - (shipping || 0) / (1 + vat) - (fees || 0);
    margin = Math.round((before / revEx) * 1000) / 10;
    profit = Math.round((before - (cpa || 0) / (1 + vat)) * 100) / 100;
  }
  return {
    id: c.id, sourceId: c.sourceId || null, name: c.name, market, currency: CURRENCY[c.country] || "USD", niche: c.niche, notes: c.notes,
    price, cost, shipping, fees, cpa, units, margin, profit, researchDate: c.researchDate, trendSource: c.trendSource, adPlan: c.adPlan || null,
    status: "AI estimated", analysed: !!c.analysed || !!analysedNames?.has(String(c.name || "").toLowerCase()),
    importFile: c.importFile, createdAt: c.createdAt,
  };
}

// One idea as the Research generator returns it: the saved
// product_candidates row (snake_case, with its id), or, as a fallback, the
// model's item before saving (no id). `ctx` fills what the item lacks.
export function fromGenerator(j, ctx) {
  return normaliseCandidate({
    id: j.id ? "n8n-" + String(j.id).slice(0, 8) : `new-${ctx.executionId}-${ctx.index}`,
    sourceId: j.id || null,
    name: String(j.name || "Unnamed idea").slice(0, 160),
    country: j.country || ctx.country,
    niche: j.niche || ctx.niche,
    notes: j.notes ? String(j.notes).slice(0, 600) : null,
    researchDate: j.research_date ? String(j.research_date).slice(0, 10) : ctx.date,
    trendSource: j.trend_source || ctx.trendSource,
    createdAt: j.created_at || new Date().toISOString(),
    inputs: {
      costPerUnitInclVat: j.cost_per_unit_incl_vat, salePriceInclVat: j.sale_price_incl_vat,
      shippingCostPerOrder: j.shipping_cost_per_order, transactionFeePerOrder: j.transaction_fee_per_order,
      expectedCpaInclVat: j.expected_cpa_incl_vat, expectedUnitsPerOrder: j.expected_units_per_order,
    },
    adPlan: adPlan(j.ad_plan),
  });
}

// The ideas in a Research generator run: the saved rows from the first node
// that has any (the insert node, then the split node before it). An item
// without a name is not an idea, e.g. a bare "success" from the insert.
export function ideasFrom(runData, nodes) {
  for (const name of nodes) {
    const items = (runData?.[name]?.[0]?.data?.main?.[0] || []).map((it) => it?.json).filter((j) => j && j.name);
    if (items.length) return items;
  }
  return [];
}

// The ad plan arrives as an object, or as JSON text from the database.
function adPlan(x) {
  let p = x;
  if (typeof p === "string") { try { p = JSON.parse(p); } catch { return null; } }
  if (!p || typeof p !== "object") return null;
  const s = (v, max = 400) => (v == null || v === "" ? null : String(v).slice(0, max));
  return {
    angle: s(p.angle), hook: s(p.hook, 240), format: s(p.format, 200),
    script: Array.isArray(p.script) ? p.script.slice(0, 6).map((v) => String(v).slice(0, 240)) : [],
    audience: s(p.audience), primaryText: s(p.primaryText), headline: s(p.headline, 80), adLibraryQuery: s(p.adLibraryQuery, 80),
  };
}

// Earlier research runs, newest first: one entry per topic, market and day.
export function researchRuns(cands, limit = 8) {
  const runs = new Map();
  for (const c of cands) {
    if (!c.niche) continue;
    const key = `${String(c.niche).toLowerCase()}|${c.market}|${c.researchDate || ""}`;
    const r = runs.get(key) || { topic: c.niche, market: c.market, date: c.researchDate || null, count: 0 };
    r.count++;
    runs.set(key, r);
  }
  return [...runs.values()].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, limit);
}

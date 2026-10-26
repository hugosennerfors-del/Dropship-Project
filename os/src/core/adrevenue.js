// What competitors' ads bring in, estimated from what Meta publishes.
//
// Meta publishes reach only for the part of an ad shown in the EU (the
// Digital Services Act). For the UK and the US it publishes neither reach
// nor spend, so an ad shown only there has no measured reach and gets no
// estimate. An ad shown in the EU and elsewhere (often the UK and Ireland)
// has its EU reach scaled up by population to every country it runs in.
// From there it is the funnel: reach × views per person = impressions,
// × click rate = clicks, × conversion = sales, × the store's price = revenue.
//
// The margin assumes the store sells at `markup` times its supplier price,
// less the market's card fees. Ad cost uses the market's Meta CPM. All of
// it is an estimate built on the assumptions the owner sets with sliders.

import { market } from "./markets.js";

// Population in millions, rounded (UN and Eurostat estimates for 2025).
export const EU_POP = {
  AT: 9.2, BE: 11.9, BG: 6.4, HR: 3.8, CY: 1.0, CZ: 10.9, DK: 6.0, EE: 1.4, FI: 5.6, FR: 68.6, DE: 83.6, GR: 10.4, HU: 9.6, IE: 5.4,
  IT: 59.0, LV: 1.9, LT: 2.9, LU: 0.7, MT: 0.6, NL: 18.0, PL: 36.6, PT: 10.7, RO: 19.0, SK: 5.4, SI: 2.1, ES: 48.8, SE: 10.6,
};
export const OTHER_POP = { GB: 69.3, US: 340, CA: 41.5, AU: 27.4, NZ: 5.3, NO: 5.6, CH: 9.0, IS: 0.4 };

// Click rate and conversion in percent, views per person, price ÷ supplier price.
export const ESTIMATE_DEFAULTS = { ctr: 1, cvr: 2, frequency: 2, markup: 3 };
export const ESTIMATE_RANGE = {
  ctr: { min: 0.2, max: 5, step: 0.1 },
  cvr: { min: 0.5, max: 6, step: 0.1 },
  frequency: { min: 1, max: 4, step: 0.5 },
  markup: { min: 1.5, max: 6, step: 0.5 },
};

const DAY = 86400000;
const n = (x) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));

export function assumptions(a = {}) {
  const out = {};
  for (const [k, d] of Object.entries(ESTIMATE_DEFAULTS)) {
    const v = n(a[k]);
    const { min, max } = ESTIMATE_RANGE[k];
    out[k] = v == null ? d : Math.min(max, Math.max(min, v));
  }
  return out;
}

// The ad's whole reach from its EU reach. `lowerBound` when part of the
// audience could not be counted (countries not reported or not known here).
export function reachOf(m) {
  const eu = n(m?.euReach);
  if (!eu || eu <= 0) return { reach: null };
  const countries = Array.isArray(m.countries) ? m.countries.map((c) => String(c).toUpperCase()) : [];
  const euPop = countries.reduce((s, c) => s + (EU_POP[c] || 0), 0);
  if (!countries.length || !euPop) return { reach: eu, euReach: eu, scale: 1, lowerBound: true, countries };
  const unknown = countries.filter((c) => !EU_POP[c] && !OTHER_POP[c]);
  const all = countries.reduce((s, c) => s + (EU_POP[c] || OTHER_POP[c] || 0), 0);
  const scale = all / euPop;
  return { reach: Math.round(eu * scale), euReach: eu, scale, lowerBound: unknown.length > 0, countries, unknown };
}

function daysRun(ad, m) {
  const d = n(m?.daysActive);
  if (d && d > 0) return d;
  const a = Date.parse(`${ad?.startedOn}T00:00:00Z`), b = Date.parse(`${m?.checkedAt || ""}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / DAY) + 1 : null;
}

// Margin per sale: price less the supplier price (price ÷ markup) and card fees.
export function marginPerSale(price, currency, a, cfg) {
  const p = n(price);
  if (p == null || p <= 0) return null;
  const fixed = currency === cfg.currency ? cfg.paymentFixed || 0 : 0;
  const supplier = p / a.markup;
  return { supplier, fees: p * (cfg.paymentPct || 0) + fixed, margin: p - supplier - p * (cfg.paymentPct || 0) - fixed };
}

// One saved ad. Returns { ok: false, reason } when there is nothing to go on:
// "no-data" (not from GetHookd, or not checked yet), "outside-eu" (Meta
// publishes no reach for it) or "no-days".
export function estimateAd(ad, a = ESTIMATE_DEFAULTS, marketCode = "UK") {
  const m = ad?.metrics;
  if (!m || m.source !== "gethookd") return { ok: false, reason: "no-data" };
  const cfg = market(marketCode);
  const r = reachOf(m);
  if (!r.reach) return { ok: false, reason: "outside-eu", price: n(m.price), currency: m.currency || null };
  const days = daysRun(ad, m);
  if (!days) return { ok: false, reason: "no-days" };
  const as = assumptions(a);
  const month = 30 / days;
  const impressions = r.reach * as.frequency;
  const clicks = impressions * (as.ctr / 100);
  const sales = clicks * (as.cvr / 100);
  const currency = m.currency || cfg.currency;
  const price = n(m.price);
  const mg = marginPerSale(price, currency, as, cfg);
  const spend = currency === cfg.currency ? (impressions / 1000) * cfg.cpm : null;
  return {
    ok: true, days, reach: r.reach, euReach: r.euReach, scale: r.scale, lowerBound: !!r.lowerBound, countries: r.countries,
    impressions, clicks, sales, price, currency,
    supplier: mg?.supplier ?? null, marginPerSale: mg?.margin ?? null,
    month: {
      impressions: impressions * month, clicks: clicks * month, sales: sales * month,
      revenue: price != null ? sales * price * month : null,
      profitBeforeAds: mg ? sales * mg.margin * month : null,
      adCost: spend != null ? spend * month : null,
      profitAfterAds: mg && spend != null ? (sales * mg.margin - spend) * month : null,
    },
  };
}

// A whole store from its monthly visits (GetHookd's traffic estimate).
export function estimateStore(visits, price, a = ESTIMATE_DEFAULTS) {
  const v = n(visits), p = n(price);
  if (v == null) return null;
  const sales = v * (assumptions(a).cvr / 100);
  return { visits: v, sales, revenue: p != null ? sales * p : null };
}

// Per advertiser: the ads that could be estimated, summed per month, with
// the store's price and traffic when known.
export function estimateByAdvertiser(ads, a = ESTIMATE_DEFAULTS, marketCode = "UK") {
  const groups = new Map();
  for (const ad of ads || []) {
    const key = ad.advertiser || ad.metrics?.landingPage || ad.url;
    const g = groups.get(key) || { advertiser: ad.advertiser || null, ads: 0, estimated: 0, outsideEu: 0, noData: 0, lowerBound: false,
      month: { sales: 0, revenue: 0, profitBeforeAds: 0, adCost: 0, profitAfterAds: 0 }, money: true, price: null, currency: null, store: null, longest: 0 };
    groups.set(key, g);
    g.ads++;
    const m = ad.metrics || {};
    g.shopId ??= m.shopId ?? null;
    if (g.price == null && n(m.price) != null) { g.price = n(m.price); g.currency = m.currency || market(marketCode).currency; g.priceFrom = m.priceFrom || "product"; }
    if (m.store?.visits != null && (!g.store || String(m.store.checkedAt || "") > String(g.store.checkedAt || ""))) g.store = m.store;
    const e = estimateAd(ad, a, marketCode);
    if (!e.ok) { if (e.reason === "outside-eu") g.outsideEu++; else g.noData++; continue; }
    g.estimated++;
    g.longest = Math.max(g.longest, e.days);
    g.lowerBound ||= e.lowerBound;
    g.month.sales += e.month.sales;
    for (const k of ["revenue", "profitBeforeAds", "adCost", "profitAfterAds"]) {
      if (e.month[k] == null) g.money = false;
      else g.month[k] += e.month[k];
    }
  }
  return [...groups.values()].map((g) => ({ ...g, storeEstimate: g.store ? estimateStore(g.store.visits, g.price, a) : null }))
    .sort((x, y) => y.month.sales - x.month.sales || y.ads - x.ads);
}

// Assemble a product profile per market and flatten it into a queryable row.
//
// A product record has two layers of inputs:
//   core      what the product is (same everywhere)
//   markets   one block per market code with price, demand, competition…
// and a list of evidence ids. User overlays — values the user verified on
// the page — are applied on top, field by field, without touching the
// original analysis.

import { MARKETS, withOverrides } from "./markets.js";
import { computeEconomics } from "./economics.js";
import { scoreProduct, explain } from "./scoring.js";
import { FIELD } from "./fields.js";
import { v, isVal } from "./provenance.js";

// overlays: { "<productId>|<market or core>|<field>": {v, s, src, note, at} }
export function applyOverlays(product, overlays) {
  if (!overlays) return product;
  const core = { ...product.core };
  const markets = Object.fromEntries(Object.entries(product.markets || {}).map(([k, m]) => [k, { ...m }]));
  // A "*" overlay is a whole market block (an AI analysis for a market the
  // research did not cover). It goes first; single-field overlays win.
  const mine = Object.entries(overlays).filter(([key, value]) => value && key.split("|")[0] === product.id)
    .sort(([a], [b]) => (a.endsWith("|*") ? 0 : 1) - (b.endsWith("|*") ? 0 : 1));
  for (const [key, value] of mine) {
    const [, scope, field] = key.split("|");
    if (field === "*") {
      if (MARKETS[scope] && value.v && typeof value.v === "object") markets[scope] = { ...value.v, ...(markets[scope] || {}), _agent: value.src };
      continue;
    }
    if (scope === "core") core[field] = value;
    else if (markets[scope]) markets[scope][field] = value;
  }
  return { ...product, core, markets };
}

export function buildMarket(product, code, evidenceIndex, settings) {
  const mk = product.markets?.[code];
  if (!mk) return null;
  const cfg = withOverrides(code, settings?.markets?.[code]);
  const core = product.core;
  const econ = computeEconomics(core, mk, cfg);
  const evidenceIds = [...(product.evidence || []), ...(mk.evidence || [])];
  const scored = scoreProduct({ core, mk, econ, cfg, evidenceIndex, evidenceIds });
  const why = explain(scored, core, mk, econ);
  return { code, cfg, mk, econ, scored, why, evidenceIds };
}

export function buildProduct(product, evidenceIndex, settings, overlays) {
  const p = applyOverlays(product, overlays);
  const markets = {};
  for (const code of Object.keys(p.markets || {})) {
    if (!MARKETS[code]) continue;
    markets[code] = buildMarket(p, code, evidenceIndex, settings);
  }
  return { ...p, built: markets };
}

// A flat row for filtering, sorting and the chat's tools. Each value is a
// plain number or string; statuses sit beside it in `_s`.
export function rowOf(product, code) {
  const b = product.built?.[code];
  if (!b) return null;
  const row = { id: product.id, market: code, currency: b.cfg.currency, _s: {} };
  const put = (k, x) => {
    if (isVal(x)) { row[k] = x.v; row._s[k] = x.s; }
    else if (x !== undefined) { row[k] = x; }
  };
  for (const [k, x] of Object.entries(product.core)) put(k, x);
  for (const [k, x] of Object.entries(b.mk)) if (k !== "evidence") put(k, x);
  for (const [k, x] of Object.entries(b.econ)) if (!k.startsWith("_")) put(k, x);
  const sc = b.scored;
  for (const k of ["opportunity", "evidenceWeighted", "confidence", "risk", "stage", "marginScore", "profitScore",
    "adPotential", "repeatScore", "growthScore", "ease"]) {
    row[k] = sc[k];
    row._s[k] = "computed";
  }
  row.redFlags = sc._detail.redFlags.map((f) => f.title);
  row.validation = sc._detail.validation.commercial.grade;
  row.interest = sc._detail.validation.interest.grade;
  row.marketBase = sc._detail.validation.base.grade;
  row.source = product.source || "research";
  return row;
}

export function rowsOf(products, code) {
  return products.map((p) => rowOf(p, code)).filter(Boolean);
}

// Human-readable value with unit, for tables and the chat.
export function fmtValue(key, value, currency) {
  if (value == null || value === "") return "—";
  const f = FIELD[key];
  if (!f) return String(value);
  const sym = currency === "SEK" ? " kr" : "";
  const pre = currency === "GBP" ? "£" : "";
  switch (f.type) {
    case "money": return `${pre}${Number(value).toLocaleString(currency === "SEK" ? "sv-SE" : "en-GB", { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2 })}${sym}`;
    case "pct": return `${Number(value).toLocaleString("en-GB", { maximumFractionDigits: 1 })} %`;
    case "score": return `${Math.round(value)}`;
    case "num": return key.toLowerCase().includes("roas") ? `${Number(value).toFixed(2)}×` : Number(value).toLocaleString("en-GB", { maximumFractionDigits: 2 });
    case "list": return Array.isArray(value) ? value.join(", ") : String(value);
    case "months": return Array.isArray(value) ? value.map((m) => "JFMAMJJASOND"[m - 1]).join(" ") : String(value);
    default: return String(value);
  }
}

export { v };

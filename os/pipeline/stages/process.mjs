// Stage 2 — validate and process.
//
// Checks every analysis record against the field registry and the evidence
// list, resolves market inheritance, applies your manual overlays on top
// (without editing the analysis files) and normalises the candidate inbox.
// Problems are collected as warnings or errors; errors stop the pipeline.

import { FIELD } from "../../src/core/fields.js";
import { MARKETS } from "../../src/core/markets.js";
import { STATUS, isVal } from "../../src/core/provenance.js";
import { resolveProduct } from "../../src/core/inherit.js";
import { applyOverlays } from "../../src/core/profile.js";
import { applyOwnSales } from "../../src/core/ownsales.js";

const STRUCTURAL = new Set(["evidence", "inherit"]);
const PLAIN = new Set(["kind"]);

export function processLayers({ raw, analysis, manual }) {
  const errors = [], warnings = [];
  const evidence = raw.evidence.evidence || [];
  const evidenceIndex = Object.fromEntries(evidence.map((e) => [e.id, e]));

  // Evidence records
  const seen = new Set();
  for (const e of evidence) {
    if (seen.has(e.id)) errors.push(`evidence ${e.id}: duplicate id`);
    seen.add(e.id);
    if (!"ABCDE".includes(e.level)) errors.push(`evidence ${e.id}: unknown level ${e.level}`);
    if (!e.claim) errors.push(`evidence ${e.id}: no claim`);
    if (!e.source?.url && e.kind !== "own_sales") warnings.push(`evidence ${e.id}: no source URL`);
  }

  // Products
  const all = [...analysis, ...manual.products];
  const ids = new Set();
  const products = [];
  for (const p of all) {
    if (!p.id) { errors.push(`${p.analysisFile}: product without id`); continue; }
    if (ids.has(p.id)) { errors.push(`${p.id}: duplicate product id`); continue; }
    ids.add(p.id);
    checkBlock(p, "core", p.core, errors, warnings);
    for (const [code, mk] of Object.entries(p.markets || {})) {
      if (!MARKETS[code]) errors.push(`${p.id}: unknown market ${code}`);
      checkBlock(p, code, mk, errors, warnings);
      for (const id of mk.evidence || []) if (!evidenceIndex[id]) errors.push(`${p.id}/${code}: unknown evidence ${id}`);
    }
    for (const id of p.evidence || []) if (!evidenceIndex[id]) errors.push(`${p.id}: unknown evidence ${id}`);
    if (!p.markets?.UK && !p.markets?.SE) warnings.push(`${p.id}: no market block`);
    if (p.store?.evidence && !evidenceIndex[p.store.evidence]) errors.push(`${p.id}: unknown store evidence ${p.store.evidence}`);
    let resolved;
    try { resolved = resolveProduct(applyOwnSales(p, raw.ownSales.rows)); } catch (err) { errors.push(err.message); continue; }
    products.push(applyOverlays(resolved, manual.overlays));
  }

  // Overlays that point at nothing
  for (const key of Object.keys(manual.overlays || {})) {
    const [pid, scope] = key.split("|");
    if (!ids.has(pid)) warnings.push(`overlay ${key}: unknown product`);
    else if (scope !== "core" && !MARKETS[scope]) warnings.push(`overlay ${key}: unknown market`);
  }

  // Candidate inbox: normalised, never promoted to a profile until analysed.
  const analysedNames = new Set(products.map((p) => String(p.core?.name?.v || "").toLowerCase()));
  const candidates = (raw.candidates.candidates || []).map((c) => normaliseCandidate(c, analysedNames));
  for (const imp of raw.imports) for (const c of imp.candidates || []) candidates.push(normaliseCandidate({ ...c, importFile: imp.file }, analysedNames));

  return { evidence, evidenceIndex, products, records: all, candidates, ownSales: raw.ownSales, overlays: manual.overlays, errors, warnings };
}

function checkBlock(p, scope, block, errors, warnings) {
  if (!block) return;
  for (const [k, x] of Object.entries(block)) {
    if (STRUCTURAL.has(k)) continue;
    const f = FIELD[k];
    if (!f) { warnings.push(`${p.id}/${scope}: unknown field ${k}`); continue; }
    if (PLAIN.has(k)) continue;
    if (!isVal(x)) { errors.push(`${p.id}/${scope}.${k}: value without status`); continue; }
    if (!STATUS[x.s]) errors.push(`${p.id}/${scope}.${k}: unknown status ${x.s}`);
    if ((x.s === "E" || x.s === "V") && !(x.src && x.src.length)) errors.push(`${p.id}/${scope}.${k}: ${x.s} value without a source`);
    if (f.type === "score" && x.v != null && (typeof x.v !== "number" || x.v < 0 || x.v > 100))
      errors.push(`${p.id}/${scope}.${k}: score ${x.v} outside 0–100`);
    if ((f.type === "money" || f.type === "pct" || f.type === "num") && x.v != null && typeof x.v !== "number")
      errors.push(`${p.id}/${scope}.${k}: expected a number, got ${JSON.stringify(x.v)}`);
    if (f.scope === "market" && scope === "core") warnings.push(`${p.id}: ${k} is a market field but sits in core`);
    if (f.scope === "core" && scope !== "core") warnings.push(`${p.id}/${scope}: ${k} is a core field but sits in a market block`);
  }
}

const CURRENCY = { SE: "SEK", GB: "GBP", UK: "GBP", US: "USD" };

function normaliseCandidate(c, analysedNames) {
  const market = c.country === "GB" ? "UK" : c.country;
  const i = c.inputs || {};
  const currency = CURRENCY[c.country] || "USD";
  const vat = market === "SE" ? 0.25 : market === "UK" ? 0.2 : 0;
  const price = i.salePriceInclVat, cost = i.costPerUnitInclVat;
  let margin = null, profit = null;
  if (price && cost != null) {
    const revEx = price / (1 + vat);
    const costEx = cost / (1 + vat);
    const ship = (i.shippingCostPerOrder || 0) / (1 + vat);
    const fees = i.transactionFeePerOrder || 0;
    margin = Math.round(((revEx - costEx - ship - fees) / revEx) * 1000) / 10;
    profit = Math.round((revEx - costEx - ship - fees - (i.expectedCpaInclVat || 0) / (1 + vat)) * 100) / 100;
  }
  return {
    id: c.id, sourceId: c.sourceId, name: c.name, market, currency, niche: c.niche, notes: c.notes,
    price, cost, shipping: i.shippingCostPerOrder, fees: i.transactionFeePerOrder, cpa: i.expectedCpaInclVat,
    margin, profit, researchDate: c.researchDate, trendSource: c.trendSource, adPlan: c.adPlan || null,
    status: "AI estimated", analysed: analysedNames.has(String(c.name || "").toLowerCase()),
    importFile: c.importFile,
  };
}

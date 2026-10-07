// Your own store's sales → market values for the products you sell.
//
// The rows come from the Supabase view intel.v_own_sales (live through n8n,
// or the build-time snapshot). A row counts as Verified only when every
// order in it carries a Shopify id; hand-entered totals are self-reported
// and stay Estimated, citing the own-sales evidence record.

import { val, none } from "./provenance.js";

// The latest period per SKU.
export function latestBySku(rows) {
  const out = {};
  for (const r of rows || []) {
    const sku = r.sku;
    if (!sku) continue;
    if (!out[sku] || String(r.period) > String(out[sku].period)) out[sku] = r;
  }
  return out;
}

export function applyOwnSales(product, rows) {
  const link = product.store;
  if (!link?.sku) return product;
  const r = latestBySku(rows)[link.sku];
  if (!r) return product;
  const market = link.market || "SE";
  const mk = { ...(product.markets?.[market] || { inherit: "UK" }) };
  const verified = r.from_shop_sync === true;
  const s = verified ? "V" : "E";
  const src = [link.evidence || "own-sales"];
  const period = String(r.period).slice(0, 7);
  const how = verified ? `Your Shopify orders, ${period}.` : `Your store tables, ${period}: entered by hand without Shopify order ids, so treated as self-reported.`;
  const n = (x) => (x == null || x === "" ? null : Number(x));
  if (n(r.revenue_per_order) != null) mk.price = val(n(r.revenue_per_order), s, src, `${how} Revenue per order incl. VAT (${r.orders} orders).`);
  if (n(r.cac) != null && n(r.ad_spend) > 0) mk.cac = val(n(r.cac), s, src, `${how} Ad spend ${n(r.ad_spend)} ÷ ${r.orders} orders.`);
  if (n(r.variable_cost_per_order) != null) mk.variableCost = val(n(r.variable_cost_per_order), s, src, `${how} Product, shipping and payment fee per order, ex VAT.`);
  mk.returnRate = n(r.return_rate_pct) == null ? none("Returns are not tracked yet: the returns table is empty.") : val(n(r.return_rate_pct), s, src, `${how} Returned units ÷ units sold.`);
  mk.evidence = [...new Set([...(mk.evidence || []), ...src.filter((x) => x.startsWith("ev:"))])];
  return { ...product, markets: { ...product.markets, [market]: mk }, ownSales: { ...r, verified } };
}

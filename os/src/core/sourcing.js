// Stores selling a product and suppliers making it: where to search, the
// dropshipping stores the n8n store finder found, and the links you save on
// the product page. Search pages are linked, not read: the sites block other
// pages from loading them.

import { cleanUrl, newId, PRODUCT_ID, hostOf } from "./weblinks.js";
import { adLibraryLinks, defaultAdQuery } from "./ads.js";

export const LINK_CURRENCIES = ["USD", "CNY", "GBP", "SEK", "EUR"];
const LOCAL = { UK: "GBP", SE: "SEK" };
const GOOGLE = { UK: { gl: "uk", hl: "en-GB" }, SE: { gl: "se", hl: "sv" } };

const clip = (q) => String(q || "").trim().slice(0, 100);

// Where small dropshipping stores show up: Shopify stores on Google, and the
// advertisers in Meta's Ad Library (dropshippers sell through ads, so they
// rarely rank in ordinary search).
export function dropshipSearchLinks(query, market) {
  const q = clip(query).replace(/"/g, "");
  const g = GOOGLE[market] || GOOGLE.UK;
  return [
    { id: "shopify-google", label: "Shopify stores on Google", sub: "small stores on Shopify that mention it",
      url: `https://www.google.com/search?q=${encodeURIComponent(`"${q}" site:myshopify.com`)}&gl=${g.gl}&hl=${g.hl}` },
    { id: "advertisers", label: "Advertisers in Meta's Ad Library", sub: "stores running ads for it now; most dropshippers sell this way",
      url: adLibraryLinks(q, market)[0].url },
  ];
}

// Where Chinese suppliers list it. AliExpress takes the words in the path,
// Alibaba in the query; 1688 needs Chinese words, so it opens on its home page.
export function supplierSearchLinks(query) {
  const q = clip(query);
  const slug = q.toLowerCase().split(/\s+/).filter(Boolean).map(encodeURIComponent).join("-");
  return [
    { id: "aliexpress", label: "AliExpress", prefilled: true, sub: "single units shipped to you: samples and small tests",
      url: slug ? `https://www.aliexpress.com/w/wholesale-${slug}.html` : "https://www.aliexpress.com/" },
    { id: "alibaba", label: "Alibaba", prefilled: true, sub: "factories and trading companies: bulk prices and minimum orders",
      url: `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(q)}` },
    { id: "1688", label: "1688", prefilled: false, sub: "China's domestic wholesale prices; search in Chinese, usually through a sourcing agent",
      url: "https://www.1688.com/" },
  ];
}

// The brands the research names as market leaders, so the store finder can
// leave them out. Generic descriptions ("Amazon generics") are dropped.
// The search words to start from: the words that found the saved stores (a
// run with other words would retire them), else the product's name without
// its qualifiers ("… with thermal compartment", "… for families"), since the
// finder wants most of the words in every result.
export function finderQuery(name, stores = []) {
  const found = stores.filter((l) => l.foundBy === "search" && l.signals?.query)
    .sort((a, b) => String(b.signals.checkedAt || "").localeCompare(String(a.signals.checkedAt || "")));
  if (found.length) return String(found[0].signals.query);
  return defaultAdQuery(name).split(/\s+(?:with|for|and|in)\s+/)[0];
}

export function brandNames(leaders) {
  const seen = new Set();
  return (Array.isArray(leaders) ? leaders : [])
    .map((x) => String(x || "").replace(/\s*\([^)]*\)/g, "").trim())
    .filter((x) => x && x.length <= 60 && !/generic|stores\b|own brands?|brands that|\bused\b|\bvarious\b|\bothers?\b|garden centres/i.test(x))
    .filter((x) => !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
    .slice(0, 12);
}

// How a saved store reads on the page: found by the store finder (likely or
// possible dropshipping, with its reasons) or saved by you.
export function storeVerdict(link) {
  const sg = link?.signals;
  if (link?.foundBy === "search" && sg && (sg.label === "likely" || sg.label === "possible")) {
    return { kind: sg.label, label: sg.label === "likely" ? "Likely dropshipping" : "Possibly dropshipping", score: Number(sg.score) || 0, why: Array.isArray(sg.why) ? sg.why : [] };
  }
  return { kind: "yours", label: sg ? "Saved by you" : "", score: -1, why: Array.isArray(sg?.why) ? sg.why : [] };
}

// Likely first, then possible (highest score first), then your own, cheapest first.
export function sortStores(stores) {
  const rank = { likely: 0, possible: 1, yours: 2 };
  return [...stores].sort((a, b) => {
    const va = storeVerdict(a), vb = storeVerdict(b);
    return rank[va.kind] - rank[vb.kind] || vb.score - va.score || (a.price ?? Infinity) - (b.price ?? Infinity);
  });
}

// Check a store or supplier link the way the database will
// (intel.api_write_links). Returns { link } or { error, field }.
export function normaliseLink(input, { productId, kind, market } = {}) {
  const s = (v) => String(v ?? "").trim();
  if (!PRODUCT_ID.test(productId || "")) return { error: "This product cannot have links saved.", field: "url" };
  if (!["store", "supplier"].includes(kind)) return { error: "Unknown kind of link.", field: "url" };
  if (kind === "store" && !/^[A-Z]{2}$/.test(market || "")) return { error: "Pick a market first.", field: "url" };
  const u = cleanUrl(input.url);
  if (u.error) return { error: s(input.url) ? u.error : `Paste the link to the ${kind === "store" ? "store's product page" : "supplier's listing"}.`, field: "url" };
  const name = s(input.name);
  if (name.length > 200) return { error: "Keep the name under 200 characters.", field: "name" };
  let price = null;
  const rawPrice = s(input.price).replace(/\s/g, "").replace(",", ".").replace(/^[£$€¥]|kr$|sek$|usd$/i, "");
  if (rawPrice) {
    price = Number(rawPrice);
    if (!Number.isFinite(price) || price < 0 || price >= 1e7) return { error: "Enter the price as a number, such as 12.50.", field: "price" };
    price = Math.round(price * 100) / 100;
  }
  const currency = s(input.currency).toUpperCase() || (kind === "store" ? LOCAL[market] || "GBP" : "USD");
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "Pick a currency.", field: "currency" };
  let moq = null;
  if (kind === "supplier" && s(input.moq)) {
    moq = Number(s(input.moq).replace(/[\s,]/g, ""));
    if (!Number.isInteger(moq) || moq < 1 || moq > 1e7) return { error: "The minimum order is a whole number of units, such as 100.", field: "moq" };
  }
  const note = s(input.note);
  if (note.length > 1000) return { error: "Keep the note under 1,000 characters.", field: "note" };
  return { link: {
    id: input.id || newId(), productId, kind, market: kind === "store" ? market : null, url: u.url,
    name: name || null, price, currency: price == null ? null : currency, moq, note: note || null,
  } };
}

const median = (xs) => { const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

// How many dropshipping stores sell it, and what they charge next to your
// own price (same currency only).
export function storeSummary(stores, { price, currency } = {}) {
  if (!stores.length) return { text: "No stores yet. Find dropshipping stores above, or save one you found yourself.", tone: "" };
  const kinds = stores.map((l) => storeVerdict(l).kind);
  const likely = kinds.filter((k) => k === "likely").length, possible = kinds.filter((k) => k === "possible").length;
  const n = (x, one, many = one + "s") => `${x} ${x === 1 ? one : many}`;
  const found = likely + possible
    ? `${n(likely + possible, "store")} look${likely + possible === 1 ? "s" : ""} like dropshipping (${likely} likely, ${possible} possible). `
    : "";
  const priced = stores.filter((l) => l.price != null && l.currency === currency).map((l) => Number(l.price));
  if (!priced.length) return { text: `${found}Add prices in ${currency} to compare the stores with yours.`.trim(), tone: "", likely, possible };
  const lo = Math.min(...priced), hi = Math.max(...priced), med = median(priced);
  let where = "";
  if (Number.isFinite(price)) {
    const below = priced.filter((x) => x < price).length;
    where = price < lo ? " You are cheaper than all of them." : price > hi ? " You are dearer than all of them: the product page has to justify it." : ` ${below} of ${priced.length} charge less than you.`;
  }
  return { lo, hi, med, count: priced.length, likely, possible, tone: Number.isFinite(price) && price > hi ? "warn" : "",
    text: `${found}${found ? "They charge" : stores.length === 1 ? "The saved store charges" : "Saved stores charge"} ${fmtMoney(lo, currency)}${hi !== lo ? `–${fmtMoney(hi, currency)}` : ""}${priced.length > 2 ? ` (median ${fmtMoney(med, currency)})` : ""}.${where}` };
}

// The cheapest saved quote in USD against the analysis' supplier price.
export function supplierSummary(suppliers, estimateUSD) {
  if (!suppliers.length) return { text: "No suppliers saved yet. Search AliExpress or Alibaba above and save the listings worth asking for a quote.", tone: "" };
  const usd = suppliers.filter((l) => l.price != null && l.currency === "USD");
  if (!usd.length) return { text: `${suppliers.length} supplier${suppliers.length === 1 ? "" : "s"} saved. Add a unit price in USD to compare it with the analysis.`, tone: "" };
  const best = usd.reduce((a, b) => (Number(b.price) < Number(a.price) ? b : a));
  const vs = Number.isFinite(estimateUSD) && estimateUSD > 0
    ? (Number(best.price) <= estimateUSD ? ` That is at or below the analysis' $${estimateUSD.toFixed(2)}.` : ` That is above the analysis' $${estimateUSD.toFixed(2)}: the margins on this page are optimistic until you find a cheaper quote.`)
    : "";
  return { best, tone: Number.isFinite(estimateUSD) && Number(best.price) > estimateUSD ? "warn" : "", text: `Cheapest saved quote: $${Number(best.price).toFixed(2)} per unit${best.moq ? ` at a minimum order of ${best.moq}` : ""}${best.name ? ` from ${best.name}` : ""}.${vs}` };
}

export function fmtMoney(v, currency) {
  if (v == null || !Number.isFinite(Number(v))) return "";
  const n = Number(v);
  const sym = { GBP: "£", USD: "$", EUR: "€" }[currency];
  const num = n.toFixed(n % 1 ? 2 : 0);
  if (sym) return `${sym}${num}`;
  if (currency === "SEK") return `${num} kr`;
  if (currency === "CNY") return `¥${num}`;
  return `${num} ${currency || ""}`.trim();
}

export { hostOf };

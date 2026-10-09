// Stores selling a product and suppliers making it: where to search, what
// the research already names, and the links you save on the product page.
// Search pages are linked, not read: the shops and marketplaces block other
// pages from loading them.

import { cleanUrl, newId, PRODUCT_ID, hostOf } from "./weblinks.js";

export const LINK_CURRENCIES = ["USD", "CNY", "GBP", "SEK", "EUR"];
const LOCAL = { UK: "GBP", SE: "SEK" };
const GOOGLE = { UK: { gl: "uk", hl: "en-GB", where: "the UK" }, SE: { gl: "se", hl: "sv", where: "Sweden" } };
const AMAZON = { UK: ["www.amazon.co.uk", "Amazon UK"], SE: ["www.amazon.se", "Amazon.se"] };

const clip = (q) => String(q || "").trim().slice(0, 100);

// Marketplaces and shops selling it in one market.
export function storeSearchLinks(query, market) {
  const enc = encodeURIComponent(clip(query));
  const g = GOOGLE[market] || GOOGLE.UK;
  const [amazonHost, amazonLabel] = AMAZON[market] || AMAZON.UK;
  const links = [
    { id: "google-shopping", label: "Google Shopping", sub: `shops selling it in ${g.where}, with prices`,
      url: `https://www.google.com/search?q=${enc}&udm=28&gl=${g.gl}&hl=${g.hl}` },
    { id: "amazon", label: amazonLabel, sub: "listings, prices and review counts", url: `https://${amazonHost}/s?k=${enc}` },
  ];
  if (market !== "SE") links.push({ id: "ebay", label: "eBay UK", sub: "new and used listings, sold counts", url: `https://www.ebay.co.uk/sch/i.html?_nkw=${enc}` });
  links.push({ id: "etsy", label: "Etsy", sub: "handmade and personalised versions", url: `https://www.etsy.com/search?q=${enc}` });
  return links;
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

// Brands and shops the research names as market leaders, searched together
// with the product. Generic descriptions ("Amazon generics") are left out.
export function namedSellers(leaders, query, market) {
  const g = GOOGLE[market] || GOOGLE.UK;
  const list = Array.isArray(leaders) ? leaders : [];
  const seen = new Set();
  return list
    .map((x) => String(x || "").replace(/\s*\([^)]*\)/g, "").trim())
    .filter((x) => x && x.length <= 60 && !/generic|stores\b|own brands|brands that|\bused\b|\bvarious\b|\bothers?\b/i.test(x))
    .filter((x) => !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
    .slice(0, 8)
    .map((name) => ({ name, url: `https://www.google.com/search?q=${encodeURIComponent(`${name} ${clip(query)}`)}&gl=${g.gl}&hl=${g.hl}` }));
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

// What saved store prices say next to your own price (same currency only).
export function storeSummary(stores, { price, currency } = {}) {
  const priced = stores.filter((l) => l.price != null && l.currency === currency).map((l) => Number(l.price));
  if (!stores.length) return { text: "No stores saved yet. Open a search above and save the shops that sell this product.", tone: "" };
  if (!priced.length) return { text: `${stores.length} store${stores.length === 1 ? "" : "s"} saved. Add their prices in ${currency} to compare them with yours.`, tone: "" };
  const lo = Math.min(...priced), hi = Math.max(...priced), med = median(priced);
  let where = "";
  if (Number.isFinite(price)) {
    const below = priced.filter((x) => x < price).length;
    where = price < lo ? " You are cheaper than every saved store." : price > hi ? " You are dearer than every saved store: the product page has to justify it." : ` ${below} of ${priced.length} saved store${priced.length === 1 ? "" : "s"} charge less than you.`;
  }
  return { lo, hi, med, count: priced.length, tone: Number.isFinite(price) && price > hi ? "warn" : "", text: `Saved stores charge ${fmtMoney(lo, currency)}${hi !== lo ? `–${fmtMoney(hi, currency)}` : ""}${priced.length > 2 ? ` (median ${fmtMoney(med, currency)})` : ""}.${where}` };
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

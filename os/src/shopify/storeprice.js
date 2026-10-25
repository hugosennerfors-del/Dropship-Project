// The price a competitor's store asks for the product its ad links to.
//
// Shopify stores answer /products/<handle>.js with the product and its
// variants (prices in the store's minor unit, so 1599 is 15.99),
// /collections/<handle>/products.json with a collection's products (prices
// as decimals) and /cart.js with the currency the store sells in. Only
// those public JSON addresses are read, on the ad's own https host;
// anything that is not a Shopify product or collection page gives no
// price. For a product, the lowest price of an available variant is the
// one a buyer of one unit pays. For a collection, its first product's
// price stands for it: a collection lists products in the store's own
// order, which puts what it promotes first, whereas a median is pulled
// down by cheaper sizes (a robe collection with children's robes).
//
// `fetch` is injected: the edge function passes the real one, tests a fake.

const HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
// Letters and digits in any script, combining marks and signs such as ® and ™
// (a handle like "retropia®-retro-flash"); encodeURIComponent escapes them.
const HANDLE = /^[\p{L}\p{N}\p{M}\p{So}._-]{1,255}$/u;
const MAX_BYTES = 2_000_000;
const COLLECTION_PRODUCTS = 10;

// Where the price is read for a landing page, and the store's cart.js, or null.
export function productJsUrl(landingPage) {
  let u;
  try { u = new URL(String(landingPage || "")); } catch { return null; }
  if (u.protocol !== "https:" || u.port || u.username || !HOST.test(u.hostname)) return null;
  const host = u.hostname.toLowerCase();
  const handleOf = (m) => { try { const h = decodeURIComponent(m[1]).replace(/\.(js|json)$/, ""); return HANDLE.test(h) ? h : null; } catch { return null; } };
  const cartUrl = `https://${host}/cart.js`;
  const p = u.pathname.match(/\/products\/([^/?#]+)/);
  if (p) {
    const handle = handleOf(p);
    return handle ? { kind: "product", host, handle, url: `https://${host}/products/${encodeURIComponent(handle)}.js`, cartUrl } : null;
  }
  const c = u.pathname.match(/\/collections\/([^/?#]+)\/?$/);
  const handle = c && handleOf(c);
  return handle && handle !== "all" ? { kind: "collection", host, handle, url: `https://${host}/collections/${encodeURIComponent(handle)}/products.json?limit=${COLLECTION_PRODUCTS}`, cartUrl } : null;
}

// { title, price, compareAt, maxPrice, variants } for a collection: its
// first product's lowest available price, with the range in the title.
export function readCollection(j, handle) {
  const lows = (Array.isArray(j?.products) ? j.products : []).map((p) => {
    const vs = (Array.isArray(p?.variants) ? p.variants : []).filter((v) => Number.isFinite(Number(v?.price)) && Number(v.price) > 0);
    const pool = vs.filter((v) => v.available !== false);
    return (pool.length ? pool : vs).reduce((min, v) => Math.min(min, Number(v.price)), Infinity);
  }).filter(Number.isFinite);
  if (!lows.length) return null;
  const lo = Math.min(...lows), hi = Math.max(...lows);
  return { title: `Collection “${handle}”: first of ${lows.length} product${lows.length === 1 ? "" : "s"}${lo !== hi ? ` (${lo}–${hi})` : ""}`,
    price: Math.round(lows[0] * 100) / 100, compareAt: null, maxPrice: hi, variants: lows.length, from: "collection" };
}

async function getJson(fetchImpl, url, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; Plan-vy price check)" }, signal: ctl.signal, redirect: "follow" });
    if (!res.ok) return { status: res.status };
    const text = await res.text();
    if (text.length > MAX_BYTES) return { status: "too-large" };
    try { return { json: JSON.parse(text) }; } catch { return { status: "not-json" }; }
  } catch (e) {
    return { status: e?.name === "AbortError" ? "timeout" : "network" };
  } finally { clearTimeout(t); }
}

// { title, price, compareAt, maxPrice, variants } from a product's .js JSON.
export function readProduct(p) {
  const variants = Array.isArray(p?.variants) ? p.variants.filter((v) => Number.isFinite(Number(v?.price))) : [];
  if (!variants.length) return null;
  const sellable = variants.filter((v) => v.available !== false);
  const pool = sellable.length ? sellable : variants;
  const cheapest = pool.reduce((a, b) => (Number(b.price) < Number(a.price) ? b : a));
  const cents = (x) => Math.round(Number(x)) / 100;
  const compare = Number(cheapest.compare_at_price);
  return {
    title: String(p.title || "").replace(/\s+/g, " ").trim().slice(0, 200) || null,
    price: cents(cheapest.price),
    compareAt: Number.isFinite(compare) && compare > Number(cheapest.price) ? cents(compare) : null,
    maxPrice: cents(Math.max(...pool.map((v) => Number(v.price)))),
    variants: variants.length,
    from: "product",
  };
}

export async function storePrice({ fetch: fetchImpl, landingPage, timeoutMs = 8000, currencies = new Map() }) {
  const at = productJsUrl(landingPage);
  if (!at) return { error: "not-a-product-page" };
  const r = await getJson(fetchImpl, at.url, timeoutMs);
  if (!r.json) return { error: `${at.kind} ${r.status}` };
  const product = at.kind === "collection" ? readCollection(r.json, at.handle) : readProduct(r.json);
  if (!product) return { error: "no-price" };
  // One cart.js per store; `currencies` caches it across the ads of a search.
  if (!currencies.has(at.host)) {
    const c = await getJson(fetchImpl, at.cartUrl, timeoutMs);
    currencies.set(at.host, /^[A-Z]{3}$/.test(String(c.json?.currency || "")) ? c.json.currency : null);
  }
  return { ...product, currency: currencies.get(at.host), host: at.host };
}

// Prices for many landing pages: one request per product, a few at a time.
export async function storePrices({ fetch: fetchImpl, landingPages, max = 8, concurrency = 4, timeoutMs }) {
  const byUrl = new Map();
  for (const lp of landingPages) {
    const at = productJsUrl(lp);
    if (at && !byUrl.has(at.url) && byUrl.size < max) byUrl.set(at.url, lp);
  }
  const currencies = new Map(), found = new Map();
  const jobs = [...byUrl.values()];
  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    const res = await Promise.all(batch.map((lp) => storePrice({ fetch: fetchImpl, landingPage: lp, timeoutMs, currencies })));
    batch.forEach((lp, k) => found.set(productJsUrl(lp).url, res[k]));
  }
  // Every landing page (with its own query string) maps to its product's price.
  return (lp) => { const at = productJsUrl(lp); return at ? found.get(at.url) || null : null; };
}

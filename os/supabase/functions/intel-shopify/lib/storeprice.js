// The price a competitor's store asks for the product its ad links to.
//
// Shopify stores answer /products/<handle>.js with the product and its
// variants (prices in the store's minor unit, so 1599 is 15.99) and
// /cart.js with the currency the store sells in. Only those two public JSON
// addresses are read, on the ad's own https host; anything that is not a
// Shopify product page gives no price. The lowest price of an available
// variant is the one a buyer of one unit pays.
//
// `fetch` is injected: the edge function passes the real one, tests a fake.

const HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const MAX_BYTES = 2_000_000;

// The product's .js address and the store's cart.js, or null.
export function productJsUrl(landingPage) {
  let u;
  try { u = new URL(String(landingPage || "")); } catch { return null; }
  if (u.protocol !== "https:" || u.port || u.username || !HOST.test(u.hostname)) return null;
  const m = u.pathname.match(/\/products\/([^/?#]+)/);
  if (!m) return null;
  let handle;
  try { handle = decodeURIComponent(m[1]).replace(/\.(js|json)$/, ""); } catch { return null; }
  if (!/^[\p{L}\p{N}._-]{1,255}$/u.test(handle)) return null;
  const host = u.hostname.toLowerCase();
  return { host, handle, url: `https://${host}/products/${encodeURIComponent(handle)}.js`, cartUrl: `https://${host}/cart.js` };
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
  };
}

export async function storePrice({ fetch: fetchImpl, landingPage, timeoutMs = 8000, currencies = new Map() }) {
  const at = productJsUrl(landingPage);
  if (!at) return { error: "not-a-product-page" };
  const r = await getJson(fetchImpl, at.url, timeoutMs);
  if (!r.json) return { error: `product ${r.status}` };
  const product = readProduct(r.json);
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

// GetHookd (an index of Meta's ad library) for the product page: one search
// for the ads running now for a product in a market. The edge function
// makes the call with the API key from Vault; the page never sees the key.
//
// GetHookd is an MCP server over HTTP (JSON-RPC "tools/call"). search_ads is
// billed per ad returned (about 0.01 credit each), so a search asks for a
// handful of ads, at most two per advertiser, and only those running now.
//
// `fetch` is injected: the edge function passes the real one, tests a fake.

export const GETHOOKD_MCP = "https://app.gethookd.ai/api/mcp/v1";
export const HOOKD_MAX = 20;
export const HOOKD_FIELDS = "id,brand,title,hook,platform,countries,start_date,days_active,status,performance_score,performance_score_title,landing_page,shop_id,share_url,eu_total_reach,ad_spend_range_score_title";
const COUNTRY = { UK: "GB", SE: "SE" };

export class HookdError extends Error {
  constructor(kind, message) { super(message); this.name = "HookdError"; this.kind = kind; }
}

const num = (x) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
const str = (x, n) => (x == null ? null : String(x).replace(/\s+/g, " ").trim().slice(0, n) || null);

export function searchArguments({ query, market, limit = 10 }) {
  return {
    query: String(query || "").replace(/\s+/g, " ").trim().slice(0, 80),
    geo: COUNTRY[market] || "GB",
    status: "active",
    limit: Math.max(1, Math.min(HOOKD_MAX, Math.round(Number(limit) || 10))),
    ads_per_brand_limit: 2,
    compact: true,
    fields: HOOKD_FIELDS,
  };
}

// One tool call. Returns the JSON block of the answer (GetHookd sends one
// JSON text block, then a text card and images per ad). A 429 (too many
// calls at once) is tried again after a pause, at most `retries` times: a
// refused call has not been run, so nothing is billed twice.
export async function callTool({ key, fetch: fetchImpl, name, args, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), retries = 3, random = Math.random }) {
  if (!key) throw new HookdError("config", "GetHookd is not connected: save the API key in Supabase Vault as gethookd_api_key.");
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetchImpl(GETHOOKD_MCP, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      });
    } catch (e) {
      throw new HookdError("network", `GetHookd could not be reached (${String(e?.message || e).slice(0, 120)}).`);
    }
    if (res.status !== 429 || attempt >= retries) break;
    const after = Number(res.headers?.get?.("retry-after"));
    await sleep(after > 0 ? Math.min(5, after) * 1000 : 1000 * 2 ** attempt * (0.75 + random() * 0.5));
  }
  if (res.status === 429) throw new HookdError("busy", "GetHookd answered 429 (too many calls at once) several times; try again in a minute.");
  if (res.status === 401) throw new HookdError("auth", "GetHookd did not accept the API key. Create a new key in GetHookd and save it in Supabase Vault as gethookd_api_key.");
  if (res.status === 402) throw new HookdError("credits", "The GetHookd account has run out of credits.");
  if (res.status === 403) throw new HookdError("scope", "The GetHookd key is not allowed to search ads.");
  if (!res.ok) throw new HookdError("http", `GetHookd answered ${res.status}.`);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch {
    // A streamable-HTTP server may answer as server-sent events.
    const line = text.split("\n").reverse().find((l) => l.startsWith("data:"));
    try { body = line ? JSON.parse(line.slice(5)) : null; } catch { body = null; }
  }
  if (!body) throw new HookdError("format", "GetHookd's answer could not be read.");
  if (body.error) throw new HookdError("rpc", `GetHookd: ${String(body.error.message || "error").slice(0, 200)}`);
  const blocks = (body.result?.content || []).filter((c) => c?.type === "text");
  for (const b of blocks) {
    try { const j = JSON.parse(b.text); if (j && typeof j === "object") return j; } catch { /* a text card */ }
  }
  throw new HookdError("format", String(blocks[0]?.text || "GetHookd returned no data.").slice(0, 300));
}

export function normaliseHookdAd(r) {
  if (!r || typeof r !== "object" || !r.id) return null;
  let landingDomain = null, landingPage = null;
  try {
    const u = r.landing_page ? new URL(r.landing_page) : null;
    landingDomain = u ? u.hostname.replace(/^www\./, "") : null;
    landingPage = u && u.protocol === "https:" && String(r.landing_page).length <= 500 ? u.href : null;
  } catch { landingDomain = null; }
  const share = /^https:\/\/app\.gethookd\.ai\//.test(String(r.share_url || "")) ? String(r.share_url) : null;
  const countries = Array.isArray(r.countries) ? [...new Set(r.countries.map((c) => String(c).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))].slice(0, 40) : [];
  return {
    adId: String(r.id),
    advertiser: str(r.brand?.name, 200),
    brandId: r.brand?.id ?? null,
    brandActiveAds: num(r.brand?.active_ads),
    title: str(r.title, 200),
    hook: str(r.hook, 300),
    startedOn: /^\d{4}-\d{2}-\d{2}$/.test(String(r.start_date || "")) ? r.start_date : null,
    daysActive: num(r.days_active),
    stillRunning: r.status !== "inactive",
    performance: num(r.performance_score),
    performanceTitle: str(r.performance_score_title, 40),
    landingDomain,
    shareUrl: share,
    landingPage,
    shopId: num(r.shop_id),
    countries,
    // Meta publishes reach only for the part of an ad shown in the EU.
    euReach: num(r.eu_total_reach),
    spendRange: str(r.ad_spend_range_score_title, 40),
  };
}

// The JSON block of a search_ads answer → { ads, summary }.
export function readSearch(json) {
  if (json?.status === "needs_input") throw new HookdError("survey", "GetHookd wants its connect survey answered or skipped before it searches. Answer it in GetHookd, or ask the assistant that connected it to skip it.");
  if (json?.errors) throw new HookdError("api", str(json.message || json.error?.message || json.code, 300) || "GetHookd refused the search.");
  const ads = (Array.isArray(json?.data) ? json.data : []).map(normaliseHookdAd).filter(Boolean);
  return {
    ads,
    summary: {
      total: num(json?.meta?.total), matched: num(json?.meta?.total_ads_matched),
      brands: new Set(ads.map((a) => a.brandId ?? a.advertiser)).size,
      usedCredits: num(json?.used_credits), remainingCredits: num(json?.remaining_credits), asOf: json?.meta?.as_of || null,
    },
  };
}

export async function searchAds({ key, fetch: fetchImpl, query, market, limit }) {
  const args = searchArguments({ query, market, limit });
  if (args.query.length < 2) throw new HookdError("input", "Give the search at least two characters.");
  return readSearch(await callTool({ key, fetch: fetchImpl, name: "search_ads", args }));
}

// What the revenue estimate (core/adrevenue.js) reads from a saved ad:
// where it runs, its EU reach, how long it had run when checked, and the
// price on the store it links to (storeprice.js) when that was found.
export function adMetrics(ad, { today, price = null, store = null } = {}) {
  return {
    source: "gethookd", adId: ad.adId, countries: ad.countries || [], euReach: ad.euReach ?? null, spendRange: ad.spendRange ?? null,
    performance: ad.performance ?? null, performanceTitle: ad.performanceTitle ?? null, daysActive: ad.daysActive ?? null,
    checkedAt: today, landingPage: ad.landingPage ?? null, shopId: ad.shopId ?? null,
    ...(price && !price.error ? { price: price.price, compareAt: price.compareAt, currency: price.currency, productTitle: price.title, priceFrom: price.from || "product", priceCheckedAt: today } : {}),
    ...(store ? { store } : {}),
  };
}

// A found ad as the fields of a saved ad. The edge function saves these with
// intel.gethookd_save_ads, which applies ads.save's limits.
export function savedAdInput(ad, { today = new Date().toISOString().slice(0, 10), price = null } = {}) {
  const note = [
    "GetHookd",
    ad.performanceTitle ? `performance ${ad.performanceTitle}${ad.performance != null ? ` (${ad.performance})` : ""}` : null,
    ad.brandActiveAds != null ? `${ad.brandActiveAds} active ads from this advertiser` : null,
    ad.landingDomain ? `lands on ${ad.landingDomain}` : null,
    ad.title,
  ].filter(Boolean).join(" · ").slice(0, 1000);
  return { url: ad.shareUrl, platform: "meta", advertiser: ad.advertiser, startedOn: ad.startedOn, stillRunning: ad.stillRunning, angle: (ad.hook || ad.title || "").slice(0, 300), note,
    metrics: adMetrics(ad, { today, price }) };
}

// GetHookd's id for a saved ad, from its share link.
export const hookdAdId = (url) => (String(url || "").match(/^https:\/\/app\.gethookd\.ai\/share\/ad\/(\d{1,15})(?:[?#]|$)/) || [])[1] || null;

// One ad, fresh: get_ad is free. Returns the same shape as a search row.
export async function getAd({ key, fetch: fetchImpl, adId }) {
  const json = await callTool({ key, fetch: fetchImpl, name: "get_ad", args: { ad_id: Number(adId) } });
  if (json?.errors) throw new HookdError("api", str(json.message || json.error?.message || json.code, 300) || "GetHookd could not read the ad.");
  const ad = normaliseHookdAd(json?.data);
  if (!ad) throw new HookdError("format", "GetHookd returned no ad.");
  return ad;
}

// A store's estimated monthly visits (about 0.1 credit per store).
export async function getShopTraffic({ key, fetch: fetchImpl, shopId, today }) {
  const json = await callTool({ key, fetch: fetchImpl, name: "get_shop_traffic", args: { shop_id: Number(shopId), window: 90 } });
  if (json?.errors) throw new HookdError("api", str(json.message || json.error?.message || json.code, 300) || "GetHookd could not read the store's traffic.");
  const points = (Array.isArray(json?.data?.points) ? json.data.points : []).filter((p) => num(p?.monthly_visits) != null && /^\d{4}-\d{2}/.test(String(p?.date || "")));
  const last = points.at(-1);
  return {
    store: last ? { shopId: Number(shopId), visits: num(last.monthly_visits), month: String(last.date).slice(0, 7), checkedAt: today } : { shopId: Number(shopId), visits: null, month: null, checkedAt: today },
    usedCredits: num(json?.used_credits), remainingCredits: num(json?.remaining_credits),
  };
}

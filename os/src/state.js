// App state: the research database, your edits and the derived rows.
//
// Where the data lives, in order of preference:
//   1. Supabase (schema intel) through the n8n workflow Intelligence-DB:
//      research analyses (versioned), your verified values, agent runs,
//      settings, watchlist and your store's sales, live.
//   2. The snapshot embedded in the page at build time (always present).
//   3. The page's own storage, for edits made while n8n is unreachable.
// Browser storage only keeps view preferences.

import { buildProduct, rowOf } from "./core/profile.js";
import { resolveProduct } from "./core/inherit.js";
import { applyOwnSales } from "./core/ownsales.js";
import { MARKETS, PRIMARY_MARKET } from "./core/markets.js";
import { liveAvailable, liveRead, liveWrite, MCP_FIX } from "./live.js";

const DB_PREFIX = "intel";
const listeners = new Set();

export const store = {
  dataset: null,
  evidenceIndex: {},
  market: PRIMARY_MARKET,
  overlays: {},
  settings: { markets: {} },
  liveProducts: {},       // research records changed in Supabase since the snapshot
  userProducts: [],       // agent, manual and imported products
  ownSalesRows: [],
  candidates: null,       // live inbox, loaded on demand
  runs: [],
  watch: [],
  compare: [],
  db: null,
  dbState: "connecting",
  live: { state: "connecting", error: "", at: null, info: null },
  sample: null,
  sampleState: "connecting",
  tools: false,
  version: 0,
};

let cache = { version: -1, built: null, rows: {} };

export function init(dataset) {
  store.dataset = dataset;
  store.evidenceIndex = Object.fromEntries(dataset.evidence.map((e) => [e.id, e]));
  store.overlays = { ...(dataset.overlays || {}) };
  store.ownSalesRows = dataset.ownSales?.rows || [];
  const pref = loadPref();
  if (pref.market && MARKETS[pref.market]) store.market = pref.market;
  if (Array.isArray(pref.compare)) store.compare = pref.compare.slice(0, 5);
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function changed(what) {
  store.version++;
  for (const fn of listeners) fn(what);
}

// ── Derived data ───────────────────────────────────────────────────────
export function allProducts() { rebuild(); return cache.built; }
export function rows(market = store.market) { rebuild(); return cache.rows[market] || []; }
export function product(id) { return allProducts().find((p) => p.id === id) || null; }
export function row(id, market = store.market) { return rows(market).find((r) => r.id === id) || null; }

function rebuild() {
  if (cache.version === store.version && cache.built) return;
  const research = store.dataset.products.map((p) => store.liveProducts[p.id] || p);
  const known = new Set(research.map((p) => p.id));
  const extra = Object.values(store.liveProducts).filter((p) => !known.has(p.id) && (p.source || "research") === "research");
  const records = [...research, ...extra, ...store.userProducts].filter((p) => !p.archived);
  const built = [];
  for (const rec of records) {
    try {
      const resolved = resolveProduct(applyOwnSales(rec, store.ownSalesRows));
      built.push(buildProduct(resolved, store.evidenceIndex, store.settings, store.overlays));
    } catch (e) {
      console.warn("Skipped a product that could not be built:", rec?.id, e);
    }
  }
  const out = {};
  for (const code of Object.keys(MARKETS)) out[code] = built.map((b) => rowOf(b, code)).filter(Boolean);
  cache = { version: store.version, built, rows: out };
}

// ── Preferences (this browser only) ───────────────────────────────────
const PREF_KEY = "planvy-intel-pref";
function loadPref() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); } catch { return {}; }
}
export function savePref(patch) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...loadPref(), ...patch })); } catch { /* convenience only */ }
}
export function setMarket(code) {
  if (!MARKETS[code] || store.market === code) return;
  store.market = code;
  savePref({ market: code });
  changed("market");
}
export function toggleCompare(id) {
  const i = store.compare.indexOf(id);
  if (i >= 0) store.compare.splice(i, 1);
  else if (store.compare.length < 5) store.compare.push(id);
  else return false;
  savePref({ compare: store.compare });
  changed("compare");
  return true;
}

// ── Connecting ─────────────────────────────────────────────────────────
export async function connect(claude) {
  const use = async (name) => {
    try { return claude && claude.use ? await claude.use(name) : null; } catch { return null; }
  };
  const [db, sample, hasLive] = await Promise.all([use("db"), use("sample"), liveAvailable(claude)]);
  store.sample = sample;
  store.sampleState = sample ? "ready" : "unavailable";
  if (sample) {
    try { store.tools = !!(await sample.limits())?.tools; } catch { store.tools = false; }
  }
  store.db = db;
  store.dbState = db ? "ready" : "offline";
  changed("connect");

  // Edits saved in the page's own storage while n8n was unreachable.
  if (db) await loadPageStore(db);

  if (hasLive) await refreshLive();
  else { store.live = { state: "offline", error: "The n8n connector is not available in this view.", at: null }; changed("live"); }
}

export async function refreshLive() {
  store.live = { ...store.live, state: "connecting", error: "" };
  changed("live");
  try {
    const r = await liveRead({ since: store.dataset.meta.generated });
    applyLive(r);
    store.live = { state: "ready", error: "", at: r.generatedAt, info: { evidenceCount: r.evidenceCount, inbox: r.inbox, lastPipelineRun: r.lastPipelineRun, productIndex: r.productIndex } };
  } catch (e) {
    store.live = { state: "offline", error: MCP_FIX[e?.code] || e?.message || "The live database could not be reached.", at: null };
  }
  changed("live");
}

function applyLive(r) {
  for (const e of r.evidence || []) {
    store.evidenceIndex[e.id] = e;
    const i = store.dataset.evidence.findIndex((x) => x.id === e.id);
    if (i >= 0) store.dataset.evidence[i] = e; else store.dataset.evidence.push(e);
  }
  const liveProducts = {}, userProducts = [];
  for (const p of r.products || []) {
    if ((p.source || "research") === "research") liveProducts[p.id] = p;
    else userProducts.push(p);
  }
  // Research products archived in the database disappear from the page too.
  for (const [id, x] of Object.entries(r.productIndex || {})) if (x.archived) liveProducts[id] = { ...(liveProducts[id] || { id }), archived: true };
  store.liveProducts = liveProducts;
  store.userProducts = userProducts;
  store.overlays = { ...(store.dataset.overlays || {}), ...(r.overlays || {}) };
  store.runs = r.runs || [];
  store.settings = { markets: r.settings?.markets || {} };
  store.watch = r.settings?.watch || [];
  if (Array.isArray(r.ownSales) && r.ownSales.length) store.ownSalesRows = r.ownSales.map((x) => ({ ...x, period: String(x.period).slice(0, 10) }));
}

export async function loadCandidates() {
  if (store.live.state !== "ready") return store.dataset.candidates;
  const r = await liveRead({ since: "9999-01-01T00:00:00Z", candidates: true });
  store.candidates = (r.candidates || []).map((c) => normaliseCandidate(c));
  changed("candidates");
  return store.candidates;
}

function normaliseCandidate(c) {
  const market = c.country === "GB" ? "UK" : c.country;
  const i = c.inputs || {};
  const vat = market === "SE" ? 0.25 : market === "UK" ? 0.2 : 0;
  const price = Number(i.salePriceInclVat) || null, cost = Number(i.costPerUnitInclVat);
  let margin = null;
  if (price) {
    const revEx = price / (1 + vat);
    margin = Math.round(((revEx - cost / (1 + vat) - (Number(i.shippingCostPerOrder) || 0) / (1 + vat) - (Number(i.transactionFeePerOrder) || 0)) / revEx) * 1000) / 10;
  }
  return { id: c.id, sourceId: c.sourceId, name: c.name, market, currency: { SE: "SEK", UK: "GBP", US: "USD" }[market] || "USD", niche: c.niche, notes: c.notes,
    price, cost, cpa: Number(i.expectedCpaInclVat) || null, margin, researchDate: c.researchDate, trendSource: c.trendSource, adPlan: c.adPlan || null,
    status: "AI estimated", analysed: !!c.analysed };
}

// ── Page storage fallback ──────────────────────────────────────────────
async function loadPageStore(db) {
  try {
    const [ov, up, runs] = await Promise.all([
      db.collection(`${DB_PREFIX}_overlays`).limit(1000).get(),
      db.collection(`${DB_PREFIX}_products`).limit(500).get(),
      db.collection(`${DB_PREFIX}_runs`).orderBy("createdAt", "desc").limit(200).get(),
    ]);
    for (const d of ov.docs) { const x = d.data(); if (x?.key && x.value) store.overlays[x.key] = x.value; }
    for (const d of up.docs) { const p = d.data(); if (p?.id && p.core && !store.userProducts.some((u) => u.id === p.id)) store.userProducts.push(p); }
    for (const d of runs.docs) { const r = { id: d.id, ...d.data() }; if (!store.runs.some((x) => x.id === r.id)) store.runs.push(r); }
    changed("pagestore");
  } catch { store.dbState = "offline"; }
}

const live = () => store.live.state === "ready";
const docId = (key) => key.replace(/\|/g, "~").replace(/[^A-Za-z0-9_.~:@+-]/g, "_");

async function write(action, payload, fallback) {
  if (live()) {
    try { await liveWrite(action, payload); return { ok: true, where: "supabase" }; }
    catch (e) { return { ok: false, reason: e?.code === "db_error" ? `The database refused the change: ${e.message}` : (MCP_FIX[e?.code] || e?.message || "The change could not be saved.") }; }
  }
  if (store.db && fallback) {
    try { await fallback(store.db); return { ok: true, where: "page", note: "Saved in the page; it reaches Supabase only when n8n is connected." }; }
    catch (e) { return { ok: false, reason: dbMessage(e) }; }
  }
  return { ok: false, reason: "Saved for this visit only: neither the live database nor the page storage is available here." };
}

export async function setOverlay(key, value) {
  if (value == null) delete store.overlays[key]; else store.overlays[key] = value;
  changed("overlay");
  return value == null
    ? write("overlay.remove", { key }, (db) => db.collection(`${DB_PREFIX}_overlays`).doc(docId(key)).delete())
    : write("overlay.set", { key, value }, (db) => db.collection(`${DB_PREFIX}_overlays`).doc(docId(key)).set({ key, value, at: new Date().toISOString() }));
}

export async function saveSettings(settings) {
  store.settings = settings;
  changed("settings");
  return write("settings.save", { markets: settings.markets || {} }, (db) => db.doc(`${DB_PREFIX}/settings`).set(settings));
}

export async function saveUserProduct(p) {
  const i = store.userProducts.findIndex((x) => x.id === p.id);
  if (i >= 0) store.userProducts[i] = p; else store.userProducts.push(p);
  changed("products");
  return write("product.save", { record: p, analyst: p.source === "agent" ? "claude-agent-profiler" : "page", note: p.fromCandidate ? `From inbox candidate ${p.fromCandidate}` : null },
    (db) => db.collection(`${DB_PREFIX}_products`).doc(p.id).set(p));
}

export async function archiveUserProduct(id) {
  store.userProducts = store.userProducts.filter((x) => x.id !== id);
  changed("products");
  return write("product.archive", { id }, (db) => db.collection(`${DB_PREFIX}_products`).doc(id).delete());
}

export async function saveRun(run) {
  const id = "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const doc = { ...run, createdAt: new Date().toISOString() };
  store.runs.unshift({ id, ...doc });
  changed("runs");
  const res = await write("run.save", { id, ...doc }, (db) => db.collection(`${DB_PREFIX}_runs`).doc(id).set(doc));
  return { ...res, id };
}

export async function toggleWatch(id) {
  const i = store.watch.indexOf(id);
  if (i >= 0) store.watch.splice(i, 1); else store.watch.push(id);
  changed("watch");
  return write("watch.set", { ids: store.watch }, (db) => db.doc(`${DB_PREFIX}/watch`).set({ ids: store.watch }));
}

export function dbMessage(e) {
  switch (e?.code) {
    case "invalid_argument": return "You can view this page but not change its shared data.";
    case "quota_exceeded": return "The page storage is full. Remove old agent runs or imported products.";
    case "resource_exhausted": return "Too many changes at once. Wait a moment and try again.";
    default: return "The change could not be saved. Try again in a moment.";
  }
}

export function runsFor(productId) {
  return store.runs.filter((r) => r.productId === productId);
}

export function dataSourceLabel() {
  if (store.live.state === "ready") return { tone: "on", text: "Live: Supabase via n8n" };
  if (store.live.state === "connecting") return { tone: "", text: "Connecting to Supabase…" };
  return { tone: "warn", text: "Snapshot from " + new Date(store.dataset.meta.generated).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) };
}

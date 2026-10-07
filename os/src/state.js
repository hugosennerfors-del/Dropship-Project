// App state: the embedded dataset, your edits and the derived rows.
//
// Layers on the page mirror the pipeline:
//   dataset.products        processed analysis (embedded at build time)
//   store.userProducts      products added on the page (agents, CSV import)
//   store.overlays          values you verified or corrected, field by field
//   store.settings          your market assumptions (FX, fees, shipping)
//   store.runs              agent outputs, versioned, never overwritten
// Everything shared lives in the page's database; browser storage only
// keeps view preferences.

import { buildProduct, rowOf } from "./core/profile.js";
import { resolveProduct } from "./core/inherit.js";
import { MARKETS, PRIMARY_MARKET } from "./core/markets.js";

const DB_PREFIX = "intel";
const listeners = new Set();

export const store = {
  dataset: null,
  evidenceIndex: {},
  market: PRIMARY_MARKET,
  overlays: {},
  settings: { markets: {} },
  userProducts: [],
  runs: [],
  watch: [],
  compare: [],
  db: null,
  dbState: "connecting", // connecting | ready | offline | readonly
  sample: null,
  sampleState: "connecting", // connecting | ready | unavailable | declined
  tools: false,
  version: 0,
};

let cache = { version: -1, built: null, rows: {} };

export function init(dataset) {
  store.dataset = dataset;
  store.evidenceIndex = Object.fromEntries(dataset.evidence.map((e) => [e.id, e]));
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
export function allProducts() {
  rebuild();
  return cache.built;
}
export function rows(market = store.market) {
  rebuild();
  return cache.rows[market] || [];
}
export function product(id) {
  return allProducts().find((p) => p.id === id) || null;
}
export function row(id, market = store.market) {
  return rows(market).find((r) => r.id === id) || null;
}
export function marketsOf(id) {
  const p = product(id);
  return p ? Object.keys(p.built) : [];
}

function rebuild() {
  if (cache.version === store.version && cache.built) return;
  const base = store.dataset.products;
  const added = store.userProducts.map((p) => {
    try { return resolveProduct(p); } catch { return null; }
  }).filter(Boolean);
  const built = [...base, ...added].map((p) => buildProduct(p, store.evidenceIndex, store.settings, store.overlays));
  const out = {};
  for (const code of Object.keys(MARKETS)) {
    out[code] = built.map((b) => rowOf(b, code)).filter(Boolean);
  }
  cache = { version: store.version, built, rows: out };
}

// ── Preferences (this browser only) ───────────────────────────────────
const PREF_KEY = "planvy-intel-pref";
function loadPref() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); } catch { return {}; }
}
export function savePref(patch) {
  try {
    const cur = loadPref();
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch { /* preferences are a convenience */ }
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

// ── Shared database ────────────────────────────────────────────────────
export async function connect(claude) {
  const use = async (name) => {
    try { return claude && claude.use ? await claude.use(name) : null; } catch { return null; }
  };
  const [db, sample] = await Promise.all([use("db"), use("sample")]);
  store.sample = sample;
  store.sampleState = sample ? "ready" : "unavailable";
  if (sample) {
    try { store.tools = !!(await sample.limits())?.tools; } catch { store.tools = false; }
  }
  store.db = db;
  if (!db) { store.dbState = "offline"; changed("connect"); return; }
  try {
    const [ov, st, up, runs, watch] = await Promise.all([
      db.collection(`${DB_PREFIX}_overlays`).limit(1000).get(),
      db.doc(`${DB_PREFIX}/settings`).get(),
      db.collection(`${DB_PREFIX}_products`).limit(500).get(),
      db.collection(`${DB_PREFIX}_runs`).orderBy("createdAt", "desc").limit(300).get(),
      db.doc(`${DB_PREFIX}/watch`).get(),
    ]);
    store.overlays = {};
    for (const d of ov.docs) {
      const x = d.data();
      if (x && x.key && x.value) store.overlays[x.key] = x.value;
    }
    if (st.exists) store.settings = { markets: {}, ...st.data() };
    store.userProducts = up.docs.map((d) => d.data()).filter((p) => p && p.id && p.core);
    store.runs = runs.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (watch.exists) store.watch = watch.data().ids || [];
    store.dbState = "ready";
  } catch {
    store.dbState = "offline";
  }
  changed("connect");
}

const overlayDocId = (key) => key.replace(/\|/g, "~").replace(/[^A-Za-z0-9_.~:@+-]/g, "_");

export async function setOverlay(key, value) {
  if (value == null) delete store.overlays[key];
  else store.overlays[key] = value;
  changed("overlay");
  if (!store.db) return { ok: false, reason: "Saved for this visit only: the page database is not available here." };
  try {
    const ref = store.db.collection(`${DB_PREFIX}_overlays`).doc(overlayDocId(key));
    if (value == null) await ref.delete();
    else await ref.set({ key, value, at: new Date().toISOString() });
    return { ok: true };
  } catch (e) {
    if (e?.code === "invalid_argument") store.dbState = "readonly";
    return { ok: false, reason: dbMessage(e) };
  }
}

export async function saveSettings(settings) {
  store.settings = settings;
  changed("settings");
  if (!store.db) return { ok: false, reason: "Saved for this visit only." };
  try { await store.db.doc(`${DB_PREFIX}/settings`).set(settings); return { ok: true }; } catch (e) { return { ok: false, reason: dbMessage(e) }; }
}

export async function saveUserProduct(p) {
  const i = store.userProducts.findIndex((x) => x.id === p.id);
  if (i >= 0) store.userProducts[i] = p; else store.userProducts.push(p);
  changed("products");
  if (!store.db) return { ok: false, reason: "Saved for this visit only." };
  try { await store.db.collection(`${DB_PREFIX}_products`).doc(p.id).set(p); return { ok: true }; } catch (e) { return { ok: false, reason: dbMessage(e) }; }
}
export async function deleteUserProduct(id) {
  store.userProducts = store.userProducts.filter((x) => x.id !== id);
  changed("products");
  try { if (store.db) await store.db.collection(`${DB_PREFIX}_products`).doc(id).delete(); } catch { /* shown as removed locally */ }
}

export async function saveRun(run) {
  const id = "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const doc = { ...run, createdAt: new Date().toISOString() };
  store.runs.unshift({ id, ...doc });
  changed("runs");
  if (!store.db) return { ok: false, id };
  try { await store.db.collection(`${DB_PREFIX}_runs`).doc(id).set(doc); return { ok: true, id }; } catch (e) { return { ok: false, id, reason: dbMessage(e) }; }
}

export async function toggleWatch(id) {
  const i = store.watch.indexOf(id);
  if (i >= 0) store.watch.splice(i, 1); else store.watch.push(id);
  changed("watch");
  try { if (store.db) await store.db.doc(`${DB_PREFIX}/watch`).set({ ids: store.watch }); } catch { /* local only */ }
}

export function dbMessage(e) {
  switch (e?.code) {
    case "invalid_argument": return "You can view this page but not change its shared data.";
    case "quota_exceeded": return "The page database is full. Remove old agent runs or imported products.";
    case "resource_exhausted": return "Too many changes at once. Wait a moment and try again.";
    default: return "The change could not be saved. Try again in a moment.";
  }
}

export function runsFor(productId) {
  return store.runs.filter((r) => r.productId === productId);
}

// The product page's "Stores & suppliers" section: the small dropshipping
// stores selling the product in the selected market (found by the n8n store
// finder, or saved by you), searches that surface more of them, and the
// Chinese suppliers making it, with the listings you save (prices and
// minimum orders).

import { store, linksFor, saveLink, removeLink, setOverlay, loadPref, savePref } from "../state.js";
import { esc, attr, icon, glyph } from "../ui/dom.js";
import { MARKETS } from "../core/markets.js";
import { LINK_CURRENCIES, dropshipSearchLinks, supplierSearchLinks, brandNames, finderQuery, storeVerdict, sortStores, normaliseLink, storeSummary, supplierSummary, fmtMoney, hostOf } from "../core/sourcing.js";
import { findDropshipStores, finderAvailable, finderReport } from "../dropship.js";
import { burstAt } from "../fx.js";

// Per product: search words, the form open (null or {kind, id}), its draft
// and error, the link whose Remove was clicked once, and the store finder's
// state per market.
const ui = {};
const uiFor = (pid) => (ui[pid] ||= { query: null, editing: null, draft: {}, error: null, armed: null, find: {} });

// Your own words for the product, else the words that found its stores in
// this market, else its name.
function queryFor(p, m) {
  return uiFor(p.id).query ?? loadPref().sourceQueries?.[p.id] ?? finderQuery(p.core.name?.v, linksFor(p.id, "store").filter((l) => l.market === m));
}

const linkCard = (l) => `<a class="ads-link" data-src-link="${attr(l.id)}" href="${attr(l.url)}" target="_blank" rel="noopener noreferrer">
  <b>${esc(l.label)} ${icon("ext", 11)}</b><small>${esc(l.sub)}</small>${l.prefilled === false ? '<span class="tag">paste the search</span>' : ""}</a>`;

function finderBlock(u, q, m) {
  const f = u.find[m] || { state: "idle" };
  const market = MARKETS[m]?.name || m;
  const live = store.live.state === "ready" && finderAvailable();
  const running = f.state === "running";
  const help = live
    ? `Searches the web for small stores selling “${q}” in ${market}, then checks each store's public Shopify data for signs of dropshipping. About 20 seconds; three web searches on your n8n credits.`
    : "Needs the live database through the n8n connector.";
  const report = f.state === "done" ? `<div class="callout${f.found ? " good" : ""}" data-src-report>${icon(f.found ? "check" : "info", 16)}<span>${esc(f.text)}</span></div>`
    : f.state === "error" ? `<div class="callout bad" data-src-report role="alert">${icon("warn", 16)}<span>${esc(f.text)}</span></div>`
    : f.state === "slow" ? `<div class="callout" data-src-report>${icon("info", 16)}<span>${esc(f.text)} <button class="btn sm" type="button" data-src-wait>Check again</button></span></div>` : "";
  return `<div class="src-find">
      <button class="btn primary sm" type="button" data-src-find${live && !running && q.trim().length >= 3 ? "" : " disabled"}>${running ? '<span class="thinking"><i></i><i></i><i></i></span>Searching…' : `${icon("search", 13)}Find dropshipping stores`}</button>
      <span class="xs muted">${esc(help)}</span>
    </div>${report}`;
}

export function sourcingSection(p, b, r, m) {
  const u = uiFor(p.id);
  const q = queryFor(p, m);
  const market = MARKETS[m]?.name || m;
  const stores = linksFor(p.id, "store").filter((l) => l.market === m);
  const otherStores = linksFor(p.id, "store").length - stores.length;
  const suppliers = linksFor(p.id, "supplier");
  const estimate = Number(p.core.supplierPriceUSD?.v);
  const sSum = storeSummary(stores, { price: r?.price, currency: MARKETS[m]?.currency });
  const pSum = supplierSummary(suppliers, Number.isFinite(estimate) ? estimate : null);
  const supply = Object.values(store.evidenceIndex).filter((e) => e.kind === "supply" && (e.products || []).includes(p.id));
  const editing = (kind) => (u.editing?.kind === kind ? u.editing : null);
  return `<section class="p-sec" id="sec-sourcing">
    <h2>Stores & suppliers <small>dropshipping stores selling it in ${esc(market)}, and who makes it</small></h2>
    <label class="field ads-q"><span>Search words<small class="xs muted">used for every search below; suppliers list in English</small></span>
      <span class="ads-q-row"><input id="src-q" type="text" maxlength="100" value="${attr(q)}" autocomplete="off" spellcheck="false"><button class="btn sm" type="button" data-src-copy>${icon("link", 13)}Copy</button></span></label>

    <div class="panel"><div class="panel-h"><h3>Dropshipping stores selling it</h3><span class="sub">${esc(market)} · small online stores, not big brands</span></div>
      <div class="panel-b stack">
        ${finderBlock(u, q, m)}
        <div class="ads-links">${dropshipSearchLinks(q, m).map(linkCard).join("")}</div>
        <div class="callout${sSum.tone ? " " + sSum.tone : ""}" data-src-summary="store">${icon("info", 16)}<span>${esc(sSum.text)}</span></div>
      </div>
      ${listBlock("store", stores, u)}
      ${editing("store") ? linkForm("store", u, stores.find((l) => l.id === u.editing.id), m) : ""}
      ${otherStores ? `<div class="panel-b xs muted" style="border-top:1px solid var(--border)">${otherStores} more for ${esc(MARKETS[m === "UK" ? "SE" : "UK"]?.name || "the other market")}.</div>` : ""}
    </div>

    <div class="panel"><div class="panel-h"><h3>Suppliers in China</h3><span class="sub">every market · opens in a new tab</span></div>
      <div class="panel-b stack">
        <div class="ads-links">${supplierSearchLinks(q).map(linkCard).join("")}</div>
        ${supply.length ? `<div class="stack" style="gap:6px"><span class="xs muted">From the research</span>${supply.map((e) => `<p class="small src-ev">${glyph(e.unverified ? "A" : "E")}<span>${esc(e.claim)}${e.source?.url ? ` <a class="linkish xs" href="${attr(e.source.url)}" target="_blank" rel="noopener noreferrer">${esc(e.source.publisher || e.source.title || "source")} ${icon("ext", 10)}</a>` : ""}</span></p>`).join("")}</div>` : ""}
        <div class="callout${pSum.tone ? " " + pSum.tone : ""}" data-src-summary="supplier">${icon("info", 16)}<span>${esc(pSum.text)}</span></div>
        <p class="xs muted">A listing's price is a starting point, not a quote. Ask for a sample, the price at your order size, shipping to ${esc(market)} and any certificates (CE/UKCA) before you order.</p>
      </div>
      ${listBlock("supplier", suppliers, u, estimate)}
      ${editing("supplier") ? linkForm("supplier", u, suppliers.find((l) => l.id === u.editing.id), m) : ""}
    </div>
  </section>`;
}

function listBlock(kind, items, u, estimate) {
  const add = u.editing?.kind === kind ? "" : `<button class="btn sm" type="button" data-src-new="${kind}">${icon("plus", 13)}${kind === "store" ? "Save a store" : "Save a supplier"}</button>`;
  let title, sub, sorted;
  if (kind === "store") {
    const kinds = items.map((l) => storeVerdict(l).kind);
    const count = (k) => kinds.filter((x) => x === k).length;
    title = "Stores";
    sub = items.length ? [count("likely") && `${count("likely")} likely`, count("possible") && `${count("possible")} possible`, count("yours") && `${count("yours")} saved by you`].filter(Boolean).join(" · ") : "none yet";
    sorted = sortStores(items);
  } else {
    title = "Saved suppliers";
    sub = items.length ? `${items.length} saved, cheapest first` : "none yet";
    sorted = [...items].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }
  return `<div class="src-list-h"><b>${title}</b><span class="xs muted">${esc(sub)}</span>${add}</div>
    <div class="list" data-src-list="${kind}">${sorted.map((l) => linkRow(l, u, kind, estimate)).join("")}</div>`;
}

function linkRow(l, u, kind, estimate) {
  const host = hostOf(l.url);
  const price = l.price != null ? `<span class="mono src-price">${esc(fmtMoney(l.price, l.currency))}${kind === "supplier" ? "/unit" : ""}</span>` : '<span class="spill">no price</span>';
  const moq = kind === "supplier" && l.moq ? `<span class="spill">MOQ ${l.moq.toLocaleString("en-GB")}</span>` : "";
  const applied = store.overlays[`${l.productId}|core|supplierPriceUSD`]?.note?.includes?.(l.url);
  const use = kind === "supplier" && l.currency === "USD" && l.price != null
    ? (applied ? '<span class="tag">in the calculator</span>' : `<button class="btn sm" type="button" data-src-use="${attr(l.id)}" title="Save $${Number(l.price).toFixed(2)} as your verified supplier price; the calculator and scores update">Use price</button>`)
    : "";
  const armed = u.armed === l.id;
  const v = kind === "store" ? storeVerdict(l) : null;
  const found = v && v.kind !== "yours";
  const title = found && l.signals?.productTitle ? `“${l.signals.productTitle}”` : "";
  const sub = found ? [host, title, l.signals?.added && `listed ${l.signals.added}`].filter(Boolean).join(" · ") : [host, l.note].filter(Boolean).join(" · ");
  return `<div class="li src-row" data-link="${attr(l.id)}">
    <span class="body"><b>${esc(l.name || host || "Link")}${found ? ` <span class="tag src-${v.kind}">${esc(v.label)}</span>` : ""}</b><small>${esc(sub)}</small>${found && v.why.length ? `<small class="src-why">${esc(v.why.join(" · "))}</small>` : ""}</span>
    <span class="side">${price}${moq}${use}
      <a class="btn sm" href="${attr(l.url)}" target="_blank" rel="noopener noreferrer">Open ${icon("ext", 11)}</a>
      <button class="btn sm ghost" type="button" data-src-edit="${attr(l.id)}" data-kind="${kind}">Edit</button>
      <button class="btn sm ${armed ? "bb-btn-danger" : "ghost"}" type="button" data-src-rm="${attr(l.id)}">${armed ? "Remove?" : "Remove"}</button></span>
  </div>`;
}

function linkForm(kind, u, link, m) {
  const d = { ...(link || {}), ...u.draft };
  const cur = d.currency || (kind === "store" ? MARKETS[m]?.currency || "GBP" : "USD");
  const err = (f) => (u.error?.field === f ? ' aria-invalid="true"' : "");
  const isStore = kind === "store";
  return `<form class="panel-b ads-form" id="srcForm" data-kind="${kind}" novalidate>
    <div class="grid g2">
      <label class="field ads-wide"><span>${isStore ? "Link to the store's product page" : "Link to the supplier's listing"}</span><input name="url" type="text" inputmode="url" maxlength="2000" value="${attr(d.url || "")}" placeholder="${isStore ? "https://shop.example/products/…" : "https://www.alibaba.com/product-detail/…"}" autocomplete="off" spellcheck="false"${err("url")}></label>
      <label class="field"><span>${isStore ? "Store" : "Supplier"}</span><input name="name" type="text" maxlength="200" value="${attr(d.name || "")}" placeholder="${isStore ? "shop or brand name" : "company name on the listing"}"${err("name")}></label>
      <label class="field"><span>${isStore ? "Price" : "Unit price"}</span><span class="src-price-in"><input name="price" type="text" inputmode="decimal" maxlength="12" value="${attr(d.price ?? "")}" placeholder="${isStore ? "e.g. 89.99" : "e.g. 11.50"}"${err("price")}>
        <select name="currency" aria-label="Currency"${err("currency")}>${LINK_CURRENCIES.map((c) => `<option${c === cur ? " selected" : ""}>${c}</option>`).join("")}</select></span></label>
      ${isStore ? "" : `<label class="field"><span>Minimum order (units)</span><input name="moq" type="text" inputmode="numeric" maxlength="9" value="${attr(d.moq ?? "")}" placeholder="e.g. 100"${err("moq")}></label>`}
      <label class="field ads-wide"><span>Note</span><textarea name="note" rows="2" maxlength="1000" placeholder="${isStore ? "shipping, offer, reviews, how it is positioned" : "sample price, lead time, shipping, certificates, contact"}"${err("note")}>${esc(d.note || "")}</textarea></label>
    </div>
    <p class="ads-err" role="alert"${u.error ? "" : " hidden"}>${esc(u.error?.error || "")}</p>
    <div class="row"><button class="btn primary sm" type="submit">${link ? "Save changes" : isStore ? "Save store" : "Save supplier"}</button><button class="btn sm ghost" type="button" data-src-cancel>Cancel</button></div>
  </form>`;
}

const formData = (form) => {
  const f = new FormData(form);
  return { url: f.get("url"), name: f.get("name"), price: f.get("price"), currency: f.get("currency"), moq: f.get("moq"), note: f.get("note") };
};

// Runs the store finder for a product and market; the page shows the outcome.
async function runFinder(p, m, rerender, executionId) {
  const u = uiFor(p.id);
  u.find[m] = { state: "running", executionId: executionId || null };
  rerender();
  try {
    const res = await findDropshipStores({ productId: p.id, market: m, query: queryFor(p, m), exclude: brandNames(p.built?.[m]?.mk?.marketLeaders?.v), executionId });
    u.find[m] = { state: "done", found: res.found, text: finderReport(res) };
    window.__toast?.(res.found ? `${res.found} dropshipping store${res.found === 1 ? "" : "s"} found.` : "No dropshipping stores found.");
  } catch (err) {
    u.find[m] = err?.code === "still_running"
      ? { state: "slow", executionId: err.executionId, text: "n8n is still checking the stores." }
      : { state: "error", text: err?.message || "The store finder did not answer." };
  }
  rerender();
}

// Events, delegated from the product page's root.
export function bindSourcing(root, { id, rerender, product }) {
  const inSec = (el) => el?.closest?.("#sec-sourcing");
  const showError = (form, res) => {
    const p = form.querySelector(".ads-err");
    p.textContent = res.error; p.hidden = false;
    form.querySelectorAll("[aria-invalid]").forEach((x) => x.removeAttribute("aria-invalid"));
    const bad = form.querySelector(`[name=${res.field}]`);
    if (bad) { bad.setAttribute("aria-invalid", "true"); bad.focus(); }
  };

  root.addEventListener("input", (e) => {
    if (!inSec(e.target)) return;
    const u = uiFor(id);
    if (e.target.id === "src-q") {
      u.query = e.target.value;
      const all = [...dropshipSearchLinks(u.query, store.market), ...supplierSearchLinks(u.query)];
      root.querySelectorAll("[data-src-link]").forEach((a) => { const l = all.find((x) => x.id === a.dataset.srcLink); if (l) a.href = l.url; });
      const find = root.querySelector("[data-src-find]");
      if (find && u.find[store.market]?.state !== "running") find.disabled = !(store.live.state === "ready" && finderAvailable() && u.query.trim().length >= 3);
      const pref = loadPref().sourceQueries || {};
      savePref({ sourceQueries: Object.fromEntries(Object.entries({ ...pref, [id]: u.query }).slice(-50)) });
      return;
    }
    const form = e.target.closest("#srcForm");
    if (form) u.draft = formData(form);
  });
  root.addEventListener("change", (e) => {
    const form = inSec(e.target) && e.target.closest("#srcForm");
    if (form) uiFor(id).draft = formData(form);
  });

  root.addEventListener("submit", async (e) => {
    if (e.target.id !== "srcForm") return;
    e.preventDefault();
    const u = uiFor(id);
    const kind = e.target.dataset.kind;
    const input = formData(e.target);
    const res = normaliseLink({ ...input, id: u.editing?.id || undefined }, { productId: id, kind, market: store.market });
    if (res.error) { u.draft = input; u.error = res; showError(e.target, res); return; }
    if (linksFor(id, kind).some((l) => l.url === res.link.url && l.id !== res.link.id)) {
      u.error = { error: "This link is already saved for this product.", field: "url" };
      showError(e.target, u.error);
      return;
    }
    e.target.querySelector("[type=submit]").disabled = true;
    u.editing = null; u.draft = {}; u.error = null;
    const saved = await saveLink(res.link);
    window.__toast?.(saved.ok ? (saved.note || (kind === "store" ? "Store saved." : "Supplier saved.")) : saved.reason);
    rerender();
    if (saved.ok) burstAt(root.querySelector(`[data-link="${res.link.id}"]`), 60);
  });

  root.addEventListener("click", async (e) => {
    const t = e.target;
    if (!inSec(t)) return;
    const u = uiFor(id);
    if (!t.closest("[data-src-rm]") && u.armed) {
      u.armed = null;
      if (!t.closest("button, a, input, select, textarea, label")) { rerender(); return; }
    }
    if (t.closest("[data-src-find]")) { const p = product(); if (p) runFinder(p, store.market, rerender); return; }
    if (t.closest("[data-src-wait]")) { const p = product(); if (p) runFinder(p, store.market, rerender, u.find[store.market]?.executionId); return; }
    const nw = t.closest("[data-src-new]");
    if (nw) { u.editing = { kind: nw.dataset.srcNew, id: null }; u.draft = {}; u.error = null; rerender(); root.querySelector("#srcForm [name=url]")?.focus(); return; }
    const ed = t.closest("[data-src-edit]");
    if (ed) { u.editing = { kind: ed.dataset.kind, id: ed.dataset.srcEdit }; u.draft = {}; u.error = null; rerender(); root.querySelector("#srcForm [name=url]")?.focus(); return; }
    if (t.closest("[data-src-cancel]")) { u.editing = null; u.draft = {}; u.error = null; rerender(); return; }
    const rm = t.closest("[data-src-rm]");
    if (rm) {
      const linkId = rm.dataset.srcRm;
      if (u.armed !== linkId) { u.armed = linkId; rerender(); root.querySelector(`[data-src-rm="${linkId}"]`)?.focus(); return; }
      u.armed = null;
      if (u.editing?.id === linkId) u.editing = null;
      const res = await removeLink(linkId);
      window.__toast?.(res.ok ? (res.note || "Removed.") : res.reason);
      rerender();
      return;
    }
    const use = t.closest("[data-src-use]");
    if (use) {
      const l = store.links.find((x) => x.id === use.dataset.srcUse);
      if (!l || l.currency !== "USD" || l.price == null) return;
      const res = await setOverlay(`${id}|core|supplierPriceUSD`, { v: Number(l.price), s: "V", src: ["user"],
        note: `Supplier listing${l.name ? ` from ${l.name}` : ""}${l.moq ? `, MOQ ${l.moq}` : ""}: ${l.url}`, at: new Date().toISOString() });
      window.__toast?.(res.ok ? `$${Number(l.price).toFixed(2)} is now your verified supplier price; the calculator and scores use it.` : res.reason);
      rerender();
      return;
    }
    if (t.closest("[data-src-copy]")) {
      const inp = root.querySelector("#src-q");
      try { await navigator.clipboard.writeText(inp.value); window.__toast?.("Search words copied."); }
      catch { inp.focus(); inp.select(); window.__toast?.("Selected: press Ctrl+C (⌘C on a Mac) to copy."); }
    }
  });
}

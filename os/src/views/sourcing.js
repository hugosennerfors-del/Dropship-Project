// The product page's "Stores & suppliers" section: searches that list the
// shops selling the product in the selected market and the Chinese
// suppliers making it, the sellers the research names, and the stores and
// supplier listings you save (with prices and minimum orders).

import { store, linksFor, saveLink, removeLink, setOverlay, loadPref, savePref } from "../state.js";
import { esc, attr, icon, glyph } from "../ui/dom.js";
import { MARKETS } from "../core/markets.js";
import { defaultAdQuery } from "../core/ads.js";
import { LINK_CURRENCIES, storeSearchLinks, supplierSearchLinks, namedSellers, normaliseLink, storeSummary, supplierSummary, fmtMoney, hostOf } from "../core/sourcing.js";
import { burstAt } from "../fx.js";

// Per product: search words, the form open (null or {kind, id}), its draft
// and error, and the link whose Remove was clicked once.
const ui = {};
const uiFor = (pid) => (ui[pid] ||= { query: null, editing: null, draft: {}, error: null, armed: null });

function queryFor(p) {
  const u = uiFor(p.id);
  if (u.query == null) u.query = loadPref().sourceQueries?.[p.id] ?? defaultAdQuery(p.core.name?.v);
  return u.query;
}

const linkCard = (l) => `<a class="ads-link" data-src-link="${attr(l.id)}" href="${attr(l.url)}" target="_blank" rel="noopener noreferrer">
  <b>${esc(l.label)} ${icon("ext", 11)}</b><small>${esc(l.sub)}</small>${l.prefilled === false ? '<span class="tag">paste the search</span>' : ""}</a>`;

export function sourcingSection(p, b, r, m) {
  const u = uiFor(p.id);
  const q = queryFor(p);
  const market = MARKETS[m]?.name || m;
  const stores = linksFor(p.id, "store").filter((l) => l.market === m);
  const otherStores = linksFor(p.id, "store").length - stores.length;
  const suppliers = linksFor(p.id, "supplier");
  const estimate = Number(p.core.supplierPriceUSD?.v);
  const sSum = storeSummary(stores, { price: r?.price, currency: MARKETS[m]?.currency });
  const pSum = supplierSummary(suppliers, Number.isFinite(estimate) ? estimate : null);
  const named = namedSellers(b.mk.marketLeaders?.v, q, m);
  const supply = Object.values(store.evidenceIndex).filter((e) => e.kind === "supply" && (e.products || []).includes(p.id));
  const editing = (kind) => (u.editing?.kind === kind ? u.editing : null);
  return `<section class="p-sec" id="sec-sourcing">
    <h2>Stores & suppliers <small>who sells it in ${esc(market)} and who makes it</small></h2>
    <label class="field ads-q"><span>Search words<small class="xs muted">used for every search below; suppliers list in English</small></span>
      <span class="ads-q-row"><input id="src-q" type="text" maxlength="100" value="${attr(q)}" autocomplete="off" spellcheck="false"><button class="btn sm" type="button" data-src-copy>${icon("link", 13)}Copy</button></span></label>

    <div class="panel"><div class="panel-h"><h3>Stores selling it</h3><span class="sub">${esc(market)} · opens in a new tab</span></div>
      <div class="panel-b stack">
        <div class="ads-links">${storeSearchLinks(q, m).map(linkCard).join("")}</div>
        ${named.length ? `<div class="src-named"><span class="xs muted">Named in the research</span>${named.map((x) => `<a class="chip" data-src-named href="${attr(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.name)} ${icon("ext", 10)}</a>`).join("")}</div>` : ""}
        <div class="callout${sSum.tone ? " " + sSum.tone : ""}" data-src-summary="store">${icon("info", 16)}<span>${esc(sSum.text)}</span></div>
      </div>
      ${listBlock("store", stores, u, p, m)}
      ${editing("store") ? linkForm("store", u, stores.find((l) => l.id === u.editing.id), m) : ""}
      ${otherStores ? `<div class="panel-b xs muted" style="border-top:1px solid var(--border)">${otherStores} more saved for ${esc(MARKETS[m === "UK" ? "SE" : "UK"]?.name || "the other market")}.</div>` : ""}
    </div>

    <div class="panel"><div class="panel-h"><h3>Suppliers in China</h3><span class="sub">every market · opens in a new tab</span></div>
      <div class="panel-b stack">
        <div class="ads-links">${supplierSearchLinks(q).map(linkCard).join("")}</div>
        ${supply.length ? `<div class="stack" style="gap:6px"><span class="xs muted">From the research</span>${supply.map((e) => `<p class="small src-ev">${glyph(e.unverified ? "A" : "E")}<span>${esc(e.claim)}${e.source?.url ? ` <a class="linkish xs" href="${attr(e.source.url)}" target="_blank" rel="noopener noreferrer">${esc(e.source.publisher || e.source.title || "source")} ${icon("ext", 10)}</a>` : ""}</span></p>`).join("")}</div>` : ""}
        <div class="callout${pSum.tone ? " " + pSum.tone : ""}" data-src-summary="supplier">${icon("info", 16)}<span>${esc(pSum.text)}</span></div>
        <p class="xs muted">A listing's price is a starting point, not a quote. Ask for a sample, the price at your order size, shipping to ${esc(market)} and any certificates (CE/UKCA) before you order.</p>
      </div>
      ${listBlock("supplier", suppliers, u, p, m, estimate)}
      ${editing("supplier") ? linkForm("supplier", u, suppliers.find((l) => l.id === u.editing.id), m) : ""}
    </div>
  </section>`;
}

function listBlock(kind, items, u, p, m, estimate) {
  const title = kind === "store" ? "Saved stores" : "Saved suppliers";
  const add = u.editing?.kind === kind ? "" : `<button class="btn sm" type="button" data-src-new="${kind}">${icon("plus", 13)}${kind === "store" ? "Save a store" : "Save a supplier"}</button>`;
  const sorted = [...items].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return `<div class="src-list-h"><b>${title}</b><span class="xs muted">${items.length ? `${items.length} saved, cheapest first` : "none yet"}</span>${add}</div>
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
  return `<div class="li src-row" data-link="${attr(l.id)}">
    <span class="body"><b>${esc(l.name || host || "Link")}</b><small>${esc([host, l.note].filter(Boolean).join(" · "))}</small></span>
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

// Events, delegated from the product page's root.
export function bindSourcing(root, { id, rerender }) {
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
      const all = [...storeSearchLinks(u.query, store.market), ...supplierSearchLinks(u.query)];
      root.querySelectorAll("[data-src-link]").forEach((a) => { const l = all.find((x) => x.id === a.dataset.srcLink); if (l) a.href = l.url; });
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

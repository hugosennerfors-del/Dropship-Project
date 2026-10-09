// Plan-vy Intelligence — the page.
//
// Hash routes:  #/radar  #/discover  #/research?q=…  #/p/<id>  #/trends
//               #/niches  #/compare  #/chat  #/brands  #/data?tab=…  #/store/…

import { init, connect, store, onChange, rows, setMarket, dataSourceLabel } from "./state.js";
import { esc, attr, icon, scoreChip } from "./ui/dom.js";
import { MARKETS } from "./core/markets.js";
import { startResearch, researchAvailable } from "./research.js";
import { initFx, enter as fxEnter, fxEnabled, setFx, burstAt } from "./fx.js";
import * as radar from "./views/radar.js";
import * as discover from "./views/discover.js";
import * as research from "./views/research.js";
import * as productView from "./views/product.js";
import * as trends from "./views/trends.js";
import * as nichesView from "./views/niches.js";
import * as compare from "./views/compare.js";
import * as chat from "./views/chat.js";
import * as data from "./views/data.js";
import * as brands from "./views/brands.js";

const NAV = [
  { group: "Research", items: [
    ["#/radar", "Radar", "radar"], ["#/discover", "Discover", "search"], ["#/research", "New research", "spark"],
    ["#/trends", "Early trends", "trend"], ["#/niches", "Niches", "niche"], ["#/compare", "Compare", "compare"], ["#/chat", "Ask the database", "chat"],
  ] },
  { group: "Shopify", items: [["#/brands", "Brand Builder", "wand"], ["#/data?tab=shopify", "Shopify stores", "store"]] },
  { group: "Data", items: [["#/data", "Data and sources", "data"]] },
  { group: "Store (Sweden)", items: [
    ["#/store/", "Overview", "store"], ["#/store/products", "Products", "box"], ["#/store/kassa", "Kassa", "cash"],
    ["#/store/test", "Test", "flask"], ["#/store/risk", "Risk", "shield"], ["#/store/kalender", "Kalender", "calendar"],
    ["#/store/research", "n8n research", "spark"], ["#/store/alerts", "Alerts", "bell"],
  ] },
];

const ROUTES = {
  radar: radar, discover: discover, research: research, trends: trends, niches: nichesView, compare: compare, chat: chat, data: data, brands: brands,
};

function parse() {
  const raw = (location.hash || "#/radar").slice(1);
  const [path, qs] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return { path, parts, params: new URLSearchParams(qs || "") };
}

let current = { key: "", root: null, cleanup: null, refresh: null };

// One root element per view. Re-rendering the same view (new data, a
// filter change) replaces its contents in place, so the view's delegated
// listeners and module state survive; navigating creates a new root.
function render(force) {
  const { path, parts, params } = parse();
  // The research inbox moved into New research.
  if (path === "/data" && params.get("tab") === "inbox") { history.replaceState(null, "", "#/research"); return render(force); }
  const storeMode = parts[0] === "store";
  document.getElementById("legacyRoot").hidden = !storeMode;
  document.getElementById("os-main").hidden = storeMode;
  renderRail(path, params);
  if (storeMode) { crumbs = []; renderTop(parts, true); closeDrawer(); current = { key: "store" }; return; }

  let mod, id, viewKey;
  if (parts[0] === "p" && parts[1]) { mod = productView; id = decodeURIComponent(parts[1]); viewKey = "p:" + id; }
  else { mod = ROUTES[parts[0]] || radar; viewKey = parts[0] || "radar"; }
  const out = mod.render(params, id);
  document.title = out.title && out.title !== "Opportunity Radar" ? `${shorten(out.title)} · Plan-vy Intelligence` : "Plan-vy Intelligence";
  crumbs = out.crumbs || [];
  renderTop(parts, false, out.title);

  const key = viewKey + "|" + location.hash;
  if (current.key === key && current.root && !force) {
    current.root.innerHTML = out.html;
    current.refresh?.();
    fxEnter(current.root, key);
    return;
  }
  const keepScroll = current.key === key ? window.scrollY : null;
  current.cleanup?.();
  const root = document.createElement("div");
  root.className = out.full ? "view full" : "view";
  root.innerHTML = out.html;
  document.getElementById("os-main").replaceChildren(root);
  // A view that has been left (its root replaced) no longer redraws the page:
  // an agent finishing after you moved on must not wipe what you typed.
  const mounted = mod.mount?.(root, { rerender: () => { if (root.isConnected) render(); }, params, id });
  current = {
    key, root, mod,
    cleanup: typeof mounted === "function" ? mounted : mounted?.cleanup || null,
    refresh: mounted?.refresh || null,
  };
  window.scrollTo(0, keepScroll ?? 0);
  fxEnter(root, key);
  closeDrawer();
}

function shorten(t) {
  const s = String(t).split(/:\s/)[0];
  return s.length > 40 ? s.slice(0, 38) + "…" : s;
}

let crumbs = [];

function renderRail(path, params) {
  const full = path + (params.toString() ? "?" + params.toString() : "");
  const isActive = (href) => {
    const h = href.slice(1);
    if (h === "/data") return path === "/data" && !["inbox", "shopify"].includes(params.get("tab"));
    if (h.includes("?")) return full === h;
    if (h === "/store/") return path === "/store" || path === "/store/";
    if (h === "/discover") return path.startsWith("/discover") || path.startsWith("/p/");
    return path === h || path.startsWith(h + "/");
  };
  const src = dataSourceLabel();
  const count = { "#/research": store.research.state === "running" ? "…" : store.inboxTotal, "#/compare": store.compare.length || "" };
  document.getElementById("os-rail").innerHTML = `
    <div class="brand"><span class="brand-mark">${icon("radar", 14)}</span><span class="brand-name">Plan-vy <span>Intelligence</span></span></div>
    <div class="rail-scroll">${NAV.map((g) => `<nav class="nav nav-group" aria-label="${attr(g.group)}"><div class="nav-label">${esc(g.group)}</div>
      ${g.items.map(([href, label, ic]) => `<a href="${href}"${isActive(href) ? ' aria-current="page"' : ""}>${icon(ic, 16)}<span>${esc(label)}</span>${count[href] ? `<span class="count">${count[href]}</span>` : ""}</a>`).join("")}</nav>`).join("")}
    </div>
    <div class="rail-foot">
      <span class="conn ${src.tone}"><i></i>${esc(src.text)}</span>
      <span class="conn ${store.sampleState === "ready" ? "on" : ""}"><i></i>${store.sampleState === "ready" ? (store.tools ? "Claude: chat and agents" : "Claude: text answers") : store.sampleState === "connecting" ? "Connecting to Claude…" : "Claude not available here"}</span>
    </div>`;
}

function renderTop(parts, storeMode, title) {
  const top = document.getElementById("os-top");
  const m = store.market;
  const label = storeMode ? "Store workspace (Sweden, kr)" : title ? shorten(title) : "";
  top.innerHTML = `
    <button class="burger" id="os-burger" aria-label="Open the menu">${icon("menu", 18)}</button>
    <nav class="crumbs" aria-label="Breadcrumbs">${storeMode ? `<a href="#/radar">Research</a><span>/</span><b>Store</b>`
      : `${crumbs.map(([h, l]) => `<a href="${h}">${esc(l)}</a><span>/</span>`).join("")}<b>${esc(label)}</b>`}</nav>
    <span class="spacer"></span>
    <button class="fxbtn" id="os-fx" aria-pressed="${fxEnabled()}" title="Animations and effects on or off">${icon("spark", 14)}<span>Effects</span></button>
    ${storeMode ? "" : `<button class="cmdk" id="os-cmdk" aria-label="Search or research">${icon("search", 14)}<span>Search or research</span><kbd>⌘K</kbd></button>
    <div class="seg" role="group" aria-label="Market">${Object.values(MARKETS).map((x) => `<button data-set-market="${x.code}" aria-pressed="${x.code === m}" aria-label="${x.name}"><span>${x.code === "UK" ? 'UK<span class="hide-sm">&nbsp;· £</span>' : 'S<span class="hide-sm">weden · kr</span><span class="show-sm">E</span>'}</span></button>`).join("")}</div>`}`;
}

// ── Command palette ────────────────────────────────────────────────────
function openPalette() {
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `<div class="palette" role="dialog" aria-label="Search or research"><input id="pal-q" type="text" placeholder="Search products, niches or pages, or research something new…" autocomplete="off"><div class="list" id="pal-list"></div></div>`;
  document.body.appendChild(ov);
  const q = ov.querySelector("#pal-q"), list = ov.querySelector("#pal-list");
  let sel = 0, items = [];
  const pages = [["Radar", "#/radar"], ["Discover", "#/discover"], ["New research", "#/research"], ["Brand Builder", "#/brands"], ["Shopify stores", "#/data?tab=shopify"], ["Early trends", "#/trends"], ["Niches", "#/niches"], ["Compare", "#/compare"], ["Ask the database", "#/chat"], ["Data and sources", "#/data"], ["Store: Kassa", "#/store/kassa"], ["Store: Risk", "#/store/risk"]];
  const where = store.market === "UK" ? "the UK" : MARKETS[store.market].name;
  const paint = () => {
    const raw = q.value.trim(), t = raw.toLowerCase();
    const prods = rows().filter((r) => !t || `${r.name} ${r.niche} ${r.category}`.toLowerCase().includes(t)).sort((a, b) => b.opportunity - a.opportunity).slice(0, 8)
      .map((r) => ({ href: `#/p/${r.id}`, html: `<span class="body"><b>${esc(r.name)}</b><small>${esc(r.niche)} · ${esc(r.stage)}</small></span>${scoreChip(r.opportunity)}` }));
    const pg = pages.filter(([l]) => !t || l.toLowerCase().includes(t)).slice(0, 5).map(([l, h]) => ({ href: h, html: `<span class="body"><b>${esc(l)}</b><small>Page</small></span>` }));
    // New research from the search field: n8n researches the text as a niche.
    const res = raw.length >= 2 ? [{ research: raw, html: `<span class="body"><b>Research “${esc(raw)}” in ${esc(where)}</b><small>${researchAvailable()
      ? store.research.state === "running" ? `Research on “${esc(store.research.topic)}” is running; this opens it` : "n8n finds five new product ideas with costing and an ad plan · about 30 s"
      : "Needs the n8n connector: open the page on claude.ai"}</small></span>${icon("spark", 16)}` }] : [];
    const ask = raw ? [{ href: "#/chat", ask: raw, html: `<span class="body"><b>Ask: “${esc(raw)}”</b><small>Search the database in plain language</small></span>${icon("chat", 16)}` }] : [];
    // With no match in the database, researching it is the likely intent.
    items = prods.length ? [...prods, ...pg, ...res, ...ask] : [...res, ...pg, ...ask];
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.innerHTML = items.map((x, i) => `<button class="li" data-i="${i}" aria-selected="${i === sel}">${x.html}</button>`).join("") || '<div class="empty">Nothing found.</div>';
  };
  const go = (i) => {
    const x = items[i];
    if (!x) return;
    close();
    if (x.research) {
      if (store.research.state !== "running") {
        const r = startResearch(x.research, store.market);
        if (!r.ok) toast(r.reason);
      }
      location.hash = "#/research?q=" + encodeURIComponent(store.research.state === "running" ? store.research.topic : x.research);
    } else if (x.ask) location.hash = "#/discover?q=" + encodeURIComponent(x.ask);
    else location.hash = x.href;
  };
  const close = () => { ov.remove(); document.removeEventListener("keydown", key, true); };
  const key = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
    else if (e.key === "Enter") { e.preventDefault(); go(sel); }
  };
  document.addEventListener("keydown", key, true);
  q.addEventListener("input", () => { sel = 0; paint(); });
  ov.addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    if (b) go(Number(b.dataset.i));
    else if (e.target === ov) close();
  });
  paint();
  q.focus();
}

// ── Tooltip and toast ──────────────────────────────────────────────────
function initTips() {
  const tip = document.getElementById("tip");
  let cur = null;
  const show = (el) => {
    const text = el.getAttribute("data-tip");
    if (!text) return;
    cur = el;
    tip.textContent = text;
    tip.classList.add("on");
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.top - h - 8;
    if (y < 8) y = r.bottom + 8;
    x = Math.max(8, Math.min(innerWidth - w - 8, x));
    tip.style.left = x + "px"; tip.style.top = y + "px";
  };
  const hide = () => { cur = null; tip.classList.remove("on"); };
  document.addEventListener("pointerover", (e) => { const el = e.target.closest?.("[data-tip]"); if (el && el !== cur) show(el); else if (!el && cur) hide(); });
  document.addEventListener("focusin", (e) => { const el = e.target.closest?.("[data-tip]"); if (el) show(el); });
  document.addEventListener("focusout", hide);
  addEventListener("scroll", hide, { passive: true });
}
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("on"), 3600);
}
window.__toast = toast;

// ── Drawer (phones) ────────────────────────────────────────────────────
const openDrawer = () => { document.getElementById("os-rail").classList.add("open"); document.getElementById("os-scrim").classList.add("on"); };
function closeDrawer() { document.getElementById("os-rail")?.classList.remove("open"); document.getElementById("os-scrim")?.classList.remove("on"); }

// ── Boot ───────────────────────────────────────────────────────────────
function boot() {
  const dataset = JSON.parse(document.getElementById("dataset").textContent);
  init(dataset);
  initFx();
  initTips();
  addEventListener("hashchange", () => render());
  document.addEventListener("click", (e) => {
    const t = e.target;
    const mk = t.closest?.("[data-set-market]");
    if (mk) { setMarket(mk.dataset.setMarket); return; }
    if (t.closest?.("#os-cmdk")) { openPalette(); return; }
    const fxb = t.closest?.("#os-fx");
    if (fxb) {
      const on = !fxEnabled();
      setFx(on);
      fxb.setAttribute("aria-pressed", String(on));
      if (on) { current.key = ""; render(true); burstAt(document.getElementById("os-fx"), 70); }
      return;
    }
    if (t.closest?.("#os-burger")) { openDrawer(); return; }
    if (t.closest?.("#os-scrim")) { closeDrawer(); return; }
    // Table rows link to the product unless a control inside was clicked.
    const row = t.closest?.("tr[data-go]");
    if (row && !t.closest("a,button,input,select,label")) location.hash = row.dataset.go;
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
    if (e.key === "Escape") closeDrawer();
  });
  let pending = false;
  onChange((what) => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      // Live data and edits re-render the current view in place.
      if (!document.getElementById("legacyRoot").hidden) { renderRail(parse().path, parse().params); return; }
      if (what === "market") { render(true); return; }
      else if (["connect", "live", "overlay", "products", "runs", "settings", "pagestore", "candidates", "watch", "compare", "research", "shopify"].includes(what)) {
        const busy = document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) && current.root?.contains(document.activeElement);
        if (!busy) render();
        else renderRail(parse().path, parse().params);
      }
    });
  });
  if (!location.hash) history.replaceState(null, "", "#/radar");
  render(true);
  connect(window.claude).catch(() => {});
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

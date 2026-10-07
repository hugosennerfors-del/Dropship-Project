// Product discovery: filters, sort presets and a natural-language box that
// writes the filters for you.

import { store, rows, toggleCompare, setMarket } from "../state.js";
import { esc, attr, icon, STAGE_ORDER, stageChip } from "../ui/dom.js";
import { productTable } from "../ui/table.js";
import { query, SORTS } from "../core/query.js";
import { parseQuestion } from "../core/nlq.js";
import { filterLabel } from "../chat/compose.js";
import { MARKETS } from "../core/markets.js";
import { session } from "../chat/engine.js";
import { startResearch, researchAvailable } from "../research.js";

const NUMERIC = [
  { field: "price", op: ">=", label: "Price from", money: true },
  { field: "price", op: "<=", label: "Price up to", money: true },
  { field: "margin", op: ">=", label: "Margin at least (%)" },
  { field: "profitGBP", op: ">=", label: "Profit/order at least (£)" },
  { field: "demand", op: ">=", label: "Demand at least" },
  { field: "trend", op: ">=", label: "Trend at least" },
  { field: "competition", op: "<=", label: "Competition at most" },
  { field: "brandability", op: ">=", label: "Brandability at least" },
  { field: "viral", op: ">=", label: "Viral at least" },
  { field: "tiktok", op: ">=", label: "TikTok at least" },
  { field: "meta", op: ">=", label: "Meta ads at least" },
  { field: "repeat", op: ">=", label: "Repeat purchase at least" },
  { field: "seasonalityRisk", op: "<=", label: "Seasonality risk at most" },
  { field: "risk", op: "<=", label: "Risk at most" },
  { field: "opportunity", op: ">=", label: "Opportunity at least" },
  { field: "confidence", op: ">=", label: "Confidence at least" },
];

const state = { filters: [], sort: "opportunity", colSort: null, colDir: "desc", nl: "", showMore: false };

export function setFilters(filters, sort) {
  state.filters = filters.slice();
  if (sort) { state.sort = sort; state.colSort = null; }
}

function spec() {
  const s = { filters: state.filters, sort: state.colSort ? { field: state.colSort, dir: state.colDir } : state.sort };
  return s;
}

function chips(market) {
  if (!state.filters.length) return '<span class="xs muted">No filters. Showing every product.</span>';
  return state.filters.map((f, i) => `<button class="chip" data-rm="${i}" title="Remove filter">${esc(filterLabel(f, market))}<span class="x">${icon("x", 12)}</span></button>`).join("")
    + '<button class="btn sm ghost" data-act="clear">Clear all</button>';
}

function results(market) {
  const all = rows(market);
  const res = query(all, spec());
  const sortLabel = state.colSort ? null : SORTS[state.sort]?.label;
  return `<div class="panel-h"><h2>${res.total} of ${all.length} products</h2>
      <div class="row">${store.compare.length ? `<a class="btn sm" href="#/compare">${icon("compare", 13)}Compare ${store.compare.length}</a>` : '<span class="xs muted hide-sm">Use + to add products to a comparison</span>'}
      ${res.total ? `<button class="btn sm" data-act="ask">${icon("chat", 13)}Ask about these</button>` : ""}</div></div>
    ${SORTS[state.sort]?.note && !state.colSort ? `<div class="panel-b xs muted" style="padding-block:8px;border-bottom:1px solid var(--border)">${esc(sortLabel)}: ${esc(SORTS[state.sort].note)}</div>` : ""}
    ${productTable(res.rows, { sortable: true, sortKey: state.colSort || (SORTS[state.sort]?.field ?? null), sortDir: state.colSort ? state.colDir : (SORTS[state.sort]?.dir || "desc"), compare: true, rank: true,
      columns: ["opportunity", "stage", "price", "margin", "profit", "demand", "trend", "competition", "risk", "confidence"],
      empty: "No products match all filters. Remove the strictest one (the chips above) or ask the chat for the closest matches." })}
    ${!res.total && state.nl && researchAvailable() ? `<div class="panel-b row" style="border-top:1px solid var(--border);justify-content:space-between"><span class="small muted">Nothing in the database fits “${esc(state.nl)}”. n8n can research it as a new niche.</span><button class="btn sm primary" data-act="research">${icon("spark", 13)}Research it in ${esc(market === "UK" ? "the UK" : MARKETS[market].name)}</button></div>` : ""}`;
}

const get = (field, op) => state.filters.find((f) => f.field === field && f.op === op)?.value;

export function render(params) {
  const m = store.market, cfg = MARKETS[m];
  const rs = rows(m);
  if (params?.get?.("q") && params.get("q") !== state.nl) applyNL(params.get("q"), m);
  const cats = [...new Set(rs.map((r) => r.category).filter(Boolean))].sort();
  const nichesL = [...new Set(rs.map((r) => r.niche).filter(Boolean))].sort();
  const stageSel = state.filters.find((f) => f.field === "stage")?.value || [];
  const cat = state.filters.find((f) => f.field === "category")?.value || "";
  const niche = state.filters.find((f) => f.field === "niche")?.value || "";
  const proven = state.filters.some((f) => f.field === "validation");
  return {
    title: "Discover",
    html: `<div class="page view-enter">
      <header class="page-head"><div>
        <div class="eyebrow">${icon("search", 14)} ${esc(cfg.name)}</div>
        <h1>Discover products</h1>
        <p>Filter the whole database, or describe what you want and the filters are set for you. The chat uses the same engine, so results match.</p>
      </div></header>

      <form class="panel" id="nlForm" style="display:flex;gap:8px;align-items:center;padding:6px 6px 6px 14px">
        ${icon("spark", 16)}
        <label for="nl" class="sr">Describe the products you want</label>
        <input id="nl" type="search" value="${attr(state.nl)}" placeholder="e.g. margin over 60, price under £80, low competition, good for TikTok" style="flex:1;border:0;box-shadow:none;height:34px;font-size:14px">
        <button class="btn primary" type="submit">Apply</button>
        <button class="btn" type="button" data-act="research"${researchAvailable() ? "" : " disabled"} title="${attr(researchAvailable() ? "Have n8n research the text as a niche: five new product ideas with costing and an ad plan" : "New research needs the n8n connector")}">${icon("spark", 14)}<span class="hide-sm">Research new</span></button>
      </form>

      <section class="panel">
        <div class="panel-b stack">
          <div class="row" style="gap:10px">
            <label class="field" style="flex:1 1 180px"><span>Category</span><select id="f-category"><option value="">All categories</option>${cats.map((c) => `<option${c === cat ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
            <label class="field" style="flex:1 1 220px"><span>Niche</span><select id="f-niche"><option value="">All niches</option>${nichesL.map((c) => `<option${c === niche ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
            <label class="field" style="flex:1 1 200px"><span>Sort by</span><select id="f-sort">${Object.entries(SORTS).map(([k, s]) => `<option value="${k}"${!state.colSort && state.sort === k ? " selected" : ""}>${esc(s.label)}</option>`).join("")}${state.colSort ? '<option selected value="">Column sort</option>' : ""}</select></label>
          </div>
          <div class="row" role="group" aria-label="Market stage">
            <span class="xs muted" style="margin-right:4px">Stage</span>
            ${STAGE_ORDER.map((s) => `<button class="chip" data-stage="${attr(s)}" aria-pressed="${stageSel.includes(s)}">${esc(s)}</button>`).join("")}
            <span style="width:8px"></span>
            <button class="chip" data-act="proven" aria-pressed="${proven}">Has proof of sales</button>
            <button class="chip" data-act="preset-early" title="Emerging or early growth, margin ≥ 55 %, competition ≤ 45">Early + high margin + low competition</button>
          </div>
          <details id="more"${state.showMore ? " open" : ""}>
            <summary class="small" style="cursor:pointer;color:var(--fg-2)">More filters</summary>
            <div class="grid g4" style="margin-top:12px">${NUMERIC.map((n, i) => `<label class="field"><span>${esc(n.label.replace("(£)", cfg.currency === "GBP" || n.field === "profitGBP" ? "(£)" : "(kr)"))}</span>
              <input type="number" inputmode="decimal" data-num="${i}" value="${get(n.field, n.op) ?? ""}" placeholder="any"></label>`).join("")}</div>
          </details>
          <div class="row" id="d-chips">${chips(m)}</div>
        </div>
      </section>

      <section class="panel" id="d-results">${results(m)}</section>
    </div>`,
  };
}

function setFilter(field, op, value) {
  state.filters = state.filters.filter((f) => !(f.field === field && f.op === op));
  if (value !== "" && value != null && !(Array.isArray(value) && !value.length)) state.filters.push({ field, op, value });
}

function applyNL(text, market) {
  state.nl = text;
  const p = parseQuestion(text, { market, rows: rows(market) });
  for (const f of p.filters) setFilter(f.field, f.op, f.value);
  if (p.sort) { state.sort = p.sort; state.colSort = null; }
  return p;
}

export function mount(root, { rerender }) {
  const m = () => store.market;
  const paint = () => {
    root.querySelector("#d-results").innerHTML = results(m());
    root.querySelector("#d-chips").innerHTML = chips(m());
  };
  root.addEventListener("submit", (e) => {
    if (e.target.id !== "nlForm") return;
    e.preventDefault();
    const p = applyNL(root.querySelector("#nl").value.trim(), m());
    if (p.market && p.market !== store.market) { setMarket(p.market); return; }
    rerender();
  });
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "f-category") { setFilter("category", "=", t.value); paint(); }
    else if (t.id === "f-niche") { setFilter("niche", "=", t.value); paint(); }
    else if (t.id === "f-sort" && t.value) { state.sort = t.value; state.colSort = null; paint(); }
  });
  let timer;
  root.addEventListener("input", (e) => {
    const i = e.target.dataset.num;
    if (i == null) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const n = NUMERIC[Number(i)];
      const v = e.target.value === "" ? "" : Number(e.target.value);
      setFilter(n.field, n.op, v === "" || Number.isNaN(v) ? "" : v);
      paint();
    }, 220);
  });
  root.addEventListener("toggle", (e) => { if (e.target.id === "more") state.showMore = e.target.open; }, true);
  root.addEventListener("click", (e) => {
    const t = e.target;
    const rm = t.closest("[data-rm]");
    if (rm) { state.filters.splice(Number(rm.dataset.rm), 1); rerender(); return; }
    if (t.closest("[data-act=clear]")) { state.filters = []; state.nl = ""; rerender(); return; }
    const st = t.closest("[data-stage]");
    if (st) {
      const cur = new Set(state.filters.find((f) => f.field === "stage")?.value || []);
      cur.has(st.dataset.stage) ? cur.delete(st.dataset.stage) : cur.add(st.dataset.stage);
      setFilter("stage", "in", [...cur]);
      st.setAttribute("aria-pressed", cur.has(st.dataset.stage));
      paint(); return;
    }
    if (t.closest("[data-act=proven]")) {
      const on = state.filters.some((f) => f.field === "validation");
      setFilter("validation", "in", on ? "" : ["Strong", "Medium"]);
      t.closest("[data-act=proven]").setAttribute("aria-pressed", !on);
      paint(); return;
    }
    if (t.closest("[data-act=preset-early]")) {
      setFilter("stage", "in", ["Emerging", "Early Growth"]);
      setFilter("margin", ">=", 55);
      setFilter("competition", "<=", 45);
      rerender(); return;
    }
    const s = t.closest("[data-sort]");
    if (s) {
      const k = s.dataset.sort;
      if (state.colSort === k) state.colDir = state.colDir === "asc" ? "desc" : "asc";
      else { state.colSort = k; state.colDir = s.dataset.asc === "1" ? "asc" : "desc"; }
      rerender(); return;
    }
    const c = t.closest("[data-compare]");
    if (c) {
      e.stopPropagation();
      if (!toggleCompare(c.dataset.compare)) window.__toast?.("You can compare up to five products.");
      paint(); return;
    }
    if (t.closest("[data-act=research]")) {
      const text = (root.querySelector("#nl")?.value || state.nl || "").trim();
      if (!text) { window.__toast?.("Write a niche or product in the box first, then research it."); root.querySelector("#nl")?.focus(); return; }
      const r = startResearch(text, m());
      if (!r.ok) { window.__toast?.(r.reason); return; }
      location.hash = "#/research?q=" + encodeURIComponent(text);
      return;
    }
    if (t.closest("[data-act=ask]")) {
      const res = query(rows(m()), spec());
      session.lastResultIds = res.rows.map((r) => r.id).slice(0, 15);
      location.hash = "#/chat";
      return;
    }
  });
}

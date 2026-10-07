// New research. The search field filters what the database already knows
// (analysed products and earlier ideas) as you type; "Research" asks the
// n8n Research generator for five new ideas in the current market. Ideas are
// AI estimates until "Analyse" turns one into a full, scored profile.

import { store, rows, onChange, allCandidates, loadCandidates } from "../state.js";
import { esc, attr, icon, money, pct, glyph, scoreChip, stageChip } from "../ui/dom.js";
import { MARKETS } from "../core/markets.js";
import { fold } from "../core/nlq.js";
import { researchRuns } from "../core/candidates.js";
import { startResearch, checkAgain, clearResearch, researchAvailable } from "../research.js";
import { runProfiler } from "../agents/index.js";
import { aiUnavailableNote, shortName } from "./shared.js";
import { errCopy } from "./radar.js";

const ui = { q: "", qFrom: null, market: "", profiling: {}, listState: "idle" };

const words = (q) => fold(q).split(/[\s,]+/).filter((w) => w.length > 1);
const hits = (text, ws) => { const h = fold(text); return ws.every((w) => h.includes(w)); };
const where = (m) => (m === "UK" ? "the UK" : MARKETS[m]?.name || m);
const shortDate = (d) => { const x = new Date(d); return Number.isNaN(+x) ? d : x.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); };
const secs = (r) => `${Math.max(0, Math.round((Date.now() - r.startedAt) / 1000))} s`;

export function render(params) {
  const fromUrl = params?.get?.("q");
  if (fromUrl != null && fromUrl !== ui.qFrom) { ui.q = fromUrl; ui.qFrom = fromUrl; }
  const m = store.market;
  return {
    title: "New research",
    html: `<div class="page view-enter">
      <header class="page-head"><div>
        <div class="eyebrow">${icon("spark", 14)} Research</div>
        <h1>Research new products</h1>
        <p>Search what the database already knows, or have n8n research a niche: five new product ideas with costing and an ad plan, saved in Supabase. Analyse an idea to score it against everything else.</p>
      </div></header>

      <form class="panel r-search" id="rForm" role="search">
        <div class="r-bar">
          ${icon("search", 16)}
          <label for="rq" class="sr">Niche or product</label>
          <input id="rq" type="search" value="${attr(ui.q)}" placeholder="A niche or product, e.g. cold-water swimming, dog grooming, padel" autocomplete="off">
          <button class="btn primary" type="button" data-act="run"${researchAvailable() && store.research.state !== "running" ? "" : " disabled"}>${icon("spark", 14)}<span>Research in ${esc(where(m))}</span></button>
        </div>
        <div class="r-foot xs muted">${footNote(m)}</div>
      </form>

      <div id="r-run" class="r-stack">${runPanel()}</div>
      <div id="r-dyn" class="r-stack">${dynamic(m)}</div>
    </div>`,
  };
}

function footNote(m) {
  if (!researchAvailable()) return `${icon("info", 14)}<span>New research needs the n8n connector, which this view does not have. Open the page on claude.ai and allow n8n when it asks. Searching what is already here still works.</span>`;
  const live = store.live.state === "offline" && store.live.error ? ` <span style="color:var(--warn)">n8n answered with a problem earlier: ${esc(store.live.error)}</span>` : "";
  return `<span>Typing searches the database and earlier research. <b>Research</b> asks your n8n Research generator for five new ideas in ${esc(where(m))}, with costing and an ad plan, and saves them in Supabase. It takes about half a minute and uses the workflow's OpenAI credits. Switch market at the top.${live}</span>`;
}

// ── The current run ────────────────────────────────────────────────────
function runPanel() {
  const r = store.research;
  if (r.state === "running") {
    return `<section class="panel r-status" aria-live="polite"><span class="thinking"><i></i><i></i><i></i></span>
      <div><b>Researching “${esc(r.topic)}” in ${esc(where(r.market))}…</b>
      <div class="xs muted"><span id="r-elapsed">${secs(r)}</span> · n8n Research generator · usually 20–40 seconds. You can keep working; the ideas appear here and in the list below.</div></div></section>`;
  }
  if (r.state === "slow") {
    return `<div class="callout warn" role="status">${icon("warn", 16)}<span><b>n8n is still working on “${esc(r.topic)}”.</b> It saves the ideas in Supabase when it finishes. <button class="btn sm" data-act="again">Check again</button></span></div>`;
  }
  if (r.state === "error") {
    return `<div class="callout bad" role="alert">${icon("warn", 16)}<span><b>${esc(r.error)}</b> ${esc(r.fix)} <button class="btn sm" data-act="retry">Try again</button></span></div>`;
  }
  if (r.state !== "done") return "";
  const all = allCandidates();
  const fresh = (r.ids || []).map((id) => all.find((c) => c.id === id)).filter(Boolean);
  if (!fresh.length) return "";
  return `<section class="panel" aria-live="polite">
    <div class="panel-h"><div><h2>${fresh.length} new idea${fresh.length === 1 ? "" : "s"} for “${esc(r.topic)}”</h2><span class="sub">${esc(MARKETS[r.market]?.name || r.market)} · saved to Supabase · numbers are AI estimates</span></div>
      <button class="btn sm ghost" data-act="clear">${icon("x", 13)}Hide</button></div>
    ${store.sampleState === "ready" ? "" : `<div class="panel-b">${aiUnavailableNote()}</div>`}
    <div class="r-grid">${fresh.map(card).join("")}</div>
    <div class="panel-b xs muted r-note">${glyph("A")}<span>Prices and costs include VAT. They and the CPA are the language model's guesses, not supplier quotes. Analysing an idea scores it against the database; it then appears in Discover, the rankings and the chat.</span></div>
  </section>`;
}

function card(c) {
  const plan = c.adPlan || {};
  return `<article class="r-card">
    <div class="r-card-h"><b>${esc(c.name)}</b>${glyph("A")}</div>
    ${c.notes ? `<p class="small muted">${esc(c.notes)}</p>` : ""}
    <dl class="r-nums">
      <div><dt>Price</dt><dd>${money(c.price, c.currency)}</dd></div>
      <div><dt>Cost</dt><dd>${money(c.cost, c.currency)}</dd></div>
      <div><dt>Margin</dt><dd>${pct(c.margin, 0)}</dd></div>
      <div><dt>CPA guess</dt><dd>${money(c.cpa, c.currency)}</dd></div>
      <div><dt>Profit/order</dt><dd class="${c.profit > 0 ? "pos-n" : c.profit < 0 ? "neg-n" : ""}">${money(c.profit, c.currency)}</dd></div>
    </dl>
    ${plan.hook ? `<div class="r-hook"><span class="xs muted">Ad hook${plan.format ? ` · ${esc(plan.format)}` : ""}</span><q>${esc(plan.hook)}</q>${plan.angle ? `<span class="xs muted">${esc(plan.angle)}</span>` : ""}</div>` : ""}
    <div class="r-card-f">${action(c)}${plan.adLibraryQuery ? `<span class="xs muted" title="Search this in Meta's Ad Library to see competing ads">Ad Library: “${esc(plan.adLibraryQuery)}”</span>` : ""}</div>
  </article>`;
}

const profiledId = (c) => store.userProducts.find((p) => p.fromCandidate === c.id || (c.sourceId && p.candidateId === c.sourceId))?.id || null;

function action(c) {
  const pid = profiledId(c);
  const st = ui.profiling[c.id];
  if (pid) return `<a class="btn sm" href="#/p/${attr(pid)}">${icon("arrow", 13)}Open profile</a>`;
  if (st === "running") return '<span class="thinking"><i></i><i></i><i></i>&nbsp;Analysing</span>';
  if (st && st !== "done") return `<span class="xs" style="color:var(--bad)">${esc(st)}</span>`;
  if (!["UK", "SE"].includes(c.market)) return '<span class="xs muted">Only UK and Swedish ideas can be analysed</span>';
  if (store.sampleState !== "ready") return '<span class="xs muted">Analysing needs Claude</span>';
  return `<button class="btn sm" data-profile="${attr(c.id)}">${icon("spark", 13)}Analyse</button>`;
}

// ── What the search field finds ────────────────────────────────────────
function dynamic(m) {
  return `${matches(m)}${recent()}${ideas()}`;
}

function matches(m) {
  const ws = words(ui.q);
  if (!ws.length) return "";
  const prods = rows(m).filter((r) => hits(`${r.name} ${r.niche || ""} ${r.microNiche || ""} ${r.category || ""} ${r.subcategory || ""}`, ws))
    .sort((a, b) => b.opportunity - a.opportunity);
  const n = allCandidates().filter((c) => hits(`${c.name} ${c.niche || ""} ${c.notes || ""}`, ws)).length;
  // Offer a run unless one is going or this topic was just researched.
  const r = store.research;
  const offer = researchAvailable() && r.state !== "running" && !(r.state === "done" && fold(r.topic) === fold(ui.q) && r.market === m);
  return `<section class="panel">
    <div class="panel-h"><div><h3>Already in the database</h3><span class="sub">${prods.length} analysed ${esc(MARKETS[m].name)} product${prods.length === 1 ? "" : "s"} and ${n} earlier idea${n === 1 ? "" : "s"} match “${esc(ui.q)}”</span></div>
      ${offer && prods.length ? `<button class="btn sm" data-act="run">${icon("spark", 13)}Research “${esc(shortName(ui.q, 28))}” anyway</button>` : ""}</div>
    ${prods.length ? `<div class="list">${prods.slice(0, 6).map((x) => `<a class="li" href="#/p/${attr(x.id)}"><span class="body"><b>${esc(shortName(x.name))}</b><small>${esc(x.niche || "")} · ${pct(x.margin, 0)} margin · ${money(x.profit, x.currency)}/order</small></span><span class="side">${stageChip(x.stage)}${scoreChip(x.opportunity)}</span></a>`).join("")}</div>`
      : `<div class="empty">No analysed product matches “${esc(ui.q)}” yet.${offer ? ` <button class="btn sm primary" data-act="run">${icon("spark", 13)}Research it in ${esc(where(m))}</button>` : ""}</div>`}
  </section>`;
}

function recent() {
  const runs = researchRuns(allCandidates(), 10);
  if (!runs.length) return "";
  return `<div class="row r-recent"><span class="xs muted">Earlier research</span>${runs.map((x) => `<button class="chip" data-topic="${attr(x.topic)}" title="${attr(`${x.count} idea${x.count === 1 ? "" : "s"} · ${x.market}${x.date ? " · " + x.date : ""}`)}">${esc(shortName(x.topic, 30))}<span class="muted xs">&nbsp;${esc(x.market)}${x.date ? " · " + esc(shortDate(x.date)) : ""}</span></button>`).join("")}</div>`;
}

function ideas() {
  const cands = allCandidates();
  const ws = words(ui.q);
  const list = cands.filter((c) => (!ui.market || c.market === ui.market) && (!ws.length || hits(`${c.name} ${c.niche || ""} ${c.notes || ""}`, ws)));
  const markets = [...new Set(cands.map((c) => c.market))];
  const fresh = new Set(store.research.ids || []);
  return `<section class="panel">
    <div class="panel-h"><div><h3>All research ideas</h3><span class="sub">${list.length} of ${store.inboxTotal}${ws.length ? ` matching “${esc(ui.q)}”` : ""} · from <code>product_candidates</code></span></div>
      <div class="row">
        <label class="field" style="min-width:110px"><span class="sr">Market</span><select id="r-market" aria-label="Market"><option value="">All markets</option>${markets.map((k) => `<option value="${attr(k)}"${ui.market === k ? " selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
        ${store.live.state === "ready" ? `<button class="btn sm" data-act="reload">${ui.listState === "loading" ? "Loading…" : store.candidates ? "Reload from Supabase" : "Load all from Supabase"}</button>` : ""}
      </div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Idea</th><th>Market</th><th class="r">Price</th><th class="r">Margin</th><th class="r hide-sm">Profit/order</th><th class="hide-sm">Researched</th><th class="r"></th></tr></thead><tbody>
    ${list.slice(0, 200).map((c) => `<tr><td><div class="pname" style="min-width:220px"><b style="font-weight:500">${esc(c.name)}${fresh.has(c.id) ? ' <span class="tag">New</span>' : ""}</b><small>${esc(c.niche || "")}</small></div>${c.notes ? `<div class="xs muted" style="max-width:56ch;margin-top:2px">${esc(String(c.notes).slice(0, 160))}${String(c.notes).length > 160 ? "…" : ""}</div>` : ""}</td>
      <td>${esc(c.market)}</td><td class="r metric">${money(c.price, c.currency)}</td><td class="r metric">${pct(c.margin, 0)}</td><td class="r metric hide-sm ${c.profit > 0 ? "pos-n" : c.profit < 0 ? "neg-n" : ""}">${money(c.profit, c.currency)}</td><td class="hide-sm xs muted">${esc(c.researchDate || "")}</td>
      <td class="r">${action(c)}</td></tr>`).join("") || '<tr><td colspan="7"><div class="empty">No ideas match.</div></td></tr>'}
    </tbody></table></div>
    <div class="panel-b xs muted" style="border-top:1px solid var(--border)">${list.length > 200 ? "First 200 shown. " : ""}Ideas come from the n8n Research generator. Their numbers are a model's guesses, so they stay out of the rankings until analysed. US ideas can be read but not analysed: the tool covers the UK and Sweden.</div>
  </section>`;
}

// ── Events ─────────────────────────────────────────────────────────────
export function mount(root, { rerender }) {
  const input = () => root.querySelector("#rq");
  const paintRun = () => { const el = root.querySelector("#r-run"); if (el) el.innerHTML = runPanel(); paintButtons(); };
  const paintDyn = () => { const el = root.querySelector("#r-dyn"); if (el) el.innerHTML = dynamic(store.market); };
  const paintButtons = () => {
    const off = !researchAvailable() || store.research.state === "running";
    root.querySelectorAll("#rForm [data-act=run]").forEach((b) => { b.disabled = off; });
  };

  const run = (text) => {
    const t = (text ?? input()?.value ?? "").trim();
    if (!t) { window.__toast?.("Write a niche or product to research first."); input()?.focus(); return; }
    ui.q = t;
    const res = startResearch(t, store.market);
    if (!res.ok) window.__toast?.(res.reason);
    paintRun(); paintDyn();
  };

  let timer;
  root.addEventListener("input", (e) => {
    if (e.target.id !== "rq") return;
    clearTimeout(timer);
    timer = setTimeout(() => { ui.q = e.target.value.trim(); paintDyn(); }, 200);
  });
  // Enter searches; only the button starts a paid research run.
  root.addEventListener("submit", (e) => {
    if (e.target.id !== "rForm") return;
    e.preventDefault();
    clearTimeout(timer);
    ui.q = input().value.trim();
    paintDyn();
  });
  root.addEventListener("change", (e) => {
    if (e.target.id === "r-market") { ui.market = e.target.value; paintDyn(); }
  });
  root.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-act=run]")) { run(t.closest("#rForm") ? undefined : ui.q); return; }
    if (t.closest("[data-act=again]")) { checkAgain(); return; }
    if (t.closest("[data-act=retry]")) { const r = store.research; const res = startResearch(r.topic, r.market); if (!res.ok) window.__toast?.(res.reason); return; }
    if (t.closest("[data-act=clear]")) { clearResearch(); return; }
    const tp = t.closest("[data-topic]");
    if (tp) { ui.q = tp.dataset.topic; const el = input(); if (el) el.value = ui.q; paintDyn(); return; }
    if (t.closest("[data-act=reload]")) {
      ui.listState = "loading"; paintDyn();
      try { await loadCandidates(); } catch (err) { window.__toast?.(err?.message || "The ideas could not be loaded."); }
      ui.listState = "idle"; paintDyn(); return;
    }
    const pf = t.closest("[data-profile]");
    if (pf) {
      const id = pf.dataset.profile;
      const cand = allCandidates().find((c) => c.id === id);
      if (!cand) return;
      ui.profiling[id] = "running"; paintRun(); paintDyn();
      try {
        const res = await runProfiler(cand);
        ui.profiling[id] = "done";
        window.__toast?.(res.saved ? "AI profile saved to the database. Open it to see its scores." : "AI profile added for this visit; it could not be saved.");
      } catch (err) { ui.profiling[id] = errCopy(err); }
      rerender();
    }
  });

  // The run's state changes while you type: repaint only its panel.
  const off = onChange((what) => {
    if (["research", "candidates", "products"].includes(what)) { paintRun(); paintDyn(); }
    // n8n can connect while you type; the button and its note follow.
    if (["connect", "live"].includes(what)) { paintButtons(); const f = root.querySelector(".r-foot"); if (f) f.innerHTML = footNote(store.market); }
  });
  const tick = setInterval(() => {
    const el = root.querySelector("#r-elapsed");
    if (el && store.research.state === "running") el.textContent = secs(store.research);
  }, 1000);
  return () => { off(); clearInterval(tick); clearTimeout(timer); };
}

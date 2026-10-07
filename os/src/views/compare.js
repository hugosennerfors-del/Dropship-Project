// Compare 2–5 products side by side, with a computed conclusion and an
// optional verdict from Claude.

import { store, rows, row, toggleCompare } from "../state.js";
import { esc, attr, int, pct, money, mult, icon, scoreChip, stageChip, md, dateLabel } from "../ui/dom.js";
import { MARKETS } from "../core/markets.js";
import { runCompare } from "../agents/index.js";
import { plink, aiUnavailableNote } from "./shared.js";
import { errCopy } from "./radar.js";

let judge = { state: "idle", ctl: null, error: "" };

const METRICS = [
  ["opportunity", "Opportunity", "high", (r) => scoreChip(r.opportunity)],
  ["evidenceWeighted", "Evidence-weighted", "high", (r) => int(r.evidenceWeighted)],
  ["confidence", "Data confidence", "high", (r) => int(r.confidence)],
  ["risk", "Risk", "low", (r) => int(r.risk)],
  ["stage", "Stage", null, (r) => stageChip(r.stage)],
  ["validation", "Proof of sales", null, (r) => esc(r.validation)],
  ["price", "Price", null, (r) => money(r.price, r.currency)],
  ["margin", "Gross margin", "high", (r) => pct(r.margin, 1)],
  ["profitGBP", "Profit/order (after CAC)", "high", (r) => money(r.profit, r.currency)],
  ["netMargin", "Net margin", "high", (r) => pct(r.netMargin, 1)],
  ["cac", "Estimated CAC", "low", (r) => money(r.cac, r.currency)],
  ["breakEvenRoas", "Break-even ROAS", "low", (r) => mult(r.breakEvenRoas)],
  ["startupCost", "Launch cost", "low", (r) => money(r.startupCost, r.currency, { digits: 0 })],
  ["demand", "Demand", "high", (r) => int(r.demand)],
  ["trend", "Trend", "high", (r) => int(r.trend)],
  ["trendAcceleration", "Acceleration", "high", (r) => `${r.trendAcceleration > 0 ? "+" : ""}${int(r.trendAcceleration)}%`],
  ["competition", "Competition", "low", (r) => int(r.competition)],
  ["brandability", "Brandability", "high", (r) => int(r.brandability)],
  ["adPotential", "Ad potential", "high", (r) => int(r.adPotential)],
  ["repeat", "Repeat purchase", "high", (r) => int(r.repeat)],
  ["ease", "Ease of launch", "high", (r) => int(r.ease)],
];

export function render() {
  const m = store.market;
  const sel = store.compare.map((id) => row(id, m)).filter(Boolean);
  const missing = store.compare.filter((id) => !row(id, m));
  const all = rows(m);
  const pickable = all.filter((r) => !store.compare.includes(r.id)).sort((a, b) => b.opportunity - a.opportunity);
  const best = (k, dir) => {
    const xs = sel.filter((r) => typeof r[k] === "number");
    if (xs.length < 2) return null;
    return xs.reduce((a, b) => (dir === "high" ? (b[k] > a[k] ? b : a) : (b[k] < a[k] ? b : a))).id;
  };
  const conclusion = sel.length >= 2 ? conclude(sel) : null;
  const last = store.runs.find((r) => r.agent === "compare" && r.market === m && sameSet(r.productIds, store.compare));
  return {
    title: "Compare",
    html: `<div class="page view-enter">
      <header class="page-head"><div>
        <div class="eyebrow">${icon("compare", 14)} ${esc(MARKETS[m].name)}</div>
        <h1>Compare products</h1>
        <p>Pick two to five products. The best value in each row is marked.</p>
      </div>
      <label class="field" style="min-width:260px"><span>Add a product</span><select id="addCompare"${store.compare.length >= 5 ? " disabled" : ""}><option value="">Choose…</option>${pickable.map((r) => `<option value="${attr(r.id)}">${esc(r.name)} (${r.opportunity})</option>`).join("")}</select></label></header>
      ${missing.length ? `<div class="callout">${icon("info", 16)}<span>${missing.length} selected product${missing.length > 1 ? "s have" : " has"} no ${esc(MARKETS[m].name)} analysis and ${missing.length > 1 ? "are" : "is"} hidden.</span></div>` : ""}
      ${sel.length < 2 ? `<div class="panel"><div class="empty">${icon("compare", 20)}<span>Add at least two products, here or with the + button in Discover.</span></div></div>` : `
      <section class="panel"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th style="min-width:150px"></th>${sel.map((r) => `<th style="min-width:150px"><div class="stack" style="gap:4px"><a class="plink" href="#/p/${attr(r.id)}" style="font-size:13px;color:var(--fg);border:0">${esc(short(r.name))}</a><button class="linkish xs" data-remove="${attr(r.id)}" style="justify-self:start;color:var(--fg-3)">Remove</button></div></th>`).join("")}</tr></thead>
        <tbody>${METRICS.map(([k, label, dir, cell]) => {
          const b = dir ? best(k, dir) : null;
          return `<tr><td class="small muted">${esc(label)}</td>${sel.map((r) => `<td class="mono small"${b === r.id ? ' style="background:var(--good-soft)"' : ""}>${cell(r)}${b === r.id ? ' <span class="sr">best</span>' : ""}</td>`).join("")}</tr>`;
        }).join("")}
        <tr><td class="small muted">Red flags</td>${sel.map((r) => `<td class="xs">${r.redFlags.length ? r.redFlags.map(esc).join("<br>") : '<span class="muted">None</span>'}</td>`).join("")}</tr>
        </tbody></table></div></section>

      <section class="panel"><div class="panel-h"><h2>Conclusion</h2><span class="sub">computed from the rows above</span></div>
        <div class="panel-b grid g4">${conclusion.map(([t, id, why]) => `<div class="stack" style="gap:4px"><span class="xs muted">${esc(t)}</span><b style="font-weight:500">${plink(id)}</b><span class="xs muted">${esc(why)}</span></div>`).join("")}</div>
      </section>

      <section class="stack">
        ${aiUnavailableNote()}
        ${store.sampleState === "ready" ? `<div class="agent"><div class="agent-h"><div><h3>${icon("spark", 14)} Comparison judge</h3><p>Claude weighs the products against each other and picks one, saying where thin data limits the verdict.</p></div>
          ${judge.state === "running" ? `<button class="btn sm" data-judge-stop>${icon("stop", 13)}Stop</button>` : `<button class="btn sm${last ? "" : " accent"}" data-judge>${icon("spark", 13)}${last ? "Judge again" : "Ask for a verdict"}</button>`}</div>
          ${judge.state === "running" ? '<div class="agent-b"><span class="thinking"><i></i><i></i><i></i>&nbsp;Comparing</span></div>' : judge.state === "error" ? `<div class="agent-b"><div class="callout warn">${icon("warn", 16)}<span>${esc(judge.error)}</span></div></div>` : last ? `<div class="agent-b">${verdict(last)}</div>` : ""}
        </div>` : ""}
      </section>`}
    </div>`,
  };
}

function verdict(run) {
  const o = run.output;
  return `<div class="prose">${md(o.verdict || "")}</div>
    <ol class="bullets small">${(o.ranking || []).sort((a, b) => a.rank - b.rank).map((x) => `<li>${plink(x.id)}: ${esc(x.reason)}</li>`).join("")}</ol>
    ${o.chooseIf?.length ? `<div class="stack" style="gap:4px">${o.chooseIf.map((x) => `<div class="small">Choose ${plink(x.id)} if ${esc(x.when)}</div>`).join("")}</div>` : ""}
    ${o.whatToTestFirst ? `<div class="callout">${icon("flask", 16)}<span>${esc(o.whatToTestFirst)}</span></div>` : ""}
    <span class="ai-tag">${icon("spark", 12)} AI verdict · ${dateLabel(run.createdAt)}</span>`;
}

function conclude(sel) {
  const by = (f, dir = -1) => [...sel].sort((a, b) => dir * ((a[f] ?? -1e9) - (b[f] ?? -1e9)))[0];
  const best = by("evidenceWeighted");
  const safest = by("risk", 1);
  const profit = by("profitGBP");
  const beginner = [...sel].sort((a, b) => (0.4 * b.ease + 0.3 * (100 - b.risk) + 0.3 * b.opportunity) - (0.4 * a.ease + 0.3 * (100 - a.risk) + 0.3 * a.opportunity))[0];
  return [
    ["Best overall", best.id, `evidence-weighted ${best.evidenceWeighted}, confidence ${best.confidence}`],
    ["Safest", safest.id, `risk ${safest.risk}/100`],
    ["Most profit per order", profit.id, `${money(profit.profit, profit.currency)} after est. CAC`],
    ["Best for a beginner", beginner.id, `ease ${beginner.ease}, risk ${beginner.risk}`],
  ];
}
const short = (n) => { const s = String(n).split(/:\s/)[0]; return s.length > 40 ? s.slice(0, 38) + "…" : s; };
const sameSet = (a = [], b = []) => a.length === b.length && a.every((x) => b.includes(x));

export function mount(root, { rerender }) {
  root.addEventListener("change", (e) => {
    if (e.target.id === "addCompare" && e.target.value) { toggleCompare(e.target.value); rerender(); }
  });
  root.addEventListener("click", async (e) => {
    const rm = e.target.closest("[data-remove]");
    if (rm) { toggleCompare(rm.dataset.remove); rerender(); return; }
    if (e.target.closest("[data-judge-stop]")) { judge.ctl?.abort(); return; }
    if (e.target.closest("[data-judge]")) {
      judge = { state: "running", ctl: new AbortController(), error: "" };
      rerender();
      try { await runCompare(store.compare.filter((id) => row(id, store.market)), store.market, { signal: judge.ctl.signal }); judge.state = "idle"; }
      catch (err) { judge.state = err?.code === "cancelled" ? "idle" : "error"; judge.error = errCopy(err); }
      rerender();
    }
  });
}

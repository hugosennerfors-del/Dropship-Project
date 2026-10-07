// Trend detection: where each product sits in its lifecycle, and the early
// opportunities with the evidence for calling them early.

import { store, rows, product } from "../state.js";
import { esc, attr, int, pct, money, icon, STAGE_ORDER, scoreChip, stageChip, gradeChip } from "../ui/dom.js";
import { stageColor } from "../ui/charts.js";
import { MARKETS } from "../core/markets.js";

let preset = false;

export function render() {
  const m = store.market;
  let rs = rows(m);
  const all = rs;
  if (preset) rs = rs.filter((r) => (r.margin ?? 0) >= 55 && (r.competition ?? 100) <= 45 && ["Emerging", "Early Growth"].includes(r.stage));
  const early = all.filter((r) => ["Emerging", "Early Growth"].includes(r.stage)).sort((a, b) => b.opportunity - a.opportunity);
  return {
    title: "Early trends",
    html: `<div class="page view-enter">
      <header class="page-head"><div>
        <div class="eyebrow">${icon("trend", 14)} ${esc(MARKETS[m].name)}</div>
        <h1>Trends and lifecycle</h1>
        <p>Each product is placed in a stage from its trend score, how fast interest is accelerating, competition and saturation. A stage is a reading of the current data, so it moves when the data does.</p>
      </div>
      <button class="chip" data-act="preset" aria-pressed="${preset}">Emerging + high margin + low competition</button></header>

      <section class="board" aria-label="Products by stage">${STAGE_ORDER.map((s) => {
        const xs = rs.filter((r) => r.stage === s).sort((a, b) => b.opportunity - a.opportunity);
        return `<div class="col"><h3><span class="stage"><i style="background:${stageColor(s)}"></i>${esc(s)}</span><span class="metric muted">${xs.length}</span></h3>
          ${xs.map((r) => `<a class="card" href="#/p/${attr(r.id)}"><b>${esc(shortN(r.name))}</b>
            <span class="row between"><span class="xs muted">${r.trendAcceleration > 0 ? "+" : ""}${int(r.trendAcceleration)}% · comp. ${int(r.competition)}</span>${scoreChip(r.opportunity)}</span></a>`).join("") || '<span class="xs muted" style="padding:4px">None</span>'}
        </div>`;
      }).join("")}</section>
      ${preset && !rs.length ? `<div class="callout">${icon("info", 16)}<span>No product is emerging or in early growth with a margin of at least 55% and competition of 45 or less. The closest early-stage products are listed below.</span></div>` : ""}

      <section class="stack">
        <h2 class="section-title">Early trend opportunities <small>${early.length} product${early.length === 1 ? "" : "s"} in emerging or early growth</small></h2>
        ${early.map((r) => earlyCard(r, m)).join("") || '<div class="empty">No early-stage products in this market.</div>'}
      </section>

      <section class="panel">
        <div class="panel-h"><h3>How stages are assigned</h3></div>
        <div class="panel-b"><ul class="bullets small">
          <li><b>Declining / Saturated</b>: trend direction is down (saturated if saturation ≥ 75).</li>
          <li><b>Saturated</b>: saturation ≥ 80 and competition ≥ 75.</li>
          <li><b>Emerging</b>: interest accelerating ≥ 25% while competition &lt; 45 and demand &lt; 65.</li>
          <li><b>Early Growth</b>: acceleration ≥ 10% and competition &lt; 60.</li>
          <li><b>Peak</b>: trend ≥ 80 with acceleration ≤ 5%, or a mature market with little growth.</li>
          <li><b>Growing</b>: everything else with a trend ≥ 55 or positive acceleration.</li>
        </ul></div>
      </section>
    </div>`,
  };
}

function earlyCard(r, m) {
  const p = product(r.id);
  const d = p.built[m].scored._detail;
  const evs = (p.built[m].evidenceIds || []).map((id) => store.evidenceIndex[id]).filter(Boolean).filter((e) => ["search", "social", "media", "sales", "revenue", "units", "participation"].includes(e.kind));
  const cautions = [];
  if (r.validation === "None" || r.validation === "Weak") cautions.push("No solid sales evidence yet: interest may not turn into orders.");
  if ((r.confidence ?? 0) < 40) cautions.push(`Data confidence is ${r.confidence}/100.`);
  if ((r.profit ?? 0) <= 0) cautions.push(`Loses ${money(-r.profit, r.currency)} per order at the estimated CAC.`);
  return `<article class="panel">
    <div class="panel-h"><div class="row" style="gap:10px">${scoreChip(r.opportunity)}<h3><a class="plink" href="#/p/${attr(r.id)}" style="border:0;color:var(--fg)">${esc(r.name)}</a></h3>${stageChip(r.stage)}</div>
      <div class="row">${gradeChip(r.validation, "Proof of sales")}${gradeChip(r.interest, "Interest")}</div></div>
    <div class="panel-b grid g2">
      <div class="stack" style="gap:6px"><b class="small" style="font-weight:500">Why this may be early</b>
        <ul class="bullets small">${d.stage.why.map((x) => `<li>${esc(x)}</li>`).join("")}
          <li>Trend ${int(r.trend)}/100, demand ${int(r.demand)}, competition ${int(r.competition)}, margin ${pct(r.margin, 0)}.</li></ul>
        ${cautions.length ? `<b class="small" style="font-weight:500;margin-top:6px">Before you trust it</b><ul class="bullets small">${cautions.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
      </div>
      <div class="stack" style="gap:6px"><b class="small" style="font-weight:500">Evidence</b>
        ${evs.length ? evs.slice(0, 4).map((e) => `<div class="small"><span class="tag">${e.level}</span> ${esc(e.claim.length > 170 ? e.claim.slice(0, 168) + "…" : e.claim)} <span class="xs muted">${esc(e.source?.publisher || "")}, ${esc(e.market)}</span></div>`).join("") : '<p class="small muted">No trend evidence in the database: the stage rests on AI estimates.</p>'}
      </div>
    </div>
  </article>`;
}
const shortN = (n) => { const s = String(n).split(/:\s/)[0]; return s.length > 44 ? s.slice(0, 42) + "…" : s; };

export function mount(root, { rerender }) {
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-act=preset]")) { preset = !preset; rerender(); }
  });
}

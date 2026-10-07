// Opportunity Radar: the week's summary of the database for one market.

import { store, rows, product } from "../state.js";
import { esc, attr, int, money, pct, icon, md, isoWeek, STAGE_ORDER, scoreChip, dateLabel } from "../ui/dom.js";
import { productItem } from "../ui/table.js";
import { opportunityMap, stageLegend, stageBar } from "../ui/charts.js";
import { insights } from "../core/insights.js";
import { query, niches } from "../core/query.js";
import { MARKETS } from "../core/markets.js";
import { plink } from "./shared.js";
import { runBrief } from "../agents/index.js";

const MODES = { opportunity: "Opportunity", evidence: "Evidence-weighted" };
let mode = "opportunity";
let brief = { state: "idle", text: "", ctl: null };

export function render() {
  const m = store.market, cfg = MARKETS[m];
  const rs = rows(m);
  const ins = insights(rs, m);
  const top = query(rs, { sort: mode === "evidence" ? "evidence" : "opportunity", limit: 10 }).rows;
  const stageCounts = Object.fromEntries(STAGE_ORDER.map((s) => [s, rs.filter((r) => r.stage === s).length]));
  const profitable = rs.filter((r) => (r.profit ?? 0) > 0).length;
  const proven = rs.filter((r) => r.validation === "Strong" || r.validation === "Medium").length;
  const avgConf = rs.length ? Math.round(rs.reduce((a, r) => a + r.confidence, 0) / rs.length) : 0;
  const early = rs.filter((r) => r.stage === "Emerging" || r.stage === "Early Growth").length;
  const best = top[0];
  const sym = cfg.currency === "GBP" ? "£" : "";
  const under = cfg.currency === "GBP" ? 30 : 349, over = cfg.currency === "GBP" ? 50 : 599;
  const ns = niches(rs).filter((n) => n.gap != null).sort((a, b) => b.gap - a.gap).slice(0, 5);

  const block = (title, sub, list, metric, empty) => `<section class="panel">
    <div class="panel-h"><h3>${esc(title)}</h3>${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</div>
    <div class="list">${list.length ? list.map((r, i) => productItem(r, i, metric(r))).join("") : `<div class="empty">${esc(empty || "Nothing here yet.")}</div>`}</div>
  </section>`;
  const q = (spec) => query(rs, { limit: 5, ...spec }).rows;

  return {
    title: "Opportunity Radar",
    html: `<div class="page view-enter">
      <header class="page-head">
        <div>
          <div class="eyebrow">${icon("radar", 14)} ${esc(cfg.name)} · week ${isoWeek(new Date())} · ${rs.length} products analysed</div>
          <h1>Opportunity Radar</h1>
          <p>${best ? `The strongest opportunity right now is ${plink(best.id, best.name)} at ${best.opportunity}/100. ` : ""}${profitable} of ${rs.length} products make money per order at the estimated CAC, and ${proven} have evidence that people already pay for them.</p>
        </div>
        <div class="row"><a class="btn" href="#/discover">${icon("filter", 14)}Discover</a><a class="btn primary" href="#/chat">${icon("chat", 14)}Ask the database</a></div>
      </header>

      <section class="panel stats">
        <div class="stat"><span class="k">Products in ${esc(cfg.name)}</span><span class="v">${rs.length}</span><span class="d">${store.inboxTotal} more ideas under <a href="#/research">New research</a></span></div>
        <div class="stat"><span class="k">Profitable at est. CAC</span><span class="v">${profitable}</span><span class="d">after returns and ads</span></div>
        <div class="stat"><span class="k">Early stage</span><span class="v">${early}</span><span class="d">emerging or early growth</span></div>
        <div class="stat"><span class="k">With proof of sales</span><span class="v">${proven}</span><span class="d">strong or medium commercial evidence</span></div>
        <div class="stat"><span class="k">Avg. data confidence</span><span class="v">${avgConf}</span><span class="d">0–100, from value statuses</span></div>
      </section>

      <div class="split">
        <section class="panel">
          <div class="panel-h"><h2>Top 10 this week</h2>
            <div class="seg" role="group" aria-label="Rank by">${Object.entries(MODES).map(([k, l]) => `<button data-mode="${k}" aria-pressed="${mode === k}">${l}</button>`).join("")}</div>
          </div>
          <div class="list">${top.map((r, i) => `<a class="li" href="#/p/${attr(r.id)}">
            <span class="rank">${i + 1}</span>
            <span class="body"><b>${esc(r.name)}</b><small>${esc(r.niche)} · ${esc(r.stage)} · margin ${pct(r.margin, 0)} · ${money(r.profit, r.currency)}/order · confidence ${r.confidence}</small></span>
            <span class="side">${r.redFlags.length ? `<span class="tag" title="${attr(r.redFlags.join(", "))}">${r.redFlags.length} flag${r.redFlags.length > 1 ? "s" : ""}</span>` : ""}${scoreChip(mode === "evidence" ? r.evidenceWeighted : r.opportunity, { label: MODES[mode] })}</span>
          </a>`).join("")}</div>
        </section>

        <section class="panel">
          <div class="panel-h"><h2>AI insights</h2><span class="sub">computed from the data</span></div>
          <div class="panel-b stack" style="gap:14px">
            ${ins.slice(0, 6).map((x) => `<div class="stack" style="gap:4px">
              <div class="row" style="gap:8px"><span class="sev sev-${x.tone === "bad" ? "critical" : x.tone === "warn" ? "warning" : "info"}"${x.tone === "good" ? ' style="background:var(--good)"' : ""}></span><b style="font-weight:500;font-size:13.5px">${esc(x.title)}</b></div>
              <div class="prose small" style="padding-left:16px">${md(x.text, (id) => plink(id))}</div>
            </div>`).join("")}
            ${briefBlock()}
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="panel-h"><h2>Opportunity map</h2>${stageLegend(STAGE_ORDER)}</div>
        <div class="panel-b">${opportunityMap(rs)}<p class="xs muted" style="margin-top:6px">Bubble size is the opportunity score. Demand and competition are mostly AI estimates from cited research; hover a bubble for its numbers.</p></div>
      </section>

      <section class="panel">
        <div class="panel-h"><h2>Market stages</h2><span class="sub">${STAGE_ORDER.map((s) => `${s} ${stageCounts[s]}`).join(" · ")}</span></div>
        <div class="panel-b">${stageBar(stageCounts, rs.length || 1)}</div>
      </section>

      <section class="panel">
        <div class="panel-h"><h2>Market risks</h2><span class="sub">most common red flags across ${rs.length} products</span></div>
        <div class="list">${riskRows(rs).map((x) => `<div class="li"><span class="sev sev-${x.severity}"></span><span class="body"><b>${esc(x.title)}</b><small style="white-space:normal">${x.ids.slice(0, 6).map((id) => plink(id)).join(", ")}${x.ids.length > 6 ? ` and ${x.ids.length - 6} more` : ""}</small></span><span class="side"><span class="metric">${x.ids.length}</span></span></div>`).join("") || '<div class="empty">No red flags.</div>'}</div>
      </section>

      <div class="grid g3">
        ${block("Fastest growing", "trend acceleration", q({ sort: "growing" }), (r) => `${r.trendAcceleration > 0 ? "+" : ""}${int(r.trendAcceleration)}%`)}
        ${block("Highest margin", "gross, before ads", q({ sort: "margin" }), (r) => pct(r.margin, 0))}
        ${block("Lowest competition", "competition score", q({ sort: "competition" }), (r) => int(r.competition))}
      </div>

      <section class="panel">
        <div class="panel-h"><h2>Best emerging niches</h2><span class="sub">demand minus competition</span><a class="btn sm ghost" href="#/niches">All niches ${icon("arrow", 13)}</a></div>
        <div class="list">${ns.map((n, i) => `<a class="li" href="#/niches?n=${encodeURIComponent(n.name)}">
          <span class="rank">${i + 1}</span>
          <span class="body"><b>${esc(n.name)}</b><small>${esc(n.category)} · ${n.count} product${n.count > 1 ? "s" : ""} · demand ${int(n.demand)} · competition ${int(n.competition)}</small></span>
          <span class="side"><span class="metric ${n.gap > 0 ? "pos-n" : "neg-n"}">${n.gap > 0 ? "+" : ""}${int(n.gap)}</span>${scoreChip(n.opportunity)}</span></a>`).join("")}</div>
      </section>

      <div class="grid g3">
        ${block(`Best ${cfg.code === "UK" ? "UK" : "Swedish"} fit`, "market relevance × opportunity", [...rs].filter((r) => r.relevance != null).sort((a, b) => b.relevance * b.opportunity - a.relevance * a.opportunity).slice(0, 5), (r) => `fit ${int(r.relevance)}`)}
        ${block(`Under ${sym}${under}${sym ? "" : " kr"}`, "consumer price", q({ filters: [{ field: "price", op: "<", value: under }] }), (r) => money(r.price, r.currency))}
        ${block(`Over ${sym}${over}${sym ? "" : " kr"}`, "consumer price", q({ filters: [{ field: "price", op: ">", value: over }] }), (r) => money(r.price, r.currency))}
        ${block("Best for TikTok", "TikTok potential", q({ sort: "tiktok" }), (r) => int(r.tiktok))}
        ${block("Best for Meta ads", "Meta potential", q({ sort: "meta" }), (r) => int(r.meta))}
        ${block("Best for organic", "organic content", q({ sort: "organic" }), (r) => int(r.organic))}
      </div>
      <section class="panel">
        <div class="panel-h"><h2>Best brand opportunities</h2><span class="sub">brandability with room to differentiate</span></div>
        <div class="list">${[...rs].sort((a, b) => (b.brandability + b.differentiation + b.opportunity) - (a.brandability + a.differentiation + a.opportunity)).slice(0, 5)
          .map((r, i) => productItem(r, i, `brand ${int(r.brandability)} · diff. ${int(r.differentiation)}`)).join("")}</div>
      </section>
      <p class="xs muted">Data generated ${dateLabel(store.dataset.meta.generated)}. ${esc(store.dataset.meta.note)}</p>
    </div>`,
  };
}

function riskRows(rs) {
  const by = new Map();
  for (const r of rs) {
    const p = product(r.id);
    for (const f of p?.built?.[store.market]?.scored?._detail?.redFlags || []) {
      if (!by.has(f.title)) by.set(f.title, { title: f.title, severity: f.severity, ids: [] });
      const x = by.get(f.title);
      x.ids.push(r.id);
      if (f.severity === "critical") x.severity = "critical";
    }
  }
  return [...by.values()].sort((a, b) => (b.severity === "critical") - (a.severity === "critical") || b.ids.length - a.ids.length).slice(0, 6);
}

function briefBlock() {
  if (!store.sample || store.sampleState !== "ready") return "";
  const last = store.runs.find((r) => r.agent === "brief" && r.market === store.market);
  const text = brief.state === "running" ? brief.text : brief.text || last?.output?.text || "";
  return `<div class="stack" id="brief" style="gap:8px;border-top:1px solid var(--border);padding-top:14px">
    <div class="row between"><b style="font-weight:500;font-size:13.5px">Weekly brief</b>
      ${brief.state === "running" ? `<button class="btn sm" data-act="brief-stop">${icon("stop", 13)}Stop</button>` : `<button class="btn sm" data-act="brief">${icon("spark", 13)}${text ? "Write again" : "Write with Claude"}</button>`}</div>
    ${brief.state === "running" && !brief.text ? '<span class="thinking"><i></i><i></i><i></i>&nbsp;Thinking</span>' : ""}
    ${text ? `<div class="prose small">${md(text, (id) => plink(id))}</div><span class="ai-tag">${icon("spark", 12)} Written by Claude from the rows above${last && brief.state !== "running" && !brief.text ? ` · ${dateLabel(last.createdAt)}` : ""}</span>` : brief.state === "error" ? `<p class="small muted">${esc(brief.error)}</p>` : '<p class="small muted">A 200-word summary of what to test, drop and verify this week.</p>'}
  </div>`;
}

export function mount(root, { rerender }) {
  const paintBrief = () => { const el = root.querySelector("#brief"); if (el) el.outerHTML = briefBlock(); };
  root.addEventListener("click", async (e) => {
    const m = e.target.closest("[data-mode]");
    if (m) { mode = m.dataset.mode; rerender(); return; }
    if (e.target.closest("[data-act=brief-stop]")) { brief.ctl?.abort(); return; }
    if (e.target.closest("[data-act=brief]")) {
      brief = { state: "running", text: "", ctl: new AbortController() };
      paintBrief();
      try {
        const rs = rows(store.market);
        await runBrief(rs, insights(rs, store.market), store.market, { signal: brief.ctl.signal, onText: ({ text }) => { brief.text = text; paintBrief(); } });
        brief = { state: "idle", text: "", ctl: null };
      } catch (err) {
        brief = { state: err?.code === "cancelled" ? "idle" : "error", text: err?.text || "", ctl: null, error: errCopy(err) };
      }
      paintBrief();
    }
  });
}

export function errCopy(e) {
  switch (e?.code) {
    case "not_granted": return "Claude is not allowed for this page. Allow it when the page asks, or keep using the computed insights.";
    case "rate_limited": return "Claude is busy or your usage limit is reached. Try again later.";
    case "invalid_json": return "Claude's answer could not be read. Try again.";
    case "input": return e.message;
    case "session_expired": return "Sign in to Claude again to use the agents.";
    default: return "Claude could not be reached. Try again in a moment.";
  }
}

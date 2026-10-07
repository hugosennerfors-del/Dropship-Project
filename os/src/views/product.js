// Product analysis: everything the database knows about one product in one
// market, with the reasoning behind each score and an editable calculator.

import { store, product, row, setOverlay, toggleCompare, toggleWatch, runsFor, setMarket } from "../state.js";
import { esc, attr, money, pct, int, num, mult, icon, glyph, statusPill, valueCell, tipOf, fmt, scoreChip, band, meter,
  stageChip, gradeChip, severityDot, md, MONTHS, dateLabel, isNum, signed } from "../ui/dom.js";
import { profitCurve } from "../ui/charts.js";
import { computeEconomics, scenario, profitAt, breakEvenRevenue, targetRoas, SCENARIOS } from "../core/economics.js";
import { withOverrides, MARKETS } from "../core/markets.js";
import { FIELD, FIELDS } from "../core/fields.js";
import { STATUS } from "../core/provenance.js";
import { RISK_WEIGHTS } from "../core/scoring.js";
import { marketplaceCoverage, CONNECTORS } from "../core/connectors.js";
import { AGENTS, runAgent } from "../agents/index.js";
import { session } from "../chat/engine.js";
import { plink, provenanceLegend, aiUnavailableNote } from "./shared.js";
import { errCopy } from "./radar.js";

const SECTIONS = [
  ["overview", "Overview"], ["score", "Opportunity score"], ["economics", "Profitability"], ["market", "Market opportunity"],
  ["competition", "Competition"], ["marketing", "Marketing & brand"], ["customer", "Customer"], ["validation", "Validation"],
  ["risk", "Risk"], ["data", "Data confidence"], ["agents", "AI agents"],
];

let calc = { key: "", over: {} };
const agentUI = {};

const CALC_FIELDS = [
  { k: "price", label: "Selling price (incl. VAT)", save: "price" },
  { k: "unitsPerOrder", label: "Units per order", save: "unitsPerOrder", plain: true },
  { k: "supplierPrice", label: "Supplier price / unit", save: "supplierPriceUSD", cost: true },
  { k: "inbound", label: "Inbound freight / unit", cost: true },
  { k: "dutyRate", label: "Import duty (%)", save: "dutyRate", pctf: true, cost: true },
  { k: "shipping", label: "Shipping to customer", cost: true },
  { k: "packaging", label: "Packaging", cost: true },
  { k: "paymentFees", label: "Payment fees / order", cost: true },
  { k: "returnRate", label: "Return rate (%)", save: "returnRate", pctf: true },
  { k: "cac", label: "CAC (ad cost per order)", save: "cac" },
  { k: "upsellValue", label: "Upsell value (incl. VAT)", save: "upsellValue", fromMk: true },
  { k: "attachRate", label: "Upsell attach rate (%)", save: "attachRate", pctf: true, fromMk: true },
];

export function render(params, id) {
  const p = product(id);
  if (!p) return { title: "Not found", html: `<div class="page"><div class="empty">${icon("search", 20)}<span>No product with the id “${esc(id)}”.</span><a class="btn" href="#/discover">Back to Discover</a></div></div>` };
  const m = store.market;
  const b = p.built[m];
  const name = p.core.name?.v || id;
  if (!b) {
    const other = Object.keys(p.built)[0];
    return { title: name, crumbs: [["#/discover", "Discover"]], html: `<div class="page narrow view-enter">
      <header class="page-head"><div><div class="eyebrow">${esc(p.core.category?.v || "")}</div><h1>${esc(name)}</h1></div></header>
      <div class="callout warn">${icon("info", 16)}<div class="stack" style="gap:8px"><span>The research has no ${esc(MARKETS[m].name)} analysis for this product yet. It was analysed for ${esc(MARKETS[other]?.name || other)}.</span>
        <div class="row"><button class="btn" data-market="${attr(other)}">Show the ${esc(MARKETS[other]?.name)} analysis</button>
        ${store.sampleState === "ready" ? `<button class="btn accent" data-agent="market" data-from="${attr(other)}">${icon("spark", 14)}Analyse for ${esc(MARKETS[m].name)} with AI</button>` : ""}</div>
        ${agentStatus("market")}</div></div></div>` };
  }
  const r = row(id, m);
  const d = b.scored._detail;
  const cfg = withOverrides(m, store.settings?.markets?.[m]);
  const key = `${id}|${m}`;
  if (calc.key !== key) calc = { key, over: {} };
  session.focusIds = [id];

  return {
    title: name,
    crumbs: [["#/discover", "Discover"]],
    html: `<div class="page view-enter">
      ${hero(p, b, r, m)}
      <div class="p-layout">
        <nav class="toc" aria-label="Sections">${SECTIONS.map(([k, l]) => `<a href="#sec-${k}" data-toc="${k}">${l}</a>`).join("")}</nav>
        <div class="p-sections">
          ${secOverview(p, b, r)}
          ${secScore(p, b, r, d)}
          <section class="p-sec" id="sec-economics"><h2>Profitability <small>${esc(cfg.currency)} · change any input; your numbers replace the estimates</small></h2><div id="calc">${calcBlock(p, b, cfg)}</div></section>
          ${secMarket(p, b, r, d, m)}
          ${secCompetition(p, b, r)}
          ${secMarketing(p, b, r)}
          ${secCustomer(p, b, r, m)}
          ${secValidation(p, b, r, d, m)}
          ${secRisk(p, b, r, d)}
          ${secData(p, b, r, d, m)}
          ${secAgents(p, m)}
        </div>
      </div>
    </div>`,
  };
}

// ── Hero ───────────────────────────────────────────────────────────────
function hero(p, b, r, m) {
  const c = p.core;
  const own = r._s?.cac === "V";
  const markets = Object.keys(p.built);
  const bd = band(r.opportunity);
  return `<header class="p-hero">
    <div style="min-width:0">
      <div class="path">${[c.category, c.subcategory, c.niche].map((x) => x?.v).filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("")}</div>
      <h1 style="margin-top:6px">${esc(c.name?.v)}</h1>
      <div class="row" style="margin-top:12px;gap:8px">
        ${stageChip(r.stage)}
        ${gradeChip(r.validation, "Proof of sales")}
        ${gradeChip(r.interest, "Interest")}
        ${own ? '<span class="tag">Your store</span>' : ""}
        ${p.source === "agent" ? '<span class="tag">AI profile</span>' : ""}
        ${b.mk._agent ? '<span class="tag">AI market analysis</span>' : ""}
        ${b.mk._inheritFrom ? `<span class="tag" title="${attr(`${(b.mk._inherited || []).length} values carried over from the ${b.mk._inheritFrom} analysis as AI estimates`)}">Partly from ${esc(b.mk._inheritFrom)} analysis</span>` : ""}
      </div>
      <div class="row" style="margin-top:14px">
        ${markets.length > 1 ? `<div class="seg" role="group" aria-label="Market">${markets.map((k) => `<button data-market="${k}" aria-pressed="${k === m}">${k === "UK" ? "UK" : "Sweden"}</button>`).join("")}</div>` : ""}
        <button class="btn sm${store.compare.includes(p.id) ? " on" : ""}" data-act="compare">${icon(store.compare.includes(p.id) ? "check" : "compare", 14)}${store.compare.includes(p.id) ? "In comparison" : "Compare"}</button>
        <button class="btn sm${store.watch.includes(p.id) ? " on" : ""}" data-act="watch">${icon("star", 14)}${store.watch.includes(p.id) ? "Watching" : "Watch"}</button>
        <a class="btn sm" href="#/chat" data-act="ask">${icon("chat", 14)}Ask about it</a>
      </div>
    </div>
    <div class="p-score">
      <span class="k">Opportunity</span><span class="k">Band</span>
      ${scoreChip(r.opportunity, { lg: true })}<span style="font-weight:600">${bd.label}</span>
      <span class="k" style="margin-top:8px">Evidence-weighted</span><span class="k" style="margin-top:8px">Confidence · Risk</span>
      <span class="mono" style="font-size:18px;font-weight:600">${int(r.evidenceWeighted)}</span>
      <span class="mono" style="font-size:18px;font-weight:600">${int(r.confidence)} <span class="muted" style="font-weight:400">·</span> ${int(r.risk)}</span>
    </div>
  </header>`;
}

// ── Overview ───────────────────────────────────────────────────────────
function secOverview(p, b, r) {
  const c = p.core;
  const ei = store.evidenceIndex;
  const why = b.why;
  const kv = (k, x) => x ? `<div>${esc(FIELD[k]?.label || k)}</div><div>${valueCell(k, x, r.currency, ei)}</div>` : "";
  return `<section class="p-sec" id="sec-overview">
    <h2>Overview</h2>
    ${c.overview?.v ? `<div class="prose" style="font-size:15px"><p>${esc(c.overview.v)} <span style="display:inline-block;vertical-align:-1px" data-tip="${attr(tipOf(c.overview, store.evidenceIndex))}">${glyph(c.overview.s)}</span></p></div>` : ""}
    <div class="grid g2">
      <div class="panel"><div class="panel-h"><h3>Why it could work</h3></div><div class="panel-b why">
        ${why.positives.slice(0, 5).map((x) => `<div class="why-item"><span class="pts pos">+${x.points}</span><span>${esc(x.text)}<small>${esc(x.detail)}</small></span></div>`).join("") || '<p class="small muted">No component scores above neutral.</p>'}
        ${(c.reasonsWork?.v || []).length ? `<ul class="bullets small" style="margin-top:4px">${c.reasonsWork.v.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      </div></div>
      <div class="panel"><div class="panel-h"><h3>Why it could fail</h3></div><div class="panel-b why">
        ${why.negatives.slice(0, 6).map((x) => `<div class="why-item"><span class="pts neg">${x.points}</span><span>${esc(x.text)}<small>${esc(x.detail)}</small></span></div>`).join("") || '<p class="small muted">Nothing pulls the score below neutral.</p>'}
        ${(c.reasonsFail?.v || []).length ? `<ul class="bullets small" style="margin-top:4px">${c.reasonsFail.v.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      </div></div>
    </div>
    <div class="panel"><div class="panel-b"><div class="kv">
      ${kv("targetCustomer", c.targetCustomer)}${kv("targetAge", c.targetAge)}${kv("targetGender", c.targetGender)}
      ${kv("mainBenefit", c.mainBenefit)}${kv("microNiche", c.microNiche)}${kv("relevance", b.mk.relevance)}
      ${(c.keyRisks?.v || []).length ? `<div>Key risks</div><div>${valueCell("keyRisks", c.keyRisks, r.currency, ei)}</div>` : ""}
    </div></div></div>
  </section>`;
}

// ── Score ──────────────────────────────────────────────────────────────
function secScore(p, b, r, d) {
  const c = p.core, mk = b.mk, e = b.econ, sub = d.sub;
  const cap = d.caps.find((x) => x.cap === d.cap && d.cap < d.afterRisk);
  const steps = [`Weighted components <b class="mono">${d.base}</b>`];
  if (d.interactions.length) steps.push(`interactions <b class="mono">${signed(d.interactions.reduce((a, x) => a + x.points, 0), 0)}</b>`);
  steps.push(`risk adjustment <b class="mono">×${d.riskFactor}</b>`);
  if (cap) steps.push(`capped at <b class="mono">${cap.cap}</b>`);
  steps.push(`opportunity <b class="mono">${r.opportunity}</b>`);
  const v = (x) => (x && typeof x === "object" ? x.v : x);
  const cards = [
    ["Trend", sub.trend, `${int(v(mk.trend))}/100, ${v(mk.trendDirection) || "flat"}, ${signed(v(mk.trendAcceleration), 0)}% acceleration`],
    ["Demand", sub.demand, v(mk.searchDemand) ? String(v(mk.searchDemand)).slice(0, 90) : "No search-demand data"],
    ["Profit", sub.profit, `${money(v(e.profit), r.currency)} per order after est. CAC, net margin ${pct(v(e.netMargin), 0)}`],
    ["Margin", sub.margin, `${pct(v(e.margin))} gross margin before ads and returns`],
    ["Competition", sub.competition, `competition ${int(v(mk.competition))}, saturation ${int(v(mk.saturation))} (inverted: higher is better)`],
    ["Brandability", sub.brandability, `differentiation potential ${int(v(c.differentiation))}`],
    ["Viral", v(c.viral), `impulse ${int(v(c.impulse))}, UGC ${int(v(mk.ugc))}`],
    ["Ad potential", sub.adPotential, `Meta ${int(v(mk.meta))}, TikTok ${int(v(mk.tiktok))}, Instagram ${int(v(mk.instagram))}, Google ${int(v(mk.google))}`],
    ["Repeat purchase", sub.repeat, `repeat ${int(v(c.repeat))}, subscription ${int(v(c.subscription))}`],
    ["Market growth", sub.growth, isNum(v(mk.growth)) ? `about ${v(mk.growth)}% a year` : "No growth estimate"],
    ["Ease of launch", sub.ease, `launch ≈ £${int(sub.startupGBP)}, supplier difficulty ${int(v(c.supplierDifficulty))}, regulatory ${int(v(mk.regulatoryRisk))}`],
  ];
  return `<section class="p-sec" id="sec-score">
    <h2>Opportunity score <small>weighted, not averaged</small></h2>
    <div class="callout">${icon("info", 16)}<span>${steps.join(" → ")}. Missing data counts as neutral (50) and is listed, so it neither helps nor hurts.</span></div>
    <div class="panel"><div class="panel-h"><h3>Components</h3><span class="sub">value 0–100 · weight · points vs. neutral</span></div>
      <div class="panel-b">${d.components.map((x) => `<div class="comp${x.missing ? " missing" : ""}">
        <span>${esc(x.label)}${x.missing ? ' <span class="tag">no data</span>' : ""}</span>
        <span class="bar" role="img" aria-label="${attr(`${x.label} ${x.value} of 100`)}"><i class="${x.value >= 60 ? "hi" : x.value < 40 ? "lo" : ""}" style="width:${x.value}%"></i><b></b></span>
        <span class="w">×${x.weight}</span>
        <span class="p ${x.delta > 0 ? "pos-n" : x.delta < 0 ? "neg-n" : "muted"}">${signed(x.delta)}</span>
      </div>`).join("")}
      ${d.interactions.length ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)" class="stack">${d.interactions.map((x) => `<div class="row between small"><span>${esc(x.label)}</span><span class="mono ${x.points > 0 ? "pos-n" : "neg-n"}">${signed(x.points, 0)}</span></div>`).join("")}</div>` : ""}
      ${d.caps.length ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)" class="stack">${d.caps.map((x) => `<div class="row between small"><span>Cap: ${esc(x.label)}</span><span class="mono">≤ ${x.cap}</span></div>`).join("")}</div>` : ""}
      </div></div>
    <div class="grid g4">${cards.map(([k, val, why]) => `<div class="subscore"><div class="top"><span class="k">${esc(k)}</span><span class="v">${isNum(val) ? Math.round(val) : "—"}</span></div>${meter(val, { label: k })}<p>${esc(why)}</p></div>`).join("")}</div>
  </section>`;
}

// ── Calculator ─────────────────────────────────────────────────────────
function calcBlock(p, b, cfg) {
  const base = b.econ;
  const e = computeEconomics(p.core, b.mk, cfg, calc.over);
  const cur = cfg.currency;
  const observed = e._breakdown.costBasis === "observed";
  const vv = (x) => (x && typeof x === "object" ? x.v : x);
  const inputVal = (f) => {
    if (calc.over[f.k] != null) return calc.over[f.k];
    const x = f.fromMk ? b.mk[f.k] : base[f.k];
    return vv(x) ?? "";
  };
  const inputStatus = (f) => {
    const x = f.fromMk ? b.mk[f.k] : base[f.k];
    return x && typeof x === "object" ? x : null;
  };
  const step = (f) => (f.pctf || f.plain ? "0.1" : cur === "SEK" ? "1" : "0.01");
  const fields = CALC_FIELDS.map((f) => {
    const st = inputStatus(f);
    const disabled = observed && f.cost;
    return `<label class="field${calc.over[f.k] != null ? " changed" : ""}"><span><span class="val">${st ? glyph(st.s) : ""}${esc(f.label)}</span></span>
      <input type="number" step="${step(f)}" data-calc="${f.k}" value="${attr(fmtIn(inputVal(f)))}"${disabled ? ' disabled title="Your observed cost per order replaces these components"' : ""}${st ? ` data-tip="${attr(tipOf(st, store.evidenceIndex))}"` : ""}></label>`;
  }).join("");
  const vcField = observed ? `<label class="field${calc.over.variableCost != null ? " changed" : ""}" style="grid-column:1/-1"><span><span class="val">${glyph(vv(base.variableCost) != null ? base.variableCost.s : "N")}Your cost per order (product, shipping, fees, packaging)</span></span>
      <input type="number" step="${cur === "SEK" ? "1" : "0.01"}" data-calc="variableCost" value="${attr(fmtIn(calc.over.variableCost ?? vv(base.variableCost)))}"></label>` : "";
  const changed = Object.keys(calc.over).length;
  const n = (x) => vv(x);
  const priceTotal = (n(e.price) || 0) * (n(e.unitsPerOrder) || 1);
  const vat = priceTotal - e._breakdown.revenueExV;
  const rr = (n(e.returnRate) || 0) / 100;
  const upsellC = (e._breakdown.upsellContribution || 0) * (1 - rr);
  const returnsCost = n(e.grossProfit) + upsellC - n(e.contribution);
  const scen = ["best", "base", "worst"].map((k) => scenario(p.core, b.mk, cfg, k, e));
  const curve = profitCurve(scen.map((s) => ({ label: s.label, profit: n(s.economics.profit), startup: n(s.economics.startupCost),
    color: s.kind === "best" ? "var(--good)" : s.kind === "worst" ? "var(--bad)" : "var(--fg)", main: s.kind === "base" })), cur);
  const bk = e._breakdown;
  const pAt = [10, 50, 100, 500].map((k) => [k, profitAt(e, k)]);
  const ber = breakEvenRevenue(e);
  const tr = targetRoas(e, 10);
  return `<div class="panel">
    <div class="panel-h"><h3>Unit economics calculator</h3>
      <div class="row">${changed ? `<span class="xs muted">${changed} input${changed > 1 ? "s" : ""} changed</span><button class="btn sm ghost" data-act="calc-reset">Reset</button><button class="btn sm" data-act="calc-save" title="Store your inputs as verified values for this product">${icon("check", 13)}Save as verified</button>` : `<span class="xs muted">${observed ? "Using your observed cost per order" : "Estimates shown; type to override"}</span>`}</div></div>
    <div class="panel-b calc">
      <div class="calc-in">${fields}${vcField}</div>
      <div class="stack">
        <div class="ledger">
          <div><span>Price${(n(e.unitsPerOrder) || 1) > 1 ? ` × ${n(e.unitsPerOrder)} units` : ""} incl. VAT</span><span class="num">${money(priceTotal, cur)}</span></div>
          <div class="minus"><span>VAT (${Math.round(cfg.vat * 100)}%)</span><span class="num">−${money(vat, cur)}</span></div>
          <div><span>Revenue ex VAT</span><span class="num">${money(bk.revenueExV, cur)}</span></div>
          ${observed ? `<div class="minus"><span>Your cost per order</span><span class="num">−${money(n(e.variableCost), cur)}</span></div>`
            : `<div class="minus"><span>Landed cost</span><span class="num">−${money(n(e.landedCost), cur)}</span></div>
          <div class="minus"><span>Shipping</span><span class="num">−${money(n(e.shipping), cur)}</span></div>
          <div class="minus"><span>Payment fees</span><span class="num">−${money(n(e.paymentFees), cur)}</span></div>
          <div class="minus"><span>Packaging</span><span class="num">−${money(n(e.packaging), cur)}</span></div>`}
          <div class="total"><span>Gross profit · ${pct(n(e.margin))} margin</span><span class="num">${money(n(e.grossProfit), cur)}</span></div>
          ${upsellC > 0 ? `<div><span>Expected upsell contribution</span><span class="num">+${money(upsellC, cur)}</span></div>` : ""}
          <div class="minus"><span>Expected returns (${pct(n(e.returnRate), 0)})${e._breakdown.returnsAssumed ? " · assumed" : ""}</span><span class="num">${returnsCost >= 0 ? "−" : "+"}${money(Math.abs(returnsCost), cur)}</span></div>
          <div class="total"><span>Contribution before ads</span><span class="num">${money(n(e.contribution), cur)}</span></div>
          <div class="minus"><span>CAC <span class="muted xs">${esc(e.cac.s === "V" ? "verified" : e.cac.src?.includes?.("model:cac-curve") ? "modelled" : STATUS[e.cac.s]?.label || "")}</span></span><span class="num">−${money(n(e.cac), cur)}</span></div>
          <div class="total"><span>Profit per order · ${pct(n(e.netMargin))} net</span><span class="num ${n(e.profit) > 0 ? "pos-n" : "neg-n"}">${money(n(e.profit), cur)}</span></div>
        </div>
        <div class="grid g2" style="gap:0;border:1px solid var(--border);border-radius:var(--r-md)">
          ${[["Max CAC (break-even)", money(n(e.maxCac), cur)], ["ROAS at this CAC", mult(n(e.roas))], ["Break-even ROAS", mult(n(e.breakEvenRoas))],
            ["Target ROAS for 10% net", tr ? mult(tr) : "Not reachable"], ["Contribution margin", pct(bk.revenueExV ? (n(e.contribution) / bk.revenueExV) * 100 : null)], ["Customer lifetime value", money(n(e.clv), cur)]]
            .map(([k, val], i) => `<div class="stat" style="${i % 2 ? "border-left:1px solid var(--border);" : ""}${i > 1 ? "border-top:1px solid var(--border)" : ""}"><span class="k">${k}</span><span class="v" style="font-size:16px">${val}</span></div>`).join("")}
        </div>
      </div>
    </div>
  </div>

  <div class="grid g2">
    <div class="panel"><div class="panel-h"><h3>Break-even</h3><span class="sub">launch cost excludes ad budget</span></div><div class="panel-b stack">
      <div class="ledger">
        <div><span>First stock (${bk.moq} × landed cost)</span><span class="num">${money(bk.inventory, cur)}</span></div>
        <div><span>Three samples incl. shipping</span><span class="num">${money(bk.samples, cur)}</span></div>
        <div><span>Compliance and setup</span><span class="num">${money(bk.fixed, cur)}</span></div>
        <div><span>Three UGC-style videos</span><span class="num">${money(bk.creative, cur)}</span></div>
        <div class="total"><span>Launch cost</span><span class="num">${money(n(e.startupCost), cur)}</span></div>
      </div>
      <div class="kv">
        <div>Break-even orders</div><div class="mono">${n(e.breakEvenOrders) ? int(n(e.breakEvenOrders)) : "Never at this CAC"}</div>
        <div>Break-even revenue (incl. VAT)</div><div class="mono">${ber ? money(ber, cur, { digits: 0 }) : "—"}</div>
        ${pAt.map(([k, v]) => `<div>Profit after ${k} orders</div><div class="mono ${v > 0 ? "pos-n" : "neg-n"}">${money(v, cur, { digits: 0 })}</div>`).join("")}
      </div>
    </div></div>
    <div class="panel"><div class="panel-h"><h3>Profit after launch cost</h3><span class="sub">best · base · worst</span></div><div class="panel-b">${curve}</div></div>
  </div>

  <div class="panel"><div class="panel-h"><h3>Scenarios</h3><span class="sub">same product, different assumptions</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Case</th><th class="r">CAC</th><th class="r">Returns</th><th class="r">Price</th><th class="r">Profit/order</th><th class="r">Net margin</th><th class="r">After 100 orders</th><th class="r hide-sm">Break-even</th></tr></thead>
    <tbody>${scen.map((s) => `<tr><td><b style="font-weight:500">${esc(s.label)}</b><div class="xs muted" style="max-width:34ch">${esc(s.story)}</div></td>
      <td class="r mono">${money(n(s.economics.cac), cur)}</td><td class="r mono">${pct(n(s.economics.returnRate), 0)}</td><td class="r mono">${money(n(s.economics.price), cur)}</td>
      <td class="r mono ${n(s.economics.profit) > 0 ? "pos-n" : "neg-n"}">${money(n(s.economics.profit), cur)}</td><td class="r mono">${pct(n(s.economics.netMargin), 0)}</td>
      <td class="r mono ${s.profit100 > 0 ? "pos-n" : "neg-n"}">${money(s.profit100, cur, { digits: 0 })}</td><td class="r mono hide-sm">${n(s.economics.breakEvenOrders) ? int(n(s.economics.breakEvenOrders)) + " orders" : "never"}</td></tr>`).join("")}</tbody></table></div>
    <div class="panel-b stack" style="border-top:1px solid var(--border)">
      <p class="small">${esc(scenarioComment(scen, cur))}</p>
      ${agentInline("scenarios", p.id)}
    </div>
  </div>`;
}
const fmtIn = (x) => (x === "" || x == null ? "" : Math.round(Number(x) * 100) / 100);

function scenarioComment(scen, cur) {
  const [best, base, worst] = scen.map((s) => s.economics.profit.v);
  const m = (x) => money(x, cur);
  if (best <= 0) return `Even the best case loses ${m(-best)} per order: the price, cost or CAC has to change before this product is worth testing.`;
  if (base <= 0) return `Only the best case makes money (${m(best)} per order). The base case loses ${m(-base)}, so the test has to show a CAC below the estimate of ${m(scen[1].economics.cac.v)} before you scale.`;
  if (worst <= 0) return `Profitable in the base case (${m(base)} per order) but the worst case loses ${m(-worst)}. Keep a hard CAC limit of ${m(scen[1].economics.maxCac.v)} in the test.`;
  return `Profitable in all three cases, from ${m(worst)} to ${m(best)} per order. The main risk is volume, not unit economics.`;
}

// ── Market ─────────────────────────────────────────────────────────────
function secMarket(p, b, r, d, m) {
  const mk = b.mk, ei = store.evidenceIndex;
  const peak = new Set(mk.peakMonths?.v || []);
  const now = new Date().getMonth() + 1;
  const kv = (k, x) => (x ? `<div>${esc(FIELD[k]?.label || k)}</div><div>${valueCell(k, x, r.currency, ei)}</div>` : `<div>${esc(FIELD[k]?.label || k)}</div><div>${statusPill("N", true)}</div>`);
  const cov = marketplaceCoverage(b.evidenceIds, ei, m);
  const channelScore = { meta: mk.meta, tiktok: mk.tiktok, instagram: mk.instagram, google: mk.google };
  const conn = (id) => CONNECTORS.find((c) => c.id === id);
  const connFor = { amazon: "amazon-uk", ebay: "ebay-uk", etsy: "etsy", "tiktok-shop": "tiktok-shop", google: "google-shopping", meta: "meta-ad-library", tiktok: "instagram", instagram: "instagram" };
  return `<section class="p-sec" id="sec-market">
    <h2>Market opportunity <small>${esc(MARKETS[m].name)}</small></h2>
    <div class="callout${marketTone(r)}">${icon("info", 16)}<span>${esc(marketSummary(r, mk))}</span></div>
    <div class="grid g2">
      <div class="panel"><div class="panel-b"><div class="kv">
        ${kv("relevance", mk.relevance)}${kv("demand", mk.demand)}${kv("searchDemand", mk.searchDemand)}${kv("trend", mk.trend)}
        ${kv("trendDirection", mk.trendDirection)}${kv("trendAcceleration", mk.trendAcceleration)}${kv("marketSize", mk.marketSize)}${kv("growth", mk.growth)}
      </div></div></div>
      <div class="panel"><div class="panel-h"><h3>Lifecycle and season</h3>${stageChip(r.stage)}</div><div class="panel-b stack">
        <ul class="bullets small">${d.stage.why.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <div class="season" aria-label="Peak months">${MONTHS.map((mo, i) => `<div class="${peak.has(i + 1) ? "on" : ""}${now === i + 1 ? " now" : ""}" title="${mo}${peak.has(i + 1) ? ": peak" : ""}${now === i + 1 ? " (this month)" : ""}">${mo[0]}</div>`).join("")}</div>
        <div class="kv">${kv("seasonality", mk.seasonality)}${kv("seasonalityRisk", mk.seasonalityRisk)}</div>
      </div></div>
    </div>
    <div class="panel"><div class="panel-h"><h3>Marketplaces and channels</h3><span class="sub">only data actually in the database counts</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Marketplace / channel</th><th>Data in the database</th><th class="r">Potential</th><th class="hide-sm">Connector</th></tr></thead><tbody>
      ${cov.map((x) => {
        const c = conn(connFor[x.id]);
        const pot = channelScore[x.id];
        return `<tr><td>${esc(x.label)}</td>
          <td>${x.has ? `<span class="spill">${glyph("E")}${x.evidence.length} record${x.evidence.length > 1 ? "s" : ""}${x.inMarket ? "" : " (other market)"}</span>` : '<span class="spill">' + glyph("N") + "No data</span>"}</td>
          <td class="r">${pot ? valueCell(x.id, pot, r.currency, ei) : '<span class="muted">—</span>'}</td>
          <td class="hide-sm xs muted">${c ? esc(c.status === "connected" ? "Connected" : c.status === "manual" ? "Manual" : "Not connected") : "—"}</td></tr>`;
      }).join("")}</tbody></table></div>
      <div class="panel-b xs muted" style="border-top:1px solid var(--border)">Amazon UK, eBay UK, Etsy and TikTok Shop need an API connection before the page can show listings, prices or sales. See Data → Connectors.</div>
    </div>
  </section>`;
}

function marketTone(r) {
  const gap = (r.demand ?? 50) - (r.competition ?? 50);
  return gap >= 10 && ["Emerging", "Early Growth", "Growing"].includes(r.stage) ? " good" : gap <= -15 || ["Saturated", "Declining"].includes(r.stage) ? " warn" : "";
}
function marketSummary(r, mk) {
  const gap = (r.demand ?? 50) - (r.competition ?? 50);
  const size = mk.marketSize?.v ? `Market size: ${mk.marketSize.v}.` : "No reliable market-size data.";
  const growth = isNum(mk.growth?.v) ? ` Estimated growth about ${mk.growth.v}% a year.` : "";
  const room = gap >= 10 ? `Demand (${r.demand}) is ahead of competition (${r.competition}), so there is room for a new seller.`
    : gap <= -15 ? `Competition (${r.competition}) is well ahead of demand (${r.demand}): a new seller needs a clearly better product or a channel others ignore.`
    : `Demand (${r.demand}) and competition (${r.competition}) are roughly balanced: the opportunity depends on differentiation.`;
  return `${room} Stage: ${r.stage.toLowerCase()}. ${size}${growth}`;
}

// ── Competition ────────────────────────────────────────────────────────
function secCompetition(p, b, r) {
  const mk = b.mk, c = p.core, ei = store.evidenceIndex;
  const lo = mk.competitorPriceMin?.v, hi = mk.competitorPriceMax?.v, you = r.price;
  let range = "";
  if (isNum(lo) && isNum(hi) && isNum(you)) {
    const a = Math.min(lo, you) * 0.9, z = Math.max(hi, you) * 1.08;
    const x = (v) => ((v - a) / (z - a)) * 100;
    range = `<div class="range" role="img" aria-label="${attr(`Competitor prices ${money(lo, r.currency)} to ${money(hi, r.currency)}; your price ${money(you, r.currency)}`)}">
      <div class="track"></div><div class="band" style="left:${x(lo)}%;width:${x(hi) - x(lo)}%"></div>
      <div class="you" style="left:${x(you)}%"><span>you ${money(you, r.currency)}</span></div></div>
      <div class="row between xs muted"><span>${money(lo, r.currency)}</span><span>competitor range</span><span>${money(hi, r.currency)}</span></div>`;
  }
  const listBlock = (k, x) => x?.v && (Array.isArray(x.v) ? x.v.length : true) ? `<div class="stack" style="gap:6px"><span class="small muted val">${glyph(x.s)}${esc(FIELD[k]?.label || k)}</span>${Array.isArray(x.v) ? `<ul class="bullets small">${x.v.map((y) => `<li>${esc(y)}</li>`).join("")}</ul>` : `<p class="small">${esc(x.v)}</p>`}</div>` : "";
  return `<section class="p-sec" id="sec-competition">
    <h2>Competition</h2>
    <div class="grid g2">
      <div class="panel"><div class="panel-b"><div class="kv">
        ${["competition", "saturation", "competitorCount", "competitorStrength", "differentiation"].map((k) => { const x = k === "differentiation" ? c[k] : mk[k]; return `<div>${esc(FIELD[k].label)}</div><div>${x ? valueCell(k, x, r.currency, ei) : statusPill("N", true)}</div>`; }).join("")}
      </div>${range ? `<div style="margin-top:14px">${range}</div>` : ""}</div></div>
      <div class="panel"><div class="panel-b stack">
        ${listBlock("marketLeaders", mk.marketLeaders)}${listBlock("weakCompetitors", mk.weakCompetitors)}${listBlock("commonMarketingAngles", mk.commonMarketingAngles)}
        ${!mk.marketLeaders && !mk.weakCompetitors ? '<p class="small muted">No competitor data for this market.</p>' : ""}
      </div></div>
    </div>
    <div class="grid g2">
      <div class="panel"><div class="panel-b stack">${listBlock("commonComplaints", mk.commonComplaints) || '<p class="small muted">No complaint data.</p>'}${listBlock("commonWeaknesses", mk.commonWeaknesses)}</div></div>
      <div class="panel"><div class="panel-b stack">${listBlock("differentiationOpportunities", c.differentiationOpportunities)}${listBlock("uspOpportunities", c.uspOpportunities)}</div></div>
    </div>
  </section>`;
}

// ── Marketing & brand ──────────────────────────────────────────────────
function secMarketing(p, b, r) {
  const mk = b.mk, c = p.core, ei = store.evidenceIndex;
  const ch = [["tiktok", mk], ["instagram", mk], ["meta", mk], ["google", mk], ["seo", mk], ["organic", mk], ["influencer", mk], ["ugc", mk], ["social", mk], ["viral", c], ["impulse", c], ["giftability", c]];
  const text = (k, x) => x?.v ? `<div class="stack" style="gap:4px"><span class="small muted val">${glyph(x.s)}${esc(FIELD[k].label)}</span>${Array.isArray(x.v) ? `<ul class="bullets small">${x.v.map((y) => `<li>${esc(y)}</li>`).join("")}</ul>` : `<p class="small">${esc(x.v)}</p>`}</div>` : "";
  return `<section class="p-sec" id="sec-marketing">
    <h2>Marketing & brand</h2>
    <div class="panel"><div class="panel-h"><h3>Channel potential</h3><span class="sub">0–100 · AI estimates unless marked</span></div>
      <div class="panel-b grid g4" style="gap:12px 24px">${ch.map(([k, src]) => { const x = src[k]; return `<div class="stack" style="gap:5px"><div class="row between small"><span class="val">${x ? glyph(x.s) : glyph("N")}${esc(FIELD[k].label.replace(" potential", ""))}</span><span class="mono">${int(x?.v)}</span></div>${meter(x?.v, { label: FIELD[k].label })}</div>`; }).join("")}</div></div>
    <div class="grid g2">
      <div class="panel"><div class="panel-h"><h3>Brand potential</h3><span class="row" style="gap:8px"><span class="small muted">Brandability</span>${scoreChip(c.brandability?.v, { label: "Brandability" })}</span></div><div class="panel-b stack">
        <p class="small"><b style="font-weight:500">${esc(brandVerdict(c, r).title)}</b> ${esc(brandVerdict(c, r).text)}</p>
        ${text("brandAngle", c.brandAngle)}${text("landingPageAngle", c.landingPageAngle)}
        <div class="kv">${["repeat", "subscription", "bundle"].map((k) => `<div>${esc(FIELD[k].label)}</div><div>${c[k] ? valueCell(k, c[k], r.currency, ei) : "—"}</div>`).join("")}
        ${mk.upsellValue ? `<div>Upsell value</div><div>${valueCell("upsellValue", mk.upsellValue, r.currency, ei)}</div>` : ""}</div>
      </div></div>
      <div class="panel"><div class="panel-h"><h3>Angles</h3></div><div class="panel-b stack">${text("adAngles", c.adAngles)}${text("contentAngles", c.contentAngles)}</div></div>
    </div>
  </section>`;
}

function brandVerdict(c, r) {
  const b = c.brandability?.v ?? 50, d = c.differentiation?.v ?? 50, rep = c.repeat?.v ?? 20;
  const late = ["Peak", "Declining", "Saturated"].includes(r.stage);
  if (b >= 70 && d >= 50) return { title: "Good basis for a long-term brand.", text: `People can tell a better version apart (differentiation ${d}), the category carries identity and story (brandability ${b})${rep >= 40 ? ", and customers come back" : ""}.${late ? " The market is late in its cycle, so the brand has to win on quality, not novelty." : ""}` };
  if (b >= 55) return { title: "A brand is possible, but not automatic.", text: `Brandability ${b} and differentiation ${d}: it needs a clear angle (see the differentiation opportunities) to avoid competing on price.${rep < 30 ? " Few repeat purchases, so the brand has to earn new customers each time." : ""}` };
  return { title: "Hard to build a brand on.", text: `Brandability ${b}, differentiation ${d}: buyers see it as a commodity. Treat it as a product test, or bundle it into a broader brand.` };
}

// ── Customer ───────────────────────────────────────────────────────────
function secCustomer(p, b, r, m) {
  const c = p.core, mk = b.mk;
  const card = (title, x) => `<div class="panel"><div class="panel-b stack" style="gap:6px"><span class="small muted val">${x ? glyph(x.s) : glyph("N")}${esc(title)}</span><p>${esc(x?.v || "No data.")}</p></div></div>`;
  return `<section class="p-sec" id="sec-customer">
    <h2>Customer pain point</h2>
    <div class="grid g3">${card("Problem", c.painPoint)}${card("Solution", c.problemSolved)}${card("Why people buy", c.purchaseMotivation)}</div>
    <div class="grid g2">${card("Emotional appeal", c.emotionalAppeal)}${card("Main benefit", c.mainBenefit)}</div>
    <div class="panel"><div class="panel-h"><h3>Reviews</h3><span class="sub">${mk.reviewSentiment?.s === "E" ? "from reviews you pasted" : "no review data imported yet"}</span></div><div class="panel-b stack">
      <div class="kv"><div>Review sentiment</div><div>${mk.reviewSentiment ? valueCell("reviewSentiment", mk.reviewSentiment, r.currency, store.evidenceIndex) : statusPill("N", true)}</div>
      <div>Customer complaints</div><div>${mk.customerComplaints ? valueCell("customerComplaints", mk.customerComplaints, r.currency, store.evidenceIndex) : statusPill("N", true)}</div></div>
      ${agentInline("reviews", p.id)}
    </div></div>
  </section>`;
}

// ── Validation ─────────────────────────────────────────────────────────
function secValidation(p, b, r, d, m) {
  const v = d.validation;
  const grades = [["Proof of sales", v.commercial, "Sales, revenue, units or reviews: someone pays for it."],
    ["Interest", v.interest, "Search, social or media attention. Not the same as demand."],
    ["Market base", v.base, "How many people could buy (population, participation)."]];
  const evRow = (e) => `<div class="ev"><span class="lv ${e.level}" title="Evidence level ${e.level}: ${attr(levelText(e.level))}">${e.level}</span><div>
      <div>${esc(e.claim)}</div>
      <div class="meta"><span>${esc(e.kind.replace("_", " "))}</span><span>${esc(e.market)}</span>${e.observed ? `<span>${esc(e.observed)}</span>` : ""}
        <span>${e.source?.url ? `<a href="${attr(e.source.url)}" target="_blank" rel="noopener">${esc(e.source.publisher || e.source.title)} ${icon("ext", 11)}</a>` : esc(e.source?.publisher || e.source?.title || "")}</span></div>
    </div></div>`;
  return `<section class="p-sec" id="sec-validation">
    <h2>Validation <small>${v.count} evidence record${v.count === 1 ? "" : "s"}</small></h2>
    <div class="grid g3">${grades.map(([t, g, sub]) => `<div class="subscore"><div class="top"><span class="k">${t}</span><span class="v grade-${g.grade.toLowerCase()}" style="font-family:var(--font-sans);font-size:15px"><b>${g.grade}</b></span></div><p>${esc(sub)}${g.best ? ` Best: level ${g.best.level}, ${esc(g.best.market)}.` : ""}</p></div>`).join("")}</div>
    ${v.notes.map((n) => `<div class="callout warn">${icon("warn", 16)}<span>${esc(n)}</span></div>`).join("")}
    ${["Strong", "Medium", "Weak"].map((k) => v.buckets[k].length ? `<div class="panel"><div class="panel-h"><h3>${k} evidence</h3><span class="sub">${k === "Strong" ? "own data, or level A/B in this market" : k === "Medium" ? "level A–C" : "level D–E"}</span></div><div class="panel-b" style="padding-block:4px">${v.buckets[k].map(evRow).join("")}</div></div>` : "").join("")}
    ${!v.count ? '<div class="callout">' + icon("info", 16) + "<span>No evidence records are linked to this product. Everything in the analysis is an AI estimate.</span></div>" : ""}
  </section>`;
}
const levelText = (l) => ({ A: "primary source", B: "industry data with method", C: "modelled estimate or self-report", D: "trade media or vendor", E: "single claim" }[l] || "");

// ── Risk ───────────────────────────────────────────────────────────────
function secRisk(p, b, r, d) {
  const rd = d.riskDetail, mk = b.mk, c = p.core, ei = store.evidenceIndex;
  return `<section class="p-sec" id="sec-risk">
    <h2>Risk <small>${rd.score}/100 · higher is riskier</small></h2>
    <div class="grid g2">
      <div class="panel"><div class="panel-h"><h3>Risk factors</h3><span class="sub">value · weight</span></div><div class="panel-b">
        ${rd.factors.map((f) => `<div class="comp" style="grid-template-columns:minmax(120px,170px) minmax(0,1fr) 40px 40px"><span title="${attr(f.detail || "")}">${esc(f.label)}</span>
          <span class="bar"><i class="${f.value >= 65 ? "lo" : f.value < 35 ? "hi" : ""}" style="width:${Math.round(f.value)}%"></i></span><span class="w">×${f.weight}</span><span class="p mono">${Math.round(f.value)}</span></div>`).join("")}
      </div></div>
      <div class="stack">
        <div class="panel"><div class="panel-h"><h3>Red flags</h3><span class="sub">${d.redFlags.length || "none"}</span></div><div class="panel-b stack" style="gap:10px">
          ${d.redFlags.length ? d.redFlags.map((f) => `<div class="row" style="align-items:flex-start;flex-wrap:nowrap">${severityDot(f.severity)}<div style="margin-top:-4px"><b style="font-weight:500">${esc(f.title)}</b>${f.detail ? `<div class="small muted">${esc(f.detail)}</div>` : ""}</div></div>`).join("") : '<p class="small muted">No red flags.</p>'}
        </div></div>
        <div class="panel"><div class="panel-b"><div class="kv">
          ${[["regulatoryNotes", mk], ["ipNotes", mk], ["size", c], ["weight", c], ["moq", c], ["supplierAvailability", c], ["returnRisk", c]].map(([k, src]) => src[k] ? `<div>${esc(FIELD[k].label)}</div><div>${valueCell(k, src[k], r.currency, ei)}</div>` : "").join("")}
        </div></div></div>
      </div>
    </div>
  </section>`;
}

// ── Data confidence ────────────────────────────────────────────────────
function secData(p, b, r, d, m) {
  const conf = d.confidence;
  const weakest = conf.parts.filter((x) => x.quality < 0.5).sort((a, b) => b.weight * (1 - b.quality) - a.weight * (1 - a.quality)).slice(0, 4);
  const all = [];
  for (const [k, x] of Object.entries(p.core)) if (x && typeof x === "object" && "s" in x && FIELD[k]) all.push(["Core", k, x]);
  for (const [k, x] of Object.entries(b.mk)) if (x && typeof x === "object" && "s" in x && FIELD[k]) all.push([m, k, x]);
  const counts = { V: 0, E: 0, A: 0, N: 0 };
  for (const [, , x] of all) counts[x.s] = (counts[x.s] || 0) + 1;
  const inh = new Set(b.mk._inherited || []);
  const editable = FIELDS.filter((f) => ["core", "market"].includes(f.scope) && !["text", "list", "months"].includes(f.type) && !["kind"].includes(f.key));
  return `<section class="p-sec" id="sec-data">
    <h2>Data confidence <small>${conf.score}/100</small></h2>
    <div class="grid g2">
      <div class="panel"><div class="panel-b stack">
        <div class="mix" role="img" aria-label="${attr(`Verified ${conf.mix.V}%, estimated ${conf.mix.E}%, AI estimated ${conf.mix.A}%, no data ${conf.mix.N}%`)}">${["V", "E", "A", "N"].map((s) => `<i class="${s}" style="width:${conf.mix[s]}%"></i>`).join("")}</div>
        <div class="legend">${["V", "E", "A", "N"].map((s) => `<span class="spill">${glyph(s)}${STATUS[s].label} ${conf.mix[s]}%</span>`).join("")}</div>
        <p class="small muted">Weighted by how much each input moves the score. Evidence at level A or B adds up to 12 points (${conf.bonus} here). Across all ${all.length} fields: ${counts.V} verified, ${counts.E} estimated, ${counts.A} AI estimates, ${counts.N} without data.</p>
      </div></div>
      <div class="panel"><div class="panel-h"><h3>Raise confidence fastest by verifying</h3></div><div class="list">
        ${weakest.map((x) => `<div class="li"><span class="body"><b>${esc(FIELD[x.key]?.label || x.key)}</b><small>weight ${x.weight} · ${esc(STATUS[x.status]?.label || x.status)}</small></span>${glyph(x.status)}</div>`).join("") || '<div class="empty">The key inputs are already backed by data.</div>'}
      </div></div>
    </div>
    <div class="panel"><div class="panel-h"><h3>Correct or verify a value</h3><span class="sub">stored as your own verified value; the analysis underneath is kept</span></div>
      <form class="panel-b row" id="verifyForm" style="align-items:flex-end;gap:10px">
        <label class="field" style="flex:1 1 200px"><span>Field</span><select id="vf-field">${editable.map((f) => `<option value="${f.scope === "core" ? "core" : m}|${f.key}">${esc(f.label)}${f.scope === "market" ? ` (${m})` : ""}</option>`).join("")}</select></label>
        <label class="field" style="flex:0 1 140px"><span>Value</span><input id="vf-value" type="text" inputmode="decimal" placeholder="e.g. 24.99" required></label>
        <label class="field" style="flex:2 1 240px"><span>Source</span><input id="vf-note" type="text" placeholder="e.g. Alibaba quote 3 Oct, supplier ABC" required></label>
        <button class="btn primary" type="submit">Save</button>
      </form>
      ${overlayList(p.id)}
    </div>
    <details class="panel"><summary class="panel-h" style="cursor:pointer;border-bottom:0"><h3>All ${all.length} fields with their status</h3>${provenanceLegend()}</summary>
      <div class="tbl-wrap" style="border-top:1px solid var(--border)"><table class="tbl"><thead><tr><th>Field</th><th>Value</th><th>Status</th><th class="hide-sm">Note and source</th></tr></thead><tbody>
      ${all.map(([scope, k, x]) => `<tr><td class="small">${esc(FIELD[k].label)}<div class="xs muted">${esc(scope)}${inh.has(k) ? " · from UK analysis" : ""}</div></td><td class="small" style="max-width:340px">${fmt(k, x.v, r.currency)}</td><td>${statusPill(x.s, true)}</td><td class="xs muted hide-sm" style="max-width:360px">${esc(tipOf(x, store.evidenceIndex).split(" · ").slice(1).join(" · "))}</td></tr>`).join("")}
      </tbody></table></div></details>
  </section>`;
}

function overlayList(pid) {
  const mine = Object.entries(store.overlays).filter(([k]) => k.startsWith(pid + "|") && !k.endsWith("|*"));
  if (!mine.length) return "";
  return `<div class="list" style="border-top:1px solid var(--border)">${mine.map(([k, x]) => {
    const [, scope, field] = k.split("|");
    return `<div class="li"><span class="body"><b>${esc(FIELD[field]?.label || field)} = ${fmt(field, x.v, scope === "SE" ? "SEK" : "GBP")}</b><small>${esc(scope)} · ${esc(x.note || "")}${x.at ? " · " + dateLabel(x.at) : ""}</small></span>${statusPill(x.s, true)}<button class="btn sm ghost" data-unoverlay="${attr(k)}">Undo</button></div>`;
  }).join("")}</div>`;
}

// ── Agents ─────────────────────────────────────────────────────────────
function secAgents(p, m) {
  const other = m === "UK" ? "SE" : "UK";
  const keys = ["brand", "improve"];
  if (!p.built[other]) keys.push("market");
  return `<section class="p-sec" id="sec-agents">
    <h2>AI agents <small>results are stored as versions and labelled as AI estimates</small></h2>
    ${aiUnavailableNote()}
    ${keys.map((k) => agentCard(k, p.id, m, k === "market" ? other : null)).join("")}
  </section>`;
}

function agentInline(key, pid) {
  return agentCard(key, pid, store.market, null, true);
}

function agentCard(key, pid, m, target, inline) {
  const a = AGENTS[key];
  const runs = runsFor(pid).filter((r) => r.agent === key && r.market === m);
  const ui = agentUI[`${pid}|${key}`] || {};
  const sel = runs.find((r) => r.id === ui.version) || runs[0];
  const running = ui.state === "running";
  const ready = store.sampleState === "ready";
  const input = a.needsInput === "reviews" ? `<label class="field"><span>Reviews to analyse</span><textarea id="rev-${attr(pid)}" rows="5" placeholder="Paste 10–100 reviews from Amazon, Trustpilot or your own store. One review per line works best.">${esc(ui.input || "")}</textarea></label>` : "";
  const head = `<div class="agent-h"><div><h3>${icon("spark", 14)} ${esc(a.label)}${target ? ` → ${esc(MARKETS[target].name)}` : ""}</h3><p>${esc(a.blurb)}</p></div>
    <div class="row">${runs.length > 1 ? `<select data-version="${attr(key)}" aria-label="Version">${runs.map((r, i) => `<option value="${attr(r.id)}"${r.id === sel?.id ? " selected" : ""}>v${runs.length - i} · ${dateLabel(r.createdAt)}</option>`).join("")}</select>` : ""}
    ${running ? `<button class="btn sm" data-agent-stop="${attr(key)}">${icon("stop", 13)}Stop</button>` : ready ? `<button class="btn sm${runs.length ? "" : " accent"}" data-agent="${attr(key)}"${target ? ` data-target="${attr(target)}"` : ""}>${icon("spark", 13)}${runs.length ? "Run again" : "Run"}</button>` : ""}</div></div>`;
  const body = running ? `<div class="agent-b"><span class="thinking"><i></i><i></i><i></i>&nbsp;${ui.chars ? `Writing (${ui.chars} characters)` : "Thinking"}</span></div>`
    : ui.state === "error" ? `<div class="agent-b"><div class="callout warn">${icon("warn", 16)}<span>${esc(ui.error)}</span></div></div>`
    : sel ? `<div class="agent-b">${renderOutput(key, sel)}</div>` : "";
  if (inline) return `<div class="agent">${head}${input ? `<div class="agent-b">${input}</div>` : ""}${body}</div>`;
  return `<div class="agent">${head}${input ? `<div class="agent-b">${input}</div>` : ""}${body}</div>`;
}

function agentStatus(key) {
  const ui = Object.entries(agentUI).find(([k]) => k.endsWith("|" + key))?.[1];
  if (!ui) return "";
  if (ui.state === "running") return '<span class="thinking"><i></i><i></i><i></i>&nbsp;Analysing…</span>';
  if (ui.state === "error") return `<span class="small" style="color:var(--bad)">${esc(ui.error)}</span>`;
  return "";
}

function renderOutput(key, run) {
  const o = run.output || {};
  const li = (xs) => (xs?.length ? `<ul class="bullets small">${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
  const tag = `<span class="ai-tag">${icon("spark", 12)} AI estimate · ${dateLabel(run.createdAt)}</span>`;
  switch (key) {
    case "brand": return `<div class="grid g2">
        <div class="stack"><b style="font-weight:500">Name ideas</b><div class="list">${(o.names || []).map((n) => `<div class="li" style="padding-inline:0"><span class="body"><b>${esc(n.name)}</b><small style="white-space:normal">${esc(n.why)}</small></span></div>`).join("")}</div></div>
        <div class="stack">
          ${o.tagline ? `<p style="font-size:16px;font-weight:500">“${esc(o.tagline)}”</p>` : ""}
          <div class="kv"><div>Positioning</div><div class="small">${esc(o.positioning)}</div><div>Audience</div><div class="small">${esc(o.audience)}</div><div>Tone of voice</div><div class="small">${esc(o.toneOfVoice)}</div><div>Visual direction</div><div class="small">${esc(o.visualDirection)}</div></div>
        </div></div>
      <div class="grid g3">
        <div class="stack"><b style="font-weight:500">Landing page</b><p class="small"><b>${esc(o.landingPage?.headline)}</b><br>${esc(o.landingPage?.subheadline)}</p>${li(o.landingPage?.sections)}</div>
        <div class="stack"><b style="font-weight:500">Ad hooks</b>${li(o.adHooks)}</div>
        <div class="stack"><b style="font-weight:500">Content pillars</b>${li(o.contentPillars)}<b style="font-weight:500">Offer</b><p class="small">${esc(o.offer?.bundle)} ${esc(o.offer?.pricing)}</p></div>
      </div>${o.risks?.length ? `<div class="stack"><b style="font-weight:500">Brand risks</b>${li(o.risks)}</div>` : ""}${tag}`;
    case "improve": return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Change</th><th class="hide-sm">Fixes</th><th>Impact</th><th>Difficulty</th></tr></thead><tbody>
        ${(o.improvements || []).map((x) => `<tr><td><b style="font-weight:500">${esc(x.change)}</b><div class="xs muted">Based on: ${esc(x.basedOn)}${x.costNote ? ` · ${esc(x.costNote)}` : ""}</div></td><td class="small hide-sm">${esc(x.fixes)}</td><td><span class="tag">${esc(x.impact)}</span></td><td><span class="tag">${esc(x.difficulty)}</span></td></tr>`).join("")}
      </tbody></table></div>
      ${o.positioning ? `<p class="small"><b>Positioning:</b> ${esc(o.positioning)}</p>` : ""}${o.bundleIdeas?.length ? `<div><b class="small" style="font-weight:500">Bundles</b>${li(o.bundleIdeas)}</div>` : ""}${o.doNotDo?.length ? `<div><b class="small" style="font-weight:500">Avoid</b>${li(o.doNotDo)}</div>` : ""}${tag}`;
    case "reviews": {
      const s = o.sentiment || {};
      const applied = store.overlays[`${run.productId}|${run.market}|customerComplaints`]?.src?.includes?.("user-reviews:" + run.id);
      return `<p class="small">${esc(o.summary)}</p>
        <div class="mix" style="height:10px" role="img" aria-label="${attr(`positive ${s.positive}%, neutral ${s.neutral}%, negative ${s.negative}%`)}"><i style="width:${s.positive || 0}%;background:var(--good)"></i><i style="width:${s.neutral || 0}%;background:var(--pv-a)"></i><i style="width:${s.negative || 0}%;background:var(--bad)"></i></div>
        <div class="xs muted">Positive ${int(s.positive)}% · neutral ${int(s.neutral)}% · negative ${int(s.negative)}% · ${int(o.reviewCount)} reviews</div>
        <div class="grid g2">
          <div class="stack"><b class="small" style="font-weight:500">Complaints</b>${(o.complaints || []).map((c) => `<div class="small"><b style="font-weight:500">${esc(c.theme)}</b> <span class="muted mono">×${int(c.mentions)}</span>${c.quote ? `<div class="xs muted">“${esc(c.quote)}”</div>` : ""}</div>`).join("")}</div>
          <div class="stack"><b class="small" style="font-weight:500">Praise</b>${(o.praise || []).map((c) => `<div class="small"><b style="font-weight:500">${esc(c.theme)}</b> <span class="muted mono">×${int(c.mentions)}</span>${c.quote ? `<div class="xs muted">“${esc(c.quote)}”</div>` : ""}</div>`).join("")}</div>
        </div>
        ${o.productIdeas?.length ? `<div class="stack"><b class="small" style="font-weight:500">Product ideas from the reviews</b>${o.productIdeas.map((x) => `<div class="small">${esc(x.idea)} <span class="muted">— ${esc(x.why)}</span></div>`).join("")}</div>` : ""}
        ${o.unmetNeeds?.length ? `<div><b class="small" style="font-weight:500">Unmet needs</b>${li(o.unmetNeeds)}</div>` : ""}
        <div class="row between">${tag}${applied ? '<span class="xs muted">Saved to the product</span>' : `<button class="btn sm" data-apply="${attr(run.id)}">Save complaints to the product</button>`}</div>`;
    }
    case "market": {
      const applied = store.overlays[`${run.productId}|${run.target}|*`]?.src?.includes?.("agent:" + run.id);
      return `<div class="kv">${Object.entries(o).filter(([k]) => FIELD[k]).map(([k, x]) => `<div>${esc(FIELD[k].label)}</div><div class="small">${fmt(k, x, MARKETS[run.target]?.currency)}</div>`).join("")}</div>
        ${o.notes ? `<p class="small muted">${esc(o.notes)}</p>` : ""}
        <div class="row between">${tag}${applied ? `<span class="xs muted">Added as the ${esc(MARKETS[run.target]?.name)} analysis</span>` : `<button class="btn sm accent" data-apply="${attr(run.id)}">Add as ${esc(MARKETS[run.target]?.name)} analysis</button>`}</div>`;
    }
    case "scenarios": return `<div class="prose small">${md(o.text)}</div>${tag}`;
    default: return `<pre class="xs">${esc(JSON.stringify(o, null, 2))}</pre>`;
  }
}

// ── Events ─────────────────────────────────────────────────────────────
export function mount(root, { rerender, params, id }) {
  const p = () => product(id);
  const repaintCalc = () => {
    const prod = p(); const b = prod?.built?.[store.market];
    if (!b) return;
    const el = root.querySelector("#calc");
    const active = document.activeElement?.dataset?.calc;
    const pos = document.activeElement?.selectionStart;
    el.innerHTML = calcBlock(prod, b, withOverrides(store.market, store.settings?.markets?.[store.market]));
    if (active) {
      const inp = el.querySelector(`[data-calc="${active}"]`);
      if (inp) { inp.focus(); try { if (pos != null) inp.setSelectionRange(pos, pos); } catch { /* number inputs */ } }
    }
  };
  let t;
  root.addEventListener("input", (e) => {
    const k = e.target.dataset.calc;
    if (!k) { if (e.target.id?.startsWith("rev-")) (agentUI[`${id}|reviews`] ||= {}).input = e.target.value; return; }
    clearTimeout(t);
    t = setTimeout(() => {
      const v = e.target.value;
      if (v === "" || Number.isNaN(Number(v))) delete calc.over[k]; else calc.over[k] = Number(v);
      repaintCalc();
    }, 250);
  });
  root.addEventListener("change", (e) => {
    const ver = e.target.dataset.version;
    if (ver) { (agentUI[`${id}|${ver}`] ||= {}).version = e.target.value; rerender(); }
  });
  root.addEventListener("submit", async (e) => {
    if (e.target.id !== "verifyForm") return;
    e.preventDefault();
    const [scope, field] = root.querySelector("#vf-field").value.split("|");
    const raw = root.querySelector("#vf-value").value.trim();
    const note = root.querySelector("#vf-note").value.trim();
    const f = FIELD[field];
    const value = ["money", "pct", "num", "score"].includes(f.type) ? Number(raw.replace(",", ".").replace(/[£$%\s]|kr/g, "")) : raw;
    if (["money", "pct", "num", "score"].includes(f.type) && !Number.isFinite(value)) { window.__toast?.("Enter a number for this field."); return; }
    if (f.type === "score" && (value < 0 || value > 100)) { window.__toast?.("Scores go from 0 to 100."); return; }
    const res = await setOverlay(`${id}|${scope}|${field}`, { v: value, s: "V", src: ["user"], note, at: new Date().toISOString() });
    window.__toast?.(res.ok ? `${f.label} saved as verified.` : res.reason);
    rerender();
  });
  root.addEventListener("click", async (e) => {
    const t = e.target;
    const mkb = t.closest("[data-market]");
    if (mkb) { setMarket(mkb.dataset.market); return; }
    if (t.closest("[data-act=compare]")) { if (!toggleCompare(id)) window.__toast?.("You can compare up to five products."); rerender(); return; }
    if (t.closest("[data-act=watch]")) { await toggleWatch(id); rerender(); return; }
    if (t.closest("[data-act=ask]")) { session.focusIds = [id]; return; }
    if (t.closest("[data-act=calc-reset]")) { calc.over = {}; repaintCalc(); return; }
    if (t.closest("[data-act=calc-save]")) { await saveCalc(id); calc.over = {}; rerender(); return; }
    const un = t.closest("[data-unoverlay]");
    if (un) { await setOverlay(un.dataset.unoverlay, null); window.__toast?.("Your value was removed; the analysis value is back."); rerender(); return; }
    const toc = t.closest("[data-toc]");
    if (toc) { e.preventDefault(); root.querySelector("#sec-" + toc.dataset.toc)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); return; }
    const stop = t.closest("[data-agent-stop]");
    if (stop) { agentUI[`${id}|${stop.dataset.agentStop}`]?.ctl?.abort(); return; }
    const ap = t.closest("[data-apply]");
    if (ap) {
      const run = store.runs.find((r) => r.id === ap.dataset.apply);
      if (run && AGENTS[run.agent]?.apply) { const msg = await AGENTS[run.agent].apply(run); window.__toast?.(msg); rerender(); }
      return;
    }
    const ag = t.closest("[data-agent]");
    if (ag) {
      const key = ag.dataset.agent;
      const ui = (agentUI[`${id}|${key}`] = { ...(agentUI[`${id}|${key}`] || {}), state: "running", chars: 0, ctl: new AbortController() });
      rerender();
      try {
        const from = ag.dataset.from || store.market;
        const run = await runAgent(key, { id, market: key === "market" ? from : store.market, input: ui.input, target: ag.dataset.target, signal: ui.ctl.signal,
          onText: ({ text }) => {
            ui.chars = text.length;
            const el = root.querySelector(`[data-agent-stop="${key}"]`)?.closest(".agent")?.querySelector(".thinking");
            if (el) el.lastChild.textContent = `\u00a0Writing (${text.length} characters)`;
          } });
        if (key === "market") {
          const msg = await AGENTS.market.apply({ ...run, target: run.target || (from === "UK" ? "SE" : "UK") });
          window.__toast?.(msg);
        }
        ui.state = "idle"; ui.version = null;
      } catch (err) {
        ui.state = err?.code === "cancelled" ? "idle" : "error";
        ui.error = errCopy(err);
      }
      rerender();
    }
  });
  // Highlight the section in view.
  const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) {
      root.querySelectorAll("[data-toc]").forEach((a) => a.classList.toggle("on", a.dataset.toc === en.target.id.slice(4)));
    }
  }, { rootMargin: "-80px 0px -70% 0px" }) : null;
  const observe = () => { if (io) { io.disconnect(); root.querySelectorAll(".p-sec").forEach((s) => io.observe(s)); } };
  observe();
  return { cleanup: () => io?.disconnect(), refresh: observe };
}

async function saveCalc(id) {
  const prod = product(id);
  const m = store.market;
  const cfg = withOverrides(m, store.settings?.markets?.[m]);
  let n = 0, fail = null;
  for (const [k, v] of Object.entries(calc.over)) {
    const f = CALC_FIELDS.find((x) => x.k === k);
    const field = k === "variableCost" ? "variableCost" : f?.save;
    if (!field) continue;
    let value = v, scope = m;
    if (field === "supplierPriceUSD") { value = Math.round((v / cfg.fxFromUSD) * 100) / 100; scope = "core"; }
    if (field === "unitsPerOrder") scope = m;
    const res = await setOverlay(`${id}|${scope}|${field}`, { v: value, s: "V", src: ["user"], note: "Entered in the calculator.", at: new Date().toISOString() });
    if (res.ok) n++; else fail = res.reason;
  }
  const skipped = Object.keys(calc.over).filter((k) => !CALC_FIELDS.find((x) => x.k === k)?.save && k !== "variableCost");
  window.__toast?.(fail ? fail : `${n} value${n === 1 ? "" : "s"} saved as verified${skipped.length ? `. ${skipped.length} market-wide input${skipped.length > 1 ? "s" : ""} (shipping, packaging, fees) belong in Settings` : ""}.`);
  void prod;
}

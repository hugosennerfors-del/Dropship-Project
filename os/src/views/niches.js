// Niche finder: niches aggregated from the products, plus AI niche ideas the
// database does not cover yet.

import { store, rows } from "../state.js";
import { esc, attr, int, pct, icon, scoreChip, dateLabel } from "../ui/dom.js";
import { productTable } from "../ui/table.js";
import { niches } from "../core/query.js";
import { MARKETS } from "../core/markets.js";
import { runNicheScout } from "../agents/index.js";
import { aiUnavailableNote } from "./shared.js";
import { errCopy } from "./radar.js";

let by = "niche";
let open = null;
let scout = { state: "idle", ctl: null, error: "", focus: "" };

export function render(params) {
  const m = store.market;
  const rs = rows(m);
  if (params?.get?.("n")) open = params.get("n");
  const ns = niches(rs, by);
  const sel = open ? ns.find((n) => n.name === open) : null;
  const ideas = store.runs.filter((r) => r.agent === "niches" && r.market === m);
  return {
    title: "Niches",
    html: `<div class="page view-enter">
      <header class="page-head"><div>
        <div class="eyebrow">${icon("niche", 14)} ${esc(MARKETS[m].name)}</div>
        <h1>Niche finder</h1>
        <p>Products grouped by niche. The gap is average demand minus average competition: positive means buyers want more than sellers supply.</p>
      </div>
      <div class="seg" role="group" aria-label="Group by">${[["niche", "Niche"], ["subcategory", "Subcategory"], ["category", "Category"]].map(([k, l]) => `<button data-by="${k}" aria-pressed="${by === k}">${l}</button>`).join("")}</div></header>

      <section class="panel"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>${by === "niche" ? "Niche" : by === "category" ? "Category" : "Subcategory"}</th><th class="r">Products</th><th class="r">Opportunity</th><th class="r">Demand</th><th class="r">Competition</th><th class="r">Gap</th><th class="r hide-sm">Margin</th><th class="r hide-sm">Confidence</th></tr></thead>
        <tbody>${ns.map((n) => `<tr class="click" data-open="${attr(n.name)}"${open === n.name ? ' style="background:var(--surface-2)"' : ""}>
          <td><div class="pname"><b style="font-weight:500">${esc(n.name)}</b><small>${esc(by === "category" ? "" : n.category || "")}</small></div></td>
          <td class="r metric">${n.count}</td><td class="r">${scoreChip(n.opportunity)}</td><td class="r metric">${int(n.demand)}</td><td class="r metric">${int(n.competition)}</td>
          <td class="r metric ${n.gap > 0 ? "pos-n" : "neg-n"}">${n.gap > 0 ? "+" : ""}${int(n.gap)}</td><td class="r metric hide-sm">${pct(n.margin, 0)}</td><td class="r metric hide-sm">${int(n.confidence)}</td></tr>`).join("")}
        </tbody></table></div></section>

      ${sel ? `<section class="panel"><div class="panel-h"><h2>${esc(sel.name)}</h2><button class="btn sm ghost" data-close>Close</button></div>
        ${productTable(rs.filter((r) => sel.products.includes(r.id)), { columns: ["opportunity", "stage", "price", "margin", "profit", "demand", "competition", "confidence"] })}</section>` : ""}

      <section class="stack">
        <div class="row between"><h2 class="section-title">New niche ideas <small>AI-suggested, not in the database</small></h2></div>
        ${aiUnavailableNote()}
        ${store.sampleState === "ready" ? `<form class="panel row" id="scoutForm" style="padding:6px 6px 6px 14px;gap:8px">
          <label for="scoutFocus" class="sr">Focus</label><input id="scoutFocus" type="text" value="${attr(scout.focus)}" placeholder="Optional focus, e.g. outdoor winter gear, gifts under £40" style="flex:1;border:0;box-shadow:none">
          ${scout.state === "running" ? `<button class="btn" type="button" data-scout-stop>${icon("stop", 14)}Stop</button>` : `<button class="btn primary" type="submit">${icon("spark", 14)}Find niches</button>`}
        </form>` : ""}
        ${scout.state === "running" ? '<span class="thinking"><i></i><i></i><i></i>&nbsp;Scouting niches</span>' : ""}
        ${scout.state === "error" ? `<div class="callout warn">${icon("warn", 16)}<span>${esc(scout.error)}</span></div>` : ""}
        ${ideas.slice(0, 3).map((run) => `<div class="panel"><div class="panel-h"><h3>${run.output.focus ? esc(run.output.focus) : "General scouting"}</h3><span class="ai-tag">${icon("spark", 12)} AI ideas · ${dateLabel(run.createdAt)}</span></div>
          <div class="grid g2" style="padding:16px 18px">${(run.output.niches || []).map((n) => `<div class="stack" style="gap:6px;padding:12px;border:1px solid var(--border);border-radius:var(--r-md)">
            <div class="row between"><b style="font-weight:500">${esc(n.name)}</b><span class="tag">${esc(n.category || "")}</span></div>
            <p class="small">${esc(n.whyNow)}</p>
            <p class="xs muted">For: ${esc(n.targetCustomer)}${n.seasonality ? ` · ${esc(n.seasonality)}` : ""}</p>
            ${n.exampleProducts?.length ? `<p class="xs"><b style="font-weight:500">Products:</b> ${n.exampleProducts.map(esc).join(", ")}</p>` : ""}
            ${n.signalsToCheck?.length ? `<p class="xs"><b style="font-weight:500">Check:</b> ${n.signalsToCheck.map(esc).join("; ")}</p>` : ""}
            ${n.risks?.length ? `<p class="xs muted"><b style="font-weight:500">Risks:</b> ${n.risks.map(esc).join("; ")}</p>` : ""}
          </div>`).join("")}</div></div>`).join("") || (store.sampleState === "ready" ? '<p class="small muted">No ideas yet. Run the niche scout to get eight niches the database does not cover.</p>' : "")}
      </section>
    </div>`,
  };
}

export function mount(root, { rerender }) {
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-by]");
    if (b) { by = b.dataset.by; open = null; rerender(); return; }
    const o = e.target.closest("[data-open]");
    if (o) { open = open === o.dataset.open ? null : o.dataset.open; rerender(); return; }
    if (e.target.closest("[data-close]")) { open = null; rerender(); return; }
    if (e.target.closest("[data-scout-stop]")) { scout.ctl?.abort(); }
  });
  root.addEventListener("submit", async (e) => {
    if (e.target.id !== "scoutForm") return;
    e.preventDefault();
    scout = { state: "running", ctl: new AbortController(), error: "", focus: root.querySelector("#scoutFocus").value.trim() };
    rerender();
    try {
      await runNicheScout(rows(store.market), store.market, { signal: scout.ctl.signal, focus: scout.focus });
      scout.state = "idle";
    } catch (err) {
      scout.state = err?.code === "cancelled" ? "idle" : "error";
      scout.error = errCopy(err);
    }
    rerender();
  });
}

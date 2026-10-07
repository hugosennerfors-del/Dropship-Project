// Data: where every number comes from. Pipeline layers, the live database,
// evidence, the research inbox, connectors, your edits and settings.

import { store, rows, product, setOverlay, saveSettings, refreshLive, loadCandidates, archiveUserProduct, changed } from "../state.js";
import { esc, attr, int, pct, money, icon, glyph, statusPill, dateLabel, scoreChip } from "../ui/dom.js";
import { FIELD } from "../core/fields.js";
import { MARKETS } from "../core/markets.js";
import { CONNECTOR_STATUS } from "../core/connectors.js";
import { EVIDENCE_LEVELS } from "../core/provenance.js";
import { runProfiler } from "../agents/index.js";
import { LIVE } from "../live.js";
import { provenanceLegend, aiUnavailableNote } from "./shared.js";
import { errCopy } from "./radar.js";

const TABS = [["overview", "Overview"], ["evidence", "Evidence"], ["inbox", "Research inbox"], ["connectors", "Connectors"], ["edits", "Your edits"], ["settings", "Settings"]];
let ui = { evLevel: "", evKind: "", evMarket: "", evQ: "", inboxMarket: "", inboxQ: "", profiling: {}, inboxState: "idle", exportMsg: "" };

export function render(params) {
  const tab = params?.get?.("tab") || "overview";
  return {
    title: "Data",
    html: `<div class="page view-enter">
      <header class="page-head"><div>
        <div class="eyebrow">${icon("data", 14)} Database</div>
        <h1>Data and sources</h1>
        <p>Every value carries a status, and every estimate cites its evidence. This is where the data comes from, how it moves through the pipeline and what you have changed.</p>
      </div>${provenanceLegend()}</header>
      <nav class="tabs" role="tablist">${TABS.map(([k, l]) => `<a href="#/data?tab=${k}" role="tab" aria-selected="${tab === k}">${l}${k === "inbox" ? ` <span class="muted mono xs">${store.live.info?.inbox?.total ?? store.dataset.candidates.length}</span>` : ""}</a>`).join("")}</nav>
      ${({ overview, evidence, inbox, connectors, edits, settings })[tab]?.() || overview()}
    </div>`,
  };
}

function overview() {
  const ds = store.dataset;
  const uk = rows("UK").length, se = rows("SE").length;
  const lv = store.live;
  const run = lv.info?.lastPipelineRun;
  const ownRows = store.ownSalesRows;
  return `
    <section class="panel"><div class="panel-h"><h2>Pipeline</h2><span class="sub">each layer is kept; adding data never overwrites an earlier analysis</span></div>
      <div class="layers">
        <div class="layer"><span class="n">${ds.evidence.length}</span><span class="t">Raw data</span><small>Evidence records, ${ds.candidates.length} inbox ideas, your store's sales</small></div>
        <div class="layer"><span class="n">${ds.products.length}</span><span class="t">Processed</span><small>Validated records, market inheritance resolved, your edits applied</small></div>
        <div class="layer"><span class="n">${ds.products.length + store.userProducts.length}</span><span class="t">AI analysis</span><small>Versioned analyses with a status on every value</small></div>
        <div class="layer"><span class="n">${uk + se}</span><span class="t">Scores</span><small>Opportunity, risk, confidence, stage, red flags</small></div>
        <div class="layer"><span class="n">${uk} + ${se}</span><span class="t">Profiles</span><small>UK and Sweden, one per product and market</small></div>
      </div></section>

    <div class="grid g2">
      <section class="panel"><div class="panel-h"><h3>Live database</h3>
        <span class="conn ${lv.state === "ready" ? "on" : lv.state === "connecting" ? "" : "warn"}"><i></i>${lv.state === "ready" ? "Connected" : lv.state === "connecting" ? "Connecting" : "Not connected"}</span></div>
        <div class="panel-b stack">
          <div class="kv">
            <div>Database</div><div>Supabase project “E-Comercial”, schema <code>intel</code></div>
            <div>Reached through</div><div>n8n workflow “Plan-vy · Intelligence-DB”</div>
            <div>Sync from the repo</div><div>n8n workflow “Plan-vy · Intelligence-sync”, daily at 05:47</div>
            <div>Last pipeline load</div><div>${run ? `${dateLabel(run.finished_at)} · ${int(run.stats?.products)} products, ${int(run.stats?.newVersions)} new analysis versions` : "—"}</div>
            <div>Last read</div><div>${lv.at ? dateLabel(lv.at) + " " + new Date(lv.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"}</div>
          </div>
          ${lv.state !== "ready" && lv.error ? `<div class="callout warn">${icon("warn", 16)}<span>${esc(lv.error)} The page works from the snapshot built ${dateLabel(ds.meta.generated)}.</span></div>` : ""}
          <div class="row"><button class="btn sm" data-act="refresh">${icon("data", 13)}Read again</button><span class="xs muted">Workflow id ${esc(LIVE.workflowId)}</span></div>
        </div></section>

      <section class="panel"><div class="panel-h"><h3>Your store's sales</h3><span class="sub">intel.v_own_sales</span></div>
        <div class="panel-b stack">
          ${ownRows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>SKU</th><th class="r">Orders</th><th class="r">Per order</th><th class="r">CAC</th><th class="r">Cost/order</th><th>Status</th></tr></thead><tbody>
            ${ownRows.map((r) => `<tr><td><b style="font-weight:500">${esc(r.sku)}</b><div class="xs muted">${esc(r.name)} · ${esc(String(r.period).slice(0, 7))}</div></td><td class="r metric">${int(r.orders)}</td><td class="r metric">${money(Number(r.revenue_per_order), "SEK")}</td><td class="r metric">${money(Number(r.cac), "SEK")}</td><td class="r metric">${money(Number(r.variable_cost_per_order), "SEK")}</td><td>${statusPill(r.from_shop_sync ? "V" : "E", true)}</td></tr>`).join("")}
          </tbody></table></div>` : '<p class="small muted">No store sales found.</p>'}
          ${ownRows.some((r) => !r.from_shop_sync) ? `<div class="callout">${icon("info", 16)}<span>These orders have no Shopify order ids and were entered by hand, so they count as self-reported (Estimated). They switch to Verified automatically once orders sync from Shopify.</span></div>` : ""}
        </div></section>
    </div>

    <section class="panel"><div class="panel-h"><h3>How a value earns its status</h3></div>
      <div class="panel-b grid g4">
        ${[["V", "Verified", "Observed in a primary source or your own synced store data, or entered by you with a source."],
          ["E", "Estimated", "Derived from cited evidence (graded A–E) or a formula over data. A formula over verified data is still an estimate."],
          ["A", "AI estimated", "A model's judgement with no direct data behind it. Treat it as a hypothesis to test."],
          ["N", "Insufficient data", "Nothing reliable is known. Missing data counts as neutral in the score."]].map(([s, t, d]) => `<div class="stack" style="gap:6px"><span class="spill" style="font-size:13px;color:var(--fg)">${glyph(s)}<b style="font-weight:500">${t}</b></span><p class="xs muted">${d}</p></div>`).join("")}
      </div>
      <div class="panel-b" style="border-top:1px solid var(--border)"><div class="grid g4">${Object.entries(EVIDENCE_LEVELS).map(([l, d]) => `<div class="row" style="flex-wrap:nowrap;align-items:flex-start"><span class="tag mono">${l}</span><span class="xs muted">${esc(d)}</span></div>`).join("")}</div></div>
    </section>

    <section class="panel"><div class="panel-h"><h3>Export</h3><span class="sub">for spreadsheets, SQL and the repo</span></div>
      <div class="panel-b row">
        <button class="btn sm" data-export="profiles-csv">${icon("download", 13)}Profiles (CSV)</button>
        <button class="btn sm" data-export="overlays-json">${icon("download", 13)}Your edits (JSON)</button>
        <button class="btn sm" data-export="evidence-csv">${icon("download", 13)}Evidence (CSV)</button>
        ${ui.exportMsg ? `<span class="xs muted">${esc(ui.exportMsg)}</span>` : ""}
      </div>
      <div class="panel-b xs muted" style="border-top:1px solid var(--border)">The full SQLite file (<code>os/db/build/intel.sqlite</code>) and the Supabase sync file are built by <code>npm run pipeline</code> in the repo.</div>
    </section>`;
}

function evidence() {
  const all = store.dataset.evidence;
  const kinds = [...new Set(all.map((e) => e.kind))].sort();
  const markets = [...new Set(all.map((e) => e.market))].sort();
  const q = ui.evQ.toLowerCase();
  const list = all.filter((e) => (!ui.evLevel || e.level === ui.evLevel) && (!ui.evKind || e.kind === ui.evKind) && (!ui.evMarket || e.market === ui.evMarket)
    && (!q || `${e.claim} ${e.source?.publisher || ""} ${e.id}`.toLowerCase().includes(q)));
  return `<section class="panel">
    <div class="panel-b row" style="gap:10px">
      <label class="field" style="flex:2 1 220px"><span>Search</span><input id="evQ" type="search" value="${attr(ui.evQ)}" placeholder="Claim, publisher or id"></label>
      <label class="field"><span>Level</span><select id="evLevel"><option value="">All</option>${"ABCDE".split("").map((l) => `<option${ui.evLevel === l ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="field"><span>Kind</span><select id="evKind"><option value="">All</option>${kinds.map((k) => `<option${ui.evKind === k ? " selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
      <label class="field"><span>Market</span><select id="evMarket"><option value="">All</option>${markets.map((k) => `<option${ui.evMarket === k ? " selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
    </div>
    <div class="panel-b" style="border-top:1px solid var(--border);padding-block:4px">${list.map((e) => `<div class="ev"><span class="lv ${e.level}" title="Level ${e.level}">${e.level}</span><div>
      <div>${esc(e.claim)}</div>
      ${e.note ? `<div class="xs" style="color:var(--warn);margin-top:3px">${esc(e.note)}</div>` : ""}
      <div class="meta"><span class="mono">${esc(e.id)}</span><span>${esc(e.kind)}</span><span>${esc(e.market)}</span>${e.observed ? `<span>${esc(e.observed)}</span>` : ""}
        <span>${e.source?.url ? `<a href="${attr(e.source.url)}" target="_blank" rel="noopener">${esc(e.source.publisher || e.source.title)} ${icon("ext", 11)}</a>` : esc(e.source?.publisher || e.source?.title || "")}</span>
        ${(e.products || []).length ? `<span>${e.products.map((id) => product(id) ? `<a href="#/p/${attr(id)}">${esc(id)}</a>` : esc(id)).join(", ")}</span>` : ""}</div>
    </div></div>`).join("") || '<div class="empty">No evidence matches.</div>'}</div>
    <div class="panel-b xs muted" style="border-top:1px solid var(--border)">${list.length} of ${all.length} records.</div>
  </section>`;
}

function inbox() {
  const cands = store.candidates || store.dataset.candidates;
  const q = ui.inboxQ.toLowerCase();
  const list = cands.filter((c) => (!ui.inboxMarket || c.market === ui.inboxMarket) && (!q || `${c.name} ${c.niche} ${c.notes}`.toLowerCase().includes(q)));
  const markets = [...new Set(cands.map((c) => c.market))];
  const profiled = new Map(store.userProducts.filter((p) => p.fromCandidate).map((p) => [p.fromCandidate, p.id]));
  return `
    <div class="callout">${icon("info", 16)}<span>These ${cands.length} ideas come from the n8n Research generator (table <code>product_candidates</code> in Supabase). Their prices, costs and CPA are a language model's guesses, not quotes, so they stay out of the rankings until analysed. “Analyse” writes an AI profile into the database, labelled as AI estimates.</span></div>
    ${aiUnavailableNote()}
    <section class="panel">
      <div class="panel-b row" style="gap:10px">
        <label class="field" style="flex:2 1 220px"><span>Search</span><input id="inboxQ" type="search" value="${attr(ui.inboxQ)}" placeholder="Name, niche or note"></label>
        <label class="field"><span>Market</span><select id="inboxMarket"><option value="">All</option>${markets.map((k) => `<option${ui.inboxMarket === k ? " selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
        ${store.live.state === "ready" ? `<button class="btn sm" data-act="inbox-live" style="align-self:flex-end">${ui.inboxState === "loading" ? "Loading…" : store.candidates ? "Reload from Supabase" : "Load live from Supabase"}</button>` : ""}
      </div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Idea</th><th>Market</th><th class="r">Price</th><th class="r">Margin</th><th class="hide-sm">Researched</th><th class="r"></th></tr></thead><tbody>
      ${list.slice(0, 200).map((c) => {
        const pid = profiled.get(c.id);
        const st = ui.profiling[c.id];
        return `<tr><td><div class="pname" style="min-width:220px"><b style="font-weight:500">${esc(c.name)}</b><small>${esc(c.niche || "")}</small></div>${c.notes ? `<div class="xs muted" style="max-width:56ch;margin-top:2px">${esc(String(c.notes).slice(0, 160))}${String(c.notes).length > 160 ? "…" : ""}</div>` : ""}</td>
          <td>${esc(c.market)}</td><td class="r metric">${money(c.price, c.currency)}</td><td class="r metric">${pct(c.margin, 0)}</td><td class="hide-sm xs muted">${esc(c.researchDate || "")}</td>
          <td class="r">${pid ? `<a class="btn sm" href="#/p/${attr(pid)}">Open profile</a>` : st === "running" ? '<span class="thinking"><i></i><i></i><i></i></span>' : st && st !== "done" ? `<span class="xs" style="color:var(--bad)">${esc(st)}</span>` : store.sampleState === "ready" && ["UK", "SE"].includes(c.market) ? `<button class="btn sm" data-profile="${attr(c.id)}">${icon("spark", 13)}Analyse</button>` : '<span class="xs muted">—</span>'}</td></tr>`;
      }).join("")}</tbody></table></div>
      <div class="panel-b xs muted" style="border-top:1px solid var(--border)">${list.length} ideas${list.length > 200 ? ", first 200 shown" : ""}. US ideas can be read but not analysed: the tool covers the UK and Sweden.</div>
    </section>`;
}

function connectors() {
  const list = store.dataset.connectors;
  return `<section class="panel"><div class="list">${list.map((c) => `<div class="li" style="align-items:flex-start">
      <span class="conn ${c.status === "connected" ? "on" : c.status === "manual" ? "" : "warn"}" style="margin-top:6px"><i></i></span>
      <span class="body"><b>${esc(c.name)}</b><small style="white-space:normal">${esc(c.how)}</small><small>Provides: ${esc(c.provides.join(", "))} · yields ${esc(c.yields)} values · ${esc(c.markets.join(", "))}</small></span>
      <span class="side"><span class="tag">${esc(CONNECTOR_STATUS[c.status]?.label || c.status)}</span></span></div>`).join("")}</div></section>
    <div class="callout">${icon("info", 16)}<span>A connector writes raw records into Supabase; analysis and scores are rebuilt from them, so connecting a source never overwrites an analysis. Amazon, eBay, Etsy, TikTok Shop and Google data need API access before they can be added.</span></div>`;
}

function edits() {
  const ov = Object.entries(store.overlays).filter(([, x]) => x);
  const agentProducts = store.userProducts;
  return `<section class="panel"><div class="panel-h"><h3>Values you verified or corrected</h3><span class="sub">${ov.length}</span></div>
    <div class="list">${ov.map(([k, x]) => {
      const [pid, scope, field] = k.split("|");
      const name = product(pid)?.core?.name?.v || pid;
      return `<div class="li"><span class="body"><b>${field === "*" ? `AI ${esc(MARKETS[scope]?.name || scope)} analysis` : `${esc(FIELD[field]?.label || field)}`} · <a href="#/p/${attr(pid)}" style="color:inherit">${esc(name.split(/:\s/)[0])}</a></b><small>${esc(scope)}${x.note ? ` · ${esc(x.note)}` : ""}${x.at ? ` · ${dateLabel(x.at)}` : ""}</small></span>${statusPill(x.s, true)}<button class="btn sm ghost" data-unoverlay="${attr(k)}">Undo</button></div>`;
    }).join("") || '<div class="empty">No edits yet. Open a product and use the calculator or “Correct or verify a value”.</div>'}</div></section>
    <section class="panel"><div class="panel-h"><h3>Products added by agents or you</h3><span class="sub">${agentProducts.length}</span></div>
    <div class="list">${agentProducts.map((p) => `<div class="li"><span class="body"><b><a href="#/p/${attr(p.id)}" style="color:inherit">${esc(p.core?.name?.v || p.id)}</a></b><small>${esc(p.source)} · ${esc(Object.keys(p.markets || {}).join(", "))}${p.createdAt ? ` · ${dateLabel(p.createdAt)}` : ""}</small></span><button class="btn sm ghost" data-archive="${attr(p.id)}">Archive</button></div>`).join("") || '<div class="empty">None yet. Analyse an idea in the research inbox to add one.</div>'}</div></section>`;
}

const SETTING_FIELDS = [
  ["fxFromUSD", "USD → local currency", "Supplier prices are quoted in USD."],
  ["paymentPct", "Payment fee (share of order)", "e.g. 0.019 for 1.9 %"],
  ["paymentFixed", "Payment fee per order", "Fixed part, local currency"],
  ["packaging", "Packaging per order", "Local currency"],
];
function settings() {
  return Object.keys(MARKETS).map((code) => {
    const base = MARKETS[code];
    const ov = store.settings?.markets?.[code] || {};
    return `<section class="panel"><div class="panel-h"><h3>${esc(base.name)} assumptions</h3><span class="sub">${esc(base.currency)} · VAT ${Math.round(base.vat * 100)}%</span></div>
      <form class="panel-b grid g4" data-settings="${code}">
        ${SETTING_FIELDS.map(([k, label, hint]) => `<label class="field"><span>${esc(label)}</span><input type="number" step="any" name="${k}" value="${attr(ov[k] ?? "")}" placeholder="${attr(base[k])}"><small class="xs muted">${esc(hint)}</small></label>`).join("")}
        ${["S", "M", "L", "XL"].map((s) => `<label class="field"><span>Shipping, size ${s}</span><input type="number" step="any" name="ship_${s}" value="${attr(ov.shippingBySize?.[s] ?? "")}" placeholder="${attr(base.shippingBySize[s])}"></label>`).join("")}
        <div class="row" style="grid-column:1/-1"><button class="btn primary sm" type="submit">Save ${esc(base.name)} assumptions</button><span class="xs muted">Empty fields use the default shown. Every product's economics and scores update at once.</span></div>
      </form></section>`;
  }).join("");
}

// ── Export ─────────────────────────────────────────────────────────────
async function exportFile(kind) {
  const claude = window.claude;
  let downloads = null;
  try { downloads = claude?.use ? await claude.use("downloads") : null; } catch { downloads = null; }
  if (!downloads) return "Downloads are not available in this view.";
  let filename, data;
  const csv = (rowsArr) => rowsArr.map((r) => r.map((v) => {
    const s = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
  if (kind === "profiles-csv") {
    const cols = ["id", "market", "name", "category", "niche", "stage", "opportunity", "evidenceWeighted", "confidence", "risk", "price", "currency", "landedCost", "margin", "contribution", "cac", "profit", "netMargin", "startupCost", "breakEvenOrders", "demand", "trend", "trendAcceleration", "competition", "brandability", "viral", "tiktok", "meta", "repeat", "validation", "redFlags"];
    const all = [...rows("UK"), ...rows("SE")];
    filename = "plan-vy-profiles.csv";
    data = csv([cols, ...all.map((r) => cols.map((c) => r[c]))]);
  } else if (kind === "evidence-csv") {
    const cols = ["id", "level", "kind", "market", "claim", "observed", "publisher", "url", "products", "note"];
    filename = "plan-vy-evidence.csv";
    data = csv([cols, ...store.dataset.evidence.map((e) => [e.id, e.level, e.kind, e.market, e.claim, e.observed, e.source?.publisher, e.source?.url, e.products, e.note])]);
  } else {
    filename = "overlays.json";
    data = JSON.stringify(store.overlays, null, 1);
  }
  try { await downloads.save({ filename, data }); return `${filename} saved.`; }
  catch (e) { return e?.code === "cancelled" || e?.code === "declined" ? "Download cancelled." : "The download could not be started."; }
}

export function mount(root, { rerender }) {
  root.addEventListener("input", (e) => {
    const id = e.target.id;
    if (id === "evQ" || id === "inboxQ") {
      ui[id] = e.target.value;
      clearTimeout(ui._t);
      ui._t = setTimeout(() => { const pos = e.target.selectionStart; rerender(); const el = root.querySelector("#" + id); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* search inputs */ } } }, 250);
    }
  });
  root.addEventListener("change", (e) => {
    const id = e.target.id;
    if (["evLevel", "evKind", "evMarket", "inboxMarket"].includes(id)) { ui[id] = e.target.value; rerender(); }
  });
  root.addEventListener("submit", async (e) => {
    const code = e.target.dataset.settings;
    if (!code) return;
    e.preventDefault();
    const fd = new FormData(e.target);
    const m = {};
    for (const [k] of SETTING_FIELDS) { const v = fd.get(k); if (v !== "" && v != null && Number.isFinite(Number(v))) m[k] = Number(v); }
    const ship = {};
    for (const s of ["S", "M", "L", "XL"]) { const v = fd.get("ship_" + s); if (v !== "" && v != null && Number.isFinite(Number(v))) ship[s] = Number(v); }
    if (Object.keys(ship).length) m.shippingBySize = ship;
    const next = { markets: { ...(store.settings?.markets || {}), [code]: m } };
    const res = await saveSettings(next);
    window.__toast?.(res.ok ? `${MARKETS[code].name} assumptions saved${res.where === "supabase" ? " to Supabase" : ""}.` : res.reason);
    rerender();
  });
  root.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-act=refresh]")) { await refreshLive(); rerender(); return; }
    const ex = t.closest("[data-export]");
    if (ex) { ui.exportMsg = await exportFile(ex.dataset.export); rerender(); return; }
    const un = t.closest("[data-unoverlay]");
    if (un) { const r = await setOverlay(un.dataset.unoverlay, null); window.__toast?.(r.ok ? "Removed; the analysis value is back." : r.reason); rerender(); return; }
    const ar = t.closest("[data-archive]");
    if (ar) { const r = await archiveUserProduct(ar.dataset.archive); window.__toast?.(r.ok ? "Archived. It stays in the database history." : r.reason); rerender(); return; }
    if (t.closest("[data-act=inbox-live]")) {
      ui.inboxState = "loading"; rerender();
      try { await loadCandidates(); ui.inboxState = "idle"; } catch (err) { ui.inboxState = "idle"; window.__toast?.(err?.message || "The inbox could not be loaded."); }
      rerender(); return;
    }
    const pf = t.closest("[data-profile]");
    if (pf) {
      const id = pf.dataset.profile;
      const cand = (store.candidates || store.dataset.candidates).find((c) => c.id === id);
      if (!cand) return;
      ui.profiling[id] = "running"; rerender();
      try {
        const res = await runProfiler(cand);
        ui.profiling[id] = "done";
        window.__toast?.(res.saved ? "AI profile saved to the database." : "AI profile added for this visit; it could not be saved.");
        changed("products");
      } catch (err) { ui.profiling[id] = errCopy(err); }
      rerender();
    }
  });
}

// Data: where every number comes from. Pipeline layers, the live database,
// evidence, connectors, your edits and settings. Research ideas live under
// New research (views/research.js).

import { store, rows, product, setOverlay, saveSettings, refreshLive, archiveUserProduct } from "../state.js";
import { esc, attr, int, money, icon, glyph, statusPill, dateLabel } from "../ui/dom.js";
import { FIELD } from "../core/fields.js";
import { MARKETS } from "../core/markets.js";
import { CONNECTOR_STATUS } from "../core/connectors.js";
import { EVIDENCE_LEVELS } from "../core/provenance.js";
import { LIVE } from "../live.js";
import { provenanceLegend } from "./shared.js";
import { SCOPES, SCOPES_FOR, scopeFix } from "../shopify/documents.js";
import { SHOPIFY_API_VERSION } from "../shopify/version.js";
import { loadShopify, connectStore, testConnection, disconnectStore, saveGenerationLimit, simulatedStoreForm, storeBadge } from "../shopify/brands.js";
import { openJobDrawer } from "./shopify-ui.js";

const TABS = [["overview", "Overview"], ["evidence", "Evidence"], ["connectors", "Connectors"], ["shopify", "Shopify stores"], ["edits", "Your edits"], ["settings", "Settings"]];
let ui = { evLevel: "", evKind: "", evMarket: "", evQ: "", exportMsg: "", shop: { kind: "app", shop: "", label: "", isTest: null, busy: false, msg: "", ok: null }, armDisc: null };

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
      <nav class="tabs" role="tablist">${TABS.map(([k, l]) => `<a href="#/data?tab=${k}" role="tab" aria-selected="${tab === k}">${l}</a>`).join("")}</nav>
      ${({ overview, evidence, connectors, shopify: shopifyTab, edits, settings })[tab]?.() || overview()}
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
        <div class="layer"><span class="n">${ds.evidence.length}</span><span class="t">Raw data</span><small>Evidence records, ${int(store.inboxTotal)} <a href="#/research">research ideas</a>, your store's sales</small></div>
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

function connectors() {
  const list = store.dataset.connectors;
  return `<section class="panel"><div class="list">${list.map((c) => `<div class="li" style="align-items:flex-start">
      <span class="conn ${c.status === "connected" ? "on" : c.status === "manual" ? "" : "warn"}" style="margin-top:6px"><i></i></span>
      <span class="body"><b>${esc(c.name)}</b><small style="white-space:normal">${esc(c.how)}</small><small>Provides: ${esc(c.provides.join(", "))} · yields ${esc(c.yields)} values · ${esc(c.markets.join(", "))}</small></span>
      <span class="side"><span class="tag">${esc(CONNECTOR_STATUS[c.status]?.label || c.status)}</span></span></div>`).join("")}</div></section>
    <div class="callout">${icon("info", 16)}<span>A connector writes raw records into Supabase; analysis and scores are rebuilt from them, so connecting a source never overwrites an analysis. Amazon, eBay, Etsy, TikTok Shop and Google data need API access before they can be added.</span></div>`;
}

// -- Shopify stores -----------------------------------------------------
// Connections are listed without any secret: the page only ever sees
// whether a token exists. Credentials go once to the n8n intake workflow,
// which saves no executions, and from there into Supabase Vault.
const REQUIRED_SCOPES = ["write_products", "write_content", "write_metaobject_definitions", "write_metaobjects"];
const OPTIONAL_SCOPES = ["write_online_store_navigation", "write_publications"];
function shopifyTab() {
  const sh = store.shopify;
  const live = store.live.state === "ready";
  const f = ui.shop;
  const gens = sh.generations;
  const list = sh.connections;
  return `
    ${!live ? `<div class="callout warn">${icon("warn", 16)}<span>${esc(store.live.error || "Connecting to the live database…")} Store connections need it.</span></div>` : ""}
    <section class="panel"><div class="panel-h"><h2>Connected stores</h2><span class="sub">${list.filter((c) => c.status === "connected").length} connected · Admin GraphQL API ${esc(SHOPIFY_API_VERSION)}</span></div>
      <div class="list">${list.map((c) => connRow(c)).join("") || `<div class="empty">${sh.state === "loading" || sh.state === "waiting" ? '<span class="thinking"><i></i><i></i><i></i></span>Loading…' : "No store connected yet. Add one below, or try the whole flow with a simulated store first."}</div>`}</div>
      <div class="panel-b row" style="border-top:1px solid var(--border)"><button class="btn sm" data-shop="sim"${live ? "" : " disabled"}>${icon("flask", 13)}Add a simulated store (no Shopify)</button><button class="btn sm ghost" data-shop="reload">Read again</button><button class="btn sm ghost" data-shop="history">Publish history</button></div>
    </section>

    <div class="grid g2">
      <section class="panel"><div class="panel-h"><h3>Add a store</h3><span class="sub">a brand is published into an existing store</span></div>
        <form class="panel-b stack" data-shop-form autocomplete="off">
          <div class="seg" role="group" aria-label="How the store connects">
            <button type="button" data-shop-kind="app" aria-pressed="${f.kind === "app"}">Dev Dashboard app</button>
            <button type="button" data-shop-kind="token" aria-pressed="${f.kind === "token"}">Admin API token</button>
          </div>
          <p class="xs muted">${f.kind === "app"
            ? "For new connections: an app made in Shopify's Dev Dashboard, in the same organisation as the store. Its Client ID and secret are exchanged for a token that lasts about 24 hours and is renewed automatically."
            : "For a custom app made in the store admin before 1 January 2026 (Shopify no longer allows new ones there). The token starts with shpat_."}</p>
          <label class="field"><span>Store address</span><input type="text" name="shop" value="${attr(f.shop)}" placeholder="your-store.myshopify.com" spellcheck="false"></label>
          ${f.kind === "app" ? `<label class="field"><span>Client ID</span><input type="text" name="clientId" class="mono" spellcheck="false" autocomplete="off"></label>
            <label class="field"><span>Client secret</span><input type="password" name="clientSecret" class="mono" autocomplete="new-password"></label>`
            : `<label class="field"><span>Admin API access token</span><input type="password" name="token" class="mono" autocomplete="new-password" placeholder="shpat_…"></label>`}
          <label class="field"><span>Name in Plan-vy <small class="xs muted">optional</small></span><input type="text" name="label" value="${attr(f.label)}" maxlength="80"></label>
          <fieldset class="bb-fs"><legend class="small">Which kind of store is it?</legend>
            <label class="bb-check"><input type="radio" name="isTest" value="test"${f.isTest === true ? " checked" : ""}> Development or test store</label>
            <label class="bb-check"><input type="radio" name="isTest" value="live"${f.isTest === false ? " checked" : ""}> Live store with real customers <small>(every publish asks you to type its address)</small></label>
          </fieldset>
          <div class="row"><button class="btn primary" type="submit"${live && !f.busy ? "" : " disabled"}>${f.busy ? "Connecting…" : "Connect and test"}</button>${f.msg ? `<span class="small" style="color:${f.ok === false ? "var(--bad)" : f.ok ? "var(--good)" : "var(--fg-3)"}">${esc(f.msg)}</span>` : ""}</div>
          <p class="xs muted">The secret goes once from this form to the n8n workflow “Plan-vy · Shopify-anslutning”, which keeps no execution data, and into Supabase Vault. It is never shown again, never stored in the page and never logged. Disconnecting deletes it.</p>
        </form></section>

      <section class="panel"><div class="panel-h"><h3>Setting up a store</h3></div>
        <div class="panel-b stack small">
          <ol class="bullets">
            <li><b>A development store</b> (free): Shopify Dev Dashboard > Stores > Create a development store. Use it for every first publish.</li>
            <li><b>An app</b>: Dev Dashboard > Apps > Create app. Under Versions, choose the Admin API scopes below, release the version and install the app on the store. Copy the Client ID and secret from Settings.</li>
            <li><b>Connect</b> it here. “Connect and test” checks the token, the scopes and every API field this integration uses.</li>
          </ol>
          <div><b>Scopes to request</b> (write includes read):<ul class="bullets xs">${REQUIRED_SCOPES.map((s) => `<li><code>${s}</code>: ${esc(SCOPES[s])}</li>`).join("")}${OPTIONAL_SCOPES.map((s) => `<li><code>${s}</code> (optional): ${esc(SCOPES[s])}</li>`).join("")}</ul></div>
          <p class="xs muted">Not requested: themes, files, translations, inventory and orders. Theme templates, image uploads and other languages are not built yet, so the app does not ask for them.</p>
        </div></section>
    </div>

    <section class="panel"><div class="panel-h"><h3>AI generation limit</h3><span class="sub">${gens ? `${gens.today} of ${gens.limit} brand generations today` : "—"}</span></div>
      <form class="panel-b row" data-shop-limit><label class="field"><span>Brand generations per day</span><input type="number" name="limit" min="0" max="500" value="${attr(gens?.limit ?? 20)}"></label>
        <button class="btn sm" type="submit"${live ? "" : " disabled"}>Save limit</button>
        <span class="xs muted">Counts every generation for this database, including regenerations. Claude usage is paid by the viewer's own Claude plan, so there is no per-call price to log; tokens are estimated from the text length.</span></form></section>

    <div class="callout">${icon("info", 16)}<span>Shopify has no public API for creating a new store, so a brand is published <b>into</b> a store you connect: a collection, a page, a brand entry (metaobject) and products tagged <code>brand:&lt;handle&gt;</code>. Several stores can be connected; one store per brand is then a choice of target, not a different build.</span></div>`;
}

function connRow(c) {
  const badge = storeBadge(c);
  const needs = [...new Set([...SCOPES_FOR.product, ...SCOPES_FOR.collection, ...SCOPES_FOR.metaobject, ...SCOPES_FOR.page])];
  const missing = (c.missingScopes || []).filter((s) => needs.includes(s));
  const optional = c.schema?.optionalScopesMissing || [];
  const armed = ui.armDisc === c.id;
  const mismatch = c.isTestStore && c.schema?.partnerDevelopment === false && !c.simulated;
  return `<div class="li bb-conn" style="align-items:flex-start">
    <span class="bb-badge ${badge.toLowerCase()}">${badge}</span>
    <span class="body"><b>${esc(c.shopName || c.label || c.shopDomain)}</b>
      <small>${esc(c.shopDomain)} · ${esc(c.plan || "plan unknown")} · ${esc(c.currency || "currency unknown")} · ${c.auth === "client_credentials" ? `Dev Dashboard app ${esc(c.clientId || "")}${c.tokenExpiresAt ? `, token renews before ${new Date(c.tokenExpiresAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}` : "Admin API token"}</small>
      <small>${c.status === "connected" ? `Checked ${c.lastVerifiedAt ? dateLabel(c.lastVerifiedAt) + " " + new Date(c.lastVerifiedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : ""}${c.schema ? ` · ${c.schema.checked} API fields checked${c.schema.deprecated?.length ? `, ${c.schema.deprecated.length} deprecated` : ""}` : ""}` : esc(c.status)}</small>
      ${c.scopes?.length ? `<span class="bb-scopes">${c.scopes.map((s) => `<code>${esc(s)}</code>`).join("")}</span>` : ""}
      ${missing.length ? `<span class="small" style="color:var(--bad);white-space:normal;display:block">Missing: ${missing.map((s) => `<code>${esc(s)}</code> (${esc(SCOPES[s] || "needed")})`).join("; ")}. ${esc(scopeFix(c.auth))}</span>` : ""}
      ${optional.length ? `<small style="white-space:normal">Optional, not granted: ${optional.map((s) => `${esc(s)} (${esc(SCOPES[s] || "")})`).join("; ")}</small>` : ""}
      ${mismatch ? `<span class="small" style="color:var(--warn);white-space:normal;display:block">Added as a test store, but Shopify does not report it as a development store: it is treated as live.</span>` : ""}
      ${c.lastError ? `<span class="small" style="color:${c.status === "connected" ? "var(--warn)" : "var(--bad)"};white-space:normal;display:block">${esc(c.lastError)}</span>` : ""}
    </span>
    <span class="side"><span class="conn ${c.status === "connected" ? "on" : c.status === "pending" ? "" : "warn"}"><i></i>${esc(c.status)}</span>
      <button class="btn sm" data-shop-test="${attr(c.id)}"${c.hasToken || c.auth === "client_credentials" ? "" : " disabled"}>Test</button>
      <button class="btn sm ${armed ? "bb-btn-danger" : "ghost"}" data-shop-disc="${attr(c.id)}">${armed ? "Disconnect?" : "Disconnect"}</button></span>
  </div>`;
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
    <div class="list">${agentProducts.map((p) => `<div class="li"><span class="body"><b><a href="#/p/${attr(p.id)}" style="color:inherit">${esc(p.core?.name?.v || p.id)}</a></b><small>${esc(p.source)} · ${esc(Object.keys(p.markets || {}).join(", "))}${p.createdAt ? ` · ${dateLabel(p.createdAt)}` : ""}</small></span><button class="btn sm ghost" data-archive="${attr(p.id)}">Archive</button></div>`).join("") || '<div class="empty">None yet. Analyse an idea under <a href="#/research">New research</a> to add one.</div>'}</div></section>`;
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

export function mount(root, { rerender, params }) {
  const onShopify = () => params?.get?.("tab") === "shopify";
  if (onShopify() && store.shopify.state !== "ready") loadShopify();
  root.addEventListener("submit", async (e) => {
    const form = e.target;
    if (form.matches("[data-shop-form]")) {
      e.preventDefault();
      const fd = new FormData(form);
      const isTest = fd.get("isTest") === "test" ? true : fd.get("isTest") === "live" ? false : null;
      Object.assign(ui.shop, { shop: String(fd.get("shop") || ""), label: String(fd.get("label") || ""), isTest });
      const creds = { kind: ui.shop.kind, shop: ui.shop.shop, label: ui.shop.label, isTest, token: fd.get("token"), clientId: fd.get("clientId"), clientSecret: fd.get("clientSecret") };
      // The secret fields are cleared at once; the value lives only in this call.
      for (const n of ["token", "clientSecret"]) { const el = form.querySelector(`[name=${n}]`); if (el) el.value = ""; }
      ui.shop.busy = true; ui.shop.ok = null; ui.shop.msg = "Sending to the intake workflow…"; rerender();
      const r = await connectStore(creds, { onStatus: (m) => { ui.shop.msg = m; rerender(); } });
      ui.shop.busy = false; ui.shop.ok = r.ok; ui.shop.msg = r.ok ? `Connected: ${r.connection.shopName || r.connection.shopDomain}.` : r.reason;
      if (r.ok) Object.assign(ui.shop, { shop: "", label: "", isTest: null });
      rerender();
      return;
    }
    if (form.matches("[data-shop-limit]")) {
      e.preventDefault();
      const r = await saveGenerationLimit(new FormData(form).get("limit"));
      window.__toast?.(r.ok ? `Limit saved: ${r.limit} per day.` : r.reason);
      rerender();
    }
  });
  root.addEventListener("input", (e) => {
    const id = e.target.id;
    if (id === "evQ") {
      ui[id] = e.target.value;
      clearTimeout(ui._t);
      ui._t = setTimeout(() => { const pos = e.target.selectionStart; rerender(); const el = root.querySelector("#" + id); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* search inputs */ } } }, 250);
    }
  });
  root.addEventListener("change", (e) => {
    const id = e.target.id;
    if (["evLevel", "evKind", "evMarket"].includes(id)) { ui[id] = e.target.value; rerender(); }
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
    // Shopify stores
    const kind = t.closest("[data-shop-kind]");
    if (kind) { const form = root.querySelector("[data-shop-form]"); if (form) { const fd = new FormData(form); ui.shop.shop = String(fd.get("shop") || ""); ui.shop.label = String(fd.get("label") || ""); } ui.shop.kind = kind.dataset.shopKind; ui.shop.msg = ""; rerender(); return; }
    const sa = t.closest("[data-shop]")?.dataset.shop;
    if (sa === "reload") { await loadShopify(); rerender(); return; }
    if (sa === "history") { openJobDrawer(null, { tab: "history" }); return; }
    if (sa === "sim") {
      ui.shop.busy = true; ui.shop.ok = null; ui.shop.msg = "Creating a simulated store…"; rerender();
      const r = await connectStore(simulatedStoreForm(), { onStatus: (m) => { ui.shop.msg = m; rerender(); } });
      ui.shop.busy = false; ui.shop.ok = r.ok; ui.shop.msg = r.ok ? "Simulated store ready. Publishing to it runs the real pipeline against a store kept in the database." : r.reason;
      rerender();
      return;
    }
    const st = t.closest("[data-shop-test]");
    if (st) { st.disabled = true; const r = await testConnection(st.dataset.shopTest); window.__toast?.(r.ok ? "Testing the connection…" : r.reason); setTimeout(() => loadShopify({ quiet: true }), 3500); return; }
    const dc = t.closest("[data-shop-disc]");
    if (dc) {
      const id = dc.dataset.shopDisc;
      if (ui.armDisc !== id) { ui.armDisc = id; rerender(); clearTimeout(ui._arm); ui._arm = setTimeout(() => { ui.armDisc = null; rerender(); }, 5000); return; }
      ui.armDisc = null;
      const r = await disconnectStore(id);
      window.__toast?.(r.ok ? "Disconnected. The token or secret is deleted from Vault; the publish history is kept." : r.reason);
      rerender();
    }
  });
  return { refresh: () => { if (onShopify() && store.live.state === "ready" && store.shopify.state !== "ready" && store.shopify.state !== "loading" && !store.shopify._dataTried) { store.shopify._dataTried = true; loadShopify(); } } };
}

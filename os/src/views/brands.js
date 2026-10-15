// Brand Builder (#/brands): describe a niche, get complete brand concepts
// from Claude, edit and preview them, and publish one to a Shopify store
// (or only some of its products). Concepts are saved as versions in
// Supabase the moment they pass validation.

import { store, product } from "../state.js";
import { esc, attr, icon, dateLabel } from "../ui/dom.js";
import { MARKETS } from "../core/markets.js";
import { burstAt } from "../fx.js";
import { LIMITS } from "../shopify/concept.js";
import { complianceChecks } from "../shopify/compliance.js";
import {
  loadShopify, generateConcepts, regenerateBrand, suggestNiches, duplicateBrand, archiveBrand, importConcept, brandById,
  storeBadge, PRICE_LEVELS, TONES, PRODUCT_TYPES, IMAGE_PROVIDERS, errText,
} from "../shopify/brands.js";
import { openPreview, openEditor, openPublish, openJobDrawer, openRegenerate, openLogo, openChecks, openPolicies, openNames, paletteOf, fontsOf, loadFonts, placeholderSvg, brandVars } from "./shopify-ui.js";

const ui = {
  form: { niche: "", audience: "", priceLevel: "mid", tone: "", market: null, productType: "physical", concepts: 3, products: 6 },
  running: false, failed: false, ctl: null, status: "", chars: 0, runIds: [], rejected: [], cached: null, msg: "",
  suggestions: [], suggesting: false, q: "", selected: {}, regen: {}, sourceProductId: null,
};
const toast = (m) => window.__toast?.(m);
const SECTION_SHORT = { hero: "Hero", "featured-collection": "Products", "rich-text": "Text", "image-with-text": "Image + text", "usp-columns": "USPs", faq: "FAQ", testimonials: "Reviews (not published)", newsletter: "Newsletter" };

export function render(params) {
  const sh = store.shopify;
  const pid = params?.get?.("product");
  if (pid && pid !== ui.sourceProductId) {
    const p = product(pid);
    if (p) {
      ui.sourceProductId = pid;
      const name = p.core?.name?.v || pid;
      ui.form.niche = `${String(name).split(/:\s/)[0]}${p.core?.niche?.v ? ` (${p.core.niche.v})` : ""}`;
      if (p.core?.targetCustomer?.v) ui.form.audience = String(p.core.targetCustomer.v).slice(0, 300);
    }
  }
  ui.form.market ||= store.market;
  const gens = sh.generations;
  const sampleOk = store.sampleState === "ready";
  const liveOk = store.live.state === "ready";
  const connected = sh.connections.filter((c) => c.status === "connected");
  const fresh = ui.runIds.map((id) => brandById(id)).filter(Boolean);
  const q = ui.q.toLowerCase();
  const saved = sh.brands.filter((b) => !ui.runIds.includes(b.id) && (!q || `${b.name} ${b.concept?.tagline || ""} ${b.id}`.toLowerCase().includes(q)));
  const f = ui.form;
  return {
    title: "Brand Builder",
    html: `<div class="page view-enter bb">
      <header class="page-head"><div>
        <div class="eyebrow">${icon("wand", 14)} Brand Builder · Shopify</div>
        <h1>Brand Builder</h1>
        <p>Describe a niche and get complete brand concepts: name, positioning, palette, fonts, products with variants and prices, page plan and copy. Edit them, preview the page, then publish to a Shopify store as drafts. Nothing reaches Shopify until you confirm a store.</p>
      </div>
      <div class="bb-meta">
        <span class="tag" data-tip="Generations count against your own Claude plan; the daily cap is set under Data > Shopify stores.">${icon("spark", 12)}${gens ? `${gens.today} of ${gens.limit} generations today` : "Generations today: —"}</span>
        <a class="tag" href="#/data?tab=shopify">${icon("store", 12)}${connected.length} store${connected.length === 1 ? "" : "s"} connected</a>
        <button class="btn sm" data-bb="history">${icon("layers", 13)}Publish history</button>
      </div></header>
      ${!liveOk ? `<div class="callout warn">${icon("warn", 16)}<span>${store.live.state === "connecting" ? "Connecting to the live database…" : esc(store.live.error || "The live database is not connected.")} Brands, stores and publishing need it.</span></div>` : ""}
      ${liveOk && sh.state === "offline" ? `<div class="callout warn">${icon("warn", 16)}<span>${esc(sh.error)}</span><button class="btn sm" data-bb="reload">Try again</button></div>` : ""}
      ${!sampleOk ? `<div class="callout">${icon("info", 16)}<span>${store.sampleState === "connecting" ? "Connecting to Claude…" : "Claude is not available in this view, so new concepts cannot be generated here. Saved brands can still be edited, previewed and published."}</span></div>` : ""}
      <div class="bb-layout">
        <form class="panel bb-form" data-bb-form autocomplete="off">
          <div class="panel-h"><h3>Brief</h3>${ui.sourceProductId ? `<span class="sub">from <a href="#/p/${attr(ui.sourceProductId)}">this product</a></span>` : ""}</div>
          <div class="panel-b stack">
            <label class="field"><span>Niche or idea <small class="xs muted">required</small></span><textarea id="bb-niche" rows="3" maxlength="600" placeholder="e.g. changing robes for cold-water swimmers">${esc(f.niche)}</textarea></label>
            <div class="row"><button type="button" class="btn sm ghost" data-bb="suggest"${sampleOk && !ui.suggesting ? "" : " disabled"}>${icon("spark", 12)}${ui.suggesting ? "Thinking…" : "Suggest niches for me"}</button></div>
            ${ui.suggestions.length ? `<div class="bb-sugg">${ui.suggestions.map((s, i) => `<button type="button" class="chip" data-niche="${i}" data-tip="${attr(s.why)}">${esc(s.niche)}</button>`).join("")}</div>` : ""}
            <label class="field"><span>Target audience</span><input type="text" id="bb-audience" maxlength="300" value="${attr(f.audience)}" placeholder="age, interests, where they live"></label>
            <div class="grid g2">
              <label class="field"><span>Price level</span><select id="bb-price">${PRICE_LEVELS.map(([k, l]) => `<option value="${k}"${f.priceLevel === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
              <label class="field"><span>Tone</span><input type="text" id="bb-tone" list="bb-tones" maxlength="80" value="${attr(f.tone)}" placeholder="e.g. Nordic, playful"><datalist id="bb-tones">${TONES.map((t) => `<option value="${t}">`).join("")}</datalist></label>
            </div>
            <div class="grid g2">
              <label class="field"><span>Market and language</span><select id="bb-market">${Object.values(MARKETS).map((m) => `<option value="${m.code}"${f.market === m.code ? " selected" : ""}>${esc(m.name)} (${m.currency})</option>`).join("")}</select></label>
              <label class="field"><span>Product type</span><select id="bb-ptype">${PRODUCT_TYPES.map(([k, l]) => `<option value="${k}"${f.productType === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
            </div>
            <div class="grid g2">
              <label class="field"><span>Concepts</span><input type="number" id="bb-n" min="1" max="${LIMITS.concepts}" value="${attr(f.concepts)}"></label>
              <label class="field"><span>Products each</span><input type="number" id="bb-p" min="1" max="${LIMITS.products}" value="${attr(f.products)}"></label>
            </div>
            <div class="row">
              ${ui.running ? `<button type="button" class="btn" data-bb="stop">${icon("stop", 13)}Stop</button>` : `<button type="submit" class="btn primary"${sampleOk && liveOk ? "" : " disabled"}>${icon("wand", 14)}Generate concepts</button>`}
              ${ui.cached && !ui.running ? `<button type="button" class="btn sm" data-bb="force">Generate anew</button>` : ""}
            </div>
            <p class="xs muted">Your text is sent to Claude as data between delimiters, with an instruction to ignore any instructions inside it. Each concept is checked against a strict schema before it is saved. The same brief within 24 hours reuses the earlier answer.</p>
            <div class="bb-imp"><label class="btn sm ghost">${icon("upload", 12)}Import a concept (JSON)<input type="file" accept="application/json,.json" data-bb-import hidden></label></div>
          </div>
        </form>
        <div class="stack bb-results">
          ${ui.failed && !ui.running ? `<div class="callout bad bb-run" role="alert">${icon("warn", 16)}<span>${esc(ui.status)}</span></div>`
            : ui.running || ui.status ? `<section class="panel bb-run"><div class="panel-b row">
              ${ui.running ? '<span class="thinking"><i></i><i></i><i></i></span>' : icon("check", 14)}
              <span class="small">${esc(ui.status)}${ui.running && ui.chars ? ` · ${ui.chars.toLocaleString("en-GB")} characters written` : ""}</span></div></section>` : ""}
          ${ui.cached ? `<div class="callout">${icon("info", 16)}<span>Same brief as ${dateLabel(ui.cached.createdAt)}: showing those concepts instead of asking Claude again. “Generate anew” asks again (counts towards today's limit).</span></div>` : ""}
          ${ui.rejected.length ? `<div class="callout warn">${icon("warn", 16)}<div><b>Not saved (did not pass the schema):</b><ul class="bullets small">${ui.rejected.map((r) => `<li><b>${esc(r.name)}</b>: ${esc((r.errors || []).slice(0, 3).join("; "))}</li>`).join("")}</ul></div></div>` : ""}
          ${fresh.length ? `<h2 class="section-title">This run <small>${fresh.length} concept${fresh.length === 1 ? "" : "s"}, saved as drafts</small></h2><div class="bb-grid-cards">${fresh.map((b) => card(b, true)).join("")}</div>` : ""}
          <div class="row between"><h2 class="section-title">Your brands <small>${sh.brands.length}</small></h2>
            ${sh.brands.length > 3 ? `<input type="search" id="bb-q" placeholder="Search brands" value="${attr(ui.q)}" aria-label="Search brands">` : ""}</div>
          ${sh.state === "loading" || sh.state === "waiting" ? `<div class="empty"><span class="thinking"><i></i><i></i><i></i></span>Loading brands…</div>`
            : saved.length ? `<div class="bb-grid-cards">${saved.map((b) => card(b)).join("")}</div>`
            : `<div class="empty">${!sh.brands.length ? "No brands yet. Write a brief and generate your first concepts." : q ? "No brand matches." : "Your other brands appear here; the ones from this run are above."}</div>`}
          <details class="panel bb-img-note"><summary class="panel-h"><h3>Images</h3><span class="sub">which image sources work today</span></summary><div class="panel-b"><ul class="bullets small">${Object.values(IMAGE_PROVIDERS).map((p) => `<li><b>${esc(p.label)}</b>${p.built ? "" : " · not built yet"}: ${esc(p.note)}</li>`).join("")}</ul></div></details>
        </div>
      </div>
    </div>`,
  };
}

function lastJob(id) { return store.shopify.jobs.find((j) => j.brandId === id) || null; }

function card(b, isFresh = false) {
  const c = b.concept || {};
  const pal = c.identity?.palette || [];
  const fonts = fontsOf(c);
  const sel = ui.selected[b.id] || new Set();
  const job = lastJob(b.id);
  const regen = ui.regen[b.id];
  const p = paletteOf(c);
  return `<article class="bb-card${isFresh ? " fresh" : ""}" data-brand="${attr(b.id)}" style="${brandVars(c)}">
    <div class="bb-card-top" style="background:linear-gradient(120deg, ${p.primary}, ${p.secondary})">
      <div class="bb-sw">${pal.map((x) => `<i style="background:${/^#[0-9a-fA-F]{6}$/.test(x.hex) ? x.hex : "#ccc"}" title="${attr(`${x.role}: ${x.name} ${x.hex}`)}"></i>`).join("")}</div>
      <span class="bb-ver">${b.status === "published" ? "Published" : "Draft"} · v${b.version}</span>
    </div>
    <div class="bb-card-b">
      <h3 class="bb-name">${esc(c.name || b.name)}</h3>
      <p class="bb-tag">${esc(c.tagline || "")}</p>
      <div class="bb-type"><span class="bb-aa">Aa</span><span>${esc(fonts.head || "—")} / ${esc(fonts.body || "—")}</span><span class="tag">${esc(c.market || "UK")}</span>${(c.legalFlags || []).length ? `<span class="tag bb-warn" data-tip="${attr((c.legalFlags || []).join(" · "))}">${icon("warn", 11)}${c.legalFlags.length} to check</span>` : ""}</div>
      ${(c.story?.usps || []).length ? `<ul class="bb-usps">${c.story.usps.slice(0, 3).map((u) => `<li>${esc(u)}</li>`).join("")}</ul>` : ""}
      <div class="bb-prods">${(c.products || []).map((pr, i) => `<div class="bb-prod">
          <input type="checkbox" data-bb-sel="${attr(pr.handle || "")}" aria-label="Select ${attr(pr.title)}"${pr.handle && sel.has(pr.handle) ? " checked" : ""}${pr.handle ? "" : " disabled"}>
          <span class="bb-thumb">${placeholderSvg(c, i + 10, pr.title)}</span>
          <span class="bb-pt"><b>${esc(pr.title)}</b><small>${esc(priceLabel(c, pr))} · ${pr.variants?.length || 0} variant${pr.variants?.length === 1 ? "" : "s"}</small></span>
          <button class="btn sm ghost" data-bb-pubprod="${attr(pr.handle || "")}" data-tip="Create only this product in Shopify (as a draft)"${pr.handle ? "" : " disabled"}>${icon("store", 12)}</button>
        </div>`).join("")}</div>
      ${sel.size ? `<div class="bb-bulk"><span class="small">${sel.size} selected</span><button class="btn sm primary" data-bb-pubsel>Publish selected (${sel.size})</button><button class="btn sm ghost" data-bb-clear>Clear</button></div>` : ""}
      <div class="bb-wire" aria-label="Page plan">${(c.pagePlan?.sections || []).map((s) => `<span class="bb-w bb-w-${attr(s.type)}">${esc(SECTION_SHORT[s.type] || s.type)}</span>`).join("")}</div>
      <div class="bb-tools" aria-label="Brand tools">
        <button class="btn sm ghost" data-bb-names>${icon("search", 12)}Name check</button>
        <button class="btn sm ghost" data-bb-policies>${icon("data", 12)}Policies${c.policies?.terms ? " ✓" : ""}</button>
        <button class="btn sm ghost" data-bb-logo>${icon("wand", 12)}Logo${c.logo ? " ✓" : ""}</button>
        ${(() => { const ch = complianceChecks(c); return `<button class="btn sm ghost${ch.done ? "" : " bb-tool-open"}" data-bb-checks data-tip="${attr(ch.done ? "Store details and checks are done" : `${ch.blocking.length} check${ch.blocking.length === 1 ? "" : "s"} open before selling to shoppers`)}">${icon("shield", 12)}Checks ${ch.done ? "✓" : `${ch.items.length - ch.blocking.length}/${ch.items.length}`}</button>`; })()}
      </div>
      ${job ? `<button class="bb-job" data-bb-job="${attr(job.id)}"><span class="bb-st bb-st-${attr(job.status)}">${esc(job.status.replace("_", " "))}</span><span class="xs muted">last publish ${dateLabel(job.createdAt)}${store.shopify.connections.find((x) => x.id === job.connectionId) ? ` · ${storeBadge(store.shopify.connections.find((x) => x.id === job.connectionId))}` : ""}</span></button>` : ""}
      ${regen ? `<div class="bb-regen"><span class="thinking"><i></i><i></i><i></i></span><span class="small">${esc(regen.status || "Regenerating…")}</span><button class="btn sm" data-bb-regen-stop>Stop</button></div>` : ""}
    </div>
    <div class="bb-card-f">
      <button class="btn sm" data-bb-preview>${icon("search", 12)}Preview</button>
      <button class="btn sm" data-bb-edit>Edit</button>
      <button class="btn sm" data-bb-regen${store.sampleState === "ready" && !regen ? "" : " disabled"}>${icon("spark", 12)}Regenerate</button>
      <button class="btn sm" data-bb-dup>Duplicate</button>
      <span class="spacer"></span>
      <button class="btn sm ghost" data-bb-export data-tip="Download as JSON">${icon("download", 12)}</button>
      <button class="btn sm ${ui.armArchive === b.id ? "bb-btn-danger" : "ghost"}" data-bb-archive data-tip="Archive (kept in the database)">${ui.armArchive === b.id ? "Archive?" : icon("x", 12)}</button>
      <button class="btn sm primary bb-pub" data-bb-publish>${icon("store", 12)}Publish brand to Shopify</button>
    </div>
  </article>`;
}

function priceLabel(c, p) {
  const ps = (p.variants || []).map((v) => Number(v.price)).filter(Number.isFinite);
  if (!ps.length) return "—";
  const cur = c.currency || (c.market === "SE" ? "SEK" : "GBP");
  const fmt = (x) => (cur === "SEK" ? `${Math.round(x)} kr` : `£${x.toFixed(2)}`);
  const lo = Math.min(...ps), hi = Math.max(...ps);
  return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
}

function readForm(root) {
  const v = (id) => root.querySelector("#" + id)?.value ?? "";
  Object.assign(ui.form, { niche: v("bb-niche"), audience: v("bb-audience"), priceLevel: v("bb-price"), tone: v("bb-tone"), market: v("bb-market"), productType: v("bb-ptype"), concepts: Number(v("bb-n")) || 3, products: Number(v("bb-p")) || 6 });
}

export function mount(root, { rerender, params }) {
  const fontsFor = () => { for (const b of store.shopify.brands.slice(0, 24)) loadFonts(b.concept); };
  if (store.shopify.state !== "ready") loadShopify();
  fontsFor();
  if (params?.get?.("job")) setTimeout(() => openJobDrawer(params.get("job")), 0);

  async function generate(force = false) {
    readForm(root);
    if (ui.running) return;
    ui.ctl = new AbortController();
    Object.assign(ui, { running: true, failed: false, status: "Starting…", chars: 0, runIds: [], rejected: [], cached: null });
    rerender();
    try {
      const r = await generateConcepts({ ...ui.form, sourceProductId: ui.sourceProductId }, {
        signal: ui.ctl.signal, force,
        onStatus: (s) => { ui.status = s; rerender(); },
        onText: ({ text }) => { ui.chars = text.length; const el = root.querySelector(".bb-run .small"); if (el && root.isConnected) el.textContent = `${ui.status} · ${ui.chars.toLocaleString("en-GB")} characters written`; },
        onConcept: ({ id }) => { if (!ui.runIds.includes(id)) ui.runIds.push(id); rerender(); const el = root.querySelector(`[data-brand="${CSS.escape(id)}"]`); if (el) burstAt(el, 40); },
      });
      ui.running = false;
      if (r.cached) { ui.cached = r; ui.runIds = r.brandIds; ui.status = "From the cache: same brief as before."; }
      else {
        ui.rejected = r.rejected || [];
        ui.status = `${r.brandIds.length} concept${r.brandIds.length === 1 ? "" : "s"} saved as drafts${r.stoppedEarly ? " (stopped early)" : ""} · ${r.used} of ${r.limit} generations today.`;
      }
    } catch (e) {
      ui.running = false;
      ui.failed = e?.code !== "cancelled";
      ui.status = e?.code === "cancelled" ? "Stopped." : errText(e);
      if (e?.code && !["cancelled", "input", "limit"].includes(e.code)) ui.status = sampleError(e);
    }
    ui.ctl = null;
    rerender();
  }

  // The whole concept anew, as the brand's next version (progress on the card).
  async function regenerateWhole(b, wish) {
    const ctl = new AbortController();
    ui.regen[b.id] = { ctl, status: "Claude is writing a new concept…" };
    rerender();
    try {
      const r = await regenerateBrand(b, { signal: ctl.signal, wish, onStatus: (s) => { if (ui.regen[b.id]) ui.regen[b.id].status = s; rerender(); } });
      toast(r.brandIds?.length ? "New version saved; the earlier one is kept." : (r.rejected?.[0]?.errors || ["Nothing new was saved."]).join("; "));
    } catch (err) { toast(err?.code === "cancelled" ? "Stopped." : sampleError(err)); }
    delete ui.regen[b.id];
    rerender();
  }

  root.addEventListener("submit", (e) => { if (e.target.closest("[data-bb-form]")) { e.preventDefault(); generate(false); } });
  root.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "bb-q") { ui.q = t.value; clearTimeout(ui._t); ui._t = setTimeout(() => { rerender(); const n = root.querySelector("#bb-q"); n?.focus(); n?.setSelectionRange(n.value.length, n.value.length); }, 200); return; }
    if (t.closest("[data-bb-form]")) readForm(root);
  });
  root.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.matches("[data-bb-import]")) {
      const file = t.files?.[0];
      if (!file) return;
      if (file.size > 400000) { toast("That file is larger than 400 KB."); return; }
      const r = await importConcept(await file.text());
      toast(r.ok ? "Imported as a new draft brand." : r.reason || `Not imported: ${(r.errors || []).slice(0, 2).join("; ")}`);
      t.value = "";
      return;
    }
    const sel = t.closest("[data-bb-sel]");
    if (sel) {
      const id = t.closest("[data-brand]").dataset.brand;
      const set = (ui.selected[id] ||= new Set());
      if (t.checked) set.add(sel.dataset.bbSel); else set.delete(sel.dataset.bbSel);
      rerender();
      return;
    }
    if (t.closest("[data-bb-form]")) readForm(root);
  });
  root.addEventListener("click", async (e) => {
    const t = e.target;
    const act = t.closest("[data-bb]")?.dataset.bb;
    if (act === "stop") { ui.ctl?.abort(); return; }
    if (act === "force") return generate(true);
    if (act === "history") return openJobDrawer(null, { tab: "history" });
    if (act === "reload") { await loadShopify(); return; }
    if (act === "suggest") {
      readForm(root);
      ui.suggesting = true; rerender();
      try { ui.suggestions = await suggestNiches({ market: ui.form.market, audience: ui.form.audience }); }
      catch (err) { toast(sampleError(err)); }
      ui.suggesting = false; rerender();
      return;
    }
    const ni = t.closest("[data-niche]");
    if (ni) { ui.form.niche = ui.suggestions[Number(ni.dataset.niche)]?.niche || ui.form.niche; rerender(); root.querySelector("#bb-niche")?.focus(); return; }

    const cardEl = t.closest("[data-brand]");
    if (!cardEl) return;
    const b = brandById(cardEl.dataset.brand);
    if (!b) return;
    if (t.closest("[data-bb-preview]")) return openPreview(b.concept);
    if (t.closest("[data-bb-logo]")) return openLogo(b, { onSaved: () => rerender() });
    if (t.closest("[data-bb-checks]")) return openChecks(b, { onSaved: () => rerender() });
    if (t.closest("[data-bb-policies]")) return openPolicies(b, { onSaved: () => rerender() });
    if (t.closest("[data-bb-names]")) return openNames(b);
    if (t.closest("[data-bb-edit]")) return openEditor(b, { onSaved: () => rerender() });
    if (t.closest("[data-bb-publish]")) return openPublish(b);
    if (t.closest("[data-bb-job]")) return openJobDrawer(t.closest("[data-bb-job]").dataset.bbJob);
    const pp = t.closest("[data-bb-pubprod]");
    if (pp) return openPublish(b, { productHandles: [pp.dataset.bbPubprod] });
    if (t.closest("[data-bb-pubsel]")) return openPublish(b, { productHandles: [...(ui.selected[b.id] || [])] });
    if (t.closest("[data-bb-clear]")) { delete ui.selected[b.id]; return rerender(); }
    if (t.closest("[data-bb-dup]")) { const r = await duplicateBrand(b); toast(r.ok ? "Duplicated as a new draft brand." : r.reason || (r.errors || []).join("; ")); return; }
    if (t.closest("[data-bb-archive]")) {
      // Two clicks: the first arms the button for five seconds.
      if (ui.armArchive !== b.id) {
        ui.armArchive = b.id; rerender();
        toast(`Click again to archive “${b.name}”. It stays in the database with all versions; nothing in Shopify changes.`);
        clearTimeout(ui._arm); ui._arm = setTimeout(() => { ui.armArchive = null; rerender(); }, 5000);
        return;
      }
      ui.armArchive = null;
      const r = await archiveBrand(b.id); toast(r.ok ? "Archived." : r.reason); return;
    }
    if (t.closest("[data-bb-export]")) return exportBrand(b);
    if (t.closest("[data-bb-regen-stop]")) { ui.regen[b.id]?.ctl.abort(); return; }
    if (t.closest("[data-bb-regen]")) return openRegenerate(b, { onWhole: (wish) => regenerateWhole(b, wish), onDone: () => rerender() });
  });
  return { refresh: () => { if (store.live.state === "ready" && ["idle", "waiting", "offline"].includes(store.shopify.state) && !store.shopify._tried) { store.shopify._tried = true; loadShopify(); } fontsFor(); } };
}

function sampleError(e) {
  switch (e?.code) {
    case "not_granted": return "Claude is not allowed for this page. Allow it when the page asks, or open it on claude.ai.";
    case "rate_limited": return "Too many requests to Claude right now. Wait a minute and try again.";
    case "refused": return "Claude declined this brief. Rephrase it and try again.";
    case "invalid_json": return "Claude's answer could not be read as concepts. Try again, or ask for fewer concepts.";
    case "tools_unavailable": return "This view cannot run tool calls; reload the page.";
    case "prompt_too_large": return "The brief is too long. Shorten it.";
    case "session_expired": return "Sign in to claude.ai again.";
    case "invalid_request": return `Claude did not accept the request from this page (${e.message || "invalid request"}). This is a fault in the page, not in your brief.`;
    default: return errText(e);
  }
}

async function exportBrand(b) {
  let downloads = null;
  try { downloads = window.claude?.use ? await window.claude.use("downloads") : null; } catch { downloads = null; }
  if (!downloads) { toast("Downloads are not available in this view."); return; }
  try { await downloads.save({ filename: `${b.id}-v${b.version}.json`, data: JSON.stringify({ format: "plan-vy-brand-concept", version: b.version, exportedAt: new Date().toISOString(), concept: b.concept }, null, 2) }); toast("Saved."); }
  catch (e) { toast(e?.code === "cancelled" || e?.code === "declined" ? "Download cancelled." : "The download could not be started."); }
}

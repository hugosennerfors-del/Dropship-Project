// The product page's Ads section: competitors' ads for the product in the
// selected market. Links to the ad libraries with the search filled in, a
// GetHookd search that saves the ads it finds, and the saved ads with how
// long each has been running.

import { store, adsFor, saveAd, removeAd, addSavedAds, upsertSavedAds, loadPref, savePref } from "../state.js";
import { esc, attr, icon, money, int } from "../ui/dom.js";
import { MARKETS } from "../core/markets.js";
import { AD_PLATFORMS, LONG_RUNNING_DAYS, adLibraryLinks, adMatcher, hookdQuery, defaultAdQuery, normaliseAd, platformOf, runningDays, sortAds, adSignal } from "../core/ads.js";
import { ESTIMATE_RANGE, assumptions, estimateAd, estimateByAdvertiser } from "../core/adrevenue.js";
import { burstAt } from "../fx.js";
import { liveRead, liveWrite, MCP_FIX } from "../live.js";
import { CLONE_MODELS, CLONE_ASPECTS, CLONE_MAX_VARIATIONS, cloneCost } from "../shopify/clone.js";
import { runAdCopy } from "../agents/index.js";

// Per product and market: search words, the form being edited (null, "new"
// or an ad id), its draft, and the ad whose Remove was clicked once.
const ui = {};
// `hookd.fresh` holds the ids the last GetHookd search added, marked "new";
// `est` is the revenue estimate's "Update numbers" run.
// `clone` is the "Copy ad" form open under one saved ad.
const uiFor = (pid, m) => (ui[`${pid}|${m}`] ||= { query: null, editing: null, draft: {}, error: null, armed: null, hookd: { busy: false, status: "", error: "", result: null, fresh: [] },
  est: { busy: false, status: "", error: "", summary: null, traffic: false },
  clone: { open: null, model: CLONE_MODELS[0].slug, aspect: "1:1", variations: 2, busy: false, error: "" } });
// One GetHookd search returns at most this many ads (about 0.01 credit each).
const HOOKD_LIMIT = 10;

const SHORT = { meta: "Meta", tiktok: "TikTok", google: "Google", youtube: "YouTube", pinterest: "Pinterest", other: "Web" };
const today = () => new Date().toISOString().slice(0, 10);

function queryFor(p, m) {
  const u = uiFor(p.id, m);
  if (u.query == null) u.query = loadPref().adQueries?.[p.id] ?? defaultAdQuery(p.core.name?.v);
  return u.query;
}

export function adsSection(p, m) {
  const u = uiFor(p.id, m);
  const q = queryFor(p, m);
  const mine = adsFor(p.id);
  const here = sortAds(mine.filter((a) => a.market === m));
  const elsewhere = mine.length - here.length;
  const sig = adSignal(here);
  const market = MARKETS[m]?.name || m;
  return `<section class="p-sec" id="sec-ads">
    <h2>Ads <small>competitors' ads for this product in ${esc(market)}</small></h2>
    <div class="callout${sig.tone ? " " + sig.tone : ""}" data-ads-signal>${icon(sig.tone === "good" ? "check" : "info", 16)}<span>${esc(sig.text)}</span></div>
    <div class="panel"><div class="panel-h"><h3>Find ads running now</h3><span class="sub">opens in a new tab</span></div>
      <div class="panel-b stack">
        <label class="field ads-q"><span>Search words<small class="xs muted">ad text rarely repeats the full product name</small></span>
          <span class="ads-q-row"><input id="ads-q" type="text" maxlength="100" value="${attr(q)}" autocomplete="off" spellcheck="false"><button class="btn sm" type="button" data-ads-copy>${icon("link", 13)}Copy</button></span></label>
        <div class="ads-links">${adLibraryLinks(q, m).map((l) => `<a class="ads-link" data-ads-link="${attr(l.id)}" href="${attr(l.url)}" target="_blank" rel="noopener noreferrer">
          <b>${esc(l.label)} ${icon("ext", 11)}</b><small>${esc(l.sub)}</small>${l.prefilled ? "" : '<span class="tag">paste the search</span>'}</a>`).join("")}</div>
        <p class="xs muted">Meta and TikTok do not let other pages show their ads, so they open on their own sites. In Meta's Ad Library each ad shows the date it started running; open its details to copy the link, then save it here.</p>
      </div></div>
    ${hookdPanel(m, u, q, here.filter(isHookd))}
    ${estPanel(m, u, here)}
    <div class="panel"><div class="panel-h"><h3>Saved ads</h3><span class="sub">${here.length ? `${sig.active} running · ${sig.long} for ${LONG_RUNNING_DAYS}+ days` : "none yet"}</span>
      ${u.editing ? "" : `<button class="btn sm" type="button" data-cad-new>${icon("plus", 13)}Save an ad</button>`}</div>
      ${u.editing ? adForm(u, here.find((a) => a.id === u.editing)) : ""}
      <div class="list" data-ads-list>${here.map((a) => adRow(a, u, m)).join("") || (u.editing ? "" : '<div class="empty">No ads saved for this market yet.</div>')}</div>
      ${elsewhere ? `<div class="panel-b xs muted" style="border-top:1px solid var(--border)">${elsewhere} more saved for ${esc(MARKETS[m === "UK" ? "SE" : "UK"]?.name || "the other market")}. Switch market at the top to see them.</div>` : ""}
    </div>
    ${clonePanel(p.id, m)}
  </section>`;
}

// -- Copied ads (shopify/clone.js) ----------------------------------------
// Per product: the copies listed by the server (without images), each
// copy's images once fetched, the text being edited, Claude's runs, and the
// copy whose Remove was clicked once.
const clones = {};
const clonesFor = (pid) => (clones[pid] ||= { list: null, loading: false, error: "", detail: {}, drafts: {}, writing: {}, saving: {}, armed: null, watching: false, rerender: null });
const PENDING = ["queued", "generating", "thumbs"];
const CLONE_STATUS = { queued: "Starting…", generating: "GetHookd is making the images…", thumbs: "Saving the images…", done: "Ready to review", failed: "Stopped" };
const REVIEW = { new: "Not reviewed", approved: "Approved", rejected: "Rejected" };
const modelOf = (slug) => CLONE_MODELS.find((x) => x.slug === slug) || CLONE_MODELS[0];

// The list, once per product page while the live database is there.
function ensureClones(pid) {
  const c = clonesFor(pid);
  if (c.list || c.loading || c.error || store.live.state !== "ready") return;
  c.loading = true;
  setTimeout(() => loadClones(pid), 0);
}
async function loadClones(pid) {
  const c = clonesFor(pid);
  c.loading = true;
  try {
    const list = (await liveRead({ adClones: pid }))?.adClones;
    c.list = Array.isArray(list) ? list : [];
    c.error = "";
    // Images for the copies that are ready and not fetched yet, newest first.
    for (const x of c.list.filter((x) => x.status === "done" && !c.detail[x.id]).slice(0, 6)) {
      const d = (await liveRead({ adClone: x.id }))?.adClone;
      if (d) c.detail[x.id] = d;
    }
  } catch (err) { c.error = MCP_FIX[err?.code] || err?.message || "The copied ads could not be read."; }
  c.loading = false;
  c.rerender?.();
  if (c.list?.some((x) => PENDING.includes(x.status))) watchClones(pid);
}
// While a copy is being made, look every 6 seconds (for at most 15 minutes).
async function watchClones(pid) {
  const c = clonesFor(pid);
  if (c.watching) return;
  c.watching = true;
  for (const t0 = Date.now(); Date.now() - t0 < 15 * 60000; ) {
    await new Promise((res) => setTimeout(res, 6000));
    const before = JSON.stringify((c.list || []).map((x) => [x.id, x.status]));
    await loadClones(pid);
    if (JSON.stringify((c.list || []).map((x) => [x.id, x.status])) !== before) c.rerender?.();
    if (!c.list?.some((x) => PENDING.includes(x.status))) break;
  }
  c.watching = false;
}

// The form under a saved ad: model, format, how many images, and the most
// it can cost, before anything is spent.
function cloneForm(a, u) {
  const f = u.clone;
  const cost = cloneCost(f.model, f.variations);
  return `<div class="panel-b clone-form" data-clone-form="${attr(a.id)}">
    <p class="small"><b>Copy this ad with GetHookd.</b> GetHookd's image model makes new images in the style of this ad (a video is copied from its first frame). Claude then writes our own text for it. Nothing is published: you review it under Copied ads.</p>
    <div class="clone-opts">
      <label class="field"><span>Image model</span><select id="clone-model" data-clone-in="model">${CLONE_MODELS.map((x) => `<option value="${attr(x.slug)}"${x.slug === f.model ? " selected" : ""}>${esc(x.name)} · ${x.credits} credit${x.credits === 1 ? "" : "s"} an image</option>`).join("")}</select></label>
      <label class="field"><span>Format</span><select id="clone-aspect" data-clone-in="aspect">${Object.keys(CLONE_ASPECTS).map((k) => `<option value="${k}"${k === f.aspect ? " selected" : ""}>${k === "1:1" ? "1:1 square, feed" : k === "9:16" ? "9:16 stories and reels" : "3:4 portrait, feed"}</option>`).join("")}</select></label>
      <label class="field"><span>Images</span><select id="clone-n" data-clone-in="variations">${Array.from({ length: CLONE_MAX_VARIATIONS }, (_, i) => i + 1).map((n) => `<option value="${n}"${n === f.variations ? " selected" : ""}>${n}</option>`).join("")}</select></label>
    </div>
    ${f.error ? `<div class="callout bad" role="alert">${icon("warn", 16)}<span>${esc(f.error)}</span></div>` : ""}
    <div class="row"><button class="btn sm primary" type="button" data-clone-go="${attr(a.id)}"${f.busy ? " disabled" : ""}>${icon("spark", 13)}${f.busy ? "Starting…" : `Copy for at most ${esc(String(cost))} credits`}</button>
      <button class="btn sm ghost" type="button" data-clone-cancel>Cancel</button>
      <span class="xs muted">Charged only for images GetHookd delivers. Takes about a minute.</span></div>
  </div>`;
}

function clonePanel(pid, m) {
  const c = clonesFor(pid);
  ensureClones(pid);
  const live = store.live.state === "ready";
  const mine = (c.list || []).filter((x) => x.market === m);
  return `<div class="panel" data-clones><div class="panel-h"><h3>Copied ads</h3><span class="sub">GetHookd's images and Claude's text, for you to review</span></div>
    ${!live ? '<div class="empty">Needs the live database (n8n).</div>'
      : c.error ? `<div class="panel-b"><div class="callout bad" role="alert">${icon("warn", 16)}<span>${esc(c.error)}</span></div></div>`
      : c.list == null ? '<div class="empty">Reading the copied ads…</div>'
      : !mine.length ? '<div class="empty">None yet. Press Copy on an ad from GetHookd under Saved ads.</div>'
      : `<div class="clone-list">${mine.map((x) => cloneCard(x, c, m)).join("")}</div>`}
  </div>`;
}

function cloneCard(x, c, m) {
  const d = c.detail[x.id] || x;
  const src = d.source || {};
  const pending = PENDING.includes(x.status);
  const imgs = (d.images || []);
  const ratio = x.aspect === "9:16" ? "9 / 16" : x.aspect === "3:4" ? "3 / 4" : "1 / 1";
  const pic = (im, label, href) => `<figure class="clone-fig" style="--ar:${ratio}">${im?.data ? `<img src="data:${attr(im.mime || "image/jpeg")};base64,${attr(im.data)}" alt="${attr(label)}" loading="lazy">` : `<span class="clone-ph">${esc(pending ? "…" : "no preview")}</span>`}
    <figcaption>${esc(label)}${href ? ` · <a href="${attr(href)}" target="_blank" rel="noopener noreferrer" title="GetHookd's link works for about a day">full size ${icon("ext", 10)}</a>` : ""}</figcaption></figure>`;
  const copy = c.drafts[x.id] || d.copy || null;
  const w = c.writing[x.id];
  const cost = x.billing?.atMost ?? cloneCost(x.model, x.variations);
  return `<article class="clone-card" data-clone="${attr(x.id)}">
    <header class="clone-h">
      <div class="body"><b>${esc(src.advertiser || "GetHookd ad")}</b>${src.hook || src.title ? `<small>“${esc(src.hook || src.title)}”</small>` : ""}</div>
      <div class="side"><span class="spill clone-st-${attr(x.status)}">${pending ? '<span class="thinking"><i></i><i></i><i></i></span>' : ""}${esc(CLONE_STATUS[x.status] || x.status)}</span>
        ${x.status === "done" ? `<span class="tag clone-rv-${attr(d.review || "new")}">${esc(REVIEW[d.review || "new"])}</span>` : ""}
        <a class="btn sm ghost" href="https://app.gethookd.ai/share/ad/${attr(x.hookdAdId)}" target="_blank" rel="noopener noreferrer" title="The original ad on GetHookd">Original ${icon("ext", 11)}</a></div>
    </header>
    <p class="xs muted">${esc(modelOf(x.model).name)} · ${esc(x.aspect)} · ${x.variations} image${x.variations === 1 ? "" : "s"} · at most ${esc(String(cost))} credits · ${esc(String(x.createdAt || "").slice(0, 10))}${x.missing ? ` · ${x.missing} image${x.missing === 1 ? "" : "s"} did not arrive (not charged)` : ""}${x.remainingCredits != null ? ` · credits left ${esc(String(x.remainingCredits))}` : ""}</p>
    ${x.status === "failed" ? `<div class="callout bad" role="alert">${icon("warn", 16)}<span>${esc(x.error || "The copy stopped.")}</span>${x.cloneId ? `<button class="btn sm" type="button" data-clone-retry="${attr(x.id)}">Check again</button>` : ""}</div>` : ""}
    <div class="clone-imgs">${pic(src.image, "Original", null)}${(x.status === "done" ? imgs : imgs.length ? imgs : Array.from({ length: x.variations }, () => null)).map((im, i) => pic(im?.image || null, `Copy ${i + 1}`, im?.url)).join("")}</div>
    ${x.status === "done" ? cloneText(x, copy, w, c) : ""}
  </article>`;
}

// Our text for the copy: written by Claude from the original's words and
// the product data, edited here, saved with the review.
function cloneText(x, copy, w, c) {
  const can = store.sampleState === "ready";
  const field = (k, label, v, rows = 1, max = 300) => `<label class="field"><span>${esc(label)}</span>${rows > 1
    ? `<textarea id="clone-${attr(x.id)}-${k}" data-copy-in="${attr(x.id)}" data-k="${k}" rows="${rows}" maxlength="${max}">${esc(v || "")}</textarea>`
    : `<input id="clone-${attr(x.id)}-${k}" type="text" data-copy-in="${attr(x.id)}" data-k="${k}" maxlength="${max}" value="${attr(v || "")}">`}</label>`;
  const armed = c.armed === x.id;
  return `<div class="clone-text">
    ${!copy ? `<div class="row"><button class="btn sm primary" type="button" data-copy-write="${attr(x.id)}"${can && !w?.busy ? "" : " disabled"}>${icon("wand", 13)}${w?.busy ? "Claude is writing…" : "Write our text with Claude"}</button>
        <span class="xs muted">${can ? "Same angle as the original, new words, no claims the product data does not back." : "Claude is not available in this view."}</span></div>`
      : `<div class="grid g2">
        ${field("hook1", "Hook 1", copy.hooks?.[0], 1, 120)}${field("hook2", "Hook 2", copy.hooks?.[1], 1, 120)}
        ${field("hook3", "Hook 3", copy.hooks?.[2], 1, 120)}${field("headline", "Headline", copy.headline, 1, 60)}
        <div class="ads-wide">${field("primaryText", "Primary text", copy.primaryText, 5, 900)}</div>
        ${field("description", "Description", copy.description, 1, 60)}${field("cta", "Button", copy.cta, 1, 30)}
        <div class="ads-wide">${field("videoScript", "15-second video, one shot a line", (copy.videoScript || []).join("\n"), 5, 1200)}</div>
      </div>
      ${copy.angle || copy.changedFromOriginal ? `<p class="xs muted">${copy.angle ? `<b>Kept:</b> ${esc(copy.angle)} ` : ""}${copy.changedFromOriginal ? `<b>Changed:</b> ${esc(copy.changedFromOriginal)}` : ""}</p>` : ""}
      ${copy.checkBeforeUse?.length ? `<p class="xs muted"><b>Check before use:</b> ${esc(copy.checkBeforeUse.join(" · "))}</p>` : ""}`}
    ${w?.error ? `<div class="callout bad" role="alert">${icon("warn", 16)}<span>${esc(w.error)}</span></div>` : ""}
    <div class="row clone-actions">
      ${copy ? `<button class="btn sm" type="button" data-copy-save="${attr(x.id)}" data-rv="approved"${c.saving[x.id] ? " disabled" : ""}>${icon("check", 13)}Approve and save</button>
        <button class="btn sm ghost" type="button" data-copy-save="${attr(x.id)}" data-rv="rejected"${c.saving[x.id] ? " disabled" : ""}>Reject</button>
        <button class="btn sm ghost" type="button" data-copy-save="${attr(x.id)}" data-rv="keep"${c.saving[x.id] ? " disabled" : ""}>Save text</button>
        <button class="btn sm ghost" type="button" data-copy-write="${attr(x.id)}"${can && !w?.busy ? "" : " disabled"}>${w?.busy ? "Writing…" : "Write again"}</button>` : ""}
      <button class="btn sm ${armed ? "bb-btn-danger" : "ghost"}" type="button" data-clone-rm="${attr(x.id)}">${armed ? "Remove?" : "Remove"}</button>
    </div>
  </div>`;
}

// The form's fields back into the shape Claude wrote.
function readCopy(root, cid, base) {
  const v = (k) => root.querySelector(`[data-copy-in="${cid}"][data-k="${k}"]`)?.value ?? "";
  return { ...base, hooks: [v("hook1"), v("hook2"), v("hook3")].map((s) => s.trim()).filter(Boolean), headline: v("headline").trim(), primaryText: v("primaryText").trim(),
    description: v("description").trim(), cta: v("cta").trim(), videoScript: v("videoScript").split("\n").map((s) => s.trim()).filter(Boolean) };
}

// GetHookd: the Meta ads running now for the search words. The server finds
// them (the API key stays there) and saves each one, with its link, to the
// saved ads below; links the product already has are skipped.
function hookdPanel(m, u, q, saved = []) {
  const h = u.hookd;
  const live = store.live.state === "ready";
  const where = m === "SE" ? "Sweden" : "the UK";
  const r = h.result;
  const sum = r?.summary || {};
  const added = sum.added ?? r?.savedAds.length ?? 0;
  const known = sum.alreadySaved || 0;
  return `<div class="panel" data-hookd><div class="panel-h"><h3>GetHookd</h3><span class="sub">Meta ads running now in ${esc(where)}</span></div>
    <div class="panel-b stack">
      <div class="row"><button class="btn sm primary" type="button" data-hookd-go${live && !h.busy && hookdQuery(q).length >= 2 ? "" : " disabled"} title="GetHookd gets the product itself, without size words or what follows for/with: it matches any of the words">${icon("search", 13)}${h.busy ? "Searching…" : `Search GetHookd for “${esc(hookdQuery(q).slice(0, 40))}”`}</button>
        <span class="xs muted">${live ? `saves up to ${HOOKD_LIMIT} ads to the list below, at most 2 per advertiser · about 0.01 credit per ad` : "Needs the live database (n8n)."}</span></div>
      ${h.busy ? `<div class="row"><span class="thinking"><i></i><i></i><i></i></span><span class="small">${esc(h.status)}</span></div>` : ""}
      ${h.error ? `<div class="callout bad" role="alert">${icon("warn", 16)}<span>${esc(h.error)}</span></div>` : ""}
      ${r ? `<p class="small" data-hookd-sum>${sum.total != null ? `<b>${sum.total}</b> running ad${sum.total === 1 ? "" : "s"} in ${esc(where)} match “${esc(r.query)}”${sum.matched != null && sum.matched !== sum.total ? ` (${sum.matched} before capping each advertiser at 2)` : ""}.` : `Ads for “${esc(r.query)}”.`}
          ${!r.ads.length ? "None are running now."
            : `Found ${r.ads.length} from ${sum.brands} advertiser${sum.brands === 1 ? "" : "s"}: <b>${added} new</b> saved under Saved ads below${added ? ", marked new" : ""}${known ? `; ${known} already in the list or removed earlier` : ""}.`}
          ${sum.remainingCredits != null ? `<span class="xs muted">GetHookd credits left: ${esc(String(Math.round(sum.remainingCredits * 100) / 100))}.</span>` : ""}</p>` : ""}
      ${hookdList(r, saved, h, q)}
      <p class="xs muted">Each ad opens on GetHookd, and so does the advertiser's name: its store page there, with the store's traffic, a link to the store and its Meta Ad Library. An ad you remove from Saved ads is not saved again by a later search.</p>
    </div></div>`;
}

// The advertiser's store page on GetHookd (traffic, a link to the store, its
// Meta Ad Library), or else its brand page there; the plain name without either.
const hookdShopUrl = (shopId, brandId) => (/^\d{1,12}$/.test(String(shopId ?? "")) ? `https://app.gethookd.ai/shops/${shopId}`
  : /^\d{1,12}$/.test(String(brandId ?? "")) ? `https://app.gethookd.ai/brands/${brandId}` : null);
function storeLink(name, url) {
  return url ? `<a class="cad-store" href="${attr(url)}" target="_blank" rel="noopener noreferrer" title="Open this store on GetHookd"><b>${esc(name)}</b> ${icon("ext", 10)}</a>` : `<b>${esc(name)}</b>`;
}
// The words of a saved ad that say what it sells.
const adText = (a) => [a.angle, a.note, a.metrics?.productTitle, a.metrics?.landingPage];
// Saved ads that sell what the search words describe (all of them when the words say nothing).
const matching = (ads, q) => { const mt = adMatcher(q); return mt ? ads.filter((a) => mt.test(...adText(a))) : ads; };

// The top ads: the last search's, or else the product's saved GetHookd ads,
// best performing first, each linked to the ad and to its store on GetHookd.
// Ads whose own text never names the product are set aside: GetHookd
// matches loosely, and those stores do not sell it.
function hookdList(r, saved, h, q) {
  const savedBy = new Map(saved.map((a) => [a.url, a]));
  const all = (r ? r.ads.map((x) => { const s = savedBy.get(x.shareUrl); return { advertiser: x.advertiser, hook: x.hook || x.title, adUrl: x.shareUrl, shop: hookdShopUrl(x.shopId, x.brandId),
      perf: x.performance, perfTitle: x.performanceTitle, days: x.daysActive, text: [x.hook, x.title, x.landingPage, ...(s ? adText(s) : [])] }; })
    : saved.map((a) => ({ advertiser: a.advertiser, hook: a.angle, adUrl: a.url, shop: hookdShopUrl(a.metrics?.shopId), perf: a.metrics?.performance, perfTitle: a.metrics?.performanceTitle,
      days: a.metrics?.daysActive ?? runningDays(a), text: adText(a) })))
    .filter((x) => /^https:\/\/app\.gethookd\.ai\//.test(x.adUrl || ""))
    .sort((x, y) => (y.perf ?? -1) - (x.perf ?? -1) || (y.days ?? 0) - (x.days ?? 0));
  if (!all.length) return "";
  const mt = adMatcher(r ? r.query : q);
  const fits = mt ? all.filter((x) => mt.test(...x.text)) : all;
  const off = all.length - fits.length;
  const shown = h.showAll ? all : fits;
  const row = (x) => `<div class="li cad-row${mt && !fits.includes(x) ? " hookd-off" : ""}">
      <span class="body">${storeLink(x.advertiser || "Advertiser", x.shop)}<small>${esc(x.hook || "")}</small></span>
      <span class="side">${x.perfTitle ? `<span class="spill" title="GetHookd's performance score">${esc(x.perfTitle)}${x.perf != null ? ` ${esc(String(x.perf))}` : ""}</span>` : ""}${x.days != null ? `<span class="spill">${esc(String(x.days))} days</span>` : ""}
        <a class="btn sm" href="${attr(x.adUrl)}" target="_blank" rel="noopener noreferrer">Ad ${icon("ext", 11)}</a></span></div>`;
  return `${shown.length ? `<div class="list hookd-top" data-hookd-list>${shown.map(row).join("")}</div>`
      : `<div class="empty" data-hookd-list>None of the ${all.length} ads mention “${esc(mt.label)}”: GetHookd matched them loosely. Try other search words, such as what the product is called in ads.</div>`}
    ${off ? `<p class="xs muted" data-hookd-off>${h.showAll ? `Showing all ${all.length}, the ${off} greyed out do not mention “${esc(mt.label)}”.` : `${off} more ${off === 1 ? "ad does" : "ads do"} not mention “${esc(mt.label)}” anywhere (text, product, address), so ${off === 1 ? "that store probably does" : "those stores probably do"} not sell it.`}
      <button class="btn sm ghost" type="button" data-hookd-all>${h.showAll ? "Hide them" : "Show them"}</button></p>` : ""}`;
}
async function hookdSearch(productId, market, query, onStatus, { wait = 60000, every = 1500 } = {}) {
  const w = await liveWrite("ads.gethookd", { productId, market, query, limit: HOOKD_LIMIT });
  for (let t = 0; t < wait; t += every) {
    await new Promise((res) => setTimeout(res, every));
    const x = (await liveRead({ gethookdSearch: w.id }))?.gethookdSearch;
    if (x?.status === "done") return { query: x.query, ads: x.ads || [], savedAds: x.savedAds || [], summary: x.summary || {}, at: x.finishedAt };
    if (x?.status === "failed") throw new Error(x.error || "The search failed.");
    onStatus(x?.status === "running" ? "GetHookd is searching…" : "Waiting for the server…");
  }
  throw new Error("GetHookd did not answer within a minute. Try again.");
}

// -- What their ads bring in (core/adrevenue.js) -------------------------
// The owner's assumptions, kept per viewer.
const estPrefs = () => assumptions(loadPref().adEstimate || {});
const SLIDERS = [
  ["ctr", "Click rate", (v) => `${v.toFixed(1)}%`, "of the people who see the ad, the share who click"],
  ["cvr", "Conversion", (v) => `${v.toFixed(1)}%`, "of the visitors, the share who buy"],
  ["frequency", "Views per person", (v) => `${v.toFixed(1)}×`, "how many times each person reached saw the ad"],
  ["markup", "Price ÷ supplier price", (v) => `${v.toFixed(1)}×`, "the store's price over what it pays its supplier"],
];
const isHookd = (a) => /^https:\/\/app\.gethookd\.ai\//.test(a.url || "");
const cur = (x, c, digits = 0) => money(x, c || "GBP", { digits });

function estPanel(m, u, ads) {
  const a = estPrefs(), e = u.est, cfg = MARKETS[m] || MARKETS.UK;
  const live = store.live.state === "ready";
  const s = e.summary;
  return `<div class="panel" data-est><div class="panel-h"><h3>What their ads bring in</h3><span class="sub">an estimate from Meta's EU reach and the stores' own prices</span></div>
    <div class="panel-b stack">
      <div class="est-sliders">${SLIDERS.map(([k, label, show, hint]) => `<label class="est-sl" title="${attr(hint)}"><span>${esc(label)} <b data-est-val="${k}">${esc(show(a[k]))}</b></span>
        <input type="range" data-est-in="${k}" min="${ESTIMATE_RANGE[k].min}" max="${ESTIMATE_RANGE[k].max}" step="${ESTIMATE_RANGE[k].step}" value="${a[k]}" aria-label="${attr(label)}"></label>`).join("")}</div>
      <div class="row est-run">
        <button class="btn sm" type="button" data-est-refresh${live && !e.busy && ads.some(isHookd) ? "" : " disabled"}>${icon("spark", 13)}${e.busy ? "Updating…" : "Update numbers"}</button>
        <label class="row xs est-traffic"><input type="checkbox" data-est-traffic${e.traffic ? " checked" : ""}>Store traffic too (about 0.1 GetHookd credit per store)</label>
      </div>
      ${e.busy ? `<div class="row"><span class="thinking"><i></i><i></i><i></i></span><span class="small">${esc(e.status)}</span></div>` : ""}
      ${e.error ? `<div class="callout bad" role="alert">${icon("warn", 16)}<span>${esc(e.error)}</span></div>` : ""}
      ${s ? `<p class="xs muted" data-est-sum>Updated ${s.updated} of ${s.ads} ads and ${s.priced} prices${s.storesRead ? `, read ${s.storesRead} store${s.storesRead === 1 ? "" : "s"}' traffic (${s.usedCredits} credits)` : ""}.${s.failed?.length ? ` Not read: ${esc(s.failed[0])}` : ""}</p>` : ""}
      <div data-est-out>${estOut(ads, a, m, u.query)}</div>
      <p class="xs muted">How: Meta publishes reach only for the part of an ad shown in the EU. An ad shown in the UK and Ireland has its Irish reach scaled up by population; an ad shown only in the UK has no reach to start from. Reach × views per person × click rate × conversion = sales, × the store's price = revenue. What is left takes off the supplier price (price ÷ the slider) and card fees; ad cost uses the market's CPM of ${esc(money(cfg.cpm, cfg.currency))} per 1,000 views.</p>
    </div></div>`;
}

// Only the ads that name the product count: a store selling something else
// says nothing about what this product brings in.
function estOut(ads, a, m, q) {
  const hookd = ads.filter(isHookd);
  if (!hookd.length) return '<div class="empty">Search GetHookd above: the ads it saves carry the reach and price this needs. Ads saved by hand have none.</div>';
  const mine = matching(hookd, q), mt = adMatcher(q);
  const left = [...new Set(hookd.filter((x) => !mine.includes(x)).map((x) => x.advertiser).filter(Boolean))];
  const note = left.length ? `<p class="xs muted" data-est-left>Left out: ${esc(left.join(", "))}. Their ads do not mention “${esc(mt.label)}”, so they probably sell something else.</p>` : "";
  if (!mine.length) return `<div class="empty">None of the saved GetHookd ads mention “${esc(mt.label)}”.</div>${note}`;
  const groups = estimateByAdvertiser(mine, a, m);
  const rows = groups.map((g) => {
    const c = g.currency;
    const head = `<td>${storeLink(g.advertiser || "Advertiser", hookdShopUrl(g.shopId))}<small class="xs muted" style="display:block">${g.ads} ad${g.ads === 1 ? "" : "s"}${g.longest ? `, longest ${g.longest} days` : ""}</small></td>
      <td class="r">${g.price != null ? `${esc(cur(g.price, c, 2))}${g.priceFrom === "collection" ? '<small class="xs muted" style="display:block" title="The ad links to a collection: the price of its first product, in the store\'s own order">first in collection</small>' : ""}` : "—"}</td>`;
    const store = g.storeEstimate ? `<tr class="est-store"><td colspan="7" class="xs muted">Whole store: ${esc(int(g.storeEstimate.visits))} visits in ${esc(g.store.month || "the latest month")} → about ${esc(int(g.storeEstimate.sales))} sales${g.storeEstimate.revenue != null ? ` ≈ ${esc(cur(g.storeEstimate.revenue, c))}` : ""} a month (GetHookd's traffic estimate, every product)</td></tr>` : "";
    if (!g.estimated) {
      return `<tr data-est-row>${head}<td colspan="5" class="xs muted">${g.outsideEu ? "Shown only outside the EU: Meta publishes no reach for these ads." : "No numbers yet: press Update numbers."}</td></tr>${store}`;
    }
    const mo = g.month, ok = g.money;
    const after = ok ? mo.profitAfterAds : null;
    return `<tr data-est-row>${head}
      <td class="r"><b>${esc(int(mo.sales))}</b>${g.lowerBound ? " +" : ""}</td>
      <td class="r">${ok ? esc(cur(mo.revenue, c)) : "—"}</td>
      <td class="r">${ok ? esc(cur(mo.profitBeforeAds, c)) : "—"}</td>
      <td class="r">${ok ? esc(cur(mo.adCost, c)) : "—"}</td>
      <td class="r${after != null && after < 0 ? " neg" : ""}">${after != null ? esc(cur(after, c)) : "—"}</td></tr>${store}`;
  }).join("");
  return `<div class="tbl-wrap"><table class="tbl est-tbl"><thead><tr><th>Advertiser</th><th class="r">Price</th><th class="r">Sales a month</th><th class="r">Revenue</th><th class="r">After supplier and fees</th><th class="r">Ad cost</th><th class="r">After ads</th></tr></thead>
    <tbody>${rows}</tbody></table></div>${note}`;
}

// One saved ad's line in the list.
function estAdLine(ad, a, m) {
  if (!isHookd(ad)) return "";
  const e = estimateAd(ad, a, m);
  if (!e.ok) return e.reason === "outside-eu" ? "Shown only outside the EU: no reach from Meta" : "";
  return `≈ ${int(e.reach)}${e.lowerBound ? "+" : ""} people reached → ${int(e.month.sales)} sales${e.month.revenue != null ? ` ≈ ${cur(e.month.revenue, e.currency)}` : ""} a month`;
}

function paintEstimates(root, productId, m) {
  const a = estPrefs();
  const ads = sortAds(adsFor(productId).filter((x) => x.market === m));
  const out = root.querySelector("#sec-ads [data-est-out]");
  if (out) out.innerHTML = estOut(ads, a, m, uiFor(productId, m).query);
  for (const el of root.querySelectorAll("#sec-ads [data-est-ad]")) {
    const ad = ads.find((x) => x.id === el.dataset.estAd);
    el.textContent = ad ? estAdLine(ad, a, m) : "";
  }
}

async function estRefresh(productId, market, traffic, onStatus, { wait = 90000, every = 1500 } = {}) {
  const w = await liveWrite("ads.enrich", { productId, market, traffic });
  for (let t = 0; t < wait; t += every) {
    await new Promise((res) => setTimeout(res, every));
    const x = (await liveRead({ adStatsRun: w.id }))?.adStatsRun;
    if (x?.status === "done") return x;
    if (x?.status === "failed") throw new Error(x.error || "The update failed.");
    onStatus(x?.status === "running" ? "Reading the ads and the stores' prices…" : "Waiting for the server…");
  }
  throw new Error("The update took more than a minute and a half. Try again.");
}

function adRow(a, u, m) {
  const days = runningDays(a);
  const when = a.stillRunning === false ? '<span class="spill">stopped</span>'
    : days == null ? '<span class="spill">start date not saved</span>'
    : days >= LONG_RUNNING_DAYS ? `<span class="tag cad-long" title="Started ${attr(a.startedOn)}">${days} days</span>`
    : `<span class="spill" title="Started ${attr(a.startedOn)}">${days} day${days === 1 ? "" : "s"}</span>`;
  let host = "";
  try { host = new URL(a.url).hostname.replace(/^www\./, ""); } catch { /* shown as is */ }
  const detail = [a.angle && `“${a.angle}”`, a.note].filter(Boolean).join(" · ");
  const armed = u.armed === a.id;
  const fresh = u.hookd.fresh.includes(a.id);
  const mt = isHookd(a) ? adMatcher(u.query) : null;
  const off = mt && !mt.test(...adText(a)) ? mt.label : "";
  return `<div class="li cad-row${fresh ? " cad-fresh" : ""}" data-cad="${attr(a.id)}">
    <span class="cad-plat ads-${attr(a.platform)}" title="${attr(AD_PLATFORMS[a.platform] || a.platform)}">${esc(SHORT[a.platform] || a.platform)}</span>
    <span class="body">${storeLink(a.advertiser || host || "Ad", isHookd(a) ? hookdShopUrl(a.metrics?.shopId) : null)}<small>${esc(detail || host)}</small>${isHookd(a) ? `<small class="est-ad" data-est-ad="${attr(a.id)}">${esc(estAdLine(a, estPrefs(), m))}</small>` : ""}</span>
    <span class="side">${off ? `<span class="spill" title="Its text, product and address never name it, so the store probably sells something else">not “${esc(off)}”</span>` : ""}${fresh ? '<span class="tag cad-new" title="Added by the last GetHookd search">new</span>' : ""}${when}
      <a class="btn sm" href="${attr(a.url)}" target="_blank" rel="noopener noreferrer">Open ${icon("ext", 11)}</a>
      ${isHookd(a) ? `<button class="btn sm${u.clone.open === a.id ? " primary" : ""}" type="button" data-clone-open="${attr(a.id)}" title="Make our own version of this ad with GetHookd's images and Claude's text">${icon("spark", 12)}Copy</button>` : ""}
      <button class="btn sm ghost" type="button" data-ads-edit="${attr(a.id)}">Edit</button>
      <button class="btn sm ${armed ? "bb-btn-danger" : "ghost"}" type="button" data-ads-rm="${attr(a.id)}">${armed ? "Remove?" : "Remove"}</button></span>
  </div>${u.clone.open === a.id ? cloneForm(a, u) : ""}`;
}

function adForm(u, ad) {
  const d = { stillRunning: true, ...(ad || {}), ...u.draft };
  const auto = !d.platform || d.platformAuto;
  const err = (f) => (u.error?.field === f ? ' aria-invalid="true"' : "");
  return `<form class="panel-b ads-form" id="adsForm" novalidate>
    <div class="grid g2">
      <label class="field ads-wide"><span>Link to the ad</span><input name="url" type="text" inputmode="url" maxlength="2000" value="${attr(d.url || "")}" placeholder="https://www.facebook.com/ads/library/?id=…" autocomplete="off" spellcheck="false"${err("url")}></label>
      <label class="field"><span>Platform</span><select name="platform" data-auto="${auto ? 1 : 0}">${Object.entries(AD_PLATFORMS).map(([k, l]) => `<option value="${k}"${(d.platform || "meta") === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label class="field"><span>Advertiser</span><input name="advertiser" type="text" maxlength="200" value="${attr(d.advertiser || "")}" placeholder="the page or shop running it"${err("advertiser")}></label>
      <label class="field"><span>Started running on</span><input name="startedOn" type="date" max="${today()}" value="${attr(d.startedOn || "")}"${err("startedOn")}></label>
      <label class="field ads-check"><span>&nbsp;</span><span class="row" style="gap:8px;justify-content:flex-start"><input name="stillRunning" type="checkbox"${d.stillRunning !== false ? " checked" : ""}>Still running</span></label>
      <label class="field ads-wide"><span>Angle or hook</span><input name="angle" type="text" maxlength="300" value="${attr(d.angle || "")}" placeholder="what the ad promises, in its own words"${err("angle")}></label>
      <label class="field ads-wide"><span>Note</span><textarea name="note" rows="2" maxlength="1000" placeholder="price, offer, comments, how many versions run"${err("note")}>${esc(d.note || "")}</textarea></label>
    </div>
    <p class="ads-err" role="alert"${u.error ? "" : " hidden"}>${esc(u.error?.error || "")}</p>
    <div class="row"><button class="btn primary sm" type="submit">${ad ? "Save changes" : "Save ad"}</button><button class="btn sm ghost" type="button" data-ads-cancel>Cancel</button></div>
  </form>`;
}

const formData = (form) => {
  const f = new FormData(form);
  return {
    url: f.get("url"), platform: f.get("platform"), platformAuto: form.querySelector("[name=platform]")?.dataset.auto === "1",
    advertiser: f.get("advertiser"), startedOn: f.get("startedOn"), stillRunning: !!form.querySelector("[name=stillRunning]")?.checked,
    angle: f.get("angle"), note: f.get("note"),
  };
};

// Events, delegated from the product page's root.
export function bindAds(root, { id, rerender }) {
  const inAds = (el) => el?.closest?.("#sec-ads");
  const m = () => store.market;
  const cl = clonesFor(id);
  cl.rerender = rerender;

  root.addEventListener("input", (e) => {
    if (!inAds(e.target)) return;
    const u = uiFor(id, m());
    if (e.target.id === "ads-q") {
      u.query = e.target.value;
      const links = adLibraryLinks(u.query, m());
      root.querySelectorAll("[data-ads-link]").forEach((a) => { const l = links.find((x) => x.id === a.dataset.adsLink); if (l) a.href = l.url; });
      const pref = loadPref().adQueries || {};
      savePref({ adQueries: Object.fromEntries(Object.entries({ ...pref, [id]: u.query }).slice(-50)) });
      return;
    }
    // Edited text is kept as typed, so a repaint does not lose it.
    const cid = e.target.dataset?.copyIn;
    if (cid) { cl.drafts[cid] = readCopy(root, cid, cl.drafts[cid] || cl.detail[cid]?.copy || {}); return; }
    // A slider repaints the numbers in place, so the drag is not interrupted.
    const k = e.target.dataset?.estIn;
    if (k) {
      const a = assumptions({ ...estPrefs(), [k]: Number(e.target.value) });
      savePref({ adEstimate: a });
      const show = SLIDERS.find((s) => s[0] === k)[2];
      const val = root.querySelector(`#sec-ads [data-est-val="${k}"]`);
      if (val) val.textContent = show(a[k]);
      paintEstimates(root, id, m());
      return;
    }
    const form = e.target.closest("#adsForm");
    if (!form) return;
    if (e.target.name === "url") {
      const sel = form.querySelector("[name=platform]");
      const p = platformOf(/^https?:\/\//i.test(e.target.value) ? e.target.value : "https://" + e.target.value.trim());
      if (sel?.dataset.auto === "1" && p) sel.value = p;
    }
    u.draft = formData(form);
  });
  root.addEventListener("change", (e) => {
    if (inAds(e.target) && e.target.matches?.("[data-est-traffic]")) { uiFor(id, m()).est.traffic = e.target.checked; return; }
    const ck = inAds(e.target) && e.target.dataset?.cloneIn;
    if (ck) {
      const f = uiFor(id, m()).clone;
      f[ck] = ck === "variations" ? Number(e.target.value) : e.target.value;
      f.error = "";
      rerender();
      return;
    }
    const form = inAds(e.target) && e.target.closest("#adsForm");
    if (!form) return;
    if (e.target.name === "platform") e.target.dataset.auto = "0";
    uiFor(id, m()).draft = formData(form);
  });

  root.addEventListener("submit", async (e) => {
    if (e.target.id !== "adsForm") return;
    e.preventDefault();
    const u = uiFor(id, m());
    const input = formData(e.target);
    const res = normaliseAd({ ...input, id: u.editing !== "new" ? u.editing : undefined }, { productId: id, market: m() });
    if (res.error) {
      u.draft = input;
      u.error = res;
      const p = e.target.querySelector(".ads-err");
      p.textContent = res.error; p.hidden = false;
      e.target.querySelectorAll("[aria-invalid]").forEach((x) => x.removeAttribute("aria-invalid"));
      const bad = e.target.querySelector(`[name=${res.field}]`);
      if (bad) { bad.setAttribute("aria-invalid", "true"); bad.focus(); }
      return;
    }
    const dup = adsFor(id).find((a) => a.url === res.ad.url && a.id !== res.ad.id);
    if (dup) {
      u.error = { error: "This ad is already saved for this product.", field: "url" };
      const p = e.target.querySelector(".ads-err");
      p.textContent = u.error.error; p.hidden = false;
      return;
    }
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    u.editing = null; u.draft = {}; u.error = null;
    const saved = await saveAd(res.ad);
    window.__toast?.(saved.ok ? (saved.note || "Ad saved.") : saved.reason);
    rerender();
    if (saved.ok) burstAt(root.querySelector(`[data-cad="${res.ad.id}"]`), 60);
  });

  root.addEventListener("click", async (e) => {
    const t = e.target;
    if (!inAds(t)) return;
    const u = uiFor(id, m());
    // A click anywhere else in the section disarms a pending Remove.
    if (!t.closest("[data-ads-rm]") && u.armed) {
      u.armed = null;
      if (!t.closest("button, a, input, select, textarea, label")) { rerender(); return; }
    }
    if (t.closest("[data-hookd-all]")) { u.hookd.showAll = !u.hookd.showAll; rerender(); return; }
    if (t.closest("[data-hookd-go]")) {
      const h = u.hookd;
      h.showAll = false;
      h.busy = true; h.error = ""; h.status = "Sending the search…"; rerender();
      let fresh = [];
      try {
        h.result = await hookdSearch(id, m(), hookdQuery(u.query ?? ""), (x) => { h.status = x; rerender(); });
        fresh = h.result.savedAds;
        h.fresh = fresh.map((a) => a.id);
        addSavedAds(fresh);
        // An empty "Save an ad" form would push the new ads out of sight.
        if (fresh.length && u.editing === "new" && !String(u.draft?.url || "").trim()) { u.editing = null; u.draft = {}; u.error = null; }
      } catch (err) { h.error = MCP_FIX[err?.code] || err?.message || "The search failed."; }
      h.busy = false; rerender();
      // The ads found are listed in the panel, linked, even when all were saved before.
      const first = h.result?.ads?.length ? root.querySelector("#sec-ads [data-hookd-list]") : null;
      if (first) { first.scrollIntoView?.({ block: "nearest" }); if (fresh.length) burstAt(first, 60); }
      return;
    }
    if (t.closest("[data-est-refresh]")) {
      const est = u.est;
      est.busy = true; est.error = ""; est.status = "Sending…"; rerender();
      try {
        const run = await estRefresh(id, m(), est.traffic, (x) => { est.status = x; rerender(); });
        upsertSavedAds(run.ads || []);
        est.summary = run.summary || null;
      } catch (err) { est.error = MCP_FIX[err?.code] || err?.message || "The update failed."; }
      est.busy = false; rerender();
      return;
    }
    if (cl.armed && !t.closest("[data-clone-rm]")) cl.armed = null;
    const op = t.closest("[data-clone-open]");
    if (op) { u.clone.open = u.clone.open === op.dataset.cloneOpen ? null : op.dataset.cloneOpen; u.clone.error = ""; rerender(); return; }
    if (t.closest("[data-clone-cancel]")) { u.clone.open = null; u.clone.error = ""; rerender(); return; }
    const go = t.closest("[data-clone-go]");
    if (go) {
      const f = u.clone;
      f.busy = true; f.error = ""; rerender();
      try {
        await liveWrite("ads.clone", { productId: id, market: m(), adId: go.dataset.cloneGo, model: f.model, aspect: f.aspect, variations: f.variations });
        f.open = null;
        window.__toast?.("Copy started. It shows under Copied ads in about a minute.");
        await loadClones(id);
        watchClones(id);
      } catch (err) { f.error = MCP_FIX[err?.code] || err?.message || "The copy could not be started."; }
      f.busy = false; rerender();
      root.querySelector("#sec-ads [data-clones]")?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    const rt = t.closest("[data-clone-retry]");
    if (rt) {
      rt.disabled = true;
      try { await liveWrite("ads.clone.retry", { id: rt.dataset.cloneRetry }); await loadClones(id); watchClones(id); }
      catch (err) { window.__toast?.(MCP_FIX[err?.code] || err?.message || "Could not check again."); }
      rerender();
      return;
    }
    const wr = t.closest("[data-copy-write]");
    if (wr) {
      const cid = wr.dataset.copyWrite;
      const w = (cl.writing[cid] = { busy: true, error: "" });
      rerender();
      try {
        const copy = await runAdCopy({ id, market: cl.detail[cid]?.market || m(), source: cl.detail[cid]?.source || {} });
        cl.drafts[cid] = copy;
        // Saved straight away, so the text is not lost; the review stays as it was.
        await liveWrite("ads.clone.save", { id: cid, copy });
        if (cl.detail[cid]) cl.detail[cid].copy = copy;
        delete cl.drafts[cid];
      } catch (err) { w.error = err?.code === "not_granted" ? "Claude is not allowed for this page." : MCP_FIX[err?.code] || err?.message || "Claude could not write the text."; }
      w.busy = false; rerender();
      return;
    }
    const sv = t.closest("[data-copy-save]");
    if (sv) {
      const cid = sv.dataset.copySave, rv = sv.dataset.rv;
      const copy = readCopy(root, cid, cl.drafts[cid] || cl.detail[cid]?.copy || {});
      cl.saving[cid] = true; rerender();
      try {
        await liveWrite("ads.clone.save", { id: cid, copy, ...(rv === "keep" ? {} : { review: rv }) });
        if (cl.detail[cid]) { cl.detail[cid].copy = copy; if (rv !== "keep") cl.detail[cid].review = rv; }
        delete cl.drafts[cid];
        window.__toast?.(rv === "approved" ? "Approved and saved." : rv === "rejected" ? "Marked as rejected." : "Text saved.");
      } catch (err) { window.__toast?.(MCP_FIX[err?.code] || err?.message || "Could not save."); }
      cl.saving[cid] = false; rerender();
      return;
    }
    const crm = t.closest("[data-clone-rm]");
    if (crm) {
      const cid = crm.dataset.cloneRm;
      if (cl.armed !== cid) { cl.armed = cid; rerender(); root.querySelector(`[data-clone-rm="${cid}"]`)?.focus(); return; }
      cl.armed = null;
      try {
        await liveWrite("ads.clone.remove", { id: cid });
        cl.list = (cl.list || []).filter((x) => x.id !== cid);
        window.__toast?.("Copy removed from the page.");
      } catch (err) { window.__toast?.(MCP_FIX[err?.code] || err?.message || "Could not remove."); }
      rerender();
      return;
    }
    if (t.closest("[data-cad-new]")) { u.editing = "new"; u.draft = {}; u.error = null; rerender(); root.querySelector("#adsForm [name=url]")?.focus(); return; }
    const ed = t.closest("[data-ads-edit]");
    if (ed) { u.editing = ed.dataset.adsEdit; u.draft = {}; u.error = null; rerender(); root.querySelector("#adsForm [name=url]")?.focus(); return; }
    if (t.closest("[data-ads-cancel]")) { u.editing = null; u.draft = {}; u.error = null; rerender(); return; }
    const rm = t.closest("[data-ads-rm]");
    if (rm) {
      const adId = rm.dataset.adsRm;
      if (u.armed !== adId) { u.armed = adId; rerender(); root.querySelector(`[data-ads-rm="${adId}"]`)?.focus(); return; }
      u.armed = null;
      if (u.editing === adId) u.editing = null;
      const res = await removeAd(adId);
      window.__toast?.(res.ok ? (res.note || "Ad removed.") : res.reason);
      rerender();
      return;
    }
    if (t.closest("[data-ads-copy]")) {
      const inp = root.querySelector("#ads-q");
      try { await navigator.clipboard.writeText(inp.value); window.__toast?.("Search words copied."); }
      catch { inp.focus(); inp.select(); window.__toast?.("Selected: press Ctrl+C (⌘C on a Mac) to copy."); }
    }
  });
}

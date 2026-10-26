// The product page's Ads section: competitors' ads for the product in the
// selected market. Links to the ad libraries with the search filled in, a
// GetHookd search that saves the ads it finds, and the saved ads with how
// long each has been running.

import { store, adsFor, saveAd, removeAd, addSavedAds, upsertSavedAds, loadPref, savePref } from "../state.js";
import { esc, attr, icon, money, int } from "../ui/dom.js";
import { MARKETS } from "../core/markets.js";
import { AD_PLATFORMS, LONG_RUNNING_DAYS, adLibraryLinks, defaultAdQuery, normaliseAd, platformOf, runningDays, sortAds, adSignal } from "../core/ads.js";
import { ESTIMATE_RANGE, assumptions, estimateAd, estimateByAdvertiser } from "../core/adrevenue.js";
import { burstAt } from "../fx.js";
import { liveRead, liveWrite, MCP_FIX } from "../live.js";

// Per product and market: search words, the form being edited (null, "new"
// or an ad id), its draft, and the ad whose Remove was clicked once.
const ui = {};
// `hookd.fresh` holds the ids the last GetHookd search added, marked "new";
// `est` is the revenue estimate's "Update numbers" run.
const uiFor = (pid, m) => (ui[`${pid}|${m}`] ||= { query: null, editing: null, draft: {}, error: null, armed: null, hookd: { busy: false, status: "", error: "", result: null, fresh: [] },
  est: { busy: false, status: "", error: "", summary: null, traffic: false } });
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
      ${u.editing ? "" : `<button class="btn sm" type="button" data-ads-new>${icon("plus", 13)}Save an ad</button>`}</div>
      ${u.editing ? adForm(u, here.find((a) => a.id === u.editing)) : ""}
      <div class="list" data-ads-list>${here.map((a) => adRow(a, u, m)).join("") || (u.editing ? "" : '<div class="empty">No ads saved for this market yet.</div>')}</div>
      ${elsewhere ? `<div class="panel-b xs muted" style="border-top:1px solid var(--border)">${elsewhere} more saved for ${esc(MARKETS[m === "UK" ? "SE" : "UK"]?.name || "the other market")}. Switch market at the top to see them.</div>` : ""}
    </div>
  </section>`;
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
      <div class="row"><button class="btn sm primary" type="button" data-hookd-go${live && !h.busy && String(q).trim().length >= 2 ? "" : " disabled"}>${icon("search", 13)}${h.busy ? "Searching…" : `Search GetHookd for “${esc(String(q).trim().slice(0, 40))}”`}</button>
        <span class="xs muted">${live ? `saves up to ${HOOKD_LIMIT} ads to the list below, at most 2 per advertiser · about 0.01 credit per ad` : "Needs the live database (n8n)."}</span></div>
      ${h.busy ? `<div class="row"><span class="thinking"><i></i><i></i><i></i></span><span class="small">${esc(h.status)}</span></div>` : ""}
      ${h.error ? `<div class="callout bad" role="alert">${icon("warn", 16)}<span>${esc(h.error)}</span></div>` : ""}
      ${r ? `<p class="small" data-hookd-sum>${sum.total != null ? `<b>${sum.total}</b> running ad${sum.total === 1 ? "" : "s"} in ${esc(where)} match “${esc(r.query)}”${sum.matched != null && sum.matched !== sum.total ? ` (${sum.matched} before capping each advertiser at 2)` : ""}.` : `Ads for “${esc(r.query)}”.`}
          ${!r.ads.length ? "None are running now."
            : `Found ${r.ads.length} from ${sum.brands} advertiser${sum.brands === 1 ? "" : "s"}: <b>${added} new</b> saved under Saved ads below${added ? ", marked new" : ""}${known ? `; ${known} already in the list or removed earlier` : ""}.`}
          ${sum.remainingCredits != null ? `<span class="xs muted">GetHookd credits left: ${esc(String(Math.round(sum.remainingCredits * 100) / 100))}.</span>` : ""}</p>` : ""}
      ${hookdList(r, saved)}
      <p class="xs muted">Each ad opens on GetHookd; the advertiser's name opens the store page the ad leads to. An ad you remove from Saved ads is not saved again by a later search.</p>
    </div></div>`;
}

// A link to the store page an ad leads to (https only), or the plain name.
function storeLink(name, url) {
  return /^https:\/\//i.test(url || "") ? `<a class="ads-store" href="${attr(url)}" target="_blank" rel="noopener noreferrer" title="Open the store page this ad leads to"><b>${esc(name)}</b> ${icon("ext", 10)}</a>` : `<b>${esc(name)}</b>`;
}

// The top ads: the last search's, or else the product's saved GetHookd ads,
// best performing first, each with a link to the ad and to the store.
function hookdList(r, saved) {
  const rows = (r ? r.ads.map((x) => ({ advertiser: x.advertiser, hook: x.hook || x.title, adUrl: x.shareUrl, store: x.landingPage, perf: x.performance, perfTitle: x.performanceTitle, days: x.daysActive }))
    : saved.map((a) => ({ advertiser: a.advertiser, hook: a.angle, adUrl: a.url, store: a.metrics?.landingPage, perf: a.metrics?.performance, perfTitle: a.metrics?.performanceTitle, days: a.metrics?.daysActive ?? runningDays(a) })))
    .filter((x) => /^https:\/\/app\.gethookd\.ai\//.test(x.adUrl || ""))
    .sort((x, y) => (y.perf ?? -1) - (x.perf ?? -1) || (y.days ?? 0) - (x.days ?? 0));
  if (!rows.length) return "";
  return `<div class="list hookd-top" data-hookd-list>${rows.map((x) => `<div class="li ads-row">
      <span class="body">${storeLink(x.advertiser || "Advertiser", x.store)}<small>${esc(x.hook || "")}</small></span>
      <span class="side">${x.perfTitle ? `<span class="spill" title="GetHookd's performance score">${esc(x.perfTitle)}${x.perf != null ? ` ${esc(String(x.perf))}` : ""}</span>` : ""}${x.days != null ? `<span class="spill">${esc(String(x.days))} days</span>` : ""}
        <a class="btn sm" href="${attr(x.adUrl)}" target="_blank" rel="noopener noreferrer">Ad ${icon("ext", 11)}</a></span></div>`).join("")}</div>`;
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
      <div data-est-out>${estOut(ads, a, m)}</div>
      <p class="xs muted">How: Meta publishes reach only for the part of an ad shown in the EU. An ad shown in the UK and Ireland has its Irish reach scaled up by population; an ad shown only in the UK has no reach to start from. Reach × views per person × click rate × conversion = sales, × the store's price = revenue. What is left takes off the supplier price (price ÷ the slider) and card fees; ad cost uses the market's CPM of ${esc(money(cfg.cpm, cfg.currency))} per 1,000 views.</p>
    </div></div>`;
}

function estOut(ads, a, m) {
  const mine = ads.filter(isHookd);
  if (!mine.length) return '<div class="empty">Search GetHookd above: the ads it saves carry the reach and price this needs. Ads saved by hand have none.</div>';
  const groups = estimateByAdvertiser(mine, a, m);
  const rows = groups.map((g) => {
    const c = g.currency;
    const head = `<td>${storeLink(g.advertiser || "Advertiser", g.landingPage)}<small class="xs muted" style="display:block">${g.ads} ad${g.ads === 1 ? "" : "s"}${g.longest ? `, longest ${g.longest} days` : ""}</small></td>
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
    <tbody>${rows}</tbody></table></div>`;
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
  if (out) out.innerHTML = estOut(ads, a, m);
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
    : days >= LONG_RUNNING_DAYS ? `<span class="tag ads-long" title="Started ${attr(a.startedOn)}">${days} days</span>`
    : `<span class="spill" title="Started ${attr(a.startedOn)}">${days} day${days === 1 ? "" : "s"}</span>`;
  let host = "";
  try { host = new URL(a.url).hostname.replace(/^www\./, ""); } catch { /* shown as is */ }
  const detail = [a.angle && `“${a.angle}”`, a.note].filter(Boolean).join(" · ");
  const armed = u.armed === a.id;
  const fresh = u.hookd.fresh.includes(a.id);
  return `<div class="li ads-row${fresh ? " ads-fresh" : ""}" data-ad="${attr(a.id)}">
    <span class="ads-plat ads-${attr(a.platform)}" title="${attr(AD_PLATFORMS[a.platform] || a.platform)}">${esc(SHORT[a.platform] || a.platform)}</span>
    <span class="body">${storeLink(a.advertiser || host || "Ad", a.metrics?.landingPage)}<small>${esc(detail || host)}</small>${isHookd(a) ? `<small class="est-ad" data-est-ad="${attr(a.id)}">${esc(estAdLine(a, estPrefs(), m))}</small>` : ""}</span>
    <span class="side">${fresh ? '<span class="tag ads-new" title="Added by the last GetHookd search">new</span>' : ""}${when}
      <a class="btn sm" href="${attr(a.url)}" target="_blank" rel="noopener noreferrer">Open ${icon("ext", 11)}</a>
      <button class="btn sm ghost" type="button" data-ads-edit="${attr(a.id)}">Edit</button>
      <button class="btn sm ${armed ? "bb-btn-danger" : "ghost"}" type="button" data-ads-rm="${attr(a.id)}">${armed ? "Remove?" : "Remove"}</button></span>
  </div>`;
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
    if (saved.ok) burstAt(root.querySelector(`[data-ad="${res.ad.id}"]`), 60);
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
    if (t.closest("[data-hookd-go]")) {
      const h = u.hookd;
      h.busy = true; h.error = ""; h.status = "Sending the search…"; rerender();
      let fresh = [];
      try {
        h.result = await hookdSearch(id, m(), u.query ?? "", (x) => { h.status = x; rerender(); });
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
    if (t.closest("[data-ads-new]")) { u.editing = "new"; u.draft = {}; u.error = null; rerender(); root.querySelector("#adsForm [name=url]")?.focus(); return; }
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

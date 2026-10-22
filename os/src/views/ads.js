// The product page's Ads section: competitors' ads for the product in the
// selected market. Links to the ad libraries with the search filled in, a
// GetHookd search that saves the ads it finds, and the saved ads with how
// long each has been running.

import { store, adsFor, saveAd, removeAd, addSavedAds, loadPref, savePref } from "../state.js";
import { esc, attr, icon } from "../ui/dom.js";
import { MARKETS } from "../core/markets.js";
import { AD_PLATFORMS, LONG_RUNNING_DAYS, adLibraryLinks, defaultAdQuery, normaliseAd, platformOf, runningDays, sortAds, adSignal } from "../core/ads.js";
import { burstAt } from "../fx.js";
import { liveRead, liveWrite, MCP_FIX } from "../live.js";

// Per product and market: search words, the form being edited (null, "new"
// or an ad id), its draft, and the ad whose Remove was clicked once.
const ui = {};
const uiFor = (pid, m) => (ui[`${pid}|${m}`] ||= { query: null, editing: null, draft: {}, error: null, armed: null, hookd: { busy: false, status: "", error: "", result: null } });
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
    ${hookdPanel(m, u, q)}
    <div class="panel"><div class="panel-h"><h3>Saved ads</h3><span class="sub">${here.length ? `${sig.active} running · ${sig.long} for ${LONG_RUNNING_DAYS}+ days` : "none yet"}</span>
      ${u.editing ? "" : `<button class="btn sm" type="button" data-ads-new>${icon("plus", 13)}Save an ad</button>`}</div>
      ${u.editing ? adForm(u, here.find((a) => a.id === u.editing)) : ""}
      <div class="list">${here.map((a) => adRow(a, u)).join("") || (u.editing ? "" : '<div class="empty">No ads saved for this market yet.</div>')}</div>
      ${elsewhere ? `<div class="panel-b xs muted" style="border-top:1px solid var(--border)">${elsewhere} more saved for ${esc(MARKETS[m === "UK" ? "SE" : "UK"]?.name || "the other market")}. Switch market at the top to see them.</div>` : ""}
    </div>
  </section>`;
}

// GetHookd: the Meta ads running now for the search words. The server finds
// them (the API key stays there) and saves each one, with its link, to the
// saved ads below; links the product already has are skipped.
function hookdPanel(m, u, q) {
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
            : `Found ${r.ads.length} from ${sum.brands} advertiser${sum.brands === 1 ? "" : "s"}: <b>${added} new</b> saved below${known ? `, ${known} already in the list or removed earlier` : ""}.`}
          ${sum.remainingCredits != null ? `<span class="xs muted">GetHookd credits left: ${esc(String(Math.round(sum.remainingCredits * 100) / 100))}.</span>` : ""}</p>` : ""}
      <p class="xs muted">Each saved ad opens on GetHookd. An ad you remove from the list is not saved again by a later search.</p>
    </div></div>`;
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

function adRow(a, u) {
  const days = runningDays(a);
  const when = a.stillRunning === false ? '<span class="spill">stopped</span>'
    : days == null ? '<span class="spill">start date not saved</span>'
    : days >= LONG_RUNNING_DAYS ? `<span class="tag ads-long" title="Started ${attr(a.startedOn)}">${days} days</span>`
    : `<span class="spill" title="Started ${attr(a.startedOn)}">${days} day${days === 1 ? "" : "s"}</span>`;
  let host = "";
  try { host = new URL(a.url).hostname.replace(/^www\./, ""); } catch { /* shown as is */ }
  const detail = [a.angle && `“${a.angle}”`, a.note].filter(Boolean).join(" · ");
  const armed = u.armed === a.id;
  return `<div class="li ads-row" data-ad="${attr(a.id)}">
    <span class="ads-plat ads-${attr(a.platform)}" title="${attr(AD_PLATFORMS[a.platform] || a.platform)}">${esc(SHORT[a.platform] || a.platform)}</span>
    <span class="body"><b>${esc(a.advertiser || host || "Ad")}</b><small>${esc(detail || host)}</small></span>
    <span class="side">${when}
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
        addSavedAds(fresh);
      } catch (err) { h.error = MCP_FIX[err?.code] || err?.message || "The search failed."; }
      h.busy = false; rerender();
      if (fresh.length) burstAt(root.querySelector(`[data-ad="${fresh[0].id}"]`), 60);
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

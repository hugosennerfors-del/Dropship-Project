// Competitor ads for a product: where to find them and what the saved ones
// say. Meta and TikTok do not let other pages show their ads, so the page
// links to their ad libraries with the search filled in where the library
// takes it from the address, and keeps the ads you save there.

import { cleanUrl, newId, PRODUCT_ID } from "./weblinks.js";

export const AD_PLATFORMS = {
  meta: "Meta (Facebook, Instagram)",
  tiktok: "TikTok",
  google: "Google",
  youtube: "YouTube",
  pinterest: "Pinterest",
  other: "Other",
};

// A still-running ad this old counts as long-running.
export const LONG_RUNNING_DAYS = 30;

// The Ad Library's country filter takes ISO 3166-1 codes: the UK is GB.
const COUNTRY = { UK: "GB", SE: "SE" };
export const countryOf = (market) => COUNTRY[market] || market;

const DAY = 86400000;

// A short search for the ad libraries: the product's name without the part
// after a colon or dash and without brackets. Ad text rarely repeats a long
// product title word for word.
export function defaultAdQuery(name) {
  return String(name || "")
    .split(/:|\s[–—-]\s/)[0]
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 80);
}

// Does an ad sell what the search words describe? GetHookd matches loosely
// ("retro camera" also finds retro watches), so an ad counts only when its
// own text (hook, title, the store's product name, the address it leads
// to) has the product's head noun, the last word before "for"/"with", and
// one more of the search words when there are any. Size and marketing
// words do not count. Returns null when the search words say nothing.
const GENERIC = new Set(["a", "an", "the", "and", "or", "of", "in", "to", "on", "for", "with", "that", "which", "large", "small", "big", "mini", "capacity", "new", "best", "premium",
  "portable", "compact", "style", "styled", "set", "kit", "pack", "piece", "pcs", "multi", "multipurpose", "upgraded", "quality", "home", "homes",
  "alternative", "alternatives", "dupe", "cheap", "cheaper", "like", "similar", "top", "buy"]);
const stem = (w) => (w.length > 4 && /ies$/.test(w) ? w.slice(0, -3) + "y" : w.length > 4 && /(ch|sh|x|ss)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);
const words = (t) => String(t || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean).map(stem);
// What to send GetHookd: the product without size and marketing words or
// what follows "for"/"with" ("large capacity self-cleaning litter box for
// multi-cat homes" → "self-cleaning litter box"). GetHookd matches any of
// the words, so "large capacity" alone brings bags and storage boxes.
export function hookdQuery(query) {
  const head = String(query || "").replace(/\s+/g, " ").trim().split(/\s(?:for|with|to|that|which)\s/i)[0];
  const kept = head.split(" ").filter((w) => { const ws = words(w); return ws.length && ws.some((x) => !GENERIC.has(x)); });
  return (kept.length ? kept.join(" ") : head).slice(0, 80);
}

export function adMatcher(query) {
  const core = words(String(query || "").toLowerCase().split(/\s(?:for|with|to|that|which)\s/)[0]).filter((w) => w.length > 1 && !GENERIC.has(w));
  if (!core.length) return null;
  const head = core[core.length - 1], others = [...new Set(core.slice(0, -1))].filter((w) => w !== head);
  return {
    head, others,
    label: core.slice(-2).join(" "),
    test(...texts) {
      const have = new Set(texts.flatMap(words));
      return have.has(head) && (!others.length || others.some((w) => have.has(w)));
    },
  };
}

// Where to look. `prefilled` says whether the search arrives filled in;
// otherwise the page offers the words to copy.
export function adLibraryLinks(query, market) {
  const q = String(query || "").trim().slice(0, 100);
  const cc = countryOf(market);
  const enc = encodeURIComponent(q);
  return [
    { id: "meta", label: "Meta Ad Library", prefilled: true,
      sub: `Facebook and Instagram ads running now in ${cc === "GB" ? "the UK" : cc === "SE" ? "Sweden" : cc}`,
      url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${cc}&q=${enc}&search_type=keyword_unordered&media_type=all` },
    { id: "tiktok-library", label: "TikTok Ad Library", prefilled: false,
      sub: "ads shown in the UK and the EU; paste the search there",
      url: "https://library.tiktok.com/ads" },
    { id: "tiktok-top", label: "TikTok Top Ads", prefilled: false,
      sub: "Creative Center's best-performing ads; paste the search there",
      url: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en" },
    { id: "tiktok-search", label: "TikTok search", prefilled: true,
      sub: "videos about the product, from creators and shops",
      url: `https://www.tiktok.com/search?q=${enc}` },
  ];
}

// Which platform a link belongs to, from its address.
export function platformOf(url) {
  let h;
  try { h = new URL(url).hostname.toLowerCase(); } catch { return null; }
  const is = (d) => h === d || h.endsWith("." + d);
  if (is("facebook.com") || is("fb.com") || is("fb.watch") || is("instagram.com")) return "meta";
  if (is("tiktok.com")) return "tiktok";
  if (is("youtube.com") || is("youtu.be")) return "youtube";
  if (is("pinterest.com") || is("pin.it") || /(^|\.)pinterest\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h)) return "pinterest";
  if (is("google.com")) return "google";
  return "other";
}

const isoDay = (d) => new Date(d).toISOString().slice(0, 10);

// Check a saved ad the way the database will (intel.api_write_ads), so a
// mistake is explained next to the field instead of coming back as an error.
// Returns { ad } or { error, field }.
export function normaliseAd(input, { productId, market, today = new Date() } = {}) {
  const s = (v) => String(v ?? "").trim();
  if (!PRODUCT_ID.test(productId || "")) return { error: "This product cannot have ads saved.", field: "url" };
  if (!/^[A-Z]{2}$/.test(market || "")) return { error: "Pick a market first.", field: "url" };
  const u = cleanUrl(input.url);
  if (u.error) return { error: s(input.url) ? u.error : "Paste the link to the ad.", field: "url" };
  const url = u.url;
  const platform = input.platform && AD_PLATFORMS[input.platform] ? input.platform : platformOf(url) || "other";
  const advertiser = s(input.advertiser);
  if (advertiser.length > 200) return { error: "Keep the advertiser under 200 characters.", field: "advertiser" };
  let startedOn = s(input.startedOn);
  if (startedOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startedOn) || Number.isNaN(Date.parse(startedOn + "T00:00:00Z"))) return { error: "Use a date such as 2026-09-14.", field: "startedOn" };
    const t = Date.parse(startedOn + "T00:00:00Z");
    if (t > Date.parse(isoDay(today) + "T00:00:00Z") + DAY) return { error: "The start date cannot be in the future.", field: "startedOn" };
    if (t < Date.parse("2010-01-01T00:00:00Z")) return { error: "That start date is too far back.", field: "startedOn" };
  } else startedOn = null;
  const angle = s(input.angle);
  if (angle.length > 300) return { error: "Keep the angle under 300 characters.", field: "angle" };
  const note = s(input.note);
  if (note.length > 1000) return { error: "Keep the note under 1,000 characters.", field: "note" };
  return { ad: {
    id: input.id || newId(), productId, market, platform, url,
    advertiser: advertiser || null, startedOn, stillRunning: input.stillRunning !== false,
    angle: angle || null, note: note || null,
  } };
}

// Days a still-running ad has been running, or null when unknown or stopped.
export function runningDays(ad, today = new Date()) {
  if (!ad?.startedOn || ad.stillRunning === false) return null;
  const t = Date.parse(ad.startedOn + "T00:00:00Z");
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.parse(isoDay(today) + "T00:00:00Z") - t) / DAY));
}

// Longest-running first, then the newest saved.
export function sortAds(ads, today = new Date()) {
  return [...ads].sort((a, b) => (runningDays(b, today) ?? -1) - (runningDays(a, today) ?? -1)
    || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

// What the saved ads say about the product.
export function adSignal(ads, today = new Date()) {
  const key = (a) => s(a.advertiser).toLowerCase();
  const active = ads.filter((a) => a.stillRunning !== false);
  const long = active.filter((a) => (runningDays(a, today) ?? -1) >= LONG_RUNNING_DAYS);
  const advertisers = new Set(ads.map(key).filter(Boolean));
  const longAdvertisers = new Set(long.map(key).filter(Boolean));
  const n = (x, one, many = one + "s") => `${x} ${x === 1 ? one : many}`;
  let tone = "", text;
  if (!ads.length) {
    text = "No ads saved yet. Search the libraries above and save the ads that sell this product.";
  } else if (long.length) {
    tone = "good";
    text = `${n(long.length, "ad")} ${long.length === 1 ? "has" : "have"} been running for ${LONG_RUNNING_DAYS}+ days${longAdvertisers.size ? `, from ${n(longAdvertisers.size, "advertiser")}` : ""}. Ads that keep running for weeks usually pay for themselves, so someone is probably selling this at a profit.`;
  } else if (active.length && active.every((a) => !a.startedOn)) {
    text = "Add the date each ad started running (the library shows it) to see how long they last.";
  } else if (active.length) {
    text = `None of the ${n(active.length, "running ad")} has run for ${LONG_RUNNING_DAYS} days yet: these may be early tests, or the trend is new.`;
  } else {
    tone = "warn";
    text = "Every saved ad has stopped running. Check the libraries for newer ones before you test.";
  }
  return { total: ads.length, active: active.length, long: long.length, advertisers: advertisers.size, tone, text };
}

function s(v) { return String(v ?? "").trim(); }

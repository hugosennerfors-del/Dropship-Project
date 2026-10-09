// Competitor ads for a product: where to find them and what the saved ones
// say. Meta and TikTok do not let other pages show their ads, so the page
// links to their ad libraries with the search filled in where the library
// takes it from the address, and keeps the ads you save there.

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

const PRODUCT_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;
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

export function newAdId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Check a saved ad the way the database will (intel.api_write_ads), so a
// mistake is explained next to the field instead of coming back as an error.
// Returns { ad } or { error, field }.
export function normaliseAd(input, { productId, market, today = new Date() } = {}) {
  const s = (v) => String(v ?? "").trim();
  if (!PRODUCT_ID.test(productId || "")) return { error: "This product cannot have ads saved.", field: "url" };
  if (!/^[A-Z]{2}$/.test(market || "")) return { error: "Pick a market first.", field: "url" };
  let url = s(input.url);
  if (!url) return { error: "Paste the link to the ad.", field: "url" };
  if (/^www\.|^[a-z0-9-]+\.[a-z]{2,}\//i.test(url)) url = "https://" + url;
  if (/^http:\/\//i.test(url)) url = "https://" + url.slice(7);
  let parsed;
  try { parsed = new URL(url); } catch { return { error: "That is not a web address. Copy the ad's link from the library.", field: "url" }; }
  if (parsed.protocol !== "https:" || /\s/.test(url)) return { error: "Use the ad's https:// link.", field: "url" };
  if (url.length > 2000) return { error: "That link is too long.", field: "url" };
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
    id: input.id || newAdId(), productId, market, platform, url,
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

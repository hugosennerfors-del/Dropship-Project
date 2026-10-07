// Small rendering helpers shared by every view. Views return HTML strings;
// every value from data goes through esc() or a formatter that escapes.

import { STATUS } from "../core/provenance.js";
import { FIELD } from "../core/fields.js";
import { MARKETS } from "../core/markets.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const attr = esc;
export const isNum = (x) => typeof x === "number" && Number.isFinite(x);
export const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

const nfCache = {};
const nf = (locale, o) => (nfCache[locale + JSON.stringify(o)] ??= new Intl.NumberFormat(locale, o));

export function money(x, currency = "GBP", opts = {}) {
  if (!isNum(x)) return "—";
  const sek = currency === "SEK";
  const digits = opts.digits ?? (sek ? 0 : Math.abs(x) >= 1000 ? 0 : 2);
  const s = nf(sek ? "sv-SE" : "en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(x));
  const sign = x < 0 ? "−" : opts.sign && x > 0 ? "+" : "";
  if (currency === "GBP") return `${sign}£${s}`;
  if (currency === "USD") return `${sign}$${s}`;
  return `${sign}${s} kr`;
}
export const gbp = (x, o) => money(x, "GBP", o);
export function pct(x, d = 1) {
  if (!isNum(x)) return "—";
  return `${x < 0 ? "−" : ""}${nf("en-GB", { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(Math.abs(x))}%`;
}
export const int = (x) => (isNum(x) ? nf("en-GB", { maximumFractionDigits: 0 }).format(x) : "—");
export const num = (x, d = 1) => (isNum(x) ? nf("en-GB", { maximumFractionDigits: d }).format(x) : "—");
export const mult = (x) => (isNum(x) ? `${x.toFixed(2)}×` : "—");
export const signed = (x, d = 1) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}` : "—");

// Any registered field, formatted for its type.
export function fmt(key, value, currency = "GBP") {
  if (value == null || value === "") return "—";
  const f = FIELD[key];
  if (!f) return esc(value);
  switch (f.type) {
    case "money": return money(value, key.endsWith("USD") ? "USD" : currency);
    case "pct": return pct(value);
    case "score": return int(value);
    case "num": return key.toLowerCase().includes("roas") ? mult(value) : num(value, 2) + (f.unit ? ` ${f.unit}` : "");
    case "list": return Array.isArray(value) ? value.map(esc).join(", ") : esc(value);
    case "months": return Array.isArray(value) ? value.map((m) => MONTHS[m - 1]).join(", ") : esc(value);
    default: return esc(value);
  }
}
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── Provenance ─────────────────────────────────────────────────────────
// Each status has its own glyph so it reads without colour.
const GLYPH = {
  V: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="currentColor"/></svg>',
  E: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 1.75a4.25 4.25 0 0 1 0 8.5z" fill="currentColor"/></svg>',
  A: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.2 1.6"/></svg>',
  N: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  computed: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4h6M3 8h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
};
export function glyph(s) {
  const st = STATUS[s] ? s : s === "computed" ? "computed" : "N";
  const label = STATUS[st]?.label || "Computed by the scoring engine";
  return `<span class="pv pv-${st}" title="${attr(label)}" aria-label="${attr(label)}">${GLYPH[st]}</span>`;
}
export function statusPill(s, short = false) {
  const st = STATUS[s] ? s : "N";
  return `<span class="spill spill-${st}">${glyph(st)}${esc(short ? STATUS[st].short : STATUS[st].label)}</span>`;
}

// A value with its status glyph and a tooltip carrying note and sources.
export function valueCell(key, x, currency, evidenceIndex) {
  if (!x || typeof x !== "object" || !("s" in x)) return `<span class="val">${fmt(key, x, currency)}</span>`;
  const tip = tipOf(x, evidenceIndex);
  return `<span class="val"${tip ? ` data-tip="${attr(tip)}"` : ""}>${glyph(x.s)}<span>${fmt(key, x.v, currency)}</span></span>`;
}
export function tipOf(x, evidenceIndex) {
  const parts = [STATUS[x.s]?.label || ""];
  if (x.note) parts.push(x.note);
  const src = (x.src || []).map((id) => {
    const e = evidenceIndex?.[id];
    if (e) return `${e.source?.publisher || e.source?.title || id} (level ${e.level})`;
    if (id === "user") return "Entered by you";
    if (id.startsWith("model:")) return "Model: " + id.slice(6);
    if (id.startsWith("assumption")) return "Assumption";
    return id;
  });
  if (src.length) parts.push("Source: " + src.join("; "));
  return parts.filter(Boolean).join(" · ");
}

// ── Scores ─────────────────────────────────────────────────────────────
export function band(score) {
  if (!isNum(score)) return { key: "none", label: "No score" };
  if (score >= 70) return { key: "strong", label: "Strong" };
  if (score >= 55) return { key: "promising", label: "Promising" };
  if (score >= 40) return { key: "possible", label: "Possible" };
  return { key: "weak", label: "Weak" };
}
export function scoreChip(score, opts = {}) {
  const b = band(score);
  return `<span class="score score-${b.key}${opts.lg ? " score-lg" : ""}" title="${attr(`${opts.label || "Opportunity"} ${isNum(score) ? Math.round(score) : "—"}/100 · ${b.label}`)}">${isNum(score) ? Math.round(score) : "—"}</span>`;
}
// Horizontal 0–100 meter. `invert` for "higher is worse" scores.
export function meter(value, opts = {}) {
  const v = isNum(value) ? clamp(value) : null;
  const tone = v == null ? "none" : opts.tone || (opts.invert ? (v >= 65 ? "bad" : v >= 45 ? "warn" : "good") : (v >= 65 ? "good" : v >= 45 ? "mid" : "low"));
  return `<span class="meter meter-${tone}" role="img" aria-label="${attr(`${opts.label || ""} ${v == null ? "no data" : Math.round(v) + " of 100"}`)}"><i style="width:${v ?? 0}%"></i></span>`;
}

export const STAGE_ORDER = ["Emerging", "Early Growth", "Growing", "Peak", "Declining", "Saturated"];
export function stageChip(stage) {
  if (!stage) return "";
  const k = String(stage).toLowerCase().replace(/\s+/g, "-");
  return `<span class="stage stage-${k}"><i></i>${esc(stage)}</span>`;
}
export function gradeChip(grade, label) {
  const k = String(grade || "None").toLowerCase();
  return `<span class="grade grade-${k}" title="${attr(label + ": " + grade)}">${esc(label)} <b>${esc(grade)}</b></span>`;
}
export function severityDot(sev) {
  return `<span class="sev sev-${sev}" aria-label="${sev}"></span>`;
}

export function currencyOf(code) {
  return MARKETS[code]?.currency || "GBP";
}

// Tiny inline icon set (24px grid, stroke).
const ICONS = {
  radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12 18 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>',
  trend: '<path d="M3.5 17 9 11.5l3.5 3.5L20.5 7"/><path d="M15 7h5.5v5.5"/>',
  niche: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M17 13.5v7M13.5 17h7"/>',
  compare: '<path d="M8 4v16M16 4v16"/><path d="M4 8h4M16 8h4M4 14h4M16 14h4"/>',
  chat: '<path d="M4.5 5.5h15v10h-8l-4.5 3.5v-3.5h-2.5z"/>',
  data: '<ellipse cx="12" cy="6" rx="7.5" ry="2.75"/><path d="M4.5 6v6c0 1.5 3.4 2.75 7.5 2.75S19.5 13.5 19.5 12V6"/><path d="M4.5 12v6c0 1.5 3.4 2.75 7.5 2.75S19.5 19.5 19.5 18v-6"/>',
  inbox: '<path d="M3.5 13.5 6 5h12l2.5 8.5v5h-17z"/><path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5"/>',
  store: '<path d="M4 9.5 5.5 4.5h13L20 9.5"/><path d="M4 9.5h16v1a3 3 0 0 1-5.33 1.9A3 3 0 0 1 12 13.5a3 3 0 0 1-2.67-1.1A3 3 0 0 1 4 10.5z"/><path d="M5.5 13v6.5h13V13"/>',
  cash: '<rect x="3" y="6.5" width="18" height="11" rx="1.5"/><circle cx="12" cy="12" r="2.5"/>',
  flask: '<path d="M9.5 3.5h5M10.5 3.5v6L5 18.5a1.5 1.5 0 0 0 1.3 2.25h11.4A1.5 1.5 0 0 0 19 18.5l-5.5-9v-6"/>',
  shield: '<path d="M12 3.5 19 6v5.5c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  bell: '<path d="M12 3.5a5.5 5.5 0 0 0-5.5 5.5c0 4-1.5 5.5-2 6h15c-.5-.5-2-2-2-6A5.5 5.5 0 0 0 12 3.5z"/><path d="M10 19.5a2 2 0 0 0 4 0"/>',
  spark: '<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.5l-1.8-5.9-5.7-1.8L10.2 9z"/>',
  box: '<path d="M3.5 7.5 12 3.5l8.5 4v9l-8.5 4-8.5-4z"/><path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  ext: '<path d="M13.5 4.5h6v6M19.5 4.5 11 13"/><path d="M18 14v5.5H4.5V6H10"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  filter: '<path d="M4 5.5h16l-6 7.5v5.5l-4 1.5v-7z"/>',
  sort: '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/>',
  star: '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
  send: '<path d="M4.5 12 20 4.5 15.5 20l-3.5-6.5z"/><path d="m12 13.5 8-9"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5"/><path d="M4.5 19.5h15"/>',
  upload: '<path d="M12 15.5v-11M7 9l5-5 5 5"/><path d="M4.5 19.5h15"/>',
  warn: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17v.1"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2 18 18M6 18l1.8-1.8M16.2 7.8 18 6"/>',
  wand: '<path d="m4 20 11-11M14 4v3M12.5 5.5h3M19 9v3M17.5 10.5h3M18 3.5v1.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
export function icon(name, size = 16) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

// Inline markdown for AI text: **bold**, `code`, line breaks, bullet lists,
// and [[product-id]] tokens that become product links.
export function md(text, linkFor) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  let list = null;
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[\[([a-z0-9-]+)\]\]/g, (m, id) => (linkFor ? linkFor(id) : esc(id)));
  for (const raw of lines) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      const ordered = /^\s*\d/.test(line);
      if (!list || list.ordered !== ordered) { if (list) out.push(list.ordered ? "</ol>" : "</ul>"); list = { ordered }; out.push(ordered ? "<ol>" : "<ul>"); }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    if (list) { out.push(list.ordered ? "</ol>" : "</ul>"); list = null; }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) { out.push(`<h4>${inline(h[1])}</h4>`); continue; }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(list.ordered ? "</ol>" : "</ul>");
  return out.join("");
}

export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

export const dateLabel = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(+d) ? esc(iso) : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);
};

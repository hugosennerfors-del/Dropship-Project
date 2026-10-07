// Natural-language questions → database queries, without a model.
//
// The chat uses Claude when it is available, but the page never depends on
// it: this parser turns English or Swedish questions into the same query
// spec the filters use, and resolves follow-ups ("which one is the safest?",
// "why is number 3 better than number 1?") against the previous answer.

import { FIELDS, FIELD } from "./fields.js";
import { MARKETS } from "./markets.js";

// Comparison words, longest first so "at least" wins over "least".
const OPS = [
  [">=", ["greater than or equal to", "at least", "minimum of", "minimum", "min.", "min", "no less than", "minst", "lägst", "från", ">=", "≥"]],
  ["<=", ["less than or equal to", "at most", "maximum of", "maximum", "max.", "max", "no more than", "up to", "högst", "upp till", "<=", "≤"]],
  [">", ["greater than", "more than", "higher than", "above", "over", "exceeding", "mer än", "högre än", "över", "above", ">"]],
  ["<", ["less than", "lower than", "below", "under", "cheaper than", "mindre än", "lägre än", "billigare än", "under", "<"]],
  ["=", ["equal to", "equals", "exactly", "lika med", "="]],
];
const OP_WORDS = OPS.flatMap(([op, ws]) => ws.map((w) => [w, op])).sort((a, b) => b[0].length - a[0].length);

// Words that describe a level rather than a number.
const ADJECTIVES = [
  { re: /\b(high|good|strong|great|hög|höga|bra)\s+(gross\s+)?margins?\b|\bhögmarginal|\bhög marginal/, f: ["margin", ">=", 55], label: "high margin" },
  { re: /\b(low|thin|låg)\s+margins?\b/, f: ["margin", "<", 45], label: "low margin" },
  { re: /\b(low|little|weak|limited|låg|lite)\s+(competition|konkurrens)\b|\bnot (very )?competitive\b/, f: ["competition", "<=", 45], label: "low competition" },
  { re: /\b(high|strong|hög)\s+(competition|konkurrens)\b|\bcrowded\b/, f: ["competition", ">=", 70], label: "high competition" },
  { re: /\b(high|strong|big|stor|hög)\s+(demand|efterfrågan)\b/, f: ["demand", ">=", 65], label: "high demand" },
  { re: /\b(trending|trendande|growing fast|rising)\b/, f: ["trend", ">=", 65], label: "trending" },
  { re: /\b(brandable|brand potential|long[- ]term brand|strong brand|varumärke)\b/, f: ["brandability", ">=", 65], label: "brandable" },
  { re: /\b(viral|viralt)\b/, f: ["viral", ">=", 70], label: "viral" },
  { re: /\btik\s?tok\b(?!\s*shop)/, f: ["tiktok", ">=", 70], label: "good for TikTok" },
  { re: /\b(meta|facebook|fb)( ads| annonser)?\b/, f: ["meta", ">=", 70], label: "good for Meta ads" },
  { re: /\b(organic|organiskt|seo)\b/, f: ["organic", ">=", 65], label: "organic potential" },
  { re: /\b(repeat purchases?|recurring|återkommande köp|återköp|consumable|förbrukningsvara)\b/, f: ["repeat", ">=", 50], label: "repeat purchase" },
  { re: /\b(subscription|prenumeration)\b/, f: ["subscription", ">=", 50], label: "subscription potential" },
  { re: /\b(giftable|gift|gifts|present|presenter)\b/, f: ["giftability", ">=", 70], label: "giftable" },
  { re: /\b(low risk|safe|safer|säker|låg risk)\b/, f: ["risk", "<=", 40], label: "low risk" },
  { re: /\b(profitable|lönsam|lönsamma|makes money)\b/, f: ["profit", ">", 0], label: "profitable at the estimated CAC" },
  { re: /\b(light(weight)?|easy to ship|lätta?|lätt att skicka)\b/, f: ["weight", "<=", 1], label: "light" },
  { re: /\b(all[- ]year|year[- ]round|not seasonal|evergreen|året runt)\b/, f: ["seasonalityRisk", "<=", 35], label: "sells all year" },
  { re: /\b(proven|validated|bevisad|commercial evidence)\b/, f: ["validation", "in", ["Strong", "Medium"]], label: "with commercial evidence" },
];
const STAGE_WORDS = [
  { re: /\b(emerging|nya trender|framväxande|tidiga?)\b/, stages: ["Emerging"], label: "emerging" },
  { re: /\bearly( growth| trends?| stage)?\b|\btidig fas\b/, stages: ["Emerging", "Early Growth"], label: "early stage" },
  { re: /\b(growing|växande)\b/, stages: ["Early Growth", "Growing"], label: "growing" },
  { re: /\b(peak|toppen)\b/, stages: ["Peak"], label: "at peak" },
  { re: /\b(declining|falling|minskande)\b/, stages: ["Declining"], label: "declining" },
  { re: /\b(saturated|mättad|mättade)\b/, stages: ["Saturated"], label: "saturated" },
];
const SORT_WORDS = [
  { re: /\b(highest|best|top|bäst|högst)\s+(gross\s+)?margins?\b|\bbästa marginal/, sort: "margin" },
  { re: /\b(highest|most|best|mest|högst)\s+(profit|vinst)/, sort: "profit" },
  { re: /\b(fastest[- ]growing|snabbast växande|growing fastest)\b/, sort: "growing" },
  { re: /\b(lowest|least)\s+competition\b|\blägst konkurrens/, sort: "competition" },
  { re: /\b(highest|most|störst)\s+demand\b|\bhögst efterfrågan/, sort: "demand" },
  { re: /\bmost viral\b|\bmest viral/, sort: "viral" },
  { re: /\bbest brand|\bbrand potential|\bbästa varumärke/, sort: "brand" },
  { re: /\b(safest|lowest risk|least risky|säkrast|lägst risk)\b/, sort: "safest" },
  { re: /\b(beginners?|nybörjare|easiest|easy to start|lättast)\b/, sort: "beginners" },
  { re: /\b(best evidenced|most proven|strongest evidence|best data|mest bevisad)\b/, sort: "evidence" },
  { re: /\b(most confident|highest confidence)\b/, sort: "confidence" },
];
const MARKET_WORDS = [
  { re: /\b(uk|u\.k\.|britain|british|england|united kingdom|storbritannien|brittisk[a]?)\b/, code: "UK" },
  { re: /\b(sweden|swedish|sverige|svensk[a]?)\b/, code: "SE" },
];
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  första: 1, andra: 2, tredje: 3, fjärde: 4, femte: 5, sjätte: 6, sjunde: 7, åttonde: 8, nionde: 9, tionde: 10, last: -1, sista: -1 };
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  en: 1, ett: 1, två: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7, åtta: 8, nio: 9, tio: 10 };

// Field words, longest first. Built once from the registry, plus a few
// phrases that only make sense in questions.
const EXTRA_ALIASES = [
  ["cost", "landedCost"], ["costs", "landedCost"], ["kostar", "landedCost"], ["kostnad", "landedCost"], ["buy for", "landedCost"],
  ["sell for", "price"], ["sold for", "price"], ["sells for", "price"], ["säljas för", "price"], ["säljs för", "price"], ["priced", "price"],
  ["profit per order", "profit"], ["vinst per order", "profit"], ["margin", "margin"], ["competition score", "competition"],
  ["trend score", "trend"], ["brand score", "brandability"], ["opportunity score", "opportunity"], ["risk score", "risk"],
  ["startup", "startupCost"], ["start-up", "startupCost"], ["confidence", "confidence"],
];
const FIELD_WORDS = [
  ...FIELDS.filter((f) => f.query).flatMap((f) => [f.key.toLowerCase(), f.label.toLowerCase(), ...f.aliases].map((w) => [w, f.key])),
  ...EXTRA_ALIASES,
].filter(([w]) => w.length >= 2).sort((a, b) => b[0].length - a[0].length);

const MONEY_RE = /(£|\$|€|sek\b|kr\b|gbp\b|pund)?\s*(\d[\d\s,.]*\d|\d)\s*(k\b|tusen\b|%|£|kr\b|kronor\b|sek\b|gbp\b|pund\b|pounds?\b)?/i;

function parseNumber(raw) {
  let s = String(raw).replace(/\s/g, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// One number with its unit, from the start of `s`.
function readValue(s) {
  const m = s.match(new RegExp("^\\s*" + MONEY_RE.source, "i"));
  if (!m) return null;
  let n = parseNumber(m[2]);
  if (n == null) return null;
  const pre = (m[1] || "").toLowerCase(), post = (m[3] || "").toLowerCase();
  if (post === "k" || post === "tusen") n *= 1000;
  const currency = pre === "£" || /gbp|pund|pound/.test(pre + post) || post === "£" ? "GBP"
    : /kr|sek|kronor/.test(pre + post) ? "SEK" : pre === "$" ? "USD" : null;
  return { n, currency, percent: post === "%", length: m[0].length };
}

const norm = (t) => " " + String(t || "").toLowerCase().replace(/[“”"]/g, " ").replace(/\s+/g, " ") + " ";

// Convert a money threshold to the market's currency.
function toMarket(n, currency, market) {
  const cfg = MARKETS[market];
  if (!currency || currency === cfg.currency) return n;
  if (currency === "GBP") return n / cfg.fxToGBP;
  if (currency === "SEK") return (n * MARKETS.SE.fxToGBP) / cfg.fxToGBP;
  if (currency === "USD") return (n * 0.78) / cfg.fxToGBP;
  return n;
}

export function parseQuestion(text, ctx = {}) {
  const t = norm(text);
  const out = { filters: [], sort: null, limit: null, market: null, budgetGBP: null, within: null,
    refs: [], productIds: [], intent: "query", labels: [], text };

  for (const m of MARKET_WORDS) if (m.re.test(t)) { out.market = m.code; break; }
  const market = out.market || ctx.market || "UK";

  // Budget: "£2,000 budget", "with £2000", "budget of 1000".
  const bud = t.match(/(?:budget(?: of)?|with|med|för|have|har)\s+(£|\$)?\s*(\d[\d,.\s]*\d|\d)\s*(k|tusen)?\s*(£|kr|kronor|sek|pounds?|pund)?/i)
    || t.match(/(£|\$)?\s*(\d[\d,.\s]*\d|\d)\s*(k|tusen)?\s*(£|kr|kronor|sek|pounds?|pund)?\s+(?:budget|i budget|to spend|att spendera)/i);
  if (bud && (bud[1] || bud[4] || /budget|spend|spendera/.test(bud[0]))) {
    let n = parseNumber(bud[2]);
    if (n != null) {
      if (bud[3]) n *= 1000;
      const cur = /kr|sek|kronor/.test(bud[4] || "") ? "SEK" : "GBP";
      out.budgetGBP = cur === "SEK" ? n * MARKETS.SE.fxToGBP : n;
      out.labels.push(`launch budget ${cur === "SEK" ? n.toLocaleString("sv-SE") + " kr" : "£" + n.toLocaleString("en-GB")}`);
    }
  }

  // Numeric comparisons. Scan for operator words; the field is the nearest
  // field word before the operator (or after it: "under £30 cost").
  const consumed = [];
  for (const [w, op] of OP_WORDS) {
    let from = 0;
    const needle = /^[a-zåäö]/i.test(w) ? new RegExp(`(^|[^a-zåäö])${escapeRe(w)}(?=[^a-zåäö]|$)`, "gi") : new RegExp(escapeRe(w), "g");
    let m;
    while ((m = needle.exec(t))) {
      const start = m.index + (m[1] ? m[1].length : 0);
      const end = start + w.length;
      if (consumed.some(([a, b]) => start < b && end > a)) continue;
      const val = readValue(t.slice(end));
      if (!val) continue;
      // "between X and Y"
      const before = t.slice(Math.max(0, start - 60), start);
      let field = lastFieldIn(before);
      if (!field) field = firstFieldIn(t.slice(end + val.length, end + val.length + 30));
      if (!field) field = val.percent ? "margin" : (val.currency ? "price" : null);
      if (field && val.currency && FIELD[field]?.type !== "money") field = "price";
      if (field && val.percent && !["pct", "score"].includes(FIELD[field]?.type)) field = "margin";
      if (!field) continue;
      if (field === "budget") continue;
      const f = FIELD[field];
      let n = val.n;
      if (f?.type === "money") n = round2(toMarket(n, val.currency, market));
      out.filters.push({ field, op, value: n });
      out.labels.push(`${FIELD[field]?.label || field} ${opWord(op)} ${f?.type === "money" ? moneyLabel(n, market) : f?.type === "pct" ? n + "%" : n}`);
      consumed.push([start, end + val.length]);
      from = end;
    }
  }
  const between = t.match(/(?:between|mellan)\s+(£)?(\d[\d,.]*)\s*(?:and|och|-|–)\s*(£)?(\d[\d,.]*)/);
  if (between) {
    const field = lastFieldIn(t.slice(0, between.index)) || "price";
    const a = parseNumber(between[2]), b = parseNumber(between[4]);
    if (a != null && b != null) {
      const cur = between[1] || between[3] ? "GBP" : null;
      const conv = (x) => (FIELD[field]?.type === "money" ? round2(toMarket(x, cur, market)) : x);
      out.filters = out.filters.filter((f) => f.field !== field);
      out.filters.push({ field, op: "between", value: [conv(a), conv(b)] });
      out.labels.push(`${FIELD[field]?.label || field} between ${a} and ${b}`);
    }
  }

  // Levels and stages.
  const has = (field) => out.filters.some((f) => f.field === field);
  for (const a of ADJECTIVES) {
    if (a.re.test(t) && !has(a.f[0])) {
      out.filters.push({ field: a.f[0], op: a.f[1], value: a.f[2] });
      out.labels.push(a.label);
    }
  }
  const stages = new Set();
  for (const s of STAGE_WORDS) if (s.re.test(t)) { s.stages.forEach((x) => stages.add(x)); out.labels.push(s.label); }
  if (stages.size) out.filters.push({ field: "stage", op: "in", value: [...stages] });

  // Categories, niches and product names that appear in the question.
  if (ctx.rows?.length) {
    const cats = new Map();
    for (const r of ctx.rows) for (const k of ["category", "subcategory", "niche"]) {
      const v = String(r[k] || "").toLowerCase();
      if (v.length >= 3) cats.set(v, k);
    }
    for (const [v, k] of cats) {
      const words = v.split(/[^a-zåäö]+/).filter((w) => w.length >= 3 && !STOP.has(w));
      if (t.includes(" " + v + " ") || words.some((w) => new RegExp(`\\b${escapeRe(singular(w))}s?\\b`).test(t))) {
        if (!out.filters.some((f) => f.field === "text")) {
          const word = t.includes(" " + v + " ") ? v : words.find((w) => new RegExp(`\\b${escapeRe(singular(w))}s?\\b`).test(t));
          out.filters.push({ field: "text", op: "contains", value: singular(word) });
          out.labels.push(`about “${singular(word)}”`);
        }
        break;
      }
    }
    for (const r of ctx.rows) {
      const name = String(r.name || "").toLowerCase();
      const key = name.split(/[:(,]/)[0].trim();
      if (key.length >= 5 && t.includes(key)) out.productIds.push(r.id);
      else if (t.includes(" " + r.id.replace(/-/g, " ") + " ") || t.includes(r.id)) out.productIds.push(r.id);
    }
  }

  for (const s of SORT_WORDS) if (s.re.test(t)) { out.sort = s.sort; break; }
  const top = t.match(/\b(?:top|best|bästa|topp)\s+(\d+|[a-zåäö]+)\b/) || t.match(/\b(\d+|[a-zåäö]+)\s+(?:best|bästa|products|produkter|ideas|idéer)\b/);
  if (top) {
    const n = /^\d+$/.test(top[1]) ? Number(top[1]) : NUMBER_WORDS[top[1]];
    if (n && n <= 50) out.limit = n;
  }

  // References to the previous answer.
  const refRe = /(?:number|nr\.?|nummer|#|no\.)\s*(\d+)|\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|första|andra|tredje|fjärde|femte|sjätte|sjunde|åttonde|nionde|tionde|sista)\b(?:\s+(?:one|product|produkten|en|ett))?/g;
  let rm;
  while ((rm = refRe.exec(t))) {
    const n = rm[1] ? Number(rm[1]) : ORDINALS[rm[2]];
    if (n) out.refs.push(n);
  }
  const anaphora = /\b(these|those|them|which one|which of|of them|this one|that one|it|dessa|de här|dem|vilken|vilka av|den här|av dessa)\b/.test(t);
  const last = ctx.lastResultIds || [];
  if (last.length && (anaphora || out.refs.length)) out.within = last.slice();
  out.refIds = out.refs.map((n) => (n === -1 ? last[last.length - 1] : last[n - 1])).filter(Boolean);

  // Intent.
  if (/\bwhy\b|\bvarför\b/.test(t) && (out.refIds.length >= 2 || out.productIds.length >= 2) && /\b(better|worse|bättre|sämre|beat|over|före)\b/.test(t)) out.intent = "why";
  else if (/\bcompare|jämför|versus|\bvs\.?\b/.test(t)) out.intent = "compare";
  else if (/unit economics|economics|enhetsekonomi|break[- ]even|kalkyl|räkna|numbers|siffrorna|margins? and profit|lönsamhet/.test(t)) out.intent = "economics";
  else if (out.budgetGBP != null && (/\b(choose|pick|välja|välj|go with|recommend|rekommendera|start)\b/.test(t) || out.within)) out.intent = "budget";
  else if (/\b(which one|which of|vilken|which product)\b/.test(t) && out.within) out.intent = "pick";
  else if (/\b(why|varför|explain|förklara|tell me about|berätta om|what about|hur är)\b/.test(t) && (out.productIds.length === 1 || out.refIds.length === 1)) out.intent = "product";
  else if (/^\s*(help|hjälp|what can you do|vad kan du)\b/.test(t.trim())) out.intent = "help";
  if (out.intent === "pick" && !out.sort) out.sort = /\b(safe|säker)/.test(t) ? "safest" : "evidence";
  if (out.intent === "budget" && !out.sort) out.sort = "evidence";
  return out;
}

const STOP = new Set(["home", "with", "products", "product", "kits", "and", "for", "the", "control", "accessories", "gadgets", "care", "gear", "at", "staying", "personal", "smart", "connection", "family"]);
const singular = (w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
function lastFieldIn(s) {
  let best = null, at = -1;
  for (const [w, key] of FIELD_WORDS) {
    const re = new RegExp(`(^|[^a-zåäö])${escapeRe(w)}(?=[^a-zåäö]|$)`, "gi");
    let m;
    while ((m = re.exec(s))) {
      const end = m.index + m[0].length;
      if (end > at || (end === at && w.length > (best?.[0].length || 0))) { at = end; best = [w, key]; }
    }
  }
  if (!best) return null;
  // Only accept a field word close to the operator.
  return s.length - at <= 24 ? best[1] : null;
}
function firstFieldIn(s) {
  let best = null, at = Infinity;
  for (const [w, key] of FIELD_WORDS) {
    const m = new RegExp(`(^|[^a-zåäö])${escapeRe(w)}(?=[^a-zåäö]|$)`, "i").exec(s);
    if (m && m.index < at) { at = m.index; best = key; }
  }
  return at <= 12 ? best : null;
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const round2 = (x) => Math.round(x * 100) / 100;
export function opWord(op) {
  return { ">": "over", ">=": "at least", "<": "under", "<=": "at most", "=": "=", "!=": "not", in: "in", between: "between", contains: "contains" }[op] || op;
}
function moneyLabel(n, market) {
  return MARKETS[market].currency === "SEK" ? `${Math.round(n)} kr` : `£${n}`;
}

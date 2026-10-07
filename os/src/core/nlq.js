// Natural-language questions → database queries, without a model.
//
// The chat uses Claude when it is available, but the page never depends on
// it: this parser turns English or Swedish questions into the same query
// spec the filters use, and resolves follow-ups ("which one is the safest?",
// "why is number 3 better than number 1?") against the previous answer.
//
// All matching runs on folded text (lower case, diacritics removed), so
// "låg konkurrens" is matched as "lag konkurrens". JavaScript's \b does not
// treat å, ä and ö as letters; folding sidesteps that.

import { FIELDS, FIELD } from "./fields.js";
import { MARKETS } from "./markets.js";

export const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Comparison words, longest first so "at least" wins over "least".
const OPS = [
  [">=", ["greater than or equal to", "at least", "minimum of", "minimum", "min.", "min", "no less than", "minst", "fran", ">=", "≥"]],
  ["<=", ["less than or equal to", "at most", "maximum of", "maximum", "max.", "max", "no more than", "up to", "hogst", "upp till", "<=", "≤"]],
  [">", ["greater than", "more than", "higher than", "above", "over", "exceeding", "mer an", "hogre an", "over"]],
  ["<", ["less than", "lower than", "below", "under", "cheaper than", "mindre an", "lagre an", "billigare an"]],
  ["=", ["equal to", "equals", "exactly", "lika med", "="]],
];
const OP_WORDS = [...OPS.flatMap(([op, ws]) => ws.map((w) => [w, op])), [">", ">"], ["<", "<"]].sort((a, b) => b[0].length - a[0].length);

// Levels: words that describe a level rather than a number. `relaxed` is
// used when the question softens it ("relatively low competition").
const ADJECTIVES = [
  { re: /\b(high|good|strong|great|hog|hoga|bra|stark)\s+(gross\s+|brutto)?(margins?|marginal(er)?)\b|\bhogmarginal/, f: ["margin", ">=", 55], relaxed: 45, label: "high margin" },
  { re: /\b(low|thin|lag|laga|tunn)\s+(margins?|marginal(er)?)\b/, f: ["margin", "<", 45], label: "low margin" },
  { re: /\b(low|little|weak|limited|lag|lite|svag)\s+(competition|konkurrens)\b|\bnot (very )?competitive\b|\bfa konkurrenter\b/, f: ["competition", "<=", 45], relaxed: 55, label: "low competition" },
  { re: /\b(high|strong|hog|stark)\s+(competition|konkurrens)\b|\bcrowded\b|\bmattade?\s+marknad/, f: ["competition", ">=", 70], label: "high competition" },
  { re: /\b(high|strong|big|stor|hog)\s+(demand|efterfragan)\b/, f: ["demand", ">=", 65], relaxed: 55, label: "high demand" },
  { re: /\b(trending|trendande|trendiga?|hot right now|heta)\b/, f: ["trend", ">=", 65], label: "trending" },
  { re: /\b(brandable|brand potential|long[- ]term brand|strong brand|real brand|varumarke|varumarken|langsiktig(t|a)? (brand|varumarke)|brand)\b/, f: ["brandability", ">=", 65], label: "brandable" },
  { re: /\b(viral|viralt|virala)\b/, f: ["viral", ">=", 70], label: "viral" },
  { re: /\btik\s?tok\b(?!\s*shop)/, f: ["tiktok", ">=", 70], label: "good for TikTok", platform: true },
  { re: /\b(instagram|reels|insta)\b/, f: ["instagram", ">=", 70], label: "good for Instagram", platform: true },
  { re: /\b(meta|facebook|fb)( ads| annonser)?\b/, f: ["meta", ">=", 70], label: "good for Meta ads", platform: true },
  { re: /\b(google ads|google shopping|search ads)\b/, f: ["google", ">=", 65], label: "good for Google ads", platform: true },
  { re: /\b(organic|organiskt|organisk|seo)\b/, f: ["organic", ">=", 65], label: "organic potential", platform: true },
  { re: /\b(easy to (market|advertise|sell)|latta? att (marknadsfora|annonsera|salja)|marknadsforingsbara?)\b/, f: ["adPotential", ">=", 65], label: "easy to market" },
  { re: /\b(repeat purchases?|repeat buying|recurring|aterkommande kop|aterkop|consumables?|forbrukningsvar(a|or))\b/, f: ["repeat", ">=", 50], label: "repeat purchase" },
  { re: /\b(subscription|prenumeration|abonnemang)\b/, f: ["subscription", ">=", 50], label: "subscription potential" },
  { re: /\b(upsells?|bundles?|merforsaljning|paketering|paket)\b/, f: ["bundle", ">=", 65], label: "upsell and bundle potential" },
  { re: /\b(giftable|gifts?|present|presenter|julklapp(ar)?)\b/, f: ["giftability", ">=", 70], label: "giftable" },
  { re: /\b(low risk|safe|safer|saker|sakra|lag risk)\b/, f: ["risk", "<=", 40], label: "low risk" },
  { re: /\b(profitable|lonsam|lonsamma|makes money)\b/, f: ["profit", ">", 0], label: "profitable at the estimated CAC" },
  { re: /\b(lightweight|light products?|easy to ship|latta? att skicka|lag vikt)\b/, f: ["weight", "<=", 1], label: "light" },
  { re: /\b(all[- ]year|year[- ]round|not seasonal|evergreen|aret runt)\b/, f: ["seasonalityRisk", "<=", 35], label: "sells all year" },
  { re: /\b(proven|validated|bevisad|bevisade|commercial evidence)\b/, f: ["validation", "in", ["Strong", "Medium"]], label: "with commercial evidence" },
  { re: /\b(high aov|hog aov|hogt ordervarde|high order value|high[- ]ticket|hog snittorder)\b/, f: ["aov", ">=", 50], money: true, label: "high order value" },
  { re: /\b(nischade?|nischprodukter|niche products?|nichey|specialised|specialized)\b/, f: ["competition", "<=", 55], label: "niche (specialised, less contested)" },
];
const STAGE_WORDS = [
  { re: /\b(emerging|framvaxande|nya trender|brand new)\b/, stages: ["Emerging"], label: "emerging" },
  { re: /\b(early( growth| trends?| stage)?|tidiga?|tidigt|tidig fas)\b/, stages: ["Emerging", "Early Growth"], label: "early stage" },
  { re: /\b(growing|vaxande)\b/, stages: ["Early Growth", "Growing"], label: "growing" },
  { re: /\b(at (their )?peak|toppen)\b/, stages: ["Peak"], label: "at peak" },
  { re: /\b(declining|falling|minskande|pa vag ner)\b/, stages: ["Declining"], label: "declining" },
  { re: /\b(saturated|mattad|mattade)\b/, stages: ["Saturated"], label: "saturated" },
];
const SORT_WORDS = [
  { re: /\b(highest|best|top|bast|basta|hogst|hogsta)\s+(gross\s+|brutto)?(margins?|marginal(en)?)\b/, sort: "margin" },
  { re: /\b(highest|most|best|biggest|mest|hogst|hogsta|bast|storst)\s+(potentiell\s+|potential\s+|mojlig\s+)?(profit|vinst|lonsamhet)\b|\bmost profitable\b|\blonsammast/, sort: "profit" },
  { re: /\b(fastest[- ]growing|snabbast vaxande|growing fastest|on the rise|on the way up|pa vag upp|going up|rising)\b/, sort: "growing" },
  { re: /\b(lowest|least)\s+competition\b|\blagst konkurrens/, sort: "competition" },
  { re: /\b(highest|most|biggest|storst|hogst)\s+(demand|efterfragan)\b/, sort: "demand" },
  { re: /\bmost viral\b|\bmest virala?\b/, sort: "viral" },
  { re: /\bbest brand|\bbasta varumarke/, sort: "brand" },
  { re: /\b(safest|lowest risk|least risky|sakrast|sakraste|lagst risk)\b/, sort: "safest" },
  { re: /\b(beginners?|nyborjare|easiest|easy to start|lattast)\b/, sort: "beginners" },
  { re: /\b(best evidenced|most proven|strongest evidence|best data|mest bevisade?)\b/, sort: "evidence" },
  { re: /\b(most confident|highest confidence)\b/, sort: "confidence" },
  { re: /\b(undervalued|underrated|under the radar|undervarderade?|undervarderad)\b/, sort: "gap" },
];
const MARKET_WORDS = [
  { re: /\b(uk|u\.k\.|britain|british|england|united kingdom|storbritannien|brittisk[a]?)\b/, code: "UK" },
  { re: /\b(sweden|swedish|sverige|svensk[a]?)\b/, code: "SE" },
];
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  forsta: 1, andra: 2, tredje: 3, fjarde: 4, femte: 5, sjatte: 6, sjunde: 7, attonde: 8, nionde: 9, tionde: 10, last: -1, sista: -1 };
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  en: 1, ett: 1, tva: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7, atta: 8, nio: 9, tio: 10 };

// Field words, longest first, folded. Built once from the registry, plus a
// few phrases that only make sense in questions.
const EXTRA_ALIASES = [
  ["cost", "landedCost"], ["costs", "landedCost"], ["kostar", "landedCost"], ["kostnad", "landedCost"], ["buy for", "landedCost"], ["inkopspris", "landedCost"],
  ["sell for", "price"], ["sold for", "price"], ["sells for", "price"], ["saljas for", "price"], ["salja for", "price"], ["saljs for", "price"], ["priced", "price"],
  ["profit per order", "profit"], ["vinst per order", "profit"], ["margin", "margin"], ["competition score", "competition"],
  ["trend score", "trend"], ["brand score", "brandability"], ["opportunity score", "opportunity"], ["risk score", "risk"],
  ["startup", "startupCost"], ["start-up", "startupCost"], ["confidence", "confidence"], ["bruttomarginal", "margin"],
];
const FIELD_WORDS = [
  ...FIELDS.filter((f) => f.query).flatMap((f) => [f.key, f.label, ...f.aliases].map((w) => [fold(w), f.key])),
  ...EXTRA_ALIASES.map(([w, k]) => [fold(w), k]),
].filter(([w]) => w.length >= 2 && !["potential", "potential score"].includes(w)).sort((a, b) => b[0].length - a[0].length);

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

// Convert a money threshold to the market's currency.
function toMarket(n, currency, market) {
  const cfg = MARKETS[market];
  if (!currency || currency === cfg.currency) return n;
  if (currency === "GBP") return n / cfg.fxToGBP;
  if (currency === "SEK") return (n * MARKETS.SE.fxToGBP) / cfg.fxToGBP;
  if (currency === "USD") return (n * 0.78) / cfg.fxToGBP;
  return n;
}

// Composite rankings for "best combination of trend + margin + low competition".
const COMBO_PARTS = [
  { re: /\btrend/, key: "trend", score: (r) => r.trend },
  { re: /\b(margin|marginal)/, key: "margin", score: (r) => (r.margin == null ? null : Math.max(0, Math.min(100, ((r.margin - 30) / 45) * 100))) },
  { re: /\b(competition|konkurrens)/, key: "competition", score: (r) => (r.competition == null ? null : 100 - r.competition) },
  { re: /\b(demand|efterfragan)/, key: "demand", score: (r) => r.demand },
  { re: /\b(brand|varumarke)/, key: "brandability", score: (r) => r.brandability },
  { re: /\b(profit|vinst)/, key: "profit", score: (r) => r.profitScore },
  { re: /\b(viral|tiktok)/, key: "viral", score: (r) => r.viral },
  { re: /\b(risk)/, key: "risk", score: (r) => (r.risk == null ? null : 100 - r.risk) },
];

// "research dog toys", "gör research på hundleksaker", "find new products in
// padel": a request for new research rather than a question about the
// database. Returns {topic, market} with the topic in the user's spelling.
const RESEARCH_RES = [
  /^(?:run |do |start )?(?:a )?(?:new )?research(?: on| into| about| for)?\s+(.+)$/,
  /^(?:gor|kor|starta)\s+(?:en )?(?:ny )?research\s+(?:pa|om|inom|kring|for|av)\s+(.+)$/,
  /^researcha\s+(.+)$/,
  /^(?:find|discover|generate|get)\s+(?:me\s+)?(?:some\s+)?new\s+(?:product\s+ideas|products|ideas)\s+(?:in|for|within|about|around)\s+(.+)$/,
  /^(?:hitta|ta fram|sok|generera)\s+(?:mig\s+)?(?:nagra\s+)?nya\s+(?:produktideer|produkter|ideer)\s+(?:inom|for|i|om|kring|pa)\s+(.+)$/,
];
const POLITE = /^(?:please|can you|could you|would you|kan du|skulle du|snalla)\s+/;
const TRAILING_MARKET = /\s+(?:in|for|i|pa)\s+(?:the\s+)?(uk|united kingdom|britain|great britain|storbritannien|england|sweden|sverige)$/;

export function researchTopic(text) {
  const orig = String(text || "").normalize("NFC").replace(/\s+/g, " ").trim().replace(/[?.!]+$/, "");
  const folded = fold(orig);
  // Folding keeps positions for ordinary text, so the topic can be cut from
  // the original and keep its å, ä and ö.
  const same = folded.length === orig.length;
  const polite = folded.match(POLITE);
  const off = polite ? polite[0].length : 0;
  const t = folded.slice(off);
  for (const re of RESEARCH_RES) {
    const m = t.match(re);
    if (!m) continue;
    let topic = m[1];
    const start = off + m[0].length - m[1].length;
    let market = null;
    const tm = topic.match(TRAILING_MARKET);
    if (tm) { market = /swe|sver/.test(tm[1]) ? "SE" : "UK"; topic = topic.slice(0, tm.index); }
    const out = (same ? orig.slice(start, start + topic.length) : topic).replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
    if (out.length < 2 || /^(products?|produkter|first|forst|this|that|it|them|dessa|den)$/.test(fold(out))) return null;
    return { topic: out, market };
  }
  return null;
}

export function parseQuestion(text, ctx = {}) {
  const t = " " + fold(text).replace(/[“”"]/g, " ").replace(/\s+/g, " ") + " ";
  const out = { filters: [], sort: null, limit: null, market: null, budgetGBP: null, within: null,
    refs: [], productIds: [], intent: "query", labels: [], text, platforms: [], combo: null };

  for (const m of MARKET_WORDS) if (m.re.test(t)) { out.market = m.code; break; }
  const market = out.market || ctx.market || "UK";

  // Budget: "£2,000 budget", "with £2000", "budget of 1000", "med £1 000".
  const bud = t.match(/(?:budget(?: of)?|with|med|for|have|har|startbudget)\s+(£|\$)?\s*(\d[\d,.\s]*\d|\d)\s*(k|tusen)?\s*(£|kr|kronor|sek|pounds?|pund)?/i)
    || t.match(/(£|\$)?\s*(\d[\d,.\s]*\d|\d)\s*(k|tusen)?\s*(£|kr|kronor|sek|pounds?|pund)?\s+(?:budget|i budget|i startbudget|to spend|att spendera)/i);
  if (bud && (bud[1] || bud[4] || /budget|spend|spendera/.test(bud[0]))) {
    let n = parseNumber(bud[2]);
    if (n != null) {
      if (bud[3]) n *= 1000;
      const cur = /kr|sek|kronor/.test(bud[4] || "") ? "SEK" : "GBP";
      out.budgetGBP = cur === "SEK" ? n * MARKETS.SE.fxToGBP : n;
      out.labels.push(`launch budget ${cur === "SEK" ? n.toLocaleString("sv-SE") + " kr" : "£" + n.toLocaleString("en-GB")}`);
    }
  }
  const budgetSpan = bud ? [t.indexOf(bud[0]), t.indexOf(bud[0]) + bud[0].length] : null;

  // Numeric comparisons. The field is the nearest field word before or after
  // the number; a percentage prefers a percentage field.
  const consumed = budgetSpan ? [budgetSpan] : [];
  for (const [w, op] of OP_WORDS) {
    const needle = /^[a-z]/i.test(w) ? new RegExp(`(^|[^a-z])${escapeRe(w)}(?=[^a-z]|$)`, "gi") : new RegExp(escapeRe(w), "g");
    let m;
    while ((m = needle.exec(t))) {
      const start = m.index + (m[1] ? m[1].length : 0);
      const end = start + w.length;
      if (consumed.some(([a, b]) => start < b && end > a)) continue;
      const val = readValue(t.slice(end));
      if (!val) continue;
      const before = nearestField(t.slice(Math.max(0, start - 60), start), "before");
      const after = nearestField(t.slice(end + val.length, end + val.length + 40), "after");
      let field = pick(before, after, val);
      if (!field) field = val.percent ? "margin" : (val.currency ? "price" : null);
      if (field && val.currency && FIELD[field]?.type !== "money") field = "price";
      if (field && val.percent && !["pct", "score"].includes(FIELD[field]?.type)) field = "margin";
      if (!field) continue;
      const f = FIELD[field];
      let n = val.n;
      if (f?.type === "money") n = round2(toMarket(n, val.currency, market));
      out.filters.push({ field, op, value: n, inferred: !before && !after });
      consumed.push([start, end + val.length]);
    }
  }
  const between = t.match(/(?:between|mellan)\s+(£)?(\d[\d,.]*)\s*(?:and|och|-|–)\s*(£)?(\d[\d,.]*)/);
  if (between) {
    const field = nearestField(t.slice(0, between.index), "before")?.key || "price";
    const a = parseNumber(between[2]), b = parseNumber(between[4]);
    if (a != null && b != null) {
      const cur = between[1] || between[3] ? "GBP" : null;
      const conv = (x) => (FIELD[field]?.type === "money" ? round2(toMarket(x, cur, market)) : x);
      out.filters = out.filters.filter((f) => f.field !== field);
      out.filters.push({ field, op: "between", value: [conv(a), conv(b)] });
    }
  }
  // "under £30 that can be sold for at least £60": two price bounds that
  // contradict each other mean the lower one is the product's cost.
  const prices = out.filters.filter((f) => f.field === "price");
  const upper = prices.find((f) => f.op === "<" || f.op === "<="), lower = prices.find((f) => f.op === ">" || f.op === ">=");
  if (upper && lower && upper.value < lower.value) upper.field = "landedCost";

  // Levels and stages.
  const has = (field) => out.filters.some((f) => f.field === field);
  const relaxed = /\b(relativt|relatively|fairly|ganska|rather|reasonably|forhallandevis)\b/.test(t);
  const levelFields = [];
  for (const a of ADJECTIVES) {
    if (!a.re.test(t) || has(a.f[0])) continue;
    let value = a.f[2];
    if (relaxed && a.relaxed != null) value = a.relaxed;
    if (a.money) value = round2(toMarket(value, "GBP", market));
    out.filters.push({ field: a.f[0], op: a.f[1], value });
    if (a.platform) out.platforms.push(a.f[0]);
    levelFields.push(a.f[0]);
  }
  const stages = new Set();
  for (const s of STAGE_WORDS) if (s.re.test(t)) s.stages.forEach((x) => stages.add(x));
  if (/\b(instead of|rather than|istallet for|inte en)\b.*\b(short[- ]lived|fad|kortvarig|tillfallig)/.test(t) || /\b(not a fad|not just a trend|inte bara en trend)\b/.test(t)) {
    ["Emerging", "Early Growth", "Growing"].forEach((x) => stages.add(x));
  }
  if (stages.size) out.filters.push({ field: "stage", op: "in", value: [...stages] });

  // Categories, niches and product names that appear in the question.
  if (ctx.rows?.length) {
    const cats = new Map();
    for (const r of ctx.rows) for (const k of ["category", "subcategory", "niche"]) {
      const v = fold(r[k]);
      if (v.length >= 3) cats.set(v, k);
    }
    for (const [v] of cats) {
      const words = v.split(/[^a-z]+/).filter((w) => w.length >= 3 && !STOP.has(w));
      const hit = t.includes(" " + v + " ") ? v : words.find((w) => new RegExp(`\\b${escapeRe(singular(w))}s?\\b`).test(t));
      if (hit) {
        if (!out.filters.some((f) => f.field === "text")) out.filters.push({ field: "text", op: "contains", value: singular(hit) });
        break;
      }
    }
    for (const r of ctx.rows) {
      const name = fold(r.name);
      const key = name.split(/[:(,]/)[0].trim();
      const short = key.split(" ").slice(-2).join(" ");
      if ((key.length >= 5 && t.includes(key)) || t.includes(" " + r.id.replace(/-/g, " ") + " ") || t.includes(r.id)
        || (short.length >= 8 && t.includes(" " + short + " "))) out.productIds.push(r.id);
    }
  }

  // Sorting.
  for (const s of SORT_WORDS) if (s.re.test(t)) { out.sort = s.sort; break; }
  if (/\b(kombination|combination|combo|balans|balance|mix|blend)\b/.test(t)) {
    const parts = COMBO_PARTS.filter((p) => p.re.test(t));
    if (parts.length >= 2) {
      out.combo = parts.map((p) => p.key);
      out.sort = { label: `combined ${out.combo.join(" + ")}`, dir: "desc", score: (r) => {
        const xs = parts.map((p) => p.score(r)).filter((x) => x != null);
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
      } };
      // The levels named inside the combination rank, they do not filter.
      out.filters = out.filters.filter((f) => !out.combo.includes(f.field) || f.op === "in");
    }
  }
  if (/\b(undervalued|underrated|undervarderade?)\b/.test(t) && /\b(or|eller)\b/.test(t)) {
    out.filters = out.filters.filter((f) => f.field !== "competition");
  }
  if (out.sort === "growing" && !has("trendDirection")) out.filters.push({ field: "trendDirection", op: "=", value: "up" });
  if (!out.sort && out.platforms.length === 1) out.sort = out.platforms[0];
  if (!out.sort && levelFields.length && !["validation", "profit", "weight", "seasonalityRisk"].includes(levelFields[0])) {
    const k = levelFields[0];
    out.sort = { competition: "competition", risk: "safest", brandability: "brand", trend: "trend", demand: "demand", margin: "margin",
      adPotential: "adPotential", repeat: "repeat", bundle: "bundle", aov: "aov", giftability: "giftability", viral: "viral", subscription: "subscription" }[k] || null;
  }

  const top = t.match(/\b(?:top|best|basta|topp)\s+(\d+|[a-z]+)\b/) || t.match(/\b(\d+|[a-z]+)\s+(?:best|basta|products|produkter|produkterna|ideas|ideer|forslag)\b/);
  if (top) {
    const n = /^\d+$/.test(top[1]) ? Number(top[1]) : NUMBER_WORDS[top[1]];
    if (n && n <= 50) out.limit = n;
  }

  // References to the previous answer.
  const refRe = /(?:number|nr\.?|nummer|#|no\.)\s*(\d+)|\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|forsta|andra|tredje|fjarde|femte|sjatte|sjunde|attonde|nionde|tionde|sista)\b(?:\s+(?:one|product|produkten|en|ett))?/g;
  let rm;
  while ((rm = refRe.exec(t))) {
    const n = rm[1] ? Number(rm[1]) : ORDINALS[rm[2]];
    if (n && !(rm[2] === "andra" && !/\b(den|nummer|produkt)\b/.test(t))) out.refs.push(n);
  }
  const anaphora = /\b(these|those|them|which one|which of|of them|this one|that one|it|dessa|de har|dem|vilken av|vilka av|den har|av dessa)\b/.test(t);
  const last = ctx.lastResultIds || [];
  if (last.length && (anaphora || out.refs.length)) out.within = last.slice();
  out.refIds = out.refs.map((n) => (n === -1 ? last[last.length - 1] : last[n - 1])).filter(Boolean);

  // Intent.
  const isWhy = /\b(why|varfor|explain|forklara|how come)\b/.test(t);
  if (isWhy && (out.refIds.length >= 2 || out.productIds.length >= 2) && /\b(better|worse|battre|samre|beat|over|fore)\b/.test(t)) out.intent = "why";
  else if (/\b(compare|jamfor|versus)\b|\bvs\.?\b/.test(t)) out.intent = "compare";
  else if (/\b(avoid|undvika|undvik|stay away|steer clear|skip|valja bort|ska jag inte)\b/.test(t)
    || /\b(bad|poor|weak|low|dalig|svag|lag|dalig)\s+(potential|potentiell)\b.*\b(trend|viral|trendande)/.test(t)
    || /\b(trend|trending|trendande|viral)\b.*\b(bad|poor|weak|dalig|svag)\s+(potential|potentiell)/.test(t)) out.intent = "avoid";
  else if (/\b(test first|try first|start with|first product|testa forst|borja med|skulle du (sjalv )?testa|which would you test|vilken .* forst|forsta produkten)\b/.test(t)) out.intent = "first";
  else if (/\b(micro[- ]?niches?|mikronisch(er)?|nischer|niches|niche finder|find .* niches?|lonsamma nischer)\b/.test(t)) out.intent = "niches";
  else if (/unit economics|economics|enhetsekonomi|break[- ]even|kalkyl|numbers|siffrorna|lonsamhetskalkyl/.test(t)) out.intent = "economics";
  else if (out.budgetGBP != null) out.intent = "budget";
  else if (/\b(which one|which of|vilken av|which product|vilken produkt)\b/.test(t) && out.within) out.intent = "pick";
  else if (isWhy || /\b(tell me about|berätta om|beratta om|what about|hur ar|could .* work|kunna fungera|kan fungera|fungera)\b/.test(t)) {
    if (out.productIds.length === 1 || out.refIds.length === 1) out.intent = "product";
  } else if (/^\s*(help|hjalp|what can you do|vad kan du)\b/.test(t.trim())) out.intent = "help";
  if (out.intent === "query" && out.platforms.length >= 2) out.intent = "platforms";
  if (out.intent === "pick" && !out.sort) out.sort = /\b(safe|saker)/.test(t) ? "safest" : "evidence";
  if (out.intent === "budget" && !out.sort) out.sort = "evidence";
  const research = researchTopic(text);
  if (research) { out.intent = "research"; out.topic = research.topic; if (research.market) out.market = research.market; }
  return out;
}

const STOP = new Set(["home", "with", "products", "product", "kits", "and", "for", "the", "control", "accessories", "gadgets", "care", "gear", "at",
  "staying", "personal", "smart", "connection", "family", "outdoors", "recovery", "fitness"]);
const singular = (w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

// The nearest field word: for "before", the one ending closest to the end
// of `s`; for "after", the one starting closest to its start.
function nearestField(s, side) {
  let best = null;
  for (const [w, key] of FIELD_WORDS) {
    const re = new RegExp(`(^|[^a-z])${escapeRe(w)}(?=[^a-z]|$)`, "gi");
    let m;
    while ((m = re.exec(s))) {
      const start = m.index + m[1].length, end = start + w.length;
      const dist = side === "before" ? s.length - end : start;
      if (!best || dist < best.dist || (dist === best.dist && w.length > best.w.length)) best = { key, dist, w };
    }
  }
  if (!best) return null;
  return best.dist <= (side === "before" ? 24 : 18) ? best : null;
}
function pick(before, after, val) {
  if (!before) return after?.key || null;
  if (!after) return before.key;
  const type = (k) => FIELD[k]?.type;
  if (val.percent && type(after.key) === "pct" && type(before.key) !== "pct") return after.key;
  if (val.percent && type(before.key) === "pct" && type(after.key) !== "pct") return before.key;
  return after.dist < before.dist ? after.key : before.key;
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const round2 = (x) => Math.round(x * 100) / 100;
export function opWord(op) {
  return { ">": "over", ">=": "at least", "<": "under", "<=": "at most", "=": "=", "!=": "not", in: "in", between: "between", contains: "contains" }[op] || op;
}

// On-demand AI agents. Each one asks Claude for structured output about
// products in the database and stores the result as a versioned run. Runs
// never overwrite analysis: applying a result writes overlays or a new
// product, every value marked as an AI estimate (or as estimated from the
// reviews you pasted), so the provenance stays honest.

import { store, product, row, saveRun, setOverlay, saveUserProduct } from "../state.js";
import { MARKETS } from "../core/markets.js";
import { FIELD } from "../core/fields.js";
import { STAGES } from "../core/fields.js";
import { computeEconomics, scenario } from "../core/economics.js";
import { withOverrides } from "../core/markets.js";

const clampN = (x, lo, hi) => (typeof x === "number" && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : null);
const str = (x, max = 600) => (x == null ? null : String(x).slice(0, max));
const list = (x, n = 8, max = 200) => (Array.isArray(x) ? x.slice(0, n).map((s) => String(s).slice(0, max)) : null);

// A compact description of a product for prompts.
export function productContext(id, market) {
  const p = product(id);
  const r = row(id, market);
  if (!p || !r) return null;
  const core = {};
  for (const [k, x] of Object.entries(p.core)) if (x && typeof x === "object" && "v" in x && x.v != null) core[k] = x.v;
  const mk = {};
  for (const [k, x] of Object.entries(p.built[market].mk)) if (x && typeof x === "object" && "v" in x && x.v != null) mk[k] = x.v;
  const why = p.built[market].why;
  return JSON.stringify({
    id, market, currency: MARKETS[market].currency, core, market_data: mk,
    economics: { price: r.price, landedCost: r.landedCost, margin: r.margin, contribution: r.contribution, cac: r.cac, profit: r.profit, startupCost: r.startupCost },
    scores: { opportunity: r.opportunity, confidence: r.confidence, risk: r.risk, stage: r.stage, validation: r.validation, interest: r.interest },
    reasons: { positives: why.positives.slice(0, 4).map((x) => x.text + " (" + x.detail + ")"), negatives: why.negatives.slice(0, 4).map((x) => x.text + " (" + x.detail + ")") },
    redFlags: r.redFlags,
  });
}

const HONESTY = "You have no internet access and no data beyond what is given here. Do not present guesses as facts: where you estimate, keep figures conservative and plausible for a small independent online store. Never invent named sources, statistics or competitor revenues.";

async function runJSON(prompt, opts = {}) {
  if (!store.sample) throw { code: "not_granted", message: "Claude is not available here." };
  return store.sample.json(prompt, { modelTier: opts.tier || "default", signal: opts.signal, cache: false, onText: opts.onText });
}
async function runText(prompt, opts = {}) {
  if (!store.sample) throw { code: "not_granted", message: "Claude is not available here." };
  const res = await store.sample(prompt, { modelTier: opts.tier || "default", signal: opts.signal, cache: false, onText: opts.onText });
  return res.text;
}

// ── Agent definitions ──────────────────────────────────────────────────
export const AGENTS = {
  brand: {
    label: "Brand builder",
    blurb: "Names, positioning, landing page and ad hooks for a brand around this product.",
    async run({ id, market, signal, onText }) {
      const out = await runJSON([
        "You are a direct-to-consumer brand strategist. Build a brand concept for an independent online store selling this product in the market given.",
        HONESTY,
        "Reply with only JSON of this shape:",
        '{"names":[{"name":"…","why":"…"}],"positioning":"…","tagline":"…","audience":"…","toneOfVoice":"…","visualDirection":"…","landingPage":{"headline":"…","subheadline":"…","sections":["…"]},"adHooks":["…"],"contentPillars":["…"],"offer":{"bundle":"…","pricing":"…"},"trustBuilders":["…"],"risks":["…"]}',
        "Give 5 names (check they are not famous brands you know of), 6 ad hooks, 4 content pillars. UK English for the UK market; for Sweden, write the copy in Swedish.",
        "Product:", productContext(id, market),
      ].join("\n"), { signal, onText });
      return { output: sanitizeBrand(out) };
    },
  },
  improve: {
    label: "Improvement engine",
    blurb: "Concrete product changes that fix the common complaints and set it apart.",
    async run({ id, market, signal, onText }) {
      const out = await runJSON([
        "You are a product developer for small e-commerce brands. Propose improvements to this product that fix what customers complain about and make it clearly better than the cheap listings.",
        HONESTY,
        "Base each idea on the data given (complaints, weaknesses, differentiation opportunities, red flags) and name which data point it answers.",
        'Reply with only JSON: {"improvements":[{"change":"…","fixes":"…","basedOn":"…","impact":"high|medium|low","difficulty":"easy|moderate|hard","costNote":"…"}],"bundleIdeas":["…"],"positioning":"…","doNotDo":["…"]}',
        "Give 5–7 improvements, ordered by impact divided by difficulty.",
        "Product:", productContext(id, market),
      ].join("\n"), { signal, onText });
      return { output: sanitizeImprove(out) };
    },
  },
  reviews: {
    label: "Review analyst",
    blurb: "Paste customer reviews (yours or a competitor's) to extract complaints, praise and product ideas.",
    needsInput: "reviews",
    async run({ id, market, input, signal, onText }) {
      const text = String(input || "").slice(0, 30000);
      if (text.trim().length < 80) throw { code: "input", message: "Paste at least a few reviews (80 characters or more)." };
      const out = await runJSON([
        "You analyse customer reviews for an e-commerce researcher. Use only the reviews below. Count themes across reviews; quote short real phrases from the reviews (max 15 words each).",
        'Reply with only JSON: {"reviewCount":0,"summary":"…","sentiment":{"positive":0,"neutral":0,"negative":0},"praise":[{"theme":"…","mentions":0,"quote":"…"}],"complaints":[{"theme":"…","mentions":0,"quote":"…"}],"unmetNeeds":["…"],"productIdeas":[{"idea":"…","why":"…"}],"marketingAngles":["…"]}',
        "sentiment values are percentages that sum to 100.",
        "Product context:", productContext(id, market),
        "Reviews:", text,
      ].join("\n"), { signal, onText });
      return { output: sanitizeReviews(out), inputSummary: `${text.length.toLocaleString("en-GB")} characters of reviews` };
    },
    // Writes the review findings onto the product as values estimated from
    // the reviews, citing the run.
    async apply(run) {
      const o = run.output;
      const src = ["user-reviews:" + run.id];
      const base = `${run.productId}|${run.market}|`;
      if (o.complaints?.length) await setOverlay(base + "customerComplaints", { v: o.complaints.map((c) => c.theme), s: "E", src, note: `From ${o.reviewCount || "pasted"} reviews you pasted.` });
      if (o.summary) await setOverlay(base + "reviewSentiment", { v: `${o.summary} (positive ${o.sentiment?.positive ?? "?"}%, negative ${o.sentiment?.negative ?? "?"}%)`, s: "E", src, note: "Review analyst on reviews you pasted." });
      return "Complaints and sentiment saved to the product as estimated from your reviews.";
    },
  },
  market: {
    label: "Market adapter",
    blurb: "Analyse this product for the other market (Sweden or the UK) where the research has no analysis yet.",
    async run({ id, market, target, signal, onText }) {
      const t = target || (market === "UK" ? "SE" : "UK");
      const cfg = MARKETS[t];
      const out = await runJSON([
        `You are an e-commerce market analyst. The product below has an analysis for ${MARKETS[market].name}. Write the analysis for ${cfg.name} (${cfg.currency}, VAT ${cfg.vat * 100}%).`,
        HONESTY,
        "Adjust for local prices, climate, habits, seasonality, competition and regulation. Scores are 0–100; competition, saturation, seasonalityRisk, regulatoryRisk and ipRisk: higher is worse.",
        `Reply with only JSON with these keys (numbers unless noted): {"relevance":0,"price":0,"returnRate":0,"demand":0,"trend":0,"trendDirection":"up|flat|down","trendAcceleration":0,"growth":0,"seasonality":"text","peakMonths":[1],"seasonalityRisk":0,"competition":0,"saturation":0,"competitorPriceMin":0,"competitorPriceMax":0,"social":0,"tiktok":0,"instagram":0,"meta":0,"google":0,"seo":0,"organic":0,"influencer":0,"ugc":0,"regulatoryRisk":0,"regulatoryNotes":"text","ipRisk":0,"notes":"text"}`,
        `price is the consumer price incl. VAT in ${cfg.currency}.`,
        "Product:", productContext(id, market),
      ].join("\n"), { signal, onText });
      return { output: sanitizeMarket(out), target: t };
    },
    async apply(run) {
      const block = {};
      for (const [k, x] of Object.entries(run.output)) {
        if (k === "notes" || x == null) continue;
        block[k] = { v: x, s: "A", src: ["agent:" + run.id], note: `Market adapter (${run.createdAt.slice(0, 10)}).` };
      }
      await setOverlay(`${run.productId}|${run.target}|*`, { v: block, s: "A", src: ["agent:" + run.id] });
      return `${MARKETS[run.target].name} analysis added as AI estimates.`;
    },
  },
  scenarios: {
    label: "Scenario commentary",
    blurb: "A plain-language read of the best, base and worst case.",
    text: true,
    async run({ id, market, signal, onText }) {
      const p = product(id), b = p.built[market];
      const cfg = withOverrides(market, store.settings?.markets?.[market]);
      const base = computeEconomics(p.core, b.mk, cfg);
      const sc = ["best", "base", "worst"].map((k) => {
        const s = scenario(p.core, b.mk, cfg, k, base);
        return { case: s.label, assumptions: s.story, profitPerOrder: s.economics.profit.v, netMarginPct: s.economics.netMargin.v, profitAfter100Orders: s.profit100, breakEvenOrders: s.economics.breakEvenOrders.v };
      });
      const text = await runText([
        "You are an e-commerce finance analyst. Comment on these three scenarios for one product in 120–180 words: what has to be true for the best case, what breaks it in the worst case, and the single number the user should measure first in a test. No headings; one short paragraph and three bullets.",
        HONESTY,
        `Currency ${cfg.currency}. Scenarios: ${JSON.stringify(sc)}`,
        "Product:", productContext(id, market),
      ].join("\n"), { signal, onText });
      return { output: { text } };
    },
  },
};

// Agents that work on several products or on the whole database.
export async function runCompare(ids, market, { signal, onText } = {}) {
  const ctx = ids.map((id) => productContext(id, market)).filter(Boolean);
  const out = await runJSON([
    "You are the comparison judge in an e-commerce research tool. Compare these products for a small independent store and pick one.",
    HONESTY,
    "Weigh profit per order after CAC, evidence of real demand, competition, risk, launch cost and data confidence. Say where low data confidence limits the verdict.",
    'Reply with only JSON: {"ranking":[{"id":"…","rank":1,"reason":"…"}],"verdict":"…","chooseIf":[{"id":"…","when":"…"}],"safest":"id","highestUpside":"id","bestForBeginners":"id","whatToTestFirst":"…"}',
    "Products:", ...ctx,
  ].join("\n"), { signal, onText });
  const valid = new Set(ids);
  const o = {
    ranking: (out.ranking || []).filter((x) => valid.has(x.id)).map((x) => ({ id: x.id, rank: clampN(x.rank, 1, 9), reason: str(x.reason, 400) })),
    verdict: str(out.verdict, 1200), chooseIf: (out.chooseIf || []).filter((x) => valid.has(x.id)).map((x) => ({ id: x.id, when: str(x.when, 300) })),
    safest: valid.has(out.safest) ? out.safest : null, highestUpside: valid.has(out.highestUpside) ? out.highestUpside : null,
    bestForBeginners: valid.has(out.bestForBeginners) ? out.bestForBeginners : null, whatToTestFirst: str(out.whatToTestFirst, 400),
  };
  const saved = await saveRun({ agent: "compare", productIds: ids, market, output: o });
  return { id: saved.id, output: o };
}

export async function runNicheScout(rowsNow, market, { signal, onText, focus } = {}) {
  const covered = [...new Set(rowsNow.map((r) => r.niche))];
  const out = await runJSON([
    `You are a niche scout for e-commerce in ${MARKETS[market].name}. Suggest 8 product niches that are NOT already covered below and that suit a small independent online store (light, shippable, brandable, not heavily regulated).`,
    HONESTY,
    "These are ideas to research, not findings: for each, list the signals the user should check to validate it.",
    focus ? `Focus on: ${String(focus).slice(0, 200)}` : "",
    'Reply with only JSON: {"niches":[{"name":"…","category":"…","whyNow":"…","targetCustomer":"…","exampleProducts":["…"],"signalsToCheck":["…"],"risks":["…"],"seasonality":"…"}]}',
    "Already covered niches: " + covered.join("; "),
  ].join("\n"), { signal, onText });
  const niches = (out.niches || []).slice(0, 10).map((n) => ({
    name: str(n.name, 120), category: str(n.category, 80), whyNow: str(n.whyNow, 500), targetCustomer: str(n.targetCustomer, 300),
    exampleProducts: list(n.exampleProducts, 5), signalsToCheck: list(n.signalsToCheck, 5), risks: list(n.risks, 4), seasonality: str(n.seasonality, 120),
  })).filter((n) => n.name);
  const saved = await saveRun({ agent: "niches", market, output: { niches, focus: focus || null } });
  return { id: saved.id, output: { niches } };
}

export async function runBrief(rowsNow, insightsNow, market, { signal, onText } = {}) {
  const top = [...rowsNow].sort((a, b) => b.evidenceWeighted - a.evidenceWeighted).slice(0, 10)
    .map((r) => ({ id: r.id, name: r.name, stage: r.stage, opportunity: r.opportunity, confidence: r.confidence, margin: r.margin, profit: r.profit, competition: r.competition, risk: r.risk, validation: r.validation }));
  const text = await runText([
    `Write this week's research brief for an e-commerce founder focused on ${MARKETS[market].name}. 150–220 words: one opening sentence with the main conclusion, then 4–5 bullets with what to test, what to drop and what to verify. Mention products as [[product-id]]. Use only the data below and say where it is thin.`,
    HONESTY,
    "Top products by evidence-weighted opportunity:", JSON.stringify(top),
    "Computed findings:", JSON.stringify(insightsNow.map((i) => ({ title: i.title, text: i.text }))),
  ].join("\n"), { signal, onText });
  const saved = await saveRun({ agent: "brief", market, output: { text } });
  return { id: saved.id, output: { text } };
}

// Our own text for a competitor's ad that was copied with GetHookd: the
// same angle, new words, nothing the product data does not support.
export async function runAdCopy({ id, market, source, signal, onText }) {
  const sv = market === "SE";
  const out = await runJSON([
    "You are a direct-response copywriter for a small independent online store. Below is a competitor's Meta ad that works for this product. Write our own ad for the same product in its spirit: the same kind of hook and angle, in new words.",
    HONESTY,
    "Do not reuse the competitor's sentences, brand name, product name, personal names or offer. Do not promise anything the product data does not support: no reviews, ratings, awards, certifications, discounts, delivery times or medical claims unless they are in the product data.",
    sv ? "Write in Swedish, for shoppers in Sweden." : "Write in UK English, for shoppers in the UK.",
    'Reply with only JSON: {"angle":"…","hooks":["…","…","…"],"primaryText":"…","headline":"…","description":"…","cta":"Shop now|Learn more|Order now|Get offer","videoScript":["…"],"changedFromOriginal":"…","checkBeforeUse":["…"]}',
    "angle: one sentence on what the original does that we keep. hooks: 3 first lines, at most 12 words each. primaryText: at most 90 words. headline: at most 40 characters. description: at most 30 characters. videoScript: 4 to 6 short shots for a 15-second video, matching the hook. changedFromOriginal: what we changed so it is ours. checkBeforeUse: facts to confirm before running it.",
    "Competitor's ad (copy only the idea):", JSON.stringify({ advertiser: source?.advertiser, hook: source?.hook, title: source?.title, body: source?.body, cta: source?.cta, linkDescription: source?.linkDescription, spoken: source?.transcript, format: source?.format }),
    "Our product:", productContext(id, market) || "{}",
  ].join("\n"), { signal, onText });
  return sanitizeAdCopy(out);
}
const AD_CTAS = ["Shop now", "Learn more", "Order now", "Get offer"];
export function sanitizeAdCopy(o = {}) {
  return {
    angle: str(o.angle, 300), hooks: list(o.hooks, 3, 120) || [], primaryText: str(o.primaryText, 900), headline: str(o.headline, 60),
    description: str(o.description, 60), cta: AD_CTAS.includes(o.cta) ? o.cta : "Shop now", videoScript: list(o.videoScript, 6, 200) || [],
    changedFromOriginal: str(o.changedFromOriginal, 400), checkBeforeUse: list(o.checkBeforeUse, 5, 200) || [],
  };
}

// Inbox candidate → AI-analysed product (all values AI estimates).
export async function runProfiler(candidate, { signal, onText } = {}) {
  const market = candidate.market === "SE" ? "SE" : "UK";
  const cfg = MARKETS[market];
  const out = await runJSON([
    `You are a product research analyst. Turn this product idea into a structured analysis for ${cfg.name} (${cfg.currency}, consumer prices incl. ${cfg.vat * 100}% VAT).`,
    HONESTY,
    "Scores are 0–100. competition, saturation, seasonalityRisk, regulatoryRisk, ipRisk, shippingDifficulty, damageRisk, returnRisk and supplierDifficulty: higher is worse. supplierPriceUSD and inboundUSD are per unit in USD. size is S, M, L or XL; kind is textile, electrical or default; trendDirection is up, flat or down; peakMonths are month numbers.",
    "Reply with only JSON: " + JSON.stringify({
      core: Object.fromEntries(PROFILE_CORE.map((k) => [k, FIELD[k]?.type === "list" ? ["…"] : ["text", "enum"].includes(FIELD[k]?.type) || k === "kind" ? "…" : 0])),
      market: Object.fromEntries(PROFILE_MARKET.map((k) => [k, FIELD[k]?.type === "list" || FIELD[k]?.type === "months" ? (k === "peakMonths" ? [11, 12] : ["…"]) : ["text", "enum"].includes(FIELD[k]?.type) ? "…" : 0])),
    }),
    "Idea from the research inbox (its numbers are an earlier model's guesses):", JSON.stringify({ name: candidate.name, niche: candidate.niche, notes: candidate.notes, market: candidate.market, price: candidate.price, cost: candidate.cost, currency: candidate.currency }),
  ].join("\n"), { signal, onText, tier: "default" });
  const id = "ai-" + slug(out?.core?.name || candidate.name) + "-" + Math.random().toString(36).slice(2, 6);
  const note = `AI profile of inbox candidate “${candidate.name}”.`;
  const wrap = (k, x) => {
    const t = FIELD[k]?.type;
    let v = x;
    if (t === "score") v = clampN(Number(x), 0, 100);
    else if (t === "money" || t === "pct" || t === "num") v = clampN(Number(x), -1e6, 1e7);
    else if (t === "list") v = list(x, 8, 240);
    else if (t === "months") v = Array.isArray(x) ? x.map(Number).filter((m) => m >= 1 && m <= 12) : null;
    else v = str(x, 900);
    if (k === "size") v = ["S", "M", "L", "XL"].includes(x) ? x : "M";
    if (k === "trendDirection") v = ["up", "flat", "down"].includes(x) ? x : "flat";
    return v == null ? null : { v, s: "A", src: null, note };
  };
  const core = {};
  for (const k of PROFILE_CORE) if (out?.core?.[k] != null && k !== "kind") { const w = wrap(k, out.core[k]); if (w) core[k] = w; }
  core.kind = ["textile", "electrical", "default"].includes(out?.core?.kind) ? out.core.kind : "default";
  if (!core.name) core.name = { v: candidate.name, s: "A", note };
  const mk = { evidence: [] };
  for (const k of PROFILE_MARKET) if (out?.market?.[k] != null) { const w = wrap(k, out.market[k]); if (w) mk[k] = w; }
  for (const k of ["marketSize", "reviewSentiment"]) mk[k] = { v: null, s: "N", note: "No data: profiled by AI from an inbox idea." };
  const record = { id, source: "agent", fromCandidate: candidate.id, candidateId: candidate.sourceId || null, createdAt: new Date().toISOString(), evidence: [], core, markets: { [market]: mk } };
  const saved = await saveRun({ agent: "profiler", productId: id, market, candidateId: candidate.id, output: { name: core.name.v } });
  const res = await saveUserProduct(record);
  return { id, runId: saved.id, saved: res.ok };
}

const PROFILE_CORE = ["name", "category", "subcategory", "niche", "microNiche", "overview", "targetCustomer", "targetAge", "targetGender", "painPoint",
  "problemSolved", "mainBenefit", "emotionalAppeal", "purchaseMotivation", "supplierPriceUSD", "inboundUSD", "moq", "kind", "size", "weight",
  "shippingDifficulty", "damageRisk", "returnRisk", "supplierAvailability", "supplierDifficulty", "brandability", "viral", "impulse", "giftability",
  "repeat", "subscription", "bundle", "differentiation", "brandAngle", "landingPageAngle", "adAngles", "contentAngles",
  "differentiationOpportunities", "uspOpportunities", "reasonsWork", "reasonsFail", "keyRisks"];
const PROFILE_MARKET = ["relevance", "price", "dutyRate", "returnRate", "searchDemand", "demand", "trend", "trendDirection", "trendAcceleration", "growth",
  "seasonality", "peakMonths", "seasonalityRisk", "competition", "saturation", "competitorCount", "competitorStrength", "competitorPriceMin",
  "competitorPriceMax", "marketLeaders", "commonComplaints", "commonWeaknesses", "commonMarketingAngles", "social", "tiktok", "instagram", "meta", "google", "seo",
  "organic", "influencer", "ugc", "regulatoryRisk", "regulatoryNotes", "ipRisk"];

const slug = (s) => String(s || "product").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "product";

// Run a product agent and store the result.
export async function runAgent(key, { id, market, input, target, signal, onText }) {
  const a = AGENTS[key];
  const res = await a.run({ id, market, input, target, signal, onText });
  const saved = await saveRun({ agent: key, productId: id, market, output: res.output, target: res.target || null, inputSummary: res.inputSummary || null });
  return { id: saved.id, agent: key, productId: id, market, target: res.target || null, output: res.output, createdAt: new Date().toISOString() };
}

// ── Sanitisers: never trust the shape of model output ──────────────────
function sanitizeBrand(o = {}) {
  return {
    names: (o.names || []).slice(0, 6).map((n) => ({ name: str(n.name, 60), why: str(n.why, 240) })).filter((n) => n.name),
    positioning: str(o.positioning, 600), tagline: str(o.tagline, 140), audience: str(o.audience, 400),
    toneOfVoice: str(o.toneOfVoice, 300), visualDirection: str(o.visualDirection, 400),
    landingPage: { headline: str(o.landingPage?.headline, 140), subheadline: str(o.landingPage?.subheadline, 240), sections: list(o.landingPage?.sections, 8, 200) || [] },
    adHooks: list(o.adHooks, 8, 200) || [], contentPillars: list(o.contentPillars, 6, 200) || [],
    offer: { bundle: str(o.offer?.bundle, 300), pricing: str(o.offer?.pricing, 300) },
    trustBuilders: list(o.trustBuilders, 6, 200) || [], risks: list(o.risks, 5, 200) || [],
  };
}
function sanitizeImprove(o = {}) {
  return {
    improvements: (o.improvements || []).slice(0, 8).map((x) => ({
      change: str(x.change, 240), fixes: str(x.fixes, 300), basedOn: str(x.basedOn, 200),
      impact: ["high", "medium", "low"].includes(x.impact) ? x.impact : "medium",
      difficulty: ["easy", "moderate", "hard"].includes(x.difficulty) ? x.difficulty : "moderate", costNote: str(x.costNote, 200),
    })).filter((x) => x.change),
    bundleIdeas: list(o.bundleIdeas, 5) || [], positioning: str(o.positioning, 500), doNotDo: list(o.doNotDo, 4) || [],
  };
}
function sanitizeReviews(o = {}) {
  const theme = (x) => ({ theme: str(x.theme, 120), mentions: clampN(Number(x.mentions), 0, 1e5), quote: str(x.quote, 160) });
  return {
    reviewCount: clampN(Number(o.reviewCount), 0, 1e5), summary: str(o.summary, 600),
    sentiment: { positive: clampN(Number(o.sentiment?.positive), 0, 100), neutral: clampN(Number(o.sentiment?.neutral), 0, 100), negative: clampN(Number(o.sentiment?.negative), 0, 100) },
    praise: (o.praise || []).slice(0, 8).map(theme).filter((x) => x.theme), complaints: (o.complaints || []).slice(0, 10).map(theme).filter((x) => x.theme),
    unmetNeeds: list(o.unmetNeeds, 6) || [], productIdeas: (o.productIdeas || []).slice(0, 6).map((x) => ({ idea: str(x.idea, 200), why: str(x.why, 300) })).filter((x) => x.idea),
    marketingAngles: list(o.marketingAngles, 6) || [],
  };
}
function sanitizeMarket(o = {}) {
  const out = {};
  for (const k of ["relevance", "demand", "trend", "seasonalityRisk", "competition", "saturation", "social", "tiktok", "instagram", "meta", "google", "seo", "organic", "influencer", "ugc", "regulatoryRisk", "ipRisk"]) {
    const v = clampN(Number(o[k]), 0, 100); if (v != null) out[k] = v;
  }
  for (const k of ["price", "competitorPriceMin", "competitorPriceMax"]) { const v = clampN(Number(o[k]), 0, 1e6); if (v != null) out[k] = v; }
  for (const k of ["returnRate", "trendAcceleration", "growth"]) { const v = clampN(Number(o[k]), -100, 300); if (v != null) out[k] = v; }
  if (["up", "flat", "down"].includes(o.trendDirection)) out.trendDirection = o.trendDirection;
  if (Array.isArray(o.peakMonths)) out.peakMonths = o.peakMonths.map(Number).filter((m) => m >= 1 && m <= 12);
  for (const k of ["seasonality", "regulatoryNotes", "notes"]) if (o[k]) out[k] = str(o[k], 500);
  return out;
}

export { STAGES };

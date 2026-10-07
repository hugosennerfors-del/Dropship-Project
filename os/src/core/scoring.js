// The scoring engine.
//
// The E-commerce Opportunity Score is not an average. It is built in four
// steps, and every step is reported back so the UI can show exactly why a
// product got its score:
//
//   1. Weighted components. Ten sub-scores (0–100) times their weights,
//      which sum to 100. Profitability, demand and competition weigh most.
//   2. Interactions. Combinations that matter more than their parts: early
//      stage + high margin + low competition earns a bonus; attention without
//      demand, or a commodity with nothing to differentiate, is penalised.
//   3. Risk adjustment. The risk score scales the result down by up to 30 %.
//   4. Caps. Red flags that no amount of upside fixes (losing money per
//      order, a regulatory wall, a saturated market) cap the score.
//
// Data confidence is computed separately and never changes the opportunity
// score: a promising product on thin evidence stays promising, and the UI
// says how thin the evidence is. "Evidence-weighted opportunity" combines
// the two for rankings that should prefer well-evidenced products.

import { v, known, isVal, quality, derivedStatus } from "./provenance.js";
import { adPotentialOf } from "./economics.js";

export const WEIGHTS = {
  margin: 12,
  profit: 12,
  demand: 16,
  trend: 12,
  competition: 14,
  marketing: 12,
  brandability: 8,
  growth: 6,
  repeat: 4,
  ease: 4,
};

export const COMPONENT_LABELS = {
  margin: "Margin", profit: "Profit per order", demand: "Demand", trend: "Trend",
  competition: "Competition (inverted)", marketing: "Marketing potential", brandability: "Brandability",
  growth: "Market growth", repeat: "Repeat purchase", ease: "Ease of launch",
};

const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const n = (x, d = 50) => {
  const y = v(x);
  return typeof y === "number" && Number.isFinite(y) ? y : d;
};
const has = (x) => known(x) && typeof v(x) === "number";

function interp(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i], [x0, y0] = points[i - 1];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return points[points.length - 1][1];
}

export function growthScore(pct) {
  if (pct == null) return null;
  if (pct < 0) return clamp(25 + pct * 2);
  return interp([[0, 25], [3, 40], [5, 50], [10, 65], [20, 80], [40, 92], [100, 100]], pct);
}

// ── Market stage ────────────────────────────────────────────────────────
export function stageOf(mk, core) {
  const T = n(mk.trend), A = n(mk.trendAcceleration, 0), C = n(mk.competition), S = n(mk.saturation, C);
  const D = v(mk.trendDirection) || "flat", Dm = n(mk.demand);
  const why = [];
  let stage;
  if (D === "down") {
    stage = S >= 75 ? "Saturated" : "Declining";
    why.push(`Trend direction is down`);
  } else if (S >= 80 && C >= 75) {
    stage = "Saturated";
    why.push(`Saturation ${S} and competition ${C} are both very high`);
  } else if (A >= 25 && C < 45 && Dm < 65) {
    stage = "Emerging";
    why.push(`Interest is accelerating (+${A} %) while competition (${C}) and demand (${Dm}) are still low`);
  } else if (A >= 10 && C < 60) {
    stage = "Early Growth";
    why.push(`Interest is growing (+${A} %) and competition (${C}) has not caught up`);
  } else if (T >= 80 && A <= 5) {
    stage = "Peak";
    why.push(`Trend is high (${T}) but no longer accelerating (${A >= 0 ? "+" : ""}${A} %)`);
  } else if (T >= 55 || A > 0) {
    stage = "Growing";
    why.push(`Trend ${T}, acceleration ${A >= 0 ? "+" : ""}${A} %, competition ${C}`);
  } else {
    stage = "Peak";
    why.push(`Stable, mature demand with little growth (trend ${T})`);
  }
  const status = derivedStatus(mk.trend, mk.trendAcceleration, mk.competition);
  return { stage, why, status };
}

// ── Sub-scores ──────────────────────────────────────────────────────────
export function subScores(core, mk, econ, cfg) {
  const margin = has(econ.margin) ? clamp(((v(econ.margin) - 30) / 45) * 100) : null;
  // Profit after ads, judged both relative to the price (net margin; 25 %
  // after ads is excellent) and in absolute pounds (£15 an order after ads
  // funds scaling and creative). Losing money scores 0.
  const profitGBP = has(econ.profitGBP) ? v(econ.profitGBP) : null;
  const net = has(econ.netMargin) ? v(econ.netMargin) : null;
  const profit = profitGBP == null ? null
    : profitGBP <= 0 ? 0
    : 0.5 * clamp(((net ?? 0) / 25) * 100) + 0.5 * clamp((profitGBP / 15) * 100);
  const comp = has(mk.competition) ? clamp(100 - (0.7 * n(mk.competition) + 0.3 * n(mk.saturation, n(mk.competition)))) : null;
  const adPotential = adPotentialOf(mk);
  const marketing = 0.6 * adPotential + 0.25 * n(core.viral) + 0.15 * n(mk.organic);
  const growth = growthScore(has(mk.growth) ? v(mk.growth) : null);
  const repeat = 0.7 * n(core.repeat, 20) + 0.3 * n(core.subscription, 10);
  const startupGBP = n(econ.startupCost, 0) * cfg.fxToGBP;
  const capitalBurden = clamp(((startupGBP - 300) / (5000 - 300)) * 100);
  const ease = clamp(100 - (0.25 * n(core.supplierDifficulty) + 0.2 * n(core.shippingDifficulty)
    + 0.2 * n(mk.regulatoryRisk) + 0.2 * capitalBurden + 0.15 * n(core.damageRisk)));
  return {
    margin, profit, demand: has(mk.demand) ? n(mk.demand) : null, trend: has(mk.trend) ? n(mk.trend) : null,
    competition: comp, marketing, brandability: has(core.brandability) ? n(core.brandability) : null,
    growth, repeat, ease, adPotential, capitalBurden, startupGBP, profitGBP,
  };
}

// ── Risk ────────────────────────────────────────────────────────────────
export const RISK_WEIGHTS = {
  competition: 12, differentiation: 10, trendDependency: 9, seasonality: 8, regulation: 14,
  returns: 10, shipping: 6, quality: 6, supplier: 6, ip: 10, adDependency: 5, lowRepeat: 4,
};

export function riskOf(core, mk, econ, stage) {
  const late = ["Peak", "Declining", "Saturated"].includes(stage);
  const returnsF = Math.max(n(core.returnRisk, 30), clamp(n(econ.returnRate, 8) * 3));
  const f = {
    competition: { value: n(mk.competition), label: "High competition", detail: `competition ${n(mk.competition)}` },
    differentiation: { value: 100 - n(core.differentiation), label: "Low differentiation", detail: `differentiation potential ${n(core.differentiation)}` },
    trendDependency: {
      value: clamp(40 + (n(core.viral) - n(mk.demand)) * 0.8 + (late ? 25 : 0)),
      label: "Trend dependency", detail: late ? `late in the cycle (${stage})` : `viral ${n(core.viral)} vs demand ${n(mk.demand)}`,
    },
    seasonality: { value: n(mk.seasonalityRisk, 30), label: "Seasonality", detail: v(mk.seasonality) || "" },
    regulation: { value: n(mk.regulatoryRisk, 20), label: "Regulation", detail: v(mk.regulatoryNotes) || "" },
    returns: { value: returnsF, label: "Returns", detail: `return rate about ${n(econ.returnRate, 8)} %` },
    shipping: { value: n(core.shippingDifficulty, 30), label: "Shipping", detail: `${v(core.size) || "M"}, ${n(core.weight, 0.5)} kg` },
    quality: { value: n(core.damageRisk, 30), label: "Quality and damage", detail: "" },
    supplier: { value: n(core.supplierDifficulty, 30), label: "Supplier dependency", detail: "" },
    ip: { value: n(mk.ipRisk, 15), label: "Copyright / IP", detail: v(mk.ipNotes) || "" },
    adDependency: { value: clamp(100 - Math.max(n(mk.organic), n(mk.seo))), label: "Advertising dependency", detail: `organic ${n(mk.organic)}, SEO ${n(mk.seo)}` },
    lowRepeat: { value: 100 - n(core.repeat, 20), label: "Low repeat purchase", detail: `repeat potential ${n(core.repeat, 20)}` },
  };
  let score = 0;
  for (const [k, w] of Object.entries(RISK_WEIGHTS)) score += (w * f[k].value) / 100;
  const factors = Object.entries(f)
    .map(([k, x]) => ({ key: k, ...x, weight: RISK_WEIGHTS[k], points: round1((RISK_WEIGHTS[k] * x.value) / 100) }))
    .sort((a, b) => b.points - a.points);
  return { score: Math.round(score), factors };
}

// ── Red flags ───────────────────────────────────────────────────────────
export function redFlagsOf(core, mk, econ, sub, stage, confidence) {
  const out = [];
  const add = (severity, title, detail) => out.push({ severity, title, detail });
  const rr = n(econ.returnRate, 8);
  if (n(core.returnRisk, 0) >= 65 || rr >= 20) add("warning", "High return risk", `Expected returns around ${rr} %. ${rr >= 20 ? "That alone can erase the margin." : ""}`.trim());
  if (n(mk.competition) >= 75 && n(mk.saturation, n(mk.competition)) >= 70) add("critical", "Too saturated", `Competition ${n(mk.competition)}, saturation ${n(mk.saturation)}.`);
  if (n(core.differentiation) <= 35) add("warning", "Low differentiation", "Hard to offer anything a cheaper listing does not.");
  if (has(econ.margin) && v(econ.margin) < 45) add(v(econ.margin) < 35 ? "critical" : "warning", "Bad margins", `Gross margin ${v(econ.margin)} % before ads and returns.`);
  if (has(econ.profit) && v(econ.profit) <= 0) add("critical", "Loses money at the estimated CAC", `Expected ${v(econ.profit)} per order after ads.`);
  else if (sub.profitGBP != null && sub.profitGBP < 4) add("warning", "Too little profit per order for paid ads", `About £${sub.profitGBP.toFixed(2)} per order after ads.`);
  if (n(core.weight, 0) >= 5 || v(core.size) === "XL") add("warning", "Heavy or bulky product", `${n(core.weight, 0)} kg, size ${v(core.size) || "?"}.`);
  if (n(core.shippingDifficulty, 0) >= 70) add("warning", "Difficult shipping", "");
  if (n(mk.competitorStrength, 0) >= 80) add("warning", "Strong incumbents", (v(mk.marketLeaders) || []).slice(0, 3).join(", "));
  if (n(mk.regulatoryRisk, 0) >= 60) add(n(mk.regulatoryRisk) >= 75 ? "critical" : "warning", "Regulatory concerns", v(mk.regulatoryNotes) || "");
  if (n(mk.ipRisk, 0) >= 60) add(n(mk.ipRisk) >= 75 ? "critical" : "warning", "IP / trademark risk", v(mk.ipNotes) || "");
  if (["Peak", "Declining", "Saturated"].includes(stage) && n(core.viral) >= 70 && n(mk.demand) < 55) add("warning", "Short-lived trend", `${stage} stage with attention running ahead of demand.`);
  if (n(mk.meta, 50) <= 15) add("critical", "Advertising restricted", "Meta does not allow ads for this product category.");
  if (n(mk.seasonalityRisk, 0) >= 70) add("warning", "Narrow selling season", v(mk.seasonality) || "");
  if (sub.startupGBP >= 5000) add("warning", "High capital requirement", `About £${Math.round(sub.startupGBP).toLocaleString("en-GB")} before the first ad.`);
  if (confidence < 35) add("warning", "Thin evidence", `Data confidence ${confidence}/100: most inputs are AI estimates.`);
  return out;
}

// ── Data confidence ─────────────────────────────────────────────────────
export const CONFIDENCE_WEIGHTS = {
  price: 8, supplierPrice: 10, shipping: 4, cac: 10, returnRate: 6, demand: 12, trend: 10,
  trendAcceleration: 6, competition: 10, saturation: 4, regulatoryRisk: 6, ipRisk: 4,
  brandability: 3, viral: 3, growth: 4,
};

export function confidenceOf(core, mk, econ, evidenceIndex, evidenceIds) {
  const pick = { ...core, ...mk, supplierPrice: econ.supplierPrice, shipping: econ.shipping, cac: econ.cac,
    returnRate: econ.returnRate, price: econ.price };
  let tot = 0, got = 0;
  const parts = [];
  for (const [k, w] of Object.entries(CONFIDENCE_WEIGHTS)) {
    const q = quality(pick[k], evidenceIndex);
    tot += w; got += w * q;
    parts.push({ key: k, weight: w, quality: q, status: isVal(pick[k]) ? pick[k].s : "N" });
  }
  const strong = (evidenceIds || []).map((id) => evidenceIndex[id]).filter((e) => e && (e.level === "A" || e.level === "B"));
  const bonus = Math.min(12, strong.length * 3);
  const score = Math.round(clamp((got / tot) * 100 + bonus));
  const mix = { V: 0, E: 0, A: 0, N: 0 };
  for (const p of parts) mix[p.status] += p.weight;
  return { score, bonus, parts, mix: Object.fromEntries(Object.entries(mix).map(([k, w]) => [k, Math.round((w / tot) * 100)])) };
}

// ── Validation: proven demand vs. attention ─────────────────────────────
// Three kinds of evidence, kept apart on purpose:
//   commercial   someone paid for it (sales, revenue, units, reviews)
//   interest     people are looking at it (search, social, media)
//   base         how many people could buy it (population, participation)
const COMMERCIAL = new Set(["sales", "revenue", "units", "orders", "reviews", "own_sales"]);
const INTEREST = new Set(["search", "social", "media"]);
const BASE = new Set(["population", "participation"]);

function grade(evs, marketCode) {
  if (!evs.length) return { grade: "None", best: null };
  const rank = { A: 5, B: 4, C: 3, D: 2, E: 1 };
  let best = null, bestScore = -1;
  for (const e of evs) {
    const inMarket = e.market === marketCode;
    const s = (e.kind === "own_sales" && !e.unverified ? 6 : rank[e.level] || 0) + (inMarket ? 0.5 : 0);
    if (s > bestScore) { bestScore = s; best = e; }
  }
  const inMarket = best.market === marketCode;
  let g;
  if ((best.kind === "own_sales" && !best.unverified) || ((best.level === "A" || best.level === "B") && inMarket)) g = "Strong";
  else if (best.level === "A" || best.level === "B" || (best.level === "C" && inMarket) || best.kind === "own_sales") g = "Medium";
  else g = "Weak";
  return { grade: g, best, inMarket };
}

export function validationOf(evidenceIds, evidenceIndex, marketCode) {
  const evs = (evidenceIds || []).map((id) => evidenceIndex[id]).filter(Boolean);
  const commercial = evs.filter((e) => COMMERCIAL.has(e.kind));
  const interest = evs.filter((e) => INTEREST.has(e.kind));
  const base = evs.filter((e) => BASE.has(e.kind));
  const c = grade(commercial, marketCode), i = grade(interest, marketCode), b = grade(base, marketCode);
  const rank = { None: 0, Weak: 1, Medium: 2, Strong: 3 };
  const notes = [];
  if (rank[i.grade] > rank[c.grade]) notes.push("Trending is not the same as proven demand here: the evidence of interest is stronger than the evidence of sales.");
  if (c.best?.kind === "own_sales" && c.best.unverified) notes.push("Your own sales figures were entered by hand, not synced from Shopify, so they count as self-reported until real orders sync.");
  if (c.grade !== "None" && c.best && c.best.market !== marketCode && c.best.kind !== "own_sales") notes.push(`The sales evidence comes from ${c.best.market}, not ${marketCode}. It shows the product sells somewhere, not that it sells here.`);
  if (c.grade === "None") notes.push("No commercial evidence: nothing in the database shows anyone paying for this product yet.");
  if (rank[b.grade] >= 2 && rank[c.grade] < 2) notes.push("A large group of potential buyers exists (population or participation data), but that shows who could buy, not that they do.");
  const buckets = { Strong: [], Medium: [], Weak: [] };
  for (const e of evs) {
    const inMarket = e.market === marketCode;
    const b = (e.kind === "own_sales" && !e.unverified) || ((e.level === "A" || e.level === "B") && inMarket) ? "Strong"
      : e.level === "A" || e.level === "B" || e.level === "C" ? "Medium" : "Weak";
    buckets[b].push(e);
  }
  return { commercial: c, interest: i, base: b, notes, buckets, count: evs.length };
}

// ── Opportunity ─────────────────────────────────────────────────────────
export function scoreProduct({ core, mk, econ, cfg, evidenceIndex, evidenceIds }) {
  const sub = subScores(core, mk, econ, cfg);
  const st = stageOf(mk, core);
  const risk = riskOf(core, mk, econ, st.stage);
  const conf = confidenceOf(core, mk, econ, evidenceIndex, evidenceIds);

  // 1. Weighted components. A missing sub-score counts as neutral (50) and
  //    is listed as missing, so absent data neither helps nor hurts.
  const components = Object.entries(WEIGHTS).map(([k, w]) => {
    const raw = sub[k];
    const value = raw == null ? 50 : raw;
    return { key: k, label: COMPONENT_LABELS[k], weight: w, value: Math.round(value), missing: raw == null,
      points: round1((w * value) / 100), delta: round1((w * (value - 50)) / 100) };
  });
  const base = components.reduce((a, c) => a + c.points, 0);

  // 2. Interactions.
  const interactions = [];
  const marginPct = has(econ.margin) ? v(econ.margin) : null;
  const C = n(mk.competition), viral = n(core.viral), demand = n(mk.demand), diff = n(core.differentiation);
  if (["Emerging", "Early Growth"].includes(st.stage) && marginPct != null && marginPct >= 60 && C <= 45)
    interactions.push({ points: 5, label: "Early stage with high margin and low competition" });
  if (viral >= 70 && demand < 45)
    interactions.push({ points: -5, label: "Attention without proven demand" });
  if (C >= 70 && diff <= 35)
    interactions.push({ points: -6, label: "Commodity trap: crowded and hard to differentiate" });
  if (st.stage === "Declining") interactions.push({ points: -6, label: "Declining market" });
  else if (st.stage === "Peak" || st.stage === "Saturated") interactions.push({ points: -4, label: `${st.stage} stage: the easy growth is over` });
  const inter = interactions.reduce((a, x) => a + x.points, 0);

  // 3. Risk adjustment: no penalty up to risk 25, up to −30 % at risk 100.
  const riskFactor = 1 - 0.3 * clamp((risk.score - 25) / 75, 0, 1);
  const beforeRisk = base + inter;
  const afterRisk = beforeRisk * riskFactor;

  // 4. Caps.
  const caps = [];
  if (has(econ.profit) && v(econ.profit) <= 0) caps.push({ cap: 45, label: "Loses money per order at the estimated CAC" });
  if (marginPct != null && marginPct < 35) caps.push({ cap: 55, label: "Gross margin under 35 %" });
  if (n(mk.regulatoryRisk, 0) >= 75) caps.push({ cap: 50, label: "Regulatory barrier" });
  if (n(mk.ipRisk, 0) >= 75) caps.push({ cap: 50, label: "Serious IP / trademark risk" });
  if (n(mk.meta, 50) <= 15) caps.push({ cap: 60, label: "Main ad channel restricted" });
  if (st.stage === "Saturated") caps.push({ cap: 60, label: "Saturated market" });
  if (n(core.weight, 0) >= 15) caps.push({ cap: 55, label: "Too heavy for a small operator" });
  const cap = caps.length ? Math.min(...caps.map((c) => c.cap)) : 100;
  const opportunity = Math.round(clamp(Math.min(cap, afterRisk)));

  const redFlags = redFlagsOf(core, mk, econ, sub, st.stage, conf.score);
  const validation = validationOf(evidenceIds, evidenceIndex, cfg.code);

  return {
    opportunity,
    evidenceWeighted: Math.round(opportunity * (0.6 + (0.4 * conf.score) / 100)),
    confidence: conf.score,
    risk: risk.score,
    stage: st.stage,
    marginScore: sub.margin == null ? null : Math.round(sub.margin),
    profitScore: sub.profit == null ? null : Math.round(sub.profit),
    adPotential: Math.round(sub.adPotential),
    repeatScore: Math.round(sub.repeat),
    growthScore: sub.growth == null ? null : Math.round(sub.growth),
    ease: Math.round(sub.ease),
    _detail: {
      components, base: round1(base), interactions, beforeRisk: round1(beforeRisk), riskFactor: round1(riskFactor * 100) / 100,
      afterRisk: round1(afterRisk), caps, cap, riskDetail: risk, confidence: conf, stage: st, redFlags, validation, sub,
    },
  };
}

// Plain-language reasons for the score: positives and negatives, ordered by
// how many points each moved the score away from neutral.
export function explain(scored, core, mk, econ) {
  const d = scored._detail;
  const pos = [], neg = [];
  const say = (key) => {
    const s = d.sub;
    switch (key) {
      case "margin": return v(econ.margin) != null ? `${v(econ.margin)} % gross margin` : "margin unknown";
      case "profit": return s.profitGBP != null ? `about £${s.profitGBP.toFixed(2)} profit per order after ads` : "profit unknown";
      case "demand": return `demand ${n(mk.demand)}/100`;
      case "trend": return `trend ${n(mk.trend)}/100${has(mk.trendAcceleration) ? `, ${v(mk.trendAcceleration) >= 0 ? "+" : ""}${v(mk.trendAcceleration)} %` : ""}`;
      case "competition": return `competition ${n(mk.competition)}/100`;
      case "marketing": return `ad potential ${Math.round(s.adPotential)}/100`;
      case "brandability": return `brandability ${n(core.brandability)}/100`;
      case "growth": return has(mk.growth) ? `market growth about ${v(mk.growth)} % a year` : "growth unknown";
      case "repeat": return `repeat potential ${n(core.repeat, 20)}/100`;
      case "ease": return `ease of launch ${Math.round(s.ease)}/100`;
      default: return "";
    }
  };
  const goodWord = { margin: "High margin", profit: "Strong profit per order", demand: "Strong demand", trend: "Growing trend",
    competition: "Relatively low competition", marketing: "Good ad and content potential", brandability: "Brandable",
    growth: "Growing market", repeat: "Repeat purchases", ease: "Easy to launch" };
  const badWord = { margin: "Thin margin", profit: "Weak profit per order", demand: "Weak demand", trend: "Flat or falling trend",
    competition: "Crowded market", marketing: "Hard to advertise", brandability: "Hard to build a brand on",
    growth: "Slow market", repeat: "One-off purchase", ease: "Hard to launch" };
  for (const c of d.components) {
    if (c.missing) continue;
    if (c.delta >= 1.5) pos.push({ text: goodWord[c.key], detail: say(c.key), points: c.delta });
    else if (c.delta <= -1.5) neg.push({ text: badWord[c.key], detail: say(c.key), points: c.delta });
  }
  for (const x of d.interactions) (x.points > 0 ? pos : neg).push({ text: x.label, detail: "interaction", points: x.points });
  const riskPts = round1(d.afterRisk - d.beforeRisk);
  if (riskPts <= -1) {
    const top = d.riskDetail.factors.filter((f) => f.value >= 55).slice(0, 3).map((f) => f.label.toLowerCase());
    neg.push({ text: `Risk ${d.riskDetail.score}/100`, detail: top.length ? top.join(", ") : "spread across factors", points: riskPts });
  }
  for (const c of d.caps) if (c.cap === d.cap && d.cap < d.afterRisk) neg.push({ text: `Capped at ${c.cap}`, detail: c.label, points: round1(c.cap - d.afterRisk) });
  pos.sort((a, b) => b.points - a.points);
  neg.sort((a, b) => a.points - b.points);
  return { positives: pos, negatives: neg, missing: d.components.filter((c) => c.missing).map((c) => c.label) };
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

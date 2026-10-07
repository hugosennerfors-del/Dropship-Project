// Deterministic answers written from the database. Used when Claude is not
// available, and as the data Claude's tools return. Every number comes from
// the rows; product mentions are [[id]] tokens the chat turns into links.

import { query, SORTS, AD_TEST_GBP } from "../core/query.js";
import { FIELD } from "../core/fields.js";
import { opWord } from "../core/nlq.js";
import { MARKETS } from "../core/markets.js";

const cur = (r) => r.currency || "GBP";
export function m(x, currency) {
  if (x == null || !Number.isFinite(x)) return "—";
  if (currency === "SEK") return `${Math.round(x).toLocaleString("sv-SE")} kr`;
  const d = Math.abs(x) >= 1000 || Number.isInteger(x) ? 0 : 2;
  const s = Math.abs(x).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${x < 0 ? "−" : ""}£${s}`;
}
const p1 = (x) => (x == null ? "—" : `${Math.round(x * 10) / 10}%`);
const r0 = (x) => (x == null ? "—" : Math.round(x));

export function filterLabel(f, market) {
  if (f.field === "text") return `matches “${f.value}”`;
  const fd = FIELD[f.field];
  const label = fd?.label || f.field;
  const fmtV = (v) => (fd?.type === "money" ? m(v, MARKETS[market]?.currency) : fd?.type === "pct" ? `${v}%` : Array.isArray(v) ? v.join(", ") : v);
  if (f.op === "between") return `${label} between ${fmtV(f.value[0])} and ${fmtV(f.value[1])}`;
  if (f.op === "in") return `${label}: ${(Array.isArray(f.value) ? f.value : [f.value]).join(" or ")}`;
  return `${label} ${opWord(f.op)} ${fmtV(f.value)}`;
}

// One line per product, the facts the reasoning rests on.
export function productLine(r, i) {
  const bits = [
    `opportunity **${r0(r.opportunity)}**`,
    `margin ${p1(r.margin)}`,
    `${m(r.profit, cur(r))} profit/order after est. CAC`,
    `demand ${r0(r.demand)}`,
    `competition ${r0(r.competition)}`,
    r.stage,
    `confidence ${r0(r.confidence)}`,
  ];
  return `${i != null ? `${i + 1}. ` : "- "}[[${r.id}]] — ${bits.join(" · ")}`;
}

export function whyLine(r, why) {
  const pos = why?.positives?.[0], neg = why?.negatives?.[0];
  const parts = [];
  if (pos) parts.push(`strongest point: ${pos.text.toLowerCase()} (${pos.detail})`);
  if (neg) parts.push(`biggest drag: ${neg.text.toLowerCase()} (${neg.detail})`);
  return parts.length ? `   ${parts.join("; ")}.` : "";
}

// Which filters exclude the most rows, and the closest matches.
export function nearMisses(rows, spec, n = 5) {
  const fs = spec.filters || [];
  const pass = (r, f) => query([r], { filters: [f] }).rows.length === 1;
  const scored = rows.map((r) => ({ r, fails: fs.filter((f) => !pass(r, f)) }))
    .filter((x) => x.fails.length < fs.length)
    .sort((a, b) => a.fails.length - b.fails.length || (b.r.opportunity ?? 0) - (a.r.opportunity ?? 0));
  const blockers = fs.map((f) => ({ f, excluded: rows.filter((r) => !pass(r, f)).length })).sort((a, b) => b.excluded - a.excluded);
  return { closest: scored.slice(0, n), blockers };
}

export function answerQuery(rows, spec, ctx) {
  const market = ctx.market;
  const res = query(rows, { ...spec, limit: spec.limit || 10 });
  const labels = (spec.filters || []).map((f) => filterLabel(f, market));
  const sortLabel = typeof spec.sort === "string" ? SORTS[spec.sort]?.label || FIELD[spec.sort]?.label : spec.sort?.label || null;
  const lines = [];
  const scope = spec.within ? `Of the ${spec.within.length} products in the last answer, ` : "";
  if (!res.total) {
    const nm = nearMisses(spec.within ? rows.filter((r) => spec.within.includes(r.id)) : rows, spec);
    lines.push(`${scope}no ${MARKETS[market].name} product in the database meets all of: ${labels.join(", ") || "your conditions"}.`);
    if (nm.blockers.length) {
      lines.push("", `The strictest condition is **${filterLabel(nm.blockers[0].f, market)}**, which rules out ${nm.blockers[0].excluded} of ${rows.length} products.`);
    }
    if (nm.closest.length) {
      lines.push("", "Closest matches (missing conditions in brackets):");
      nm.closest.forEach((x, i) => lines.push(`${productLine(x.r, i)} (misses ${x.fails.map((f) => filterLabel(f, market)).join(", ")})`));
      return { text: lines.join("\n"), ids: nm.closest.map((x) => x.r.id), spec, total: 0 };
    }
    return { text: lines.join("\n"), ids: [], spec, total: 0 };
  }
  const sl = sortLabel || "highest opportunity";
  const ranked = `ranked by ${/^[A-Z][a-z]/.test(sl) && !/^(TikTok|Meta|Instagram|Google|SEO|UGC|AOV)/.test(sl) ? sl[0].toLowerCase() + sl.slice(1) : sl}:`;
  lines.push(`${scope}${res.total} ${res.total === 1 ? "product matches" : "products match"}${labels.length ? ` ${labels.join(", ")}` : ""} in the ${MARKETS[market].name}. ${res.total > res.rows.length ? `Top ${res.rows.length}, ${ranked}` : ranked[0].toUpperCase() + ranked.slice(1)}`);
  lines.push("");
  res.rows.forEach((r, i) => {
    lines.push(productLine(r, i));
    const w = whyLine(r, ctx.whyOf?.(r.id));
    if (w) lines.push(w);
  });
  lines.push("", confidenceNote(res.rows));
  return { text: lines.join("\n"), ids: res.rows.map((r) => r.id), spec, total: res.total };
}

export function confidenceNote(rs) {
  if (!rs.length) return "";
  const avg = rs.reduce((a, r) => a + (r.confidence || 0), 0) / rs.length;
  const proven = rs.filter((r) => r.validation === "Strong" || r.validation === "Medium").length;
  return `Average data confidence is ${Math.round(avg)}/100${proven ? `; ${proven} of ${rs.length} have commercial evidence` : "; none has commercial evidence in the database yet"}. Treat AI-estimated values as hypotheses to test.`;
}

export function answerPick(rows, spec, ctx) {
  const res = query(rows, { ...spec, limit: 5 });
  if (!res.rows.length) return answerQuery(rows, spec, ctx);
  const best = res.rows[0];
  const lines = [];
  if (spec.sort === "safest") {
    const det = ctx.scoresOf?.(best.id);
    const top = det?.riskDetail?.factors?.slice(0, 3).map((f) => `${f.label.toLowerCase()} ${Math.round(f.value)}`) || [];
    lines.push(`The safest of these is [[${best.id}]] with a risk score of **${best.risk}/100**, the lowest in the group.`);
    if (top.length) lines.push(`Its main remaining risks: ${top.join(", ")}.`);
    if (best.redFlags?.length) lines.push(`Red flags to check: ${best.redFlags.join(", ")}.`);
  } else {
    lines.push(`My pick from these is [[${best.id}]]: evidence-weighted opportunity **${best.evidenceWeighted}**, opportunity ${best.opportunity}, confidence ${best.confidence}.`);
    const w = whyLine(best, ctx.whyOf?.(best.id));
    if (w) lines.push(w.trim());
  }
  lines.push("", `Ranked by ${(SORTS[spec.sort]?.label || spec.sort || "opportunity").toLowerCase()}:`);
  res.rows.forEach((r, i) => lines.push(`${i + 1}. [[${r.id}]] — risk ${r.risk} · opportunity ${r.opportunity} · ${m(r.profit, cur(r))}/order · ${r.stage}`));
  return { text: lines.join("\n"), ids: res.rows.map((r) => r.id), spec, total: res.total };
}

// Why is A better than B: component by component.
export function answerWhy(a, b, ctx) {
  const sa = ctx.scoresOf?.(a.id), sb = ctx.scoresOf?.(b.id);
  const lines = [];
  const better = (a.opportunity ?? 0) >= (b.opportunity ?? 0) ? [a, b, sa, sb] : [b, a, sb, sa];
  const [x, y, sx, sy] = better;
  lines.push(`[[${x.id}]] scores **${x.opportunity}** against **${y.opportunity}** for [[${y.id}]]${x.id !== a.id ? " (so the premise is the other way round)" : ""}.`);
  if (sx && sy) {
    const diffs = sx.components.map((c) => {
      const o = sy.components.find((d) => d.key === c.key);
      return { label: c.label, d: Math.round((c.points - (o?.points ?? 0)) * 10) / 10, a: c.value, b: o?.value };
    }).filter((d) => Math.abs(d.d) >= 0.5).sort((p, q) => q.d - p.d);
    const plus = diffs.filter((d) => d.d > 0), minus = diffs.filter((d) => d.d < 0);
    if (plus.length) {
      lines.push("", "Where it gains points:");
      plus.slice(0, 5).forEach((d) => lines.push(`- ${d.label}: ${d.a} vs ${d.b} (+${d.d} points)`));
    }
    if (minus.length) {
      lines.push("", "Where it loses points:");
      minus.slice(0, 4).forEach((d) => lines.push(`- ${d.label}: ${d.a} vs ${d.b} (${d.d} points)`));
    }
    const capX = sx.caps?.length ? sx.caps.find((c) => c.cap === sx.cap) : null, capY = sy.caps?.length ? sy.caps.find((c) => c.cap === sy.cap) : null;
    if (capY && capY.cap < (sy.afterRisk ?? 100)) lines.push("", `[[${y.id}]] is also capped at ${capY.cap}: ${capY.label.toLowerCase()}.`);
    if (capX && capX.cap < (sx.afterRisk ?? 100)) lines.push("", `[[${x.id}]] is capped at ${capX.cap}: ${capX.label.toLowerCase()}.`);
    lines.push("", `Risk: ${x.risk} vs ${y.risk}. Data confidence: ${x.confidence} vs ${y.confidence}. Profit per order after estimated CAC: ${m(x.profit, cur(x))} vs ${m(y.profit, cur(y))}.`);
  }
  return { text: lines.join("\n"), ids: [x.id, y.id] };
}

export function answerEconomics(rs, ctx) {
  const lines = [];
  for (const r of rs.slice(0, 3)) {
    const c = cur(r);
    lines.push(`**[[${r.id}]]** (${MARKETS[r.market].name})`);
    lines.push(`- Price ${m(r.price, c)} incl. VAT → ${m(r.revenueEx, c)} ex VAT`);
    if (r._s?.variableCost === "V") lines.push(`- Your observed cost per order ${m(r.variableCost, c)} (product, shipping, fees)`);
    else lines.push(`- Landed cost ${m(r.landedCost, c)} (supplier ${m(r.supplierPrice, c)} + freight + duty), shipping ${m(r.shipping, c)}, fees ${m(r.paymentFees, c)}, packaging ${m(r.packaging, c)}`);
    lines.push(`- Gross margin ${p1(r.margin)}; contribution after ${p1(r.returnRate)} returns ${m(r.contribution, c)}`);
    lines.push(`- CAC ${m(r.cac, c)} (${statusWord(r._s?.cac)}) → profit ${m(r.profit, c)} per order, net margin ${p1(r.netMargin)}`);
    lines.push(`- Break-even ROAS ${r.breakEvenRoas ?? "—"}× vs ROAS at this CAC ${r.roas ?? "—"}×; max CAC ${m(r.maxCac, c)}`);
    lines.push(`- Launch cost ${m(r.startupCost, c)}; ${r.breakEvenOrders ? `break-even after ${r.breakEvenOrders} orders` : "never breaks even at this CAC"}`);
    lines.push("");
  }
  lines.push("Open a product to change any input in the calculator; your numbers replace the estimates.");
  return { text: lines.join("\n"), ids: rs.slice(0, 3).map((r) => r.id) };
}
const statusWord = (s) => ({ V: "verified", E: "estimated", A: "AI estimate", N: "unknown" }[s] || "modelled");

export function answerBudget(rows, spec, ctx) {
  const budget = spec.budgetGBP;
  const res = query(rows, { ...spec, limit: 5 });
  const lines = [];
  const scope = spec.within ? rows.filter((r) => spec.within.includes(r.id)) : rows;
  if (!res.rows.length) {
    const cheapest = [...scope].sort((a, b) => toGBP(a.startupCost, a) - toGBP(b.startupCost, b)).slice(0, 4);
    lines.push(`None of ${spec.within ? "these" : "the products"} fits a launch budget of **£${budget.toLocaleString("en-GB")}**. The budget has to cover the first stock order at MOQ, three samples, compliance, three UGC videos and a £${AD_TEST_GBP} ad test.`);
    lines.push("", "Cheapest to launch:");
    cheapest.forEach((r, i) => lines.push(`${i + 1}. [[${r.id}]] — about ${m(toGBP(r.startupCost, r) + AD_TEST_GBP, "GBP")} including the ad test (MOQ ${r.moq ?? "—"})`));
    lines.push("", "Negotiating a lower first order (many suppliers accept 50 units for a sample run) is the fastest way to bring these within budget.");
    return { text: lines.join("\n"), ids: cheapest.map((r) => r.id) };
  }
  const best = res.rows[0];
  lines.push(`With £${budget.toLocaleString("en-GB")} I would start with [[${best.id}]]: it fits the budget (about ${m(toGBP(best.startupCost, best) + AD_TEST_GBP, "GBP")} including a £${AD_TEST_GBP} ad test) and has the best evidence-weighted opportunity (${best.evidenceWeighted}) of the products that fit.`);
  const w = whyLine(best, ctx.whyOf?.(best.id));
  if (w) lines.push(w.trim());
  if ((best.profit ?? 0) <= 0) lines.push("", `Be aware that it loses money per order at the estimated CAC (${m(best.profit, cur(best))}). Run the test to measure your real CAC before ordering more stock.`);
  if (res.rows.length > 1) {
    lines.push("", "Also within budget:");
    res.rows.slice(1).forEach((r, i) => lines.push(`${i + 2}. [[${r.id}]] — launch ≈ ${m(toGBP(r.startupCost, r) + AD_TEST_GBP, "GBP")} · evidence-weighted ${r.evidenceWeighted}`));
  }
  return { text: lines.join("\n"), ids: res.rows.map((r) => r.id) };
}
const toGBP = (x, r) => (x == null ? Infinity : x * (r.currency === "SEK" ? MARKETS.SE.fxToGBP : 1));

export function answerProduct(r, ctx) {
  const why = ctx.whyOf?.(r.id);
  const lines = [`**[[${r.id}]]** — ${r.stage}, opportunity **${r.opportunity}**, risk ${r.risk}, data confidence ${r.confidence}.`];
  if (r.overview) lines.push("", r.overview);
  if (why?.positives?.length) { lines.push("", "Why it could work:"); why.positives.slice(0, 4).forEach((p) => lines.push(`- ${p.text} (${p.detail})`)); }
  if (why?.negatives?.length) { lines.push("", "Why it could fail:"); why.negatives.slice(0, 4).forEach((p) => lines.push(`- ${p.text} (${p.detail})`)); }
  if (r.redFlags?.length) lines.push("", `Red flags: ${r.redFlags.join(", ")}.`);
  lines.push("", `Validation: commercial evidence ${r.validation}, interest ${r.interest}.`);
  return { text: lines.join("\n"), ids: [r.id] };
}

export const HELP = [
  "I search and rank the product database. Try:",
  "- *Show products with margin > 60, price < £80 and competition < 40*",
  "- *Find products that cost under £30 and sell for at least £60*",
  "- *Emerging products with high margin and low competition*",
  "- *Top 5 pet products for TikTok*",
  "Then ask follow-ups: *Which one is the safest?* · *Why is number 3 better than number 1?* · *Which would you choose with £2,000?* · *Show me the unit economics*",
].join("\n");

// Products to stay away from, with the reasons. With a trend filter this
// answers "trending but poor potential".
export function answerAvoid(rows, spec, ctx) {
  const pool = query(rows, { filters: spec.filters, within: spec.within }).rows;
  const scoreOf = (r) => (r.redFlags || []).length * 6 + (100 - (r.opportunity ?? 50)) + ((r.profit ?? 0) <= 0 ? 10 : 0);
  const bad = pool.filter((r) => (r.opportunity ?? 100) < 40 || (r.redFlags || []).some((f) => /saturated|loses money|regulatory|ip|restricted|bad margins/i.test(f)))
    .sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, spec.limit || 6);
  const trending = (spec.filters || []).some((f) => f.field === "trend");
  if (!bad.length) return { text: `Nothing in this selection looks like a clear avoid: every product scores 40 or more without a serious red flag.`, ids: [] };
  const lines = [trending
    ? `These products get attention but the numbers behind them are weak. Trend is not the same as a business:`
    : `I would avoid or deprioritise these ${bad.length}, mainly because of the red flags below:`, ""];
  bad.forEach((r, i) => {
    const d = ctx.scoresOf?.(r.id);
    const crit = (d?.redFlags || []).filter((f) => f.severity === "critical").map((f) => f.title.toLowerCase());
    const warn = (d?.redFlags || []).filter((f) => f.severity !== "critical").map((f) => f.title.toLowerCase());
    lines.push(`${i + 1}. [[${r.id}]] — opportunity **${r.opportunity}**, trend ${r0(r.trend)}, ${r.stage.toLowerCase()}, ${m(r.profit, cur(r))} profit/order`);
    lines.push(`   ${crit.length ? `Deal-breakers: ${crit.join(", ")}. ` : ""}${warn.length ? `Also: ${warn.slice(0, 3).join(", ")}.` : ""}`.trimEnd());
  });
  lines.push("", "A product can still work if you fix its main problem (a better product, a higher price, an organic channel), but none of these should be a first test.");
  return { text: lines.join("\n"), ids: bad.map((r) => r.id) };
}

// "Which product would you test first?" — the best evidence-weighted
// product that can make money, with a test plan.
export function answerFirst(rows, spec, ctx) {
  const pool = query(rows, { filters: spec.filters, within: spec.within, sort: "evidence" }).rows;
  if (!pool.length) return answerQuery(rows, spec, ctx);
  const profitable = pool.filter((r) => (r.profit ?? 0) > 0);
  const pick = profitable[0] || pool[0];
  const why = ctx.whyOf?.(pick.id);
  const c = cur(pick);
  const lines = [`I would test [[${pick.id}]] first.`, ""];
  lines.push(`- Evidence-weighted opportunity **${pick.evidenceWeighted}** (opportunity ${pick.opportunity}, data confidence ${pick.confidence}), the best ${profitable[0] ? "of the products that make money at the estimated CAC" : "in the database"}.`);
  if (why?.positives?.length) lines.push(`- Strongest points: ${why.positives.slice(0, 3).map((x) => `${x.text.toLowerCase()} (${x.detail})`).join("; ")}.`);
  if (why?.negatives?.length) lines.push(`- What could sink it: ${why.negatives.slice(0, 2).map((x) => `${x.text.toLowerCase()} (${x.detail})`).join("; ")}.`);
  lines.push(`- Economics: ${m(pick.price, c)} price, ${p1(pick.margin)} gross margin, ${m(pick.profit, c)} per order after an estimated ${m(pick.cac, c)} CAC.`);
  lines.push("", "How I would test it:");
  lines.push(`1. Order samples and confirm the supplier price (the margin rests on ${pick._s?.supplierPrice === "A" ? "an AI estimate" : "an estimate"}).`);
  lines.push(`2. Spend about £300 on ads to measure the real CAC. Stop if it is above ${m(pick.maxCac, c)}, the break-even CAC.`);
  lines.push(`3. Launch cost before ads: about ${m(pick.startupCost, c)}${pick.breakEvenOrders ? `; ${pick.breakEvenOrders} orders to pay it back` : ""}.`);
  if (!profitable.length) lines.push("", `None of the products makes money at the estimated CAC, so treat this as the least weak option and focus the test on a higher price or a cheaper channel.`);
  else if (profitable.length > 1) lines.push("", `Runner-up: [[${profitable[1].id}]] (evidence-weighted ${profitable[1].evidenceWeighted}).`);
  return { text: lines.join("\n"), ids: [pick.id, ...(profitable[1] ? [profitable[1].id] : [])] };
}

// Niche finder from the database: niches and micro-niches ranked by a
// blend of opportunity, demand–competition gap and margin.
export function answerNiches(rows, spec, ctx, nichesFn) {
  const pool = query(rows, { filters: spec.filters.filter((f) => f.field !== "profit"), within: spec.within }).rows;
  const wantProfit = (spec.filters || []).some((f) => f.field === "profit");
  let ns = nichesFn(pool, "niche").map((n) => {
    const ps = pool.filter((r) => n.products.includes(r.id));
    const profitable = ps.filter((r) => (r.profit ?? 0) > 0).length;
    return { ...n, profitable, ps, rank: (n.opportunity ?? 0) * 0.5 + (n.gap ?? 0) * 0.3 + (((n.margin ?? 30) - 30) / 45) * 100 * 0.2 };
  });
  if (wantProfit) ns = ns.filter((n) => n.profitable > 0);
  ns.sort((a, b) => b.rank - a.rank);
  const lines = [`${wantProfit ? "Niches with at least one product that makes money at the estimated CAC" : "The strongest niches in the database"}, ${MARKETS[ctx.market].name}:`, ""];
  ns.slice(0, spec.limit || 6).forEach((n, i) => {
    const best = n.ps.find((r) => r.id === n.best) || n.ps[0];
    lines.push(`${i + 1}. **${n.name}** (${n.category}) — ${n.count} product${n.count > 1 ? "s" : ""}, demand ${r0(n.demand)}, competition ${r0(n.competition)}, margin ${p1(n.margin)}, avg opportunity ${r0(n.opportunity)}`);
    lines.push(`   Micro-niche: ${best?.microNiche || "—"}. Customer: ${best?.targetCustomer || "—"}`);
    if (best?.painPoint) lines.push(`   Problem: ${best.painPoint}`);
    lines.push(`   Best product: [[${best.id}]]${n.profitable ? `; ${n.profitable} profitable at est. CAC` : ""}.`);
  });
  if (!ns.length) lines.push("No niche matches. Remove a condition or run the niche scout for new ideas.");
  lines.push("", "These come from the products already analysed. The niche scout on the Niches page asks Claude for niches the database does not cover yet.");
  return { text: lines.join("\n"), ids: ns.slice(0, spec.limit || 6).map((n) => n.best) };
}

// "Best for TikTok / Instagram / Meta": the top products per platform.
export function answerPlatforms(rows, spec, ctx, platforms) {
  const others = (spec.filters || []).filter((f) => !platforms.includes(f.field));
  const pool = query(rows, { filters: others, within: spec.within }).rows;
  const lines = [`Best fit per channel, ${MARKETS[ctx.market].name} (potential 0–100, then opportunity):`, ""];
  const ids = [];
  for (const k of platforms) {
    const top = [...pool].filter((r) => r[k] != null).sort((a, b) => b[k] - a[k] || b.opportunity - a.opportunity).slice(0, 3);
    lines.push(`**${FIELD[k]?.label || k}**`);
    top.forEach((r, i) => { lines.push(`${i + 1}. [[${r.id}]] — ${k} ${r0(r[k])}, opportunity ${r.opportunity}, ${m(r.profit, cur(r))}/order`); ids.push(r.id); });
    lines.push("");
  }
  lines.push("Channel scores are AI estimates from the product's format (visual demo, impulse, giftability) and the UK audience; ad-library and creator data are not connected yet.");
  return { text: lines.join("\n"), ids: [...new Set(ids)] };
}

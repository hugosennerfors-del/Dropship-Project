// Automatic insights: short findings computed from the rows, each with the
// products it is about. Written by rules, not by a model, so they update the
// moment the data or your edits change.

import { niches } from "./query.js";

const fmtM = (x, c) => (c === "SEK" ? `${Math.round(x)} kr` : `£${x.toFixed(2)}`);

export function insights(rows, market, ownSales) {
  if (!rows.length) return [];
  const out = [];
  const add = (tone, title, text, ids = [], weight = 1) => out.push({ tone, title, text, ids, weight });

  // Profitability at a realistic CAC.
  const profitable = rows.filter((r) => (r.profit ?? 0) > 0);
  add(profitable.length / rows.length < 0.4 ? "warn" : "neutral",
    `${profitable.length} of ${rows.length} products make money at the estimated CAC`,
    profitable.length
      ? `The rest lose money per order once ads are paid. The estimated CAC is calibrated on your own campaigns, so a real test is the only way to know. Profitable now: ${profitable.slice(0, 4).map((r) => `[[${r.id}]]`).join(", ")}.`
      : "Every product loses money per order once ads are paid at the estimated CAC. Look for higher prices, bundles or organic channels before paid tests.",
    profitable.map((r) => r.id), 3);

  // Early stage with margin and room.
  const early = rows.filter((r) => ["Emerging", "Early Growth"].includes(r.stage) && (r.margin ?? 0) >= 50 && (r.competition ?? 100) <= 60)
    .sort((a, b) => b.opportunity - a.opportunity);
  if (early.length) add("good", "Early-stage products with margin and room to compete",
    `${early.map((r) => `[[${r.id}]] (${r.stage.toLowerCase()}, ${Math.round(r.margin)}% margin, competition ${r.competition})`).join(", ")}. These are the best candidates for a first test, provided the trend evidence holds up.`,
    early.map((r) => r.id), 3);

  // Trend vs commercial evidence.
  const hype = rows.filter((r) => (r.interest === "Strong" || r.interest === "Medium") && (r.validation === "None" || r.validation === "Weak"));
  if (hype.length) add("warn", "Interest without proof of sales",
    `${hype.slice(0, 5).map((r) => `[[${r.id}]]`).join(", ")}${hype.length > 5 ? ` and ${hype.length - 5} more` : ""} have search, social or media evidence but no sales evidence in the database. Trending is not the same as proven demand.`,
    hype.map((r) => r.id), 2);

  // Best evidenced.
  const proven = rows.filter((r) => r.validation === "Strong").sort((a, b) => b.evidenceWeighted - a.evidenceWeighted);
  if (proven.length) add("neutral", "Products with strong commercial evidence",
    `${proven.slice(0, 4).map((r) => `[[${r.id}]] (opportunity ${r.opportunity}, confidence ${r.confidence})`).join(", ")}. Strong evidence means someone demonstrably pays for this in ${market === "UK" ? "the UK" : "Sweden"} or in your own store.`,
    proven.map((r) => r.id), 2);

  // Your own store data.
  const own = rows.filter((r) => r._s?.cac === "V");
  if (own.length) {
    add(own.every((r) => (r.profit ?? 0) <= 0) ? "bad" : "neutral", "Your own products",
      own.map((r) => `[[${r.id}]] makes ${fmtM(r.contribution ?? 0, r.currency)} per order before ads and ${fmtM(r.profit ?? 0, r.currency)} after your actual CAC of ${fmtM(r.cac, r.currency)} (stage: ${r.stage.toLowerCase()}, competition ${r.competition})`).join("; ") + ".",
      own.map((r) => r.id), 3);
  }

  // Saturated or declining.
  const late = rows.filter((r) => ["Saturated", "Declining"].includes(r.stage));
  if (late.length) add("bad", `${late.length} products are past their window`,
    `${late.map((r) => `[[${r.id}]]`).join(", ")} are ${late.length > 1 ? "saturated or declining" : late[0].stage.toLowerCase()}. Enter only with a clearly better product or a channel competitors ignore.`,
    late.map((r) => r.id), 1);

  // Niche gap.
  const ns = niches(rows).filter((n) => n.gap != null).sort((a, b) => b.gap - a.gap);
  if (ns.length && ns[0].gap > 0) add("good", "Widest demand–competition gap",
    `${ns.slice(0, 3).map((n) => `${n.name} (demand ${Math.round(n.demand)}, competition ${Math.round(n.competition)})`).join(", ")}. A positive gap means people want it more than sellers supply it.`,
    ns.slice(0, 3).flatMap((n) => n.products), 2);

  // Regulation and IP.
  const reg = rows.filter((r) => (r.regulatoryRisk ?? 0) >= 60 || (r.ipRisk ?? 0) >= 60);
  if (reg.length) add("warn", "Legal checks before you source",
    reg.map((r) => `[[${r.id}]] (${(r.regulatoryRisk ?? 0) >= 60 ? `regulatory ${r.regulatoryRisk}` : ""}${(r.regulatoryRisk ?? 0) >= 60 && (r.ipRisk ?? 0) >= 60 ? ", " : ""}${(r.ipRisk ?? 0) >= 60 ? `IP ${r.ipRisk}` : ""})`).join(", ") + ".",
    reg.map((r) => r.id), 1);

  // Thin data overall.
  const avgConf = rows.reduce((a, r) => a + (r.confidence || 0), 0) / rows.length;
  add("neutral", `Average data confidence ${Math.round(avgConf)}/100`,
    "Most inputs are AI estimates built from cited research. Connecting a marketplace data source or verifying a supplier quote raises confidence fastest; supplier price, CAC and demand carry the most weight.",
    [], 1);

  return out.sort((a, b) => b.weight - a.weight);
}

// Unit tests for the core modules.   node test/unit.mjs
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeEconomics } from "../src/core/economics.js";
import { MARKETS } from "../src/core/markets.js";
import { val } from "../src/core/provenance.js";
import { parseQuestion } from "../src/core/nlq.js";
import { query } from "../src/core/query.js";
import { resolveProduct } from "../src/core/inherit.js";
import { applyOwnSales } from "../src/core/ownsales.js";
import { buildProduct, rowOf } from "../src/core/profile.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; } else { fail++; console.log("✗", name, extra); } };
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

// Economics: observed cost per order reproduces the store's own contribution.
{
  const core = { supplierPriceUSD: val(3.8, "E", ["x"]), inboundUSD: val(0.8, "A"), size: val("S", "A"), kind: "electrical" };
  const mk = { price: val(300, "V", ["x"]), variableCost: val(85, "V", ["x"]), returnRate: val(0, "V", ["x"]), cac: val(173.33, "V", ["x"]) };
  const e = computeEconomics(core, mk, MARKETS.SE);
  ok(near(e.margin.v, 64.6, 0.1), "margin from observed cost", e.margin.v);
  ok(near(e.contribution.v, 155), "contribution 240 − 85 = 155 with no returns", e.contribution.v);
  ok(near(e.profit.v, -18.33), "profit after CAC", e.profit.v);
  ok(e.margin.s === "E", "a formula over verified data is Estimated", e.margin.s);
  const worst = computeEconomics(core, mk, MARKETS.SE, { variableCost: 85 * 1.1 });
  ok(worst.contribution.v < e.contribution.v, "a cost override lowers contribution");
}
// Unknown return rate: an assumption is used and named, not zero.
{
  const core = { supplierPriceUSD: val(5, "A"), size: val("S", "A") };
  const mk = { price: val(25, "A"), returnRate: val(null, "N", null, "not tracked"), returnRateAssumed: val(12, "A") };
  const e = computeEconomics(core, mk, MARKETS.UK);
  ok(e.returnRate.v === 12 && e._breakdown.returnsAssumed, "assumed return rate when unknown", e.returnRate.v);
}
// Natural language → filters.
{
  const p = parseQuestion("Find products that cost under £30 and can be sold for at least £60", { market: "UK" });
  ok(p.filters.some((f) => f.field === "landedCost" && f.op === "<" && f.value === 30), "cost under £30 → landed cost", JSON.stringify(p.filters));
  ok(p.filters.some((f) => f.field === "price" && f.op === ">=" && f.value === 60), "sell for at least £60 → price", JSON.stringify(p.filters));
  const q = parseQuestion("margin > 60, price < £80, competition < 40, trend > 70 and brandability > 60", { market: "UK" });
  ok(q.filters.length === 5, "five numeric conditions", JSON.stringify(q.filters));
  const s = parseQuestion("Vilka produkter har hög marginal och låg konkurrens i Sverige?", {});
  ok(s.market === "SE" && s.filters.some((f) => f.field === "margin") && s.filters.some((f) => f.field === "competition"), "Swedish adjectives and market");
  const f = parseQuestion("Why is number 3 better than number 1?", { lastResultIds: ["a", "b", "c"] });
  ok(f.intent === "why" && f.refIds.join() === "c,a", "references to the previous list", JSON.stringify(f));
  const b = parseQuestion("best for beginners under £50", {});
  ok(b.sort === "beginners" && b.filters[0]?.field === "price", "money never attaches to a score field", JSON.stringify(b));
  const pm = (q) => parseQuestion(q, { market: "UK" });
  const g = pm("Ge mig 10 produkter i UK som har hög potential just nu och minst 60% uppskattad bruttomarginal.");
  ok(g.limit === 10 && g.filters.some((f) => f.field === "margin" && f.op === ">=" && f.value === 60), "percent binds to the margin word after it", JSON.stringify(g.filters));
  const v = pm("Visa produkter under £30 som kan säljas för minst £60.");
  ok(v.filters.some((f) => f.field === "landedCost" && f.value === 30) && v.filters.some((f) => f.field === "price" && f.value === 60), "contradicting price bounds: the lower is the cost", JSON.stringify(v.filters));
  ok(pm("Vilka produkter har möjlighet till återkommande köp?").filters.some((f) => f.field === "repeat"), "å/ä/ö words match");
  ok(pm("Vilka produkter är lätta att marknadsföra?").sort === "adPotential", "easy to market is not lightweight");
  ok(pm("Vilka produkter bör jag undvika?").intent === "avoid", "avoid intent");
  ok(pm("Vilken produkt skulle du själv testa först och varför?").intent === "first", "test-first intent");
  ok(pm("Find me profitable micro niches in the UK.").intent === "niches", "niche finder intent");
  ok(pm("Vilka produkter passar bäst för TikTok/Instagram/Meta Ads?").intent === "platforms", "several platforms");
  ok(typeof pm("Vilka produkter har bäst kombination av trend + marginal + låg konkurrens?").sort?.score === "function", "combination ranking");
  const early = pm("Vilka produkter är trendande men fortfarande tidiga?");
  ok(early.filters.some((f) => f.field === "stage" && f.value.includes("Early Growth")), "tidiga = emerging or early growth");
  const relaxed = pm("Vilka produkter har hög efterfrågan men relativt låg konkurrens?");
  ok(relaxed.filters.find((f) => f.field === "competition")?.value === 55, "relatively low relaxes the threshold");
  const m = parseQuestion("products under 300 kr", { market: "UK" });
  ok(near(m.filters[0].value, 23.4, 0.1), "kronor converted to pounds in the UK", JSON.stringify(m.filters));
}
// The dataset builds, inherits honestly and applies own sales.
{
  const ds = JSON.parse(await readFile(join(root, "db/build/dataset.json"), "utf8"));
  const ev = Object.fromEntries(ds.evidence.map((e) => [e.id, e]));
  const rows = { UK: [], SE: [] };
  for (const rec of ds.products) {
    const b = buildProduct(resolveProduct(applyOwnSales(rec, ds.ownSales.rows)), ev, {}, ds.overlays);
    for (const code of ["UK", "SE"]) { const r = rowOf(b, code); if (r) rows[code].push(r); }
  }
  ok(rows.UK.length === 31 && rows.SE.length === 19, "31 UK and 19 SE profiles", `${rows.UK.length}/${rows.SE.length}`);
  ok(rows.UK.every((r) => r.opportunity >= 0 && r.opportunity <= 100 && r.confidence >= 0 && r.confidence <= 100), "scores within 0–100");
  const posture = rows.SE.find((r) => r.id === "posture-corrector");
  ok(posture._s.cac === "E" && posture.cac === 105, "hand-entered store sales are Estimated", `${posture._s.cac} ${posture.cac}`);
  const robeSE = rows.SE.find((r) => r.id === "changing-robe");
  ok(!Object.entries(robeSE._s).some(([k, s]) => s === "V" && !["price"].includes(k)), "no Verified values carried from the UK into Sweden");
  const res = query(rows.UK, { filters: [{ field: "stage", op: "in", value: ["Emerging", "Early Growth"] }], sort: "opportunity" });
  ok(res.rows.every((r) => ["Emerging", "Early Growth"].includes(r.stage)), "stage filter");
  const budget = query(rows.UK, { budgetGBP: 2500, sort: "evidence" });
  ok(budget.rows.every((r) => r.startupCost + 300 <= 2500), "budget filter includes the ad test");
}

console.log(fail ? `✗ ${fail} failed, ${pass} passed` : `✓ ${pass} unit tests passed`);
process.exit(fail ? 1 : 0);

// Unit tests for the core modules.   node test/unit.mjs
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeEconomics } from "../src/core/economics.js";
import { MARKETS } from "../src/core/markets.js";
import { val } from "../src/core/provenance.js";
import { parseQuestion, researchTopic } from "../src/core/nlq.js";
import { fromGenerator, ideasFrom, researchRuns, toCountry } from "../src/core/candidates.js";
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
// Requests for new research, from a search field or the chat.
{
  ok(researchTopic("research dog toys")?.topic === "dog toys", "research X");
  const sv = researchTopic("Gör research på hundleksaker i Sverige");
  ok(sv?.topic === "hundleksaker" && sv.market === "SE", "Swedish request with a market", JSON.stringify(sv));
  ok(researchTopic("Kan du hitta nya produkter inom kallbad?")?.topic === "kallbad", "polite Swedish request");
  const en = researchTopic("Find new products in cold-water swimming for the UK");
  ok(en?.topic === "cold-water swimming" && en.market === "UK", "English request with a market", JSON.stringify(en));
  ok(researchTopic("Hitta nya produkter för hundägare")?.topic === "hundägare", "the topic keeps å, ä and ö");
  ok(researchTopic("Which products should I research first?") === null, "a question about research is not a request");
  ok(researchTopic("Show products with margin > 60") === null, "an ordinary question is not research");
  ok(parseQuestion("Research padel accessories", {}).intent === "research", "the parser marks it");
  ok(toCountry("UK") === "GB" && toCountry("SE") === "SE", "the generator calls the UK GB");
}
// A row from the Research generator becomes an inbox idea with honest numbers.
{
  const row = { id: "0b9d2f4e-1111-2222-3333-444455556666", name: "Padel grip kit", country: "GB", niche: "padel", cost_per_unit_incl_vat: "6.00",
    sale_price_incl_vat: "24.00", shipping_cost_per_order: "3.60", transaction_fee_per_order: "0.72", expected_cpa_incl_vat: "9.00", expected_units_per_order: "1",
    notes: "Grip tape and overgrips", ad_plan: JSON.stringify({ hook: "Your grip is slipping", angle: "Sweaty hands", script: ["0-3 s: close-up"] }), research_date: "2026-10-07" };
  const c = fromGenerator(row, { executionId: "9", index: 0, country: "GB", niche: "padel", date: "2026-10-07" });
  ok(c.id === "n8n-0b9d2f4e" && c.sourceId === row.id && c.market === "UK" && c.currency === "GBP", "ids and market match the database read", JSON.stringify(c));
  // Ex VAT: 20 − 5 − 3 − 0.72 = 11.28 → 56.4 %; less the CPA guess (7.50) = 3.78.
  ok(near(c.margin, 56.4, 0.05) && near(c.profit, 3.78, 0.01), "margin and profit after the CPA guess", `${c.margin} ${c.profit}`);
  ok(c.adPlan.hook === "Your grip is slipping" && c.adPlan.script.length === 1, "ad plan read from JSON text");
  const bare = fromGenerator({ name: "No id yet", cost_per_unit_incl_vat: 6, sale_price_incl_vat: 24 }, { executionId: "9", index: 2, country: "GB", niche: "padel", date: "2026-10-07" });
  ok(bare.id === "new-9-2" && bare.sourceId === null && bare.niche === "padel", "an unsaved item still gets an id and its topic");
  const nodes = ["Spara i product_candidates", "Dela upp kandidater"];
  const out = (name, items) => ({ [name]: [{ data: { main: [items.map((json) => ({ json }))] } }] });
  ok(ideasFrom(out(nodes[0], [row, row]), nodes).length === 2, "ideas come from the saved rows");
  const fell = ideasFrom({ ...out(nodes[0], [{ success: true }]), ...out(nodes[1], [{ name: "A" }, { name: "B" }, { name: "C" }]) }, nodes);
  ok(fell.length === 3 && fell[0].name === "A", "a save step without rows falls back to the ideas before it");
  ok(ideasFrom({}, nodes).length === 0, "no ideas, no rows");
  const runs = researchRuns([c, { ...c, id: "b" }, { ...c, id: "c", niche: "dogs", market: "SE", researchDate: "2026-10-01" }]);
  ok(runs.length === 2 && runs[0].topic === "padel" && runs[0].count === 2, "earlier research grouped by topic, market and day", JSON.stringify(runs));
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

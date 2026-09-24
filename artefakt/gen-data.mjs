/* Gör om ett svar från Plan-vy · Intelligence-API till data.js.
 *
 *   node gen-data.mjs <svar.json>       → skriver data.new.js
 *
 * Svaret hämtas genom att köra workflowet KYOkHUPZ0pu2VXId och spara
 * innehållet från noden "Svara med JSON". Filen ligger inte i repot: den
 * innehåller hela kandidatpoolen och genereras om vid varje körning.
 */
import fs from "node:fs";
const kalla = process.argv[2] || "api-1387.json";
if (!fs.existsSync(kalla)) {
  console.error("Hittar inte " + kalla + ". Ange sökvägen till API-svaret som argument.");
  process.exit(1);
}
const d = JSON.parse(fs.readFileSync(kalla, "utf8"));
const S = (v) => JSON.stringify(v);
const N = (v) => (v == null ? "null" : String(v));
const L = [];

L.push(`/* Hämtat från n8n-workflowet "Plan-vy · Intelligence-API", körningarna 1387 och 1464,`);
L.push(`   ${d.meta.generatedAt.slice(0, 16).replace("T", " ")} UTC. Kandidaternas kalkyl räknas i sidan ur`);
L.push(`   indata med samma formel som backenden, så talen inte kan glida isär. */`);
L.push(`const META = {`);
L.push(`  period: ${S(d.meta.period)},`);
L.push(`  generatedAt: ${S(d.meta.generatedAt)},`);
L.push(`  currency: ${S(d.meta.currency)},`);
L.push(`  vatRate: ${d.meta.vatRate},`);
L.push(`  sources: [`);
for (const s of d.meta.dataSources) L.push(`    [${S(s.key)}, ${S(s.label)}, ${S(s.origin)}, ${S(s.note)}],`);
L.push(`  ],`);
L.push(`};\n`);

L.push(`const OVERVIEW = {`);
L.push(`  healthScore: ${d.overview.healthScore}, healthLabel: ${S(d.overview.healthLabel)},`);
L.push(`  breakdown: { poas: ${d.overview.healthBreakdown.poas}, margin: ${d.overview.healthBreakdown.margin}, winShare: ${d.overview.healthBreakdown.winShare} },`);
const k = d.overview.kpis;
L.push(`  kpis: {`);
L.push(`    revenueExVat: ${k.revenueExVat}, orders: ${k.orders}, units: ${k.units}, aov: ${k.aov}, adSpend: ${k.adSpend},`);
L.push(`    contribution: ${k.contribution}, netProfit: ${k.netProfit}, poas: ${k.poas}, roas: ${k.roas},`);
L.push(`    netMargin: ${k.netMargin}, contribMargin: ${k.contribMargin}, winners: ${k.winners}, losers: ${k.losers},`);
L.push(`    productCount: ${k.productCount}, candidateCount: ${k.candidateCount},`);
L.push(`  },`);
L.push(`};\n`);

L.push(`const PRODUCTS = [`);
for (const p of d.products) {
  const f = p.financials, a = p.ai || {};
  L.push(`  {`);
  L.push(`    name: ${S(p.name)}, sku: ${S(p.sku)}, campaign: ${S(p.campaign)}, status: ${S(p.status)},`);
  L.push(`    f: { revenueExVat: ${f.revenueExVat}, revenueInclVat: ${f.revenueInclVat}, orders: ${f.orders}, units: ${f.units}, aov: ${f.aov}, adSpend: ${f.adSpend},`);
  L.push(`         cac: ${f.cac}, contribution: ${f.contribution}, contributionPerOrder: ${f.contributionPerOrder}, netProfit: ${f.netProfit},`);
  L.push(`         grossMargin: ${f.grossMargin}, poas: ${f.poas}, roas: ${f.roas}, breakEvenRoas: ${N(f.breakEvenRoas)}, returnRate: ${f.returnRate} },`);
  const ser = p.demand.series.map((s) => `{ month: ${S(s.month)}, orders: ${s.orders}, units: ${s.units}, revenueExVat: ${s.revenueExVat} }`).join(", ");
  L.push(`    demand: { series: [${ser}], monthsOfData: ${p.demand.monthsOfData}, momGrowth: ${N(p.demand.momGrowth)}, trend: ${S(p.demand.trend)} },`);
  L.push(`    score: ${p.opportunityScore}, scoreLabel: ${S(p.opportunityLabel)}, sb: { profitability: ${p.opportunityBreakdown.profitability}, margin: ${p.opportunityBreakdown.margin}, demand: ${p.opportunityBreakdown.demand} },`);
  /* Tratt och returer följer med precis som API:et ger dem, med available
     och saknas kvar — sidan ska kunna säga vad som fattas, inte visa nollor. */
  L.push(`    funnel: ${S(p.funnel || { available: false })},`);
  L.push(`    returns: ${S(p.returns || { available: false, rows: [] })},`);
  L.push(`    ai: {`);
  for (const key of ["verdict", "verdictReason", "scoreSummary", "customerVoice", "competition", "market"]) L.push(`      ${key}: ${S(a[key] ?? null)},`);
  L.push(`      opportunities: ${S(a.opportunities || [])},`);
  L.push(`      risks: ${S(a.risks || [])},`);
  L.push(`    },`);
  L.push(`  },`);
}
L.push(`];\n`);

L.push(`/* [severity, produkt, typ, text] */`);
L.push(`const ALERTS = [`);
for (const a of d.alerts) L.push(`  [${S(a.severity)}, ${S(a.product)}, ${S(a.type)}, ${S(a.message)}],`);
L.push(`];\n`);

L.push(`/* [id, namn, anteckning, inköp, utpris, frakt, avgift, cpa, enheter, sparad,`);
L.push(`    land, nisch, researchdag, källa]`);
L.push(`   Belopp inkl moms i landets egen valuta. Kalkylen räknas fram i calcCandidate().`);
L.push(`   Researchdagen är vad dagsvyn grupperar på; källan säger varför nischen valdes. */`);
L.push(`const RAW_CANDIDATES = [`);
for (const c of d.candidates) {
  const i = c.inputs;
  L.push(`[${S(c.id.slice(0, 8))},${S(c.name)},${S(c.notes || "")},${i.costPerUnitInclVat},${i.salePriceInclVat},${i.shippingCostPerOrder},${i.transactionFeePerOrder},${i.expectedCpaInclVat},${i.expectedUnitsPerOrder},${S((c.createdAt || "").slice(0, 19) + "Z")},${S(c.country)},${S(c.niche || "")},${S(c.researchDate || "")},${S(c.trendSource || "manuell")}],`);
}
L.push(`];\n`);

L.push(`/* Annonsupplägg per kandidat. Egen kreativ, genererad av modellen — sökningen`);
L.push(`   i Metas publika annonsbibliotek är till för att se vad som redan går. */`);
L.push(`const AD_PLANS = {`);
for (const c of d.candidates) {
  const p = c.adPlan;
  const key = S(c.id.slice(0, 8));
  const q = S(c.adLibrary.query);
  if (!p) { L.push(`  ${key}: { q: ${q} },`); continue; }
  L.push(`  ${key}: { q: ${q},`);
  L.push(`    angle: ${S(p.angle ?? null)}, hook: ${S(p.hook ?? null)}, format: ${S(p.format ?? null)},`);
  L.push(`    script: ${S(p.script || [])},`);
  L.push(`    audience: ${S(p.audience ?? null)}, primaryText: ${S(p.primaryText ?? null)}, headline: ${S(p.headline ?? null)} },`);
}
L.push(`};\n`);

const ai = d.ai;
L.push(`const AI = {`);
L.push(`  healthNarrative: ${S(ai.healthNarrative)},`);
L.push(`  recommendations: [`);
for (const r of ai.recommendations) {
  const links = (r.links || []).map((l) => `[${S(l.label)}, ${S(l.kind === "product" ? (l.href || "").replace("/products/", "") : "")}, ${S(l.kind)}]`).join(", ");
  L.push(`    { title: ${S(r.title)}, detail: ${S(r.detail)}, priority: ${S(r.priority)}, product: ${S(r.product ?? null)}, links: [${links}] },`);
}
L.push(`  ],`);
L.push(`  risks: [`);
for (const r of ai.risks) {
  const links = (r.links || []).map((l) => `[${S(l.label)}, ${S(l.kind === "product" ? (l.href || "").replace("/products/", "") : "")}, ${S(l.kind)}]`).join(", ");
  L.push(`    { title: ${S(r.title)}, detail: ${S(r.detail)}, severity: ${S(r.severity)}, links: [${links}] },`);
}
L.push(`  ],`);
L.push(`  nextActions: ${S(ai.nextActions)},`);
L.push(`};`);

fs.writeFileSync("data.new.js", L.join("\n") + "\n");
console.log("rader:", L.length);

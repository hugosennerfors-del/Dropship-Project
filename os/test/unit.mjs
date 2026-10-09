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

// Competitor ads: library links, checks and what the saved ads say.
{
  const A = await import("../src/core/ads.js");
  const today = new Date("2026-10-09T12:00:00Z");
  ok(A.defaultAdQuery("Posture corrector: adjustable (unisex)") === "posture corrector", "ad search drops the subtitle and brackets", A.defaultAdQuery("Posture corrector: adjustable (unisex)"));
  const [meta, lib, top, search] = A.adLibraryLinks("robe & towel", "UK");
  ok(meta.url === "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=GB&q=robe%20%26%20towel&search_type=keyword_unordered&media_type=all", "Meta Ad Library link: UK is GB, the search is encoded", meta.url);
  ok(A.adLibraryLinks("x", "SE")[0].url.includes("country=SE"), "Meta Ad Library link for Sweden");
  ok(!lib.prefilled && !top.prefilled && search.prefilled && search.url === "https://www.tiktok.com/search?q=robe%20%26%20towel", "TikTok links: only search takes the words from the address");
  ok(A.platformOf("https://www.facebook.com/ads/library/?id=1") === "meta" && A.platformOf("https://www.instagram.com/p/x") === "meta"
    && A.platformOf("https://vm.tiktok.com/abc") === "tiktok" && A.platformOf("https://www.pinterest.co.uk/pin/1") === "pinterest"
    && A.platformOf("https://notfacebook.com/x") === "other" && A.platformOf("nope") === null, "platform from the link's host");
  const good = A.normaliseAd({ url: "www.facebook.com/ads/library/?id=5", advertiser: "  Robe Co ", startedOn: "2026-08-01" }, { productId: "changing-robe", market: "UK", today });
  ok(good.ad && good.ad.url === "https://www.facebook.com/ads/library/?id=5" && good.ad.platform === "meta" && good.ad.advertiser === "Robe Co" && good.ad.stillRunning === true && /^[0-9a-f]{8}-[0-9a-f]{4}-4/.test(good.ad.id), "a pasted link without https:// is completed", JSON.stringify(good));
  ok(A.normaliseAd({ url: "http://www.tiktok.com/@shop/video/1" }, { productId: "changing-robe", market: "UK", today }).ad?.url.startsWith("https://"), "http links are upgraded");
  ok(A.normaliseAd({ url: "javascript:alert(1)" }, { productId: "changing-robe", market: "UK", today }).field === "url", "only https links are saved");
  ok(A.normaliseAd({ url: "https://x.test/a", startedOn: "2026-10-20" }, { productId: "changing-robe", market: "UK", today }).field === "startedOn", "a start date in the future is refused");
  ok(A.normaliseAd({ url: "https://x.test/a" }, { productId: "Bad Id", market: "UK", today }).error, "product ids are checked like the database does");
  const ads = [
    { advertiser: "A", startedOn: "2026-08-01", createdAt: "1" },
    { advertiser: "B", startedOn: "2026-10-01", createdAt: "2" },
    { advertiser: "C", startedOn: "2026-01-01", stillRunning: false, createdAt: "3" },
  ];
  ok(A.runningDays(ads[0], today) === 69 && A.runningDays(ads[2], today) === null, "days running counts only ads still running");
  ok(A.sortAds(ads, today).map((a) => a.advertiser).join("") === "ABC", "longest-running ads first");
  const sig = A.adSignal(ads, today);
  ok(sig.tone === "good" && sig.long === 1 && sig.active === 2 && sig.advertisers === 3, "one ad past 30 days reads as a profit sign", JSON.stringify(sig));
  ok(A.adSignal([{ startedOn: "2026-10-01" }], today).tone === "" && /early tests/.test(A.adSignal([{ startedOn: "2026-10-01" }], today).text), "only young ads: early tests");
  ok(A.adSignal([{ stillRunning: false }], today).tone === "warn", "every ad stopped: a warning");
  ok(/No ads saved/.test(A.adSignal([], today).text), "no ads: says how to find them");
}

// Stores selling a product and its suppliers.
{
  const S = await import("../src/core/sourcing.js");
  const W = await import("../src/core/weblinks.js");
  const uk = S.storeSearchLinks("robe & towel", "UK");
  ok(uk.map((l) => l.id).join() === "google-shopping,amazon,ebay,etsy", "UK store searches: Google Shopping, Amazon, eBay, Etsy");
  ok(uk[0].url === "https://www.google.com/search?q=robe%20%26%20towel&udm=28&gl=uk&hl=en-GB" && uk[1].url === "https://www.amazon.co.uk/s?k=robe%20%26%20towel"
    && uk[2].url === "https://www.ebay.co.uk/sch/i.html?_nkw=robe%20%26%20towel", "store search links carry the encoded words and the UK", uk.map((l) => l.url).join(" "));
  const se = S.storeSearchLinks("hundtäcke", "SE");
  ok(se.map((l) => l.id).join() === "google-shopping,amazon,etsy" && se[0].url.includes("gl=se&hl=sv") && se[1].url.startsWith("https://www.amazon.se/s?k=hundt%C3%A4cke"), "Swedish store searches: Amazon.se, no eBay UK");
  const [ali, alibaba, cn] = S.supplierSearchLinks("Changing Robe");
  ok(ali.url === "https://www.aliexpress.com/w/wholesale-changing-robe.html" && alibaba.url === "https://www.alibaba.com/trade/search?SearchText=Changing%20Robe" && !cn.prefilled,
    "supplier searches: AliExpress path, Alibaba query, 1688 home page", `${ali.url} ${alibaba.url}`);
  ok(S.supplierSearchLinks("")[0].url === "https://www.aliexpress.com/", "no search words: AliExpress home page");
  const named = S.namedSellers(["Dryrobe", "Red Original (premium)", "Amazon generics", "Large decor dropshipping stores", "dryrobe"], "changing robe", "UK");
  ok(named.map((x) => x.name).join() === "Dryrobe,Red Original" && named[0].url === "https://www.google.com/search?q=Dryrobe%20changing%20robe&gl=uk&hl=en-GB", "named sellers: brands searched with the product, generic descriptions left out", JSON.stringify(named));
  const st = S.normaliseLink({ url: "shop.example/products/robe", name: " Robe Shop ", price: "£89,99", moq: "50" }, { productId: "changing-robe", kind: "store", market: "UK" });
  ok(st.link && st.link.url === "https://shop.example/products/robe" && st.link.price === 89.99 && st.link.currency === "GBP" && st.link.moq === null && st.link.market === "UK" && st.link.name === "Robe Shop", "a store link: https added, price parsed, market currency, no MOQ", JSON.stringify(st));
  const sp = S.normaliseLink({ url: "https://www.alibaba.com/product-detail/x.html", price: "11.5", currency: "usd", moq: "1,000" }, { productId: "changing-robe", kind: "supplier", market: "UK" });
  ok(sp.link && sp.link.market === null && sp.link.currency === "USD" && sp.link.moq === 1000 && sp.link.price === 11.5, "a supplier link: no market, USD, MOQ parsed", JSON.stringify(sp));
  ok(S.normaliseLink({ url: "https://a.test/x", price: "abc" }, { productId: "changing-robe", kind: "store", market: "UK" }).field === "price", "a price that is not a number is refused");
  ok(S.normaliseLink({ url: "https://a.test/x", moq: "2.5" }, { productId: "changing-robe", kind: "supplier" }).field === "moq", "a fractional minimum order is refused");
  ok(S.normaliseLink({ url: "ftp://a.test/x" }, { productId: "changing-robe", kind: "supplier" }).field === "url", "only https links");
  ok(W.cleanUrl("http://a.test/x").url === "https://a.test/x" && W.cleanUrl("not a link").error, "links are completed to https or explained");
  const stores = [{ price: 89, currency: "GBP" }, { price: 120, currency: "GBP" }, { price: 175, currency: "GBP" }, { price: 999, currency: "SEK" }];
  const ss = S.storeSummary(stores, { price: 109, currency: "GBP" });
  ok(ss.lo === 89 && ss.hi === 175 && ss.med === 120 && /1 of 3 saved stores charge less/.test(ss.text), "store prices: range, median and where your price sits", ss.text);
  ok(S.storeSummary(stores, { price: 200, currency: "GBP" }).tone === "warn", "dearer than every saved store: a warning");
  const ps = S.supplierSummary([{ price: 14, currency: "USD", moq: 50 }, { price: 11.5, currency: "USD", moq: 100, name: "Ningbo Co" }, { price: 60, currency: "CNY" }], 24);
  ok(ps.best.price === 11.5 && /\$11\.50 per unit at a minimum order of 100 from Ningbo Co/.test(ps.text) && /at or below the analysis' \$24\.00/.test(ps.text), "cheapest USD quote against the analysis", ps.text);
  ok(S.supplierSummary([{ price: 30, currency: "USD" }], 24).tone === "warn", "a quote above the analysis' supplier price is a warning");
  ok(S.fmtMoney(89.5, "GBP") === "£89.50" && S.fmtMoney(249, "SEK") === "249 kr" && S.fmtMoney(80, "CNY") === "¥80", "money in the link's own currency");
}

console.log(fail ? `✗ ${fail} failed, ${pass} passed` : `✓ ${pass} unit tests passed`);
process.exit(fail ? 1 : 0);

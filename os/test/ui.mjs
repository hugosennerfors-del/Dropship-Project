// Interaction tests in a real browser.
//   node test/ui.mjs
// 1. The chat answers from the database without Claude, including follow-ups.
// 2. With a mocked Claude and n8n connector: live data from Supabase is
//    applied, writes go to the Intelligence-DB workflow, and Claude's tool
//    calls run real queries.
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(join(root, "dist/index.html"), "utf8");
const liveFixture = await readFile(join(root, "test/fixtures-live-read.json"), "utf8");
const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
const server = http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); r.end(doc); }).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;

let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name, extra); } };
const browser = await chromium.launch();

// ── 1. Chat without Claude ─────────────────────────────────────────────
{
  console.log("Chat, database answers");
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url + "#/chat");
  await page.waitForSelector("#q");
  const ask = async (q) => {
    const n = await page.locator(".msg:not(.user) [data-body]").count();
    await page.fill("#q", q);
    await page.keyboard.press("Enter");
    await page.waitForFunction((n) => document.querySelectorAll(".msg:not(.user) [data-body]").length > n && !document.querySelector(".msg:not(.user) .thinking"), n, { timeout: 8000 });
    return page.locator(".msg:not(.user) [data-body]").last().innerText();
  };
  let a = await ask("Show products with margin > 60, price < £80, competition < 40, trend > 70 and brandability > 60");
  ok(/no United Kingdom product/i.test(a) && /strictest condition/i.test(a) && /Closest matches/i.test(a), "explains an empty result and shows closest matches", a.slice(0, 200));
  a = await ask("Find products that cost under £30 and sell for at least £60");
  ok(/products? match/i.test(a) && /Landed cost under £30/i.test(a) && /Selling price at least £60/i.test(a), "two-sided price condition", a.slice(0, 200));
  const links = await page.locator(".msg:not(.user)").last().locator("a.plink").count();
  ok(links >= 2, "answer links to products", String(links));
  const firstId = await page.locator(".msg:not(.user)").last().locator("a.plink").first().getAttribute("href");
  a = await ask("Which one is the safest?");
  ok(/safest of these is/i.test(a) && /risk score of/i.test(a), "follow-up: safest of the previous list", a.slice(0, 160));
  await ask("Show me the top 5 products by opportunity");
  a = await ask("Why is number 3 better than number 1?");
  ok(/scores \*{0}\d+|scores/i.test(a) && /(gains|loses) points/i.test(a), "follow-up: number 3 vs number 1", a.slice(0, 200));
  a = await ask("Which one would you choose with £2,000?");
  ok(/£2,000/.test(a), "follow-up: budget", a.slice(0, 160));
  a = await ask("Show me the unit economics");
  ok(/Price .* incl\. VAT/.test(a) && /Break-even ROAS/.test(a), "follow-up: unit economics", a.slice(0, 160));
  a = await ask("Vilka produkter har hög marginal och låg konkurrens i Sverige?");
  ok(/Sweden/.test(a), "Swedish question switches market", a.slice(0, 160));
  ok(firstId && firstId.startsWith("#/p/"), "product links use #/p/<id>");
  // Discover's natural-language box writes filters.
  await page.goto(url + "#/discover");
  await page.fill("#nl", "margin over 55, good for TikTok, early stage");
  await page.click("#nlForm button[type=submit]");
  await page.waitForTimeout(200);
  const chips = await page.locator("#d-chips .chip").allInnerTexts();
  ok(chips.some((c) => /Gross margin over 55/.test(c)) && chips.some((c) => /TikTok/.test(c)) && chips.some((c) => /Emerging|Early Growth/.test(c)), "Discover parses a description into filters", chips.join(" | "));
  // Without n8n the research page still searches, and says why it cannot research.
  await page.goto(url + "#/research?q=padel");
  await page.waitForSelector("#rq");
  ok(await page.locator("#rForm [data-act=run]").isDisabled(), "research button is off without the n8n connector");
  ok(/needs the n8n connector/.test(await page.locator(".r-foot").innerText()), "the page says what research needs");
  ok(/Already in the database/.test(await page.locator("#r-dyn").innerText()), "the search field finds what the database has");
  await page.goto(url + "#/chat");
  a = await ask("Gör research på hundleksaker");
  ok(/hundleksaker/.test(a) && /n8n Research generator/.test(a), "a research request in Swedish is understood", a.slice(0, 160));
  ok(/needs the n8n connector/.test(await page.locator(".msg:not(.user)").last().innerText()), "the chat says research needs n8n here");
  ok(!errors.length, "no page errors", errors.join("; "));
  await ctx.close();
}

// ── 2. Mocked Claude and n8n ───────────────────────────────────────────
{
  console.log("Live database and Claude, mocked");
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, reducedMotion: "reduce" });
  await ctx.addInitScript((fixture) => {
    window.__calls = [];
    const live = JSON.parse(fixture);
    const mcp = {
      async callTool(server, tool, input) {
        window.__calls.push({ server, tool, input });
        if (tool === "execute_workflow") return { payload: { executionId: String(window.__calls.length) } };
        if (tool === "get_workflow_execution" && !input.includeData) return { payload: { execution: { status: "success" } } };
        const body = window.__calls.filter((c) => c.tool === "execute_workflow").at(-1).input.inputs.webhookData.body;
        const result = body.op === "read" ? live : { ok: true };
        return { payload: { data: { resultData: { runData: { Svar: [{ data: { main: [[{ json: { ok: true, result } }]] } }] } } } } };
      },
    };
    const sample = async (input, opts = {}) => {
      window.__sampleInputs = (window.__sampleInputs || []).concat([input]);
      if (opts.tools) {
        const q = opts.tools.find((t) => t.name === "query_products");
        const res = await q.execute({ filters: [{ field: "margin", op: ">=", value: 55 }], sort: "margin", limit: 3 });
        window.__toolResult = res;
        const ids = res.rows.map((r) => r.id);
        const text = `Three products clear a 55 % margin: ${ids.map((id, i) => `${i + 1}. [[${id}]]`).join(" ")}.`;
        opts.onText?.({ text, delta: text });
        return { text, truncated: false, modelTierApplied: "default" };
      }
      const text = "ok";
      opts.onText?.({ text, delta: text });
      return { text, truncated: false };
    };
    sample.limits = async () => ({ maxPromptBytes: 65536, tools: { maxCount: 16 } });
    sample.json = async () => ({});
    window.claude = { use: async (name) => (name === "mcp" ? mcp : name === "sample" ? sample : null) };
  }, liveFixture);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url + "#/p/changing-robe");
  await page.waitForFunction(() => /Live: Supabase/.test(document.querySelector(".rail-foot")?.innerText || ""), null, { timeout: 8000 });
  ok(true, "page connects to the live database through n8n");
  const reads = await page.evaluate(() => window.__calls.filter((c) => c.tool === "execute_workflow").map((c) => c.input));
  ok(reads[0]?.workflowId === "ZzrznUz8OFIAr4ve" && reads[0]?.inputs?.webhookData?.body?.op === "read" && reads[0]?.inputs?.webhookData?.body?.params?.since, "read call goes to Intelligence-DB with since=snapshot");
  await page.waitForTimeout(300);
  const priceInput = await page.locator('[data-calc="price"]').inputValue();
  ok(priceInput === "99", "a verified value from Supabase replaces the analysis value", priceInput);
  // Store sales from the live view: posture corrector in Sweden, Estimated.
  await page.goto(url + "#/p/posture-corrector");
  await page.click('[data-market="SE"]');
  await page.waitForTimeout(300);
  const cacTip = await page.locator('[data-calc="cac"]').getAttribute("data-tip");
  ok(/Estimated/.test(cacTip || "") && /entered by hand/i.test(cacTip || ""), "store sales without Shopify ids are labelled Estimated", cacTip);
  // Write: verify a value.
  await page.click('[data-market="UK"]');
  await page.waitForTimeout(200);
  await page.selectOption("#vf-field", "UK|competition");
  await page.fill("#vf-value", "70");
  await page.fill("#vf-note", "Counted listings on Amazon UK, 7 Oct");
  await page.click("#verifyForm button[type=submit]");
  await page.waitForFunction(() => window.__calls.some((c) => c.tool === "execute_workflow" && c.input.inputs.webhookData.body.op === "write"), null, { timeout: 8000 });
  const w = await page.evaluate(() => window.__calls.filter((c) => c.tool === "execute_workflow").map((c) => c.input.inputs.webhookData.body).find((b) => b.op === "write"));
  ok(w.action === "overlay.set" && w.payload.key === "posture-corrector|UK|competition" && w.payload.value.v === 70 && w.payload.value.s === "V", "verified value is written to Supabase via n8n", JSON.stringify(w));
  // Chat with Claude and page tools.
  await page.goto(url + "#/chat");
  await page.fill("#q", "Which products have a margin of at least 55%?");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /Three products/.test(document.querySelector(".chat-log")?.innerText || ""), null, { timeout: 8000 });
  const tr = await page.evaluate(() => window.__toolResult);
  ok(tr && tr.rows.length === 3 && tr.rows.every((r) => r.margin >= 55), "Claude's query_products tool runs a real query", JSON.stringify(tr?.rows?.map((r) => r.margin)));
  const step = await page.locator(".step").first().innerText();
  ok(/Searched UK products: Gross margin at least 55%/.test(step), "the applied filter is shown under the answer", step);
  const sideCount = await page.locator(".chat-side .li").count();
  ok(sideCount === 3, "the answer's products become the follow-up list", String(sideCount));
  const prompt = await page.evaluate(() => JSON.stringify(window.__sampleInputs.at(-1)));
  ok(/Page context: market UK/.test(prompt) && /query_products/.test(prompt), "the prompt carries rules, schema and page context");
  ok(!errors.length, "no page errors", errors.join("; "));
  await ctx.close();
}

// ── 3. New research from the search fields, mocked n8n ─────────────────
{
  console.log("New research, mocked n8n Research generator");
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, reducedMotion: "reduce" });
  await ctx.addInitScript((fixture) => {
    window.__calls = [];
    const runs = {};
    const live = JSON.parse(fixture);
    // The saved product_candidates rows the insert node returns: numeric
    // columns as text and the ad plan as JSON text, as Postgres gives them.
    const saved = (body, n) => Array.from({ length: 5 }, (_, i) => ({ json: {
      id: `${n}${i}aaaaaa-0000-4000-8000-00000000000${i}`, name: `${body.niche} idea ${i + 1}`, source: "AI-research", country: body.country, niche: body.niche,
      cost_per_unit_incl_vat: "6.00", sale_price_incl_vat: "24.00", shipping_cost_per_order: "3.60", transaction_fee_per_order: "0.72",
      expected_cpa_incl_vat: "9.00", expected_units_per_order: "1", notes: "Visual, demonstrable and cheap to ship.", status: "idea",
      research_date: body.researchDate, trend_source: body.trendSource, created_at: new Date().toISOString(),
      ad_plan: JSON.stringify({ angle: "Fix it in ten seconds", hook: `Still struggling with ${body.niche}?`, format: "UGC demo 15 s", script: ["0-3 s: the problem"], adLibraryQuery: body.niche }),
    } }));
    const mcp = {
      async callTool(server, tool, input) {
        window.__calls.push({ server, tool, input });
        if (tool === "execute_workflow") { const id = String(window.__calls.length); runs[id] = input; return { payload: { executionId: id } }; }
        if (!input.includeData) return { payload: { execution: { status: "success" } } };
        const run = runs[input.executionId];
        const body = run.inputs.webhookData.body;
        if (run.workflowId === "jD6A7tOD1L8bdUd8") return { payload: { data: { resultData: { runData: { "Spara i product_candidates": [{ data: { main: [saved(body, input.executionId)] } }] } } } } };
        const result = body.op === "read" ? live : { ok: true };
        return { payload: { data: { resultData: { runData: { Svar: [{ data: { main: [[{ json: { ok: true, result } }]] } }] } } } } };
      },
    };
    const sample = async (input, opts = {}) => { window.__samples = (window.__samples || 0) + 1; const text = "ok"; opts.onText?.({ text, delta: text }); return { text, truncated: false }; };
    sample.limits = async () => ({ maxPromptBytes: 65536, tools: { maxCount: 16 } });
    sample.json = async () => { window.__samples = (window.__samples || 0) + 1; return { core: { name: "Padel grip kit", category: "Sports & Outdoors", niche: "Padel", brandability: 60, supplierPriceUSD: 4, size: "S", kind: "default" }, market: { price: 24, demand: 55, trend: 60, competition: 50, trendDirection: "up" } }; };
    window.claude = { use: async (name) => (name === "mcp" ? mcp : name === "sample" ? sample : null) };
  }, liveFixture);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const researchCalls = () => page.evaluate(() => window.__calls.filter((c) => c.tool === "execute_workflow" && c.input.workflowId === "jD6A7tOD1L8bdUd8").map((c) => ({ trigger: c.input.triggerNodeName, mode: c.input.executionMode, ...c.input.inputs.webhookData.body })));
  const inboxBefore = JSON.parse(liveFixture).inbox.total;

  await page.goto(url + "#/radar");
  await page.waitForFunction(() => /Live: Supabase/.test(document.querySelector(".rail-foot")?.innerText || ""), null, { timeout: 8000 });
  // The search field in the top bar: no product matches, so research comes first.
  await page.click("#os-cmdk");
  await page.fill("#pal-q", "padel grips");
  const first = await page.locator("#pal-list .li").first().innerText();
  ok(/Research “padel grips” in the UK/.test(first), "the top-bar search offers to research what it cannot find", first);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /new ideas for “padel grips”/.test(document.querySelector("#r-run")?.innerText || ""), null, { timeout: 8000 });
  ok((await page.evaluate(() => location.hash)).startsWith("#/research?q=padel"), "research opens the research page");
  let calls = await researchCalls();
  ok(calls.length === 1 && calls[0].niche === "padel grips" && calls[0].country === "GB" && calls[0].trigger === "API: generera research" && calls[0].mode === "production",
    "the n8n Research generator runs with the search text and the UK as GB", JSON.stringify(calls));
  ok(await page.locator(".r-card").count() === 5, "five new ideas are shown");
  const card = await page.locator(".r-card").first().innerText();
  ok(/£24\.00/.test(card) && /56%/.test(card) && /£3\.78/.test(card) && /Still struggling with padel grips/.test(card), "an idea shows price, margin, profit after CPA and its ad hook", card.replace(/\s+/g, " ").slice(0, 200));
  const railCount = await page.locator('#os-rail a[href="#/research"] .count').innerText();
  ok(Number(railCount) === inboxBefore + 5, "the idea count grows by five", `${railCount} vs ${inboxBefore}`);
  ok(await page.locator("#r-dyn .tag", { hasText: "New" }).count() === 5, "the new ideas are marked in the full list");
  // Analyse an idea into a profile; it is saved with a link to its row.
  await page.locator(".r-card [data-profile]").first().click();
  await page.waitForSelector('.r-card a[href^="#/p/ai-"]', { timeout: 8000 });
  const save = await page.evaluate(() => window.__calls.filter((c) => c.tool === "execute_workflow").map((c) => c.input.inputs.webhookData.body).find((b) => b.action === "product.save"));
  ok(save && /^\d+0aaaaaa-0000-4000-8000-000000000000$/.test(save.payload.record.candidateId) && save.payload.record.source === "agent", "the analysed idea is saved with its candidate id", JSON.stringify(save?.payload?.record?.candidateId));
  // Typing in the research field searches what is there.
  await page.fill("#rq", "grips");
  await page.waitForTimeout(400);
  const dyn = await page.locator("#r-dyn").innerText();
  ok(/5 earlier ideas match “grips”/.test(dyn) && (await page.locator("#r-dyn tbody tr").count()) === 5, "typing filters the database and earlier research", dyn.slice(0, 160));
  // Discover's box can research too.
  await page.goto(url + "#/discover");
  await page.fill("#nl", "cold-water swimming");
  await page.click("#nlForm [data-act=research]");
  await page.waitForFunction(() => /new ideas for “cold-water swimming”/.test(document.querySelector("#r-run")?.innerText || ""), null, { timeout: 8000 });
  calls = await researchCalls();
  ok(calls.length === 2 && calls[1].niche === "cold-water swimming", "Discover's Research new button runs research", JSON.stringify(calls.map((c) => c.niche)));
  // The chat answers a research request itself and offers the run.
  await page.goto(url + "#/chat");
  const samplesBefore = await page.evaluate(() => window.__samples || 0);
  await page.fill("#q", "Gör research på hundleksaker i Sverige");
  await page.keyboard.press("Enter");
  await page.waitForSelector("[data-research]", { timeout: 8000 });
  ok(await page.evaluate(() => window.__samples || 0) === samplesBefore, "a research request does not go to Claude");
  ok(await researchCalls().then((c) => c.length) === 2, "nothing runs until the button is pressed");
  await page.click("[data-research]");
  await page.waitForFunction(() => /new ideas for “hundleksaker”/.test(document.querySelector("#r-run")?.innerText || ""), null, { timeout: 8000 });
  calls = await researchCalls();
  ok(calls[2]?.niche === "hundleksaker" && calls[2]?.country === "SE", "the chat's button researches in Sweden", JSON.stringify(calls[2]));
  ok(/kr/.test(await page.locator(".r-card").first().innerText()), "Swedish ideas are shown in kronor");
  ok(!errors.length, "no page errors", errors.join("; "));
  await ctx.close();
}

await browser.close();
server.close();
console.log(fail ? `✗ ${fail} failed, ${pass} passed` : `✓ ${pass} passed`);
process.exit(fail ? 1 : 0);

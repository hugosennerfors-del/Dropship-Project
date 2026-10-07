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

await browser.close();
server.close();
console.log(fail ? `✗ ${fail} failed, ${pass} passed` : `✓ ${pass} passed`);
process.exit(fail ? 1 : 0);

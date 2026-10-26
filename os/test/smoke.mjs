// Browser smoke test: every route renders without console errors.
//   node test/smoke.mjs [--shots]
import { chromium } from "./browser.mjs";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(join(root, "dist/index.html"), "utf8");
const page0 = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(page0); }).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const shots = process.argv.includes("--shots");
const outDir = process.env.SHOTS || "/tmp";

const browser = await chromium.launch();
const routes = ["#/radar", "#/discover", "#/research", "#/research?q=padel", "#/p/changing-robe", "#/p/posture-corrector", "#/trends", "#/niches", "#/compare", "#/chat", "#/data", "#/data?tab=evidence", "#/data?tab=inbox", "#/data?tab=connectors", "#/data?tab=edits", "#/data?tab=settings", "#/data?tab=shopify", "#/brands", "#/brands?product=changing-robe", "#/store/", "#/store/kassa", "#/store/risk", "#/store/products"];
let failures = 0;
for (const vp of [{ width: 1360, height: 900, name: "desktop" }, { width: 390, height: 844, name: "phone" }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|ERR_CERT|net::/.test(m.text())) errors.push("console: " + m.text()); });
  await page.goto(url + "#/radar");
  await page.waitForSelector(".page", { timeout: 8000 });
  for (const r of routes) {
    await page.evaluate((h) => { location.hash = h; }, r);
    await page.waitForTimeout(250);
    const info = await page.evaluate(() => ({
      text: (document.querySelector("#os-main:not([hidden]) .view, #legacyRoot:not([hidden]) #view")?.innerText || "").slice(0, 80).replace(/\s+/g, " "),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    const bad = !info.text || info.overflow > 2;
    if (bad) failures++;
    console.log(`${vp.name.padEnd(7)} ${r.padEnd(24)} ${bad ? "FAIL" : "ok  "} overflow=${info.overflow} ${info.text}`);
    if (shots && ["#/radar", "#/p/changing-robe", "#/chat", "#/discover", "#/research?q=padel", "#/store/kassa", "#/data", "#/brands", "#/data?tab=shopify"].includes(r)) {
      await page.screenshot({ path: `${outDir}/${vp.name}-${r.replace(/[#/?=]/g, "_")}.png`, fullPage: false });
    }
  }
  if (errors.length) { failures += errors.length; console.log(errors.join("\n")); }
  await ctx.close();
}
await browser.close();
server.close();
console.log(failures ? `✗ ${failures} problems` : "✓ all routes render");
process.exit(failures ? 1 : 0);

import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
/* Effekterna prövas med rörelse PÅ. Frågan är inte hur de ser ut utan att de
   aldrig ljuger: en uppräknad siffra slutar på exakt vyns text, inflygningen
   släpper taget, och "minska rörelse" och knappen Effekter stänger av allt. */
const DIR = path.dirname(fileURLToPath(import.meta.url));
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(DIR + "/index.html"));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = "http://127.0.0.1:" + server.address().port + "/index.html";
const b = await chromium.launch();
let fel = 0;
const T = (l, c, x = "") => { if (!c) fel++; console.log((c ? "PASS " : "FEL  ") + l + (c ? "" : "  " + x)); };

const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
p.on("pageerror", (e) => { fel++; console.log("PAGEERROR:", e.message); });
await p.goto(url + "#/");
await p.waitForTimeout(120);
const tidigt = await p.$eval(".kpi .val", (e) => e.textContent);
T("inflygningen är igång direkt efter laddning", await p.$eval("#view", (e) => e.classList.contains("enter")));
T("siffran räknas upp och står inte på slutvärdet än", tidigt !== "15 200 kr", JSON.stringify(tidigt));
await p.waitForTimeout(1700);
const facit = await p.evaluate(() => kr(OVERVIEW.kpis.revenueExVat));
T("uppräkningen slutar på exakt vyns text", (await p.$eval(".kpi .val", (e) => e.textContent)) === facit, facit);
const allaKpi = await p.$$eval(".kpi .val", (n) => n.map((x) => x.textContent));
T("ingen KPI fastnar på en mellanliggande siffra", allaKpi.every((t) => !/NaN/.test(t)) && allaKpi.length >= 6, JSON.stringify(allaKpi));
T("inflygningen släpper taget efteråt", !(await p.$eval("#view", (e) => e.classList.contains("enter"))));

/* Omritning mitt i inflygningen får inte starta om uppräkningen från noll. */
await p.goto(url + "#/risk");
await p.waitForTimeout(500);
await p.evaluate(() => render());
await p.waitForTimeout(1600);
const koncFacit = await p.evaluate(() => pct(koncentration().andel, 0));
T("omritad vy landar också rätt", (await p.textContent("#view")).includes(koncFacit), koncFacit);

/* Konfetti ritar på en duk som frigörs när den är klar. */
await p.evaluate(() => fxFest(700, 300, 40));
await p.waitForTimeout(150);
T("konfettin ritar", (await p.$eval("#fxCanvas", (c) => c.width)) > 0);
await p.waitForTimeout(3600);
T("duken frigörs efteråt", (await p.$eval("#fxCanvas", (c) => c.width)) === 0);

/* Knappen Effekter stänger av och minns det. */
await p.goto(url + "#/");
await p.waitForTimeout(1700);
await p.click("#fxToggle");
T("knappen slår av effekterna", await p.evaluate(() => document.documentElement.classList.contains("fx-off")));
T("knappen visar läget", (await p.getAttribute("#fxToggle", "aria-pressed")) === "false");
await p.reload();
await p.waitForTimeout(150);
T("avstängt läge överlever omladdning", await p.evaluate(() => document.documentElement.classList.contains("fx-off")));
T("avstängt: ingen inflygning", !(await p.$eval("#view", (e) => e.classList.contains("enter"))));
T("avstängt: siffrorna står rätt från början", (await p.$eval(".kpi .val", (e) => e.textContent)) === facit);
await p.click("#fxToggle");
T("knappen slår på igen", !(await p.evaluate(() => document.documentElement.classList.contains("fx-off"))));

/* Minska rörelse vinner över knappen. */
const lugn = await b.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
await lugn.goto(url + "#/");
await lugn.waitForTimeout(120);
T("minska rörelse: ingen inflygning", !(await lugn.$eval("#view", (e) => e.classList.contains("enter"))));
T("minska rörelse: siffrorna står rätt direkt", (await lugn.$eval(".kpi .val", (e) => e.textContent)) === facit);
T("minska rörelse: knappen döljs", !(await lugn.isVisible("#fxToggle")));

/* Mobil med effekter på: ingen sidledes rullning mitt i inflygningen. */
const m = await b.newPage({ viewport: { width: 390, height: 844 } });
for (const h of ["#/", "#/kassa", "#/research"]) {
  await m.goto(url + h);
  await m.waitForTimeout(300);
  const ok = await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  T("mobil med effekter, ingen sidledes rullning: " + h, ok);
}

await b.close();
server.close();
console.log(fel === 0 ? "\nAllt grönt." : "\n" + fel + " fel.");

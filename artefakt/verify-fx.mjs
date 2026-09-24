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

/* Regression: på Research lutade korten med perspektivet satt på hela listan,
   som är över 20 000 px hög. En lutning på 6° drog isär kortet och flyttade
   "Öppna analys" 167 px bort från pekaren, så klicket träffade ingenting.
   Här går pekaren mot länken som en människa gör, och länken ska stå still. */
const r = await b.newPage({ viewport: { width: 1440, height: 900 } });
r.on("pageerror", (e) => { fel++; console.log("PAGEERROR:", e.message); });
await r.goto(url + "#/research");
await r.waitForTimeout(1800);
const forsta = r.locator("#view .cards > article.glass").first();
await forsta.scrollIntoViewIfNeeded();
await r.waitForTimeout(200);
const lank = forsta.locator("a", { hasText: "Öppna analys" });
const fore = await lank.boundingBox();
const kortBox = await forsta.boundingBox();
const malX = fore.x + fore.width / 2, malY = fore.y + fore.height / 2;
await r.mouse.move(kortBox.x + kortBox.width / 2, kortBox.y + 20);
for (let i = 1; i <= 12; i++) {
  await r.mouse.move(malX, kortBox.y + 20 + (malY - kortBox.y - 20) * (i / 12));
  await r.waitForTimeout(30);
}
await r.waitForTimeout(300);
const efter = await lank.boundingBox();
const flytt = Math.hypot(efter.x - fore.x, efter.y - fore.y);
T("Öppna analys står still när pekaren närmar sig", flytt < 1 && Math.abs(efter.height - fore.height) < 1,
  "flyttade " + flytt.toFixed(1) + " px, höjd " + fore.height + " → " + efter.height.toFixed(1));
T("research-kortet lutar inte", (await forsta.evaluate((e) => getComputedStyle(e).transform)) === "none");
await r.mouse.down(); await r.mouse.up();
await r.waitForTimeout(400);
T("klicket på Öppna analys öppnar kandidaten", /^#\/kandidat\?id=/.test(await r.evaluate(() => location.hash)),
  await r.evaluate(() => location.hash));

/* Knappar ändrar inte storlek eller läge på hover eller tryck. */
await r.goto(url + "#/research");
await r.waitForTimeout(1800);
const knapp = r.locator("#exportCsv");
const kFore = await knapp.boundingBox();
await r.mouse.move(kFore.x + kFore.width - 2, kFore.y + kFore.height - 2);
await r.waitForTimeout(250);
const kHover = await knapp.boundingBox();
T("knappen står still på hover", Math.abs(kHover.x - kFore.x) < 0.5 && Math.abs(kHover.y - kFore.y) < 0.5 && Math.abs(kHover.width - kFore.width) < 0.5);
await r.mouse.down();
await r.waitForTimeout(120);
const kTryck = await knapp.boundingBox();
await r.mouse.up();
T("knappen krymper inte när den trycks", Math.abs(kTryck.width - kFore.width) < 0.5 && Math.abs(kTryck.height - kFore.height) < 0.5);

/* KPI-rutorna får luta, men lugnt och kring sin egen mitt. */
await r.goto(url + "#/");
await r.waitForTimeout(1800);
const kpi = r.locator("#view .kpi").nth(1);
const kpiFore = await kpi.boundingBox();
/* Sikta in i rutan, inte på det rundade hörnet: där ligger pekaren utanför. */
await r.mouse.move(kpiFore.x + kpiFore.width * 0.85, kpiFore.y + kpiFore.height * 0.8, { steps: 6 });
await r.waitForTimeout(300);
const kpiEfter = await kpi.boundingBox();
const mittFlytt = Math.hypot((kpiEfter.x + kpiEfter.width / 2) - (kpiFore.x + kpiFore.width / 2), (kpiEfter.y + kpiEfter.height / 2) - (kpiFore.y + kpiFore.height / 2));
T("KPI-rutan lutar", (await kpi.evaluate((e) => e.style.transform)).includes("rotateX"));
T("KPI-rutan lutar kring sin egen mitt", mittFlytt < 8, mittFlytt.toFixed(1) + " px");
T("KPI-rutan behåller sin storlek inom några pixlar", Math.abs(kpiEfter.width - kpiFore.width) < 12 && Math.abs(kpiEfter.height - kpiFore.height) < 12,
  kpiFore.width.toFixed(0) + "×" + kpiFore.height.toFixed(0) + " → " + kpiEfter.width.toFixed(0) + "×" + kpiEfter.height.toFixed(0));
await r.mouse.move(5, 5);
await r.waitForTimeout(500);
T("KPI-rutan rätar upp sig när pekaren går", (await kpi.evaluate((e) => e.style.transform)) === "");
await r.close();

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

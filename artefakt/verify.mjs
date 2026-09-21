import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
const DIR = "/tmp/claude-0/-home-user-Dropship-Project/d8fc5821-8dc5-5fdf-ab43-bfc4a2d57554/scratchpad/art";
const url = "file://" + DIR + "/index.html";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
p.on("console", (m) => m.type() === "error" && errs.push("CONSOLE: " + m.text()));
const T = (label, cond, extra = "") => console.log((cond ? "PASS " : "FEL  ") + label + (cond ? "" : "  " + extra));

await p.goto(url + "#/research");
await p.waitForTimeout(400);

// 1. Landsknappar finns
const chips = await p.$$eval("[data-country]", (n) => n.map((x) => x.textContent.trim()));
T("landsknappar speglar poolen", chips.length >= 3 && chips[0].startsWith("Alla marknader"), JSON.stringify(chips));
console.log("   knappar:", JSON.stringify(chips));

// 2. Filtrera på Storbritannien
await p.click('[data-country="GB"]');
await p.waitForTimeout(300);
const gbTxt = await p.textContent("#view");
T("GB-filter visar 5 kandidater", /5 kandidater i Storbritannien/.test(gbTxt), gbTxt.slice(0, 200));
T("GB visar pund", gbTxt.includes("£"), "");
T("GB visar inte kronor i korten", !/\d\s?kr/.test(gbTxt.split("Kandidater (")[1] ?? ""), "");

// 3. Öppna en GB-kandidat
const href = await p.getAttribute('a[href^="#/kandidat"]', "href");
await p.goto(url + href);
await p.waitForTimeout(400);
const cTxt = await p.textContent("#view");
T("kandidatsidan öppnas", cTxt.includes("Annonsupplägg"), cTxt.slice(0, 120));
T("annonsupplägg visar hook", cTxt.includes("Hook (första 3 sekunderna)"), "");
T("annonsupplägg visar manus", cTxt.includes("Manus"), "");
T("verklighetskoll avstängd utanför SE", cTxt.includes("Går inte att jämföra"), "");
T("moms 20 % anges", cTxt.includes("moms 20"), cTxt.match(/moms[^·]*/)?.[0] ?? "");
const lib = await p.getAttribute('a[href*="facebook.com/ads/library"]', "href");
T("Ad Library-länk för GB", !!lib && lib.includes("country=GB"), String(lib));
console.log("   länk:", lib);

// 4. En svensk kandidat: verklighetskollen ska vara kvar och valutan SEK
await p.goto(url + "#/research");
await p.waitForTimeout(300);
await p.click('[data-country="SE"]');
await p.waitForTimeout(300);
const seHref = await p.$eval('a[href^="#/kandidat"]:has-text("rabbit")', (a) => a.getAttribute("href"));
await p.goto(url + seHref);
await p.waitForTimeout(400);
const sTxt = await p.textContent("#view");
T("SE-kandidat behåller verklighetskollen", sTxt.includes("Mot dina egna siffror") && !sTxt.includes("Går inte att jämföra"), "");
T("SE-kandidat i kronor", /kr/.test(sTxt) && !sTxt.includes("£"), "");
T("SE-bidrag 342 kr oförändrat (rabbit)", sTxt.replace(/ /g, " ").includes("342 kr"), sTxt.match(/Täckningsbidrag[\s\S]{0,60}/)?.[0] ?? "");

// 5. Sökning över annonsvinkel. reload() krävs: goto till enbart ny hash
// laddar inte om dokumentet, så countryFilter hade legat kvar på SE.
await p.goto(url + "#/research");
await p.reload();
await p.waitForTimeout(400);
await p.fill("#q", "frother");
await p.waitForTimeout(400);
const qTxt = await p.textContent("#view");
T("sökning hittar via produktnamn", qTxt.includes("Milk Frother"), "");
await p.fill("#q", "barista");
await p.waitForTimeout(400);
const q2 = await p.textContent("#view");
T("sökning når anteckning", q2.includes("Milk Frother"), q2.slice(0, 160));
await p.fill("#q", "risotto");
await p.waitForTimeout(400);
const q3 = await p.textContent("#view");
T("sökning når annonsmanus", q3.includes("Pan Stirrer"), q3.slice(0, 160));

// 6. Mobilvy
const mp = await b.newPage({ viewport: { width: 390, height: 844 } });
await mp.goto(url + "#/research");
await mp.waitForTimeout(400);
const sw = await mp.evaluate(() => document.documentElement.scrollWidth);
T("ingen horisontell scroll på 390px", sw <= 391, "scrollWidth=" + sw);
const closedBox = await (await mp.$("#side")).boundingBox();
await mp.click("#burger");
// Lådan glider in med en CSS-övergång. Mät inte mitt i den: vänta tills den
// står still, annars mäter man animeringen och inte om den öppnades.
let bx = null;
try {
  await mp.waitForFunction(() => document.getElementById("side").getBoundingClientRect().x > -1, null, { timeout: 3000 });
  bx = await (await mp.$("#side")).boundingBox();
} catch { bx = await (await mp.$("#side")).boundingBox(); }
const diag = await mp.evaluate(() => ({ cls: document.getElementById("side").className, scrim: document.getElementById("scrim").className }));
// Stängd låda ligger på x ≈ -bredden; öppen på x ≈ 0. isVisible() duger inte,
// den rapporterar en translateX(-100%)-låda som synlig.
T("lådan är undanskjuten när den är stängd", closedBox.x < -100, JSON.stringify(closedBox));
T("hamburgermenyn öppnas", bx.x > -1, JSON.stringify(bx) + " " + JSON.stringify(diag));

// 7. Varje kandidatsida ska rendera utan fel
await p.goto(url + "#/research");
await p.reload();
await p.waitForTimeout(300);
const ids = await p.$$eval("script", () => window.CANDIDATES ? window.CANDIDATES.map((c) => c.id) : []);
const allIds = await p.evaluate(() => CANDIDATES.map((c) => c.id));
let broken = [];
for (const id of allIds) {
  await p.goto(url + "#/kandidat?id=" + id);
  await p.waitForTimeout(25);
  const t = await p.textContent("#view");
  if (t.includes("Kandidaten finns inte") || t.includes("undefined") || t.includes("NaN")) broken.push(id);
}
T("alla " + allIds.length + " kandidatsidor renderar", broken.length === 0, broken.join(", "));

console.log(errs.length ? "\nFEL I KONSOLEN:\n" + errs.join("\n") : "\nInga konsolfel.");


// ── 8. Dagsvyn ──────────────────────────────────────────────────────────
const dp = await b.newPage({ viewport: { width: 1440, height: 1100 } });
dp.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await dp.goto(url + "#/research");
await dp.waitForTimeout(500);
const dagKnappar = await dp.$$eval("[data-day]", (n) => n.map((x) => x.textContent.trim()));
T("dagsknappar renderas", dagKnappar.length >= 3, JSON.stringify(dagKnappar));
console.log("   dagar:", JSON.stringify(dagKnappar));
T("färskaste dagen först efter 'Alla dagar'", /I dag|I går|\d+ dagar/.test(dagKnappar[1] || ""), dagKnappar[1]);

const dagVarden = await dp.$$eval("[data-day]", (n) => n.map((x) => x.getAttribute("data-day")));
const senaste = dagVarden.find((v) => v !== "ALL");
await dp.click('[data-day="' + senaste + '"]');
await dp.waitForTimeout(400);
const dt = await dp.textContent("#view");
const antalEfter = await dp.evaluate((d) => CANDIDATES.filter((c) => c.dag === d).length, senaste);
T("dagsfilter begränsar listan", dt.includes("Kandidater (") && antalEfter > 0 && antalEfter < (await dp.evaluate(() => CANDIDATES.length)), senaste + " -> " + antalEfter);
T("nischen syns på kortet", dt.includes("mörkerkörning") || dt.includes("däckbyte") || dt.includes("garderob"), dt.slice(0, 200));

// Kandidatsidan ska bära dag, härkomst och varför
const nyHref = await dp.getAttribute('a[href^="#/kandidat"]', "href");
await dp.goto(url + nyHref);
await dp.waitForTimeout(400);
const nt = await dp.textContent("#view");
T("kandidatsidan visar researchdag", nt.includes("Researchdag"), nt.slice(0, 160));
T("kandidatsidan visar härkomst", /Säsong|Bredd|Manuell/.test(nt), "");
T("kandidatsidan förklarar valet", nt.includes("sex veckor före") || nt.includes("volym året om") || nt.includes("Körd för hand"), "");
T("färskhetsmärket syns", /I dag|I går|\d+ dagar/.test(nt), "");

// Sökningen ska nå nischen
await dp.goto(url + "#/research");
await dp.reload();
await dp.waitForTimeout(400);
await dp.fill("#q", "däckbyte");
await dp.waitForTimeout(400);
const st2 = await dp.textContent("#view");
T("sökning når nischen", !st2.includes("Inget matchar"), st2.slice(0, 160));
await dp.close();



// ── 9. Kalendervyn ──────────────────────────────────────────────────────
const kp = await b.newPage({ viewport: { width: 1440, height: 1200 } });
kp.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await kp.goto(url + "#/kalender");
await kp.waitForTimeout(500);
const kt = await kp.textContent("#view");
T("kalendervyn renderas", kt.includes("Kör detta nu") && kt.includes("Kommande toppar"), kt.slice(0, 160));
T("kalendern utgår från USA, inte Sverige", kt.includes("Kör detta nu i USA"), kt.slice(0, 120));
const marknader = await kp.$$eval("[data-kalmarknad]", (n) => n.map((x) => x.textContent.trim()));
T("alla fem marknader kan väljas", marknader.join(",") === "USA,Storbritannien,Australien,EU,Sverige", JSON.stringify(marknader));
T("USA visas utan moms i priset", kt.includes("utan moms i priset"), "");
// Australien har omvänd årstid — den ska synas i tabellen
await kp.click('[data-kalmarknad="AU"]');
await kp.waitForTimeout(300);
const au = await kp.textContent("#view");
T("Australien nämner omvänd årstid", au.includes("omvänd årstid"), au.slice(0, 160));
T("Australien siktar på sommar, inte vinter", /sommarförberedelse|strand/.test(au), au.slice(0, 200));
T("Australien räknar i AUD", au.includes("AUD"), "");
// Varje tema ska ha en länk till annonsbiblioteket för rätt marknad
const adlib = await kp.$$eval('a[href*="ads/library"]', (n) => n.map((x) => x.getAttribute("href")));
T("annonslänkar pekar på vald marknad", adlib.length > 0 && adlib.every((h) => h.includes("country=AU")), adlib[0] || "inga");
// Täckningen finns i Sverige, där allt faktiskt kördes
await kp.click('[data-kalmarknad="SE"]');
await kp.waitForTimeout(300);
T("navet har en kalenderflik", (await kp.$$eval("#nav a", (a) => a.map((x) => x.textContent.trim()))).includes("Kalender"));
T("siktar framåt, inte på i dag", /toppar omkring vecka \d+/.test(kt) && /Kör dem nu, inte då/.test(kt), kt.slice(0, 200));

const kt2 = await kp.textContent("#view");
T("Sverige siktar på däckbyte", kt2.includes("däckbyte"), kt2.slice(0, 200));
const korKnappar = await kp.$$eval("[data-kor]", (n) => n.map((x) => x.getAttribute("data-kor")));
const visaLankar = await kp.$$eval("[data-sok]", (n) => n.map((x) => x.getAttribute("data-sok")));
T("teman som körts visas som klara i Sverige", visaLankar.length >= 8, visaLankar.length + " klara");
T("teman som inte körts har en knapp", korKnappar.length >= 3, korKnappar.length + " oklara");
console.log("   researchade:", visaLankar.slice(0, 4).join(" · "));
console.log("   kvar att köra:", korKnappar.slice(0, 4).join(" · "));

// Täckningen får inte ljuga: varje "klar" ska ha kandidater i listan
const ljuger = await kp.evaluate((teman) => teman.filter((t) => !CANDIDATES.some((c) => c.niche &&
  (c.niche.toLowerCase() === t.toLowerCase() ||
   [...new Set(t.toLowerCase().split(/[^a-zåäö0-9]+/).filter((w) => w.length > 3))]
     .every((w) => c.niche.toLowerCase().includes(w))))), visaLankar);
T("inget tema påstås klart utan kandidater", ljuger.length === 0, JSON.stringify(ljuger));

// Deadline-kolumnen
T("tabellen visar sista researchdag", kt2.includes("Researcha senast"), "");
const korLand = await kp.$$eval("[data-kor]", (n) => n.map((x) => x.getAttribute("data-land")));
T("kör-knappen bär vald marknad", korLand.length > 0 && korLand.every((l) => l === "SE"), JSON.stringify(korLand.slice(0, 3)));
const forsenade = await kp.$$eval("td", (t) => t.filter((x) => x.textContent.includes("försenad")).length);
console.log("   försenade toppar:", forsenade);

// Klick på "Visa kandidaterna" ska landa i Research med sökningen satt
await kp.click('[data-sok]');
await kp.waitForTimeout(500);
const rt = await kp.textContent("#view");
T("visa-länken hoppar till Research", (await kp.evaluate(() => location.hash)) === "#/research", await kp.evaluate(() => location.hash));
T("sökningen är förifylld", (await kp.inputValue("#q")).length > 3, await kp.inputValue("#q"));
T("och ger träffar", !rt.includes("Inget matchar"), rt.slice(0, 160));
await kp.close();

await b.close();

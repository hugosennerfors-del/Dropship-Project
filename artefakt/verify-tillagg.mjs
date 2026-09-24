import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
/* Katalogen tas ur skriptets egen plats, så sviten går att köra från en
   checkout och inte bara från katalogen den skrevs i. */
const DIR = path.dirname(fileURLToPath(import.meta.url));

/* Sidan serveras över http i stället för file://. En file://-sida får en
   ogenomskinlig origin i Chromium, och då beter sig sessionStorage inte
   som den gör i en publicerad artefakt — persistenstesterna blev flaxiga
   av testmiljön, inte av koden. */
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(DIR + "/index.html"));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = "http://127.0.0.1:" + server.address().port + "/index.html";
const b = await chromium.launch();
let fel = 0;
const T = (l, c, x = "") => { if (!c) fel++; console.log((c ? "PASS " : "FEL  ") + l + (c ? "" : "  " + x)); };

/* En lagring som beter sig som den riktiga: skrivningar syns i efterföljande
   läsningar OCH överlever en omladdning, precis som db gör. Utan det hade
   persistenstesterna mätt mocken i stället för sidan. */
const mock = `(() => {
  const NYCKEL = "__mockdb";
  const store = JSON.parse(sessionStorage.getItem(NYCKEL) || '{"docs":{},"col":{}}');
  const spara = () => sessionStorage.setItem(NYCKEL, JSON.stringify(store));
  window.__db = store;
  window.__nedladdat = [];
  const snap = (arr) => ({ docs: arr.map(([id, data]) => ({ id, data: () => data })) });
  const colRef = (namn) => {
    store.col[namn] = store.col[namn] || {};
    const q = {
      doc(id) { return {
        async set(v) { store.col[namn][id] = v; spara(); },
        async delete() { delete store.col[namn][id]; spara(); },
      }; },
      orderBy() { return q; }, limit() { return q; }, where() { return q; },
      async get() { return snap(Object.entries(store.col[namn])); },
    };
    return q;
  };
  const db = {
    collection: colRef,
    doc(vag) { return {
      async get() { return { exists: vag in store.docs, data: () => store.docs[vag] }; },
      async set(v) { store.docs[vag] = v; spara(); },
    }; },
  };
  const downloads = { async save(o) { window.__nedladdat.push(o); } };
  window.claude = { use: async (n) => (n === "db" ? db : n === "downloads" ? downloads : null) };
})()`;

async function sida(hash) {
  const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
  p.on("pageerror", (e) => { fel++; console.log("PAGEERROR:", e.message); });
  await p.addInitScript(mock);
  await p.goto(url + hash);
  await p.waitForTimeout(450);
  return p;
}
const text = (p) => p.textContent("#view");

/* ── 1. Översikt: koncentrationsvarning ─────────────────────────────────── */
let p = await sida("#/");
let t = await text(p);
T("koncentrationsvarning på översikten", /av bidraget hänger på/.test(t));
T("varningen namnger den största produkten", /Posture Corrector|Vinterhandskar|hänger på \w/.test(t), t.slice(0, 0));
T("varningen länkar till risksidan", (await p.$$('a[href="#/risk"]')).length > 0);
T("ingen färskhetsvarning vid tre dagar", !/Siffrorna är \d+ dagar gamla/.test(t));

/* Färskhetsvarningen tänds av tiden, inte av en flagga. */
await p.evaluate(() => { META.generatedAt = "2026-08-10T08:00:00.000Z"; render(); });
await p.waitForTimeout(200);
t = await text(p);
T("färskhetsvarning vid 45 dagar", /Siffrorna är 45 dagar gamla/.test(t), t.slice(0, 120));
T("45 dagar nämner månadsrapportering", /månadsrapportering/.test(t));
await p.evaluate(() => { META.generatedAt = "2026-09-21T08:09:44.666Z"; render(); });

/* ── 2. Produktsidan: tratt, returer, jämförelse, scenario ──────────────── */
await p.goto(url + "#/produkt?sku=SPC-001");
await p.waitForTimeout(400);
t = await text(p);
T("CPA-trappan finns", /CPA-trappan/.test(t));
T("trappan säger att den väntar på data", /Väntar på data/.test(t));
T("trappan namnger de tomma kolumnerna", /impressions/.test(t) && /clicks/.test(t));
T("trappan visar CPA som ändå går att räkna", /105/.test(t.replace(/ /g, " ")), "");
T("trappan visar ingen NaN", !/NaN/.test(t));
T("returer säger att tabellen är tom", /Inga returer registrerade/.test(t));
T("returer nämner det antagna värdet", /antagna värdet/.test(t));
T("jämförelse mot poolen finns", /Mot kandidaternas antaganden/.test(t));
T("jämförelsen anger percentil", /percentilen av \d+ antaganden/.test(t), t.slice(0, 80));
T("scenariot finns", /Vad händer om/.test(t));

const poasRad = async () => (await p.$$eval("#view dl.rows .sum .num", (n) => n.map((x) => x.textContent.trim())))[0];
const poasFore = await poasRad();
await p.$eval('[data-scen="cpa"]', (el) => { el.value = "50"; el.dispatchEvent(new Event("input", { bubbles: true })); });
await p.waitForTimeout(250);
const poasEfter = await poasRad();
T("reglaget för annonskostnad räknar om POAS", poasFore !== poasEfter, poasFore + " -> " + poasEfter);
const nummer = (s) => Number(String(s).replace(/[^\d,.-]/g, "").replace(",", "."));
T("50 % dyrare annonser sänker POAS", nummer(poasEfter) < nummer(poasFore), poasFore + " -> " + poasEfter);
await p.click("#scenNoll");
await p.waitForTimeout(250);
T("nollställ återställer POAS", (await poasRad()) === poasFore, poasFore + " vs " + (await poasRad()));

/* Reglagen får inte röra databasen: samma tal ska stå kvar i KPI:n. */
await p.goto(url + "#/");
await p.waitForTimeout(300);
T("scenariot ändrade inget i ögonblicksbilden", /15\s200/.test((await text(p)).replace(/ /g, " ")));

/* ── 3. Kandidatsidan: policy och säsong ────────────────────────────────── */
await p.goto(url + "#/kandidat?id=9df592e2");
await p.waitForTimeout(400);
t = await text(p);
T("policyvarning på vuxenprodukt", /Meta tillåter inte annonsen/.test(t));
T("policyvarningen säger varför", /Vuxenprodukter får inte annonseras/.test(t));
T("policyvarningen tar inte bort siffrorna", /Täckningsbidrag/.test(t));
T("rubriken bär märket Inte på Meta", /Inte på Meta/.test(t));
const iListan = await (async () => {
  await p.goto(url + "#/research");
  await p.waitForTimeout(400);
  const rader = await p.$$eval("#view article.glass", (n) => n.map((x) => x.textContent));
  await p.goto(url + "#/kandidat?id=9df592e2");
  await p.waitForTimeout(400);
  return rader.filter((r) => /vibrator|dildo|G-punkt/i.test(r));
})();
T("blockerade kandidater märks även i listan", iListan.length > 0 && iListan.every((r) => /Inte på Meta/.test(r)),
  String(iListan.length) + " rader, " + iListan.filter((r) => !/Inte på Meta/.test(r)).length + " omärkta");

const q4 = await p.evaluate(() => {
  const c = CANDIDATES.find((x) => x.id === "9df592e2");
  return { nov: q4Justerad(c, 11), sep: q4Justerad(c, 9), bas: c.expectedPoas };
});
T("november räknas 40 % dyrare", Math.abs(q4.nov.faktor - 1.4) < 1e-9, String(q4.nov.faktor));
T("september lämnas orörd", q4.sep.faktor === 1);
T("dyrare annonser ger lägre POAS", q4.nov.poas < q4.bas, q4.nov.poas + " vs " + q4.bas);
T("säsongsrutan göms i en neutral månad", !/Säsongen i annonsauktionen/.test(t));

const harPolicy = await p.evaluate(() => ({
  massage: !!policy(CANDIDATES.find((c) => /massage/i.test(c.name))),
  block: CANDIDATES.filter((c) => (policy(c) || {}).niva === "block").length,
  ren: CANDIDATES.filter((c) => !policy(c)).length,
}));
T("hälsoprodukt flaggas som risk, inte block", harPolicy.massage === true);

/* Leverantör, ledtid och kalkylens ålder. */
T("leverantörsrutan finns", /Leverantör och kalkylens ålder/.test(t));
T("kalkylens ålder anges", /Kalkylen (räknades för \d+|är \d+ dagar gammal)/.test(t), t.slice(0, 0));
await p.$eval('[data-lev$="|ledtid"]', (el) => { el.value = "26"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(350);
t = await text(p);
T("lång ledtid larmar", /26 dagars ledtid bygger in ett/.test(t), t.slice(0, 0));
await p.$eval('[data-lev$="|ledtid"]', (el) => { el.value = "9"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(350);
t = await text(p);
T("kort ledtid godkänns men med förbehåll", /9 dagars ledtid är hanterbart/.test(t));
await p.$eval('[data-lev$="|url"]', (el) => { el.value = "https://example.com/vara"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(350);
const lev = await p.evaluate(() => window.__db.col.leverantorer);
T("leverantören sparas per kandidat", lev["9df592e2"] && lev["9df592e2"].ledtid === "9", JSON.stringify(lev));

/* Avgiftskontrollen: kandidatens antagna avgift mot tabellen. */
const avg = await p.evaluate(() => {
  const c = CANDIDATES.find((x) => x.id === "9df592e2");
  /* 699 kr till 1,5 % plus 1,80 kr fast ger 12,29 kr; kalkylen antar 21 kr. */
  const tabell = avgiftAv(c.country, c.inputs.sale * c.inputs.units);
  const narmare = Object.assign({}, c, { inputs: Object.assign({}, c.inputs, { fee: Math.round(tabell * 100) / 100 }) });
  return { html: kandidatAvgift(c), lika: kandidatAvgift(narmare), fee: c.inputs.fee, tabell };
});
T("tabellen räknar procent plus fast avgift", Math.abs(avg.tabell - 12.285) < 0.01, String(avg.tabell));
T("en generös antagen avgift pekas ut", /ser generös ut/.test(avg.html), avg.html.slice(0, 120));
T("den säger hur mycket bidraget faktiskt är bättre", /bättre per order än kalkylen visar/.test(avg.html));
T("avgiftskontrollen tiger när talen stämmer", avg.lika === "", avg.lika.slice(0, 120));
T("blockerade är en delmängd, inte allt", harPolicy.block > 0 && harPolicy.block < 140, String(harPolicy.block));
T("de flesta kandidater går fria", harPolicy.ren > 60, String(harPolicy.ren));

/* ── 4. Kassa ───────────────────────────────────────────────────────────── */
await p.goto(url + "#/kassa");
await p.waitForTimeout(400);
t = await text(p);
T("kassavyn renderas", /Så ligger pengarna/.test(t));
T("kassalinjen finns", /Kassalinje 60 dagar/.test(t));
/* Antagen returgrad är noll i inställningarna, så linjen rör sig inte —
   och det ska stå rakt ut att det är för optimistiskt, inte döljas. */
T("noll antagen returgrad sägs vara optimistiskt", /nästan säkert för optimistiskt/.test(t), t.slice(0, 0));
T("den sätter en siffra på vad en procent kostar", /drar\s+linjen nedåt med ungefär/.test(t.replace(/\s+/g, " ")), t.slice(0, 0));
T("returfönstret går att ställa in", (await p.$$('[data-kassa="returdagar"]')).length === 1);
T("glappet mot utbetalning pekas ut", /Returfönstret är 23 dagar/.test(t), t.slice(0, 0));
T("avgiftstabellen finns i kassan", /Avgifter per marknad/.test(t));
T("avgifterna sägs vara listpriser, inte hämtade", /inte hämtade från ditt konto/.test(t));
await p.$eval('[data-kassa="kassa"]', (el) => { el.value = "40000"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(350);
t = await text(p);
T("40 000 i kassa håller perioden", /Kassan håller hela perioden/.test(t), t.slice(0, 200));
const sparat = await p.evaluate(() => window.__db.docs["plan/kassa"]);
T("kassan sparas i lagringen", sparat && sparat.kassa === 40000, JSON.stringify(sparat));
await p.$eval('[data-kassa="kassa"]', (el) => { el.value = "3000"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(350);
t = await text(p);
T("3 000 i kassa tar slut", /Kassan tar slut dag \d+/.test(t), t.slice(0, 200));
T("kassabrist skiljs från olönsamhet", /inte samma sak som att affären är olönsam/.test(t));

/* Lagret läses asynkront och ritar om när det är klart, så vänta på värdet
   i stället för på klockan — annars mäter testet renderingsordningen. */
await p.reload();
const sparatVarde = await p.waitForFunction(() => {
  const el = document.querySelector('[data-kassa="kassa"]');
  return el && el.value !== "0" ? el.value : false;
}, null, { timeout: 5000 }).then((h) => h.jsonValue()).catch(() => null);
T("inmatningen överlever omladdning", sparatVarde === "3000", String(sparatVarde));

/* Avgiftstabellen: en höjd procentsats ska slå igenom på exempelordern. */
const avgiftFore = (await p.$$eval("#view table tbody tr td:last-child", (n) => n.map((x) => x.textContent.trim()))).slice(-5)[0];
await p.$eval('[data-avgift="US|pct"]', (el) => { el.value = "4.5"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(350);
const avgiftEfter = (await p.$$eval("#view table tbody tr td:last-child", (n) => n.map((x) => x.textContent.trim()))).slice(-5)[0];
T("höjd avgift räknas om direkt", avgiftFore !== avgiftEfter, avgiftFore + " -> " + avgiftEfter);
T("avgiften sparas", (await p.evaluate(() => window.__db.docs["plan/avgifter"])).US.pct === 4.5);
await p.$eval('[data-avgift="US|pct"]', (el) => { el.value = "2.9"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(300);

/* ── 5. Test: livscykel, beslut, konkurrenter, kreativa ─────────────────── */
await p.goto(url + "#/test");
await p.waitForTimeout(400);
t = await text(p);
T("testvyn renderas", /Träffsäkerhet/.test(t));
T("utan utfall sägs det rakt ut", /Ingen kandidat har ett verkligt utfall/.test(t));
T("inget test pågår från start", /Inget test pågår/.test(t));
T("kandidater att starta listas", /Starta ett test/.test(t));
T("blockerade kandidater erbjuds inte som test", /kandidater är utelämnade eftersom Meta inte släpper igenom dem/.test(t));
/* Tabellen hittas via Testa-knappen, inte via ordningsnummer: när inget test
   pågår ritas den första sektionen som en tom ruta och numret glider. */
const testbara = await p.evaluate(() =>
  [...document.querySelectorAll("#view [data-starta]")]
    .map((b) => b.closest("tr").querySelector("td").textContent.trim()));
T("ingen vuxenprodukt i testlistan", !testbara.some((n) => /vibrator|dildo|g-punkt/i.test(n)), testbara.join(" | "));
/* Ett namn är antingen helt, eller klippt med ellips på ordgräns — aldrig
   avhugget mitt i ett ord som "app-styrni". */
const heltNamn = await p.evaluate(() => CANDIDATES.map((c) => c.name));
const trasiga = testbara.filter((visat) => {
  if (heltNamn.includes(visat)) return false;            // oklippt
  if (!visat.endsWith("…")) return true;            // klippt utan ellips
  const stam = visat.slice(0, -1);
  const helt = heltNamn.find((h) => h.startsWith(stam));
  if (!helt) return true;                                // inte ens en prefix
  return helt[stam.length] !== " ";                      // klippt mitt i ett ord
});
T("namn är antingen hela eller klippta på ordgräns", trasiga.length === 0, trasiga.join(" | "));
T("något namn klipps faktiskt", testbara.some((n) => n.endsWith("…")), testbara.join(" | "));

await p.click("[data-starta]");
await p.waitForTimeout(400);
t = await text(p);
T("en kandidat flyttas till test", /Under test \(1\)/.test(t), t.slice(0, 160));
const livs = await p.evaluate(() => Object.values(window.__db.col.livscykel || {}));
T("steget sparas", livs.length === 1 && livs[0].steg === "testas", JSON.stringify(livs));

await p.$eval("[data-verklig]", (el) => { el.value = "420"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(400);
t = await text(p);
T("snittfelet räknas när utfall finns", /snittfel på CPA över 1 test/.test(t), t.slice(0, 200));
T("felet får en riktning", /gissar systematiskt för lågt|gissar för högt|ligger nära utfallet/.test(t));

await p.fill("#beslutText", "Stoppade posture corrector — CPA 3x gissningen.");
await p.click("#beslutSpara");
await p.waitForTimeout(400);
t = await text(p);
T("beslutet syns i loggen", /Stoppade posture corrector/.test(t));
T("beslutet sparas", Object.keys(await p.evaluate(() => window.__db.col.beslut || {})).length === 1);

await p.fill("#konkNamn", "nordic grip");
await p.fill("#konkAntal", "14");
await p.click("#konkSpara");
await p.waitForTimeout(400);
t = await text(p);
T("konkurrenten listas", /nordic grip/.test(t));
T("mätningen syns", /14/.test(t));
/* Samma sökord samma dag är en rättelse, inte en ny mätpunkt. */
await p.fill("#konkNamn", "nordic grip");
await p.fill("#konkAntal", "11");
await p.click("#konkSpara");
await p.waitForTimeout(400);
let konk = await p.evaluate(() => Object.values(window.__db.col.konkurrenter || {}));
T("samma sökord samma dag ersätter mätningen", konk.length === 1 && konk[0].matningar.length === 1, JSON.stringify(konk));
T("det är den senaste siffran som står kvar", konk[0].matningar[0].antal === 11);

/* En mätning från förra veckan ger raden en riktning. */
await p.evaluate(() => {
  const id = Object.keys(window.__db.col.konkurrenter)[0];
  const k = window.__db.col.konkurrenter[id];
  k.matningar = [{ dag: "2026-09-17", antal: 6 }].concat(k.matningar);
  sessionStorage.setItem("__mockdb", JSON.stringify(window.__db));
});
await p.reload();
await p.waitForTimeout(500);
t = await text(p);
T("två mätdagar ger en riktning uppåt", /▲5/.test(t), t.slice(0, 0));
T("historiken syns", /09-17: 6/.test(t), t.slice(0, 0));
konk = await p.evaluate(() => Object.values(window.__db.col.konkurrenter || {}));
T("samma sökord slås ihop till en rad", konk.length === 1 && konk[0].matningar.length === 2, JSON.stringify(konk));

await p.fill("#kreaHook", "Stel rygg efter passet?");
await p.selectOption("#kreaTyp", "problem");
await p.fill("#kreaCtr", "1.8");
await p.fill("#kreaCpa", "230");
await p.fill("#kreaFrek", "1.4");
await p.click("#kreaSpara");
await p.waitForTimeout(400);
t = await text(p);
T("kreativen loggas", /Stel rygg efter passet/.test(t));
T("CTR visas med enhet", /1,80 %|1\.80 %/.test(t));
T("hooktypen följer med", /Problemet först/.test(t));
T("frekvens under 2,5 flaggas inte", !/Byt film/.test(t));
T("frekvensen förklaras när inget är utslitet", /Över 2,5 tillsammans med fallande CTR/.test(t));

await p.fill("#kreaHook", "Priset i första bilden");
await p.selectOption("#kreaTyp", "pris");
await p.fill("#kreaCtr", "0.9");
await p.fill("#kreaFrek", "3.1");
await p.click("#kreaSpara");
await p.waitForTimeout(400);
t = await text(p);
T("frekvens över 2,5 flaggas", /Byt film/.test(t));
T("utmattningen förklaras som trötthet, inte produktfel", /av trötthet, inte för att produkten slutat/.test(t));
T("vinkelbiblioteket byggs", /Vinkelbibliotek/.test(t));
T("bästa hooktypen hamnar överst", t.indexOf("Problemet först") < t.indexOf("Priset först"));
T("för få kreativa sägs rakt ut", /För få kreativa för att dra en slutsats/.test(t));

await p.reload();
await p.waitForTimeout(500);
t = await text(p);
T("allt finns kvar efter omladdning", /Stoppade posture corrector/.test(t) && /nordic grip/.test(t) && /Stel rygg/.test(t));

/* ── 6. Risk ────────────────────────────────────────────────────────────── */
await p.goto(url + "#/risk");
await p.waitForTimeout(400);
t = await text(p);
T("riskvyn renderas", /Koncentration/.test(t));
T("dödsregeln finns", /Dödsregeln/.test(t));
T("40 och 30 ordrar räcker för att dömas vid gränsen 30", !/För tidigt att döma/.test(t));
T("registreringströsklar listas", /Registreringströsklar/.test(t));
T("OSS-tröskeln nämns", /OSS/.test(t));
T("USA sägs vara per delstat", /PER DELSTAT/.test(t));
T("tröskelraderna står på noll tills utlandsorder finns", /Ingen försäljning/.test(t));
T("annonspolicyn summeras", /Blockerade/.test(t) && /Kräver försiktighet/.test(t));
T("kontohälsan finns", /Annonskontots hälsa/.test(t));
T("avslagsandel är tom utan inmatning", /Avslagsandel/.test(t));
T("det vi inte vet redovisas", /Det vi inte vet/.test(t));
T("returgraden över tid listas som okänd", /Returgrad över tid/.test(t));

await p.$eval('[data-kassa="kontoInskickade"]', (el) => { el.value = "40"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(300);
await p.$eval('[data-kassa="kontoAvslagna"]', (el) => { el.value = "10"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(350);
t = await text(p);
T("25 % avslag larmar", /Var femte annons avslås/.test(t), t.slice(0, 0));
T("kontot sparas separat", (await p.evaluate(() => window.__db.docs["plan/konto"])).avslagna === 10);
await p.$eval('[data-kassa="kontoAvslagna"]', (el) => { el.value = "1"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(350);
t = await text(p);
T("låg avslagsandel ger friskt konto", /Kontot ser friskt ut/.test(t));
T("återköp sägs sakna kundidentitet", /saknar kundidentitet/.test(t));
T("valutaexponering sägs sakna kurskälla", /Ingen kurskälla är inkopplad/.test(t));

await p.$eval('[data-kassa="manadsbudget"]', (el) => { el.value = "6000"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(350);
t = await text(p);
T("budgeten slår i taket", /budgeten slut/.test(t), t.slice(0, 200));
const risk = await p.evaluate(() => window.__db.docs["plan/risk"]);
T("budgeten sparas separat från kassan", risk && risk.manadsbudget === 6000, JSON.stringify(risk));

await p.$eval('[data-kassa="killOrdrar"]', (el) => { el.value = "10"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(350);
t = await text(p);
T("sänkt ordergräns fäller dom", /Regeln säger stäng av/.test(t), t.slice(0, 200));
await p.$eval('[data-kassa="killOrdrar"]', (el) => { el.value = "100"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(350);
t = await text(p);
T("höjd ordergräns gör utfallet för tidigt att döma", /För tidigt att döma/.test(t), t.slice(0, 200));
T("ingen dom faller under gränsen", !/Regeln säger stäng av/.test(t));

/* ── 7. CSV ─────────────────────────────────────────────────────────────── */
await p.goto(url + "#/research");
await p.waitForTimeout(400);
await p.click("#exportCsv");
await p.waitForTimeout(400);
const ned = await p.evaluate(() => window.__nedladdat);
T("en fil erbjuds", ned.length === 1 && ned[0].filename === "kandidater.csv", JSON.stringify(ned.map((x) => x.filename)));
const csv = ned[0] ? ned[0].data : "";
const rader = csv.split("\n");
T("rubrikrad först", rader[0].includes("namn;land;valuta"), rader[0].slice(0, 60));
T("alla kandidater med", rader.length === 141, String(rader.length));
T("policykolumnen fylls", /;block;|;risk;/.test(csv));
T("semikolon som avgränsare, inte komma", rader[1].split(";").length === 19, rader[1].slice(0, 80));
T("BOM så Excel läser åäö", csv.charCodeAt(0) === 0xfeff);
T("knappen bekräftar", (await p.textContent("#exportCsv")) === "Sparad");

/* ── 8. Utan lagring alls: inget får krascha ────────────────────────────── */
const p2 = await b.newPage({ viewport: { width: 390, height: 900 } });
const fel2 = [];
p2.on("pageerror", (e) => fel2.push(e.message));
for (const h of ["#/", "#/kassa", "#/test", "#/risk", "#/produkt?sku=SPC-001", "#/kandidat?id=9df592e2"]) {
  await p2.goto(url + h);
  await p2.waitForTimeout(300);
  const bredd = await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  T("mobil utan lagring: " + h, bredd && fel2.length === 0, fel2.join(" | "));
}
T("nya vyerna når navet", (await p2.$$('a[href="#/kassa"], a[href="#/test"], a[href="#/risk"]')).length >= 3);

/* ── 9. Innan lagret hunnit fram dras inga slutsatser ───────────────────── */
const p3 = await b.newPage({ viewport: { width: 1440, height: 1000 } });
p3.on("pageerror", (e) => { fel++; console.log("PAGEERROR:", e.message); });
await p3.addInitScript(`(() => {
  const langsam = new Promise((r) => setTimeout(() => r(null), 3000));
  window.claude = { use: () => langsam };
})()`);
await p3.goto(url + "#/kassa");
await p3.waitForTimeout(500);
const under = await p3.textContent("#view");
T("ingen konkursdom medan lagret läses", !/Kassan tar slut dag/.test(under), under.slice(0, 120));
T("den säger att den läser", /Läser dina sparade inmatningar/.test(under));
await p3.goto(url + "#/risk");
await p3.waitForTimeout(400);
T("risksidan säger samma sak", /Läser dina sparade inmatningar/.test(await p3.textContent("#view")));
await p3.close();

await b.close();
server.close();
console.log(fel === 0 ? "\nAllt grönt." : "\n" + fel + " fel.");

import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
const url = "file:///tmp/claude-0/-home-user-Dropship-Project/d8fc5821-8dc5-5fdf-ab43-bfc4a2d57554/scratchpad/art/index.html";
const b = await chromium.launch();
const T = (l, c, x = "") => console.log((c ? "PASS " : "FEL  ") + l + (c ? "" : "  " + x));

/* Mockad koppling med samma svarsformer som n8n faktiskt gav i körning 1388. */
const mock = (mode) => `(() => {
  const ITEMS = [
    {json:{name:"Vikbar träningsbänk med ryggstöd",notes:"Högre AOV, tydlig hemmagym-vinkel.",cost_per_unit_incl_vat:68,sale_price_incl_vat:249,shipping_cost_per_order:39,transaction_fee_per_order:7.47,expected_cpa_incl_vat:115,expected_units_per_order:1,
      ad_plan:{angle:"Ett helt gym under sängen",hook:"Du behöver inte ett gym.",format:"UGC-demo 15 s",script:["0-3 s: stökigt vardagsrum","3-7 s: demo"],audience:"20-45 år",primaryText:"En enkel träningsgrej.",headline:"Träna hemma",adLibraryQuery:"folding bench"}}},
    {json:{name:"Massagepistol med fyra munstycken",notes:"Visuellt stark demo.",cost_per_unit_incl_vat:390,sale_price_incl_vat:1299,shipping_cost_per_order:120,transaction_fee_per_order:39,expected_cpa_incl_vat:420,expected_units_per_order:1,
      ad_plan:{angle:"Återhämtning på 60 sekunder",hook:"Stel rygg efter passet?",format:"Före/efter 12 s",script:["0-4 s: stel nacke"],audience:"25-50 år",primaryText:"Mjuka upp musklerna hemma.",headline:"Återhämta snabbare",adLibraryQuery:"massage gun"}}},
    {json:{name:"Kompakt hopprep med räknare",notes:"Dubblett — finns redan i ögonblicksbilden.",cost_per_unit_incl_vat:68,sale_price_incl_vat:249,shipping_cost_per_order:39,transaction_fee_per_order:7.47,expected_cpa_incl_vat:115,expected_units_per_order:1,ad_plan:null}},
  ];
  let polls = 0;
  window.__calls = [];
  window.__saved = [];
  const mcp = {
    async callTool(server, tool, input, opts) {
      window.__calls.push({ server, tool, input, opts });
      if ("${mode}" === "reauth") throw { code: "needs_reauth", message: "token expired" };
      if ("${mode}" === "toolerr" && tool === "execute_workflow") throw { code: "tool_error", message: "Workflow är inte publicerat." };
      if (tool === "execute_workflow") return { payload: { executionId: "1388", status: "started" } };
      if (tool === "get_workflow_execution" && !input.includeData) {
        polls++;
        return { payload: { execution: { id: "1388", status: polls < 2 ? "running" : "success" } } };
      }
      return { payload: { data: { resultData: { runData: { "Dela upp kandidater": [ { data: { main: [ITEMS] } } ] } } } } };
    },
  };
  const db = {
    collection(){ return {
      doc(id){ return { async set(v){ window.__saved.push(id); } }; },
      orderBy(){ return this; }, limit(){ return this; },
      async get(){ return { docs: [] }; },
    }; },
  };
  window.claude = { use: async (n) => ("${mode}" === "nomcp" ? null : n === "mcp" ? mcp : n === "db" ? db : null) };
})()`;

async function page(mode) {
  const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  if (mode) await p.addInitScript(mock(mode));
  await p.goto(url + "#/research");
  await p.waitForTimeout(500);
  return p;
}

// ── 1. Panelen utan koppling alls (lokal fil, inget window.claude) ──
let p = await page(null);
T("panelen renderas", await p.isVisible("#runResearch"));
T("knappen är avstängd utan sökning", await p.isDisabled("#runResearch"));
T("knappen ber om en sökning", (await p.textContent("#runResearch")).includes("Skriv en sökning först"));
T("marknadsväljaren har alla sex marknader", (await p.$$eval("#rCountry option", (o) => o.length)) === 6);
await p.fill("#q", "vinterjackor");
await p.waitForTimeout(350);
T("knappen aktiveras av sökningen", !(await p.isDisabled("#runResearch")));
T("knappen visar sökordet", (await p.textContent("#runResearch")).includes("vinterjackor"));
await p.click("#runResearch");
await p.waitForTimeout(600);
let t = await p.textContent("#view");
T("utan koppling: förklarar varför", t.includes("inte tillgång till dina kopplingar"), t.slice(0, 200));
await p.close();

// ── 2. Fel som kräver återanslutning ──
p = await page("reauth");
await p.fill("#q", "vinterjackor");
await p.waitForTimeout(350);
await p.click("#runResearch");
await p.waitForTimeout(800);
t = await p.textContent("#view");
T("needs_reauth ger sin egen åtgärd", t.includes("återanslutas") && t.includes("Kopplingar"), t.slice(0, 200));
await p.close();

// ── 3. Verktygsfel visar n8n:s eget meddelande ──
p = await page("toolerr");
await p.fill("#q", "vinterjackor");
await p.waitForTimeout(350);
await p.click("#runResearch");
await p.waitForTimeout(800);
t = await p.textContent("#view");
T("tool_error visar n8n:s meddelande", t.includes("inte publicerat"), t.slice(0, 200));
await p.close();

// ── 4. Hela flödet ──
p = await page("ok");
const before = await p.evaluate(() => CANDIDATES.length);
await p.selectOption("#rCountry", "GB");
await p.waitForTimeout(250);
await p.fill("#q", "träningsutrustning");
await p.waitForTimeout(350);
await p.click("#runResearch");
await p.waitForTimeout(600);
T("statusraden visar att den startar", (await p.textContent("#view")).includes("Startar körningen"), "");
// Första pollen sker efter 2 s; texten byter först då.
await p.waitForTimeout(2200);
T("statusraden visar att den kör", (await p.textContent("#view")).includes("Söker fram produkter"), (await p.textContent("#view")).slice(0, 160));
await p.waitForTimeout(8000);
t = await p.textContent("#view");
const after = await p.evaluate(() => CANDIDATES.length);
T("två nya kandidater lades till", after === before + 2, before + " -> " + after);
T("dubbletten mot ögonblicksbilden filtrerades bort", t.includes("2 nya kandidater"), t.slice(0, 300));
T("vyn hoppar till körningens marknad", await p.$eval('[data-country="GB"]', (e) => e.getAttribute("aria-pressed")) === "true");
T("sökrutan rensas så resultatet syns", (await p.inputValue("#q")) === "");
T("den nya bänken syns i listan", t.includes("Vikbar träningsbänk"), "");
T("de sparades i sidans lagring", (await p.evaluate(() => window.__saved.length)) === 2, JSON.stringify(await p.evaluate(() => window.__saved)));

const calls = await p.evaluate(() => window.__calls);
T("startanropet är production", calls[0].input.executionMode === "production", JSON.stringify(calls[0].input));
T("startanropet skickar nisch och land", calls[0].input.inputs.webhookData.body.niche === "träningsutrustning" && calls[0].input.inputs.webhookData.body.country === "GB", JSON.stringify(calls[0].input.inputs));
T("inga anrop cachas", calls.every((c) => c.opts && c.opts.cache === false), "");
T("hämtningen begränsas till rätt nod", calls[calls.length - 1].input.nodeNames[0] === "Dela upp kandidater", "");

// Ny kandidat: räknad i GB-moms och öppningsbar
const gb = await p.evaluate(() => {
  const c = CANDIDATES.find((x) => x.name.indexOf("träningsbänk") > -1);
  return c && { country: c.country, cur: c.cur, contribution: Math.round(c.contribution * 100) / 100, verdict: c.verdict, id: c.id, hasAd: !!(c.ad && c.ad.hook) };
});
T("ny kandidat bär rätt marknad", gb && gb.country === "GB" && gb.cur === "GBP", JSON.stringify(gb));
T("ny kandidat räknas med 20 % moms", gb && Math.abs(gb.contribution - (249 / 1.2 - (68 / 1.2 + 39 / 1.2 + 7.47 / 1.2))) < 0.01, JSON.stringify(gb));
T("ny kandidat bär sitt annonsupplägg", gb && gb.hasAd, JSON.stringify(gb));
await p.goto(url + "#/kandidat?id=" + gb.id);
await p.waitForTimeout(400);
const ct = await p.textContent("#view");
T("nya kandidatens sida öppnas", ct.includes("Annonsupplägg") && ct.includes("Du behöver inte ett gym"), ct.slice(0, 200));
await p.close();
await b.close();

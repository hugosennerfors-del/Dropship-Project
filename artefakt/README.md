# Plan-vy Intelligence — artefaktkällan

Sidan som ligger publicerad på claude.ai byggs härifrån. Den är helt statisk:
ingen fetch, inget backend-anrop vid körning. Data ligger inbakad i `data.js`,
hämtad från n8n-workflowet **Plan-vy · Intelligence-API** (körning 1387).

## Filer

| Fil | Roll |
| --- | --- |
| `head.html` | `<head>`, typografi och all CSS |
| `body.html` | Skalet: bakgrund, sidomeny, topprad, `#view` |
| `data.js` | Ögonblicksbilden från API:t — META, OVERVIEW, PRODUCTS, ALERTS, RAW_CANDIDATES, AD_PLANS, AI |
| `app.js` | Vyer, kalkyl, chansscore, router |
| `build.mjs` | Slår ihop ovanstående till `index.html` |
| `gen-data.mjs` | Gör om ett API-svar till `data.js` |
| `verify.mjs` | Playwright-kontroller: vyer, marknader, mobil (48 st) |
| `verify-research.mjs` | Playwright-kontroller: research-körningen, med mockad koppling (26 st) |
| `verify-tillagg.mjs` | Playwright-kontroller: Kassa, Test, Risk, policy, CSV (127 st) |
| `index.html` | Det som publiceras — genererad, redigera den inte för hand |

## Bygga och kontrollera

```
node build.mjs
node verify.mjs
node verify-research.mjs
node verify-tillagg.mjs
```

`verify-tillagg.mjs` startar en egen http-server på `127.0.0.1` i stället för
att öppna `file://`. En `file://`-sida får en ogenomskinlig origin i Chromium
och då beter sig `sessionStorage` inte som i en publicerad artefakt — testerna
för att inmatningar överlever en omladdning blev flaxiga av miljön, inte av
koden.

## Köra ny research från sidan

En artefakt får inte göra nätverksanrop, så sidan kan inte ringa n8n:s webhook
direkt. I stället går den via läsarens egen n8n-koppling i claude.ai, med
capability `mcp`:

```
capabilities: {
  mcp: { servers: [{ server: "n8n", tools: ["execute_workflow", "get_workflow_execution"] }] },
  db: {},
  downloads: true,
}
```

Flödet: `execute_workflow` startar `Plan-vy · Research-generator (API)` i
produktionsläge med `{niche, country}`, sidan pollar `get_workflow_execution`
tills körningen är klar (cirka 20 sekunder), och läser kandidaterna ur noden
`Dela upp kandidater`. Inget anrop cachas, och bara läsningar görs om — en
körning som redan startat startas aldrig om automatiskt.

Nya kandidater sparas två gånger: i n8n:s `product_candidates` av arbetsflödet,
och i sidans egen `db` så att de finns kvar efter en omladdning. Dubbletter
sorteras bort på namn, och den inbakade raden vinner eftersom den bär
databasens riktiga id.

Varje felkod har sin egen åtgärd i `MCP_FIX`. En gemensam "något gick fel"
döljer just den knapp som skulle laga sidan, så den finns inte.

## Hämta färsk data

Kör `Plan-vy · Intelligence-API` i n8n, ta `Slå ihop svar`-nodens `payload`,
och generera om `data.js`. Kandidaternas kalkyl räknas om i sidan ur indata
med samma formel som backenden, så talen inte kan glida isär.

## Marknader

Varje kandidat bär ett land. Momssatsen följer landet (SE 25 %, GB 20 %,
DE 19 %, FI 25,5 %), och belopp visas i marknadens egen valuta. Banden för
CPA-realism och bidrag är satta per marknad och grovt kalibrerade mot
prisnivån där — inte mot dagsfärsk växelkurs. Chansscore jämförs därför
inom en marknad, inte mellan två.

Verklighetskollen mot dina egna siffror är avstängd utanför Sverige: alla
liveprodukter säljs i SEK, och en CAC i en valuta säger ingenting om en CPA
i en annan.

## Vad sidan räknar och vad den frågar efter

Regeln genom hela sidan: **siffror som går att räkna fram ur data räknas fram,
siffror som bara användaren vet frågas efter, och siffror som saknas sägs
sakna.** Ingenting fylls i med gissningar som ser ut som mätningar.

Räknas fram ur `data.js`: koncentrationsrisk, poolplacering av CAC,
Q4-påslaget på CPA, policykontrollen, dödsregeln, scenarioreglagen och
budgettakten.

Frågas efter (sparas i sidans `db`, når aldrig n8n): kassa och betalvillkor,
returfönster, månadsbudget, verklig CPA per test, beslutslogg,
konkurrentmätningar, kreativa med frekvens och hooktyp, avgiftssatser per
marknad, leverantörslänk och ledtid, samt avslagsräkningen för annonskontot.

Sägs sakna, med orsak, under **Risk → Det vi inte vet**: återköpsfrekvens
(ordertabellen har ingen kundidentitet), valutaexponering (ingen kurskälla),
annonstratten (`impressions` och `clicks` finns som kolumner men är tomma)
och returgrad över tid (`returns` är tom).

`lagerKlart` gör att Kassa och Risk håller inne sina slutsatser tills lagret
lästs. Utan det skulle en tom kassa på noll se ut som en konkurs under de
första hundra millisekunderna.

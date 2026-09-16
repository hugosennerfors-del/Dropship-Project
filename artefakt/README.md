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
| `verify.mjs` | Playwright-kontroller mot `index.html` |
| `index.html` | Det som publiceras — genererad, redigera den inte för hand |

## Bygga och kontrollera

```
node build.mjs
node verify.mjs
```

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

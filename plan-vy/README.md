# Plan-vy Intelligence

Dashboard för lönsamhet och produktresearch i dropshipping-portföljen.
Next.js 15 (App Router) · React 19 · TypeScript · Tailwind 4 · Recharts · Framer Motion.

Appen har **ingen egen backend och ingen databas**. All data hämtas från
n8n-workflowet `Plan-vy · Intelligence-API`.

```bash
npm install
npm run dev     # http://localhost:3000
```

Standardperiod är `2026-09`. Byt period med väljaren i toppbaren — den skriver
`?month=YYYY-MM` i URL:en, så en vy går att dela som länk.

## Endpoints

| Metod | URL | Används av |
|---|---|---|
| GET | `…/webhook/plan-vy-api?month=YYYY-MM` | hela appen |
| POST | `…/webhook/plan-vy-research-generate` | knappen "Generera idéer" på /research |

`NEXT_PUBLIC_PLAN_VY_API` pekar om bas-URL:en (se `.env.example`). Utan den går
allt mot skarp backend.

GET-anropet skickar med flit **inga egna request-headers**. Webhook-noden har
ingen `allowedOrigins` satt utan sätter bara `Access-Control-Allow-Origin` på
svaret, så anropet måste förbli en "simple request" — en extra header gör att
webbläsaren skickar en OPTIONS-preflight först, och då faller anropet.

## Sidor

| Rutt | Innehåll |
|---|---|
| `/` | Business Health Score, KPI:er, AI-sammanfattning, larm, datakällor |
| `/products` | Sorterbar tabell (kort under `md`), filter vinnare/förlorare |
| `/products/[sku]` | Produkten som nav: verdict → score → demand → kundröst → konkurrens → ads → financials → marknad → analys → möjligheter → risker → källor |
| `/research` | Kandidatkort med kalkyl och verdict, plus AI-generator |
| `/alerts` | Larm grupperade på allvarlighetsgrad |
| `/insights` | Narrativ, rekommendationer, risker, nästa steg |

## Fyra ställen där API:t inte ser ut som man tror

Typerna i `src/lib/types.ts` är skrivna mot vad backenden **faktiskt** skickar,
verifierat mot en körning av workflowet. Fyra avvikelser mot den spec som
cirkulerat, alla sådana som ger tyst trasigt UI:

1. **`products[].status` är `scale` | `profit` | `watch` | `cut`.**
   Backenden sätter `poas>=1.5 → scale`, `>=1 → profit`, `>=0.8 → watch`, annars
   `cut`. Värdet `winner` skickas aldrig. En uppslagstabell byggd på `winner`
   hade gett tomma statuspiller för alla lönsamma produkter. `isWinner()` i
   `src/lib/ui.ts` definierar vinnare som `scale | profit`, vilket matchar
   backendens egen `winners`-räkning.
2. **`sku`, `campaign`, `breakEvenRoas`, `notes` och `createdAt` kan vara `null`.**
   `sku` är särskilt viktigt: det är URL-segmentet i `/products/[sku]`. En
   produkt utan sku får aldrig länkas. `productHref()` är enda stället som
   bygger produkt-URL:er och returnerar `null` i det läget.
3. **Hela `ai`-blocket är nullbart per fält.** `<AiText>` renderar ett tomt
   läge i stället för strängen "null".
4. **`meta.period` är `null` när månaden saknar data**, och då är `products`
   tom. Varje vy har ett tomt läge för det.

Dessutom: `demand.trend` kan vara `unknown` och `monthsOfData` vara 1 — det är
normalfallet för en nystartad produkt. Då ritas ingen trendlinje alls, utan en
enskild siffra med texten "1 mån data". En månad är ingen riktning.

## Färger

Bakgrundens chroma-blobbar och accentgradienten använder cyan `#38bdf8`,
violett `#818cf8` och rosa `#e879f9` enligt design-specen.

De färgerna används **inte** till dataserier. Som kategorisk palett faller de på
två kontroller: violett↔rosa har ΔE 0,9 vid protanopi (i praktiken samma färg
för rödblinda) och violett↔cyan ligger på ΔE 13,5 för normalseende, under
golvet 15. De når dessutom bara 2,0–2,8:1 mot glasytan, vilket är för svagt för
linjer och staplar.

Grafer använder därför indigo `#4f46e5` (5,96:1), som ligger mellan cyan och
violett i gradienten. Delstaplarna i Opportunity-mätaren har alla samma färg med
flit: de mäter samma sak — ett delbetyg av 100 — och är direktmärkta med namn
och tal, så färg behöver inte bära identiteten.

Statusfärgerna är reserverade och kombineras alltid med ikon eller ord, aldrig
färg ensam. `--pos`/`--warn` används på stora tal och grafmarkeringar (≥ 3:1);
`--pos-ink`/`--warn-ink` är mörkare varianter för brödtext (≥ 4,5:1).
`--text-muted` är `#67727e` och inte `#7b8794`, som bara når 3,47:1 och därmed
inte klarar AA för brödtext.

## Struktur

```
src/
  app/          sidor (alla klientkomponenter — datan hämtas i webbläsaren)
  components/   DataProvider, AppShell, tabell, kort, grafer, tooltips
  lib/          api · types · format (sv-SE) · ui (statusar, ordlista)
```

`DataProvider` gör **en** hämtning per månad och delar svaret med alla sidor, så
navigering mellan vyer inte kostar ett nytt anrop. Ett långsamt svar för en
tidigare månad kan aldrig skriva över ett nyare — varje hämtning har en biljett
som kontrolleras innan state sätts.

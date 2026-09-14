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

## Driftsättning på Netlify

`netlify.toml` ligger i **repo-roten**, inte här — det är där Netlify letar.
`base = "plan-vy"` flyttar bygget hit, och alla andra sökvägar i filen är
relativa till base.

| Inställning | Värde |
|---|---|
| Base directory | `plan-vy` |
| Build command | `npm run build` |
| Publish directory | `.next` (relativt base) |
| Node | 22 |

`@netlify/plugin-nextjs` deklareras i `netlify.toml` och installeras av Netlify
själv. Lägg den **inte** i `package.json` också — det ger versionskonflikt.

### Lösenordsgrind

Netlifys inbyggda lösenordsskydd kräver betalplan. `netlify/edge-functions/auth.ts`
gör samma sak på gratisplanen och kräver två miljövariabler:

| Variabel | Innehåll |
|---|---|
| `SITE_USER` | användarnamn |
| `SITE_PASSWORD` | lösenord (markerad som secret i Netlify) |

Funktionen **felar stängt**: saknas någon av dem svarar den 503 i stället för att
släppa förbi. En felkonfiguration ska inte kunna lägga siffrorna öppet.

Egna headers från `netlify.toml` gäller inte på vägar som en edge function
serverar, så `X-Robots-Tag` med flera sätts i funktionen i stället.

`NEXT_PUBLIC_PLAN_VY_API` är valfri och behövs bara om bygget ska peka mot något
annat än skarp n8n-backend.

CORS fungerar från vilken Netlify-domän som helst: respond-noden sätter
`Access-Control-Allow-Origin: *`, och research-webhooken har dessutom
`allowedOrigins: "*"` så preflighten går igenom.

### Innan du gör URL:en publik

En Netlify-URL är öppen för alla som har länken. Två saker följer av det:

1. **Dashboarden visar omsättning, marginaler och inköpspris.** Den ligger bakom
   basic auth via edge function, och `X-Robots-Tag: noindex, nofollow` håller
   den utanför sökindex. Basic auth skickar lösenordet base64-kodat, inte
   hashat — det är TLS som skyddar det på vägen, så dela aldrig länken utan
   `https://`.
2. **Knappen "Generera idéer" träffar en oautentiserad webhook** som kostar
   OpenAI-krediter och skriver rader i `product_candidates`. Den som hittar
   sidan kan trycka på den hur många gånger som helst. Det är webhooken som
   behöver skyddas, inte knappen — frontend kan inte hindra ett direktanrop.

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

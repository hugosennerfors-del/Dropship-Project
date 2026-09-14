# 16. Plan-vy — komplett specifikation

Dashboard för lönsamhet per order och per produkt. Byggd mot **Shopify → n8n → Supabase → Next.js**.
Kod ligger i [`plan/`](plan/). Formlerna är enhetstestade — `npm test` kör sju tester som verifierar dem.

---

## 16.1 Tre fel i den ursprungliga kravlistan, och vad jag gjorde istället

Jag byggde inte det du bad om rakt av på tre punkter, eftersom de som formulerade skulle ge dig fel siffror. Här är varför.

### Fel 1: moms

> `ROAS = Intäkt / Annonskostnad`

Shopify rapporterar intäkt **inklusive moms**. Räknar du ROAS på det talet är resultatet **25 % för högt**, varje gång. En "ROAS 2,0" är i verkligheten 1,6.

**Vad jag gjorde:** all intäkt räknas om till ex moms en gång, i `toExVat()`. Varje tal i vyn är ex moms och det står i sidhuvudet.

> ⚠️ Metas eget rapporterade ROAS räknar **inkl** moms. Ditt tal kommer alltid ligga ~25 % under Metas. Det är inte ett fel — jämför dem aldrig rakt av.

### Fel 2: bidrag som redan dragit av annonsen

> `Bidrag per order = Försäljningspris − (produktkostnad + fraktkostnad + transaktionsavgift + annonskostnad per order)`

Det där är **nettovinst per order**, inte contribution margin. Contribution margin är per definition **före** annonskostnad.

Det spelar roll, för i nästa andetag skriver du `Break-even ROAS = 1 / bruttomarginal`. Om marginalen redan dragit av annonsen blir break-even-beräkningen cirkulär: du räknar annonskostnad för att räkna ut hur mycket annonskostnad du tål.

**Vad jag gjorde:** två separata tal med olika namn.

| Tal | Formel | Används till |
|---|---|---|
| `grossProfit` / bidrag | Intäkt ex moms − COGS − frakt ut − transaktionsavgift | Break-even, ampel, skalningsbeslut |
| `netProfit` | grossProfit − annonskostnad − fasta kostnader | Vad du faktiskt tjänade |

### Fel 3: ROI som drar av investeringen två gånger

> `ROA / ROI = (Vinst − Investering) / Investering`

Om "Vinst" betyder vinst **efter** kostnader har investeringen redan dragits av. Att dra av den igen ger dig ett tal som är för lågt med exakt investeringens storlek.

**Vad jag gjorde:** `ROI = (bruttovinst − annonskostnad) / annonskostnad`. Avkastningen är bruttovinsten annonsen genererade; investeringen är annonskostnaden. Ingen dubbelräkning.

### Plus en sak som saknades helt: returer

Ett bidrag på 890 kr vid 25 % returgrad är i praktiken **630 kr**. Utan den justeringen visar vyn vinst på produkter som går med förlust. Den finns nu som eget fält, `effectiveContributionPerOrder`, och som en andra rad i tabellen.

---

## 16.2 Alla formler

Notation: alla intäktstal **ex moms** om inget annat anges.

### Grund

```
Intäkt ex moms      = (bruttointäkt inkl moms − returer) / (1 + momssats)
Landad styckkostnad = inköp + inkommande frakt + tull + EPR-avgift per st
COGS                = landad styckkostnad × sålda enheter
Transaktionsavgift  = bruttobelopp inkl moms × avgiftssats + fast avgift × antal order
```

### Resultat

```
Bruttovinst (bidrag)   = Intäkt ex moms − COGS − utgående frakt − transaktionsavgift
Bidrag per order       = Bruttovinst / antal order
Nettovinst             = Bruttovinst − annonskostnad − fasta kostnader
Nettovinst per order   = Nettovinst / antal order
Bruttomarginal %       = Bruttovinst / Intäkt ex moms
Nettomarginal %        = Nettovinst / Intäkt ex moms
Marginal i kronor      = Bruttovinst (totalt) respektive Bidrag per order (per styck)
```

### Annons

```
ROAS             = Intäkt ex moms / annonskostnad
POAS             = Bruttovinst / annonskostnad          ← break-even alltid 1,00
Break-even ROAS  = 1 / bruttomarginal
ROI              = (Bruttovinst − annonskostnad) / annonskostnad
CPA              = annonskostnad / antal order
AOV              = Intäkt ex moms / antal order
CVR              = antal order / sessioner
CPC              = annonskostnad / klick
CTR              = klick / visningar
CPM              = annonskostnad / visningar × 1000
```

### Returjusterat

```
Effektivt bidrag = Bidrag × (1 − R)
                 − R × returhanteringskostnad
                 − R × (1 − återförsäljningsgrad) × landad styckkostnad

Break-even ROAS justerad = 1 / (Effektivt bidrag / AOV)
```

### Skalningströsklar

```
Max CPA vid mål-POAS = Bidrag per order / mål-POAS
CPA-utrymme          = Max CPA vid 1,60 − faktisk CPA
```

---

## 16.3 Hur bidrag och ROI hänger ihop — i klartext

**Bidraget är taket för vad en kund får kosta.** Allt annat följer av det.

Säg att du säljer för 1 395 kr inkl moms. Ex moms blir det 1 116 kr. Produkten kostar 370 kr landad, frakten ut 70 kr, transaktionsavgiften cirka 28 kr.

```
Bidrag = 1116 − 370 − 70 − 28 = 648 kr
Bruttomarginal = 648 / 1116 = 58 %
Break-even ROAS = 1 / 0,58 = 1,72×
```

**648 kr är hela ditt utrymme.** Betalar du 648 kr för en kund går du exakt jämnt ut — POAS 1,00, ROI 0 %. Betalar du 700 kr förlorar du 52 kr per order, och ju fler du säljer desto mer förlorar du.

Så här hänger talen ihop:

| Du betalar i CPA | POAS | ROI | Nettovinst/order | Vad det betyder |
|---|---|---|---|---|
| 200 kr | 3,24 | +224 % | 448 kr | Underinvesterar. Höj budgeten. |
| 405 kr | 1,60 | +60 % | 243 kr | **Grön zon.** Skala 20–30 % var 48:e timme. |
| 560 kr | 1,16 | +16 % | 88 kr | Bär rörlig kostnad men inte fasta. Optimera. |
| 648 kr | 1,00 | 0 % | 0 kr | Break-even. |
| 750 kr | 0,86 | −14 % | −102 kr | Varje order kostar pengar. Pausa. |

**Därför är POAS ampelns nyckeltal, inte ROAS.** ROAS 2,4 betyder utmärkt för en produkt med 58 % marginal och förlust för en med 35 %. POAS 1,00 betyder break-even för *alla* produkter, alltid. Det är den enda kolumnen du kan jämföra rakt av mellan rader.

**Beslutsregeln, en mening:** skala när POAS ≥ 1,60 och du har minst 15 order, optimera mellan 1,15 och 1,60, pausa under 1,15 — och kolla alltid returgraden innan du tror på ett grönt ljus.

---

## 16.4 Layouten, sektion för sektion

### Sidhuvud

Överst vänster står **"Plan-vy"** i 22 px halvfet, och direkt under i grått: `2026-08-15 – 2026-09-14 · jämfört med föregående 30 dagar · alla belopp ex moms`. Den sista frasen står där permanent — det är den vanligaste källan till missförstånd när någon annan tittar på skärmen.

Till höger på samma rad ligger filtren: en segmenterad kontroll med **7 / 14 / 30 / 90 dagar** där aktivt val är svart med vit text, och två dropdowns — **Alla produkter** och **Alla kampanjer**. Filtren skriver till URL:en (`?range=30d&product=...`), så en filtrerad vy går att bokmärka och skicka vidare.

### Toppsektion: fem KPI-kort

Under sidhuvudet ligger **fem kort på en rad** (staplas i två kolumner på surfplatta, en på mobil). Varje kort är vitt med tunn grå ram, 12 px radie.

Varje kort har samma anatomi: liten grå etikett uppe till vänster, **procentuell förändring mot föregående period** som färgad pill uppe till höger, det stora talet i 28 px halvfet med tabulära siffror under, och en grå hjälprad längst ned.

| # | Kort | Stort tal | Hjälprad | Delta |
|---|---|---|---|---|
| 1 | Omsättning ex moms | `kr(netRevenueExVat)` | — | mot föregående period |
| 2 | Annonskostnad | `kr(adSpend)` | `CPA 405 kr` | **lägre är bättre** — deltat vänder färg |
| 3 | POAS | `1,84×` | `ROAS 3,12× · break-even POAS 1,00` | mot föregående |
| 4 | Nettovinst | `kr(netProfit)` | `243 kr per order` | mot föregående |
| 5 | Ordrar | `142` | `AOV 1 116 kr · CVR 2,14 %` | mot föregående |

Kort 2 är det enda där en **nedgång är grön**. Det är avsiktligt och hanteras av flaggan `lowerIsBetter`.

Direkt under kortraden står en enrads sammanfattning: *"**3** produkter redo att skala. **1** under break-even — åtgärda idag."* Den raden är det första ögat fastnar på och den enda texten i vyn som talar om vad du ska göra härnäst.

### Produkttabell

Rubrik **"Produkter"**, sedan en tabell i vitt kort med horisontell scroll under 1 100 px. Sorterbar på produktnamn, ordrar, annons, POAS, bidrag och nettovinst — **default är nettovinst fallande**, så det som tjänar mest pengar står överst.

Kolumnerna, vänster till höger:

1. **Produkt** — namn i halvfet, SKU i 11 px grått under
2. **Inköp** — landad styckkostnad, alltså inköp + frakt in + tull + EPR
3. **Pris** — säljpris inkl moms
4. **Marginal** — bruttomarginal i procent, med `BE 1,72×` i grått under
5. **Ordrar**
6. **Annons** — spend i perioden
7. **ROAS** — röd text när den ligger under radens egen break-even
8. **POAS** — halvfet, röd under 1,00. Kolumnrubriken har tooltip: *"Bruttovinst delad på annonskostnad. Break-even är alltid 1,00."*
9. **CPA**
10. **Bidrag/order** — och när returgraden överstiger 5 % en andra rad i grått: `eff. 487 kr` med tooltip *"Efter 25 % returer"*
11. **Nettovinst** — halvfet, röd vid negativt
12. **Status** — ampel-pill

Ampeln bärs av **text och ikon, aldrig färg ensam**: ▲ SKALA (grön), ■ OPTIMERA (gul), ▼ PAUSA (röd), • TESTA (grå). Hovra så får du den fullständiga motiveringen, till exempel: *"POAS 1,84 (mål 1,60). CPA 405 kr mot bidrag 648 kr. Tål 0 kr högre CPA innan den faller ur grönt."*

**TESTA visas när produkten har färre än 15 order** — inte för att den är dålig, utan för att utfallet under 15 order är brus. Det hindrar dig från att pausa en produkt som bara haft otur i tre dagar.

### Grafer

Under tabellen ligger **två grafer sida vid sida** på bred skärm, staplade under 1 280 px.

**Vinst över tid** (vänster) är ett kombinationsdiagram: blå staplar för intäkt ex moms, orange staplar för annonskostnad, och en svart linje för nettovinst ovanpå. Nollinjen är utritad i grått, så förlustdagar syns direkt som linje under strecket. **En y-axel, aldrig två** — två skalor uppfinner ett samband som inte finns i datan.

**POAS- och ROAS-trend** (höger) är två linjer: POAS i blått och ROAS i grått, med en **röd referenslinje vid 1,00** märkt "break-even POAS". Ligger den blå linjen under den röda under flera dagar i rad förlorar butiken pengar på varje order, oavsett vad Metas panel säger.

Under dem, i full bredd: **Bidrag per order mot CPA**. Liggande staplar, en per produkt, sorterade fallande på effektivt bidrag. Stapeln är grön när bidraget överstiger CPA och grå när det inte gör det, och CPA ligger som ett **smalt rött streck** i samma skala. Ligger strecket till höger om stapeln går produkten med förlust — det syns utan att man läser en enda siffra. Varje stapel har sitt belopp direktetiketterat till höger, eftersom statisk färg inte räcker som enda bärare av information.

### Färgsystem

Seriefärgerna är validerade för färgblindhet: blå `#2a78d6`, orange `#eb6834`, aqua `#1baf7a`. Statusfärgerna (grön, gul, röd) är **reserverade** och används aldrig som seriefärg i något diagram — annars går "röd = förlust" och "röd = serie 3" inte att skilja åt.

---

## 16.5 Tech-stack

| Lager | Val | Varför |
|---|---|---|
| Frontend | **Next.js 15**, App Router, React Server Components | Aggregering körs på servern; klienten får färdiga tal. Filtren bor i URL:en. |
| Styling | **Tailwind 4** | Inga komponentbibliotek att kämpa mot. |
| Diagram | **Recharts** | Räcker gott, och `ComposedChart` gör kombinationsdiagrammet i ett anrop. |
| Databas | **Supabase Postgres** | Riktiga joins mellan ordrar, produkter och annonsdata. Gratisnivån räcker till ~500k rader. |
| Integration | **n8n** | Se [kapitel 19](19-n8n-workflows.md). |
| Källa | **Shopify Admin GraphQL API** | `InventoryItem.unitCost` ger COGS; webhooks ger realtid. |

### Filstruktur

```
plan/
├── app/
│   ├── layout.tsx
│   ├── globals.css
│   └── (dashboard)/page.tsx      ← hämtar data, räknar, renderar
├── components/
│   ├── KpiCard.tsx               ← kort med periodjämförelse
│   ├── StatusPill.tsx            ← ampel, text + ikon + färg
│   ├── ProductTable.tsx          ← sorterbar, 12 kolumner
│   ├── ProfitChart.tsx           ← kombinationsdiagram
│   ├── RoasTrendChart.tsx        ← POAS/ROAS med break-even-linje
│   ├── ContributionChart.tsx     ← bidrag mot CPA
│   └── Filters.tsx               ← URL-baserade filter
├── lib/
│   ├── metrics.ts                ← ALLA formler
│   ├── metrics.test.ts           ← 7 tester, kör med npm test
│   ├── status.ts                 ← ampel-logik
│   ├── types.ts
│   ├── format.ts                 ← sv-SE-formatering
│   ├── palette.ts                ← validerade diagramfärger
│   └── db.ts                     ← Supabase-läsning
└── supabase/
    ├── schema.sql                ← 8 tabeller
    └── views.sql                 ← v_product_period, v_actual_return_rate
```

### Datamodell

Åtta tabeller: `settings` (moms och avgiftssatser), `products` (SKU, kostnad, returgrad), `orders` + `order_lines` (belopp **inkl** moms precis som Shopify skickar dem), `ad_spend` (en rad per dag, annons och produkt), `campaign_product_map` (regex som knyter kampanj till SKU), `sessions_daily` (för CVR) och `thresholds` (ampelgränser, redigerbara utan kodändring).

Två designbeslut värda att känna till:

**COGS fryses vid ordertillfället** i `order_lines.unit_cost_at_sale`. Höjer leverantören priset i november ska oktobers marginal inte ändras retroaktivt.

**`landed_adder` är ditt eget fält.** Shopify känner bara till inköpspriset. Inkommande frakt, tull, **€3-avgiften per deklarationsrad** och EPR-avgiften finns ingen annanstans — och utan dem är marginalen systematiskt för hög.

---

## 16.6 Kom igång

```bash
cd plan
npm install
cp .env.example .env.local        # fyll i Supabase- och Shopify-nycklar

# Kör i Supabase SQL Editor, i denna ordning:
#   supabase/schema.sql
#   supabase/views.sql

npm test        # 7 formeltester ska passera
npm run dev     # http://localhost:3000
```

Importera sedan n8n-flödena från [`n8n/`](n8n/) och kör backfill-flödet en gång för historiken.

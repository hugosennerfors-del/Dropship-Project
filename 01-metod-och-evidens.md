# 1. Metod och evidenskvalitet

## 1.1 Vad jag faktiskt gjorde

Cirka 60 riktade webbsökningar i fyra vågor, 14 september 2026:

1. **Makro och regelverk** — EU:s tullreform, GPSR, EPR/WEEE/batteri, kosmetikaregler, TikTok Shops EU-status, svensk e-handelsdata, CPM- och betalningslandskap.
2. **Produktsignalsvep** — TikTok Shop-data (Kalodata, FastMoss, EchoTik via sekundärkällor), Amazon-försäljningsestimat (asinsight), sökvolymdata (Glimpse/risingtrends via sekundärkällor), kategorispecifika djupdyk i husdjur, hem, bil, sömn, fitness, trädgård, barn, hobby, outdoor.
3. **Butiks- och annonsanalys** — trafik- och intäktsestimat per varumärke (brandsearch), annonsvolym, produktantal, erbjudandestruktur, nordiska varumärkesfall.
4. **Motbevisning** — för varje kandidat aktivt letat efter skäl att *inte* göra den: patentkonflikter, varumärkestvister, regulatoriska hinder, avtagande trendkurvor, mättnad, returproblem.

## 1.2 Vad jag INTE kunde göra — läs det här

Miljöns nätverksproxy blockerade direkt hämtning av flera av de källor jag helst hade velat läsa förstahands:

| Källa | Status | Konsekvens |
|---|---|---|
| `trends.google.com` | **Blockerad** | Inga egna Google Trends-kurvor. All trenddata är andrahandsrefererad. |
| `amazon.com` (Movers & Shakers, BSR) | **Blockerad** | Inga egna BSR-observationer. Försäljningssiffror kommer från asinsight, som modellerar. |
| `kalodata.com` | **Blockerad** | TikTok Shop-siffror hämtade via sekundärrefererande sidor. |
| `blog.lengow.com`, `explodingtopics.com` | **Blockerad** | Samma sak. |
| `reddit.com` | **Ej hämtbar** | Ingen förstahandsläsning av community-sentiment. |
| Meta Ad Library | Ej försökt direkt (kräver inloggning/JS) | Ingen egen annonsräkning. Annonsantal kommer från brandsearch. |
| AliExpress/Alibaba prissidor | Endast via sökutdrag | **Alla sourcing-kostnader i rapporten är indikativa spann, inte offerter.** |

**Praktisk innebörd:** ingen enskild produkt i den här rapporten kan få Evidence Confidence över ~80, och de flesta hamnar 55–78. Det är inte falsk blygsamhet — det är vad underlaget bär. Se 1.5 för vad som skulle höja det.

## 1.3 Källhierarki (hur jag viktat)

**Nivå A — primära myndigheter och register** (högst vikt)
Europeiska kommissionen (taxation-customs), Naturvårdsverket, Jordbruksverkets hundregister, PostNord/HUI E-barometern, FEDIAF, domstolsavgöranden (IPEC), RSPB, BirdLife Sverige.

**Nivå B — branschdata med metod** (hög vikt)
FastMoss, EchoTik, Kalodata (TikTok Shop-GMV, orderantal), Kustom "Behind the Returns 2026" (78,6 miljoner order), YouGov, marknadsanalyshus när de anger metod.

**Nivå C — modellerade estimatverktyg** (medelvikt, bra för storleksordning)
asinsight (Amazon-enhetsestimat), brandsearch (trafik- och intäktsspann, annonsantal), Similarweb-härledda tal, getlatka.

**Nivå D — branschmedia och leverantörsbloggar** (låg vikt, aldrig ensam grund)
Shopify-bloggen, CJdropshipping, Sell The Trend, Minea, WinningHunter, dropshipping-bloggar. Dessa **säljer verktyg och kurser**. De listar rutinmässigt samma produkter år efter år och har incitament att få allt att se lovande ut. Jag har använt dem för att generera hypoteser, aldrig för att bekräfta dem.

**Nivå E — enskilda påståenden utan spårbar metod** (endast som färgsättning, alltid markerat)

## 1.4 Score-systemet (0–100)

Viktningen är den du specificerade:

| Dimension | Vikt | Vad jag bedömer |
|---|---|---|
| Demand | 20 | Absolut storlek på befintlig efterfrågan (sökvolym, enhetsvolym, installerad bas) |
| Trend momentum | 20 | Riktning och lutning. Stabil = mitten. Fallande = under mitten. |
| Sales validation | 15 | Finns hårda bevis på *köp*, inte bara intresse (ordervolym, GMV, recensioner, bolagsdata) |
| Competition quality | 10 | **Högt = bra.** Finns framgångsrika företag som redan säljer produkten? Det bevisar marknaden. |
| Ad potential | 10 | Hur lätt produkten säljs via kort video / UGC / paid social |
| Margin potential | 10 | Realistisk bruttomarginal efter produkt, frakt och tull |
| Differentiation / branding | 10 | Går det att bygga ett faktiskt varumärke, eller är det en ren råvara? |
| Logistics | 5 | Vikt, volym, ömtålighet, returrisk, regulatorisk tyngd |

**Viktig läsanvisning:** *Competition quality* mäter att marknaden är bevisad — inte att den är lätt att vinna. Svårighetsgraden fångas i *Differentiation*, i fältet **Saturation** och i riskavsnittet. En produkt kan därför ha Competition quality 10/10 och ändå vara ett dåligt val (smart fågelmatare är exakt det fallet).

## 1.5 Evidence Confidence (0–100)

Separat skala som mäter **underlagets styrka**, inte produktens attraktivitet.

| Intervall | Betydelse | Vad som krävs |
|---|---|---|
| 90–100 | Mycket stark | Primärdata + flera oberoende källor + egen verifiering |
| 75–89 | Stark | Flera oberoende nivå-A/B-källor som pekar åt samma håll |
| 60–74 | Lovande men luckor | Ett par nivå-B/C-källor, viktiga variabler fortfarande okända |
| 40–59 | Spekulativt | Mest nivå-C/D, eller motstridiga signaler |
| <40 | För lite evidens | Skulle inte agera på det |

**Ingenting i den här rapporten når 90+**, eftersom jag inte kunde göra förstahandsverifiering. Det som skulle lyfta de tre toppkandidaterna till 85+:

- Egen Google Trends-export för Sverige, Tyskland, UK, 5 år, per nyckelord
- Skärmdumpar från Meta Ad Library på faktiska konkurrenters aktiva annonser i SE/DE
- Tre skriftliga offerter per produkt från Alibaba-leverantörer inkl. fraktvillkor DDP
- Amazon.se- och Amazon.de-recensionsantal per konkurrerande listning
- Två veckors egen data från ett live-test (CTR, CPC, CVR, AOV)

Punkt 1–4 tar ungefär en arbetsdag. Gör dem innan du binder kapital.

## 1.6 Var jag medvetet gick emot branschkonsensus

**1. "Annonser som körts 30+ dagar är lönsamma."**
Det här upprepas i praktiskt taget varje dropshipping-guide. En analys av 500+ kreativ från 2026 hävdar motsatsen: under cost-cap/bid-cap-inköp lämnar annonsörer annonser igång och låter auktionen avgöra, så en **gammal annons är oftast en obeskuren annons, inte en bevisad annons**. Bättre signal: vilka kreativ som bär flest impressions. Källorna är i direkt konflikt med varandra — jag har valt att flagga det snarare än att välja sida, men jag lutar åt den nyare tolkningen eftersom den beskriver en mekanism och inte bara en tumregel.

**2. "Top TikTok-produkter = bra dropshipping-produkter."**
De faktiska toppsäljarna på TikTok Shop är skincare och kosttillskott (Medicube, Dr.Melaxin, MaryRuth's, Toplux). De är i praktiken otillgängliga för ett snabbt EU-test — se avsnitt 2.4. Att lista dem som "trending products" utan att nämna CPNP är vilseledande, och nästan alla listor gör det.

**3. "Bygg där det inte finns konkurrens."**
Nej. Total frånvaro av konkurrens betyder oftast frånvaro av efterfrågan. Jag har rankat upp kategorier där flera bolag *tjänar pengar* och rankat ner kategorier där ingen gör det.

**4. "Vinnarprodukten finns i verktyget."**
Verktygen (Minea, Sell The Trend, Winning Hunter, Dropship.io) visar vad som redan skalar — alltså vad som redan har konkurrens. De är användbara för validering, inte för upptäckt. Upptäckten i den här rapporten kom från korsningen *säsong × geografi × regelverk*, inte från en produktlista.

## 1.7 Diagrammen

Alla åtta diagram genereras av [`tools/make_charts.py`](tools/make_charts.py) och skrivs till [`assets/`](assets/). Skriptet har inga beroenden — `python3 tools/make_charts.py` räcker. Varje siffra i varje diagram kommer från rådata-loggen, så du kan spåra den till källan.

Färgerna är validerade för färgblindhet (adjacent ΔE 9,2 deutan, normalseende 27,6 — båda över golvet). Statisk SVG i GitHub-markdown kan inte bära hover, så identiteten bärs av legend och direktetiketter i stället för tooltip, och varje diagram har sin fullständiga tabell i rapporttexten.

**Ett diagram byggdes om efter granskning:** tidslinjen ritades först horisontellt, men sex av elva händelser ligger inom tio månader under 2026 och etiketterna gick inte att separera. Den är nu vertikal.

## 1.8 Fakta vs. estimat — notationen i rapporten

- **Fet siffra med källnamn** = rapporterad av källan som fakta
- *Kursiv* = mitt estimat eller min beräkning
- `UNKNOWN` = jag kunde inte verifiera det och gissar inte
- ⚠️ = motstridiga källor eller känd risk

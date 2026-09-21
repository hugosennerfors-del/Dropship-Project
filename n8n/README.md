# Daglig säsongsresearch

**Schemat är avstängt.** Arbetsflödet `Plan-vy · Daglig säsongsresearch`
(n8n `lpM9ISs0ak8Q9esT`) är avaktiverat och kör ingenting av sig självt —
varje anrop mot OpenAI kostar pengar, och de ska startas medvetet. Kalendern
lever i stället i appens Kalender-flik, som visar vad som bör researchas och
låter dig trycka på det.

Arbetsflödet finns kvar och kan aktiveras igen i n8n om du vill ha det
automatiskt. Det kördes `daglig-valj-nischer.js` är innehållet i dess
Code-nod och är den enda del som bestämmer vad som researchas.

```
Varje morgon 06:00
  └─ Välj dagens nischer     (daglig-valj-nischer.js)
       └─ Kör research       (POST → plan-vy-research-generate, en gång per nisch)
```

## Marknader

Kalendern utgår från köpstarka marknader — USA, Storbritannien, Australien och
EU som en enhet — inte från Sverige. Sverige finns kvar sist eftersom det är
där liveprodukterna faktiskt säljs och verklighetskollen fungerar.

Det är inte bara andra ord: USA har ingen moms i det annonserade priset (sales
tax läggs på i kassan och varierar per delstat), Australien har omvänd årstid
så julen infaller mitt i sommaren, och EU behandlas som en marknad med EUR och
21 % som snitt — en förenkling, satserna skiljer sig mellan länderna.

Varje marknad har sin egen handelskalender med sina helger: Thanksgiving och
back to school i USA, Bonfire Night och Boxing Day i Storbritannien, EOFY-rean
och jul i sommarvärme i Australien.

## Varför kalender och inte trenddata

Metas annonsbibliotek går inte att läsa automatiskt — se
`META-ANNONSDATA.md` för de faktiska svarskoderna. Google Trends dagliga
RSS-flöde testades också och förkastades: kategoriparametern ignoreras — tolv
olika kategorier gav identisk lista — och listan är nyheter, inte produkter.
Den 21 september 2026 innehöll den `brigitte bardot`, `presley gerber`,
`ozempic` och `bet365`. Noll shoppingnischer. USA-flödet ser likadant ut.

Dessutom är dagens trend per definition sen: toppen är redan där när den syns.
Kalendern siktar i stället **sex veckor framåt**, så att annonserna hinner
testas färdigt innan efterfrågan kommer. Den 21 september väljer den däckbyte
och mörkerkörning för vecka 45; den 15 oktober växlar den själv till julmat
och julklappar.

Två av dagens tre nischer kommer ur säsongsfönstret, den tredje ur en rotation
av nischer som bär volym året om, så att täckningen växer i stället för att
stå still.

## Kostnad

Tre nischer per körning är tre LLM-anrop mot OpenAI:s API, debiterade per
token. En ChatGPT-prenumeration täcker inte detta — API och prenumeration är
skilda konton. Sätt ett tak under platform.openai.com → Settings → Limits.

`PER_DAG` och `LEDTID` överst i filen styr antalet nischer respektive hur
långt före toppen researchen körs.

## Fallgrop

En avstängd nod i n8n släpper igenom sin indata till nästa nod. Att stänga av
väljarnoden stoppar alltså inte HTTP-anropet — det avfyras ändå, med tomt
innehåll, och generatorn faller tillbaka på standardnischen. Stäng av
HTTP-noden i stället.

## Härkomst per kandidat

Varje sparad rad bär `niche`, `research_date`, `trend_source`
(`kalender` / `bredd` / `manuell`) och `trend_note`. Sidan grupperar på
`research_date` och räknar färskheten vid visning, så den åldras av sig själv.

Om du någon gång betalar för en riktig trendkälla byts bara Code-noden ut —
resten av kedjan tar redan emot härkomsten.

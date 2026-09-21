# Daglig säsongsresearch

Arbetsflödet `Plan-vy · Daglig säsongsresearch` (n8n `lpM9ISs0ak8Q9esT`) kör
varje morgon 06:00 svensk tid. `daglig-valj-nischer.js` är innehållet i dess
Code-nod och är den enda del som bestämmer vad som researchas.

```
Varje morgon 06:00
  └─ Välj dagens nischer     (daglig-valj-nischer.js)
       └─ Kör research       (POST → plan-vy-research-generate, en gång per nisch)
```

## Varför kalender och inte trenddata

Det finns ingen gratis daglig visningsdata för svensk e-handel. Google Trends
dagliga RSS-flöde testades och förkastades: kategoriparametern ignoreras — tolv
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

## Kostnad och reglage

Tre nischer per dag är tre LLM-anrop, ungefär 90 i månaden. `PER_DAG` och
`LEDTID` överst i filen styr det. Pausa hela schemat genom att avaktivera
arbetsflödet i n8n.

## Härkomst per kandidat

Varje sparad rad bär `niche`, `research_date`, `trend_source`
(`kalender` / `bredd` / `manuell`) och `trend_note`. Sidan grupperar på
`research_date` och räknar färskheten vid visning, så den åldras av sig själv.

Om du någon gång betalar för en riktig trendkälla byts bara Code-noden ut —
resten av kedjan tar redan emot härkomsten.

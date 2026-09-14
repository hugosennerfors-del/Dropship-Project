# Arkiv

Det här är **inte** den kod som körs. Live-dashboarden ligger i [`../plan-vy/`](../plan-vy/).

## Varför det ligger här

Innehållet byggdes innan n8n-backenden fanns, utifrån premissen att appen skulle
äga sin egen databas. Den premissen gäller inte längre: `plan-vy/` har varken
backend eller databas utan hämtar allt från workflowet
`Plan-vy · Intelligence-API`.

Sparat i stället för raderat eftersom formlerna och testerna fortfarande är
giltiga och dokumenterar varför siffrorna räknas som de gör.

| Sökväg | Vad det är | Status |
|---|---|---|
| `plan-supabase/` | Next.js-dashboard mot egen Supabase-databas | Ersatt av `plan-vy/` |
| `plan-supabase/lib/metrics.ts` | Alla formler på ett ställe | 7 av 7 tester gröna |
| `plan-supabase/supabase/*.sql` | Schema och vyer | Aldrig driftsatt |
| `16-plan-vy-spec.md` | Specen för den byggd | Beskriver arkitektur som inte används |

```bash
node --experimental-strip-types --test archive/plan-supabase/lib/metrics.test.ts
```

## Det som fortfarande gäller

Tre räknesätt från `16-plan-vy-spec.md` §16.1 överlevde bytet av arkitektur och
görs likadant i n8n-backenden i dag:

1. **Moms räknas bort en gång, först.** Shopify rapporterar intäkt inklusive
   moms; ROAS och marginal på det talet blir 25 % för höga.
2. **Täckningsbidrag är före annonskostnad.** Dras annonsen av först blir
   `break-even ROAS = 1 / marginal` cirkulärt. Bidrag och nettovinst är två tal
   med olika namn, inte ett.
3. **POAS i stället för ROAS som ampel.** Break-even ligger alltid på exakt 1,00,
   så två produkter går att jämföra i samma kolumn. Break-even ROAS varierar med
   marginalen och säger ingenting utan den.

Returjusteringen i `returnAdjustedContribution()` finns däremot inte i
n8n-backenden, som i stället drar av returgraden rakt av i SQL-frågan.

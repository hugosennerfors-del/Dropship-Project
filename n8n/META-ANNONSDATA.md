# Går Metas annonsbibliotek att läsa automatiskt?

Nej. Testat från n8n den 21 september 2026, som har öppen utgång mot internet.

| Väg | Svar |
| --- | --- |
| `graph.facebook.com/v21.0/ads_archive` (GB och US) | **HTTP 500**, `OAuthException`, `www-authenticate: OAuth "Facebook Platform"` |
| `facebook.com/ads/library/?q=…&country=GB` | **HTTP 403**, `x-fb-rd: 1`, JS-baserad bot-utmaning |
| `facebook.com/ads/library/report/` | **HTTP 403**, samma utmaning |

`ads_archive` kräver en Meta-utvecklarapp med godkänd behörighet och
ID-verifiering av den som äger appen. Den publika sidan blockerar
automatiserad läsning aktivt. Ingen Meta-koppling finns bland kontots
credentials.

## Vad sidan gör i stället

Varje tema i Kalender-fliken och varje kandidat har en **Se annonserna**-länk
som öppnar annonsbiblioteket för rätt marknad med rätt sökord. Du tittar
själv; sidan påstår ingenting om vad som går där.

## Om du vill ha det automatiskt

Det krävs en Meta-utvecklarapp med `ads_archive`-behörighet och en
access-token. Läggs den som en credential i n8n går resten av kedjan att koppla
in — generatorn tar redan emot härkomst per kandidat.

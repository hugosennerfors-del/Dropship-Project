# Spetsläget — högt bidrag, hög ROI, bred köparkrets

`analys.mjs` rangordnar kandidatpoolen på den fråga som chansscoren i sidan
inte svarar på: vilka produkter har både stort täckningsbidrag och en
köparkrets som är stor nog att bära volym.

```
node analys.mjs
```

## Vad modellen gör som chansscoren inte gör

**Tilltro till CPA-antagandet.** Chansscoren mäter CPA mot ett fast band i
kronor. Den ser inte att 240 kr i CPA på ett pris av 1 599 kr är ett helt
annat påstående än 240 kr på 699 kr. Här vägs CPA som andel av utpriset:
medianen i poolen är 46 %, och ett antagande under 20 % halverar vinstkraften,
eftersom samma optimism sitter i både bidrag-mot-CPA och POAS samtidigt.

**Räckvidd.** Prisbarriär (billigare = fler kan köpa) och målgruppens storlek
i Sverige, med säsongen som multiplikator. Målgruppsbedömningen är min, inte
uppmätt, och ligger som en synlig tabell i `analys.mjs` rad för rad så att
varje enskild klassning går att invända mot.

**Meta-policy.** Vuxenprodukter får inte annonseras på Meta. Fyra av poolens
åtta högsta bidrag är sexleksaker, vilket gör dem oannonserbara på den kanal
hela kalkylen bygger på. De lyfts ut ur rangordningen i stället för att toppa
den.

**Spets** är geometriskt medel av vinstkraft och räckvidd, så en produkt måste
ha båda. Ett aritmetiskt medel hade låtit en dyr nischprodukt vinna på enbart
bidrag.

## Falsifieringen

Rangordningen jämförs mot det faktiskt uppnådda förvärvet i portföljen:
105–173 kr per order ex moms, alltså 131–217 kr inkl moms över 70 ordrar.
En kandidat som antar en CPA under 131 kr antar något som aldrig har uppnåtts
i verksamheten, hur bra POAS än ser ut.

`pool.json` är ögonblicksbilden analysen kördes på, `rank.json` dess utfall.

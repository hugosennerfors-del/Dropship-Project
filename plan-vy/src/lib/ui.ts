import type { Origin, Product, ProductStatus, Trend, Verdict } from "./types";

/* ── Produktstatus ────────────────────────────────────────────────────────
 * Backend skickar 'scale' | 'profit' | 'watch' | 'cut' (aldrig 'winner').
 * Uppslaget har ändå en fallback så ett nytt värde ger grå pill i stället
 * för en kraschad render.
 * ---------------------------------------------------------------------- */

export interface Meta {
  label: string;
  tone: "pos" | "neg" | "warn" | "neutral" | "accent";
  hint: string;
}

const STATUS: Record<ProductStatus, Meta> = {
  scale: { label: "Skala", tone: "pos", hint: "POAS ≥ 1,50 — bär sin annonskostnad med marginal." },
  profit: { label: "Lönsam", tone: "pos", hint: "POAS 1,00–1,49 — över break-even men tunt." },
  watch: { label: "Bevaka", tone: "warn", hint: "POAS 0,80–0,99 — strax under break-even." },
  cut: { label: "Skär", tone: "neg", hint: "POAS < 0,80 — varje order kostar pengar." },
};

const UNKNOWN_STATUS: Meta = { label: "Okänd", tone: "neutral", hint: "Okänt statusvärde från API:t." };

export const statusMeta = (s: string): Meta => STATUS[s as ProductStatus] ?? UNKNOWN_STATUS;

/** Vinnare = bär sin annonskostnad. Matchar backendens winners-räkning (poas >= 1). */
export const isWinner = (p: Product): boolean => p.status === "scale" || p.status === "profit";
export const isLoser = (p: Product): boolean => p.status === "watch" || p.status === "cut";

/* ── Kandidat-verdict ──────────────────────────────────────────────────── */

const VERDICT: Record<Verdict, Meta> = {
  SATSA: { label: "SATSA", tone: "pos", hint: "Förväntad POAS ≥ 1,50 och marginal ≥ 25 %." },
  TESTA: { label: "TESTA", tone: "warn", hint: "Över break-even men utan marginal att skala på." },
  UNDVIK: { label: "UNDVIK", tone: "neg", hint: "Bidraget täcker inte den förväntade annonskostnaden." },
};

export const verdictMeta = (v: string): Meta =>
  VERDICT[v as Verdict] ?? { label: v || "Okänd", tone: "neutral", hint: "Okänt verdict." };

/* ── Provenance ────────────────────────────────────────────────────────── */

export interface OriginMeta {
  label: string;
  tone: "real" | "computed" | "ai" | "estimate";
}

const ORIGIN: Record<Origin, OriginMeta> = {
  real: { label: "Verklig data", tone: "real" },
  computed: { label: "Beräknad", tone: "computed" },
  "ai-generated": { label: "AI", tone: "ai" },
  "ai-estimated": { label: "AI-uppskattning", tone: "estimate" },
};

export const originMeta = (o: string): OriginMeta =>
  ORIGIN[o as Origin] ?? { label: o || "Okänd", tone: "estimate" };

/* ── Trend ─────────────────────────────────────────────────────────────── */

export const trendMeta = (t: Trend): { label: string; tone: Meta["tone"]; arrow: string } => {
  switch (t) {
    case "up":
      return { label: "Stigande", tone: "pos", arrow: "↑" };
    case "down":
      return { label: "Fallande", tone: "neg", arrow: "↓" };
    case "flat":
      return { label: "Platt", tone: "neutral", arrow: "→" };
    default:
      return { label: "För lite data", tone: "neutral", arrow: "·" };
  }
};

/* ── Länkar ────────────────────────────────────────────────────────────── */

/**
 * Enda stället som får bygga en produkt-URL.
 *
 * Returnerar hela adressen inklusive period, så att ingen anropare behöver
 * klistra på "?month=" själv — sku ligger redan i query-strängen och en andra
 * frågetecken hade spräckt länken.
 *
 * Sidan ligger på /produkt och INTE under /products/. Omdirigeringen för
 * backendens gamla länkar matchar "/products/:sku", och det mönstret svalde
 * allt som låg där — även Next egna datafiler som /products/detail.txt, vilket
 * gav sku="detail.txt" och en tom sida. Utanför /products/ kan det inte hända.
 *
 * sku kan vara null från backend. Då finns ingen sida att länka till.
 */
export const productHref = (p: Pick<Product, "sku">, month?: string): string | null => {
  if (!p.sku) return null;
  const q = new URLSearchParams({ sku: p.sku });
  if (month) q.set("month", month);
  return `/produkt?${q.toString()}`;
};

/* ── Ordlista för term-tooltips ────────────────────────────────────────── */

export interface Term {
  short: string;
  detail: string;
}

export const TERMS: Record<string, Term> = {
  poas: {
    short: "Vinst per annonskrona. Break-even är alltid exakt 1,00.",
    detail:
      "POAS = täckningsbidrag ÷ annonskostnad. Till skillnad från ROAS beror break-even inte på marginalen — den ligger på 1,00 för varje produkt, så två produkter går att jämföra rakt av i samma kolumn. Under 1,00 betalar du för att sälja.",
  },
  roas: {
    short: "Omsättning per annonskrona. Break-even beror på marginalen.",
    detail:
      "ROAS = intäkt (ex moms) ÷ annonskostnad. Talet säger inget om lönsamhet i sig: ROAS 2,4 är utmärkt vid 60 % marginal och förlust vid 30 %. Jämför alltid mot produktens egen break-even ROAS.",
  },
  contribution: {
    short: "Täckningsbidrag FÖRE annonskostnad.",
    detail:
      "Intäkt ex moms minus rörliga kostnader: varukostnad, frakt och transaktionsavgifter. Annonskostnaden är inte avdragen — det är hela poängen. Bidraget är pengarna du har att betala annonser med, och nettovinsten är vad som blir kvar efteråt.",
  },
  breakEvenRoas: {
    short: "Den ROAS där produkten går jämnt ut.",
    detail:
      "Break-even ROAS = 1 ÷ bruttomarginal. Vid 40 % marginal krävs ROAS 2,50 för att nå noll. Lägre marginal flyttar kravet uppåt — därför säger en ROAS-siffra ingenting förrän du vet vilken marginal den gäller.",
  },
  opportunityScore: {
    short: "0–100, deterministiskt räknat. Ingen AI.",
    detail:
      "Lönsamhet 40 % (POAS mot målet 1,50) · marginal 25 % (mot 30 %) · efterfrågetrend 35 % (MoM-förändring i antal ordrar). Samma indata ger alltid samma tal, så det går att följa över tid.",
  },
  healthScore: {
    short: "Portföljens hälsa 0–100.",
    detail:
      "POAS 45 % · nettomarginal 35 % · andel produkter över break-even 20 %. Beräknat i backenden, inte av AI.",
  },
  cac: {
    short: "Annonskostnad per order.",
    detail:
      "CAC = annonskostnad ÷ antal ordrar. Jämför den mot täckningsbidrag per order: mellanskillnaden är vad ordern faktiskt lämnar kvar.",
  },
  aov: {
    short: "Snittordervärde, ex moms.",
    detail: "AOV = intäkt ex moms ÷ antal ordrar. Högre AOV gör en hög CAC lättare att bära.",
  },
  grossMargin: {
    short: "Täckningsbidrag som andel av intäkten.",
    detail:
      "Bruttomarginal = täckningsbidrag ÷ intäkt ex moms. Den sätter break-even ROAS (1 ÷ marginal) och avgör hur mycket CPA produkten tål.",
  },
  returnRate: {
    short: "Andel returnerade ordrar.",
    detail:
      "Returer äter bidrag två gånger: den uteblivna intäkten och kostnaden för att ta hem varan. Backenden räknar redan av returgraden från bidraget.",
  },
  netProfit: {
    short: "Vinst EFTER annonskostnad.",
    detail: "Nettovinst = täckningsbidrag − annonskostnad. Det är talet som faktiskt når kontot.",
  },
};

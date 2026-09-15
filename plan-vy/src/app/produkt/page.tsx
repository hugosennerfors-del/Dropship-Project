"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useData } from "@/components/DataProvider";
import { DemandChart, PoasBar, ScoreMeter } from "@/components/charts";
import { Term } from "@/components/Term";
import {
  AiText,
  EmptyState,
  ErrorState,
  GlassCard,
  Pill,
  ProvenanceBadge,
  Section,
  Skeleton,
} from "@/components/primitives";
import { delta, kr, monthLabel, num, pct, x } from "@/lib/format";
import { statusMeta, trendMeta } from "@/lib/ui";
import type { TERMS } from "@/lib/ui";
import type { Product } from "@/lib/types";

function Stat({
  label,
  value,
  term,
  tone,
}: {
  label: string;
  value: string;
  term?: keyof typeof TERMS;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="glass-flat px-3.5 py-3">
      <dt className="text-[11.5px] text-[var(--text-muted)]">
        {term ? <Term k={term}>{label}</Term> : label}
      </dt>
      <dd
        className="mt-1 text-[16px] font-semibold tabular-nums"
        style={{ color: tone === "pos" ? "var(--pos-ink)" : tone === "neg" ? "var(--neg-ink)" : "var(--text-primary)" }}
      >
        {value}
      </dd>
    </div>
  );
}

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-[13px] italic text-[var(--text-muted)]">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
          <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--series)]" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ProductPage() {
  // sku kommer som query-parameter, inte som ruttsegment: statisk export kan
  // inte generera sidor för sku den inte känner till vid bygget.
  const searchParams = useSearchParams();
  const sku = searchParams.get("sku") ?? "";
  const { data, loading, error, refetch, month } = useData();

  if (error) return <ErrorState message={error} onRetry={refetch} />;

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <div className="glass p-5"><Skeleton className="h-4 w-40" /><Skeleton className="mt-4 h-16 w-full" /></div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="glass p-5"><Skeleton className="h-4 w-32" /><Skeleton className="mt-5 h-10 w-24" /><Skeleton className="mt-4 h-2.5 w-full" /></div>
          <div className="glass p-5"><Skeleton className="h-4 w-28" /><Skeleton className="mt-4 h-[200px] w-full" /></div>
        </div>
      </div>
    );
  }

  const product: Product | undefined = data.products.find((p) => p.sku === sku);

  if (!product) {
    return (
      <GlassCard>
        <EmptyState
          title="Produkten finns inte i den här perioden."
          body={sku ? `Ingen produkt med SKU "${sku}" rapporterades för ${data.meta.period ?? month}.` : "Ingen produkt vald."}
        />
        <div className="mt-4 text-center">
          <Link href={`/products?month=${month}`} className="text-[13px] font-medium text-[var(--series)] hover:underline">
            ← Tillbaka till alla produkter
          </Link>
        </div>
      </GlassCard>
    );
  }

  const f = product.financials;
  const d = product.demand;
  const ai = product.ai;
  const t = trendMeta(d.trend);
  const srcOf = (section: string) => product.sources.find((s) => s.section === section);

  return (
    <div className="space-y-5">
      {/* Rubrik */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="truncate text-[19px] font-semibold tracking-tight text-[var(--text-primary)]">
              {product.name}
            </h2>
            <Pill meta={statusMeta(product.status)} />
          </div>
          <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">
            {monthLabel(data.meta.period ?? month)} · SKU {product.sku ?? "—"}
            {product.campaign ? ` · Kampanj ${product.campaign}` : " · Ingen kampanj mappad"}
          </p>
        </div>
        <Link href={`/products?month=${month}`} className="text-[12.5px] font-medium text-[var(--series)] hover:underline">
          ← Alla produkter
        </Link>
      </div>

      {/* a. AI Verdict */}
      <Section title="AI Verdict" origin="ai-generated" note="Genererat av språkmodell utifrån produktens egna siffror.">
        {ai.verdict ? (
          <p className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">{ai.verdict}</p>
        ) : (
          <p className="text-[15px] italic text-[var(--text-muted)]">Inget verdict genererat.</p>
        )}
        <div className="mt-2.5"><AiText value={ai.verdictReason} fallback="Ingen motivering genererad." /></div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* b. Opportunity Score */}
        <Section
          title="Product Opportunity Score"
          origin={srcOf("opportunityScore")?.origin ?? "computed"}
          note={srcOf("opportunityScore")?.note}
        >
          <ScoreMeter
            score={product.opportunityScore}
            label={product.opportunityLabel}
            breakdown={[
              { key: "profitability", label: "Lönsamhet (40 %)", value: product.opportunityBreakdown.profitability },
              { key: "margin", label: "Marginal (25 %)", value: product.opportunityBreakdown.margin },
              { key: "demand", label: "Efterfrågetrend (35 %)", value: product.opportunityBreakdown.demand },
            ]}
          />
          <div className="mt-5 border-t border-[var(--hairline)] pt-4">
            <AiText value={ai.scoreSummary} fallback="Ingen sammanfattning genererad." />
          </div>
        </Section>

        {/* c. Demand */}
        <Section
          title="Demand"
          origin={srcOf("demand")?.origin ?? "real"}
          note={srcOf("demand")?.note}
          actions={
            d.monthsOfData >= 2 ? (
              <span className="text-[12.5px] font-medium" style={{ color: t.tone === "pos" ? "var(--pos-ink)" : t.tone === "neg" ? "var(--neg-ink)" : "var(--text-secondary)" }}>
                {t.arrow} {t.label}
                {d.momGrowth != null ? ` · ${delta(d.momGrowth)} MoM` : null}
              </span>
            ) : null
          }
          delay={0.05}
        >
          <DemandChart series={d.series} monthsOfData={d.monthsOfData} />
        </Section>
      </div>

      {/* d. Customer Voice + e. Competition */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Customer Voice" origin={srcOf("customerVoice")?.origin ?? "ai-estimated"} note={srcOf("customerVoice")?.note}>
          <AiText value={ai.customerVoice} fallback="Ingen kundröst genererad." />
        </Section>
        <Section title="Competition" origin={srcOf("competition")?.origin ?? "ai-estimated"} note={srcOf("competition")?.note} delay={0.04}>
          <AiText value={ai.competition} fallback="Ingen konkurrensanalys genererad." />
        </Section>
      </div>

      {/* f. Ads */}
      <Section title="Ads" origin={srcOf("financials")?.origin ?? "real"} note={srcOf("financials")?.note}>
        <p className="mb-4 text-[12.5px] text-[var(--text-muted)]">
          Kampanj: <span className="font-medium text-[var(--text-secondary)]">{product.campaign ?? "ingen mappad"}</span>
        </p>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Annonskostnad" value={kr(f.adSpend)} />
          <Stat label="CAC" value={kr(f.cac)} term="cac" />
          <Stat label="ROAS" value={x(f.roas)} term="roas" />
          <Stat label="POAS" value={x(f.poas)} term="poas" tone={f.poas >= 1 ? "pos" : "neg"} />
        </dl>
        <div className="mt-5">
          <PoasBar poas={f.poas} />
          <p className="mt-2.5 text-[12.5px] text-[var(--text-secondary)]">
            {f.poas >= 1
              ? `Varje annonskrona ger ${x(f.poas)} i täckningsbidrag. Ordern lämnar ${kr(f.contributionPerOrder - f.cac)} kvar efter annonsen.`
              : `Varje annonskrona ger bara ${x(f.poas)} i täckningsbidrag. CAC ${kr(f.cac)} mot bidrag ${kr(f.contributionPerOrder)} per order.`}
          </p>
        </div>
      </Section>

      {/* g. Financials */}
      <Section title="Financials" origin={srcOf("financials")?.origin ?? "real"} note={srcOf("financials")?.note}>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Intäkt ex moms" value={kr(f.revenueExVat)} />
          <Stat label="Ordrar" value={num(f.orders)} />
          <Stat label="AOV" value={kr(f.aov)} term="aov" />
          <Stat label="Täckningsbidrag" value={kr(f.contribution)} term="contribution" tone={f.contribution >= 0 ? "pos" : "neg"} />
          <Stat label="Bidrag per order" value={kr(f.contributionPerOrder)} term="contribution" />
          <Stat label="Nettovinst" value={kr(f.netProfit)} term="netProfit" tone={f.netProfit >= 0 ? "pos" : "neg"} />
          <Stat label="Bruttomarginal" value={pct(f.grossMargin)} term="grossMargin" />
          <Stat label="Break-even ROAS" value={f.breakEvenRoas == null ? "—" : x(f.breakEvenRoas)} term="breakEvenRoas" />
          <Stat label="Returgrad" value={pct(f.returnRate)} term="returnRate" tone={f.returnRate > 0.1 ? "neg" : undefined} />
          <Stat label="Enheter" value={num(f.units)} />
          <Stat label="Intäkt inkl moms" value={kr(f.revenueInclVat)} />
        </dl>
        {f.breakEvenRoas != null ? (
          <p className="mt-4 text-[12.5px] text-[var(--text-secondary)]">
            Marginalen {pct(f.grossMargin)} kräver ROAS {x(f.breakEvenRoas)} för att gå jämnt ut. Faktisk ROAS är {x(f.roas)} —{" "}
            {f.roas >= f.breakEvenRoas ? "över kravet." : "under kravet."}
          </p>
        ) : null}
      </Section>

      {/* h. Market */}
      <Section title="Market" origin={srcOf("market")?.origin ?? "ai-estimated"} note={srcOf("market")?.note}>
        <AiText value={ai.market} fallback="Ingen marknadsanalys genererad." />
      </Section>

      {/* i. AI Analysis */}
      <Section title="AI Analysis" origin="ai-generated" note="Språkmodellens sammanfattning av vad som driver scoren.">
        <AiText value={ai.scoreSummary} fallback="Ingen analys genererad." />
      </Section>

      {/* j. Opportunities + k. Risks */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Opportunities" origin="ai-generated" note="AI-genererade uppslag, inte verifierade.">
          <Bullets items={ai.opportunities} empty="Inga möjligheter genererade." />
        </Section>
        <Section title="Risks" origin="ai-generated" note="AI-genererade risker, inte verifierade." delay={0.04}>
          <Bullets items={ai.risks} empty="Inga risker genererade." />
        </Section>
      </div>

      {/* l. Sources */}
      <GlassCard delay={0.06}>
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">Sources</h2>
        <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">
          Varje sektion ovan är märkt med var datan kommer ifrån.
        </p>
        <ul className="mt-4 space-y-2.5">
          {product.sources.map((s) => (
            <li key={s.section} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
              <ProvenanceBadge origin={s.origin} />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">{s.section}</span>
              <span className="text-[12.5px] text-[var(--text-muted)]">{s.note}</span>
            </li>
          ))}
        </ul>
      </GlassCard>
    </div>
  );
}

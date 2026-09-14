"use client";

import Link from "next/link";
import { useData } from "@/components/DataProvider";
import { KpiCard, KpiSkeleton } from "@/components/KpiCard";
import { AlertList } from "@/components/AlertList";
import { PoasBar, ScoreMeter, Sparkline } from "@/components/charts";
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
import { kr, num, pct, x } from "@/lib/format";
import { productHref, statusMeta } from "@/lib/ui";

export default function OverviewPage() {
  const { data, loading, error, refetch, month } = useData();

  if (error) return <ErrorState message={error} onRetry={refetch} />;

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="glass p-5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="mt-5 h-10 w-24" />
            <Skeleton className="mt-4 h-2.5 w-full" />
          </div>
          <div className="glass p-5">
            <Skeleton className="h-3.5 w-28" />
            <div className="mt-4 space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-[85%]" />
            </div>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <KpiSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  const { overview, ai, alerts, products, meta } = data;
  const k = overview.kpis;
  const aiSource = meta.dataSources.find((d) => d.key === "ai_insights");
  const topProducts = [...products].sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Health + narrativ */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Section title="Business Health Score" origin="computed" note="POAS 45 % · nettomarginal 35 % · andel över break-even 20 %.">
          <ScoreMeter
            score={overview.healthScore}
            label={overview.healthLabel}
            tone="status"
            breakdown={[
              { key: "poas", label: "POAS", value: overview.healthBreakdown.poas },
              { key: "margin", label: "Nettomarginal", value: overview.healthBreakdown.margin },
              { key: "winShare", label: "Andel över break-even", value: overview.healthBreakdown.winShare },
            ]}
          />
          <p className="mt-5 border-t border-[var(--hairline)] pt-4 text-[12.5px] text-[var(--text-muted)]">
            {num(k.winners)} av {num(k.productCount)} produkter bär sin annonskostnad.
          </p>
        </Section>

        <Section
          title="AI-sammanfattning"
          origin={aiSource?.origin ?? "ai-generated"}
          note={aiSource?.note}
          delay={0.05}
        >
          <AiText value={ai.healthNarrative} />

          {ai.nextActions.length ? (
            <div className="mt-5 border-t border-[var(--hairline)] pt-4">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Nästa steg
              </h3>
              <ol className="mt-2.5 space-y-1.5">
                {ai.nextActions.map((a, i) => (
                  <li key={i} className="flex gap-2.5 text-[13px] text-[var(--text-secondary)]">
                    <span className="mt-[3px] shrink-0 text-[11px] font-semibold tabular-nums text-[var(--series)]">
                      {i + 1}
                    </span>
                    <span>{a}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <Link
            href={`/insights?month=${month}`}
            className="mt-5 inline-block text-[12.5px] font-medium text-[var(--series)] hover:underline"
          >
            Alla rekommendationer och risker →
          </Link>
        </Section>
      </div>

      {/* KPI:er */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Intäkt ex moms" value={kr(k.revenueExVat)} sub={`${num(k.orders)} ordrar · ${num(k.units)} enheter`} delay={0.02} />
        <KpiCard label="AOV" value={kr(k.aov)} term="aov" sub="Snittordervärde ex moms" delay={0.04} />
        <KpiCard label="Annonskostnad" value={kr(k.adSpend)} sub={`CPA ${kr(k.orders ? k.adSpend / k.orders : null)}`} delay={0.06} />
        <KpiCard label="Täckningsbidrag" value={kr(k.contribution)} term="contribution" raw={k.contribution} tone="auto" sub={`Marginal ${pct(k.contribMargin)}`} delay={0.08} />
        <KpiCard label="Nettovinst" value={kr(k.netProfit)} term="netProfit" raw={k.netProfit} tone="auto" sub={`Nettomarginal ${pct(k.netMargin)}`} delay={0.1} />
        <KpiCard
          label="POAS"
          value={x(k.poas)}
          term="poas"
          raw={k.poas - 1}
          tone="auto"
          sub={k.poas >= 1 ? "Över break-even" : "Under break-even"}
          accessory={<PoasBar poas={k.poas} compact />}
          delay={0.12}
        />
        <KpiCard label="ROAS" value={x(k.roas)} term="roas" sub="Jämför mot produktens break-even" delay={0.14} />
        <KpiCard
          label="Vinnare / förlorare"
          value={`${num(k.winners)} / ${num(k.losers)}`}
          sub={`${num(k.candidateCount)} kandidater i research`}
          delay={0.16}
        />
      </div>

      {/* Produkter */}
      <Section
        title="Produkter med högst Opportunity Score"
        origin="computed"
        note="Lönsamhet 40 % · marginal 25 % · efterfrågetrend 35 %."
        actions={
          <Link href={`/products?month=${month}`} className="text-[12.5px] font-medium text-[var(--series)] hover:underline">
            Alla produkter →
          </Link>
        }
      >
        {topProducts.length === 0 ? (
          <EmptyState
            title="Inga produkter för den här perioden."
            body="Välj en annan månad i periodväljaren uppe till höger."
          />
        ) : (
          <ul className="divide-y divide-[var(--hairline)]">
            {topProducts.map((p) => {
              const href = productHref(p);
              const inner = (
                <div className="flex items-center gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-[var(--text-primary)]">{p.name}</p>
                    <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
                      {p.opportunityLabel} · {p.opportunityScore}/100
                    </p>
                  </div>
                  <div className="hidden sm:block"><Sparkline series={p.demand.series} /></div>
                  <div className="w-[88px] shrink-0 text-right">
                    <p className="text-[13px] font-semibold tabular-nums text-[var(--text-primary)]">{x(p.financials.poas)}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">POAS</p>
                  </div>
                  <Pill meta={statusMeta(p.status)} size="sm" />
                </div>
              );
              return (
                <li key={p.sku ?? p.name}>
                  {href ? (
                    <Link href={`${href}?month=${month}`} className="-mx-2 block rounded-lg px-2 transition hover:bg-white/50">
                      {inner}
                    </Link>
                  ) : (
                    <div className="-mx-2 px-2" title="Produkten saknar SKU och har ingen egen sida.">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Larm */}
      <Section
        title="Larm"
        origin="computed"
        note="Beräknade tröskelvärden i backenden, inte AI."
        actions={
          alerts.length ? (
            <Link href={`/alerts?month=${month}`} className="text-[12.5px] font-medium text-[var(--series)] hover:underline">
              Alla larm →
            </Link>
          ) : null
        }
      >
        <AlertList alerts={alerts.slice(0, 5)} products={products} />
      </Section>

      {/* Datakällor */}
      <GlassCard delay={0.1}>
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">Datakällor</h2>
        <ul className="mt-4 space-y-2.5">
          {meta.dataSources.map((s) => (
            <li key={s.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
              <ProvenanceBadge origin={s.origin} />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">{s.label}</span>
              <span className="text-[12.5px] text-[var(--text-muted)]">{s.note}</span>
            </li>
          ))}
        </ul>
      </GlassCard>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useData } from "@/components/DataProvider";
import { AxisBar, StressTable } from "@/components/CandidateParts";
import { Term } from "@/components/Term";
import {
  EmptyState,
  ErrorState,
  GlassCard,
  Pill,
  ProvenanceBadge,
  Section,
  Skeleton,
} from "@/components/primitives";
import { IconExternal } from "@/components/icons";
import { dateLabel, kr, monthLabel, pct, x } from "@/lib/format";
import { realityCheck, successScore } from "@/lib/success";
import { verdictMeta } from "@/lib/ui";
import type { Candidate } from "@/lib/types";

const VAT = 0.25;
const ex = (v: number) => v / (1 + VAT);

/** Ett steg i kalkylen. Positiva belopp läggs till, negativa dras av. */
function CalcRow({ label, value, sum, hint }: { label: string; value: number; sum?: boolean; hint?: string }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-2 ${
        sum ? "border-t border-[var(--hairline)] font-semibold" : ""
      }`}
    >
      <dt className={sum ? "text-[13px] text-[var(--text-primary)]" : "text-[12.5px] text-[var(--text-secondary)]"}>
        {label}
        {hint ? <span className="ml-2 text-[11px] text-[var(--text-muted)]">{hint}</span> : null}
      </dt>
      <dd
        className="shrink-0 text-[13px] tabular-nums"
        style={{
          color: sum
            ? value >= 0 ? "var(--pos-ink)" : "var(--neg-ink)"
            : value < 0 ? "var(--text-secondary)" : "var(--text-primary)",
        }}
      >
        {value < 0 ? `− ${kr(Math.abs(value))}` : kr(value)}
      </dd>
    </div>
  );
}

export default function CandidatePage() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const { data, loading, error, refetch, month } = useData();

  if (error) return <ErrorState message={error} onRetry={refetch} />;

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <div className="glass p-5"><Skeleton className="h-5 w-64" /><Skeleton className="mt-4 h-12 w-40" /></div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="glass p-5"><Skeleton className="h-4 w-32" /><Skeleton className="mt-4 h-40 w-full" /></div>
          <div className="glass p-5"><Skeleton className="h-4 w-32" /><Skeleton className="mt-4 h-40 w-full" /></div>
        </div>
      </div>
    );
  }

  const c: Candidate | undefined = data.candidates.find((k) => k.id === id);

  if (!c) {
    return (
      <GlassCard>
        <EmptyState
          title="Kandidaten finns inte."
          body={id ? `Ingen sparad kandidat med id "${id}".` : "Ingen kandidat vald."}
        />
        <div className="mt-4 text-center">
          <Link href={`/research?month=${month}`} className="text-[13px] font-medium text-[var(--series)] hover:underline">
            ← Tillbaka till research
          </Link>
        </div>
      </GlassCard>
    );
  }

  const result = successScore(c);
  const rc = realityCheck(c, data.products);
  const units = c.inputs.expectedUnitsPerOrder || 1;
  const cpaEx = ex(c.inputs.expectedCpaInclVat);

  return (
    <div className="space-y-5">
      {/* Rubrik */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[19px] font-semibold tracking-tight text-[var(--text-primary)]">{c.name}</h2>
            <Pill meta={verdictMeta(c.verdict)} />
          </div>
          <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">
            {monthLabel(data.meta.period ?? month)} · {c.source ?? "okänd källa"}
            {c.createdAt ? ` · sparad ${dateLabel(c.createdAt)}` : null}
          </p>
        </div>
        <Link href={`/research?month=${month}`} className="text-[12.5px] font-medium text-[var(--series)] hover:underline">
          ← All research
        </Link>
      </div>

      {/* Den viktigaste ramen: det här är en prognos, inte en mätning. */}
      <div className="rounded-xl border border-[var(--warn)]/25 bg-[#d97706]/8 px-4 py-3">
        <p className="text-[12.5px] leading-relaxed text-[var(--warn-ink)]">
          <strong>Produkten har aldrig sålts.</strong> Varenda siffra nedan är en uppskattning — inköpspris,
          utpris och framför allt CPA. Det finns ingen efterfrågehistorik, ingen kundröst och ingen uppmätt
          konkurrens att luta sig mot, till skillnad från produktsidorna.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* Bedömning */}
        <Section
          title="Bedömning"
          origin="computed"
          note="Förväntad lönsamhet 35 % · marginal 25 % · CPA-realism 25 % · bidrag per order 15 %."
        >
          <div className="flex items-end gap-3">
            <span className="text-[40px] font-semibold leading-none tabular-nums text-[var(--text-primary)]">
              {result.score}
            </span>
            <span className="pb-1 text-[13px] text-[var(--text-muted)]">/ 100</span>
            <span className="ml-auto pb-1 text-[13px] font-medium text-[var(--text-secondary)]">{result.label}</span>
          </div>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[#52606d]/12">
            <div className="h-full rounded-full" style={{ width: `${result.score}%`, background: "#4f46e5" }} />
          </div>
          <dl className="mt-5 space-y-3.5">
            {result.axes.map((a) => (
              <AxisBar key={a.key} label={a.label} value={a.value} weight={a.weight} note={a.note} />
            ))}
          </dl>
        </Section>

        {/* Kalkylen steg för steg */}
        <Section
          title="Kalkylen, steg för steg"
          origin="computed"
          note="Räknat på kandidatens indata. Alla belopp ex moms."
          delay={0.04}
        >
          <dl>
            <CalcRow label="Utpris" value={ex(c.inputs.salePriceInclVat) * units} hint={units > 1 ? `${units} st` : undefined} />
            <CalcRow label="Varukostnad" value={-ex(c.inputs.costPerUnitInclVat) * units} />
            <CalcRow label="Frakt" value={-ex(c.inputs.shippingCostPerOrder)} />
            <CalcRow label="Transaktionsavgift" value={-ex(c.inputs.transactionFeePerOrder)} />
            <CalcRow label="Täckningsbidrag" value={c.calc.contributionPerOrder} sum />
            <CalcRow label="Förväntad annonskostnad" value={-cpaEx} hint="gissad" />
            <CalcRow label="Netto per order" value={c.calc.netPerOrder} sum />
          </dl>

          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-[var(--hairline)] pt-4">
            <div className="glass-flat px-3.5 py-3">
              <dt className="text-[11.5px] text-[var(--text-muted)]"><Term k="grossMargin">Bruttomarginal</Term></dt>
              <dd className="mt-1 text-[16px] font-semibold tabular-nums text-[var(--text-primary)]">{pct(c.calc.grossMargin)}</dd>
            </div>
            <div className="glass-flat px-3.5 py-3">
              <dt className="text-[11.5px] text-[var(--text-muted)]"><Term k="breakEvenRoas">Break-even ROAS</Term></dt>
              <dd className="mt-1 text-[16px] font-semibold tabular-nums text-[var(--text-primary)]">
                {c.calc.breakEvenRoas == null ? "—" : x(c.calc.breakEvenRoas)}
              </dd>
            </div>
          </dl>
        </Section>
      </div>

      {/* Stresstest */}
      <Section title="Tål kalkylen att ha fel?" origin="computed" note="POAS och netto per order vid högre CPA än antaget.">
        <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
          CPA är det enda talet ingen känner till på förhand, och hela utfallet hänger på det.
          Ordern slutar bära sig när CPA stigit {pct(result.cpaHeadroom, 0)} över gissningen.
        </p>
        <StressTable result={result} />
      </Section>

      {/* Verklighetskoll */}
      <Section
        title="Mot dina egna siffror"
        origin="real"
        note="Jämförelsen använder dina liveprodukters faktiska utfall denna period."
      >
        {rc.basis === 0 ? (
          <EmptyState
            title="Inga liveprodukter att jämföra med."
            body="När du har en produkt som annonserats går kandidatens antaganden att ställa mot verkligt utfall."
          />
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-3">
              <div className="glass-flat px-3.5 py-3">
                <dt className="text-[11.5px] text-[var(--text-muted)]">Antagen CPA (ex moms)</dt>
                <dd className="mt-1 text-[16px] font-semibold tabular-nums text-[var(--text-primary)]">{kr(rc.assumedCpaEx)}</dd>
              </div>
              <div className="glass-flat px-3.5 py-3">
                <dt className="text-[11.5px] text-[var(--text-muted)]">Din faktiska <Term k="cac">CAC</Term></dt>
                <dd className="mt-1 text-[16px] font-semibold tabular-nums text-[var(--text-primary)]">
                  {kr(rc.observedCacLow)} – {kr(rc.observedCacHigh)}
                </dd>
              </div>
              <div className="glass-flat px-3.5 py-3">
                <dt className="text-[11.5px] text-[var(--text-muted)]">Din faktiska marginal</dt>
                <dd className="mt-1 text-[16px] font-semibold tabular-nums text-[var(--text-primary)]">
                  {pct(rc.observedMarginLow, 0)} – {pct(rc.observedMarginHigh, 0)}
                </dd>
              </div>
            </dl>

            <div className="mt-4 space-y-2.5">
              {rc.cpaBelowAnythingAchieved ? (
                <p className="rounded-xl border border-[var(--neg)]/25 bg-[#dc2626]/8 px-4 py-3 text-[12.5px] leading-relaxed text-[#b91c1c]">
                  Kalkylen antar {kr(rc.assumedCpaEx)} per order — <strong>billigare än något du faktiskt har
                  uppnått</strong> ({kr(rc.observedCacLow)} som lägst på {rc.basis} {rc.basis === 1 ? "produkt" : "produkter"}).
                  Håller inte det antagandet faller hela kalkylen.
                </p>
              ) : (
                <p className="rounded-xl border border-[var(--pos)]/25 bg-[#059669]/8 px-4 py-3 text-[12.5px] leading-relaxed text-[var(--pos-ink)]">
                  Antagen CPA {kr(rc.assumedCpaEx)} ligger inom det spann du faktiskt presterat.
                  Antagandet är åtminstone inte orimligt.
                </p>
              )}

              {rc.marginAboveAnythingAchieved ? (
                <p className="rounded-xl border border-[var(--warn)]/25 bg-[#d97706]/8 px-4 py-3 text-[12.5px] leading-relaxed text-[var(--warn-ink)]">
                  Antagen marginal {pct(c.calc.grossMargin, 0)} är högre än något du haft
                  ({pct(rc.observedMarginHigh, 0)} som bäst). Kontrollera inköpspriset innan du räknar hem det.
                </p>
              ) : null}
            </div>

            <p className="mt-4 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
              CPA räknas om till ex moms före jämförelsen — kandidatens tal anges inklusive moms, dina
              produkters CAC exklusive. Utan omräkning hade varje kandidat sett 25 % dyrare ut än den är.
            </p>
          </>
        )}
      </Section>

      {/* Anteckning */}
      {c.notes || c.supplierUrl ? (
        <Section title="Anteckning" origin="ai-generated" note="Motivering från språkmodellen som föreslog produkten.">
          {c.notes ? (
            <p className="text-[13.5px] leading-relaxed text-[var(--text-secondary)]">{c.notes}</p>
          ) : null}
          {c.supplierUrl ? (
            <a
              href={c.supplierUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--series)] hover:underline"
            >
              Leverantör <IconExternal width={13} height={13} />
            </a>
          ) : null}
        </Section>
      ) : null}

      {/* Vad som saknas — motsvarigheten till produktsidans sektioner */}
      <GlassCard delay={0.06}>
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
          Det här vet vi inte
        </h2>
        <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">
          Sektioner som finns på en produktsida, men som saknar underlag för en kandidat.
        </p>
        <ul className="mt-4 space-y-2.5">
          {[
            ["Efterfrågan", "Ingen försäljningshistorik finns förrän produkten annonserats."],
            ["Kundröst", "Inga egna recensioner eller returorsaker att läsa av."],
            ["Konkurrens", "Ingen uppmätt konkurrens — bara språkmodellens allmänna intryck."],
            ["Returgrad", "Okänd. Den kan ensam äta upp hela bidraget ovan."],
          ].map(([t, d]) => (
            <li key={t} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="text-[13px] font-medium text-[var(--text-primary)]">{t}</span>
              <span className="text-[12.5px] text-[var(--text-muted)]">{d}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-[var(--hairline)] pt-4 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
          Enda sättet att fylla i dem är att köra ett test. Bidraget {kr(c.calc.contributionPerOrder)} per order
          säger hur mycket varje order har att ge — och därmed hur snabbt ett test blir dyrt om CPA:n
          hamnar fel.
        </p>
      </GlassCard>

      {/* Källor */}
      <GlassCard delay={0.08}>
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">Källor</h2>
        <ul className="mt-4 space-y-2.5">
          <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
            <ProvenanceBadge origin="ai-estimated" note="Inköpspris, utpris, frakt, avgift och CPA är gissade av språkmodellen." />
            <span className="text-[13px] font-medium text-[var(--text-primary)]">Indata</span>
            <span className="text-[12.5px] text-[var(--text-muted)]">Uppskattade, inte uppmätta.</span>
          </li>
          <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
            <ProvenanceBadge origin="computed" note="Bidrag, marginal, break-even ROAS, POAS och chansscore räknas i kod." />
            <span className="text-[13px] font-medium text-[var(--text-primary)]">Kalkyl och betyg</span>
            <span className="text-[12.5px] text-[var(--text-muted)]">Deterministiskt — samma indata ger samma tal.</span>
          </li>
          <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
            <ProvenanceBadge origin="real" note="Dina liveprodukters faktiska CAC och marginal denna period." />
            <span className="text-[13px] font-medium text-[var(--text-primary)]">Jämförelsen</span>
            <span className="text-[12.5px] text-[var(--text-muted)]">Verkligt utfall från din egen portfölj.</span>
          </li>
        </ul>
      </GlassCard>
    </div>
  );
}

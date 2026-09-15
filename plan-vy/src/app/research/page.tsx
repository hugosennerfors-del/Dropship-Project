"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useData } from "@/components/DataProvider";
import { Term } from "@/components/Term";
import { BestBet } from "@/components/BestBet";
import { EmptyState, ErrorState, GlassCard, Pill, Section, Skeleton } from "@/components/primitives";
import { IconExternal } from "@/components/icons";
import { ApiError, generateResearch } from "@/lib/api";
import { dateLabel, kr, pct, x } from "@/lib/format";
import { rankCandidates } from "@/lib/success";
import { verdictMeta } from "@/lib/ui";
import type { Candidate } from "@/lib/types";

function Row({ label, value, term, tone }: { label: string; value: string; term?: Parameters<typeof Term>[0]["k"]; tone?: "pos" | "neg" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--hairline)] py-1.5 last:border-0">
      <dt className="text-[12px] text-[var(--text-muted)]">{term ? <Term k={term}>{label}</Term> : label}</dt>
      <dd
        className="text-[13px] font-semibold tabular-nums"
        style={{ color: tone === "pos" ? "var(--pos-ink)" : tone === "neg" ? "var(--neg-ink)" : "var(--text-primary)" }}
      >
        {value}
      </dd>
    </div>
  );
}

function CandidateCard({ c, index, rank, score }: { c: Candidate; index: number; rank?: number; score?: number }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.35), ease: [0.22, 1, 0.36, 1] }}
      className="glass flex flex-col p-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-baseline gap-2 text-[14.5px] font-semibold leading-snug text-[var(--text-primary)]">
            {rank ? (
              <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-[var(--text-muted)]">
                {rank}
              </span>
            ) : null}
            <span className="min-w-0">{c.name}</span>
          </h3>
          <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">
            {c.source ?? "Okänd källa"}
            {c.createdAt ? ` · ${dateLabel(c.createdAt)}` : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Pill meta={verdictMeta(c.verdict)} size="sm" />
          {score != null ? (
            <span className="text-[11px] tabular-nums text-[var(--text-muted)]">Chans {score}</span>
          ) : null}
        </div>
      </header>

      {c.notes ? (
        <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">{c.notes}</p>
      ) : null}

      <dl className="mt-4 mb-4">
        <Row label="Bidrag per order" value={kr(c.calc.contributionPerOrder)} term="contribution" tone={c.calc.contributionPerOrder > 0 ? "pos" : "neg"} />
        <Row label="Bruttomarginal" value={pct(c.calc.grossMargin)} term="grossMargin" />
        <Row label="Break-even ROAS" value={c.calc.breakEvenRoas == null ? "—" : x(c.calc.breakEvenRoas)} term="breakEvenRoas" />
        <Row label="Förväntad POAS" value={x(c.calc.expectedPoas)} term="poas" tone={c.calc.expectedPoas >= 1 ? "pos" : "neg"} />
        <Row label="Netto per order" value={kr(c.calc.netPerOrder)} tone={c.calc.netPerOrder >= 0 ? "pos" : "neg"} />
      </dl>

      <footer className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--hairline)] pt-3">
        <span className="text-[11.5px] text-[var(--text-muted)]">
          {kr(c.inputs.costPerUnitInclVat)} → {kr(c.inputs.salePriceInclVat)} inkl moms
        </span>
        {c.supplierUrl ? (
          <a
            href={c.supplierUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--series)] hover:underline"
          >
            Leverantör <IconExternal width={13} height={13} />
          </a>
        ) : null}
      </footer>
    </motion.article>
  );
}

export default function ResearchPage() {
  const { data, loading, error, refetch } = useData();
  const [niche, setNiche] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function onGenerate(e: React.FormEvent) {
    e.preventDefault();
    const value = niche.trim();
    if (!value || busy) return;

    setBusy(true);
    setNote(null);
    try {
      const count = await generateResearch(value);
      setNote({
        kind: "ok",
        text: count
          ? `${count} nya kandidater sparade för "${value}".`
          : `Anropet gick igenom för "${value}", men inga kandidater kom tillbaka.`,
      });
      setNiche("");
      refetch();
    } catch (err) {
      setNote({
        kind: "err",
        text: err instanceof ApiError ? err.message : "Kunde inte generera kandidater.",
      });
    } finally {
      setBusy(false);
    }
  }

  const ranked = data ? rankCandidates(data.candidates) : [];

  return (
    <div className="space-y-6">
      {/* Bästa chansen — rangordnar kandidaterna innan generatorn, så det första
          man ser är en slutsats och inte ett inmatningsfält. */}
      {!loading && data && data.candidates.length > 0 ? (
        <BestBet candidates={data.candidates} />
      ) : null}

      {/* Generator */}
      <GlassCard>
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">AI-produktresearch</h2>
        <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">
          Beskriv en nisch. Backenden föreslår fem kandidater med uppskattad kalkyl och sparar dem.
        </p>

        <form onSubmit={onGenerate} className="mt-4 flex flex-wrap gap-2.5">
          <label htmlFor="niche" className="sr-only">Nisch</label>
          <input
            id="niche"
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            disabled={busy}
            placeholder="t.ex. husdjursprodukter för lägenhet"
            className="min-w-0 flex-1 rounded-xl border border-white/70 bg-white/60 px-4 py-2.5 text-[13.5px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition focus:bg-white/85 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || !niche.trim()}
            className="rounded-xl border border-[var(--series)]/30 bg-[var(--series)]/12 px-5 py-2.5 text-[13px] font-semibold text-[#4338ca] transition hover:bg-[var(--series)]/20 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? "Genererar…" : "Generera idéer"}
          </button>
        </form>

        {busy ? (
          <p className="mt-3 text-[12.5px] text-[var(--text-muted)]">
            Språkmodellen skriver fem förslag och sparar dem. Det tar oftast 20–60 sekunder.
          </p>
        ) : null}

        {note ? (
          <p
            className="mt-3 text-[12.5px] font-medium"
            style={{ color: note.kind === "ok" ? "var(--pos-ink)" : "var(--neg-ink)" }}
            role="status"
          >
            {note.text}
          </p>
        ) : null}
      </GlassCard>

      {/* Kandidater */}
      {error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : loading || !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass p-5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-3 h-3 w-24" />
              <div className="mt-5 space-y-2.5">
                {Array.from({ length: 5 }).map((__, j) => <Skeleton key={j} className="h-3.5 w-full" />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Section
          title={`Kandidater (${data.candidates.length})`}
          origin="real"
          note="Sparade rader i product_candidates. Kalkylen är beräknad, siffrorna i den är AI-uppskattade."
          actions={
            <span className="text-[11.5px] text-[var(--text-muted)]">Sorterade efter chansscore</span>
          }
        >
          {data.candidates.length === 0 ? (
            <EmptyState title="Inga kandidater sparade än." body="Beskriv en nisch ovan och generera de första förslagen." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {ranked.map(({ candidate, result }, i) => (
                <CandidateCard key={candidate.id} c={candidate} index={i} rank={i + 1} score={result.score} />
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

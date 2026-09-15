"use client";

import { motion } from "framer-motion";
import { Pill, ProvenanceBadge } from "./primitives";
import { Term } from "./Term";
import { kr, pct, x } from "@/lib/format";
import { rankCandidates, type SuccessResult } from "@/lib/success";
import { verdictMeta } from "@/lib/ui";
import type { Candidate } from "@/lib/types";

const SERIES = "#4f46e5";

function AxisBar({ label, value, weight, note }: { label: string; value: number; weight: number; note: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-[12.5px] text-[var(--text-secondary)]">
          {label} <span className="text-[11px] text-[var(--text-muted)]">{Math.round(weight * 100)} %</span>
        </dt>
        <dd className="text-[12.5px] font-semibold tabular-nums text-[var(--text-primary)]">{Math.round(value)}</dd>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#52606d]/10">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(value, 100))}%`, background: SERIES }} />
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-muted)]">{note}</p>
    </div>
  );
}

function StressTable({ result }: { result: SuccessResult }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-[var(--hairline)] text-[11.5px] text-[var(--text-muted)]">
            <th scope="col" className="py-1.5 text-left font-medium">Om CPA blir</th>
            <th scope="col" className="py-1.5 text-right font-medium">POAS</th>
            <th scope="col" className="py-1.5 text-right font-medium">Netto/order</th>
            <th scope="col" className="py-1.5 text-right font-medium">Bär sig</th>
          </tr>
        </thead>
        <tbody>
          {result.stress.map((s) => (
            <tr key={s.bump} className="border-b border-[var(--hairline)] last:border-0">
              <td className="py-2 text-[var(--text-secondary)]">
                {s.bump === 0 ? "som gissat" : `+${Math.round(s.bump * 100)} %`}
              </td>
              <td className="py-2 text-right font-semibold tabular-nums"
                  style={{ color: s.survives ? "var(--pos-ink)" : "var(--neg-ink)" }}>
                {x(s.poas)}
              </td>
              <td className="py-2 text-right tabular-nums"
                  style={{ color: s.netPerOrder >= 0 ? "var(--pos-ink)" : "var(--neg-ink)" }}>
                {kr(s.netPerOrder)}
              </td>
              <td className="py-2 text-right font-medium"
                  style={{ color: s.survives ? "var(--pos-ink)" : "var(--neg-ink)" }}>
                {s.survives ? "Ja" : "Nej"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Rangordnar kandidaterna och lyfter fram den med högst chans.
 *
 * Betyget är räknat i koden, inte av AI — samma indata ger alltid samma tal.
 * Men INDATA är AI-gissningar, och det står i kortet: modellen rangordnar
 * uppskattningar, inte uppmätt verklighet.
 */
export function BestBet({ candidates }: { candidates: Candidate[] }) {
  const ranked = rankCandidates(candidates);
  if (ranked.length === 0) return null;

  const { candidate: top, result } = ranked[0];
  const runnersUp = ranked.slice(1, 4);
  const viable = top.calc.expectedPoas >= 1 && top.calc.contributionPerOrder > 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="glass overflow-hidden p-0"
    >
      <div aria-hidden className="h-[3px] w-full accent-rule" />
      <div className="p-5">
        <header className="mb-4 flex flex-wrap items-center gap-2.5">
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">Bästa chansen</h2>
          <ProvenanceBadge
            origin="computed"
            note="Betyget räknas i koden: förväntad lönsamhet 35 % · marginal 25 % · CPA-realism 25 % · bidrag per order 15 %. Samma indata ger alltid samma tal."
          />
        </header>

        {!viable ? (
          <p className="mb-4 rounded-xl border border-[var(--warn)]/30 bg-[#d97706]/10 px-4 py-3 text-[12.5px] text-[var(--warn-ink)]">
            Ingen kandidat bär sin egen annonskostnad ens på gissade siffror. Den högst rankade visas ändå,
            men den är inte ett vad med dåliga odds — den är ett vad med negativa odds.
          </p>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[17px] font-semibold leading-snug text-[var(--text-primary)]">{top.name}</p>
                <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                  {kr(top.inputs.costPerUnitInclVat)} → {kr(top.inputs.salePriceInclVat)} inkl moms
                </p>
              </div>
              <Pill meta={verdictMeta(top.verdict)} size="sm" />
            </div>

            <div className="mt-4 flex items-end gap-3">
              <span className="text-[40px] font-semibold leading-none tabular-nums text-[var(--text-primary)]">
                {result.score}
              </span>
              <span className="pb-1 text-[13px] text-[var(--text-muted)]">/ 100</span>
              <span className="ml-auto pb-1 text-[13px] font-medium text-[var(--text-secondary)]">{result.label}</span>
            </div>
            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[#52606d]/12">
              <div className="h-full rounded-full" style={{ width: `${result.score}%`, background: SERIES }} />
            </div>

            <dl className="mt-5 space-y-3.5">
              {result.axes.map((a) => (
                <AxisBar key={a.key} label={a.label} value={a.value} weight={a.weight} note={a.note} />
              ))}
            </dl>
          </div>

          <div>
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Tål kalkylen att ha fel?
            </h3>
            <p className="mt-1.5 mb-3 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
              CPA:n är gissad. Här är vad som händer om den blir högre än antaget.
              Ordern slutar bära sig när CPA stigit {pct(result.cpaHeadroom, 0)}.
            </p>
            <StressTable result={result} />

            <div className="mt-5 space-y-2.5 border-t border-[var(--hairline)] pt-4">
              <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
                <span className="font-semibold text-[var(--pos-ink)]">Starkast:</span>{" "}
                {result.strongest.label.toLowerCase()} — {result.strongest.note}
              </p>
              <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
                <span className="font-semibold text-[var(--neg-ink)]">Svagast:</span>{" "}
                {result.weakest.label.toLowerCase()} — {result.weakest.note}
              </p>
            </div>
          </div>
        </div>

        {runnersUp.length ? (
          <div className="mt-6 border-t border-[var(--hairline)] pt-4">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Närmast efter</h3>
            <ol className="mt-2.5 space-y-1.5">
              {runnersUp.map(({ candidate, result: r }, i) => (
                <li key={candidate.id} className="flex items-center gap-3 text-[12.5px]">
                  <span className="w-4 shrink-0 tabular-nums text-[var(--text-muted)]">{i + 2}</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{candidate.name}</span>
                  <span className="shrink-0 tabular-nums text-[var(--text-muted)]">
                    <Term k="poas">{x(candidate.calc.expectedPoas)}</Term>
                  </span>
                  <span className="w-8 shrink-0 text-right font-semibold tabular-nums text-[var(--text-primary)]">{r.score}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <p className="mt-5 border-t border-[var(--hairline)] pt-4 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
          Rangordningen är deterministisk, men den rangordnar <strong>uppskattningar</strong>. Inköpspris, utpris
          och CPA är AI-gissningar, inte uppmätta tal — därför väger modellen ner kandidater vars kalkyl vilar på
          en osannolikt låg CPA. Först när produkten faktiskt annonserats finns riktiga siffror att döma på.
        </p>
      </div>
    </motion.section>
  );
}

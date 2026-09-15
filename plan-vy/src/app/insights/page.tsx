"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useData } from "@/components/DataProvider";
import { AiText, EmptyState, ErrorState, GlassCard, Section, Skeleton } from "@/components/primitives";
import type { InsightLink } from "@/lib/types";

const PRIORITY = {
  high: { label: "Hög", cls: "bg-[#dc2626]/12 text-[#b91c1c] border-[#dc2626]/28" },
  medium: { label: "Medel", cls: "bg-[#d97706]/14 text-[var(--warn-ink)] border-[#d97706]/30" },
  low: { label: "Låg", cls: "bg-[#52606d]/10 text-[var(--text-secondary)] border-[#52606d]/22" },
} as const;

function Level({ level }: { level: keyof typeof PRIORITY | string }) {
  const p = PRIORITY[level as keyof typeof PRIORITY] ?? PRIORITY.low;
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${p.cls}`}>
      {p.label}
    </span>
  );
}

/**
 * Renderar bara de länkar backenden faktiskt har löst upp.
 *
 * links[] byggs i n8n av resolveLinks(), som matchar AI-texten mot riktiga
 * produktnamn och bara släpper igenom produkter som har en sku. Tom lista
 * betyder att det inte finns någon sida att länka till — då blir det ren text.
 * Frontenden gissar aldrig en egen /products/{namn}-URL.
 *
 * Backenden skriver fortfarande "/products/<sku>", den formen appen hade innan
 * den blev statisk. Sku plockas ur den och adressen byggs om till dagens rutt.
 * Det är ingen gissning — sku kommer från en länk backenden redan har verifierat
 * mot produktlistan. netlify.toml pekar om den gamla formen också, men det är
 * för länkar som kommer utifrån; internt slipper vi hoppet och de 404:or Next
 * annars får när den förhämtar en rutt som inte finns.
 */
const LEGACY_PRODUCT = /^\/products\/([^/?#]+)$/;

function resolveHref(l: InsightLink, month: string): string {
  const m = l.kind === "product" ? LEGACY_PRODUCT.exec(l.href) : null;
  if (m) {
    const q = new URLSearchParams({ sku: decodeURIComponent(m[1]), month });
    return `/products/detail?${q.toString()}`;
  }
  const sep = l.href.includes("?") ? "&" : "?";
  return `${l.href}${sep}month=${month}`;
}

function Links({ links, month }: { links: InsightLink[] | undefined; month: string }) {
  const list = links ?? [];
  if (list.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {list.map((l, i) => (
        <Link
          key={`${l.href}-${i}`}
          href={resolveHref(l, month)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--series)]/25 bg-[var(--series)]/10 px-2.5 py-1 text-[12px] font-medium text-[#4338ca] transition hover:bg-[var(--series)]/18"
        >
          {l.label}
          <span aria-hidden>→</span>
        </Link>
      ))}
    </div>
  );
}

export default function InsightsPage() {
  const { data, loading, error, refetch, month } = useData();

  if (error) return <ErrorState message={error} onRetry={refetch} />;

  if (loading || !data) {
    return (
      <div className="space-y-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass p-5">
            <Skeleton className="h-4 w-36" />
            <div className="mt-4 space-y-2.5">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-[88%]" />
              <Skeleton className="h-3.5 w-[72%]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const { ai, meta } = data;
  const src = meta.dataSources.find((d) => d.key === "ai_insights");

  return (
    <div className="space-y-5">
      <Section title="Sammanfattning" origin={src?.origin ?? "ai-generated"} note={src?.note}>
        <AiText value={ai.healthNarrative} />
      </Section>

      <Section title={`Rekommendationer (${ai.recommendations.length})`} origin="ai-generated" note="Prioriterade åtgärder från språkmodellen." delay={0.04}>
        {ai.recommendations.length === 0 ? (
          <EmptyState title="Inga rekommendationer genererade." />
        ) : (
          <ul className="space-y-3">
            {ai.recommendations.map((r, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="rounded-xl border border-white/60 bg-white/45 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[13.5px] font-semibold text-[var(--text-primary)]">{r.title}</h3>
                  <Level level={r.priority} />
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">{r.detail}</p>
                {r.product ? (
                  <p className="mt-2 text-[11.5px] text-[var(--text-muted)]">Gäller: {r.product}</p>
                ) : null}
                <Links links={r.links} month={month} />
              </motion.li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Risker (${ai.risks.length})`} origin="ai-generated" note="Identifierade av språkmodellen utifrån dina siffror." delay={0.08}>
        {ai.risks.length === 0 ? (
          <EmptyState title="Inga risker genererade." />
        ) : (
          <ul className="space-y-3">
            {ai.risks.map((r, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="rounded-xl border border-white/60 border-l-2 border-l-[var(--warn)] bg-white/45 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[13.5px] font-semibold text-[var(--text-primary)]">{r.title}</h3>
                  <Level level={r.severity} />
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">{r.detail}</p>
                <Links links={r.links} month={month} />
              </motion.li>
            ))}
          </ul>
        )}
      </Section>

      <GlassCard delay={0.12}>
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">Nästa steg</h2>
        {ai.nextActions.length === 0 ? (
          <div className="mt-4"><EmptyState title="Inga nästa steg genererade." /></div>
        ) : (
          <ol className="mt-4 space-y-2.5">
            {ai.nextActions.map((a, i) => (
              <li key={i} className="flex gap-3 text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
                <span className="mt-[2px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--series)]/12 text-[11px] font-semibold tabular-nums text-[#4338ca]">
                  {i + 1}
                </span>
                <span>{a}</span>
              </li>
            ))}
          </ol>
        )}
      </GlassCard>
    </div>
  );
}

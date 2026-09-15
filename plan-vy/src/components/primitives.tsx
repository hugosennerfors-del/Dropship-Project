"use client";

import { motion } from "framer-motion";
import { Tooltip } from "./Tooltip";
import { useData } from "./DataProvider";
import { originMeta, type Meta } from "@/lib/ui";
import type { Origin, SourceRef } from "@/lib/types";

/* ── Kort ─────────────────────────────────────────────────────────────── */

export function GlassCard({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`glass p-5 ${className}`}
    >
      {children}
    </motion.section>
  );
}

/** Namngiven sektion med valfri provenance-märkning i huvudet. */
export function Section({
  title,
  origin,
  note,
  actions,
  children,
  className = "",
  delay = 0,
}: {
  title: string;
  origin?: Origin | null;
  note?: string | null;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <GlassCard className={className} delay={delay}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
            {title}
          </h2>
          {origin ? <ProvenanceBadge origin={origin} note={note ?? undefined} /> : null}
        </div>
        {actions}
      </header>
      {children}
    </GlassCard>
  );
}

/* ── Provenance ───────────────────────────────────────────────────────── */

const ORIGIN_STYLE: Record<string, string> = {
  real: "bg-[#059669]/12 text-[#047857] border-[#059669]/25",
  computed: "bg-[#2a78d6]/12 text-[#1d5fb0] border-[#2a78d6]/25",
  ai: "bg-[#7c3aed]/12 text-[#6d28d9] border-[#7c3aed]/25",
  estimate: "bg-[#52606d]/10 text-[var(--text-secondary)] border-[#52606d]/22",
};

export function ProvenanceBadge({ origin, note }: { origin: Origin | string; note?: string }) {
  const m = originMeta(origin);
  const badge = (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${ORIGIN_STYLE[m.tone]}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {m.label}
    </span>
  );
  return note ? (
    <Tooltip content={<p>{note}</p>}>{badge}</Tooltip>
  ) : (
    badge
  );
}

/** Hittar rätt källa för en sektion och renderar dess badge. */
export function SectionProvenance({ sources, section }: { sources: SourceRef[]; section: string }) {
  const s = sources.find((x) => x.section === section);
  if (!s) return null;
  return <ProvenanceBadge origin={s.origin} note={s.note} />;
}

/* ── Pill ─────────────────────────────────────────────────────────────── */

const TONE: Record<Meta["tone"], string> = {
  pos: "bg-[#059669]/12 text-[#047857] border-[#059669]/28",
  neg: "bg-[#dc2626]/12 text-[#b91c1c] border-[#dc2626]/28",
  warn: "bg-[#d97706]/14 text-[#b45309] border-[#d97706]/30",
  neutral: "bg-[#52606d]/10 text-[var(--text-secondary)] border-[#52606d]/22",
  accent: "bg-[#4f46e5]/12 text-[#4338ca] border-[#4f46e5]/28",
};

export function Pill({
  meta,
  size = "md",
}: {
  meta: Meta;
  size?: "sm" | "md";
}) {
  const pill = (
    <span
      className={`inline-flex items-center rounded-full border font-semibold ${TONE[meta.tone]} ${
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[12px]"
      }`}
    >
      {meta.label}
    </span>
  );
  return meta.hint ? <Tooltip content={<p>{meta.hint}</p>}>{pill}</Tooltip> : pill;
}

/* ── Skelett ──────────────────────────────────────────────────────────── */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="glass p-5">
      <Skeleton className="h-3.5 w-28" />
      <Skeleton className="mt-4 h-8 w-40" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-3" />
        ))}
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="glass overflow-hidden p-5">
      <Skeleton className="h-3.5 w-36" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 flex-[3]" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Tomma lägen och fel ──────────────────────────────────────────────── */

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--hairline)] bg-white/30 px-5 py-8 text-center">
      <p className="text-[13.5px] font-medium text-[var(--text-secondary)]">{title}</p>
      {body ? <p className="mt-1.5 text-[12.5px] text-[var(--text-muted)]">{body}</p> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="glass border-l-2 border-l-[var(--neg)] p-5">
      <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
        Kunde inte hämta data
      </h2>
      <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg border border-[var(--hairline)] bg-white/60 px-3.5 py-1.5 text-[12.5px] font-medium text-[var(--text-primary)] transition hover:bg-white/85"
        >
          Försök igen
        </button>
      ) : null}
    </div>
  );
}

/**
 * Text som aldrig skriver ut "null" när AI-fältet saknas.
 *
 * Skiljer på två tomma lägen: "hämtas fortfarande" och "kom aldrig". Utan den
 * skillnaden ser en sida som laddar korrekt ut som en sida där AI:n misslyckats.
 */
export function AiText({ value, fallback = "Ingen analys genererad för den här perioden." }: {
  value: string | null | undefined;
  fallback?: string;
}) {
  const { aiLoading } = useData();

  if (!value || !value.trim()) {
    if (aiLoading) {
      return (
        <div>
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="mt-2 h-3.5 w-[82%]" />
          <p className="mt-2.5 text-[11.5px] text-[var(--text-muted)]">AI-analysen genereras…</p>
        </div>
      );
    }
    return <p className="text-[13px] italic text-[var(--text-muted)]">{fallback}</p>;
  }
  return <p className="text-[13.5px] leading-relaxed text-[var(--text-secondary)]">{value}</p>;
}

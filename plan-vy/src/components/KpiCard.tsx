"use client";

import { motion } from "framer-motion";
import { Term } from "./Term";
import { Skeleton } from "./primitives";
import type { TERMS } from "@/lib/ui";

type Tone = "auto" | "neutral";

export function KpiCard({
  label,
  value,
  sub,
  raw,
  term,
  tone = "neutral",
  delay = 0,
  accessory,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  /** Talet bakom `value`, används bara för att välja färg när tone="auto". */
  raw?: number | null;
  term?: keyof typeof TERMS;
  tone?: Tone;
  delay?: number;
  accessory?: React.ReactNode;
}) {
  const colored = tone === "auto" && typeof raw === "number" && Number.isFinite(raw);
  const color = colored
    ? raw! > 0
      ? "var(--pos-ink)"
      : raw! < 0
        ? "var(--neg-ink)"
        : "var(--text-primary)"
    : "var(--text-primary)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      className="glass flex min-w-0 flex-col p-4"
    >
      <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {term ? <Term k={term}>{label}</Term> : label}
      </p>
      <p
        className="mt-2.5 truncate text-[25px] font-semibold leading-none tabular-nums"
        style={{ color }}
        title={value}
      >
        {value}
      </p>
      {sub ? <div className="mt-2 text-[12px] text-[var(--text-muted)]">{sub}</div> : null}
      {accessory ? <div className="mt-3">{accessory}</div> : null}
    </motion.div>
  );
}

export function KpiSkeleton() {
  return (
    <div className="glass flex flex-col p-4">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-32" />
      <Skeleton className="mt-3 h-3 w-20" />
    </div>
  );
}

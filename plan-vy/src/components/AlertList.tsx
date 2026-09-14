"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { IconCritical, IconWarning } from "./icons";
import { EmptyState } from "./primitives";
import type { Alert, Product } from "@/lib/types";
import { productHref } from "@/lib/ui";

const STYLE = {
  critical: {
    border: "border-l-[var(--neg)]",
    text: "text-[#b91c1c]",
    label: "Kritisk",
    Icon: IconCritical,
  },
  warning: {
    border: "border-l-[var(--warn)]",
    text: "text-[var(--warn-ink)]",
    label: "Varning",
    Icon: IconWarning,
  },
} as const;

/**
 * En rad per larm. Ikon + ord + färg, aldrig färg ensam — annars försvinner
 * skillnaden mellan kritisk och varning för den som inte ser röd/orange.
 */
export function AlertRow({ alert, products, index = 0 }: { alert: Alert; products: Product[]; index?: number }) {
  const s = STYLE[alert.severity] ?? STYLE.warning;
  const match = alert.product ? products.find((p) => p.name === alert.product) : undefined;
  const href = match ? productHref(match) : null;

  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
      className={`flex items-start gap-3 rounded-xl border border-white/60 border-l-2 ${s.border} bg-white/45 px-4 py-3`}
    >
      <s.Icon className={`mt-0.5 shrink-0 ${s.text}`} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-relaxed text-[var(--text-primary)]">{alert.message}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[var(--text-muted)]">
          <span className={`font-semibold ${s.text}`}>{s.label}</span>
          <span aria-hidden>·</span>
          <span>{alert.type}</span>
          {href ? (
            <>
              <span aria-hidden>·</span>
              <Link href={href} className="font-medium text-[var(--series)] hover:underline">
                {alert.product}
              </Link>
            </>
          ) : alert.product ? (
            <>
              <span aria-hidden>·</span>
              <span>{alert.product}</span>
            </>
          ) : null}
        </p>
      </div>
    </motion.li>
  );
}

export function AlertList({ alerts, products }: { alerts: Alert[]; products: Product[] }) {
  if (!alerts.length) {
    return <EmptyState title="Inga larm den här perioden." body="Inga produkter under break-even, inga höga returgrader." />;
  }
  return (
    <ul className="space-y-2.5">
      {alerts.map((a, i) => (
        <AlertRow key={`${a.type}-${a.product ?? "portfolio"}-${i}`} alert={a} products={products} index={i} />
      ))}
    </ul>
  );
}

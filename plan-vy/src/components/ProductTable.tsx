"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PoasBar, Sparkline } from "./charts";
import { EmptyState, Pill } from "./primitives";
import { Term } from "./Term";
import { kr, num, pct, x } from "@/lib/format";
import { isLoser, isWinner, productHref, statusMeta, trendMeta } from "@/lib/ui";
import type { Product } from "@/lib/types";
import type { TERMS } from "@/lib/ui";

type Filter = "all" | "winners" | "losers";
type Dir = "asc" | "desc";

interface Col {
  key: string;
  label: string;
  term?: keyof typeof TERMS;
  align: "left" | "right";
  value: (p: Product) => number | string;
}

const COLS: Col[] = [
  { key: "name", label: "Produkt", align: "left", value: (p) => p.name.toLowerCase() },
  { key: "status", label: "Status", align: "left", value: (p) => p.financials.poas },
  { key: "orders", label: "Ordrar", align: "right", value: (p) => p.financials.orders },
  { key: "revenue", label: "Intäkt ex moms", align: "right", value: (p) => p.financials.revenueExVat },
  { key: "adSpend", label: "Annons", align: "right", value: (p) => p.financials.adSpend },
  { key: "poas", label: "POAS", term: "poas", align: "right", value: (p) => p.financials.poas },
  { key: "roas", label: "ROAS", term: "roas", align: "right", value: (p) => p.financials.roas },
  { key: "beRoas", label: "Break-even ROAS", term: "breakEvenRoas", align: "right", value: (p) => p.financials.breakEvenRoas ?? Number.POSITIVE_INFINITY },
  { key: "margin", label: "Marginal", term: "grossMargin", align: "right", value: (p) => p.financials.grossMargin },
  { key: "net", label: "Nettovinst", term: "netProfit", align: "right", value: (p) => p.financials.netProfit },
  { key: "score", label: "Opportunity", term: "opportunityScore", align: "right", value: (p) => p.opportunityScore },
];

export function ProductTable({ products, month }: { products: Product[]; month: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: string; dir: Dir }>({ key: "score", dir: "desc" });

  const rows = useMemo(() => {
    const filtered = products.filter((p) =>
      filter === "winners" ? isWinner(p) : filter === "losers" ? isLoser(p) : true,
    );
    const col = COLS.find((c) => c.key === sort.key) ?? COLS[0];
    return [...filtered].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      const cmp = typeof va === "string" || typeof vb === "string"
        ? String(va).localeCompare(String(vb), "sv")
        : (va as number) - (vb as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [products, filter, sort]);

  const toggle = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  const counts = {
    all: products.length,
    winners: products.filter(isWinner).length,
    losers: products.filter(isLoser).length,
  };

  return (
    <div>
      {/* Filter — en rad ovanför tabellen */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([
          ["all", "Alla"],
          ["winners", "Vinnare"],
          ["losers", "Förlorare"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={`rounded-lg border px-3 py-1.5 text-[12.5px] transition ${
              filter === key
                ? "border-[var(--series)]/35 bg-[var(--series)]/12 font-semibold text-[#4338ca]"
                : "border-white/70 bg-white/50 text-[var(--text-secondary)] hover:bg-white/80"
            }`}
          >
            {label} <span className="tabular-nums opacity-70">({counts[key]})</span>
          </button>
        ))}
        <p className="ml-auto text-[11.5px] text-[var(--text-muted)]">
          Vinnare = POAS ≥ 1,00
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={filter === "all" ? "Inga produkter den här perioden." : "Inga produkter matchar filtret."}
          body={filter === "all" ? "Välj en annan månad i periodväljaren." : undefined}
        />
      ) : (
        <>
        {/* Under md blir elva kolumner oläsbara även med sidled-scroll — där
            visas samma rader som kort i stället. */}
        <ul className="space-y-3 md:hidden">
          {rows.map((p) => {
            const f = p.financials;
            const href = productHref(p);
            const t = trendMeta(p.demand.trend);
            const head = (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-[var(--text-primary)]">{p.name}</p>
                  <p className="mt-1 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                    <Sparkline series={p.demand.series} width={56} height={18} />
                    {p.demand.monthsOfData > 1 ? <span>{t.arrow} {t.label}</span> : null}
                  </p>
                </div>
                <Pill meta={statusMeta(p.status)} size="sm" />
              </div>
            );
            return (
              <li key={p.sku ?? p.name} className="rounded-xl border border-white/60 bg-white/45 p-4">
                {href ? (
                  <Link href={`${href}?month=${month}`} className="block">{head}</Link>
                ) : (
                  <div title="Saknar SKU — ingen egen sida">{head}</div>
                )}
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--hairline)] pt-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-[11.5px] text-[var(--text-muted)]">POAS</dt>
                    <dd className="text-[12.5px] font-semibold tabular-nums" style={{ color: f.poas >= 1 ? "var(--pos-ink)" : "var(--neg-ink)" }}>{x(f.poas)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-[11.5px] text-[var(--text-muted)]">Nettovinst</dt>
                    <dd className="text-[12.5px] font-semibold tabular-nums" style={{ color: f.netProfit >= 0 ? "var(--pos-ink)" : "var(--neg-ink)" }}>{kr(f.netProfit)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-[11.5px] text-[var(--text-muted)]">Ordrar</dt>
                    <dd className="text-[12.5px] tabular-nums text-[var(--text-primary)]">{num(f.orders)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-[11.5px] text-[var(--text-muted)]">Marginal</dt>
                    <dd className="text-[12.5px] tabular-nums text-[var(--text-primary)]">{pct(f.grossMargin)}</dd>
                  </div>
                  <div className="col-span-2 flex items-baseline justify-between gap-2">
                    <dt className="text-[11.5px] text-[var(--text-muted)]">Opportunity</dt>
                    <dd className="text-[12.5px] tabular-nums text-[var(--text-primary)]">
                      <span className="font-semibold">{p.opportunityScore}</span>
                      <span className="ml-1.5 text-[11px] text-[var(--text-muted)]">{p.opportunityLabel}</span>
                    </dd>
                  </div>
                </dl>
                <div className="mt-3"><PoasBar poas={f.poas} compact /></div>
              </li>
            );
          })}
        </ul>

        <div className="-mx-1 hidden overflow-x-auto px-1 md:block">
          <table className="w-full min-w-[1040px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--hairline)]">
                {COLS.map((c) => {
                  const active = sort.key === c.key;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                      className={`whitespace-nowrap px-2.5 py-2.5 font-medium ${
                        c.align === "right" ? "text-right" : "text-left"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggle(c.key)}
                        className={`inline-flex items-center gap-1 text-[12px] transition hover:text-[var(--text-primary)] ${
                          active ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                        }`}
                      >
                        {c.term ? <Term k={c.term}>{c.label}</Term> : c.label}
                        <span aria-hidden className={active ? "opacity-100" : "opacity-0"}>
                          {sort.dir === "asc" ? "↑" : "↓"}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const f = p.financials;
                const href = productHref(p);
                const t = trendMeta(p.demand.trend);
                return (
                  <motion.tr
                    key={p.sku ?? p.name}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.25, delay: Math.min(i * 0.02, 0.3) }}
                    className="border-b border-[var(--hairline)] last:border-0 hover:bg-white/45"
                  >
                    <td className="max-w-[260px] px-2.5 py-3">
                      {href ? (
                        <Link
                          href={`${href}?month=${month}`}
                          className="block truncate font-medium text-[var(--text-primary)] hover:text-[var(--series)] hover:underline"
                        >
                          {p.name}
                        </Link>
                      ) : (
                        <span className="block truncate font-medium text-[var(--text-primary)]" title="Saknar SKU — ingen egen sida">
                          {p.name}
                        </span>
                      )}
                      <span className="mt-1 flex items-center gap-2">
                        <Sparkline series={p.demand.series} width={70} height={20} />
                        {p.demand.monthsOfData > 1 ? (
                          <span className="whitespace-nowrap text-[11px] text-[var(--text-muted)]">
                            {t.arrow} {t.label}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-2.5 py-3"><Pill meta={statusMeta(p.status)} size="sm" /></td>
                    <td className="px-2.5 py-3 text-right tabular-nums">{num(f.orders)}</td>
                    <td className="px-2.5 py-3 text-right tabular-nums">{kr(f.revenueExVat)}</td>
                    <td className="px-2.5 py-3 text-right tabular-nums">{kr(f.adSpend)}</td>
                    <td className="px-2.5 py-3 text-right">
                      <span
                        className="font-semibold tabular-nums"
                        style={{ color: f.poas >= 1 ? "var(--pos-ink)" : "var(--neg-ink)" }}
                      >
                        {x(f.poas)}
                      </span>
                      <span className="mt-1.5 block"><PoasBar poas={f.poas} compact /></span>
                    </td>
                    <td className="px-2.5 py-3 text-right tabular-nums">{x(f.roas)}</td>
                    <td className="px-2.5 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                      {f.breakEvenRoas == null ? "—" : x(f.breakEvenRoas)}
                    </td>
                    <td className="px-2.5 py-3 text-right tabular-nums">{pct(f.grossMargin)}</td>
                    <td
                      className="px-2.5 py-3 text-right font-semibold tabular-nums"
                      style={{ color: f.netProfit >= 0 ? "var(--pos-ink)" : "var(--neg-ink)" }}
                    >
                      {kr(f.netProfit)}
                    </td>
                    <td className="px-2.5 py-3 text-right">
                      <span className="font-semibold tabular-nums text-[var(--text-primary)]">{p.opportunityScore}</span>
                      <span className="block text-[11px] text-[var(--text-muted)]">{p.opportunityLabel}</span>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

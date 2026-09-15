"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { motion } from "framer-motion";
import { useData } from "./DataProvider";
import { monthLabel } from "@/lib/format";
import {
  IconAlerts,
  IconChevron,
  IconInsights,
  IconMenu,
  IconOverview,
  IconProducts,
  IconRefresh,
  IconResearch,
} from "./icons";

const NAV = [
  { href: "/", label: "Overview", Icon: IconOverview },
  { href: "/products", label: "Products", Icon: IconProducts },
  { href: "/research", label: "Research", Icon: IconResearch },
  { href: "/alerts", label: "Alerts", Icon: IconAlerts },
  { href: "/insights", label: "AI Insights", Icon: IconInsights },
] as const;

const CRUMB: Record<string, string> = {
  produkt: "Produkt",
  "": "Overview",
  products: "Products",
  research: "Research",
  alerts: "Alerts",
  insights: "AI Insights",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const { month, setMonth, loading, refetch, data } = useData();

  /** Alla interna länkar bär månaden vidare. */
  const withMonth = (href: string) => `${href}?month=${month}`;

  const segments = pathname.split("/").filter(Boolean);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <motion.aside
        animate={{ width: collapsed ? 68 : 232 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="sticky top-0 hidden h-screen shrink-0 flex-col border-r border-white/60 bg-white/60 backdrop-blur-[18px] md:flex"
        style={{ backdropFilter: "blur(18px) saturate(140%)" }}
      >
        <div className="flex h-16 items-center gap-2.5 px-4">
          <span aria-hidden className="h-7 w-[3px] shrink-0 rounded-full accent-rule" />
          {!collapsed ? (
            <span className="truncate text-[13.5px] font-semibold tracking-tight text-[var(--text-primary)]">
              Plan-vy Intelligence
            </span>
          ) : null}
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV.map(({ href, label, Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={withMonth(href)}
                aria-current={active ? "page" : undefined}
                title={collapsed ? label : undefined}
                className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition ${
                  active
                    ? "bg-white/75 font-semibold text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-white/45"
                }`}
              >
                {active ? (
                  <span
                    aria-hidden
                    className="absolute inset-y-1.5 left-0 w-[3px] rounded-full accent-rule"
                  />
                ) : null}
                <Icon className="shrink-0" />
                {!collapsed ? <span className="truncate">{label}</span> : null}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expandera sidomenyn" : "Fäll ihop sidomenyn"}
          className="m-3 flex items-center justify-center gap-2 rounded-xl border border-white/70 bg-white/50 py-2 text-[12px] text-[var(--text-secondary)] transition hover:bg-white/80"
        >
          <IconChevron
            className="transition-transform"
            style={{ transform: collapsed ? "none" : "rotate(180deg)" }}
          />
          {!collapsed ? <span>Fäll ihop</span> : null}
        </button>
      </motion.aside>

      {/* Huvudkolumn */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-white/60 bg-white/55 backdrop-blur-[18px]">
          <div className="flex h-16 items-center gap-4 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-label="Växla sidomeny"
              className="rounded-lg p-2 text-[var(--text-secondary)] transition hover:bg-white/60 md:hidden"
            >
              <IconMenu />
            </button>

            {/* Breadcrumbs */}
            <nav aria-label="Brödsmulor" className="min-w-0 flex-1">
              <ol className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[12.5px] text-[var(--text-muted)]">
                <li>
                  <Link href={withMonth("/")} className="hover:text-[var(--text-primary)]">
                    Plan-vy
                  </Link>
                </li>
                {segments.length === 0 ? (
                  <>
                    <li aria-hidden>/</li>
                    <li className="font-medium text-[var(--text-primary)]">Overview</li>
                  </>
                ) : (
                  segments.map((seg, i) => {
                    const last = i === segments.length - 1;
                    const href = `/${segments.slice(0, i + 1).join("/")}`;
                    const label = CRUMB[seg] ?? decodeURIComponent(seg);
                    return (
                      <li key={href} className="flex min-w-0 items-center gap-1.5">
                        <span aria-hidden>/</span>
                        {last ? (
                          <span className="truncate font-medium text-[var(--text-primary)]">{label}</span>
                        ) : (
                          <Link href={withMonth(href)} className="truncate hover:text-[var(--text-primary)]">
                            {label}
                          </Link>
                        )}
                      </li>
                    );
                  })
                )}
              </ol>
            </nav>

            {/* Månadsväljare */}
            <div className="flex items-center gap-2">
              <label htmlFor="month-picker" className="hidden text-[12.5px] text-[var(--text-muted)] sm:block">
                Period
              </label>
              <input
                id="month-picker"
                type="month"
                value={month}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
                className="rounded-lg border border-white/70 bg-white/60 px-2.5 py-1.5 text-[12.5px] text-[var(--text-primary)] transition hover:bg-white/85"
              />
              <button
                type="button"
                onClick={refetch}
                disabled={loading}
                aria-label="Hämta om"
                className="rounded-lg border border-white/70 bg-white/60 p-2 text-[var(--text-secondary)] transition hover:bg-white/85 disabled:opacity-40"
              >
                <IconRefresh className={loading ? "animate-spin" : undefined} />
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {/* Detaljsidor (t.ex. /produkt) sätter sin egen rubrik — annars
              skulle "Products" stå ovanför produktnamnet. */}
          {segments.length <= 1 && segments[0] !== "produkt" ? (
            <div className="mb-6">
              <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-primary)]">
                {CRUMB[segments[0] ?? ""] ?? "Plan-vy"}
              </h1>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                {monthLabel(data?.meta.period ?? month)}
                {data?.meta.currency ? ` · ${data.meta.currency} · intäkter ex moms` : null}
              </p>
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

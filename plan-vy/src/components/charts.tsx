"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { kr, monthShort, num } from "@/lib/format";
import type { DemandPoint } from "@/lib/types";

const SERIES = "#4f46e5";
const POS = "#059669";
const NEG = "#dc2626";
const MUTED = "#67727e";

/* ── Sparkline ────────────────────────────────────────────────────────────
 * Handritad SVG i stället för Recharts: den här renderas en gång per tabellrad
 * och behöver varken axlar, tooltip eller ResponsiveContainer.
 * ------------------------------------------------------------------------ */

export function Sparkline({
  series,
  width = 88,
  height = 26,
}: {
  series: DemandPoint[];
  width?: number;
  height?: number;
}) {
  const pts = series ?? [];

  if (pts.length === 0) {
    return <span className="text-[11px] text-[var(--text-muted)]">Ingen data</span>;
  }

  // En enda månad är ingen trend. Visa punkten och säg hur mycket data det är.
  if (pts.length === 1) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <svg width={14} height={height} aria-hidden>
          <circle cx={7} cy={height / 2} r={3} fill={SERIES} />
        </svg>
        <span className="whitespace-nowrap text-[11px] text-[var(--text-muted)]">1 mån data</span>
      </span>
    );
  }

  const values = pts.map((p) => p.orders);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const coords = values.map((v, i) => {
    const xx = pad + (i / (values.length - 1)) * w;
    const yy = pad + h - ((v - min) / span) * h;
    return [xx, yy] as const;
  });

  const d = coords.map(([xx, yy], i) => `${i === 0 ? "M" : "L"}${xx.toFixed(1)},${yy.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  const rising = values[values.length - 1] >= values[0];

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={`Ordrar per månad, ${pts.length} månader, senast ${values[values.length - 1]}`}
    >
      <path d={d} fill="none" stroke={SERIES} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={3} fill={rising ? POS : NEG} stroke="#fff" strokeWidth={1.5} />
    </svg>
  );
}

/* ── Efterfrågegraf ─────────────────────────────────────────────────────── */

function DemandTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: DemandPoint }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="glass px-3 py-2 text-[12px]">
      <p className="font-semibold text-[var(--text-primary)]">{monthShort(p.month)} {p.month.slice(0, 4)}</p>
      <dl className="mt-1.5 space-y-0.5 text-[var(--text-secondary)]">
        <div className="flex justify-between gap-6">
          <dt>Ordrar</dt>
          <dd className="font-medium tabular-nums text-[var(--text-primary)]">{num(p.orders)}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt>Enheter</dt>
          <dd className="tabular-nums">{num(p.units)}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt>Intäkt ex moms</dt>
          <dd className="tabular-nums">{kr(p.revenueExVat)}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Ordrar per månad.
 *
 * Bara EN serie på EN axel. Enheter och intäkt finns i tooltipen i stället för
 * på en andra y-axel — två skalor i samma ruta går inte att jämföra ärligt.
 */
export function DemandChart({ series, monthsOfData }: { series: DemandPoint[]; monthsOfData: number }) {
  if (!series?.length) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--hairline)] bg-white/30 px-5 py-10 text-center text-[13px] text-[var(--text-muted)]">
        Ingen efterfrågedata registrerad.
      </div>
    );
  }

  if (monthsOfData === 1) {
    const only = series[0];
    return (
      <div className="rounded-xl border border-[var(--hairline)] bg-white/40 px-5 py-6">
        <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          1 mån data
        </p>
        <p className="mt-2 text-[26px] font-semibold tabular-nums text-[var(--text-primary)]">
          {num(only.orders)} <span className="text-[14px] font-normal text-[var(--text-secondary)]">ordrar</span>
        </p>
        <p className="mt-1 text-[12.5px] text-[var(--text-secondary)]">
          {monthShort(only.month)} {only.month.slice(0, 4)} · {kr(only.revenueExVat)} ex moms
        </p>
        <p className="mt-3 border-t border-[var(--hairline)] pt-3 text-[12.5px] text-[var(--text-muted)]">
          En månad räcker inte för att avgöra en riktning. Ingen trend visas.
        </p>
      </div>
    );
  }

  const values = series.map((s) => s.orders);
  const max = Math.max(...values);
  // Recharts väljer annars krokiga ticks (0, 9, 18, 35). Lås i stället fyra
  // jämna steg och räkna ut taket därifrån, så axeln alltid går att läsa av.
  const { niceMax, ticks } = (() => {
    const target = Math.max(max * 1.15, 4);
    const rough = target / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((c) => c >= rough) ?? 10 * mag;
    const top = step * 4;
    return { niceMax: top, ticks: [0, step, step * 2, step * 3, top] };
  })();

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="rgba(31,41,51,0.07)" vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={monthShort}
            tickLine={false}
            axisLine={{ stroke: "rgba(31,41,51,0.12)" }}
            dy={4}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={40}
            domain={[0, niceMax]}
            ticks={ticks}
            tickFormatter={(v: number) => num(v)}
          />
          <RTooltip content={<DemandTooltip />} cursor={{ stroke: "rgba(31,41,51,0.18)", strokeWidth: 1 }} />
          <Line
            type="monotone"
            dataKey="orders"
            stroke={SERIES}
            strokeWidth={2}
            dot={{ r: 3, fill: SERIES, stroke: "#fff", strokeWidth: 1.5 }}
            activeDot={{ r: 5, fill: SERIES, stroke: "#fff", strokeWidth: 2 }}
            name="Ordrar"
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-2 text-center text-[11.5px] text-[var(--text-muted)]">
        Ordrar per månad · {monthsOfData} månader data
      </p>
    </div>
  );
}

/* ── POAS mot break-even ────────────────────────────────────────────────── */

/**
 * POAS som stapel med break-even-linjen fast på 1,00.
 * Skalan går till 2,0 så att linjen alltid hamnar på samma ställe och två
 * produkter går att jämföra visuellt.
 */
export function PoasBar({ poas, compact = false }: { poas: number; compact?: boolean }) {
  const MAXV = 2;
  const ok = poas >= 1;
  const width = Math.max(1.5, Math.min((poas / MAXV) * 100, 100));
  const breakEvenAt = (1 / MAXV) * 100;

  return (
    <div className={compact ? "w-full min-w-[96px]" : "w-full"}>
      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-[#52606d]/12"
        role="img"
        aria-label={`POAS ${poas.toFixed(2)}, break-even 1,00`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${width}%`, background: ok ? POS : NEG }}
        />
        <div
          className="absolute inset-y-[-2px] w-[2px] bg-[var(--neg)]"
          style={{ left: `${breakEvenAt}%` }}
          title="Break-even 1,00"
        />
      </div>
      {!compact ? (
        <div className="mt-1.5 flex justify-between text-[11px] text-[var(--text-muted)]">
          <span>0</span>
          <span className="font-medium text-[var(--neg-ink)]">break-even 1,00</span>
          <span>2,0+</span>
        </div>
      ) : null}
    </div>
  );
}

/* ── Score-mätare ───────────────────────────────────────────────────────── */

/**
 * 0–100-mätare med delkomponenter.
 *
 * Alla delstaplar har samma färg med flit: de mäter samma sak (ett delbetyg av
 * 100) och är direktmärkta med namn och tal. Tre olika kulörer skulle påstå att
 * de är olika kategorier, och den cyan/violett/rosa-trion går dessutom inte att
 * skilja åt vid rödblindhet (ΔE 0,9).
 */
export function ScoreMeter({
  score,
  label,
  breakdown,
  tone = "series",
}: {
  score: number;
  label?: string;
  breakdown?: { key: string; label: string; value: number }[];
  tone?: "series" | "status";
}) {
  const color = tone === "status" ? (score >= 55 ? POS : score >= 35 ? "#d97706" : NEG) : SERIES;

  return (
    <div>
      <div className="flex items-end gap-3">
        <span className="text-[38px] font-semibold leading-none tabular-nums text-[var(--text-primary)]">
          {Math.round(score)}
        </span>
        <span className="pb-1 text-[13px] text-[var(--text-muted)]">/ 100</span>
        {label ? (
          <span className="ml-auto pb-1 text-[13px] font-medium text-[var(--text-secondary)]">{label}</span>
        ) : null}
      </div>

      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[#52606d]/12">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${Math.max(0, Math.min(score, 100))}%`, background: color }}
        />
      </div>

      {breakdown?.length ? (
        <dl className="mt-5 space-y-3">
          {breakdown.map((b) => (
            <div key={b.key}>
              <div className="flex items-baseline justify-between">
                <dt className="text-[12.5px] text-[var(--text-secondary)]">{b.label}</dt>
                <dd className="text-[12.5px] font-semibold tabular-nums text-[var(--text-primary)]">
                  {Math.round(b.value)}
                </dd>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#52606d]/10">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(0, Math.min(b.value, 100))}%`, background: SERIES }}
                />
              </div>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

export { SERIES, POS, NEG, MUTED };

"use client";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { SERIES, CHART } from "@/lib/palette";
import { kr } from "@/lib/format";

export interface ProfitPoint {
  date: string;        // "2026-09-01"
  netRevenue: number;  // ex moms
  adSpend: number;
  netProfit: number;
}

/**
 * Vinst över tid. En axel, aldrig två — två y-skalor uppfinner ett samband
 * som inte finns i datan. Intäkt och annons står som staplar i samma skala,
 * nettovinsten som linje ovanpå, och nollinjen är utritad så förlustdagar syns.
 */
export function ProfitChart({ data }: { data: ProfitPoint[] }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <h3 className="text-[15px] font-semibold text-neutral-900">Vinst över tid</h3>
      <p className="mt-0.5 text-[12px] text-neutral-500">
        Intäkt ex moms mot annonskostnad. Linjen är nettovinst efter annons, frakt, avgifter och COGS.
      </p>
      <div className="mt-4 h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: CHART.ink2 }} tickLine={false} axisLine={{ stroke: CHART.grid }} />
            <YAxis tick={{ fontSize: 11, fill: CHART.ink2 }} tickLine={false} axisLine={false}
                   tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={44} />
            <Tooltip
              formatter={(v: number, n) => [kr(v), n]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${CHART.grid}` }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
            <ReferenceLine y={0} stroke={CHART.ink2} strokeWidth={1} />
            <Bar dataKey="netRevenue" name="Intäkt ex moms" fill={SERIES.s1} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="adSpend" name="Annonskostnad" fill={SERIES.s2} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Line dataKey="netProfit" name="Nettovinst" stroke={CHART.ink} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

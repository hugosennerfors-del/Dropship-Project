"use client";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Legend } from "recharts";
import { SERIES, CHART, STATUS } from "@/lib/palette";
import { x } from "@/lib/format";

export interface RoasPoint { date: string; roas: number; poas: number; }

/**
 * POAS ligger överst i legenden med avsikt: dess break-even är alltid 1,00,
 * utritad som en heldragen referenslinje. ROAS finns med för jämförelse mot
 * Meta, men break-even för ROAS är olika per produkt och går därför inte att
 * rita som en enda linje.
 */
export function RoasTrendChart({ data }: { data: RoasPoint[] }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <h3 className="text-[15px] font-semibold text-neutral-900">POAS- och ROAS-trend</h3>
      <p className="mt-0.5 text-[12px] text-neutral-500">
        Linjen vid 1,00 är break-even för POAS. Under den kostar varje order pengar.
      </p>
      <div className="mt-4 h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: CHART.ink2 }} tickLine={false} axisLine={{ stroke: CHART.grid }} />
            <YAxis tick={{ fontSize: 11, fill: CHART.ink2 }} tickLine={false} axisLine={false} width={40}
                   tickFormatter={(v) => v.toFixed(1).replace(".", ",")} />
            <Tooltip formatter={(v: number, n) => [x(v), n]}
                     contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${CHART.grid}` }} />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
            <ReferenceLine y={1} stroke={STATUS.critical} strokeWidth={1.5}
                           label={{ value: "break-even POAS", fontSize: 10.5, fill: STATUS.critical, position: "insideTopRight" }} />
            <Line dataKey="poas" name="POAS" stroke={SERIES.s1} strokeWidth={2} dot={false} />
            <Line dataKey="roas" name="ROAS" stroke={CHART.muted} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

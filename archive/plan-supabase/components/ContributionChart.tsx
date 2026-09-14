"use client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList, ResponsiveContainer } from "recharts";
import { SERIES, CHART, STATUS } from "@/lib/palette";
import { kr } from "@/lib/format";

export interface ContributionBar {
  name: string;
  contribution: number;   // bidrag per order före returer
  effective: number;      // efter returer
  cpa: number;
}

/**
 * Bidrag per order mot faktisk CPA, per produkt.
 * Är CPA-markören till höger om stapeln går produkten med förlust —
 * det är hela diagrammets syfte och syns utan att man läser en siffra.
 */
export function ContributionChart({ data }: { data: ContributionBar[] }) {
  const sorted = [...data].sort((a, b) => b.effective - a.effective);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <h3 className="text-[15px] font-semibold text-neutral-900">Bidrag per order mot CPA</h3>
      <p className="mt-0.5 text-[12px] text-neutral-500">
        Grön stapel är bidrag efter returer. Rött streck är vad du faktiskt betalar per order.
        Streck till höger om stapeln = förlust.
      </p>
      <div className="mt-4" style={{ height: Math.max(180, sorted.length * 44 + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={CHART.grid} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: CHART.ink2 }} tickLine={false}
                   axisLine={{ stroke: CHART.grid }} tickFormatter={(v) => kr(v)} />
            <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12, fill: CHART.ink }}
                   tickLine={false} axisLine={false} />
            <Tooltip formatter={(v: number, n) => [kr(v), n]}
                     contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${CHART.grid}` }} />
            <Bar dataKey="effective" name="Bidrag efter returer" radius={[0, 4, 4, 0]} maxBarSize={22}>
              {sorted.map((d, i) => (
                <Cell key={i} fill={d.effective > d.cpa ? SERIES.s3 : CHART.muted} />
              ))}
              <LabelList dataKey="effective" position="right" formatter={(v: number) => kr(v)}
                         style={{ fontSize: 11.5, fill: CHART.ink, fontWeight: 600 }} />
            </Bar>
            <Bar dataKey="cpa" name="CPA" maxBarSize={3} fill={STATUS.critical} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

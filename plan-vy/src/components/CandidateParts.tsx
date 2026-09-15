"use client";

import { kr, x } from "@/lib/format";
import type { SuccessResult } from "@/lib/success";

const SERIES = "#4f46e5";

export function AxisBar({ label, value, weight, note }: { label: string; value: number; weight: number; note: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-[12.5px] text-[var(--text-secondary)]">
          {label} <span className="text-[11px] text-[var(--text-muted)]">{Math.round(weight * 100)} %</span>
        </dt>
        <dd className="text-[12.5px] font-semibold tabular-nums text-[var(--text-primary)]">{Math.round(value)}</dd>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#52606d]/10">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(value, 100))}%`, background: SERIES }} />
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-muted)]">{note}</p>
    </div>
  );
}

export function StressTable({ result }: { result: SuccessResult }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-[var(--hairline)] text-[11.5px] text-[var(--text-muted)]">
            <th scope="col" className="py-1.5 text-left font-medium">Om CPA blir</th>
            <th scope="col" className="py-1.5 text-right font-medium">POAS</th>
            <th scope="col" className="py-1.5 text-right font-medium">Netto/order</th>
            <th scope="col" className="py-1.5 text-right font-medium">Bär sig</th>
          </tr>
        </thead>
        <tbody>
          {result.stress.map((s) => (
            <tr key={s.bump} className="border-b border-[var(--hairline)] last:border-0">
              <td className="py-2 text-[var(--text-secondary)]">
                {s.bump === 0 ? "som gissat" : `+${Math.round(s.bump * 100)} %`}
              </td>
              <td className="py-2 text-right font-semibold tabular-nums"
                  style={{ color: s.survives ? "var(--pos-ink)" : "var(--neg-ink)" }}>
                {x(s.poas)}
              </td>
              <td className="py-2 text-right tabular-nums"
                  style={{ color: s.netPerOrder >= 0 ? "var(--pos-ink)" : "var(--neg-ink)" }}>
                {kr(s.netPerOrder)}
              </td>
              <td className="py-2 text-right font-medium"
                  style={{ color: s.survives ? "var(--pos-ink)" : "var(--neg-ink)" }}>
                {s.survives ? "Ja" : "Nej"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { SERIES };

import { delta, pct } from "@/lib/format";

export interface KpiCardProps {
  label: string;
  value: string;
  /** Råvärden för periodjämförelse. Utelämna för att dölja deltat. */
  current?: number;
  previous?: number;
  /** true när ett lägre värde är bättre (annonskostnad, CPA). */
  lowerIsBetter?: boolean;
  hint?: string;
}

export function KpiCard({ label, value, current, previous, lowerIsBetter, hint }: KpiCardProps) {
  const d = current !== undefined && previous !== undefined ? delta(current, previous) : null;
  const good = d === null ? null : lowerIsBetter ? d < 0 : d > 0;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-neutral-500">{label}</span>
        {d !== null && (
          <span
            className={[
              "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
              good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
            ].join(" ")}
            title="Mot föregående period av samma längd"
          >
            {d > 0 ? "▲" : "▼"} {pct(Math.abs(d), 0)}
          </span>
        )}
      </div>
      <div className="mt-2 text-[28px] font-semibold tabular-nums tracking-tight text-neutral-900">
        {value}
      </div>
      {hint && <p className="mt-1.5 text-[11.5px] leading-snug text-neutral-500">{hint}</p>}
    </div>
  );
}

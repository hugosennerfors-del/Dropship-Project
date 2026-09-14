import type { StatusResult } from "@/lib/status";

/**
 * Status bärs av text OCH färg, aldrig färg ensam.
 * Färgblinda läsare och utskrifter måste kunna läsa tabellen.
 */
const STYLES: Record<StatusResult["color"], string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-rose-50 text-rose-800 ring-rose-200",
  grey: "bg-neutral-100 text-neutral-600 ring-neutral-200",
};
const ICONS: Record<StatusResult["color"], string> = {
  green: "▲", amber: "■", red: "▼", grey: "•",
};

export function StatusPill({ status }: { status: StatusResult }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-inset ${STYLES[status.color]}`}
      title={status.reason}
    >
      <span aria-hidden>{ICONS[status.color]}</span>
      {status.verdict}
    </span>
  );
}

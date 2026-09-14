const LOCALE = "sv-SE";

const sek = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "SEK",
  maximumFractionDigits: 0,
});
const sekPrecise = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "SEK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const int = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Kronor, ex moms. Visar "—" för saknat värde i stället för "NaN kr". */
export const kr = (v: number | null | undefined): string => (isNum(v) ? sek.format(v) : "—");

export const krExact = (v: number | null | undefined): string =>
  isNum(v) ? sekPrecise.format(v) : "—";

export const num = (v: number | null | undefined): string => (isNum(v) ? int.format(v) : "—");

/** Andel 0–1 som procent. pct(0.32) -> "32,0 %" */
export const pct = (v: number | null | undefined, digits = 1): string =>
  isNum(v)
    ? new Intl.NumberFormat(LOCALE, {
        style: "percent",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(v)
    : "—";

/** Multiplar: POAS/ROAS. x(1.42) -> "1,42×" */
export const x = (v: number | null | undefined, digits = 2): string =>
  isNum(v)
    ? `${new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(v)}×`
    : "—";

/** Signerad procentförändring. delta(0.34) -> "+34,0 %" */
export const delta = (v: number | null | undefined, digits = 1): string => {
  if (!isNum(v)) return "—";
  const s = new Intl.NumberFormat(LOCALE, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: "exceptZero",
  }).format(v);
  return s;
};

/** "2026-09" -> "september 2026". Faller tillbaka på indata om den inte går att tolka. */
export const monthLabel = (m: string | null | undefined): string => {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return m ?? "—";
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mm - 1, 1));
  return new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
};

/** "2026-09" -> "sep" för axlar där det är ont om plats. */
export const monthShort = (m: string | null | undefined): string => {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return m ?? "";
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mm - 1, 1));
  return new Intl.DateTimeFormat(LOCALE, { month: "short", timeZone: "UTC" }).format(d).replace(".", "");
};

export const dateLabel = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" }).format(d);
};

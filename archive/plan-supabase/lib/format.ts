export const kr = (n: number, d = 0) =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: d }).format(n);
export const pct = (n: number, d = 1) =>
  new Intl.NumberFormat("sv-SE", { style: "percent", maximumFractionDigits: d }).format(n);
export const num = (n: number, d = 0) =>
  new Intl.NumberFormat("sv-SE", { maximumFractionDigits: d }).format(n);
export const x = (n: number) =>
  Number.isFinite(n) ? `${n.toFixed(2).replace(".", ",")}×` : "—";
export const delta = (curr: number, prev: number) =>
  prev === 0 ? null : (curr - prev) / Math.abs(prev);

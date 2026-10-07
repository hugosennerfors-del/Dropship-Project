// The query engine. Discovery, the Radar, the niche finder and the chat all
// go through here, so a filter typed in the chat and a filter clicked in
// Discovery return exactly the same products.
//
// query(rows, { filters, sort, limit, within, budgetGBP })
//   filters  [{ field, op, value }]   op: > >= < <= = != contains in between
//   sort     { field, dir } or a preset name from SORTS
//   within   restrict to these product ids (follow-up questions)

import { FIELD } from "./fields.js";

const TEXT_FIELDS = ["name", "category", "subcategory", "niche", "microNiche", "targetCustomer", "overview"];

function matchOne(row, f) {
  const key = f.field;
  if (key === "text") {
    const needle = String(f.value || "").toLowerCase();
    return TEXT_FIELDS.some((k) => String(row[k] || "").toLowerCase().includes(needle));
  }
  const x = row[key];
  const y = f.value;
  if (x == null) return false;
  switch (f.op) {
    case ">": return Number(x) > Number(y);
    case ">=": return Number(x) >= Number(y);
    case "<": return Number(x) < Number(y);
    case "<=": return Number(x) <= Number(y);
    case "=": case "==": return typeof x === "string" ? x.toLowerCase() === String(y).toLowerCase() : Number(x) === Number(y);
    case "!=": return typeof x === "string" ? x.toLowerCase() !== String(y).toLowerCase() : Number(x) !== Number(y);
    case "contains": return (Array.isArray(x) ? x.join(" ") : String(x)).toLowerCase().includes(String(y).toLowerCase());
    case "in": return (Array.isArray(y) ? y : [y]).map((s) => String(s).toLowerCase()).includes(String(x).toLowerCase());
    case "between": return Number(x) >= Number(y[0]) && Number(x) <= Number(y[1]);
    default: return false;
  }
}

// Money filters are written in the market's currency.
const startupGBP = (r) => (r.startupCost == null ? null : r.startupCost * (r.currency === "SEK" ? 0.078 : 1));

export const SORTS = {
  "opportunity": { label: "Highest opportunity", field: "opportunity", dir: "desc" },
  "evidence": { label: "Opportunity × evidence", field: "evidenceWeighted", dir: "desc" },
  "margin": { label: "Highest margin", field: "margin", dir: "desc" },
  "profit": { label: "Highest profit", field: "profitGBP", dir: "desc" },
  "growing": { label: "Fastest growing", field: "trendAcceleration", dir: "desc" },
  "competition": { label: "Lowest competition", field: "competition", dir: "asc" },
  "demand": { label: "Highest demand", field: "demand", dir: "desc" },
  "viral": { label: "Most viral", field: "viral", dir: "desc" },
  "brand": { label: "Best brand potential", field: "brandability", dir: "desc" },
  "safest": { label: "Lowest risk", field: "risk", dir: "asc" },
  "beginners": { label: "Best for beginners", score: (r) => 0.4 * (r.ease ?? 50) + 0.3 * (100 - (r.risk ?? 50)) + 0.3 * (r.opportunity ?? 0), dir: "desc",
    note: "40 % ease of launch, 30 % low risk, 30 % opportunity." },
  "budget1000": { label: "Best for £1,000 budget", budgetGBP: 1000, dir: "desc",
    note: "Launch cost plus a £300 ad test must fit in £1,000; ranked by evidence-weighted opportunity." },
  "confidence": { label: "Best evidence", field: "confidence", dir: "desc" },
};

export const AD_TEST_GBP = 300;

export function query(rows, spec = {}) {
  let out = rows;
  if (spec.within && spec.within.length) {
    const set = new Set(spec.within);
    out = out.filter((r) => set.has(r.id));
  }
  for (const f of spec.filters || []) out = out.filter((r) => matchOne(r, f));

  let sort = spec.sort;
  if (typeof sort === "string") sort = SORTS[sort] || { field: sort, dir: (FIELD[sort]?.better === "low" ? "asc" : "desc") };
  const budget = spec.budgetGBP ?? sort?.budgetGBP;
  if (budget) out = out.filter((r) => startupGBP(r) != null && startupGBP(r) + AD_TEST_GBP <= budget);

  if (sort) {
    const dir = sort.dir === "asc" ? 1 : -1;
    const key = sort.score || ((r) => r[sort.field ?? "evidenceWeighted"]);
    const keyFn = sort.budgetGBP ? (r) => r.evidenceWeighted : key;
    out = [...out].sort((a, b) => {
      const x = keyFn(a), y = keyFn(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return dir * (x - y) || (b.opportunity ?? 0) - (a.opportunity ?? 0);
    });
  }
  const total = out.length;
  if (spec.limit) out = out.slice(0, spec.limit);
  return { rows: out, total };
}

export function describe(spec) {
  const parts = (spec.filters || []).map((f) => {
    const label = f.field === "text" ? "matches" : FIELD[f.field]?.label || f.field;
    const val = Array.isArray(f.value) ? f.value.join("–") : f.value;
    return f.field === "text" ? `“${val}”` : `${label} ${f.op} ${val}`;
  });
  const sort = typeof spec.sort === "string" ? SORTS[spec.sort]?.label || spec.sort : spec.sort ? `${FIELD[spec.sort.field]?.label || spec.sort.field} ${spec.sort.dir}` : null;
  return { filters: parts, sort, budget: spec.budgetGBP || (typeof spec.sort === "string" && SORTS[spec.sort]?.budgetGBP) || null };
}

// Group rows into niches for the niche finder.
export function niches(rows, by = "niche") {
  const groups = new Map();
  for (const r of rows) {
    const k = r[by] || "Unassigned";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const avg = (xs, k) => {
    const ys = xs.map((x) => x[k]).filter((y) => typeof y === "number");
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
  };
  return [...groups.entries()].map(([name, xs]) => {
    const best = [...xs].sort((a, b) => b.evidenceWeighted - a.evidenceWeighted)[0];
    return {
      name, category: xs[0].category, count: xs.length, products: xs.map((x) => x.id), best: best.id,
      margin: avg(xs, "margin"), demand: avg(xs, "demand"), competition: avg(xs, "competition"),
      trend: avg(xs, "trend"), acceleration: avg(xs, "trendAcceleration"), brandability: avg(xs, "brandability"),
      marketing: avg(xs, "adPotential"), opportunity: avg(xs, "opportunity"), confidence: avg(xs, "confidence"),
      risk: avg(xs, "risk"),
      // Demand relative to competition: high when people want it and few sell it.
      gap: avg(xs, "demand") != null && avg(xs, "competition") != null ? avg(xs, "demand") - avg(xs, "competition") : null,
    };
  }).sort((a, b) => b.opportunity - a.opportunity);
}

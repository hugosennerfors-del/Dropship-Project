// Hand-drawn SVG charts. Every mark, tick and label uses one scale per axis.

import { esc, attr, money, isNum } from "./dom.js";

const STAGE_VAR = {
  "Emerging": "--st-emerging", "Early Growth": "--st-early", "Growing": "--st-growing",
  "Peak": "--st-peak", "Declining": "--st-declining", "Saturated": "--st-saturated",
};
export const stageColor = (s) => `var(${STAGE_VAR[s] || "--st-saturated"})`;

const short = (name, n = 22) => {
  const s = String(name || "").split(/[:(,]/)[0].trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
};

// Demand (y) against competition (x); bubble size = opportunity.
export function opportunityMap(rows, opts = {}) {
  const W = 640, H = 380, L = 44, R = 16, T = 16, B = 40;
  const x = (c) => L + (c / 100) * (W - L - R);
  const y = (d) => T + (1 - d / 100) * (H - T - B);
  const ticks = [0, 25, 50, 75, 100];
  const pts = rows.filter((r) => isNum(r.competition) && isNum(r.demand));
  const labelled = new Set([...pts].sort((a, b) => b.opportunity - a.opportunity).slice(0, opts.labels ?? 6).map((r) => r.id));
  const placed = [];
  const labels = [];
  for (const r of [...pts].sort((a, b) => b.opportunity - a.opportunity)) {
    if (!labelled.has(r.id)) continue;
    let lx = x(r.competition) + 9, ly = y(r.demand) + 4;
    const text = short(r.name);
    const w = text.length * 6;
    let anchor = "start";
    if (lx + w > W - R) { lx = x(r.competition) - 9; anchor = "end"; }
    for (let i = 0; i < 6 && placed.some((p) => Math.abs(p.y - ly) < 13 && Math.abs(p.x - lx) < w); i++) ly += 13;
    placed.push({ x: lx, y: ly });
    labels.push(`<text class="lbl" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}">${esc(text)}</text>`);
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Opportunity map: demand against competition for ${pts.length} products">
    <rect x="${L}" y="${T}" width="${x(50) - L}" height="${y(50) - T}" fill="var(--good-soft)" opacity=".7"/>
    <text x="${L + 8}" y="${T + 16}" style="fill:var(--good);font-family:var(--font-sans);font-size:11px;font-weight:500">High demand, low competition</text>
    <g class="grid">${ticks.map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H - B}"/><line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>`).join("")}</g>
    <g>${ticks.map((t) => `<text x="${x(t)}" y="${H - B + 16}" text-anchor="middle">${t}</text><text x="${L - 8}" y="${y(t) + 3.5}" text-anchor="end">${t}</text>`).join("")}</g>
    <text class="lbl" x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">Competition →</text>
    <text class="lbl" transform="translate(12 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Demand →</text>
    ${sweep(x(50), y(50), L, T, W - L - R, H - T - B)}
    ${pts.map((r) => {
      const rad = 3.5 + Math.max(0, r.opportunity - 15) / 6;
      return `<a href="#/p/${attr(r.id)}" aria-label="${attr(`${r.name}: demand ${r.demand}, competition ${r.competition}, opportunity ${r.opportunity}`)}"><circle class="dot" cx="${x(r.competition).toFixed(1)}" cy="${y(r.demand).toFixed(1)}" r="${rad.toFixed(1)}" fill="${stageColor(r.stage)}" fill-opacity=".8" stroke="#fff" stroke-width="1.5" data-tip="${attr(`${r.name} · opportunity ${r.opportunity} · demand ${r.demand} · competition ${r.competition} · ${r.stage}`)}"/></a>`;
    }).join("")}
    ${labels.join("")}
  </svg>`;
}

// A radar beam turning around the middle of the map (only drawn while
// effects are on; it never takes a click).
function sweep(cx, cy, px, py, pw, ph) {
  const r = Math.hypot(pw, ph) / 2 + 8;
  const at = (deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
  const wedge = (a, b, o) => { const [x1, y1] = at(a), [x2, y2] = at(b); return `<path d="M${cx} ${cy}L${x1.toFixed(1)} ${y1.toFixed(1)}A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}Z" fill="#818cf8" fill-opacity="${o}"/>`; };
  const [bx, by] = at(0);
  return `<clipPath id="oppClip"><rect x="${px}" y="${py}" width="${pw}" height="${ph}"/></clipPath>
    <g clip-path="url(#oppClip)" aria-hidden="true"><g class="fx-sweep" style="transform-origin:${cx}px ${cy}px">${wedge(-40, -22, 0.05)}${wedge(-22, -9, 0.09)}${wedge(-9, 0, 0.16)}
      <line x1="${cx}" y1="${cy}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="#4f46e5" stroke-opacity=".45" stroke-width="1.5"/></g></g>`;
}

export function stageLegend(stages) {
  return `<div class="legend">${stages.map((s) => `<span class="stage"><i style="background:${stageColor(s)}"></i>${esc(s)}</span>`).join("")}</div>`;
}

// Cumulative profit after the launch cost, 0–500 orders, one line per scenario.
export function profitCurve(series, currency, opts = {}) {
  const W = 640, H = 260, L = 64, R = 18, T = 14, B = 34;
  const maxN = opts.maxOrders || 500;
  const vals = series.flatMap((s) => [-s.startup, s.profit * maxN - s.startup]);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (hi - lo < 1) hi = lo + 1;
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const x = (n) => L + (n / maxN) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const yt = niceTicks(lo, hi, 5);
  const xt = [0, 100, 200, 300, 400, 500].filter((n) => n <= maxN);
  const fmt = (v) => money(v, currency, { digits: 0 });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative profit after launch cost for up to ${maxN} orders">
    <g class="grid">${yt.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`).join("")}</g>
    <line x1="${L}" x2="${W - R}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="var(--fg-3)" stroke-width="1"/>
    <g>${yt.map((t) => `<text x="${L - 8}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${esc(fmt(t))}</text>`).join("")}</g>
    <g>${xt.map((n) => `<text x="${x(n).toFixed(1)}" y="${H - B + 16}" text-anchor="middle">${n}</text>`).join("")}</g>
    <text class="lbl" x="${W - R}" y="${H - 4}" text-anchor="end">Orders</text>
    ${series.map((s) => {
      const y0 = y(-s.startup), y1 = y(s.profit * maxN - s.startup);
      const be = s.profit > 0 ? s.startup / s.profit : null;
      return `<path d="M${x(0)} ${y0.toFixed(1)}L${x(maxN)} ${y1.toFixed(1)}" fill="none" stroke="${s.color}" stroke-width="${s.main ? 2.2 : 1.4}" ${s.main ? 'class="draw" pathLength="1"' : 'class="fade" stroke-dasharray="4 3"'}/>
        ${be != null && be <= maxN ? `<circle cx="${x(be).toFixed(1)}" cy="${y(0).toFixed(1)}" r="${s.main ? 4 : 3}" fill="${s.color}" stroke="#fff" stroke-width="1.5" class="fade"><title>${esc(s.label)}: break-even after ${Math.ceil(be)} orders</title></circle>` : ""}
        <text x="${(x(maxN) - 4).toFixed(1)}" y="${(y1 + (y1 < T + 10 ? 12 : -6)).toFixed(1)}" text-anchor="end" style="fill:${s.color};font-family:var(--font-sans);font-size:11px;font-weight:500">${esc(s.label)}</text>`;
    }).join("")}
  </svg>`;
}

export function niceTicks(lo, hi, n = 5) {
  const span = hi - lo;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
  const out = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}

// Stacked bar: how many products sit in each stage.
export function stageBar(counts, total) {
  return `<div class="mix" style="height:10px" role="img" aria-label="${attr(Object.entries(counts).map(([s, n]) => `${s} ${n}`).join(", "))}">${Object.entries(counts).filter(([, n]) => n).map(([s, n]) => `<i style="width:${(n / total) * 100}%;background:${stageColor(s)}" data-tip="${attr(`${s}: ${n}`)}"></i>`).join("")}</div>`;
}

// Small horizontal bar for a 0–100 value with a marker, used in lists.
export function hbar(value, max = 100, tone = "var(--fg-2)") {
  const w = isNum(value) ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return `<span class="meter wide"><i style="width:${w}%;background:${tone}"></i></span>`;
}

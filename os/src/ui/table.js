// The product table used by Discover, niches and chat results.

import { esc, attr, money, pct, int, scoreChip, stageChip, meter, icon, glyph } from "./dom.js";
import { store } from "../state.js";

export const COLUMNS = {
  opportunity: { label: "Opportunity", r: true, cell: (r) => scoreChip(r.opportunity), sort: "opportunity" },
  evidenceWeighted: { label: "Evidence-wtd", r: true, cell: (r) => `<span class="metric">${int(r.evidenceWeighted)}</span>`, sort: "evidenceWeighted" },
  confidence: { label: "Confidence", r: true, cell: (r) => `<span class="row nowrap" style="justify-content:flex-end;gap:6px">${meter(r.confidence, { label: "Confidence", tone: r.confidence >= 55 ? "good" : r.confidence >= 35 ? "mid" : "low" })}<span class="metric">${int(r.confidence)}</span></span>`, sort: "confidence" },
  stage: { label: "Stage", cell: (r) => stageChip(r.stage), sort: "stage" },
  price: { label: "Price", r: true, cell: (r) => `<span class="metric">${money(r.price, r.currency)}</span>`, sort: "price" },
  margin: { label: "Margin", r: true, cell: (r) => `<span class="metric">${pct(r.margin, 0)}</span>`, sort: "margin" },
  profit: { label: "Profit/order", r: true, cell: (r) => `<span class="metric ${r.profit > 0 ? "pos-n" : "neg-n"}">${money(r.profit, r.currency)}</span>`, sort: "profitGBP", tip: "After returns and estimated CAC" },
  demand: { label: "Demand", r: true, cell: (r) => `<span class="metric">${int(r.demand)}</span>`, sort: "demand" },
  trend: { label: "Trend", r: true, cell: (r) => `<span class="metric">${int(r.trend)}</span>`, sort: "trend" },
  growth: { label: "Accel.", r: true, cell: (r) => `<span class="metric">${r.trendAcceleration > 0 ? "+" : ""}${int(r.trendAcceleration)}%</span>`, sort: "trendAcceleration" },
  competition: { label: "Competition", r: true, cell: (r) => `<span class="metric">${int(r.competition)}</span>`, sort: "competition", asc: true },
  brandability: { label: "Brand", r: true, cell: (r) => `<span class="metric">${int(r.brandability)}</span>`, sort: "brandability" },
  risk: { label: "Risk", r: true, cell: (r) => `<span class="metric">${int(r.risk)}</span>`, sort: "risk", asc: true },
  startup: { label: "Launch cost", r: true, cell: (r) => `<span class="metric">${money(r.startupCost, r.currency, { digits: 0 })}</span>`, sort: "startupCost", asc: true },
  validation: { label: "Proof", cell: (r) => `<span class="grade grade-${String(r.validation).toLowerCase()}" title="Commercial evidence: ${attr(r.validation)}"><b>${esc(r.validation)}</b></span>`, sort: "validation" },
};

export function productTable(rows, opts = {}) {
  const cols = opts.columns || ["opportunity", "stage", "price", "margin", "profit", "demand", "competition", "risk", "confidence"];
  const sortKey = opts.sortKey, dir = opts.sortDir;
  if (!rows.length) return `<div class="empty">${icon("search", 20)}<span>${esc(opts.empty || "No products match.")}</span></div>`;
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr>
      ${opts.rank ? '<th style="width:28px">#</th>' : ""}
      <th>Product</th>
      ${cols.map((c) => {
        const col = COLUMNS[c];
        const s = sortKey === col.sort ? ` aria-sort="${dir === "asc" ? "ascending" : "descending"}"` : "";
        return `<th class="${col.r ? "r" : ""}${["demand", "trend", "growth", "brandability", "validation", "startup", "risk", "confidence"].includes(c) ? " hide-sm" : ""}"${s}${col.tip ? ` title="${attr(col.tip)}"` : ""}>${opts.sortable ? `<button data-sort="${col.sort}" data-asc="${col.asc ? 1 : 0}">${esc(col.label)}${sortKey === col.sort ? (dir === "asc" ? " ↑" : " ↓") : ""}</button>` : esc(col.label)}</th>`;
      }).join("")}
      ${opts.compare ? '<th class="r" style="width:40px"><span class="sr">Compare</span></th>' : ""}
    </tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="click" data-go="#/p/${attr(r.id)}">
      ${opts.rank ? `<td class="metric muted">${i + 1}</td>` : ""}
      <td><div class="pname"><a href="#/p/${attr(r.id)}">${esc(r.name)}</a><small>${esc(r.niche || r.category || "")}${r.source === "agent" ? " · AI profile" : ""}${r._s?.cac === "V" ? " · your store" : ""}</small></div></td>
      ${cols.map((c) => `<td class="${COLUMNS[c].r ? "r" : ""}${["demand", "trend", "growth", "brandability", "validation", "startup", "risk", "confidence"].includes(c) ? " hide-sm" : ""}">${COLUMNS[c].cell(r)}</td>`).join("")}
      ${opts.compare ? `<td class="r"><button class="btn sm ghost${store.compare.includes(r.id) ? " on" : ""}" data-compare="${attr(r.id)}" aria-pressed="${store.compare.includes(r.id)}" title="${store.compare.includes(r.id) ? "Remove from comparison" : "Add to comparison"}">${icon(store.compare.includes(r.id) ? "check" : "plus", 14)}</button></td>` : ""}
    </tr>`).join("")}</tbody>
  </table></div>`;
}

// Compact list item linking to a product.
export function productItem(r, i, metric) {
  return `<a class="li" href="#/p/${attr(r.id)}">
    ${i != null ? `<span class="rank">${i + 1}</span>` : ""}
    <span class="body"><b>${esc(r.name)}</b><small>${esc(r.niche || "")} · ${esc(r.stage)}</small></span>
    <span class="side">${metric ? `<span class="metric">${metric}</span>` : ""}${scoreChip(r.opportunity)}</span>
  </a>`;
}

export { glyph };

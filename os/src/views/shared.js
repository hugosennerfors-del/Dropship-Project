// Pieces several views share.

import { store, rows, product } from "../state.js";
import { esc, attr, glyph, icon } from "../ui/dom.js";
import { STATUS } from "../core/provenance.js";

export function plink(id, label) {
  const p = product(id);
  const name = label || p?.core?.name?.v || id;
  if (!p) return esc(name);
  return `<a class="plink" href="#/p/${attr(id)}">${esc(shortName(name))}</a>`;
}
export const shortName = (n, max = 48) => {
  const s = String(n || "");
  const cut = s.split(/:\s/)[0];
  return cut.length > max ? cut.slice(0, max - 1).trimEnd() + "…" : cut;
};

export function provenanceLegend() {
  return `<div class="legend" aria-label="Data status legend">${["V", "E", "A", "N"].map((s) => `<span class="spill">${glyph(s)}${esc(STATUS[s].label)}</span>`).join("")}</div>`;
}

export function aiUnavailableNote() {
  if (store.sampleState === "ready") return "";
  const why = store.sampleState === "declined" ? "Claude was declined for this page in this visit."
    : store.sampleState === "connecting" ? "Connecting to Claude…" : "Claude is not available in this view (open the page on claude.ai to use the agents).";
  return `<div class="callout">${icon("info", 16)}<span>${esc(why)} Everything else works from the database.</span></div>`;
}

export function idsToNames(ids) {
  return ids.map((id) => product(id)?.core?.name?.v || id);
}

export function marketRowsCount(code) {
  return rows(code).length;
}

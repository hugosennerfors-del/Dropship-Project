// The store finder. The n8n workflow "Plan-vy · Dropshipping-butiker" runs
// three Brave searches for small online stores selling a product (leaving
// out marketplaces, big chains and the brands the research names), reads
// each store's public Shopify files (shop info, product search, the matched
// product and its shipping policy) and saves the stores that look like
// dropshipping in intel.product_links, with the reasons. Started from the
// product page; uses three Brave searches on n8n's gateway credits.

import { refreshLinks } from "./state.js";
import { runWorkflow, mcpReady, MCP_FIX } from "./live.js";

export const DROPSHIP_FINDER = { workflowId: "ix9qjSql5xiqexHT", trigger: "API: dropship-butiker", nodes: ["Svar"] };

export const finderAvailable = () => mcpReady();

// Resolves with { found, checked, searched, saved } or rejects with
// { code, message } (code "still_running" carries the executionId).
export async function findDropshipStores({ productId, market, query, exclude = [], executionId, onWait }) {
  const q = String(query || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (q.length < 3) throw { code: "bad_input", message: "Write at least three letters to search for." };
  if (!mcpReady()) throw { code: "not_connected", message: MCP_FIX.not_connected || "The store finder needs the n8n connector." };
  const { runData } = await runWorkflow({
    ...DROPSHIP_FINDER,
    body: { productId, market: market === "SE" ? "SE" : "UK", query: q, exclude: exclude.slice(0, 20) },
    deadlineMs: 150000, executionId, onWait,
  });
  const out = runData.Svar?.[0]?.data?.main?.[0]?.[0]?.json;
  if (!out?.ok) throw { code: "tool_error", message: "The store finder stopped before it could save anything." };
  await refreshLinks();
  const checked = Array.isArray(out.checked) ? out.checked : [];
  return {
    found: Number(out.found) || 0,
    searched: Number(out.searched) || 0,
    checked: checked.length,
    shopify: checked.filter((c) => c.shopify).length,
    selling: checked.filter((c) => c.match).length,
    blocked: Number(out.blocked) || 0,
    degraded: !!out.degraded,
    saved: out.saved || {},
    errors: Array.isArray(out.errors) ? out.errors : [],
  };
}

// One sentence for the page after a run.
export function finderReport(r) {
  if (r.errors?.length && !r.searched) return `The search failed: ${r.errors[0]}`;
  if (!r.checked) return `The searches returned ${r.searched} results, but none was a small store selling it.`;
  const base = `Checked ${r.checked} store${r.checked === 1 ? "" : "s"} from ${r.searched} search results: ${r.shopify} run on Shopify and ${r.selling} sell it.`;
  // Shopify's bot protection answered some checks with a challenge page.
  const blocked = r.blocked ? ` Shopify blocked ${r.blocked} of the checks (too many requests)${r.degraded ? ", so earlier finds were kept; try again in a few minutes" : ""}.` : "";
  const retired = r.saved?.retired ? ` ${r.saved.retired} earlier find${r.saved.retired === 1 ? " no longer qualifies and was" : "s no longer qualify and were"} taken off the list.` : "";
  if (!r.found) return `${base} None looks like dropshipping${r.degraded ? " among the stores it could check" : ": they deliver fast from their own stock or are big retailers"}.${retired}${blocked}`;
  return `${base} ${r.found} look${r.found === 1 ? "s" : ""} like dropshipping.${retired}${blocked}`;
}

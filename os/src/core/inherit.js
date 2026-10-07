// Market inheritance: a market block can say `inherit: "UK"` and override
// only what differs. Carried-over values are downgraded honestly:
//
//   - verified or evidence-based values become AI estimates for the new
//     market, because evidence about the UK says nothing certain about Sweden;
//   - money is converted at the configured exchange rate and marked as an
//     AI estimate;
//   - market facts that cannot travel (leaders, competitor counts, market
//     size, review data, regulation notes, own sales data) are not copied.

import { MARKETS } from "./markets.js";
import { FIELD } from "./fields.js";
import { val, none, isVal } from "./provenance.js";

// Not carried over. Keys listed in NO_DATA become "Insufficient data" when
// the child does not set them; the others are simply left out.
const LOCAL_ONLY = new Set([
  "marketLeaders", "weakCompetitors", "competitorCount", "marketSize", "searchDemand",
  "reviewSentiment", "customerComplaints", "regulatoryNotes", "evidence",
  "cac", "variableCost",
]);
const NO_DATA = ["marketSize", "searchDemand", "reviewSentiment"];
// Money fields authored per market (others are derived by economics.js).
const MONEY = new Set(["price", "upsellValue", "competitorPriceMin", "competitorPriceMax", "fixedLaunchCost"]);

export function resolveMarket(product, code, seen = new Set()) {
  const mk = product.markets?.[code];
  if (!mk) return null;
  if (!mk.inherit) return { ...mk, _inherited: [] };
  if (seen.has(code)) throw new Error(`${product.id}: inheritance cycle at ${code}`);
  seen.add(code);
  const parentCode = mk.inherit;
  const parent = resolveMarket(product, parentCode, seen);
  if (!parent) throw new Error(`${product.id}: ${code} inherits from missing market ${parentCode}`);
  const from = MARKETS[parentCode], to = MARKETS[code];
  const rate = from.fxToGBP / to.fxToGBP;
  const label = from.code;

  const out = {};
  const inherited = [];
  for (const [k, x] of Object.entries(parent)) {
    if (k.startsWith("_") || k === "inherit" || LOCAL_ONLY.has(k) || k in mk) continue;
    if (!isVal(x)) continue;
    inherited.push(k);
    if (x.s === "N") { out[k] = x; continue; }
    if (MONEY.has(k) && typeof x.v === "number") {
      out[k] = val(roundMoney(x.v * rate, to.currency), "A", null,
        `Converted from the ${label} value (${x.v} ${from.currency}) at the configured exchange rate; not checked for this market.`);
      continue;
    }
    out[k] = val(x.v, "A", null, x.s === "A"
      ? (x.note ? `${x.note} (carried over from the ${label} analysis)` : `Carried over from the ${label} analysis.`)
      : `Carried over from the ${label} analysis, where it was ${x.s === "V" ? "verified" : "estimated from evidence"}; not checked for this market.`);
  }
  for (const k of NO_DATA) if (!(k in mk)) out[k] = none(`No ${to.name} data in the database.`);
  for (const [k, x] of Object.entries(mk)) if (k !== "inherit") out[k] = x;

  // An unknown return rate keeps the parent's figure as the assumption.
  if (isVal(out.returnRate) && out.returnRate.s === "N" && isVal(parent.returnRate) && parent.returnRate.v != null)
    out.returnRateAssumed = val(parent.returnRate.v, "A", null, `Assumed from the ${label} analysis.`);

  out._inherited = inherited.filter((k) => !(k in mk));
  out._inheritFrom = parentCode;
  return out;
}

export function resolveProduct(product) {
  const markets = {};
  for (const code of Object.keys(product.markets || {})) {
    if (!MARKETS[code]) continue;
    markets[code] = resolveMarket(product, code);
  }
  return { ...product, markets };
}

function roundMoney(x, currency) {
  if (currency === "SEK") return x >= 100 ? Math.round(x / 10) * 10 - 1 : Math.round(x);
  return Math.round(x * 100) / 100;
}

export { FIELD };

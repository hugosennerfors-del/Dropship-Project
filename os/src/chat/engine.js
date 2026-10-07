// The research chat. Claude answers with page tools that query the real
// database; without Claude the page answers from the same queries with
// templated text. Follow-up context (the last list, the product in focus)
// is kept by the page and sent with every turn.

import { store, rows as rowsOf, product, row } from "../state.js";
import { query, SORTS, niches } from "../core/query.js";
import { parseQuestion } from "../core/nlq.js";
import { schemaForAI } from "../core/fields.js";
import { MARKETS } from "../core/markets.js";
import { computeEconomics, scenario, profitAt, breakEvenRevenue, targetRoas } from "../core/economics.js";
import { withOverrides } from "../core/markets.js";
import * as C from "./compose.js";

export const session = {
  turns: [],          // [{role, content}] sent to Claude
  messages: [],       // what the page shows
  lastResultIds: [],
  focusIds: [],
};

const whyOf = (id, market = store.market) => product(id)?.built?.[market]?.why || null;
const scoresOf = (id, market = store.market) => product(id)?.built?.[market]?.scored?._detail || null;

const COMPACT = ["id", "name", "niche", "stage", "opportunity", "evidenceWeighted", "confidence", "risk", "price", "landedCost", "margin",
  "profit", "profitGBP", "netMargin", "cac", "demand", "trend", "trendAcceleration", "competition", "saturation", "brandability",
  "viral", "tiktok", "meta", "repeat", "giftability", "startupCost", "breakEvenOrders", "validation", "interest", "currency"];
const compact = (r) => {
  const o = {};
  for (const k of COMPACT) if (r[k] != null) o[k] = typeof r[k] === "number" ? Math.round(r[k] * 100) / 100 : r[k];
  if (r.redFlags?.length) o.redFlags = r.redFlags;
  const ai = Object.entries(r._s || {}).filter(([k, s]) => s === "A" && COMPACT.includes(k)).map(([k]) => k);
  if (ai.length) o.aiEstimated = ai;
  const v = Object.entries(r._s || {}).filter(([k, s]) => s === "V").map(([k]) => k);
  if (v.length) o.verified = v;
  return o;
};

function rulesTurn(market) {
  const rs = rowsOf(market);
  const index = rs.map((r) => `${r.id} | ${r.name} | ${r.niche} | ${r.stage} | opp ${r.opportunity} | conf ${r.confidence}`).join("\n");
  return [
    "You are the research analyst inside Plan-vy Intelligence, an e-commerce research tool focused on the UK, with Sweden as the alternative market.",
    "You answer questions about the product database in this page. You can only see it through the tools provided: query_products, get_product, compare_products, unit_economics and niche_overview. Always call a tool before stating any number, and never invent products, numbers or sources.",
    "",
    "How the data works:",
    "- Every value has a status: V verified (own sales data or a primary source), E estimated from cited evidence, A AI estimate (a model's judgement), N insufficient data. When a conclusion rests on AI estimates, say so briefly.",
    "- Scores are 0–100. For competition, saturation, risk and every *Risk field, higher is worse.",
    "- Opportunity is a weighted score (margin 12, profit 12, demand 16, trend 12, competition 14, marketing 12, brandability 8, growth 6, repeat 4, ease 4) with interaction bonuses/penalties, a risk adjustment of up to −30 % and caps for deal-breakers. evidenceWeighted scales it by data confidence.",
    "- Profit per order is after returns and an estimated CAC. CAC is modelled from price and calibrated on the user's own Swedish campaigns, so it is uncertain.",
    "- Money is in the market's currency incl. VAT for consumer prices (GBP for UK, SEK for Sweden).",
    "- Trending (search, social, media) is not the same as proven demand (sales, revenue, reviews). Keep them apart.",
    "",
    "How to answer:",
    "- Mention products as [[product-id]] (the page turns these into links). Use the ids from tool results.",
    "- Explain the reasoning with the data points that drive it (margin, profit per order, demand, competition, stage, risk, confidence). Prefer short paragraphs and lists.",
    "- When you list products, number them; the user will refer back to them as 'number 3'. The page sends the previous list with each message.",
    "- If no product matches, say which condition is the bottleneck and show the closest matches.",
    "- Answer in the language the user writes in (Swedish or English).",
    `- The current market is ${MARKETS[market].name} (${market}). Use it unless the user asks for the other market.`,
    "",
    "Queryable fields (key, type, meaning):",
    schemaForAI(),
    "",
    `Products in the database for ${market} (id | name | niche | stage | opportunity | confidence):`,
    index,
  ].join("\n");
}

function contextNote(market) {
  const parts = [`market ${market}`];
  if (session.lastResultIds.length) parts.push("previous list: " + session.lastResultIds.map((id, i) => `${i + 1}. ${id}`).join(", "));
  if (session.focusIds.length) parts.push("product in focus: " + session.focusIds.join(", "));
  return `\n\n[Page context: ${parts.join("; ")}]`;
}

function tools(market, trace) {
  const mk = (m) => (m && MARKETS[String(m).toUpperCase()] ? String(m).toUpperCase() : market);
  return [
    {
      name: "query_products",
      description: "Filter and rank products in the database. Returns {total, applied, rows} with up to `limit` compact rows. Use it for any question about which products match conditions, and for rankings.",
      inputSchema: {
        type: "object",
        properties: {
          filters: { type: "array", items: { type: "object", properties: {
            field: { type: "string", description: "A queryable field key, or 'text' to search names and niches." },
            op: { type: "string", enum: [">", ">=", "<", "<=", "=", "!=", "contains", "in", "between"] },
            value: { description: "Number, string, array for 'in', [min, max] for 'between'. Money in the market currency." },
          }, required: ["field", "op", "value"] } },
          sort: { type: "string", description: `A preset (${Object.keys(SORTS).join(", ")}) or a field key.` },
          limit: { type: "number", description: "Default 10, max 15." },
          within: { type: "array", items: { type: "string" }, description: "Restrict to these product ids (follow-ups)." },
          budget_gbp: { type: "number", description: "Keep products whose launch cost plus a £300 ad test fits this budget." },
          market: { type: "string", enum: ["UK", "SE"] },
        },
      },
      execute: (input) => {
        const m = mk(input.market);
        const spec = {
          filters: Array.isArray(input.filters) ? input.filters.map((f) => ({ field: String(f.field), op: String(f.op), value: f.value })) : [],
          sort: input.sort ? String(input.sort) : "opportunity",
          limit: Math.min(15, Number(input.limit) || 10),
          within: Array.isArray(input.within) ? input.within.map(String) : null,
          budgetGBP: input.budget_gbp ? Number(input.budget_gbp) : null,
        };
        const all = rowsOf(m);
        const res = query(all, spec);
        const applied = spec.filters.map((f) => C.filterLabel(f, m));
        trace({ kind: "query", market: m, applied, sort: SORTS[spec.sort]?.label || spec.sort, total: res.total, ids: res.rows.map((r) => r.id), budget: spec.budgetGBP });
        const out = { market: m, total: res.total, applied, sort: SORTS[spec.sort]?.label || spec.sort, rows: res.rows.map(compact) };
        if (!res.total && spec.filters.length) {
          const nm = C.nearMisses(spec.within ? all.filter((r) => spec.within.includes(r.id)) : all, spec, 5);
          out.bottleneck = nm.blockers.slice(0, 3).map((b) => ({ condition: C.filterLabel(b.f, m), excludes: b.excluded, of: all.length }));
          out.closest = nm.closest.map((x) => ({ ...compact(x.r), misses: x.fails.map((f) => C.filterLabel(f, m)) }));
        }
        return out;
      },
    },
    {
      name: "get_product",
      description: "Full analysis of one product in one market: all fields with statuses, score breakdown, reasons it could work or fail, risk factors, red flags, validation and evidence. Use for 'tell me about', 'why', 'is it safe'.",
      inputSchema: { type: "object", properties: { id: { type: "string" }, market: { type: "string", enum: ["UK", "SE"] } }, required: ["id"] },
      execute: (input) => {
        const m = mk(input.market);
        const id = String(input.id);
        const r = row(id, m);
        if (!r) throw new Error(`No product ${id} in ${m}. Products in ${m}: ${rowsOf(m).map((x) => x.id).join(", ")}`);
        const d = scoresOf(id, m), why = whyOf(id, m);
        trace({ kind: "product", market: m, id });
        const p = product(id);
        const ev = (p.built[m].evidenceIds || []).map((e) => store.evidenceIndex[e]).filter(Boolean).slice(0, 8)
          .map((e) => ({ level: e.level, kind: e.kind, market: e.market, claim: e.claim.slice(0, 220), source: e.source?.publisher }));
        const fields = {};
        for (const [k, x] of Object.entries(r)) if (!k.startsWith("_") && x != null && x !== "") fields[k] = x;
        return {
          fields, statuses: r._s,
          score: { opportunity: r.opportunity, components: d.components.map((c) => ({ key: c.key, value: c.value, weight: c.weight, points: c.points })),
            interactions: d.interactions, riskFactor: d.riskFactor, caps: d.caps },
          why: { positives: why.positives.slice(0, 5), negatives: why.negatives.slice(0, 5) },
          risk: { score: d.riskDetail.score, top: d.riskDetail.factors.slice(0, 5).map((f) => ({ factor: f.label, value: f.value })) },
          redFlags: d.redFlags, validation: { commercial: d.validation.commercial.grade, interest: d.validation.interest.grade, notes: d.validation.notes },
          stageWhy: d.stage.why, evidence: ev,
        };
      },
    },
    {
      name: "compare_products",
      description: "Side-by-side metrics and score components for 2–5 products in one market. Returns one compact row plus components per product.",
      inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } }, market: { type: "string", enum: ["UK", "SE"] } }, required: ["ids"] },
      execute: (input) => {
        const m = mk(input.market);
        const ids = (Array.isArray(input.ids) ? input.ids : []).map(String).slice(0, 5);
        trace({ kind: "compare", market: m, ids });
        return ids.map((id) => {
          const r = row(id, m);
          if (!r) return { id, error: `not in ${m}` };
          const d = scoresOf(id, m);
          return { ...compact(r), components: Object.fromEntries(d.components.map((c) => [c.key, c.value])), topRisks: d.riskDetail.factors.slice(0, 3).map((f) => f.label) };
        });
      },
    },
    {
      name: "unit_economics",
      description: "Unit economics for one product: price, costs, margin, contribution after returns, CAC, profit per order, ROAS, break-even, launch cost, profit at 10/50/100/500 orders, and best/base/worst scenarios. Optional overrides (price, supplierPrice, shipping, cac, returnRate…) recompute everything.",
      inputSchema: { type: "object", properties: { id: { type: "string" }, market: { type: "string", enum: ["UK", "SE"] },
        overrides: { type: "object", description: "Plain numbers in the market currency, e.g. {price: 34.99, cac: 12}." } }, required: ["id"] },
      execute: (input) => {
        const m = mk(input.market);
        const id = String(input.id);
        const p = product(id);
        const b = p?.built?.[m];
        if (!b) throw new Error(`No product ${id} in ${m}`);
        const cfg = withOverrides(m, store.settings?.markets?.[m]);
        const over = input.overrides && typeof input.overrides === "object" ? input.overrides : {};
        const e = computeEconomics(p.core, b.mk, cfg, over);
        trace({ kind: "economics", market: m, id, overrides: Object.keys(over) });
        const pick = (x) => (x && typeof x === "object" && "v" in x ? { value: x.v, status: x.s } : x);
        const out = {};
        for (const k of ["price", "revenueEx", "supplierPrice", "inbound", "dutyRate", "landedCost", "shipping", "packaging", "paymentFees", "variableCost",
          "grossProfit", "margin", "returnRate", "contribution", "cac", "profit", "netMargin", "maxCac", "roas", "breakEvenRoas", "startupCost", "breakEvenOrders", "clv"]) out[k] = pick(e[k]);
        out.currency = cfg.currency;
        out.profitAtOrders = Object.fromEntries([10, 50, 100, 500].map((n) => [n, profitAt(e, n)]));
        out.breakEvenRevenue = breakEvenRevenue(e);
        out.targetRoasFor10pctNet = targetRoas(e, 10);
        out.scenarios = ["best", "base", "worst"].map((k) => {
          const s = scenario(p.core, b.mk, cfg, k, e);
          return { scenario: s.label, assumptions: s.story, profitPerOrder: s.economics.profit.v, netMargin: s.economics.netMargin.v, profitAt100: s.profit100 };
        });
        return out;
      },
    },
    {
      name: "niche_overview",
      description: "Niches (or categories) aggregated from the products: count, average opportunity, demand, competition, demand–competition gap, best product.",
      inputSchema: { type: "object", properties: { by: { type: "string", enum: ["niche", "category", "subcategory"] }, market: { type: "string", enum: ["UK", "SE"] } } },
      execute: (input) => {
        const m = mk(input.market);
        const by = ["niche", "category", "subcategory"].includes(input.by) ? input.by : "niche";
        trace({ kind: "niches", market: m, by });
        return niches(rowsOf(m), by).map((n) => ({ name: n.name, products: n.products, best: n.best, count: n.count,
          opportunity: r1(n.opportunity), demand: r1(n.demand), competition: r1(n.competition), gap: r1(n.gap), margin: r1(n.margin), confidence: r1(n.confidence) }));
      },
    },
  ];
}
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// Deterministic answer from the parser and the composer.
export function localAnswer(text, market) {
  const rs = rowsOf(market);
  const p = parseQuestion(text, { market, rows: rs, lastResultIds: session.lastResultIds });
  const m = p.market || market;
  const mrows = rowsOf(m);
  const ctx = { market: m, whyOf: (id) => whyOf(id, m), scoresOf: (id) => scoresOf(id, m) };
  const spec = { filters: p.filters, sort: p.sort || "opportunity", limit: p.limit, within: p.within, budgetGBP: p.budgetGBP };
  const trace = [];
  let ans;
  switch (p.intent) {
    case "help": ans = { text: C.HELP, ids: [] }; break;
    case "why": {
      const ids = p.refIds.length >= 2 ? p.refIds : p.productIds;
      const [a, b] = ids.slice(0, 2).map((id) => mrows.find((r) => r.id === id));
      ans = a && b ? C.answerWhy(a, b, ctx) : { text: "I need two products from the last list to compare, for example *why is number 3 better than number 1?*", ids: [] };
      break;
    }
    case "compare": {
      const ids = (p.refIds.length ? p.refIds : p.productIds.length ? p.productIds : session.lastResultIds.slice(0, 2));
      const [a, b] = ids.slice(0, 2).map((id) => mrows.find((r) => r.id === id));
      ans = a && b ? C.answerWhy(a, b, ctx) : C.answerQuery(mrows, spec, ctx);
      break;
    }
    case "economics": {
      const ids = p.refIds.length ? p.refIds : p.productIds.length ? p.productIds : session.focusIds.length ? session.focusIds : session.lastResultIds.slice(0, 3);
      const sel = ids.map((id) => mrows.find((r) => r.id === id)).filter(Boolean);
      ans = sel.length ? C.answerEconomics(sel, ctx) : { text: "Which product? Ask for a list first, or name the product.", ids: [] };
      break;
    }
    case "pick": ans = C.answerPick(mrows, spec, ctx); break;
    case "budget": ans = C.answerBudget(mrows, spec, ctx); break;
    case "product": {
      const id = p.refIds[0] || p.productIds[0];
      const r = mrows.find((x) => x.id === id);
      ans = r ? C.answerProduct(r, ctx) : C.answerQuery(mrows, spec, ctx);
      break;
    }
    default: ans = C.answerQuery(mrows, spec, ctx);
  }
  if (["query", "pick", "budget"].includes(p.intent)) {
    trace.push({ kind: "query", market: m, applied: (p.filters || []).map((f) => C.filterLabel(f, m)).concat(p.budgetGBP ? [`launch budget £${p.budgetGBP}`] : []),
      sort: SORTS[spec.sort]?.label || spec.sort, total: ans.total ?? ans.ids.length, ids: ans.ids, within: !!p.within });
  }
  return { ...ans, parsed: p, market: m, trace };
}

// Ask. Streams through onText when Claude answers; resolves with
// {text, ids, trace, mode}.
export async function ask(text, { market, onText, onTrace, signal }) {
  const trace = [];
  const push = (t) => { trace.push(t); onTrace?.(trace.slice()); };
  const userTurn = { role: "user", content: text + contextNote(market) };

  if (store.sample && store.sampleState === "ready") {
    const history = session.turns.slice(-12);
    const input = [{ role: "user", content: rulesTurn(market) }, ...history, userTurn];
    try {
      let res;
      if (store.tools) {
        res = await store.sample(input, { tools: tools(market, push), onText, signal });
      } else {
        // No page tools in this view: answer from a deterministic query and
        // let Claude write the explanation from those rows.
        const local = localAnswer(text, market);
        local.trace.forEach(push);
        const data = local.ids.map((id) => row(id, local.market)).filter(Boolean).map(compact);
        res = await store.sample([...input.slice(0, -1), { role: "user", content: `${userTurn.content}\n\n[The page ran this query for you: ${JSON.stringify(local.trace)}. Rows: ${JSON.stringify(data).slice(0, 20000)}]` }],
          { onText, signal, cache: false });
      }
      session.turns.push(userTurn, { role: "assistant", content: res.text });
      const ids = idsIn(res.text);
      const lastQuery = [...trace].reverse().find((t) => t.kind === "query");
      remember(ids.length >= 2 ? ids : lastQuery?.ids || ids);
      return { text: res.text, ids, trace, mode: "claude", truncated: res.truncated };
    } catch (e) {
      if (e?.code === "cancelled") throw e;
      if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(e?.code)) {
        store.sampleState = e.code === "not_granted" ? "declined" : "unavailable";
      }
      if (e?.code === "tools_unavailable") store.tools = false;
      const local = localAnswer(text, market);
      remember(local.ids);
      session.turns.push(userTurn, { role: "assistant", content: local.text });
      return { text: local.text, ids: local.ids, trace: local.trace, mode: "local", error: e?.code || "upstream_error", partial: e?.text };
    }
  }
  const local = localAnswer(text, market);
  remember(local.ids);
  session.turns.push(userTurn, { role: "assistant", content: local.text });
  return { text: local.text, ids: local.ids, trace: local.trace, mode: "local" };
}

function remember(ids) {
  if (ids && ids.length) session.lastResultIds = ids.slice(0, 15);
}
export function idsIn(text) {
  const seen = [];
  for (const m of String(text).matchAll(/\[\[([a-z0-9-]+)\]\]/g)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}
export function resetChat() {
  session.turns = []; session.messages = []; session.lastResultIds = []; session.focusIds = [];
}

export const ERROR_COPY = {
  not_granted: "Claude is switched off for this page, so I answered from the database directly.",
  sampling_disabled: "Claude is not available on this account, so I answered from the database directly.",
  rate_limited: "Claude is busy or your usage limit is reached. I answered from the database directly; try again later for a written analysis.",
  session_expired: "Your Claude session expired. Sign in again for written analyses; this answer comes from the database directly.",
  prompt_too_large: "The conversation got too long for Claude. Start a new chat; this answer comes from the database directly.",
  refused: "Claude declined this question. This answer comes from the database directly.",
  upstream_error: "Claude could not be reached. This answer comes from the database directly.",
};

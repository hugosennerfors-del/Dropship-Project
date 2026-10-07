// New research from a search field. The n8n workflow "Plan-vy ·
// Research-generator (API)" asks a language model for five product ideas in
// a niche and market, with costing and an ad plan, and saves them in Supabase
// (public.product_candidates). They land in the research inbox as AI
// estimates; "Analyse" turns one into a full, scored profile.
//
// One run at a time. It keeps going while you switch views, and the state
// lives in store.research so every view can show it.

import { store, changed, addCandidates } from "./state.js";
import { runWorkflow, mcpReady, MCP_FIX } from "./live.js";
import { fromGenerator, ideasFrom, toCountry } from "./core/candidates.js";
import { MARKETS } from "./core/markets.js";

export const RESEARCH = {
  workflowId: "jD6A7tOD1L8bdUd8",
  trigger: "API: generera research",
  // The insert node returns the saved rows with their ids; the split node
  // before it is the fallback if the insert's output ever changes.
  nodes: ["Spara i product_candidates", "Dela upp kandidater"],
};

const idle = () => ({ state: "idle", topic: "", market: "", startedAt: 0, finishedAt: 0, executionId: null, ids: [], error: "", fix: "" });

export const researchAvailable = () => mcpReady();
export const researchRunning = () => store.research.state === "running";

// Starts a run and returns at once: {ok} or {ok: false, reason}.
export function startResearch(topic, market = store.market) {
  const t = String(topic || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (t.length < 2) return { ok: false, reason: "Write a niche or product to research first." };
  if (researchRunning()) return { ok: false, reason: `Research on “${store.research.topic}” is still running.` };
  if (!mcpReady()) return { ok: false, reason: "New research needs the n8n connector. Open the page on claude.ai and allow n8n when it asks." };
  const m = MARKETS[market] ? market : store.market;
  store.research = { ...idle(), state: "running", topic: t, market: m, startedAt: Date.now() };
  changed("research");
  run(t, m, null, 150000);
  return { ok: true };
}

// n8n was still working when the page stopped waiting: wait again.
export function checkAgain() {
  const r = store.research;
  if (r.state !== "slow" || !r.executionId) return;
  store.research = { ...r, state: "running" };
  changed("research");
  run(r.topic, r.market, r.executionId, 60000);
}

export function clearResearch() {
  if (researchRunning()) return;
  store.research = idle();
  changed("research");
}

async function run(topic, market, executionId, deadlineMs) {
  const country = toCountry(market);
  const date = new Date().toISOString().slice(0, 10);
  try {
    const { executionId: id, runData } = await runWorkflow({
      workflowId: RESEARCH.workflowId, trigger: RESEARCH.trigger, nodes: RESEARCH.nodes, executionId, deadlineMs,
      body: { niche: topic, country, researchDate: date, trendSource: "search", trendNote: "Searched in Plan-vy Intelligence" },
      onWait: (s, id) => { store.research.executionId = id; },
    });
    const found = ideasFrom(runData, RESEARCH.nodes);
    if (!found.length) throw { code: "tool_error", message: "The research run finished without any ideas." };
    const fresh = found.map((j, i) => fromGenerator(j, { executionId: id, index: i, country, niche: topic, date, trendSource: "search" }));
    addCandidates(fresh);
    store.research = { ...store.research, state: "done", executionId: id, ids: fresh.map((c) => c.id), finishedAt: Date.now() };
    changed("research");
    if (!location.hash.startsWith("#/research")) window.__toast?.(`Research done: ${fresh.length} new ideas for “${topic}”. They are under New research.`);
  } catch (e) {
    if (e?.code === "still_running") store.research = { ...store.research, state: "slow", executionId: e.executionId };
    else store.research = {
      ...store.research, state: "error",
      error: e?.code === "tool_error" && e.message ? e.message : "The research run did not go through.",
      fix: MCP_FIX[e?.code] || "Try again in a moment. If n8n got as far as saving, the ideas are in Supabase: reload the list below.",
    };
    changed("research");
  }
}

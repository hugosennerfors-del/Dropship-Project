// The live database: Supabase (schema intel), reached through the n8n
// workflow "Plan-vy · Intelligence-DB" with the viewer's n8n connector.
//
// Reads return what changed since the page's embedded snapshot, plus your
// edits, agent runs, settings and store sales. Writes go through
// intel.api_write, which validates every action and never overwrites a
// research analysis. When n8n cannot be reached the page keeps working
// from its snapshot and saves edits in the page's own storage.

export const LIVE = {
  server: "n8n",
  workflowId: "ZzrznUz8OFIAr4ve",
  trigger: "API: intelligence-db",
  nodes: ["Svar", "Fel"],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mcpRef = null;

export async function liveAvailable(claude) {
  try {
    mcpRef = claude && claude.use ? await claude.use("mcp") : null;
  } catch { mcpRef = null; }
  return !!mcpRef;
}

async function tool(name, input, retry) {
  try {
    return await mcpRef.callTool(LIVE.server, name, input, { cache: false });
  } catch (e) {
    // Only reads are retried, once; a started execution is never restarted.
    if (retry && e && e.retryable === true) {
      await sleep(Math.min(e.retryAfterMs || 1500, 6000) + Math.random() * 300);
      return await mcpRef.callTool(LIVE.server, name, input, { cache: false });
    }
    throw e;
  }
}

export const mcpReady = () => !!mcpRef;

const RUNNING = ["running", "new", "waiting"];

// Start a published workflow through the viewer's n8n connector and wait
// for it. Resolves with {executionId, runData} for the nodes named; rejects
// with {code, message}, or {code: "still_running", executionId} when the
// deadline passes first (pass executionId back in to keep waiting).
export async function runWorkflow({ workflowId, trigger, body, nodes, onWait, deadlineMs = 90000, executionId }) {
  if (!mcpRef) throw { code: "not_connected", message: "The n8n connector is not available in this view." };
  let id = executionId;
  if (!id) {
    const started = await tool("execute_workflow", {
      workflowId,
      executionMode: "production",
      triggerNodeName: trigger,
      inputs: { webhookData: { method: "POST", body } },
    }, false);
    id = started?.payload?.executionId;
    if (!id) throw { code: "tool_error", message: "n8n did not return an execution id." };
  }
  let status = "running";
  const t0 = Date.now();
  for (let i = 0; Date.now() - t0 < deadlineMs; i++) {
    await sleep(i < 3 ? 700 : i < 8 ? 1200 : 2500);
    const st = await tool("get_workflow_execution", { workflowId, executionId: String(id), includeData: false }, true);
    status = String(st?.payload?.execution?.status || "running");
    if (!RUNNING.includes(status)) break;
    onWait?.(Math.round((Date.now() - t0) / 1000), id);
  }
  if (RUNNING.includes(status)) throw { code: "still_running", executionId: id, message: "n8n is still working on it." };
  if (status !== "success") throw { code: "tool_error", executionId: id, message: `The workflow ended as “${status}”.` };
  const full = await tool("get_workflow_execution", { workflowId, executionId: String(id), includeData: true, nodeNames: nodes }, true);
  return { executionId: id, runData: full?.payload?.data?.resultData?.runData || {} };
}

// One call to the Intelligence-DB workflow. Resolves with the SQL function's
// result or rejects with {code, message}.
export async function liveCall(body, { onWait } = {}) {
  const { runData } = await runWorkflow({ workflowId: LIVE.workflowId, trigger: LIVE.trigger, body, nodes: LIVE.nodes, onWait });
  const run = (runData.Svar || runData.Fel || [])[0];
  const item = run?.data?.main?.[0]?.[0]?.json;
  if (!item) throw { code: "tool_error", message: "The database call returned nothing." };
  if (!item.ok) throw { code: "db_error", message: item.error || "Database error." };
  return item.result;
}

export const liveRead = (params) => liveCall({ op: "read", params });
export const liveWrite = (action, payload) => liveCall({ op: "write", action, payload });

export const MCP_FIX = {
  not_connected: "Open the page on claude.ai and allow the n8n connector when it asks.",
  server_not_connected: "Connect n8n under claude.ai → Settings → Connectors to use the live database.",
  needs_reauth: "Reconnect n8n under claude.ai → Settings → Connectors.",
  not_in_manifest: "Allow the n8n connector when the page asks.",
  not_granted: "This view cannot use your connectors. Open the page on claude.ai.",
  blocked_by_policy: "Your organisation's policy blocks this n8n tool.",
  rate_limited: "Too many calls right now. Wait a moment.",
  server_unavailable: "n8n did not answer. Try again in a moment.",
  db_error: "The database refused the change.",
};

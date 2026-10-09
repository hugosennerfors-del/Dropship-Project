// The one Shopify Admin GraphQL client.
//
// - POSTs to https://{shop}/admin/api/{version}/graphql.json with the
//   X-Shopify-Access-Token header.
// - Shopify meters by query cost (a leaky bucket in points): after every
//   call it reads extensions.cost.throttleStatus and pauses on its own when
//   less than `reserve` of the bucket is left.
// - THROTTLED errors, HTTP 429 and 5xx are retried with exponential backoff
//   and jitter, at most `maxRetries` times; then it throws with the full
//   response attached.
// - Every call keeps Shopify's request id (x-request-id) for support.
// - The token never appears in errors, logs or return values.
//
// `fetch` and `sleep` are injected so the same code runs in the edge
// function, in tests (mock shop) and nowhere else.

import { SHOPIFY_API_VERSION } from "./version.js";

export class ShopifyError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = "ShopifyError";
    this.kind = kind;            // auth | throttled | http | graphql | user | network | schema
    Object.assign(this, extra);  // status, errors, userErrors, requestId, response
  }
}

export function createClient({ shop, token, version = SHOPIFY_API_VERSION, fetch: fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  reserve = 0.2, maxRetries = 5, baseDelayMs = 500, log = () => {}, random = Math.random } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*\.(myshopify\.com|mock\.test)$/.test(String(shop || ""))) throw new ShopifyError("config", "The shop domain must look like your-store.myshopify.com.");
  if (!token) throw new ShopifyError("config", "No access token for this store.");
  const url = `https://${shop}/admin/api/${version}/graphql.json`;
  const state = { throttle: null, requestIds: [], calls: 0, costs: 0 };

  const backoff = (attempt, retryAfterS) => {
    if (retryAfterS) return retryAfterS * 1000;
    const exp = baseDelayMs * 2 ** attempt;
    return Math.min(20000, exp) * (0.75 + random() * 0.5);
  };
  const opName = (doc) => (String(doc).match(/\b(?:query|mutation)\s+(\w+)/) || [])[1] || "anonymous";

  async function request(doc, variables = {}, { allowUserErrors = true } = {}) {
    const op = opName(doc);
    for (let attempt = 0; ; attempt++) {
      // Wait before spending if the bucket is low.
      const t = state.throttle;
      if (t && t.maximumAvailable && t.currentlyAvailable < t.maximumAvailable * reserve) {
        const need = t.maximumAvailable * reserve * 1.5 - t.currentlyAvailable;
        const waitMs = Math.ceil((need / Math.max(1, t.restoreRate)) * 1000);
        log({ event: "throttle-pause", op, waitMs, available: t.currentlyAvailable });
        await sleep(waitMs);
        state.throttle = { ...t, currentlyAvailable: t.currentlyAvailable + (waitMs / 1000) * t.restoreRate };
      }
      let res, body = null, text = "";
      state.calls++;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({ query: doc, variables }),
        });
      } catch (e) {
        if (attempt < maxRetries) { const ms = backoff(attempt); log({ event: "retry", op, reason: "network", attempt, ms }); await sleep(ms); continue; }
        throw new ShopifyError("network", `Shopify could not be reached (${String(e?.message || e).slice(0, 120)}).`, { op });
      }
      const requestId = res.headers?.get?.("x-request-id") || null;
      if (requestId) state.requestIds.push(requestId);
      text = await res.text();
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      if (body?.extensions?.cost?.throttleStatus) { state.throttle = body.extensions.cost.throttleStatus; state.costs += body.extensions.cost.actualQueryCost ?? body.extensions.cost.requestedQueryCost ?? 0; }

      if (res.status === 401 || res.status === 403) {
        throw new ShopifyError("auth", res.status === 401 ? "Shopify rejected the access token. Create a new one in the store's app settings and connect again." : "The token is missing a permission (access scope) this action needs.", { status: res.status, requestId, op });
      }
      const errs = Array.isArray(body?.errors) ? body.errors : [];
      const throttled = res.status === 429 || errs.some((e) => e?.extensions?.code === "THROTTLED");
      if (throttled || res.status >= 500) {
        if (attempt < maxRetries) {
          let ms = backoff(attempt, Number(res.headers?.get?.("retry-after")) || 0);
          const ts = body?.extensions?.cost?.throttleStatus, need = body?.extensions?.cost?.requestedQueryCost;
          if (throttled && ts && need) ms = Math.max(ms, Math.ceil(((need - ts.currentlyAvailable) / Math.max(1, ts.restoreRate)) * 1000));
          log({ event: "retry", op, reason: throttled ? "throttled" : `http ${res.status}`, attempt, ms, requestId });
          await sleep(ms);
          continue;
        }
        throw new ShopifyError(throttled ? "throttled" : "http", throttled ? "Shopify kept throttling the requests; try again in a minute." : `Shopify answered ${res.status} several times.`, { status: res.status, requestId, op, response: trim(body ?? text) });
      }
      if (!res.ok) throw new ShopifyError("http", `Shopify answered ${res.status}.`, { status: res.status, requestId, op, response: trim(body ?? text) });
      if (errs.length || (body?.errors && !errs.length)) {
        const msg = errs.length ? errs.map((e) => e.message).join("; ") : String(body.errors);
        throw new ShopifyError("graphql", `Shopify could not run ${op}: ${msg.slice(0, 400)}`, { errors: errs.length ? errs : [{ message: msg }], requestId, op, response: trim(body) });
      }
      const data = body?.data ?? null;
      if (!allowUserErrors) assertNoUserErrors(data, op, requestId);
      return { data, requestId, cost: body?.extensions?.cost ?? null };
    }
  }

  // Collects every node of a paginated connection at `path` ("menus").
  async function paginate(doc, variables, path, { max = 1000 } = {}) {
    const out = [];
    let after = null;
    do {
      const { data } = await request(doc, { ...variables, after });
      const conn = path.split(".").reduce((o, k) => o?.[k], data);
      out.push(...(conn?.nodes || []));
      after = conn?.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
    } while (after && out.length < max);
    return out;
  }

  return {
    request,
    paginate,
    // A mutation whose userErrors must be empty; returns its payload.
    async mutate(doc, variables, field) {
      const r = await request(doc, variables);
      const payload = r.data?.[field];
      if (!payload) throw new ShopifyError("graphql", `Shopify returned no ${field} result.`, { requestId: r.requestId, op: field });
      if (payload.userErrors?.length) throw new ShopifyError("user", `Shopify refused ${field}: ${payload.userErrors.map((e) => `${(e.field || []).join(".") || "input"}: ${e.message}`).join("; ").slice(0, 500)}`, { userErrors: payload.userErrors, requestId: r.requestId, op: field });
      return { payload, requestId: r.requestId };
    },
    get state() { return { throttle: state.throttle, calls: state.calls, costs: state.costs, requestIds: state.requestIds.slice(-20) }; },
  };
}

function assertNoUserErrors(data, op, requestId) {
  for (const v of Object.values(data || {})) {
    if (v?.userErrors?.length) throw new ShopifyError("user", `Shopify refused ${op}: ${v.userErrors.map((e) => e.message).join("; ")}`, { userErrors: v.userErrors, requestId, op });
  }
}
const trim = (x) => { const s = typeof x === "string" ? x : JSON.stringify(x); return s && s.length > 4000 ? s.slice(0, 4000) + "…" : (typeof x === "string" ? x : JSON.parse(s)); };

// Removes anything that looks like a token before a value is stored or
// logged (Admin API tokens start with shp…_).
export function redact(value) {
  return JSON.parse(JSON.stringify(value ?? null, (k, v) => {
    if (/token|secret|password|authorization/i.test(k)) return "[redacted]";
    if (typeof v === "string") return v.replace(/shp[a-z]{2}_[A-Za-z0-9]{8,}/g, "[redacted]");
    return v;
  }));
}

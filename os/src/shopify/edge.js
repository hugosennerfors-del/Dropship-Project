// The edge function's logic (Supabase Edge Function "intel-shopify").
//
// Called only by intel.fn_dispatch (pg_net) with {action, id} and the shared
// secret in x-intel-secret, which it checks against Vault. It is the only
// code that reads a Shopify token or app secret (from Vault, by id) and
// talks to Shopify; auth.js turns a connection into an access token.
// It answers 202 straight away and works in the background:
//
//   test      check a connection: shop, plan, currency, scopes, API version,
//             every field the integration uses (introspection)
//   run       claim a publish job (a lease, so it never runs twice), run the
//             pipeline within a time budget, re-dispatch itself to continue
//   rollback  undo a job (soft by default; delete only what it created)
//   names     look up whether brand names are free as domains (names.js)
//   gethookd  search GetHookd's index of Meta ads for a product and save the
//             ads found as the product's competitor ads (gethookd.js), with
//             the price each store asks (storeprice.js)
//   adstats   fresh numbers for a product's saved GetHookd ads: each ad
//             again (free), the stores' prices and, when asked, the stores'
//             monthly visits (about 0.1 GetHookd credit per store)
//
// `sql` is a postgres.js client on SUPABASE_DB_URL; everything else is
// injected so the logic stays plain JavaScript.

import { createClient, redact } from "./client.js";
import { accessToken } from "./auth.js";
import { runJob, runRollback } from "./pipeline.js";
import { verifySchema } from "./schema.js";
import { Q, SCOPES, SCOPES_FOR } from "./documents.js";
import { createMockShop } from "./mockshop.js";
import { SHOPIFY_API_VERSION } from "./version.js";
import { checkNames } from "./names.js";
import { searchAds, savedAdInput, getAd, getShopTraffic, hookdAdId, adMetrics } from "./gethookd.js";
import { storePrices } from "./storeprice.js";

const CORE_SCOPES = [...new Set([...SCOPES_FOR.product, ...SCOPES_FOR.collection, ...SCOPES_FOR.metaobject, ...SCOPES_FOR.page])];
const OPTIONAL_SCOPES = [...new Set([...SCOPES_FOR.menu, ...SCOPES_FOR.publish])];
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function sameSecret(a, b) {
  const x = new TextEncoder().encode(String(a || "")), y = new TextEncoder().encode(String(b || ""));
  if (x.length !== y.length || !x.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export function createHandler({ sql, selfUrl, fetch: fetchImpl = globalThis.fetch, waitUntil = (p) => p, budgetMs = 100000, log = (o) => console.log(JSON.stringify(o)) }) {
  const fnSecret = async () => (await sql`select decrypted_secret from vault.decrypted_secrets where name = 'intel_fn_secret'`)[0]?.decrypted_secret;

  // -- Persistence port for the pipeline --------------------------------
  const storeFor = (job) => ({
    async getSteps(jobId) {
      const rows = await sql`select key, seq, kind, status, request, response, shopify_gid, attempts, error from intel.publish_job_steps where job_id = ${jobId}`;
      return new Map(rows.map((r) => [r.key, r]));
    },
    async saveStep(jobId, s) {
      await sql`insert into intel.publish_job_steps (job_id, key, seq, kind, status, request, response, shopify_gid, attempts, error, updated_at)
        values (${jobId}, ${s.key}, ${s.seq ?? 0}, ${s.kind ?? null}, ${s.status}, ${s.request === undefined ? null : sql.json(s.request)}, ${s.response === undefined ? null : sql.json(s.response)},
                ${s.shopify_gid ?? null}, ${s.attempts ?? 0}, ${s.error ? sql.json(s.error) : null}, now())
        on conflict (job_id, key) do update set seq = excluded.seq, kind = excluded.kind, status = excluded.status,
          request = coalesce(excluded.request, intel.publish_job_steps.request), response = coalesce(excluded.response, intel.publish_job_steps.response),
          shopify_gid = coalesce(excluded.shopify_gid, intel.publish_job_steps.shopify_gid), attempts = excluded.attempts,
          error = ${s.error === undefined ? sql`intel.publish_job_steps.error` : sql`excluded.error`}, updated_at = now()`;
    },
    async addResource(jobId, r) {
      await sql`insert into intel.created_resources (job_id, connection_id, resource_type, shopify_gid, handle, admin_url, public_url, previous_state)
        values (${jobId}, ${job.connection_id}, ${r.resource_type}, ${r.shopify_gid}, ${r.handle ?? null}, ${r.admin_url ?? null}, ${r.public_url ?? null}, ${r.previous_state ? sql.json(r.previous_state) : null})`;
    },
    async resources(jobId) {
      return await sql`select id, resource_type, shopify_gid, handle, previous_state, removed_at from intel.created_resources where job_id = ${jobId} order by id`;
    },
    async markResource(id, patch) {
      await sql`update intel.created_resources set state = ${sql.json(patch)}, removed_at = case when ${!!patch.removed} then now() else removed_at end where id = ${id}`;
    },
    // Made by a publish of the same brand in this store, and not removed.
    async ownedResource(connectionId, type, gid, brandId) {
      return (await sql`select 1 from intel.created_resources r join intel.publish_jobs j on j.id = r.job_id
        where r.connection_id = ${connectionId} and r.resource_type = ${type} and r.shopify_gid = ${gid} and r.removed_at is null and j.brand_id = ${brandId || job.brand_id} limit 1`).length > 0;
    },
    async updateJob(jobId, p) {
      const errorSet = Object.prototype.hasOwnProperty.call(p, "error");
      await sql`update intel.publish_jobs set
        status = coalesce(${p.status ?? null}, status),
        progress = coalesce(${p.progress ? sql.json(p.progress) : null}, progress),
        error = case when ${errorSet} then ${p.error ? sql.json(p.error) : null} else error end,
        started_at = case when ${!!p.started} then coalesce(started_at, now()) else started_at end,
        finished_at = case when ${!!p.finished} then now() else finished_at end,
        updated_at = now() where id = ${jobId}`;
    },
    async audit(action, meta) { await sql`insert into intel.audit_log (actor, action, target, metadata) values ('intel-shopify', ${action}, ${job.id}, ${sql.json(meta || {})})`; },
  });

  // -- A client for a connection (token from Vault, or the simulated store) -
  // Vault port for auth.js: a client-credentials token is cached with its
  // expiry through intel.shopify_cache_token.
  const secrets = {
    read: async (id) => (await sql`select decrypted_secret from vault.decrypted_secrets where id = ${id}`)[0]?.decrypted_secret || null,
    saveToken: async (conn, token, expiresAt) => {
      const [r] = await sql`select intel.shopify_cache_token(${conn.id}, ${token}, ${expiresAt}) as id`;
      conn.token_secret_id = r.id;
      conn.token_expires_at = expiresAt;
    },
  };
  async function clientFor(conn, { fresh = false } = {}) {
    const shopLog = (o) => log({ ...o, shop: conn.shop_domain });
    if (/\.mock\.test$/.test(conn.shop_domain)) {
      const [saved] = await sql`select state from intel.sim_stores where domain = ${conn.shop_domain}`;
      const mock = createMockShop({ domain: conn.shop_domain, name: conn.label || "Simulated store", currency: /^se-/.test(conn.shop_domain) ? "SEK" : "GBP", restore: saved?.state || null });
      const token = await accessToken(conn, { secrets, fetch: mock.fetch, fresh });
      const client = createClient({ shop: conn.shop_domain, token, version: conn.api_version || SHOPIFY_API_VERSION, fetch: mock.fetch, log: shopLog });
      client.persist = async () => { await sql`insert into intel.sim_stores (domain, state, updated_at) values (${conn.shop_domain}, ${sql.json(mock.snapshot())}, now()) on conflict (domain) do update set state = excluded.state, updated_at = now()`; };
      return client;
    }
    const token = await accessToken(conn, { secrets, fetch: fetchImpl, fresh });
    const client = createClient({ shop: conn.shop_domain, token, version: conn.api_version || SHOPIFY_API_VERSION, fetch: fetchImpl, log: shopLog });
    client.persist = async () => {};
    return client;
  }

  // -- test -------------------------------------------------------------
  async function test(id) {
    const [conn] = await sql`select * from intel.shopify_connections where id = ${id}`;
    if (!conn) return;
    try {
      // A new token, so scopes released since the last one are seen now.
      const client = await clientFor(conn, { fresh: true });
      const { data: s } = await client.request(Q.shop);
      const { data: sc } = await client.request(Q.scopes);
      const have = new Set((sc?.currentAppInstallation?.accessScopes || []).map((x) => x.handle));
      const has = (x) => have.has(x) || (x.startsWith("read_") && have.has("write_" + x.slice(5)));
      const missing = CORE_SCOPES.filter((x) => !has(x));
      const optionalMissing = OPTIONAL_SCOPES.filter((x) => !has(x));
      let versions = null;
      try { const { data } = await client.request(Q.versions); versions = data?.publicApiVersions || null; } catch { versions = null; }
      const pinned = conn.api_version || SHOPIFY_API_VERSION;
      const pinnedInfo = versions?.find((v) => v.handle === pinned) || null;
      const schema = await verifySchema(client);
      const ok = missing.length === 0 && schema.ok && (!versions || pinnedInfo?.supported !== false);
      const problems = [];
      if (missing.length) problems.push(`Missing access: ${missing.map((x) => `${x} (${SCOPES[x]})`).join("; ")}.`);
      if (!schema.ok) problems.push(`API ${pinned} lacks: ${schema.missing.slice(0, 12).join(", ")}${schema.missing.length > 12 ? " …" : ""}.`);
      if (versions && pinnedInfo?.supported === false) problems.push(`API version ${pinned} is no longer supported by this store.`);
      await sql`update intel.shopify_connections set status = ${ok ? "connected" : "error"}, shop_name = ${s?.shop?.name ?? null}, plan_name = ${s?.shop?.plan?.publicDisplayName ?? null},
        currency = ${s?.shop?.currencyCode ?? null}, primary_host = ${s?.shop?.primaryDomain?.host ?? null}, scopes = ${[...have]}, missing_scopes = ${missing},
        schema_check = ${sql.json({ ok: schema.ok, missing: schema.missing, deprecated: schema.deprecated, checked: schema.checked, optionalScopesMissing: optionalMissing, partnerDevelopment: !!s?.shop?.plan?.partnerDevelopment })},
        api_versions = ${sql.json({ pinned, supported: pinnedInfo ? pinnedInfo.supported : null, available: (versions || []).map((v) => v.handle).slice(-6) })},
        last_error = ${problems.length ? problems.join(" ") : null}, last_verified_at = now(), updated_at = now() where id = ${id}`;
      await client.persist();
      log({ event: "test", connection: id, ok });
    } catch (e) {
      await sql`update intel.shopify_connections set status = 'error', last_error = ${String(e?.message || e).slice(0, 500)}, last_verified_at = now(), updated_at = now() where id = ${id}`;
      log({ event: "test", connection: id, ok: false, error: String(e?.message || e).slice(0, 200) });
    }
  }

  // -- run --------------------------------------------------------------
  async function run(id) {
    const [job] = await sql`update intel.publish_jobs set status = 'running', lease_until = now() + interval '170 seconds', invocations = invocations + 1, started_at = coalesce(started_at, now()), updated_at = now()
      where id = ${id} and status in ('queued', 'running') and (lease_until is null or lease_until < now()) returning *`;
    if (!job) { log({ event: "run", job: id, skipped: "not runnable or already running" }); return; }
    const store = storeFor(job);
    let client = null;
    try {
      const [conn] = await sql`select * from intel.shopify_connections where id = ${job.connection_id}`;
      const [bv] = await sql`select concept from intel.brand_versions where brand_id = ${job.brand_id} and version = ${job.brand_version}`;
      if (!conn || conn.status !== "connected") throw Object.assign(new Error("The store is not connected; test the connection and retry."), { kind: "config" });
      if (!bv) throw Object.assign(new Error("The brand version is gone."), { kind: "config" });
      client = await clientFor(conn);
      const r = await runJob({ job, concept: bv.concept, connection: conn, client, store, budgetMs, log: (o) => log({ ...o, job: id }) });
      await client.persist();
      await sql`update intel.publish_jobs set lease_until = null where id = ${id}`;
      if (r.status === "continue") { await redispatch("run", id); return; }
      if (r.status === "succeeded") await sql`update intel.brands set status = 'published', updated_at = now() where id = ${job.brand_id}`;
      log({ event: "run", job: id, status: r.status, requestIds: client.state.requestIds.slice(-5) });
    } catch (e) {
      if (client) await client.persist().catch(() => {});
      await store.updateJob(id, { status: "failed", error: { kind: e?.kind || "error", message: String(e?.message || e).slice(0, 600) }, finished: true });
      await sql`update intel.publish_jobs set lease_until = null where id = ${id}`;
      log({ event: "run", job: id, status: "failed", error: String(e?.message || e).slice(0, 200) });
    }
  }

  // -- rollback ---------------------------------------------------------
  async function rollback(id) {
    const [job] = await sql`update intel.publish_jobs set lease_until = now() + interval '170 seconds', invocations = invocations + 1, updated_at = now()
      where id = ${id} and status = 'rolling_back' and (lease_until is null or lease_until < now()) returning *`;
    if (!job) return;
    const store = storeFor(job);
    let client = null;
    try {
      const [conn] = await sql`select * from intel.shopify_connections where id = ${job.connection_id}`;
      client = await clientFor(conn);
      const r = await runRollback({ job, mode: job.rollback?.mode || "unpublish", client, store });
      await client.persist();
      if (r.status === "rolled_back") await sql`update intel.brands set status = 'draft', updated_at = now() where id = ${job.brand_id} and not exists (select 1 from intel.publish_jobs where brand_id = ${job.brand_id} and status = 'succeeded')`;
      log({ event: "rollback", job: id, status: r.status, actions: r.done?.length });
    } catch (e) {
      if (client) await client.persist().catch(() => {});
      await store.updateJob(id, { status: "partially_failed", error: { step: "rollback", kind: e?.kind || "error", message: String(e?.message || e).slice(0, 600) }, finished: true });
    } finally {
      await sql`update intel.publish_jobs set lease_until = null where id = ${id}`;
    }
  }

  // -- names ------------------------------------------------------------
  async function names(id) {
    const [row] = await sql`update intel.name_checks set status = 'running' where id = ${id} and status = 'queued' returning *`;
    if (!row) return;
    try {
      const results = await checkNames(row.names, row.market, { fetch: fetchImpl });
      await sql`update intel.name_checks set status = 'done', results = ${sql.json(results)}, finished_at = now() where id = ${id}`;
      log({ event: "names", id, names: row.names.length });
    } catch (e) {
      await sql`update intel.name_checks set status = 'failed', error = ${String(e?.message || e).slice(0, 300)}, finished_at = now() where id = ${id}`;
    }
  }

  // -- gethookd ---------------------------------------------------------
  async function gethookd(id) {
    const [row] = await sql`update intel.gethookd_searches set status = 'running' where id = ${id} and status = 'queued' returning *`;
    if (!row) return;
    try {
      const [k] = await sql`select decrypted_secret from vault.decrypted_secrets where name = 'gethookd_api_key'`;
      const r = await searchAds({ key: k?.decrypted_secret, fetch: fetchImpl, query: row.query, market: row.market, limit: row.ad_limit });
      const found = r.ads.filter((a) => a.shareUrl);
      const today = new Date().toISOString().slice(0, 10);
      // The price each store asks, for the revenue estimate. A store that
      // does not answer only leaves its price out.
      const priceOf = await storePrices({ fetch: fetchImpl, landingPages: found.map((a) => a.landingPage).filter(Boolean) }).catch(() => () => null);
      // Every ad with a link becomes one of the product's saved ads; links it
      // already has, saved or removed, are skipped.
      const [{ saved }] = await sql`select intel.gethookd_save_ads(${id}, ${sql.json(found.map((a) => savedAdInput(a, { today, price: priceOf(a.landingPage) })))}) as saved`;
      const summary = { ...r.summary, added: saved?.added ?? 0, alreadySaved: saved?.known ?? 0 };
      await sql`update intel.gethookd_searches set status = 'done', results = ${sql.json(r.ads)}, summary = ${sql.json(summary)}, finished_at = now() where id = ${id}`;
      log({ event: "gethookd", id, ads: r.ads.length, added: summary.added, credits: r.summary.usedCredits });
    } catch (e) {
      await sql`update intel.gethookd_searches set status = 'failed', error = ${String(e?.message || e).slice(0, 300)}, finished_at = now() where id = ${id}`;
    }
  }

  // -- adstats ----------------------------------------------------------
  async function adstats(id) {
    const [row] = await sql`update intel.ad_stats_runs set status = 'running' where id = ${id} and status = 'queued' returning *`;
    if (!row) return;
    try {
      const [k] = await sql`select decrypted_secret from vault.decrypted_secrets where name = 'gethookd_api_key'`;
      const key = k?.decrypted_secret;
      const today = new Date().toISOString().slice(0, 10);
      const rows = await sql`select id, url, metrics from intel.product_ads where product_id = ${row.product_id} and removed_at is null
        and url like 'https://app.gethookd.ai/share/ad/%' order by created_at desc limit 40`;
      const fresh = new Map(), failed = [];
      for (let i = 0; i < rows.length; i += 4) {
        await Promise.all(rows.slice(i, i + 4).map(async (x) => {
          const adId = x.metrics?.adId || hookdAdId(x.url);
          if (!adId) return;
          try { fresh.set(x.id, await getAd({ key, fetch: fetchImpl, adId })); } catch (e) { failed.push(String(e?.message || e).slice(0, 120)); }
        }));
      }
      const priceOf = await storePrices({ fetch: fetchImpl, landingPages: [...fresh.values()].map((a) => a.landingPage).filter(Boolean) });
      // Store traffic: what earlier runs found, and with `traffic` a new
      // reading for stores not read in the last 7 days, at most 5 a run.
      const stores = new Map();
      for (const x of rows) if (x.metrics?.store?.shopId) stores.set(x.metrics.store.shopId, x.metrics.store);
      let usedCredits = 0, storesRead = 0;
      if (row.traffic) {
        const age = (s) => (Date.now() - Date.parse(`${s?.checkedAt}T00:00:00Z`)) / 86400000;
        const due = [...new Set([...fresh.values()].map((a) => a.shopId).filter(Boolean))].filter((s) => !(age(stores.get(s)) < 7)).slice(0, 5);
        for (const s of due) {
          try { const t = await getShopTraffic({ key, fetch: fetchImpl, shopId: s, today }); stores.set(s, t.store); usedCredits += t.usedCredits || 0; storesRead++; }
          catch (e) { failed.push(String(e?.message || e).slice(0, 120)); }
        }
      }
      let updated = 0, priced = 0;
      for (const x of rows) {
        const ad = fresh.get(x.id);
        if (!ad) continue;
        const p = priceOf(ad.landingPage);
        const ok = p && !p.error;
        // A price that cannot be read now keeps the one found before.
        const kept = !ok && x.metrics?.price != null ? { price: x.metrics.price, compareAt: x.metrics.compareAt ?? null, currency: x.metrics.currency ?? null, title: x.metrics.productTitle ?? null, from: x.metrics.priceFrom } : null;
        const m = adMetrics(ad, { today, price: ok ? p : kept, store: ad.shopId ? stores.get(ad.shopId) || null : null });
        if (kept) m.priceCheckedAt = x.metrics.priceCheckedAt ?? null;
        if (ok) priced++;
        await sql`update intel.product_ads set metrics = ${sql.json(m)}, still_running = ${ad.stillRunning}, updated_at = now() where id = ${x.id} and product_id = ${row.product_id}`;
        updated++;
      }
      const summary = { ads: rows.length, updated, priced, storesRead, usedCredits: Math.round(usedCredits * 100) / 100, failed: failed.slice(0, 5) };
      await sql`update intel.ad_stats_runs set status = 'done', summary = ${sql.json(summary)}, finished_at = now() where id = ${id}`;
      log({ event: "adstats", id, ...summary });
    } catch (e) {
      await sql`update intel.ad_stats_runs set status = 'failed', error = ${String(e?.message || e).slice(0, 300)}, finished_at = now() where id = ${id}`;
    }
  }

  async function redispatch(action, id) {
    const s = await fnSecret();
    await fetchImpl(selfUrl, { method: "POST", headers: { "Content-Type": "application/json", "x-intel-secret": s }, body: JSON.stringify({ action, id }) });
  }

  return async function handler(req) {
    if (req.method !== "POST") return json(405, { error: "POST only" });
    const given = req.headers.get("x-intel-secret");
    if (!sameSecret(given, await fnSecret())) return json(401, { error: "unauthorised" });
    let body;
    try { body = await req.json(); } catch { return json(400, { error: "invalid JSON" }); }
    const { action, id } = body || {};
    if (!/^[0-9a-f-]{36}$/.test(String(id || ""))) return json(400, { error: "invalid id" });
    const work = { test, run, rollback, names, gethookd, adstats }[action];
    if (!work) return json(400, { error: "unknown action" });
    waitUntil(work(id).catch((e) => log({ event: action, id, crashed: String(e?.message || e).slice(0, 200), detail: redact(String(e?.stack || "")).slice(0, 400) })));
    return json(202, { accepted: true, action, id });
  };
}

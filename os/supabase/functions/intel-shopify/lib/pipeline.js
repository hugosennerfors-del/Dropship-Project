// The publish pipeline: runs a plan (mapping.js) step by step against a
// store, saving each step's request, response and Shopify id as it goes.
//
// - Idempotent: a step that already succeeded is skipped; a product or page
//   this integration made earlier is updated, never duplicated.
// - Resumable: a failed step stops the job (failed, or partially_failed if
//   something was already created); "retry" starts again at that step.
// - Time-boxed: past `budgetMs` it stops between steps and reports
//   `continue`, so a serverless runtime can pick it up in a new invocation.
// - Never touches a handle someone else is using: the preflight fails with
//   a clear message instead. "Someone else" includes another Plan-vy brand:
//   ownership is per brand, so one brand never updates another's products.
//
// `store` is the persistence port (Postgres in the edge function, memory in
// tests): getSteps, saveStep, addResource, markResource, ownedResource,
// updateJob, audit.

import { buildPlan, adminUrl, publicUrl, planRollback } from "./mapping.js";
import { Q, M, SCOPES, scopeFix } from "./documents.js";
import { verifySchema } from "./schema.js";
import { ShopifyError, redact } from "./client.js";

const short = (x, n = 6000) => { const s = JSON.stringify(redact(x)); return s.length > n ? { truncated: true, preview: s.slice(0, n) } : JSON.parse(s); };
const errInfo = (e) => ({ kind: e?.kind || "error", message: String(e?.message || e).slice(0, 800), requestId: e?.requestId || null, userErrors: e?.userErrors || undefined, missing: e?.missing || undefined });

export async function runJob({ job, concept, connection, client, store, budgetMs = Infinity, now = () => Date.now(), log = () => {} }) {
  const started = now();
  const plan = buildPlan(concept, job.options || {});
  if (!plan.ok) {
    await store.saveStep(job.id, { key: "validate", seq: 0, kind: "validate", status: "failed", attempts: 1, error: { kind: "validation", message: plan.errors.slice(0, 12).join("; ") } });
    await store.updateJob(job.id, { status: "failed", error: { kind: "validation", message: "The brand concept is not valid; fix it in the Brand Builder.", errors: plan.errors.slice(0, 40) }, finished: true });
    return { status: "failed" };
  }
  const saved = await store.getSteps(job.id);
  const ctx = { ids: {}, shop: null, existing: {}, publicationId: null };
  for (const st of saved.values()) {
    if (st.status === "succeeded") {
      if (st.shopify_gid) ctx.ids[st.key] = st.shopify_gid;
      if (st.key === "preflight" && st.response) { ctx.shop = st.response.shop; ctx.existing = st.response.existing || {}; }
      if (st.key === "publish" && st.response?.publicationId) ctx.publicationId = st.response.publicationId;
    }
  }
  if (!saved.has("validate")) await store.saveStep(job.id, { key: "validate", seq: 0, kind: "validate", status: "succeeded", attempts: 1, response: { products: plan.summary.products, variants: plan.summary.variants, warnings: plan.warnings } });
  await store.updateJob(job.id, { status: "running", started: true, progress: progress(plan, saved) });

  const created = [];
  for (const [i, step] of plan.steps.entries()) {
    const prev = saved.get(step.key);
    if (prev?.status === "succeeded") continue;
    if (now() - started > budgetMs) {
      await store.updateJob(job.id, { status: "queued", progress: progress(plan, await store.getSteps(job.id)) });
      return { status: "continue" };
    }
    const attempts = (prev?.attempts || 0) + 1;
    await store.saveStep(job.id, { key: step.key, seq: i + 1, kind: step.kind, status: "running", attempts, request: short(step.variables ?? step.check ?? step.targets ?? null) });
    try {
      const r = await STEPS[step.kind]({ step, plan, ctx, client, store, job, connection });
      if (r?.gid) ctx.ids[step.key] = r.gid;
      for (const res of r?.resources || []) { await store.addResource(job.id, res); created.push(res); }
      await store.saveStep(job.id, { key: step.key, seq: i + 1, kind: step.kind, status: "succeeded", attempts, response: short(r?.response ?? null), shopify_gid: r?.gid || null, error: null });
      log({ event: "step", key: step.key, status: "succeeded" });
    } catch (e) {
      const info = errInfo(e);
      await store.saveStep(job.id, { key: step.key, seq: i + 1, kind: step.kind, status: "failed", attempts, error: info });
      const any = [...(await store.getSteps(job.id)).values()].some((s) => s.status === "succeeded" && s.shopify_gid);
      await store.updateJob(job.id, { status: any ? "partially_failed" : "failed", error: { step: step.key, ...info }, progress: progress(plan, await store.getSteps(job.id)), finished: true });
      await store.audit("publish.step_failed", { job: job.id, step: step.key, kind: info.kind });
      log({ event: "step", key: step.key, status: "failed", error: info.message });
      return { status: any ? "partially_failed" : "failed", error: info };
    }
  }
  await store.updateJob(job.id, { status: "succeeded", error: null, progress: progress(plan, await store.getSteps(job.id)), finished: true });
  await store.audit("publish.succeeded", { job: job.id, products: plan.summary.products });
  return { status: "succeeded" };
}

function progress(plan, steps) {
  const by = (kind) => plan.steps.filter((s) => s.kind === kind);
  const done = (list) => list.filter((s) => steps.get(s.key)?.status === "succeeded").length;
  return {
    total: plan.steps.length, done: done(plan.steps),
    products: { done: done(by("product")), total: by("product").length },
    current: plan.steps.find((s) => steps.get(s.key)?.status !== "succeeded")?.key || null,
  };
}

const gidNum = (gid) => String(gid || "").split("/").pop();

const STEPS = {
  // Token, scopes, API fields, currency and handles, before any write.
  async preflight({ step, ctx, client, store, job, connection }) {
    const { data: s } = await client.request(Q.shop);
    const shop = s?.shop;
    if (!shop) throw new ShopifyError("graphql", "Shopify did not return the shop.");
    if (step.check.currency && shop.currencyCode && shop.currencyCode !== step.check.currency) {
      throw new ShopifyError("config", `The store sells in ${shop.currencyCode} but the concept is priced in ${step.check.currency}. Pick the matching market in the Brand Builder or another store.`);
    }
    const { data: sc } = await client.request(Q.scopes);
    const have = new Set((sc?.currentAppInstallation?.accessScopes || []).map((x) => x.handle));
    // write_* implies read_* on Shopify.
    const missingScopes = step.check.scopes.filter((x) => !have.has(x) && !(x.startsWith("read_") && have.has("write_" + x.slice(5))));
    if (missingScopes.length) throw new ShopifyError("scopes", `The app is missing access: ${missingScopes.map((x) => `${x} (${SCOPES[x] || "needed"})`).join("; ")}. ${scopeFix(connection?.auth_kind)}`, { missing: missingScopes });
    const schema = await verifySchema(client, step.check.groups);
    if (!schema.ok) throw new ShopifyError("schema", `The store's Admin API (version ${connection?.api_version || "pinned"}) lacks fields this integration uses: ${schema.missing.join(", ")}. The pinned API version needs updating.`, { missing: schema.missing });

    const existing = { products: {}, collection: null, page: null };
    const conflicts = [];
    for (const handle of step.check.productHandles) {
      const { data } = await client.request(Q.productByHandle, { handle });
      const p = data?.productByIdentifier;
      if (!p) continue;
      if (await store.ownedResource(job.connection_id, "product", p.id, job.brand_id)) existing.products[handle] = { id: p.id, status: p.status };
      else conflicts.push(`product \u201c${handle}\u201d`);
    }
    if (step.check.collectionHandle) {
      const { data } = await client.request(Q.collectionByHandle, { handle: step.check.collectionHandle });
      const col = data?.collectionByIdentifier;
      if (col) { if (await store.ownedResource(job.connection_id, "collection", col.id, job.brand_id)) existing.collection = { id: col.id }; else conflicts.push(`collection \u201c${col.handle}\u201d`); }
    }
    if (step.check.pageHandle) {
      const { data } = await client.request(Q.pageByHandle, { query: `handle:${step.check.pageHandle}` });
      const pg = (data?.pages?.nodes || []).find((x) => x.handle === step.check.pageHandle);
      if (pg) { if (await store.ownedResource(job.connection_id, "page", pg.id, job.brand_id)) existing.page = { id: pg.id, isPublished: pg.isPublished }; else conflicts.push(`page \u201c${pg.handle}\u201d`); }
    }
    for (const handle of step.check.policyHandles || []) {
      const { data } = await client.request(Q.pageByHandle, { query: `handle:${handle}` });
      const pg = (data?.pages?.nodes || []).find((x) => x.handle === handle);
      if (!pg) continue;
      if (await store.ownedResource(job.connection_id, "page", pg.id, job.brand_id)) (existing.policies ||= {})[handle] = { id: pg.id, isPublished: pg.isPublished };
      else conflicts.push(`page \u201c${pg.handle}\u201d`);
    }
    if (conflicts.length) throw new ShopifyError("conflict", `Already in use in the store and not made by this brand: ${conflicts.join(", ")}. Rename the brand or product (the handle follows the name) and try again.`);
    const response = { shop: { name: shop.name, domain: shop.myshopifyDomain, host: shop.primaryDomain?.host || shop.myshopifyDomain, currency: shop.currencyCode, plan: shop.plan?.publicDisplayName || null }, schema: { checked: schema.checked, deprecated: schema.deprecated }, existing };
    // Later steps in this run read what the preflight found.
    ctx.shop = response.shop; ctx.existing = existing;
    return { response };
  },

  async metaobjectDefinition({ step, client }) {
    const { data } = await client.request(Q.metaobjectDefinition, { type: step.variables.type });
    const found = data?.metaobjectDefinitionByType;
    if (found) return { gid: found.id, response: { existed: true, id: found.id } };
    const { payload } = await client.mutate(M.metaobjectDefinitionCreate, { definition: step.variables.definition }, "metaobjectDefinitionCreate");
    const id = payload.metaobjectDefinition.id;
    return { gid: id, response: { existed: false, id }, resources: [{ resource_type: "metaobject_definition", shopify_gid: id, handle: step.variables.type, previous_state: null }] };
  },

  async product({ step, plan, ctx, client, connection }) {
    const ex = ctx.existing?.products?.[step.handle];
    const variables = { ...step.variables, identifier: ex ? { id: ex.id } : null };
    if (!ex) delete variables.identifier;
    const { payload, requestId } = await client.mutate(M.productSet, variables, "productSet");
    const p = payload.product;
    if (!p?.id) throw new ShopifyError("graphql", "Shopify did not return the product.", { requestId });
    return {
      gid: p.id, response: { id: p.id, handle: p.handle, status: p.status, updated: !!ex, requestId },
      resources: [{ resource_type: "product", shopify_gid: p.id, handle: p.handle, admin_url: adminUrl(connection?.shop_domain, "product", p.id),
        public_url: publicUrl(ctx.shop?.host, "product", p.handle), previous_state: ex ? { existed: true, status: ex.status } : null }],
    };
    void plan;
  },

  async collection({ step, ctx, client, connection }) {
    const ex = ctx.existing?.collection;
    if (ex) return { gid: ex.id, response: { id: ex.id, existed: true, note: "Collection kept as it is (made by an earlier Plan-vy job)." } };
    const { payload } = await client.mutate(M.collectionCreate, step.variables, "collectionCreate");
    const col = payload.collection;
    return { gid: col.id, response: { id: col.id, handle: col.handle },
      resources: [{ resource_type: "collection", shopify_gid: col.id, handle: col.handle, admin_url: adminUrl(connection?.shop_domain, "collection", col.id), public_url: publicUrl(ctx.shop?.host, "collection", col.handle), previous_state: null }] };
  },

  // An upsert: if an earlier Plan-vy job made this entry, it is recorded as
  // existing, so undoing this job never deletes it.
  async metaobject({ step, client, store, job, connection }) {
    const { payload } = await client.mutate(M.metaobjectUpsert, step.variables, "metaobjectUpsert");
    const mo = payload.metaobject;
    const existed = await store.ownedResource(job.connection_id, "metaobject", mo.id, job.brand_id);
    return { gid: mo.id, response: { id: mo.id, handle: mo.handle, existed },
      resources: [{ resource_type: "metaobject", shopify_gid: mo.id, handle: mo.handle, admin_url: adminUrl(connection?.shop_domain, "metaobject", mo.id), previous_state: existed ? { existed: true } : null }] };
  },

  async page({ step, ctx, client, connection }) {
    return pageStep(step, ctx.existing?.page, { ctx, client, connection });
  },

  // A policy page: the same as the brand page, with its own handle.
  async policyPage({ step, ctx, client, connection }) {
    return pageStep(step, ctx.existing?.policies?.[step.handle], { ctx, client, connection });
  },

  // Adds the collection to a menu. The menu's earlier items are saved, so
  // undo can put it back exactly as it was.
  async menu({ step, ctx, client, connection }) {
    const collectionId = ctx.ids.collection;
    if (!collectionId) throw new ShopifyError("config", "The menu item needs the brand collection, which was not created.");
    const menus = await client.paginate(Q.menus, {}, "menus");
    const menu = menus.find((m) => m.handle === step.menuHandle);
    if (!menu) throw new ShopifyError("config", `The store has no menu with the handle \u201c${step.menuHandle}\u201d.`);
    const toInput = (it) => ({ id: it.id, title: it.title, type: it.type, ...(it.resourceId ? { resourceId: it.resourceId } : {}), ...(it.url && !it.resourceId ? { url: it.url } : {}), ...(it.tags?.length ? { tags: it.tags } : {}), items: (it.items || []).map(toInput) });
    const items = (menu.items || []).map(toInput);
    if (items.some((it) => it.resourceId === collectionId)) return { gid: menu.id, response: { id: menu.id, note: "Already in the menu." } };
    const next = [...items, { title: step.item.title, type: "COLLECTION", resourceId: collectionId, items: [] }];
    await client.mutate(M.menuUpdate, { id: menu.id, title: menu.title, handle: menu.handle, items: next }, "menuUpdate");
    return { gid: menu.id, response: { id: menu.id, items: next.length },
      resources: [{ resource_type: "menu", shopify_gid: menu.id, handle: menu.handle, admin_url: adminUrl(connection?.shop_domain, "menu", menu.id), previous_state: { existed: true, title: menu.title, items } }] };
  },

  async publish({ step, ctx, client }) {
    const pubs = await client.paginate(Q.publications, {}, "publications");
    const online = pubs.find((p) => /online store/i.test(p.name));
    if (!online) throw new ShopifyError("config", "The store has no Online Store sales channel to publish to.");
    const resources = [];
    for (const key of step.targets) {
      const id = ctx.ids[key];
      if (!id) continue;
      await client.mutate(M.publish, { id, input: [{ publicationId: online.id }] }, "publishablePublish");
      resources.push({ resource_type: "publication", shopify_gid: id, handle: key, previous_state: { publicationId: online.id } });
    }
    return { response: { publicationId: online.id, published: resources.length }, resources };
  },

  async finalize({ plan, ctx }) {
    return { response: { brand: plan.summary.handle, ids: ctx.ids, host: ctx.shop?.host || null } };
  },
};

// Creates a page, or updates the one an earlier publish of this brand made
// (`ex`), keeping what it was so undo can put it back.
async function pageStep(step, ex, { ctx, client, connection }) {
  const v = step.variables.page;
  if (ex) {
    const { payload } = await client.mutate(M.pageUpdate, { id: ex.id, page: { title: v.title, body: v.body, isPublished: v.isPublished } }, "pageUpdate");
    return { gid: ex.id, response: { id: ex.id, updated: true, isPublished: payload.page?.isPublished },
      resources: [{ resource_type: "page", shopify_gid: ex.id, handle: v.handle, admin_url: adminUrl(connection?.shop_domain, "page", ex.id), public_url: publicUrl(ctx.shop?.host, "page", v.handle), previous_state: { existed: true, isPublished: ex.isPublished } }] };
  }
  const { payload } = await client.mutate(M.pageCreate, step.variables, "pageCreate");
  const pg = payload.page;
  return { gid: pg.id, response: { id: pg.id, handle: pg.handle, isPublished: pg.isPublished },
    resources: [{ resource_type: "page", shopify_gid: pg.id, handle: pg.handle, admin_url: adminUrl(connection?.shop_domain, "page", pg.id), public_url: publicUrl(ctx.shop?.host, "page", pg.handle), previous_state: null }] };
}

// Undo a job: soft by default (see planRollback). Every action is logged
// on the resource; a failed action leaves the rest untouched and the job
// marked so it can be retried.
export async function runRollback({ job, mode = "unpublish", client, store, now = () => Date.now() }) {
  const resources = await store.resources(job.id);
  const actions = planRollback(resources, mode);
  const done = [];
  try {
    for (const a of actions) {
      const r = a.resource;
      switch (a.op) {
        case "restoreMenu": await client.mutate(M.menuUpdate, { id: r.shopify_gid, title: r.previous_state.title, handle: r.handle, items: r.previous_state.items }, "menuUpdate"); break;
        case "unpublish": await client.mutate(M.unpublish, { id: r.shopify_gid, input: [{ publicationId: r.previous_state.publicationId }] }, "publishableUnpublish"); break;
        case "hidePage": await client.mutate(M.pageUpdate, { id: r.shopify_gid, page: { isPublished: r.previous_state?.existed ? !!r.previous_state.isPublished : false } }, "pageUpdate"); break;
        case "deletePage": await client.mutate(M.pageDelete, { id: r.shopify_gid }, "pageDelete"); break;
        case "deleteCollection": await client.mutate(M.collectionDelete, { input: { id: r.shopify_gid } }, "collectionDelete"); break;
        case "draftProduct": await client.mutate(M.productStatus, { product: { id: r.shopify_gid, status: a.status } }, "productUpdate"); break;
        case "deleteProduct": await client.mutate(M.productDelete, { input: { id: r.shopify_gid } }, "productDelete"); break;
        case "deleteMetaobject": await client.mutate(M.metaobjectDelete, { id: r.shopify_gid }, "metaobjectDelete"); break;
        default: break;
      }
      await store.markResource(r.id, { removed: a.op.startsWith("delete") || a.op === "unpublish" || a.op === "restoreMenu", rolled_back: a.op, at: new Date(now()).toISOString() });
      done.push(a.label);
    }
  } catch (e) {
    const info = errInfo(e);
    await store.updateJob(job.id, { status: "partially_failed", error: { step: "rollback", ...info, done }, finished: true });
    await store.audit("publish.rollback_failed", { job: job.id, mode, done: done.length });
    return { status: "failed", error: info, done };
  }
  await store.updateJob(job.id, { status: "rolled_back", error: null, finished: true });
  await store.audit("publish.rolled_back", { job: job.id, mode, actions: done.length });
  return { status: "rolled_back", done };
}

export { gidNum };

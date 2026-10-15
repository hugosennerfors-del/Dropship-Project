// Shopify integration: schema, mapping, client, schema check, pipeline,
// idempotency, resume, throttling and rollback, against the simulated store.
//   node test/shopify.mjs
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConcept, sanitizeHtml, slugify, uniqueHandle, toHtml, variantMargin, keptOnRegenerate } from "../src/shopify/concept.js";
import { CONCEPT_JSON_SCHEMA, CONCEPT_TOOL_SCHEMA, jsonDepth } from "../src/shopify/concept-schema.js";
import { buildPlan, planRollback, pageBody, adminUrl, publicUrl } from "../src/shopify/mapping.js";
import { createClient, ShopifyError, redact } from "../src/shopify/client.js";
import { verifySchema } from "../src/shopify/schema.js";
import { runJob, runRollback } from "../src/shopify/pipeline.js";
import { createMockShop } from "../src/shopify/mockshop.js";
import { accessToken } from "../src/shopify/auth.js";
import { Q, scopeFix } from "../src/shopify/documents.js";
import { SHOPIFY_API_VERSION } from "../src/shopify/version.js";
import { econSettings, orderEconomics, conceptEconomics, econProblems } from "../src/shopify/economics.js";
import { logoLayout, logoSvg, logoSettings } from "../src/shopify/logo.js";
import { complianceChecks, attest, productGroups, businessGaps } from "../src/shopify/compliance.js";
import { domainLabel, domainCandidates, checkDomain, checkNames } from "../src/shopify/names.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const concept = JSON.parse(await readFile(join(root, "test/fixtures-brand-concept.json"), "utf8"));
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) pass++; else { fail++; console.log("✗", name, extra); } };
const clone = (x) => structuredClone(x);

// A test clock: sleeping moves it forward instantly.
function clock() { let t = 1_800_000_000_000; return { now: () => t, sleep: async (ms) => { t += ms; clock.slept.push(ms); }, advance: (ms) => { t += ms; } }; }
clock.slept = [];

// In-memory persistence with the same port as the Postgres adapter.
function memStore() {
  const steps = new Map(), resources = [], jobs = new Map(), audit = [];
  let rid = 0;
  return {
    steps, resourceList: resources, jobs, auditLog: audit,
    async getSteps(jobId) { return new Map([...(steps.get(jobId) || new Map())].map(([k, v]) => [k, { ...v }])); },
    async saveStep(jobId, s) { const m = steps.get(jobId) || new Map(); m.set(s.key, { ...(m.get(s.key) || {}), ...s }); steps.set(jobId, m); },
    async addResource(jobId, r) { resources.push({ id: ++rid, job_id: jobId, ...r }); },
    async resources(jobId) { return resources.filter((r) => r.job_id === jobId); },
    async markResource(id, patch) { const r = resources.find((x) => x.id === id); if (r) { r.state = patch; if (patch.removed) r.removed_at = patch.at; } },
    async ownedResource(connectionId, type, gid, brandId) { return resources.some((r) => r.connection_id === connectionId && r.resource_type === type && r.shopify_gid === gid && !r.removed_at && (!brandId || r.brand_id === brandId)); },
    async updateJob(jobId, patch) { jobs.set(jobId, { ...(jobs.get(jobId) || {}), ...patch }); },
    async audit(action, meta) { audit.push({ action, meta }); },
  };
}
// Resources carry the connection and the job's brand, so ownership checks
// work across jobs (and never across brands).
const JOB_BRAND = {};
const withConnection = (store, connectionId) => ({ ...store, async addResource(jobId, r) { return store.addResource(jobId, { ...r, connection_id: connectionId, brand_id: JOB_BRAND[jobId] }); } });

// ── Concept validation ─────────────────────────────────────────────────
{
  const v = validateConcept(concept);
  ok(v.ok, "the fixture concept is valid", v.errors.join("; "));
  ok(v.value.handle === "tidewarm" && v.value.products[0].handle === "tidewarm-changing-robe" && v.value.products[1].handle === "tidewarm-dry-bag-20-l", "handles carry the brand once", v.value.products.map((p) => p.handle).join());
  ok(v.value.products[0].variants[0].price === "109.00" && v.value.identity.palette[0].hex === "#1e4e79", "prices and colours are normalised");
  const bad = clone(concept);
  bad.identity.palette[0].hex = "blue";
  bad.products[0].variants[0].price = "0";
  bad.products[0].variants[1].optionValues = ["XL"];
  bad.products[0].variants[2].sku = "TW-ROBE-S";
  bad.products[0].variants[2].compareAtPrice = "99";
  const e = validateConcept(bad).errors.join(" | ");
  ok(/palette\[0\]\.hex/.test(e) && /variants\[0\]\.price: must be more than 0/.test(e) && /“XL” is not a value of Size/.test(e) && /SKU must be unique/.test(e) && /must be higher than the price/.test(e), "invalid colours, prices, option values, SKUs and compare-at prices are caught", e);
  ok(!validateConcept({ name: "x" }).ok, "an incomplete concept fails");
  const noFg = clone(concept); noFg.identity.palette = noFg.identity.palette.filter((p) => p.role !== "fg");
  ok(/needs a fg colour/.test(validateConcept(noFg).errors.join()), "the palette needs text and background colours");
  ok(CONCEPT_JSON_SCHEMA.properties.products.items.properties.variants.items.required.includes("sku"), "the model's schema requires a SKU per variant");
  // Claude's page tools refuse an inputSchema over 4 KB or nested more than 8 levels.
  ok(JSON.stringify(CONCEPT_TOOL_SCHEMA).length <= 4096 && jsonDepth(CONCEPT_TOOL_SCHEMA) <= 8 && jsonDepth(CONCEPT_JSON_SCHEMA) > 8,
    "the tool schema fits Claude's limits (4 KB, 8 levels); the full schema goes in the prompt", `${JSON.stringify(CONCEPT_TOOL_SCHEMA).length} bytes, depth ${jsonDepth(CONCEPT_TOOL_SCHEMA)}`);
  ok(CONCEPT_TOOL_SCHEMA.required.join() === CONCEPT_JSON_SCHEMA.required.join() && CONCEPT_TOOL_SCHEMA.properties.products.items.required.includes("variants"),
    "the tool schema keeps the required fields of the concept and its products");
}
// ── HTML, handles, margins ─────────────────────────────────────────────
{
  const s = sanitizeHtml(`<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:x">l</a><strong>ok</strong><img src=x onerror=y>`);
  ok(s === "<p>Hi</p>l<strong>ok</strong>", "scripts, attributes and unknown tags never survive", s);
  ok(sanitizeHtml("a < b & <b>c</b>") === "a &lt; b &amp; <b>c</b>", "plain text is escaped, allowed tags kept");
  ok(toHtml("One\n\nTwo") === "<p>One</p><p>Two</p>", "plain text becomes paragraphs");
  ok(slugify("Nordisk Värme & Co!") === "nordisk-varme-and-co", "handles fold å/ä/ö and punctuation");
  ok(uniqueHandle("tidewarm", new Set(["tidewarm", "tidewarm-2"])) === "tidewarm-3", "taken handles get -2, -3 …");
  const m = variantMargin({ price: "24.00", cost: "6.00", vat: 0.2, shipping: 3 });
  ok(m && Math.abs(m.net - 20) < 0.01 && m.contribution > 0, "margin per variant after VAT, shipping and fees", JSON.stringify(m));
}
// ── Plan (dry run) ─────────────────────────────────────────────────────
{
  const plan = buildPlan(concept, {});
  ok(plan.ok, "the plan builds", plan.errors?.join());
  ok(plan.steps.map((s) => s.key).join() === "preflight,metaobject-definition,product:tidewarm-changing-robe,product:tidewarm-dry-bag-20-l,collection,metaobject,page,finalize", "steps in order, safe defaults", plan.steps.map((s) => s.key).join());
  const p = plan.steps[2].variables.input;
  ok(p.status === "DRAFT" && p.tags.includes("brand:tidewarm") && p.vendor === "Tidewarm" && p.metafields[0].value === "tidewarm", "products are drafts tagged with the brand");
  ok(p.productOptions[0].values.length === 3 && p.variants[2].compareAtPrice === "129.00" && p.variants[0].inventoryItem.sku === "TW-ROBE-S" && p.variants[0].inventoryItem.measurement.weight.unit === "GRAMS", "options, variants, SKU and weight map to productSet");
  const bag = plan.steps[3].variables.input;
  ok(bag.productOptions[0].name === "Title" && bag.variants[0].optionValues[0].name === "Default Title", "a product without options gets Shopify's default variant");
  ok(!/<script/.test(p.descriptionHtml) && p.descriptionHtml.includes("<li>Fleece lining</li>"), "descriptions are sanitised and carry the bullet points");
  ok(plan.steps.find((s) => s.key === "page").variables.page.isPublished === false, "the page stays hidden by default");
  ok(plan.warnings.some((w) => /testimonials must be real/.test(w)), "made-up testimonials are never published");
  ok(!/testimonial|Swimmers say/i.test(pageBody(plan.concept).html), "the page body leaves the testimonials section out");
  ok(plan.summary.products === 2 && plan.summary.variants === 4 && plan.summary.collection === 1 && plan.summary.currency === "GBP" && plan.summary.apiCalls > 0, "the summary counts what will be created", JSON.stringify(plan.summary));
  const one = buildPlan(concept, { includeBrand: false, productHandles: ["tidewarm-dry-bag-20-l"] });
  ok(one.steps.map((s) => s.key).join() === "preflight,product:tidewarm-dry-bag-20-l,finalize", "a single product publishes without collection, page or menu");
  const cheap = clone(concept); cheap.products[1].variants[0].price = "7.00";
  ok(buildPlan(cheap).warnings.some((w) => /negative margin/.test(w)), "a negative margin is flagged before publishing");
  const live = buildPlan(concept, { productStatus: "ACTIVE", publishToOnlineStore: true, addToMenu: true });
  ok(live.steps.some((s) => s.key === "menu") && live.steps.some((s) => s.key === "publish") && live.warnings.some((w) => /ACTIVE/.test(w)), "going live is an explicit option with a warning");
  ok(normaliseThemeOff(), "theme templates cannot be switched on yet (phase 7)");
  function normaliseThemeOff() { return buildPlan(concept, { writeTheme: true }).options.writeTheme === false; }
  ok(adminUrl("tidewarm-test.myshopify.com", "product", "gid://shopify/Product/42") === "https://admin.shopify.com/store/tidewarm-test/products/42", "admin links");
  ok(adminUrl("x.mock.test", "product", "gid://shopify/Product/42") === null && publicUrl("x.mock.test", "page", "tidewarm") === null, "a simulated store gets no links");
}
// ── Client: throttling, retries, auth, pagination, redaction ───────────
{
  const c = clock(); clock.slept = [];
  const shop = createMockShop({ clock: c.now });
  const client = createClient({ shop: shop.shop.domain, token: "shpat_testtoken1234567890", fetch: shop.fetch, sleep: c.sleep, random: () => 0.5 });
  shop.inject.throttle = 2;
  const r = await client.request(`query PlanvyShop { shop { name } }`);
  ok(r.data.shop.name === "Plan-vy Test Store" && clock.slept.length === 2, "THROTTLED is retried with backoff", JSON.stringify(clock.slept));
  shop.inject.http500 = 1;
  ok((await client.request(`query PlanvyShop { shop { name } }`)).data.shop, "a 5xx is retried");
  shop.inject.http500 = 99;
  let e = null; try { await client.request(`query PlanvyShop { shop { name } }`); } catch (x) { e = x; }
  ok(e instanceof ShopifyError && e.kind === "http" && e.requestId, "after the retry limit the error keeps Shopify's request id", e?.message);
  shop.inject.http500 = 0;
  const bad = createClient({ shop: shop.shop.domain, token: "bad", fetch: shop.fetch, sleep: c.sleep });
  e = null; try { await bad.request(`query PlanvyShop { shop { name } }`); } catch (x) { e = x; }
  ok(e?.kind === "auth" && !/bad/.test(e.message), "a rejected token is not retried and not echoed");
  // Drain the bucket: the client pauses on its own.
  shop.state.bucket.available = 300; shop.state.bucket.at = c.now();
  clock.slept = [];
  await client.request(`query PlanvyShop { shop { name } }`);
  await client.request(`query PlanvyShop { shop { name } }`);
  ok(clock.slept.some((ms) => ms > 1000), "a low bucket makes the client wait before the next call", JSON.stringify(clock.slept));
  const menus = await client.paginate(`query PlanvyMenus($after: String) { menus(first: 25, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } }`, {}, "menus");
  ok(menus.length === 1, "pagination collects every node");
  const red = redact({ token: "shpat_abc", note: "uses shpat_abcdefghijklmnop", ok: 1 });
  ok(red.token === "[redacted]" && !/shpat_/.test(red.note) && red.ok === 1, "tokens are redacted from anything stored");
  ok(SHOPIFY_API_VERSION === "2026-07" && shop.state.calls.every((x) => /\/admin\/api\/2026-07\/graphql\.json$/.test(x.url)), "every call goes to the pinned version");
  e = null; try { createClient({ shop: "evil.example.com", token: "x" }); } catch (x) { e = x; }
  ok(e?.kind === "config", "only *.myshopify.com domains are accepted");
}
// ── Schema check ───────────────────────────────────────────────────────
{
  const c = clock();
  const full = createMockShop({ clock: c.now });
  const s1 = await verifySchema(createClient({ shop: full.shop.domain, token: "shpat_x1234567890123456", fetch: full.fetch, sleep: c.sleep }));
  ok(s1.ok && s1.checked > 60, "every field used is checked against the store's schema", `${s1.checked}`);
  const old = createMockShop({ clock: c.now, missingFields: ["ProductSetInput.productOptions", "Mutation.productSet(identifier)"] });
  const s2 = await verifySchema(createClient({ shop: old.shop.domain, token: "shpat_x1234567890123456", fetch: old.fetch, sleep: c.sleep }));
  ok(!s2.ok && s2.missing.includes("ProductSetInput.productOptions") && s2.missing.includes("Mutation.productSet(identifier)"), "a missing field or argument is named", s2.missing.join());
  // 2026-07 deprecates collectionCreate's input argument (in favour of
  // collection): it still works, so it is a warning, not a missing field.
  const dep = createMockShop({ clock: c.now, deprecatedFields: ["Mutation.collectionCreate(input)", "CollectionInput.ruleSet"] });
  const s3 = await verifySchema(createClient({ shop: dep.shop.domain, token: "shpat_x1234567890123456", fetch: dep.fetch, sleep: c.sleep }));
  ok(s3.ok && s3.missing.length === 0 && s3.deprecated.includes("Mutation.collectionCreate(input)") && s3.deprecated.includes("CollectionInput.ruleSet"),
    "a deprecated argument or input field is found and reported as deprecated, not missing", JSON.stringify({ missing: s3.missing, deprecated: s3.deprecated }));
}
// -- Access tokens: pasted token or Dev Dashboard app (client credentials) --
{
  const vault = new Map([["s-token", "shpat_pasted1234567890"], ["s-secret", "cs-very-secret-value"]]);
  const saved = [];
  const secrets = { read: async (id) => vault.get(id) ?? null, saveToken: async (conn, token, expiresAt) => { vault.set("s-cached", token); conn.token_secret_id = "s-cached"; conn.token_expires_at = expiresAt; saved.push(expiresAt); } };
  ok(await accessToken({ auth_kind: "token", token_secret_id: "s-token" }, { secrets }) === "shpat_pasted1234567890", "a pasted token is used as is");
  let e = null; try { await accessToken({ auth_kind: "token", token_secret_id: null }, { secrets }); } catch (x) { e = x; }
  ok(e?.kind === "config" && /disconnected/.test(e.message), "no token: the store reads as disconnected");

  const shop = createMockShop();
  const t0 = Date.parse("2026-10-09T12:00:00Z");
  let t = t0;
  const cc = { id: "c2", auth_kind: "client_credentials", shop_domain: shop.shop.domain, client_id: "abc123client", client_secret_id: "s-secret", token_secret_id: null, token_expires_at: null };
  const exchanges = () => shop.state.calls.filter((c) => c.op === "TokenExchange").length;
  const t1 = await accessToken(cc, { secrets, fetch: shop.fetch, now: () => t });
  ok(t1 === "mock-cc-token-1" && exchanges() === 1 && saved[0] === new Date(t0 + 86399 * 1000).toISOString(), "client credentials are exchanged for a token whose expiry comes from expires_in", saved[0]);
  t = t0 + 3600 * 1000;
  ok(await accessToken(cc, { secrets, fetch: shop.fetch, now: () => t }) === "mock-cc-token-1" && exchanges() === 1, "a cached token is reused while it is valid");
  t = t0 + (86399 - 200) * 1000;
  ok(await accessToken(cc, { secrets, fetch: shop.fetch, now: () => t }) === "mock-cc-token-2" && exchanges() === 2, "a token about to expire is renewed by asking again");
  t = t0 + (86399 + 3600) * 1000;
  ok(await accessToken(cc, { secrets, fetch: shop.fetch, now: () => t }) === "mock-cc-token-2" && exchanges() === 2, "the renewed token is cached in turn");
  ok(await accessToken(cc, { secrets, fetch: shop.fetch, now: () => t, fresh: true }) === "mock-cc-token-3" && exchanges() === 3, "a connection test asks for a new token, so newly released scopes count at once");
  ok(await accessToken(cc, { secrets, fetch: shop.fetch, now: () => t }) === "mock-cc-token-3" && exchanges() === 3, "and the new token replaces the cached one");
  const client = createClient({ shop: shop.shop.domain, token: "mock-cc-token-2", fetch: shop.fetch, sleep: async () => {} });
  ok((await client.request(Q.shop)).data.shop.plan.publicDisplayName === "Development", "the renewed token works for Admin API calls");

  const wrong = { ...cc, token_secret_id: null, token_expires_at: null, client_secret_id: "s-wrong" };
  vault.set("s-wrong", "bad");
  e = null; try { await accessToken(wrong, { secrets, fetch: shop.fetch, now: () => t }); } catch (x) { e = x; }
  ok(e?.kind === "auth" && /Client ID and secret/.test(e.message) && !e.message.includes("cs-very-secret-value"), "a rejected secret gives an actionable error without the secret", e?.message);
  const other = createMockShop({ notPermitted: true });
  e = null; try { await accessToken({ ...cc, shop_domain: other.shop.domain, token_secret_id: null, token_expires_at: null }, { secrets, fetch: other.fetch, now: () => t }); } catch (x) { e = x; }
  ok(e?.kind === "auth" && /same organisation/.test(e.message), "a store outside the app's organisation is explained", e?.message);
}
// ── Pipeline ───────────────────────────────────────────────────────────
// The connection names a real-looking domain so admin links are built; the
// client still talks to the simulated store.
const conn = { id: "c1", shop_domain: "plan-vy-test.myshopify.com", api_version: SHOPIFY_API_VERSION };
async function setup(extra = {}) {
  const c = clock();
  const shop = createMockShop({ clock: c.now, ...extra });
  const client = createClient({ shop: shop.shop.domain, token: "shpat_x1234567890123456", fetch: shop.fetch, sleep: c.sleep });
  const base = memStore();
  const store = withConnection(base, conn.id);
  return { c, shop, client, base, store };
}
const job = (id, options = {}, brand = "tidewarm") => { JOB_BRAND[id] = brand; return { id, connection_id: conn.id, brand_id: brand, options }; };
{
  const { shop, client, base, store } = await setup();
  const r = await runJob({ job: job("j1"), concept, connection: conn, client, store });
  ok(r.status === "succeeded", "happy path: the job succeeds", JSON.stringify(r));
  ok(shop.state.products.size === 2 && [...shop.state.products.values()].every((p) => p.status === "DRAFT"), "two draft products in the store");
  ok(shop.state.collections.size === 1 && shop.state.pages.size === 1 && [...shop.state.pages.values()][0].isPublished === false && shop.state.metaobjects.size === 1, "collection, hidden page and brand entry");
  const steps = await base.getSteps("j1");
  ok([...steps.values()].every((s) => s.status === "succeeded") && steps.get("product:tidewarm-changing-robe").shopify_gid, "every step is saved with its Shopify id");
  ok(base.resourceList.filter((x) => x.job_id === "j1").length === 6 && base.resourceList.some((x) => x.admin_url?.startsWith("https://admin.shopify.com/store/")), "created resources (2 products, collection, page, brand entry and its type) are recorded with admin links", String(base.resourceList.length));
  ok(!JSON.stringify([...steps.values()]).includes("shpat_"), "no token in the saved steps");

  // Same job again: nothing new is sent.
  const before = shop.state.calls.length;
  await runJob({ job: job("j1"), concept, connection: conn, client, store });
  ok(shop.state.calls.length === before, "running a finished job again sends nothing (idempotent)");

  // A new job for the same brand updates what Plan-vy made, no duplicates.
  const edited = clone(concept); edited.products[0].variants[0].price = "99.00";
  const r2 = await runJob({ job: job("j2"), concept: edited, connection: conn, client, store });
  ok(r2.status === "succeeded" && shop.state.products.size === 2 && shop.state.collections.size === 1 && shop.state.pages.size === 1, "publishing the brand again updates instead of duplicating", JSON.stringify(r2));
  ok([...shop.state.products.values()].find((p) => p.handle === "tidewarm-changing-robe").input.variants[0].price === "99.00", "the edited price reached the store");
  const j2plan = planRollback(base.resourceList.filter((x) => x.job_id === "j2"), "delete");
  ok(!j2plan.some((a) => a.op.startsWith("delete")), "deleting a re-publish never removes what an earlier job made", j2plan.map((a) => a.op).join());

  // Another brand with the same handles in the same store: a conflict, never an update.
  const before2 = shop.state.calls.filter((x) => x.op === "PlanvyProductSet").length;
  const r3 = await runJob({ job: job("j2b", {}, "other-brand"), concept: edited, connection: conn, client, store });
  ok(r3.status === "failed" && /not made by this brand/.test(r3.error.message) && shop.state.calls.filter((x) => x.op === "PlanvyProductSet").length === before2, "another brand's products with the same handle are a conflict, not an update", r3.error?.message);

  // Undo j2 softly: products to their earlier status, page hidden.
  const rb = await runRollback({ job: job("j2"), mode: "unpublish", client, store });
  ok(rb.status === "rolled_back" && shop.state.products.size === 2, "soft undo keeps the products", JSON.stringify(rb));
}
{
  // Someone else's product already uses the handle: stop before writing.
  const { shop, client, store } = await setup();
  shop.state.products.set("gid://shopify/Product/9", { id: "gid://shopify/Product/9", handle: "tidewarm-dry-bag-20-l", status: "ACTIVE", title: "Someone else" });
  const r = await runJob({ job: job("j3"), concept, connection: conn, client, store });
  ok(r.status === "failed" && /not made by this brand/.test(r.error.message) && shop.state.products.size === 1, "a handle in use by someone else stops the job before any write", r.error?.message);
}
{
  // Page creation fails once: partially failed, retry resumes at the page.
  const { shop, client, base, store } = await setup();
  shop.inject.userErrors.pageCreate = 1;
  const r = await runJob({ job: job("j4"), concept, connection: conn, client, store });
  ok(r.status === "partially_failed" && /Simulated refusal/.test(r.error.message) && base.jobs.get("j4").status === "partially_failed", "a failing step leaves what succeeded and marks the job", JSON.stringify(r));
  const productSets = () => shop.state.calls.filter((x) => x.op === "PlanvyProductSet").length;
  const n = productSets();
  const r2 = await runJob({ job: job("j4"), concept, connection: conn, client, store });
  ok(r2.status === "succeeded" && productSets() === n && shop.state.pages.size === 1, "retry resumes at the failed step without re-creating products");
  ok((await base.getSteps("j4")).get("page").attempts === 2, "attempts are counted per step");
}
{
  // Time budget: stop between steps, continue in a new invocation.
  const { c, client, base, store } = await setup();
  let t = 0;
  const r = await runJob({ job: job("j5"), concept, connection: conn, client, store, budgetMs: 1, now: () => (t += 1) });
  ok(r.status === "continue" && base.jobs.get("j5").status === "queued", "past the time budget the job is queued to continue");
  const r2 = await runJob({ job: job("j5"), concept, connection: conn, client, store });
  ok(r2.status === "succeeded", "the next invocation finishes it");
  void c;
}
{
  // Going live: menu item and Online Store publication, then a full undo.
  const { shop, client, base, store } = await setup();
  const r = await runJob({ job: job("j6", { productStatus: "ACTIVE", publishToOnlineStore: true, addToMenu: true, publishPage: true }), concept, connection: conn, client, store });
  ok(r.status === "succeeded", "live publish succeeds", JSON.stringify(r.error));
  const menu = shop.state.menus.get("gid://shopify/Menu/1");
  ok(menu.items.length === 3 && menu.items[2].type === "COLLECTION", "the brand is added to the main menu, earlier items kept");
  ok(shop.state.published.size === 3, "collection and both products published to the Online Store");
  const plan = planRollback(base.resourceList.filter((x) => x.job_id === "j6"), "delete");
  ok(plan.some((a) => a.op === "restoreMenu") && plan.some((a) => a.op === "deleteProduct") && !plan.some((a) => /definition/i.test(a.op)), "the delete plan lists what goes and never the shared metaobject type");
  const rb = await runRollback({ job: job("j6"), mode: "delete", client, store });
  ok(rb.status === "rolled_back" && shop.state.products.size === 0 && shop.state.pages.size === 0 && shop.state.collections.size === 0 && shop.state.metaobjects.size === 0 && shop.state.defs.size === 1, "delete removes what the job created, keeps the type", JSON.stringify([shop.state.products.size, shop.state.pages.size]));
  ok(menu.items.length === 2 && shop.state.published.size === 0, "the menu is restored and publications withdrawn");
}
{
  const { client, store } = await setup({ currency: "SEK" });
  const r = await runJob({ job: job("j7"), concept, connection: conn, client, store });
  ok(r.status === "failed" && /sells in SEK/.test(r.error.message), "a currency mismatch stops the job", r.error?.message);
}
{
  const { client, store } = await setup({ scopes: ["write_products"] });
  const r = await runJob({ job: job("j8"), concept, connection: conn, client, store });
  ok(r.status === "failed" && r.error.kind === "scopes" && /write_content/.test(r.error.message) && /check the store again/.test(r.error.message), "missing scopes are named with what they are for and how to add them", r.error?.message);
  ok(/Dev Dashboard/.test(scopeFix("client_credentials")) && /release it/.test(scopeFix("client_credentials")) && /approve the new access/.test(scopeFix("client_credentials")) && !/Dev Dashboard/.test(scopeFix("token")), "the fix names the Dev Dashboard and the approval in the store only for apps connected with client credentials");
}
{
  const { client, store } = await setup({ missingFields: ["PageCreateInput.isPublished"] });
  const r = await runJob({ job: job("j9"), concept, connection: conn, client, store });
  ok(r.status === "failed" && r.error.kind === "schema" && /PageCreateInput\.isPublished/.test(r.error.message), "a field missing from the API version stops the job before writing", r.error?.message);
}
{
  const { client, base, store } = await setup();
  const broken = clone(concept); broken.products[0].variants[0].price = "-3";
  const r = await runJob({ job: job("j10"), concept: broken, connection: conn, client, store });
  ok(r.status === "failed" && base.jobs.get("j10").error.kind === "validation", "an invalid concept never reaches Shopify");
}

// Policy pages: validated, planned with brand handles, published, updated, undone.
{
  const pol = clone(concept);
  pol.policies = { terms: { title: "Terms", body: "<p>Sold by Tidewarm Ltd.</p><script>x()</script>" }, returns: { title: "Returns", body: "<p>14 days.</p>" }, shipping: { title: "Delivery", body: "<p>3–6 days.</p>" }, privacy: { title: "Privacy", body: "<p>We keep orders.</p>" } };
  const v = validateConcept(pol);
  ok(v.ok && v.value.policies.terms.body === "<p>Sold by Tidewarm Ltd.</p>", "policy pages are validated and their HTML sanitised", v.errors.join());
  const plan = buildPlan(pol, { includePolicies: true });
  const keys = plan.steps.filter((s) => s.kind === "policyPage").map((s) => s.handle);
  ok(plan.ok && keys.join() === "tidewarm-terms,tidewarm-returns,tidewarm-shipping,tidewarm-privacy" && plan.summary.policyPages === 4 && plan.steps[0].check.policyHandles.length === 4, "four policy pages with the brand's handle, checked in the preflight", keys.join());
  const se = clone(pol); se.market = "SE";
  ok(buildPlan(se, { includePolicies: true }).steps.some((s) => s.handle === "tidewarm-retur-och-angerratt"), "Swedish brands get Swedish page handles");
  const owned = { ...pol, business: { legalName: "Tidewarm Ltd" }, economics: { adCost: "5" }, logo: { style: "badge" }, compliance: { attested: { gpsr: { at: "2026-10-15T08:00:00Z", products: ["a"] } } } };
  const kept = keptOnRegenerate(owned);
  ok(Object.keys(kept).join() === "business,economics,logo,compliance" && kept.business.legalName === "Tidewarm Ltd" && kept.business !== owned.business && !("policies" in kept) && Object.keys(keptOnRegenerate({ name: "x" })).length === 0,
    "a new whole concept keeps the owner's store details, settings and confirmations, as copies, but not the policy pages");
  ok(!buildPlan(pol, {}).steps.some((s) => s.kind === "policyPage"), "policy pages are only published when chosen");
  const gap = clone(pol); gap.policies.shipping.body = "<p>Delivered by [FILL IN: carrier] in 3–6 days.</p>";
  ok(!buildPlan(gap, { includePolicies: true }).ok && /fill in the marked gaps/.test(buildPlan(gap, { includePolicies: true }).errors[0]), "a page with a [FILL IN] mark cannot be published");
  ok(!buildPlan(concept, { includePolicies: true }).ok, "choosing policy pages for a brand without them is an error, not a silent skip");

  const { shop, client, base, store } = await setup();
  const r = await runJob({ job: job("jp1", { includePolicies: true, publishPage: true }), concept: pol, connection: conn, client, store });
  const pages = [...shop.state.pages.values()];
  ok(r.status === "succeeded" && pages.length === 5 && pages.filter((p) => /^tidewarm-/.test(p.handle)).every((p) => p.isPublished), "the brand page and four published policy pages are created", JSON.stringify(r));
  const edited = clone(pol); edited.policies.returns.body = "<p>30 days.</p>";
  const r2 = await runJob({ job: job("jp2", { includePolicies: true, publishPage: true }), concept: edited, connection: conn, client, store });
  ok(r2.status === "succeeded" && shop.state.pages.size === 5 && [...shop.state.pages.values()].find((p) => p.handle === "tidewarm-returns").body === "<p>30 days.</p>", "publishing again updates the policy pages instead of duplicating them");
  const rb = await runRollback({ job: job("jp2"), mode: "unpublish", client, store });
  ok(rb.status === "rolled_back" && [...shop.state.pages.values()].filter((p) => /^tidewarm-/.test(p.handle)).every((p) => p.isPublished === true), "undoing the update puts the pages back as they were before it (published by the first job)", JSON.stringify(rb.done));
  const rb1 = await runRollback({ job: job("jp1"), mode: "unpublish", client, store });
  ok(rb1.status === "rolled_back" && [...shop.state.pages.values()].every((p) => p.isPublished === false), "undoing the first publish hides every page it made");
  void base;
}
{
  const pol = clone(concept);
  pol.policies = { terms: { title: "Terms", body: "<p>x</p>" } };
  const { shop, client, store } = await setup();
  shop.state.pages.set("gid://shopify/Page/77", { id: "gid://shopify/Page/77", handle: "tidewarm-terms", isPublished: true, title: "Someone's terms" });
  const r = await runJob({ job: job("jp3", { includePolicies: true }), concept: pol, connection: conn, client, store });
  ok(r.status === "failed" && /tidewarm-terms/.test(r.error.message), "a page someone else made with the same handle stops the job before anything is written", r.error?.message);
}

// Unit economics: VAT, landed cost, shipping, fees, returns and ad cost per order.
{
  const se = econSettings({ market: "SE", economics: { shipping: "49", adCost: "150" } });
  ok(se.vat === 0.25 && se.feePct === 2.9 && se.feeFixed === 0 && se.assumed.includes("feePct") && !se.assumed.includes("shipping"), "Swedish settings: 25% VAT, assumed fees are marked as assumptions");
  const x = orderEconomics({ price: "499.00", cost: "120.00", settings: se });
  // net 399.20; fees 14.47; (1-0.03)*399.20 - 120 - 49 - 14.47 = 203.75
  ok(x.net === 399.2 && x.fees === 14.47 && x.contribution === 203.75 && x.breakEvenCpa === 203.75 && x.profit === 53.75 && x.marginPct === 13.5, "contribution, break-even ad cost and profit per order", JSON.stringify(x));
  ok(x.breakEvenRoas === 2.45, "break-even ROAS is the order value per unit of ad spend that leaves nothing", x.breakEvenRoas);
  // Price that breaks even after 150 in ads: 319 / (0.97/1.25 - 0.029) = 427.04
  ok(x.breakEvenPrice === 427.04 && x.targetPrice === 543.44, "the price needed to break even, and to make the target margin, after the ad cost", `${x.breakEvenPrice} ${x.targetPrice}`);
  const check = orderEconomics({ price: x.breakEvenPrice, cost: 120, settings: se });
  ok(Math.abs(check.profit) < 0.02, "at the break-even price the profit is zero", check.profit);
  const noAds = orderEconomics({ price: 499, cost: 120, settings: econSettings({ market: "SE" }) });
  ok(noAds.profit === null && noAds.marginPct === null && noAds.contribution > 0, "without an ad cost only the break-even ad cost is shown");
  const hopeless = orderEconomics({ price: 100, cost: 10, settings: { ...se, returnPct: 80, feePct: 19, adCost: 10 } });
  ok(hopeless.breakEvenPrice === null && hopeless.targetPrice === null, "when no price can cover the costs, no price is suggested");
  ok(econProblems({ ...se, returnPct: 120, shipping: -1 }).length === 2, "settings out of range are reported");
  const c = clone(concept); c.market = "SE"; c.economics = { shipping: 49, adCost: 400 };
  const all = conceptEconomics(c);
  ok(all.rows.length === c.products.length && all.priced >= 1 && Array.isArray(all.losing) && all.losing.length >= 1, "a concept lists every product and which lose money at the ad cost", JSON.stringify(all.losing));
  const nocost = clone(concept); nocost.products.forEach((p) => delete p.costEstimate);
  ok(conceptEconomics(nocost).missingCost.length === nocost.products.length && conceptEconomics(nocost).priced === 0, "products without a landed cost are listed, not guessed");
}

// Logo: layout from name, palette and font; the SVG escapes the name.
{
  const measure = (text, px) => text.length * px * 0.6;
  const c = { ...clone(concept), name: "Åsa & <Co>" };
  const st = logoSettings(c);
  ok(st.style === "badge" && st.shape === "circle" && !st.upper, "a brand without a saved logo gets the badge style");
  const l = logoLayout(c, { measure });
  const txt = l.items.filter((i) => i.t === "text");
  ok(txt[0].text === "Å" && txt[1].text === "Åsa & <Co>" && l.w > l.h && l.bg, "the badge has the initial (Å) and the name, with the brand's background", JSON.stringify(txt.map((t) => t.text)));
  const svg = logoSvg(l, { title: c.name });
  ok(svg.includes("Åsa &amp; &lt;Co&gt;") && !svg.includes("<Co>") && svg.startsWith("<svg"), "the name is escaped in the SVG");
  const stacked = logoLayout(c, { measure, style: "stacked", shape: "diamond", upper: true, transparent: true });
  ok(stacked.h > stacked.w / 4 && stacked.bg === null && stacked.items.some((i) => i.t === "path") && stacked.items.at(-1).text === "ÅSA & <CO>", "stacked, diamond, capitals and a transparent background");
  const word = logoLayout(c, { measure, style: "wordmark" });
  ok(word.items.filter((i) => i.t === "text").length === 1, "the wordmark has the name only, with an accent dot");
  ok(logoSettings({ ...c, logo: { style: "x", shape: "y" } }).style === "badge", "unknown saved settings fall back to the defaults");
}

// Checks before selling: store details, withdrawal, delivery, product rules.
{
  const se = clone(concept); se.market = "SE";
  se.products[0].title = "Golden Hour LED Lamp"; se.products[0].tags = ["lamp", "usb"];
  let ch = complianceChecks(se);
  const ids = ch.items.map((i) => i.id);
  ok(!ch.done && ["business", "vat", "withdrawal", "delivery", "complaints", "gpsr", "ce", "weee"].every((x) => ids.includes(x)), "a Swedish brand with a lamp gets the EU, CE and electrical-waste checks", ids.join());
  ok(ch.items.find((i) => i.id === "business").status === "missing" && ch.items.find((i) => i.id === "vat").status === "ok", "empty store details are missing; VAT is already in every price");
  ok(productGroups({ title: "Babyfilt" }).includes("toys") && productGroups({ title: "Ansiktsserum" }).includes("cosmetics") && productGroups({ title: "Skrivbordslampa med USB" }).includes("electrical") && !productGroups({ title: "Dry bag" }).length && !productGroups({ title: "Ledger notebook", productType: "Fantastic stationery" }).length, "product groups come from words in the product, Swedish compounds too, without matching inside unrelated words");
  ok(businessGaps({ legalName: "X AB", orgNumber: "5566", address: "Gatan 1", email: "a@b.se" }, "SE").includes("orgNumber:format") && !businessGaps({ legalName: "X AB", orgNumber: "556677-8899", address: "Gatan 1", email: "a@b.se" }, "SE").length, "a Swedish organisation number must look like 556677-8899");
  se.business = { legalName: "Setlight AB", orgNumber: "556677-8899", address: "Gatan 1, 111 22 Stockholm", email: "hej@setlight.se", shipping: { maxDays: 7 }, returns: { days: 14 }, euResponsible: { name: "Setlight AB", address: "Gatan 1", email: "hej@setlight.se" } };
  ch = complianceChecks(se);
  ok(ch.items.find((i) => i.id === "gpsr").status === "confirm" && ch.items.find((i) => i.id === "withdrawal").status === "confirm" && !ch.done, "with details filled in, what the page cannot see still needs a confirmation");
  let done = se;
  for (const i of ch.items.filter((x) => x.status === "confirm")) done = attest(done, i.id, i.products);
  ok(complianceChecks(done).done, "confirming every remaining item completes the checklist");
  const more = clone(done); more.products.push({ ...clone(more.products[0]), title: "LED Strip", handle: "setlight-led-strip" });
  ok(!complianceChecks(more).done && complianceChecks(more).blocking.some((i) => i.id === "ce"), "a new electrical product needs the CE confirmation again");
  const short = clone(done); short.business.returns.days = 10;
  ok(complianceChecks(short).items.find((i) => i.id === "withdrawal").status === "missing", "a return period under 14 days is not accepted");
  const uk = clone(concept); uk.market = "UK";
  ok(!complianceChecks(uk).items.some((i) => i.id === "gpsr"), "the GPSR item is for the EU market only");
}

// Name check: DNS first, then the registry's RDAP where IANA lists one.
{
  ok(domainLabel("Åsa & Co!") === "asa-and-co" && domainLabel("Setlight") === "setlight", "names become domain labels (å folds, & becomes and)");
  ok(domainCandidates("Golden Hour", "SE").join() === "goldenhour.se,goldenhour.com,goldenhour.nu,goldenhour.shop,golden-hour.se,golden-hour.com,golden-hour.nu,golden-hour.shop" && domainCandidates("Tidewarm", "UK")[0] === "tidewarm.co.uk", "domains per market, with and without the hyphen");
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    if (url.includes("data.iana.org")) return res(200, { services: [[["com", "net"], ["https://rdap.verisign.com/com/v1/"]], [["uk"], ["https://rdap.nominet.uk/uk/"]]] });
    const q = new URL(url).searchParams.get("name");
    if (url.startsWith("https://dns.google")) {
      if (q === "taken.com" || q === "taken.se") return res(200, { Status: 0, Answer: [{ name: q, type: 2 }] });
      if (q === "dnsdown.com") return res(500, {});
      return res(200, { Status: 3 });
    }
    if (url.includes("rdap.verisign.com")) return url.endsWith("/nodns.com") || url.endsWith("/dnsdown.com") ? res(200, {}) : res(404, {});
    return res(500, {});
  };
  const boot = { com: "https://rdap.verisign.com/com/v1/" };
  ok((await checkDomain("taken.com", { fetch: fake, bootstrap: boot })).status === "taken", "a domain with name servers is taken");
  ok((await checkDomain("brandnew.com", { fetch: fake, bootstrap: boot })).status === "free", "no DNS and 404 at the registry: free");
  ok((await checkDomain("nodns.com", { fetch: fake, bootstrap: boot })).status === "taken", "registered without name servers is still taken");
  ok((await checkDomain("brandnew.se", { fetch: fake, bootstrap: boot })).status === "probably free", "no RDAP for .se: no DNS means probably free, not free");
  ok((await checkDomain("dnsdown.com", { fetch: fake, bootstrap: boot })).status === "taken" && (await checkDomain("dnsdown.se", { fetch: async () => { throw new Error("offline"); }, bootstrap: {} })).status === "unknown", "when DNS fails the registry decides; when both fail the answer is unclear");
  const all = await checkNames(["Taken", "Brandnew"], "SE", { fetch: fake });
  ok(all.Taken.find((r) => r.domain === "taken.se").status === "taken" && all.Brandnew.find((r) => r.domain === "brandnew.com").status === "free" && calls.filter((u) => u.includes("data.iana.org")).length === 1, "several names, one bootstrap fetch", JSON.stringify(all.Brandnew));
}

// The edge function's copies (what was deployed) match src/shopify.
{
  const lib = join(root, "supabase/functions/intel-shopify/lib");
  const ascii = (s) => s.replace(/[^\x00-\x7f]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
  const files = (await readdir(lib)).filter((f) => f.endsWith(".js"));
  const stale = [];
  for (const f of files) if ((await readFile(join(lib, f), "utf8")) !== ascii(await readFile(join(root, "src/shopify", f), "utf8"))) stale.push(f);
  ok(files.length >= 10 && !stale.length, "the edge function's copies match src/shopify (npm run edge:sync)", stale.join());
}

console.log(fail ? `✗ ${fail} failed, ${pass} passed` : `✓ ${pass} Shopify tests passed`);
process.exit(fail ? 1 : 0);

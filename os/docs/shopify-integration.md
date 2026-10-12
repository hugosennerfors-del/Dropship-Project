# Shopify integration and Brand Builder

The Brand Builder (`#/brands`) turns a niche into complete brand concepts with Claude. The concepts cover name, positioning, palette, fonts, products with variants and prices, page plan and copy. You edit and preview a concept, then publish it to a Shopify store with **Publish brand to Shopify**. This document covers how that works, what it needs and what is not built yet.

## What "publish" means

Shopify has no public API for creating a store, so a brand is published **into** a store you connect ("store within the store"):

| In Shopify | Made by | Notes |
|---|---|---|
| Products | `productSet` | Tagged `brand:<handle>` and `plan-vy`. The brand is also in the metafield `custom.brand`. Status `DRAFT` unless you choose Active. |
| Smart collection | `collectionCreate` | Rule: tag equals `brand:<handle>`. |
| Brand entry | `metaobjectDefinitionCreate` (type `plan_vy_brand`, once per store), `metaobjectUpsert` | Holds palette, fonts, story, USPs and the logo brief, so a theme can read them. |
| Page | `pageCreate` / `pageUpdate` | The page plan as plain, sanitised HTML. **Hidden** unless you choose to publish it. |
| Menu item (optional) | `menuUpdate` | Earlier items are saved and restored on undo. |
| Online Store listing (optional) | `publishablePublish` | Off by default. |

Theme templates (`themeFilesUpsert`), image uploads, translations and blog posts are **not built** (see the end of this document).

You can connect several stores (`intel.shopify_connections`). One store per brand is then a choice of target store, not a rebuild.

## Architecture

```
page (claude.ai artifact)
  ├─ Claude (artifact "sample" capability): concepts through the tool submit_concept
  └─ n8n connector (viewer's own)
       ├─ "Plan-vy · Intelligence-DB"      intel.api_read / intel.api_write  (no secrets ever)
       └─ "Plan-vy · Shopify-anslutning"   intel.shopify_intake → Vault      (saves no executions)
Supabase (schema intel)
  ├─ tables: shopify_connections, brands, brand_versions, publish_jobs, publish_job_steps,
  │          created_resources, ai_generations, audit_log, sim_stores
  ├─ Vault: Admin API tokens, Dev Dashboard client secrets, cached client-credentials tokens
  └─ intel.fn_dispatch (pg_net) ──POST {action,id} + x-intel-secret──▶ Edge Function "intel-shopify"
Edge Function "intel-shopify"  (the only code that reads a token or talks to Shopify)
  ├─ test      connection check: shop, plan, currency, scopes, API versions, introspection
  ├─ run       claims the job (lease), runs the pipeline within 100 s, re-dispatches itself to continue
  └─ rollback  undo (soft by default)
```

Code: `src/shopify/` is shared by the page, the edge function and the tests.

- `version.js`: the pinned API version.
- `client.js`: the GraphQL client (throttling, retries, request ids, redaction).
- `auth.js`: tokens.
- `documents.js`: every query and mutation, with the schema paths they need.
- `schema.js`: introspection check.
- `concept.js` and `concept-schema.js`: the strict concept shape, validation, HTML sanitising, handles, margins.
- `mapping.js`: concept → exact steps and variables; also the rollback plan.
- `pipeline.js`: runs the steps.
- `edge.js`: the edge function.
- `mockshop.js`: the simulated store.
- `brands.js`: the page side.

`supabase/functions/intel-shopify/lib/` holds copies made by `npm run edge:sync`; a test fails if they drift from `src/shopify`. The SQL is in `supabase/migrations/`.

### Publish pipeline

The steps run in this order. Each one is saved with its request, response, Shopify id and attempts in `publish_job_steps`:

1. **validate**: the concept against the schema, prices, handles, image URLs.
2. **preflight**:
   - token;
   - currency matches the concept;
   - scopes (write implies read);
   - introspection of every field the job will send;
   - handles free, or made by *this brand* in this store.
3. **metaobject-definition**: only if missing.
4. **product:<handle>**: one step per product (`productSet`, updates what this brand made earlier).
5. **collection**, **metaobject**, **page**.
6. **menu** and **publish**: only when chosen.
7. **finalize**.

Properties of the pipeline:

- **Idempotency key per job.** The same key returns the same job, and a re-run skips steps that succeeded.
- **Retry** resumes at the failed step.
- **Undo** acts only on resources recorded in `created_resources` for that job:
  - The default is **soft**: products to draft (or their earlier status), the page hidden, listings withdrawn, menus restored.
  - **Delete permanently** is a separate choice that needs `DELETE` typed. It never deletes anything that existed before the job, nor the shared metaobject type.
- Every start, retry, failure and undo is in `audit_log`.

### Rate limits

`client.js` does the following:

- reads `extensions.cost.throttleStatus` after every call and pauses on its own below 20 % of the bucket;
- retries `THROTTLED`, HTTP 429 and 5xx with exponential backoff and jitter, at most 5 times;
- keeps Shopify's `x-request-id` for support;
- paginates with `pageInfo`.

Publishing always runs as a background job, never in a page request.

## Connecting a store

Since **1 January 2026** Shopify no longer lets a store create new "legacy custom apps" under *Settings > Apps > Develop apps*, so there are two ways to connect.

1. **Dev Dashboard app (recommended for new stores).**
   - Create an app in Shopify's Dev Dashboard, in the **same organisation** as the store.
   - Choose the scopes below, release a version and install it on the store.
   - Paste the **Client ID** and **client secret** under *Data > Shopify stores*.
   - The edge function exchanges them for an Admin API token with the client credentials grant (`POST https://{shop}/admin/oauth/access_token`, `grant_type=client_credentials`). That token lasts `expires_in` seconds (about 24 h). It is cached in Vault and renewed 5 minutes before it expires.
   - A store outside the app's organisation answers `shop_not_permitted`; the page says so.
2. **Admin API token.** For a custom app made in the store admin before 2026. Paste its `shpat_…` token.

**Not built: OAuth with the authorization-code grant**, which is needed for stores you do not own (several merchants). It would be a third kind in `auth.js`, behind the same interface, with HMAC checks and the compliance webhooks.

### Scopes (request only these)

| Scope | Why |
|---|---|
| `write_products` | create and update products, variants and the collection (includes `read_products`: find handles already in use) |
| `write_content` | create the brand page (includes `read_content`) |
| `write_metaobject_definitions` | create the `plan_vy_brand` metaobject type once |
| `write_metaobjects` | save the brand entry (includes `read_metaobjects`) |
| `write_online_store_navigation` (optional) | add the brand to a menu |
| `write_publications` (optional) | list products and the collection on the Online Store channel |

The app does **not** request themes, files, translations, inventory or orders, because those features are not built.

**Adding a scope later.** For a Dev Dashboard app: create a new version with the scope added and release it. For a store in the app's own organisation, the release is the approval (shopify.dev, "Manage access scopes"). Then press *Check access again* in the publish dialog, or *Test* under *Data > Shopify stores*. A connection test always asks Shopify for a new client-credentials token, so a newly released scope counts at once instead of after the cached token expires. Products need status **Active** as well as the Online Store listing before shoppers can see them; the dialog's *Visible to shoppers now* choice sets both.

### Where secrets live

- **Tokens and client secrets.** They go once from the page form (password fields, cleared at once) through the n8n workflow **Plan-vy · Shopify-anslutning**. That workflow stores no execution data, success or failure. From there they go to `intel.shopify_intake` and into **Supabase Vault**.
- **SQL logging.** `shopify_intake` never raises. Postgres logs the text of failing statements (`log_min_error_statement = error`), and that text would carry the secret. A refusal is therefore returned as data and written to the connection's `last_error`, without the secret.
- **What the page sees.** Never a token. It sees `hasToken`, scopes, status and when a client-credentials token renews. The Intelligence-DB workflow refuses any payload that looks like a Shopify token.
- **Database functions.** Only the database owner can run them: n8n's Postgres credential and the edge function. Execute rights are revoked from `anon` and `authenticated`, and RLS is on every table.
- **Edge function.** It accepts only calls carrying `x-intel-secret`, a random value generated in the database (Vault `intel_fn_secret`) and compared in constant time. That is why `verify_jwt` is off.
- **Disconnecting.** It deletes the token and the client secret from Vault and keeps the history.

### Live or test

- Every connection is marked **test** or **live**.
- A store Shopify does not report as a development store (`plan.partnerDevelopment = false`) is treated as **live**, whatever was chosen (database trigger).
- Publishing to a live store needs the store's address typed in the publish dialog. The database also refuses `publish.start` for a live store without that confirmation.
- Simulated stores (`*.mock.test`) are always test stores.

## Setting up a development store

1. Shopify Dev Dashboard > Stores > create a **development store** (free).
2. Dev Dashboard > Apps > create an app. Under Versions:
   - choose Admin API version `2026-07`;
   - choose the scopes above;
   - release the version and install the app on the development store.
3. Copy the Client ID and secret from the app's Settings.
4. In the page: *Data > Shopify stores > Dev Dashboard app*. Fill in the store address, Client ID and secret, choose "Development or test store", then **Connect and test**.
5. Check from your machine (read-only):
   `SHOPIFY_SHOP=… SHOPIFY_CLIENT_ID=… SHOPIFY_CLIENT_SECRET=… npm run shopify:schema`
6. Publish a brand as drafts. Check it in the store admin, then use **Undo publish**.

Before a real store exists, use **Add a simulated store** under *Data > Shopify stores*. It runs the same pipeline and edge function against a store kept in `intel.sim_stores`, with no Shopify involved.

## API version and upgrades

- `src/shopify/version.js` pins `2026-07`, the newest version Shopify listed as stable when this was written. `2026-10` was a release candidate.
- Every connection test and every job preflight checks every field the integration sends against the store's own schema (introspection, 102 paths).
- If a field is missing, nothing is written and the missing paths are named.

Once a quarter:

1. Read the release notes for products, collections, pages, metaobjects, menus and publications.
2. Change the constant.
3. Run `npm run shopify:schema` against a development store.
4. Run `npm run edge:sync`, `npm test`, and deploy the edge function.

## Brand Builder (AI)

- **Input:**
  - niche or idea (required), or *Suggest niches for me*;
  - audience, price level, tone;
  - market and language: UK in GBP, or Sweden in SEK with Swedish copy;
  - product type;
  - 1–5 concepts, 1–12 products each.
- **Structured output.** Claude submits each concept through a page tool, `submit_concept`. The tool's input schema is `CONCEPT_TOOL_SCHEMA`, a compact copy of `CONCEPT_JSON_SCHEMA` under the 4 KB tool limit. `validateConcept` checks each submission. An invalid concept is refused with the exact fields to fix, and Claude resubmits. Only valid concepts are saved; they show up one at a time. Where the view cannot run tools, the page asks for JSON and validates it the same way.
- **Prompt injection.** The user's text sits between `<brief>` delimiters, with an instruction that it is data and that instructions inside it must be ignored.
- **Versions.**
  - Every accepted concept is saved as a brand (version 1). Edits and regenerations make new versions; earlier versions are kept in `brand_versions`.
  - Product handles are fixed on the first save, so renaming a product updates the same Shopify product.
  - A duplicate gets new handles.
- **Limits and cost.**
  - The cap on brand generations per day is set under *Data > Shopify stores*. It is enforced in the database and counts every generation.
  - The same brief within 24 hours reuses the earlier answer (`input_hash`).
  - Tokens are logged as estimates from text length. Claude usage is paid by the viewer's own Claude plan, so there is no per-call price to log (`cost_cents` stays empty).
- **Testimonials.** Fabricated reviews are never published. A testimonials section stays a placeholder in the preview and is left out of the page.

## Tests

```
npm test                 unit, Shopify (77), build, smoke, UI in Chromium (87)
npm run test:shopify     the Shopify suite on its own
npm run shopify:schema   contract check (simulated store, or a real one with SHOPIFY_* set)
```

The Shopify suite runs against `mockshop.js`. It covers:

- validation, sanitising, handles and margins;
- the client: throttling, 5xx, auth, pauses, pagination, redaction;
- the schema check, and access tokens (client credentials, renewal, errors);
- the pipeline: happy path, idempotent re-run, re-publish updates, conflicts, cross-brand conflicts, partial failure and retry, the time budget;
- live publish with undo and delete, currency, scope and schema failures.

The UI suite drives the page with mocked Claude and n8n:

- generation, including a refused concept;
- preview, editing, the publish dialog (dry run, live-store lock), the status drawer and undo;
- the store form, plus a check that no token reaches the Intelligence-DB workflow.

The deployed edge function and SQL were also exercised end to end against a simulated store:

- connect, then publish;
- idempotent re-run, conflict, retry;
- soft undo, then permanent delete;
- Dev Dashboard token exchange, and intake through n8n with no saved execution.

**Not done: an end-to-end run against a real development store.** There is no store or token in this environment. Step 5 above is that check.

## Not built yet

| Item | State |
|---|---|
| Theme templates (`templates/page.brand-*.json`, `themeFilesUpsert`) with backup | Not built; the option is shown but cannot be switched on. The theme is never touched. |
| Image upload (`stagedUploadsCreate` → PUT → `fileCreate`), AI images, print-on-demand mockups | Not built. Products get images only from https links you add; the preview shows placeholders. |
| OAuth (authorization-code grant) for other merchants' stores | Not built; see "Connecting a store". |
| Webhooks (`products/delete`, `app/uninstalled`, compliance topics) with HMAC | Not built. |
| Translations, Markets, blog posts, bulk operations (>50 products), JSON-LD | Not built. |
| Regenerating only part of a concept | Not built; *Regenerate* makes a whole new concept as the brand's next version. |
| Multiple users and roles | Not built; the database serves one owner (as the rest of Plan-vy). |

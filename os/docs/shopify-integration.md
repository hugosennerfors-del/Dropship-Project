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

**Adding a scope later.** For a Dev Dashboard app: create a new version with the scope added and release it, then open the app in the store's admin and approve the new access. A store the app is already installed on keeps its old scopes until that approval ("Create apps using the Dev Dashboard" on shopify.dev; "Manage access scopes" says a release in your own organisation is enough, but a release alone left `write_publications` out on 12 October 2026). Then press *Check access again* in the publish dialog, or *Test* under *Data > Shopify stores*. A connection test always asks Shopify for a new client-credentials token, so a newly released scope counts at once instead of after the cached token expires. Products need status **Active** as well as the Online Store listing before shoppers can see them; the dialog's *Visible to shoppers now* choice sets both.

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

### Brand tools

Each brand card has these tools. Everything they save is stored with the concept as a new version.

- **Regenerate one part** (`regeneratePart` in `brands.js`).
  - The parts are: name and tagline, look, story, product texts, page plan, SEO. Claude rewrites only the chosen part; handles, variants and prices stay.
  - An optional wish goes to Claude between `<wish>` delimiters, as data.
  - The answer must pass `validateConcept`; Claude gets one retry with the errors.
  - *The whole concept* still makes a new concept. It keeps the store details, profit settings, logo choice and confirmations (`keptOnRegenerate`), but not the policy pages, because they name the old brand.
- **Profit per order** (`economics.js`).
  - Fields: shipping, ad cost per order, returns, payment fees and a target margin. Fee and return values the owner has not set are shown as assumptions.
  - Per variant it shows the contribution, profit after ads, break-even CPA and ROAS, and the price needed for the target margin.
- **Logo** (`logo.js`).
  - A wordmark, a badge or a stacked logo, built from the name, palette and heading font.
  - Downloads as SVG or PNG (transparent background optional); the choice is saved as `concept.logo`.
- **Store details and checks** (`compliance.js`).
  - Store details are saved in `concept.business`: company, organisation number, contact, delivery, returns, and the EU responsible person for Sweden.
  - The checklist covers:
    - the seller's details;
    - prices with VAT;
    - the 14-day right of withdrawal;
    - delivery information;
    - for Sweden, three years to complain about faults and GPSR product safety;
    - CE, WEEE, batteries, toys and cosmetics where the product words match.
  - What the page cannot see (a supplier's declaration, a registration) the owner confirms per product.
  - While anything is open, the publish dialog will not make products buyable (Active or published to the Online Store). Drafts are still allowed.
  - It is a checklist with the law named for each line, not legal advice.
- **Policy pages** (`buildPolicyPrompt`, `writePolicies`).
  - Claude writes terms, returns and right of withdrawal, delivery, and privacy, in the brand's language and tone, from the store details only. A fact it was not given becomes `[FYLL I: …]` / `[FILL IN: …]`.
  - The owner edits the pages in the dialog; the HTML is sanitised.
  - *Policy pages* in the publish dialog creates them as Shopify pages, with handles such as `tidewarm-retur-och-angerratt`. They are checked in the preflight, updated on re-publish and hidden or deleted by undo.
  - Publishing is refused while a gap mark is left.
- **FAQ from objections** (`faq.js`, `faqObjections`, `analyseReviews`, `writeFaq`).
  - Objections come from:
    - review-analyst runs on the brand's source product;
    - reviews pasted in the dialog, analysed by the same agent (saved on the source product when there is one);
    - objections an earlier FAQ answered;
    - the product's complaint fields. These are ticked only when verified or estimated from evidence; AI guesses are listed but not ticked.
  - Claude answers the ticked objections (at most eight questions) from the brand's products and store details only. Review quotes go in as delimited data. A missing fact becomes a gap mark.
  - The answers replace the items of the page plan's FAQ section, or a new one is added before the newsletter section. The objections are saved as `concept.faq`.
  - `buildPlan` refuses to publish the brand page while any section still has a gap mark; products alone can still be published.
- **Name check** (`names.js`, edge action `names`, table `intel.name_checks`).
  - Up to five names; up to 30 checks an hour across the database.
  - Each name is tried as up to eight domains for the market: `.se .com .nu .shop` for Sweden, `.co.uk .com .uk .shop` for the UK.
  - The edge function looks each one up in DNS (`dns.google`); where IANA lists an RDAP server, it asks the registry too.
  - Results are *taken*, *free* (the registry says it is not registered), *probably free* (no such domain in DNS; `.se` and `.nu` have no public RDAP) or *unknown*. Only a registrar can confirm.
  - Trade marks are not checked automatically: EUIPO, TMview, WIPO and the UK IPO have no free search API that can be used from here. The dialog links to their searches and copies the name.

## Competitors' ads from GetHookd

The product page's *Ads* tab has a **GetHookd** panel. It searches GetHookd, an index of Meta's ad library, for the ads running now for the product in the chosen market (UK → `GB`, Sweden → `SE`).

- **Path.**
  - The page sends the write action `ads.gethookd` (`productId`, `market`, `query`, `limit`) through the Intelligence-DB workflow.
  - `intel.api_write_gethookd` checks the words (2–80 characters), caps the limit at 20 and allows 60 searches an hour across the database. It stores a row in `intel.gethookd_searches` and dispatches the edge action `gethookd`.
  - The edge function calls GetHookd's MCP tool `search_ads` (`src/shopify/gethookd.js`). It asks for active ads only, at most two per advertiser, and only the fields it shows.
  - The page polls `api_read({"gethookdSearch": id})`, for up to 60 seconds.
- **The key.**
  - The API key is in Supabase Vault as `gethookd_api_key`. The edge function reads it from there.
  - The page, n8n and git never see it.
  - A missing or rejected key is named in the panel, and so is an account without credits.
- **Cost.** GetHookd bills about 0.01 credit per ad returned. The panel asks for 10, and shows the credits left after each search.
- **Saving an ad.**
  - *Save* turns a found ad into an ordinary competitor ad (`savedAdInput` → `normaliseAd` → `ads.save`). It keeps the advertiser, start date, hook, performance label and landing domain.
  - The link is GetHookd's share page; the panel links nothing else.
  - An ad already saved for the product shows as *Saved*.
- **Survey.** GetHookd asks every new connection to answer or skip a short survey before it will search. It was skipped for this account. Otherwise the panel says so.

## Tests

```
npm test                 unit (95), Shopify (151), build, smoke, UI in Chromium (168)
npm run test:shopify     the Shopify suite on its own
npm run shopify:schema   contract check (simulated store, or a real one with SHOPIFY_* set)
```

The Shopify suite runs against `mockshop.js`. It covers:

- validation, sanitising, handles and margins;
- the client: throttling, 5xx, auth, pauses, pagination, redaction;
- the schema check, and access tokens (client credentials, renewal, errors);
- the pipeline: happy path, idempotent re-run, re-publish updates, conflicts, cross-brand conflicts, partial failure and retry, the time budget;
- live publish with undo and delete, currency, scope and schema failures;
- profit per order, the logo layout, the checklist, policy pages (plan, publish, update, undo, conflict), the FAQ (objections, prompt, page section, gap block) and the name check against a fake DNS and RDAP;
- the GetHookd search against a fake MCP server: arguments, JSON and event-stream answers, the survey, key, credit and API errors, and saving a found ad.

The UI suite drives the page with mocked Claude and n8n:

- generation, including a refused concept;
- preview, editing, the publish dialog (dry run, live-store lock), the status drawer and undo;
- the store form, plus a check that no token reaches the Intelligence-DB workflow.

The deployed edge function and SQL were also exercised end to end against a simulated store:

- connect, then publish;
- idempotent re-run, conflict, retry;
- soft undo, then permanent delete;
- Dev Dashboard token exchange, and intake through n8n with no saved execution;
- a GetHookd search for "changing robe" in the UK (22 October 2026): 5 running ads from 3 advertisers, 0.05 credits.

**Not done: an end-to-end run against a real development store.** There is no store or token in this environment. Step 5 above is that check.

## Not built yet

| Item | State |
|---|---|
| Theme templates (`templates/page.brand-*.json`, `themeFilesUpsert`) with backup | Not built; the option is shown but cannot be switched on. The theme is never touched. |
| Image upload (`stagedUploadsCreate` → PUT → `fileCreate`), AI images, print-on-demand mockups | Not built. Products get images only from https links you add; the preview shows placeholders. |
| OAuth (authorization-code grant) for other merchants' stores | Not built; see "Connecting a store". |
| Webhooks (`products/delete`, `app/uninstalled`, compliance topics) with HMAC | Not built. |
| Translations, Markets, blog posts, bulk operations (>50 products), JSON-LD | Not built. |
| Automatic trade mark search (PRV, EUIPO, UK IPO) | Not built; no free search API can be used from here. The name check links to the registers instead. |
| Multiple users and roles | Not built; the database serves one owner (as the rest of Plan-vy). |

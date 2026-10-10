# Plan-vy Intelligence

A UK-first e-commerce research system: a product database with a status on
every value, a scoring engine, deep product analysis, and an AI chat that
queries the database. Sweden is the alternative market. The store workspace
(Kassa, Test, Risk, Kalender, n8n research) from the earlier Plan-vy page
lives in the same page under **Store**.

## Where the data lives

```
Supabase (project "E-Comercial")
├── public.*            your store and the n8n research generator (unchanged)
│     orders, order_lines, ad_spend, products, product_candidates …
└── intel.*             this system
      evidence          cited sources, graded A–E
      products          one row per product (research, agent, manual, import)
      analyses          every analysis, versioned; a change adds a version
      overlays          values you verified or corrected (soft-deleted, logged)
      agent_runs        brand builder, review analyst, … outputs
      profiles          computed scores per product and market
      settings          market assumptions, watchlist
      connectors        data sources and their status
      pipeline_runs     every sync
      v_own_sales       your store's sales per product (live)
      v_inbox           research-generator ideas, analysed or not
      v_field_values    every field with its status, for SQL
      api_read / api_write / sync_all   the only entry points

n8n
├── Plan-vy · Intelligence-DB     the page's read/write API (POST, private path)
├── Plan-vy · Intelligence-sync   loads db/build/supabase-sync.json from GitHub, daily 05:47
└── Plan-vy · Research-generator  new research: five ideas for a niche and market, with
                                  costing and an ad plan, saved in public.product_candidates
```

## New research from the search fields

Type a niche or product in the top-bar search (⌘K), the box on Discover, the
New research page, or ask the chat ("research padel accessories", "gör
research på hundleksaker"). The search finds what the database already has;
**Research** runs the Research generator for the current market (the UK is
sent as `GB`). The ideas appear at once, are saved in Supabase, and count as
AI estimates until **Analyse** turns one into a scored profile. A run takes
about half a minute and uses the workflow's OpenAI credits, so nothing starts
without a click.

The page reads Supabase through the viewer's n8n connector and falls back to
the snapshot embedded at build time, so it always works.

## Competitors' ads

Each product page has an **Ads** section for the selected market. It links to
Meta's Ad Library with the market (the UK is `GB`) and the search words
filled in, to TikTok search the same way, and to TikTok's Ad Library and Top
Ads, which do not take the search from the address (copy it with one click).
Meta and TikTok do not let other pages show their ads, so they open in a new
tab. Ads you find are saved on the product (link, advertiser, when it started
running, angle, note) in `intel.product_ads` through the `ads.save` and
`ads.remove` actions. Still-running ads 30 days or older count as
long-running, which the section reads as a sign that someone sells the
product at a profit. Removing an ad keeps the row, marked removed.

## Dropshipping stores and suppliers

Next to Ads, **Stores & suppliers** answers which small dropshipping stores
already sell the product, and who makes it. Big brands and marketplaces are
left out on purpose.

**Find dropshipping stores** starts the n8n workflow
*Plan-vy · Dropshipping-butiker* ([source](n8n/dropship-stores.workflow.js)):

1. Three Brave searches for the product in the selected market (one limited
   to `myshopify.com`), on n8n's gateway credits.
2. Marketplaces, big chains, social media, comparison sites and the brands
   the research names are dropped; a result must mention the product.
3. Each remaining store's public Shopify files are read: `/meta.json` (name,
   country, currency, catalogue size, countries it ships to), the store's
   own product search, the matched product's `.json` and the shipping
   policy.
4. Each store is scored on dropshipping signals: description images hosted
   on AliExpress or CJ Dropshipping, AliExpress- or CJ-style product codes,
   long delivery times, "ships from abroad" wording, a store registered
   abroad, and a small catalogue. Fast delivery (5 days or less) and a big
   catalogue count against. When a shipping policy lists zones (UK 1–3
   days, rest of the world 2–7 weeks), the market's own zone counts, and a
   range after refund or processing wording is not a delivery time.
   60+ is *likely*, 40–59 *possible*; the rest are not saved. *Likely* needs
   a supplier sign (AliExpress or CJ images or codes, images on Chinese
   servers, "ships from abroad" wording, a store registered in China or Hong
   Kong). Slow delivery and a small catalogue alone fit a brand or a maker
   too, so such a store is at most *possible*, and only with two of the
   weaker signs (a delivery of 10 days or more counts as two); with over
   1,000 products it counts as a retailer and is not saved.
5. Likely and possible stores are saved in `intel.product_links`
   (`found_by = 'search'`, with the reasons). A new run retires earlier finds
   that no longer qualify. A store you removed is never added back, and a
   found store you edit becomes yours.

The finder searches with the section's search words: yours if you typed
some, else the words that found the saved stores (a run with other words
would retire them), else the product's name without qualifiers such as
"with …" or "for …", since a result must contain most of the words.

These are signs, not proof. Stores on other platforms (WooCommerce, Wix) and
stores that hide their Shopify files are not checked.

Two searches open in a new tab for more: Shopify stores on Google, and the
advertisers in Meta's Ad Library (dropshippers sell through ads, so many
never rank in ordinary search).

**Suppliers in China:** AliExpress (single units, samples) and Alibaba
(factories, minimum orders) take the search from the link; 1688 needs
Chinese words, so it opens on its home page. The research's supply notes are
shown beside them.

Stores and supplier listings you save (link, name, price, currency, and the
minimum order for suppliers) go to `intel.product_links` through
`links.save` and `links.remove`. The section compares store prices with
yours and the cheapest USD quote with the analysis' supplier price. **Use
price** saves a quote as your verified supplier price, so the calculator and
scores use it. Each research idea links to the same searches (ads, Shopify
stores, AliExpress, Alibaba).

## Brand Builder and Shopify

**Brand Builder** (`#/brands`) turns a niche into complete brand concepts with
Claude: name, positioning, palette, fonts, products with variants and prices,
page plan and copy. Every concept passes a strict schema before it is saved
as a version. Edit it, preview the page (desktop or mobile), and publish it
to a connected Shopify store with **Publish brand to Shopify**. The brand
becomes products (drafts by default), a smart collection, a brand metaobject,
a hidden page and optionally a menu item and Online Store listing. A publish
is a background job with a dry run, step-by-step status, retry and undo.
Stores are connected under *Data > Shopify stores*; tokens and app secrets
go straight into Supabase Vault and never reach the page. Architecture,
scopes, setup and what is not built yet:
[docs/shopify-integration.md](docs/shopify-integration.md).

## Look

Chroma Glass, the earlier Plan-vy palette: a cool light ground with slow
cyan, violet and pink colour fields behind frosted-glass panels, indigo for
data, Instrument Sans and IBM Plex Mono. Effects (panels rising in, a
turning rainbow edge, a glow that follows the pointer, gradient headings,
count-ups, charts that draw themselves, a radar beam, confetti when research
or an analysis finishes) sit behind the system's "reduce motion" setting and
the Effects switch in the top bar. Nothing that can be clicked tilts or
moves away from the pointer; `npm test` checks every visible button with
effects on.

## Layers

```
db/raw/          raw data: evidence.json, own-sales.json (from intel.v_own_sales),
                 n8n-candidates.json (public.product_candidates)
db/analysis/     AI analysis, one module per research session (status per value)
db/manual/       your own overlays.json and products/*.json (optional)
db/build/        processed.json · scores.json · profiles.json · dataset.json
                 intel.sqlite · supabase-sync.json · supabase/*.sql
```

Status codes: **V** verified (primary source, synced store data, or entered by
you with a source), **E** estimated from cited evidence or a formula over data,
**A** AI estimate, **N** insufficient data. Store orders without Shopify ids
count as self-reported (E) until real orders sync.

## Commands

```
npm install
npm run pipeline     # raw → processed → scores → profiles, SQLite, Supabase sync file
npm run build        # dist/index.html (single file, embeds the snapshot)
npm test             # unit, Shopify, build, smoke and browser tests
npm run shopify:schema   # contract check of the pinned Shopify API (see docs)
npm run edge:sync    # copy src/shopify into the edge function before deploying it
```

After `npm run pipeline`, commit and push: the Intelligence-sync workflow loads
the new build into Supabase the next morning, or run it by hand in n8n.

## Code

```
src/core/         fields (the vocabulary), markets, provenance, economics,
                  scoring, inherit (UK → SE), ownsales, profile, query, nlq, insights,
                  candidates (research-inbox ideas), ads (ad-library links, saved ads),
                  sourcing (store and supplier searches, saved links), weblinks
src/chat/         engine (Claude with page tools, or local answers), compose
src/agents/       brand builder, improvement engine, review analyst,
                  market adapter, scenario commentary, comparison judge,
                  niche scout, weekly brief, inbox profiler
src/views/        radar, discover, research, product (+ ads, sourcing), trends, niches, compare, chat, data,
                  brands (Brand Builder), shopify-ui (preview, editor, publish, status, undo)
src/shopify/      Shopify client, auth, schema check, mapping, pipeline, edge function,
                  simulated store, brand concepts (shared by page, edge function and tests)
supabase/         edge function intel-shopify and the SQL migrations
n8n/              source of the n8n workflows built in code
src/live.js       Supabase through n8n (any published workflow, polled to completion)
src/research.js   new research from the search fields
src/dropship.js   the store finder (n8n workflow Plan-vy · Dropshipping-butiker)
src/fx.js         effects: entrances, count-ups, glow, sparks, confetti
src/styles/       app.css (Chroma Glass palette and components), brands.css, fx.css (effects)
src/state.js      the page's data layer
pipeline/         run.mjs and its stages
```

Adding a data source: write raw records to `intel.evidence` (or a new raw
table), cite them from an analysis, and list the source in
`src/core/connectors.js`. Adding a score: extend `src/core/scoring.js`; every
view, the chat and the SQL export read from the same rows.

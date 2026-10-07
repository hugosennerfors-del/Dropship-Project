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
npm test             # unit tests, every route in a browser, chat and live-data tests
```

After `npm run pipeline`, commit and push: the Intelligence-sync workflow loads
the new build into Supabase the next morning, or run it by hand in n8n.

## Code

```
src/core/         fields (the vocabulary), markets, provenance, economics,
                  scoring, inherit (UK → SE), ownsales, profile, query, nlq, insights,
                  candidates (research-inbox ideas)
src/chat/         engine (Claude with page tools, or local answers), compose
src/agents/       brand builder, improvement engine, review analyst,
                  market adapter, scenario commentary, comparison judge,
                  niche scout, weekly brief, inbox profiler
src/views/        radar, discover, research, product, trends, niches, compare, chat, data
src/live.js       Supabase through n8n (any published workflow, polled to completion)
src/research.js   new research from the search fields
src/fx.js         effects: entrances, count-ups, glow, sparks, confetti
src/styles/       app.css (Chroma Glass palette and components), fx.css (effects)
src/state.js      the page's data layer
pipeline/         run.mjs and its stages
```

Adding a data source: write raw records to `intel.evidence` (or a new raw
table), cite them from an analysis, and list the source in
`src/core/connectors.js`. Adding a score: extend `src/core/scoring.js`; every
view, the chat and the SQL export read from the same rows.

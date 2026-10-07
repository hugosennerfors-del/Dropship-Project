// Stage 4 — write the build outputs.
//
//   db/build/processed.json   analysis + inheritance + your overlays
//   db/build/scores.json      every score with its breakdown
//   db/build/profiles.json    one flat row per product and market
//   db/build/dataset.json     what the page embeds (processed + evidence +
//                             inbox + connectors); the page recomputes scores
//   db/build/intel.sqlite     everything above as relational tables

import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { CONNECTORS } from "../../src/core/connectors.js";
import { FIELDS } from "../../src/core/fields.js";

const strip = (p) => {
  const { analysisFile, ...rest } = p;
  return { ...rest, analysisFile };
};

export async function writeOutputs(root, processed, scored, log) {
  const out = join(root, "db/build");
  await mkdir(out, { recursive: true });
  const generated = log.finishedAt;
  const products = processed.products.map(strip);

  await writeFile(join(out, "processed.json"), JSON.stringify({ generated, products }, null, 1));
  await writeFile(join(out, "scores.json"), JSON.stringify({ generated, scores: scored.scores }, null, 1));
  await writeFile(join(out, "profiles.json"), JSON.stringify({ generated, rows: scored.rows }, null, 1));
  const dataset = {
    meta: {
      generated, version: log.version, primaryMarket: "UK",
      counts: log.counts,
      note: "Only own sales data is Verified. Research figures are Estimated from cited evidence; everything else is an AI estimate and is labelled as such.",
    },
    evidence: processed.evidence,
    // Authored records (analysis layer). The page applies own sales,
    // inheritance and overlays itself, exactly like the pipeline does.
    products: processed.records.map(strip),
    overlays: processed.overlays,
    candidates: processed.candidates,
    ownSales: processed.ownSales,
    connectors: CONNECTORS,
    log: { warnings: log.warnings.length, errors: log.errors.length, stages: log.stages },
  };
  await writeFile(join(out, "dataset.json"), JSON.stringify(dataset));
  await writeFile(join(out, "pipeline-log.json"), JSON.stringify(log, null, 1));
  const sqlite = await writeSqlite(join(out, "intel.sqlite"), processed, scored, log);
  return { dataset, sqlite };
}

async function writeSqlite(path, processed, scored, log) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return { skipped: "node:sqlite is not available in this Node version" };
  }
  await rm(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = OFF;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE fields (key TEXT PRIMARY KEY, label TEXT, grp TEXT, scope TEXT, type TEXT, better TEXT, description TEXT);
    CREATE TABLE evidence (id TEXT PRIMARY KEY, level TEXT, kind TEXT, market TEXT, claim TEXT, observed TEXT, via TEXT,
      source_title TEXT, source_publisher TEXT, source_url TEXT, note TEXT);
    CREATE TABLE evidence_products (evidence_id TEXT, product_id TEXT);
    CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT, category TEXT, niche TEXT, micro_niche TEXT, markets TEXT, layer TEXT, analysis_file TEXT);
    -- Every input value with its provenance. layer: analysis | inherited | manual
    CREATE TABLE field_values (product_id TEXT, scope TEXT, field TEXT, value_json TEXT, status TEXT, src_json TEXT, note TEXT, layer TEXT);
    -- One row per product and market, numeric columns for SQL filtering.
    CREATE TABLE profiles (product_id TEXT, market TEXT, currency TEXT, name TEXT, category TEXT, niche TEXT, stage TEXT,
      opportunity REAL, evidence_weighted REAL, confidence REAL, risk REAL,
      price REAL, landed_cost REAL, margin REAL, contribution REAL, cac REAL, profit REAL, profit_gbp REAL, net_margin REAL,
      roas REAL, break_even_roas REAL, startup_cost REAL, break_even_orders REAL,
      demand REAL, trend REAL, trend_acceleration REAL, competition REAL, saturation REAL, brandability REAL, viral REAL,
      tiktok REAL, meta REAL, repeat_potential REAL, regulatory_risk REAL, ip_risk REAL, validation TEXT, row_json TEXT,
      PRIMARY KEY (product_id, market));
    CREATE TABLE score_components (product_id TEXT, market TEXT, component TEXT, weight REAL, value REAL, points REAL, missing INTEGER);
    CREATE TABLE red_flags (product_id TEXT, market TEXT, severity TEXT, title TEXT, detail TEXT);
    CREATE TABLE candidates (id TEXT PRIMARY KEY, name TEXT, market TEXT, currency TEXT, niche TEXT, price REAL, cost REAL,
      cpa REAL, margin REAL, profit REAL, research_date TEXT, status TEXT, analysed INTEGER, notes TEXT);
    CREATE TABLE connectors (id TEXT PRIMARY KEY, name TEXT, status TEXT, markets TEXT, provides TEXT, yields TEXT, how TEXT);
  `);
  const tx = (fn) => { db.exec("BEGIN"); try { fn(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } };
  tx(() => {
    const m = db.prepare("INSERT INTO meta VALUES (?, ?)");
    m.run("generated", log.finishedAt); m.run("version", String(log.version));
    m.run("note", "Only own sales data is Verified (status V). E = estimated from cited evidence, A = AI estimate, N = insufficient data.");

    const f = db.prepare("INSERT INTO fields VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const x of FIELDS) f.run(x.key, x.label, x.group, x.scope, x.type, x.better, x.desc || null);

    const e = db.prepare("INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const ep = db.prepare("INSERT INTO evidence_products VALUES (?, ?)");
    for (const x of processed.evidence) {
      e.run(x.id, x.level, x.kind, x.market, x.claim, x.observed || null, x.via || null,
        x.source?.title || null, x.source?.publisher || null, x.source?.url || null, x.note || null);
      for (const pid of x.products || []) ep.run(x.id, pid);
    }

    const p = db.prepare("INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const fv = db.prepare("INSERT INTO field_values VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const x of processed.products) {
      const c = x.core || {};
      p.run(x.id, c.name?.v ?? null, c.category?.v ?? null, c.niche?.v ?? null, c.microNiche?.v ?? null,
        Object.keys(x.markets || {}).join(","), x.source || "research", x.analysisFile || null);
      const put = (scope, block, inherited = []) => {
        for (const [k, val] of Object.entries(block || {})) {
          if (k.startsWith("_") || k === "evidence") continue;
          if (val && typeof val === "object" && "s" in val) {
            fv.run(x.id, scope, k, JSON.stringify(val.v ?? null), val.s, val.src ? JSON.stringify(val.src) : null, val.note || null,
              val.src?.includes?.("user") ? "manual" : inherited.includes(k) ? "inherited" : "analysis");
          } else {
            fv.run(x.id, scope, k, JSON.stringify(val), "A", null, null, "analysis");
          }
        }
      };
      put("core", c);
      for (const [code, mk] of Object.entries(x.markets || {})) put(code, mk, mk._inherited || []);
    }

    const pr = db.prepare(`INSERT INTO profiles VALUES (${Array(37).fill("?").join(", ")})`);
    const n = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    for (const r of scored.rows) {
      pr.run(r.id, r.market, r.currency, r.name, r.category ?? null, r.niche ?? null, r.stage,
        n(r.opportunity), n(r.evidenceWeighted), n(r.confidence), n(r.risk),
        n(r.price), n(r.landedCost), n(r.margin), n(r.contribution), n(r.cac), n(r.profit), n(r.profitGBP), n(r.netMargin),
        n(r.roas), n(r.breakEvenRoas), n(r.startupCost), n(r.breakEvenOrders),
        n(r.demand), n(r.trend), n(r.trendAcceleration), n(r.competition), n(r.saturation), n(r.brandability), n(r.viral),
        n(r.tiktok), n(r.meta), n(r.repeat), n(r.regulatoryRisk), n(r.ipRisk), r.validation, JSON.stringify(r));
    }

    const sc = db.prepare("INSERT INTO score_components VALUES (?, ?, ?, ?, ?, ?, ?)");
    const rf = db.prepare("INSERT INTO red_flags VALUES (?, ?, ?, ?, ?)");
    for (const [pid, byMarket] of Object.entries(scored.scores)) {
      for (const [code, s] of Object.entries(byMarket)) {
        for (const c of s.components) sc.run(pid, code, c.key, c.weight, c.value, c.points, c.missing ? 1 : 0);
        for (const f of s.redFlags) rf.run(pid, code, f.severity, f.title, f.detail || null);
      }
    }

    const ca = db.prepare("INSERT INTO candidates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const c of processed.candidates) {
      ca.run(c.id, c.name, c.market, c.currency, c.niche ?? null, n(c.price), n(c.cost), n(c.cpa), n(c.margin), n(c.profit),
        c.researchDate ?? null, c.status, c.analysed ? 1 : 0, c.notes ?? null);
    }

    const co = db.prepare("INSERT INTO connectors VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const c of CONNECTORS) co.run(c.id, c.name, c.status, c.markets.join(","), c.provides.join(", "), c.yields, c.how);
  });
  const counts = Object.fromEntries(["evidence", "products", "field_values", "profiles", "score_components", "red_flags", "candidates"]
    .map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
  db.close();
  return { path, counts };
}

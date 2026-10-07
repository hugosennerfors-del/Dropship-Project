// Stage 5 — Supabase sync batches.
//
// Writes db/build/supabase/*.sql: calls to the intel.sync_* functions that
// upsert evidence, products (a new analysis version only when a record
// changed), computed profiles and connectors, and log the pipeline run.
// Run them with any Postgres client connected to the project, e.g.
//   psql "$DATABASE_URL" -f db/build/supabase/01-evidence.sql
// The n8n workflow "Plan-vy · Intelligence-DB" then serves the result.

import { writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { CONNECTORS } from "../../src/core/connectors.js";

const MAX = 90_000; // characters per batch file
const q = (obj) => {
  const s = JSON.stringify(obj);
  if (s.includes("$J$")) throw new Error("JSON contains the dollar-quote tag");
  return `$J$${s}$J$::jsonb`;
};
const lit = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`);

// The same content as one JSON payload for intel.sync_all(), fetched from
// GitHub by the n8n workflow "Plan-vy · Intelligence-sync".
export async function writeSyncPayload(root, processed, scored, log) {
  const KEEP = PROFILE_KEYS;
  const payload = {
    source: "pipeline/run.mjs",
    generated: log.finishedAt,
    counts: log.counts,
    warnings: log.warnings.slice(0, 50),
    evidence: processed.evidence,
    products: processed.records.filter((r) => (r.source || "research") === "research").map((r) => {
      const { analysisFile, ...rec } = r;
      const d = analysisFile?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
      return { ...rec, analyst: d ? `claude-research-${d}` : "claude-research" };
    }),
    profiles: scored.rows.map((r) => {
      const o = Object.fromEntries(KEEP.filter((k) => r[k] != null).map((k) => [k, r[k]]));
      o.components = Object.fromEntries(scored.scores[r.id][r.market].components.map((c) => [c.key, { value: c.value, weight: c.weight, points: c.points }]));
      return o;
    }),
    connectors: CONNECTORS,
  };
  const file = join(root, "db/build/supabase-sync.json");
  await writeFile(file, JSON.stringify(payload));
  return file;
}

const PROFILE_KEYS = ["id", "market", "currency", "stage", "opportunity", "evidenceWeighted", "confidence", "risk", "price", "margin", "contribution",
  "cac", "profit", "profitGBP", "netMargin", "startupCost", "breakEvenOrders", "demand", "trend", "trendAcceleration", "competition",
  "brandability", "viral", "tiktok", "meta", "repeat", "validation", "interest", "redFlags"];

export async function writeSupabaseBatches(root, processed, scored, log) {
  const dir = join(root, "db/build/supabase");
  await mkdir(dir, { recursive: true });
  for (const f of await readdir(dir)) await rm(join(dir, f));

  const files = [];
  const batch = async (name, stmts) => {
    let part = 1, buf = [];
    const flush = async () => {
      if (!buf.length) return;
      const file = `${name}${part > 1 || stmts.join("").length > MAX ? `-${String(part).padStart(2, "0")}` : ""}.sql`;
      await writeFile(join(dir, file), buf.join("\n") + "\n");
      files.push(file);
      part++; buf = [];
    };
    for (const s of stmts) {
      if (buf.join("\n").length + s.length > MAX) await flush();
      buf.push(s);
    }
    await flush();
  };

  await batch("01-evidence", processed.evidence.map((e) => `select intel.sync_evidence(${q(e)});`));

  const analyst = `claude-research-${(processed.records[0]?.analysisFile || "").match(/\d{4}-\d{2}-\d{2}/)?.[0] || "unknown"}`;
  await batch("02-products", processed.records.filter((r) => (r.source || "research") === "research").map((r) => {
    const { analysisFile, ...rec } = r;
    const who = analysisFile?.match(/\d{4}-\d{2}-\d{2}/) ? `claude-research-${analysisFile.match(/\d{4}-\d{2}-\d{2}/)[0]}` : analyst;
    return `select intel.sync_product(${q(rec)}, ${lit(who)}, ${lit(r.store?.sku || null)});`;
  }));

  const KEEP = ["id", "market", "currency", "stage", "opportunity", "evidenceWeighted", "confidence", "risk", "price", "margin", "contribution",
    "cac", "profit", "profitGBP", "netMargin", "startupCost", "breakEvenOrders", "demand", "trend", "trendAcceleration", "competition",
    "brandability", "viral", "tiktok", "meta", "repeat", "validation", "interest", "redFlags"];
  await batch("03-profiles", scored.rows.map((r) => {
    const o = Object.fromEntries(KEEP.filter((k) => r[k] != null).map((k) => [k, r[k]]));
    o.components = Object.fromEntries(scored.scores[r.id][r.market].components.map((c) => [c.key, { value: c.value, weight: c.weight, points: c.points }]));
    return `select intel.sync_profile(${q(o)});`;
  }));

  await batch("04-connectors", [
    ...CONNECTORS.map((c) => `select intel.sync_connector(${q(c)});`),
    `insert into intel.pipeline_runs (source, started_at, finished_at, stats, warnings) values ('pipeline/run.mjs', ${lit(log.startedAt)}, ${lit(log.finishedAt)}, ${q(log.counts)}, array[${log.warnings.slice(0, 50).map(lit).join(", ")}]::text[]);`,
    "select (select count(*) from intel.products) as products, (select count(*) from intel.evidence) as evidence, (select count(*) from intel.profiles) as profiles, (select count(*) from intel.connectors) as connectors;",
  ]);
  return { dir, files };
}

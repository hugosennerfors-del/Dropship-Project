// The data pipeline: raw → processed → analysis → scores → profiles.
//
//   node pipeline/run.mjs            build everything into db/build/
//   node pipeline/run.mjs --check    validate only, write nothing
//
// Each layer is read from its own folder and never overwritten by a later
// one: adding raw data or a new analysis file re-runs the downstream stages
// without touching earlier analyses.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { ingest } from "./stages/ingest.mjs";
import { processLayers } from "./stages/process.mjs";
import { scoreAll } from "./stages/score.mjs";
import { writeOutputs } from "./stages/export.mjs";
import { writeSupabaseBatches, writeSyncPayload } from "./stages/supabase.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");

const log = { startedAt: new Date().toISOString(), stages: [], warnings: [], errors: [] };
const stage = (name, info) => { log.stages.push({ name, at: new Date().toISOString(), ...info }); };

const layers = await ingest(root);
stage("ingest", {
  evidence: layers.raw.evidence.evidence.length, candidates: layers.raw.candidates.candidates.length,
  ownSales: (layers.raw.ownSales.rows || []).length, imports: layers.raw.imports.length,
  analysisProducts: layers.analysis.length, manualProducts: layers.manual.products.length,
  overlays: Object.keys(layers.manual.overlays).length,
});

const processed = processLayers(layers);
log.warnings.push(...processed.warnings);
log.errors.push(...processed.errors);
stage("process", { products: processed.products.length, candidates: processed.candidates.length,
  warnings: processed.warnings.length, errors: processed.errors.length });

if (processed.errors.length) {
  console.error(`✗ ${processed.errors.length} errors:\n  ` + processed.errors.join("\n  "));
  process.exit(1);
}
if (processed.warnings.length) console.warn(`! ${processed.warnings.length} warnings:\n  ` + processed.warnings.join("\n  "));

const scored = scoreAll(processed, layers.manual.settings);
stage("score", { rows: scored.rows.length });

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
log.version = pkg.version;
log.counts = {
  products: processed.products.length,
  profiles: scored.rows.length,
  uk: scored.rows.filter((r) => r.market === "UK").length,
  se: scored.rows.filter((r) => r.market === "SE").length,
  evidence: processed.evidence.length,
  candidates: processed.candidates.length,
};
log.finishedAt = new Date().toISOString();

if (checkOnly) {
  console.log(`✓ check passed: ${log.counts.products} products, ${log.counts.profiles} market profiles, ${log.counts.evidence} evidence records`);
  process.exit(0);
}

const { sqlite } = await writeOutputs(root, processed, scored, log);
const sb = await writeSupabaseBatches(root, processed, scored, log);
await writeSyncPayload(root, processed, scored, log);
console.log(`✓ ${log.counts.products} products → ${log.counts.uk} UK + ${log.counts.se} SE profiles, ${log.counts.evidence} evidence, ${log.counts.candidates} inbox candidates`);
console.log(sqlite.skipped ? `  SQLite skipped: ${sqlite.skipped}` : `  SQLite: ${JSON.stringify(sqlite.counts)}`);
console.log(`  Supabase: db/build/supabase-sync.json (for n8n) and SQL batches ${sb.files.join(", ")}`);

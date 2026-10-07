// Stage 1 — ingest. Reads every layer from disk without changing anything.
//
//   db/raw/         raw data: evidence, own sales, imported candidates
//   db/analysis/    AI analysis: one module per research session
//   db/manual/      your own corrections and products (overlays.json,
//                   products/*.json, settings.json)

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const readJSON = async (p, fallback) => (existsSync(p) ? JSON.parse(await readFile(p, "utf8")) : fallback);

export async function ingest(root) {
  const db = join(root, "db");
  const raw = {
    evidence: await readJSON(join(db, "raw/evidence.json"), { meta: {}, evidence: [] }),
    candidates: await readJSON(join(db, "raw/n8n-candidates.json"), { meta: {}, candidates: [] }),
    ownSales: await readJSON(join(db, "raw/own-sales.json"), { meta: {}, rows: [] }),
    imports: [],
  };
  const importDir = join(db, "raw/imports");
  if (existsSync(importDir)) {
    for (const f of (await readdir(importDir)).filter((f) => f.endsWith(".json")).sort()) {
      raw.imports.push({ file: `raw/imports/${f}`, ...(await readJSON(join(importDir, f))) });
    }
  }

  const analysis = [];
  const analysisDir = join(db, "analysis");
  for (const f of (await readdir(analysisDir)).filter((f) => f.endsWith(".mjs") && !f.startsWith("_")).sort()) {
    const mod = await import(pathToFileURL(join(analysisDir, f)).href);
    for (const p of mod.products || []) analysis.push({ ...p, analysisFile: `analysis/${f}` });
  }

  const manual = {
    overlays: await readJSON(join(db, "manual/overlays.json"), {}),
    settings: await readJSON(join(db, "manual/settings.json"), {}),
    products: [],
  };
  const mpDir = join(db, "manual/products");
  if (existsSync(mpDir)) {
    for (const f of (await readdir(mpDir)).filter((f) => f.endsWith(".json")).sort()) {
      manual.products.push({ ...(await readJSON(join(mpDir, f))), analysisFile: `manual/products/${f}`, source: "manual" });
    }
  }
  return { raw, analysis, manual };
}

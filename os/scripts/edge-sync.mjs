// Copies the shared Shopify modules the edge function needs into
// supabase/functions/intel-shopify/lib/ (same files as src/shopify, so the
// deployed code can be compared with the repo line by line):
//   node scripts/edge-sync.mjs
// Non-ASCII characters are written as \uXXXX escapes (same meaning in JS
// strings, templates and regexes; only comments read differently), so the
// deployed files are plain ASCII and survive any upload path unchanged.
import { build } from "esbuild";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "supabase/functions/intel-shopify/lib");
const { metafile } = await build({ entryPoints: [join(root, "src/shopify/edge.js")], bundle: true, format: "esm", platform: "neutral", write: false, metafile: true });
const files = Object.keys(metafile.inputs).map((f) => basename(f)).sort();
const ascii = (s) => s.replace(/[^\x00-\x7f]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
await mkdir(out, { recursive: true });
for (const f of await readdir(out)) if (!files.includes(f)) await rm(join(out, f));
for (const f of files) await writeFile(join(out, f), ascii(await readFile(join(root, "src/shopify", f), "utf8")));
console.log("lib:", files.join(", "));

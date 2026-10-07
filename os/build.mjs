// Build the single-file page: dist/index.html
//
//   npm run build        (after npm run pipeline)
//
// The page embeds the pipeline's dataset as a snapshot, bundles the app with
// esbuild, and includes the store workspace (the earlier Plan-vy page in
// ../artefakt) with its styles scoped under .legacy and its routes moved
// under #/store, so both live in one artifact.

import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const legacyDir = join(root, "../artefakt");

const bundle = await build({
  entryPoints: [join(root, "src/app.js")],
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2020",
  write: false,
  legalComments: "none",
});
const js = bundle.outputFiles[0].text;
const css = await readFile(join(root, "src/styles/app.css"), "utf8");
const dataset = await readFile(join(root, "db/build/dataset.json"), "utf8");

// ── Legacy store workspace ─────────────────────────────────────────────
const head = await readFile(join(legacyDir, "head.html"), "utf8");
const body = await readFile(join(legacyDir, "body.html"), "utf8");
const legacyData = await readFile(join(legacyDir, "data.js"), "utf8");
let legacyApp = await readFile(join(legacyDir, "app.js"), "utf8");

const LEGACY_VARS = ["bg", "cyan", "violet", "pink", "ink", "ink2", "ink3", "hair-strong", "pos", "pos-ink", "neg", "neg-ink", "warn", "warn-ink",
  "series", "series-ink", "glass", "glass-br", "shadow", "hair", "accent", "r", "sans", "mono"];
const renameVars = (s) => s.replace(/--([a-z0-9-]+)/g, (m, name) => (LEGACY_VARS.includes(name) ? `--lg-${name}` : m));

let legacyCss = head.slice(head.indexOf("<style>") + 7, head.lastIndexOf("</style>"));
const fxStart = legacyCss.indexOf("/* ── Effekter");
if (fxStart > 0) legacyCss = legacyCss.slice(0, fxStart);
legacyCss = scopeCss(renameVars(legacyCss.replace(/\/\*[\s\S]*?\*\//g, "")), ".legacy");
legacyCss += `
.legacy{--lg-bg:transparent;--lg-ink:var(--fg);--lg-ink2:var(--fg-2);--lg-ink3:var(--fg-3);--lg-hair-strong:var(--border-strong);
--lg-pos:var(--good);--lg-pos-ink:var(--good);--lg-neg:var(--bad);--lg-neg-ink:var(--bad);--lg-warn:var(--warn);--lg-warn-ink:var(--warn);
--lg-series:var(--accent);--lg-series-ink:var(--accent);--lg-glass:var(--surface);--lg-glass-br:var(--border);--lg-shadow:none;
--lg-hair:var(--border);--lg-accent:var(--accent);--lg-r:12px;--lg-sans:var(--font-sans);--lg-mono:var(--font-mono);--lg-cyan:var(--accent);
--lg-violet:var(--accent);--lg-pink:var(--accent);min-height:0;font-size:14px;background:transparent}
.legacy .field,.legacy .side,.legacy .top,.legacy .scrim,.legacy .fxbar,.legacy .fxcanvas,.legacy .glow,.legacy .fxbtn{display:none!important}
.legacy .shell{display:block;min-height:0}
.legacy .main{min-width:0}
.legacy .glass{backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:none}
.legacy .flat{background:var(--surface-2);border-color:var(--border)}
.legacy tbody tr:hover{background:var(--surface-2)}
.legacy .wrap{max-width:1240px;margin:0 auto}
`;

// Routes move under #/store; the workspace only renders while it is shown.
legacyApp = renameVars(legacyApp);
legacyApp = replaceOnce(legacyApp, 'const raw = (location.hash || "#/").slice(1);', "const raw = ((location.hash || '#/').slice(1).replace(/^\\/store/, '')) || '/';");
legacyApp = legacyApp.replace(/(["`])#\//g, "$1#/store/");
legacyApp = legacyApp.replace(/href="#\$\{href\}"/g, 'href="#/store${href}"');
legacyApp = replaceOnce(legacyApp, "function render() {\n", "function render() {\n  if (!(location.hash || '').startsWith('#/store')) return;\n");
// The effects belong to the old design; they stay off here.
legacyApp = replaceOnce(legacyApp, 'fxSatt(sparat !== "av");', "fxSatt(false);");

const legacyBody = renameVars(body);

const esc = (s) => s.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
const html = `<title>Plan-vy Intelligence</title>
<meta name="description" content="UK-first e-commerce research: product database, scoring, analysis and an AI chat that queries the database.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap">
<style>
${css}
${legacyCss}
</style>
<div class="os">
  <aside class="rail" id="os-rail" aria-label="Navigation"></aside>
  <button class="scrim" id="os-scrim" aria-label="Close the menu"></button>
  <div class="main">
    <header class="topbar" id="os-top"></header>
    <main id="os-main"></main>
    <div class="legacy" id="legacyRoot" hidden>
${legacyBody}
    </div>
  </div>
</div>
<div id="tip" role="tooltip"></div>
<div id="toast" role="status" aria-live="polite"></div>
<script type="application/json" id="dataset">${esc(dataset)}</script>
<script>${esc(js)}</script>
<script>
${esc(legacyData)}
(function () {
${esc(legacyApp)}
})();
</script>
`;

await mkdir(join(root, "dist"), { recursive: true });
await writeFile(join(root, "dist/index.html"), html);
console.log(`dist/index.html: ${(html.length / 1024).toFixed(0)} KB (app ${(js.length / 1024).toFixed(0)} KB, data ${(dataset.length / 1024).toFixed(0)} KB)`);

function replaceOnce(s, a, b) {
  const i = s.indexOf(a);
  if (i < 0) throw new Error("build: legacy anchor not found: " + a.slice(0, 60));
  return s.slice(0, i) + b + s.slice(i + a.length);
}

// Prefix every selector with `scope`. Handles @media/@supports blocks;
// @keyframes and @font-face pass through.
function scopeCss(src, scope) {
  let out = "", i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open < 0) { out += src.slice(i); break; }
    const prelude = src.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < src.length && depth) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; j++; }
    const inner = src.slice(open + 1, j - 1);
    if (/^@(media|supports)/.test(prelude)) out += `${prelude}{${scopeCss(inner, scope)}}\n`;
    else if (/^@/.test(prelude)) out += `${prelude}{${inner}}\n`;
    else if (prelude) out += `${prelude.split(",").map((sel) => scopeSel(sel.trim(), scope)).join(",")}{${inner}}\n`;
    i = j;
  }
  return out;
}
function scopeSel(sel, scope) {
  if (!sel) return sel;
  if (sel === ":root" || sel === "html" || sel === "body") return scope;
  if (sel.startsWith(":root")) return scope + sel.slice(5);
  if (/^(html|body)\b/.test(sel)) return scope + sel.replace(/^(html|body)/, "");
  return `${scope} ${sel}`;
}

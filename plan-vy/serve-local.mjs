/**
 * Lokal server för den byggda sidan. Kör: node serve-local.mjs
 *
 * Varför inte bara öppna out/index.html direkt? Två skäl: statisk export
 * använder snygga URL:er utan .html, och en sida öppnad via file:// får inte
 * göra fetch mot n8n. En riktig server på localhost löser båda.
 *
 * Reglerna nedan speglar netlify.toml, så lokalt och driftsatt beter sig lika.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";

// fileURLToPath, inte .pathname: på Windows blir pathname "/C:/..." och bryts.
const ROOT = fileURLToPath(new URL("./out/", import.meta.url));
const PORT = Number(process.env.PORT) || 4173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const isFile = async (p) => {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
};

/** Samma omdirigering som netlify.toml: gamla /products/<sku> -> /produkt. */
const LEGACY_PRODUCT = /^\/products\/([^/]+)$/;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = decodeURIComponent(url.pathname);

  const legacy = LEGACY_PRODUCT.exec(path);
  if (legacy) {
    const q = new URLSearchParams({ sku: legacy[1] });
    for (const [k, v] of url.searchParams) if (!q.has(k)) q.set(k, v);
    res.writeHead(302, { Location: `/produkt?${q}` });
    return res.end();
  }

  // Hindra att en påhittad sökväg tar sig ur out/.
  let file = join(ROOT, path);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Förbjudet");
  }

  if (!(await isFile(file))) {
    if (await isFile(`${file}.html`)) file += ".html";
    else if (await isFile(join(file, "index.html"))) file = join(file, "index.html");
    else {
      const notFound = join(ROOT, "404.html");
      if (await isFile(notFound)) {
        res.writeHead(404, { "Content-Type": TYPES[".html"] });
        return res.end(await readFile(notFound));
      }
      res.writeHead(404, { "Content-Type": TYPES[".txt"] });
      return res.end("404");
    }
  }

  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(await readFile(file));
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\nPort ${PORT} är upptagen — sidan kanske redan körs.`);
    console.error(`Öppna http://localhost:${PORT} eller stäng det andra fönstret.\n`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, () => {
  console.log(`\n  Plan-vy Intelligence körs lokalt\n`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  Stäng fönstret för att stoppa.\n`);
});

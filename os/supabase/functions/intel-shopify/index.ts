// intel-shopify: the only code that reads a Shopify token and talks to
// Shopify. Started by intel.fn_dispatch (pg_net) with {action, id} and the
// shared secret; the logic is in lib/ (copied from src/shopify by
// scripts/edge-sync.mjs).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";
// Decodes PNG and JPEG and writes JPEG in TypeScript and WebAssembly (the
// Deno build; the npm one loads native addons): the edge runtime has no
// image API, and the page can only show images it is sent as data.
import { decode, Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { createHandler } from "./lib/edge.js";

function encodeBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 });

// A copied ad's image as a JPEG of at most 480 px on its long edge.
async function thumb(bytes: Uint8Array) {
  const img = await decode(bytes);
  if (!(img instanceof Image)) throw new Error("not a still image");
  const long = Math.max(img.width, img.height);
  if (long > 480) img.width >= img.height ? img.resize(480, Image.RESIZE_AUTO) : img.resize(Image.RESIZE_AUTO, 480);
  const jpeg = await img.encodeJPEG(72);
  return { mime: "image/jpeg", data: encodeBase64(jpeg), width: img.width, height: img.height };
}

Deno.serve(createHandler({
  sql,
  selfUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/intel-shopify`,
  waitUntil: (p: Promise<unknown>) => EdgeRuntime.waitUntil(p),
  thumb,
}));

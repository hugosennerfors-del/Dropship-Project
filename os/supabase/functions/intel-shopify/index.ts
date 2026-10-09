// intel-shopify: the only code that reads a Shopify token and talks to
// Shopify. Started by intel.fn_dispatch (pg_net) with {action, id} and the
// shared secret; the logic is in lib/ (copied from src/shopify by
// scripts/edge-sync.mjs).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";
import { createHandler } from "./lib/edge.js";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 });

Deno.serve(createHandler({
  sql,
  selfUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/intel-shopify`,
  waitUntil: (p: Promise<unknown>) => EdgeRuntime.waitUntil(p),
}));

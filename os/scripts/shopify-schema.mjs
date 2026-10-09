// Contract check: does a store's Admin API, at the pinned version, have every
// field and argument this integration sends?
//
//   npm run shopify:schema                       against the simulated store
//   SHOPIFY_SHOP=your-dev-store.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_… npm run shopify:schema
//   SHOPIFY_SHOP=… SHOPIFY_CLIENT_ID=… SHOPIFY_CLIENT_SECRET=… npm run shopify:schema
//
// Read-only: it runs the shop query, publicApiVersions and introspection,
// nothing else. Exits 1 when a field is missing, so it fails in CI after an
// API version change. Use a development store; the token is read from the
// environment and never printed.
import { createClient } from "../src/shopify/client.js";
import { verifySchema } from "../src/shopify/schema.js";
import { accessToken } from "../src/shopify/auth.js";
import { createMockShop } from "../src/shopify/mockshop.js";
import { Q } from "../src/shopify/documents.js";
import { SHOPIFY_API_VERSION } from "../src/shopify/version.js";

const env = process.env;
const shopDomain = env.SHOPIFY_SHOP || "";
let fetchImpl = globalThis.fetch, label;
let token;
if (!shopDomain) {
  const mock = createMockShop();
  fetchImpl = mock.fetch;
  token = "simulated";
  label = `simulated store (no Shopify; set SHOPIFY_SHOP to check a real store)`;
} else if (env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET) {
  const vault = new Map([["secret", env.SHOPIFY_CLIENT_SECRET]]);
  token = await accessToken(
    { id: "cli", auth_kind: "client_credentials", shop_domain: shopDomain, client_id: env.SHOPIFY_CLIENT_ID, client_secret_id: "secret" },
    { secrets: { read: async (id) => vault.get(id) || null, saveToken: async () => {} } },
  );
  label = `${shopDomain} (Dev Dashboard app, client credentials)`;
} else if (env.SHOPIFY_ADMIN_TOKEN) {
  token = env.SHOPIFY_ADMIN_TOKEN;
  label = `${shopDomain} (Admin API token)`;
} else {
  console.error("Set SHOPIFY_ADMIN_TOKEN, or SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET, next to SHOPIFY_SHOP.");
  process.exit(2);
}

const client = createClient({ shop: shopDomain || "plan-vy-test.mock.test", token, fetch: fetchImpl });
const { data: s } = await client.request(Q.shop);
const { data: v } = await client.request(Q.versions);
const res = await verifySchema(client);
const versions = v?.publicApiVersions || [];
const pinned = versions.find((x) => x.handle === SHOPIFY_API_VERSION);

console.log(`Store:        ${label}`);
console.log(`Shop:         ${s?.shop?.name} · ${s?.shop?.currencyCode} · ${s?.shop?.plan?.publicDisplayName}${s?.shop?.plan?.partnerDevelopment ? " (development store)" : ""}`);
console.log(`API version:  ${SHOPIFY_API_VERSION} pinned · ${pinned ? (pinned.supported ? "supported" : "NO LONGER SUPPORTED") : "not listed by the store"} · listed: ${versions.map((x) => x.handle).slice(-5).join(", ")}`);
console.log(`Fields:       ${res.checked} checked, ${res.missing.length} missing, ${res.deprecated.length} deprecated`);
for (const m of res.missing) console.log(`  missing     ${m}`);
for (const d of res.deprecated) console.log(`  deprecated  ${d}`);
console.log(res.ok ? "✓ every field this integration sends exists in the pinned version" : "✗ the pinned version lacks fields; see above");
process.exit(res.ok ? 0 : 1);

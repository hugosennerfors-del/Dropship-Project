// The Admin API access token for a connection, behind one function so the
// publishing code never knows how a store was connected.
//
//   token               an Admin API token pasted once: a custom app made in
//                       the store admin before 2026 (Shopify stopped new ones
//                       on 1 January 2026) or an offline token. Used as is.
//   client_credentials  an app made in Shopify's Dev Dashboard, in the same
//                       organisation as the store. Its Client ID and secret
//                       are exchanged at /admin/oauth/access_token for a
//                       token that lives `expires_in` seconds (about 24 h);
//                       it is cached in Vault and renewed a few minutes
//                       before it runs out. There is no refresh token: the
//                       same request is simply made again.
//
// The authorization-code grant (OAuth with a callback, for stores outside
// your organisation) is not built; it would be a third kind here.
//
// `secrets` is the Vault port: read(id) and saveToken(conn, token, expiresAt).

import { ShopifyError } from "./client.js";

export const RENEW_BEFORE_S = 300;

// `fresh` skips the cached token, so a connection test sees scopes released
// since the token was issued.
export async function accessToken(conn, { secrets, fetch: fetchImpl = globalThis.fetch, now = () => Date.now(), fresh = false }) {
  if (conn.auth_kind !== "client_credentials") {
    if (!conn.token_secret_id) throw new ShopifyError("config", "The store is disconnected.");
    const t = await secrets.read(conn.token_secret_id);
    if (!t) throw new ShopifyError("config", "The store's token is missing from Vault; connect the store again.");
    return t;
  }
  const expires = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (!fresh && conn.token_secret_id && expires - now() > RENEW_BEFORE_S * 1000) {
    const cached = await secrets.read(conn.token_secret_id);
    if (cached) return cached;
  }
  if (!conn.client_id || !conn.client_secret_id) throw new ShopifyError("config", "The store's app credentials are missing; connect the store again.");
  const secret = await secrets.read(conn.client_secret_id);
  if (!secret) throw new ShopifyError("config", "The app's client secret is missing from Vault; connect the store again.");

  let res, body = null;
  try {
    res = await fetchImpl(`https://${conn.shop_domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: conn.client_id, client_secret: secret }).toString(),
    });
    const text = await res.text();
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  } catch (e) {
    throw new ShopifyError("network", `Shopify could not be reached for a token (${String(e?.message || e).slice(0, 120)}).`);
  }
  if (!res.ok || !body?.access_token) {
    const code = String(body?.error || `http ${res.status}`).slice(0, 60);
    const detail = String(body?.error_description || "").slice(0, 200);
    const message = code === "shop_not_permitted"
      ? "Shopify only gives this app a token for stores in the same organisation as the app. Create the app in the Dev Dashboard of the organisation that owns this store, or connect with an Admin API token."
      : res.status === 400 || res.status === 401
        ? `Shopify did not accept the Client ID and secret (${code}${detail ? `: ${detail}` : ""}). Copy both again from the Dev Dashboard > your app > Settings, and check the app is installed on this store.`
        : `Shopify did not issue a token (${code}${detail ? `: ${detail}` : ""}).`;
    throw new ShopifyError("auth", message, { status: res.status });
  }
  const lifetime = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
  const expiresAt = new Date(now() + lifetime * 1000).toISOString();
  await secrets.saveToken(conn, body.access_token, expiresAt);
  return body.access_token;
}

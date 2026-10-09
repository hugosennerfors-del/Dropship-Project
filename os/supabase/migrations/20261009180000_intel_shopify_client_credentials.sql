-- Dev Dashboard apps (client credentials grant) next to pasted tokens.
--
-- Since 1 January 2026 a store can no longer create new "legacy custom apps"
-- in its admin (Settings > Apps > Develop apps). New connections use an app
-- made in Shopify's Dev Dashboard, in the same organisation as the store: its
-- Client ID and client secret are exchanged for an Admin API token that lives
-- about 24 hours (expires_in), renewed by the edge function before it runs
-- out. Pasted tokens (legacy custom apps made before 2026, or an offline
-- token from OAuth) keep working as before. The client secret and the
-- current token are in Vault; only the edge function reads them.

alter table intel.shopify_connections
  add column if not exists auth_kind text not null default 'token' check (auth_kind in ('token', 'client_credentials')),
  add column if not exists client_id text,
  add column if not exists client_secret_id uuid,
  add column if not exists token_expires_at timestamptz;

-- Connect with a Dev Dashboard app. Called by the n8n intake workflow (which
-- saves no executions), never by the page.
create or replace function intel.shopify_connect_app(p_shop text, p_client_id text, p_client_secret text, p_label text default null, p_is_test boolean default true)
returns jsonb language plpgsql security definer set search_path = intel, public, pg_temp as $$
declare shop text; cid uuid; old_secret uuid; old_token uuid; sid uuid; mock boolean;
begin
  shop := lower(regexp_replace(regexp_replace(trim(coalesce(p_shop, '')), '^https?://', ''), '/.*$', ''));
  if shop !~ '^[a-z0-9][a-z0-9-]{0,60}\.(myshopify\.com|mock\.test)$' then raise exception 'Use the store''s myshopify.com address, e.g. your-store.myshopify.com'; end if;
  mock := shop ~ '\.mock\.test$';
  if mock and not coalesce(p_is_test, true) then raise exception 'A simulated store can only be a test store'; end if;
  if coalesce(p_client_id, '') !~ '^[A-Za-z0-9_-]{8,100}$' then raise exception 'That does not look like a Client ID (Dev Dashboard > your app > Settings)'; end if;
  if length(coalesce(p_client_secret, '')) < 8 or length(p_client_secret) > 300 or p_client_secret ~ '\s' then raise exception 'That does not look like a client secret (Dev Dashboard > your app > Settings)'; end if;
  select id, client_secret_id, token_secret_id into cid, old_secret, old_token from intel.shopify_connections where shop_domain = shop;
  if old_secret is not null then
    perform vault.update_secret(old_secret, p_client_secret);
    sid := old_secret;
  else
    sid := vault.create_secret(p_client_secret, 'shopify-app:' || shop || ':' || gen_random_uuid(), 'Shopify app client secret for ' || shop);
  end if;
  -- A token from an earlier connection is dropped; a fresh one is fetched.
  if old_token is not null then delete from vault.secrets where id = old_token; end if;
  insert into intel.shopify_connections (shop_domain, auth_kind, client_id, client_secret_id, token_secret_id, token_expires_at, label, is_test_store, status, last_error, updated_at)
  values (shop, 'client_credentials', p_client_id, sid, null, null, nullif(left(trim(coalesce(p_label, '')), 80), ''), coalesce(p_is_test, true), 'pending', null, now())
  on conflict (shop_domain) do update set auth_kind = 'client_credentials', client_id = excluded.client_id, client_secret_id = excluded.client_secret_id,
    token_secret_id = null, token_expires_at = null, label = coalesce(excluded.label, intel.shopify_connections.label),
    is_test_store = excluded.is_test_store, status = 'pending', last_error = null, updated_at = now()
  returning id into cid;
  insert into intel.audit_log (action, target, metadata) values ('shopify.connect', cid::text, jsonb_build_object('shop', shop, 'test', coalesce(p_is_test, true), 'auth', 'client_credentials'));
  perform intel.fn_dispatch('test', cid);
  return jsonb_build_object('ok', true, 'id', cid, 'shop', shop);
end $$;

-- Connect with a pasted Admin API token. Same as before, and it now also
-- switches a client-credentials connection back to a plain token.
create or replace function intel.shopify_connect(p_shop text, p_token text, p_label text default null, p_is_test boolean default true)
returns jsonb language plpgsql security definer set search_path = intel, public, pg_temp as $$
declare shop text; sid uuid; cid uuid; mock boolean; old_secret uuid;
begin
  shop := lower(regexp_replace(regexp_replace(trim(coalesce(p_shop, '')), '^https?://', ''), '/.*$', ''));
  if shop !~ '^[a-z0-9][a-z0-9-]{0,60}\.(myshopify\.com|mock\.test)$' then raise exception 'Use the store''s myshopify.com address, e.g. your-store.myshopify.com'; end if;
  mock := shop ~ '\.mock\.test$';
  if mock and not coalesce(p_is_test, true) then raise exception 'A simulated store can only be a test store'; end if;
  if not mock and coalesce(p_token, '') !~ '^shp[a-z]{2}_[A-Za-z0-9]{16,}$' then raise exception 'That does not look like an Admin API access token (it starts with shpat_)'; end if;
  if mock and length(coalesce(p_token, '')) < 8 then raise exception 'token too short'; end if;
  select id, token_secret_id, client_secret_id into cid, sid, old_secret from intel.shopify_connections where shop_domain = shop;
  if sid is not null then
    perform vault.update_secret(sid, p_token);
  else
    sid := vault.create_secret(p_token, 'shopify:' || shop || ':' || gen_random_uuid(), 'Shopify Admin API token for ' || shop);
  end if;
  if old_secret is not null then delete from vault.secrets where id = old_secret; end if;
  insert into intel.shopify_connections (shop_domain, auth_kind, token_secret_id, label, is_test_store, status, last_error, updated_at)
  values (shop, 'token', sid, nullif(left(trim(coalesce(p_label, '')), 80), ''), coalesce(p_is_test, true), 'pending', null, now())
  on conflict (shop_domain) do update set auth_kind = 'token', client_id = null, client_secret_id = null, token_expires_at = null,
    token_secret_id = excluded.token_secret_id, label = coalesce(excluded.label, intel.shopify_connections.label),
    is_test_store = excluded.is_test_store, status = 'pending', last_error = null, updated_at = now()
  returning id into cid;
  insert into intel.audit_log (action, target, metadata) values ('shopify.connect', cid::text, jsonb_build_object('shop', shop, 'test', coalesce(p_is_test, true), 'auth', 'token'));
  perform intel.fn_dispatch('test', cid);
  return jsonb_build_object('ok', true, 'id', cid, 'shop', shop);
end $$;

-- The edge function caches a client-credentials token here, with its expiry.
create or replace function intel.shopify_cache_token(p_id uuid, p_token text, p_expires_at timestamptz)
returns uuid language plpgsql security definer set search_path = intel, public, pg_temp as $$
declare sid uuid; shop text;
begin
  select token_secret_id, shop_domain into sid, shop from intel.shopify_connections where id = p_id and auth_kind = 'client_credentials' for update;
  if not found then raise exception 'unknown client-credentials connection'; end if;
  if sid is not null then
    perform vault.update_secret(sid, p_token);
  else
    sid := vault.create_secret(p_token, 'shopify:' || shop || ':' || gen_random_uuid(), 'Shopify Admin API token (client credentials, renewed automatically) for ' || shop);
  end if;
  update intel.shopify_connections set token_secret_id = sid, token_expires_at = p_expires_at, updated_at = now() where id = p_id;
  return sid;
end $$;

-- Disconnecting also forgets the client secret (the token is removed by
-- shopify.disconnect itself).
create or replace function intel.shopify_connections_forget() returns trigger
language plpgsql security definer set search_path = intel, public, pg_temp as $$
begin
  if new.status = 'disconnected' and new.client_secret_id is not null then
    delete from vault.secrets where id = new.client_secret_id;
    new.client_secret_id := null;
    new.token_expires_at := null;
  end if;
  return new;
end $$;
create or replace trigger shopify_connections_forget before update of status on intel.shopify_connections
  for each row execute function intel.shopify_connections_forget();

revoke all on function intel.shopify_connect_app(text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function intel.shopify_connect(text, text, text, boolean) from public, anon, authenticated;
revoke all on function intel.shopify_cache_token(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function intel.shopify_connections_forget() from public, anon, authenticated;

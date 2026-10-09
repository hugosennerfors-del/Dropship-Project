-- One entry point for the n8n intake workflow ("Plan-vy · Shopify-anslutning").
--
-- It never raises. Postgres writes the text of a failing statement to its
-- log (log_min_error_statement = error), and the text of the intake
-- statement carries the token or client secret, so a refused value comes
-- back as {ok: false, error} instead. The refusal is also written to the
-- store's connection row (last_error, never the secret) so the page can
-- show it: the intake workflow saves no executions, so the page cannot read
-- its result there.
create or replace function intel.shopify_intake(p jsonb)
returns jsonb language plpgsql security definer set search_path = intel, public, pg_temp as $$
declare shop text; msg text; is_test boolean;
begin
  begin
    if p->>'kind' = 'app' then
      return intel.shopify_connect_app(p->>'shop', p->>'clientId', p->>'clientSecret', p->>'label', case when p->>'isTest' = 'false' then false else true end);
    elsif p->>'kind' = 'token' then
      return intel.shopify_connect(p->>'shop', p->>'token', p->>'label', case when p->>'isTest' = 'false' then false else true end);
    end if;
    raise exception 'Choose how the store connects: an Admin API token or a Dev Dashboard app.';
  exception when others then
    msg := left(sqlerrm, 300);
  end;
  shop := lower(regexp_replace(regexp_replace(trim(coalesce(p->>'shop', '')), '^https?://', ''), '/.*$', ''));
  is_test := case when p->>'isTest' = 'false' then false else true end;
  if shop ~ '^[a-z0-9][a-z0-9-]{0,60}\.(myshopify\.com|mock\.test)$' then
    insert into intel.shopify_connections (shop_domain, label, is_test_store, status, last_error, updated_at)
    values (shop, nullif(left(trim(coalesce(p->>'label', '')), 80), ''), is_test or shop ~ '\.mock\.test$', 'error', 'Not connected: ' || msg, now())
    on conflict (shop_domain) do update set
      last_error = case when intel.shopify_connections.token_secret_id is null and intel.shopify_connections.client_secret_id is null
                        then 'Not connected: ' || msg else 'New credentials were refused (the earlier ones still work): ' || msg end,
      status = case when intel.shopify_connections.token_secret_id is null and intel.shopify_connections.client_secret_id is null
                    then 'error' else intel.shopify_connections.status end,
      updated_at = now();
  end if;
  insert into intel.audit_log (action, target, metadata) values ('shopify.connect_refused', shop, jsonb_build_object('error', msg));
  return jsonb_build_object('ok', false, 'error', msg, 'shop', shop);
end $$;

revoke all on function intel.shopify_intake(jsonb) from public, anon, authenticated;

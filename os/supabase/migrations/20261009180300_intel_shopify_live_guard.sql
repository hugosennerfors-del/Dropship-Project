-- A store Shopify does not report as a development store is treated as
-- live, whatever was chosen when it was connected, so every publish to it
-- needs the typed confirmation (publish.start requires confirmLive for
-- stores that are not test stores). Simulated stores (*.mock.test) stay
-- test stores.
create or replace function intel.shopify_connections_live_guard() returns trigger
language plpgsql security definer set search_path = intel, public, pg_temp as $$
begin
  if new.is_test_store and new.shop_domain !~ '\.mock\.test$' and (new.schema_check->>'partnerDevelopment') = 'false' then
    new.is_test_store := false;
    new.last_error := concat_ws(' ', new.last_error, 'Added as a test store, but Shopify does not report it as a development store, so it is treated as live.');
  end if;
  return new;
end $$;
create or replace trigger shopify_connections_live_guard before insert or update of schema_check, is_test_store on intel.shopify_connections
  for each row execute function intel.shopify_connections_live_guard();
revoke all on function intel.shopify_connections_live_guard() from public, anon, authenticated;

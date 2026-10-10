-- The store finder's run can be "degraded": Shopify's bot protection blocked
-- too many of its store checks to judge which earlier finds still qualify.
-- Such a run sends retire = false and keeps every earlier find.

create or replace function intel.api_links_found(payload jsonb)
returns jsonb
language plpgsql
set search_path = intel, public, pg_temp
as $$
declare
  s jsonb;
  v_product text := payload->>'productId';
  v_market text := payload->>'market';
  v_url text;
  v_urls text[] := '{}';
  v_price numeric;
  v_cur text;
  added int := 0;
  refreshed int := 0;
  skipped int := 0;
  retired int := 0;
begin
  if v_product !~ '^[a-z0-9][a-z0-9-]{0,119}$' then raise exception 'links.found needs a product id'; end if;
  if v_market !~ '^[A-Z]{2}$' then raise exception 'links.found needs a market'; end if;
  if jsonb_typeof(payload->'stores') <> 'array' then raise exception 'links.found needs a list of stores'; end if;
  for s in select * from jsonb_array_elements(payload->'stores') limit 25 loop
    v_url := btrim(s->>'url');
    if v_url is null or v_url !~ '^https://[^[:space:]]+$' or length(v_url) > 2000 then skipped := skipped + 1; continue; end if;
    v_urls := v_urls || v_url;
    v_price := case when (s->>'price') ~ '^\d{1,7}(\.\d{1,2})?$' then (s->>'price')::numeric end;
    v_cur := case when v_price is not null and (s->>'currency') ~ '^[A-Za-z]{3}$' then upper(s->>'currency') end;
    if v_cur is null then v_price := null; end if;
    -- You removed it: leave it out.
    if exists (select 1 from intel.product_links where product_id = v_product and kind = 'store' and url = v_url and removed_by = 'you')
       and not exists (select 1 from intel.product_links where product_id = v_product and kind = 'store' and url = v_url and removed_at is null) then
      skipped := skipped + 1; continue;
    end if;
    -- Already listed: fresh signals; your own fields stay.
    update intel.product_links set signals = s->'signals', updated_at = now(),
        price = case when found_by = 'search' then v_price else price end,
        currency = case when found_by = 'search' then v_cur else currency end,
        note = case when found_by = 'search' then left(nullif(btrim(s->>'note'), ''), 1000) else note end
      where product_id = v_product and kind = 'store' and url = v_url and removed_at is null;
    if found then refreshed := refreshed + 1; continue; end if;
    insert into intel.product_links (id, product_id, kind, market, url, name, price, currency, note, found_by, signals)
    values (gen_random_uuid(), v_product, 'store', v_market, v_url, left(nullif(btrim(s->>'name'), ''), 200), v_price, v_cur,
      left(nullif(btrim(s->>'note'), ''), 1000), 'search',
      case when jsonb_typeof(s->'signals') = 'object' and octet_length((s->'signals')::text) <= 4000 then s->'signals' end);
    added := added + 1;
  end loop;
  -- Earlier finds this run no longer rates as dropshipping. A run whose
  -- store checks were mostly blocked (retire = false) keeps them.
  if coalesce((payload->>'retire')::boolean, true) then
    update intel.product_links set removed_at = now(), removed_by = 'search', updated_at = now()
      where product_id = v_product and kind = 'store' and market = v_market and found_by = 'search'
        and removed_at is null and not (url = any (v_urls));
    get diagnostics retired = row_count;
  end if;
  insert into intel.audit_log (actor, action, target, metadata)
  values ('n8n', 'links.found', v_product, jsonb_build_object('market', v_market, 'added', added, 'refreshed', refreshed,
    'skipped', skipped, 'retired', retired, 'query', left(payload->>'query', 100)));
  return jsonb_build_object('ok', true, 'added', added, 'refreshed', refreshed, 'skipped', skipped, 'retired', retired);
end $$;

revoke all on function intel.api_links_found(jsonb) from public, anon, authenticated;

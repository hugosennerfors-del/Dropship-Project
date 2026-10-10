-- Dropshipping stores found automatically by the n8n workflow
-- "Plan-vy · Dropshipping-butiker" (Brave Search, then each store's public
-- Shopify files). They are saved next to the links you add yourself and
-- marked found_by = 'search' with the signals behind the guess.

alter table intel.product_links add column if not exists found_by text not null default 'you' check (found_by in ('you', 'search'));
alter table intel.product_links add column if not exists signals jsonb check (signals is null or (jsonb_typeof(signals) = 'object' and octet_length(signals::text) <= 4000));

create or replace function intel.api_read_links()
returns jsonb
language sql
stable
set search_path = intel, public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', l.id, 'productId', l.product_id, 'kind', l.kind, 'market', l.market, 'url', l.url, 'name', l.name,
    'price', l.price, 'currency', l.currency, 'moq', l.moq, 'note', l.note, 'foundBy', l.found_by, 'signals', l.signals,
    'createdAt', l.created_at, 'updatedAt', l.updated_at))
    order by l.created_at desc), '[]'::jsonb)
  from (select * from intel.product_links where removed_at is null order by created_at desc limit 4000) l;
$$;

-- links.found: a batch from the store finder. New stores are added; a store
-- already saved keeps your own fields, and a found one gets fresh signals.
-- A store you removed is not added again by the same search.
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
  v_price numeric;
  v_cur text;
  added int := 0;
  refreshed int := 0;
  skipped int := 0;
begin
  if v_product !~ '^[a-z0-9][a-z0-9-]{0,119}$' then raise exception 'links.found needs a product id'; end if;
  if v_market !~ '^[A-Z]{2}$' then raise exception 'links.found needs a market'; end if;
  if jsonb_typeof(payload->'stores') <> 'array' then raise exception 'links.found needs a list of stores'; end if;
  for s in select * from jsonb_array_elements(payload->'stores') limit 25 loop
    v_url := btrim(s->>'url');
    if v_url is null or v_url !~ '^https://[^[:space:]]+$' or length(v_url) > 2000 then skipped := skipped + 1; continue; end if;
    v_price := case when (s->>'price') ~ '^\d{1,7}(\.\d{1,2})?$' then (s->>'price')::numeric end;
    v_cur := case when v_price is not null and (s->>'currency') ~ '^[A-Za-z]{3}$' then upper(s->>'currency') end;
    if v_cur is null then v_price := null; end if;
    if exists (select 1 from intel.product_links where product_id = v_product and kind = 'store' and url = v_url and removed_at is not null and found_by = 'search')
       and not exists (select 1 from intel.product_links where product_id = v_product and kind = 'store' and url = v_url and removed_at is null) then
      skipped := skipped + 1; continue;
    end if;
    update intel.product_links set signals = s->'signals', updated_at = now(),
        price = case when found_by = 'search' then v_price else price end,
        currency = case when found_by = 'search' then v_cur else currency end
      where product_id = v_product and kind = 'store' and url = v_url and removed_at is null;
    if found then refreshed := refreshed + 1; continue; end if;
    insert into intel.product_links (id, product_id, kind, market, url, name, price, currency, note, found_by, signals)
    values (gen_random_uuid(), v_product, 'store', v_market, v_url, left(nullif(btrim(s->>'name'), ''), 200), v_price, v_cur,
      left(nullif(btrim(s->>'note'), ''), 1000), 'search',
      case when jsonb_typeof(s->'signals') = 'object' and octet_length((s->'signals')::text) <= 4000 then s->'signals' end);
    added := added + 1;
  end loop;
  insert into intel.audit_log (actor, action, target, metadata)
  values ('n8n', 'links.found', v_product, jsonb_build_object('market', v_market, 'added', added, 'refreshed', refreshed, 'skipped', skipped, 'query', left(payload->>'query', 100)));
  return jsonb_build_object('ok', true, 'added', added, 'refreshed', refreshed, 'skipped', skipped);
end $$;

revoke all on function intel.api_links_found(jsonb) from public, anon, authenticated;

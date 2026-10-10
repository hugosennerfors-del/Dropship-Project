-- A new run of the store finder replaces its earlier finds for the same
-- product and market: stores it found before but no longer rates as
-- dropshipping are retired (removed_by = 'search'). Stores you saved stay,
-- and a store you removed yourself (removed_by = 'you') is never added back.
-- Editing a found store makes it yours (found_by = 'you').

alter table intel.product_links add column if not exists removed_by text check (removed_by in ('you', 'search'));
update intel.product_links set removed_by = 'you' where removed_at is not null and removed_by is null;

create or replace function intel.api_write_links(action text, payload jsonb)
returns jsonb
language plpgsql
set search_path = intel, public, pg_temp
as $$
declare
  v_id uuid;
  v_row intel.product_links;
  v_other uuid;
  v_kind text := payload->>'kind';
  v_price numeric;
  v_moq integer;
  t text;
begin
  if action = 'links.save' then
    begin
      v_id := (payload->>'id')::uuid;
    exception when others then
      raise exception 'links.save needs a valid id';
    end;
    if v_id is null then raise exception 'links.save needs an id'; end if;
    if v_kind not in ('store', 'supplier') then raise exception 'kind must be store or supplier'; end if;
    t := nullif(btrim(payload->>'price'), '');
    if t is not null then
      if t !~ '^\d{1,7}(\.\d{1,2})?$' then raise exception 'Price must be a number with at most two decimals'; end if;
      v_price := t::numeric;
    end if;
    t := nullif(btrim(payload->>'moq'), '');
    if t is not null then
      if t !~ '^\d{1,8}$' then raise exception 'Minimum order must be a whole number'; end if;
      v_moq := t::integer;
    end if;
    select id into v_other from intel.product_links
      where product_id = payload->>'productId' and kind = v_kind and url = btrim(payload->>'url') and removed_at is null and id <> v_id;
    if v_other is not null then raise exception 'This link is already saved for this product'; end if;

    insert into intel.product_links as l (id, product_id, kind, market, url, name, price, currency, moq, note)
    values (v_id, payload->>'productId', v_kind,
      case when v_kind = 'store' then payload->>'market' end,
      btrim(payload->>'url'), nullif(btrim(payload->>'name'), ''), v_price,
      case when v_price is not null then upper(payload->>'currency') end,
      case when v_kind = 'supplier' then v_moq end,
      nullif(btrim(payload->>'note'), ''))
    on conflict (id) do update set
      market = excluded.market, url = excluded.url, name = excluded.name, price = excluded.price, currency = excluded.currency,
      moq = excluded.moq, note = excluded.note, updated_at = now(), removed_at = null, removed_by = null,
      -- Editing a store the finder found makes it yours: a later run keeps it.
      found_by = 'you'
      where l.product_id = excluded.product_id and l.kind = excluded.kind
    returning * into v_row;
    if v_row.id is null then raise exception 'That id belongs to another product or kind of link'; end if;

    insert into intel.audit_log (action, target, metadata)
    values ('links.save', v_row.product_id, jsonb_build_object('id', v_row.id, 'kind', v_row.kind, 'market', v_row.market));
    return jsonb_build_object('ok', true, 'id', v_row.id);

  elsif action = 'links.remove' then
    begin
      v_id := (payload->>'id')::uuid;
    exception when others then
      raise exception 'links.remove needs a valid id';
    end;
    update intel.product_links set removed_at = now(), removed_by = 'you', updated_at = now()
      where id = v_id and removed_at is null
      returning * into v_row;
    if v_row.id is not null then
      insert into intel.audit_log (action, target, metadata)
      values ('links.remove', v_row.product_id, jsonb_build_object('id', v_row.id, 'kind', v_row.kind));
    end if;
    return jsonb_build_object('ok', true, 'removed', v_row.id is not null);
  end if;

  raise exception 'Unknown action: %', action;
end $$;

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
  -- Earlier finds this run no longer rates as dropshipping.
  update intel.product_links set removed_at = now(), removed_by = 'search', updated_at = now()
    where product_id = v_product and kind = 'store' and market = v_market and found_by = 'search'
      and removed_at is null and not (url = any (v_urls));
  get diagnostics retired = row_count;
  insert into intel.audit_log (actor, action, target, metadata)
  values ('n8n', 'links.found', v_product, jsonb_build_object('market', v_market, 'added', added, 'refreshed', refreshed,
    'skipped', skipped, 'retired', retired, 'query', left(payload->>'query', 100)));
  return jsonb_build_object('ok', true, 'added', added, 'refreshed', refreshed, 'skipped', skipped, 'retired', retired);
end $$;

revoke all on function intel.api_links_found(jsonb) from public, anon, authenticated;
revoke all on function intel.api_write_links(text, jsonb) from public, anon, authenticated;

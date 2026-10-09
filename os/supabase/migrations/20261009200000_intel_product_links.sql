-- Stores selling a product and suppliers making it, saved on the product
-- page: a competitor's product page (per market, with its price) or a
-- supplier listing on AliExpress, Alibaba, 1688 or elsewhere (unit price,
-- currency, minimum order).
--
-- Written only through intel.api_write('links.save' | 'links.remove') and
-- read through intel.api_read (key "links"). Removing keeps the row
-- (removed_at), like ads and overlays.

create table if not exists intel.product_links (
  id uuid primary key,
  product_id text not null check (product_id ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  kind text not null check (kind in ('store', 'supplier')),
  market text check (market ~ '^[A-Z]{2}$'),
  url text not null check (url ~ '^https://[^[:space:]]+$' and length(url) <= 2000),
  name text check (length(name) <= 200),
  price numeric(12, 2) check (price >= 0 and price < 10000000),
  currency text check (currency ~ '^[A-Z]{3}$'),
  moq integer check (moq between 1 and 10000000),
  note text check (length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  -- A store belongs to one market; a supplier serves every market.
  check ((kind = 'store' and market is not null and moq is null) or (kind = 'supplier' and market is null)),
  check (price is null or currency is not null)
);

create unique index if not exists product_links_one_per_url on intel.product_links (product_id, kind, url) where removed_at is null;
create index if not exists product_links_product on intel.product_links (product_id) where removed_at is null;

alter table intel.product_links enable row level security;
revoke all on intel.product_links from anon, authenticated;

create or replace function intel.api_read_links()
returns jsonb
language sql
stable
set search_path = intel, public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', l.id, 'productId', l.product_id, 'kind', l.kind, 'market', l.market, 'url', l.url, 'name', l.name,
    'price', l.price, 'currency', l.currency, 'moq', l.moq, 'note', l.note,
    'createdAt', l.created_at, 'updatedAt', l.updated_at))
    order by l.created_at desc), '[]'::jsonb)
  from (select * from intel.product_links where removed_at is null order by created_at desc limit 4000) l;
$$;

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
      moq = excluded.moq, note = excluded.note, updated_at = now(), removed_at = null
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
    update intel.product_links set removed_at = now(), updated_at = now()
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

revoke all on function intel.api_read_links() from public, anon, authenticated;
revoke all on function intel.api_write_links(text, jsonb) from public, anon, authenticated;

create or replace function intel.api_write(action text, payload jsonb)
returns jsonb
language plpgsql
set search_path = intel, public, pg_temp
as $$
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception 'payload must be a JSON object'; end if;
  if octet_length(payload::text) > 400000 then raise exception 'payload too large'; end if;
  if split_part(action, '.', 1) in ('brand', 'generation', 'limits', 'publish', 'shopify') then return intel.api_write_shopify(action, payload); end if;
  if split_part(action, '.', 1) = 'ads' then return intel.api_write_ads(action, payload); end if;
  if split_part(action, '.', 1) = 'links' then return intel.api_write_links(action, payload); end if;
  return intel.api_write_base(action, payload);
end $$;

create or replace function intel.api_read(params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
set search_path = intel, public, pg_temp
as $$
declare r jsonb;
begin
  if coalesce((params->>'shopifyOnly')::boolean, false) then
    return jsonb_build_object('ok', true, 'generatedAt', now(), 'shopify', intel.api_read_shopify(params));
  end if;
  r := intel.api_read_base(params) || jsonb_build_object('ads', intel.api_read_ads(), 'links', intel.api_read_links());
  if coalesce((params->>'shopify')::boolean, false) then r := r || jsonb_build_object('shopify', intel.api_read_shopify(params)); end if;
  return r;
end $$;

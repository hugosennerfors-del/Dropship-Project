-- Competitor ads saved on a product page: an ad you found in Meta's Ad
-- Library, TikTok's ad library or elsewhere, with when it started running.
-- Ads that keep running for weeks are a common sign that they pay for
-- themselves; the page counts them per product.
--
-- Written only through intel.api_write('ads.save' | 'ads.remove') and read
-- through intel.api_read (key "ads"). Removing an ad keeps the row
-- (removed_at), like overlays.

create table if not exists intel.product_ads (
  id uuid primary key,
  product_id text not null check (product_id ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  market text not null check (market ~ '^[A-Z]{2}$'),
  platform text not null check (platform in ('meta', 'tiktok', 'google', 'pinterest', 'youtube', 'other')),
  url text not null check (url ~ '^https://[^[:space:]]+$' and length(url) <= 2000),
  advertiser text check (length(advertiser) <= 200),
  started_on date,
  still_running boolean not null default true,
  angle text check (length(angle) <= 300),
  note text check (length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz
);

create unique index if not exists product_ads_one_per_url on intel.product_ads (product_id, url) where removed_at is null;
create index if not exists product_ads_product on intel.product_ads (product_id) where removed_at is null;

alter table intel.product_ads enable row level security;
revoke all on intel.product_ads from anon, authenticated;

create or replace function intel.api_read_ads()
returns jsonb
language sql
stable
set search_path = intel, public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', a.id, 'productId', a.product_id, 'market', a.market, 'platform', a.platform, 'url', a.url,
    'advertiser', a.advertiser, 'startedOn', a.started_on, 'stillRunning', a.still_running,
    'angle', a.angle, 'note', a.note, 'createdAt', a.created_at, 'updatedAt', a.updated_at))
    order by a.created_at desc), '[]'::jsonb)
  from (select * from intel.product_ads where removed_at is null order by created_at desc limit 2000) a;
$$;

create or replace function intel.api_write_ads(action text, payload jsonb)
returns jsonb
language plpgsql
set search_path = intel, public, pg_temp
as $$
declare
  v_id uuid;
  v_started date;
  v_row intel.product_ads;
  v_other uuid;
  t text;
begin
  if action = 'ads.save' then
    begin
      v_id := (payload->>'id')::uuid;
    exception when others then
      raise exception 'ads.save needs a valid id';
    end;
    if v_id is null then raise exception 'ads.save needs an id'; end if;
    t := nullif(btrim(payload->>'startedOn'), '');
    if t is not null then
      if t !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Started running on must be a date (YYYY-MM-DD)'; end if;
      v_started := t::date;
      if v_started > current_date + 1 then raise exception 'Started running on cannot be in the future'; end if;
      if v_started < date '2010-01-01' then raise exception 'Started running on is too far back'; end if;
    end if;
    -- The same ad saved twice on one product is one row.
    select id into v_other from intel.product_ads
      where product_id = payload->>'productId' and url = btrim(payload->>'url') and removed_at is null and id <> v_id;
    if v_other is not null then raise exception 'This ad is already saved for this product'; end if;

    insert into intel.product_ads as a (id, product_id, market, platform, url, advertiser, started_on, still_running, angle, note)
    values (v_id, payload->>'productId', payload->>'market', payload->>'platform', btrim(payload->>'url'),
      nullif(btrim(payload->>'advertiser'), ''), v_started, coalesce((payload->>'stillRunning')::boolean, true),
      nullif(btrim(payload->>'angle'), ''), nullif(btrim(payload->>'note'), ''))
    on conflict (id) do update set
      market = excluded.market, platform = excluded.platform, url = excluded.url, advertiser = excluded.advertiser,
      started_on = excluded.started_on, still_running = excluded.still_running, angle = excluded.angle, note = excluded.note,
      updated_at = now(), removed_at = null
      where a.product_id = excluded.product_id
    returning * into v_row;
    if v_row.id is null then raise exception 'That id belongs to an ad on another product'; end if;

    insert into intel.audit_log (action, target, metadata)
    values ('ads.save', v_row.product_id, jsonb_build_object('id', v_row.id, 'platform', v_row.platform, 'market', v_row.market));
    return jsonb_build_object('ok', true, 'id', v_row.id);

  elsif action = 'ads.remove' then
    begin
      v_id := (payload->>'id')::uuid;
    exception when others then
      raise exception 'ads.remove needs a valid id';
    end;
    update intel.product_ads set removed_at = now(), updated_at = now()
      where id = v_id and removed_at is null
      returning * into v_row;
    if v_row.id is not null then
      insert into intel.audit_log (action, target, metadata)
      values ('ads.remove', v_row.product_id, jsonb_build_object('id', v_row.id));
    end if;
    return jsonb_build_object('ok', true, 'removed', v_row.id is not null);
  end if;

  raise exception 'Unknown action: %', action;
end $$;

revoke all on function intel.api_read_ads() from public, anon, authenticated;
revoke all on function intel.api_write_ads(text, jsonb) from public, anon, authenticated;

-- Route the new actions and include saved ads in every full read.
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
  r := intel.api_read_base(params) || jsonb_build_object('ads', intel.api_read_ads());
  if coalesce((params->>'shopify')::boolean, false) then r := r || jsonb_build_object('shopify', intel.api_read_shopify(params)); end if;
  return r;
end $$;

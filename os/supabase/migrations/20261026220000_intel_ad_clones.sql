-- "Copy ad" on the product page's Ads section (src/shopify/clone.js).
--
-- A saved GetHookd ad is copied with GetHookd's image models
-- (create_clone_ad); the edge function (action "clone") polls until the
-- images are made and keeps small JPEG copies of them here, with the
-- original ad's words. Claude writes our own text for it in the page, and
-- the owner reviews it: approved or rejected, with edits. Nothing is
-- published anywhere.
--
-- Write actions (allow-listed in the n8n workflow "Plan-vy · Intelligence-DB"):
--   ads.clone         start a copy: { productId, market, adId, model, aspect, variations }
--   ads.clone.save    save the text and the review: { id, copy, review, note }
--   ads.clone.retry   look again at a copy that stopped: { id }
--   ads.clone.remove  hide a copy from the page: { id }
-- Read: { adClones: productId } lists a product's copies without images;
-- { adClone: id } returns one with its images.

create table if not exists intel.ad_clones (
  id uuid primary key default gen_random_uuid(),
  product_id text not null check (product_id ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  market text not null default 'UK' check (market in ('UK', 'SE')),
  ad_id uuid references intel.product_ads (id) on delete set null,
  hookd_ad_id bigint not null check (hookd_ad_id > 0),
  model text not null check (model in ('nano-banana-2', 'nano-banana-pro', 'gpt-image')),
  aspect text not null check (aspect in ('1:1', '9:16', '3:4')),
  variations int not null check (variations between 1 and 4),
  status text not null default 'queued' check (status in ('queued', 'generating', 'thumbs', 'done', 'failed')),
  clone_id bigint,
  source jsonb check (source is null or octet_length(source::text) <= 200000),
  images jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array' and octet_length(images::text) <= 800000),
  billing jsonb,
  missing int,
  remaining_credits numeric,
  copy jsonb check (copy is null or (jsonb_typeof(copy) = 'object' and octet_length(copy::text) <= 8000)),
  review text not null default 'new' check (review in ('new', 'approved', 'rejected')),
  note text check (note is null or length(note) <= 1000),
  error text,
  lease_until timestamptz,
  invocations int not null default 0,
  polls int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  removed_at timestamptz
);
create index if not exists ad_clones_product on intel.ad_clones (product_id, created_at desc) where removed_at is null;
create index if not exists ad_clones_created on intel.ad_clones (created_at desc);
alter table intel.ad_clones enable row level security;

-- One copy as the page reads it; images only when asked for.
create or replace function intel.ad_clone_json(c intel.ad_clones, with_images boolean)
 returns jsonb
 language sql
 stable
 set search_path to 'intel', 'public', 'pg_temp'
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', c.id, 'productId', c.product_id, 'market', c.market, 'adId', c.ad_id, 'hookdAdId', c.hookd_ad_id::text,
    'model', c.model, 'aspect', c.aspect, 'variations', c.variations, 'status', c.status, 'cloneId', c.clone_id::text,
    'source', case when with_images then c.source else c.source - 'image' end,
    'images', case when with_images then c.images
      else (select coalesce(jsonb_agg(x - 'image' || jsonb_build_object('copied', jsonb_typeof(x->'image') = 'object')), '[]'::jsonb) from jsonb_array_elements(c.images) x) end,
    'billing', c.billing, 'missing', c.missing, 'remainingCredits', c.remaining_credits, 'copy', c.copy, 'review', c.review, 'note', c.note,
    'error', c.error, 'createdAt', c.created_at, 'updatedAt', c.updated_at, 'finishedAt', c.finished_at));
$function$;

create or replace function intel.api_write_clone(action text, payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'intel', 'public', 'pg_temp'
as $function$
declare
  a intel.product_ads;
  c intel.ad_clones;
  hid text;
  cid uuid;
  rv text;
begin
  if action = 'ads.clone' then
    if coalesce(payload->>'productId', '') !~ '^[a-z0-9][a-z0-9-]{0,119}$' then raise exception 'unknown product'; end if;
    if coalesce(payload->>'adId', '') !~ '^[0-9a-f-]{36}$' then raise exception 'unknown ad'; end if;
    select * into a from intel.product_ads where id = (payload->>'adId')::uuid and product_id = payload->>'productId' and removed_at is null;
    if a.id is null then raise exception 'That ad is not saved for this product.'; end if;
    hid := coalesce(nullif(a.metrics->>'adId', ''), substring(a.url from '^https://app\.gethookd\.ai/share/ad/(\d{1,15})(?:[?#]|$)'));
    if hid is null or hid !~ '^\d{1,15}$' then raise exception 'Only ads found with GetHookd can be copied.'; end if;
    if coalesce(payload->>'model', '') not in ('nano-banana-2', 'nano-banana-pro', 'gpt-image') then raise exception 'unknown image model'; end if;
    if coalesce(payload->>'aspect', '') not in ('1:1', '9:16', '3:4') then raise exception 'unknown aspect ratio'; end if;
    if coalesce(payload->>'variations', '') !~ '^[1-4]$' then raise exception 'Ask for 1 to 4 images.'; end if;
    if not exists (select 1 from vault.secrets where name = 'gethookd_api_key') then
      raise exception 'GetHookd is not connected: the API key is missing from Vault.';
    end if;
    -- Copies spend credits: at most 6 an hour and 20 a day.
    if (select count(*) from intel.ad_clones where created_at > now() - interval '1 hour') >= 6 then
      raise exception 'Six copies were started in the last hour; wait a while before the next.';
    end if;
    if (select count(*) from intel.ad_clones where created_at > now() - interval '1 day') >= 20 then
      raise exception 'Twenty copies were started today; try again tomorrow.';
    end if;
    if exists (select 1 from intel.ad_clones where ad_id = a.id and status in ('queued', 'generating', 'thumbs') and removed_at is null) then
      raise exception 'This ad is already being copied.';
    end if;
    insert into intel.ad_clones (product_id, market, ad_id, hookd_ad_id, model, aspect, variations)
    values (a.product_id, case when payload->>'market' = 'SE' then 'SE' else 'UK' end, a.id, hid::bigint,
      payload->>'model', payload->>'aspect', (payload->>'variations')::int)
    returning id into cid;
    insert into intel.audit_log (action, target, metadata)
    values ('ads.clone', a.product_id, jsonb_build_object('id', cid, 'ad', a.id, 'hookdAd', hid, 'model', payload->>'model', 'variations', (payload->>'variations')::int));
    perform intel.fn_dispatch('clone', cid);
    return jsonb_build_object('ok', true, 'id', cid);
  end if;

  if coalesce(payload->>'id', '') !~ '^[0-9a-f-]{36}$' then raise exception 'unknown copy'; end if;
  select * into c from intel.ad_clones where id = (payload->>'id')::uuid and removed_at is null;
  if c.id is null then raise exception 'That copy is gone.'; end if;

  if action = 'ads.clone.save' then
    rv := coalesce(payload->>'review', c.review);
    if rv not in ('new', 'approved', 'rejected') then raise exception 'review must be new, approved or rejected'; end if;
    if payload ? 'copy' and payload->'copy' <> 'null'::jsonb and (jsonb_typeof(payload->'copy') <> 'object' or octet_length((payload->'copy')::text) > 8000) then
      raise exception 'The text is too long.';
    end if;
    update intel.ad_clones set
      copy = case when payload ? 'copy' then nullif(payload->'copy', 'null'::jsonb) else copy end,
      review = rv,
      note = case when payload ? 'note' then left(nullif(btrim(payload->>'note'), ''), 1000) else note end,
      updated_at = now()
    where id = c.id;
    return jsonb_build_object('ok', true, 'id', c.id);
  end if;

  if action = 'ads.clone.retry' then
    -- Only a copy GetHookd started can be looked at again: it costs one
    -- get_clone_ad a poll, never a new copy.
    if c.status <> 'failed' or c.clone_id is null then raise exception 'Only a copy that stopped after GetHookd started it can be checked again.'; end if;
    update intel.ad_clones set status = 'generating', polls = 0, invocations = 0, error = null, finished_at = null, lease_until = null, updated_at = now() where id = c.id;
    perform intel.fn_dispatch('clone', c.id);
    return jsonb_build_object('ok', true, 'id', c.id);
  end if;

  if action = 'ads.clone.remove' then
    update intel.ad_clones set removed_at = now(), updated_at = now() where id = c.id;
    insert into intel.audit_log (action, target, metadata) values ('ads.clone.remove', c.product_id, jsonb_build_object('id', c.id));
    return jsonb_build_object('ok', true, 'id', c.id);
  end if;

  raise exception 'unknown action %', action;
end $function$;

create or replace function intel.api_write(action text, payload jsonb)
 returns jsonb
 language plpgsql
 set search_path to 'intel', 'public', 'pg_temp'
as $function$
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception 'payload must be a JSON object'; end if;
  if octet_length(payload::text) > 400000 then raise exception 'payload too large'; end if;
  if action = 'brand.names' then return intel.api_write_names(action, payload); end if;
  if action = 'ads.gethookd' then return intel.api_write_gethookd(action, payload); end if;
  if action = 'ads.enrich' then return intel.api_write_adstats(action, payload); end if;
  if action in ('ads.clone', 'ads.clone.save', 'ads.clone.retry', 'ads.clone.remove') then return intel.api_write_clone(action, payload); end if;
  if split_part(action, '.', 1) in ('brand', 'generation', 'limits', 'publish', 'shopify') then return intel.api_write_shopify(action, payload); end if;
  if split_part(action, '.', 1) = 'ads' then return intel.api_write_ads(action, payload); end if;
  if split_part(action, '.', 1) = 'links' then return intel.api_write_links(action, payload); end if;
  return intel.api_write_base(action, payload);
end $function$;

create or replace function intel.api_read(params jsonb default '{}'::jsonb)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'intel', 'public', 'pg_temp'
as $function$
declare r jsonb;
begin
  if params ? 'nameCheck' then
    return jsonb_build_object('ok', true, 'generatedAt', now(), 'nameCheck',
      (select jsonb_build_object('id', x.id, 'brandId', x.brand_id, 'market', x.market, 'names', x.names, 'status', x.status, 'results', x.results, 'error', x.error, 'createdAt', x.created_at, 'finishedAt', x.finished_at)
         from intel.name_checks x where x.id = (params->>'nameCheck')::uuid));
  end if;
  if params ? 'gethookdSearch' then
    return jsonb_build_object('ok', true, 'generatedAt', now(), 'gethookdSearch',
      (select jsonb_build_object('id', x.id, 'productId', x.product_id, 'market', x.market, 'query', x.query, 'limit', x.ad_limit, 'status', x.status,
          'ads', x.results, 'summary', x.summary, 'error', x.error, 'createdAt', x.created_at, 'finishedAt', x.finished_at,
          'savedAds', (select coalesce(jsonb_agg(intel.ad_json(a) order by a.started_on nulls last), '[]'::jsonb)
            from intel.product_ads a where a.id = any(x.added_ad_ids) and a.removed_at is null))
         from intel.gethookd_searches x where x.id = (params->>'gethookdSearch')::uuid));
  end if;
  if params ? 'adStatsRun' then
    return jsonb_build_object('ok', true, 'generatedAt', now(), 'adStatsRun',
      (select jsonb_build_object('id', x.id, 'productId', x.product_id, 'market', x.market, 'traffic', x.traffic, 'status', x.status,
          'summary', x.summary, 'error', x.error, 'createdAt', x.created_at, 'finishedAt', x.finished_at,
          'ads', case when x.status = 'done' then (select coalesce(jsonb_agg(intel.ad_json(a) order by a.created_at desc), '[]'::jsonb)
            from intel.product_ads a where a.product_id = x.product_id and a.removed_at is null) end)
         from intel.ad_stats_runs x where x.id = (params->>'adStatsRun')::uuid));
  end if;
  if params ? 'adClones' then
    return jsonb_build_object('ok', true, 'generatedAt', now(), 'adClones',
      (select coalesce(jsonb_agg(intel.ad_clone_json(c, false) order by c.created_at desc), '[]'::jsonb)
         from (select * from intel.ad_clones where product_id = params->>'adClones' and removed_at is null order by created_at desc limit 30) c));
  end if;
  if params ? 'adClone' then
    return jsonb_build_object('ok', true, 'generatedAt', now(), 'adClone',
      (select intel.ad_clone_json(c, true) from intel.ad_clones c where c.id = (params->>'adClone')::uuid and c.removed_at is null));
  end if;
  if coalesce((params->>'shopifyOnly')::boolean, false) then
    return jsonb_build_object('ok', true, 'generatedAt', now(), 'shopify', intel.api_read_shopify(params));
  end if;
  r := intel.api_read_base(params) || jsonb_build_object('ads', intel.api_read_ads(), 'links', intel.api_read_links());
  if coalesce((params->>'shopify')::boolean, false) then r := r || jsonb_build_object('shopify', intel.api_read_shopify(params)); end if;
  return r;
end $function$;

create or replace function intel.fn_dispatch(p_action text, p_id uuid)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'intel', 'public', 'pg_temp'
as $function$
declare s text; rid bigint;
begin
  if p_action not in ('test', 'run', 'rollback', 'names', 'gethookd', 'adstats', 'clone') then raise exception 'unknown dispatch action %', p_action; end if;
  select decrypted_secret into s from vault.decrypted_secrets where name = 'intel_fn_secret';
  if s is null then raise exception 'intel_fn_secret is missing from Vault'; end if;
  select net.http_post(
    url := 'https://qxodeheliubsaebwqpni.supabase.co/functions/v1/intel-shopify',
    body := jsonb_build_object('action', p_action, 'id', p_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-intel-secret', s),
    timeout_milliseconds := 10000) into rid;
  return rid;
end $function$;

revoke all on function intel.api_write_clone(text, jsonb) from public, anon, authenticated;
revoke all on function intel.fn_dispatch(text, uuid) from public, anon, authenticated;

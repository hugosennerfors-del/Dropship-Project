-- Numbers behind the revenue estimate on the product page's Ads section
-- (src/core/adrevenue.js).
--
-- A saved GetHookd ad keeps in `metrics` what the estimate reads: the
-- countries it runs in, its EU reach (Meta publishes reach only for the EU),
-- how long it had run when checked, the price on the store it links to and,
-- when asked for, the store's monthly visits. GetHookd searches fill it in
-- (gethookd_save_ads); the write action "ads.enrich" refreshes a product's
-- saved GetHookd ads through the edge function (action "adstats").

alter table intel.product_ads add column if not exists metrics jsonb;
alter table intel.product_ads drop constraint if exists product_ads_metrics_check;
alter table intel.product_ads add constraint product_ads_metrics_check
  check (metrics is null or (jsonb_typeof(metrics) = 'object' and octet_length(metrics::text) <= 8000));

-- One saved ad as the page reads it.
create or replace function intel.ad_json(a intel.product_ads)
 returns jsonb
 language sql
 stable
 set search_path to 'intel', 'public', 'pg_temp'
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', a.id, 'productId', a.product_id, 'market', a.market, 'platform', a.platform, 'url', a.url,
    'advertiser', a.advertiser, 'startedOn', a.started_on, 'stillRunning', a.still_running,
    'angle', a.angle, 'note', a.note, 'metrics', a.metrics, 'createdAt', a.created_at, 'updatedAt', a.updated_at));
$function$;

create or replace function intel.api_read_ads()
 returns jsonb
 language sql
 stable
 set search_path to 'intel', 'public', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(intel.ad_json(a) order by a.created_at desc), '[]'::jsonb)
  from (select * from intel.product_ads where removed_at is null order by created_at desc limit 2000) a;
$function$;

-- As before, and a link the product already has refreshes that ad's
-- metrics instead of adding it again (a removed ad stays removed).
create or replace function intel.gethookd_save_ads(p_id uuid, p_ads jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'intel', 'public', 'pg_temp'
as $function$
declare
  s intel.gethookd_searches;
  a jsonb;
  m jsonb;
  u text;
  d date;
  nid uuid;
  ids uuid[] := '{}';
  known int := 0;
begin
  select * into s from intel.gethookd_searches where id = p_id;
  if s.id is null or s.product_id is null then return jsonb_build_object('added', 0, 'known', 0); end if;
  for a in select x from jsonb_array_elements(case when jsonb_typeof(p_ads) = 'array' then p_ads else '[]'::jsonb end) x loop
    u := btrim(coalesce(a->>'url', ''));
    if u !~ '^https://app\.gethookd\.ai/[^[:space:]]+$' or length(u) > 2000 then continue; end if;
    m := case when jsonb_typeof(a->'metrics') = 'object' and octet_length((a->'metrics')::text) <= 8000 then a->'metrics' end;
    if exists (select 1 from intel.product_ads p where p.product_id = s.product_id and p.url = u) then
      known := known + 1;
      if m is not null then
        update intel.product_ads set metrics = m, updated_at = now() where product_id = s.product_id and url = u and removed_at is null;
      end if;
      continue;
    end if;
    begin
      d := nullif(btrim(a->>'startedOn'), '')::date;
      if d < date '2010-01-01' or d > current_date + 1 then d := null; end if;
    exception when others then d := null;
    end;
    nid := null;
    insert into intel.product_ads (id, product_id, market, platform, url, advertiser, started_on, still_running, angle, note, metrics)
    values (gen_random_uuid(), s.product_id, s.market, 'meta', u,
      left(nullif(btrim(a->>'advertiser'), ''), 200), d, coalesce((a->>'stillRunning')::boolean, true),
      left(nullif(btrim(a->>'angle'), ''), 300), left(nullif(btrim(a->>'note'), ''), 1000), m)
    on conflict (product_id, url) where removed_at is null do nothing
    returning id into nid;
    if nid is null then
      known := known + 1;
    else
      ids := ids || nid;
      insert into intel.audit_log (action, target, metadata)
      values ('ads.save', s.product_id, jsonb_build_object('id', nid, 'platform', 'meta', 'market', s.market, 'via', 'gethookd', 'search', p_id));
    end if;
  end loop;
  update intel.gethookd_searches set added_ad_ids = added_ad_ids || ids where id = p_id;
  return jsonb_build_object('added', cardinality(ids), 'known', known);
end $function$;

create table if not exists intel.ad_stats_runs (
  id uuid primary key default gen_random_uuid(),
  product_id text not null check (product_id ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  market text not null default 'UK' check (market in ('UK', 'SE')),
  traffic boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  summary jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ad_stats_runs_created on intel.ad_stats_runs (created_at desc);
alter table intel.ad_stats_runs enable row level security;

create or replace function intel.api_write_adstats(action text, payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'intel', 'public', 'pg_temp'
as $function$
declare sid uuid;
begin
  if action <> 'ads.enrich' then raise exception 'unknown action %', action; end if;
  if coalesce(payload->>'productId', '') !~ '^[a-z0-9][a-z0-9-]{0,119}$' then raise exception 'unknown product'; end if;
  if not exists (select 1 from vault.secrets where name = 'gethookd_api_key') then
    raise exception 'GetHookd is not connected: the API key is missing from Vault.';
  end if;
  if (select count(*) from intel.ad_stats_runs where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many updates in the last hour; try again later.';
  end if;
  insert into intel.ad_stats_runs (product_id, market, traffic)
  values (payload->>'productId', case when payload->>'market' = 'SE' then 'SE' else 'UK' end, coalesce((payload->>'traffic')::boolean, false))
  returning id into sid;
  perform intel.fn_dispatch('adstats', sid);
  return jsonb_build_object('ok', true, 'id', sid);
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
  if p_action not in ('test', 'run', 'rollback', 'names', 'gethookd', 'adstats') then raise exception 'unknown dispatch action %', p_action; end if;
  select decrypted_secret into s from vault.decrypted_secrets where name = 'intel_fn_secret';
  if s is null then raise exception 'intel_fn_secret is missing from Vault'; end if;
  select net.http_post(
    url := 'https://qxodeheliubsaebwqpni.supabase.co/functions/v1/intel-shopify',
    body := jsonb_build_object('action', p_action, 'id', p_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-intel-secret', s),
    timeout_milliseconds := 10000) into rid;
  return rid;
end $function$;

revoke all on function intel.api_write_adstats(text, jsonb) from public, anon, authenticated;
revoke all on function intel.gethookd_save_ads(uuid, jsonb) from public, anon, authenticated;
revoke all on function intel.fn_dispatch(text, uuid) from public, anon, authenticated;

-- GetHookd searches from the product page: the competitors' Meta ads
-- running now for a product in a market.
--
-- The page asks with the write action "ads.gethookd"; the edge function
-- intel-shopify (action "gethookd") calls GetHookd's search_ads with the
-- API key from Vault (secret "gethookd_api_key") and stores the ads here.
-- The page reads them back with api_read({"gethookdSearch": id}) and saves
-- the ones it wants as ordinary competitor ads (ads.save).
-- GetHookd bills about 0.01 credit per ad returned; a search returns at
-- most 20.

create table if not exists intel.gethookd_searches (
  id uuid primary key default gen_random_uuid(),
  product_id text,
  market text not null default 'UK' check (market in ('UK', 'SE')),
  query text not null,
  ad_limit int not null default 10 check (ad_limit between 1 and 20),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  results jsonb,
  summary jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists gethookd_searches_created on intel.gethookd_searches (created_at desc);
alter table intel.gethookd_searches enable row level security;

create or replace function intel.api_write_gethookd(action text, payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'intel', 'public', 'pg_temp'
as $function$
declare q text; lim int; sid uuid;
begin
  if action <> 'ads.gethookd' then raise exception 'unknown action %', action; end if;
  q := regexp_replace(btrim(coalesce(payload->>'query', '')), '\s+', ' ', 'g');
  if length(q) < 2 or length(q) > 80 then raise exception 'Search words: 2 to 80 characters.'; end if;
  if coalesce(payload->>'productId', '') !~ '^[a-z0-9][a-z0-9-]{0,119}$' then raise exception 'unknown product'; end if;
  lim := least(20, greatest(1, coalesce(nullif(payload->>'limit', '')::int, 10)));
  if not exists (select 1 from vault.secrets where name = 'gethookd_api_key') then
    raise exception 'GetHookd is not connected: the API key is missing from Vault.';
  end if;
  if (select count(*) from intel.gethookd_searches where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many GetHookd searches in the last hour; try again later.';
  end if;
  insert into intel.gethookd_searches (product_id, market, query, ad_limit)
  values (payload->>'productId', case when payload->>'market' = 'SE' then 'SE' else 'UK' end, q, lim)
  returning id into sid;
  perform intel.fn_dispatch('gethookd', sid);
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
          'ads', x.results, 'summary', x.summary, 'error', x.error, 'createdAt', x.created_at, 'finishedAt', x.finished_at)
         from intel.gethookd_searches x where x.id = (params->>'gethookdSearch')::uuid));
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
  if p_action not in ('test', 'run', 'rollback', 'names', 'gethookd') then raise exception 'unknown dispatch action %', p_action; end if;
  select decrypted_secret into s from vault.decrypted_secrets where name = 'intel_fn_secret';
  if s is null then raise exception 'intel_fn_secret is missing from Vault'; end if;
  select net.http_post(
    url := 'https://qxodeheliubsaebwqpni.supabase.co/functions/v1/intel-shopify',
    body := jsonb_build_object('action', p_action, 'id', p_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-intel-secret', s),
    timeout_milliseconds := 10000) into rid;
  return rid;
end $function$;

revoke all on function intel.api_write_gethookd(text, jsonb) from public, anon, authenticated;
revoke all on function intel.fn_dispatch(text, uuid) from public, anon, authenticated;

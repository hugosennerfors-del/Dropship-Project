-- Name checks for the Brand Builder: is a brand name free as a domain?
-- The page asks with the write action "brand.names"; the edge function
-- intel-shopify (action "names") looks the domains up in DNS and, where the
-- registry offers it, RDAP, and stores the result here. The page reads it
-- back with api_read({"nameCheck": id}).

create table if not exists intel.name_checks (
  id uuid primary key default gen_random_uuid(),
  brand_id text,
  market text not null default 'UK' check (market in ('UK', 'SE')),
  names text[] not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  results jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists name_checks_created on intel.name_checks (created_at desc);
alter table intel.name_checks enable row level security;

create or replace function intel.api_write_names(action text, payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'intel', 'public', 'pg_temp'
as $function$
declare n text[]; nid uuid;
begin
  if action <> 'brand.names' then raise exception 'unknown action %', action; end if;
  select array_agg(distinct left(btrim(v), 40)) into n
    from jsonb_array_elements_text(case when jsonb_typeof(payload->'names') = 'array' then payload->'names' else '[]'::jsonb end) v
   where btrim(v) ~ '^[\w &''.-]{2,40}$';
  if n is null or cardinality(n) = 0 then raise exception 'Give 1 to 5 names (letters, digits and spaces).'; end if;
  if cardinality(n) > 5 then raise exception 'At most 5 names at a time.'; end if;
  if (select count(*) from intel.name_checks where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many name checks in the last hour; try again later.';
  end if;
  insert into intel.name_checks (brand_id, market, names)
  values (left(payload->>'brandId', 90), case when payload->>'market' = 'SE' then 'SE' else 'UK' end, n)
  returning id into nid;
  perform intel.fn_dispatch('names', nid);
  return jsonb_build_object('ok', true, 'id', nid);
end $function$;

-- Route the new action before the prefix routing, so "brand.*" keeps going
-- to api_write_shopify for everything else.
create or replace function intel.api_write(action text, payload jsonb)
 returns jsonb
 language plpgsql
 set search_path to 'intel', 'public', 'pg_temp'
as $function$
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception 'payload must be a JSON object'; end if;
  if octet_length(payload::text) > 400000 then raise exception 'payload too large'; end if;
  if action = 'brand.names' then return intel.api_write_names(action, payload); end if;
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
  if p_action not in ('test', 'run', 'rollback', 'names') then raise exception 'unknown dispatch action %', p_action; end if;
  select decrypted_secret into s from vault.decrypted_secrets where name = 'intel_fn_secret';
  if s is null then raise exception 'intel_fn_secret is missing from Vault'; end if;
  select net.http_post(
    url := 'https://qxodeheliubsaebwqpni.supabase.co/functions/v1/intel-shopify',
    body := jsonb_build_object('action', p_action, 'id', p_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-intel-secret', s),
    timeout_milliseconds := 10000) into rid;
  return rid;
end $function$;

revoke all on function intel.api_write_names(text, jsonb) from public, anon, authenticated;
revoke all on function intel.fn_dispatch(text, uuid) from public, anon, authenticated;

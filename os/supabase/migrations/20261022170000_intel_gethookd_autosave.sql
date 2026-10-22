-- A GetHookd search saves what it finds: every ad with a GetHookd link
-- becomes one of the product's saved competitor ads (intel.product_ads),
-- under the same limits as ads.save. A link the product already has, saved
-- or removed, is skipped, so an ad you removed does not come back.
--
-- The edge function intel-shopify (action "gethookd") calls
-- intel.gethookd_save_ads with the rows shaped by savedAdInput
-- (src/shopify/gethookd.js); api_read({"gethookdSearch": id}) returns the
-- new rows as savedAds so the page can list them at once.

alter table intel.gethookd_searches add column if not exists added_ad_ids uuid[] not null default '{}';

create or replace function intel.gethookd_save_ads(p_id uuid, p_ads jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'intel', 'public', 'pg_temp'
as $function$
declare
  s intel.gethookd_searches;
  a jsonb;
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
    if exists (select 1 from intel.product_ads p where p.product_id = s.product_id and p.url = u) then
      known := known + 1;
      continue;
    end if;
    begin
      d := nullif(btrim(a->>'startedOn'), '')::date;
      if d < date '2010-01-01' or d > current_date + 1 then d := null; end if;
    exception when others then d := null;
    end;
    nid := null;
    insert into intel.product_ads (id, product_id, market, platform, url, advertiser, started_on, still_running, angle, note)
    values (gen_random_uuid(), s.product_id, s.market, 'meta', u,
      left(nullif(btrim(a->>'advertiser'), ''), 200), d, coalesce((a->>'stillRunning')::boolean, true),
      left(nullif(btrim(a->>'angle'), ''), 300), left(nullif(btrim(a->>'note'), ''), 1000))
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
          'savedAds', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'id', a.id, 'productId', a.product_id, 'market', a.market, 'platform', a.platform, 'url', a.url,
              'advertiser', a.advertiser, 'startedOn', a.started_on, 'stillRunning', a.still_running,
              'angle', a.angle, 'note', a.note, 'createdAt', a.created_at, 'updatedAt', a.updated_at)) order by a.started_on nulls last), '[]'::jsonb)
            from intel.product_ads a where a.id = any(x.added_ad_ids) and a.removed_at is null))
         from intel.gethookd_searches x where x.id = (params->>'gethookdSearch')::uuid));
  end if;
  if coalesce((params->>'shopifyOnly')::boolean, false) then
    return jsonb_build_object('ok', true, 'generatedAt', now(), 'shopify', intel.api_read_shopify(params));
  end if;
  r := intel.api_read_base(params) || jsonb_build_object('ads', intel.api_read_ads(), 'links', intel.api_read_links());
  if coalesce((params->>'shopify')::boolean, false) then r := r || jsonb_build_object('shopify', intel.api_read_shopify(params)); end if;
  return r;
end $function$;

revoke all on function intel.gethookd_save_ads(uuid, jsonb) from public, anon, authenticated;

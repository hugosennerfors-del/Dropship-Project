-- Starts the edge function for a job or connection. The shared secret is
-- read from Vault here; the function checks it against Vault itself.
create or replace function intel.fn_dispatch(p_action text, p_id uuid)
returns bigint language plpgsql security definer set search_path = intel, public, pg_temp as $$
declare s text; rid bigint;
begin
  if p_action not in ('test', 'run', 'rollback') then raise exception 'unknown dispatch action %', p_action; end if;
  select decrypted_secret into s from vault.decrypted_secrets where name = 'intel_fn_secret';
  if s is null then raise exception 'intel_fn_secret is missing from Vault'; end if;
  select net.http_post(
    url := 'https://qxodeheliubsaebwqpni.supabase.co/functions/v1/intel-shopify',
    body := jsonb_build_object('action', p_action, 'id', p_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-intel-secret', s),
    timeout_milliseconds := 10000) into rid;
  return rid;
end $$;

-- Stores (or replaces) a store's Admin API token in Vault and starts a
-- connection test. Called only by the n8n workflow that keeps no
-- execution data, so the token is never logged.
create or replace function intel.shopify_connect(p_shop text, p_token text, p_label text default null, p_is_test boolean default true)
returns jsonb language plpgsql security definer set search_path = intel, public, pg_temp as $$
declare shop text; sid uuid; cid uuid; mock boolean;
begin
  shop := lower(regexp_replace(regexp_replace(trim(coalesce(p_shop, '')), '^https?://', ''), '/.*$', ''));
  if shop !~ '^[a-z0-9][a-z0-9-]{0,60}\.(myshopify\.com|mock\.test)$' then raise exception 'Use the store''s myshopify.com address, e.g. your-store.myshopify.com'; end if;
  mock := shop ~ '\.mock\.test$';
  if mock and not coalesce(p_is_test, true) then raise exception 'A simulated store can only be a test store'; end if;
  if not mock and coalesce(p_token, '') !~ '^shp[a-z]{2}_[A-Za-z0-9]{16,}$' then raise exception 'That does not look like an Admin API access token (it starts with shpat_)'; end if;
  if mock and length(coalesce(p_token, '')) < 8 then raise exception 'token too short'; end if;
  select id, token_secret_id into cid, sid from intel.shopify_connections where shop_domain = shop;
  if sid is not null then
    perform vault.update_secret(sid, p_token);
  else
    sid := vault.create_secret(p_token, 'shopify:' || shop || ':' || gen_random_uuid(), 'Shopify Admin API token for ' || shop);
  end if;
  insert into intel.shopify_connections (shop_domain, token_secret_id, label, is_test_store, status, last_error, updated_at)
  values (shop, sid, nullif(left(trim(coalesce(p_label, '')), 80), ''), coalesce(p_is_test, true), 'pending', null, now())
  on conflict (shop_domain) do update set token_secret_id = excluded.token_secret_id, label = coalesce(excluded.label, intel.shopify_connections.label),
    is_test_store = excluded.is_test_store, status = 'pending', last_error = null, updated_at = now()
  returning id into cid;
  insert into intel.audit_log (action, target, metadata) values ('shopify.connect', cid::text, jsonb_build_object('shop', shop, 'test', coalesce(p_is_test, true)));
  perform intel.fn_dispatch('test', cid);
  return jsonb_build_object('ok', true, 'id', cid, 'shop', shop);
end $$;

-- Brand Builder and publishing actions (api_write delegates here).
create or replace function intel.api_write_shopify(action text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = intel, public, pg_temp as $$
declare
  bid text; v int; c jsonb; j intel.publish_jobs%rowtype; conn intel.shopify_connections%rowtype; lim int; used int; gid bigint; cached record; sid uuid;
begin
  if action = 'brand.save' then
    c := payload->'concept';
    bid := payload->>'id';
    if jsonb_typeof(c) <> 'object' or coalesce(c->>'name', '') = '' then raise exception 'concept needs at least a name'; end if;
    if octet_length(c::text) > 300000 then raise exception 'concept too large'; end if;
    if bid is null or bid !~ '^[a-z0-9][a-z0-9-]{1,90}$' then raise exception 'invalid brand id'; end if;
    if exists (select 1 from intel.brands where id = bid) then
      if coalesce((payload->>'create')::boolean, false) then raise exception 'a brand with the id % already exists', bid; end if;
      update intel.brands set version = version + 1, name = left(c->>'name', 120), handle = coalesce(c->>'handle', bid), market = coalesce(c->>'market', market),
        status = case when status = 'archived' then 'draft' else status end, updated_at = now() where id = bid returning version into v;
    else
      insert into intel.brands (id, name, handle, version, market, input_hash, source_product_id)
      values (bid, left(c->>'name', 120), coalesce(c->>'handle', bid), 1, c->>'market', payload->>'inputHash', payload->>'sourceProductId') returning version into v;
    end if;
    insert into intel.brand_versions (brand_id, version, concept, note, generation_id) values (bid, v, c, left(payload->>'note', 300), nullif(payload->>'generationId', '')::bigint);
    return jsonb_build_object('ok', true, 'id', bid, 'version', v);

  elsif action = 'brand.archive' then
    update intel.brands set status = 'archived', updated_at = now() where id = payload->>'id';
    return jsonb_build_object('ok', true, 'id', payload->>'id');

  elsif action = 'generation.start' then
    select coalesce((limits->>'brandGenerationsPerDay')::int, 20) into lim from intel.settings where id = 'default';
    select count(*) into used from intel.ai_generations where kind = coalesce(payload->>'kind', 'brand') and created_at > date_trunc('day', now()) and status <> 'failed';
    if not coalesce((payload->>'force')::boolean, false) and payload->>'inputHash' is not null then
      select id, output, created_at into cached from intel.ai_generations
       where input_hash = payload->>'inputHash' and status = 'finished' and created_at > now() - interval '24 hours' order by created_at desc limit 1;
      if cached.id is not null then
        return jsonb_build_object('ok', true, 'cached', jsonb_build_object('id', cached.id, 'output', cached.output, 'createdAt', cached.created_at), 'used', used, 'limit', lim);
      end if;
    end if;
    if used >= lim then raise exception 'Daily limit reached: % brand generations today (limit %). Raise it under Settings or try tomorrow.', used, lim; end if;
    insert into intel.ai_generations (kind, model, input, input_hash) values (coalesce(payload->>'kind', 'brand'), left(payload->>'model', 60), payload->'input', payload->>'inputHash') returning id into gid;
    return jsonb_build_object('ok', true, 'id', gid, 'used', used + 1, 'limit', lim);

  elsif action = 'generation.finish' then
    update intel.ai_generations set output = payload->'output', tokens_in = nullif(payload->>'tokensIn', '')::int, tokens_out = nullif(payload->>'tokensOut', '')::int,
      tokens_estimated = coalesce((payload->>'estimated')::boolean, true), cost_cents = nullif(payload->>'costCents', '')::numeric,
      status = case when payload->>'status' = 'failed' then 'failed' else 'finished' end, error = left(payload->>'error', 500), finished_at = now()
     where id = (payload->>'id')::bigint;
    return jsonb_build_object('ok', true);

  elsif action = 'limits.save' then
    lim := (payload->>'brandGenerationsPerDay')::int;
    if lim is null or lim < 0 or lim > 500 then raise exception 'brandGenerationsPerDay must be 0–500'; end if;
    update intel.settings set limits = jsonb_set(coalesce(limits, '{}'), '{brandGenerationsPerDay}', to_jsonb(lim)), updated_at = now() where id = 'default';
    return jsonb_build_object('ok', true, 'brandGenerationsPerDay', lim);

  elsif action = 'publish.start' then
    select * into j from intel.publish_jobs where idempotency_key = payload->>'idempotencyKey';
    if found then return jsonb_build_object('ok', true, 'existing', true, 'job', to_jsonb(j) - 'lease_until'); end if;
    select * into conn from intel.shopify_connections where id = (payload->>'connectionId')::uuid;
    if not found or conn.status <> 'connected' then raise exception 'The store is not connected. Test the connection under Data → Shopify first.'; end if;
    if not conn.is_test_store and not coalesce((payload->>'confirmLive')::boolean, false) then raise exception 'This is a live store: confirm it in the publish dialog first.'; end if;
    if not exists (select 1 from intel.brand_versions where brand_id = payload->>'brandId' and version = (payload->>'version')::int) then raise exception 'That brand version does not exist'; end if;
    if exists (select 1 from intel.publish_jobs where brand_id = payload->>'brandId' and connection_id = conn.id and status in ('queued', 'running', 'rolling_back')) then
      raise exception 'A job for this brand and store is already running; wait for it to finish.';
    end if;
    insert into intel.publish_jobs (brand_id, brand_version, connection_id, options, idempotency_key)
    values (payload->>'brandId', (payload->>'version')::int, conn.id, coalesce(payload->'options', '{}'), payload->>'idempotencyKey') returning * into j;
    insert into intel.audit_log (action, target, metadata) values ('publish.start', j.id::text, jsonb_build_object('brand', j.brand_id, 'version', j.brand_version, 'shop', conn.shop_domain, 'live', not conn.is_test_store, 'options', j.options));
    perform intel.fn_dispatch('run', j.id);
    return jsonb_build_object('ok', true, 'job', to_jsonb(j) - 'lease_until');

  elsif action = 'publish.retry' then
    select * into j from intel.publish_jobs where id = (payload->>'jobId')::uuid;
    if not found then raise exception 'unknown job'; end if;
    if j.status not in ('failed', 'partially_failed') or j.rollback is not null then raise exception 'Only a failed publish can be retried (this one is %).', j.status; end if;
    update intel.publish_jobs set status = 'queued', error = null, finished_at = null, lease_until = null, updated_at = now() where id = j.id;
    insert into intel.audit_log (action, target) values ('publish.retry', j.id::text);
    perform intel.fn_dispatch('run', j.id);
    return jsonb_build_object('ok', true, 'id', j.id);

  elsif action = 'publish.rollback' then
    select * into j from intel.publish_jobs where id = (payload->>'jobId')::uuid;
    if not found then raise exception 'unknown job'; end if;
    if not coalesce((payload->>'confirm')::boolean, false) then raise exception 'Confirm the undo first.'; end if;
    if coalesce(payload->>'mode', 'unpublish') not in ('unpublish', 'delete') then raise exception 'mode is unpublish or delete'; end if;
    if payload->>'mode' = 'delete' and coalesce(payload->>'confirmText', '') <> 'DELETE' then raise exception 'Type DELETE to remove permanently.'; end if;
    if j.status in ('queued', 'running', 'rolling_back') then raise exception 'Wait until the job has finished.'; end if;
    if j.status = 'rolled_back' then raise exception 'This publish has already been undone.'; end if;
    update intel.publish_jobs set status = 'rolling_back', rollback = jsonb_build_object('mode', coalesce(payload->>'mode', 'unpublish'), 'requestedAt', now()),
      error = null, finished_at = null, lease_until = null, updated_at = now() where id = j.id;
    insert into intel.audit_log (action, target, metadata) values ('publish.rollback', j.id::text, jsonb_build_object('mode', coalesce(payload->>'mode', 'unpublish')));
    perform intel.fn_dispatch('rollback', j.id);
    return jsonb_build_object('ok', true, 'id', j.id);

  elsif action = 'shopify.test' then
    if not exists (select 1 from intel.shopify_connections where id = (payload->>'connectionId')::uuid and token_secret_id is not null) then raise exception 'unknown or disconnected store'; end if;
    update intel.shopify_connections set status = case when status = 'disconnected' then status else 'pending' end, updated_at = now() where id = (payload->>'connectionId')::uuid;
    perform intel.fn_dispatch('test', (payload->>'connectionId')::uuid);
    return jsonb_build_object('ok', true);

  elsif action = 'shopify.disconnect' then
    select * into conn from intel.shopify_connections where id = (payload->>'connectionId')::uuid;
    if not found then raise exception 'unknown store'; end if;
    sid := conn.token_secret_id;
    update intel.shopify_connections set token_secret_id = null, status = 'disconnected', updated_at = now() where id = conn.id;
    if sid is not null then delete from vault.secrets where id = sid; end if;
    insert into intel.audit_log (action, target, metadata) values ('shopify.disconnect', conn.id::text, jsonb_build_object('shop', conn.shop_domain));
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'unknown action %', action;
end $$;

-- Brand Builder and publishing state for the page (no tokens, ever).
create or replace function intel.api_read_shopify(params jsonb)
returns jsonb language sql stable security definer set search_path = intel, public, pg_temp as $$
  select jsonb_build_object(
    'connections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label, 'shopDomain', c.shop_domain, 'isTestStore', c.is_test_store,
        'simulated', c.shop_domain ~ '\.mock\.test$', 'status', c.status, 'shopName', c.shop_name, 'plan', c.plan_name, 'currency', c.currency, 'host', c.primary_host,
        'apiVersion', c.api_version, 'scopes', c.scopes, 'missingScopes', c.missing_scopes, 'schema', c.schema_check, 'apiVersions', c.api_versions,
        'lastError', c.last_error, 'lastVerifiedAt', c.last_verified_at, 'hasToken', c.token_secret_id is not null) order by c.installed_at)
      from intel.shopify_connections c where c.status <> 'disconnected' or coalesce((params->>'withDisconnected')::boolean, false)), '[]'::jsonb),
    'brands', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'handle', b.handle, 'version', b.version, 'status', b.status, 'market', b.market,
        'sourceProductId', b.source_product_id, 'updatedAt', b.updated_at, 'concept', bv.concept) order by b.updated_at desc)
      from (select * from intel.brands where status <> 'archived' order by updated_at desc limit 24) b
      join intel.brand_versions bv on bv.brand_id = b.id and bv.version = b.version), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'brandId', j.brand_id, 'brandVersion', j.brand_version, 'connectionId', j.connection_id, 'status', j.status,
        'options', j.options, 'progress', j.progress, 'error', j.error, 'rollback', j.rollback, 'createdAt', j.created_at, 'startedAt', j.started_at, 'finishedAt', j.finished_at) order by j.created_at desc)
      from (select * from intel.publish_jobs order by created_at desc limit 40) j), '[]'::jsonb),
    'job', case when params->>'job' is not null then jsonb_build_object(
      'steps', coalesce((select jsonb_agg(jsonb_build_object('key', s.key, 'seq', s.seq, 'kind', s.kind, 'status', s.status, 'attempts', s.attempts, 'error', s.error,
          'gid', s.shopify_gid, 'response', s.response, 'updatedAt', s.updated_at) order by s.seq) from intel.publish_job_steps s where s.job_id = (params->>'job')::uuid), '[]'::jsonb),
      'resources', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'type', r.resource_type, 'gid', r.shopify_gid, 'handle', r.handle, 'adminUrl', r.admin_url,
          'publicUrl', r.public_url, 'existed', coalesce((r.previous_state->>'existed')::boolean, false), 'state', r.state, 'removedAt', r.removed_at) order by r.id)
        from intel.created_resources r where r.job_id = (params->>'job')::uuid), '[]'::jsonb)) end,
    'generations', jsonb_build_object(
      'today', (select count(*) from intel.ai_generations where kind = 'brand' and created_at > date_trunc('day', now()) and status <> 'failed'),
      'limit', (select coalesce((limits->>'brandGenerationsPerDay')::int, 20) from intel.settings where id = 'default'),
      'costCentsToday', (select coalesce(sum(cost_cents), 0) from intel.ai_generations where created_at > date_trunc('day', now()))));
$$;

-- Keep the existing API exactly as it was; new actions are delegated.
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'intel' and p.proname = 'api_write_base') then
    alter function intel.api_write(text, jsonb) rename to api_write_base;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'intel' and p.proname = 'api_read_base') then
    alter function intel.api_read(jsonb) rename to api_read_base;
  end if;
end $$;

create or replace function intel.api_write(action text, payload jsonb)
returns jsonb language plpgsql set search_path = intel, public, pg_temp as $$
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception 'payload must be a JSON object'; end if;
  if octet_length(payload::text) > 400000 then raise exception 'payload too large'; end if;
  if split_part(action, '.', 1) in ('brand', 'generation', 'limits', 'publish', 'shopify') then return intel.api_write_shopify(action, payload); end if;
  return intel.api_write_base(action, payload);
end $$;

create or replace function intel.api_read(params jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable set search_path = intel, public, pg_temp as $$
declare r jsonb;
begin
  if coalesce((params->>'shopifyOnly')::boolean, false) then
    return jsonb_build_object('ok', true, 'generatedAt', now(), 'shopify', intel.api_read_shopify(params));
  end if;
  r := intel.api_read_base(params);
  if coalesce((params->>'shopify')::boolean, false) then r := r || jsonb_build_object('shopify', intel.api_read_shopify(params)); end if;
  return r;
end $$;

-- Only the database owner (n8n's Postgres credential, the edge function)
-- may call these; nothing is exposed to the public API roles.
revoke all on function intel.fn_dispatch(text, uuid) from public, anon, authenticated;
revoke all on function intel.shopify_connect(text, text, text, boolean) from public, anon, authenticated;
revoke all on function intel.api_write_shopify(text, jsonb) from public, anon, authenticated;
revoke all on function intel.api_read_shopify(jsonb) from public, anon, authenticated;
revoke all on function intel.api_write(text, jsonb) from public, anon, authenticated;
revoke all on function intel.api_read(jsonb) from public, anon, authenticated;
revoke all on function intel.api_write_base(text, jsonb) from public, anon, authenticated;
revoke all on function intel.api_read_base(jsonb) from public, anon, authenticated;

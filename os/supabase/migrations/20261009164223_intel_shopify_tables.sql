-- Shopify integration and Brand Builder: tables.
-- Tokens live only in Vault (vault.secrets, encrypted at rest); a
-- connection row keeps the secret's id, never the token.
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'intel_fn_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'intel_fn_secret',
      'Shared secret: intel SQL functions -> intel-shopify edge function. Generated in the database, never exported.');
  end if;
end $$;

create table if not exists intel.shopify_connections (
  id uuid primary key default gen_random_uuid(),
  label text,
  shop_domain text not null unique check (shop_domain ~ '^[a-z0-9][a-z0-9-]{0,60}\.(myshopify\.com|mock\.test)$'),
  token_secret_id uuid,
  is_test_store boolean not null default true,
  api_version text not null default '2026-07',
  status text not null default 'pending' check (status in ('pending', 'connected', 'error', 'disconnected')),
  shop_name text, plan_name text, currency text, primary_host text,
  scopes text[] not null default '{}', missing_scopes text[] not null default '{}',
  schema_check jsonb, api_versions jsonb, last_error text,
  installed_at timestamptz not null default now(), last_verified_at timestamptz, updated_at timestamptz not null default now(),
  constraint simulated_only_as_test check (shop_domain !~ '\.mock\.test$' or is_test_store)
);

create table if not exists intel.brands (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,90}$'),
  name text not null,
  handle text not null,
  version int not null default 1,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  market text, input_hash text, source_product_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists intel.brand_versions (
  brand_id text not null references intel.brands(id),
  version int not null,
  concept jsonb not null,
  note text,
  generation_id bigint,
  created_at timestamptz not null default now(),
  primary key (brand_id, version)
);

create table if not exists intel.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references intel.brands(id),
  brand_version int not null,
  connection_id uuid not null references intel.shopify_connections(id),
  options jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'partially_failed', 'rolling_back', 'rolled_back')),
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 120),
  progress jsonb not null default '{}',
  error jsonb,
  rollback jsonb,
  lease_until timestamptz,
  invocations int not null default 0,
  created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz, updated_at timestamptz not null default now()
);
create index if not exists publish_jobs_brand on intel.publish_jobs (brand_id, created_at desc);

create table if not exists intel.publish_job_steps (
  job_id uuid not null references intel.publish_jobs(id),
  key text not null,
  seq int not null default 0,
  kind text,
  status text not null check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  request jsonb, response jsonb, shopify_gid text,
  attempts int not null default 0,
  error jsonb,
  updated_at timestamptz not null default now(),
  primary key (job_id, key)
);

create table if not exists intel.created_resources (
  id bigserial primary key,
  job_id uuid not null references intel.publish_jobs(id),
  connection_id uuid not null references intel.shopify_connections(id),
  resource_type text not null,
  shopify_gid text not null,
  handle text, admin_url text, public_url text,
  previous_state jsonb, state jsonb,
  removed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists created_resources_owner on intel.created_resources (connection_id, resource_type, shopify_gid);
create index if not exists created_resources_job on intel.created_resources (job_id);

create table if not exists intel.ai_generations (
  id bigserial primary key,
  kind text not null default 'brand',
  model text,
  input jsonb, output jsonb, input_hash text,
  tokens_in int, tokens_out int, tokens_estimated boolean not null default true, cost_cents numeric(10, 2),
  status text not null default 'started' check (status in ('started', 'finished', 'failed')),
  error text,
  created_at timestamptz not null default now(), finished_at timestamptz
);
create index if not exists ai_generations_hash on intel.ai_generations (input_hash, created_at desc);

create table if not exists intel.audit_log (
  id bigserial primary key,
  actor text not null default 'page',
  action text not null,
  target text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table intel.settings add column if not exists limits jsonb not null default '{"brandGenerationsPerDay": 20}';

alter table intel.shopify_connections enable row level security;
alter table intel.brands enable row level security;
alter table intel.brand_versions enable row level security;
alter table intel.publish_jobs enable row level security;
alter table intel.publish_job_steps enable row level security;
alter table intel.created_resources enable row level security;
alter table intel.ai_generations enable row level security;
alter table intel.audit_log enable row level security;

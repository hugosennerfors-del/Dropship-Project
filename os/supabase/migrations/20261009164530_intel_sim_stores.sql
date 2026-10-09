-- State of simulated stores (*.mock.test test connections), so a simulated
-- store keeps its products between edge-function invocations. Never used
-- for real stores.
create table if not exists intel.sim_stores (
  domain text primary key check (domain ~ '\.mock\.test$'),
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table intel.sim_stores enable row level security;

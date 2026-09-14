-- =====================================================================
-- Plan-vy — datamodell (Supabase / Postgres)
-- Kör i Supabase SQL Editor. Idempotent.
-- =====================================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- Inställningar: en rad per butik. Här bor moms och avgiftssatser.
-- ---------------------------------------------------------------------
create table if not exists settings (
  id                    int primary key default 1,
  currency              text    not null default 'SEK',
  vat_rate              numeric not null default 0.25,   -- svensk moms
  -- Transaktionsavgifter. Shopify Payments SE ~1,6% + 1,80 kr för EU-kort.
  -- Klarna ligger högre. Sätt en blandad sats tills du mäter din faktiska.
  txn_fee_pct           numeric not null default 0.019,
  txn_fee_fixed         numeric not null default 1.80,
  -- Fast månadskostnad som ska slås ut per order (Shopify-abb, appar, domän).
  monthly_fixed_cost    numeric not null default 0,
  updated_at            timestamptz not null default now(),
  constraint settings_singleton check (id = 1)
);
insert into settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Produkter. En rad per SKU (variant), inte per produkt.
-- unit_cost kommer från Shopify InventoryItem.unitCost.
-- landed_adder är DITT påslag: inkommande frakt, tull, EUR 3-avgiften,
-- EPR-avgift per enhet. Shopify känner inte till den.
-- ---------------------------------------------------------------------
create table if not exists products (
  id                uuid primary key default uuid_generate_v4(),
  shopify_variant_id text unique,
  shopify_product_id text,
  sku               text unique not null,
  name              text not null,
  unit_cost         numeric not null default 0,   -- inköp per st, ex moms
  landed_adder      numeric not null default 0,   -- frakt in + tull + EPR per st
  price             numeric not null default 0,   -- ordinarie säljpris INKL moms
  -- Returgrad: sätts manuellt tills du har 100+ order, därefter beräknad.
  return_rate       numeric not null default 0.05,
  return_handling_cost numeric not null default 0, -- kostnad per retur (frakt + hantering)
  return_resale_rate numeric not null default 0.9,  -- andel av returer som går att sälja igen
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists products_sku_idx on products (sku);

-- ---------------------------------------------------------------------
-- Ordrar. gross_* är INKL moms precis som Shopify rapporterar dem.
-- Omräkning till ex moms sker i vyn, aldrig i inmatningen.
-- ---------------------------------------------------------------------
create table if not exists orders (
  id                  uuid primary key default uuid_generate_v4(),
  shopify_order_id    text unique not null,
  order_number        text,
  created_at_shop     timestamptz not null,
  currency            text not null default 'SEK',
  gross_total         numeric not null,          -- inkl moms, inkl frakt
  gross_shipping      numeric not null default 0,-- vad KUNDEN betalade i frakt
  gross_discounts     numeric not null default 0,
  shipping_cost       numeric not null default 0,-- vad FRAKTEN kostade dig
  txn_fee             numeric,                   -- faktisk avgift om känd, annars beräknad
  refunded_gross      numeric not null default 0,
  financial_status    text,
  landing_site        text,
  utm_source          text,
  utm_campaign        text,
  utm_content         text,
  ingested_at         timestamptz not null default now()
);
create index if not exists orders_created_idx on orders (created_at_shop);
create index if not exists orders_utm_campaign_idx on orders (utm_campaign);

create table if not exists order_lines (
  id                uuid primary key default uuid_generate_v4(),
  order_id          uuid not null references orders(id) on delete cascade,
  product_id        uuid references products(id),
  sku               text not null,
  qty               int not null,
  gross_line_total  numeric not null,            -- inkl moms, efter radrabatt
  unit_cost_at_sale numeric not null default 0,  -- fryst COGS vid ordertillfället
  landed_at_sale    numeric not null default 0,
  refunded_qty      int not null default 0
);
create index if not exists order_lines_order_idx on order_lines (order_id);
create index if not exists order_lines_product_idx on order_lines (product_id);

-- ---------------------------------------------------------------------
-- Annonsdata. En rad per dag, kampanj och (om mappad) produkt.
-- product_id är null när kampanjen inte går att knyta till en SKU.
-- ---------------------------------------------------------------------
create table if not exists ad_spend (
  id            uuid primary key default uuid_generate_v4(),
  date          date not null,
  platform      text not null default 'meta',
  account_id    text,
  campaign_id   text,
  campaign_name text,
  adset_id      text,
  adset_name    text,
  ad_id         text,
  ad_name       text,
  product_id    uuid references products(id),
  spend         numeric not null default 0,
  impressions   bigint  not null default 0,
  clicks        bigint  not null default 0,
  -- Metas egen attribution. Används för sanity-check, ALDRIG som vinstunderlag.
  platform_purchases       int     not null default 0,
  platform_purchase_value  numeric not null default 0,
  synced_at     timestamptz not null default now(),
  unique (date, platform, ad_id)
);
create index if not exists ad_spend_date_idx on ad_spend (date);
create index if not exists ad_spend_product_idx on ad_spend (product_id);

-- Mappning kampanj -> produkt. Regex så du slipper mappa varje ny kampanj.
create table if not exists campaign_product_map (
  id            uuid primary key default uuid_generate_v4(),
  match_pattern text not null,       -- t.ex. '^ROCK_' eller 'omkladningsrock'
  product_id    uuid not null references products(id) on delete cascade,
  priority      int not null default 100
);

-- Sessioner för CVR. Fylls från GA4 eller Shopify Analytics.
create table if not exists sessions_daily (
  date       date primary key,
  sessions   bigint not null default 0
);

-- ---------------------------------------------------------------------
-- Tröskelvärden för ampeln. Redigerbara utan kodändring.
-- ---------------------------------------------------------------------
create table if not exists thresholds (
  id                     int primary key default 1,
  scale_poas             numeric not null default 1.60,  -- grönt över
  optimize_poas          numeric not null default 1.15,  -- gult över, rött under
  min_orders_for_verdict int     not null default 15,    -- färre = "testa"
  max_return_rate        numeric not null default 0.25,
  constraint thresholds_singleton check (id = 1)
);
insert into thresholds (id) values (1) on conflict (id) do nothing;

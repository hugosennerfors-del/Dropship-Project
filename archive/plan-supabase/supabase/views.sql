-- =====================================================================
-- Vyer. Kör efter schema.sql.
-- All aggregering sker här, aldrig i frontend.
-- =====================================================================

-- Dagliga produktsiffror: ordrar, COGS, avgifter och annonskostnad per dag.
create or replace view v_product_period as
with order_day as (
  select
    ol.product_id,
    (o.created_at_shop at time zone 'Europe/Stockholm')::date as date,
    count(distinct o.id)                                       as orders,
    sum(ol.qty)                                                as units,
    sum(ol.gross_line_total)                                   as gross_revenue,
    sum(o.gross_shipping * (ol.gross_line_total / nullif(o.gross_total,0)))  as gross_shipping,
    sum(o.refunded_gross * (ol.gross_line_total / nullif(o.gross_total,0)))  as refunded_gross,
    sum(o.shipping_cost * (ol.gross_line_total / nullif(o.gross_total,0)))   as shipping_cost,
    sum(ol.qty * (ol.unit_cost_at_sale + ol.landed_at_sale))   as cogs,
    sum(coalesce(o.txn_fee,0) * (ol.gross_line_total / nullif(o.gross_total,0))) as txn_fee
  from order_lines ol
  join orders o on o.id = ol.order_id
  group by 1, 2
),
ad_day as (
  select product_id, date,
         sum(spend) as ad_spend,
         sum(impressions) as impressions,
         sum(clicks) as clicks
  from ad_spend
  group by 1, 2
)
select
  coalesce(od.product_id, ad.product_id)        as product_id,
  coalesce(od.date, ad.date)                    as date,
  coalesce(od.orders, 0)                        as orders,
  coalesce(od.units, 0)                         as units,
  coalesce(od.gross_revenue, 0)                 as gross_revenue,
  coalesce(od.gross_shipping, 0)                as gross_shipping,
  coalesce(od.refunded_gross, 0)                as refunded_gross,
  coalesce(od.shipping_cost, 0)                 as shipping_cost,
  coalesce(od.cogs, 0)                          as cogs,
  coalesce(od.txn_fee, 0)                       as txn_fee,
  coalesce(ad.ad_spend, 0)                      as ad_spend,
  coalesce(ad.impressions, 0)                   as impressions,
  coalesce(ad.clicks, 0)                        as clicks,
  coalesce(s.sessions, 0)                       as sessions
from order_day od
full outer join ad_day ad
  on ad.product_id = od.product_id and ad.date = od.date
left join sessions_daily s
  on s.date = coalesce(od.date, ad.date);

-- Faktisk returgrad per produkt, rullande 90 dagar.
-- Skriv tillbaka den till products.return_rate via n8n en gång i veckan,
-- men bara när underlaget är minst 30 enheter.
create or replace view v_actual_return_rate as
select
  ol.product_id,
  sum(ol.qty)                                        as units_sold,
  sum(ol.refunded_qty)                               as units_returned,
  case when sum(ol.qty) >= 30
       then sum(ol.refunded_qty)::numeric / sum(ol.qty)
       else null end                                 as return_rate_90d
from order_lines ol
join orders o on o.id = ol.order_id
where o.created_at_shop > now() - interval '90 days'
group by 1;

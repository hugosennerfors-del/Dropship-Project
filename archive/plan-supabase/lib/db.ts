import { createClient } from "@supabase/supabase-js";
import type { PeriodInput, Product, Settings } from "./types";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,   // server-side only
  { auth: { persistSession: false } },
);

export const RANGE_DAYS: Record<string, number> = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 };

export function periodBounds(range: string) {
  const days = RANGE_DAYS[range] ?? 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 864e5);
  const prevTo = new Date(from.getTime());
  const prevFrom = new Date(from.getTime() - days * 864e5);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { days, from: iso(from), to: iso(to), prevFrom: iso(prevFrom), prevTo: iso(prevTo) };
}

export async function getSettings(): Promise<Settings> {
  const { data } = await supabase.from("settings").select("*").eq("id", 1).single();
  return {
    currency: data?.currency ?? "SEK",
    vatRate: Number(data?.vat_rate ?? 0.25),
    txnFeePct: Number(data?.txn_fee_pct ?? 0.019),
    txnFeeFixed: Number(data?.txn_fee_fixed ?? 1.8),
    monthlyFixedCost: Number(data?.monthly_fixed_cost ?? 0),
  };
}

/** Läser den materialiserade vyn. Ingen tung aggregering i frontend. */
export async function getProductPeriod(from: string, to: string, productId?: string) {
  let q = supabase.from("v_product_period")
    .select("*")
    .gte("date", from).lte("date", to);
  if (productId) q = q.eq("product_id", productId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getProducts(): Promise<Product[]> {
  const { data } = await supabase.from("products").select("*").eq("active", true);
  return (data ?? []).map((d) => ({
    id: d.id, sku: d.sku, name: d.name,
    unitCost: Number(d.unit_cost), landedAdder: Number(d.landed_adder),
    price: Number(d.price), returnRate: Number(d.return_rate),
    returnHandlingCost: Number(d.return_handling_cost),
    returnResaleRate: Number(d.return_resale_rate),
  }));
}

/** Slår ihop dagrader till ett PeriodInput. */
export function rollup(rows: any[]): PeriodInput {
  const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  return {
    grossRevenue: sum("gross_revenue"), grossShipping: sum("gross_shipping"),
    refundedGross: sum("refunded_gross"), shippingCost: sum("shipping_cost"),
    cogs: sum("cogs"), txnFee: sum("txn_fee"),
    orders: sum("orders"), units: sum("units"), adSpend: sum("ad_spend"),
    impressions: sum("impressions"), clicks: sum("clicks"), sessions: sum("sessions"),
  };
}

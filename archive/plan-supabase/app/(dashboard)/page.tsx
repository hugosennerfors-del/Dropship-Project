import { Suspense } from "react";
import { KpiCard } from "@/components/KpiCard";
import { Filters } from "@/components/Filters";
import { ProductTable, type ProductRow } from "@/components/ProductTable";
import { ProfitChart } from "@/components/ProfitChart";
import { RoasTrendChart } from "@/components/RoasTrendChart";
import { ContributionChart } from "@/components/ContributionChart";
import { computeMetrics } from "@/lib/metrics";
import { productStatus, DEFAULT_THRESHOLDS } from "@/lib/status";
import { getProducts, getProductPeriod, getSettings, periodBounds, rollup } from "@/lib/db";
import { kr, x, num } from "@/lib/format";

export const revalidate = 300; // 5 min

export default async function PlanView({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { from, to, prevFrom, prevTo, days } = periodBounds(sp.range ?? "30d");

  const [settings, products, rows, prevRows] = await Promise.all([
    getSettings(),
    getProducts(),
    getProductPeriod(from, to, sp.product),
    getProductPeriod(prevFrom, prevTo, sp.product),
  ]);

  const total = computeMetrics(rollup(rows), settings);
  const prevTotal = computeMetrics(rollup(prevRows), settings);

  const productRows: ProductRow[] = products.map((p) => {
    const mine = rows.filter((r) => r.product_id === p.id);
    const input = rollup(mine);
    const m = computeMetrics(input, settings, p);
    return {
      id: p.id, sku: p.sku, name: p.name,
      unitCost: p.unitCost, landedCost: p.unitCost + p.landedAdder, price: p.price,
      orders: input.orders, returnRate: p.returnRate,
      metrics: m,
      status: productStatus(m, input.orders, p.returnRate, DEFAULT_THRESHOLDS),
    };
  }).filter((r) => r.orders > 0 || r.metrics.adSpend > 0);

  // Dagserier
  const byDate = new Map<string, { netRevenue: number; adSpend: number; grossProfit: number }>();
  for (const r of rows) {
    const d = byDate.get(r.date) ?? { netRevenue: 0, adSpend: 0, grossProfit: 0 };
    const m = computeMetrics(rollup([r]), settings);
    d.netRevenue += m.netRevenueExVat;
    d.adSpend += m.adSpend;
    d.grossProfit += m.grossProfit;
    byDate.set(r.date, d);
  }
  const series = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  const profitData = series.map(([date, d]) => ({
    date: date.slice(5), netRevenue: d.netRevenue, adSpend: d.adSpend,
    netProfit: d.grossProfit - d.adSpend,
  }));
  const roasData = series.map(([date, d]) => ({
    date: date.slice(5),
    roas: d.adSpend ? d.netRevenue / d.adSpend : 0,
    poas: d.adSpend ? d.grossProfit / d.adSpend : 0,
  }));
  const contributionData = productRows.map((r) => ({
    name: r.name,
    contribution: r.metrics.contributionPerOrder,
    effective: r.metrics.effectiveContributionPerOrder,
    cpa: r.metrics.cpa,
  }));

  const scale = productRows.filter((r) => r.status.verdict === "SKALA").length;
  const pause = productRows.filter((r) => r.status.verdict === "PAUSA").length;

  return (
    <main className="mx-auto max-w-[1440px] px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900">Plan-vy</h1>
          <p className="mt-0.5 text-[13px] text-neutral-500">
            {from} – {to} · jämfört med föregående {days} dagar · alla belopp ex moms
          </p>
        </div>
        <Suspense>
          <Filters
            products={products.map((p) => ({ id: p.id, name: p.name }))}
            campaigns={[...new Set(rows.map((r) => r.campaign_name).filter(Boolean))] as string[]}
          />
        </Suspense>
      </header>

      {/* Toppsektion: fem KPI-kort */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Omsättning ex moms" value={kr(total.netRevenueExVat)}
                 current={total.netRevenueExVat} previous={prevTotal.netRevenueExVat} />
        <KpiCard label="Annonskostnad" value={kr(total.adSpend)}
                 current={total.adSpend} previous={prevTotal.adSpend} lowerIsBetter
                 hint={`CPA ${kr(total.cpa)}`} />
        <KpiCard label="POAS" value={x(total.poas)}
                 current={total.poas} previous={prevTotal.poas}
                 hint={`ROAS ${x(total.roas)} · break-even POAS 1,00`} />
        <KpiCard label="Nettovinst" value={kr(total.netProfit)}
                 current={total.netProfit} previous={prevTotal.netProfit}
                 hint={`${kr(total.netProfitPerOrder)} per order`} />
        <KpiCard label="Ordrar" value={num(total.orders)}
                 current={total.orders} previous={prevTotal.orders}
                 hint={`AOV ${kr(total.aov)} · CVR ${(total.cvr * 100).toFixed(2)} %`} />
      </section>

      {scale + pause > 0 && (
        <p className="mt-3 text-[12.5px] text-neutral-500">
          {scale > 0 && <><strong className="text-emerald-700">{scale}</strong> produkt{scale === 1 ? "" : "er"} redo att skala. </>}
          {pause > 0 && <><strong className="text-rose-700">{pause}</strong> under break-even — åtgärda idag.</>}
        </p>
      )}

      {/* Produkttabell */}
      <section className="mt-6">
        <h2 className="mb-3 text-[15px] font-semibold text-neutral-900">Produkter</h2>
        <ProductTable rows={productRows} />
      </section>

      {/* Grafer */}
      <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ProfitChart data={profitData} />
        <RoasTrendChart data={roasData} />
      </section>
      <section className="mt-4">
        <ContributionChart data={contributionData} />
      </section>
    </main>
  );
}

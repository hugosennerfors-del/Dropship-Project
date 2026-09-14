"use client";
import { useState, useMemo } from "react";
import { kr, pct, x, num } from "@/lib/format";
import { StatusPill } from "./StatusPill";
import type { StatusResult } from "@/lib/status";
import type { Metrics } from "@/lib/types";

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  unitCost: number;
  landedCost: number;
  price: number;
  orders: number;
  returnRate: number;
  metrics: Metrics;
  status: StatusResult;
}

type SortKey = "name" | "orders" | "adSpend" | "poas" | "contribution" | "netProfit";

export function ProductTable({ rows }: { rows: ProductRow[] }) {
  const [sort, setSort] = useState<SortKey>("netProfit");
  const [desc, setDesc] = useState(true);

  const sorted = useMemo(() => {
    const val = (r: ProductRow) => ({
      name: r.name, orders: r.orders, adSpend: r.metrics.adSpend,
      poas: r.metrics.poas, contribution: r.metrics.contributionPerOrder,
      netProfit: r.metrics.netProfit,
    })[sort];
    return [...rows].sort((a, b) => {
      const av = val(a), bv = val(b);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string, "sv") : (av as number) - (bv as number);
      return desc ? -cmp : cmp;
    });
  }, [rows, sort, desc]);

  const th = (key: SortKey, label: string, right = true) => (
    <th
      className={`cursor-pointer select-none whitespace-nowrap px-3 py-2.5 text-[11.5px] font-medium text-neutral-500 hover:text-neutral-900 ${right ? "text-right" : "text-left"}`}
      onClick={() => { sort === key ? setDesc(!desc) : (setSort(key), setDesc(true)); }}
    >
      {label}{sort === key && <span className="ml-1">{desc ? "↓" : "↑"}</span>}
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="w-full min-w-[1100px] border-collapse text-[13px]">
        <thead className="border-b border-neutral-200 bg-neutral-50/60">
          <tr>
            {th("name", "Produkt", false)}
            <th className="px-3 py-2.5 text-right text-[11.5px] font-medium text-neutral-500">Inköp</th>
            <th className="px-3 py-2.5 text-right text-[11.5px] font-medium text-neutral-500">Pris</th>
            <th className="px-3 py-2.5 text-right text-[11.5px] font-medium text-neutral-500">Marginal</th>
            {th("orders", "Ordrar")}
            {th("adSpend", "Annons")}
            <th className="px-3 py-2.5 text-right text-[11.5px] font-medium text-neutral-500">ROAS</th>
            <th className="px-3 py-2.5 text-right text-[11.5px] font-medium text-neutral-500" title="Bruttovinst delad på annonskostnad. Break-even är alltid 1,00.">POAS</th>
            <th className="px-3 py-2.5 text-right text-[11.5px] font-medium text-neutral-500">CPA</th>
            {th("contribution", "Bidrag/order")}
            {th("netProfit", "Nettovinst")}
            <th className="px-3 py-2.5 text-left text-[11.5px] font-medium text-neutral-500">Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const m = r.metrics;
            const belowBreakEven = m.poas < 1;
            return (
              <tr key={r.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/70">
                <td className="px-3 py-2.5">
                  <div className="font-medium text-neutral-900">{r.name}</div>
                  <div className="text-[11px] text-neutral-400">{r.sku}</div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{kr(r.landedCost)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{kr(r.price)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <div className="text-neutral-900">{pct(m.grossMarginPct)}</div>
                  <div className="text-[11px] text-neutral-400">BE {x(m.breakEvenRoas)}</div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-900">{num(r.orders)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{kr(m.adSpend)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <span className={m.roas < m.breakEvenRoas ? "text-rose-700" : "text-neutral-900"}>{x(m.roas)}</span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <span className={`font-semibold ${belowBreakEven ? "text-rose-700" : "text-neutral-900"}`}>{x(m.poas)}</span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{kr(m.cpa)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <div className="text-neutral-900">{kr(m.contributionPerOrder)}</div>
                  {r.returnRate > 0.05 && (
                    <div className="text-[11px] text-neutral-400" title={`Efter ${pct(r.returnRate, 0)} returer`}>
                      eff. {kr(m.effectiveContributionPerOrder)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <span className={m.netProfit < 0 ? "font-semibold text-rose-700" : "font-semibold text-neutral-900"}>
                    {kr(m.netProfit)}
                  </span>
                </td>
                <td className="px-3 py-2.5"><StatusPill status={r.status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

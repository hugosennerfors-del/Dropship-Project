"use client";
import { useRouter, useSearchParams } from "next/navigation";

const RANGES = [
  { key: "7d", label: "7 dagar" },
  { key: "14d", label: "14 dagar" },
  { key: "30d", label: "30 dagar" },
  { key: "90d", label: "90 dagar" },
] as const;

export function Filters({ products, campaigns }: { products: { id: string; name: string }[]; campaigns: string[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    v ? next.set(k, v) : next.delete(k);
    router.push(`?${next.toString()}`);
  };
  const range = sp.get("range") ?? "30d";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5">
        {RANGES.map((r) => (
          <button key={r.key} onClick={() => set("range", r.key)}
            className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition ${
              range === r.key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900"
            }`}>
            {r.label}
          </button>
        ))}
      </div>

      <select value={sp.get("product") ?? ""} onChange={(e) => set("product", e.target.value)}
        className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12.5px] text-neutral-700">
        <option value="">Alla produkter</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      <select value={sp.get("campaign") ?? ""} onChange={(e) => set("campaign", e.target.value)}
        className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12.5px] text-neutral-700">
        <option value="">Alla kampanjer</option>
        {campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  );
}

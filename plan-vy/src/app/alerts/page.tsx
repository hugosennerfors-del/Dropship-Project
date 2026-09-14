"use client";

import { useData } from "@/components/DataProvider";
import { AlertList } from "@/components/AlertList";
import { EmptyState, ErrorState, Section, Skeleton } from "@/components/primitives";

export default function AlertsPage() {
  const { data, loading, error, refetch } = useData();

  if (error) return <ErrorState message={error} onRetry={refetch} />;

  if (loading || !data) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="glass p-5">
            <Skeleton className="h-3.5 w-32" />
            <div className="mt-4 space-y-2.5">
              {Array.from({ length: 3 }).map((__, j) => <Skeleton key={j} className="h-12 w-full" />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const critical = data.alerts.filter((a) => a.severity === "critical");
  const warnings = data.alerts.filter((a) => a.severity === "warning");

  if (!data.alerts.length) {
    return (
      <Section title="Larm" origin="computed" note="Beräknade tröskelvärden i backenden.">
        <EmptyState
          title="Inga larm den här perioden."
          body="Inga produkter under break-even, inga höga returgrader, ingen fallande efterfrågan."
        />
      </Section>
    );
  }

  return (
    <div className="space-y-6">
      {critical.length ? (
        <Section title={`Kritiskt (${critical.length})`} origin="computed" note="POAS < 0,80 eller negativ portföljmarginal.">
          <AlertList alerts={critical} products={data.products} />
        </Section>
      ) : null}
      {warnings.length ? (
        <Section
          title={`Varningar (${warnings.length})`}
          origin="computed"
          note="POAS under 1,00, returgrad över 10 % eller fallande efterfrågan."
          delay={0.05}
        >
          <AlertList alerts={warnings} products={data.products} />
        </Section>
      ) : null}
    </div>
  );
}

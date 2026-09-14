"use client";

import { useData } from "@/components/DataProvider";
import { ProductTable } from "@/components/ProductTable";
import { ErrorState, Section, SkeletonTable } from "@/components/primitives";

export default function ProductsPage() {
  const { data, loading, error, refetch, month } = useData();

  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (loading || !data) return <SkeletonTable rows={8} />;

  return (
    <Section
      title="Produkter"
      origin="real"
      note="Försäljning och annonskostnad live från backenden. Opportunity Score är beräknad."
    >
      <ProductTable products={data.products} month={month} />
    </Section>
  );
}

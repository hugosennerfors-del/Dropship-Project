import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { DataProvider } from "@/components/DataProvider";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Plan-vy Intelligence",
  description: "Lönsamhet och produktresearch för dropshipping-portföljen.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>
        {/* Dekorativa chroma-blobbar bakom allt innehåll. */}
        <div className="chroma-field" aria-hidden>
          <div className="chroma-blob chroma-blob--1" />
          <div className="chroma-blob chroma-blob--2" />
          <div className="chroma-blob chroma-blob--3" />
        </div>

        {/* useSearchParams kräver en Suspense-gräns i App Router. */}
        <Suspense fallback={null}>
          <DataProvider>
            <AppShell>{children}</AppShell>
          </DataProvider>
        </Suspense>
      </body>
    </html>
  );
}

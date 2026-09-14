import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Plan-vy", description: "Lönsamhet per order och produkt" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body className="bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}

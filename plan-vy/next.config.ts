import type { NextConfig } from "next";

/**
 * Statisk export.
 *
 * Appen hämtar all data i webbläsaren från n8n — ingen sida behöver renderas på
 * en server. Med output: "export" blir bygget en mapp med färdiga filer som går
 * att lägga på vilken statisk värd som helst, utan körtidsplugin.
 *
 * Följden: dynamiska ruttsegment går inte, eftersom Next måste känna till varje
 * sökväg vid bygget och produkternas sku finns bara i API:t. Produktsidan tar
 * därför sku som query-parameter, och /products/<sku> pekas om dit i
 * netlify.toml så att länkarna backenden genererar fortsätter fungera.
 */
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
};

export default nextConfig;

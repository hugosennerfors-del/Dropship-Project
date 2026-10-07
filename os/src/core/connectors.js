// Data connectors: where raw data comes from, what each one would provide
// and whether it is connected. A connector writes raw records into
// db/raw/<id>/ (pipeline) or into the page's database (app); it never writes
// analysis or scores. The analysis and scoring layers read raw data, so new
// data can be added without destroying earlier analyses.
//
// status   connected      runs today and has delivered data
//          manual         data arrives by hand (paste, CSV, page form)
//          not_connected  designed, needs credentials or an API plan

export const CONNECTORS = [
  {
    id: "own-store", name: "Own store (Supabase via n8n)", markets: ["SE"], status: "connected",
    provides: ["Orders", "Revenue", "Ad spend", "CAC", "Contribution", "Returns"],
    yields: "Verified", lastRun: "2026-09-24",
    how: "n8n Intelligence-API workflow reads orders, order_lines and ad_spend from Supabase.",
  },
  {
    id: "n8n-research", name: "n8n Research generator", markets: ["SE", "UK", "US"], status: "connected",
    provides: ["Product candidates", "Ad plans"],
    yields: "AI estimated", lastRun: "2026-09-24",
    how: "LLM-generated candidates in Supabase product_candidates. Treated as an inbox, never as evidence.",
  },
  {
    id: "web-research", name: "Web research (analyst sessions)", markets: ["UK", "SE", "global"], status: "manual",
    provides: ["Evidence records with source, level and date"],
    yields: "Estimated", lastRun: "2026-10-07",
    how: "Cited sources graded A–E and stored in db/raw/evidence.json.",
  },
  {
    id: "csv-import", name: "CSV import", markets: ["UK", "SE"], status: "manual",
    provides: ["Any field in the product model"],
    yields: "As labelled in the file",
    how: "Upload a CSV on the Data page or run `npm run import -- file.csv`. Columns map to field keys; a status column per field is optional.",
  },
  {
    id: "amazon-uk", name: "Amazon UK", markets: ["UK"], status: "not_connected",
    provides: ["Prices", "Best-seller rank", "Review count", "Ratings", "Review text"],
    yields: "Verified",
    how: "Needs a product-data API (e.g. Keepa or the SP-API). Its pages could not be read during research (network policy), so no Amazon data is in the database.",
  },
  {
    id: "ebay-uk", name: "eBay UK", markets: ["UK"], status: "not_connected",
    provides: ["Sold listings", "Prices", "Seller counts"],
    yields: "Verified",
    how: "Needs the eBay Browse / Marketplace Insights API. Its pages could not be read during research (network policy), so no eBay data is in the database.",
  },
  {
    id: "etsy", name: "Etsy", markets: ["UK", "SE"], status: "not_connected",
    provides: ["Listings", "Prices", "Favourites", "Shop sales counts"],
    yields: "Verified", how: "Etsy Open API v3 key.",
  },
  {
    id: "tiktok-shop", name: "TikTok Shop UK", markets: ["UK"], status: "not_connected",
    provides: ["GMV estimates", "Units", "Creator counts"],
    yields: "Estimated", how: "Third-party analytics (FastMoss, Kalodata) export or API plan.",
  },
  {
    id: "google-trends", name: "Google Trends", markets: ["UK", "SE"], status: "not_connected",
    provides: ["Search interest over time", "Rising queries", "Seasonality"],
    yields: "Verified (relative index)",
    how: "Needs a SerpAPI-style provider or a manual CSV export from trends.google.com. It could not be reached during research, so no Trends data is in the database.",
  },
  {
    id: "google-shopping", name: "Google Shopping / Search", markets: ["UK", "SE"], status: "not_connected",
    provides: ["Search volume", "CPC", "Shopping prices", "Merchant counts"],
    yields: "Estimated", how: "Google Ads Keyword Planner API or a keyword-data provider.",
  },
  {
    id: "meta-ad-library", name: "Meta Ad Library", markets: ["UK", "SE"], status: "not_connected",
    provides: ["Active ads per product", "Ad longevity", "Advertiser counts"],
    yields: "Verified",
    how: "Meta Ad Library API (needs identity verification). Long-running ads are a proxy for profitable products.",
  },
  {
    id: "instagram", name: "Instagram / TikTok organic", markets: ["UK", "SE"], status: "not_connected",
    provides: ["Hashtag views", "Creator counts", "Engagement"],
    yields: "Estimated", how: "Social-listening provider export.",
  },
];

export const CONNECTOR_STATUS = {
  connected: { label: "Connected", tone: "good" },
  manual: { label: "Manual", tone: "neutral" },
  not_connected: { label: "Not connected", tone: "muted" },
};

// Which marketplaces have data for a product in a market: only evidence
// records actually in the database count.
export function marketplaceCoverage(evidenceIds, evidenceIndex, marketCode) {
  const want = [
    { id: "amazon", label: "Amazon UK", match: /amazon|asin/i },
    { id: "ebay", label: "eBay UK", match: /ebay/i },
    { id: "etsy", label: "Etsy", match: /etsy/i },
    { id: "tiktok-shop", label: "TikTok Shop", match: /tiktok shop|fastmoss|kalodata/i },
    { id: "google", label: "Google Shopping / Search", match: /google|search/i },
    { id: "meta", label: "Meta", match: /meta|facebook/i },
    { id: "tiktok", label: "TikTok", match: /tiktok/i },
    { id: "instagram", label: "Instagram", match: /instagram/i },
  ];
  const evs = (evidenceIds || []).map((id) => evidenceIndex[id]).filter(Boolean);
  return want.map((w) => {
    const hits = evs.filter((e) => w.match.test(`${e.claim} ${e.source?.publisher || ""} ${e.source?.title || ""} ${e.id}`));
    const inMarket = hits.filter((e) => e.market === marketCode || (marketCode === "UK" && e.market === "GB"));
    return { ...w, match: undefined, evidence: hits.map((e) => e.id), inMarket: inMarket.length > 0, has: hits.length > 0 };
  });
}

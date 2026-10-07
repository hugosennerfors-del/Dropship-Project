// Market configuration. UK is the primary market; Sweden is the alternative.
//
// Every number here is an assumption the economics depend on, so each one
// carries where it came from. Values marked "assumption" are defaults the
// user is expected to replace with their own contracts (payment provider,
// carrier, FX). They are editable in Settings and stored per viewer.

export const MARKETS = {
  UK: {
    code: "UK",
    name: "United Kingdom",
    currency: "GBP",
    symbol: "£",
    locale: "en-GB",
    vat: 0.2,
    // USD -> GBP for supplier prices quoted in USD. Assumption, not a live rate.
    fxFromUSD: 0.78,
    // Local currency -> GBP, used only to put both markets on one score scale.
    fxToGBP: 1,
    paymentPct: 0.019,
    paymentFixed: 0.2,
    packaging: 0.6,
    // Outbound parcel cost by product size class. Royal Mail Tracked 48 for a
    // 2 kg parcel is quoted at £3.40–4.60 (ev:uk-parcel-prices); larger
    // classes are estimates.
    shippingBySize: { S: 3.4, M: 4.6, L: 6.9, XL: 11.5 },
    // Reverse-logistics cost per returned parcel. UK DTC brands report
    // roughly £10–25 per return before the refunded value (ev:uk-returns).
    returnHandlingBySize: { S: 6, M: 10, L: 16, XL: 25 },
    // Meta ecommerce CPM, roughly £11.81 in 2026 (ev:uk-meta-cpm). Q4 runs
    // 20–40 % above Q1.
    cpm: 11.81,
    q4CpmUplift: 0.3,
    adCostIndex: 1,
    sources: {
      fxFromUSD: "assumption",
      paymentPct: "assumption (blended card rate, check your provider)",
      packaging: "assumption",
      shippingBySize: "ev:uk-parcel-prices",
      returnHandlingBySize: "ev:uk-returns",
      cpm: "ev:uk-meta-cpm",
    },
    compliance: [
      {
        id: "uk-vat-overseas",
        title: "UK VAT from the first sale",
        body:
          "A seller established outside the UK that ships goods worth £135 or less directly to UK consumers must register for UK VAT and charge it at the point of sale. There is no registration threshold for non-UK sellers. When an online marketplace facilitates the sale, the marketplace accounts for the VAT instead.",
        evidence: ["ev:uk-vat-135"],
      },
      {
        id: "uk-cosmetics",
        title: "Cosmetics need a UK Responsible Person",
        body:
          "Cosmetic products must be notified on SCPN before they are sold in Great Britain, and only a UK-based Responsible Person can do that. Their name and address go on the label.",
        evidence: ["ev:uk-cosmetics-rp"],
      },
      {
        id: "uk-electrical",
        title: "Electrical products carry manufacturer duties",
        body:
          "Selling own-brand electrical goods makes you the manufacturer for product-safety purposes: conformity marking (UKCA or CE), a declaration of conformity and a technical file. Budget for testing before the first order.",
        evidence: ["ev:repo-ce-testing"],
      },
    ],
    // Retail calendar used for seasonal timing. Months are 1–12.
    calendar: [
      { month: 1, label: "January sales, New Year fitness" },
      { month: 2, label: "Valentine's Day" },
      { month: 3, label: "Mothering Sunday" },
      { month: 4, label: "Easter" },
      { month: 5, label: "Hay fever season starts" },
      { month: 6, label: "Father's Day, hay fever peak" },
      { month: 7, label: "Summer holidays" },
      { month: 9, label: "Back to school, autumn" },
      { month: 10, label: "Halloween, heating season" },
      { month: 11, label: "Black Friday, Bonfire Night" },
      { month: 12, label: "Christmas" },
    ],
  },
  SE: {
    code: "SE",
    name: "Sweden",
    currency: "SEK",
    symbol: "kr",
    locale: "sv-SE",
    vat: 0.25,
    fxFromUSD: 10.0,
    fxToGBP: 0.078,
    paymentPct: 0.019,
    paymentFixed: 2.5,
    packaging: 7,
    shippingBySize: { S: 49, M: 65, L: 95, XL: 160 },
    returnHandlingBySize: { S: 60, M: 95, L: 150, XL: 240 },
    // Swedish Meta CPM was about $9–13.5 in the earlier research (ev:repo-cpm-se).
    cpm: 110,
    q4CpmUplift: 0.3,
    adCostIndex: 1,
    sources: {
      fxFromUSD: "assumption",
      paymentPct: "assumption",
      packaging: "assumption",
      shippingBySize: "assumption (PostNord/DHL small-parcel level)",
      returnHandlingBySize: "assumption",
      cpm: "ev:repo-cpm-se",
    },
    compliance: [
      {
        id: "eu-duty",
        title: "EU duty on low-value parcels",
        body:
          "The €150 customs duty exemption ended on 1 July 2026, with a €3 per declaration line charge during the transition to 2028. Every import from outside the EU now carries duty.",
        evidence: ["ev:repo-eu-duty"],
      },
      {
        id: "eu-withdrawal",
        title: "14-day right of withdrawal and the withdrawal button",
        body:
          "EU consumers can return distance purchases within 14 days, and a withdrawal button is mandatory from 19 June 2026.",
        evidence: ["ev:repo-eu-withdrawal"],
      },
      {
        id: "se-weee",
        title: "WEEE and battery producer responsibility",
        body:
          "Electrical products and batteries require registration and producer-responsibility fees before the first sale in Sweden.",
        evidence: ["ev:repo-ce-testing"],
      },
    ],
    calendar: [
      { month: 1, label: "Mellandagsrea ends, New Year" },
      { month: 2, label: "Alla hjärtans dag" },
      { month: 5, label: "Mors dag" },
      { month: 6, label: "Midsommar" },
      { month: 9, label: "Autumn, darker evenings" },
      { month: 11, label: "Black Week, Fars dag" },
      { month: 12, label: "Christmas" },
    ],
  },
};

export const MARKET_CODES = Object.keys(MARKETS);
export const PRIMARY_MARKET = "UK";

export function market(code) {
  return MARKETS[code] || MARKETS[PRIMARY_MARKET];
}

// A market with the user's own overrides applied (from Settings).
export function withOverrides(code, overrides) {
  const base = market(code);
  if (!overrides) return base;
  return { ...base, ...overrides, shippingBySize: { ...base.shippingBySize, ...(overrides.shippingBySize || {}) } };
}

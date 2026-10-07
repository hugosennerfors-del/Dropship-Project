// The field registry: one vocabulary for the database, the filters, the
// chat's query tools and the natural-language parser.
//
// scope   core     same in every market (what the product is)
//         market   specific to UK or SE (price, demand, competition)
//         derived  computed by economics.js from core + market inputs
//         score    computed by scoring.js
// type    score (0–100) | pct | money | num | text | list | enum | months
// better  "high" | "low" — which direction is good, for sorting and colour
// aliases words the parser maps to this field (English and Swedish)

const F = [];
const def = (key, label, group, scope, type, opts = {}) =>
  F.push({ key, label, group, scope, type, better: opts.better ?? null, unit: opts.unit ?? null,
           aliases: opts.aliases ?? [], desc: opts.desc ?? "", query: opts.query ?? (type !== "text" && type !== "list") });

// Identity
def("name", "Product name", "Identity", "core", "text", { aliases: ["product", "produkt"], query: true });
def("category", "Category", "Identity", "core", "text", { aliases: ["kategori"], query: true });
def("subcategory", "Subcategory", "Identity", "core", "text", { aliases: ["underkategori"], query: true });
def("niche", "Niche", "Identity", "core", "text", { aliases: ["nisch"], query: true });
def("microNiche", "Micro-niche", "Identity", "core", "text", { aliases: ["micro niche", "mikronisch"], query: true });
def("overview", "Overview", "Identity", "core", "text");

// Customer
def("targetCustomer", "Target customer", "Customer", "core", "text");
def("targetAge", "Target age", "Customer", "core", "text", { query: true });
def("targetGender", "Target gender", "Customer", "core", "text", { query: true });

// Problem
def("painPoint", "Customer pain point", "Problem", "core", "text");
def("problemSolved", "Problem solved", "Problem", "core", "text");
def("mainBenefit", "Main benefit", "Problem", "core", "text");
def("emotionalAppeal", "Emotional appeal", "Problem", "core", "text");
def("purchaseMotivation", "Purchase motivation", "Problem", "core", "text");

// Market relevance
def("relevance", "Market relevance", "Market", "market", "score", { better: "high",
  aliases: ["uk relevance", "market relevance", "relevans"], desc: "How well the product fits this market's consumers, climate and habits." });

// Economics — inputs
def("price", "Selling price", "Economics", "market", "money", { better: "high",
  aliases: ["selling price", "retail price", "price", "pris", "utpris", "säljpris", "sell for", "säljas för"],
  desc: "Consumer price including VAT, in the market's currency." });
def("supplierPrice", "Supplier price", "Economics", "derived", "money", { better: "low", aliases: ["supplier price", "supplier cost", "inköpspris", "leverantörspris"] });
def("inbound", "Inbound freight", "Economics", "derived", "money", { better: "low" });
def("dutyRate", "Import duty", "Economics", "market", "pct", { better: "low", aliases: ["duty", "tull"] });
def("landedCost", "Landed cost", "Economics", "derived", "money", { better: "low",
  aliases: ["landed cost", "product cost", "cost", "kostnad", "landad kostnad", "costs", "kostar"],
  desc: "Supplier price plus inbound freight plus duty, per unit." });
def("shipping", "Shipping to customer", "Economics", "derived", "money", { better: "low", aliases: ["shipping", "frakt", "shipping cost"] });
def("paymentFees", "Payment fees", "Economics", "derived", "money", { better: "low", aliases: ["fees", "avgifter"] });
def("packaging", "Packaging", "Economics", "derived", "money", { better: "low" });
def("variableCost", "Variable cost per order", "Economics", "derived", "money", { better: "low",
  aliases: ["variable cost", "cost per order", "rörlig kostnad"],
  desc: "Everything an order costs before ads, ex VAT: landed cost, shipping, payment fees and packaging. Observed for products you already sell." });
def("cac", "Estimated CAC", "Economics", "derived", "money", { better: "low",
  aliases: ["cac", "cpa", "customer acquisition cost", "kundanskaffningskostnad", "annonskostnad per order"] });
def("returnRate", "Return rate", "Economics", "market", "pct", { better: "low", aliases: ["return rate", "returns", "returgrad", "returer"] });
def("unitsPerOrder", "Units per order", "Economics", "market", "num", { better: "high" });
def("upsellValue", "Potential upsell value", "Economics", "market", "money", { better: "high", aliases: ["upsell", "upsell value", "merförsäljning"] });
def("attachRate", "Upsell attach rate", "Economics", "market", "pct", { better: "high" });

// Economics — derived
def("revenueEx", "Revenue ex VAT", "Economics", "derived", "money", { better: "high" });
def("aov", "Estimated AOV", "Economics", "derived", "money", { better: "high", aliases: ["aov", "average order value", "ordervärde", "snittorder"] });
def("grossProfit", "Gross profit", "Economics", "derived", "money", { better: "high", aliases: ["gross profit", "bruttovinst"] });
def("margin", "Gross margin", "Economics", "derived", "pct", { better: "high",
  aliases: ["margin", "gross margin", "marginal", "bruttomarginal", "margins"],
  desc: "Revenue ex VAT minus landed cost, shipping, payment fees and packaging, as a share of revenue ex VAT. Before ads and returns." });
def("contribution", "Contribution before ads", "Economics", "derived", "money", { better: "high",
  desc: "Expected profit per order after returns, before ad spend." });
def("profit", "Profit per order", "Economics", "derived", "money", { better: "high",
  aliases: ["profit", "potential profit", "net profit", "vinst", "bidrag", "profit per order"],
  desc: "Expected contribution per order after returns and estimated CAC." });
def("profitGBP", "Profit per order (GBP)", "Economics", "derived", "money", { better: "high" });
def("netMargin", "Potential net margin", "Economics", "derived", "pct", { better: "high",
  aliases: ["net margin", "nettomarginal", "contribution margin"] });
def("maxCac", "Maximum CAC", "Economics", "derived", "money", { better: "high", aliases: ["max cac", "maximum cac", "break-even cac"] });
def("roas", "Potential ROAS", "Economics", "derived", "num", { better: "high", aliases: ["roas", "potential roas"] });
def("breakEvenRoas", "Break-even ROAS", "Economics", "derived", "num", { better: "low", aliases: ["break-even roas", "break even roas"] });
def("startupCost", "Estimated startup cost", "Launch", "derived", "money", { better: "low",
  aliases: ["startup cost", "start cost", "startkostnad", "budget", "capital"] });
def("breakEvenOrders", "Break-even orders", "Launch", "derived", "num", { better: "low", aliases: ["break-even orders", "break even orders"] });
def("clv", "Customer lifetime value", "Economics", "derived", "money", { better: "high", aliases: ["clv", "ltv", "lifetime value", "livstidsvärde"] });
def("moq", "Estimated MOQ", "Launch", "core", "num", { better: "low", aliases: ["moq", "minimum order"] });
def("fixedLaunchCost", "Compliance and setup cost", "Launch", "market", "money", { better: "low", query: false,
  desc: "One-off costs before the first sale: testing, certification, registration." });

// Sourcing inputs (USD, as quoted by suppliers)
def("supplierPriceUSD", "Supplier price (USD)", "Sourcing", "core", "money", { better: "low", query: false });
def("inboundUSD", "Inbound freight (USD)", "Sourcing", "core", "money", { better: "low", query: false });
def("kind", "Product kind", "Sourcing", "core", "enum", { query: false, desc: "textile, electrical or default; sets how many returned units can be resold." });
def("returnRateAssumed", "Assumed return rate", "Economics", "market", "pct", { query: false });

// Demand & trend
def("searchDemand", "Search demand", "Demand", "market", "text");
def("demand", "Demand score", "Demand", "market", "score", { better: "high",
  aliases: ["demand", "high demand", "efterfrågan", "hög efterfrågan", "demand score"] });
def("trend", "Trend score", "Demand", "market", "score", { better: "high",
  aliases: ["trend", "trend score", "trending", "trendande", "trendig"] });
def("trendDirection", "Trend direction", "Demand", "market", "enum", { aliases: ["direction", "riktning"] });
def("trendAcceleration", "Trend acceleration", "Demand", "market", "pct", { better: "high",
  aliases: ["acceleration", "growing fast", "fastest growing", "accelerating", "acceleration %"],
  desc: "Approximate change in interest over the last 6–12 months, in percent." });
def("marketSize", "Market size", "Demand", "market", "text");
def("growth", "Estimated market growth", "Demand", "market", "pct", { better: "high", aliases: ["market growth", "growth", "tillväxt", "marknadstillväxt"] });
def("seasonality", "Seasonality", "Demand", "market", "text", { aliases: ["season", "säsong"] , query: true });
def("peakMonths", "Peak months", "Demand", "market", "months");
def("seasonalityRisk", "Seasonality risk", "Demand", "market", "score", { better: "low", aliases: ["seasonality risk", "seasonal", "säsongsrisk", "säsongsberoende"] });
def("stage", "Market stage", "Demand", "score", "enum", { aliases: ["stage", "lifecycle", "fas", "livscykel"], query: true });

// Competition
def("competition", "Competition score", "Competition", "market", "score", { better: "low",
  aliases: ["competition", "konkurrens", "competitive", "competitors"], desc: "Higher means more competition." });
def("saturation", "Market saturation", "Competition", "market", "score", { better: "low", aliases: ["saturation", "saturated", "mättnad", "mättad"] });
def("competitorCount", "Competitor count", "Competition", "market", "num", { better: "low", aliases: ["competitor count", "number of competitors", "antal konkurrenter"] });
def("competitorStrength", "Competitor strength", "Competition", "market", "score", { better: "low", aliases: ["competitor strength", "incumbents"] });
def("competitorPriceMin", "Competitor price low", "Competition", "market", "money");
def("competitorPriceMax", "Competitor price high", "Competition", "market", "money");
def("avgReviewCount", "Average review count", "Competition", "market", "num");
def("avgRating", "Average rating", "Competition", "market", "num");
def("marketLeaders", "Market leaders", "Competition", "market", "list");
def("weakCompetitors", "Weak competitors", "Competition", "market", "text");
def("commonComplaints", "Common complaints", "Competition", "market", "list");
def("commonWeaknesses", "Common product weaknesses", "Competition", "market", "list");
def("commonMarketingAngles", "Common marketing angles", "Competition", "market", "list");
def("differentiation", "Differentiation potential", "Competition", "core", "score", { better: "high",
  aliases: ["differentiation", "differentiate", "differentiering"] });

// Marketing
def("social", "Social media potential", "Marketing", "market", "score", { better: "high", aliases: ["social", "social media", "sociala medier"] });
def("tiktok", "TikTok potential", "Marketing", "market", "score", { better: "high", aliases: ["tiktok", "tiktok ads", "tik tok", "tiktok potential"] });
def("instagram", "Instagram potential", "Marketing", "market", "score", { better: "high", aliases: ["instagram", "ig", "reels"] });
def("meta", "Meta Ads potential", "Marketing", "market", "score", { better: "high", aliases: ["meta", "meta ads", "facebook", "facebook ads", "fb ads"] });
def("google", "Google Ads potential", "Marketing", "market", "score", { better: "high", aliases: ["google ads", "google", "search ads", "shopping ads"] });
def("seo", "SEO potential", "Marketing", "market", "score", { better: "high", aliases: ["seo", "organic search"] });
def("organic", "Organic content potential", "Marketing", "market", "score", { better: "high", aliases: ["organic", "organic content", "organiskt"] });
def("influencer", "Influencer potential", "Marketing", "market", "score", { better: "high", aliases: ["influencer", "influencers", "creator"] });
def("ugc", "UGC potential", "Marketing", "market", "score", { better: "high", aliases: ["ugc", "user generated"] });
def("viral", "Viral potential", "Marketing", "core", "score", { better: "high", aliases: ["viral", "most viral", "viralitet"] });
def("impulse", "Impulse purchase score", "Marketing", "core", "score", { better: "high", aliases: ["impulse", "impulsköp", "impulse buy"] });
def("giftability", "Giftability", "Marketing", "core", "score", { better: "high", aliases: ["gift", "giftable", "present", "presentköp", "giftability"] });

// Brand & purchase behaviour
def("brandability", "Brandability score", "Brand", "core", "score", { better: "high",
  aliases: ["brandability", "brand", "brand potential", "varumärke", "long-term brand", "långsiktigt varumärke"] });
def("repeat", "Repeat purchase potential", "Brand", "core", "score", { better: "high",
  aliases: ["repeat", "repeat purchase", "återkommande köp", "återköp", "recurring"] });
def("subscription", "Subscription potential", "Brand", "core", "score", { better: "high", aliases: ["subscription", "prenumeration", "abonnemang"] });
def("bundle", "Bundle potential", "Brand", "core", "score", { better: "high", aliases: ["bundle", "bundles", "paket", "upsells and bundles"] });
def("brandAngle", "Potential brand angle", "Brand", "core", "text");
def("landingPageAngle", "Landing page angle", "Brand", "core", "text");
def("adAngles", "Potential ad angles", "Brand", "core", "list");
def("contentAngles", "Potential content angles", "Brand", "core", "list");
def("differentiationOpportunities", "Differentiation opportunities", "Brand", "core", "list");
def("uspOpportunities", "USP opportunities", "Brand", "core", "list");

// Logistics
def("size", "Product size", "Logistics", "core", "enum", { aliases: ["size", "storlek"] });
def("weight", "Product weight", "Logistics", "core", "num", { better: "low", unit: "kg", aliases: ["weight", "vikt", "heavy", "light", "tung", "lätt"] });
def("shippingDifficulty", "Shipping difficulty", "Logistics", "core", "score", { better: "low", aliases: ["shipping difficulty", "easy to ship", "lätt att skicka"] });
def("damageRisk", "Damage risk", "Logistics", "core", "score", { better: "low", aliases: ["damage risk", "fragile", "ömtålig"] });
def("returnRisk", "Return risk", "Logistics", "core", "score", { better: "low", aliases: ["return risk", "returrisk"] });
def("supplierAvailability", "Supplier availability", "Logistics", "core", "score", { better: "high" });
def("supplierDifficulty", "Supplier difficulty", "Logistics", "core", "score", { better: "low" });

// Risk
def("regulatoryRisk", "Regulatory risk", "Risk", "market", "score", { better: "low", aliases: ["regulatory", "regulation", "regulatory risk", "regler", "regelverk"] });
def("regulatoryNotes", "Regulatory notes", "Risk", "market", "text");
def("ipRisk", "Intellectual property risk", "Risk", "market", "score", { better: "low", aliases: ["ip", "ip risk", "trademark", "patent", "varumärkesrisk"] });
def("ipNotes", "IP notes", "Risk", "market", "text");
def("reviewSentiment", "Review sentiment", "Reviews", "market", "text");
def("customerComplaints", "Customer complaints", "Reviews", "market", "list");

// Reasons
def("reasonsWork", "Reasons it could work", "Reasons", "core", "list");
def("reasonsFail", "Reasons it might fail", "Reasons", "core", "list");
def("keyRisks", "Key risks", "Reasons", "core", "list");

// Scores (computed)
def("opportunity", "E-commerce Opportunity Score", "Scores", "score", "score", { better: "high",
  aliases: ["opportunity", "opportunity score", "potential", "potential score", "best", "bäst", "möjlighet", "potential just nu"] });
def("evidenceWeighted", "Evidence-weighted opportunity", "Scores", "score", "score", { better: "high",
  aliases: ["evidence-weighted", "evidence weighted", "best evidenced", "proven"],
  desc: "Opportunity scaled by data confidence: prefers products the database knows more about." });
def("confidence", "Data confidence", "Scores", "score", "score", { better: "high", aliases: ["confidence", "data confidence", "evidence", "säkerhet", "datakvalitet"] });
def("risk", "Risk score", "Scores", "score", "score", { better: "low", aliases: ["risk", "risk score", "safest", "säkrast", "risky", "riskabel"] });
def("marginScore", "Margin score", "Scores", "score", "score", { better: "high" });
def("profitScore", "Profit score", "Scores", "score", "score", { better: "high" });
def("adPotential", "Ad potential score", "Scores", "score", "score", { better: "high", aliases: ["ad potential", "ads", "advertising", "annonser", "paid ads"] });
def("repeatScore", "Repeat purchase score", "Scores", "score", "score", { better: "high" });
def("growthScore", "Market growth score", "Scores", "score", "score", { better: "high" });
def("ease", "Ease of launch score", "Scores", "score", "score", { better: "high",
  aliases: ["ease", "ease of launch", "easy to launch", "beginner", "beginners", "nybörjare", "lätt att starta"] });

export const FIELDS = F;
export const FIELD = Object.fromEntries(F.map((f) => [f.key, f]));
export const QUERYABLE = F.filter((f) => f.query).map((f) => f.key);
export const GROUPS = [...new Set(F.map((f) => f.group))];

export const STAGES = ["Emerging", "Early Growth", "Growing", "Peak", "Declining", "Saturated"];
export const DIRECTIONS = ["up", "flat", "down"];

// Find a field from free text: exact key, label, or alias (longest match wins).
export function resolveField(text) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return null;
  if (FIELD[t]) return FIELD[t];
  let best = null, bestLen = 0;
  for (const f of F) {
    for (const a of [f.label.toLowerCase(), ...f.aliases]) {
      if (t === a && a.length > bestLen) { best = f; bestLen = a.length; }
    }
  }
  return best;
}

// Compact schema for the AI: field keys with labels, types and meaning.
export function schemaForAI() {
  return F.filter((f) => f.query)
    .map((f) => `${f.key} (${f.type}${f.better ? `, ${f.better === "high" ? "higher is better" : "lower is better"}` : ""}): ${f.label}${f.desc ? ". " + f.desc : ""}`)
    .join("\n");
}

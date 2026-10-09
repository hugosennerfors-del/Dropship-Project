// The JSON Schema the Brand Builder gives the model as a tool input, so
// Claude answers in exactly the shape validateConcept() accepts. Kept apart
// from concept.js so the edge function does not carry it.

import { PALETTE_ROLES, SECTION_TYPES, LIMITS } from "./concept.js";

const S = (type, extra = {}) => ({ type, ...extra });
const STR = (max, extra = {}) => S("string", { maxLength: max, ...extra });
export const CONCEPT_JSON_SCHEMA = {
  type: "object",
  required: ["name", "tagline", "positioning", "targetAudience", "toneOfVoice", "identity", "story", "products", "pagePlan", "seo", "legalFlags"],
  properties: {
    name: STR(60), handle: STR(60, { pattern: "^[a-z0-9-]+$" }), tagline: STR(60), positioning: STR(700),
    targetAudience: { type: "object", required: ["summary", "personas"], properties: { summary: STR(400), personas: { type: "array", maxItems: 4, items: { type: "object", required: ["name", "description"], properties: { name: STR(60), description: STR(400) } } } } },
    toneOfVoice: { type: "object", required: ["adjectives", "doList", "dontList"], properties: { adjectives: { type: "array", minItems: 1, maxItems: 8, items: STR(40) }, doList: { type: "array", maxItems: 8, items: STR(160) }, dontList: { type: "array", maxItems: 8, items: STR(160) } } },
    identity: { type: "object", required: ["palette", "typography", "logoBrief", "imageryDirection"], properties: {
      palette: { type: "array", minItems: 3, maxItems: 8, items: { type: "object", required: ["role", "hex", "name"], properties: { role: { type: "string", enum: PALETTE_ROLES }, hex: STR(7, { pattern: "^#[0-9a-fA-F]{6}$" }), name: STR(40) } } },
      typography: { type: "object", required: ["headingFont", "bodyFont", "rationale"], properties: { headingFont: STR(40, { description: "A Google Fonts family name" }), bodyFont: STR(40, { description: "A Google Fonts family name" }), rationale: STR(300) } },
      logoBrief: STR(600), imageryDirection: STR(600) } },
    story: { type: "object", required: ["about", "mission", "usps"], properties: { about: STR(1500), mission: STR(300), usps: { type: "array", minItems: 3, maxItems: 5, items: STR(140) } } },
    products: { type: "array", minItems: 1, maxItems: LIMITS.products, items: { type: "object", required: ["title", "description", "bulletPoints", "productType", "tags", "options", "variants", "imagePrompts", "seo"], properties: {
      title: STR(120), description: STR(5000, { description: "80–150 words, selling, plain text or <p>/<ul>/<li>/<strong>" }), bulletPoints: { type: "array", maxItems: 8, items: STR(200) },
      productType: STR(60), tags: { type: "array", maxItems: 12, items: STR(40) },
      options: { type: "array", maxItems: 3, items: { type: "object", required: ["name", "values"], properties: { name: STR(40), values: { type: "array", minItems: 1, maxItems: 20, items: STR(60) } } } },
      variants: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", required: ["optionValues", "price", "sku"], properties: { optionValues: { type: "array", items: STR(60) }, price: STR(10, { pattern: "^\\d+(\\.\\d{1,2})?$", description: "Consumer price incl. VAT in the market's currency" }), compareAtPrice: STR(10), sku: STR(64), weightGrams: { type: "integer", minimum: 0 } } } },
      costEstimate: STR(10, { description: "Landed unit cost, same currency" }), suggestedMarginPct: { type: "number" }, imagePrompts: { type: "array", maxItems: 6, items: STR(400) },
      seo: { type: "object", required: ["title", "description"], properties: { title: STR(70), description: STR(320) } } } } },
    pagePlan: { type: "object", required: ["sections"], properties: { sections: { type: "array", minItems: 3, maxItems: LIMITS.sections, items: { type: "object", required: ["type"], properties: {
      type: { type: "string", enum: SECTION_TYPES }, headline: STR(120), body: STR(1500), items: { type: "array", maxItems: 8, items: { type: "object", required: ["title", "body"], properties: { title: STR(120), body: STR(600) } } }, imagePrompt: STR(400) } } } } },
    seo: { type: "object", required: ["title", "description", "keywords"], properties: { title: STR(70), description: STR(320), keywords: { type: "array", maxItems: 12, items: STR(60) } } },
    legalFlags: { type: "array", maxItems: 10, items: STR(240), description: "Risks to check: names that resemble known brands, claims that need evidence, regulated product types. Not legal advice." },
  },
};

// The same schema without descriptions and string lengths, for the page
// tool Claude calls (tool schemas may be at most 4 KB). validateConcept()
// still enforces every length and sends the errors back to Claude.
const strip = (x) => Array.isArray(x) ? x.map(strip)
  : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== "description" && k !== "maxLength").map(([k, v]) => [k, strip(v)])) : x;
export const CONCEPT_TOOL_SCHEMA = strip(CONCEPT_JSON_SCHEMA);

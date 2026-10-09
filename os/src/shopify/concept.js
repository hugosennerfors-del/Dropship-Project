// Brand concepts: the strict shape the Brand Builder produces and the only
// shape that reaches Shopify. Model output, your edits and anything read
// back from the database all pass validateConcept() first; nothing that
// fails it is published.
//
// Plain ESM with no imports, shared by the page, the edge function and the
// tests.

export const SECTION_TYPES = ["hero", "featured-collection", "rich-text", "image-with-text", "usp-columns", "faq", "testimonials", "newsletter"];
export const PALETTE_ROLES = ["primary", "secondary", "accent", "bg", "fg"];
export const LIMITS = { concepts: 5, products: 12, options: 3, optionValues: 20, variants: 100, sections: 12 };

// -- Handles ------------------------------------------------------------
// Shopify handles: lower case letters, digits and hyphens. Å, ä and ö
// become a, a and o.
export function slugify(s, max = 60) {
  return String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "") || "brand";
}
// The first free handle: base, base-2, base-3 … `taken` is a Set or a
// function (handle) => boolean.
export function uniqueHandle(base, taken) {
  const has = typeof taken === "function" ? taken : (h) => taken?.has?.(h);
  const root = slugify(base);
  if (!has(root)) return root;
  for (let i = 2; i < 1000; i++) {
    const h = `${root.slice(0, 56)}-${i}`;
    if (!has(h)) return h;
  }
  throw new Error("No free handle for " + root);
}

// -- HTML ---------------------------------------------------------------
// Product and page text may only use these tags, and never attributes.
// Script-like blocks are dropped with their content, allowed tags lose
// their attributes, every other tag is removed, and all remaining text is
// escaped, so no script, style, link or event handler can get through.
const TAGS = new Set(["p", "ul", "ol", "li", "strong", "em", "b", "i", "h2", "h3", "h4", "blockquote", "br"]);
const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export function sanitizeHtml(html) {
  let s = String(html ?? "").replace(/[\u0000\u0001]/g, "");
  s = s.replace(/<(script|style|iframe|object|embed|template|noscript|svg|math)\b[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (m, tag) => {
    const t = tag.toLowerCase();
    if (!TAGS.has(t)) return "";
    return t === "br" ? "\u0000br\u0001" : `\u0000${m[1] === "/" ? "/" : ""}${t}\u0001`;
  });
  s = escapeHtml(s).replace(/\u0000(\/?[a-z0-9]+)\u0001/g, "<$1>");
  return s.trim();
}
// Plain text from the model becomes paragraphs; HTML is sanitised.
export function toHtml(text) {
  const t = String(text ?? "").trim();
  if (!t) return "";
  if (/<(p|ul|ol|li|strong|em|b|i|h[2-4]|br|blockquote)\b/i.test(t)) return sanitizeHtml(t);
  return t.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
}
export const stripHtml = (s) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

// -- Validation ---------------------------------------------------------
// Returns { ok, errors: ["path: message"], value } where value is the
// normalised concept (trimmed strings, handles filled in, HTML sanitised).
export function validateConcept(input, opts = {}) {
  const errors = [];
  const err = (path, msg) => errors.push(`${path}: ${msg}`);
  const obj = (x) => x && typeof x === "object" && !Array.isArray(x);
  const str = (path, x, { min = 1, max = 200, optional = false } = {}) => {
    if (x == null || x === "") { if (!optional && min > 0) err(path, "required"); return optional ? undefined : ""; }
    if (typeof x !== "string" && typeof x !== "number") { err(path, "must be text"); return ""; }
    const s = String(x).replace(/\s+/g, " ").trim();
    if (s.length < min) err(path, `at least ${min} characters`);
    if (s.length > max) err(path, `at most ${max} characters`);
    return s.slice(0, max);
  };
  const text = (path, x, max = 4000, min = 1) => {
    if (x == null || x === "") { if (min > 0) err(path, "required"); return ""; }
    const s = String(x).trim();
    if (s.length > max) err(path, `at most ${max} characters`);
    return s.slice(0, max);
  };
  const list = (path, x, { min = 0, max = 10, each = 200 } = {}) => {
    if (x == null) { if (min) err(path, `at least ${min} items`); return []; }
    if (!Array.isArray(x)) { err(path, "must be a list"); return []; }
    if (x.length < min) err(path, `at least ${min} items`);
    if (x.length > max) err(path, `at most ${max} items`);
    return x.slice(0, max).map((v, i) => str(`${path}[${i}]`, v, { max: each }));
  };

  if (!obj(input)) return { ok: false, errors: ["concept: must be an object"], value: null };
  const c = input;
  const v = {};
  v.name = str("name", c.name, { max: 60 });
  v.handle = c.handle ? slugify(c.handle) : slugify(v.name);
  if (c.handle && slugify(c.handle) !== String(c.handle)) err("handle", "only a–z, 0–9 and hyphens");
  v.tagline = str("tagline", c.tagline, { max: 60 });
  v.positioning = str("positioning", c.positioning, { max: 700 });

  const ta = obj(c.targetAudience) ? c.targetAudience : {};
  v.targetAudience = {
    summary: str("targetAudience.summary", ta.summary, { max: 400 }),
    personas: (Array.isArray(ta.personas) ? ta.personas : []).slice(0, 4).map((p, i) => ({
      name: str(`targetAudience.personas[${i}].name`, p?.name, { max: 60 }),
      description: str(`targetAudience.personas[${i}].description`, p?.description, { max: 400 }),
    })),
  };
  const tv = obj(c.toneOfVoice) ? c.toneOfVoice : {};
  v.toneOfVoice = {
    adjectives: list("toneOfVoice.adjectives", tv.adjectives, { min: 1, max: 8, each: 40 }),
    doList: list("toneOfVoice.doList", tv.doList, { max: 8, each: 160 }),
    dontList: list("toneOfVoice.dontList", tv.dontList, { max: 8, each: 160 }),
  };

  const id = obj(c.identity) ? c.identity : {};
  const palette = Array.isArray(id.palette) ? id.palette : [];
  if (palette.length < 3 || palette.length > 8) err("identity.palette", "3 to 8 colours");
  const pal = palette.slice(0, 8).map((p, i) => {
    const hex = String(p?.hex ?? "").trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) err(`identity.palette[${i}].hex`, "must be #rrggbb");
    if (!PALETTE_ROLES.includes(p?.role)) err(`identity.palette[${i}].role`, `one of ${PALETTE_ROLES.join(", ")}`);
    return { role: p?.role, hex: hex.toLowerCase(), name: str(`identity.palette[${i}].name`, p?.name, { max: 40 }) };
  });
  for (const role of ["primary", "bg", "fg"]) if (!pal.some((p) => p.role === role)) err("identity.palette", `needs a ${role} colour`);
  const ty = obj(id.typography) ? id.typography : {};
  const font = (path, f) => { const s = str(path, f, { max: 40 }); if (s && !/^[A-Za-z0-9 ]{2,40}$/.test(s)) err(path, "a font name (letters, digits, spaces)"); return s; };
  v.identity = {
    palette: pal,
    typography: { headingFont: font("identity.typography.headingFont", ty.headingFont), bodyFont: font("identity.typography.bodyFont", ty.bodyFont), rationale: str("identity.typography.rationale", ty.rationale, { max: 300, optional: true }) ?? "" },
    logoBrief: str("identity.logoBrief", id.logoBrief, { max: 600 }),
    imageryDirection: str("identity.imageryDirection", id.imageryDirection, { max: 600 }),
  };

  const st = obj(c.story) ? c.story : {};
  v.story = { about: text("story.about", st.about, 1500), mission: str("story.mission", st.mission, { max: 300 }), usps: list("story.usps", st.usps, { min: 3, max: 5, each: 140 }) };

  const products = Array.isArray(c.products) ? c.products : [];
  if (products.length < 1) err("products", "at least 1 product");
  if (products.length > LIMITS.products) err("products", `at most ${LIMITS.products} products`);
  const productHandles = new Set();
  v.products = products.slice(0, LIMITS.products).map((p, i) => {
    const out = validateProduct(p, `products[${i}]`, err, { str, text, list, obj });
    // Handles carry the brand once: "tidewarm-dry-bag", not "tidewarm-tidewarm-dry-bag".
    const titleSlug = slugify(out.title);
    out.handle = uniqueHandle(p?.handle || (titleSlug.startsWith(v.handle) ? titleSlug : `${v.handle}-${titleSlug}`), productHandles);
    productHandles.add(out.handle);
    return out;
  });

  const plan = obj(c.pagePlan) && Array.isArray(c.pagePlan.sections) ? c.pagePlan.sections : [];
  if (!plan.length) err("pagePlan.sections", "at least 1 section");
  if (plan.length > LIMITS.sections) err("pagePlan.sections", `at most ${LIMITS.sections} sections`);
  v.pagePlan = {
    sections: plan.slice(0, LIMITS.sections).map((s, i) => {
      const p = `pagePlan.sections[${i}]`;
      if (!SECTION_TYPES.includes(s?.type)) err(`${p}.type`, `one of ${SECTION_TYPES.join(", ")}`);
      return {
        type: s?.type,
        headline: str(`${p}.headline`, s?.headline, { max: 120, optional: true }),
        body: s?.body == null ? undefined : text(`${p}.body`, s.body, 1500, 0),
        items: s?.items == null ? undefined : (Array.isArray(s.items) ? s.items : []).slice(0, 8).map((it, j) => ({
          title: str(`${p}.items[${j}].title`, it?.title, { max: 120 }), body: text(`${p}.items[${j}].body`, it?.body, 600),
        })),
        imagePrompt: str(`${p}.imagePrompt`, s?.imagePrompt, { max: 400, optional: true }),
      };
    }),
  };

  const seo = obj(c.seo) ? c.seo : {};
  v.seo = { title: str("seo.title", seo.title, { max: 70 }), description: str("seo.description", seo.description, { max: 320 }), keywords: list("seo.keywords", seo.keywords, { max: 12, each: 60 }) };
  v.legalFlags = list("legalFlags", c.legalFlags ?? [], { max: 10, each: 240 });
  if (opts.market) v.market = opts.market;
  else if (c.market) v.market = str("market", c.market, { max: 8 });
  if (c.currency) v.currency = str("currency", c.currency, { max: 3 });
  return { ok: errors.length === 0, errors, value: v };
}

function validateProduct(p, path, err, { str, text, list, obj }) {
  if (!obj(p)) { err(path, "must be an object"); return { title: "", options: [], variants: [] }; }
  const out = {
    title: str(`${path}.title`, p.title, { max: 120 }),
    description: "",
    bulletPoints: list(`${path}.bulletPoints`, p.bulletPoints ?? [], { max: 8, each: 200 }),
    productType: str(`${path}.productType`, p.productType, { max: 60 }),
    tags: list(`${path}.tags`, p.tags ?? [], { max: 12, each: 40 }).map((t) => t.replace(/,/g, " ")),
    options: [],
    variants: [],
    imagePrompts: list(`${path}.imagePrompts`, p.imagePrompts ?? [], { max: 6, each: 400 }),
    images: list(`${path}.images`, p.images ?? [], { max: 10, each: 1000 }),
    seo: { title: str(`${path}.seo.title`, p.seo?.title, { max: 70 }), description: str(`${path}.seo.description`, p.seo?.description, { max: 320 }) },
  };
  out.description = toHtml(text(`${path}.description`, p.description, 5000));
  if (p.costEstimate != null && p.costEstimate !== "") out.costEstimate = money(`${path}.costEstimate`, p.costEstimate, err, { allowZero: true });
  if (p.suggestedMarginPct != null) {
    const m = Number(p.suggestedMarginPct);
    if (!Number.isFinite(m) || m < -100 || m > 100) err(`${path}.suggestedMarginPct`, "a percentage");
    else out.suggestedMarginPct = m;
  }
  for (const [i, u] of out.images.entries()) if (!/^https:\/\/[^\s"'<>]+$/i.test(u)) err(`${path}.images[${i}]`, "must be an https URL");

  const options = Array.isArray(p.options) ? p.options : [];
  if (options.length > 3) err(`${path}.options`, "at most 3 options");
  out.options = options.slice(0, 3).map((o, i) => {
    const values = Array.isArray(o?.values) ? o.values : [];
    if (!values.length) err(`${path}.options[${i}].values`, "at least 1 value");
    if (values.length > 20) err(`${path}.options[${i}].values`, "at most 20 values");
    const vals = values.slice(0, 20).map((x, j) => str(`${path}.options[${i}].values[${j}]`, x, { max: 60 }));
    if (new Set(vals).size !== vals.length) err(`${path}.options[${i}].values`, "values must be unique");
    return { name: str(`${path}.options[${i}].name`, o?.name, { max: 40 }), values: vals };
  });
  if (new Set(out.options.map((o) => o.name.toLowerCase())).size !== out.options.length) err(`${path}.options`, "option names must be unique");

  const variants = Array.isArray(p.variants) ? p.variants : [];
  if (!variants.length) err(`${path}.variants`, "at least 1 variant");
  if (variants.length > 100) err(`${path}.variants`, "at most 100 variants");
  const combos = new Set();
  const skus = new Set();
  out.variants = variants.slice(0, 100).map((x, i) => {
    const vp = `${path}.variants[${i}]`;
    const ov = Array.isArray(x?.optionValues) ? x.optionValues.map((s) => String(s ?? "").trim()) : [];
    if (out.options.length && ov.length !== out.options.length) err(`${vp}.optionValues`, `needs ${out.options.length} value(s), one per option`);
    if (!out.options.length && ov.length > 0) err(`${vp}.optionValues`, "the product has no options");
    ov.forEach((val, k) => { if (out.options[k] && !out.options[k].values.includes(val)) err(`${vp}.optionValues[${k}]`, `“${val}” is not a value of ${out.options[k].name}`); });
    const key = ov.join("\u0001");
    if (combos.has(key)) err(`${vp}.optionValues`, "duplicate variant");
    combos.add(key);
    const price = money(`${vp}.price`, x?.price, err);
    let compareAtPrice;
    if (x?.compareAtPrice != null && x.compareAtPrice !== "") {
      compareAtPrice = money(`${vp}.compareAtPrice`, x.compareAtPrice, err);
      if (Number(compareAtPrice) <= Number(price)) err(`${vp}.compareAtPrice`, "must be higher than the price");
    }
    const sku = String(x?.sku ?? "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(sku)) err(`${vp}.sku`, "letters, digits, . _ - (max 64)");
    if (skus.has(sku)) err(`${vp}.sku`, "SKU must be unique");
    skus.add(sku);
    const out2 = { optionValues: ov, price, sku };
    if (compareAtPrice) out2.compareAtPrice = compareAtPrice;
    if (x?.weightGrams != null && x.weightGrams !== "") {
      const w = Number(x.weightGrams);
      if (!Number.isInteger(w) || w < 0 || w > 70000) err(`${vp}.weightGrams`, "whole grams, 0–70000");
      else out2.weightGrams = w;
    }
    return out2;
  });
  if (out.options.length) {
    const total = out.options.reduce((n, o) => n * o.values.length, 1);
    if (total > 100) err(`${path}.options`, "more than 100 combinations");
  }
  return out;
}

// Prices travel as decimal strings ("24.99"): more than zero unless
// allowZero, at most two decimals.
function money(path, x, err, { allowZero = false } = {}) {
  const s = String(x ?? "").trim().replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) { err(path, "a price like 24.99"); return "0"; }
  if (!allowZero && Number(s) <= 0) err(path, "must be more than 0");
  return Number(s).toFixed(2);
}

// Margin per variant: price incl. VAT, unit cost, shipping and fees.
// Returned so the page can warn before anything is published.
export function variantMargin({ price, cost, vat = 0.2, shipping = 0, paymentPct = 0.029, paymentFixed = 0.3, shopifyPct = 0 }) {
  const p = Number(price), c = Number(cost);
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(c)) return null;
  const net = p / (1 + vat);
  const fees = p * (paymentPct + shopifyPct) + paymentFixed;
  const contribution = net - c - shipping - fees;
  return { net: round2(net), fees: round2(fees), contribution: round2(contribution), marginPct: Math.round((contribution / net) * 1000) / 10 };
}
const round2 = (x) => Math.round(x * 100) / 100;

// Brand concept → the ordered steps of a publish job, with the exact
// GraphQL variables each step sends. The dry run shows this plan; the
// edge function runs it. One function, so what you review is what runs.
//
// Model B (one Shopify store per brand) is a choice of connection, not a
// different plan: a plan never assumes which store it goes to.

import { validateConcept, toHtml, stripHtml, sanitizeHtml, variantMargin, POLICY_KEYS, POLICY_SLUGS, FILL_IN } from "./concept.js";
import { SCOPES_FOR } from "./documents.js";
import { groupsFor } from "./schema.js";

export const BRAND_METAOBJECT_TYPE = "plan_vy_brand";
export const DEFAULT_OPTIONS = { productStatus: "DRAFT", includeBrand: true, publishPage: false, publishToOnlineStore: false, addToMenu: false, menuHandle: "main-menu", writeTheme: false, productHandles: null, includePolicies: false };
const CURRENCY = { UK: "GBP", SE: "SEK" };
const VAT = { UK: 0.2, SE: 0.25 };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function normaliseOptions(o = {}) {
  const out = { ...DEFAULT_OPTIONS, ...o };
  out.productStatus = out.productStatus === "ACTIVE" ? "ACTIVE" : "DRAFT";
  for (const k of ["includeBrand", "publishPage", "publishToOnlineStore", "addToMenu", "writeTheme", "includePolicies"]) out[k] = !!out[k];
  out.menuHandle = /^[a-z0-9-]{1,60}$/.test(String(out.menuHandle || "")) ? out.menuHandle : "main-menu";
  out.productHandles = Array.isArray(out.productHandles) && out.productHandles.length ? out.productHandles.map(String) : null;
  if (!out.includeBrand) { out.publishPage = false; out.addToMenu = false; out.includePolicies = false; }
  // Theme templates are phase 7; until then the option cannot be switched on.
  out.writeTheme = false;
  return out;
}

export function buildPlan(conceptInput, optionsInput = {}) {
  const v = validateConcept(conceptInput);
  if (!v.ok) return { ok: false, errors: v.errors, steps: [], summary: null, warnings: [] };
  const c = v.value;
  const o = normaliseOptions(optionsInput);
  const market = c.market || "UK";
  const currency = c.currency || CURRENCY[market] || "GBP";
  const products = o.productHandles ? c.products.filter((p) => o.productHandles.includes(p.handle)) : c.products;
  if (!products.length) return { ok: false, errors: ["productHandles: none of the chosen products are in this concept"], steps: [], summary: null, warnings: [] };
  const brandTag = `brand:${c.handle}`;
  const images = products.some((p) => p.images.length);
  const warnings = [];
  const policies = o.includePolicies ? policyPages(c) : [];
  if (o.includePolicies && !policies.length) return { ok: false, errors: ["policies: this brand has no policy pages yet; write them first or untick them"], steps: [], summary: null, warnings: [] };
  const unfilled = policies.filter((p) => FILL_IN.test(p.body)).map((p) => p.title);
  if (unfilled.length) return { ok: false, errors: [`policies: fill in the marked gaps first ([FYLL I] / [FILL IN]) in: ${unfilled.join(", ")}`], steps: [], summary: null, warnings: [] };

  const opts = { collection: o.includeBrand, metaobject: o.includeBrand, page: o.includeBrand, addToMenu: o.addToMenu, publishToOnlineStore: o.publishToOnlineStore };
  const groups = groupsFor(opts, { images });
  const scopes = [...new Set([...SCOPES_FOR.product, ...(o.includeBrand ? [...SCOPES_FOR.collection, ...SCOPES_FOR.metaobject, ...SCOPES_FOR.page] : []),
    ...(o.addToMenu ? SCOPES_FOR.menu : []), ...(o.publishToOnlineStore ? SCOPES_FOR.publish : [])])];

  const steps = [];
  steps.push({ key: "preflight", kind: "preflight", title: "Check the store: token, scopes, API fields, currency, free handles",
    check: { groups, scopes, currency, productHandles: products.map((p) => p.handle), collectionHandle: o.includeBrand ? c.handle : null, pageHandle: o.includeBrand ? c.handle : null, ...(policies.length ? { policyHandles: policies.map((p) => p.handle) } : {}) } });

  if (o.includeBrand) {
    steps.push({ key: "metaobject-definition", kind: "metaobjectDefinition", title: "Brand metaobject type (created once per store)",
      variables: { type: BRAND_METAOBJECT_TYPE, definition: metaobjectDefinition() } });
  }

  for (const p of products) {
    const tags = [...new Set([...p.tags, brandTag, "plan-vy"])];
    const hasOptions = p.options.length > 0;
    const productOptions = hasOptions
      ? p.options.map((op, i) => ({ name: op.name, position: i + 1, values: op.values.map((name) => ({ name })) }))
      : [{ name: "Title", position: 1, values: [{ name: "Default Title" }] }];
    const variants = p.variants.map((x) => {
      const vv = {
        optionValues: hasOptions ? x.optionValues.map((name, i) => ({ optionName: p.options[i].name, name })) : [{ optionName: "Title", name: "Default Title" }],
        price: x.price,
        inventoryItem: { sku: x.sku, tracked: false, ...(x.weightGrams != null ? { measurement: { weight: { value: x.weightGrams, unit: "GRAMS" } } } : {}) },
      };
      if (x.compareAtPrice) vv.compareAtPrice = x.compareAtPrice;
      return vv;
    });
    const descriptionHtml = p.description + (p.bulletPoints.length ? `<ul>${p.bulletPoints.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "");
    const input = {
      title: p.title, handle: p.handle, descriptionHtml: sanitizeHtml(descriptionHtml), productType: p.productType, vendor: c.name, tags,
      status: o.productStatus, seo: { title: p.seo.title, description: p.seo.description }, productOptions, variants,
      metafields: [{ namespace: "custom", key: "brand", type: "single_line_text_field", value: c.handle }],
    };
    if (p.images.length) input.files = p.images.map((url, i) => ({ originalSource: url, alt: `${p.title}${i ? ` – ${i + 1}` : ""}`.slice(0, 512), contentType: "IMAGE" }));
    steps.push({ key: `product:${p.handle}`, kind: "product", handle: p.handle, title: `Product: ${p.title} (${p.variants.length} variant${p.variants.length === 1 ? "" : "s"}, ${o.productStatus === "DRAFT" ? "draft" : "active"})`,
      variables: { identifier: null, input, synchronous: true } });
    // Margin warnings, before anything is published.
    if (p.costEstimate) {
      for (const x of p.variants) {
        const mg = variantMargin({ price: x.price, cost: p.costEstimate, vat: VAT[market] ?? 0.2 });
        if (mg && mg.contribution < 0) warnings.push(`${p.title} (${x.sku}): negative margin, ${mg.contribution} ${currency} per unit before ads.`);
      }
    }
    if (!p.images.length) warnings.push(`${p.title}: no images; Shopify shows a placeholder until you add some.`);
  }

  if (o.includeBrand) {
    steps.push({ key: "collection", kind: "collection", title: `Collection: ${c.name} (smart, tag ${brandTag})`,
      variables: { input: { title: c.name, handle: c.handle, descriptionHtml: toHtml(c.positioning), seo: { title: c.seo.title, description: c.seo.description },
        ruleSet: { appliedDisjunctively: false, rules: [{ column: "TAG", relation: "EQUALS", condition: brandTag }] } } } });
    steps.push({ key: "metaobject", kind: "metaobject", title: "Brand metaobject: palette, typography, story, USPs",
      variables: { handle: { type: BRAND_METAOBJECT_TYPE, handle: c.handle }, metaobject: { fields: metaobjectFields(c) } } });
    const { html, skipped } = pageBody(c);
    if (skipped.length) warnings.push(`Not published on the page: ${skipped.join(", ")} (testimonials must be real customer quotes; add them in Shopify).`);
    steps.push({ key: "page", kind: "page", title: `Page: ${c.name} (${o.publishPage ? "published" : "hidden"})`,
      variables: { page: { title: c.name, handle: c.handle, body: html, isPublished: o.publishPage } } });
    for (const p of policies) {
      steps.push({ key: `policy:${p.handle}`, kind: "policyPage", handle: p.handle, title: `Policy page: ${p.title} (${o.publishPage ? "published" : "hidden"})`,
        variables: { page: { title: p.title, handle: p.handle, body: p.body, isPublished: o.publishPage } } });
    }
  }
  if (o.addToMenu) steps.push({ key: "menu", kind: "menu", title: `Menu item “${c.name}” in ${o.menuHandle}`, menuHandle: o.menuHandle, item: { title: c.name, type: "COLLECTION", resourceId: "<collection id from the collection step>" } });
  if (o.publishToOnlineStore) steps.push({ key: "publish", kind: "publish", title: "Publish to the Online Store channel", targets: [...(o.includeBrand ? ["collection"] : []), ...products.map((p) => `product:${p.handle}`)] });
  steps.push({ key: "finalize", kind: "finalize", title: "Save ids and links" });

  for (const f of c.legalFlags) warnings.push(`Check: ${f}`);
  if (o.productStatus === "ACTIVE") warnings.push("Products are created as ACTIVE: they can be bought as soon as they are published to a sales channel.");

  const variantsTotal = products.reduce((n, p) => n + p.variants.length, 0);
  const apiCalls = 5 + products.length * 2 + (o.includeBrand ? 7 : 0) + policies.length * 2 + (o.addToMenu ? 2 : 0) + (o.publishToOnlineStore ? 1 + products.length + (o.includeBrand ? 1 : 0) : 0);
  const summary = {
    brand: c.name, handle: c.handle, market, currency, status: o.productStatus,
    products: products.length, variants: variantsTotal, images: products.reduce((n, p) => n + p.images.length, 0),
    collection: o.includeBrand ? 1 : 0, page: o.includeBrand ? 1 : 0, metaobject: o.includeBrand ? 1 : 0, menuItem: o.addToMenu ? 1 : 0, policyPages: policies.length,
    publishToOnlineStore: o.publishToOnlineStore, pagePublished: o.publishPage, apiCalls, estSeconds: Math.round(apiCalls * 0.7 + products.length * 1.5 + 3), scopes,
  };
  return { ok: true, errors: [], steps, summary, warnings, options: o, concept: c };
}

// The brand's policy pages, in a fixed order, with brand-specific handles
// (one store can carry several brands).
export function policyPages(c) {
  const slugs = POLICY_SLUGS[c.market === "SE" ? "SE" : "UK"];
  return POLICY_KEYS.filter((k) => c.policies?.[k]?.body).map((k) => ({ key: k, handle: `${c.handle}-${slugs[k]}`.slice(0, 120), title: c.policies[k].title, body: sanitizeHtml(c.policies[k].body) }));
}

export function metaobjectDefinition() {
  const f = (key, name, type) => ({ key, name, type });
  return {
    type: BRAND_METAOBJECT_TYPE, name: "Brand (Plan-vy)",
    access: { storefront: "PUBLIC_READ" },
    fieldDefinitions: [
      f("name", "Name", "single_line_text_field"), f("tagline", "Tagline", "single_line_text_field"),
      f("positioning", "Positioning", "multi_line_text_field"), f("story", "Story", "multi_line_text_field"),
      f("mission", "Mission", "single_line_text_field"), f("usps", "USPs", "list.single_line_text_field"),
      f("palette", "Palette", "json"), f("typography", "Typography", "json"),
      f("logo_brief", "Logo brief", "multi_line_text_field"), f("collection_handle", "Collection handle", "single_line_text_field"),
    ],
  };
}

export function metaobjectFields(c) {
  return [
    { key: "name", value: c.name }, { key: "tagline", value: c.tagline }, { key: "positioning", value: c.positioning },
    { key: "story", value: stripHtml(c.story.about) }, { key: "mission", value: c.story.mission }, { key: "usps", value: JSON.stringify(c.story.usps) },
    { key: "palette", value: JSON.stringify(c.identity.palette) }, { key: "typography", value: JSON.stringify({ heading: c.identity.typography.headingFont, body: c.identity.typography.bodyFont }) },
    { key: "logo_brief", value: c.identity.logoBrief }, { key: "collection_handle", value: c.handle },
  ];
}

// The page body: the section plan as plain, sanitised HTML that any theme
// renders. Links are built here (never taken from model text).
export function pageBody(c) {
  const out = [], skipped = [];
  for (const s of c.pagePlan.sections) {
    const h = s.headline ? `<h2>${esc(s.headline)}</h2>` : "";
    const b = s.body ? toHtml(s.body) : "";
    switch (s.type) {
      case "testimonials": skipped.push("testimonials"); break;
      case "usp-columns": out.push(h + b + `<ul>${(s.items?.length ? s.items : c.story.usps.map((u) => ({ title: u, body: "" }))).map((it) => `<li><strong>${esc(it.title)}</strong>${it.body ? ` ${esc(stripHtml(it.body))}` : ""}</li>`).join("")}</ul>`); break;
      case "faq": out.push(h + b + (s.items || []).map((it) => `<h3>${esc(it.title)}</h3>${toHtml(it.body)}`).join("")); break;
      case "featured-collection": out.push(h + b + `<p><a href="/collections/${encodeURIComponent(c.handle)}">${esc(`Shop ${c.name}`)}</a></p>`); break;
      default: out.push(h + b);
    }
  }
  return { html: out.filter(Boolean).join("\n"), skipped };
}

// Links for a created resource. A simulated store (*.mock.test) has no
// admin or storefront, so it gets no links rather than dead ones.
const simulated = (domain) => /\.mock\.test$/.test(String(domain || ""));
export function adminUrl(shopDomain, type, gid) {
  if (simulated(shopDomain)) return null;
  const store = String(shopDomain || "").replace(/\.myshopify\.com$/, "");
  const id = String(gid || "").split("/").pop();
  const path = { product: "products", collection: "collections", page: "content/pages", metaobject: "content/entries", menu: "content/menus" }[type];
  return path && id ? `https://admin.shopify.com/store/${store}/${path}/${id}` : null;
}
export function publicUrl(host, type, handle) {
  if (simulated(host)) return null;
  const path = { product: "products", collection: "collections", page: "pages" }[type];
  return path && host && handle ? `https://${host}/${path}/${handle}` : null;
}

// Rollback: what happens to each resource a job created. Default is soft:
// products back to draft, pages hidden, publications withdrawn, menus
// restored. Delete removes what the job created (never anything that
// existed before it, never the shared metaobject type).
export function planRollback(resources, mode = "unpublish") {
  const live = resources.filter((r) => !r.removed_at);
  const order = { menu: 0, publication: 1, page: 2, collection: 3, product: 4, metaobject: 5, metaobject_definition: 6 };
  const actions = [];
  for (const r of [...live].sort((a, b) => (order[a.resource_type] ?? 9) - (order[b.resource_type] ?? 9))) {
    const existed = !!r.previous_state?.existed;
    switch (r.resource_type) {
      case "menu": actions.push({ resource: r, op: "restoreMenu", label: `Restore menu ${r.handle} to its earlier items` }); break;
      case "publication": actions.push({ resource: r, op: "unpublish", label: `Withdraw ${r.handle} from the Online Store` }); break;
      case "page":
        if (mode === "delete" && !existed) actions.push({ resource: r, op: "deletePage", label: `Delete page ${r.handle}` });
        else actions.push({ resource: r, op: "hidePage", label: `Hide page ${r.handle}` });
        break;
      case "collection":
        if (mode === "delete" && !existed) actions.push({ resource: r, op: "deleteCollection", label: `Delete collection ${r.handle}` });
        break;
      case "product":
        if (mode === "delete" && !existed) actions.push({ resource: r, op: "deleteProduct", label: `Delete product ${r.handle}` });
        else actions.push({ resource: r, op: "draftProduct", label: existed && r.previous_state?.status ? `Set product ${r.handle} back to ${r.previous_state.status}` : `Set product ${r.handle} to draft`, status: existed && r.previous_state?.status ? r.previous_state.status : "DRAFT" });
        break;
      case "metaobject":
        if (mode === "delete" && !existed) actions.push({ resource: r, op: "deleteMetaobject", label: `Delete brand entry ${r.handle}` });
        break;
      default: break;
    }
  }
  return actions;
}

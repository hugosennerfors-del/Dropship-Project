// A simulated Shopify Admin GraphQL endpoint for tests and for the
// "simulated store" connection (domain *.mock.test, test stores only).
// It answers the operations in documents.js by name, keeps state, meters
// cost like Shopify's leaky bucket and can inject throttling, server
// errors and user errors. It is not Shopify: passing against it proves the
// pipeline's logic, not that a real store accepts the payloads (the
// introspection check and a development store do that).

import { NEEDS } from "./documents.js";

export function createMockShop(opts = {}) {
  let clock = opts.clock || (() => Date.now());
  const shop = { name: opts.name || "Plan-vy Test Store", domain: opts.domain || "plan-vy-test.mock.test", currency: opts.currency || "GBP", plan: "Development" };
  const scopes = opts.scopes || ["write_products", "write_content", "write_metaobject_definitions", "write_metaobjects", "write_online_store_navigation", "write_publications"];
  const missingFields = new Set(opts.missingFields || []);
  const st = {
    seq: 1000, products: new Map(), collections: new Map(), pages: new Map(), defs: new Map(), metaobjects: new Map(),
    menus: new Map([["gid://shopify/Menu/1", { id: "gid://shopify/Menu/1", handle: "main-menu", title: "Main menu", items: [
      { id: "gid://shopify/MenuItem/1", title: "Home", type: "FRONTPAGE", resourceId: null, url: "/", tags: [], items: [] },
      { id: "gid://shopify/MenuItem/2", title: "Catalog", type: "CATALOG", resourceId: null, url: "/collections/all", tags: [], items: [] }] }]]),
    publications: [{ id: "gid://shopify/Publication/1", name: "Online Store" }, { id: "gid://shopify/Publication/2", name: "Point of Sale" }],
    published: new Map(), calls: [], bucket: { max: 2000, available: 2000, rate: 100, at: clock() },
  };
  // A simulated store that must outlive one function invocation is
  // restored from (and saved to) the database by the caller.
  if (opts.restore) {
    const r = opts.restore;
    st.seq = r.seq ?? st.seq;
    for (const k of ["products", "collections", "pages", "defs", "metaobjects", "menus", "published"]) if (Array.isArray(r[k])) st[k] = new Map(r[k]);
  }
  const inject = { throttle: 0, http500: 0, userErrors: {} };
  const gid = (type) => `gid://shopify/${type}/${++st.seq}`;

  // Schema for introspection: every path in NEEDS exists unless listed in
  // missingFields. Paths in deprecatedFields exist but are deprecated, and,
  // as in GraphQL, a deprecated argument or input field is only listed when
  // the query asks for it with includeDeprecated: true.
  const deprecatedFields = new Set(opts.deprecatedFields || []);
  const types = {};
  const rootName = { Query: "QueryRoot", Mutation: "Mutation" };
  for (const p of Object.values(NEEDS).flat()) {
    if (missingFields.has(p)) continue;
    const m = p.match(/^(\w+)\.(\w+)(?:\((\w+)\))?$/);
    const tn = rootName[m[1]] || m[1];
    const t = (types[tn] ||= { name: tn, fields: [], inputFields: [] });
    const isRoot = !!rootName[m[1]];
    const list = isRoot ? t.fields : t.inputFields;
    const old = deprecatedFields.has(p);
    let f = list.find((x) => x.name === m[2]);
    if (!f) { f = isRoot ? { name: m[2], isDeprecated: false, args: [] } : { name: m[2], isDeprecated: !m[3] && old }; list.push(f); }
    if (m[3] && !f.args.some((a) => a.name === m[3])) f.args.push({ name: m[3], isDeprecated: old });
  }
  const introspect = (t, q) => t && {
    ...t,
    fields: t.fields.map((f) => ({ ...f, args: /args\(includeDeprecated: true\)/.test(q) ? f.args : f.args.filter((a) => !a.isDeprecated) })),
    inputFields: /inputFields\(includeDeprecated: true\)/.test(q) ? t.inputFields : t.inputFields.filter((f) => !f.isDeprecated),
  };

  function charge(cost) {
    const b = st.bucket, t = clock();
    b.available = Math.min(b.max, b.available + ((t - b.at) / 1000) * b.rate);
    b.at = t;
    const throttled = inject.throttle > 0 ? (inject.throttle--, true) : b.available < cost;
    if (!throttled) b.available -= cost;
    return { throttled, cost: { requestedQueryCost: cost, actualQueryCost: throttled ? 0 : cost, throttleStatus: { maximumAvailable: b.max, currentlyAvailable: Math.floor(b.available), restoreRate: b.rate } } };
  }
  const userErr = (op) => { const n = inject.userErrors[op]; if (n) { inject.userErrors[op]--; return [{ field: ["input"], message: `Simulated refusal of ${op}` }]; } return null; };

  const handlers = {
    PlanvyShop: () => ({ shop: { name: shop.name, myshopifyDomain: shop.domain, currencyCode: shop.currency, primaryDomain: { url: `https://${shop.domain}`, host: shop.domain }, plan: { publicDisplayName: shop.plan, partnerDevelopment: true, shopifyPlus: false } } }),
    PlanvyScopes: () => ({ currentAppInstallation: { accessScopes: scopes.map((handle) => ({ handle })) } }),
    PlanvyVersions: () => ({ publicApiVersions: [{ handle: "2026-04", displayName: "2026-04", supported: true }, { handle: "2026-07", displayName: "2026-07 (Latest)", supported: true }] }),
    PlanvySchemaRoots: () => ({ __schema: { queryType: { name: "QueryRoot" }, mutationType: { name: "Mutation" } } }),
    PlanvySchemaTypes: (v, q) => {
      const out = {};
      for (const m of q.matchAll(/(t\d+): __type\(name: "([^"]+)"\)/g)) out[m[1]] = introspect(types[m[2]], q) || null;
      return out;
    },
    PlanvyProductByHandle: (v) => ({ productByIdentifier: [...st.products.values()].find((p) => p.handle === v.handle) || null }),
    PlanvyCollectionByHandle: (v) => ({ collectionByIdentifier: [...st.collections.values()].find((c) => c.handle === v.handle) || null }),
    PlanvyPageByHandle: (v) => ({ pages: { nodes: [...st.pages.values()].filter((p) => `handle:${p.handle}` === v.query) } }),
    PlanvyMetaobjectDefinition: (v) => ({ metaobjectDefinitionByType: st.defs.get(v.type) || null }),
    PlanvyPublications: () => ({ publications: { nodes: st.publications, pageInfo: { hasNextPage: false, endCursor: null } } }),
    PlanvyMenus: () => ({ menus: { nodes: [...st.menus.values()].map((m) => structuredClone(m)), pageInfo: { hasNextPage: false, endCursor: null } } }),
    PlanvyProductSet: (v) => {
      const ue = userErr("productSet"); if (ue) return { productSet: { product: null, userErrors: ue } };
      const inp = v.input;
      if (!inp?.title) return { productSet: { product: null, userErrors: [{ field: ["input", "title"], message: "Title can't be blank" }] } };
      if (v.identifier?.id) {
        const p = st.products.get(v.identifier.id);
        if (!p) return { productSet: { product: null, userErrors: [{ field: ["identifier"], message: "Product not found" }] } };
        Object.assign(p, { title: inp.title, status: inp.status || p.status, input: inp });
        return { productSet: { product: { id: p.id, handle: p.handle, status: p.status, title: p.title }, userErrors: [] } };
      }
      if ([...st.products.values()].some((p) => p.handle === inp.handle)) return { productSet: { product: null, userErrors: [{ field: ["input", "handle"], message: "Handle has already been taken" }] } };
      const p = { id: gid("Product"), handle: inp.handle, status: inp.status || "DRAFT", title: inp.title, input: inp };
      st.products.set(p.id, p);
      return { productSet: { product: { id: p.id, handle: p.handle, status: p.status, title: p.title }, userErrors: [] } };
    },
    PlanvyProductStatus: (v) => { const p = st.products.get(v.product.id); if (!p) return { productUpdate: { product: null, userErrors: [{ field: ["id"], message: "Product not found" }] } }; p.status = v.product.status; return { productUpdate: { product: { id: p.id, status: p.status }, userErrors: [] } }; },
    PlanvyProductDelete: (v) => { const ok = st.products.delete(v.input.id); return { productDelete: { deletedProductId: ok ? v.input.id : null, userErrors: ok ? [] : [{ field: ["id"], message: "Product not found" }] } }; },
    PlanvyCollectionCreate: (v) => {
      const ue = userErr("collectionCreate"); if (ue) return { collectionCreate: { collection: null, userErrors: ue } };
      if ([...st.collections.values()].some((c) => c.handle === v.input.handle)) return { collectionCreate: { collection: null, userErrors: [{ field: ["input", "handle"], message: "Handle has already been taken" }] } };
      const c = { id: gid("Collection"), handle: v.input.handle, title: v.input.title, input: v.input }; st.collections.set(c.id, c);
      return { collectionCreate: { collection: { id: c.id, handle: c.handle, title: c.title }, userErrors: [] } };
    },
    PlanvyCollectionDelete: (v) => { const ok = st.collections.delete(v.input.id); return { collectionDelete: { deletedCollectionId: ok ? v.input.id : null, userErrors: ok ? [] : [{ field: ["id"], message: "Collection not found" }] } }; },
    PlanvyMetaobjectDefinitionCreate: (v) => { const d = { id: gid("MetaobjectDefinition"), type: v.definition.type, definition: v.definition }; st.defs.set(d.type, d); return { metaobjectDefinitionCreate: { metaobjectDefinition: { id: d.id, type: d.type }, userErrors: [] } }; },
    PlanvyMetaobjectUpsert: (v) => {
      if (!st.defs.has(v.handle.type)) return { metaobjectUpsert: { metaobject: null, userErrors: [{ field: ["handle", "type"], message: "No definition for type" }] } };
      const key = `${v.handle.type}/${v.handle.handle}`;
      const m = st.metaobjects.get(key) || { id: gid("Metaobject"), handle: v.handle.handle };
      m.fields = v.metaobject.fields; st.metaobjects.set(key, m);
      return { metaobjectUpsert: { metaobject: { id: m.id, handle: m.handle }, userErrors: [] } };
    },
    PlanvyMetaobjectDelete: (v) => { for (const [k, m] of st.metaobjects) if (m.id === v.id) { st.metaobjects.delete(k); return { metaobjectDelete: { deletedId: v.id, userErrors: [] } }; } return { metaobjectDelete: { deletedId: null, userErrors: [{ field: ["id"], message: "Not found" }] } }; },
    PlanvyPageCreate: (v) => {
      const ue = userErr("pageCreate"); if (ue) return { pageCreate: { page: null, userErrors: ue } };
      if ([...st.pages.values()].some((p) => p.handle === v.page.handle)) return { pageCreate: { page: null, userErrors: [{ field: ["page", "handle"], message: "Handle has already been taken" }] } };
      const p = { id: gid("Page"), handle: v.page.handle, isPublished: !!v.page.isPublished, title: v.page.title, body: v.page.body }; st.pages.set(p.id, p);
      return { pageCreate: { page: { id: p.id, handle: p.handle, isPublished: p.isPublished }, userErrors: [] } };
    },
    PlanvyPageUpdate: (v) => { const p = st.pages.get(v.id); if (!p) return { pageUpdate: { page: null, userErrors: [{ field: ["id"], message: "Page not found" }] } }; Object.assign(p, v.page); return { pageUpdate: { page: { id: p.id, isPublished: !!p.isPublished }, userErrors: [] } }; },
    PlanvyPageDelete: (v) => { const ok = st.pages.delete(v.id); return { pageDelete: { deletedPageId: ok ? v.id : null, userErrors: ok ? [] : [{ field: ["id"], message: "Page not found" }] } }; },
    PlanvyMenuUpdate: (v) => {
      const m = st.menus.get(v.id); if (!m) return { menuUpdate: { menu: null, userErrors: [{ field: ["id"], message: "Menu not found" }] } };
      const fill = (it) => ({ id: it.id || gid("MenuItem"), title: it.title, type: it.type, resourceId: it.resourceId || null, url: it.url || null, tags: it.tags || [], items: (it.items || []).map(fill) });
      m.title = v.title; m.items = v.items.map(fill);
      return { menuUpdate: { menu: { id: m.id }, userErrors: [] } };
    },
    PlanvyPublish: (v) => { st.published.set(v.id, v.input.map((x) => x.publicationId)); return { publishablePublish: { userErrors: [] } }; },
    PlanvyUnpublish: (v) => { st.published.delete(v.id); return { publishableUnpublish: { userErrors: [] } }; },
  };

  async function fetchImpl(url, init) {
    const res = (status, json, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => ({ "x-request-id": `mock-${st.calls.length}`, ...headers })[k.toLowerCase()] ?? null }, text: async () => JSON.stringify(json) });
    // Client credentials grant (Dev Dashboard apps): form-encoded, answers
    // access_token, scope and expires_in.
    if (/\/admin\/oauth\/access_token$/.test(url)) {
      const form = new URLSearchParams(String(init.body || ""));
      st.calls.push({ op: "TokenExchange", url, token: "n/a" });
      if (opts.notPermitted) return res(400, { error: "shop_not_permitted", error_description: "Client credentials cannot be performed on this shop." });
      if (form.get("grant_type") !== "client_credentials" || !form.get("client_id") || !form.get("client_secret") || form.get("client_secret") === "bad") return res(400, { error: "invalid_client", error_description: "Client authentication failed (simulated)." });
      st.tokensIssued = (st.tokensIssued || 0) + 1;
      return res(200, { access_token: `mock-cc-token-${st.tokensIssued}`, scope: scopes.join(","), expires_in: 86399 });
    }
    const body = JSON.parse(init.body);
    const op = (String(body.query).match(/\b(?:query|mutation)\s+(\w+)/) || [])[1];
    st.calls.push({ op, variables: body.variables, url, token: init.headers?.["X-Shopify-Access-Token"] ? "present" : "missing" });
    if (!init.headers?.["X-Shopify-Access-Token"] || init.headers["X-Shopify-Access-Token"] === "bad") return res(401, { errors: "[API] Invalid API key or access token" });
    if (inject.http500 > 0) { inject.http500--; return res(502, { errors: "Bad gateway (simulated)" }); }
    const isMutation = /^\s*mutation/.test(body.query);
    const c = charge(isMutation ? 10 : 2);
    if (c.throttled) return res(200, { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }], extensions: { cost: c.cost } });
    const h = handlers[op];
    if (!h) return res(200, { errors: [{ message: `Mock has no handler for ${op}` }] });
    return res(200, { data: h(body.variables || {}, body.query), extensions: { cost: c.cost } });
  }

  const snapshot = () => ({ seq: st.seq, ...Object.fromEntries(["products", "collections", "pages", "defs", "metaobjects", "menus", "published"].map((k) => [k, [...st[k]]])) });
  return { fetch: fetchImpl, state: st, inject, shop, snapshot, setClock: (fn) => { clock = fn; } };
}

// Introspection check: does the store's Admin API (at the pinned version)
// have every root field, argument and input field this integration sends?
// Runs on "Test connection" and before every publish job, so a renamed or
// removed field stops the job before anything is written, with the exact
// missing paths in the error.

import { NEEDS } from "./documents.js";

export async function verifySchema(client, groups = Object.keys(NEEDS)) {
  const paths = [...new Set(groups.flatMap((g) => NEEDS[g] || []))];
  const { data: root } = await client.request(`query PlanvySchemaRoots { __schema { queryType { name } mutationType { name } } }`);
  const roots = { Query: root?.__schema?.queryType?.name || "QueryRoot", Mutation: root?.__schema?.mutationType?.name || "Mutation" };
  const typeOf = (p) => { const t = p.split(".")[0]; return roots[t] || t; };
  const names = [...new Set(paths.map(typeOf))];
  const aliases = names.map((n, i) => `t${i}: __type(name: ${JSON.stringify(n)}) { name fields(includeDeprecated: true) { name isDeprecated args { name } } inputFields { name } }`);
  const { data } = await client.request(`query PlanvySchemaTypes { ${aliases.join(" ")} }`);
  const types = {};
  names.forEach((n, i) => { types[n] = data?.[`t${i}`] || null; });
  const missing = [], deprecated = [];
  for (const p of paths) {
    const m = p.match(/^(\w+)\.(\w+)(?:\((\w+)\))?$/);
    if (!m) continue;
    const t = types[typeOf(p)];
    if (!t) { missing.push(p); continue; }
    const field = (t.fields || []).find((f) => f.name === m[2]) || (t.inputFields || []).find((f) => f.name === m[2]);
    if (!field) { missing.push(p); continue; }
    if (m[3] && !(field.args || []).some((a) => a.name === m[3])) { missing.push(p); continue; }
    if (field.isDeprecated) deprecated.push(p);
  }
  return { ok: missing.length === 0, missing, deprecated, checked: paths.length };
}

// Which NEEDS groups a publish with these options touches.
export function groupsFor(options = {}, { images = false, rollback = null } = {}) {
  const g = ["base", "product"];
  if (images) g.push("productImages");
  if (options.collection !== false) g.push("collection");
  if (options.metaobject !== false) g.push("metaobject");
  if (options.page !== false) g.push("page");
  if (options.addToMenu) g.push("menu");
  if (options.publishToOnlineStore) g.push("publish");
  if (rollback) g.push("rollback");
  if (rollback === "delete") g.push("delete");
  return g;
}

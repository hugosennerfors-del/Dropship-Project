// Is a brand name free as a domain? For each name, a few domains for the
// market are looked up: first in DNS (a registered domain almost always has
// name servers), then, when DNS has nothing and the registry is listed in
// IANA's RDAP bootstrap, in the registry itself (404 = not registered).
// Results say how sure they are; only a registrar can sell the domain.
//
// `fetch` is injected: the edge function passes the real one, tests a fake.

export const TLDS = { SE: ["se", "com", "nu", "shop"], UK: ["co.uk", "com", "uk", "shop"] };
export const DOH = "https://dns.google/resolve";
export const RDAP_BOOTSTRAP = "https://data.iana.org/rdap/dns.json";

// The domain label for a name: a\u2013z, 0\u20139 and hyphens; \u00e5, \u00e4, \u00f6 fold to a, a, o.
export function domainLabel(name) {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63).replace(/-+$/, "");
}

export function domainCandidates(name, market = "UK") {
  const label = domainLabel(name);
  if (!label) return [];
  const nohyphen = label.replace(/-/g, "");
  const labels = nohyphen !== label && nohyphen.length >= 3 ? [nohyphen, label] : [label];
  return labels.flatMap((l) => (TLDS[market] || TLDS.UK).map((t) => `${l}.${t}`)).slice(0, 8);
}

// TLD \u2192 RDAP base URL, from IANA's bootstrap file.
export async function loadBootstrap(fetchImpl) {
  try {
    const r = await fetchImpl(RDAP_BOOTSTRAP, { headers: { accept: "application/json" } });
    if (!r.ok) return {};
    const j = await r.json();
    const map = {};
    for (const [tlds, urls] of j.services || []) for (const t of tlds) if (urls?.[0]) map[t] = urls[0].endsWith("/") ? urls[0] : urls[0] + "/";
    return map;
  } catch { return {}; }
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

// One domain: { domain, status: "taken" | "free" | "probably free" | "unknown", via, note }.
export async function checkDomain(domain, { fetch: fetchImpl, bootstrap = {}, timeoutMs = 8000 }) {
  let dns = null;
  try {
    const r = await withTimeout(fetchImpl(`${DOH}?name=${encodeURIComponent(domain)}&type=NS`, { headers: { accept: "application/dns-json" } }), timeoutMs);
    if (r.ok) dns = await r.json();
  } catch { dns = null; }
  if (dns && dns.Status === 0 && (dns.Answer || []).length) return { domain, status: "taken", via: "dns" };
  const tld = domain.split(".").slice(1).join(".");
  const base = bootstrap[tld] || bootstrap[domain.split(".").pop()];
  if (base && (!dns || dns.Status === 3 || dns.Status === 0)) {
    try {
      const r = await withTimeout(fetchImpl(`${base}domain/${encodeURIComponent(domain)}`, { headers: { accept: "application/rdap+json" } }), timeoutMs);
      if (r.status === 404) return { domain, status: "free", via: "rdap", note: "Not registered at the registry." };
      if (r.ok) return { domain, status: "taken", via: "rdap", note: "Registered, without name servers." };
    } catch { /* fall back to DNS */ }
  }
  if (dns && dns.Status === 3) return { domain, status: "probably free", via: "dns", note: "No such domain in DNS; check at a registrar before you rely on it." };
  return { domain, status: "unknown", via: dns ? "dns" : "none", note: "No clear answer; check at a registrar." };
}

// Every name: { [name]: [domain results] }.
export async function checkNames(names, market, { fetch: fetchImpl, concurrency = 4 } = {}) {
  const bootstrap = await loadBootstrap(fetchImpl);
  const out = {};
  for (const name of names) {
    const domains = domainCandidates(name, market);
    const res = [];
    for (let i = 0; i < domains.length; i += concurrency) res.push(...await Promise.all(domains.slice(i, i + concurrency).map((d) => checkDomain(d, { fetch: fetchImpl, bootstrap }))));
    out[name] = res;
  }
  return out;
}

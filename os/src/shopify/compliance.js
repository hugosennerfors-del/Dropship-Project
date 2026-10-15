// Checks before a brand is sold to consumers: the seller's details, the
// right of withdrawal, delivery information and product safety rules that
// depend on what is sold. It is a checklist, not legal advice: the page can
// see what is filled in, and asks the owner to confirm what it cannot see
// (a supplier's declaration of conformity, a registration).
//
// Store details live in concept.business; confirmations in
// concept.compliance.attested[id] = { at, products: [handles covered] }.

const t = (x) => String(x ?? "").trim();
const ORG_SE = /^(\d{6}|\d{8})-?\d{4}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Product groups with their own rules, found from words in the title,
// type and tags. A match asks for a confirmation; it never guesses a pass.
export const GROUPS = {
  // `word`: short English words, matched as whole words; `part`: words that
  // also appear inside compounds (Swedish "skrivbordslampa", "ansiktsserum").
  electrical: { word: /\b(led|usb|rgb|fan|plug|cable|adapter|electric|electrical|charger|speaker|heater|projector|bluetooth)s?\b/i, part: /(lamp|belysning|laddare|batteri|battery|elektrisk|högtalare|värmare|projektor|fläkt|power ?bank|kabel|sladd|ring ?light)/i },
  battery: { word: /\b(rechargeable|li-ion)\b/i, part: /(batter|power ?bank|lithium|litium|uppladdningsbar)/i },
  toys: { word: /\b(toys?|kids|baby|children|plush)\b/i, part: /(leksak|barn|bebis|gosedjur|baby)/i },
  cosmetics: { word: /\b(cream|lotion|cosmetics?|skincare|shampoo|balm|perfume|makeup)\b/i, part: /(serum|kräm|kosmetik|hudvård|schampo|balsam|parfym|smink|ansiktsolja)/i },
};

export function productGroups(p) {
  const text = [p?.title, p?.productType, ...(p?.tags || [])].map(t).join(" ");
  return Object.keys(GROUPS).filter((g) => GROUPS[g].word.test(text) || GROUPS[g].part.test(text));
}

// Missing store details, as field names.
export function businessGaps(b = {}, market = "SE") {
  const gaps = [];
  if (!t(b.legalName)) gaps.push("legalName");
  if (!t(b.orgNumber)) gaps.push("orgNumber");
  else if (market === "SE" && !ORG_SE.test(t(b.orgNumber))) gaps.push("orgNumber:format");
  if (!t(b.address)) gaps.push("address");
  if (!EMAIL.test(t(b.email))) gaps.push("email");
  return gaps;
}

const attested = (c, id, handles = null) => {
  const a = c?.compliance?.attested?.[id];
  if (!a?.at) return false;
  if (!handles) return true;
  return handles.every((h) => (a.products || []).includes(h));
};

// The checklist for a concept. Each item: id, title, why, source, status
// ("ok", "missing" or "confirm"), and the products it concerns.
export function complianceChecks(c) {
  const market = c?.market === "SE" ? "SE" : "UK";
  const b = c?.business || {};
  const items = [];
  const add = (it) => items.push({ required: true, products: [], ...it });
  const gaps = businessGaps(b, market);
  add({
    id: "business", title: market === "SE" ? "Company name, organisation number, address and email on the site" : "Business name, registration number, address and email on the site",
    why: "Online shops must show who the seller is and how to reach them.",
    source: market === "SE" ? "Lag (2002:562) om elektronisk handel, 8 §" : "Electronic Commerce (EC Directive) Regulations 2002, reg. 6",
    status: gaps.length ? "missing" : "ok", detail: gaps.length ? `Missing: ${gaps.map((g) => ({ legalName: "company name", orgNumber: "organisation number", "orgNumber:format": "organisation number in the form 556677-8899", address: "address", email: "email" }[g])).join(", ")}.` : "",
  });
  add({ id: "vat", title: "Prices include VAT", why: "Consumers must see the total price.", source: market === "SE" ? "Prisinformationslagen (2004:347)" : "Price Marking Order 2004", status: "ok", detail: "The Brand Builder's prices always include VAT." });
  const days = Number(b.returns?.days);
  add({
    id: "withdrawal", title: market === "SE" ? "14 days' right of withdrawal (ångerrätt), stated in the returns policy" : "14-day cancellation right, stated in the returns policy",
    why: "Consumers may cancel a distance purchase within 14 days of receiving the goods.",
    source: market === "SE" ? "Lag (2005:59) om distansavtal och avtal utanför affärslokaler, 2 kap." : "Consumer Contracts Regulations 2013, reg. 29–30",
    status: !(days >= 14) ? "missing" : c?.policies?.returns || attested(c, "withdrawal") ? "ok" : "confirm",
    detail: !(days >= 14) ? "Set the return period to at least 14 days under Store details." : c?.policies?.returns ? "" : "Write the policy pages here, or confirm that your store's own returns policy states it.",
  });
  const maxDays = Number(b.shipping?.maxDays);
  add({ id: "delivery", title: "Delivery time and cost stated", why: "Consumers must be told when the goods arrive and what delivery costs before they buy.", source: market === "SE" ? "Lag (2005:59), 2 kap. 2 §" : "Consumer Contracts Regulations 2013, sch. 2", status: maxDays > 0 ? "ok" : "missing", detail: maxDays > 0 ? "" : "Set the delivery time under Store details." });
  if (market === "SE") {
    add({ id: "complaints", title: "Three years to complain about faults (reklamation)", why: "A consumer may complain about a fault for three years; the terms must not say less.", source: "Konsumentköplagen (2022:260)", status: c?.policies?.terms || attested(c, "complaints") ? "ok" : "confirm", detail: c?.policies?.terms ? "" : "Write the policy pages here, or confirm that your store's own terms state it." });
    const euRep = b.euResponsible || {};
    const repOk = t(euRep.name) && t(euRep.address) && EMAIL.test(t(euRep.email));
    const handles = (c?.products || []).map((p) => p.handle).filter(Boolean);
    add({
      id: "gpsr", title: "Product safety (GPSR): manufacturer or EU responsible person shown for each product",
      why: "Each product offered online in the EU must show the manufacturer's name and postal and electronic address, an EU-based responsible person when the manufacturer is outside the EU, what the product is (picture and type), and warnings or safety information in Swedish.",
      source: "Regulation (EU) 2023/988 (GPSR), art. 19, in force since 13 December 2024",
      status: !repOk ? "missing" : attested(c, "gpsr", handles) ? "ok" : "confirm",
      detail: !repOk ? "Fill in the EU responsible person under Store details." : "Confirm you have each product's manufacturer details and safety information from the supplier.",
      products: handles,
    });
  }
  const byGroup = (g) => (c?.products || []).filter((p) => productGroups(p).includes(g));
  const groupItem = (g, id, title, why, source) => {
    const ps = byGroup(g);
    if (!ps.length) return;
    const handles = ps.map((p) => p.handle).filter(Boolean);
    add({ id, title, why, source, status: attested(c, id, handles) ? "ok" : "confirm", detail: `Concerns: ${ps.map((p) => p.title).join(", ")}.`, products: handles });
  };
  if (market === "SE") {
    groupItem("electrical", "ce", "CE marking and the supplier's EU declaration of conformity", "Electrical products need CE marking under the low-voltage, EMC and RoHS directives; get the declaration of conformity from the supplier and keep it.", "Directives 2014/35/EU, 2014/30/EU, 2011/65/EU");
    groupItem("electrical", "weee", "Producer responsibility for electrical products", "Whoever first sells electrical products in Sweden must be registered with Naturvårdsverket and part of a collection scheme.", "Förordning (2022:1276) om producentansvar för elutrustning");
    groupItem("battery", "batteries", "Producer responsibility for batteries", "Products with batteries bring producer responsibility for the batteries as well.", "Regulation (EU) 2023/1542 on batteries");
    groupItem("toys", "toys", "Toy safety: CE marking and warnings", "Toys must be CE marked, with warnings and age limits in Swedish.", "Directive 2009/48/EC");
    groupItem("cosmetics", "cosmetics", "Cosmetics: responsible person and CPNP notification", "Cosmetics need an EU responsible person, a safety assessment and notification in the EU portal CPNP before sale.", "Regulation (EC) 1223/2009");
  } else {
    groupItem("electrical", "ce", "UKCA or CE marking for electrical products", "Electrical products sold in Great Britain need conformity marking and the supplier's declaration.", "Electrical Equipment (Safety) Regulations 2016");
  }
  const blocking = items.filter((i) => i.required && i.status !== "ok");
  return { market, items, blocking, done: !blocking.length };
}

// Confirm an item for the products it lists today.
export function attest(c, id, products = []) {
  return { ...c, compliance: { ...(c.compliance || {}), attested: { ...(c.compliance?.attested || {}), [id]: { at: new Date().toISOString(), products } } } };
}

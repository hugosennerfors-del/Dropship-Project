// Brand Builder dialogs shared by the Brand Builder view and the Shopify
// settings: page preview, content editor, publish dialog (with dry run),
// job status drawer with history, and undo. Each opens over the page and
// keeps its own small state; nothing here talks to Shopify directly.

import { store, onChange } from "../state.js";
import { esc, attr, icon, money, dateLabel } from "../ui/dom.js";
import { validateConcept, sanitizeHtml, toHtml, SECTION_TYPES, PALETTE_ROLES, LIMITS } from "../shopify/concept.js";
import { buildPlan, DEFAULT_OPTIONS } from "../shopify/mapping.js";
import { SCOPES, scopeFix } from "../shopify/documents.js";
import { conceptEconomics, econSettings, orderEconomics } from "../shopify/economics.js";
import {
  brandById, connectionById, jobById, isLive, storeBadge, saveBrand, startPublish, retryJob, rollbackJob, loadJob, loadShopify,
  undoPlan, newIdempotencyKey, recheckConnection, TERMINAL, IMAGE_PROVIDERS,
} from "../shopify/brands.js";

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONT = /^[A-Za-z0-9 ]{2,40}$/;
const toast = (m) => window.__toast?.(m);
let uid = 0;

// -- Brand look ------------------------------------------------------------
export function paletteOf(c) {
  const by = (r) => (c?.identity?.palette || []).find((p) => p.role === r)?.hex;
  const ok = (h) => (HEX.test(h || "") ? h : null);
  return {
    primary: ok(by("primary")) || "#4f46e5", secondary: ok(by("secondary")) || ok(by("accent")) || "#818cf8",
    accent: ok(by("accent")) || ok(by("secondary")) || "#e879f9", bg: ok(by("bg")) || "#fafafa", fg: ok(by("fg")) || "#1f2933",
  };
}
export function fontsOf(c) {
  const t = c?.identity?.typography || {};
  return { head: FONT.test(t.headingFont || "") ? t.headingFont : null, body: FONT.test(t.bodyFont || "") ? t.bodyFont : null };
}
// CSS variables for a brand; every value is checked before it is used.
export function brandVars(c) {
  const p = paletteOf(c), f = fontsOf(c);
  return `--b-primary:${p.primary};--b-secondary:${p.secondary};--b-accent:${p.accent};--b-bg:${p.bg};--b-fg:${p.fg};`
    + `--b-head:${f.head ? `'${f.head}',` : ""}var(--font-sans);--b-body:${f.body ? `'${f.body}',` : ""}var(--font-sans);`;
}

// Google Fonts are loaded on demand for the preview (family names are
// validated, so they are safe in the URL).
const loadedFonts = new Set();
export function loadFonts(c) {
  const f = fontsOf(c);
  for (const fam of [f.head, f.body]) {
    if (!fam || loadedFonts.has(fam)) continue;
    loadedFonts.add(fam);
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, "+")}&display=swap`;
    document.head.appendChild(l);
  }
}

// The placeholder image provider: an abstract picture in the brand's
// colours. Shown in the preview only.
export function placeholderSvg(c, seed = 0, label = "Placeholder image") {
  const p = paletteOf(c);
  const id = `bbg${++uid}`;
  const a = (seed * 47) % 360;
  return `<svg class="bb-ph" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${attr(label)}"><defs><linearGradient id="${id}" gradientTransform="rotate(${a} .5 .5)"><stop offset="0" stop-color="${p.primary}"/><stop offset="1" stop-color="${p.secondary}"/></linearGradient></defs><rect width="400" height="400" fill="url(#${id})"/><circle cx="${110 + ((seed * 53) % 170)}" cy="${130 + ((seed * 31) % 130)}" r="${70 + ((seed * 17) % 60)}" fill="${p.accent}" opacity=".55"/><rect x="40" y="310" width="${110 + ((seed * 29) % 150)}" height="14" rx="7" fill="${p.bg}" opacity=".75"/></svg>`;
}

function lum(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const currencyOf = (c) => c?.currency || (c?.market === "SE" ? "SEK" : "GBP");
const price = (c, x) => money(Number(x), currencyOf(c));
const firstPrice = (p) => p?.variants?.[0]?.price;

// -- Modal helper ------------------------------------------------------------
function openModal({ cls = "", label, render, mount, onClose }) {
  const prev = document.activeElement;
  const ov = document.createElement("div");
  ov.className = "overlay bb-ov";
  ov.innerHTML = `<div class="bb-modal ${cls}" role="dialog" aria-modal="true" aria-label="${attr(label)}" tabindex="-1"></div>`;
  const box = ov.firstElementChild;
  document.body.appendChild(ov);
  let cleanup = null;
  const paint = () => {
    const focusKey = document.activeElement && box.contains(document.activeElement) ? document.activeElement.getAttribute("data-k") : null;
    const top = box.scrollTop;
    box.innerHTML = render();
    box.scrollTop = top;
    if (focusKey) {
      const el = box.querySelector(`[data-k="${CSS.escape(focusKey)}"]`);
      el?.focus();
      if (el && el.tagName === "INPUT" && el.type === "text") { try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* not text */ } }
    }
  };
  const close = () => {
    ov.remove();
    document.removeEventListener("keydown", onKey, true);
    cleanup?.();
    onClose?.();
    prev?.focus?.();
  };
  const onKey = (e) => { if (e.key === "Escape" && document.body.lastElementChild === ov) { e.preventDefault(); close(); } };
  document.addEventListener("keydown", onKey, true);
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
  paint();
  const m = mount?.(box, { paint, close });
  cleanup = typeof m === "function" ? m : null;
  (box.querySelector("[autofocus]") || box).focus();
  return { close, paint, box };
}

// -- Preview -------------------------------------------------------------------
// Our own rendering of the page plan with the brand's colours and fonts:
// a decision aid before publishing, not the Shopify theme.
export function openPreview(concept) {
  const ui = { mode: "desktop", product: null };
  loadFonts(concept);
  const p = paletteOf(concept);
  const ratio = contrast(p.fg, p.bg);
  return openModal({
    cls: "bb-preview", label: `Preview of ${concept.name}`,
    render: () => `
      <div class="bb-ptool">
        <div class="row"><b>${esc(concept.name)}</b><span class="xs muted">Preview: our rendering of the page plan, not your Shopify theme</span></div>
        <div class="row">
          ${ratio < 4.5 ? `<span class="tag bb-warn" data-tip="Text colour on background: ${ratio.toFixed(1)}:1. WCAG asks for 4.5:1.">${icon("warn", 12)}Low contrast ${ratio.toFixed(1)}:1</span>` : ""}
          <div class="seg" role="group" aria-label="Screen size">
            <button data-pv-mode="desktop" aria-pressed="${ui.mode === "desktop"}">Desktop</button>
            <button data-pv-mode="mobile" aria-pressed="${ui.mode === "mobile"}">Mobile</button>
          </div>
          <button class="btn sm" data-close autofocus>${icon("x", 13)}Close</button>
        </div>
      </div>
      <div class="bb-stage"><div class="bb-frame ${ui.mode}" style="${brandVars(concept)}">${pageHtml(concept, ui)}</div></div>`,
    mount: (box, { paint, close }) => {
      box.addEventListener("click", (e) => {
        const t = e.target;
        if (t.closest("[data-close]")) return close();
        const m = t.closest("[data-pv-mode]");
        if (m) { ui.mode = m.dataset.pvMode; ui.product = null; return paint(); }
        const pr = t.closest("[data-pv-product]");
        if (pr) { ui.product = Number(pr.dataset.pvProduct); paint(); box.querySelector(".bb-frame")?.scrollTo?.(0, 0); return; }
        if (t.closest("[data-pv-back]")) { ui.product = null; return paint(); }
        if (t.closest(".bb-site a, .bb-site button")) e.preventDefault();
      });
    },
  });
}

function pageHtml(c, ui) {
  const head = `<header class="bb-s-head"><span class="bb-logo"><i>${esc((c.name || "?").slice(0, 1).toUpperCase())}</i>${esc(c.name)}</span>
    <nav><a href="#">Shop</a><a href="#">About</a><a href="#">FAQ</a></nav><span class="bb-cart">${icon("box", 16)}</span></header>`;
  const foot = `<footer class="bb-s-foot"><div><b>${esc(c.name)}</b><p>${esc(c.story?.mission || "")}</p></div><div class="xs">© ${new Date().getFullYear()} ${esc(c.name)} · Preview made by Plan-vy</div></footer>`;
  if (ui.product != null && c.products?.[ui.product]) return `<div class="bb-site">${head}${productPage(c, ui.product)}${foot}</div>`;
  const sections = (c.pagePlan?.sections || []).map((s, i) => sectionHtml(c, s, i)).join("");
  return `<div class="bb-site">${head}${sections}${foot}</div>`;
}

function sectionHtml(c, s, i) {
  const h = s.headline ? `<h2>${esc(s.headline)}</h2>` : "";
  const body = s.body ? `<div class="bb-rt">${toHtml(s.body)}</div>` : "";
  const items = s.items?.length ? s.items : null;
  switch (s.type) {
    case "hero": return `<section class="bb-s bb-hero"><div><h1>${esc(s.headline || c.tagline)}</h1>${body || `<p>${esc(c.tagline)}</p>`}<a class="bb-cta" href="#">Shop ${esc(c.name)}</a></div><div class="bb-img">${placeholderSvg(c, i + 1, "Hero image (placeholder)")}</div></section>`;
    case "featured-collection": return `<section class="bb-s">${h || `<h2>${esc(c.name)}</h2>`}${body}<div class="bb-grid">${(c.products || []).map((p, j) => `<button class="bb-pcard" data-pv-product="${j}"><span class="bb-img">${placeholderSvg(c, j + 10, p.title)}</span><b>${esc(p.title)}</b><span>${price(c, firstPrice(p))}${p.variants?.[0]?.compareAtPrice ? ` <s>${price(c, p.variants[0].compareAtPrice)}</s>` : ""}</span></button>`).join("")}</div></section>`;
    case "image-with-text": return `<section class="bb-s bb-split"><div class="bb-img">${placeholderSvg(c, i + 20, "Image (placeholder)")}</div><div>${h}${body}</div></section>`;
    case "usp-columns": return `<section class="bb-s">${h}${body}<div class="bb-cols">${(items || (c.story?.usps || []).map((u) => ({ title: u, body: "" }))).map((it) => `<div><i></i><b>${esc(it.title)}</b>${it.body ? `<p>${esc(it.body)}</p>` : ""}</div>`).join("")}</div></section>`;
    case "faq": return `<section class="bb-s">${h}${body}<div class="bb-faq">${(items || []).map((it) => `<details><summary>${esc(it.title)}</summary><div class="bb-rt">${toHtml(it.body)}</div></details>`).join("")}</div></section>`;
    case "testimonials": return `<section class="bb-s"><div class="bb-note">${icon("info", 14)}<span><b>${esc(s.headline || "Testimonials")}</b>: not published. Reviews must be real customer quotes; add them in Shopify when you have them.</span></div></section>`;
    case "newsletter": return `<section class="bb-s bb-news">${h || "<h2>Stay in the loop</h2>"}${body}<div class="bb-nl"><input type="text" placeholder="Email address" disabled aria-label="Email address (preview)"><button disabled>Sign up</button></div></section>`;
    default: return `<section class="bb-s">${h}${body}</section>`;
  }
}

function productPage(c, i) {
  const p = c.products[i];
  const v = p.variants?.[0] || {};
  return `<section class="bb-s bb-pdp"><button class="bb-back" data-pv-back>${icon("back", 14)} All products</button>
    <div class="bb-split"><div class="bb-img">${placeholderSvg(c, i + 10, p.title)}</div><div>
      <h1>${esc(p.title)}</h1><p class="bb-price">${price(c, v.price)}${v.compareAtPrice ? ` <s>${price(c, v.compareAtPrice)}</s>` : ""}</p>
      ${(p.options || []).map((o) => `<label class="bb-opt"><span>${esc(o.name)}</span><select disabled>${o.values.map((x) => `<option>${esc(x)}</option>`).join("")}</select></label>`).join("")}
      <button class="bb-cta" disabled>Add to cart</button>
      <div class="bb-rt">${sanitizeHtml(toHtml(p.description))}</div>
      ${p.bulletPoints?.length ? `<ul>${p.bulletPoints.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
      ${p.images?.length ? `<p class="xs">${p.images.length} image link${p.images.length === 1 ? "" : "s"} will be sent to Shopify (not shown in the preview).</p>` : ""}
    </div></div></section>`;
}

// -- Profit per order ------------------------------------------------------------
// The table under "Profit per order" in the editor, and the short summary
// in the publish dialog. Figures come from economics.js.
export function econHtml(c) {
  const all = conceptEconomics(c);
  const e = all.settings, cur = currencyOf(c);
  const m = (x) => (x === null || x === undefined ? "—" : money(x, cur));
  const notes = [];
  if (all.problems.length) return `<div class="callout bad">${icon("warn", 16)}<ul class="bullets small">${all.problems.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  if (e.shipping === null) notes.push("Shipping per order is not set, so it counts as 0.");
  if (e.adCost === null) notes.push("Add your expected ad cost per order to see the profit; until then the table shows how much an ad may cost before an order loses money.");
  if (e.assumed.length) notes.push(`Assumed until you set them: ${e.assumed.map((k) => ({ feePct: `payment fee ${e.feePct}%`, feeFixed: `fixed fee ${m(e.feeFixed)}`, returnPct: `${e.returnPct}% returns` }[k])).join(", ")}.`);
  const losing = all.losing.length ? `<div class="callout bad">${icon("warn", 16)}<span><b>${all.losing.length} product${all.losing.length === 1 ? " loses" : "s lose"} money${e.adCost === null ? " before any ads" : ` at ${m(e.adCost)} in ads per order`}:</b> ${esc(all.losing.join(", "))}. Raise the price, lower the cost, or spend less per order.</span></div>` : "";
  return `${losing}${notes.length ? `<ul class="bullets xs muted">${notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <div class="tbl-wrap"><table class="tbl bb-et"><thead><tr><th>Product</th><th class="r">Price</th><th class="r">Before ads</th><th class="r" data-tip="The most an ad may cost per order before the order loses money">Max ad cost</th><th class="r">Profit at your ad cost</th><th class="r" data-tip="Order value (incl. VAT) per unit of ad spend at which you break even">Break-even ROAS</th><th class="r">Price to break even</th><th class="r">Price for ${esc(String(e.targetPct))}% margin</th></tr></thead><tbody>
    ${all.rows.map((r) => r.econ ? `<tr><td>${esc(r.title)}</td><td class="r metric">${m(r.econ.price)}</td><td class="r metric${r.econ.contribution < 0 ? " bb-neg" : ""}">${m(r.econ.contribution)}</td><td class="r metric">${r.econ.breakEvenCpa > 0 ? m(r.econ.breakEvenCpa) : "—"}</td>
        <td class="r metric${(r.econ.profit ?? 0) < 0 ? " bb-neg" : ""}">${r.econ.profit === null ? "—" : `${m(r.econ.profit)} <small class="muted">${r.econ.marginPct}%</small>`}</td><td class="r metric">${r.econ.breakEvenRoas ?? "—"}</td>
        <td class="r metric">${r.econ.breakEvenPrice === null ? "not possible" : m(r.econ.breakEvenPrice)}</td><td class="r metric">${r.econ.targetPrice === null ? "not possible" : m(r.econ.targetPrice)}</td></tr>`
      : `<tr><td>${esc(r.title)}</td><td class="r metric">${r.price === null ? "—" : m(r.price)}</td><td colspan="6" class="xs muted">Add a landed cost per unit (under Products) to see the figures.</td></tr>`).join("")}
    </tbody></table></div>`;
}

// -- Editor --------------------------------------------------------------------
// Every generated field can be changed before publishing; saving validates
// the whole concept and stores it as the brand's next version.
const BLANK_PRODUCT = () => ({ title: "New product", description: "", bulletPoints: [], productType: "", tags: [], options: [], variants: [{ optionValues: [], price: "10.00", sku: `SKU-${Math.random().toString(36).slice(2, 7).toUpperCase()}` }], imagePrompts: [], images: [], seo: { title: "", description: "" } });

function getPath(o, path) { return path.split(".").reduce((x, k) => (x == null ? x : x[k]), o); }
function setPath(o, path, v) {
  const ks = path.split(".");
  let x = o;
  for (let i = 0; i < ks.length - 1; i++) { const k = ks[i]; if (x[k] == null) x[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; x = x[k]; }
  x[ks.at(-1)] = v;
}

export function openEditor(brand, { onSaved } = {}) {
  const w = structuredClone(brand.concept);
  w.products ||= []; w.pagePlan ||= { sections: [] }; w.identity ||= { palette: [], typography: {} }; w.story ||= { usps: [] }; w.seo ||= { keywords: [] };
  const ui = { errors: [], busy: false, open: { identity: true } };
  const market = w.market === "SE" ? "SE" : "UK";
  const vat = market === "SE" ? 0.25 : 0.2;

  const inp = (path, label, { type = "text", rows, hint, mono, list, ph } = {}) => {
    const raw = getPath(w, path);
    const val = list === "lines" ? (raw || []).join("\n") : list === "csv" ? (raw || []).join(", ") : raw ?? "";
    const attrs = `data-path="${attr(path)}" data-k="${attr(path)}"${list ? ` data-list="${list}"` : ""}${type === "int" ? ' data-int="1"' : ""}`;
    const field = rows ? `<textarea ${attrs} rows="${rows}">${esc(val)}</textarea>`
      : `<input type="${type === "int" ? "number" : "text"}" ${attrs} value="${attr(val)}"${mono ? ' class="mono"' : ""}${ph != null ? ` placeholder="${attr(ph)}"` : ""}>`;
    return `<label class="field"><span>${esc(label)}${hint ? `<small class="xs muted">${esc(hint)}</small>` : ""}</span>${field}</label>`;
  };
  const sec = (key, title, body) => `<details class="bb-ed-sec" data-sec="${key}"${ui.open[key] ? " open" : ""}><summary>${esc(title)}</summary><div class="bb-ed-b">${body}</div></details>`;

  const render = () => {
    const pal = w.identity.palette || [];
    return `
      <div class="bb-mhead"><div><div class="eyebrow">${icon("wand", 13)} Edit content · ${esc(brand.id)} v${brand.version}</div><h2>${esc(w.name || "Brand")}</h2></div>
        <button class="btn sm ghost" data-close aria-label="Close">${icon("x", 14)}</button></div>
      <div class="bb-mbody stack">
        ${ui.errors.length ? `<div class="callout bad">${icon("warn", 16)}<div><b>Not saved. Fix these first:</b><ul class="bullets small">${ui.errors.slice(0, 30).map((e) => `<li>${esc(friendlyError(e, w))}</li>`).join("")}</ul></div></div>` : ""}
        ${sec("identity", "Name, positioning and look", `<div class="grid g2">
            ${inp("name", "Brand name")}${inp("handle", "URL handle", { hint: "letters, digits, hyphens", mono: true })}
            ${inp("tagline", "Tagline", { hint: "max 60 characters" })}${inp("toneOfVoice.adjectives", "Tone of voice", { list: "csv", hint: "comma separated" })}
          </div>
          ${inp("positioning", "Positioning", { rows: 3 })}${inp("targetAudience.summary", "Target audience", { rows: 2 })}
          <div class="field"><span>Palette</span><div class="bb-pal-ed">${pal.map((x, i) => `<div class="bb-pal-row">
              <input type="color" data-path="identity.palette.${i}.hex" data-k="pc${i}" value="${attr(HEX.test(x.hex || "") ? x.hex : "#000000")}" aria-label="Colour">
              <input type="text" class="mono" data-path="identity.palette.${i}.hex" data-k="ph${i}" value="${attr(x.hex || "")}" aria-label="Hex">
              <select data-path="identity.palette.${i}.role" data-k="pr${i}" aria-label="Role">${PALETTE_ROLES.map((r) => `<option${x.role === r ? " selected" : ""}>${r}</option>`).join("")}</select>
              <input type="text" data-path="identity.palette.${i}.name" data-k="pn${i}" value="${attr(x.name || "")}" aria-label="Colour name">
              <button class="btn sm ghost" data-ed="rm-color" data-i="${i}" aria-label="Remove colour">${icon("x", 12)}</button></div>`).join("")}
            ${pal.length < 8 ? `<button class="btn sm" data-ed="add-color">${icon("plus", 12)}Colour</button>` : ""}</div></div>
          <div class="grid g2">${inp("identity.typography.headingFont", "Heading font", { hint: "Google Fonts name" })}${inp("identity.typography.bodyFont", "Body font", { hint: "Google Fonts name" })}</div>
          ${inp("identity.logoBrief", "Logo brief", { rows: 2 })}${inp("identity.imageryDirection", "Imagery direction", { rows: 2 })}`)}
        ${sec("story", "Story and USPs", `${inp("story.about", "About the brand", { rows: 4 })}${inp("story.mission", "Mission")}${inp("story.usps", "USPs (3–5, one per line)", { rows: 4, list: "lines" })}`)}
        ${sec("products", `Products (${w.products.length})`, `${w.products.map((p, i) => productEditor(p, i)).join("")}
          ${w.products.length < LIMITS.products ? `<button class="btn sm" data-ed="add-product">${icon("plus", 12)}Product</button>` : ""}`)}
        ${sec("econ", "Profit per order", `<p class="xs muted">Per order of one item: price after VAT, minus landed cost, shipping, payment fee and returns, then your ad cost per order. Saved with the brand.</p>
          <div class="grid g3">${inp("economics.shipping", "Shipping per order", { mono: true, hint: `${currencyOf(w)}, what you pay`, ph: "not set" })}${inp("economics.adCost", "Ad cost per order", { mono: true, hint: `${currencyOf(w)}, expected cost per purchase`, ph: "not set" })}${inp("economics.targetPct", "Target margin %", { mono: true, hint: "of net revenue", ph: econSettings(w).targetPct })}
            ${inp("economics.returnPct", "Returns %", { mono: true, hint: "orders refunded", ph: `${econSettings(w).returnPct} (assumed)` })}${inp("economics.feePct", "Payment fee %", { mono: true, hint: "your plan's rate", ph: `${econSettings(w).feePct} (assumed)` })}${inp("economics.feeFixed", "Fixed fee per order", { mono: true, hint: currencyOf(w), ph: `${econSettings(w).feeFixed} (assumed)` })}</div>
          <div class="bb-econ" data-econ>${econHtml(w)}</div>`)}
        ${sec("page", `Page plan (${w.pagePlan.sections.length} sections)`, `${w.pagePlan.sections.map((s, i) => `<div class="bb-ed-card">
            <div class="row between"><select data-path="pagePlan.sections.${i}.type" data-k="st${i}" aria-label="Section type">${SECTION_TYPES.map((t) => `<option${s.type === t ? " selected" : ""}>${t}</option>`).join("")}</select>
              <span class="row"><button class="btn sm ghost" data-ed="up" data-i="${i}" aria-label="Move up"${i ? "" : " disabled"}>↑</button><button class="btn sm ghost" data-ed="down" data-i="${i}" aria-label="Move down"${i < w.pagePlan.sections.length - 1 ? "" : " disabled"}>↓</button><button class="btn sm ghost" data-ed="rm-section" data-i="${i}" aria-label="Remove section">${icon("x", 12)}</button></span></div>
            ${inp(`pagePlan.sections.${i}.headline`, "Headline")}${inp(`pagePlan.sections.${i}.body`, "Text", { rows: 3 })}
            ${["usp-columns", "faq"].includes(s.type) ? `<label class="field"><span>Items <small class="xs muted">one per line: title | text</small></span><textarea data-items="${i}" data-k="si${i}" rows="4">${esc((s.items || []).map((it) => `${it.title} | ${it.body}`).join("\n"))}</textarea></label>` : ""}
          </div>`).join("")}
          ${w.pagePlan.sections.length < LIMITS.sections ? `<button class="btn sm" data-ed="add-section">${icon("plus", 12)}Section</button>` : ""}`)}
        ${sec("seo", "SEO", `${inp("seo.title", "Page title", { hint: "max 70" })}${inp("seo.description", "Meta description", { rows: 2, hint: "max 320" })}${inp("seo.keywords", "Keywords", { list: "csv" })}`)}
        ${sec("legal", `Checks before publishing (${(w.legalFlags || []).length})`, `${inp("legalFlags", "One per line (not legal advice: what to check)", { rows: 4, list: "lines" })}`)}
      </div>
      <div class="bb-mfoot"><span class="xs muted">Saving validates everything and stores version ${brand.version + 1}; earlier versions are kept.</span>
        <div class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" data-ed="save"${ui.busy ? " disabled" : ""}>${ui.busy ? "Saving…" : "Save as new version"}</button></div></div>`;
  };

  function productEditor(p, i) {
    const opts = p.options || [];
    return `<div class="bb-ed-card">
      <div class="row between"><b>${esc(p.title || `Product ${i + 1}`)}</b><button class="btn sm ghost" data-ed="rm-product" data-i="${i}" aria-label="Remove product">${icon("x", 12)}Remove</button></div>
      <div class="grid g2">${inp(`products.${i}.title`, "Title")}${inp(`products.${i}.productType`, "Product type")}</div>
      ${inp(`products.${i}.description`, "Description (80–150 words)", { rows: 4 })}
      <div class="grid g2">${inp(`products.${i}.bulletPoints`, "Bullet points (one per line)", { rows: 3, list: "lines" })}${inp(`products.${i}.tags`, "Tags", { list: "csv", hint: "comma separated" })}</div>
      <div class="field"><span>Options <small class="xs muted">name and values, e.g. Size: S, M, L</small></span>
        <textarea data-options="${i}" data-k="po${i}" rows="${Math.max(1, opts.length)}" placeholder="Size: S, M, L">${esc(opts.map((o) => `${o.name}: ${o.values.join(", ")}`).join("\n"))}</textarea>
        <button class="btn sm" data-ed="rebuild" data-i="${i}">Rebuild variants from options</button></div>
      <div class="tbl-wrap"><table class="tbl bb-vt"><thead><tr><th>Variant</th><th>Price</th><th>Compare at</th><th>SKU</th><th>Weight g</th><th class="r">Margin</th></tr></thead><tbody>
        ${(p.variants || []).map((v, j) => {
          const mg = p.costEstimate ? orderEconomics({ price: v.price, cost: p.costEstimate, settings: econSettings(w) }) : null;
          const pct = mg ? (mg.marginPct ?? (mg.net > 0 ? Math.round((mg.contribution / mg.net) * 1000) / 10 : null)) : null;
          return `<tr><td>${esc((v.optionValues || []).join(" / ") || "Default")}</td>
            <td><input type="text" class="mono" data-path="products.${i}.variants.${j}.price" data-k="vp${i}-${j}" value="${attr(v.price ?? "")}" aria-label="Price"></td>
            <td><input type="text" class="mono" data-path="products.${i}.variants.${j}.compareAtPrice" data-k="vc${i}-${j}" value="${attr(v.compareAtPrice ?? "")}" aria-label="Compare-at price"></td>
            <td><input type="text" class="mono" data-path="products.${i}.variants.${j}.sku" data-k="vs${i}-${j}" value="${attr(v.sku ?? "")}" aria-label="SKU"></td>
            <td><input type="number" data-int="1" data-path="products.${i}.variants.${j}.weightGrams" data-k="vw${i}-${j}" value="${attr(v.weightGrams ?? "")}" aria-label="Weight in grams"></td>
            <td class="r metric${mg && (mg.profit ?? mg.contribution) < 0 ? " bb-neg" : ""}" data-tip="${mg ? attr(`Of net revenue after ${Math.round(vat * 100)}% VAT, landed cost, shipping, payment fee and returns${mg.profit === null ? "; before ads (set an ad cost under Profit per order)" : ", and your ad cost per order"}`) : "Add a landed cost to see the margin"}">${pct === null ? "—" : `${pct}%`}</td></tr>`;
        }).join("")}</tbody></table></div>
      <div class="grid g2">${inp(`products.${i}.costEstimate`, "Landed cost per unit", { mono: true, hint: currencyOf(w) })}${inp(`products.${i}.images`, "Image links (https, one per line)", { rows: 2, list: "lines" })}</div>
      <div class="grid g2">${inp(`products.${i}.seo.title`, "SEO title")}${inp(`products.${i}.seo.description`, "SEO description")}</div>
    </div>`;
  }

  return openModal({
    cls: "bb-editor", label: `Edit ${brand.concept.name}`, render,
    mount: (box, { paint, close }) => {
      box.addEventListener("toggle", (e) => { const d = e.target.closest?.("details[data-sec]"); if (d) ui.open[d.dataset.sec] = d.open; }, true);
      box.addEventListener("input", (e) => {
        const t = e.target;
        if (t.dataset.path) {
          let v = t.value;
          if (t.dataset.list === "lines") v = v.split("\n").map((x) => x.trim()).filter(Boolean);
          else if (t.dataset.list === "csv") v = v.split(",").map((x) => x.trim()).filter(Boolean);
          else if (t.dataset.int) v = v === "" ? undefined : Number(v);
          setPath(w, t.dataset.path, v);
          if (/^economics\.|\.(price|costEstimate)$/.test(t.dataset.path)) { const el = box.querySelector("[data-econ]"); if (el) el.innerHTML = econHtml(w); }
          if (t.type === "color") { const hexIn = box.querySelector(`input[type=text][data-path="${CSS.escape(t.dataset.path)}"]`); if (hexIn) hexIn.value = t.value; }
        } else if (t.dataset.items != null) {
          w.pagePlan.sections[Number(t.dataset.items)].items = t.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [a, ...b] = l.split("|"); return { title: a.trim(), body: b.join("|").trim() || a.trim() }; });
        } else if (t.dataset.options != null) {
          w.products[Number(t.dataset.options)].options = t.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [n, ...rest] = l.split(":"); return { name: n.trim(), values: rest.join(":").split(",").map((x) => x.trim()).filter(Boolean) }; }).filter((o) => o.name);
        }
      });
      box.addEventListener("click", async (e) => {
        const t = e.target;
        if (t.closest("[data-close]")) return close();
        const b = t.closest("[data-ed]");
        if (!b) return;
        const i = Number(b.dataset.i);
        switch (b.dataset.ed) {
          case "add-color": w.identity.palette.push({ role: "accent", hex: "#888888", name: "New colour" }); break;
          case "rm-color": w.identity.palette.splice(i, 1); break;
          case "add-product": w.products.push(BLANK_PRODUCT()); ui.open.products = true; break;
          case "rm-product": w.products.splice(i, 1); break;
          case "rebuild": rebuildVariants(w.products[i]); break;
          case "add-section": w.pagePlan.sections.push({ type: "rich-text", headline: "New section", body: "" }); ui.open.page = true; break;
          case "rm-section": w.pagePlan.sections.splice(i, 1); break;
          case "up": if (i > 0) { const s = w.pagePlan.sections; [s[i - 1], s[i]] = [s[i], s[i - 1]]; } break;
          case "down": { const s = w.pagePlan.sections; if (i < s.length - 1) [s[i + 1], s[i]] = [s[i], s[i + 1]]; break; }
          case "save": {
            const clean = JSON.parse(JSON.stringify(w));
            const v = validateConcept(clean);
            if (!v.ok) { ui.errors = v.errors; paint(); box.scrollTop = 0; return; }
            ui.busy = true; ui.errors = []; paint();
            const r = await saveBrand(clean, { id: brand.id, note: "Edited in the page" });
            ui.busy = false;
            if (!r.ok) { ui.errors = r.errors || [r.reason]; paint(); box.scrollTop = 0; return; }
            toast(`Saved as version ${r.version}.`);
            close();
            onSaved?.(r);
            return;
          }
          default: return;
        }
        paint();
      });
    },
  });
}

// "products[0].variants[1].price: …" → "Robe › variant M › price: …".
function friendlyError(e, w) {
  return String(e)
    .replace(/products\[(\d+)\]\.variants\[(\d+)\]\./g, (m, i, j) => { const p = w.products?.[i]; const v = p?.variants?.[j]; return `${p?.title || `Product ${+i + 1}`} › variant ${(v?.optionValues || []).join(" / ") || +j + 1} › `; })
    .replace(/products\[(\d+)\]\.?/g, (m, i) => `${w.products?.[i]?.title || `Product ${+i + 1}`} › `)
    .replace(/pagePlan\.sections\[(\d+)\]\.?/g, (m, i) => `Page section ${+i + 1} (${w.pagePlan?.sections?.[i]?.type || "?"}) › `)
    .replace(/identity\.palette\[(\d+)\]\.?/g, (m, i) => `Colour ${+i + 1} › `)
    .replace(/ › :/g, ":");
}

// Variants for every combination of option values, keeping the price and
// SKU of combinations that already existed.
function rebuildVariants(p) {
  const opts = (p.options || []).filter((o) => o.values?.length);
  const old = new Map((p.variants || []).map((v) => [(v.optionValues || []).join("\u0001"), v]));
  const base = p.variants?.[0] || { price: "10.00", sku: "SKU" };
  let combos = [[]];
  for (const o of opts) combos = combos.flatMap((c) => o.values.map((x) => [...c, x]));
  if (combos.length > 100) { toast("More than 100 combinations; remove some values first."); return; }
  const stem = String(base.sku || "SKU").replace(/-[A-Za-z0-9]+$/, "") || "SKU";
  p.variants = combos.map((c) => old.get(c.join("\u0001")) || { optionValues: c, price: base.price, sku: c.length ? `${stem}-${c.map((x) => x.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase()).join("-")}` : stem, ...(base.weightGrams != null ? { weightGrams: base.weightGrams } : {}) });
}

// -- Publish dialog ---------------------------------------------------------
// Nothing is sent until a target store is chosen and confirmed. The safe
// choices are the defaults: draft products, hidden page, no theme, no menu,
// no sales channel. A live store also needs its address typed.
export function openPublish(brand, { productHandles = null, onStarted } = {}) {
  const conns = store.shopify.connections.filter((c) => c.status !== "disconnected");
  const pick = conns.find((c) => c.status === "connected" && !isLive(c)) || conns.find((c) => c.status === "connected") || conns[0] || null;
  const ui = {
    connectionId: pick?.id || "", confirm: false, liveText: "", dry: false, busy: false, error: "", key: newIdempotencyKey(), checking: false, checkNote: "",
    options: { ...DEFAULT_OPTIONS, includeBrand: !productHandles, productHandles },
  };
  const scopeOk = (have, need) => have.includes(need) || (need.startsWith("read_") && have.includes("write_" + need.slice(5)));

  const render = () => {
    const c = brand.concept;
    const conn = connectionById(ui.connectionId);
    const plan = buildPlan(c, ui.options);
    const live = isLive(conn);
    const blockers = [];
    let missing = [];
    if (!conn) blockers.push("Choose a store.");
    else {
      if (conn.status !== "connected") blockers.push(`This store is not connected (${conn.status}). Test it under Data > Shopify stores.`);
      if (conn.currency && plan.ok && conn.currency !== plan.summary.currency) blockers.push(`The store sells in ${conn.currency} but this concept is priced in ${plan.summary.currency}.`);
      missing = plan.ok ? plan.summary.scopes.filter((x) => !scopeOk(conn.scopes || [], x)) : [];
      if (conn.schema && conn.schema.ok === false) blockers.push(`The store's API version lacks fields this integration uses: ${(conn.schema.missing || []).slice(0, 6).join(", ")}.`);
    }
    if (!plan.ok) blockers.push(...plan.errors.slice(0, 8));
    const liveOk = !live || ui.liveText.trim().toLowerCase() === (conn?.shopDomain || "");
    const can = !blockers.length && !missing.length && ui.confirm && liveOk && !ui.busy;
    const sm = plan.summary;
    const o = ui.options;
    const what = sm ? [
      `${sm.products} product${sm.products === 1 ? "" : "s"} (status: ${sm.status === "DRAFT" ? "draft" : "active"}) with ${sm.variants} variant${sm.variants === 1 ? "" : "s"}`,
      sm.images ? `${sm.images} image${sm.images === 1 ? "" : "s"} from your links` : "No images (Shopify shows a placeholder)",
      o.includeBrand ? `1 smart collection “${sm.brand}” (products tagged brand:${sm.handle})` : null,
      o.includeBrand ? `1 page “${sm.brand}” (${o.publishPage ? "published" : "hidden"})` : null,
      o.includeBrand ? "1 brand entry (metaobject) with palette, fonts, story and USPs" : null,
      o.addToMenu ? `1 menu item in “${o.menuHandle}”` : null,
      o.publishToOnlineStore ? "Published to the Online Store sales channel" : "Not published to any sales channel",
      "No theme files are written",
    ].filter(Boolean) : [];
    return `
      <div class="bb-mhead"><div><div class="eyebrow">${icon("store", 13)} ${productHandles ? "Create products in Shopify" : "Publish brand to Shopify"}</div><h2>${esc(c.name)} <span class="muted small">v${brand.version}</span></h2></div>
        <button class="btn sm ghost" data-close aria-label="Close">${icon("x", 14)}</button></div>
      <div class="bb-mbody stack">
        ${conns.length ? `<label class="field"><span>Target store</span><select data-pub="conn" data-k="conn">${conns.map((x) => `<option value="${attr(x.id)}"${x.id === ui.connectionId ? " selected" : ""}${x.status === "connected" ? "" : " disabled"}>${esc(x.shopName || x.label || x.shopDomain)} · ${esc(x.shopDomain)} · ${storeBadge(x)}${x.status === "connected" ? "" : ` · ${esc(x.status)}`}</option>`).join("")}</select></label>`
          : `<div class="callout warn">${icon("warn", 16)}<span>No store is connected yet. <a href="#/data?tab=shopify" data-close>Connect a store</a> under Data > Shopify stores (a simulated store works too).</span></div>`}
        ${conn ? `<div class="bb-target ${storeBadge(conn).toLowerCase()}"><span class="bb-badge">${storeBadge(conn)}</span><div><b>${esc(conn.shopName || conn.shopDomain)}</b><small>${esc(conn.shopDomain)} · ${esc(conn.plan || "plan unknown")} · ${esc(conn.currency || "")}${conn.simulated ? " · nothing reaches Shopify" : ""}</small></div></div>` : ""}
        ${productHandles ? `<p class="small muted">Only the ${productHandles.length} chosen product${productHandles.length === 1 ? "" : "s"}; no collection, page or menu.</p>` : ""}
        <section class="bb-box"><h4>Exactly what will be created</h4><ul class="bullets small">${what.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          ${sm ? `<p class="xs muted">About ${sm.apiCalls} API calls, about ${sm.estSeconds} s. Runs in the background; you can close this page.</p>` : ""}</section>
        <section class="bb-box"><h4>Choices</h4>
          <div class="row"><span class="small">Quick choice</span><div class="seg" role="group" aria-label="Quick choice">
            <button data-pub="preset" data-v="safe" aria-pressed="${o.productStatus === "DRAFT" && !o.publishPage && !o.publishToOnlineStore}">Draft, hidden</button><button data-pub="preset" data-v="live" aria-pressed="${o.productStatus === "ACTIVE" && o.publishToOnlineStore && (o.publishPage || !o.includeBrand)}">Visible to shoppers now</button></div></div>
          <div class="row"><span class="small">Product status</span><div class="seg" role="group" aria-label="Product status">
            <button data-pub="status" data-v="DRAFT" aria-pressed="${o.productStatus === "DRAFT"}">Draft</button><button data-pub="status" data-v="ACTIVE" aria-pressed="${o.productStatus === "ACTIVE"}">Active</button></div></div>
          <label class="bb-check"><input type="checkbox" data-pub="publishPage" data-k="pp"${o.publishPage ? " checked" : ""}${o.includeBrand ? "" : " disabled"}> Publish the brand page now <small>(off: the page is created hidden)</small></label>
          <label class="bb-check"><input type="checkbox" data-pub="addToMenu" data-k="am"${o.addToMenu ? " checked" : ""}${o.includeBrand ? "" : " disabled"}> Add the brand to a menu</label>
          ${o.addToMenu ? `<label class="field bb-indent"><span>Menu handle</span><input type="text" class="mono" data-pub="menuHandle" data-k="mh" value="${attr(o.menuHandle)}"></label>` : ""}
          <label class="bb-check"><input type="checkbox" data-pub="publishToOnlineStore" data-k="os"${o.publishToOnlineStore ? " checked" : ""}> Publish to the Online Store sales channel <small>(off: nothing is visible to shoppers)</small></label>
          ${o.publishToOnlineStore && o.productStatus === "DRAFT" ? `<p class="xs muted bb-indent">Draft products stay hidden from shoppers even on the Online Store; choose Active to sell them now.</p>` : ""}
          <label class="bb-check bb-off"><input type="checkbox" disabled> Write a theme template <small>(not built yet; the theme is never touched)</small></label>
        </section>
        ${econBox(c, productHandles)}
        ${plan.warnings?.length ? `<div class="callout warn">${icon("warn", 16)}<ul class="bullets small">${plan.warnings.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
        ${blockers.length ? `<div class="callout bad">${icon("warn", 16)}<ul class="bullets small">${blockers.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
        ${missing.length ? accessHtml(conn, missing, ui) : ""}
        <section class="bb-box"><div class="row between"><h4>Dry run</h4><button class="btn sm" data-pub="dry">${ui.dry ? "Hide" : "Show"} the exact requests</button></div>
          ${ui.dry ? (plan.ok ? `<p class="xs muted">Validated. These are the steps and the exact GraphQL variables the job sends; nothing is sent now.</p><ol class="bb-dry">${plan.steps.map((s) => `<li><b>${esc(s.title)}</b>${s.variables || s.check || s.targets || s.item ? `<pre>${esc(JSON.stringify(s.variables || s.check || s.targets || s.item, null, 2))}</pre>` : ""}</li>`).join("")}</ol>` : `<p class="small">The concept does not validate; see the list above.</p>`) : `<p class="xs muted">Validates everything and shows the payload without writing to Shopify.</p>`}
        </section>
        ${conn ? `<label class="bb-check bb-confirm"><input type="checkbox" data-pub="confirm" data-k="cf"${ui.confirm ? " checked" : ""}> I have checked the target store: <b>${esc(conn.shopName || conn.shopDomain)}</b> (${esc(conn.shopDomain)})</label>` : ""}
        ${conn && live ? `<label class="field"><span>This is a LIVE store. Type its address to publish there</span><input type="text" class="mono" data-pub="liveText" data-k="lt" placeholder="${attr(conn.shopDomain)}" value="${attr(ui.liveText)}" autocomplete="off"></label>` : ""}
        ${ui.error ? `<div class="callout bad">${icon("warn", 16)}<span>${esc(ui.error)}</span></div>` : ""}
      </div>
      <div class="bb-mfoot">${missing.length ? `<span class="xs bb-err">Locked: Shopify has not given the app ${esc(scopesToAdd(missing).join(", "))}. See the red box.</span>` : `<span class="xs muted">${conn?.simulated ? "Simulated store: the job runs for real, against a store that only exists in the database." : "Products are created as drafts unless you chose Active."}</span>`}
        <div class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" data-pub="go"${can ? "" : " disabled"}>${ui.busy ? "Starting…" : productHandles ? `Create ${productHandles.length} product${productHandles.length === 1 ? "" : "s"}` : "Publish"}</button></div></div>`;
  };

  return openModal({
    cls: "bb-publish", label: `Publish ${brand.concept.name}`, render,
    mount: (box, { paint: repaint, close }) => {
      // A choice that needs access the app lacks brings the explanation into view.
      const paint = () => { const had = !!box.querySelector(".bb-access"); repaint(); if (!had) box.querySelector(".bb-access")?.scrollIntoView({ block: "nearest" }); };
      box.addEventListener("change", (e) => {
        const t = e.target, k = t.dataset.pub;
        if (!k) return;
        if (k === "conn") { ui.connectionId = t.value; ui.confirm = false; ui.liveText = ""; ui.checkNote = ""; }
        else if (k === "confirm") ui.confirm = t.checked;
        else if (["publishPage", "addToMenu", "publishToOnlineStore"].includes(k)) ui.options[k] = t.checked;
        paint();
      });
      box.addEventListener("input", (e) => {
        const t = e.target, k = t.dataset.pub;
        if (k === "liveText") { ui.liveText = t.value; paint(); }
        else if (k === "menuHandle") ui.options.menuHandle = t.value.trim();
      });
      box.addEventListener("click", async (e) => {
        const t = e.target;
        if (t.closest("[data-close]")) return close();
        const b = t.closest("[data-pub]");
        if (!b || b.tagName === "INPUT" || b.tagName === "SELECT") return;
        if (b.dataset.pub === "status") { ui.options.productStatus = b.dataset.v; return paint(); }
        if (b.dataset.pub === "preset") {
          const live = b.dataset.v === "live";
          Object.assign(ui.options, { productStatus: live ? "ACTIVE" : "DRAFT", publishToOnlineStore: live, publishPage: live && ui.options.includeBrand });
          return paint();
        }
        if (b.dataset.pub === "recheck") {
          ui.checking = true; ui.checkNote = ""; paint();
          const r = await recheckConnection(ui.connectionId);
          ui.checking = false;
          ui.checkNote = r.ok ? `Checked ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.` : r.reason;
          return paint();
        }
        if (b.dataset.pub === "dry") { ui.dry = !ui.dry; return paint(); }
        if (b.dataset.pub === "go") {
          const conn = connectionById(ui.connectionId);
          ui.busy = true; ui.error = ""; paint();
          const r = await startPublish({ brand, connection: conn, options: ui.options, confirmLive: isLive(conn), key: ui.key });
          ui.busy = false;
          if (!r.ok) { ui.error = r.reason; return paint(); }
          close();
          toast(r.existing ? "This publish was already started; showing it." : "Publishing started. Follow it in the status panel.");
          onStarted?.(r.jobId);
          openJobDrawer(r.jobId);
        }
      });
    },
  });
}

// One line on profit per order in the publish dialog (the full table is in
// the editor). Warns, never blocks.
function econBox(c, productHandles) {
  const all = conceptEconomics(c);
  const rows = productHandles ? all.rows.filter((r) => productHandles.includes(r.handle)) : all.rows;
  if (!rows.length) return "";
  const e = all.settings, cur = currencyOf(c);
  const priced = rows.filter((r) => r.econ);
  const losing = priced.filter((r) => (r.econ.profit ?? r.econ.contribution) < 0).map((r) => r.title);
  const missingCost = rows.filter((r) => !r.hasCost).map((r) => r.title);
  if (!priced.length) return `<section class="bb-box bb-econ-sum"><h4>Profit per order</h4><p class="small">No product has a landed cost yet, so the profit cannot be worked out. Add costs under Edit > Products.</p></section>`;
  const worst = priced.reduce((a, r) => ((r.econ.profit ?? r.econ.contribution) < (a.econ.profit ?? a.econ.contribution) ? r : a));
  const line = e.adCost === null
    ? `Before ads, an order earns ${money(Math.min(...priced.map((r) => r.econ.contribution)), cur)} to ${money(Math.max(...priced.map((r) => r.econ.contribution)), cur)}. No ad cost per order is set.`
    : `At ${money(e.adCost, cur)} in ads per order, profit per order is ${money(Math.min(...priced.map((r) => r.econ.profit)), cur)} to ${money(Math.max(...priced.map((r) => r.econ.profit)), cur)}.`;
  return `<section class="bb-box bb-econ-sum${losing.length ? " bad" : ""}"><h4>Profit per order</h4><p class="small">${esc(line)}</p>
    ${losing.length ? `<p class="small bb-err">${icon("warn", 12)} ${esc(`${losing.length} of ${priced.length} lose money: ${losing.join(", ")}. Worst: ${worst.title}.`)}</p>` : ""}
    ${missingCost.length ? `<p class="xs muted">${esc(`${missingCost.length} without a landed cost: ${missingCost.join(", ")}.`)}</p>` : ""}
    <p class="xs muted">Shipping ${e.shipping === null ? "not set (0)" : money(e.shipping, cur)}, returns ${e.returnPct}%, payment fee ${e.feePct}% + ${money(e.feeFixed, cur)}. Change them under Edit > Profit per order.</p></section>`;
}

// Scopes the chosen publish needs and the store's app lacks: what to add,
// where, and a button that checks the store again without leaving.
const scopesToAdd = (missing) => [...new Set(missing.map((x) => x.replace(/^read_/, "write_")))];
function accessHtml(conn, missing, ui) {
  const add = scopesToAdd(missing);
  return `<div class="callout bad bb-access" role="alert">${icon("warn", 16)}<div class="stack" style="gap:6px">
      <b>Shopify has not given the app access to publish this. Add ${add.length === 1 ? "this scope" : "these scopes"} (write includes read):</b>
      <ul class="bullets small">${add.map((x) => `<li><code>${esc(x)}</code>: ${esc(String(SCOPES[x] || "needed").replace(/ \(optional\)$/, ""))}</li>`).join("")}</ul>
      <p class="small">${esc(scopeFix(conn.auth))}</p>
      <div class="row"><button class="btn sm" data-pub="recheck"${ui.checking ? " disabled" : ""}>${ui.checking ? "Checking the store…" : "Check access again"}</button>
        ${ui.checkNote ? `<span class="xs">${esc(ui.checkNote)} ${missing.length ? "Still missing." : ""}</span>` : ""}</div>
    </div></div>`;
}

// -- Status drawer --------------------------------------------------------------
const STATUS_LABEL = { queued: "Queued", running: "Running", succeeded: "Done", failed: "Failed", partially_failed: "Partly done", rolling_back: "Undoing", rolled_back: "Undone" };
const statusChip = (st) => `<span class="bb-st bb-st-${attr(st)}">${esc(STATUS_LABEL[st] || st)}</span>`;
function stepLabel(key) {
  if (key.startsWith("product:")) return `Product ${key.slice(8)}`;
  return { validate: "Validate the concept", preflight: "Check the store (token, scopes, API, currency, handles)", "metaobject-definition": "Brand metaobject type", collection: "Collection", metaobject: "Brand entry", page: "Brand page", menu: "Menu item", publish: "Online Store channel", finalize: "Save ids and links" }[key] || key;
}
const RES_LABEL = { product: "Product", collection: "Collection", page: "Page", metaobject: "Brand entry", metaobject_definition: "Metaobject type", menu: "Menu", publication: "Online Store listing" };

let drawer = null;
export function openJobDrawer(jobId, { tab = "job" } = {}) {
  if (drawer) { drawer.show(jobId, tab); return drawer; }
  const ui = { jobId, tab, q: "", status: "", busy: false };
  const el = document.createElement("aside");
  el.className = "bb-drawer";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Publish status");
  document.body.appendChild(el);
  let timer = null, alive = true;

  const poll = async () => {
    clearTimeout(timer);
    if (!alive || !ui.jobId) return;
    try { await loadJob(ui.jobId); } catch { /* shown as stale */ }
    const j = jobById(ui.jobId);
    if (alive && j && !TERMINAL.includes(j.status)) timer = setTimeout(poll, 2000);
  };
  const render = () => {
    const j = ui.jobId ? jobById(ui.jobId) : null;
    el.innerHTML = `<div class="bb-dhead"><div class="tabs" role="tablist">
        <button role="tab" aria-selected="${ui.tab === "job"}" data-dr-tab="job"${ui.jobId ? "" : " disabled"}>This publish</button>
        <button role="tab" aria-selected="${ui.tab === "history"}" data-dr-tab="history">History (${store.shopify.jobs.length})</button></div>
        <button class="btn sm ghost" data-dr="close" aria-label="Close">${icon("x", 14)}</button></div>
      <div class="bb-dbody">${ui.tab === "history" ? historyHtml(ui) : j ? jobHtml(j) : '<div class="empty">Nothing published yet.</div>'}</div>`;
  };
  const unsub = onChange((what) => { if (what === "shopify" && alive) { const a = document.activeElement; const keep = a && el.contains(a) && a.tagName === "INPUT" ? a.id : null; render(); if (keep) { const n = el.querySelector("#" + keep); n?.focus(); try { n?.setSelectionRange(n.value.length, n.value.length); } catch { /* not text */ } } } });
  const close = () => { alive = false; clearTimeout(timer); unsub(); el.remove(); drawer = null; document.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => { if (e.key === "Escape" && !document.querySelector(".bb-ov")) close(); };
  document.addEventListener("keydown", onKey, true);
  el.addEventListener("input", (e) => { if (e.target.id === "bb-hq") { ui.q = e.target.value; render(); const n = el.querySelector("#bb-hq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); } });
  el.addEventListener("change", (e) => { if (e.target.id === "bb-hs") { ui.status = e.target.value; render(); } });
  el.addEventListener("click", async (e) => {
    const t = e.target;
    const d = t.closest("[data-dr]");
    const tb = t.closest("[data-dr-tab]");
    if (tb) { ui.tab = tb.dataset.drTab; return render(); }
    const pick = t.closest("[data-dr-job]");
    if (pick) { ui.jobId = pick.dataset.drJob; ui.tab = "job"; render(); return poll(); }
    if (!d) return;
    if (d.dataset.dr === "close") return close();
    if (d.dataset.dr === "retry") {
      d.disabled = true;
      const r = await retryJob(ui.jobId);
      toast(r.ok ? "Retrying from the step that failed." : r.reason);
      return poll();
    }
    if (d.dataset.dr === "undo") return openUndo(ui.jobId, { onStarted: () => poll() });
    if (d.dataset.dr === "refresh") { await loadShopify({ quiet: true }); return poll(); }
  });
  drawer = { show(id, t = "job") { ui.jobId = id || ui.jobId; ui.tab = id ? t : "history"; render(); poll(); }, close };
  render();
  poll();
  return drawer;
}

function jobHtml(j) {
  const b = brandById(j.brandId);
  const conn = connectionById(j.connectionId);
  const det = store.shopify.jobDetail[j.id] || { steps: [], resources: [] };
  const pg = j.progress || {};
  const pct = pg.total ? Math.round((pg.done / pg.total) * 100) : 0;
  const steps = [...det.steps].sort((a, c) => a.seq - c.seq);
  const left = pg.total ? Math.max(0, pg.total - steps.filter((s) => s.key !== "validate").length) : 0;
  const busy = !TERMINAL.includes(j.status);
  const canUndo = ["succeeded", "partially_failed", "failed"].includes(j.status) && det.resources.some((r) => !r.removedAt);
  const canRetry = ["failed", "partially_failed"].includes(j.status) && !j.rollback;
  const icon2 = (st) => ({ succeeded: icon("check", 13), failed: icon("x", 13), running: '<span class="bb-spin"></span>' }[st] || '<span class="bb-dotp"></span>');
  return `<div class="stack">
    <div class="row between"><div><b>${esc(b?.name || j.brandId)}</b> <span class="muted small">v${j.brandVersion}</span><div class="xs muted">${esc(conn?.shopName || conn?.shopDomain || "store")} ${conn ? `<span class="bb-badge sm ${storeBadge(conn).toLowerCase()}">${storeBadge(conn)}</span>` : ""} · ${dateLabel(j.createdAt)}</div></div>${statusChip(j.status)}</div>
    <div class="bb-prog" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
    <div class="xs muted">${pg.total ? `${pg.done} of ${pg.total} steps` : "Waiting for the job to start"}${pg.products ? ` · products ${pg.products.done} of ${pg.products.total}` : ""}${busy ? " · updates every 2 s" : ""}</div>
    ${j.error?.message ? `<div class="callout bad">${icon("warn", 16)}<span><b>${esc(j.error.step ? stepLabel(j.error.step) : "Error")}:</b> ${esc(j.error.message)}${j.error.requestId ? `<br><span class="xs mono">Shopify request id ${esc(j.error.requestId)}</span>` : ""}</span></div>` : ""}
    <ol class="bb-steps">${steps.map((s) => `<li class="bb-step-${attr(s.status)}">${icon2(s.status)}<div><b>${esc(stepLabel(s.key))}</b>${s.attempts > 1 ? ` <span class="xs muted">attempt ${s.attempts}</span>` : ""}
        ${s.status === "failed" && s.error?.message ? `<div class="xs bb-err">${esc(s.error.message)}</div>` : ""}
        ${s.status === "succeeded" && s.response ? `<div class="xs muted">${esc(stepNote(s))}</div>` : ""}</div></li>`).join("")}
      ${left && busy ? `<li class="bb-step-pending"><span class="bb-dotp"></span><div class="muted small">${left} more step${left === 1 ? "" : "s"}</div></li>` : ""}</ol>
    ${det.resources.length ? `<section class="bb-box"><h4>Created in the store</h4><ul class="bb-res">${det.resources.map((r) => `<li class="${r.removedAt ? "gone" : ""}"><span>${esc(RES_LABEL[r.type] || r.type)} <b>${esc(r.handle || "")}</b>${r.existed ? ' <span class="xs muted">(updated)</span>' : ""}${r.removedAt ? ` <span class="xs muted">${esc(r.state?.rolled_back || "undone")}</span>` : ""}</span>
        <span class="row">${r.adminUrl ? `<a class="linkish xs" href="${attr(r.adminUrl)}" target="_blank" rel="noopener">Admin ${icon("ext", 11)}</a>` : ""}${r.publicUrl ? `<a class="linkish xs" href="${attr(r.publicUrl)}" target="_blank" rel="noopener">Store ${icon("ext", 11)}</a>` : ""}${!r.adminUrl && conn?.simulated ? '<span class="xs muted">simulated</span>' : ""}</span></li>`).join("")}</ul></section>` : ""}
    <div class="row">${canRetry ? `<button class="btn sm primary" data-dr="retry">Retry from the failed step</button>` : ""}${canUndo ? `<button class="btn sm" data-dr="undo">Undo publish…</button>` : ""}<button class="btn sm ghost" data-dr="refresh">Refresh</button></div>
  </div>`;
}
function stepNote(s) {
  const r = s.response || {};
  if (s.key === "preflight") return r.shop ? `${r.shop.name} · ${r.shop.currency} · ${r.schema?.checked ?? "?"} API fields checked` : "";
  if (s.key === "validate") return `${r.products ?? "?"} products, ${r.variants ?? "?"} variants`;
  if (r.updated) return "Updated (made by an earlier Plan-vy publish)";
  if (r.existed) return "Already there; kept";
  if (s.key === "publish") return `${r.published ?? 0} listed`;
  return r.handle ? `Created: ${r.handle}` : "Done";
}

function historyHtml(ui) {
  const q = ui.q.toLowerCase();
  const list = store.shopify.jobs.filter((j) => (!ui.status || j.status === ui.status) && (!q || `${brandById(j.brandId)?.name || j.brandId} ${connectionById(j.connectionId)?.shopDomain || ""}`.toLowerCase().includes(q)));
  return `<div class="stack"><div class="row"><input id="bb-hq" type="search" placeholder="Search brand or store" value="${attr(ui.q)}" aria-label="Search publishes" style="flex:1">
      <select id="bb-hs" aria-label="Status"><option value="">All</option>${Object.entries(STATUS_LABEL).map(([k, l]) => `<option value="${k}"${ui.status === k ? " selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="list">${list.map((j) => { const c = connectionById(j.connectionId); return `<button class="li bb-hrow" data-dr-job="${attr(j.id)}"><span class="body"><b>${esc(brandById(j.brandId)?.name || j.brandId)} <span class="muted">v${j.brandVersion}</span></b><small>${esc(c?.shopDomain || "store")} · ${dateLabel(j.createdAt)}${j.options?.productHandles ? ` · ${j.options.productHandles.length} products only` : ""}</small></span>${statusChip(j.status)}</button>`; }).join("") || '<div class="empty">No publishes match.</div>'}</div></div>`;
}

// -- Undo ------------------------------------------------------------------------
// Soft by default: products back to draft, the page hidden, listings and
// menus restored. Deleting is a separate choice that needs DELETE typed.
// Only what this publish created is touched.
export function openUndo(jobId, { onStarted } = {}) {
  const ui = { mode: "unpublish", text: "", busy: false, error: "" };
  const render = () => {
    const j = jobById(jobId);
    const conn = connectionById(j?.connectionId);
    const det = store.shopify.jobDetail[jobId] || { resources: [] };
    const plan = undoPlan(det.resources, ui.mode);
    const kept = det.resources.filter((r) => !r.removedAt).length - plan.length;
    const can = plan.length && !ui.busy && (ui.mode === "unpublish" || ui.text === "DELETE");
    return `<div class="bb-mhead"><div><div class="eyebrow">${icon("back", 13)} Undo publish</div><h2>${esc(brandById(j?.brandId)?.name || "Publish")}</h2></div><button class="btn sm ghost" data-close aria-label="Close">${icon("x", 14)}</button></div>
      <div class="bb-mbody stack">
        ${conn ? `<div class="bb-target ${storeBadge(conn).toLowerCase()}"><span class="bb-badge">${storeBadge(conn)}</span><div><b>${esc(conn.shopName || conn.shopDomain)}</b><small>${esc(conn.shopDomain)}</small></div></div>` : ""}
        <label class="bb-check"><input type="radio" name="bb-um" value="unpublish"${ui.mode === "unpublish" ? " checked" : ""} autofocus> <span><b>Unpublish</b> (recommended): products back to draft, the page hidden, listings and the menu restored. Nothing is deleted.</span></label>
        <label class="bb-check bb-danger"><input type="radio" name="bb-um" value="delete"${ui.mode === "delete" ? " checked" : ""}> <span><b>Delete permanently</b>: removes what this publish created. Cannot be undone.</span></label>
        <section class="bb-box"><h4>${plan.length} action${plan.length === 1 ? "" : "s"}</h4><ul class="bullets small">${plan.map((a) => `<li>${esc(a.label)}</li>`).join("") || "<li>Nothing to undo.</li>"}</ul>
          ${kept > 0 ? `<p class="xs muted">${kept} item${kept === 1 ? "" : "s"} stay as they are (made before this publish, or the shared brand metaobject type).</p>` : ""}</section>
        ${ui.mode === "delete" ? `<label class="field"><span>Type DELETE to confirm</span><input type="text" class="mono" data-um-text data-k="umt" value="${attr(ui.text)}" autocomplete="off"></label>` : ""}
        ${ui.error ? `<div class="callout bad">${icon("warn", 16)}<span>${esc(ui.error)}</span></div>` : ""}
      </div>
      <div class="bb-mfoot"><span class="xs muted">Only resources recorded for this publish are touched.</span><div class="row"><button class="btn" data-close>Cancel</button>
        <button class="btn ${ui.mode === "delete" ? "bb-btn-danger" : "primary"}" data-um-go${can ? "" : " disabled"}>${ui.busy ? "Starting…" : ui.mode === "delete" ? "Delete permanently" : "Unpublish"}</button></div></div>`;
  };
  return openModal({
    cls: "bb-undo", label: "Undo publish", render,
    mount: (box, { paint, close }) => {
      box.addEventListener("change", (e) => { if (e.target.name === "bb-um") { ui.mode = e.target.value; ui.text = ""; paint(); } });
      box.addEventListener("input", (e) => { if (e.target.hasAttribute("data-um-text")) { ui.text = e.target.value; paint(); } });
      box.addEventListener("click", async (e) => {
        if (e.target.closest("[data-close]")) return close();
        if (!e.target.closest("[data-um-go]")) return;
        ui.busy = true; ui.error = ""; paint();
        const r = await rollbackJob(jobId, ui.mode, ui.mode === "delete" ? ui.text : "");
        ui.busy = false;
        if (!r.ok) { ui.error = r.reason; return paint(); }
        close();
        toast(ui.mode === "delete" ? "Deleting what this publish created." : "Unpublishing.");
        onStarted?.();
      });
    },
  });
}

export { IMAGE_PROVIDERS };

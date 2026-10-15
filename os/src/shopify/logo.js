// A simple logo for a brand, built from its name, palette and heading font:
// a wordmark, a badge with the initial next to the name, or the two stacked.
// The layout is one list of shapes, drawn as SVG (for the preview and the
// SVG download) and on a canvas (for the PNG, with the web font drawn in).
//
// `measure(text, fontPx, family)` returns the text's width in px; the page
// passes a canvas measurer, the tests a fixed one.

export const LOGO_STYLES = [["wordmark", "Wordmark"], ["badge", "Badge and name"], ["stacked", "Stacked"]];
export const LOGO_SHAPES = [["circle", "Circle"], ["square", "Rounded square"], ["arch", "Arch"], ["diamond", "Diamond"]];

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONT = /^[A-Za-z0-9 ]{2,40}$/;

export function logoColors(concept) {
  const by = (r) => (concept?.identity?.palette || []).find((p) => p.role === r)?.hex;
  const ok = (h) => (HEX.test(h || "") ? h : null);
  return {
    primary: ok(by("primary")) || "#4f46e5", accent: ok(by("accent")) || ok(by("secondary")) || "#e879f9",
    bg: ok(by("bg")) || "#ffffff", fg: ok(by("fg")) || "#1f2933",
  };
}

export function logoSettings(concept) {
  const l = concept?.logo || {};
  return {
    style: LOGO_STYLES.some(([k]) => k === l.style) ? l.style : "badge",
    shape: LOGO_SHAPES.some(([k]) => k === l.shape) ? l.shape : "circle",
    upper: !!l.upper,
    font: FONT.test(concept?.identity?.typography?.headingFont || "") ? concept.identity.typography.headingFont : null,
  };
}

const initial = (name) => (String(name || "?").trim().match(/[\p{L}\p{N}]/u)?.[0] || "?").toUpperCase();

// The shapes of one logo, in a box of width × height px.
export function logoLayout(concept, { measure, style, shape, upper, transparent = false } = {}) {
  const set = { ...logoSettings(concept), ...(style ? { style } : {}), ...(shape ? { shape } : {}), ...(upper !== undefined ? { upper } : {}) };
  const col = logoColors(concept);
  const family = set.font;
  const name = (set.upper ? String(concept?.name || "Brand").toUpperCase() : String(concept?.name || "Brand")).slice(0, 60);
  const fontPx = 64, mark = 96, gap = 28, pad = 32;
  const tw = Math.ceil(measure(name, fontPx, family));
  const items = [];
  const markShape = (x, y, s) => {
    const fill = col.primary;
    if (set.shape === "circle") items.push({ t: "circle", cx: x + s / 2, cy: y + s / 2, r: s / 2, fill });
    else if (set.shape === "square") items.push({ t: "rect", x, y, w: s, h: s, rx: s * 0.22, fill });
    else if (set.shape === "arch") items.push({ t: "path", d: `M${x} ${y + s}V${y + s / 2}A${s / 2} ${s / 2} 0 0 1 ${x + s} ${y + s / 2}V${y + s}Z`, fill });
    else items.push({ t: "path", d: `M${x + s / 2} ${y}L${x + s} ${y + s / 2}L${x + s / 2} ${y + s}L${x} ${y + s / 2}Z`, fill });
    items.push({ t: "text", x: x + s / 2, y: y + s / 2 + s * 0.17, text: initial(concept?.name), size: s * 0.5, fill: col.bg, anchor: "middle", family });
  };
  let w, h;
  if (set.style === "wordmark") {
    w = pad * 2 + tw + 18; h = pad * 2 + fontPx;
    items.push({ t: "text", x: pad, y: pad + fontPx * 0.8, text: name, size: fontPx, fill: col.fg, anchor: "start", family });
    items.push({ t: "circle", cx: pad + tw + 10, cy: pad + fontPx * 0.72, r: 7, fill: col.accent });
  } else if (set.style === "stacked") {
    w = pad * 2 + Math.max(tw, mark); h = pad * 2 + mark + gap * 0.6 + fontPx;
    markShape((w - mark) / 2, pad, mark);
    items.push({ t: "text", x: w / 2, y: pad + mark + gap * 0.6 + fontPx * 0.8, text: name, size: fontPx, fill: col.fg, anchor: "middle", family });
  } else {
    w = pad * 2 + mark + gap + tw; h = pad * 2 + mark;
    markShape(pad, pad, mark);
    items.push({ t: "text", x: pad + mark + gap, y: pad + mark / 2 + fontPx * 0.3, text: name, size: fontPx, fill: col.fg, anchor: "start", family });
  }
  return { w: Math.ceil(w), h: Math.ceil(h), bg: transparent ? null : col.bg, items, settings: set, colors: col };
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fam = (f) => (f ? `'${f}', ` : "") + "system-ui, sans-serif";

export function logoSvg(layout, { title = "" } = {}) {
  const parts = layout.items.map((i) => {
    if (i.t === "circle") return `<circle cx="${i.cx}" cy="${i.cy}" r="${i.r}" fill="${i.fill}"/>`;
    if (i.t === "rect") return `<rect x="${i.x}" y="${i.y}" width="${i.w}" height="${i.h}" rx="${i.rx}" fill="${i.fill}"/>`;
    if (i.t === "path") return `<path d="${i.d}" fill="${i.fill}"/>`;
    return `<text x="${i.x}" y="${i.y}" font-family="${xml(fam(i.family))}" font-size="${i.size}" font-weight="700" fill="${i.fill}" text-anchor="${i.anchor}">${xml(i.text)}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.w} ${layout.h}" width="${layout.w}" height="${layout.h}" role="img" aria-label="${xml(title)}">${title ? `<title>${xml(title)}</title>` : ""}${layout.bg ? `<rect width="100%" height="100%" fill="${layout.bg}"/>` : ""}${parts.join("")}</svg>`;
}

// Draws the layout on a 2D canvas context at `scale` (the canvas must be
// layout.w*scale × layout.h*scale). Fonts must be loaded first.
export function drawLogo(ctx, layout, scale = 1) {
  ctx.save();
  ctx.scale(scale, scale);
  if (layout.bg) { ctx.fillStyle = layout.bg; ctx.fillRect(0, 0, layout.w, layout.h); }
  for (const i of layout.items) {
    ctx.fillStyle = i.fill;
    if (i.t === "circle") { ctx.beginPath(); ctx.arc(i.cx, i.cy, i.r, 0, Math.PI * 2); ctx.fill(); }
    else if (i.t === "rect") { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(i.x, i.y, i.w, i.h, i.rx) : ctx.rect(i.x, i.y, i.w, i.h); ctx.fill(); }
    else if (i.t === "path") ctx.fill(new Path2D(i.d));
    else { ctx.font = `700 ${i.size}px ${fam(i.family)}`; ctx.textAlign = i.anchor === "middle" ? "center" : "left"; ctx.textBaseline = "alphabetic"; ctx.fillText(i.text, i.x, i.y); }
  }
  ctx.restore();
}

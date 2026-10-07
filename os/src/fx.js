// Effects: page entrances, numbers that count up, sections that rise into
// view, a glow behind the glass that follows the pointer, a page-change bar,
// sparks on click and confetti when something goes well (research done, an
// idea analysed, a value verified).
//
// Two locks: the system's "reduce motion" and the Effects switch in the top
// bar (class fx-off on <html>, remembered in this browser). Nothing here
// touches data: a number that counts up always ends on exactly the text the
// view wrote. Nothing you can click tilts or flips, and every effect layer
// has pointer-events: none, so a click always reaches what is under it.

const KEY = "planvy-intel-fx";
const COLORS = ["#38bdf8", "#818cf8", "#e879f9", "#fbbf24", "#34d399"];
const ENTER_MS = 1500;
const RISE = ".panel, .agent, .p-score, .callout, .page-head, .p-hero, .stats > .stat, .board .col, .glass, .alert";
const FILL = ".meter > i, .comp .bar i, .mix i, .bar > i, .poas > i";
const COUNT = ".stat .v, .score-lg, .subscore .v, .layer .n, .kpi .val, .stat dd";
const SPOT = ".panel, .agent, .p-score, .r-card, .card, .subscore, .glass";
const SECTIONS = ".page > *, .p-sections > .p-sec, #view > *";

const calm = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: true };
const FX = { t0: 0, key: null, timer: 0, bits: [], loop: 0, aim: null, pos: null, glowLoop: 0, io: null, par: 0, parAim: [0, 0] };
const $ = (id) => document.getElementById(id);

export const fxEnabled = () => !document.documentElement.classList.contains("fx-off");
export const fxOn = () => !calm.matches && fxEnabled();

// ── Page entrances ─────────────────────────────────────────────────────
// Called after every render. A new view starts the entrance; a re-render
// in the middle of it continues where the animations were (their delays
// are shortened by the time already gone), later re-renders stay still.
export function enter(root, key) {
  if (!root) return;
  const now = performance.now();
  if (key !== FX.key) { FX.key = key; FX.t0 = now; bar(); }
  const gone = now - FX.t0;
  const done = () => root.classList.remove("enter");
  if (!fxOn() || gone > ENTER_MS) { done(); return; }
  root.style.setProperty("--fx-el", gone + "ms");
  let i = 0, j = 0, d = 0;
  root.querySelectorAll(RISE).forEach((n) => n.style.setProperty("--i", Math.min(i++, 14)));
  root.querySelectorAll(FILL).forEach((n) => n.style.setProperty("--j", Math.min(j++, 24)));
  root.querySelectorAll(".chart .dot").forEach((n) => n.style.setProperty("--d", Math.min(d++, 60)));
  root.classList.add("enter");
  clearTimeout(FX.timer);
  FX.timer = setTimeout(done, ENTER_MS - gone + 80);
  countUp(root);
  if (gone < 60) reveal(root);
}

function bar() {
  const b = $("osBar");
  if (!b || !fxOn()) return;
  b.classList.remove("go"); void b.offsetWidth; b.classList.add("go");
}

// Sections below the fold wait, then rise as they scroll into view.
function reveal(root) {
  if (typeof IntersectionObserver !== "function") return;
  FX.io ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      FX.io.unobserve(e.target);
      if (!e.target.isConnected) continue;
      e.target.classList.remove("fx-wait");
      e.target.classList.add("fx-show");
      countUp(e.target, true);
      setTimeout(() => e.target.classList.remove("fx-show"), 900);
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.04 });
  const fold = innerHeight + 40;
  root.querySelectorAll(SECTIONS).forEach((n) => {
    if (n.getBoundingClientRect().top > fold) { n.classList.add("fx-wait"); FX.io.observe(n); }
  });
}

// ── Numbers count up ───────────────────────────────────────────────────
// "£1,234.50", "1 234 kr", "56%", "−18": the digits run from zero and the
// text ends exactly as written. Dates and elements with children are left.
const NUM = /[−-]?\d[\d,.  ]*\d|[−-]?\d/g;
function parseNum(m) {
  const sign = /^[−-]/.test(m) ? m[0] : "";
  const body = sign ? m.slice(1) : m;
  let group = "", dec = "", decimals = 0, v;
  const spaces = /[  ]/.test(body);
  if (body.includes(",") && body.includes(".")) { group = ","; dec = "."; }
  else if (body.includes(",")) { if (/^\d{1,3}(,\d{3})+$/.test(body)) group = ","; else dec = ","; }
  else if (body.includes(".")) dec = ".";
  if (spaces) group = (body.match(/[  ]/) || [""])[0];
  let clean = body;
  if (group) clean = clean.split(group).join("");
  if (dec) { decimals = clean.length - clean.lastIndexOf(dec) - 1; clean = clean.replace(dec, "."); }
  v = Number(clean);
  return Number.isFinite(v) ? { sign, group, dec, decimals, v } : null;
}
function formatNum(d, share) {
  let [whole, frac] = (d.v * share).toFixed(d.decimals).split(".");
  if (d.group) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, d.group);
  return d.sign + whole + (d.decimals ? d.dec + frac : "");
}
function countUp(root, now) {
  const jobs = [];
  root.querySelectorAll(COUNT).forEach((el) => {
    if (el.children.length || el.dataset.fxCounted) return;
    const text = el.textContent;
    if (!/\d/.test(text) || /\d{4}-\d{2}/.test(text)) return;
    const parts = [];
    let last = 0, ok = true;
    text.replace(NUM, (m, pos) => { const d = parseNum(m); if (!d) ok = false; parts.push(text.slice(last, pos), d); last = pos + m.length; return m; });
    if (!ok) return;
    parts.push(text.slice(last));
    el.dataset.fxCounted = "1";
    jobs.push({ el, text, parts });
  });
  if (!jobs.length || document.visibilityState !== "visible") return;
  const t0 = now ? performance.now() : FX.t0, LEN = 1100;
  const step = (t) => {
    const p = Math.min(1, Math.max(0, (t - t0) / LEN));
    const share = 1 - Math.pow(2, -10 * p);
    for (const j of jobs) {
      if (!j.el.isConnected) continue;
      j.el.textContent = p >= 1 || !fxOn() ? j.text : j.parts.map((x) => (typeof x === "string" ? x : formatNum(x, share))).join("");
    }
    if (p < 1 && fxOn()) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ── Pointer: glow, spotlight, colour fields ────────────────────────────
function move(e) {
  if (e.pointerType !== "mouse" || !fxOn()) return;
  for (let n = e.target.closest?.(SPOT); n; n = n.parentElement?.closest(SPOT)) {
    const r = n.getBoundingClientRect();
    n.style.setProperty("--mx", e.clientX - r.left + "px");
    n.style.setProperty("--my", e.clientY - r.top + "px");
  }
  FX.aim = [e.clientX, e.clientY];
  $("osGlow")?.classList.add("on");
  if (!FX.glowLoop) FX.glowLoop = requestAnimationFrame(glowStep);
  FX.parAim = [e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5];
  if (!FX.par) FX.par = requestAnimationFrame(() => {
    FX.par = 0;
    const c = document.querySelector(".chroma");
    if (c) { c.style.setProperty("--px", FX.parAim[0].toFixed(3)); c.style.setProperty("--py", FX.parAim[1].toFixed(3)); }
  });
}
function glowStep() {
  const g = $("osGlow");
  if (!g || !FX.aim) { FX.glowLoop = 0; return; }
  FX.pos = FX.pos || FX.aim.slice();
  FX.pos[0] += (FX.aim[0] - FX.pos[0]) * 0.1;
  FX.pos[1] += (FX.aim[1] - FX.pos[1]) * 0.1;
  g.style.transform = `translate3d(${FX.pos[0]}px,${FX.pos[1]}px,0) translate(-50%,-50%)`;
  FX.glowLoop = Math.hypot(FX.aim[0] - FX.pos[0], FX.aim[1] - FX.pos[1]) > 0.5 ? requestAnimationFrame(glowStep) : 0;
}

// ── Sparks on click ────────────────────────────────────────────────────
export function sparks(x, y, n = 10) {
  if (!fxOn()) return;
  const bits = [];
  const ring = document.createElement("span");
  ring.className = "fx-ring";
  ring.style.setProperty("--x0", x + "px"); ring.style.setProperty("--y0", y + "px");
  bits.push(ring);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    const d = 26 + Math.random() * 30;
    const s = document.createElement("span");
    s.className = "fx-spark";
    s.style.background = COLORS[i % COLORS.length];
    s.style.setProperty("--x0", x + "px"); s.style.setProperty("--y0", y + "px");
    s.style.setProperty("--x1", x + Math.cos(a) * d + "px"); s.style.setProperty("--y1", y + Math.sin(a) * d + "px");
    bits.push(s);
  }
  bits.forEach((b) => { b.addEventListener("animationend", () => b.remove()); setTimeout(() => b.remove(), 1200); });
  document.body.append(...bits);
}

// ── Confetti ───────────────────────────────────────────────────────────
// Physics runs on time, not frames, so it falls at the same speed on a
// 120 Hz screen and still ends on a slow phone.
export function burst(x, y, n = 110) {
  if (!fxOn()) return;
  const c = $("osCanvas");
  if (!c) return;
  const ox = x ?? innerWidth / 2, oy = y ?? innerHeight * 0.32;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
    const v = 5 + Math.random() * 9;
    FX.bits.push({ x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.35,
      w: 5 + Math.random() * 6, h: 3 + Math.random() * 5, f: COLORS[i % COLORS.length], age: 0, max: 1900 + Math.random() * 900 });
  }
  if (FX.loop) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  const ctx = c.getContext("2d");
  if (!ctx) { FX.bits = []; return; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  let prev = performance.now();
  const step = (t) => {
    const dt = Math.max(0, t - prev);
    const k = Math.min(3, dt / 16.7);
    prev = t;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    FX.bits = FX.bits.filter((b) => (b.age += dt) < b.max && b.y < innerHeight + 40);
    for (const b of FX.bits) {
      b.vy += 0.24 * k; b.vx *= Math.pow(0.985, k); b.vy *= Math.pow(0.985, k);
      b.x += b.vx * k; b.y += b.vy * k; b.r += b.vr * k;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (b.max - b.age) / 500);
      ctx.translate(b.x, b.y); ctx.rotate(b.r);
      ctx.fillStyle = b.f;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.r * 1.7)) + 1);
      ctx.restore();
    }
    if (FX.bits.length) FX.loop = requestAnimationFrame(step);
    else { FX.loop = 0; c.width = 0; c.height = 0; }
  };
  FX.loop = requestAnimationFrame(step);
}
export function burstAt(el, n = 90) {
  if (!el?.getBoundingClientRect) return burst(undefined, undefined, n);
  const r = el.getBoundingClientRect();
  const visible = r.bottom > 0 && r.top < innerHeight;
  return visible ? burst(r.left + r.width / 2, r.top + Math.min(r.height / 2, 60), n) : burst(undefined, undefined, n);
}

// ── The switch ─────────────────────────────────────────────────────────
export function setFx(on) {
  document.documentElement.classList.toggle("fx-off", !on);
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* a convenience only */ }
  if (!on) {
    $("osGlow")?.classList.remove("on");
    FX.bits = [];
    document.querySelectorAll(".fx-wait").forEach((n) => n.classList.remove("fx-wait"));
  }
}

export function initFx() {
  let saved = "on";
  try { saved = localStorage.getItem(KEY) || "on"; } catch { /* no storage: on */ }
  document.documentElement.classList.toggle("fx-off", saved === "off");
  addEventListener("pointermove", move, { passive: true });
  document.documentElement.addEventListener("mouseleave", () => $("osGlow")?.classList.remove("on"));
  addEventListener("pointerdown", (e) => {
    if (e.target.closest?.("button, a, select, .chip, input[type=range], [data-go]")) sparks(e.clientX, e.clientY);
  }, { passive: true });
  addEventListener("resize", () => { const c = $("osCanvas"); if (c && !FX.loop) { c.width = 0; c.height = 0; } });
  // If motion gets reduced while the page is open, nothing stays hidden.
  calm.addEventListener?.("change", () => { if (calm.matches) document.querySelectorAll(".fx-wait").forEach((n) => n.classList.remove("fx-wait")); });
  // The store workspace (the earlier page) hands its effects to this module.
  window.__fx = { burst, burstAt, enter, sparks };
}

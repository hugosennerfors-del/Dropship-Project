/* ── Formatering ─────────────────────────────────────────────────────── */
const L = "sv-SE", VAT = 0.25, ex = (v) => v / (1 + VAT);
const nf = (o) => new Intl.NumberFormat(L, o);
const fKr = nf({ style: "currency", currency: "SEK", maximumFractionDigits: 0 });
const fInt = nf({ maximumFractionDigits: 0 });
const ok = (v) => typeof v === "number" && Number.isFinite(v);
const kr = (v) => (ok(v) ? fKr.format(v) : "—");
const num = (v) => (ok(v) ? fInt.format(v) : "—");
const pct = (v, d = 1) => (ok(v) ? nf({ style: "percent", minimumFractionDigits: d, maximumFractionDigits: d }).format(v) : "—");
const mult = (v) => (ok(v) ? nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + "×" : "—");
const monthLabel = (m) => {
  if (!m) return "—";
  const [y, mm] = m.split("-").map(Number);
  return new Intl.DateTimeFormat(L, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, mm - 1, 1)));
};
const dateLabel = (iso) => (iso ? new Intl.DateTimeFormat(L, { dateStyle: "medium" }).format(new Date(iso)) : "—");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ── Marknader ───────────────────────────────────────────────────────────
   Varje land har sin egen momssats, så en kandidat kan inte räknas om med
   svenska 25 % bara för att listan är svensk. Banden för CPA-realism och
   bidrag är satta per marknad: ett brittiskt CPA på 12 £ är inte lågt bara
   för att talet är litet. De är grovt kalibrerade mot prisnivån i landet,
   inte mot dagsfärsk växelkurs — betyg jämförs därför inom en marknad. */
const MARKETS = {
  SE: { name: "Sverige", cur: "SEK", vat: 0.25, cpaBand: [60, 160], bufBand: [40, 450] },
  GB: { name: "Storbritannien", cur: "GBP", vat: 0.2, cpaBand: [4.5, 12], bufBand: [3, 34] },
  NO: { name: "Norge", cur: "NOK", vat: 0.25, cpaBand: [65, 175], bufBand: [45, 490] },
  DK: { name: "Danmark", cur: "DKK", vat: 0.25, cpaBand: [42, 112], bufBand: [28, 315] },
  DE: { name: "Tyskland", cur: "EUR", vat: 0.19, cpaBand: [5, 14], bufBand: [3.5, 39] },
  FI: { name: "Finland", cur: "EUR", vat: 0.255, cpaBand: [5, 14], bufBand: [3.5, 39] },
};
const market = (code) => MARKETS[code] ?? MARKETS.SE;
const HOME = "SE";

/* Belopp i kandidatens egen valuta. Ören bara där de betyder något: ett
   brittiskt pris är 29,99 £, ett svenskt är 699 kr. */
const moneyFmt = {};
const money = (v, cur = "SEK") => {
  if (!ok(v)) return "—";
  const d = cur === "SEK" || cur === "NOK" || cur === "DKK" ? 0 : 2;
  const key = cur + d;
  moneyFmt[key] ??= nf({ style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: d });
  return moneyFmt[key].format(v);
};

/* Sökningen i Metas publika annonsbibliotek. Den visar konkurrenternas
   aktiva annonser för samma produkttyp — referens för vinkel och format,
   inte material att kopiera. */
const adLibraryUrl = (q, country) =>
  "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=" + country +
  "&q=" + encodeURIComponent(q) + "&search_type=keyword_unordered&media_type=all";

/* ── Kandidatkalkyl. Samma formel som n8n-backenden. ─────────────────── */
function calcCandidate(row) {
  const [id, name, notes, cost, sale, ship, fee, cpa, units, created, country = HOME] = row;
  const u = units || 1;
  const m = market(country);
  const mex = (v) => v / (1 + m.vat);
  const contribution = mex(sale) * u - (mex(cost) * u + mex(ship) + mex(fee));
  const grossMargin = contribution / (mex(sale) * u);
  const expectedPoas = contribution / mex(cpa);
  const verdict = contribution <= 0 || expectedPoas < 1 ? "UNDVIK"
    : expectedPoas >= 1.5 && grossMargin >= 0.25 ? "SATSA" : "TESTA";
  return {
    id, name, notes, created,
    country: MARKETS[country] ? country : HOME, market: m, cur: m.cur, mex,
    ad: AD_PLANS[id] ?? null,
    inputs: { cost, sale, ship, fee, cpa, units: u },
    contribution, grossMargin, expectedPoas, verdict,
    breakEvenRoas: grossMargin > 0 ? 1 / grossMargin : null,
    netPerOrder: contribution - mex(cpa),
    cpaEx: mex(cpa),
  };
}
const CANDIDATES = RAW_CANDIDATES.map(calcCandidate);

/* ── Chansscore ──────────────────────────────────────────────────────────
   Fyra axlar. CPA-tolerans är INTE en egen: POAS faller till 1,00 exakt när
   CPA stigit med (expectedPoas − 1), så den ligger redan i axel 1.

   Banden är omkalibrerade. De första sattes efter en kandidatlista där allt
   låg mellan 85 och 210 kr i CPA; när dyrare produkter kom in mättade alla
   fyra axlarna samtidigt och tre kandidater fick 100 var. Ett betyg som inte
   skiljer de starkaste åt rangordnar ingenting. */
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const band = (v, lo, hi) => clamp(((v - lo) / (hi - lo)) * 100);
const WEIGHTS = { profit: 0.35, margin: 0.25, cpaRealism: 0.25, buffer: 0.15 };

function successScore(c) {
  const axes = [
    { key: "profit", label: "Förväntad lönsamhet", value: band(c.expectedPoas, 1, 2), weight: WEIGHTS.profit,
      note: `Förväntad POAS ${mult(c.expectedPoas)} mot break-even 1,00.` },
    { key: "margin", label: "Marginal", value: band(c.grossMargin, 0.25, 0.7), weight: WEIGHTS.margin,
      note: `Bruttomarginal ${pct(c.grossMargin, 0)} — buffert mot fel i inköps- och utpris.` },
    { key: "cpaRealism", label: "CPA-realism", value: band(c.inputs.cpa, c.market.cpaBand[0], c.market.cpaBand[1]), weight: WEIGHTS.cpaRealism,
      note: `Kalkylen antar ${money(c.inputs.cpa, c.cur)} per order i ${c.market.name}. Lågt antagande sänker betyget: hela utfallet hänger på det talet.` },
    { key: "buffer", label: "Bidrag per order", value: band(c.contribution, c.market.bufBand[0], c.market.bufBand[1]), weight: WEIGHTS.buffer,
      note: `${money(c.contribution, c.cur)} ex moms att betala annonsen med.` },
  ];
  const score = Math.round(axes.reduce((a, x) => a + x.value * x.weight, 0));
  const stress = [0, 0.25, 0.5].map((bump) => {
    const poas = c.contribution / (c.cpaEx * (1 + bump));
    return { bump, poas, net: c.contribution - c.cpaEx * (1 + bump), survives: poas >= 1 };
  });
  const sorted = [...axes].sort((a, b) => a.value - b.value);
  return {
    score, axes, stress,
    label: score >= 70 ? "Stark" : score >= 50 ? "Rimlig" : score >= 30 ? "Svag" : "Undvik",
    headroom: c.expectedPoas - 1,
    weakest: sorted[0], strongest: sorted[sorted.length - 1],
  };
}

function rankCandidates(list) {
  return list.map((c) => ({ c, r: successScore(c) })).sort((a, b) => {
    const av = a.c.expectedPoas >= 1 && a.c.contribution > 0;
    const bv = b.c.expectedPoas >= 1 && b.c.contribution > 0;
    if (av !== bv) return av ? -1 : 1;
    return b.r.score - a.r.score;
  });
}

/* Verklighetskoll. ENHETER: produkternas cac är ex moms, kandidatens cpa
   inkl moms. Utan omräkning ser varje kandidat 25 % dyrare ut än den är. */
function realityCheck(c) {
  const live = PRODUCTS.filter((p) => p.f.adSpend > 0 && p.f.cac > 0);
  const cacs = live.map((p) => p.f.cac), margins = live.map((p) => p.f.grossMargin);
  const low = cacs.length ? Math.min(...cacs) : null, high = cacs.length ? Math.max(...cacs) : null;
  return {
    applicable: c.country === HOME,
    assumedCpaEx: c.cpaEx, basis: live.length,
    cacLow: low, cacHigh: high,
    marginLow: margins.length ? Math.min(...margins) : null,
    marginHigh: margins.length ? Math.max(...margins) : null,
    cpaBelowAchieved: low != null && c.cpaEx < low,
    marginAboveAchieved: margins.length > 0 && c.grossMargin > Math.max(...margins),
  };
}

/* ── Etiketter ───────────────────────────────────────────────────────── */
const STATUS = {
  scale: ["Skala", "p-pos"], profit: ["Lönsam", "p-pos"],
  watch: ["Bevaka", "p-warn"], cut: ["Skär", "p-neg"],
};
const statusMeta = (s) => STATUS[s] ?? ["Okänd", "p-neu"];
const VERDICT = { SATSA: ["SATSA", "p-pos"], TESTA: ["TESTA", "p-warn"], UNDVIK: ["UNDVIK", "p-neg"] };
const verdictMeta = (v) => VERDICT[v] ?? [v || "Okänd", "p-neu"];
const ORIGIN = {
  real: ["Verklig data", "b-real"], computed: ["Beräknad", "b-calc"],
  "ai-generated": ["AI", "b-ai"], "ai-estimated": ["AI-uppskattning", "b-est"],
};
const badge = (o, note) => {
  const [lab, cls] = ORIGIN[o] ?? ["Okänd", "b-est"];
  return `<span class="badge ${cls}"${note ? ` title="${esc(note)}"` : ""}><i></i>${lab}</span>`;
};
const pill = (label, cls) => `<span class="pill ${cls}">${esc(label)}</span>`;
const signColor = (v) => (v >= 0 ? "var(--pos-ink)" : "var(--neg-ink)");

/* ── Små byggstenar ──────────────────────────────────────────────────── */
const sec = (title, origin, note, body, actions = "") => `
  <section class="glass sec">
    <div class="sec-h"><div class="l"><h2>${esc(title)}</h2>${origin ? badge(origin, note) : ""}</div>${actions}</div>
    ${body}
  </section>`;

const kpi = (lab, val, sub, color) => `
  <div class="glass kpi">
    <p class="lab">${esc(lab)}</p>
    <p class="val num"${color ? ` style="color:${color}"` : ""}>${val}</p>
    ${sub ? `<p class="sub">${sub}</p>` : ""}
  </div>`;

const poasBar = (poas, showScale) => {
  const w = Math.max(1.5, Math.min((poas / 2) * 100, 100));
  return `<div class="poas" role="img" aria-label="POAS ${mult(poas)}, break-even 1,00">
      <i style="width:${w}%;background:${poas >= 1 ? "var(--pos)" : "var(--neg)"}"></i>
      <b style="left:50%"></b>
    </div>${showScale ? `<div style="display:flex;justify-content:space-between;margin-top:6px" class="muted">
      <span>0</span><span style="color:var(--neg-ink);font-weight:500">break-even 1,00</span><span>2,0+</span></div>` : ""}`;
};

const axisBar = (a) => `
  <div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px">
      <dt style="font-size:12.5px;color:var(--ink2)">${esc(a.label)} <span class="muted">${Math.round(a.weight * 100)} %</span></dt>
      <dd class="num" style="margin:0;font-size:12.5px;font-weight:600">${Math.round(a.value)}</dd>
    </div>
    <div class="bar"><i style="width:${clamp(a.value)}%"></i></div>
    <p class="muted" style="margin:4px 0 0">${esc(a.note)}</p>
  </div>`;

const stressTable = (r) => `
  <div class="scroll"><table style="min-width:320px">
    <thead><tr><th>Om CPA blir</th><th class="r">POAS</th><th class="r">Netto/order</th><th class="r">Bär sig</th></tr></thead>
    <tbody>${r.stress.map((s) => `
      <tr><td style="color:var(--ink2)">${s.bump === 0 ? "som gissat" : "+" + Math.round(s.bump * 100) + " %"}</td>
      <td class="r num" style="font-weight:600;color:${s.survives ? "var(--pos-ink)" : "var(--neg-ink)"}">${mult(s.poas)}</td>
      <td class="r num" style="color:${signColor(s.net)}">${kr(s.net)}</td>
      <td class="r" style="font-weight:500;color:${s.survives ? "var(--pos-ink)" : "var(--neg-ink)"}">${s.survives ? "Ja" : "Nej"}</td></tr>`).join("")}
    </tbody></table></div>`;

const sparkOne = (label) => `<span class="muted" style="white-space:nowrap">&#9679; ${esc(label)}</span>`;
const emptyBox = (t, s) => `<div class="empty"><p>${esc(t)}</p>${s ? `<small>${esc(s)}</small>` : ""}</div>`;

/* ── Vyer ────────────────────────────────────────────────────────────── */
const K = OVERVIEW.kpis;
const productBySku = (sku) => PRODUCTS.find((p) => p.sku === sku);

function viewOverview() {
  const top = [...PRODUCTS].sort((a, b) => b.score - a.score);
  return `
  <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,2fr)" data-stack>
    ${sec("Business Health Score", "computed", "POAS 45 % · nettomarginal 35 % · andel över break-even 20 %.", `
      <div style="display:flex;align-items:flex-end;gap:12px">
        <span class="num" style="font-size:38px;font-weight:600;line-height:1">${OVERVIEW.healthScore}</span>
        <span class="muted" style="padding-bottom:4px">/ 100</span>
        <span style="margin-left:auto;padding-bottom:4px;font-size:13px;font-weight:500;color:var(--ink2)">${esc(OVERVIEW.healthLabel)}</span>
      </div>
      <div class="meter" style="margin-top:12px"><i style="width:${OVERVIEW.healthScore}%;background:${OVERVIEW.healthScore >= 55 ? "var(--pos)" : OVERVIEW.healthScore >= 35 ? "var(--warn)" : "var(--neg)"}"></i></div>
      <dl style="margin-top:20px;display:grid;gap:14px">
        ${[["POAS", OVERVIEW.breakdown.poas], ["Nettomarginal", OVERVIEW.breakdown.margin], ["Andel över break-even", OVERVIEW.breakdown.winShare]]
          .map(([l, v]) => `<div><div style="display:flex;justify-content:space-between;align-items:baseline">
            <dt style="font-size:12.5px;color:var(--ink2)">${l}</dt><dd class="num" style="margin:0;font-size:12.5px;font-weight:600">${v}</dd></div>
            <div class="bar"><i style="width:${v}%"></i></div></div>`).join("")}
      </dl>
      <p class="muted" style="margin:20px 0 0;border-top:1px solid var(--hair);padding-top:16px">
        ${num(K.winners)} av ${num(K.productCount)} produkter bär sin annonskostnad.</p>`)}

    ${sec("AI-sammanfattning", "ai-generated", "Genererat av språkmodell utifrån dina egna siffror.", `
      <p class="note">${esc(AI.healthNarrative)}</p>
      <div style="margin-top:20px;border-top:1px solid var(--hair);padding-top:16px">
        <h3 class="lab" style="font-size:12px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--ink3)">Nästa steg</h3>
        <ol style="margin:10px 0 0;padding:0;list-style:none;display:grid;gap:8px">
          ${AI.nextActions.map((a, i) => `<li style="display:flex;gap:10px"><span class="num" style="font-size:11px;font-weight:600;color:var(--series);padding-top:3px">${i + 1}</span><span class="note">${esc(a)}</span></li>`).join("")}
        </ol>
      </div>
      <a class="chip" style="margin-top:18px" href="#/insights">Alla rekommendationer och risker &rarr;</a>`)}
  </div>

  <div class="cards" style="margin-top:16px">
    ${kpi("Intäkt ex moms", kr(K.revenueExVat), `${num(K.orders)} ordrar · ${num(K.units)} enheter`)}
    ${kpi("AOV", kr(K.aov), "Snittordervärde ex moms")}
    ${kpi("Annonskostnad", kr(K.adSpend), `CPA ${kr(K.adSpend / K.orders)}`)}
    ${kpi("Täckningsbidrag", kr(K.contribution), `Marginal ${pct(K.contribMargin)}`, signColor(K.contribution))}
    ${kpi("Nettovinst", kr(K.netProfit), `Nettomarginal ${pct(K.netMargin)}`, signColor(K.netProfit))}
    ${kpi("POAS", mult(K.poas), K.poas >= 1 ? "Över break-even" : "Under break-even", signColor(K.poas - 1))}
    ${kpi("ROAS", mult(K.roas), "Jämför mot produktens break-even")}
    ${kpi("Vinnare / förlorare", `${num(K.winners)} / ${num(K.losers)}`, `${num(K.candidateCount)} kandidater i research`)}
  </div>

  <div style="margin-top:16px">
  ${sec("Produkter med högst Opportunity Score", "computed", "Lönsamhet 40 % · marginal 25 % · efterfrågetrend 35 %.", `
    <ul style="margin:0;padding:0;list-style:none">
      ${top.map((p) => `<li style="border-top:1px solid var(--hair)">
        <a href="#/produkt?sku=${encodeURIComponent(p.sku)}" style="display:flex;align-items:center;gap:16px;padding:12px 8px;margin:0 -8px;border-radius:10px;text-decoration:none">
          <span style="flex:1;min-width:0">
            <span style="display:block;font-size:13.5px;font-weight:500">${esc(p.name)}</span>
            <span class="muted">${esc(p.scoreLabel)} · ${p.score}/100</span>
          </span>
          ${sparkOne("1 mån data")}
          <span style="width:84px;text-align:right">
            <span class="num" style="display:block;font-size:13px;font-weight:600">${mult(p.f.poas)}</span>
            <span class="muted">POAS</span>
          </span>
          ${pill(...statusMeta(p.status))}
        </a></li>`).join("")}
    </ul>`, `<a class="chip" href="#/products">Alla produkter &rarr;</a>`)}
  </div>

  <div style="margin-top:16px">
  ${sec("Larm", "computed", "Beräknade tröskelvärden i backenden, inte AI.", `
    <ul style="margin:0;padding:0;list-style:none;display:grid;gap:10px">${ALERTS.map(alertRow).join("")}</ul>`,
    `<a class="chip" href="#/alerts">Alla larm &rarr;</a>`)}
  </div>

  <div style="margin-top:16px">
  ${sec("Datakällor", null, null, `
    <ul style="margin:0;padding:0;list-style:none;display:grid;gap:10px">
      ${META.sources.map(([k, label, origin, note]) => `<li style="display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px">
        ${badge(origin)}<span style="font-size:13px;font-weight:500">${esc(label)}</span>
        <span class="muted">${esc(note)}</span></li>`).join("")}
    </ul>`)}
  </div>`;
}

function alertRow([severity, product, type, message]) {
  const crit = severity === "critical";
  const p = product ? PRODUCTS.find((x) => x.name === product) : null;
  return `<li class="alert ${crit ? "a-crit" : "a-warn"}">
    <span style="color:${crit ? "var(--neg-ink)" : "var(--warn-ink)"};flex-shrink:0;padding-top:1px">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
      ${crit ? '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16.5h.01"/>' : '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'}
      </svg></span>
    <span style="flex:1;min-width:0">
      <span style="display:block;font-size:13px;line-height:1.55">${esc(message)}</span>
      <span class="muted" style="display:flex;flex-wrap:wrap;gap:4px 8px;margin-top:4px">
        <b style="color:${crit ? "var(--neg-ink)" : "var(--warn-ink)"}">${crit ? "Kritisk" : "Varning"}</b>
        <span>·</span><span>${esc(type)}</span>
        ${p ? `<span>·</span><a href="#/produkt?sku=${encodeURIComponent(p.sku)}" style="color:var(--series);font-weight:500">${esc(p.name)}</a>` : ""}
      </span>
    </span></li>`;
}

let sortKey = "score", sortDir = "desc", prodFilter = "all";

function viewProducts() {
  const cols = [
    ["name", "Produkt", "l", (p) => p.name.toLowerCase()],
    ["status", "Status", "l", (p) => p.f.poas],
    ["orders", "Ordrar", "r", (p) => p.f.orders],
    ["revenue", "Intäkt ex moms", "r", (p) => p.f.revenueExVat],
    ["ad", "Annons", "r", (p) => p.f.adSpend],
    ["poas", "POAS", "r", (p) => p.f.poas],
    ["roas", "ROAS", "r", (p) => p.f.roas],
    ["be", "Break-even ROAS", "r", (p) => p.f.breakEvenRoas ?? Infinity],
    ["margin", "Marginal", "r", (p) => p.f.grossMargin],
    ["net", "Nettovinst", "r", (p) => p.f.netProfit],
    ["score", "Opportunity", "r", (p) => p.score],
  ];
  const isWin = (p) => p.status === "scale" || p.status === "profit";
  const rows = PRODUCTS.filter((p) => prodFilter === "winners" ? isWin(p) : prodFilter === "losers" ? !isWin(p) : true);
  const col = cols.find((c) => c[0] === sortKey) ?? cols[0];
  rows.sort((a, b) => {
    const va = col[3](a), vb = col[3](b);
    const cmp = typeof va === "string" ? va.localeCompare(vb, "sv") : va - vb;
    return sortDir === "asc" ? cmp : -cmp;
  });
  const counts = { all: PRODUCTS.length, winners: PRODUCTS.filter(isWin).length, losers: PRODUCTS.filter((p) => !isWin(p)).length };

  const body = `
    <div class="filters">
      ${[["all", "Alla"], ["winners", "Vinnare"], ["losers", "Förlorare"]].map(([k, l]) =>
        `<button class="fbtn" data-filter="${k}" aria-pressed="${prodFilter === k}">${l} <span class="num" style="opacity:.7">(${counts[k]})</span></button>`).join("")}
      <span class="muted" style="margin-left:auto">Vinnare = POAS &ge; 1,00</span>
    </div>
    ${rows.length === 0 ? emptyBox("Inga produkter matchar filtret.") : `
    <div class="scroll" data-desk><table style="min-width:1000px">
      <thead><tr>${cols.map((c) => `<th class="${c[2]}"><button data-sort="${c[0]}" style="border:0;background:0;padding:0;font:inherit;color:${sortKey === c[0] ? "var(--ink)" : "var(--ink3)"};font-weight:${sortKey === c[0] ? 600 : 500}">${c[1]}<span style="opacity:${sortKey === c[0] ? 1 : 0}">${sortDir === "asc" ? " ↑" : " ↓"}</span></button></th>`).join("")}</tr></thead>
      <tbody>${rows.map((p) => `<tr>
        <td style="max-width:250px"><a href="#/produkt?sku=${encodeURIComponent(p.sku)}" style="font-weight:500;text-decoration:none">${esc(p.name)}</a>
          <span style="display:block;margin-top:3px">${sparkOne("1 mån data")}</span></td>
        <td>${pill(...statusMeta(p.status))}</td>
        <td class="r num">${num(p.f.orders)}</td>
        <td class="r num">${kr(p.f.revenueExVat)}</td>
        <td class="r num">${kr(p.f.adSpend)}</td>
        <td class="r"><span class="num" style="font-weight:600;color:${signColor(p.f.poas - 1)}">${mult(p.f.poas)}</span>
          <span style="display:block;margin-top:6px">${poasBar(p.f.poas, false)}</span></td>
        <td class="r num">${mult(p.f.roas)}</td>
        <td class="r num" style="color:var(--ink2)">${p.f.breakEvenRoas == null ? "—" : mult(p.f.breakEvenRoas)}</td>
        <td class="r num">${pct(p.f.grossMargin)}</td>
        <td class="r num" style="font-weight:600;color:${signColor(p.f.netProfit)}">${kr(p.f.netProfit)}</td>
        <td class="r"><span class="num" style="font-weight:600">${p.score}</span><span class="muted" style="display:block">${esc(p.scoreLabel)}</span></td>
      </tr>`).join("")}</tbody></table></div>
    <ul data-mob style="display:none;margin:0;padding:0;list-style:none;gap:12px">
      ${rows.map((p) => `<li style="border:1px solid rgba(255,255,255,.6);background:rgba(255,255,255,.45);border-radius:14px;padding:16px">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
          <a href="#/produkt?sku=${encodeURIComponent(p.sku)}" style="font-size:13.5px;font-weight:600;text-decoration:none">${esc(p.name)}</a>
          ${pill(...statusMeta(p.status))}
        </div>
        <dl style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;border-top:1px solid var(--hair);padding-top:12px">
          ${[["POAS", mult(p.f.poas), signColor(p.f.poas - 1)], ["Nettovinst", kr(p.f.netProfit), signColor(p.f.netProfit)],
             ["Ordrar", num(p.f.orders), ""], ["Marginal", pct(p.f.grossMargin), ""]].map(([l, v, c]) =>
            `<div style="display:flex;justify-content:space-between;gap:8px"><dt class="muted">${l}</dt><dd class="num" style="margin:0;font-size:12.5px;font-weight:600${c ? `;color:${c}` : ""}">${v}</dd></div>`).join("")}
        </dl>
        <div style="margin-top:12px">${poasBar(p.f.poas, false)}</div>
      </li>`).join("")}
    </ul>`}`;
  return sec("Produkter", "real", "Försäljning och annonskostnad från backenden. Opportunity Score är beräknad.", body);
}

function viewProduct(sku) {
  const p = productBySku(sku);
  if (!p) return `<div class="glass sec">${emptyBox("Produkten finns inte i den här perioden.", sku ? `Ingen produkt med SKU "${sku}".` : "Ingen produkt vald.")}
    <p style="text-align:center;margin:16px 0 0"><a class="chip" href="#/products">&larr; Tillbaka till alla produkter</a></p></div>`;
  const f = p.f, d = p.demand, ai = p.ai;
  const stat = (l, v, c) => `<div class="flat stat"><dt>${l}</dt><dd class="num"${c ? ` style="color:${c}"` : ""}>${v}</dd></div>`;
  const bullets = (items, empty) => items.length
    ? `<ul style="margin:0;padding:0;list-style:none;display:grid;gap:8px">${items.map((i) => `<li style="display:flex;gap:10px"><span style="width:6px;height:6px;border-radius:99px;background:var(--series);margin-top:7px;flex-shrink:0"></span><span class="note">${esc(i)}</span></li>`).join("")}</ul>`
    : `<p class="muted" style="font-style:italic">${empty}</p>`;

  return `
  <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;margin-bottom:20px">
    <div style="min-width:0">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px">
        <h2 style="font-size:19px;font-weight:600">${esc(p.name)}</h2>${pill(...statusMeta(p.status))}
      </div>
      <p class="muted" style="margin:5px 0 0">${monthLabel(META.period)} · SKU ${esc(p.sku)}${p.campaign ? ` · Kampanj ${esc(p.campaign)}` : " · Ingen kampanj mappad"}</p>
    </div>
    <a class="chip" href="#/products">&larr; Alla produkter</a>
  </div>

  <div style="display:grid;gap:16px">
    ${sec("AI Verdict", "ai-generated", "Genererat av språkmodell utifrån produktens egna siffror.",
      `<p style="font-size:20px;font-weight:600;letter-spacing:-.01em">${esc(ai.verdict)}</p>
       <p class="note" style="margin-top:10px">${esc(ai.verdictReason)}</p>`)}

    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.4fr)" data-stack>
      ${sec("Product Opportunity Score", "computed", "Lönsamhet 40 % · marginal 25 % · efterfrågetrend 35 %.", `
        <div style="display:flex;align-items:flex-end;gap:12px">
          <span class="num" style="font-size:38px;font-weight:600;line-height:1">${p.score}</span>
          <span class="muted" style="padding-bottom:4px">/ 100</span>
          <span style="margin-left:auto;padding-bottom:4px;font-size:13px;font-weight:500;color:var(--ink2)">${esc(p.scoreLabel)}</span>
        </div>
        <div class="meter" style="margin-top:12px"><i style="width:${p.score}%"></i></div>
        <dl style="margin-top:20px;display:grid;gap:14px">
          ${[["Lönsamhet (40 %)", p.sb.profitability], ["Marginal (25 %)", p.sb.margin], ["Efterfrågetrend (35 %)", p.sb.demand]]
            .map(([l, v]) => `<div><div style="display:flex;justify-content:space-between;align-items:baseline">
              <dt style="font-size:12.5px;color:var(--ink2)">${l}</dt><dd class="num" style="margin:0;font-size:12.5px;font-weight:600">${v}</dd></div>
              <div class="bar"><i style="width:${v}%"></i></div></div>`).join("")}
        </dl>
        <p class="note" style="margin-top:20px;border-top:1px solid var(--hair);padding-top:16px">${esc(ai.scoreSummary)}</p>`)}

      ${sec("Demand", "real", "Egna månatliga ordrar (v_product_period).", `
        <div style="border:1px solid var(--hair);background:rgba(255,255,255,.4);border-radius:14px;padding:20px">
          <p class="lab" style="margin:0;font-size:12px;font-weight:500;letter-spacing:.03em;text-transform:uppercase;color:var(--ink3)">${d.monthsOfData} mån data</p>
          <p class="num" style="margin:8px 0 0;font-size:26px;font-weight:600">${num(d.series[0].orders)} <span style="font-size:14px;font-weight:400;color:var(--ink2)">ordrar</span></p>
          <p class="note" style="margin:4px 0 0">${monthLabel(d.series[0].month)} · ${kr(d.series[0].revenueExVat)} ex moms</p>
          <p class="muted" style="margin:12px 0 0;border-top:1px solid var(--hair);padding-top:12px">En månad räcker inte för att avgöra en riktning. Ingen trend visas.</p>
        </div>`)}
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr" data-stack>
      ${sec("Customer Voice", "ai-estimated", "Ingen fri recensions-API — AI-uppskattning.", `<p class="note">${esc(ai.customerVoice)}</p>`)}
      ${sec("Competition", "ai-estimated", "Ingen fri konkurrent-API — AI-uppskattning.", `<p class="note">${esc(ai.competition)}</p>`)}
    </div>

    ${sec("Ads", "real", "Supabase orders/order_lines/ad_spend.", `
      <p class="muted" style="margin:0 0 16px">Kampanj: <b style="color:var(--ink2);font-weight:500">${esc(p.campaign ?? "ingen mappad")}</b></p>
      <dl class="cards" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        ${stat("Annonskostnad", kr(f.adSpend))}${stat("CAC", kr(f.cac))}
        ${stat("ROAS", mult(f.roas))}${stat("POAS", mult(f.poas), signColor(f.poas - 1))}
      </dl>
      <div style="margin-top:20px">${poasBar(f.poas, true)}</div>
      <p class="note" style="margin-top:10px">${f.poas >= 1
        ? `Varje annonskrona ger ${mult(f.poas)} i täckningsbidrag.`
        : `Varje annonskrona ger bara ${mult(f.poas)} i täckningsbidrag. CAC ${kr(f.cac)} mot bidrag ${kr(f.contributionPerOrder)} per order.`}</p>`)}

    ${sec("Financials", "real", "Supabase orders/order_lines/ad_spend.", `
      <dl class="cards" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        ${stat("Intäkt ex moms", kr(f.revenueExVat))}${stat("Ordrar", num(f.orders))}${stat("AOV", kr(f.aov))}
        ${stat("Täckningsbidrag", kr(f.contribution), signColor(f.contribution))}
        ${stat("Bidrag per order", kr(f.contributionPerOrder))}
        ${stat("Nettovinst", kr(f.netProfit), signColor(f.netProfit))}
        ${stat("Bruttomarginal", pct(f.grossMargin))}
        ${stat("Break-even ROAS", f.breakEvenRoas == null ? "—" : mult(f.breakEvenRoas))}
        ${stat("Returgrad", pct(f.returnRate))}${stat("Enheter", num(f.units))}${stat("Intäkt inkl moms", kr(f.revenueInclVat))}
      </dl>
      ${f.breakEvenRoas != null ? `<p class="note" style="margin-top:16px">Marginalen ${pct(f.grossMargin)} kräver ROAS ${mult(f.breakEvenRoas)} för att gå jämnt ut. Faktisk ROAS är ${mult(f.roas)} — ${f.roas >= f.breakEvenRoas ? "över kravet." : "under kravet."}</p>` : ""}`)}

    ${sec("Market", "ai-estimated", "Ingen fri söktrend-API — AI-uppskattning.", `<p class="note">${esc(ai.market)}</p>`)}
    ${sec("AI Analysis", "ai-generated", "Språkmodellens sammanfattning av vad som driver scoren.", `<p class="note">${esc(ai.scoreSummary)}</p>`)}

    <div class="grid" style="grid-template-columns:1fr 1fr" data-stack>
      ${sec("Opportunities", "ai-generated", "AI-genererade uppslag, inte verifierade.", bullets(ai.opportunities, "Inga möjligheter genererade."))}
      ${sec("Risks", "ai-generated", "AI-genererade risker, inte verifierade.", bullets(ai.risks, "Inga risker genererade."))}
    </div>
  </div>`;
}

let showRejected = false;
let query = "";
let countryFilter = "ALL";

/* Länder som faktiskt förekommer i listan, i den ordning MARKETS räknar upp
   dem. Ett land utan kandidater får ingen knapp — annars vore hälften döda. */
const COUNTRIES = Object.keys(MARKETS).filter((k) => RAW_CANDIDATES.some((r) => (r[10] ?? HOME) === k));

/* Sökning över namn, anteckning, land och annonsupplägg. Diakritiklös
   jämförelse, så "plånbok" hittas även när man skriver "planbok". Flera ord
   = alla måste finnas. */
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const haystack = (c) => {
  const a = c.ad ?? {};
  return norm([c.name, c.notes, c.verdict, c.market.name, c.country,
    a.q, a.angle, a.hook, a.format, a.audience, a.primaryText, a.headline,
    ...(a.script ?? [])].join(" "));
};
function matches(c, q) {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = haystack(c);
  return terms.every((t) => hay.includes(t));
}

function viewResearch() {
  const hits = CANDIDATES.filter((c) => (countryFilter === "ALL" || c.country === countryFilter) && matches(c, query));
  const worth = hits.filter((c) => c.verdict !== "UNDVIK");
  const rejected = hits.length - worth.length;
  const shown = showRejected ? hits : worth;
  const ranked = rankCandidates(shown);
  const best = rankCandidates(worth);

  const bestBet = best.length ? (() => {
    const { c, r } = best[0];
    const runners = best.slice(1, 4);
    return `
    <section class="glass" style="overflow:hidden;padding:0">
      <div class="rule" style="height:3px"></div>
      <div style="padding:20px">
        <div class="sec-h"><div class="l"><h2>Bästa chansen</h2>${badge("computed", "Förväntad lönsamhet 35 % · marginal 25 % · CPA-realism 25 % · bidrag 15 %.")}</div></div>
        <div class="grid" style="grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)" data-stack>
          <div>
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
              <a href="#/kandidat?id=${c.id}" style="font-size:17px;font-weight:600;line-height:1.35;text-decoration:none">${esc(c.name)}</a>
              ${pill(...verdictMeta(c.verdict))}
            </div>
            <p class="muted" style="margin:5px 0 0">${money(c.inputs.cost, c.cur)} &rarr; ${money(c.inputs.sale, c.cur)} inkl moms · ${esc(c.market.name)}</p>
            <div style="display:flex;align-items:flex-end;gap:12px;margin-top:16px">
              <span class="num" style="font-size:40px;font-weight:600;line-height:1">${r.score}</span>
              <span class="muted" style="padding-bottom:4px">/ 100</span>
              <span style="margin-left:auto;padding-bottom:4px;font-size:13px;font-weight:500;color:var(--ink2)">${r.label}</span>
            </div>
            <div class="meter" style="margin-top:12px"><i style="width:${r.score}%"></i></div>
            <dl style="margin-top:20px;display:grid;gap:14px">${r.axes.map(axisBar).join("")}</dl>
          </div>
          <div>
            <h3 class="lab" style="font-size:12px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--ink3)">Tål kalkylen att ha fel?</h3>
            <p class="note" style="margin:6px 0 12px">CPA:n är gissad. Ordern slutar bära sig när CPA stigit ${pct(r.headroom, 0)}.</p>
            ${stressTable(r)}
            <div style="margin-top:20px;border-top:1px solid var(--hair);padding-top:16px;display:grid;gap:10px">
              <p class="note"><b style="color:var(--pos-ink)">Starkast:</b> ${esc(r.strongest.label.toLowerCase())} — ${esc(r.strongest.note)}</p>
              <p class="note"><b style="color:var(--neg-ink)">Svagast:</b> ${esc(r.weakest.label.toLowerCase())} — ${esc(r.weakest.note)}</p>
            </div>
          </div>
        </div>
        ${runners.length ? `<div style="margin-top:24px;border-top:1px solid var(--hair);padding-top:16px">
          <h3 class="lab" style="font-size:12px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--ink3)">Närmast efter</h3>
          <ol style="margin:10px 0 0;padding:0;list-style:none;display:grid;gap:6px">
            ${runners.map(({ c: rc, r: rr }, i) => `<li style="display:flex;align-items:center;gap:12px;font-size:12.5px">
              <span class="num muted" style="width:16px">${i + 2}</span>
              <a href="#/kandidat?id=${rc.id}" style="flex:1;min-width:0;color:var(--ink2);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(rc.name)}</a>
              <span class="muted">${esc(rc.market.name)}</span>
              <span class="num muted">${mult(rc.expectedPoas)}</span>
              <span class="num" style="width:32px;text-align:right;font-weight:600">${rr.score}</span></li>`).join("")}
          </ol></div>` : ""}
        <p class="muted" style="margin:20px 0 0;border-top:1px solid var(--hair);padding-top:16px">
          Rangordningen är deterministisk, men den rangordnar <b>uppskattningar</b>. Inköpspris, utpris och CPA är
          AI-gissningar, inte uppmätta tal — därför väger modellen ner kandidater vars kalkyl vilar på en osannolikt låg CPA.</p>
      </div>
    </section>`;
  })() : "";

  const grid = ranked.length === 0
    ? (query && hits.length === 0 ? "" : emptyBox("Ingen kandidat nådde upp till TESTA.", `Alla ${hits.length} föll på att bidraget inte täcker den förväntade annonskostnaden.`))
    : `<div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(290px,1fr))">
        ${ranked.map(({ c, r }, i) => `
        <article class="glass" style="padding:20px;display:flex;flex-direction:column">
          <header style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
            <div style="min-width:0">
              <h3 style="font-size:14.5px;font-weight:600;line-height:1.35;display:flex;gap:8px;align-items:baseline">
                <span class="num muted" style="flex-shrink:0">${i + 1}</span>
                <a href="#/kandidat?id=${c.id}" style="text-decoration:none">${esc(c.name)}</a>
              </h3>
              <p class="muted" style="margin:5px 0 0">${esc(c.market.name)} · ${dateLabel(c.created)}</p>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
              ${pill(...verdictMeta(c.verdict))}<span class="num muted">Chans ${r.score}</span>
            </div>
          </header>
          <p class="note" style="margin:12px 0 ${c.ad?.hook ? "10px" : "16px"}">${esc(c.notes)}</p>
          ${c.ad?.hook ? `<p class="note" style="margin:0 0 16px;padding-left:10px;border-left:2px solid rgba(79,70,229,.3);color:var(--ink2)">${esc(c.ad.hook)}</p>` : ""}
          <dl class="rows" style="margin-top:auto">
            ${[["Bidrag per order", money(c.contribution, c.cur), signColor(c.contribution)],
               ["Bruttomarginal", pct(c.grossMargin), ""],
               ["Break-even ROAS", c.breakEvenRoas == null ? "—" : mult(c.breakEvenRoas), ""],
               ["Förväntad POAS", mult(c.expectedPoas), signColor(c.expectedPoas - 1)],
               ["Netto per order", money(c.netPerOrder, c.cur), signColor(c.netPerOrder)]]
              .map(([l, v, col]) => `<div><dt>${l}</dt><dd class="num" style="font-weight:600${col ? `;color:${col}` : ""}">${v}</dd></div>`).join("")}
          </dl>
          <footer style="margin-top:16px;border-top:1px solid var(--hair);padding-top:12px;display:flex;justify-content:space-between;gap:12px;align-items:center">
            <a href="#/kandidat?id=${c.id}" style="font-size:12px;font-weight:500;color:var(--series);text-decoration:none">Öppna analys &rarr;</a>
            <span class="muted">${money(c.inputs.cost, c.cur)} &rarr; ${money(c.inputs.sale, c.cur)}</span>
          </footer>
        </article>`).join("")}
      </div>`;

  return `${bestBet}
    <div style="margin-top:16px">
    ${sec(`Kandidater (${shown.length})`, "real", "Sparade rader i product_candidates. Kalkylen är beräknad, siffrorna i den är AI-uppskattade.",
      `${COUNTRIES.length > 1 ? `<div class="filters" style="margin-bottom:12px">
        ${[["ALL", "Alla marknader", CANDIDATES.length], ...COUNTRIES.map((k) =>
          [k, MARKETS[k].name, CANDIDATES.filter((c) => c.country === k).length])].map(([k, l, cnt]) =>
          `<button class="fbtn" data-country="${k}" aria-pressed="${countryFilter === k}">${l} <span class="num" style="opacity:.7">(${cnt})</span></button>`).join("")}
        <span class="muted" style="margin-left:auto">Moms och valuta följer marknaden</span>
      </div>` : ""}
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px">
        <label style="position:relative;flex:1;min-width:220px">
          <span class="sr">Sök bland kandidater</span>
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
               style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--ink3)"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
          <input id="q" type="search" value="${esc(query)}" placeholder="Sök på produkt, vinkel, hook eller land…" autocomplete="off"
            style="width:100%;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:12px;
                   padding:10px 14px 10px 38px;font:inherit;font-size:13.5px;color:var(--ink)">
        </label>
        ${query ? `<button id="clearQ" class="fbtn">Rensa</button>` : ""}
        <span class="muted">${query ? `${hits.length} av ${CANDIDATES.length} matchar`
          : countryFilter === "ALL" ? `${CANDIDATES.length} kandidater`
          : `${hits.length} kandidater i ${MARKETS[countryFilter].name}`}</span>
      </div>
      ${query && hits.length === 0 ? emptyBox(`Inget matchar "${esc(query)}".`, "Prova ett kortare ord — sökningen träffar både produktnamn och anteckning.") : ""}
      ${rejected > 0 ? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;border:1px solid rgba(255,255,255,.6);background:rgba(255,255,255,.45);border-radius:14px;padding:10px 16px;margin-bottom:16px">
        <span class="note">${rejected} av ${hits.length} dolda — bidraget täcker inte den förväntade annonskostnaden.</span>
        <button id="toggleRejected" style="border:0;background:0;padding:0;font-size:12.5px;font-weight:500;color:var(--series);text-decoration:underline">${showRejected ? "Dölj dem igen" : "Visa dem ändå"}</button>
      </div>` : ""}${grid}`,
      `<span class="muted">Sorterade efter chansscore</span>`)}
    </div>`;
}

function viewCandidate(id) {
  const c = CANDIDATES.find((x) => x.id === id);
  if (!c) return `<div class="glass sec">${emptyBox("Kandidaten finns inte.", id ? `Ingen sparad kandidat med id "${id}".` : "Ingen kandidat vald.")}
    <p style="text-align:center;margin:16px 0 0"><a class="chip" href="#/research">&larr; Tillbaka till research</a></p></div>`;
  const r = successScore(c), rc = realityCheck(c), u = c.inputs.units;
  const row = (label, value, isSum, hint) => `
    <div${isSum ? ' class="sum"' : ""}>
      <dt${isSum ? ' style="font-size:13px;color:var(--ink)"' : ""}>${label}${hint ? ` <span class="muted">${hint}</span>` : ""}</dt>
      <dd class="num"${isSum ? ` style="font-weight:600;color:${signColor(value)}"` : value < 0 ? ' style="color:var(--ink2)"' : ""}>${value < 0 ? "− " + money(Math.abs(value), c.cur) : money(value, c.cur)}</dd>
    </div>`;

  return `
  <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;margin-bottom:20px">
    <div style="min-width:0">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px">
        <h2 style="font-size:19px;font-weight:600">${esc(c.name)}</h2>${pill(...verdictMeta(c.verdict))}
      </div>
      <p class="muted" style="margin:5px 0 0">${esc(c.market.name)} · ${c.cur} · moms ${pct(c.market.vat, 0)} · sparad ${dateLabel(c.created)}</p>
    </div>
    <a class="chip" href="#/research">&larr; All research</a>
  </div>

  <div class="callout c-warn" style="margin-bottom:16px">
    <b>Produkten har aldrig sålts.</b> Varenda siffra nedan är en uppskattning — inköpspris, utpris och framför allt
    CPA. Det finns ingen efterfrågehistorik, ingen kundröst och ingen uppmätt konkurrens att luta sig mot, till
    skillnad från produktsidorna.
  </div>

  <div style="display:grid;gap:16px">
    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.05fr)" data-stack>
      ${sec("Bedömning", "computed", "Förväntad lönsamhet 35 % · marginal 25 % · CPA-realism 25 % · bidrag 15 %.", `
        <div style="display:flex;align-items:flex-end;gap:12px">
          <span class="num" style="font-size:40px;font-weight:600;line-height:1">${r.score}</span>
          <span class="muted" style="padding-bottom:4px">/ 100</span>
          <span style="margin-left:auto;padding-bottom:4px;font-size:13px;font-weight:500;color:var(--ink2)">${r.label}</span>
        </div>
        <div class="meter" style="margin-top:12px"><i style="width:${r.score}%"></i></div>
        <dl style="margin-top:20px;display:grid;gap:14px">${r.axes.map(axisBar).join("")}</dl>`)}

      ${sec("Kalkylen, steg för steg", "computed", `Räknat på kandidatens indata. Alla belopp ex moms (${pct(c.market.vat, 0)} i ${c.market.name}).`, `
        <dl class="rows">
          ${row("Utpris", c.mex(c.inputs.sale) * u, false, u > 1 ? `${u} st` : "")}
          ${row("Varukostnad", -c.mex(c.inputs.cost) * u)}
          ${row("Frakt", -c.mex(c.inputs.ship))}
          ${row("Transaktionsavgift", -c.mex(c.inputs.fee))}
          ${row("Täckningsbidrag", c.contribution, true)}
          ${row("Förväntad annonskostnad", -c.cpaEx, false, "gissad")}
          ${row("Netto per order", c.netPerOrder, true)}
        </dl>
        <dl style="margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:12px;border-top:1px solid var(--hair);padding-top:16px">
          <div class="flat stat"><dt>Bruttomarginal</dt><dd class="num">${pct(c.grossMargin)}</dd></div>
          <div class="flat stat"><dt>Break-even ROAS</dt><dd class="num">${c.breakEvenRoas == null ? "—" : mult(c.breakEvenRoas)}</dd></div>
        </dl>`)}
    </div>

    ${sec("Tål kalkylen att ha fel?", "computed", "POAS och netto per order vid högre CPA än antaget.", `
      <p class="note" style="margin:0 0 12px">CPA är det enda talet ingen känner till på förhand, och hela utfallet
      hänger på det. Ordern slutar bära sig när CPA stigit ${pct(r.headroom, 0)} över gissningen.</p>
      ${stressTable(r)}`)}

    ${rc.applicable
      ? sec("Mot dina egna siffror", "real", "Jämförelsen använder dina liveprodukters faktiska utfall denna period.", `
      <dl class="cards" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
        <div class="flat stat"><dt>Antagen CPA (ex moms)</dt><dd class="num">${kr(rc.assumedCpaEx)}</dd></div>
        <div class="flat stat"><dt>Din faktiska CAC</dt><dd class="num">${kr(rc.cacLow)} – ${kr(rc.cacHigh)}</dd></div>
        <div class="flat stat"><dt>Din faktiska marginal</dt><dd class="num">${pct(rc.marginLow, 0)} – ${pct(rc.marginHigh, 0)}</dd></div>
      </dl>
      <div style="margin-top:16px;display:grid;gap:10px">
        ${rc.cpaBelowAchieved
          ? `<p class="callout c-neg">Kalkylen antar ${kr(rc.assumedCpaEx)} per order — <b>billigare än något du faktiskt har uppnått</b>
             (${kr(rc.cacLow)} som lägst på ${rc.basis} ${rc.basis === 1 ? "produkt" : "produkter"}). Håller inte det antagandet faller hela kalkylen.</p>`
          : `<p class="callout c-pos">Antagen CPA ${kr(rc.assumedCpaEx)} ligger inom det spann du faktiskt presterat. Antagandet är åtminstone inte orimligt.</p>`}
        ${rc.marginAboveAchieved
          ? `<p class="callout c-warn">Antagen marginal ${pct(c.grossMargin, 0)} är högre än något du haft (${pct(rc.marginHigh, 0)} som bäst).
             Kontrollera inköpspriset innan du räknar hem det.</p>` : ""}
      </div>
      <p class="muted" style="margin-top:16px">CPA räknas om till ex moms före jämförelsen — kandidatens tal anges inklusive moms,
      dina produkters CAC exklusive. Utan omräkning hade varje kandidat sett 25 % dyrare ut än den är.</p>`)
      : sec("Mot dina egna siffror", null, null, `
      <p class="callout c-warn"><b>Går inte att jämföra.</b> Alla dina liveprodukter säljs i ${MARKETS[HOME].name}, i ${MARKETS[HOME].cur}.
      Den här kandidaten är prissatt i ${c.cur} för ${c.market.name}, och en CAC i en valuta säger ingenting om en CPA i en annan —
      varken kursen eller auktionspriset på Meta är detsamma. Jämförelsen tänds av sig själv så fort du har en såld produkt i ${c.market.name}.</p>
      <p class="muted" style="margin-top:12px">Tills dess står CPA-antagandet ${money(c.inputs.cpa, c.cur)} helt oprövat. Behandla
      betyget som en rangordning mot övriga kandidater i ${c.market.name}, inte som ett löfte.</p>`)}

    ${(() => {
      const a = c.ad ?? {};
      const hasPlan = Boolean(a.angle || a.hook || a.primaryText);
      const url = adLibraryUrl(a.q || c.name, c.country);
      const field = (label, value) => value
        ? `<div><dt class="lab" style="font-size:11.5px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--ink3)">${label}</dt>
             <dd style="margin:4px 0 0;font-size:13px;line-height:1.5">${esc(value)}</dd></div>` : "";
      return sec("Annonsupplägg", hasPlan ? "ai-generated" : null,
        hasPlan ? "Vinkel, hook och manus från språkmodellen — egen kreativ, inte hämtad från någon annans annons." : null, `
        ${hasPlan ? `<dl style="display:grid;gap:16px;margin:0">
          ${field("Vinkel", a.angle)}
          ${field("Hook (första 3 sekunderna)", a.hook)}
          ${field("Format", a.format)}
          ${(a.script ?? []).length ? `<div><dt class="lab" style="font-size:11.5px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--ink3)">Manus</dt>
            <dd style="margin:6px 0 0"><ol style="margin:0;padding:0;list-style:none;display:grid;gap:8px">
              ${a.script.map((line, i) => `<li style="display:flex;gap:10px;font-size:13px;line-height:1.5">
                <span class="num" style="width:18px;height:18px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:99px;background:rgba(79,70,229,.12);color:var(--series-ink);font-size:10.5px;font-weight:600;margin-top:2px">${i + 1}</span>
                <span>${esc(line)}</span></li>`).join("")}
            </ol></dd></div>` : ""}
          ${field("Målgrupp att börja från", a.audience)}
          ${a.headline || a.primaryText ? `<div><dt class="lab" style="font-size:11.5px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--ink3)">Annonstext</dt>
            <dd style="margin:6px 0 0;border:1px solid rgba(255,255,255,.6);background:rgba(255,255,255,.45);border-radius:12px;padding:12px 14px">
              ${a.headline ? `<p style="margin:0;font-size:13.5px;font-weight:600">${esc(a.headline)}</p>` : ""}
              ${a.primaryText ? `<p class="note" style="margin:${a.headline ? "6px" : "0"} 0 0">${esc(a.primaryText)}</p>` : ""}
            </dd></div>` : ""}
        </dl>`
        : `<p class="note" style="margin:0">Den här kandidaten sparades innan annonsupplägg fanns, så vinkel och manus saknas.
           Nästa research-körning för samma nisch genererar dem.</p>`}
        <div style="margin-top:${hasPlan ? "20px" : "16px"};border-top:1px solid var(--hair);padding-top:16px">
          <a class="chip" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Konkurrenternas annonser i ${esc(c.market.name)} &rarr;</a>
          <p class="muted" style="margin-top:12px">Öppnar Metas publika annonsbibliotek på "${esc(a.q || c.name)}". Där ser du vilka
          annonser som faktiskt körs just nu för den här produkttypen — <b>som referens för vinkel och format</b>.
          Vinklar, hooktyper och klippformat är fria att återanvända. Själva filmen och texten i en annons är däremot
          upphovsrättsskyddad oavsett hur mycket eller lite du omsätter, och Meta stänger konton som kopierar rakt av.</p>
        </div>`);
    })()}

    ${c.notes ? sec("Anteckning", "ai-generated", "Motivering från språkmodellen som föreslog produkten.", `<p class="note">${esc(c.notes)}</p>`) : ""}

    ${sec("Det här vet vi inte", null, null, `
      <p class="muted" style="margin:-8px 0 16px">Sektioner som finns på en produktsida, men som saknar underlag för en kandidat.</p>
      <ul style="margin:0;padding:0;list-style:none;display:grid;gap:10px">
        ${[["Efterfrågan", "Ingen försäljningshistorik finns förrän produkten annonserats."],
           ["Kundröst", "Inga egna recensioner eller returorsaker att läsa av."],
           ["Konkurrens", "Ingen uppmätt konkurrens — bara språkmodellens allmänna intryck."],
           ["Returgrad", "Okänd. Den kan ensam äta upp hela bidraget ovan."]]
          .map(([t, d]) => `<li style="display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px">
            <b style="font-size:13px;font-weight:500">${t}</b><span class="muted">${d}</span></li>`).join("")}
      </ul>
      <p class="note" style="margin-top:16px;border-top:1px solid var(--hair);padding-top:16px">
        Enda sättet att fylla i dem är att köra ett test. Bidraget ${money(c.contribution, c.cur)} per order säger hur mycket varje
        order har att ge — och därmed hur snabbt ett test blir dyrt om CPA:n hamnar fel.</p>`)}
  </div>`;
}

function viewAlerts() {
  const crit = ALERTS.filter((a) => a[0] === "critical"), warn = ALERTS.filter((a) => a[0] === "warning");
  if (!ALERTS.length) return sec("Larm", "computed", "Beräknade tröskelvärden i backenden.", emptyBox("Inga larm den här perioden."));
  const list = (items) => `<ul style="margin:0;padding:0;list-style:none;display:grid;gap:10px">${items.map(alertRow).join("")}</ul>`;
  return `<div style="display:grid;gap:16px">
    ${crit.length ? sec(`Kritiskt (${crit.length})`, "computed", "POAS < 0,80 eller negativ portföljmarginal.", list(crit)) : ""}
    ${warn.length ? sec(`Varningar (${warn.length})`, "computed", "POAS under 1,00, returgrad över 10 % eller fallande efterfrågan.", list(warn)) : ""}
  </div>`;
}

function viewInsights() {
  const LEVEL = { high: ["Hög", "p-neg"], medium: ["Medel", "p-warn"], low: ["Låg", "p-neu"] };
  const links = (arr) => arr.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">${arr.map(([label, sku, kind]) =>
        `<a class="chip" href="${kind === "product" ? `#/produkt?sku=${encodeURIComponent(sku)}` : "#/research"}">${esc(label)} &rarr;</a>`).join("")}</div>` : "";
  const card = (r, levelKey, borderLeft) => `
    <li style="border:1px solid rgba(255,255,255,.6);${borderLeft}background:rgba(255,255,255,.45);border-radius:14px;padding:16px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <h3 style="font-size:13.5px;font-weight:600">${esc(r.title)}</h3>${pill(...(LEVEL[r[levelKey]] ?? LEVEL.low))}
      </div>
      <p class="note" style="margin-top:6px">${esc(r.detail)}</p>
      ${r.product ? `<p class="muted" style="margin-top:8px">Gäller: ${esc(r.product)}</p>` : ""}
      ${links(r.links)}
    </li>`;
  return `<div style="display:grid;gap:16px">
    ${sec("Sammanfattning", "ai-generated", "Genererat av språkmodell utifrån dina egna siffror.", `<p class="note">${esc(AI.healthNarrative)}</p>`)}
    ${sec(`Rekommendationer (${AI.recommendations.length})`, "ai-generated", "Prioriterade åtgärder från språkmodellen.",
      `<ul style="margin:0;padding:0;list-style:none;display:grid;gap:12px">${AI.recommendations.map((r) => card(r, "priority", "")).join("")}</ul>`)}
    ${sec(`Risker (${AI.risks.length})`, "ai-generated", "Identifierade av språkmodellen utifrån dina siffror.",
      `<ul style="margin:0;padding:0;list-style:none;display:grid;gap:12px">${AI.risks.map((r) => card(r, "severity", "border-left-width:2px;border-left-color:var(--warn);")).join("")}</ul>`)}
    ${sec("Nästa steg", null, null, `<ol style="margin:0;padding:0;list-style:none;display:grid;gap:10px">
      ${AI.nextActions.map((a, i) => `<li style="display:flex;gap:12px">
        <span class="num" style="width:20px;height:20px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:99px;background:rgba(79,70,229,.12);color:var(--series-ink);font-size:11px;font-weight:600;margin-top:1px">${i + 1}</span>
        <span class="note">${esc(a)}</span></li>`).join("")}</ol>`)}
  </div>`;
}

/* ── Router och skal ─────────────────────────────────────────────────── */
const NAV = [
  ["/", "Overview", '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'],
  ["/products", "Products", '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>'],
  ["/research", "Research", '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>'],
  ["/alerts", "Alerts", '<path d="M12 3a6 6 0 0 0-6 6c0 4-1.5 5.5-2 6h16c-.5-.5-2-2-2-6a6 6 0 0 0-6-6z"/><path d="M10 20a2 2 0 0 0 4 0"/>'],
  ["/insights", "AI Insights", '<path d="M12 3v1M4.9 6.3l.7.7M3 13.5h1M20 13.5h1M18.4 7l.7-.7"/><path d="M9 17.5a5 5 0 1 1 6 0c-.6.5-.9 1-1 1.8h-4c-.1-.8-.4-1.3-1-1.8z"/><path d="M10 21h4"/>'],
];
const TITLES = { "/": "Overview", "/products": "Products", "/research": "Research", "/alerts": "Alerts", "/insights": "AI Insights", "/produkt": "Produkt", "/kandidat": "Kandidat" };

function parseHash() {
  const raw = (location.hash || "#/").slice(1);
  const [path, qs] = raw.split("?");
  return { path: path || "/", params: new URLSearchParams(qs || "") };
}

function render() {
  const { path, params } = parseHash();
  const sub = path === "/produkt" || path === "/kandidat";

  document.getElementById("nav").innerHTML = NAV.map(([href, label, icon]) => {
    const active = href === "/" ? path === "/" : path.startsWith(href);
    return `<a href="#${href}"${active ? ' aria-current="page"' : ""}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>
      <span>${label}</span></a>`;
  }).join("");

  const name = TITLES[path] ?? "Plan-vy";
  document.getElementById("crumbs").innerHTML = sub
    ? `<a href="#${path === "/produkt" ? "/products" : "/research"}">${path === "/produkt" ? "Products" : "Research"}</a><span>/</span><b>${name}</b>`
    : `<a href="#/">Plan-vy</a><span>/</span><b>${name}</b>`;

  const head = document.getElementById("pageHead");
  head.style.display = sub ? "none" : "block";
  if (!sub) {
    head.innerHTML = `<h1>${name}</h1><p>${monthLabel(META.period)} · ${META.currency} · intäkter ex moms</p>`;
  }

  let html;
  switch (path) {
    case "/products": html = viewProducts(); break;
    case "/produkt": html = viewProduct(params.get("sku") ?? ""); break;
    case "/research": html = viewResearch(); break;
    case "/kandidat": html = viewCandidate(params.get("id") ?? ""); break;
    case "/alerts": html = viewAlerts(); break;
    case "/insights": html = viewInsights(); break;
    default: html = viewOverview();
  }
  document.getElementById("view").innerHTML = html;
  closeDrawer();
  window.scrollTo(0, 0);
}

/* Lådan skjuts ut med transform och ligger kvar i DOM:en, så den får inert
   under md — annars går den att tabba till fast den inte syns. */
const mq = window.matchMedia("(max-width:767px)");
const side = () => document.getElementById("side");
function syncInert() {
  const el = side();
  const hidden = mq.matches && !el.classList.contains("open");
  el.toggleAttribute("inert", hidden);
  el.setAttribute("aria-hidden", hidden ? "true" : "false");
}
function openDrawer() { side().classList.add("open"); document.getElementById("scrim").classList.add("on"); syncInert(); }
function closeDrawer() { side().classList.remove("open"); document.getElementById("scrim").classList.remove("on"); syncInert(); }

addEventListener("hashchange", render);
addEventListener("DOMContentLoaded", () => {
  render();
  syncInert();
  mq.addEventListener("change", syncInert);
  document.getElementById("burger").addEventListener("click", openDrawer);
  document.getElementById("scrim").addEventListener("click", closeDrawer);
  addEventListener("keydown", (e) => e.key === "Escape" && closeDrawer());

  document.getElementById("view").addEventListener("click", (e) => {
    const f = e.target.closest("[data-filter]");
    if (f) { prodFilter = f.dataset.filter; return render(); }
    const cf = e.target.closest("[data-country]");
    if (cf) { countryFilter = cf.dataset.country; return render(); }
    const s = e.target.closest("[data-sort]");
    if (s) {
      if (sortKey === s.dataset.sort) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortKey = s.dataset.sort; sortDir = "desc"; }
      return render();
    }
    if (e.target.id === "toggleRejected") { showRejected = !showRejected; return render(); }
    if (e.target.id === "clearQ") { query = ""; return render(); }
  });

  /* Sökfältet ritas om vid varje tangenttryck, så fokus och markörläge måste
     återställas efteråt — annars hoppar markören ur fältet efter första
     bokstaven. */
  let qTimer;
  document.getElementById("view").addEventListener("input", (e) => {
    if (e.target.id !== "q") return;
    query = e.target.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      const pos = e.target.selectionStart;
      render();
      const el = document.getElementById("q");
      if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    }, 120);
  });
});

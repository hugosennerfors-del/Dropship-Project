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
/* Färskheten räknas vid visning, inte vid bygget, så den åldras av sig själv.
   Dagen är det sidan grupperar på — en kandidat från i dag har haft noll
   dagar på sig att bli upptäckt av någon annan. */
const idag = () => new Date().toISOString().slice(0, 10);
const dagarSedan = (dag) => {
  if (!dag) return null;
  const d = Math.round((Date.parse(idag() + "T00:00:00Z") - Date.parse(dag + "T00:00:00Z")) / 86400000);
  return Number.isFinite(d) ? d : null;
};
const farskhet = (dag) => {
  const d = dagarSedan(dag);
  if (d == null) return { text: "Okänd dag", cls: "p-neu", n: 999 };
  if (d <= 0) return { text: "I dag", cls: "p-pos", n: 0 };
  if (d === 1) return { text: "I går", cls: "p-pos", n: 1 };
  if (d <= 7) return { text: d + " dagar", cls: "p-warn", n: d };
  return { text: d + " dagar", cls: "p-neu", n: d };
};
const KALLA = { kalender: "Säsong", bredd: "Bredd", manuell: "Manuell" };
const KALLA_VARFOR = {
  kalender: "Vald ur säsongskalendern: nischen researchas ungefär sex veckor före sin efterfrågetopp, så att annonserna hinner testas färdigt innan volymen kommer.",
  bredd: "Vald ur breddrotationen: nischer som bär volym året om, så att täckningen växer i stället för att stå still.",
  manuell: "Körd för hand — antingen från sökrutan i Research eller direkt mot n8n.",
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
  US: { name: "USA", cur: "USD", vat: 0, cpaBand: [6, 18], bufBand: [4, 45] },
  GB: { name: "Storbritannien", cur: "GBP", vat: 0.2, cpaBand: [4.5, 12], bufBand: [3, 34] },
  AU: { name: "Australien", cur: "AUD", vat: 0.1, cpaBand: [9, 25], bufBand: [6, 65] },
  EU: { name: "EU", cur: "EUR", vat: 0.21, cpaBand: [5, 14], bufBand: [3.5, 39] },
  SE: { name: "Sverige", cur: "SEK", vat: 0.25, cpaBand: [60, 160], bufBand: [40, 450] },
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
  const [id, name, notes, cost, sale, ship, fee, cpa, units, created, country = HOME,
         niche = "", researchDate = "", trendSource = "manuell"] = row;
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
    niche: niche || null, dag: researchDate || String(created).slice(0, 10), kalla: trendSource || "manuell",
    ad: PLANS[id] ?? null,
    inputs: { cost, sale, ship, fee, cpa, units: u },
    contribution, grossMargin, expectedPoas, verdict,
    breakEvenRoas: grossMargin > 0 ? 1 / grossMargin : null,
    netPerOrder: contribution - mex(cpa),
    cpaEx: mex(cpa),
  };
}
/* Kandidatlistan börjar i ögonblicksbilden från API:t, men sidan kan köra ny
   research och lägga till rader. Därför är den föränderlig och byggs om i
   stället för att räknas en gång vid start. */
let RAW = RAW_CANDIDATES.slice();
let PLANS = Object.assign({}, AD_PLANS);
let CANDIDATES = RAW.map(calcCandidate);
const rebuild = () => { CANDIDATES = RAW.map(calcCandidate); };

/* Två rader är samma produkt om namnen är lika. Den inbakade raden vinner:
   den kommer från databasen och bär dess riktiga id. */
const nameKey = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
function addRows(rows, plans) {
  const seen = new Set(RAW.map((r) => nameKey(r[1])));
  const added = [];
  for (const r of rows) {
    if (seen.has(nameKey(r[1]))) continue;
    seen.add(nameKey(r[1]));
    RAW.unshift(r);
    if (plans[r[0]]) PLANS[r[0]] = plans[r[0]];
    added.push(r);
  }
  if (added.length) rebuild();
  return added;
}

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
  ${(() => {
      const k = koncentration();
      if (!k || k.niva === "lag") return "";
      return `<div class="callout ${k.niva === "hog" ? "c-neg" : "c-warn"}" style="margin-bottom:16px">
        <b>${pct(k.andel, 0)} av bidraget hänger på ${esc(k.storst)}.</b>
        Med ${k.antal} ${k.antal === 1 ? "produkt" : "produkter"} i portföljen försvinner större delen av rörelsen
        samma dag som en av dem stoppas. <a href="#/risk" style="color:var(--series-ink)">Se Risk</a>.
      </div>`;
    })()}
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

    ${produktTratt(p)}
    ${produktReturer(p)}
    ${produktJamforelse(p)}
    ${produktScenario(p)}

    <div class="grid" style="grid-template-columns:1fr 1fr" data-stack>
      ${sec("Opportunities", "ai-generated", "AI-genererade uppslag, inte verifierade.", bullets(ai.opportunities, "Inga möjligheter genererade."))}
      ${sec("Risks", "ai-generated", "AI-genererade risker, inte verifierade.", bullets(ai.risks, "Inga risker genererade."))}
    </div>
  </div>`;
}

/* ── CPA-trappan ─────────────────────────────────────────────────────────
   CPA är slutsiffran. Den består av CPM, CTR, CPC och konverteringsgrad, och
   utan uppdelningen går det inte att se om problemet är kreativen eller
   landningssidan. Visningar och klick finns som kolumner i databasen men är
   tomma — då sägs det, i stället för att visa nollor som om de vore mätta. */
function produktTratt(p) {
  const f = p.funnel || {};
  if (f.available) {
    const steg = [
      ["Visningar", num(f.impressions), ""],
      ["CPM", kr(f.cpm), "kostnad per tusen visningar"],
      ["Klick", num(f.clicks), ""],
      ["CTR", pct(f.ctr, 2), "andel som klickar"],
      ["CPC", kr(f.cpc), "kostnad per klick"],
      ["Konvertering", f.cvr != null ? pct(f.cvr, 2) : "—", "andel klick som blir order"],
      ["CPA", kr(f.cpa), "kostnad per order"],
    ];
    return sec("CPA-trappan", "real", "Uppmätt ur annonsdata.", `
      <dl class="cards" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
        ${steg.map(([t, v, d]) => `<div class="flat stat"><dt>${t}</dt><dd class="num">${v}</dd>${d ? `<p class="muted" style="margin:2px 0 0;font-size:11px">${d}</p>` : ""}</div>`).join("")}
      </dl>`);
  }
  /* Ögonblicksbilden kan vara äldre än API:ets trattfält. Då räknas CPA:n
     ur produktens egna siffror i stället för att visa NaN. */
  const spend = ok(f.spend) ? f.spend : p.f.adSpend;
  const cpa = ok(f.cpa) ? f.cpa : p.f.cac;
  return sec("CPA-trappan", null, null, `
    <p class="callout c-warn" style="margin:0"><b>Väntar på data.</b> Kolumnerna <code>impressions</code> och
    <code>clicks</code> finns i <code>ad_spend</code> men är tomma, så CPM, CTR, CPC och konverteringsgrad går
    inte att räkna. Det enda som går är CPA: ${kr(cpa)} per order, alltså ${kr(spend)} delat på
    ${num(p.f.orders)} ordrar.</p>
    <p class="note" style="margin-top:12px">Fyll kolumnerna från Meta så tänds resten av trappan av sig själv.
    Då går det att se skillnad på tre helt olika problem som alla ser likadana ut i CPA:n: dålig CTR betyder att
    kreativen inte fångar, dålig konvertering betyder att annonsen lovar något sidan inte håller, och hög CPM
    betyder att du tävlar om fel målgrupp.</p>`);
}

function produktReturer(p) {
  const r = p.returns || {};
  if (!r.available) {
    return sec("Returer", null, null, `
      <p class="callout c-warn" style="margin:0"><b>Inga returer registrerade.</b> Tabellen <code>returns</code>
      är tom, så systemet räknar på det antagna värdet ${pct(p.f.returnRate, 1)} i stället för uppmätt.</p>
      <p class="note" style="margin-top:12px">Returgraden är tyst tills man ser vad den består av. Fel storlek är
      ett annat problem än trasig vid leverans — det första löses i annonsen, det andra hos leverantören.</p>`);
  }
  const perOrsak = {};
  r.rows.forEach((x) => { perOrsak[x.reason] = (perOrsak[x.reason] || 0) + x.antal; });
  const tot = Object.values(perOrsak).reduce((a, b) => a + b, 0) || 1;
  return sec("Returer", "real", "Uppmätt ur returtabellen.", `
    <ul style="margin:0;padding:0;list-style:none;display:grid;gap:10px">
      ${Object.entries(perOrsak).sort((a, b) => b[1] - a[1]).map(([orsak, antal]) => `<li style="display:flex;align-items:center;gap:12px">
        <span style="flex:1;font-size:13px">${esc(orsak)}</span>
        <div style="width:120px;height:10px;background:rgba(255,255,255,.4);border-radius:5px;overflow:hidden">
          <i style="display:block;height:100%;width:${Math.round((antal / tot) * 100)}%;background:var(--warn)"></i></div>
        <span class="num muted" style="width:56px;text-align:right">${num(antal)}</span>
      </li>`).join("")}
    </ul>`);
}

function produktJamforelse(p) {
  const pp = poolPlacering(p.f.cac * (1 + MARKETS[HOME].vat));
  if (!pp) return "";
  return sec("Mot kandidaternas antaganden", "computed", "Din uppmätta CAC mot vad researchen gissar.", `
    <p class="note" style="margin:0 0 14px">Din faktiska CAC är ${kr(p.f.cac)} ex moms, alltså
    ${kr(p.f.cac * (1 + MARKETS[HOME].vat))} inklusive. Kandidaterna gissar mellan ${kr(pp.lagst)} och
    ${kr(pp.hogst)}, med ${kr(pp.median)} som median.</p>
    <div style="display:flex;align-items:flex-end;gap:12px">
      <span class="num" style="font-size:34px;font-weight:600;line-height:1">${pp.percentil}:e</span>
      <span class="muted" style="padding-bottom:4px">percentilen av ${pp.antal} antaganden</span>
    </div>
    <div class="meter" style="margin-top:12px"><i style="width:${pp.percentil}%;background:${pp.percentil >= 70 ? "var(--neg)" : pp.percentil >= 40 ? "var(--warn)" : "var(--pos)"}"></i></div>
    <p class="note" style="margin-top:14px">${pp.percentil >= 70
      ? "Din verkliga CAC är dyrare än de flesta antaganden i poolen. Kandidaternas POAS är därför sannolikt för optimistiska — räkna med sämre utfall än kalkylen visar."
      : pp.percentil >= 40 ? "Din CAC ligger mitt i spannet. Kandidaternas antaganden är i samma storleksordning som din verklighet."
      : "Du köper trafik billigare än de flesta kandidater antar. Det betyder att kalkylerna snarast är försiktiga."}</p>`);
}

/* Scenariot räknar om på plats. Alla tre reglagen är procent mot nuläget. */
let scen = { pris: 0, cpa: 0, retur: 0 };
function produktScenario(p) {
  const f = p.f;
  const orders = f.orders || 1;
  const prisF = 1 + scen.pris / 100;
  const cpaF = 1 + scen.cpa / 100;
  const returNy = Math.max(0, Math.min(0.9, f.returnRate + scen.retur / 100));

  const intakt = f.revenueExVat * prisF;
  const rorligt = f.revenueExVat - f.contribution;
  /* Bidraget skalas med hur mycket mer som kommer tillbaka: både intäkt och
     rörlig kostnad följer antalet behållna ordrar, så kvoten räcker. */
  const bidragEnkelt = (intakt - rorligt) * ((1 - returNy) / Math.max(1 - f.returnRate, 0.01));
  const spend = f.adSpend * cpaF;
  const poas = spend > 0 ? bidragEnkelt / spend : 0;
  const netto = bidragEnkelt - spend;

  const reglage = (id, etikett, varde, min, max, suffix) => `
    <div style="display:grid;gap:4px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span class="muted">${etikett}</span>
        <span class="num" style="font-weight:600">${varde > 0 ? "+" : ""}${varde}${suffix}</span>
      </div>
      <input type="range" data-scen="${id}" min="${min}" max="${max}" step="1" value="${varde}" style="width:100%">
    </div>`;

  return sec("Vad händer om", "computed", "Räknat på nuvarande period. Reglagen ändrar ingenting i databasen.", `
    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)" data-stack>
      <div style="display:grid;gap:16px">
        ${reglage("pris", "Utpris", scen.pris, -30, 50, " %")}
        ${reglage("cpa", "Annonskostnad", scen.cpa, -50, 100, " %")}
        ${reglage("retur", "Returgrad", scen.retur, 0, 25, " p.e.")}
        <button id="scenNoll" class="fbtn" style="justify-self:start">Nollställ</button>
      </div>
      <div>
        <dl class="rows">
          <div><dt>Täckningsbidrag</dt><dd class="num" style="font-weight:600">${kr(bidragEnkelt)}<span class="muted" style="font-weight:400"> mot ${kr(f.contribution)}</span></dd></div>
          <div><dt>Annonskostnad</dt><dd class="num">${kr(spend)}</dd></div>
          <div class="sum"><dt style="font-size:13px;color:var(--ink)">POAS</dt><dd class="num" style="font-weight:600;color:${signColor(poas - 1)}">${mult(poas)}</dd></div>
          <div class="sum"><dt style="font-size:13px;color:var(--ink)">Netto</dt><dd class="num" style="font-weight:600;color:${signColor(netto)}">${kr(netto)}</dd></div>
        </dl>
        <p class="note" style="margin-top:14px">${poas >= 1 && f.poas < 1
          ? "Med den här justeringen bär produkten sig. Det säger vad som krävs — inte att det går att genomföra."
          : poas < 1 && f.poas >= 1 ? "Den här justeringen tippar produkten till förlust."
          : "Förhållandet mellan bidrag och annonskostnad är oförändrat i tecken."}</p>
      </div>
    </div>`);
}

let showRejected = false;
let query = "";
let countryFilter = "ALL";
let dayFilter = "ALL";

/* Researchdagarna som faktiskt finns, nyast först. Dagsvyn är poängen med
   schemat: en kandidat från i dag har ingen annan hunnit se. */
const dagar = () => {
  const d = {};
  CANDIDATES.forEach((c) => { if (c.dag) d[c.dag] = (d[c.dag] || 0) + 1; });
  return Object.keys(d).sort().reverse().map((k) => ({ dag: k, antal: d[k] }));
};

/* Länder som faktiskt förekommer i listan, i den ordning MARKETS räknar upp
   dem. Ett land utan kandidater får ingen knapp — annars vore hälften döda. */
const countries = () => Object.keys(MARKETS).filter((k) => CANDIDATES.some((c) => c.country === k));

/* Sökning över namn, anteckning, land och annonsupplägg. Diakritiklös
   jämförelse, så "plånbok" hittas även när man skriver "planbok". Flera ord
   = alla måste finnas. */
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const haystack = (c) => {
  const a = c.ad ?? {};
  return norm([c.name, c.notes, c.verdict, c.market.name, c.country, c.niche, c.dag,
    a.q, a.angle, a.hook, a.format, a.audience, a.primaryText, a.headline,
    ...(a.script ?? [])].join(" "));
};
function matches(c, q) {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = haystack(c);
  return terms.every((t) => hay.includes(t));
}

/* ── Ny research på begäran ──────────────────────────────────────────────
   En artefakt får inte göra nätverksanrop, så sidan kan inte ringa n8n:s
   webhook direkt. Den går i stället via läsarens egen n8n-koppling: samma
   arbetsflöde, samma databas, men med läsarens inloggning i stället för en
   öppen adress. Nya kandidater sparas i sidans egen lagring så att de finns
   kvar efter en omladdning — n8n har dem redan i product_candidates. */
const RESEARCH = {
  server: "n8n",
  workflow: "jD6A7tOD1L8bdUd8",
  trigger: "API: generera research",
  node: "Dela upp kandidater",
};

/* window.claude finns bara inuti en publicerad artefakt. Öppnad som lokal
   fil saknas den helt, och då ska sidan fungera utan att kasta. */
const cap = async (name) => {
  try { return window.claude && window.claude.use ? await window.claude.use(name) : null; }
  catch (e) { return null; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Varje kopplingsfel har sin egen rätta åtgärd. En gemensam "något gick
   fel" döljer just den knapp som skulle laga sidan. */
const MCP_FIX = {
  server_not_connected: "Lägg till n8n under claude.ai → Inställningar → Kopplingar.",
  needs_reauth: "n8n behöver återanslutas: claude.ai → Inställningar → Kopplingar.",
  selection_required: "Du har flera n8n-kopplingar och har inte valt en. Välj i claude.ai och försök igen.",
  not_in_manifest: "n8n är inte tillåtet för den här sidan. Tillåt kopplingen när sidan frågar.",
  blocked_by_policy: "Organisationens policy blockerar det här n8n-verktyget.",
  approval_required: "Anropet kräver ett godkännande som inte går att ge härifrån.",
  not_granted: "Den här vyn har inte tillgång till dina kopplingar. Öppna sidan från claude.ai.",
  capability_disabled: "Den här vyn kan inte nå kopplingar.",
  capability_removed: "Den här vyn kan inte nå kopplingar.",
  cancelled: "Körningen avbröts. Hann den starta kan kandidaterna ändå ligga i n8n.",
  rate_limited: "För många anrop just nu. Vänta en stund och försök igen.",
  server_unavailable: "n8n svarade inte. Försök igen om en stund.",
  bad_request: "Anropet till n8n var felformat — det är en bugg i sidan.",
};

let rState = { status: "idle", niche: "", country: HOME, msg: "", added: 0, total: 0, fix: "" };
let researchCountry = "US";

const paint = (msg) => {
  rState.msg = msg;
  const el = document.getElementById("rStatus");
  if (el) el.textContent = msg; else render();
};

async function callN8n(mcp, tool, input, retry) {
  try {
    return await mcp.callTool(RESEARCH.server, tool, input, { cache: false });
  } catch (e) {
    // Bara läsningar får göras om, och bara en gång. En körning som redan
    // startat får aldrig startas igen automatiskt.
    if (retry && e && e.retryable === true) {
      await sleep(Math.min(e.retryAfterMs || 2000, 8000) + Math.random() * 400);
      return await mcp.callTool(RESEARCH.server, tool, input, { cache: false });
    }
    throw e;
  }
}

function planFrom(p, name) {
  const words = norm(name).replace(/[^a-z0-9 -]/g, " ").split(/[\s-]+/).filter((w) => w.length > 2);
  const q = p && p.adLibraryQuery ? String(p.adLibraryQuery) : words.slice(0, 3).join(" ");
  if (!p) return { q };
  return {
    q,
    angle: p.angle || null, hook: p.hook || null, format: p.format || null,
    script: Array.isArray(p.script) ? p.script.map(String) : [],
    audience: p.audience || null, primaryText: p.primaryText || null, headline: p.headline || null,
  };
}

/* Lagringen är en bekvämlighet, inte resultatet: går den fel står
   kandidaterna kvar i vyn och i n8n:s databas ändå. */
async function saveRows(rows, plans, niche) {
  try {
    const db = await cap("db");
    if (!db) return;
    for (const r of rows) {
      await db.collection("candidates").doc(r[0]).set({
        row: r, plan: plans[r[0]] || null, niche, country: r[10], addedAt: Date.now(),
      });
    }
  } catch (e) { /* tyst: sidan visar dem redan */ }
}

async function loadSaved() {
  try {
    const db = await cap("db");
    if (!db) return;
    const snap = await db.collection("candidates").orderBy("addedAt", "desc").limit(500).get();
    const rows = [], plans = {};
    snap.docs.forEach((d) => {
      const v = d.data() || {};
      if (Array.isArray(v.row) && v.row.length >= 10) {
        rows.push(v.row);
        if (v.plan) plans[v.row[0]] = v.plan;
      }
    });
    if (addRows(rows, plans).length) render();
  } catch (e) { /* tyst: ögonblicksbilden räcker */ }
}

async function runResearch(niche, country) {
  if (rState.status === "running") return;
  rState = { status: "running", niche, country, msg: "Startar körningen…", added: 0, total: 0, fix: "" };
  render();

  const fail = (e) => {
    const code = e && e.code ? String(e.code) : "upstream_error";
    rState = {
      status: "error", niche, country, added: 0, total: 0,
      msg: code === "tool_error" && e.message ? e.message : "Research-körningen gick inte igenom.",
      fix: MCP_FIX[code] || "Ladda om sidan och försök igen.",
    };
    render();
  };

  try {
    const mcp = await cap("mcp");
    if (!mcp) return fail({ code: "not_granted" });

    const started = await callN8n(mcp, "execute_workflow", {
      workflowId: RESEARCH.workflow,
      executionMode: "production",
      triggerNodeName: RESEARCH.trigger,
      inputs: { webhookData: { method: "POST", body: { niche, country } } },
    }, false);

    const id = started && started.payload && started.payload.executionId;
    if (!id) return fail({ code: "tool_error", message: "n8n svarade utan körnings-id." });

    const t0 = Date.now();
    let status = "running";
    for (let i = 0; i < 45; i++) {
      await sleep(i < 4 ? 2000 : 3500);
      const st = await callN8n(mcp, "get_workflow_execution", {
        workflowId: RESEARCH.workflow, executionId: String(id), includeData: false,
      }, true);
      status = String((st && st.payload && st.payload.execution && st.payload.execution.status) || "running");
      if (status !== "running" && status !== "new" && status !== "waiting") break;
      paint("Söker fram produkter i " + MARKETS[country].name + "… " + Math.round((Date.now() - t0) / 1000) + " s");
    }
    if (status !== "success") {
      return fail({ code: "tool_error", message: 'Körningen slutade som "' + status + '".' });
    }

    paint("Hämtar resultatet…");
    const full = await callN8n(mcp, "get_workflow_execution", {
      workflowId: RESEARCH.workflow, executionId: String(id), includeData: true, nodeNames: [RESEARCH.node],
    }, true);

    const runData = full && full.payload && full.payload.data && full.payload.data.resultData
      && full.payload.data.resultData.runData;
    const run = runData && runData[RESEARCH.node] && runData[RESEARCH.node][0];
    const items = (run && run.data && run.data.main && run.data.main[0]) || [];
    if (!items.length) return fail({ code: "tool_error", message: "Körningen gav inga kandidater." });

    const created = new Date().toISOString().slice(0, 19) + "Z";
    const rows = [], plans = {};
    items.forEach((it, i) => {
      const j = (it && it.json) || {};
      const rid = "n" + id + "-" + i;
      rows.push([
        rid, String(j.name || "Namnlös kandidat"), String(j.notes || ""),
        Number(j.cost_per_unit_incl_vat) || 0, Number(j.sale_price_incl_vat) || 0,
        Number(j.shipping_cost_per_order) || 0, Number(j.transaction_fee_per_order) || 0,
        Number(j.expected_cpa_incl_vat) || 0, Number(j.expected_units_per_order) || 1,
        created, country,
      ]);
      plans[rid] = planFrom(j.ad_plan, String(j.name || ""));
    });

    const added = addRows(rows, plans);
    saveRows(added, plans, niche);
    countryFilter = country;
    query = "";
    showRejected = false;
    rState = { status: "done", niche, country, msg: "", added: added.length, total: rows.length, fix: "" };
    render();
  } catch (e) {
    fail(e);
  }
}

/* Panelen som kör research. Den syns alltid: sökfältet filtrerar det som
   redan finns, den här knappen hämtar något nytt. */
function researchPanel() {
  const q = query.trim();
  const running = rState.status === "running";
  const market = MARKETS[researchCountry];
  const opts = Object.keys(MARKETS)
    .map((k) => '<option value="' + k + '"' + (k === researchCountry ? " selected" : "") + ">" + esc(MARKETS[k].name) + "</option>")
    .join("");

  const result = rState.status === "done"
    ? '<p class="callout c-pos" style="margin:12px 0 0">' + (rState.added
        ? "Klart: " + rState.added + " nya kandidater på ”" + esc(rState.niche) + "” i " + esc(MARKETS[rState.country].name) + ", med kalkyl och annonsupplägg. De ligger kvar i n8n:s databas."
        : "Körningen gav " + rState.total + " förslag, men alla fanns redan i listan.") + "</p>"
    : rState.status === "error"
      ? '<div class="callout c-neg" style="margin:12px 0 0"><b>' + esc(rState.msg) + "</b><br>" + esc(rState.fix) + "</div>"
      : "";

  return '<div style="border:1px solid rgba(255,255,255,.6);background:rgba(255,255,255,.45);border-radius:14px;padding:16px;margin-bottom:16px">'
    + '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">'
    +   '<div style="flex:1;min-width:210px">'
    +     '<h3 style="font-size:13.5px;font-weight:600">Hittar du inte produkten?</h3>'
    +     '<p class="muted" style="margin:4px 0 0">Skriv vilken nisch eller produkt du vill åt i sökfältet ovan, välj marknad och kör. '
    +       'n8n tar fram fem nya kandidater med kalkyl och annonsupplägg — det tar ungefär 20 sekunder och kostar OpenAI-krediter.</p>'
    +   '</div>'
    +   '<label style="display:grid;gap:4px"><span class="muted">Marknad</span>'
    +     '<select id="rCountry"' + (running ? " disabled" : "") + ' style="border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:10px;padding:7px 10px;font:inherit;font-size:12.5px;color:var(--ink)">'
    +       opts + '</select></label>'
    +   '<button id="runResearch" class="fbtn"' + (running || !q ? " disabled" : "") + ' aria-pressed="false"'
    +     ' style="font-weight:600' + (running || !q ? ";opacity:.5" : ";border-color:rgba(79,70,229,.35);background:rgba(79,70,229,.12);color:var(--series-ink)") + '">'
    +     (running ? "Kör…" : q ? "Kör research på ”" + esc(q) + "”" : "Skriv en sökning först") + "</button>"
    + "</div>"
    + '<p id="rStatus" class="note" style="margin:' + (running ? "12px" : "0") + ' 0 0;color:var(--ink2)">' + (running ? esc(rState.msg) : "") + "</p>"
    + result
    + '<p class="muted" style="margin-top:12px">Sidan når n8n genom din egen koppling i claude.ai — första gången frågar den om lov. '
    +   'Resultatet sparas både i n8n och i sidan, så det finns kvar nästa gång du öppnar den.</p>'
    + "</div>";
}

function viewResearch() {
  const hits = CANDIDATES.filter((c) =>
    (countryFilter === "ALL" || c.country === countryFilter) &&
    (dayFilter === "ALL" || c.dag === dayFilter) &&
    matches(c, query));
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
              <span style="display:flex;gap:6px;flex-shrink:0">${pill(...verdictMeta(c.verdict))}${
                (policy(c) || {}).niva === "block" ? pill("Inte på Meta", "p-neg") : ""}</span>
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
              <p class="muted" style="margin:5px 0 0">${esc(c.market.name)} · ${dateLabel(c.created)}${c.niche ? " · " + esc(c.niche) : ""}</p>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
              ${pill(...verdictMeta(c.verdict))}${(policy(c) || {}).niva === "block" ? pill("Inte på Meta", "p-neg") : ""}
              <span style="display:flex;gap:6px;align-items:center">${pill(farskhet(c.dag).text, farskhet(c.dag).cls)}</span>
              <span class="num muted">Chans ${r.score}</span>
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
      `${(() => {
        const d = dagar();
        if (d.length < 2) return "";
        const visa = d.slice(0, 8);
        return `<div class="filters" style="margin-bottom:12px">
          <button class="fbtn" data-day="ALL" aria-pressed="${dayFilter === "ALL"}">Alla dagar <span class="num" style="opacity:.7">(${CANDIDATES.length})</span></button>
          ${visa.map((x) => {
            const f = farskhet(x.dag);
            return `<button class="fbtn" data-day="${x.dag}" aria-pressed="${dayFilter === x.dag}" title="${x.dag}">${f.text} <span class="num" style="opacity:.7">(${x.antal})</span></button>`;
          }).join("")}
          <span class="muted" style="margin-left:auto">Nyast först — färskast har minst risk att redan vara upptäckt</span>
        </div>`;
      })()}
      ${countries().length > 1 ? `<div class="filters" style="margin-bottom:12px">
        ${[["ALL", "Alla marknader", CANDIDATES.length], ...countries().map((k) =>
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
        <button id="exportCsv" class="fbtn">Exportera CSV</button>
        <span class="muted">${query ? `${hits.length} av ${CANDIDATES.length} matchar`
          : countryFilter === "ALL" ? `${CANDIDATES.length} kandidater`
          : `${hits.length} kandidater i ${MARKETS[countryFilter].name}`}</span>
      </div>
      ${researchPanel()}
      ${query && hits.length === 0 ? emptyBox(`Inget matchar "${esc(query)}".`, "Ingen sparad kandidat heter så — men du kan köra research på det direkt här ovanför.") : ""}
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
        <h2 style="font-size:19px;font-weight:600">${esc(c.name)}</h2>${pill(...verdictMeta(c.verdict))}${
          (policy(c) || {}).niva === "block" ? pill("Inte på Meta", "p-neg") : ""}${pill(farskhet(c.dag).text, farskhet(c.dag).cls)}
      </div>
      <p class="muted" style="margin:5px 0 0">${esc(c.market.name)} · ${c.cur} · moms ${pct(c.market.vat, 0)} · researchad ${dateLabel(c.created)}${c.niche ? " ur nischen " + esc(c.niche) : ""}</p>
    </div>
    <a class="chip" href="#/research">&larr; All research</a>
  </div>

  <div style="display:flex;flex-wrap:wrap;gap:8px 20px;align-items:baseline;border:1px solid rgba(255,255,255,.6);background:rgba(255,255,255,.45);border-radius:14px;padding:12px 16px;margin-bottom:16px">
    <span class="muted">Researchdag</span><b style="font-size:13px;font-weight:500">${esc(c.dag || "okänd")}</b>
    <span class="muted">Härkomst</span><b style="font-size:13px;font-weight:500">${esc(KALLA[c.kalla] || "Manuell")}${c.niche ? " · " + esc(c.niche) : ""}</b>
    <p class="muted" style="flex-basis:100%;margin:2px 0 0">${esc(KALLA_VARFOR[c.kalla] || KALLA_VARFOR.manuell)}</p>
  </div>

  ${(() => {
    const pol = policy(c);
    if (!pol) return "";
    const neg = pol.niva === "block";
    return `<div class="callout ${neg ? "c-neg" : "c-warn"}" style="margin-bottom:16px">
      <b>${esc(pol.etikett)}.</b> ${esc(pol.varfor)}
      ${neg ? " Siffrorna nedan stämmer, men de går inte att omsätta på den här kanalen." : ""}
    </div>`;
  })()}

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
        </dl>
        ${kandidatAvgift(c)}`)}
    </div>

    ${leverantorsSektion(c)}

    ${(() => {
      const m = new Date().getUTCMonth() + 1;
      const q = q4Justerad(c, m);
      if (q.faktor === 1) return "";
      const upp = q.faktor > 1;
      return sec("Säsongen i annonsauktionen", "computed", "Annonspriserna följer efterfrågan, kalkylen gör det inte.", `
        <p class="note" style="margin:0 0 14px">Kalkylen antar ${money(c.inputs.cpa, c.cur)} i CPA oavsett månad. I
        ${new Intl.DateTimeFormat(L, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, m - 1, 1)))}
        ligger annonspriserna typiskt ${pct(Math.abs(q.faktor - 1), 0)} ${upp ? "högre" : "lägre"} än årsgenomsnittet.</p>
        <dl class="cards" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
          <div class="flat stat"><dt>Justerad CPA</dt><dd class="num">${money(q.cpaInkl, c.cur)}</dd></div>
          <div class="flat stat"><dt>POAS då</dt><dd class="num" style="color:${signColor(q.poas - 1)}">${mult(q.poas)}</dd></div>
          <div class="flat stat"><dt>Netto per order</dt><dd class="num" style="color:${signColor(q.netto)}">${money(q.netto, c.cur)}</dd></div>
        </dl>
        ${q.poas < 1 && c.expectedPoas >= 1 ? `<p class="callout c-neg" style="margin-top:14px">Produkten bär sig i
          kalkylen men inte i den här månaden. Det är den vanligaste fällan inför Black Friday: kalkylen räknas i
          september och körs i november.</p>` : ""}`);
    })()}

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

/* ── Kalendern: vad som bör researchas, och senast när ───────────────────
   Riktad mot köpstarka marknader — USA, Storbritannien, Australien och EU
   som en enhet — inte mot Sverige. Sverige finns kvar sist eftersom det är
   där liveprodukterna faktiskt säljs och verklighetskollen fungerar.

   Kalendern är INTE annonsdata. Metas annonsbibliotek går inte att läsa
   automatiskt: Graph API:ts ads_archive kräver en godkänd utvecklarapp, och
   den publika sidan svarar 403 med en bot-utmaning. Varje tema har därför en
   länk du själv klickar på för att se vad som faktiskt körs just nu.

   Dagens trend är dessutom sen — toppen är redan där. Kalendern siktar
   LEDTID veckor framåt, så annonserna hinner testas klart före volymen. */
const LEDTID = 6;
const ADLIB = { US: "US", GB: "GB", AU: "AU", EU: "DE", SE: "SE" };

const SASONG = {
  US: [
    { fran: 1,  till: 6,  teman: ["nystart, träning och organisering hemma", "torr vinterluft och inomhusklimat", "hemmakontor och skrivbordet"] },
    { fran: 7,  till: 11, teman: ["alla hjärtans dag och present till partner", "vinterbilen och kyla", "matlagning och köksprylar"] },
    { fran: 12, till: 16, teman: ["vårstädning och förvaring", "allergi, pollen och luftrening", "trädgård och odling"] },
    { fran: 17, till: 21, teman: ["mors dag och present till mamma", "grillning och uteplats", "camping och friluftsliv"] },
    { fran: 22, till: 26, teman: ["fars dag och present till pappa", "pool, bad och sommarvärme", "bilresor och packning"] },
    { fran: 27, till: 31, teman: ["kylning och het sommar inomhus", "utomhuslek och barn på lovet", "husdjur i värmen"] },
    { fran: 32, till: 36, teman: ["back to school och studentrum", "barnfamiljens vardag och morgonrutin", "förvaring i små utrymmen"] },
    { fran: 37, till: 41, teman: ["höst, mörker och belysning hemma", "halloween och utklädnad", "mysiga kvällar och filtar"] },
    { fran: 42, till: 46, teman: ["black friday-produkter med hög upplevd rabatt", "thanksgiving, matlagning och dukning", "värme och kalla golv"] },
    { fran: 47, till: 50, teman: ["julklappar till vuxna", "julpynt och stämningsljus", "present till den som har allt"] },
    { fran: 51, till: 53, teman: ["julklappar i sista minuten", "nyår och fest", "mellandagar och nystart"] },
  ],
  GB: [
    { fran: 1,  till: 6,  teman: ["nystart, träning och organisering hemma", "kyla, drag och uppvärmningskostnad", "hemmakontor och skrivbordet"] },
    { fran: 7,  till: 11, teman: ["alla hjärtans dag och present till partner", "mothering sunday och present till mamma", "vinterbilen och kyla"] },
    { fran: 12, till: 16, teman: ["vårstädning och fönsterputs", "påsk, ägg och familjefest", "trädgård och odling"] },
    { fran: 17, till: 21, teman: ["uteplats, utemöbler och altan", "grillning och utomhusmatlagning", "bank holiday och utflykt"] },
    { fran: 22, till: 26, teman: ["resa, packning och flyg", "sol, bad och strand", "cykel och utomhusträning"] },
    { fran: 27, till: 31, teman: ["sommarvärme och svala sovrum", "festival och camping", "utomhuslek och barn på lovet"] },
    { fran: 32, till: 36, teman: ["back to school och skolstart", "höststädning och förvaring", "hemmakontor och ergonomi"] },
    { fran: 37, till: 41, teman: ["regn, väta och ytterkläder", "höstmörker och belysning i hemmet", "halloween och utklädnad"] },
    { fran: 42, till: 46, teman: ["bonfire night och mörkerkvällar", "black friday-produkter med hög upplevd rabatt", "värme, filtar och kalla fötter"] },
    { fran: 47, till: 50, teman: ["julklappar till vuxna", "julpynt och stämningsljus", "köksprylar inför julmaten"] },
    { fran: 51, till: 53, teman: ["julklappar i sista minuten", "boxing day och rea", "nyår och fest"] },
  ],
  AU: [
    { fran: 1,  till: 6,  teman: ["sommarvärme, kylning och svala sovrum", "strand, pool och utomhusliv", "back to school i januari"] },
    { fran: 7,  till: 12, teman: ["sensommar och uteplats", "grillning och utomhusmatlagning", "husdjur i värmen"] },
    { fran: 13, till: 18, teman: ["höst och svalare kvällar", "påsk och familjefest", "städning och förvaring inomhus"] },
    { fran: 19, till: 26, teman: ["vinterkyla och uppvärmning inomhus", "EOFY-rea och avdragsgilla inköp", "filtar, värme och mysiga kvällar"] },
    { fran: 27, till: 35, teman: ["vinter inomhus och torr luft", "hemmaträning när det är kallt", "hemmakontor och skrivbordet"] },
    { fran: 36, till: 41, teman: ["vår, trädgård och odling", "allergi, pollen och luftrening", "vårstädning och fönsterputs"] },
    { fran: 42, till: 47, teman: ["sommarförberedelse och strandsaker", "black friday-produkter med hög upplevd rabatt", "melbourne cup och fest"] },
    { fran: 48, till: 53, teman: ["jul i sommarvärme och utomhusfest", "julklappar till vuxna", "semester, resa och packning"] },
  ],
  EU: [
    { fran: 1,  till: 6,  teman: ["nystart, träning och organisering hemma", "torr vinterluft och inomhusklimat", "hemmakontor och skrivbordet"] },
    { fran: 7,  till: 11, teman: ["alla hjärtans dag och present till partner", "vinterbilen och kyla", "karneval och fest"] },
    { fran: 12, till: 16, teman: ["vårstädning och fönsterputs", "påsk och familjefest", "allergi, pollen och luftrening"] },
    { fran: 17, till: 21, teman: ["uteplats, utemöbler och altan", "trädgård och odling på balkong", "grillning och utomhusmatlagning"] },
    { fran: 22, till: 26, teman: ["resa, packning och flyg", "sol, bad och strand", "camping och friluftsliv"] },
    { fran: 27, till: 33, teman: ["sommarsemester och långa resor", "värme inomhus och svala sovrum", "utomhuslek och barn på lovet"] },
    { fran: 34, till: 38, teman: ["skolstart och barnfamiljens vardag", "höststädning och förvaring", "hemmakontor och ergonomi"] },
    { fran: 39, till: 43, teman: ["höstmörker och belysning i hemmet", "regn, väta och ytterkläder", "inomhusträning när det blir kallt"] },
    { fran: 44, till: 47, teman: ["värme, filtar och kalla fötter", "black friday-produkter med hög upplevd rabatt", "mörkerkörning och synlighet"] },
    { fran: 48, till: 51, teman: ["julklappar till vuxna", "julpynt och stämningsljus", "köksprylar inför julmaten"] },
    { fran: 52, till: 53, teman: ["julklappar i sista minuten", "nyår och fest", "mellandagar och nystart"] },
  ],
  SE: [
    { fran: 1,  till: 6,  teman: ["träning och nystart hemma", "torr inomhusluft och vinterhud", "förvaring och ordning efter julen"] },
    { fran: 7,  till: 11, teman: ["vinterfriluftsliv och kyla utomhus", "hemmakontor och ergonomi", "vinterbilen och skrapa, halka, kyla"] },
    { fran: 12, till: 16, teman: ["vårstädning och fönsterputs", "odling och plantering på balkong", "allergi, pollen och luftrening"] },
    { fran: 17, till: 21, teman: ["uteplats, utemöbler och altan", "grillning och utomhusmatlagning", "cykel och utomhusträning"] },
    { fran: 22, till: 26, teman: ["resa, packning och flyg", "sol, bad och strand", "camping och friluftsliv"] },
    { fran: 27, till: 31, teman: ["värme inomhus och svala sovrum", "husdjur under sommaren", "utomhuslek och barn på semestern"] },
    { fran: 32, till: 36, teman: ["skolstart och barnfamiljens vardag", "hemmakontor och skrivbordet", "höststädning och förvaring"] },
    { fran: 37, till: 41, teman: ["höstmörker och belysning i hemmet", "regn, väta och ytterkläder", "inomhusträning när det blir kallt"] },
    { fran: 42, till: 45, teman: ["däckbyte och bilen inför vintern", "kalla fötter, värme och filtar", "mörkerkörning, reflexer och synlighet"] },
    { fran: 46, till: 48, teman: ["presenter och julklappar till vuxna", "mys, levande ljus och stämning inomhus", "köksprylar inför julmaten"] },
    { fran: 49, till: 53, teman: ["julklappar i sista minuten", "julbord, dukning och servering", "nyår, fest och mellandagar"] },
  ],
};

/* Marknaderna i prioritetsordning. Sverige sist: det är hemmamarknaden där
   siffrorna kan kontrolleras, inte den som ska driva urvalet. */
const KAL_MARKNADER = ["US", "GB", "AU", "EU", "SE"];

const BREDD = [
  "laddning, kablar och mobiltillbehör",
  "städning och smarta förvaringslösningar i hemmet",
  "kök och matlagning",
  "husdjursprodukter för hund och katt",
  "sömn och återhämtning i sovrummet",
  "bilinredning och bilvård",
  "hårvård och styling hemma",
  "hemmakontor och ergonomi vid skrivbordet",
  "träning och rehab hemma",
  "resa, packning och pendling",
  "småbarnsföräldrar och barnfamiljens vardag",
  "avkoppling, massage och stel nacke efter jobbet",
  "verktyg och fix hemma",
  "organisering av garderob och kläder",
];

const DAG = 86400000;
function isoVecka(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dag = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dag);
  const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - start) / DAG + 1) / 7);
}
function veckansMandag(ar, v) {
  const fjarde = new Date(Date.UTC(ar, 0, 4));
  const mandagV1 = new Date(fjarde.getTime() - ((fjarde.getUTCDay() || 7) - 1) * DAG);
  return new Date(mandagV1.getTime() + (v - 1) * 7 * DAG);
}
const kortDatum = (d) => new Intl.DateTimeFormat(L, { day: "numeric", month: "short", timeZone: "UTC" }).format(d);

/* Har temat körts? Exakt träff på normaliserad sträng, eller att det ena
   ordsetet ryms i det andra. Avsiktligt snålt — hellre säga "inte gjord" än
   påstå täckning som inte finns. */
const ord = (s) => new Set(norm(s).replace(/[^a-z0-9åäö ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
function gjord(tema, marknad) {
  const a = ord(tema);
  const traffar = CANDIDATES.filter((c) => {
    if (!c.niche) return false;
    if (marknad && c.country !== marknad) return false;
    if (norm(c.niche) === norm(tema)) return true;
    const b = ord(c.niche);
    if (!a.size || !b.size) return false;
    const delad = [...a].filter((w) => b.has(w)).length;
    return delad === a.size || delad === b.size;
  });
  if (!traffar.length) return null;
  const dagar = traffar.map((c) => c.dag).filter(Boolean).sort();
  return { antal: traffar.length, senast: dagar[dagar.length - 1] || null };
}

/* Två-tre ord ur temat duger som sökning i annonsbiblioteket. */
const STOPP = new Set(["och", "eller", "till", "inför", "under", "hemma", "inomhus", "produkter", "present", "till"]);
const adlibOrd = (tema) => norm(tema).replace(/[^a-z0-9åäö ]/g, " ").split(/\s+/)
  .filter((w) => w.length > 3 && !STOPP.has(w)).slice(0, 2).join(" ");
const adlibUrl = (tema, marknad) => adLibraryUrl(adlibOrd(tema), ADLIB[marknad] || "US");

let kalMarknad = "US";

function viewKalender() {
  const M = MARKETS[kalMarknad];
  const nu = new Date();
  const idagUtc = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate()));
  const malvecka = isoVecka(new Date(idagUtc.getTime() + LEDTID * 7 * DAG));
  const tabell = SASONG[kalMarknad] || SASONG.EU;
  const fonsterFor = (v) => tabell.find((k) => v >= k.fran && v <= k.till) || tabell[tabell.length - 1];

  const rad = (tema, marknad) => {
    const g = gjord(tema, marknad);
    return `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--hair)">
      <div style="min-width:0;flex:1">
        <p style="margin:0;font-size:13.5px;font-weight:500">${esc(tema)}</p>
        <p class="muted" style="margin:3px 0 0">${g
          ? `Researchad i ${esc(MARKETS[marknad].name)} — ${g.antal} kandidater, senast ${esc(g.senast || "okänt datum")}`
          : `Inte researchad i ${esc(MARKETS[marknad].name)}`}</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="chip" href="${esc(adlibUrl(tema, marknad))}" target="_blank" rel="noopener noreferrer">Se annonserna</a>
        ${g
          ? `<a class="chip" href="#/research" data-sok="${esc(tema)}">Kandidaterna &rarr;</a>`
          : `<button class="fbtn" data-kor="${esc(tema)}" data-land="${marknad}" style="font-weight:600;border-color:rgba(79,70,229,.35);background:rgba(79,70,229,.12);color:var(--series-ink)">Kör research</button>`}
      </div>
    </div>`;
  };

  const rader = [];
  for (let i = 0; i < 16; i++) {
    const m = new Date(idagUtc.getTime() + i * 7 * DAG);
    const v = isoVecka(m);
    const start = veckansMandag(m.getUTCFullYear(), v);
    const senast = new Date(start.getTime() - LEDTID * 7 * DAG);
    const teman = fonsterFor(v).teman;
    const klara = teman.filter((t) => gjord(t, kalMarknad)).length;
    rader.push({ v, start, slut: new Date(start.getTime() + 6 * DAG), senast, teman, klara,
      forsenad: senast < idagUtc && klara < teman.length, arMal: v === malvecka });
  }

  return `<div style="display:grid;gap:16px">
    <div class="filters">
      ${KAL_MARKNADER.map((k) => `<button class="fbtn" data-kalmarknad="${k}" aria-pressed="${kalMarknad === k}">${esc(MARKETS[k].name)}</button>`).join("")}
      <span class="muted" style="margin-left:auto">Köpstarka marknader först — Sverige sist, som kontroll</span>
    </div>

    ${sec(`Kör detta nu i ${M.name}`, "computed", `Toppen ligger i vecka ${malvecka}. Research ${LEDTID} veckor före ger annonserna tid att testas färdigt.`, `
      <p class="note" style="margin:0 0 4px">Temana nedan toppar omkring <b>vecka ${malvecka}</b>
      (från ${kortDatum(veckansMandag(idagUtc.getUTCFullYear(), malvecka))}) i ${esc(M.name)}. Kör dem nu, inte då.</p>
      <p class="muted" style="margin:0 0 4px">Belopp räknas i ${M.cur}${M.vat > 0 ? ` med ${pct(M.vat, 0)} moms` : " utan moms i priset — sales tax läggs på i kassan"}.</p>
      ${fonsterFor(malvecka).teman.map((t) => rad(t, kalMarknad)).join("")}`)}

    ${sec(`Kommande toppar i ${M.name}`, null, null, `
      <p class="muted" style="margin:-8px 0 14px">Sista researchdag är veckans start minus ${LEDTID} veckor.
      Har den passerat utan att temat körts står det <b>försenad</b>.${kalMarknad === "AU"
        ? " Australien har omvänd årstid: jul infaller mitt i sommaren och vintern ligger i juni till augusti."
        : ""}</p>
      <div class="scroll"><table style="min-width:560px">
        <thead><tr><th>Vecka</th><th>Toppar</th><th>Researcha senast</th><th>Teman</th><th class="r">Klart</th></tr></thead>
        <tbody>${rader.map((r) => `<tr${r.arMal ? ' style="background:rgba(79,70,229,.07)"' : ""}>
          <td class="num" style="font-weight:600">v.${r.v}</td>
          <td class="muted">${kortDatum(r.start)}&ndash;${kortDatum(r.slut)}</td>
          <td class="num"${r.forsenad ? ' style="color:var(--neg-ink);font-weight:600"' : ""}>${kortDatum(r.senast)}${r.forsenad ? " · försenad" : ""}</td>
          <td style="font-size:12.5px">${r.teman.map(esc).join("<br>")}</td>
          <td class="r num">${r.klara}/${r.teman.length}</td>
        </tr>`).join("")}</tbody>
      </table></div>`)}

    ${sec("Bredd året om", null, null, `
      <p class="muted" style="margin:-8px 0 4px">Nischer utan säsong, som bär volym hela året. Körs i ${esc(M.name)}
      när det inte är bråttom med en säsong.</p>
      ${BREDD.map((t) => rad(t, kalMarknad)).join("")}`)}

    ${sec("Var kommer urvalet ifrån", null, null, `
      <p class="note" style="margin:0"><b>Inte från Facebook-annonser.</b> Metas annonsbibliotek går inte att läsa
      automatiskt: Graph API:ts <code>ads_archive</code> svarar OAuthException utan en godkänd utvecklarapp, och den
      publika sidan svarar 403 med en bot-utmaning. Därför finns i stället en <b>Se annonserna</b>-länk vid varje tema
      som öppnar biblioteket för rätt marknad — du tittar, sidan hittar inte på.</p>
      <p class="note" style="margin:10px 0 0">Urvalet är en handelskalender per marknad. Den siktar ${LEDTID} veckor
      framåt, vilket är det närmaste man kommer att vara tidig utan att betala för en trendtjänst. USA, Storbritannien
      och Australien har sina egna helger och säsonger; EU behandlas som en marknad med EUR och ett snitt på
      ${pct(MARKETS.EU.vat, 0)} moms, vilket är en förenkling — satserna skiljer sig mellan länderna.</p>
      <p class="muted" style="margin:12px 0 0;border-top:1px solid var(--hair);padding-top:12px">Ingenting här körs
      automatiskt. Varje knapp är ett anrop du startar, och som kostar OpenAI-krediter.</p>`)}
  </div>`;
}

/* ═══ Tillägg ══════════════════════════════════════════════════════════════
   Allt nedan är byggt på en enkel regel: siffror som går att räkna fram ur
   data räknas fram, siffror som bara du vet frågas efter, och siffror som
   saknas sägs sakna. Ingenting fylls i med gissningar som ser ut som mätning.

   Det du matar in sparas i sidans egen lagring och finns kvar över
   omladdning. Den når inte n8n — den är sidans, inte databasens. */

const LAGER = { kassa: null, risk: null, konto: null, beslut: [], konkurrenter: [], kreativa: [],
  livscykel: {}, avgifter: {}, leverantorer: {} };
let lagerKlart = false;

async function lagerLas() {
  try {
    const db = await cap("db");
    if (!db) { lagerKlart = true; return; }
    const [kassa, risk, konto, avg, lev, beslut, konk, krea, livs] = await Promise.all([
      db.doc("plan/kassa").get(),
      db.doc("plan/risk").get(),
      db.doc("plan/konto").get(),
      db.doc("plan/avgifter").get(),
      db.collection("leverantorer").limit(500).get(),
      db.collection("beslut").orderBy("tid", "desc").limit(200).get(),
      db.collection("konkurrenter").limit(100).get(),
      db.collection("kreativa").orderBy("tid", "desc").limit(200).get(),
      db.collection("livscykel").limit(500).get(),
    ]);
    LAGER.kassa = kassa.exists ? kassa.data() : null;
    LAGER.risk = risk.exists ? risk.data() : null;
    LAGER.konto = konto.exists ? konto.data() : null;
    LAGER.avgifter = avg.exists ? avg.data() : {};
    lev.docs.forEach((d) => { LAGER.leverantorer[d.id] = d.data(); });
    LAGER.beslut = beslut.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    LAGER.konkurrenter = konk.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    LAGER.kreativa = krea.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    livs.docs.forEach((d) => { LAGER.livscykel[d.id] = d.data(); });
  } catch (e) { /* utan lagring visas tomma formulär, inget kraschar */ }
  lagerKlart = true;
  render();
}

/* Lagret läses asynkront. Innan det kommit tillbaka står formulären på sina
   utgångsvärden, och en kassa på noll ser ut som en konkurs. Vyerna som drar
   slutsatser ur inmatade tal håller inne slutsatsen tills lagret är läst. */
function lagerLaddar() {
  if (lagerKlart) return "";
  return `<p class="callout c-warn" style="margin-top:16px">Läser dina sparade inmatningar. Talen nedan är
    utgångsvärden tills de kommit fram.</p>`;
}

async function lagerSkriv(vag, data, samling) {
  try {
    const db = await cap("db");
    if (!db) return false;
    if (samling) await db.collection(samling).doc(vag).set(data);
    else await db.doc(vag).set(data);
    return true;
  } catch (e) { return false; }
}
async function lagerTaBort(samling, id) {
  try { const db = await cap("db"); if (db) await db.collection(samling).doc(id).delete(); } catch (e) {}
}

const nuISO = () => new Date().toISOString();
/* Namn klipps på ordgräns med ellips — "app-styrni" ser ut som en bugg. */
const kortNamn = (t, max) => {
  const s = String(t || "");
  if (s.length <= max) return s;
  const kap = s.slice(0, max);
  const mellanslag = kap.lastIndexOf(" ");
  return (mellanslag > max * 0.6 ? kap.slice(0, mellanslag) : kap.trimEnd()) + "\u2026";
};
const idNu = () => "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ── Färskhet på hela ögonblicksbilden ──────────────────────────────────── */
function farskhetsbanner() {
  const d = dagarSedan(String(META.generatedAt || "").slice(0, 10));
  if (d == null || d < 7) return "";
  const allvar = d >= 21 ? "c-neg" : "c-warn";
  return `<div class="callout ${allvar}" style="margin-bottom:16px">
    <b>Siffrorna är ${d} dagar gamla.</b> Ögonblicksbilden hämtades ${esc(String(META.generatedAt).slice(0, 10))}
    och uppdateras inte av sig själv. Allt utom det du kört från Research sedan dess kan ha rört sig
    ${d >= 21 ? "— en hel månadsrapportering kan ha hunnit passera." : "."}
  </div>`;
}

/* ── Q4: annonspriserna stiger, kalkylen gör det inte ───────────────────── */
const Q4 = { 1: 0.85, 2: 0.9, 3: 0.95, 4: 1, 5: 1, 6: 0.95, 7: 0.9, 8: 0.95, 9: 1, 10: 1.15, 11: 1.4, 12: 1.3 };
const q4Faktor = (m) => Q4[m] || 1;
function q4Justerad(c, manad) {
  const f = q4Faktor(manad);
  const cpaEx = c.mex(c.inputs.cpa * f);
  return { faktor: f, cpaInkl: c.inputs.cpa * f, poas: cpaEx > 0 ? c.contribution / cpaEx : 0, netto: c.contribution - cpaEx };
}

/* ── Policykontroll ─────────────────────────────────────────────────────── */
const POLICY = [
  { niva: "block", etikett: "Meta tillåter inte annonsen",
    varfor: "Vuxenprodukter får inte annonseras på Meta, oavsett hur kalkylen ser ut.",
    re: /vibrator|dildo|g-punkt|parvibrator|sexleksak|analplugg|penisring|onani/i },
  { niva: "block", etikett: "Meta tillåter inte annonsen",
    varfor: "Receptbelagda läkemedel och viktminskningspreparat är förbjudna.",
    re: /ozempic|semaglutid|viktminskningspiller|bantningspiller|receptbelagd/i },
  { niva: "risk", niva2: "risk", etikett: "Hälsopåstående — fastnar ofta i granskning",
    varfor: "Meta begränsar annonser som påstår medicinsk effekt. Vinkeln måste hålla sig till bekvämlighet, inte bot.",
    re: /massage|nacksträckar|hållning|posture|smärt|värk|led\b|rygg|blodcirkulation|terapi|rehab/i },
  { niva: "risk", etikett: "Kroppsfokus — före/efter är inte tillåtet",
    varfor: "Före- och efterbilder på kroppen är förbjudna, och personlig karaktäristik får inte utpekas.",
    re: /bantning|fettförbrän|midjeband|shapewear|hudföryngring|rynk|cellulit/i },
  { niva: "risk", etikett: "Åldersgräns eller tillstånd kan krävas",
    varfor: "Alkohol, spel och tobak kräver särskilda tillstånd och åldersinställningar.",
    re: /vin\b|alkohol|sprit|öl\b|vape|nikotin|spel|casino|lotteri/i },
];
function policy(c) {
  const hoge = (c.name + " " + (c.notes || "") + " " + (c.niche || "")).toLowerCase();
  const traffar = POLICY.filter((p) => p.re.test(hoge));
  if (!traffar.length) return null;
  const block = traffar.find((p) => p.niva === "block");
  return block || traffar[0];
}

/* ── Hur din CAC står sig mot poolens antaganden ────────────────────────── */
function poolPlacering(cacInklMoms) {
  const alla = CANDIDATES.filter((c) => c.country === HOME && c.inputs.cpa > 0).map((c) => c.inputs.cpa).sort((a, b) => a - b);
  if (!alla.length || !ok(cacInklMoms)) return null;
  const under = alla.filter((v) => v < cacInklMoms).length;
  return { percentil: Math.round((under / alla.length) * 100), antal: alla.length,
    median: alla[Math.floor(alla.length / 2)], lagst: alla[0], hogst: alla[alla.length - 1] };
}

/* ── Koncentrationsrisk ─────────────────────────────────────────────────── */
function koncentration() {
  const bidrag = PRODUCTS.map((p) => ({ namn: p.name, v: Math.max(0, p.f.contribution) })).sort((a, b) => b.v - a.v);
  const tot = bidrag.reduce((a, x) => a + x.v, 0);
  if (!tot) return null;
  const andel = bidrag[0].v / tot;
  return { storst: bidrag[0].namn, andel, antal: PRODUCTS.length,
    niva: PRODUCTS.length <= 2 || andel >= 0.7 ? "hog" : andel >= 0.5 ? "medel" : "lag" };
}

/* ── CSV ────────────────────────────────────────────────────────────────── */
function csvRad(v) {
  const s = String(v == null ? "" : v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function kandidatCsv() {
  const h = ["namn", "land", "valuta", "nisch", "researchdag", "omdome", "inkop", "utpris", "frakt", "avgift", "cpa",
    "enheter", "bidrag", "marginal", "poas", "netto", "chans", "policy", "annonssokning"];
  const rader = rankCandidates(CANDIDATES).map(({ c, r }) => {
    const p = policy(c);
    return [c.name, c.country, c.cur, c.niche || "", c.dag || "", c.verdict, c.inputs.cost, c.inputs.sale,
      c.inputs.ship, c.inputs.fee, c.inputs.cpa, c.inputs.units,
      c.contribution.toFixed(2), (c.grossMargin * 100).toFixed(1), c.expectedPoas.toFixed(3),
      c.netPerOrder.toFixed(2), r.score, p ? p.niva : "ok", (c.ad && c.ad.q) || ""].map(csvRad).join(";");
  });
  return "﻿" + h.join(";") + "\n" + rader.join("\n");
}
/* Knappen får själv bära beskedet. En alert() blockeras tyst i en sandlåda
   utan allow-modals, och då hade felet sett ut som att ingenting hände. */
async function laddaNer(filnamn, text, knapp) {
  const svar = (t) => {
    if (!knapp) return;
    const original = knapp.dataset.text || knapp.textContent;
    knapp.dataset.text = original;
    knapp.textContent = t;
    setTimeout(() => { knapp.textContent = knapp.dataset.text; }, 2600);
  };
  const d = await cap("downloads");
  if (!d) { svar("Nedladdning ej tillgänglig"); return; }
  try { await d.save({ filename: filnamn, data: text }); svar("Sparad"); }
  catch (e) { svar("Viewern nekade"); }
}

/* ═══ Kassa ════════════════════════════════════════════════════════════════
   Täckningsbidrag är inte pengar på kontot. Du betalar leverantören direkt,
   Meta drar dagligen, men betalleverantören håller pengarna i några dagar och
   returer kommer ännu senare. Ett lönsamt bolag kan gå omkull på timing. */
const KASSA_STD = { kassa: 0, utbetalningsdagar: 7, leverantorsdagar: 0, returdagar: 30,
  dagligAnnons: 0, fastaKostnader: 0 };
const kassaData = () => Object.assign({}, KASSA_STD, LAGER.kassa || {});

function kassaProjektion(inst, dagar) {
  const K = OVERVIEW.kpis;
  const dagarIManad = 30;
  const intaktPerDag = K.revenueExVat / dagarIManad;
  const rorligPerDag = (K.revenueExVat - K.contribution) / dagarIManad;
  const annonsPerDag = inst.dagligAnnons > 0 ? inst.dagligAnnons : K.adSpend / dagarIManad;
  const fastPerDag = inst.fastaKostnader / dagarIManad;
  /* Returer betalas tillbaka långt efter att ordern räknats som intäkt. De
     läggs på som ett utflöde först när returfönstret passerats. */
  const returSats = PRODUCTS.length
    ? PRODUCTS.reduce((a, p) => a + p.f.returnRate * p.f.revenueExVat, 0) / Math.max(K.revenueExVat, 1)
    : 0;
  const returPerDag = intaktPerDag * returSats;
  const rader = [];
  let saldo = inst.kassa;
  for (let d = 1; d <= dagar; d++) {
    const in_ = d > inst.utbetalningsdagar ? intaktPerDag : 0;
    const retur = d > inst.returdagar ? returPerDag : 0;
    const ut = annonsPerDag + fastPerDag + retur + (d > inst.leverantorsdagar ? rorligPerDag : 0);
    saldo += in_ - ut;
    rader.push({ dag: d, in: in_, ut, saldo });
  }
  const botten = rader.reduce((a, r) => (r.saldo < a.saldo ? r : a), rader[0]);
  const slut = rader.find((r) => r.saldo < 0);
  return { rader, botten, slut, annonsPerDag, intaktPerDag, rorligPerDag, fastPerDag,
    returPerDag, returSats, glapp: inst.returdagar - inst.utbetalningsdagar };
}

function falt(id, etikett, varde, suffix, hjalp) {
  return `<label style="display:grid;gap:4px">
    <span class="muted">${esc(etikett)}</span>
    <span style="display:flex;align-items:center;gap:6px">
      <input type="number" data-kassa="${id}" value="${esc(String(varde))}" step="any"
        style="width:110px;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:10px;padding:7px 10px;font:inherit;font-size:13px;color:var(--ink)">
      <span class="muted">${esc(suffix)}</span>
    </span>
    ${hjalp ? `<span class="muted" style="font-size:11.5px">${esc(hjalp)}</span>` : ""}
  </label>`;
}

function viewKassa() {
  const inst = kassaData();
  const p = kassaProjektion(inst, 60);
  const bredd = (v, max) => Math.max(1, Math.min(100, (Math.abs(v) / (max || 1)) * 100));
  const maxSaldo = Math.max(...p.rader.map((r) => Math.abs(r.saldo)), 1);
  const steg = p.rader.filter((_, i) => i % 5 === 4);

  return `<div style="display:grid;gap:16px">
    ${farskhetsbanner()}
    ${sec("Så ligger pengarna", null, null, `
      <p class="note" style="margin:0 0 14px">Täckningsbidraget säger att affären bär sig. Kassan säger om du
      överlever tiden fram tills den gör det. Fyll i talen nedan — de sparas i sidan.</p>
      <div style="display:flex;flex-wrap:wrap;gap:18px">
        ${falt("kassa", "Kassa i dag", inst.kassa, META.currency, "Vad som faktiskt finns på kontot")}
        ${falt("utbetalningsdagar", "Utbetalning dröjer", inst.utbetalningsdagar, "dagar", "Stripe och Klarna håller pengarna")}
        ${falt("leverantorsdagar", "Kredit hos leverantör", inst.leverantorsdagar, "dagar", "0 om du betalar direkt")}
        ${falt("returdagar", "Returfönster", inst.returdagar, "dagar", "Så länge kunden får ångra sig")}
        ${falt("dagligAnnons", "Annonsbudget per dag", inst.dagligAnnons, META.currency, "0 = räkna på nuvarande takt")}
        ${falt("fastaKostnader", "Fasta kostnader per månad", inst.fastaKostnader, META.currency, "Verktyg, domän, abonnemang")}
      </div>
      ${p.glapp > 0 ? `<p class="callout c-warn" style="margin-top:16px"><b>Returfönstret är ${p.glapp} dagar
        längre än utbetalningsfönstret.</b> Under de dagarna står pengarna på ditt konto utan att vara dina.
        Kassan ser därför strukturellt bättre ut än den är, och ju snabbare du växer desto större blir glappet
        — det är precis vid uppskalning som det brukar smälla.</p>`
        : `<p class="muted" style="margin-top:16px">Utbetalningen dröjer minst lika länge som returfönstret,
        så pengarna på kontot är dina när de kommer. Det är ovanligt bra villkor.</p>`}`)}

    ${sec("Kassalinje 60 dagar", "computed", "Räknat på nuvarande intäktstakt och dina inmatade villkor.", `
      <dl class="cards" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <div class="flat stat"><dt>In per dag</dt><dd class="num">${kr(p.intaktPerDag)}</dd></div>
        <div class="flat stat"><dt>Ut per dag</dt><dd class="num">${kr(p.annonsPerDag + p.rorligPerDag + p.fastPerDag)}</dd></div>
        <div class="flat stat"><dt>Lägsta punkt</dt><dd class="num" style="color:${signColor(p.botten.saldo)}">${kr(p.botten.saldo)}</dd></div>
        <div class="flat stat"><dt>Når botten</dt><dd class="num">dag ${p.botten.dag}</dd></div>
      </dl>
      ${!lagerKlart ? lagerLaddar() : p.slut
        ? `<p class="callout c-neg" style="margin-top:16px"><b>Kassan tar slut dag ${p.slut.dag}.</b>
           I nuvarande takt går saldot under noll ${p.slut.dag < 30 ? "innan månaden är ute" : "inom två månader"}.
           Det är inte samma sak som att affären är olönsam — det är att pengarna kommer för sent.</p>`
        : `<p class="callout c-pos" style="margin-top:16px">Kassan håller hela perioden. Lägsta punkt ${kr(p.botten.saldo)} dag ${p.botten.dag}.</p>`}
      <div style="margin-top:18px;display:grid;gap:6px">
        ${steg.map((r) => `<div style="display:flex;align-items:center;gap:10px">
          <span class="muted num" style="width:46px">dag ${r.dag}</span>
          <div style="flex:1;height:14px;background:rgba(255,255,255,.4);border-radius:7px;overflow:hidden">
            <i style="display:block;height:100%;width:${bredd(r.saldo, maxSaldo)}%;background:${r.saldo >= 0 ? "var(--pos)" : "var(--neg)"}"></i>
          </div>
          <span class="num" style="width:90px;text-align:right;color:${signColor(r.saldo)}">${kr(r.saldo)}</span>
        </div>`).join("")}
      </div>
      <p class="muted" style="margin-top:14px">Modellen är avsiktligt enkel: jämn intäktstakt, jämn kostnadstakt.
      Den fångar timingen, inte enskilda dagar. ${p.returSats > 0
        ? `Returerna räknas på ${pct(p.returSats, 1)} av intäkten och dras först efter returfönstret — men den
           satsen är ett antagande, inte uppmätt: returtabellen är tom.`
        : `Returer rör inte linjen alls, eftersom den antagna returgraden i inställningarna står på noll och
           returtabellen är tom. Det är nästan säkert för optimistiskt — varje procent verklig returgrad drar
           linjen nedåt med ungefär ${kr(p.intaktPerDag * 0.01 * 30)} i månaden.`}</p>`)}

    ${avgiftsSektion()}
  </div>`;
}

/* ═══ Test ═════════════════════════════════════════════════════════════════
   Kandidaterna står på "idé" och rör sig aldrig. Utan en plats att skriva vad
   som faktiskt hände blir systemet aldrig klokare — bara större. */
const STEG = { ide: "Idé", testas: "Testas", vinnare: "Vinnare", forlorare: "Förlorare", arkiv: "Arkiverad" };
const stegAv = (id) => (LAGER.livscykel[id] || {}).steg || "ide";

function viewTest() {
  const iSteg = {};
  Object.keys(STEG).forEach((k) => { iSteg[k] = []; });
  CANDIDATES.forEach((c) => { (iSteg[stegAv(c.id)] || iSteg.ide).push(c); });

  const aktiva = iSteg.testas.concat(iSteg.vinnare, iSteg.forlorare);
  const tratt = aktiva.map((c) => {
    const l = LAGER.livscykel[c.id] || {};
    const verklig = Number(l.verkligCpa) || 0;
    const fel = verklig > 0 && c.inputs.cpa > 0 ? verklig / c.inputs.cpa - 1 : null;
    return { c, l, fel };
  });
  const medFel = tratt.filter((t) => t.fel != null);
  const snittFel = medFel.length ? medFel.reduce((a, t) => a + t.fel, 0) / medFel.length : null;

  const rad = (c) => {
    const l = LAGER.livscykel[c.id] || {};
    const steg = stegAv(c.id);
    return `<tr>
      <td><a href="#/kandidat?id=${esc(c.id)}" style="text-decoration:none">${esc(kortNamn(c.name, 42))}</a>
        <span class="muted" style="display:block">${esc(c.market.name)} · ${esc(c.dag || "")}</span></td>
      <td><select data-steg="${esc(c.id)}" style="border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:8px;padding:4px 8px;font:inherit;font-size:12px">
        ${Object.keys(STEG).map((k) => `<option value="${k}"${steg === k ? " selected" : ""}>${STEG[k]}</option>`).join("")}
      </select></td>
      <td class="num muted">${mult(c.expectedPoas)}</td>
      <td><input type="number" step="any" data-verklig="${esc(c.id)}" value="${esc(String(l.verkligCpa ?? ""))}" placeholder="—"
        style="width:78px;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:8px;padding:4px 8px;font:inherit;font-size:12px;text-align:right"></td>
      <td><input type="number" step="1" data-ordrar="${esc(c.id)}" value="${esc(String(l.ordrar ?? ""))}" placeholder="—"
        style="width:64px;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:8px;padding:4px 8px;font:inherit;font-size:12px;text-align:right"></td>
      <td class="r num">${(() => {
        const v = Number(l.verkligCpa) || 0;
        if (!v || !c.inputs.cpa) return "—";
        const f = v / c.inputs.cpa - 1;
        return `<span style="color:${f > 0.15 ? "var(--neg-ink)" : f < -0.15 ? "var(--pos-ink)" : "var(--ink2)"}">${f > 0 ? "+" : ""}${pct(f, 0)}</span>`;
      })()}</td>
    </tr>`;
  };

  const kanTestas = CANDIDATES.filter((c) => stegAv(c.id) === "ide" && c.verdict !== "UNDVIK");
  const blockeradeHar = kanTestas.filter((c) => (policy(c) || {}).niva === "block").length;
  const valbara = rankCandidates(kanTestas.filter((c) => (policy(c) || {}).niva !== "block")).slice(0, 12);

  return `<div style="display:grid;gap:16px">
    ${lagerKlart ? "" : `<div>${lagerLaddar()}</div>`}
    ${sec("Träffsäkerhet", "computed", "Hur fel kalkylen var, mätt mot det du skrivit in.", `
      ${snittFel == null
        ? `<p class="note" style="margin:0">Ingen kandidat har ett verkligt utfall inskrivet än. Så fort du fyllt i
           verklig CPA på ett par tester räknas snittfelet här — och då vet du om systemet systematiskt gissar
           för lågt, vilket är den vanligaste sjukan.</p>`
        : `<div style="display:flex;align-items:flex-end;gap:12px">
             <span class="num" style="font-size:38px;font-weight:600;line-height:1;color:${signColor(-snittFel)}">${snittFel > 0 ? "+" : ""}${pct(snittFel, 0)}</span>
             <span class="muted" style="padding-bottom:5px">snittfel på CPA över ${medFel.length} test</span>
           </div>
           <p class="note" style="margin-top:12px">${snittFel > 0.15
             ? "Kalkylen gissar systematiskt för lågt. Räkna upp CPA-antagandena med ungefär den här siffran innan du litar på en POAS."
             : snittFel < -0.15 ? "Kalkylen gissar för högt — du köper billigare trafik än modellen antar."
             : "Gissningarna ligger nära utfallet. Modellen är användbar som den är."}</p>`}`)}

    ${sec(`Under test (${aktiva.length})`, null, null, aktiva.length === 0
      ? emptyBox("Inget test pågår.", "Flytta en kandidat till Testas nedan, så dyker den upp här.")
      : `<div class="scroll"><table style="min-width:640px">
          <thead><tr><th>Kandidat</th><th>Steg</th><th>Gissad POAS</th><th>Verklig CPA</th><th>Ordrar</th><th class="r">Fel</th></tr></thead>
          <tbody>${aktiva.map(rad).join("")}</tbody></table></div>
        <p class="muted" style="margin-top:12px">Verklig CPA anges inklusive moms, samma sätt som gissningen, annars
        jämförs äpplen med päron.</p>`)}

    ${sec("Starta ett test", null, null, `
      <p class="muted" style="margin:-8px 0 12px">De bäst rankade kandidaterna som ännu inte testats.${blockeradeHar
        ? ` ${blockeradeHar} kandidater är utelämnade eftersom Meta inte släpper igenom dem — de står kvar med sina siffror under <a href="#/risk" style="color:var(--series-ink)">Risk</a>.`
        : ""}</p>
      <div class="scroll"><table style="min-width:560px">
        <thead><tr><th>Kandidat</th><th>Marknad</th><th class="r">Bidrag</th><th class="r">POAS</th><th class="r">Chans</th><th></th></tr></thead>
        <tbody>${valbara.map(({ c, r }) => `<tr>
          <td><a href="#/kandidat?id=${esc(c.id)}" style="text-decoration:none">${esc(kortNamn(c.name, 44))}</a></td>
          <td class="muted">${esc(c.market.name)}</td>
          <td class="r num">${money(c.contribution, c.cur)}</td>
          <td class="r num">${mult(c.expectedPoas)}</td>
          <td class="r num" style="font-weight:600">${r.score}</td>
          <td class="r"><button class="fbtn" data-starta="${esc(c.id)}">Testa</button></td>
        </tr>`).join("")}</tbody></table></div>`)}

    ${sec("Beslutslogg", null, null, `
      <p class="muted" style="margin:-8px 0 12px">Varför dödade vi produkten? Om sex veckor minns ingen, och risken
      är att ni testar samma sak igen.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <input id="beslutText" type="text" placeholder="Vad beslutades, och varför?" maxlength="300"
          style="flex:1;min-width:240px;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:10px;padding:8px 12px;font:inherit;font-size:13px;color:var(--ink)">
        <button id="beslutSpara" class="fbtn" style="font-weight:600">Spara</button>
      </div>
      ${LAGER.beslut.length === 0 ? emptyBox("Inga beslut loggade.") : `<ul style="margin:0;padding:0;list-style:none;display:grid;gap:8px">
        ${LAGER.beslut.slice(0, 40).map((b) => `<li style="display:flex;gap:12px;align-items:baseline;border-top:1px solid var(--hair);padding-top:8px">
          <span class="muted num" style="flex-shrink:0">${esc(String(b.tid || "").slice(0, 10))}</span>
          <span class="note" style="flex:1">${esc(b.text || "")}</span>
          <button class="fbtn" data-ta-bort-beslut="${esc(b.id)}" style="padding:2px 8px;font-size:11px">Ta bort</button>
        </li>`).join("")}</ul>`}`)}

    ${sec("Konkurrenter att hålla koll på", null, null, `
      <p class="muted" style="margin:-8px 0 12px">Stigande antal aktiva annonser betyder att de skalar, vilket betyder
      att produkten fungerar. Det är den närmaste riktiga trendsignal du kommer utan att betala för en tjänst.
      Räkna annonserna i biblioteket och skriv in siffran — den som rör sig uppåt över veckorna är intressant.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <input id="konkNamn" type="text" placeholder="Varumärke eller sökord" maxlength="80"
          style="flex:1;min-width:180px;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:10px;padding:8px 12px;font:inherit;font-size:13px;color:var(--ink)">
        <select id="konkLand" style="border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:10px;padding:8px 10px;font:inherit;font-size:13px">
          ${KAL_MARKNADER.map((k) => `<option value="${k}">${esc(MARKETS[k].name)}</option>`).join("")}
        </select>
        <input id="konkAntal" type="number" placeholder="antal" style="width:82px;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:10px;padding:8px 10px;font:inherit;font-size:13px">
        <button id="konkSpara" class="fbtn" style="font-weight:600">Spara</button>
      </div>
      ${LAGER.konkurrenter.length === 0 ? emptyBox("Ingen konkurrent bevakas än.") : `<div class="scroll"><table style="min-width:520px">
        <thead><tr><th>Sökord</th><th>Marknad</th><th class="r">Senast</th><th>Historik</th><th></th></tr></thead>
        <tbody>${LAGER.konkurrenter.map((k) => {
          const h = Array.isArray(k.matningar) ? k.matningar : [];
          const sista = h[h.length - 1];
          const forsta = h[0];
          const riktning = h.length > 1 && sista && forsta ? sista.antal - forsta.antal : null;
          return `<tr>
            <td><a href="${esc(adLibraryUrl(k.namn || "", k.land || "US"))}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">${esc(k.namn || "")} &nearr;</a></td>
            <td class="muted">${esc((MARKETS[k.land] || {}).name || k.land || "")}</td>
            <td class="r num">${sista ? sista.antal : "—"}${riktning != null ? ` <span style="color:${riktning > 0 ? "var(--pos-ink)" : riktning < 0 ? "var(--neg-ink)" : "var(--ink3)"}">${riktning > 0 ? "▲" : riktning < 0 ? "▼" : "–"}${Math.abs(riktning)}</span>` : ""}</td>
            <td class="muted" style="font-size:11.5px">${h.slice(-6).map((m) => String(m.dag).slice(5) + ": " + m.antal).join(" · ") || "—"}</td>
            <td class="r"><button class="fbtn" data-ta-bort-konk="${esc(k.id)}" style="padding:2px 8px;font-size:11px">Ta bort</button></td>
          </tr>`;
        }).join("")}</tbody></table></div>`}`)}

    ${sec("Kreativ-liggare", null, null, `
      <p class="muted" style="margin:-8px 0 12px">Efter tjugo tester vet du vilken <b>hooktyp</b> som fungerar för dig,
      inte bara vilken produkt. Meta-siffrorna finns inte i databasen, så de skrivs in för hand.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <input id="kreaHook" type="text" placeholder="Hook eller vinkel" maxlength="120"
          style="flex:1;min-width:200px;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:10px;padding:8px 12px;font:inherit;font-size:13px;color:var(--ink)">
        <select id="kreaTyp" style="border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:10px;padding:8px 10px;font:inherit;font-size:13px">
          ${Object.keys(HOOKTYPER).map((k) => `<option value="${k}">${esc(HOOKTYPER[k])}</option>`).join("")}
        </select>
        <input id="kreaCtr" type="number" step="any" placeholder="CTR %" style="width:86px;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:10px;padding:8px 10px;font:inherit;font-size:13px">
        <input id="kreaCpa" type="number" step="any" placeholder="CPA" style="width:80px;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:10px;padding:8px 10px;font:inherit;font-size:13px">
        <input id="kreaFrek" type="number" step="any" placeholder="Frekvens" style="width:92px;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:10px;padding:8px 10px;font:inherit;font-size:13px">
        <button id="kreaSpara" class="fbtn" style="font-weight:600">Spara</button>
      </div>
      ${LAGER.kreativa.length === 0 ? emptyBox("Ingen kreativ loggad än.") : `<div class="scroll"><table style="min-width:640px">
        <thead><tr><th>Hook</th><th>Typ</th><th class="r">CTR</th><th class="r">CPA</th><th class="r">Frekvens</th><th>Datum</th><th></th></tr></thead>
        <tbody>${LAGER.kreativa.slice(0, 40).map((k) => {
          const frek = k.frekvens == null ? null : Number(k.frekvens);
          const trott = frek != null && frek >= 2.5;
          return `<tr>
          <td>${esc(k.hook || "")}${trott ? ` <span class="pill p-neg" style="margin-left:6px">Byt film</span>` : ""}</td>
          <td class="muted">${esc(HOOKTYPER[k.typ] || HOOKTYPER.ovrigt)}</td>
          <td class="r num">${k.ctr != null ? Number(k.ctr).toFixed(2) + " %" : "—"}</td>
          <td class="r num">${k.cpa != null ? Number(k.cpa).toFixed(0) : "—"}</td>
          <td class="r num" style="${trott ? "color:var(--neg-ink);font-weight:600" : ""}">${frek == null ? "—" : frek.toFixed(1)}</td>
          <td class="muted num">${esc(String(k.tid || "").slice(0, 10))}</td>
          <td class="r"><button class="fbtn" data-ta-bort-krea="${esc(k.id)}" style="padding:2px 8px;font-size:11px">Ta bort</button></td>
        </tr>`; }).join("")}</tbody></table></div>
        ${(() => {
          const trotta = LAGER.kreativa.filter((k) => k.frekvens != null && Number(k.frekvens) >= 2.5);
          if (!trotta.length) return `<p class="muted" style="margin-top:12px">Frekvensen säger hur många gånger
            samma person sett filmen. Över 2,5 tillsammans med fallande CTR betyder att den är utsliten, inte att
            produkten är fel.</p>`;
          return `<p class="callout c-warn" style="margin-top:14px"><b>${trotta.length}
            ${trotta.length === 1 ? "kreativ är" : "kreativa är"} utslitna.</b> Frekvens över 2,5 betyder att samma
            person sett filmen två och en halv gång. Då stiger CPA:n av trötthet, inte för att produkten slutat
            fungera — byt film innan du sänker budgeten.</p>`;
        })()}`}`)}

    ${vinkelbibliotek()}
  </div>`;
}

/* ═══ Risk ═════════════════════════════════════════════════════════════════ */
const TROSKLAR = [
  { kod: "GB", namn: "Storbritannien", belopp: 85000, valuta: "GBP", vad: "VAT-registrering", not: "Gäller omsättning i Storbritannien under rullande 12 månader." },
  { kod: "EU", namn: "EU (OSS)", belopp: 10000, valuta: "EUR", vad: "OSS-registrering", not: "Gäller total distansförsäljning till alla EU-länder tillsammans. Tröskeln är låg och passeras lätt." },
  { kod: "US", namn: "USA", belopp: 100000, valuta: "USD", vad: "Economic nexus", not: "Gäller PER DELSTAT och varierar. 100 000 dollar eller 200 transaktioner är det vanligaste, men inte universellt." },
  { kod: "AU", namn: "Australien", belopp: 75000, valuta: "AUD", vad: "GST-registrering", not: "Gäller omsättning i Australien under 12 månader." },
];
const RISK_STD = { manadsbudget: 0, killPoas: 1, killOrdrar: 30 };
const riskData = () => Object.assign({}, RISK_STD, LAGER.risk || {});

function omsattningPerMarknad() {
  const per = {};
  PRODUCTS.forEach((p) => { per[HOME] = (per[HOME] || 0) + p.f.revenueExVat; });
  return per;
}

function viewRisk() {
  const inst = riskData();
  const konc = koncentration();
  const oms = omsattningPerMarknad();
  const K = OVERVIEW.kpis;

  const flaggade = CANDIDATES.map((c) => ({ c, p: policy(c) })).filter((x) => x.p);
  const blockerade = flaggade.filter((x) => x.p.niva === "block");
  const riskabla = flaggade.filter((x) => x.p.niva === "risk");
  const utanLeverantor = CANDIDATES.length;
  const utanLev = CANDIDATES.filter((c) => !(levFor(c.id).url || "").trim()).length;

  /* Heter nu, inte idag: idag() är en global hjälpare och ett skuggat namn
     här hade gjort varje framtida anrop till den i den här vyn till ett fel. */
  const nu = new Date();
  const dagarIManaden = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() + 1, 0)).getUTCDate();
  const dagNu = nu.getUTCDate();
  const takt = K.adSpend / Math.max(1, dagNu);
  const prognos = takt * dagarIManaden;
  const slutDag = inst.manadsbudget > 0 ? Math.floor(inst.manadsbudget / Math.max(takt, 0.01)) : null;

  return `<div style="display:grid;gap:16px">
    ${farskhetsbanner()}
    ${lagerKlart ? "" : `<div>${lagerLaddar()}</div>`}

    ${sec("Koncentration", "computed", "Hur mycket av bidraget som hänger på en enda produkt.", konc
      ? `<div style="display:flex;align-items:flex-end;gap:12px">
          <span class="num" style="font-size:38px;font-weight:600;line-height:1">${pct(konc.andel, 0)}</span>
          <span class="muted" style="padding-bottom:5px">av täckningsbidraget kommer från ${esc(konc.storst)}</span>
        </div>
        <div class="meter" style="margin-top:12px"><i style="width:${Math.round(konc.andel * 100)}%;background:${konc.niva === "hog" ? "var(--neg)" : konc.niva === "medel" ? "var(--warn)" : "var(--pos)"}"></i></div>
        <p class="note" style="margin-top:14px">${konc.niva === "hog"
          ? `Du har ${konc.antal} ${konc.antal === 1 ? "produkt" : "produkter"}. Åker en på en policyvarning eller en leverantörsstopp försvinner större delen av rörelsen samma dag. Det är den vanligaste dödsorsaken för små butiker som faktiskt hade en fungerande produkt.`
          : "Spridningen är rimlig. Ingen enskild produkt bär hela rörelsen."}</p>`
      : emptyBox("Inget bidrag att fördela än."))}

    ${sec("Annonsbudget", null, null, `
      <div style="display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end">
        ${falt("manadsbudget", "Månadsbudget", inst.manadsbudget, META.currency, "0 = ingen gräns satt")}
        <div class="flat stat" style="min-width:120px"><dt>Förbrukat</dt><dd class="num">${kr(K.adSpend)}</dd></div>
        <div class="flat stat" style="min-width:120px"><dt>Takt per dag</dt><dd class="num">${kr(takt)}</dd></div>
        <div class="flat stat" style="min-width:120px"><dt>Prognos månad</dt><dd class="num">${kr(prognos)}</dd></div>
      </div>
      ${inst.manadsbudget > 0
        ? (slutDag && slutDag <= dagarIManaden
          ? `<p class="callout c-warn" style="margin-top:16px">I den här takten är budgeten slut <b>dag ${slutDag}</b> av ${dagarIManaden}.</p>`
          : `<p class="callout c-pos" style="margin-top:16px">Takten håller sig inom budgeten månaden ut.</p>`)
        : `<p class="muted" style="margin-top:14px">Sätt en månadsbudget så räknas dagen då den tar slut.</p>`}`)}

    ${sec("Dödsregeln", null, null, `
      <p class="note" style="margin:0 0 14px">Bestäm gränsen innan pengarna sitter i det. En regel skriven i förväg är
      det enda som håller när man redan lagt 4 000 kronor på en produkt man tror på.</p>
      <div style="display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end">
        ${falt("killPoas", "Stäng av under POAS", inst.killPoas, "", "1,00 är break-even")}
        ${falt("killOrdrar", "efter minst", inst.killOrdrar, "ordrar", "Innan dess är utfallet brus")}
      </div>
      <div class="scroll" style="margin-top:16px"><table style="min-width:520px">
        <thead><tr><th>Produkt</th><th class="r">POAS</th><th class="r">Ordrar</th><th>Läge</th></tr></thead>
        <tbody>${PRODUCTS.map((p) => {
          const nogOrdrar = p.f.orders >= inst.killOrdrar;
          const under = p.f.poas < inst.killPoas;
          const lage = !nogOrdrar ? ["För tidigt att döma", "p-neu"] : under ? ["Regeln säger stäng av", "p-neg"] : ["Över gränsen", "p-pos"];
          return `<tr><td>${esc(p.name)}</td><td class="r num">${mult(p.f.poas)}</td>
            <td class="r num">${num(p.f.orders)}</td><td>${pill(lage[0], lage[1])}</td></tr>`;
        }).join("")}</tbody></table></div>`)}

    ${sec("Registreringströsklar", null, null, `
      <p class="note" style="margin:0 0 14px">Den här är billig att missa och dyr att upptäcka i efterhand. Passerar du
      en tröskel utan att registrera dig blir momsen din kostnad retroaktivt, inte kundens.</p>
      <p class="muted" style="margin:-6px 0 14px">Omsättningskolumnen läses ur ordertabellen per marknad. All
      försäljning hittills är svensk och räknas inte mot någon av raderna nedan, så de står på noll tills den
      första utlandsordern kommer. Tabellen är alltså en förvarning, inte en mätning.</p>
      <div class="scroll"><table style="min-width:560px">
        <thead><tr><th>Marknad</th><th>Gäller</th><th class="r">Tröskel</th><th class="r">Din omsättning</th><th>Läge</th></tr></thead>
        <tbody>${TROSKLAR.map((t) => {
          const o = oms[t.kod] || 0;
          const andel = t.belopp > 0 ? o / t.belopp : 0;
          const lage = o === 0 ? ["Ingen försäljning", "p-neu"] : andel >= 0.8 ? ["Nära tröskeln", "p-neg"] : andel >= 0.5 ? ["Halvvägs", "p-warn"] : ["God marginal", "p-pos"];
          return `<tr><td><b style="font-weight:500">${esc(t.namn)}</b><span class="muted" style="display:block;font-size:11.5px">${esc(t.not)}</span></td>
            <td class="muted">${esc(t.vad)}</td>
            <td class="r num">${nf({ maximumFractionDigits: 0 }).format(t.belopp)} ${esc(t.valuta)}</td>
            <td class="r num">${o > 0 ? nf({ maximumFractionDigits: 0 }).format(o) : "—"}</td>
            <td>${pill(lage[0], lage[1])}</td></tr>`;
        }).join("")}</tbody></table></div>
      <p class="muted" style="margin-top:14px">Beloppen är de vanligaste gränserna och ändras. Kontrollera mot
      skattemyndigheten i landet innan du förlitar dig på dem — särskilt USA, där varje delstat har sin egen regel.</p>`)}

    ${sec("Annonspolicy", "computed", "Regelbaserad kontroll mot Metas förbjudna och begränsade kategorier.", `
      <dl class="cards" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <div class="flat stat"><dt>Blockerade</dt><dd class="num" style="color:var(--neg-ink)">${blockerade.length}</dd></div>
        <div class="flat stat"><dt>Kräver försiktighet</dt><dd class="num" style="color:var(--warn-ink,var(--ink))">${riskabla.length}</dd></div>
        <div class="flat stat"><dt>Utan anmärkning</dt><dd class="num">${CANDIDATES.length - flaggade.length}</dd></div>
      </dl>
      ${blockerade.length ? `<div style="margin-top:16px">
        <h3 class="lab" style="font-size:12px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--ink3)">Går inte att annonsera</h3>
        <ul style="margin:10px 0 0;padding:0;list-style:none;display:grid;gap:8px">
          ${blockerade.slice(0, 12).map(({ c, p }) => `<li style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline;border-top:1px solid var(--hair);padding-top:8px">
            <a href="#/kandidat?id=${esc(c.id)}" style="font-size:13px;text-decoration:none">${esc(kortNamn(c.name, 48))}</a>
            <span class="num muted">${money(c.contribution, c.cur)} i bidrag</span>
            <span class="muted" style="flex-basis:100%">${esc(p.varfor)}</span>
          </li>`).join("")}
        </ul>
        <p class="note" style="margin-top:12px">De här ligger kvar i listan med sina siffror, men de går inte att
        annonsera på Meta. Räkna inte med dem när du planerar.</p>
      </div>` : ""}
      ${riskabla.length ? `<div style="margin-top:18px;border-top:1px solid var(--hair);padding-top:14px">
        <h3 class="lab" style="font-size:12px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--ink3)">Kräver försiktig vinkel</h3>
        <p class="muted" style="margin:8px 0 0">${riskabla.length} kandidater rör hälsa, kropp eller åldersgränsade
        kategorier. De går att annonsera, men vinkeln måste hålla sig till bekvämlighet och funktion — aldrig bot,
        aldrig före och efter på kroppen.</p>
      </div>` : ""}`)}

    ${kontoSektion()}

    ${sec("Det vi inte vet", null, null, `
      <ul style="margin:0;padding:0;list-style:none;display:grid;gap:10px">
        ${[["Leverantör och ledtid", utanLev >= utanLeverantor
             ? `<code>supplier_url</code> är tom på alla ${utanLeverantor} kandidater, och ingen har fått en länk i sidans egen lagring heller. Fyll i länk och ledtid på kandidatsidan — en produkt som tar 25 dagar till USA har ett returproblem inbyggt, oavsett hur fin kalkylen ser ut.`
             : `${utanLeverantor - utanLev} av ${utanLeverantor} kandidater har fått leverantör och ledtid ifyllda här i sidan; ${utanLev} saknar det fortfarande. Databasens <code>supplier_url</code> är tom på allihop — det är sidans lagring som håller det du skrivit in.`],
           ["Återköpsfrekvens", "Går inte att räkna: ordertabellen saknar kundidentitet. Om 15 % köper igen stiger din tillåtna CAC lika mycket, och gränsfall blir plötsligt lönsamma. Det kräver en kolumn i databasen, inte en inmatning här."],
           ["Valutaexponering", "Du säljer snart i USD, GBP och AUD, köper i USD och rapporterar i SEK. Ingen kurskälla är inkopplad, så kursrörelse och drift går inte att skilja åt. Avgiftstabellen i Kassa täcker betalavgiften, inte kursen."],
           ["Annonstratten", "Visningar och klick finns som kolumner i databasen men är tomma. Utan dem går det inte att se om en dålig CPA beror på kreativen eller på landningssidan."],
           ["Returgrad över tid", "Returtabellen är tom, så kassalinjen räknar på det antagna värdet. Driftar den verkliga returgraden uppåt äts bidraget tyst, och ingenting i sidan skulle märka det."]]
          .map(([t, d]) => `<li style="border-top:1px solid var(--hair);padding-top:10px">
            <b style="font-size:13px;font-weight:500">${t}</b>
            <span class="muted" style="display:block;margin-top:3px">${d}</span></li>`).join("")}
      </ul>`)}
  </div>`;
}

/* ═══ Avgifter per marknad ═════════════════════════════════════════════════
   Du räknar med ungefär tre procent överallt. Klarna och Stripe tar olika
   mycket i olika länder, och på en tunn marginal är skillnaden mellan 2,4 %
   och 3,9 % hela vinsten på en gränsfallsprodukt.

   Talen nedan är utgångsvärden, inte mätningar. Ingen kurs- eller priskälla
   är inkopplad, så de är till för att ersättas med det som står i ditt eget
   avtal — därför är de redigerbara och sparas. */
const AVGIFT_STD = {
  US: { pct: 2.9, fast: 0.3 }, GB: { pct: 1.5, fast: 0.2 }, AU: { pct: 1.75, fast: 0.3 },
  EU: { pct: 1.5, fast: 0.25 }, SE: { pct: 1.5, fast: 1.8 },
};
const avgiftFor = (kod) => Object.assign({}, AVGIFT_STD[kod] || AVGIFT_STD.SE, (LAGER.avgifter || {})[kod] || {});
const avgiftAv = (kod, ordervarde) => {
  const a = avgiftFor(kod);
  return (ordervarde * a.pct) / 100 + a.fast;
};

function avgiftsSektion() {
  return sec("Avgifter per marknad", null, null, `
    <p class="note" style="margin:0 0 14px">Utgångsvärdena är vanliga listpriser, inte hämtade från ditt konto.
    Skriv in det som faktiskt står i ditt avtal — på en gränsfallsprodukt är skillnaden mellan 2,4 % och 3,9 %
    hela vinsten.</p>
    <div class="scroll"><table style="min-width:520px">
      <thead><tr><th>Marknad</th><th class="r">Procent</th><th class="r">Fast per order</th><th class="r">På en order à 500</th></tr></thead>
      <tbody>${KAL_MARKNADER.map((k) => {
        const a = avgiftFor(k);
        return `<tr>
          <td>${esc(MARKETS[k].name)}</td>
          <td class="r"><input type="number" step="any" data-avgift="${k}|pct" value="${a.pct}"
            style="width:72px;text-align:right;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:8px;padding:4px 8px;font:inherit;font-size:12px"> %</td>
          <td class="r"><input type="number" step="any" data-avgift="${k}|fast" value="${a.fast}"
            style="width:72px;text-align:right;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:8px;padding:4px 8px;font:inherit;font-size:12px"> ${esc(MARKETS[k].cur)}</td>
          <td class="r num">${money(avgiftAv(k, 500), MARKETS[k].cur)}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`);
}

/* Kandidatens antagna avgift mot vad tabellen säger för just det ordervärdet. */
function kandidatAvgift(c) {
  const ordervarde = c.inputs.sale * c.inputs.units;
  const enligtTabell = avgiftAv(c.country, ordervarde);
  const antagen = c.inputs.fee;
  const diff = antagen - enligtTabell;
  if (Math.abs(diff) < Math.max(0.5, enligtTabell * 0.08)) return "";
  const forLagt = diff < 0;
  const paverkan = c.mex(Math.abs(diff));
  return `<p class="callout ${forLagt ? "c-warn" : "c-pos"}" style="margin-top:14px">
    <b>Betalavgiften ${forLagt ? "ser låg ut" : "ser generös ut"}.</b> Kalkylen räknar
    ${money(antagen, c.cur)} per order; ${esc(MARKETS[c.country].name)}-raden i Kassa ger
    ${money(enligtTabell, c.cur)} på ett ordervärde om ${money(ordervarde, c.cur)}.
    ${forLagt
      ? `Stämmer tabellen försvinner ${money(paverkan, c.cur)} till av bidraget per order, och POAS faller till
         ${mult((c.contribution - paverkan) / c.cpaEx)}.`
      : `Bidraget är i så fall ${money(paverkan, c.cur)} bättre per order än kalkylen visar.`}
  </p>`;
}

/* ═══ Leverantör och kalkylens ålder ═══════════════════════════════════════
   supplier_url är null på varenda kandidat. En produkt som tar 25 dagar till
   USA har ett returproblem inbyggt, oavsett hur fin kalkylen ser ut. */
const LEV_STD = { url: "", ledtid: "", moq: "" };
const levFor = (id) => Object.assign({}, LEV_STD, (LAGER.leverantorer || {})[id] || {});

function leverantorsSektion(c) {
  const l = levFor(c.id);
  const ledtid = Number(l.ledtid) || 0;
  const alder = dagarSedan(String(c.created || "").slice(0, 10));
  const gammal = alder != null && alder >= 45;

  return sec("Leverantör och kalkylens ålder", null, null, `
    <p class="note" style="margin:0 0 14px">Två saker fattas i databasen och ingen research kan gissa dem åt dig:
    var produkten faktiskt köps och hur lång tid den tar fram.</p>
    <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end">
      <label style="display:grid;gap:4px;flex:1;min-width:220px">
        <span class="muted">Leverantörslänk</span>
        <input type="url" data-lev="${esc(c.id)}|url" value="${esc(l.url)}" placeholder="https://…"
          style="border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:10px;padding:7px 10px;font:inherit;font-size:13px;color:var(--ink)">
      </label>
      <label style="display:grid;gap:4px">
        <span class="muted">Ledtid till kund</span>
        <span style="display:flex;align-items:center;gap:6px">
          <input type="number" data-lev="${esc(c.id)}|ledtid" value="${esc(String(l.ledtid))}" placeholder="—"
            style="width:74px;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:10px;padding:7px 10px;font:inherit;font-size:13px;color:var(--ink)">
          <span class="muted">dagar</span></span>
      </label>
      <label style="display:grid;gap:4px">
        <span class="muted">Minsta order</span>
        <span style="display:flex;align-items:center;gap:6px">
          <input type="number" data-lev="${esc(c.id)}|moq" value="${esc(String(l.moq))}" placeholder="—"
            style="width:74px;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:10px;padding:7px 10px;font:inherit;font-size:13px;color:var(--ink)">
          <span class="muted">st</span></span>
      </label>
    </div>
    ${ledtid >= 20 ? `<p class="callout c-warn" style="margin-top:14px"><b>${ledtid} dagars ledtid bygger in ett
      returproblem.</b> Över tre veckors väntan är den vanligaste orsaken till återbetalningskrav och tvister,
      och den kostnaden syns inte i kalkylen ovan.</p>`
      : ledtid > 0 ? `<p class="callout c-pos" style="margin-top:14px">${ledtid} dagars ledtid är hanterbart.
        Skriv ut leveranstiden i annonsen ändå — förväntan är halva returorsaken.</p>` : ""}
    ${alder == null ? "" : `<p class="${gammal ? "callout c-warn" : "muted"}" style="margin-top:14px">
      ${gammal ? "<b>Kalkylen är " + alder + " dagar gammal.</b> Leverantörspriser rör sig, särskilt inför Q4. "
        + "Kontrollera inköpspriset mot leverantören innan du räknar hem den här."
        : "Kalkylen räknades för " + alder + " " + (alder === 1 ? "dag" : "dagar") + " sedan. Inköpspriset är färskt nog."}</p>`}`);
}

/* ═══ Annonskontots hälsa ══════════════════════════════════════════════════
   Ett konto som fastnar är dyrare än vilken dålig produkt som helst. Meta
   lämnar inte ut siffran, så den skrivs in. */
const KONTO_STD = { inskickade: 0, avslagna: 0, not: "" };
const kontoData = () => Object.assign({}, KONTO_STD, LAGER.konto || {});

function kontoSektion() {
  const k = kontoData();
  const andel = k.inskickade > 0 ? k.avslagna / k.inskickade : null;
  const niva = andel == null ? null : andel >= 0.2 ? "hog" : andel >= 0.1 ? "medel" : "lag";
  return sec("Annonskontots hälsa", null, null, `
    <p class="note" style="margin:0 0 14px">Avslagen syns bara i Metas gränssnitt. Räkna dem en gång i veckan och
    skriv in summan — det är avslagsandelen över tid som säger om kontot är på väg att begränsas, inte det enskilda
    avslaget.</p>
    <div style="display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end">
      ${falt("kontoInskickade", "Inskickade annonser", k.inskickade, "st", "Totalt sedan du började räkna")}
      ${falt("kontoAvslagna", "Avslagna", k.avslagna, "st", "Inklusive de som gick igenom efter överklagan")}
      <div class="flat stat" style="min-width:130px"><dt>Avslagsandel</dt>
        <dd class="num" style="color:${niva === "hog" ? "var(--neg-ink)" : niva === "medel" ? "var(--warn-ink,var(--ink))" : "var(--ink)"}">
          ${andel == null ? "—" : pct(andel, 0)}</dd></div>
    </div>
    <label style="display:grid;gap:4px;margin-top:16px">
      <span class="muted">Begränsningar eller varningar på kontot</span>
      <input type="text" data-konto-not value="${esc(k.not)}" maxlength="200" placeholder="Tomt är goda nyheter"
        style="border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.6);border-radius:10px;padding:8px 12px;font:inherit;font-size:13px;color:var(--ink)">
    </label>
    ${niva === "hog" ? `<p class="callout c-neg" style="margin-top:14px"><b>Var femte annons avslås.</b> På den nivån
      är risken reell att kontot begränsas. Gå igenom vilka kategorier avslagen gäller innan du skickar in fler —
      Annonspolicy-rutan ovan visar vilka av dina kandidater som rör förbjudna områden.</p>`
      : niva === "medel" ? `<p class="callout c-warn" style="margin-top:14px">Avslagsandelen börjar bli hög. Det är
        oftast en handfull produkter som står för dem.</p>`
      : k.inskickade > 0 ? `<p class="callout c-pos" style="margin-top:14px">Kontot ser friskt ut.</p>` : ""}
    ${k.not ? `<p class="callout c-warn" style="margin-top:14px"><b>Noterat:</b> ${esc(k.not)}</p>` : ""}`);
}

/* ═══ Vinkelbibliotek ══════════════════════════════════════════════════════
   Efter tjugo tester vet du vilken hooktyp som fungerar för dig, inte bara
   vilken produkt. Typen sätts för hand — ingen modell ska gissa den åt dig. */
const HOOKTYPER = {
  problem: "Problemet först", foreefter: "Före och efter", pris: "Priset först",
  demo: "Ren demo", rost: "Kundröst", humor: "Humor", ovrigt: "Övrigt",
};

function vinkelbibliotek() {
  const per = {};
  LAGER.kreativa.forEach((k) => {
    const t = k.typ && HOOKTYPER[k.typ] ? k.typ : "ovrigt";
    (per[t] = per[t] || []).push(k);
  });
  const rader = Object.entries(per).map(([typ, rows]) => {
    const medCtr = rows.filter((r) => r.ctr != null);
    const medCpa = rows.filter((r) => r.cpa != null);
    return {
      typ, antal: rows.length,
      ctr: medCtr.length ? medCtr.reduce((a, r) => a + Number(r.ctr), 0) / medCtr.length : null,
      cpa: medCpa.length ? medCpa.reduce((a, r) => a + Number(r.cpa), 0) / medCpa.length : null,
    };
  }).sort((a, b) => (b.ctr ?? -1) - (a.ctr ?? -1));

  const nog = LAGER.kreativa.length >= 6;
  return sec("Vinkelbibliotek", "computed", "Snitt per hooktyp ur kreativ-liggaren.", rader.length === 0
    ? emptyBox("Ingen kreativ loggad än.", "Sätt en hooktyp när du loggar, så byggs biblioteket av sig självt.")
    : `<div class="scroll"><table style="min-width:480px">
        <thead><tr><th>Hooktyp</th><th class="r">Antal</th><th class="r">Snitt-CTR</th><th class="r">Snitt-CPA</th></tr></thead>
        <tbody>${rader.map((r) => `<tr>
          <td>${esc(HOOKTYPER[r.typ])}</td>
          <td class="r num">${r.antal}</td>
          <td class="r num">${r.ctr == null ? "—" : r.ctr.toFixed(2) + " %"}</td>
          <td class="r num">${r.cpa == null ? "—" : Math.round(r.cpa)}</td>
        </tr>`).join("")}</tbody></table></div>
      <p class="${nog ? "note" : "callout c-warn"}" style="margin-top:14px">${nog
        ? "Den hooktyp som står överst är den som fungerat bäst för dig, inte den som fungerar bäst i allmänhet. Det är den skillnaden som gör biblioteket värt något."
        : `<b>För få kreativa för att dra en slutsats.</b> ${LAGER.kreativa.length} av ungefär sex behövs innan snittet säger något annat än brus.`}</p>`);
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
  ["/kalender", "Kalender", '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h2M14 14h2M8 18h2"/>'],
  ["/kassa", "Kassa", '<path d="M3 7h18v12H3z"/><path d="M3 11h18"/><circle cx="8" cy="15" r="1.4"/>'],
  ["/test", "Test", '<path d="M9 3h6M10 3v6.5L5.5 18a2 2 0 0 0 1.8 3h9.4a2 2 0 0 0 1.8-3L14 9.5V3"/><path d="M8 15h8"/>'],
  ["/risk", "Risk", '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17.2v.1"/>'],
  ["/alerts", "Alerts", '<path d="M12 3a6 6 0 0 0-6 6c0 4-1.5 5.5-2 6h16c-.5-.5-2-2-2-6a6 6 0 0 0-6-6z"/><path d="M10 20a2 2 0 0 0 4 0"/>'],
  ["/insights", "AI Insights", '<path d="M12 3v1M4.9 6.3l.7.7M3 13.5h1M20 13.5h1M18.4 7l.7-.7"/><path d="M9 17.5a5 5 0 1 1 6 0c-.6.5-.9 1-1 1.8h-4c-.1-.8-.4-1.3-1-1.8z"/><path d="M10 21h4"/>'],
];
const TITLES = { "/": "Overview", "/products": "Products", "/research": "Research", "/kalender": "Kalender", "/kassa": "Kassa", "/test": "Test", "/risk": "Risk", "/alerts": "Alerts", "/insights": "AI Insights", "/produkt": "Produkt", "/kandidat": "Kandidat" };

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
    case "/kalender": html = viewKalender(); break;
    case "/kassa": html = viewKassa(); break;
    case "/test": html = viewTest(); break;
    case "/risk": html = viewRisk(); break;
    case "/alerts": html = viewAlerts(); break;
    case "/insights": html = viewInsights(); break;
    default: html = viewOverview();
  }
  const sub2 = path === "/produkt" || path === "/kandidat";
  const banner = sub2 || path === "/kassa" || path === "/risk" ? "" : farskhetsbanner();
  document.getElementById("view").innerHTML = banner + html;
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
    const df = e.target.closest("[data-day]");
    if (df) { dayFilter = df.dataset.day; return render(); }
    const sok = e.target.closest("[data-sok]");
    if (sok) { query = sok.dataset.sok; countryFilter = "ALL"; dayFilter = "ALL"; return; }
    const km = e.target.closest("[data-kalmarknad]");
    if (km) { kalMarknad = km.dataset.kalmarknad; return render(); }
    const kor = e.target.closest("[data-kor]");
    if (kor) {
      const tema = kor.dataset.kor;
      const land = MARKETS[kor.dataset.land] ? kor.dataset.land : "US";
      query = tema; researchCountry = land; countryFilter = "ALL"; dayFilter = "ALL";
      location.hash = "#/research";
      setTimeout(() => runResearch(tema, land), 0);
      return;
    }
    const s = e.target.closest("[data-sort]");
    if (s) {
      if (sortKey === s.dataset.sort) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortKey = s.dataset.sort; sortDir = "desc"; }
      return render();
    }
    if (e.target.id === "toggleRejected") { showRejected = !showRejected; return render(); }
    if (e.target.closest("#runResearch")) {
      const q = query.trim();
      if (q) runResearch(q, researchCountry);
      return;
    }
    if (e.target.id === "clearQ") { query = ""; return render(); }
    if (e.target.id === "exportCsv") { laddaNer("kandidater.csv", kandidatCsv(), e.target); return; }
    if (e.target.id === "scenNoll") { scen = { pris: 0, cpa: 0, retur: 0 }; return render(); }

    const starta = e.target.closest("[data-starta]");
    if (starta) {
      const id = starta.dataset.starta;
      const d = { steg: "testas", tid: nuISO() };
      LAGER.livscykel[id] = d; lagerSkriv(id, d, "livscykel").then(render);
      return render();
    }
    if (e.target.id === "beslutSpara") {
      const el = document.getElementById("beslutText");
      const text = (el && el.value || "").trim();
      if (!text) return;
      const id = idNu(); const d = { text, tid: nuISO() };
      LAGER.beslut.unshift(Object.assign({ id }, d));
      lagerSkriv(id, d, "beslut"); el.value = "";
      return render();
    }
    if (e.target.id === "konkSpara") {
      const namn = (document.getElementById("konkNamn").value || "").trim();
      const land = document.getElementById("konkLand").value;
      const antal = Number(document.getElementById("konkAntal").value);
      if (!namn || !Number.isFinite(antal)) return;
      const dag = idag();
      const fanns = LAGER.konkurrenter.find((k) => k.namn === namn && k.land === land);
      if (fanns) {
        fanns.matningar = (fanns.matningar || []).filter((m) => m.dag !== dag).concat([{ dag, antal }]);
        lagerSkriv(fanns.id, { namn, land, matningar: fanns.matningar }, "konkurrenter");
      } else {
        const id = idNu(); const d = { namn, land, matningar: [{ dag, antal }] };
        LAGER.konkurrenter.push(Object.assign({ id }, d));
        lagerSkriv(id, d, "konkurrenter");
      }
      document.getElementById("konkNamn").value = ""; document.getElementById("konkAntal").value = "";
      return render();
    }
    if (e.target.id === "kreaSpara") {
      const hook = (document.getElementById("kreaHook").value || "").trim();
      if (!hook) return;
      const ctrEl = document.getElementById("kreaCtr"), cpaEl = document.getElementById("kreaCpa");
      const frekEl = document.getElementById("kreaFrek");
      const id = idNu();
      const d = { hook, typ: document.getElementById("kreaTyp").value,
        ctr: ctrEl.value === "" ? null : Number(ctrEl.value),
        cpa: cpaEl.value === "" ? null : Number(cpaEl.value),
        frekvens: frekEl.value === "" ? null : Number(frekEl.value), tid: nuISO() };
      LAGER.kreativa.unshift(Object.assign({ id }, d));
      lagerSkriv(id, d, "kreativa");
      document.getElementById("kreaHook").value = ""; ctrEl.value = ""; cpaEl.value = ""; frekEl.value = "";
      return render();
    }
    const tbB = e.target.closest("[data-ta-bort-beslut]");
    if (tbB) { const id = tbB.dataset.taBortBeslut; LAGER.beslut = LAGER.beslut.filter((x) => x.id !== id); lagerTaBort("beslut", id); return render(); }
    const tbK = e.target.closest("[data-ta-bort-konk]");
    if (tbK) { const id = tbK.dataset.taBortKonk; LAGER.konkurrenter = LAGER.konkurrenter.filter((x) => x.id !== id); lagerTaBort("konkurrenter", id); return render(); }
    const tbC = e.target.closest("[data-ta-bort-krea]");
    if (tbC) { const id = tbC.dataset.taBortKrea; LAGER.kreativa = LAGER.kreativa.filter((x) => x.id !== id); lagerTaBort("kreativa", id); return render(); }
  });

  /* Sökfältet ritas om vid varje tangenttryck, så fokus och markörläge måste
     återställas efteråt — annars hoppar markören ur fältet efter första
     bokstaven. */
  document.getElementById("view").addEventListener("change", (e) => {
    if (e.target.id !== "rCountry") return;
    researchCountry = e.target.value;
    render();
  });

  /* Sparad research från tidigare körningar. Lagringen svarar först efter
     första målningen, så listan byggs om när den kommer. */
  loadSaved();
  lagerLas();

  /* Inmatningar som sparas i sidans lagring. */
  document.getElementById("view").addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.kassa) {
      const vilken = t.dataset.kassa;
      const iRisk = ["manadsbudget", "killPoas", "killOrdrar"].includes(vilken);
      const iKonto = vilken === "kontoInskickade" || vilken === "kontoAvslagna";
      if (iKonto) {
        const bas = kontoData();
        bas[vilken === "kontoInskickade" ? "inskickade" : "avslagna"] = Math.max(0, Number(t.value) || 0);
        LAGER.konto = bas; await lagerSkriv("plan/konto", bas);
        return render();
      }
      const bas = iRisk ? riskData() : kassaData();
      bas[vilken] = Number(t.value) || 0;
      if (iRisk) { LAGER.risk = bas; await lagerSkriv("plan/risk", bas); }
      else { LAGER.kassa = bas; await lagerSkriv("plan/kassa", bas); }
      return render();
    }
    if (t.dataset && t.dataset.avgift) {
      const [kod, del] = t.dataset.avgift.split("|");
      const bas = Object.assign({}, LAGER.avgifter);
      bas[kod] = Object.assign({}, avgiftFor(kod), { [del]: Math.max(0, Number(t.value) || 0) });
      LAGER.avgifter = bas; await lagerSkriv("plan/avgifter", bas);
      return render();
    }
    if (t.dataset && t.dataset.lev) {
      const [id, del] = t.dataset.lev.split("|");
      const d = Object.assign({}, levFor(id), { [del]: del === "url" ? t.value.trim() : t.value });
      LAGER.leverantorer[id] = d; await lagerSkriv(id, d, "leverantorer");
      return render();
    }
    if (t.hasAttribute && t.hasAttribute("data-konto-not")) {
      const bas = Object.assign(kontoData(), { not: t.value.trim() });
      LAGER.konto = bas; await lagerSkriv("plan/konto", bas);
      return render();
    }
    if (t.dataset && t.dataset.steg) {
      const id = t.dataset.steg;
      const d = Object.assign({}, LAGER.livscykel[id] || {}, { steg: t.value, tid: nuISO() });
      LAGER.livscykel[id] = d; await lagerSkriv(id, d, "livscykel");
      return render();
    }
    if (t.dataset && (t.dataset.verklig || t.dataset.ordrar)) {
      const id = t.dataset.verklig || t.dataset.ordrar;
      const falt2 = t.dataset.verklig ? "verkligCpa" : "ordrar";
      const d = Object.assign({}, LAGER.livscykel[id] || {}, { tid: nuISO() });
      d[falt2] = t.value === "" ? null : Number(t.value);
      LAGER.livscykel[id] = d; await lagerSkriv(id, d, "livscykel");
      return render();
    }
  });

  document.getElementById("view").addEventListener("input", (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.scen) return;
    scen[t.dataset.scen] = Number(t.value) || 0;
    render();
  });

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

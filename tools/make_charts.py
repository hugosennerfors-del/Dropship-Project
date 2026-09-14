#!/usr/bin/env python3
"""
Genererar rapportens diagram som statiska SVG-filer i assets/.

Palett och markspecifikationer följer dataviz-skillens referensinstans.
Kategoriska slots (light surface #fcfcfb): 1 blå #2a78d6, 2 orange #eb6834, 3 aqua #1baf7a.
Validerad med scripts/validate_palette.js --mode light: alla hårda gates PASS.
Aqua ligger under 3:1 mot ytan -> relief-regeln gäller, därför synliga direktetiketter
i varje diagram och fullständiga tabeller i rapporttexten.

Statisk SVG i GitHub-markdown kan inte bära hover-lagret, så identitet bärs av
legend + direktetiketter i stället för tooltip.
"""
import math
import os
import html

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")

SURFACE = "#fcfcfb"
BORDER = "#e7e6e2"
GRID = "#ecebe7"
INK = "#0b0b0b"
INK2 = "#52514e"
MUTED = "#c5c4be"
S1 = "#2a78d6"   # blå
S2 = "#eb6834"   # orange
S3 = "#1baf7a"   # aqua
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

# Sekventiell blå ramp (steg 100-700) ur referenspaletten
RAMP = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7",
        "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"]


def esc(s):
    return html.escape(str(s), quote=True)


def tw(text, size, weight=400):
    """Grov textbreddsuppskattning för systemsans."""
    f = 0.60 if weight >= 600 else 0.555
    narrow = sum(1 for c in str(text) if c in "iljt.,:;'!|()[] ")
    wide = sum(1 for c in str(text) if c in "MWmw@%")
    return (len(str(text)) * f - narrow * 0.22 * f + wide * 0.25 * f) * size


def bar_path(x, y, w, h, r=4, side="right"):
    """Stapel med 4px rundade dataändar, kvadratisk mot baslinjen."""
    r = max(0, min(r, h / 2, w))
    if w <= 0.6:
        return f'M{x:.2f},{y:.2f} h{max(w,0.6):.2f} v{h:.2f} h-{max(w,0.6):.2f} Z'
    if side == "right":
        return (f'M{x:.2f},{y:.2f} h{w-r:.2f} a{r},{r} 0 0 1 {r},{r} '
                f'v{h-2*r:.2f} a{r},{r} 0 0 1 -{r},{r} h-{w-r:.2f} Z')
    return (f'M{x+w:.2f},{y:.2f} h-{w-r:.2f} a{r},{r} 0 0 0 -{r},{r} '
            f'v{h-2*r:.2f} a{r},{r} 0 0 0 {r},{r} h{w-r:.2f} Z')


def vbar_path(x, y, w, h, r=4):
    """Vertikal stapel, rundad topp, kvadratisk bas."""
    r = max(0, min(r, w / 2, h))
    if h <= 0.6:
        return f'M{x:.2f},{y+h:.2f} h{w:.2f} v-{max(h,0.6):.2f} h-{w:.2f} Z'
    return (f'M{x:.2f},{y+h:.2f} v-{h-r:.2f} a{r},{r} 0 0 1 {r},-{r} '
            f'h{w-2*r:.2f} a{r},{r} 0 0 1 {r},{r} v{h-r:.2f} Z')


def head(w, h, title, subtitle, note=None):
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
         f'viewBox="0 0 {w} {h}" role="img" aria-label="{esc(title)}">',
         f'<title>{esc(title)}</title>',
         f'<rect width="{w}" height="{h}" rx="10" fill="{SURFACE}" stroke="{BORDER}"/>',
         f'<text x="28" y="36" font-family="{FONT}" font-size="17" font-weight="600" fill="{INK}">{esc(title)}</text>',
         f'<text x="28" y="57" font-family="{FONT}" font-size="12.5" fill="{INK2}">{esc(subtitle)}</text>']
    if note:
        s.append(f'<text x="28" y="{h-16}" font-family="{FONT}" font-size="11" fill="{INK2}">{esc(note)}</text>')
    return s


def legend(items, x, y, size=12):
    """items: [(färg, etikett)]"""
    out, cx = [], x
    for color, label in items:
        out.append(f'<rect x="{cx:.1f}" y="{y-8:.1f}" width="10" height="10" rx="2.5" fill="{color}"/>')
        out.append(f'<text x="{cx+16:.1f}" y="{y+1:.1f}" font-family="{FONT}" font-size="{size}" fill="{INK2}">{esc(label)}</text>')
        cx += 16 + tw(label, size) + 22
    return out


def write(name, parts):
    parts.append("</svg>")
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))
    print("wrote", path)


# ---------------------------------------------------------------- 1. scatter
def chart_score_evidence():
    W, H = 880, 560
    data = [
        ("Hundbadrock", 80, 72, "rec"), ("Omklädningsrock", 79, 70, "rec"),
        ("Smart fågelmatare", 77, 78, "no"), ("Pälsdammsugare hund", 73, 76, "rec"),
        ("Husdjursfontän", 71, 74, ""), ("Torkbox hund", 70, 58, ""),
        ("Vakuumförslutare", 70, 68, ""), ("Hundbilskydd", 68, 55, ""),
        ("Walking pad", 67, 72, "no"), ("Fascia ring", 67, 55, "no"),
        ("Automatisk kattlåda", 66, 70, ""), ("Bildammsugare", 66, 68, ""),
        ("Värmesulor", 65, 62, ""), ("Retro digitalkamera", 65, 52, ""),
        ("Spinnskrubb", 64, 70, ""), ("Digital fotoram", 64, 60, ""),
        ("Gryningslampa", 63, 64, ""), ("Avfuktarpåsar", 62, 62, ""),
        ("Växtbelysning", 61, 60, ""), ("Galaxprojektor", 60, 72, ""),
    ]
    L, R, T, B = 74, 34, 104, 78
    pw, ph = W - L - R, H - T - B
    x0, x1, y0, y1 = 58, 82, 48, 82

    def px(v): return L + (v - x0) / (x1 - x0) * pw
    def py(v): return T + ph - (v - y0) / (y1 - y0) * ph

    s = head(W, H, "Score mot evidensstyrka — topp 20",
             "Score = bedömning enligt rubriken. Evidence = hur starkt underlaget bakom bedömningen är.",
             "Ingen produkt når Evidence 90+: Google Trends, Amazon, Meta Ad Library och Kalodata gick inte att nå förstahands.")
    s += legend([(S1, "Rekommenderad att testa"), (MUTED, "Övriga i topp 20")], 28, 82)

    for v in range(60, 83, 5):
        s.append(f'<line x1="{px(v):.1f}" y1="{T}" x2="{px(v):.1f}" y2="{T+ph}" stroke="{GRID}" stroke-width="1"/>')
        s.append(f'<text x="{px(v):.1f}" y="{T+ph+20}" font-family="{FONT}" font-size="11.5" fill="{INK2}" text-anchor="middle">{v}</text>')
    for v in range(50, 81, 10):
        s.append(f'<line x1="{L}" y1="{py(v):.1f}" x2="{L+pw}" y2="{py(v):.1f}" stroke="{GRID}" stroke-width="1"/>')
        s.append(f'<text x="{L-12}" y="{py(v)+4:.1f}" font-family="{FONT}" font-size="11.5" fill="{INK2}" text-anchor="end">{v}</text>')

    s.append(f'<line x1="{L}" y1="{py(75):.1f}" x2="{L+pw}" y2="{py(75):.1f}" stroke="{INK2}" stroke-width="1" opacity="0.45"/>')
    s.append(f'<text x="{L+pw-4}" y="{py(75)-7:.1f}" font-family="{FONT}" font-size="11" fill="{INK2}" text-anchor="end">≥ 75 = stark evidens</text>')

    s.append(f'<text x="{L+pw/2:.0f}" y="{T+ph+44}" font-family="{FONT}" font-size="12" fill="{INK2}" text-anchor="middle">Score (0–100)</text>')
    s.append(f'<text x="22" y="{T+ph/2:.0f}" font-family="{FONT}" font-size="12" fill="{INK2}" text-anchor="middle" transform="rotate(-90 22 {T+ph/2:.0f})">Evidence Confidence (0–100)</text>')

    labelled = {"Hundbadrock": (-13, -11), "Omklädningsrock": (12, 16), "Smart fågelmatare": (-12, -13),
                "Pälsdammsugare hund": (12, 5), "Fascia ring": (14, 4), "Galaxprojektor": (12, 4),
                "Retro digitalkamera": (12, 4), "Husdjursfontän": (14, 20)}
    for name, sc, ev, kind in data:
        cx, cy = px(sc), py(ev)
        fill = S1 if kind == "rec" else MUTED
        s.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="7" fill="{fill}" stroke="{SURFACE}" stroke-width="2"/>')
        if name in labelled:
            dx, dy = labelled[name]
            anchor = "start" if dx > 0 else "end"
            weight = "600" if kind == "rec" else "400"
            col = INK if kind == "rec" else INK2
            s.append(f'<text x="{cx+dx:.1f}" y="{cy+dy:.1f}" font-family="{FONT}" font-size="11.5" '
                     f'font-weight="{weight}" fill="{col}" text-anchor="{anchor}">{esc(name)}</text>')
    write("01-score-vs-evidence.svg", s)


# ------------------------------------------------------------- 2. amazon bar
def chart_amazon():
    rows = [("Handhållen bildammsugare", 40000), ("Vakuumförslutare (kläder)", 40000),
            ("Sladdlös husdjursfontän", 30000), ("Torkbox för hund", 30000),
            ("Avfuktarpåsar", 30000), ("Pälsdammsugare hund", 10000),
            ("Elektrisk spinnskrubb", 10000), ("Walking pad", 10000),
            ("Galaxprojektor", 10000), ("Gryningslampa", 8000),
            ("Värmestrumpor", 8000), ("Växtbelysning", 4000),
            ("Skotork / boot dryer", 2000), ("Värmeväst (dam)", 400)]
    W = 880
    rowh, gap = 27, 9
    T, B, L, R = 108, 62, 232, 96
    H = T + len(rows) * (rowh + gap) - gap + B
    pw = W - L - R
    mx = 40000

    s = head(W, H, "Uppskattad månadsvolym för kategoriledaren, Amazon US",
             "Ledande ASIN per sökord, 2026. Skalan visar storleksordning — inte europeisk efterfrågan.",
             "Källa: asinsight.com. Modellerade estimat, inte rapporterade tal. Svensk efterfrågan kan avvika kraftigt.")
    for i in range(0, 5):
        gx = L + pw * i / 4
        s.append(f'<line x1="{gx:.1f}" y1="{T-8}" x2="{gx:.1f}" y2="{H-B+6}" stroke="{GRID}" stroke-width="1"/>')
        s.append(f'<text x="{gx:.1f}" y="{T-16}" font-family="{FONT}" font-size="11" fill="{INK2}" text-anchor="middle">{int(mx*i/4/1000)}k</text>')

    y = T
    for name, v in rows:
        w = pw * v / mx
        s.append(f'<text x="{L-14}" y="{y+rowh/2+4:.1f}" font-family="{FONT}" font-size="12" fill="{INK}" text-anchor="end">{esc(name)}</text>')
        s.append(f'<path d="{bar_path(L, y, w, rowh)}" fill="{S1}"/>')
        lbl = f"{v:,}".replace(",", " ")
        s.append(f'<text x="{L+w+10:.1f}" y="{y+rowh/2+4:.1f}" font-family="{FONT}" font-size="11.5" font-weight="600" fill="{INK}">{lbl}</text>')
        y += rowh + gap
    write("02-amazon-manadsvolym.svg", s)


# ---------------------------------------------------- 3. stacked unit economics
def chart_unit_economics():
    rows = [("Omklädningsrock", 33, 7, 89, "1,45×"), ("Pälsdammsugare hund", 39, 10, 70, "1,70×"),
            ("Hundbadrock", 13, 5, 41, "1,44×"), ("Sladdlös husdjursfontän", 16, 5, 28, "1,75×"),
            ("Elektrisk spinnskrubb", 11, 5, 23, "1,69×")]
    W = 880
    rowh, gap = 40, 20
    T, B, L, R = 120, 66, 208, 168
    H = T + len(rows) * (rowh + gap) - gap + B
    pw = W - L - R
    mx = 130

    s = head(W, H, "Enhetsekonomi per order — vad som faktiskt blir kvar",
             "Retailpris fördelat på inköp, utgående frakt och bidrag. Bidraget är det som betalar annonserna.",
             "Inköp och frakt är mina estimat (kap. 4), inte offerter. Break-even ROAS = 1 ÷ bidragsmarginal.")
    s += legend([(S2, "Inköp (landat)"), (S3, "Frakt ut"), (S1, "Bidrag före annons")], 28, 88)

    for i in range(0, 6):
        gx = L + pw * i * 25 / mx
        if i * 25 > mx:
            break
        s.append(f'<line x1="{gx:.1f}" y1="{T-10}" x2="{gx:.1f}" y2="{H-B+6}" stroke="{GRID}" stroke-width="1"/>')
        s.append(f'<text x="{gx:.1f}" y="{T-18}" font-family="{FONT}" font-size="11" fill="{INK2}" text-anchor="middle">€{i*25}</text>')

    y = T
    for name, cogs, ship, contrib, roas in rows:
        s.append(f'<text x="{L-14}" y="{y+rowh/2+4:.1f}" font-family="{FONT}" font-size="12" fill="{INK}" text-anchor="end">{esc(name)}</text>')
        cx = L
        segs = [(cogs, S2), (ship, S3), (contrib, S1)]
        for idx, (val, col) in enumerate(segs):
            w = pw * val / mx
            side = "right" if idx == len(segs) - 1 else "flat"
            d = bar_path(cx, y, w, rowh) if side == "right" else f'M{cx:.2f},{y:.2f} h{w:.2f} v{rowh:.2f} h-{w:.2f} Z'
            s.append(f'<path d="{d}" fill="{col}"/>')
            if w > tw(f"€{val}", 11.5, 600) + 16:
                s.append(f'<text x="{cx+w/2:.1f}" y="{y+rowh/2+4:.1f}" font-family="{FONT}" font-size="11.5" '
                         f'font-weight="600" fill="#ffffff" text-anchor="middle">€{val}</text>')
            cx += w + 2   # 2px ytglugg mellan segment
        total = cogs + ship + contrib
        s.append(f'<text x="{cx+12:.1f}" y="{y+rowh/2-2:.1f}" font-family="{FONT}" font-size="12" font-weight="600" fill="{INK}">€{total} pris</text>')
        s.append(f'<text x="{cx+12:.1f}" y="{y+rowh/2+14:.1f}" font-family="{FONT}" font-size="11" fill="{INK2}">BE-ROAS {roas}</text>')
        y += rowh + gap
    write("03-enhetsekonomi.svg", s)


# ------------------------------------------------------------ 4. stat tiles
def chart_cpm_tiles():
    W, H = 880, 250
    s = head(W, H, "Vad uppmärksamhet kostar — Meta-CPM per marknad",
             "Tre olika mätningar från tre leverantörer. De är inte strikt jämförbara, därför står de som separata tal.",
             "Källor: Lebesgue, superads, Adligator (2026). Poängen är storleksordningen, inte decimalerna.")
    tiles = [("Sverige", "$9,10–13,50", "Lägst i Västeuropa. Spannet är två\nolika mätfönster, inte en trend.", S1),
             ("Globalt snitt", "~$20,90", "12 mån jul 2025 – jun 2026.\nSamma källa som Sveriges $13,50.", MUTED),
             ("USA", "$22–23", "Ungefär dubbelt mot Sverige.\nDärför testar du inte i USA först.", MUTED)]
    tw_ = (W - 56 - 2 * 20) / 3
    x = 28
    for label, value, note, col in tiles:
        s.append(f'<rect x="{x:.0f}" y="82" width="{tw_:.0f}" height="112" rx="8" fill="#ffffff" stroke="{BORDER}"/>')
        s.append(f'<rect x="{x:.0f}" y="82" width="4" height="112" rx="2" fill="{col}"/>')
        s.append(f'<text x="{x+20:.0f}" y="106" font-family="{FONT}" font-size="12" fill="{INK2}">{esc(label)}</text>')
        s.append(f'<text x="{x+20:.0f}" y="140" font-family="{FONT}" font-size="26" font-weight="600" fill="{INK}">{esc(value)}</text>')
        for i, line in enumerate(note.split("\n")):
            s.append(f'<text x="{x+20:.0f}" y="{164+i*15}" font-family="{FONT}" font-size="11" fill="{INK2}">{esc(line)}</text>')
        x += tw_ + 20
    write("04-cpm-per-marknad.svg", s)


# ------------------------------------------------------- 5. store bubble scatter
def chart_stores():
    W, H = 880, 520
    data = [("Houndsy", 7, 48.9, 67), ("Atlas Pet Company", 29, 68.2, 74),
            ("Fera Pets", 30, -53.3, 112), ("Fable Pets", 70, -4.8, 19),
            ("Hike Footwear", 119, 8.2, 1241), ("The Muzzle Movement", 172, 1.4, 83)]
    L, R, T, B = 74, 40, 116, 82
    pw, ph = W - L - R, H - T - B
    x0, x1, y0, y1 = 0, 185, -60, 80

    def px(v): return L + (v - x0) / (x1 - x0) * pw
    def py(v): return T + ph - (v - y0) / (y1 - y0) * ph
    def rad(ads): return 8 + 16 * math.sqrt(min(ads, 300) / 300)

    s = head(W, H, "Sortimentsbredd mot trafiktillväxt",
             "De 6 av 11 teardown-butikerna som har både SKU-antal och trafikriktning. Bubbla = antal aktiva Meta-annonser.",
             "Källa: brandsearch.co, 2026. Modellerade estimat. Hike Footwear kör 1 241 annonser — kapad bubbelskala.")
    s += legend([(S1, "Butik (bubbla = antal aktiva Meta-annonser)")], 28, 90)

    for v in range(0, 186, 40):
        s.append(f'<line x1="{px(v):.1f}" y1="{T}" x2="{px(v):.1f}" y2="{T+ph}" stroke="{GRID}" stroke-width="1"/>')
        s.append(f'<text x="{px(v):.1f}" y="{T+ph+20}" font-family="{FONT}" font-size="11.5" fill="{INK2}" text-anchor="middle">{v}</text>')
    for v in range(-60, 81, 20):
        s.append(f'<line x1="{L}" y1="{py(v):.1f}" x2="{L+pw}" y2="{py(v):.1f}" stroke="{GRID}" stroke-width="1"/>')
        s.append(f'<text x="{L-12}" y="{py(v)+4:.1f}" font-family="{FONT}" font-size="11.5" fill="{INK2}" text-anchor="end">{v:+d}%</text>')
    s.append(f'<line x1="{L}" y1="{py(0):.1f}" x2="{L+pw}" y2="{py(0):.1f}" stroke="{INK2}" stroke-width="1" opacity="0.5"/>')

    s.append(f'<text x="{L+pw/2:.0f}" y="{T+ph+46}" font-family="{FONT}" font-size="12" fill="{INK2}" text-anchor="middle">Antal produkter i sortimentet</text>')
    s.append(f'<text x="22" y="{T+ph/2:.0f}" font-family="{FONT}" font-size="12" fill="{INK2}" text-anchor="middle" transform="rotate(-90 22 {T+ph/2:.0f})">Trafikförändring</text>')

    offs = {"Houndsy": (0, 40), "Atlas Pet Company": (0, -36), "Fera Pets": (0, 40),
            "Fable Pets": (0, -30), "Hike Footwear": (0, -46), "The Muzzle Movement": (0, -32)}
    for name, sku, growth, ads in data:
        cx, cy, r = px(sku), py(growth), rad(ads)
        s.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{S1}" fill-opacity="0.22" stroke="{S1}" stroke-width="2"/>')
        dx, dy = offs[name]
        s.append(f'<text x="{cx+dx:.1f}" y="{cy+dy:.1f}" font-family="{FONT}" font-size="12" font-weight="600" fill="{INK}" text-anchor="middle">{esc(name)}</text>')
        s.append(f'<text x="{cx+dx:.1f}" y="{cy+dy+14:.1f}" font-family="{FONT}" font-size="10.5" fill="{INK2}" text-anchor="middle">{sku} SKU · {ads} annonser</text>')
    write("05-butiker-sku-vs-tillvaxt.svg", s)


# ------------------------------------------------------------- 6. timeline
def chart_timeline():
    """Vertikal tidslinje. Den horisontella varianten kollapsade: sex händelser
    ligger inom tio månader 2026 och etiketterna gick omöjliga att separera."""
    events = [
        ("13 dec 2024", "GPSR träder i kraft", "EU Responsible Person, spårbarhet och varningar krävs vid försäljningsstället", "past"),
        ("18 aug 2025", "EU:s batteriförordning fullt tillämplig", "Förordning (EU) 2023/1542 ersätter direktiv 2006/66/EG", "past"),
        ("15 jan 2026", "Batteriregistrering kompletteras", "Kemisk sammansättning, skattenummer och tilldelad producentansvarsorganisation", "past"),
        ("19 jun 2026", "Ångerknapp blir obligatorisk", "Gäller alla webbshoppar som säljer till EU-konsumenter, oavsett etableringsland", "past"),
        ("1 jul 2026", "€150-tullfriheten slopas", "€3 i tull per rad i tulldeklarationen för försändelser ≤ €150", "past"),
        ("12 aug 2026", "Svenskt ombud krävs", "För företag utan svensk etablering som säljer förpackade varor till svenska konsumenter", "past"),
        ("14 sep 2026", "Researchen gjord", "Allt nedan ligger framför dig", "now"),
        ("~1 nov 2026", "EU-hanteringsavgift", "Föreslagen av kommissionen — ännu inte beslutad", "future"),
        ("27 nov 2026", "Black Friday", "Black Week 23–29 nov. Sista realistiska tillfället att hinna testa innan peak", "future"),
        ("2027–2028", "Textil-EPR i drift", "Reviderat avfallsdirektiv (EU) 2025/1892. Svenskt startdatum ännu okänt", "future"),
        ("1 jul 2028", "Övergångsregimen upphör", "€3-regimen löper ut och ersätts av permanent ordning", "future"),
    ]
    W = 880
    rowh = 46
    T, B = 132, 66
    H = T + len(events) * rowh + B
    axis_x = 238

    s = head(W, H, "Regelverk och säsong — tidslinje 2024–2028",
             "Datumen är fastställda i EU-källor och svenska källor. Hanteringsavgiften är ett förslag, textil-EPR saknar svenskt startdatum.",
             "Källor: EU-kommissionen (Taxation & Customs Union), Naturvårdsverket, reviderat avfallsdirektiv (EU) 2025/1892.")
    s += legend([(INK2, "Redan i kraft"), (S1, "Idag"), (S2, "Framför dig")], 28, 104)

    s.append(f'<line x1="{axis_x}" y1="{T-6}" x2="{axis_x}" y2="{T + len(events)*rowh - rowh/2:.0f}" '
             f'stroke="{GRID}" stroke-width="2"/>')

    y = T + 8
    for date, title, sub, kind in events:
        col = S1 if kind == "now" else (S2 if kind == "future" else INK2)
        r = 8 if kind == "now" else 5.5
        s.append(f'<text x="{axis_x-26}" y="{y+5:.0f}" font-family="{FONT}" font-size="12" '
                 f'fill="{col}" text-anchor="end">{esc(date)}</text>')
        s.append(f'<circle cx="{axis_x}" cy="{y:.0f}" r="{r}" fill="{col}" stroke="{SURFACE}" stroke-width="2.5"/>')
        if kind == "now":
            s.append(f'<circle cx="{axis_x}" cy="{y:.0f}" r="14" fill="none" stroke="{S1}" stroke-width="1.5" opacity="0.4"/>')
        tcol = INK if kind != "past" else INK
        s.append(f'<text x="{axis_x+28}" y="{y+1:.0f}" font-family="{FONT}" font-size="13" '
                 f'font-weight="600" fill="{tcol}">{esc(title)}</text>')
        s.append(f'<text x="{axis_x+28}" y="{y+17:.0f}" font-family="{FONT}" font-size="11" fill="{INK2}">{esc(sub)}</text>')
        y += rowh
    write("06-tidslinje-regelverk.svg", s)


# ------------------------------------------------------------ 7. tiktok bars
def chart_tiktok():
    rows = [("Tyskland", 174.7), ("Frankrike", 132.8), ("Spanien", 104.7), ("Italien", 86.6), ("Sverige", 0.0)]
    W = 880
    rowh, gap = 34, 14
    T, B, L, R = 108, 66, 168, 190
    H = T + len(rows) * (rowh + gap) - gap + B
    pw = W - L - R
    mx = 180

    s = head(W, H, "TikTok Shop i Europa — GMV per marknad, 90 dagar t.o.m. 9 juli 2026",
             "Kärnmarknaderna omsatte tillsammans ~€499 M. Sverige har ingen TikTok Shop och ingen annonserad lansering.",
             "Källor: Lengow/Kalodata-referat. Sveriges status per juli 2026; inget officiellt besked om Norden.")
    for i in range(0, 5):
        gx = L + pw * i * 45 / mx
        s.append(f'<line x1="{gx:.1f}" y1="{T-8}" x2="{gx:.1f}" y2="{H-B+6}" stroke="{GRID}" stroke-width="1"/>')
        s.append(f'<text x="{gx:.1f}" y="{T-16}" font-family="{FONT}" font-size="11" fill="{INK2}" text-anchor="middle">€{i*45}M</text>')

    y = T
    for name, v in rows:
        s.append(f'<text x="{L-14}" y="{y+rowh/2+4:.1f}" font-family="{FONT}" font-size="12.5" fill="{INK}" text-anchor="end">{esc(name)}</text>')
        if v > 0:
            w = pw * v / mx
            s.append(f'<path d="{bar_path(L, y, w, rowh)}" fill="{S1}"/>')
            s.append(f'<text x="{L+w+10:.1f}" y="{y+rowh/2+4:.1f}" font-family="{FONT}" font-size="12" font-weight="600" fill="{INK}">€{str(v).replace(".", ",")} M</text>')
        else:
            s.append(f'<rect x="{L}" y="{y+rowh/2-1:.1f}" width="26" height="2" rx="1" fill="{MUTED}"/>')
            s.append(f'<text x="{L+36:.1f}" y="{y+rowh/2+4:.1f}" font-family="{FONT}" font-size="12" fill="{INK2}">Inte lanserad — din trafik måste gå till egen butik</text>')
        y += rowh + gap
    write("07-tiktok-shop-europa.svg", s)


# --------------------------------------------------------------- 8. heatmap
def chart_heatmap():
    dims = [("Demand", 20), ("Trend", 20), ("Sales val.", 15), ("Comp. qual.", 10),
            ("Ad pot.", 10), ("Margin", 10), ("Diff.", 10), ("Logist.", 5)]
    rows = [
        ("1 Hundbadrock", [15, 15, 12, 8, 9, 8, 8, 5], 80),
        ("2 Omklädningsrock", [14, 17, 12, 8, 9, 9, 7, 3], 79),
        ("3 Smart fågelmatare", [16, 18, 13, 10, 9, 5, 3, 3], 77),
        ("4 Pälsdammsugare hund", [16, 12, 12, 9, 9, 7, 5, 3], 73),
        ("5 Husdjursfontän", [18, 13, 12, 7, 8, 6, 4, 3], 71),
        ("6 Torkbox hund", [15, 12, 11, 7, 8, 7, 6, 4], 70),
        ("7 Vakuumförslutare", [17, 12, 11, 7, 8, 7, 4, 4], 70),
        ("8 Hundbilskydd", [12, 12, 9, 7, 8, 8, 7, 5], 68),
        ("9 Walking pad", [15, 14, 11, 8, 7, 6, 5, 1], 67),
        ("10 Fascia ring", [12, 13, 11, 7, 9, 7, 4, 4], 67),
    ]
    W = 880
    cw, ch, gapc = 68, 34, 3
    L, T, B, R = 208, 128, 74, 0
    H = T + len(rows) * (ch + gapc) - gapc + B

    s = head(W, H, "Poängsammansättning — topp 10",
             "Färgen visar andel av dimensionens maxvikt. Siffran i cellen är råpoängen.",
             "Ljus cell = svag på den dimensionen. Score är en bedömning enligt en fast rubrik, inte en mätning.")
    x = L
    for name, wgt in dims:
        s.append(f'<text x="{x+cw/2:.1f}" y="{T-14}" font-family="{FONT}" font-size="11" fill="{INK}" text-anchor="middle">{esc(name)}</text>')
        s.append(f'<text x="{x+cw/2:.1f}" y="{T-1}" font-family="{FONT}" font-size="10" fill="{INK2}" text-anchor="middle">max {wgt}</text>')
        x += cw + gapc
    s.append(f'<text x="{W-52}" y="{T-14}" font-family="{FONT}" font-size="11" fill="{INK}" text-anchor="middle">Score</text>')

    y = T + 10
    for name, vals, total in rows:
        s.append(f'<text x="{L-16}" y="{y+ch/2+4:.1f}" font-family="{FONT}" font-size="12" fill="{INK}" text-anchor="end">{esc(name)}</text>')
        x = L
        for (dim, wgt), v in zip(dims, vals):
            frac = v / wgt
            idx = min(len(RAMP) - 1, max(0, int(round(frac * (len(RAMP) - 1)))))
            fill = RAMP[idx]
            txt = "#ffffff" if idx >= 7 else INK
            s.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{cw}" height="{ch}" rx="4" fill="{fill}"/>')
            s.append(f'<text x="{x+cw/2:.1f}" y="{y+ch/2+4:.1f}" font-family="{FONT}" font-size="11.5" font-weight="600" fill="{txt}" text-anchor="middle">{v}</text>')
            x += cw + gapc
        s.append(f'<text x="{W-52}" y="{y+ch/2+4:.1f}" font-family="{FONT}" font-size="13" font-weight="600" fill="{INK}" text-anchor="middle">{total}</text>')
        y += ch + gapc
    write("08-poangsammansattning.svg", s)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    chart_score_evidence()
    chart_amazon()
    chart_unit_economics()
    chart_cpm_tiles()
    chart_stores()
    chart_timeline()
    chart_tiktok()
    chart_heatmap()

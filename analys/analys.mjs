import fs from "node:fs";
const pool = JSON.parse(fs.readFileSync("pool.json", "utf8")).candidates
  .filter((c) => c.country === "SE" && c.verdict !== "UNDVIK");

/* Målgruppsbredd i Sverige (1-4) och säsong (-1/0/+1 per 17 sept, med hösten
   och julhandeln framför sig). Detta är MIN bedömning, inte uppmätt data —
   den syns i utskriften så att varje enskild rad går att invända mot.
   policy: "block" = Meta tillåter inte annonsen alls.
           "risk"  = hälsopåstående som lätt fastnar i granskning. */
const K = {
  "Mini projektor":                  [3, +1, "ok"],
  "Mini Bluetooth-printer":          [2,  0, "ok"],
  "Trådlös däckpump":                [3, +1, "ok"],
  "Laddningsstation för mobil":      [3,  0, "ok"],
  "Monitorarm":                      [3,  0, "ok"],
  "Roterande smyckesförvaring":      [2, +1, "ok"],
  "Magnetisk trådlös billaddare":    [3,  0, "ok"],
  "LED väckarklocka":                [3,  0, "ok"],
  "Bilorganisatör för baksäte":      [2,  0, "ok"],
  "Uppvärmbar halsvärmare":          [2, +1, "risk"],
  "Portabel handhållen massagepist": [2,  0, "risk"],
  "USB-C väggladdare 65W":           [4,  0, "ok"],
  "Elektrisk nack- och axelmassage": [2, +1, "risk"],
  "Hopfällbar eldstad":              [2, -1, "ok"],
  "Uppvärmd sittdyna":               [2, +1, "ok"],
  "Elektrisk fotvärmare":            [2, +1, "ok"],
  "Magnetisk rengöringsborste":      [3,  0, "ok"],
  "USB-C hubb 6-i-1":                [3,  0, "ok"],
  "Trådlös vägglampa":               [3, +1, "ok"],
  "Nackkudde i memory foam":         [3,  0, "ok"],
  "Nackkudde med minnesskum":        [2,  0, "ok"],
  "Värmeisolerande underlakan":      [3, +1, "ok"],
  "Automatisk laserleksak":          [2,  0, "ok"],
  "Bärbar vitbrusmaskin":            [2,  0, "ok"],
  "Pneumatisk sits- och matt":       [2,  0, "ok"],
  "Utdragbar balkongavskärmning":    [2, -1, "ok"],
  "Justerbart laptopstativ":         [3,  0, "ok"],
  "Under-sink förvaringshylla":      [4,  0, "ok"],
  "Packkuber 6-pack":                [3,  0, "ok"],
  "Silikonmatta för barns matstol":  [2,  0, "ok"],
  "Magnetisk mobilhållare för inst": [3,  0, "ok"],
  "Självvattnande odlingslåda":      [2, -1, "ok"],
  "Elektrisk vinöppnare":            [3, +1, "ok"],
  "Portabel träningsmatta":          [2, +1, "ok"],
  "Solcellsdriven utomhusvägglampa": [2, -1, "ok"],
  "Nattlampa med rörelsesensor":     [4, +1, "ok"],
  "3-i-1 magnetisk laddningskabel":  [4,  0, "ok"],
  "Ljusstark uppladdningsbar pannl": [2, +1, "ok"],
  "Sängfäste för telefon":           [3,  0, "ok"],
  "Mikrofiberinteriörset":           [3,  0, "ok"],
  "Vintermössa med inbyggd LED":     [2, +1, "ok"],
  "Maghjul":                         [2, +1, "ok"],
  "Magnetisk kabelhållare":          [3,  0, "ok"],
  "Rörelsestyrd LED-list":           [3, +1, "ok"],
  "Vakuumpåsar för resväska":        [3,  0, "ok"],
  "Barnvagnskrok":                   [2,  0, "ok"],
  "Massagerulle för nacke":          [2,  0, "risk"],
  "Spolborste med teleskopskaft":    [3,  0, "ok"],
  "Under-desk kabelkorg":            [3,  0, "ok"],
  "Magnetisk scarf-":                [2, +1, "ok"],
  "Väggmonterad mopphållare":        [3,  0, "ok"],
  "Motståndsband-set":               [2, +1, "ok"],
  "Kabelhanteringsbox":              [3,  0, "ok"],
  "Justerbar klädvårdsborste":       [3, +1, "ok"],
  "Uppvärmd nackvärmare":            [2, +1, "risk"],
  "Solcellsdriven dekorationsbelys": [2, -1, "ok"],
  "Rotvolymklämma":                  [1,  0, "ok"],
  "Gelé för bilens":                 [3,  0, "ok"],
  "Nacksträckare":                   [2,  0, "risk"],
  "Vakuumpump för vinflaska":        [2, +1, "ok"],
  "Bärbar klädstänk":                [4, +1, "ok"],
  "Kompakt hopprep":                 [2, +1, "ok"],
  "Hopfällbar vattenflaska":         [3,  0, "ok"],
  "Kabelorganisatör för resor":      [3,  0, "ok"],
  "Ergonomiskt handledsstöd":        [3,  0, "ok"],
  "Silikonmatta för diskho":         [4,  0, "ok"],
  "Push-up bars":                    [2, +1, "ok"],
  "Trädgårdsorganisatör":            [2, -1, "ok"],
  "Mörkläggande sovmask":            [3,  0, "ok"],
  "Antislip klädskydd":              [3,  0, "ok"],
  "Anti-glid matskål":               [2,  0, "ok"],
  "Dörrdragsspärr":                  [3, +1, "ok"],
  "Under-dörr tätningslist":         [3, +1, "ok"],
  "Fönsterisolering":                [3, +1, "ok"],
  "Slick back hårborste":            [1,  0, "ok"],
  "Herrplånbok":                     [2, +1, "ok"],
  "Luddborttagare för päls":         [3,  0, "ok"],
  "Hopfällbar hundvattenskål":       [2,  0, "ok"],
  "Elektrisk mjölkskummare":         [3,  0, "ok"],
  "Elektrisk minihackare":           [3,  0, "ok"],
  "Mikrovågslock":                   [4,  0, "ok"],
  "Vikbar diskho-sil":               [4,  0, "ok"],
  "Silicone air fryer liner":        [3,  0, "ok"],
  "Tunn reseplånbok":                [2,  0, "ok"],
  "Diskret mini-vibrator":           [2,  0, "block"],
  "Parvibrator":                     [2,  0, "block"],
  "Vattentät rabbit":                [2,  0, "block"],
  "Dubbeldesignad dildo":            [1,  0, "block"],
  "Uppvärmd G-punktsstav":           [2,  0, "block"],
};
const meta = (name) => {
  for (const k of Object.keys(K)) if (name.startsWith(k)) return K[k];
  return null;
};

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const band = (v, lo, hi) => clamp(((v - lo) / (hi - lo)) * 100);

const rows = [];
const okänd = [];
for (const c of pool) {
  const m = meta(c.name);
  if (!m) { okänd.push(c.name); continue; }
  const [aud, season, policy] = m;
  const price = c.inputs.salePriceInclVat;
  const bidrag = c.calc.contributionPerOrder;
  const poas = c.calc.expectedPoas;
  const cpaKvot = c.inputs.expectedCpaInclVat / price;

  // Tilltro: ett CPA-antagande långt under marknadens normala andel av
  // priset gör BÅDE bidrag-mot-CPA och POAS optimistiska samtidigt, så det
  // sänker hela vinstkraften i stället för att bara vara en egen axel.
  const tro = 0.5 + 0.5 * (band(cpaKvot, 0.15, 0.4) / 100);
  const vinstkraft = (0.55 * band(bidrag, 100, 400) + 0.45 * band(poas, 1, 2)) * tro;

  const prisTillgång = clamp(((900 - price) / (900 - 199)) * 100);
  const räckvidd = clamp((0.45 * prisTillgång + 0.55 * ((aud / 4) * 100)) * (season > 0 ? 1.15 : season < 0 ? 0.85 : 1));

  rows.push({ n: c.name, price, bidrag, poas, cpaKvot, aud, season, policy,
    tro, vinstkraft, räckvidd, spets: Math.sqrt(vinstkraft * räckvidd) });
}
if (okänd.length) console.log("OKLASSADE (" + okänd.length + "):", okänd.join(" | "));

const körbara = rows.filter((r) => r.policy !== "block").sort((a, b) => b.spets - a.spets);
const S = (r) => String(r).padStart(4);
console.log("\n" + "=".repeat(118));
console.log("SPETSLÄGET — högt bidrag OCH hög ROI OCH bred köparkrets samtidigt");
console.log("spets = geometriskt medel av vinstkraft och räckvidd, så en produkt måste ha båda");
console.log("=".repeat(118));
console.log("  # produkt".padEnd(50) + "pris  bidr  POAS  CPA%  vinst  räckv  SPETS  målgr  säs  policy");
körbara.slice(0, 22).forEach((r, i) =>
  console.log(String(i + 1).padStart(3) + " " + r.n.slice(0, 45).padEnd(46) +
    S(r.price) + S(r.bidrag.toFixed(0)) + "  " + r.poas.toFixed(2) +
    S((r.cpaKvot * 100).toFixed(0)) + "%" + S(r.vinstkraft.toFixed(0)) + "  " +
    S(r.räckvidd.toFixed(0)) + "   " + r.spets.toFixed(1).padStart(5) + "    " +
    r.aud + "/4  " + (r.season > 0 ? " +" : r.season < 0 ? " -" : "  ") + "   " + r.policy));

fs.writeFileSync("rank.json", JSON.stringify(rows));
console.log("\nBLOCKERADE AV META-POLICY (hade annars legat i topp):");
rows.filter((r) => r.policy === "block").sort((a, b) => b.vinstkraft - a.vinstkraft).slice(0, 3)
  .forEach((r) => console.log("   vinstkraft " + r.vinstkraft.toFixed(0) + "  bidrag " + r.bidrag.toFixed(0) + " kr   " + r.n));

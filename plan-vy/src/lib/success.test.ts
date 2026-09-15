import { test } from "node:test";
import assert from "node:assert/strict";
import { poasAtBump, rankCandidates, realityCheck, successScore } from "./success.ts";
import type { Candidate } from "./types.ts";

const VAT = 1.25;

/** Bygger en kandidat med samma kalkyl som n8n-backenden gör. */
function make(over: Partial<Candidate["inputs"]> & { name?: string } = {}): Candidate {
  const inputs = {
    costPerUnitInclVat: 64, salePriceInclVat: 249, shippingCostPerOrder: 40,
    transactionFeePerOrder: 7, expectedCpaInclVat: 112, expectedUnitsPerOrder: 1,
    ...over,
  };
  const ex = (v: number) => v / VAT;
  const u = inputs.expectedUnitsPerOrder || 1;
  const contributionPerOrder =
    ex(inputs.salePriceInclVat) * u -
    (ex(inputs.costPerUnitInclVat) * u + ex(inputs.shippingCostPerOrder) + ex(inputs.transactionFeePerOrder));
  const grossMargin = contributionPerOrder / (ex(inputs.salePriceInclVat) * u);
  const expectedPoas = contributionPerOrder / ex(inputs.expectedCpaInclVat);
  return {
    id: over.name ?? "x", name: over.name ?? "Testprodukt", source: "test", supplierUrl: null,
    notes: null, status: "idea", createdAt: null, inputs,
    calc: {
      contributionPerOrder: +contributionPerOrder.toFixed(2),
      grossMargin: +grossMargin.toFixed(4),
      breakEvenRoas: grossMargin > 0 ? +(1 / grossMargin).toFixed(2) : null,
      expectedPoas: +expectedPoas.toFixed(3),
      netPerOrder: +(contributionPerOrder - ex(inputs.expectedCpaInclVat)).toFixed(2),
    },
    verdict: expectedPoas >= 1.5 && grossMargin >= 0.25 ? "SATSA" : expectedPoas < 1 ? "UNDVIK" : "TESTA",
  };
}

test("POAS når exakt 1,00 när CPA stigit med (expectedPoas − 1)", () => {
  const c = make();
  const headroom = c.calc.expectedPoas - 1;
  assert.ok(Math.abs(poasAtBump(c, headroom) - 1) < 0.001,
    "stresströskeln är en funktion av expectedPoas — därför ingen egen axel");
});

test("en lågt gissad CPA sänker betyget även när POAS ser bättre ut", () => {
  // Samma produkt, enda skillnaden är hur optimistiskt CPA gissats. Bidraget
  // måste vara stort nog att båda varianterna är lönsamma — annars mäter testet
  // bara att en olönsam produkt får underkänt, vilket är en annan sak.
  const rich = { salePriceInclVat: 449, costPerUnitInclVat: 110, shippingCostPerOrder: 49, transactionFeePerOrder: 13 };
  const optimistic = make({ ...rich, expectedCpaInclVat: 60, name: "optimistisk" });
  const conservative = make({ ...rich, expectedCpaInclVat: 150, name: "konservativ" });

  assert.ok(optimistic.calc.expectedPoas > conservative.calc.expectedPoas,
    "den optimistiska ser bättre ut på POAS");
  assert.ok(conservative.calc.expectedPoas > 1, "båda ska vara lönsamma på gissade siffror");
  assert.ok(successScore(conservative).score > successScore(optimistic).score,
    "men den konservativa ska få högre chansscore — kalkylen vilar inte på en förhoppning");
});

test("högt bidrag slår lågt bidrag vid samma kvot", () => {
  // Båda har POAS ~1,6, men den ena har fyra gånger så mycket att ta av.
  const small = make({ salePriceInclVat: 129, costPerUnitInclVat: 31, shippingCostPerOrder: 20,
                       transactionFeePerOrder: 4, expectedCpaInclVat: 44, name: "liten" });
  const large = make({ salePriceInclVat: 449, costPerUnitInclVat: 110, shippingCostPerOrder: 49,
                       transactionFeePerOrder: 13, expectedCpaInclVat: 155, name: "stor" });
  assert.ok(successScore(large).score > successScore(small).score);
});

test("stresstestet visar när ordern slutar bära sig", () => {
  const c = make({ expectedCpaInclVat: 112 });
  const s = successScore(c);
  assert.equal(s.stress.length, 3);
  assert.equal(s.stress[0].bump, 0);
  // Monotont: högre CPA ger aldrig högre POAS.
  assert.ok(s.stress[0].poas > s.stress[1].poas && s.stress[1].poas > s.stress[2].poas);
  // Nettot per order ska följa med ner.
  assert.ok(s.stress[2].netPerOrder < s.stress[0].netPerOrder);
});

test("olönsamma kandidater hamnar sist oavsett hur bra de ser ut i övrigt", () => {
  const loser = make({ salePriceInclVat: 449, costPerUnitInclVat: 110, expectedCpaInclVat: 400, name: "förlorare" });
  const winner = make({ expectedCpaInclVat: 80, name: "vinnare" });
  assert.ok(loser.calc.expectedPoas < 1, "förlorarens POAS är under break-even");
  assert.ok(winner.calc.expectedPoas > 1, "vinnaren bär sin annonskostnad");
  // Förloraren har hög marginal och högt bidrag, alltså bra delbetyg.
  assert.ok(loser.calc.grossMargin > 0.5);
  const ranked = rankCandidates([loser, winner]);
  assert.equal(ranked[0].candidate.name, "vinnare");
  assert.equal(ranked[1].candidate.name, "förlorare");
});

test("score håller sig i 0–100 även vid extremvärden", () => {
  for (const c of [
    make({ expectedCpaInclVat: 1 }),
    make({ expectedCpaInclVat: 9999 }),
    make({ salePriceInclVat: 10, costPerUnitInclVat: 900 }),
  ]) {
    const s = successScore(c);
    assert.ok(s.score >= 0 && s.score <= 100, `score utanför intervallet: ${s.score}`);
    for (const a of s.axes) assert.ok(a.value >= 0 && a.value <= 100);
  }
});

test("vikterna summerar till 1", () => {
  const sum = successScore(make()).axes.reduce((a, x) => a + x.weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `vikterna summerar till ${sum}`);
});

test("verklighetskollen räknar om moms innan den jämför", () => {
  const c = make({ expectedCpaInclVat: 125 }); // 100 kr ex moms
  const live = [{ financials: { cac: 105, adSpend: 4200, grossMargin: 0.4 } }];
  const r = realityCheck(c, live);
  assert.ok(Math.abs(r.assumedCpaEx - 100) < 0.01, `fick ${r.assumedCpaEx}, väntade 100`);
  // 100 ex moms < 105 ex moms => under allt som uppnåtts.
  assert.equal(r.cpaBelowAnythingAchieved, true);
  // Utan omräkning hade 125 jämförts mot 105 och sett dyrare ut — fel slutsats.
  assert.ok(r.assumedCpaEx < c.inputs.expectedCpaInclVat);
});

test("verklighetskollen klarar sig utan liveprodukter", () => {
  const r = realityCheck(make(), []);
  assert.equal(r.basis, 0);
  assert.equal(r.observedCacLow, null);
  assert.equal(r.cpaBelowAnythingAchieved, false);
});

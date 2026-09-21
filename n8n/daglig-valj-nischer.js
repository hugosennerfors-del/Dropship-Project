// Vilka nischer ska researchas i dag?
//
// Det finns ingen gratis daglig visningsdata for svensk e-handel. Google
// Trends dagliga flode ar ett nyhetsflode - kontrollerat: alla kategorier
// ger samma lista, och den 21 sept 2026 innehall den brigitte bardot,
// presley gerber och bet365. Noll shoppingnischer.
//
// Dessutom ar dagens trend per definition sen: toppen ar redan dar. Darfor
// valjs nischerna i stallet ur en sasongskalender, riktad FRAMAT: vi
// researchar det som toppar om LEDTID veckor, sa att annonserna hinner
// testas fardigt innan efterfragan kommer.
const LEDTID = 6;        // veckor framat vi siktar pa
const PER_DAG = 3;       // antal nischer per dag (varje kostar OpenAI-krediter)
const LAND = 'SE';

const KALENDER = [
  { fran: 1,  till: 6,  teman: ['träning och nystart hemma', 'torr inomhusluft och vinterhud', 'förvaring och ordning efter julen'] },
  { fran: 7,  till: 11, teman: ['vinterfriluftsliv och kyla utomhus', 'hemmakontor och ergonomi', 'vinterbilen och skrapa, halka, kyla'] },
  { fran: 12, till: 16, teman: ['vårstädning och fönsterputs', 'odling och plantering på balkong', 'allergi, pollen och luftrening'] },
  { fran: 17, till: 21, teman: ['uteplats, utemöbler och altan', 'grillning och utomhusmatlagning', 'cykel och utomhusträning'] },
  { fran: 22, till: 26, teman: ['resa, packning och flyg', 'sol, bad och strand', 'camping och friluftsliv'] },
  { fran: 27, till: 31, teman: ['värme inomhus och svala sovrum', 'husdjur under sommaren', 'utomhuslek och barn på semestern'] },
  { fran: 32, till: 36, teman: ['skolstart och barnfamiljens vardag', 'hemmakontor och skrivbordet', 'höststädning och förvaring'] },
  { fran: 37, till: 41, teman: ['höstmörker och belysning i hemmet', 'regn, väta och ytterkläder', 'inomhusträning när det blir kallt'] },
  { fran: 42, till: 45, teman: ['däckbyte och bilen inför vintern', 'kalla fötter, värme och filtar', 'mörkerkörning, reflexer och synlighet'] },
  { fran: 46, till: 48, teman: ['presenter och julklappar till vuxna', 'mys, levande ljus och stämning inomhus', 'köksprylar inför julmaten'] },
  { fran: 49, till: 53, teman: ['julklappar i sista minuten', 'julbord, dukning och servering', 'nyår, fest och mellandagar'] },
];

// Nischer som inte hör till någon säsong men som bär volym året om. En per
// dag, roterande, så att täckningen breddas i stället för att stå still.
const BREDD = [
  'laddning, kablar och mobiltillbehör',
  'städning och smarta förvaringslösningar i hemmet',
  'kök och matlagning',
  'husdjursprodukter för hund och katt',
  'sömn och återhämtning i sovrummet',
  'bilinredning och bilvård',
  'hårvård och styling hemma',
  'hemmakontor och ergonomi vid skrivbordet',
  'träning och rehab hemma',
  'resa, packning och pendling',
  'småbarnsföräldrar och barnfamiljens vardag',
  'avkoppling, massage och stel nacke efter jobbet',
  'verktyg och fix hemma',
  'organisering av garderob och kläder',
];

function isoVecka(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dag = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dag);
  const arsstart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - arsstart) / 86400000 + 1) / 7);
}

const nu = new Date();
const researchDate = nu.toISOString().slice(0, 10);
const mal = new Date(nu.getTime() + LEDTID * 7 * 86400000);
const malvecka = isoVecka(mal);
const dagNr = Math.floor((nu - new Date(Date.UTC(nu.getUTCFullYear(), 0, 1))) / 86400000);

const fonster = KALENDER.find((k) => malvecka >= k.fran && malvecka <= k.till) || KALENDER[KALENDER.length - 1];

const valda = [];
const antalSasong = Math.max(1, PER_DAG - 1);
for (let i = 0; i < antalSasong; i++) {
  const tema = fonster.teman[(dagNr + i) % fonster.teman.length];
  if (!valda.some((v) => v.niche === tema)) {
    valda.push({
      niche: tema,
      trendNote: 'Säsong: toppar omkring vecka ' + malvecka + '. Research körs ' + LEDTID + ' veckor före, så annonserna hinner testas klart innan efterfrågan kommer.',
      trendSource: 'kalender',
    });
  }
}
while (valda.length < PER_DAG) {
  const tema = BREDD[(dagNr + valda.length) % BREDD.length];
  if (valda.some((v) => v.niche === tema)) { valda.push({ niche: tema + ' ', trendNote: '', trendSource: 'bredd' }); break; }
  valda.push({
    niche: tema,
    trendNote: 'Bredd: roterar genom nischer som bär volym året om, så att täckningen växer i stället för att stå still.',
    trendSource: 'bredd',
  });
}

return valda.map((v, i) => ({ json: {
  niche: v.niche.trim(),
  country: LAND,
  researchDate,
  trendSource: v.trendSource,
  trendNote: v.trendNote,
  malvecka,
  ordning: i + 1,
} }));

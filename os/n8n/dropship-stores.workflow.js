// n8n workflow "Plan-vy · Dropshipping-butiker" (Workflow SDK source).
// Finds small online stores, usually Shopify dropshipping stores, that sell
// a product: three Brave searches (n8n gateway credits), marketplaces, big
// chains and the brands the research names are left out, then each store's
// public Shopify files are read (/meta.json, /search/suggest.json, the
// matched product's .json and the shipping policy) to see whether it sells
// the product and whether the listing came from AliExpress or CJ.
// The stores that look like dropshipping are saved with
// intel.api_links_found. Started from the product page through the n8n
// connector: POST { productId, market, query, exclude }.
import { workflow, node, trigger, expr } from '@n8n/workflow-sdk';

// The webhook path is private: anyone who has it can start a run (and spend
// the Brave searches), so the real one lives only in n8n. The page starts
// the workflow through the n8n connector by its id, not by this path.
const hook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.2,
  config: {
    name: 'API: dropship-butiker',
    parameters: { httpMethod: 'POST', path: 'dropship-stores-<private>', responseMode: 'lastNode', options: {} },
  },
});

const prepare = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Förbered',
    parameters: {
      jsCode: `// Indata från sidan: { productId, market: 'UK'|'SE', query, exclude: [märken] }.
// Tre sökningar som letar efter små butiker, inte stora märken.
const b = $input.first().json.body || {};
const clean = (s, n) => String(s ?? '').replace(/[\\u0000-\\u001f"]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, n);
const productId = String(b.productId || '');
if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(productId)) throw new Error('productId saknas eller är ogiltigt');
const market = b.market === 'SE' ? 'SE' : 'UK';
const q = clean(b.query, 80);
if (q.length < 3) throw new Error('Sökorden är för korta');
const exclude = (Array.isArray(b.exclude) ? b.exclude : []).map((x) => clean(x, 60)).filter(Boolean).slice(0, 20);
const country = market === 'SE' ? 'SE' : 'GB';
const lang = market === 'SE' ? 'sv' : 'en-gb';
const queries = market === 'SE'
  ? ['"' + q + '" site:myshopify.com', q + ' fri frakt butik', q + ' shop -amazon -cdon -prisjakt']
  : ['"' + q + '" site:myshopify.com', q + ' free shipping', q + ' shop -amazon -ebay -etsy -argos'];
return queries.map((query) => ({ json: { query, country, lang, productId, market, q, exclude } }));`,
    },
  },
});

const search = node({
  type: '@brave/n8n-nodes-brave-search.braveSearch',
  version: 1.1,
  config: {
    name: 'Brave-sökning',
    onError: 'continueRegularOutput',
    parameters: {
      operation: 'web',
      query: expr('{{ $json.query }}'),
      count: 20,
      additionalParameters: {
        country: expr('{{ $json.country }}'),
        search_lang: expr('{{ $json.lang }}'),
        safesearch: 'moderate',
        text_decorations: false,
        spellcheck: false,
      },
    },
  },
});

const pick = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Välj butiker',
    parameters: {
      jsCode: `// Unika webbplatser från sökningarna, utan marknadsplatser, stora kedjor,
// sociala medier, jämförelsesajter och märkena som skickades med.
const prep = $('Förbered').first().json;
const BLOCK = ['amazon.', 'ebay.', 'etsy.', 'argos.', 'johnlewis.', 'decathlon.', 'dunelm.', 'next.co.uk', 'asos.', 'tesco.', 'sainsburys.', 'boots.', 'very.co.uk',
  'wayfair.', 'ikea.', 'walmart.', 'target.com', 'aliexpress.', 'alibaba.', 'temu.', 'shein.', 'wish.com', 'facebook.', 'instagram.', 'tiktok.', 'youtube.', 'pinterest.',
  'reddit.', 'quora.', 'wikipedia.', 'trustpilot.', 'google.', 'bing.', 'which.co.uk', 'theguardian.', 'bbc.', 'dailymail.', 'telegraph.', 'independent.co.uk', 'mumsnet.',
  'pricespy.', 'pricerunner.', 'prisjakt.', 'idealo.', 'kelkoo.', 'cdon.', 'clasohlson.', 'jula.', 'biltema.', 'elgiganten.', 'netonnet.', 'ahlens.', 'ellos.', 'zalando.',
  'apotea.', 'lyko.', 'hm.com', 'primark.', 'marksandspencer.', 'matalan.', 'currys.', 'screwfix.', 'diy.com', 'homebase.', 'lakeland.', 'robertdyas.', 'wilko.',
  'notonthehighstreet.', 'onbuy.', 'fruugo.', 'cdiscount.', 'otto.de', 'bol.com', 'kaufland.', 'rakuten.', 'medium.com', 'linkedin.', 'x.com', 'twitter.', 'yahoo.',
  'msn.', 'forbes.', 'nytimes.', 'cnn.', 'shopify.com', 'shopify.dev', 'wordpress.', 'blogspot.', 'gov.uk', 'nhs.uk', 'ac.uk', 'sportsdirect.', 'harveynichols.',
  'selfridges.', 'jdsports.', 'halfords.', 'costco.', 'aldi.', 'lidl.', 'coop.', 'ica.se', 'blocket.', 'tradera.', 'vinted.', 'gumtree.', 'depop.',
  // Big chains, marketplaces and media seen in the results; several always
  // answer with a bot check, which made runs count as blocked.
  'manomano.', 'therange.', 'asda.', 'petsathome.', 'coopersofstortford.', 'habitat.', 'debenhams.', 'superdrug.', 'ryman.', 'home.bargains',
  'bmstores.', 'savers.', 'wowcher.', 'u-buy.', 'lionshome.', 'trolley.co.uk', 'jdwilliams.', 'oliverbonas.', 'zooplus.', 'bitiba.', 'chewy.',
  'homedepot.', 'dickssportinggoods.', 'accio.', 'wired.', 'standard.co.uk', 'marieclaire.', 'runnersworld.'];
// Short names (Ring, Aura) would block any address containing them.
const brands = (prep.exclude || []).map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, '')).filter((x) => x.length >= 5);
// An entry ending in a dot is a name in any domain (amazon. = amazon.co.uk,
// amazon.se); any other entry is a whole domain and its subdomains.
const hit = (host, b) => b.endsWith('.') ? (host.startsWith(b) || host.includes('.' + b)) : (host === b || host.endsWith('.' + b));
const blocked = (host) => BLOCK.some((b) => hit(host, b)) || brands.some((t) => host.replace(/[^a-z0-9]/g, '').includes(t));
const clean = (s, n = 200) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\\s+/g, ' ').trim().slice(0, n);
// The Code node has no URL class, so links are split with a pattern.
const parseUrl = (s) => {
  const m = /^(https?):\\/\\/([^\\/?#:]+)(?::\\d+)?([^?#]*)/i.exec(String(s || ''));
  if (!m) return null;
  const protocol = m[1].toLowerCase() + ':', hostname = m[2].toLowerCase();
  return { protocol, hostname, pathname: m[3] || '/', origin: protocol + '//' + hostname };
};
// A result must mention most of the product's words: "robe" alone finds
// French dresses, not changing robes.
const words = prep.q.toLowerCase().split(/[^a-z0-9åäöé]+/).filter((w) => w.length >= 3);
const need = Math.max(1, Math.ceil(words.length * 0.6));
const relevant = (r) => { const t = (String(r.title || '') + ' ' + String(r.description || '')).toLowerCase(); return words.filter((w) => t.includes(w)).length >= need; };
const hosts = new Map();
const errors = [];
const lists = [];
for (const it of $input.all()) {
  const j = it.json || {};
  if (j.error) { errors.push(clean(j.error.message || j.error, 200)); continue; }
  lists.push(Array.isArray(j.web?.results) ? j.web.results : Array.isArray(j.results) ? j.results : (j.url ? [j] : []));
}
const results = lists.reduce((n, l) => n + l.length, 0);
// Take the searches in turn, so each one contributes stores.
const order = [];
for (let i = 0; i < 20; i++) for (const l of lists) if (l[i]) order.push(l[i]);
for (const r of order) {
  const u = parseUrl(r.url);
  if (!u || u.protocol !== 'https:') continue;
  const host = u.hostname.toLowerCase().replace(/^www\\./, '');
  if (blocked(host) || !relevant(r)) continue;
  const prev = hosts.get(host);
  const isProduct = /\\/products\\//.test(u.pathname);
  if (!prev || (isProduct && !prev.isProduct)) hosts.set(host, { host, origin: u.origin, url: u.origin + u.pathname, isProduct, title: clean(r.title), description: clean(r.description, 300) });
}
const list = [...hosts.values()].slice(0, 20);
if (!list.length) return [{ json: { none: true, host: '', origin: 'https://example.invalid', errors, results } }];
return list.map((x, i) => ({ json: { ...x, errors: i === 0 ? errors : [], results } }));`,
    },
  },
});

const meta = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Butiksinfo',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: expr("{{ $('Välj butiker').item.json.origin }}/meta.json"),
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'User-Agent', value: 'Mozilla/5.0 (compatible; Plan-vy store check)' }, { name: 'Accept', value: 'application/json' }] },
      options: {
        timeout: 7000,
        batching: { batch: { batchSize: 4, batchInterval: 800 } },
        redirect: { redirect: { followRedirects: true, maxRedirects: 3 } },
        response: { response: { neverError: true, responseFormat: 'text', outputPropertyName: 'data' } },
      },
    },
  },
});

const suggest = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Produktsök',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: expr("{{ $('Välj butiker').item.json.origin }}/search/suggest.json?resources[type]=product&resources[limit]=10&q={{ encodeURIComponent($('Förbered').first().json.q) }}"),
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'User-Agent', value: 'Mozilla/5.0 (compatible; Plan-vy store check)' }, { name: 'Accept', value: 'application/json' }] },
      options: {
        timeout: 7000,
        batching: { batch: { batchSize: 4, batchInterval: 800 } },
        redirect: { redirect: { followRedirects: true, maxRedirects: 3 } },
        response: { response: { neverError: true, responseFormat: 'text', outputPropertyName: 'data' } },
      },
    },
  },
});

const matcha = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Matcha',
    parameters: {
      jsCode: `// Vilken av butikens produkter är vår produkt? Butikens egen sökning ger
// upp till tio träffar; den med flest av sökorden i titeln vinner.
const prep = $('Förbered').first().json;
const cands = $('Välj butiker').all().map((x) => x.json);
const metas = $('Butiksinfo').all().map((x) => x.json);
const parse = (s) => { if (s && typeof s === 'object') return s; try { return JSON.parse(String(s)); } catch { return null; } };
const words = prep.q.toLowerCase().split(/[^a-z0-9åäöé]+/).filter((w) => w.length >= 3);
const overlap = (t) => { const s = String(t || '').toLowerCase(); return words.filter((w) => s.includes(w)).length; };
const need = Math.max(1, Math.ceil(words.length * 0.6));
// Shopify's bot protection answers too many requests with a challenge page:
// that store is unknown, not \"not on Shopify\".
const isBlocked = (raw) => typeof raw === 'string' && /cf_chl_opt|challenge-platform|Verifying your connection|Too Many Requests|<title>Just a moment/i.test(raw);
return $input.all().map((it, i) => {
  const c = cands[i] || {};
  const m = parse(metas[i]?.data);
  const sg = parse(it.json?.data);
  const shopify = !c.none && (!!(m && (m.myshopify_domain || m.id)) || !!(sg && sg.resources));
  const blocked = !c.none && !shopify && (isBlocked(metas[i]?.data) || isBlocked(it.json?.data));
  const products = sg?.resources?.results?.products || [];
  const best = products.map((p) => ({ p, o: overlap(p.title) })).sort((a, b) => b.o - a.o)[0];
  const match = best && best.o >= need ? best.p : null;
  const pageHandle = c.isProduct && overlap(c.title) >= need ? String(c.url.split('/products/')[1] || '').split('/')[0] : '';
  const handle = String(match?.handle || pageHandle || '').replace(/[^a-z0-9%._-]/gi, '').slice(0, 120);
  return { json: { origin: c.origin || 'https://example.invalid', host: c.host || '', shopify, blocked, matched: !!handle,
    handle, title: String(match?.title || (pageHandle ? c.title : '') || '').slice(0, 160), price: match?.price ?? match?.price_min ?? null,
    productUrl: match?.url ? String(match.url).split('?')[0] : (handle ? '/products/' + handle : '') }, pairedItem: { item: i } };
});`,
    },
  },
});

const product = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Produktdata',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: expr("{{ $json.matched ? $json.origin + '/products/' + $json.handle + '.json' : 'https://example.invalid/' }}"),
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'User-Agent', value: 'Mozilla/5.0 (compatible; Plan-vy store check)' }, { name: 'Accept', value: 'application/json' }] },
      options: {
        timeout: 7000,
        batching: { batch: { batchSize: 4, batchInterval: 800 } },
        redirect: { redirect: { followRedirects: true, maxRedirects: 3 } },
        response: { response: { neverError: true, responseFormat: 'text', outputPropertyName: 'data' } },
      },
    },
  },
});

const policy = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Fraktpolicy',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: expr("{{ $('Matcha').item.json.matched ? $('Matcha').item.json.origin + '/policies/shipping-policy' : 'https://example.invalid/' }}"),
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'User-Agent', value: 'Mozilla/5.0 (compatible; Plan-vy store check)' }, { name: 'Accept', value: 'text/html' }] },
      options: {
        timeout: 7000,
        batching: { batch: { batchSize: 4, batchInterval: 800 } },
        redirect: { redirect: { followRedirects: true, maxRedirects: 3 } },
        response: { response: { neverError: true, responseFormat: 'text', outputPropertyName: 'data' } },
      },
    },
  },
});

const score = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Bedöm',
    parameters: {
      jsCode: `// Bedömer varje butik som säljer produkten. Starkast: produktbeskrivningens
// bilder ligger på AliExpress eller CJ Dropshippings servrar, eller
// varianternas artikelnummer kommer därifrån. Sedan leveranstid, varifrån
// varorna skickas, butikens land och katalogens storlek. Tecken, inte bevis.
const prep = $('Förbered').first().json;
const metas = $('Butiksinfo').all().map((x) => x.json);
const matches = $('Matcha').all().map((x) => x.json);
const prods = $('Produktdata').all().map((x) => x.json);
const pols = $('Fraktpolicy').all().map((x) => x.json);
const parse = (s) => { if (s && typeof s === 'object') return s; try { return JSON.parse(String(s)); } catch { return null; } };
const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const textOf = (html) => String(html || '').replace(/<script[\\s\\S]*?<\\/script>|<style[\\s\\S]*?<\\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\\s+/g, ' ').slice(0, 60000);
// Delivery time. Stores list zones (UK 1–3 days, rest of the world 2–7
// weeks): the market's own zone counts, and a range after refund or
// processing wording is not a delivery time. One range, never two mixed.
const HOME = prep.market === 'SE' ? /(sverige|sweden|inrikes|domestic)/i : /(\\buk\\b|united kingdom|great britain|mainland|england|scotland|wales|domestic)/i;
const AWAY = /(international|rest of (?:the )?world|europe|\\beu\\b|usa|united states|canada|australia|outside|utrikes|utanför|övriga världen)/i;
const NOT_DELIVERY = /(return|refund|exchange|cancel|processing|handling|dispatch(?:ed)? within|retur|återbetal|ånger|hantering)/i;
const days = (text) => {
  const found = [];
  const re = /(\\d{1,2})\\s*(?:-|–|—|to|till)\\s*(\\d{1,2})\\s*(?:business|working|arbets)?\\s*(days|dagar|weeks|veckor)/gi;
  let r, from = 0;
  while ((r = re.exec(text))) {
    // The words since the previous range say what this one is for.
    const ctx = text.slice(Math.max(from, r.index - 60), r.index);
    from = re.lastIndex;
    const k = /week|veck/i.test(r[3]) ? 7 : 1;
    const a = Number(r[1]) * k, b = Number(r[2]) * k;
    if (!(b > 0 && b <= 90 && a <= b) || NOT_DELIVERY.test(ctx)) continue;
    found.push({ a, b, home: HOME.test(ctx) && !AWAY.test(ctx), away: AWAY.test(ctx) });
  }
  const home = found.filter((x) => x.home), other = found.filter((x) => !x.away);
  const pick = home.length ? home : other.length ? other : found;
  if (!pick.length) return null;
  const best = pick.reduce((m, x) => (x.b > m.b ? x : m));
  return [best.a, best.b];
};
const FROM_ABROAD = /(ship(?:ped|s)? (?:directly )?from (?:china|asia|hong kong|our (?:international|overseas|global) (?:warehouse|suppliers?))|(?:international|overseas|global) (?:warehouse|fulfil?ment cent(?:er|re))|dispatched from (?:china|abroad|overseas)|from our (?:partners?|suppliers?) (?:abroad|overseas|in china)|skickas från (?:utlandet|kina|vårt internationella lager)|internationellt lager)/i;
const marketCountry = prep.market === 'SE' ? 'SE' : 'GB';
const checked = [];
const stores = [];
matches.forEach((mt, i) => {
  if (!mt.host) return;
  if (mt.blocked) { checked.push({ host: mt.host, blocked: true }); return; }
  if (!mt.shopify) { checked.push({ host: mt.host, shopify: false }); return; }
  if (!mt.matched) { checked.push({ host: mt.host, shopify: true, match: false }); return; }
  const m = parse(metas[i]?.data) || {};
  const pj = parse(prods[i]?.data)?.product || null;
  const body = String(pj?.body_html || '');
  const policyText = textOf(pols[i]?.data);
  let s = 25;
  const why = [];
  // A sign that the goods come from a supplier platform or from abroad, and
  // the weaker signs (a long delivery counts twice).
  let supplier = false, hints = 0;
  // Strongest: the listing itself came from a supplier platform.
  if (/alicdn\\.com|aliexpress-media\\.com/i.test(body)) { s += 40; supplier = true; why.push('description images hosted on AliExpress'); }
  else if (/cjdropshipping|cjdropship|cf\\.cjdropshipping/i.test(body)) { s += 40; supplier = true; why.push('description images hosted by CJ Dropshipping'); }
  else if (/\\.aliyuncs\\.com|\\.1688\\.com|cbu01\\.alicdn/i.test(body)) { s += 30; supplier = true; why.push('description images on Chinese servers'); }
  const skus = (pj?.variants || []).map((v) => String(v.sku || ''));
  if (skus.some((x) => /^CJ[A-Z0-9]{6,}/.test(x))) { s += 30; supplier = true; why.push('CJ Dropshipping product codes'); }
  else if (skus.some((x) => /\\d{1,3}:\\d{3,}(#[^;]*)?(;\\d{1,3}:\\d{3,})*/.test(x))) { s += 30; supplier = true; why.push('AliExpress-style product codes'); }
  // Delivery time: the policy page, or the product description.
  const d = days(policyText) || days(textOf(body));
  if (d) {
    if (d[1] >= 10) { s += 30; hints += 2; why.push('delivery ' + d[0] + '–' + d[1] + ' days'); }
    else if (d[1] >= 7) { s += 20; hints += 1; why.push('delivery ' + d[0] + '–' + d[1] + ' days'); }
    else if (d[1] <= 5) { s -= 20; why.push('delivery ' + d[0] + '–' + d[1] + ' days: probably own stock'); }
  }
  if (FROM_ABROAD.test(policyText) || FROM_ABROAD.test(textOf(body))) { s += 20; supplier = true; why.push('says it ships from abroad'); }
  // Where the store is registered.
  const country = String(m.country || '').toUpperCase();
  if (country === 'CN' || country === 'HK') { s += 25; supplier = true; why.push('store registered in ' + (country === 'CN' ? 'China' : 'Hong Kong')); }
  else if (country && country !== marketCountry) { s += 10; hints += 1; why.push('store registered in ' + country); }
  const count = num(m.published_products_count);
  if (count != null) {
    const n = count + (count === 1 ? ' product' : ' products');
    if (count <= 50) { s += 10; hints += 1; why.push(n); }
    else if (count <= 200) { s += 5; why.push(n); }
    else if (count > 1000) { s -= 15; why.push(n + ': a big retailer'); }
  }
  const ships = Array.isArray(m.ships_to_countries) ? m.ships_to_countries : [];
  if (ships.includes('*') || ships.length >= 100) why.push('ships worldwide');
  const added = pj?.created_at ? String(pj.created_at).slice(0, 10) : null;
  // Slow delivery and a small catalogue alone fit a brand or a maker too:
  // without a supplier sign a store is at most possible, only with two weaker
  // signs, and with a big catalogue it is a retailer.
  if (!supplier) s = Math.min(s, count != null && count > 1000 ? 35 : hints >= 2 ? 59 : 39);
  s = Math.max(0, Math.min(100, s));
  const label = s >= 60 ? 'likely' : s >= 40 ? 'possible' : 'unlikely';
  const variantPrice = num(pj?.variants?.[0]?.price);
  const price = variantPrice ?? num(mt.price);
  // Link to the store's own domain rather than its myshopify.com address.
  const domain = String(m.domain || '').toLowerCase();
  const site = /^[a-z0-9.-]+$/.test(domain) && !/myshopify\\.com$/.test(domain) ? 'https://' + domain : mt.origin;
  const entry = {
    url: site + (mt.productUrl || '/products/' + mt.handle), name: String(m.name || mt.host).slice(0, 200),
    price: price != null ? price.toFixed(2) : null, currency: m.currency || null,
    note: 'Found by search: ' + (why.length ? why.join(', ') : 'Shopify store selling it, no other signals') + '.',
    signals: { score: s, label, why, shopify: true, products: count, deliveryDays: d, country: country || null, added,
      productTitle: String(pj?.title || mt.title || '').slice(0, 160), handle: mt.handle, host: site.replace('https://', ''), query: prep.q, checkedAt: new Date().toISOString() },
  };
  checked.push({ host: mt.host, shopify: true, match: true, score: s, label, why });
  if (label !== 'unlikely') stores.push(entry);
});
const keep = stores.sort((a, b) => b.signals.score - a.signals.score).slice(0, 12);
// Many blocked checks: the run saw too little to retire earlier finds.
const blocked = checked.filter((c) => c.blocked).length;
const degraded = blocked >= Math.max(2, Math.ceil(checked.length * 0.3));
const payload = { productId: prep.productId, market: prep.market, query: prep.q, stores: keep, retire: !degraded };
const sql = "select intel.api_links_found(convert_from(decode('" + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64') + "', 'base64'), 'UTF8')::jsonb) as result";
const first = $('Välj butiker').first().json;
return [{ json: { ok: true, productId: prep.productId, market: prep.market, query: prep.q, searched: first.results || 0, checked, stores: keep, blocked, degraded, errors: first.errors || [], sql } }];`,
    },
  },
});

const save = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Spara',
    parameters: {
      operation: 'executeQuery',
      query: '{{ $json.sql }}',
      options: {},
    },
    credentials: { postgres: { id: 'JsGo1mWcGCqPQu8K', name: 'Postgres account 5' } },
  },
});

const answer = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Svar',
    parameters: {
      jsCode: `const r = $input.first().json.result;
const saved = typeof r === 'string' ? JSON.parse(r) : r;
const b = $('Bedöm').first().json;
return [{ json: { ok: true, productId: b.productId, market: b.market, query: b.query, searched: b.searched, checked: b.checked, found: b.stores.length, blocked: b.blocked || 0, degraded: !!b.degraded, saved, errors: b.errors } }];`,
    },
  },
});

export default workflow('plan-vy-dropship-stores', 'Plan-vy · Dropshipping-butiker')
  .add(hook)
  .to(prepare)
  .to(search)
  .to(pick)
  .to(meta)
  .to(suggest)
  .to(matcha)
  .to(product)
  .to(policy)
  .to(score)
  .to(save)
  .to(answer);

// api/_lib/crawl.js — fetches a business website (or an App Store listing) and
// turns it into plain-text source documents. Nothing here interprets the
// content; it only records what the business itself publishes.

const UA = 'Mozilla/5.0 (compatible; SquadronBot/1.0; +https://squadron.tel)';
const MAX_BYTES = 600_000;
const MAX_PAGES = 10;
const MAX_TEXT_PER_PAGE = 24_000;

const PRIORITY = [
  'pricing', 'price', 'plans', 'faq', 'help', 'support', 'contact', 'hours', 'location',
  'about', 'services', 'products', 'shop', 'menu', 'policy', 'policies', 'returns', 'refund',
  'shipping', 'terms', 'booking', 'appointments', 'schedule', 'reservations',
];

export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (!u.hostname.includes('.')) return null;
    u.hash = '';
    return u.toString();
  } catch { return null; }
}

export function isAppStoreUrl(url) {
  try { return /(^|\.)apps\.apple\.com$/i.test(new URL(url).hostname); } catch { return false; }
}

async function fetchWithTimeout(url, ms = 12_000, accept = 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5') {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.8' }, redirect: 'follow', signal: ctrl.signal });
    const buf = await r.arrayBuffer();
    const bytes = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
    return { ok: r.ok, status: r.status, url: r.url || url, type: r.headers.get('content-type') || '', text: new TextDecoder('utf-8', { fatal: false }).decode(bytes) };
  } finally { clearTimeout(t); }
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

export function htmlToText(html) {
  let s = html.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|noscript|svg|canvas|iframe|template)[\s\S]*?<\/\1>/gi, ' ');
  const titleM = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? decodeEntities(titleM[1]).replace(/\s+/g, ' ').trim() : '';
  const metaDesc = (s.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1] || '';
  // Keep JSON-LD blocks: they often carry hours, address and phone in a clean form.
  const ld = [];
  s.replace(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi, (_, j) => { ld.push(j.trim().slice(0, 4000)); return ''; });
  s = s.replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/header|\/footer|\/td|\/th|\/dt|\/dd|\/blockquote)[^>]*>/gi, '\n');
  s = s.replace(/<(h[1-6])[^>]*>/gi, '\n## ');
  s = s.replace(/<li[^>]*>/gi, '\n- ');
  s = s.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  let text = '';
  if (title) text += `# ${title}\n`;
  if (metaDesc) text += `${decodeEntities(metaDesc)}\n\n`;
  text += s;
  if (ld.length) text += '\n\nSTRUCTURED DATA (JSON-LD):\n' + ld.join('\n');
  return { title, text: text.slice(0, MAX_TEXT_PER_PAGE) };
}

function extractLinks(html, baseUrl) {
  const out = new Set();
  const base = new URL(baseUrl);
  const re = /<a[^>]+href=["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], base);
      if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
      if (!/^https?:$/.test(u.protocol)) continue;
      if (/\.(pdf|jpg|jpeg|png|gif|svg|webp|mp4|mp3|zip|css|js|xml|ico|woff2?)$/i.test(u.pathname)) continue;
      u.hash = ''; u.search = '';
      out.add(u.toString());
    } catch { /* ignore malformed links */ }
  }
  return [...out];
}

function scoreLink(url) {
  const p = url.toLowerCase();
  let score = 0;
  PRIORITY.forEach((k, i) => { if (p.includes(k)) score += PRIORITY.length - i; });
  score -= Math.min(10, (p.match(/\//g) || []).length - 3);
  if (/blog|news|press|careers|jobs|login|signin|signup|cart|account|privacy|cookie|sitemap|wp-|tag\/|category\//.test(p)) score -= 30;
  return score;
}

export async function crawlSite(startUrl, log = () => {}) {
  const pages = [];
  const seen = new Set();
  let first = await fetchWithTimeout(startUrl).catch((e) => ({ ok: false, status: 0, type: '', error: e }));
  if (!first.ok) {
    // Many sites answer only on www (or only without it). Try the other one
    // before giving up. Squadron identifies itself honestly and does not try
    // to get around a site that blocks automated readers.
    try {
      const u = new URL(startUrl);
      u.hostname = u.hostname.startsWith('www.') ? u.hostname.slice(4) : 'www.' + u.hostname;
      const alt = await fetchWithTimeout(u.toString()).catch(() => null);
      if (alt && alt.ok) first = alt;
    } catch {}
  }
  if (!first.ok || !/html|xml|text/i.test(first.type)) {
    const blocked = [401, 403, 406, 429, 503].includes(first.status);
    const e = new Error(blocked
      ? 'This website blocks automated readers, so Squadron could not read it.'
      : first.status ? `Could not read ${startUrl} (HTTP ${first.status}).` : `Could not reach ${startUrl}. Check the address and try again.`);
    e.code = blocked ? 'site_blocked' : 'site_unreachable';
    throw e;
  }
  seen.add(first.url);
  const home = htmlToText(first.text);
  pages.push({ kind: 'web', url: first.url, title: home.title, content: home.text });
  log(`Read ${first.url}`);
  const links = extractLinks(first.text, first.url)
    .filter((u) => !seen.has(u))
    .map((u) => ({ u, s: scoreLink(u) }))
    .filter((x) => x.s > -20)
    .sort((a, b) => b.s - a.s)
    .slice(0, 24);
  const queue = links.map((x) => x.u);
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length && pages.length < MAX_PAGES) {
      const u = queue.shift();
      if (!u || seen.has(u)) continue;
      seen.add(u);
      try {
        const r = await fetchWithTimeout(u, 9_000);
        if (!r.ok || !/html|xml|text/i.test(r.type)) continue;
        const t = htmlToText(r.text);
        if (t.text.length < 200) continue;
        if (pages.length < MAX_PAGES) { pages.push({ kind: 'web', url: r.url, title: t.title, content: t.text }); log(`Read ${r.url}`); }
      } catch (e) { log(`Skipped ${u}: ${e.message}`); }
    }
  });
  await Promise.all(workers);
  return pages;
}

export function appStoreId(url) {
  const m = String(url).match(/id(\d{6,})/);
  return m ? m[1] : null;
}

export async function fetchAppStore(url, log = () => {}) {
  const id = appStoreId(url);
  if (!id) throw new Error('That does not look like an App Store link (it needs an id, like apps.apple.com/us/app/name/id123456789).');
  const r = await fetchWithTimeout(`https://itunes.apple.com/lookup?id=${id}&entity=software`, 12_000, 'application/json');
  if (!r.ok) throw new Error(`App Store lookup failed (HTTP ${r.status}).`);
  const data = JSON.parse(r.text);
  const app = data.results && data.results[0];
  if (!app) throw new Error('The App Store returned no app for that id.');
  log(`Read App Store listing for ${app.trackName}`);
  const lines = [
    `# ${app.trackName}`,
    `Seller: ${app.sellerName || app.artistName || ''}`,
    `Bundle: ${app.bundleId || ''}`,
    `Price: ${app.formattedPrice || (app.price === 0 ? 'Free' : app.price)}`,
    `Category: ${(app.genres || []).join(', ')}`,
    `Version: ${app.version || ''} (${app.currentVersionReleaseDate || ''})`,
    `Rating: ${app.averageUserRating ? app.averageUserRating.toFixed(2) : 'n/a'} from ${app.userRatingCount || 0} ratings`,
    `Minimum OS: ${app.minimumOsVersion || ''}`,
    `Age rating: ${app.contentAdvisoryRating || ''}`,
    `Seller URL: ${app.sellerUrl || ''}`,
    `Support URL: ${app.supportUrl || ''}`,
    `App Store URL: ${app.trackViewUrl || url}`,
    '',
    '## Description',
    app.description || '',
    '',
    '## Release notes',
    app.releaseNotes || '',
  ];
  const listing = { kind: 'appstore', url: app.trackViewUrl || url, title: app.trackName, content: lines.join('\n').slice(0, MAX_TEXT_PER_PAGE), meta: app };
  return listing;
}

export function documentToText(name, text) {
  const lower = name.toLowerCase();
  if (/\.(html?|xml)$/.test(lower)) return htmlToText(text).text;
  return String(text).replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 60_000);
}

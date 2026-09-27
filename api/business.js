// /api/business — creates a business from a website URL, an App Store URL, or
// uploaded documents, and returns the token that identifies it from then on.
import { ensureSchema, sql, newId, newToken, readJson, bad } from './_lib/db.js';
import { normalizeUrl, isAppStoreUrl, documentToText } from './_lib/crawl.js';
import { track } from './_lib/events.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return bad(res, 405, 'POST only');
  const body = readJson(req);
  let kind = body.kind;
  let value = null;
  const docs = [];
  try {
    if (kind === 'docs') {
      const list = Array.isArray(body.documents) ? body.documents : [];
      for (const d of list.slice(0, 12)) {
        if (!d || typeof d.text !== 'string' || !d.text.trim()) continue;
        const name = String(d.name || 'document.txt').slice(0, 200);
        docs.push({ kind: 'document', url: null, title: name, content: documentToText(name, d.text) });
      }
      if (!docs.length) return bad(res, 400, 'Add at least one document with text in it.');
      value = docs.map((d) => d.title).join(', ');
    } else {
      const url = normalizeUrl(body.url);
      if (!url) return bad(res, 400, 'Enter a full website address, like https://example.com.');
      kind = isAppStoreUrl(url) ? 'appstore' : 'url';
      value = url;
    }
    await ensureSchema();
    const id = newId('biz');
    const token = newToken();
    await sql().query('INSERT INTO businesses (id, token, input_kind, input_value, status) VALUES ($1,$2,$3,$4,$5)', [id, token, kind, value, docs.length ? 'crawled' : 'new']);
    for (const d of docs) {
      await sql().query('INSERT INTO sources (business_id, kind, url, title, content) VALUES ($1,$2,$3,$4,$5)', [id, d.kind, d.url, d.title, d.content]);
    }
    await track('business_created', { businessId: id, meta: { kind } });
    return res.status(200).json({ token, kind, value, sources: docs.map((d) => ({ kind: d.kind, title: d.title, chars: d.content.length })) });
  } catch (e) {
    console.error('[business]', e);
    return bad(res, 500, e.message);
  }
}

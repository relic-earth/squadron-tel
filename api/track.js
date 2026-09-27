// /api/track — two small public writes that call no AI model.
// POST { name, visit } records a funnel event from the browser (see
//   _lib/events.js: no cookies, no IP, no user agent is stored).
// POST { action: 'rate', token, stage, score, comment } stores a customer's
//   one-question satisfaction answer. It is authorized by the business token
//   (the same secret that opens Squadron HQ) or by the signed-in session.
import { sql, loadBusiness, readJson, bad } from './_lib/db.js';
import { currentAccount } from './_lib/auth.js';
import { track, CLIENT_EVENTS } from './_lib/events.js';
import { saveRating, ensureCareSchema } from './_lib/care.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return bad(res, 405, 'POST only');
  const body = readJson(req);
  try {
    if (body.action === 'rate') {
      let accountId = null, email = null, businessId = null;
      if (body.token) {
        const biz = await loadBusiness(String(body.token));
        if (biz && biz.account_id) { accountId = biz.account_id; businessId = biz.id; }
      }
      if (!accountId) { const acc = await currentAccount(req); if (acc) accountId = acc.id; }
      if (!accountId) return bad(res, 401, 'Open this from your Squadron HQ link, or log in first.');
      const r = await sql().query('SELECT email FROM accounts WHERE id = $1', [accountId]);
      email = r[0] && r[0].email;
      if (!body.score) {
        await ensureCareSchema();
        const have = await sql().query('SELECT stage, score, comment FROM satisfaction WHERE account_id = $1', [accountId]);
        return res.status(200).json({ ratings: have });
      }
      return res.status(200).json(await saveRating({ accountId, email, businessId, stage: body.stage, score: body.score, comment: body.comment }));
    }
    const name = String(body.name || '');
    if (!CLIENT_EVENTS.has(name)) return bad(res, 400, 'Unknown event');
    const visit = /^[a-z0-9]{8,32}$/i.test(String(body.visit || '')) ? body.visit : null;
    await track(name, { visit, meta: body.meta && typeof body.meta === 'object' ? { k: String(body.meta.k || '').slice(0, 40) } : null });
    return res.status(204).end();
  } catch (e) {
    console.error('[track]', e);
    return bad(res, 500, 'Could not save that.');
  }
}

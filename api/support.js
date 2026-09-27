// /api/support — Squadron's own support desk.
// POST { action: 'ticket', name, email, topic, message, page, transcript } opens
// a ticket: it is stored, the team is emailed, and the customer gets an email
// with the reference number. POST { action: 'helpful', id, yes } records a
// Help Center vote. Nothing here calls an AI model, so nothing costs credit.
import { sql, readJson, bad } from './_lib/db.js';
import { currentAccount } from './_lib/auth.js';
import { ensureSupportSchema, createTicket, ipHash, ticketRef } from './_lib/tickets.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return bad(res, 405, 'POST only');
  const body = readJson(req);
  try {
    await ensureSupportSchema();
    if (body.action === 'helpful') {
      const id = String(body.id || '').replace(/[^a-z0-9-]/g, '').slice(0, 60);
      if (!id) return bad(res, 400, 'id required');
      const col = body.yes ? 'yes' : 'no';
      await sql().query(`INSERT INTO help_votes (article, ${col}) VALUES ($1, 1) ON CONFLICT (article) DO UPDATE SET ${col} = help_votes.${col} + 1`, [id]);
      return res.status(200).json({ ok: true });
    }
    if (body.website) return res.status(200).json({ ok: true, reference: ticketRef() }); // honeypot
    const acc = await currentAccount(req).catch(() => null);
    const out = await createTicket({ email: body.email, name: body.name, topic: body.topic, message: body.message, page: body.page, transcript: body.transcript, ip: ipHash(req), accountId: acc && acc.id, accountLine: acc ? `${acc.email} (${acc.id})` : null });
    return res.status(200).json({ ok: true, ...out });
  } catch (e) {
    if (e.status) return bad(res, e.status, e.message);
    console.error('[support]', e);
    return bad(res, 500, 'Your request could not be saved. Please email info@squadron.tel.');
  }
}

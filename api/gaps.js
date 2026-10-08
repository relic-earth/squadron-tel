// /api/gaps — the knowledge approval queue. Approving a gap writes the answer
// into the Business Profile as an owner-corrected FAQ, so the team can answer
// it from then on.
import { sql, loadBusiness, loadProfile, readJson, bad, ensureSchema } from './_lib/db.js';
import { applyCorrections } from './_lib/profile.js';
import { ownerGate } from './_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return bad(res, 405, 'POST only');
  const body = readJson(req);
  const { token, id, action } = body;
  if (!token || !id) return bad(res, 400, 'token and id required');
  try {
    await ensureSchema();
    const biz = await loadBusiness(token);
    if (!biz) return bad(res, 404, 'Unknown business');
    const gate = await ownerGate(req, biz); if (gate) return res.status(gate.status).json(gate);
    const rows = await sql().query('SELECT * FROM knowledge_gaps WHERE id = $1 AND business_id = $2', [id, biz.id]);
    const gap = rows[0];
    if (!gap) return bad(res, 404, 'Unknown item');
    if (action === 'dismiss') {
      await sql().query("UPDATE knowledge_gaps SET status = 'dismissed', resolved_at = now() WHERE id = $1", [id]);
    } else if (action === 'approve') {
      const answer = String(body.answer || '').trim();
      if (!answer) return bad(res, 400, 'Write the answer first.');
      const question = String(body.question || gap.question).trim().slice(0, 500);
      const prow = await loadProfile(biz.id);
      if (!prow) return bad(res, 400, 'No profile');
      const current = applyCorrections(prow.profile, prow.corrections);
      const n = (current.faqs || []).length;
      const corrections = { [`faqs.${n}.question`]: question, [`faqs.${n}.answer`]: answer.slice(0, 4000) };
      await sql().query('UPDATE profiles SET corrections = corrections || $2::jsonb, updated_at = now() WHERE business_id = $1', [biz.id, JSON.stringify(corrections)]);
      await sql().query("UPDATE knowledge_gaps SET status = 'approved', proposed_answer = $2, resolved_at = now() WHERE id = $1", [id, answer.slice(0, 4000)]);
    } else if (action === 'done') {
      await sql().query("UPDATE knowledge_gaps SET status = 'done', resolved_at = now() WHERE id = $1", [id]);
    } else return bad(res, 400, 'Unknown action');
    const gaps = await sql().query('SELECT id, conversation_id, question, proposed_answer, status, created_at FROM knowledge_gaps WHERE business_id = $1 ORDER BY created_at DESC LIMIT 200', [biz.id]);
    return res.status(200).json({ ok: true, gaps });
  } catch (e) {
    console.error('[gaps]', e);
    return bad(res, 500, e.message);
  }
}

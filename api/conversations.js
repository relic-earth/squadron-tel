// /api/conversations — GET lists a business's conversations (for HQ);
// POST stores or updates a voice conversation's transcript and outcome.
import { ensureSchema, sql, loadBusiness, newId, readJson, bad } from './_lib/db.js';
import { ownerGate } from './_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const body = req.method === 'GET' ? {} : readJson(req);
  const token = req.method === 'GET' ? req.query?.token : body.token;
  if (!token) return bad(res, 400, 'token required');
  try {
    await ensureSchema();
    const biz = await loadBusiness(token);
    if (!biz) return bad(res, 404, 'Unknown business');
    const gate = await ownerGate(req, biz); if (gate) return res.status(gate.status).json(gate);
    if (req.method === 'GET') {
      if (req.query?.id) {
        const rows = await sql().query('SELECT * FROM conversations WHERE id = $1 AND business_id = $2', [req.query.id, biz.id]);
        return res.status(200).json({ conversation: rows[0] || null });
      }
      const rows = await sql().query(
        'SELECT id, channel, agent_name, outcome, summary, escalated, test, duration_s, recording_url, started_at, ended_at, jsonb_array_length(transcript) AS turns FROM conversations WHERE business_id = $1 ORDER BY started_at DESC LIMIT 200', [biz.id]);
      const gaps = await sql().query('SELECT id, conversation_id, question, proposed_answer, status, created_at FROM knowledge_gaps WHERE business_id = $1 ORDER BY created_at DESC LIMIT 200', [biz.id]);
      return res.status(200).json({ conversations: rows, gaps });
    }
    if (req.method === 'POST') {
      const channel = ['voice-web', 'phone', 'chat', 'sms', 'email'].includes(body.channel) ? body.channel : 'voice-web';
      const id = body.conversationId && /^cnv_[a-z0-9]+$/.test(body.conversationId) ? body.conversationId : newId('cnv');
      const transcript = Array.isArray(body.transcript) ? body.transcript.slice(0, 400).map((t) => ({ role: t.role === 'customer' ? 'customer' : 'agent', text: String(t.text || '').slice(0, 2000), agent_id: t.agent_id || null, agent_name: t.agent_name || null, type: t.type || null, at: t.at || null })) : [];
      const outcome = String(body.outcome || (transcript.length ? 'answered' : 'no conversation')).slice(0, 60);
      const summary = transcript.find((t) => t.role === 'customer')?.text.slice(0, 140) || null;
      await sql().query(
        `INSERT INTO conversations (id, business_id, channel, agent_id, agent_name, outcome, summary, transcript, duration_s, escalated, test, ended_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
         ON CONFLICT (id) DO UPDATE SET transcript = EXCLUDED.transcript, outcome = EXCLUDED.outcome, summary = EXCLUDED.summary, duration_s = EXCLUDED.duration_s, escalated = EXCLUDED.escalated, ended_at = now()`,
        [id, biz.id, channel, body.agentId || null, body.agentName || null, outcome, summary, JSON.stringify(transcript), Number.isFinite(+body.durationS) ? Math.round(+body.durationS) : null, !!body.escalated, body.test !== false]);
      for (const g of (Array.isArray(body.gaps) ? body.gaps : []).slice(0, 20)) {
        if (typeof g === 'string' && g.trim()) await sql().query('INSERT INTO knowledge_gaps (business_id, conversation_id, question) VALUES ($1,$2,$3)', [biz.id, id, g.trim().slice(0, 500)]);
      }
      for (const m of (Array.isArray(body.messages) ? body.messages : []).slice(0, 10)) {
        if (m && m.message) await sql().query('INSERT INTO knowledge_gaps (business_id, conversation_id, question, proposed_answer, status) VALUES ($1,$2,$3,$4,$5)', [biz.id, id, `Message taken: ${String(m.message).slice(0, 400)}`, `Contact: ${String(m.contact || 'not given').slice(0, 200)}`, 'message']);
      }
      return res.status(200).json({ ok: true, conversationId: id });
    }
    return bad(res, 405, 'GET or POST');
  } catch (e) {
    console.error('[conversations]', e);
    return bad(res, 500, e.message);
  }
}

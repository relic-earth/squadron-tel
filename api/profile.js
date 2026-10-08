// /api/profile — reads the Business Profile (GET) or records the owner's
// corrections to it (POST). Corrections are kept separately so the original
// extraction and its sources are never lost.
import { ensureSchema, sql, loadBusiness, loadProfile, readJson, bad } from './_lib/db.js';
import { applyCorrections } from './_lib/profile.js';
import { ownerGate } from './_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const token = req.method === 'GET' ? req.query?.token : readJson(req).token;
  if (!token) return bad(res, 400, 'token required');
  try {
    await ensureSchema();
    const biz = await loadBusiness(token);
    if (!biz) return bad(res, 404, 'Unknown business');
    if (req.method === 'POST') {
      const gate = await ownerGate(req, biz); if (gate) return res.status(gate.status).json(gate);
      const { corrections } = readJson(req);
      if (!corrections || typeof corrections !== 'object') return bad(res, 400, 'corrections object required');
      const clean = {};
      for (const [k, v] of Object.entries(corrections)) {
        if (!/^[a-z_]+(\.[a-z_0-9]+)*$/.test(k)) continue;
        clean[k] = typeof v === 'string' ? v.slice(0, 4000) : v;
      }
      await sql().query(
        `UPDATE profiles SET corrections = corrections || $2::jsonb, updated_at = now() WHERE business_id = $1`,
        [biz.id, JSON.stringify(clean)]);
    }
    const row = await loadProfile(biz.id);
    const sources = await sql().query('SELECT kind, url, title, length(content) AS chars FROM sources WHERE business_id = $1 ORDER BY id', [biz.id]);
    return res.status(200).json({
      business: { id: biz.id, kind: biz.input_kind, value: biz.input_value, status: biz.status },
      profile: row ? applyCorrections(row.profile, row.corrections) : null,
      corrections: row ? row.corrections : {},
      model: row ? row.model : null,
      sources,
    });
  } catch (e) {
    console.error('[profile]', e);
    return bad(res, 500, e.message);
  }
}

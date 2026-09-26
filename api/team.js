// /api/team — GET returns the team; POST generates (or regenerates) it from
// the Business Profile; PATCH edits one agent's fields or toggles it.
import { ensureSchema, sql, loadBusiness, loadProfile, loadTeam, readJson, bad } from './_lib/db.js';
import { applyCorrections } from './_lib/profile.js';
import { generateTeam } from './_lib/team.js';
import { requireFunds, recordSpend, textCostCents, HOLD, PaymentRequired } from './_lib/ledger.js';

const EDITABLE = ['title', 'job_description', 'scope', 'out_of_scope', 'escalation_rule', 'greeting', 'enabled'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const body = req.method === 'GET' ? {} : readJson(req);
  const token = req.method === 'GET' ? req.query?.token : body.token;
  if (!token) return bad(res, 400, 'token required');
  try {
    await ensureSchema();
    const biz = await loadBusiness(token);
    if (!biz) return bad(res, 404, 'Unknown business');
    if (req.method === 'POST') {
      const row = await loadProfile(biz.id);
      if (!row) return bad(res, 400, 'Your Business Profile is built as soon as your first 30 days are paid. Create your account and choose a plan in Billing, then come back here.');
      const profile = applyCorrections(row.profile, row.corrections);
      await requireFunds(biz.account_id, HOLD.team, 'This account');
      const { agents, routing_notes, model, usage } = await generateTeam(profile);
      await recordSpend({ accountId: biz.account_id, businessId: biz.id, kind: 'team', cents: textCostCents(model, usage) });
      await sql().query(
        `INSERT INTO teams (business_id, agents, model) VALUES ($1, $2, $3)
         ON CONFLICT (business_id) DO UPDATE SET agents = EXCLUDED.agents, model = EXCLUDED.model, updated_at = now()`,
        [biz.id, JSON.stringify({ agents, routing_notes }), model]);
      await sql().query("UPDATE businesses SET status = 'team', updated_at = now() WHERE id = $1", [biz.id]);
      return res.status(200).json({ agents, routing_notes, model });
    }
    if (req.method === 'PATCH') {
      const team = await loadTeam(biz.id);
      if (!team) return bad(res, 404, 'No team yet');
      const agents = team.agents.agents;
      const a = agents.find((x) => x.id === body.agentId);
      if (!a) return bad(res, 404, 'Unknown agent');
      for (const k of EDITABLE) if (k in body) a[k] = body[k];
      await sql().query('UPDATE teams SET agents = $2, updated_at = now() WHERE business_id = $1', [biz.id, JSON.stringify(team.agents)]);
      return res.status(200).json({ agents, routing_notes: team.agents.routing_notes });
    }
    const team = await loadTeam(biz.id);
    if (!team) return res.status(200).json({ agents: null });
    return res.status(200).json({ agents: team.agents.agents, routing_notes: team.agents.routing_notes, model: team.model });
  } catch (e) {
    if (e instanceof PaymentRequired) return res.status(402).json({ error: e.message, code: e.code });
    console.error('[team]', e);
    return bad(res, 500, e.message);
  }
}

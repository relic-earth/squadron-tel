// /api/hq — everything Squadron HQ shows: conversations, escalations, usage
// against the plan allowance, the knowledge queue, settings and channel
// status. ?export=csv returns the conversation log as a file.
import { sql, loadBusiness, loadProfile, readJson, bad } from './_lib/db.js';
import { ensureAuthSchema, currentAccount } from './_lib/auth.js';
import { ledgerStatus } from './_lib/ledger.js';
import { channelStatus } from './_lib/channels.js';

let _handled = null;
function ensureHandled() {
  if (!_handled) _handled = sql().query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ').catch((e) => { _handled = null; throw e; });
  return _handled;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // POST { token, action: 'handled', id, handled } marks an escalation as
  // dealt with (or reopens it), so Today only shows what still needs the owner.
  if (req.method === 'POST') {
    const body = readJson(req);
    if (!body.token || !body.id || body.action !== 'handled') return bad(res, 400, 'token, id and action required');
    try {
      await ensureHandled();
      const biz = await loadBusiness(body.token);
      if (!biz) return bad(res, 404, 'Unknown business');
      const r = await sql().query(`UPDATE conversations SET handled_at = ${body.handled === false ? 'NULL' : 'now()'} WHERE id = $1 AND business_id = $2 RETURNING id, handled_at`, [String(body.id), biz.id]);
      if (!r[0]) return bad(res, 404, 'Unknown conversation');
      return res.status(200).json({ ok: true, id: r[0].id, handled_at: r[0].handled_at });
    } catch (e) { console.error('[hq handled]', e); return bad(res, 500, e.message); }
  }
  const token = req.query?.token;
  if (!token) return bad(res, 400, 'token required');
  try {
    await ensureAuthSchema();
    const biz = await loadBusiness(token);
    if (!biz) return bad(res, 404, 'Unknown business');
    const acc = await currentAccount(req);
    await ensureHandled();
    const conversations = await sql().query(
      `SELECT id, channel, agent_name, outcome, summary, escalated, test, duration_s, recording_url, started_at, ended_at, handled_at, jsonb_array_length(transcript) AS turns,
         CASE WHEN escalated AND NOT test THEN LEFT((SELECT string_agg(t->>'text', E'\n') FROM jsonb_array_elements(transcript) t WHERE t->>'role' = 'customer'), 1200) END AS customer_text
       FROM conversations WHERE business_id = $1 ORDER BY started_at DESC LIMIT 500`, [biz.id]);
    if (req.query.export === 'csv') {
      const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const lines = ['id,started_at,channel,agent,outcome,escalated,test,duration_s,turns,summary'];
      for (const c of conversations) lines.push([c.id, c.started_at, c.channel, c.agent_name, c.outcome, c.escalated, c.test, c.duration_s, c.turns, c.summary].map(esc).join(','));
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="squadron-conversations-${biz.id}.csv"`);
      return res.status(200).send(lines.join('\n'));
    }
    const escIds = conversations.filter((c) => c.escalated && !c.test && c.channel === 'phone').map((c) => c.id);
    if (escIds.length) {
      try {
        const calls = await sql().query('SELECT conversation_id, from_number FROM calls WHERE conversation_id = ANY($1)', [escIds]);
        const by = Object.fromEntries(calls.map((x) => [x.conversation_id, x.from_number]));
        for (const c of conversations) if (by[c.id]) c.caller = by[c.id];
      } catch (e) { /* no calls table yet */ }
    }
    const st = await ledgerStatus(biz.account_id);
    const since = st.periodStart ? new Date(st.periodStart) : (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; })();
    const usage = await sql().query(
      `SELECT COUNT(*)::int AS conversations, COUNT(*) FILTER (WHERE escalated)::int AS escalations
         FROM conversations WHERE business_id = $1 AND test = false AND started_at >= $2`, [biz.id, since.toISOString()]);
    const tests = await sql().query('SELECT COUNT(*)::int AS n FROM conversations WHERE business_id = $1 AND test = true', [biz.id]);
    const gaps = await sql().query('SELECT id, conversation_id, question, proposed_answer, status, created_at FROM knowledge_gaps WHERE business_id = $1 ORDER BY created_at DESC LIMIT 200', [biz.id]);
    const fp = biz.account_id ? await sql().query("SELECT MIN(paid_at) AS t FROM invoices WHERE account_id = $1 AND kind = 'plan' AND status = 'paid'", [biz.account_id]) : [{}];
    const paused = !st.active || st.remainingCents < 3;
    const balancePercent = st.budgetCents ? Math.max(0, Math.round((st.remainingCents / st.budgetCents) * 100)) : 0;
    const prow = await loadProfile(biz.id);
    const bizName = (prow && prow.profile && prow.profile.company && prow.profile.company.name && prow.profile.company.name.value) || biz.input_value;
    return res.status(200).json({
      business: { id: biz.id, name: bizName, status: biz.status, phone_number: biz.phone_number },
      account: acc ? { email: acc.email } : null,
      firstPaidAt: fp[0] ? fp[0].t : null,
      plan: { key: st.planKey, name: st.plan.name, active: st.active, periodEnd: st.periodEnd, minutes: st.minutesIncluded },
      usage: { periodStart: since.toISOString(), minutes: st.minutesUsed, minutesIncluded: st.minutesIncluded, minutesRemaining: st.minutesRemaining, balancePercent, conversations: usage[0].conversations, escalations: usage[0].escalations, testConversations: tests[0].n, paused, voicePaused: paused || st.minutesRemaining <= 0 },
      conversations, gaps, settings: (({ integrations, ...s }) => s)(biz.settings || {}), channels: channelStatus(biz),
    });
  } catch (e) {
    console.error('[hq]', e);
    return bad(res, 500, e.message);
  }
}

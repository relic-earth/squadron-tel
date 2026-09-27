// /api/hq — everything Squadron HQ shows: conversations, escalations, usage
// against the plan allowance, the knowledge queue, settings and channel
// status. ?export=csv returns the conversation log as a file.
import { sql, loadBusiness, loadProfile, bad } from './_lib/db.js';
import { ensureAuthSchema, currentAccount } from './_lib/auth.js';
import { ledgerStatus } from './_lib/ledger.js';
import { channelStatus } from './_lib/channels.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const token = req.query?.token;
  if (!token) return bad(res, 400, 'token required');
  try {
    await ensureAuthSchema();
    const biz = await loadBusiness(token);
    if (!biz) return bad(res, 404, 'Unknown business');
    const acc = await currentAccount(req);
    const conversations = await sql().query(
      'SELECT id, channel, agent_name, outcome, summary, escalated, test, duration_s, recording_url, started_at, ended_at, jsonb_array_length(transcript) AS turns FROM conversations WHERE business_id = $1 ORDER BY started_at DESC LIMIT 500', [biz.id]);
    if (req.query.export === 'csv') {
      const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const lines = ['id,started_at,channel,agent,outcome,escalated,test,duration_s,turns,summary'];
      for (const c of conversations) lines.push([c.id, c.started_at, c.channel, c.agent_name, c.outcome, c.escalated, c.test, c.duration_s, c.turns, c.summary].map(esc).join(','));
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="squadron-conversations-${biz.id}.csv"`);
      return res.status(200).send(lines.join('\n'));
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
      conversations, gaps, settings: biz.settings || {}, channels: channelStatus(biz),
    });
  } catch (e) {
    console.error('[hq]', e);
    return bad(res, 500, e.message);
  }
}

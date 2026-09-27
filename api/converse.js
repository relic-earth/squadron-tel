// /api/converse — one turn of a grounded conversation with the team. Used by
// the browser test harness and, later, by the deployed chat channel. Every
// turn is stored, and every refusal becomes an entry in the knowledge queue.
import { ensureSchema, sql, loadBusiness, loadProfile, loadTeam, newId, readJson, bad } from './_lib/db.js';
import { applyCorrections } from './_lib/profile.js';
import { answer } from './_lib/answer.js';
import { notifyOwner } from './_lib/email.js';
import { firstRealAnswer } from './_lib/care.js';
import { requireFunds, recordSpend, textCostCents, HOLD, PaymentRequired } from './_lib/ledger.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return bad(res, 405, 'POST only');
  const body = readJson(req);
  const { token, message, businessId } = body;
  const channel = ['chat', 'voice-web', 'phone', 'sms', 'email'].includes(body.channel) ? body.channel : 'chat';
  const test = token ? body.test !== false : false;
  if (!token && !businessId) return bad(res, 400, 'token required');
  if (!message || typeof message !== 'string') return bad(res, 400, 'message required');
  try {
    await ensureSchema();
    let biz = null;
    if (token) biz = await loadBusiness(token);
    else {
      // Public widget access: only a business whose chat channel is turned on.
      const rows = await sql().query('SELECT * FROM businesses WHERE id = $1', [String(businessId)]);
      biz = rows[0] || null;
      if (biz && !(biz.channels && biz.channels.chat && biz.channels.chat.enabled)) return bad(res, 403, 'Chat is not turned on for this business.');
    }
    if (!biz) return bad(res, 404, 'Unknown business');
    const [prow, team] = await Promise.all([loadProfile(biz.id), loadTeam(biz.id)]);
    if (!prow || !team) return bad(res, 400, 'Build the profile and the team first.');
    const profile = applyCorrections(prow.profile, prow.corrections);
    const agents = team.agents.agents.filter((a) => a.enabled !== false);
    if (!agents.length) return bad(res, 400, 'Every agent is turned off.');
    const business = { name: profile.company?.name?.value || biz.input_value };
    // Prepaid only: every turn, test or live, needs an active paid plan with
    // budget left. Chat has no conversation limit beyond the prepaid budget.
    try { await requireFunds(biz.account_id, HOLD.chatTurn, business.name); }
    catch (e) {
      if (!(e instanceof PaymentRequired)) throw e;
      return res.status(402).json({ error: test ? e.message : `${business.name} cannot take chat messages right now. Please contact the business directly.`, code: e.code });
    }

    let convo = null;
    if (body.conversationId) {
      const rows = await sql().query('SELECT * FROM conversations WHERE id = $1 AND business_id = $2', [body.conversationId, biz.id]);
      convo = rows[0] || null;
    }
    if (!convo) {
      convo = { id: newId('cnv'), transcript: [], sources: [], agent_id: null };
      await sql().query('INSERT INTO conversations (id, business_id, channel, transcript, test) VALUES ($1,$2,$3,$4,$5)', [convo.id, biz.id, channel, '[]', test]);
    }
    const history = convo.transcript || [];
    if (history.length >= 80) return bad(res, 429, 'This conversation has reached its length limit. Please start a new one.');
    const lastAgentId = [...history].reverse().find((h) => h.role === 'agent')?.agent_id || null;
    const out = await answer({ business, agents, profile, history, message: message.slice(0, 2000), channel, lastAgentId, settings: biz.settings || null });

    await recordSpend({ accountId: biz.account_id, businessId: biz.id, kind: test ? 'chat-test' : 'chat', cents: textCostCents(out.model, out.usage), ref: convo.id });
    const now = new Date().toISOString();
    history.push({ role: 'customer', text: message.slice(0, 2000), at: now });
    history.push({ role: 'agent', agent_id: out.agent.id, agent_name: `${out.agent.persona} · ${out.agent.title}`, text: out.reply, type: out.replyType, citations: out.citations.map((c) => c.id), at: now });
    if (out.followUp) history.push({ role: 'agent', agent_id: out.agent.id, agent_name: `${out.agent.persona} · ${out.agent.title}`, text: out.followUp, type: 'follow_up', citations: [], at: now });
    const sources = (convo.sources || []).concat(out.citations.map((c) => ({ id: c.id, text: c.text, source: c.source })));
    const outcome = out.replyType === 'transfer' ? 'transferred' : out.replyType === 'take_message' ? 'message taken' : out.replyType === 'refusal' ? 'unanswered question' : 'answered';
    await sql().query(
      `UPDATE conversations SET transcript = $2, sources = $3, agent_id = $4, agent_name = $5, outcome = $6, escalated = escalated OR $7, summary = $8 WHERE id = $1`,
      [convo.id, JSON.stringify(history), JSON.stringify(sources), out.agent.id, `${out.agent.persona} · ${out.agent.title}`, outcome, out.replyType === 'transfer', history.find((h) => h.role === 'customer')?.text.slice(0, 140) || null]);
    if (out.gapQuestion && ['refusal', 'take_message', 'transfer'].includes(out.replyType)) {
      await sql().query('INSERT INTO knowledge_gaps (business_id, conversation_id, question) VALUES ($1,$2,$3)', [biz.id, convo.id, out.gapQuestion.slice(0, 500)]);
    }
    if (!test && ['take_message', 'transfer'].includes(out.replyType) && out.messageForOwner) {
      const recentText = history.slice(-12).map((h) => `${h.role === 'customer' ? 'Customer' : (h.agent_name || 'AI team')}: ${h.text}`).join('\n');
      notifyOwner(biz.id, { subject: out.replyType === 'transfer' ? 'A customer asked for a person' : 'A customer left a message', text: `${out.messageForOwner}\n\nThe conversation so far (${channel}):\n${recentText}\n\nIt is in Squadron HQ under Escalations.` }).catch((e) => console.error('[converse notify]', e.message));
    }
    if (!test) await firstRealAnswer(biz.id);
    return res.status(200).json({
      conversationId: convo.id,
      agent: { id: out.agent.id, persona: out.agent.persona, title: out.agent.title, portrait: out.agent.portrait, voice: out.agent.voice, persona_idx: out.agent.persona_idx },
      reply: out.reply,
      followUp: out.followUp || null,
      replyType: out.replyType,
      handoff: out.handoff,
      citations: out.citations,
      gapQuestion: out.gapQuestion,
      messageForOwner: out.messageForOwner,
      model: out.model,
    });
  } catch (e) {
    console.error('[converse]', e);
    return bad(res, 500, e.message);
  }
}

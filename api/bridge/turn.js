// /api/bridge/turn — one caller turn on the phone line. Twilio sends what the
// caller said; the team answers with the same grounded engine as chat, and the
// answer is spoken while Twilio listens for the next turn.
import { sql, loadProfile, loadTeam } from '../_lib/db.js';
import { applyCorrections } from '../_lib/profile.js';
import { answer } from '../_lib/answer.js';
import { notifyOwner, sendEmail } from '../_lib/email.js';
import { recordSpend, textCostCents } from '../_lib/ledger.js';
import { formParams, validTwilio, unsign, twiml, listen, speak, xml, canTransfer, transferTarget, PUBLIC, SPEECH_CENTS_PER_TURN, TTS_CENTS_PER_CHAR, TWILIO_VOICE } from '../_lib/phone.js';

async function startRecording(callSid, businessId) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${callSid}/Recordings.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ RecordingStatusCallback: `${PUBLIC}/api/bridge/recording?secret=${encodeURIComponent(process.env.BRIDGE_SECRET || '')}&businessId=${encodeURIComponent(businessId)}`, RecordingStatusCallbackEvent: 'completed', RecordingChannels: 'dual' }).toString(),
  }).catch((e) => console.error('[bridge/turn record]', e.message));
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/xml');
  res.setHeader('Cache-Control', 'no-store');
  const p = formParams(req);
  if (!validTwilio(req, '/api/bridge/turn', p)) return res.status(403).send('<Response/>');
  const st = unsign(req.query?.s);
  const send = (x) => res.status(200).send(twiml(x));
  if (!st) return send(`<Say voice="${TWILIO_VOICE}">Goodbye.</Say><Hangup/>`);
  try {
    const biz = (await sql().query('SELECT * FROM businesses WHERE id = $1', [st.b]))[0];
    const settings = (biz && biz.settings) || {};
    if (!st.r) { await startRecording(p.CallSid, st.b); st.r = 1; }
    if ((Date.now() - st.t) / 1000 > Number(st.l || 0) - 20) return send(`${speak('This call has reached its time limit. Thank you for calling. Goodbye.', settings)}<Hangup/>`);
    const said = String(p.SpeechResult || '').trim();
    if (!said) {
      const n = (st.n || 0) + (req.query?.silent ? 0 : 1);
      if (n >= 3) return send(`${speak("I'll let you go now. Thank you for calling. Goodbye.", settings)}<Hangup/>`);
      return send(listen({ ...st, n }, speak("I'm here whenever you're ready.", settings)));
    }
    const [prow, team, crow] = await Promise.all([loadProfile(biz.id), loadTeam(biz.id), sql().query('SELECT * FROM conversations WHERE id = $1', [st.c])]);
    const profile = applyCorrections(prow.profile, prow.corrections);
    const agents = team.agents.agents.filter((a) => a.enabled !== false);
    const business = { name: profile.company?.name?.value || biz.input_value };
    const convo = crow[0] || { transcript: [], sources: [] };
    const history = convo.transcript || [];
    const lastAgentId = [...history].reverse().find((h) => h.role === 'agent')?.agent_id || null;
    const out = await answer({ business, agents, profile, history, message: said.slice(0, 2000), channel: 'phone', lastAgentId, settings });
    const spoken = [out.reply, out.followUp].filter(Boolean).join(' ');
    const tts = String(settings.tts_voice || '').startsWith('deepgram:') ? spoken.length * TTS_CENTS_PER_CHAR : 0;
    await recordSpend({ accountId: biz.account_id, businessId: biz.id, kind: st.d ? 'phone-demo' : 'phone-turn', cents: textCostCents(out.model, out.usage) + SPEECH_CENTS_PER_TURN + tts, ref: st.c });
    const now = new Date().toISOString();
    const agentName = `${out.agent.persona} · ${out.agent.title}`;
    history.push({ role: 'customer', text: said.slice(0, 2000), at: now });
    history.push({ role: 'agent', agent_id: out.agent.id, agent_name: agentName, text: spoken, type: out.replyType, citations: out.citations.map((c) => c.id), at: now });
    const transfer = out.replyType === 'transfer' && canTransfer(settings, out.transferTo) && !st.d;
    const outcome = out.replyType === 'transfer' ? 'transferred' : out.replyType === 'take_message' ? 'message taken' : out.replyType === 'refusal' ? 'unanswered question' : 'answered';
    await sql().query('UPDATE conversations SET transcript = $2, sources = $3, agent_id = $4, agent_name = $5, outcome = $6, escalated = escalated OR $7, summary = COALESCE(summary, $8) WHERE id = $1',
      [st.c, JSON.stringify(history), JSON.stringify((convo.sources || []).concat(out.citations.map((c) => ({ id: c.id, text: c.text, source: c.source })))), out.agent.id, agentName, outcome, out.replyType === 'transfer', said.slice(0, 140)]);
    if (out.gapQuestion && ['refusal', 'take_message', 'transfer'].includes(out.replyType)) await sql().query('INSERT INTO knowledge_gaps (business_id, conversation_id, question) VALUES ($1, $2, $3)', [biz.id, st.c, out.gapQuestion.slice(0, 500)]);
    if (!st.d && ['take_message', 'transfer'].includes(out.replyType) && out.messageForOwner) {
      const recent = history.slice(-12).map((h) => `${h.role === 'customer' ? 'Caller' : (h.agent_name || 'AI team')}: ${h.text}`).join('\n');
      const to = out.transferTo ? ` for ${out.transferTo.name}` : '';
      if (out.transferTo && out.transferTo.email) sendEmail({ to: out.transferTo.email, subject: transfer ? `A caller was put through to ${out.transferTo.name}` : `A caller left a message for ${out.transferTo.name}`, text: `${out.messageForOwner}\n\nThe call so far:\n${recent}` }).catch((e) => console.error('[bridge/turn directory email]', e.message));
      notifyOwner(biz.id, { subject: transfer ? `A caller was transferred${to}` : `A caller left a message${to}`, text: `${out.messageForOwner}\n\nThe call so far:\n${recent}\n\nIt is in Squadron HQ.` }).catch((e) => console.error('[bridge/turn notify]', e.message));
    }
    if (transfer) return send(`${speak(spoken, settings)}<Dial>${xml(transferTarget(settings, out.transferTo))}</Dial>`);
    // The team chose to put the caller through, but there is no line to dial:
    // say so plainly and take a message instead of leaving them hanging.
    if (out.replyType === 'transfer' && !st.d) {
      const who = out.transferTo ? out.transferTo.name : 'someone';
      return send(listen({ ...st, n: 0 }, speak(`I'm sorry, ${who} can't take calls directly right now, so I'll take a message for them. What's your name, and the best number to reach you?`, settings)));
    }
    return send(listen({ ...st, n: 0 }, speak(spoken, settings)));
  } catch (e) {
    console.error('[bridge/turn]', e);
    return send(listen({ ...st, n: (st.n || 0) + 1 }, `<Say voice="${TWILIO_VOICE}">Sorry, I missed that. Could you say it again?</Say>`));
  }
}

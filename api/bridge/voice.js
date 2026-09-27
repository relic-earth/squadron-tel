// /api/bridge/voice — Twilio's voice webhook for every Squadron number.
// Squadron checks Twilio's signature, finds the business, places the prepaid
// hold for the whole call, greets the caller and starts listening. Each turn
// then goes to /api/bridge/turn. Everything runs on Vercel and Twilio.
import { sql, loadTeam, newId } from '../_lib/db.js';
import { ensureBridgeSchema } from '../_lib/bridge.js';
import { callContext } from './context.js';
import { formParams, validTwilio, twiml, listen, speak, xml, TWILIO_VOICE } from '../_lib/phone.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/xml');
  res.setHeader('Cache-Control', 'no-store');
  const p = formParams(req);
  if (!validTwilio(req, '/api/bridge/voice', p)) return res.status(403).send('<Response/>');
  const bye = (t) => res.status(200).send(twiml(`<Say voice="${TWILIO_VOICE}">${xml(t)}</Say><Hangup/>`));
  try {
    const ctx = await callContext(String(p.To || ''), String(p.CallSid || ''));
    if (!ctx || !ctx.ok) return bye(ctx && ctx.reason === 'paused' ? 'This business has reached its plan allowance, so its assistant is paused right now. Please try again later.' : 'This number is not assigned to a business right now. Goodbye.');
    const biz = (await sql().query('SELECT * FROM businesses WHERE id = $1', [ctx.businessId]))[0];
    const team = await loadTeam(biz.id);
    const front = team.agents.agents.filter((a) => a.enabled !== false)[0];
    const greeting = `This call is answered by an AI agent for ${ctx.businessName}, and it is recorded. ${front.greeting} You're dealing with top brass from the start: every agent on this line is a manager.`;
    const convoId = newId('cnv');
    const now = new Date().toISOString();
    await sql().query("INSERT INTO conversations (id, business_id, channel, transcript, test, agent_id, agent_name, outcome) VALUES ($1, $2, 'phone', $3, $4, $5, $6, 'in progress')",
      [convoId, biz.id, JSON.stringify([{ role: 'agent', agent_id: front.id, agent_name: `${front.persona} · ${front.title}`, text: greeting, at: now }]), !!ctx.demo, front.id, `${front.persona} · ${front.title}`]);
    await ensureBridgeSchema();
    await sql().query('ALTER TABLE calls ADD COLUMN IF NOT EXISTS hold_ref TEXT');
    await sql().query(`INSERT INTO calls (call_sid, business_id, conversation_id, from_number, demo, hold_ref) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (call_sid) DO UPDATE SET conversation_id = EXCLUDED.conversation_id, hold_ref = EXCLUDED.hold_ref`, [p.CallSid, biz.id, convoId, p.From || null, !!ctx.demo, ctx.holdRef]);
    const state = { b: biz.id, c: convoId, h: ctx.holdRef, t: Date.now(), l: ctx.limitSeconds, d: ctx.demo ? 1 : 0, n: 0, r: 0 };
    return res.status(200).send(twiml(listen(state, speak(greeting, biz.settings))));
  } catch (e) {
    console.error('[bridge/voice]', e);
    return bye('Sorry, this line is having a problem right now. Please try again in a few minutes. Goodbye.');
  }
}

// /api/bridge/status — Twilio's call status callback. When a call ends, the
// prepaid hold is settled to the measured line cost (Twilio minutes and
// recording) and the call's length is saved. Model, speech and voice costs
// are recorded turn by turn in /api/bridge/turn.
import { sql } from '../_lib/db.js';
import { settleHold, PER_MINUTE } from '../_lib/ledger.js';
import { formParams, validTwilio } from '../_lib/phone.js';
import { firstRealAnswer } from '../_lib/care.js';

export default async function handler(req, res) {
  const p = formParams(req);
  if (!validTwilio(req, '/api/bridge/status', p)) return res.status(403).end();
  if (p.CallStatus !== 'completed') return res.status(200).end();
  try {
    const call = (await sql().query('SELECT * FROM calls WHERE call_sid = $1', [p.CallSid]))[0];
    if (call) {
      const seconds = Math.max(1, Number(p.CallDuration) || 0);
      const cents = Math.ceil(seconds / 60) * (PER_MINUTE.twilioInbound + PER_MINUTE.twilioRecording);
      if (call.hold_ref) await settleHold(String(call.hold_ref), { cents, seconds });
      if (call.conversation_id) await sql().query("UPDATE conversations SET duration_s = $2, ended_at = now(), outcome = CASE WHEN outcome = 'in progress' THEN 'ended' ELSE outcome END WHERE id = $1", [call.conversation_id, seconds]);
      if (call.conversation_id && !call.demo) {
        await firstRealAnswer(call.business_id);
      }
    }
  } catch (e) { console.error('[bridge/status]', e); }
  return res.status(200).end();
}

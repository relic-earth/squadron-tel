// /api/bridge/call-ended — stores a finished phone call as a conversation,
// with its gaps and messages, and releases a demo number if one was used.
import { sql, bad, newId, readJson } from '../_lib/db.js';
import { checkSecret, ensureBridgeSchema } from '../_lib/bridge.js';
import { settleHold, realtimeCostCents, PER_MINUTE, HOLD } from '../_lib/ledger.js';

// Deepgram Aura-2 text-to-speech, $0.030 per 1,000 characters (published pay-as-you-go price).
const TTS_CENTS_PER_CHAR = 0.003;
import { notifyOwner } from '../_lib/email.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!checkSecret(req)) return bad(res, 401, 'unauthorized');
  if (req.method !== 'POST') return bad(res, 405, 'POST only');
  const b = readJson(req);
  try {
    await ensureBridgeSchema();
    const businessId = String(b.businessId || '');
    const transcript = (Array.isArray(b.transcript) ? b.transcript : []).slice(0, 400);
    const outcome = b.transferRequested ? 'transferred' : (b.messages || []).length ? 'message taken' : (b.gaps || []).length ? 'unanswered question' : transcript.length ? 'answered' : 'no conversation';
    const id = newId('cnv');
    const existing = b.callSid ? await sql().query('SELECT recording_url FROM calls WHERE call_sid = $1', [b.callSid]) : [];
    await sql().query(
      `INSERT INTO conversations (id, business_id, channel, agent_id, agent_name, outcome, summary, transcript, duration_s, escalated, test, recording_url, ended_at)
       VALUES ($1,$2,'phone',$3,$4,$5,$6,$7,$8,$9,$10,$11, now())`,
      [id, businessId, b.agentId || null, b.agentName || null, outcome, transcript.find((t) => t.role === 'customer')?.text.slice(0, 140) || (b.from ? `Call from ${b.from}` : null), JSON.stringify(transcript), Number.isFinite(+b.durationS) ? Math.round(+b.durationS) : null, !!b.transferRequested, !!b.demo, existing[0]?.recording_url || null]);
    if (b.callSid) {
      await sql().query(`INSERT INTO calls (call_sid, business_id, conversation_id, from_number, demo) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (call_sid) DO UPDATE SET conversation_id = EXCLUDED.conversation_id`, [b.callSid, businessId, id, b.from || null, !!b.demo]);
    }
    for (const g of (b.gaps || []).slice(0, 20)) if (typeof g === 'string' && g.trim()) await sql().query('INSERT INTO knowledge_gaps (business_id, conversation_id, question) VALUES ($1,$2,$3)', [businessId, id, g.trim().slice(0, 500)]);
    // Settle the call's hold to its measured cost: Realtime tokens plus
    // transcription and Twilio per-minute charges. Without a usage report the
    // hold settles at the worst-case rate, so a missing report never undercharges.
    if (b.holdRef) {
      const seconds = Math.max(1, Number(b.durationS) || 0);
      const minutes = Math.ceil(seconds / 60);
      const perMin = PER_MINUTE.transcribe + PER_MINUTE.twilioInbound + PER_MINUTE.twilioRecording;
      const ttsCents = Math.max(0, Number(b.ttsChars) || 0) * TTS_CENTS_PER_CHAR;
      const measured0 = b.usage && typeof b.usage === 'object' ? realtimeCostCents(String(b.model || ''), b.usage) + minutes * perMin : (seconds / 60) * HOLD.voicePerMinute;
      const measured = measured0 + ttsCents;
      await settleHold(String(b.holdRef), { cents: measured, seconds });
    }
    const msgs = (b.messages || []).filter((m) => m && m.message).slice(0, 10);
    if (msgs.length && !b.demo) {
      await notifyOwner(businessId, {
        subject: `New message from a caller${b.from ? ' at ' + b.from : ''}`,
        text: msgs.map((m) => `Message: ${m.message}\nContact: ${m.contact || 'not given'}`).join('\n\n') + '\n\nThe full call is in Squadron HQ: https://www.squadron.tel/hq',
      }).catch((e) => console.error('[call-ended email]', e.message));
    }
    for (const m of (b.messages || []).slice(0, 10)) if (m && m.message) await sql().query("INSERT INTO knowledge_gaps (business_id, conversation_id, question, proposed_answer, status) VALUES ($1,$2,$3,$4,'message')", [businessId, id, `Message taken: ${String(m.message).slice(0, 400)}`, `Contact: ${String(m.contact || 'not given').slice(0, 200)}`]);
    return res.status(200).json({ ok: true, conversationId: id });
  } catch (e) {
    console.error('[bridge/call-ended]', e);
    return bad(res, 500, e.message);
  }
}

// /api/bridge/session?businessId=... — the Realtime session (instructions,
// voice, tools) for a business's phone line, plus settings the bridge needs.
import { sql, bad, loadProfile, loadTeam } from '../_lib/db.js';
import { checkSecret, ensureBridgeSchema } from '../_lib/bridge.js';
import { applyCorrections } from '../_lib/profile.js';
import { voiceSession } from '../_lib/voice.js';
import { deepgramToken } from '../_lib/tts.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!checkSecret(req)) return bad(res, 401, 'unauthorized');
  const businessId = String(req.query?.businessId || '');
  try {
    await ensureBridgeSchema();
    const rows = await sql().query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    const biz = rows[0];
    if (!biz) return bad(res, 404, 'Unknown business');
    const [prow, team] = await Promise.all([loadProfile(biz.id), loadTeam(biz.id)]);
    if (!prow || !team) return bad(res, 400, 'No profile or team');
    const profile = applyCorrections(prow.profile, prow.corrections);
    const agents = team.agents.agents.filter((a) => a.enabled !== false);
    const business = { name: profile.company?.name?.value || biz.input_value };
    const session = voiceSession({ business, agents, profile, channel: 'phone', settings: biz.settings || null, recordingNotice: true, withLookup: true });
    // A short-lived OpenAI key for this one call, so the bridge never holds the real key.
    const model = String(req.query?.model || process.env.REALTIME_MODEL || 'gpt-realtime-2.1-mini');
    const cs = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: 600 }, session: { type: 'realtime', model } }),
    });
    const csText = await cs.text();
    if (!cs.ok) throw new Error(`OpenAI client secret failed (${cs.status}): ${csText.slice(0, 200)}`);
    const csJson = JSON.parse(csText);
    const clientSecret = csJson.value || csJson.client_secret?.value;
    // Businesses with a Deepgram voice get text-only Realtime output, spoken by
    // Deepgram Aura; the bridge falls back to the Realtime voice if this fails.
    let tts = null;
    const tv = String((biz.settings && biz.settings.tts_voice) || '');
    if (tv.startsWith('deepgram:')) {
      try { tts = { provider: 'deepgram', model: tv.slice(9), token: await deepgramToken() }; }
      catch (e) { console.error('[bridge/session] deepgram token', e.message); }
    }
    return res.status(200).json({ ok: true, session, clientSecret, model, agent: session.speaker, settings: biz.settings || {}, businessName: business.name, tts });
  } catch (e) {
    console.error('[bridge/session]', e);
    return bad(res, 500, e.message);
  }
}

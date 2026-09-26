// /api/voice-check — a public health check for the phone voice chain:
// Squadron's partner secret → Relic → Deepgram. Returns only booleans, never
// a token. Used to confirm Deepgram voices work before a real call.
import { deepgramToken } from './_lib/tts.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const out = { partnerSecret: !!process.env.SQUADRON_PARTNER_SECRET, twilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN), bridgeSecret: !!process.env.BRIDGE_SECRET, deepgramToken: false, error: null };
  try { out.deepgramToken = !!(await deepgramToken()); } catch (e) { out.error = e.message; }
  // The phone bridge: find it from the Twilio numbers' voice webhooks, then ask it for /health.
  out.bridge = null; out.numbers = 0;
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=50`, { headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64') } });
    const j = await r.json();
    const nums = j.incoming_phone_numbers || [];
    out.numbers = nums.length;
    out.webhooks = nums.map((n) => { try { const u = new URL(n.voice_url); return u.host + u.pathname; } catch { return n.voice_url ? 'other' : 'none'; } });
    const hook = nums.map((n) => n.voice_url).find((u) => /\/twilio\/voice$/.test(u || ''));
    if (hook) {
      const h = await fetch(hook.replace(/\/twilio\/voice$/, '/health')).then((x) => x.json()).catch(() => null);
      out.bridge = { host: new URL(hook).host, healthy: !!(h && h.ok) };
    }
  } catch (e) { out.bridgeError = e.message; }
  return res.status(200).json(out);
}

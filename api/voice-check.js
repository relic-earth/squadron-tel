// /api/voice-check — a public health check for the phone voice chain:
// Squadron's partner secret → Relic → Deepgram. Returns only booleans, never
// a token. Used to confirm Deepgram voices work before a real call.
import { speakMulaw } from './_lib/tts.js';
import { sign, PUBLIC } from './_lib/phone.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const out = { partnerSecret: !!process.env.SQUADRON_PARTNER_SECRET, twilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN), bridgeSecret: !!process.env.BRIDGE_SECRET, voiceAudioBytes: 0, error: null };
  try { out.voiceAudioBytes = (await speakMulaw('Thank you for calling House Legal.')).length; } catch (e) { out.error = e.message; }
  // Twilio numbers and where their voice webhooks point.
  out.numbers = 0;
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=50`, { headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64') } });
    const j = await r.json();
    const nums = j.incoming_phone_numbers || [];
    out.numbers = nums.length;
    out.webhooks = nums.map((n) => { try { const u = new URL(n.voice_url); return u.host + u.pathname; } catch { return n.voice_url ? 'other' : 'none'; } });
    const b = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`, { headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64') } }).then((x) => x.json()).catch(() => null);
    out.twilioBalance = b && b.balance ? `${b.balance} ${b.currency}` : null;
  } catch (e) { out.twilioError = e.message; }
  out.sampleAudio = `${PUBLIC}/api/bridge/audio?a=${sign({ t: 'Thank you for calling House Legal. How can I help you today?', m: 'aura-2-pandora-en' })}`;
  return res.status(200).json(out);
}

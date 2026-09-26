// /api/voice-check — a public health check for the phone voice chain:
// Squadron's partner secret → Relic → Deepgram. Returns only booleans, never
// a token. Used to confirm Deepgram voices work before a real call.
import { deepgramToken } from './_lib/tts.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const out = { partnerSecret: !!process.env.SQUADRON_PARTNER_SECRET, twilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN), bridgeSecret: !!process.env.BRIDGE_SECRET, deepgramToken: false, error: null };
  try { out.deepgramToken = !!(await deepgramToken()); } catch (e) { out.error = e.message; }
  return res.status(200).json(out);
}

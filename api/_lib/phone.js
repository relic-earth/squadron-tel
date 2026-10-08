// api/_lib/phone.js — the phone line on plain web requests (no bridge server).
// Twilio listens and transcribes each caller turn (<Gather input="speech">),
// Squadron answers with the same engine as chat, and the answer is spoken in
// the business's voice: a Deepgram Aura voice rendered through Relic and
// played by Twilio, or a Twilio voice. Callers can talk over the agent.
import crypto from 'node:crypto';
import { humanMode } from './human.js';

export const PUBLIC = (process.env.PUBLIC_ORIGIN || 'https://www.squadron.tel').replace(/\/$/, '');
const SECRET = () => process.env.BRIDGE_SECRET || process.env.SESSION_SECRET || '';
export const TWILIO_VOICE = 'Polly.Joanna-Generative';
// Twilio speech recognition, charged per <Gather> turn (conservative).
export const SPEECH_CENTS_PER_TURN = 2;
// Deepgram Aura-2 text-to-speech, $0.030 per 1,000 characters.
export const TTS_CENTS_PER_CHAR = 0.003;

export function xml(s) { return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }

export function formParams(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return Object.fromEntries(new URLSearchParams(String(req.body || '')));
}

// Twilio signs the exact URL it requested plus the sorted POST parameters.
export function validTwilio(req, path, params) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const sig = req.headers['x-twilio-signature'];
  if (!token || !sig) return false;
  const raw = String(req.url || '');
  let data = `${PUBLIC}${path}${raw.includes('?') ? raw.slice(raw.indexOf('?')) : ''}`;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  const want = crypto.createHmac('sha1', token).update(data).digest('base64');
  return want.length === String(sig).length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(sig)));
}

const mac = (s) => crypto.createHmac('sha256', SECRET()).update(s).digest('base64url');
export function sign(obj) { const s = Buffer.from(JSON.stringify(obj)).toString('base64url'); return `${s}.${mac(s)}`; }
export function unsign(tok) {
  const [s, m] = String(tok || '').split('.');
  if (!s || !m || mac(s) !== m) return null;
  try { return JSON.parse(Buffer.from(s, 'base64url').toString()); } catch { return null; }
}

// One spoken passage: a signed audio URL for a Deepgram voice, or <Say>.
export function speak(text, settings) {
  const tv = String((settings && settings.tts_voice) || '');
  if (tv.startsWith('deepgram:')) {
    const tok = sign({ t: String(text).slice(0, 1000), m: tv.slice(9) });
    return `<Play>${xml(`${PUBLIC}/api/bridge/audio?a=${tok}`)}</Play>`;
  }
  return `<Say voice="${TWILIO_VOICE}">${xml(text)}</Say>`;
}

// Listen for the caller's next turn; the caller can interrupt what is playing.
export function listen(state, inner) {
  return `<Gather input="speech" action="${xml(`${PUBLIC}/api/bridge/turn?s=${sign(state)}`)}" method="POST" speechTimeout="auto" speechModel="phone_call" enhanced="true" language="en-US" actionOnEmptyResult="true">${inner}</Gather><Redirect method="POST">${xml(`${PUBLIC}/api/bridge/turn?s=${sign({ ...state, n: (state.n || 0) + 1 })}&silent=1`)}</Redirect>`;
}

export function twiml(inner) { return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`; }

// A transfer goes to the directory entry the team picked (Switchboard), or
// to the single on-call number (Frontdesk).
export function transferTarget(settings, entry) { return (entry && entry.phone) || (settings && settings.on_call_phone) || ''; }
export function canTransfer(settings, entry) { return humanMode(settings) !== 'ai_only' && !!transferTarget(settings, entry); }

// mu-law (8 kHz) to a 16-bit PCM WAV that Twilio's <Play> accepts.
export function mulawToWav(mu) {
  const n = mu.length, out = Buffer.alloc(44 + n * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + n * 2, 4); out.write('WAVE', 8);
  out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(8000, 24); out.writeUInt32LE(16000, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const u = ~mu[i] & 0xff, sign = u & 0x80, exp = (u >> 4) & 7, man = u & 0x0f;
    let s = ((man << 3) + 0x84) << exp; s -= 0x84;
    out.writeInt16LE(sign ? -s : s, 44 + i * 2);
  }
  return out;
}

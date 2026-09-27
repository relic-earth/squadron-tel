// /api/bridge/speak — the bridge sends one sentence of agent text and gets
// back 8 kHz mu-law audio in the business's Deepgram voice.
import { bad, readJson } from '../_lib/db.js';
import { checkSecret } from '../_lib/bridge.js';
import { speakMulaw } from '../_lib/tts.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!checkSecret(req)) return bad(res, 401, 'unauthorized');
  if (req.method !== 'POST') return bad(res, 405, 'POST');
  const b = readJson(req);
  const text = String(b.text || '').trim();
  if (!text) return bad(res, 400, 'text required');
  const model = /^aura-[a-z0-9-]+$/.test(String(b.model || '')) ? b.model : 'aura-2-pandora-en';
  try {
    const audio = await speakMulaw(text, model);
    res.setHeader('Content-Type', 'audio/basic');
    return res.status(200).send(audio);
  } catch (e) {
    console.error('[bridge/speak]', e.message);
    return bad(res, 502, e.message);
  }
}

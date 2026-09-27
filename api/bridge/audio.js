// /api/bridge/audio?a=<signed> — one spoken passage in a Deepgram Aura voice,
// as a WAV that Twilio plays. Signed by Squadron, so nobody else can use it
// to generate speech. Identical passages are cached at the edge.
import { unsign, mulawToWav } from '../_lib/phone.js';
import { speakMulaw } from '../_lib/tts.js';

export default async function handler(req, res) {
  const a = unsign(req.query?.a);
  if (!a || !a.t) return res.status(403).end();
  try {
    const wav = mulawToWav(await speakMulaw(a.t, a.m || 'aura-2-pandora-en'));
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    return res.status(200).send(wav);
  } catch (e) {
    console.error('[bridge/audio]', e.message);
    return res.status(502).end();
  }
}

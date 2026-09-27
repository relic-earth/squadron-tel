// api/_lib/tts.js — phone voices spoken by Deepgram Aura. The Deepgram key
// lives only on Relic; Relic's partner route turns text into 8 kHz mu-law
// audio that goes straight into the phone line.
const RELIC = process.env.RELIC_SQUADRON_URL || 'https://www.relic.earth/api/partner/squadron';

async function relic(body) {
  const secret = process.env.SQUADRON_PARTNER_SECRET;
  if (!secret) throw new Error('SQUADRON_PARTNER_SECRET is not configured');
  return fetch(RELIC, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-squadron-secret': secret }, body: JSON.stringify(body) });
}

// Returns raw mu-law audio (a Buffer) for one sentence or short passage.
export async function speakMulaw(text, model = 'aura-2-pandora-en') {
  const r = await relic({ action: 'speak', text: String(text).slice(0, 1000), model });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Relic partner ${r.status}`); }
  return Buffer.from(await r.arrayBuffer());
}

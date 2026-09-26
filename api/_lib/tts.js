// api/_lib/tts.js — short-lived Deepgram tokens for phone voices spoken by
// Deepgram Aura. The Deepgram key lives only on Relic; Relic's partner route
// mints a 60-second token for each call, so neither Squadron nor the bridge
// ever holds the key.
const RELIC = process.env.RELIC_SQUADRON_URL || 'https://www.relic.earth/api/partner/squadron';

export async function deepgramToken() {
  const secret = process.env.SQUADRON_PARTNER_SECRET;
  if (!secret) throw new Error('SQUADRON_PARTNER_SECRET is not configured');
  const r = await fetch(RELIC, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-squadron-secret': secret }, body: JSON.stringify({ action: 'deepgram_token' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error || `Relic partner ${r.status}`);
  return j.access_token;
}

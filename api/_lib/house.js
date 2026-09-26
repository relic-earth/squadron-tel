// api/_lib/house.js — the house account: Island Global Co's own businesses run
// on Squadron without a customer invoice. Each 30-day period carries a spend
// cap that the ledger enforces exactly like a prepaid plan, so the house
// account can never spend more than the cap in a period. Only admins reach it.
import crypto from 'node:crypto';
import { sql, newId, newToken } from './db.js';
import { ensureAuthSchema } from './auth.js';
import { ensureLedgerSchema, ledgerStatus } from './ledger.js';
import { crawlSite, normalizeUrl } from './crawl.js';
import { buildProfile, applyCorrections } from './profile.js';
import { generateTeam } from './team.js';

export const HOUSE_EMAIL = 'house@squadron.tel';
const ORIGIN = process.env.PUBLIC_ORIGIN || 'https://www.squadron.tel';
const DEFAULT_CAP_CENTS = 5000;

// Phone voices beyond the OpenAI Realtime voices. The bridge speaks these with
// Deepgram Aura text-to-speech (8 kHz mu-law, straight into the phone line).
export const TTS_VOICES = { 'deepgram:aura-2-pandora-en': 'Pandora, British female (Deepgram Aura 2), the House Legal podcast voice' };

export const HOUSE_LEGAL_RULES = `- House Legal is AI software for legal information and document analysis. It is not a law firm, and nobody on this line is a lawyer.
- Answer questions about House Legal itself: what it does, how reports work, plans and prices, accounts, billing and privacy, using only KNOWLEDGE.
- Never give legal advice, never apply the law to the caller's own situation, never predict an outcome, and never recommend what the caller should do legally. If the caller describes their own legal problem, say that you cannot advise on it, that they can ask their question in writing at houselegal.org for an AI-generated legal information report, and that for advice they should speak with a licensed attorney.
- If the caller mentions an emergency, a threat to safety, or a deadline today, tell them to call 911 for an emergency or to contact a licensed attorney right away, and do not continue the legal discussion.`;

export async function houseAccount() {
  await ensureAuthSchema();
  await ensureLedgerSchema();
  const r = await sql().query('SELECT id FROM accounts WHERE email = $1', [HOUSE_EMAIL]);
  if (r[0]) return r[0].id;
  const id = newId('acc');
  // No password hash, so nobody can sign in as the house account.
  await sql().query("INSERT INTO accounts (id, email, pass_hash, plan) VALUES ($1, $2, 'house:no-login', 'house')", [id, HOUSE_EMAIL]);
  return id;
}

// Opens a 30-day house period with the given spend cap when none is active.
export async function ensureHousePeriod(accountId, capCents) {
  const st = await ledgerStatus(accountId);
  if (st.active) return st;
  const last = await sql().query("SELECT amount_cents FROM invoices WHERE account_id = $1 AND item = 'house' ORDER BY created_at DESC LIMIT 1", [accountId]);
  const cap = Math.max(500, Math.min(100000, Math.round(Number(capCents) || (last[0] && last[0].amount_cents) || DEFAULT_CAP_CENTS)));
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 86400000);
  await sql().query(
    "INSERT INTO invoices (id, account_id, item, kind, label, amount_cents, reference, status, paid_at, period_start, period_end) VALUES ($1, $2, 'house', 'plan', $3, $4, $5, 'paid', now(), $6, $7)",
    [newId('inv'), accountId, `House account, 30 days, spend cap $${(cap / 100).toFixed(2)}`, cap, `HOUSE-${start.toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`, start, end]);
  return ledgerStatus(accountId);
}

// Renews the house period each month at the last cap (called by billing-cron).
export async function renewHouse() {
  const r = await sql().query('SELECT id FROM accounts WHERE email = $1', [HOUSE_EMAIL]);
  if (!r[0]) return false;
  const st = await ledgerStatus(r[0].id);
  if (st.active) return false;
  await ensureHousePeriod(r[0].id);
  return true;
}

// Builds (or resumes building) a house business from its website, turns chat
// on, and makes sure a house period is active. Safe to call again.
export async function houseInstall({ website, capCents, notifyEmail, onCallName, rebuild, ttsVoice, extraRules }) {
  const accountId = await houseAccount();
  const url = normalizeUrl(website);
  if (!url) throw new Error('A website address is required.');
  let biz = (await sql().query('SELECT * FROM businesses WHERE account_id = $1 AND input_value = $2 LIMIT 1', [accountId, url]))[0];
  if (!biz) {
    const id = newId('biz');
    await sql().query("INSERT INTO businesses (id, token, input_kind, input_value, status, account_id) VALUES ($1, $2, 'url', $3, 'new', $4)", [id, newToken(), url, accountId]);
    biz = (await sql().query('SELECT * FROM businesses WHERE id = $1', [id]))[0];
  }
  const log = [];
  let sources = await sql().query('SELECT kind, url, title, content FROM sources WHERE business_id = $1 ORDER BY id', [biz.id]);
  if (!sources.length || rebuild) {
    const pages = await crawlSite(url, (m) => log.push(m));
    await sql().query("DELETE FROM sources WHERE business_id = $1 AND kind = 'web'", [biz.id]);
    for (const pg of pages) await sql().query('INSERT INTO sources (business_id, kind, url, title, content) VALUES ($1, $2, $3, $4, $5)', [biz.id, pg.kind, pg.url, pg.title, pg.content]);
    sources = pages;
    log.push(`Read ${pages.length} pages.`);
  }
  let prow = (await sql().query('SELECT profile, corrections FROM profiles WHERE business_id = $1', [biz.id]))[0];
  if (!prow || rebuild) {
    const { profile, model } = await buildProfile(sources);
    await sql().query(
      `INSERT INTO profiles (business_id, profile, model) VALUES ($1, $2, $3)
       ON CONFLICT (business_id) DO UPDATE SET profile = EXCLUDED.profile, model = EXCLUDED.model, corrections = '{}'::jsonb, updated_at = now()`,
      [biz.id, JSON.stringify(profile), model]);
    prow = { profile, corrections: {} };
    log.push('Built the Business Profile.');
  }
  const hasTeam = (await sql().query('SELECT 1 FROM teams WHERE business_id = $1', [biz.id]))[0];
  if (!hasTeam || rebuild) {
    const profile = applyCorrections(prow.profile, prow.corrections);
    const { agents, routing_notes, model } = await generateTeam(profile);
    await sql().query(
      `INSERT INTO teams (business_id, agents, model) VALUES ($1, $2, $3)
       ON CONFLICT (business_id) DO UPDATE SET agents = EXCLUDED.agents, model = EXCLUDED.model, updated_at = now()`,
      [biz.id, JSON.stringify({ agents, routing_notes }), model]);
    log.push(`Built the team: ${agents.length} agents.`);
  }
  const settings = { ...(biz.settings || {}) };
  if (notifyEmail) settings.notify_email = String(notifyEmail).trim().toLowerCase();
  if (onCallName) settings.on_call_name = String(onCallName).slice(0, 80);
  if (!settings.human_mode) settings.human_mode = 'ai_first';
  if (typeof ttsVoice === 'string') settings.tts_voice = TTS_VOICES[ttsVoice] ? ttsVoice : '';
  if (typeof extraRules === 'string') settings.extra_rules = extraRules.trim().slice(0, 2000);
  else if (!settings.extra_rules && /houselegal\.org/i.test(url)) settings.extra_rules = HOUSE_LEGAL_RULES;
  const channels = { ...(biz.channels || {}), chat: { enabled: true, changed_at: new Date().toISOString() } };
  if (biz.phone_number) channels.phone = { enabled: true, changed_at: new Date().toISOString() };
  await sql().query("UPDATE businesses SET status = 'team', settings = $2, channels = $3, updated_at = now() WHERE id = $1", [biz.id, JSON.stringify(settings), JSON.stringify(channels)]);
  const ledger = await ensureHousePeriod(accountId, capCents);
  const name = prow.profile?.company?.name?.value || url;
  return {
    ok: true, businessId: biz.id, token: biz.token, name, phone: biz.phone_number || null, log, ttsVoice: settings.tts_voice || null,
    snippet: `<script src="${ORIGIN}/widget.js" data-business="${biz.id}" async></script>`,
    ledger: { active: ledger.active, budgetCents: ledger.budgetCents, spentCents: ledger.spentCents, periodEnd: ledger.periodEnd },
  };
}

// ---- Twilio numbers --------------------------------------------------------

function twilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) throw new Error('Twilio is not configured.');
  const auth = 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64');
  const call = async (url, { method = 'GET', form } = {}) => {
    const r = await fetch(url, { method, headers: { Authorization: auth, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form).toString() : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || `Twilio ${r.status}`);
    return j;
  };
  return { sid, call, base: `https://api.twilio.com/2010-04-01/Accounts/${sid}` };
}

// Lists the numbers Squadron owns (with their voice webhooks), the US local
// monthly price, and a few available numbers to buy.
export async function houseNumbers({ areaCode }) {
  const t = twilio();
  const owned = await t.call(`${t.base}/IncomingPhoneNumbers.json?PageSize=50`);
  let price = null;
  try {
    const p = await t.call('https://pricing.twilio.com/v1/PhoneNumbers/Countries/US');
    const local = (p.phone_number_prices || []).find((x) => x.number_type === 'local');
    price = local ? { current: local.current_price, base: local.base_price, unit: p.price_unit } : null;
  } catch (e) { price = { error: e.message }; }
  const q = new URLSearchParams({ VoiceEnabled: 'true', SmsEnabled: 'false', PageSize: '8' });
  if (areaCode) q.set('AreaCode', String(areaCode));
  const avail = await t.call(`${t.base}/AvailablePhoneNumbers/US/Local.json?${q}`);
  return {
    owned: (owned.incoming_phone_numbers || []).map((n) => ({ number: n.phone_number, name: n.friendly_name, voiceUrl: n.voice_url })),
    price,
    available: (avail.available_phone_numbers || []).map((n) => ({ number: n.phone_number, locality: n.locality, region: n.region })),
  };
}

// Buys one number, points it at the bridge, and assigns it to a house business.
export async function houseBuy({ businessId, number, voiceUrl }) {
  const accountId = await houseAccount();
  const biz = (await sql().query('SELECT * FROM businesses WHERE id = $1 AND account_id = $2', [businessId, accountId]))[0];
  if (!biz) throw new Error('That business is not on the house account.');
  if (biz.phone_number) return { ok: true, number: biz.phone_number, already: true };
  if (!/^\+1\d{10}$/.test(String(number || ''))) throw new Error('Pass a +1 number from the available list.');
  if (!/^https:\/\/[^\s]+\/twilio\/voice$/.test(String(voiceUrl || ''))) throw new Error('Pass the bridge voice webhook, ending in /twilio/voice.');
  const t = twilio();
  const bought = await t.call(`${t.base}/IncomingPhoneNumbers.json`, { method: 'POST', form: { PhoneNumber: number, VoiceUrl: voiceUrl, VoiceMethod: 'POST', FriendlyName: `Squadron house: ${biz.input_value}`.slice(0, 64) } });
  const channels = { ...(biz.channels || {}), phone: { enabled: true, changed_at: new Date().toISOString() } };
  await sql().query('UPDATE businesses SET phone_number = $2, channels = $3, updated_at = now() WHERE id = $1', [biz.id, bought.phone_number, JSON.stringify(channels)]);
  return { ok: true, number: bought.phone_number, sid: bought.sid };
}

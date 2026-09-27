// api/_lib/numbers.js — self-serve phone numbers for paying customers.
// A number is bought only for an account with an active paid period and
// enough prepaid balance left to cover its first month of line rental, which
// is recorded against that balance at once (and then once per paid period by
// the billing cron). Deleting the account releases the number.
import { sql } from './db.js';
import { requireFunds, recordSpend } from './ledger.js';

const ORIGIN = (process.env.PUBLIC_ORIGIN || 'https://www.squadron.tel').replace(/\/$/, '');
export const NUMBER_CENTS = Number(process.env.NUMBER_CENTS || 115);

function twilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) { const e = new Error('Phone numbers are not available right now. A person at Squadron has been told, and chat keeps working.'); e.status = 503; throw e; }
  const auth = 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64');
  const call = async (url, { method = 'GET', form } = {}) => {
    const r = await fetch(url, { method, headers: { Authorization: auth, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form).toString() : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.message || `Twilio ${r.status}`); e.status = 502; throw e; }
    return j;
  };
  return { call, base: `https://api.twilio.com/2010-04-01/Accounts/${sid}` };
}

// Up to eight local numbers, optionally in one area code. Costs nothing.
export async function searchNumbers(areaCode) {
  const t = twilio();
  const q = new URLSearchParams({ VoiceEnabled: 'true', PageSize: '8' });
  if (/^\d{3}$/.test(String(areaCode || ''))) q.set('AreaCode', String(areaCode));
  const avail = await t.call(`${t.base}/AvailablePhoneNumbers/US/Local.json?${q}`);
  return (avail.available_phone_numbers || []).map((n) => ({ number: n.phone_number, pretty: n.friendly_name, locality: n.locality, region: n.region }));
}

export async function buyNumber(biz, number) {
  if (biz.phone_number) return { number: biz.phone_number, already: true };
  if (!/^\+1\d{10}$/.test(String(number || ''))) { const e = new Error('Choose a number from the list.'); e.status = 400; throw e; }
  await requireFunds(biz.account_id, NUMBER_CENTS + 50, 'This account');
  const t = twilio();
  const bought = await t.call(`${t.base}/IncomingPhoneNumbers.json`, { method: 'POST', form: { PhoneNumber: number, VoiceUrl: `${ORIGIN}/api/bridge/voice`, VoiceMethod: 'POST', StatusCallback: `${ORIGIN}/api/bridge/status`, StatusCallbackMethod: 'POST', FriendlyName: `Squadron: ${biz.input_value}`.slice(0, 64) } });
  const st = await sql().query("SELECT period_start FROM invoices WHERE account_id = $1 AND kind = 'plan' AND status = 'paid' AND period_start <= now() AND period_end > now() ORDER BY period_start DESC LIMIT 1", [biz.account_id]);
  const ref = `num:${biz.id}:${st[0] ? new Date(st[0].period_start).toISOString().slice(0, 10) : 'now'}`;
  await recordSpend({ accountId: biz.account_id, businessId: biz.id, kind: 'number', cents: NUMBER_CENTS, ref });
  const channels = { ...(biz.channels || {}), phone: { enabled: true, changed_at: new Date().toISOString(), sid: bought.sid } };
  await sql().query('UPDATE businesses SET phone_number = $2, channels = $3, updated_at = now() WHERE id = $1', [biz.id, bought.phone_number, JSON.stringify(channels)]);
  return { number: bought.phone_number };
}

// Releases every number an account owns (on account deletion).
export async function releaseNumbers(businessIds) {
  if (!businessIds.length || !process.env.TWILIO_ACCOUNT_SID) return 0;
  const rows = await sql().query('SELECT id, phone_number, channels FROM businesses WHERE id = ANY($1) AND phone_number IS NOT NULL', [businessIds]);
  let n = 0;
  const t = twilio();
  for (const r of rows) {
    try {
      let sid = r.channels && r.channels.phone && r.channels.phone.sid;
      if (!sid) { const f = await t.call(`${t.base}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(r.phone_number)}`); sid = f.incoming_phone_numbers && f.incoming_phone_numbers[0] && f.incoming_phone_numbers[0].sid; }
      if (sid) { await t.call(`${t.base}/IncomingPhoneNumbers/${sid}.json`, { method: 'DELETE' }).catch(() => {}); n++; }
    } catch (e) { console.error('[release number]', r.phone_number, e.message); }
  }
  return n;
}

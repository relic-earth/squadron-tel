// /api/settings — business settings (on-call contact, business hours,
// notification email) and channel deployment state, with honest per-channel
// status. GET reads; POST updates.
import { accepted, REFUSAL, CODE, recordAcceptance } from './_lib/terms.js';
import { sql, loadBusiness, readJson, bad } from './_lib/db.js';
import { ensureAuthSchema } from './_lib/auth.js';
import { channelStatus } from './_lib/channels.js';
import { HUMAN_MODES } from './_lib/human.js';
import { cleanDirectory, EDITIONS, editionOf } from './_lib/directory.js';
import { currentAccount, ownerGate } from './_lib/auth.js';
import { track } from './_lib/events.js';
import { searchNumbers, buyNumber, NUMBER_CENTS } from './_lib/numbers.js';
import { PaymentRequired } from './_lib/ledger.js';


export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const body = req.method === 'GET' ? {} : readJson(req);
  const token = req.method === 'GET' ? req.query?.token : body.token;
  if (!token) return bad(res, 400, 'token required');
  try {
    await ensureAuthSchema();
    const biz = await loadBusiness(token);
    if (!biz) return bad(res, 404, 'Unknown business');
    if (req.method === 'POST' && (body.action === 'integrations' || body.action === 'integrations_test')) {
      return bad(res, 410, 'Squadron is all-in-one: conversations, escalations and messages live in Squadron HQ, so there are no outside connections to set up.');
    }
    if (req.method === 'POST' && (body.action === 'number_search' || body.action === 'number_buy')) {
      // Buying a number spends prepaid balance, so it needs the owner's session.
      const acc = await currentAccount(req);
      if (!acc || acc.id !== biz.account_id) return bad(res, 401, 'Log in to the account that owns this team first.');
      try {
        if (body.action === 'number_search') return res.status(200).json({ numbers: await searchNumbers(body.areaCode), monthlyCents: NUMBER_CENTS });
        if (body.action === 'number_buy') { if (!accepted(body)) return res.status(400).json({ error: REFUSAL, code: CODE }); await recordAcceptance(req, { accountId: acc.id, email: acc.email, kind: 'number_buy', body }); }
        const out = await buyNumber(biz, body.number);
        await track('number_bought', { accountId: acc.id, businessId: biz.id });
        const fresh = (await sql().query('SELECT * FROM businesses WHERE id = $1', [biz.id]))[0];
        return res.status(200).json({ ...out, status: channelStatus(fresh), channels: fresh.channels });
      } catch (e) {
        if (e instanceof PaymentRequired) return bad(res, 402, e.message);
        if (e.status) return bad(res, e.status, e.message);
        throw e;
      }
    }
    if (req.method === 'POST') {
      const gate = await ownerGate(req, biz); if (gate) return res.status(gate.status).json(gate);
      const settings = { ...(biz.settings || {}) };
      const s = body.settings || {};
      if ('on_call_phone' in s) settings.on_call_phone = String(s.on_call_phone || '').slice(0, 40);
      if ('on_call_name' in s) settings.on_call_name = String(s.on_call_name || '').slice(0, 80);
      if ('notify_email' in s) settings.notify_email = String(s.notify_email || '').slice(0, 200);
      if ('hours' in s) settings.hours = String(s.hours || '').slice(0, 400);
      if ('human_mode' in s) settings.human_mode = HUMAN_MODES[s.human_mode] ? s.human_mode : 'ai_first';
      if ('directory' in s) settings.directory = cleanDirectory(s.directory);
      if ('brand' in s) settings.brand = ['squadron', 'frontdesk', 'switchboard'].includes(s.brand) ? s.brand : 'squadron';
      if ('edition' in s) settings.edition = EDITIONS[s.edition] ? s.edition : undefined;
      if ('after_hours' in s) settings.after_hours = ['message', 'answer'].includes(s.after_hours) ? s.after_hours : 'answer';
      const channels = { ...(biz.channels || {}) };
      if (body.channels && typeof body.channels === 'object') {
        for (const k of ['chat', 'phone']) if (body.channels[k] && typeof body.channels[k].enabled === 'boolean') channels[k] = { ...(channels[k] || {}), enabled: body.channels[k].enabled, changed_at: new Date().toISOString() };
        if (body.channels.chat && body.channels.chat.enabled === true && !(biz.channels && biz.channels.chat && biz.channels.chat.enabled)) await track('chat_deployed', { accountId: biz.account_id, businessId: biz.id });
      }
      await sql().query('UPDATE businesses SET settings = $2, channels = $3, updated_at = now() WHERE id = $1', [biz.id, JSON.stringify(settings), JSON.stringify(channels)]);
      biz.settings = settings; biz.channels = channels;
    }
    let suggested = {};
    try {
      const p = await sql().query('SELECT profile, corrections FROM profiles WHERE business_id = $1', [biz.id]);
      const { applyCorrections } = await import('./_lib/profile.js');
      const prof = p[0] ? applyCorrections(p[0].profile, p[0].corrections) : null;
      const v = (f) => (f && f.value) || '';
      const acc = biz.account_id ? (await sql().query('SELECT email FROM accounts WHERE id = $1', [biz.account_id]))[0] : null;
      const hours = prof && Array.isArray(prof.hours) ? prof.hours.map((h) => [v(h.days), [v(h.open), v(h.close)].filter(Boolean).join(' to ')].filter(Boolean).join(', ')).filter(Boolean).join('; ') : '';
      suggested = { on_call_phone: prof ? v(prof.contact && prof.contact.phone) : '', notify_email: (acc && acc.email) || (prof ? v(prof.contact && prof.contact.email) : ''), hours: hours.slice(0, 400) };
    } catch (e) { console.error('[settings suggest]', e.message); }
    const { integrations: _hidden, ...safeSettings } = biz.settings || {};
    return res.status(200).json({ edition: editionOf(biz.settings), suggested, business: { id: biz.id, status: biz.status, phone_number: biz.phone_number }, settings: safeSettings, channels: biz.channels || {}, status: channelStatus(biz), humanModes: HUMAN_MODES });
  } catch (e) {
    console.error('[settings]', e);
    return bad(res, 500, e.message);
  }
}

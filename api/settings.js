// /api/settings — business settings (on-call contact, business hours,
// notification email) and channel deployment state, with honest per-channel
// status. GET reads; POST updates.
import { accepted, REFUSAL, CODE, recordAcceptance } from './_lib/terms.js';
import { sql, loadBusiness, readJson, bad } from './_lib/db.js';
import { ensureAuthSchema } from './_lib/auth.js';
import { channelStatus } from './_lib/channels.js';
import { HUMAN_MODES } from './_lib/human.js';
import { currentAccount } from './_lib/auth.js';
import { track } from './_lib/events.js';
import { searchNumbers, buyNumber, NUMBER_CENTS } from './_lib/numbers.js';
import { PaymentRequired } from './_lib/ledger.js';
import crypto from 'node:crypto';
import { publicIntegrations, safeWebhook, cleanUrl, checkHubspot, sendTest, recentDeliveries } from './_lib/integrations.js';


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
      // Connections hold credentials, so they need the owner's session.
      const acc = await currentAccount(req);
      if (!acc || acc.id !== biz.account_id) return bad(res, 401, 'Log in to the account that owns this team first.');
      const settings = { ...(biz.settings || {}) };
      const cur = { ...(settings.integrations || {}) };
      if (body.action === 'integrations') {
        const x = body.integrations || {};
        if ('booking_url' in x) { const u = cleanUrl(x.booking_url); if (u === null) return bad(res, 400, 'Enter the full booking page address, like https://calendly.com/yourname.'); cur.booking_url = u; }
        if ('webhook_url' in x) {
          const u = String(x.webhook_url || '').trim() ? safeWebhook(x.webhook_url) : '';
          if (u === null) return bad(res, 400, 'Enter a webhook address that starts with https:// and points to a public server, like the one Zapier or Make gives you.');
          cur.webhook_url = u;
          if (u && !cur.webhook_secret) cur.webhook_secret = 'whsec_' + crypto.randomBytes(18).toString('base64url');
        }
        if (x.hubspot_disconnect) { delete cur.hubspot_token; delete cur.hubspot_portal; }
        if (x.hubspot_token) {
          const tok = String(x.hubspot_token).trim();
          try { const { portal } = await checkHubspot(tok); cur.hubspot_token = tok; cur.hubspot_portal = portal; }
          catch (e) { return bad(res, 400, `HubSpot did not accept that token (${e.message}). Create a private app with the contacts read and write scopes, and paste its access token.`); }
        }
        settings.integrations = cur;
        await sql().query('UPDATE businesses SET settings = $2, updated_at = now() WHERE id = $1', [biz.id, JSON.stringify(settings)]);
        biz.settings = settings;
        await track('integration_saved', { accountId: acc.id, businessId: biz.id, meta: { booking: !!cur.booking_url, webhook: !!cur.webhook_url, hubspot: !!cur.hubspot_token } });
      } else {
        const out = await sendTest(biz);
        return res.status(200).json({ test: out, integrations: publicIntegrations(biz), deliveries: await recentDeliveries(biz.id) });
      }
      return res.status(200).json({ integrations: publicIntegrations(biz), deliveries: await recentDeliveries(biz.id) });
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
      const settings = { ...(biz.settings || {}) };
      const s = body.settings || {};
      if ('on_call_phone' in s) settings.on_call_phone = String(s.on_call_phone || '').slice(0, 40);
      if ('on_call_name' in s) settings.on_call_name = String(s.on_call_name || '').slice(0, 80);
      if ('notify_email' in s) settings.notify_email = String(s.notify_email || '').slice(0, 200);
      if ('hours' in s) settings.hours = String(s.hours || '').slice(0, 400);
      if ('human_mode' in s) settings.human_mode = HUMAN_MODES[s.human_mode] ? s.human_mode : 'ai_first';
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
    const deliveries = await recentDeliveries(biz.id).catch(() => []);
    return res.status(200).json({ integrations: publicIntegrations(biz), deliveries, suggested, business: { id: biz.id, status: biz.status, phone_number: biz.phone_number }, settings: safeSettings, channels: biz.channels || {}, status: channelStatus(biz), humanModes: HUMAN_MODES });
  } catch (e) {
    console.error('[settings]', e);
    return bad(res, 500, e.message);
  }
}

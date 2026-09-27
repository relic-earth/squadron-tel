// api/_lib/integrations.js — sends what the team learns to the tools a
// business already uses. Two connections, both set on the Deploy screen:
//
// - Webhook: every event is POSTed as JSON to the business's URL, signed with
//   HMAC-SHA256 (header X-Squadron-Signature: sha256=<hex of the raw body>).
//   Zapier, Make, n8n and most CRMs (Salesforce, Pipedrive, Zoho, Close,
//   GoHighLevel) accept it through a "catch hook" or inbound webhook.
// - HubSpot: with a private-app token, a customer who leaves an email or phone
//   number becomes (or updates) a HubSpot contact, and the message and chat
//   are added to that contact as a note.
//
// Only live conversations send events; tests never do. No AI model is
// called, so none of this spends provider credit. Every delivery is logged
// so the owner can see what was sent and whether it arrived.
import crypto from 'node:crypto';
import { sql } from './db.js';

export const EVENT_TYPES = {
  'person.requested': 'A customer asked for a person',
  'message.taken': 'The team took a message',
  'call.ended': 'A phone call ended',
  'question.unanswered': 'The team could not answer a question',
  'test': 'Test event from the Deploy screen',
};

let _ready = null;
export function ensureIntegrationsSchema() {
  if (!_ready) _ready = sql().query(`CREATE TABLE IF NOT EXISTS integration_log (
    id BIGSERIAL PRIMARY KEY, business_id TEXT NOT NULL, event TEXT NOT NULL, target TEXT NOT NULL,
    ok BOOLEAN NOT NULL, status INTEGER, detail TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`).catch((e) => { _ready = null; throw e; });
  return _ready;
}

export function integrationsOf(biz) { return (biz && biz.settings && biz.settings.integrations) || {}; }

// What the browser may see: never the HubSpot token itself.
export function publicIntegrations(biz) {
  const i = integrationsOf(biz);
  return {
    booking_url: i.booking_url || '',
    booking_provider: bookingProvider(i.booking_url),
    webhook_url: i.webhook_url || '',
    webhook_secret: i.webhook_secret || '',
    hubspot: i.hubspot_token ? { connected: true, hint: `…${String(i.hubspot_token).slice(-4)}`, portal: i.hubspot_portal || null } : { connected: false },
  };
}

export function bookingProvider(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    const known = { 'calendly.com': 'Calendly', 'cal.com': 'Cal.com', 'app.acuityscheduling.com': 'Acuity', 'acuityscheduling.com': 'Acuity', 'square.site': 'Square Appointments', 'squareup.com': 'Square Appointments', 'opentable.com': 'OpenTable', 'resy.com': 'Resy', 'booksy.com': 'Booksy', 'vagaro.com': 'Vagaro', 'mindbodyonline.com': 'Mindbody', 'calendar.app.google': 'Google Calendar', 'calendar.google.com': 'Google Calendar', 'outlook.office365.com': 'Microsoft Bookings', 'book.housecallpro.com': 'Housecall Pro', 'clienthub.getjobber.com': 'Jobber', 'setmore.com': 'Setmore', 'simplybook.me': 'SimplyBook.me', 'tidycal.com': 'TidyCal', 'zcal.co': 'zcal' };
    for (const [k, v] of Object.entries(known)) if (h === k || h.endsWith('.' + k)) return v;
    return url ? 'Booking page' : null;
  } catch { return null; }
}

export function cleanUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  try { const x = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); if (x.protocol !== 'https:' && x.protocol !== 'http:') return null; return x.toString(); } catch { return null; }
}

// Blocks webhooks aimed at private or local addresses.
export function safeWebhook(u) {
  const x = cleanUrl(u);
  if (!x) return x;
  const h = new URL(x).hostname.toLowerCase();
  if (new URL(x).protocol !== 'https:') return null;
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(10|127|0)\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || h.includes(':') && !h.includes('.')) return null;
  return x;
}

async function log(businessId, event, target, ok, status, detail) {
  try { await ensureIntegrationsSchema(); await sql().query('INSERT INTO integration_log (business_id, event, target, ok, status, detail) VALUES ($1,$2,$3,$4,$5,$6)', [businessId, event, target, ok, status || null, detail ? String(detail).slice(0, 300) : null]); }
  catch (e) { console.error('[integrations log]', e.message); }
}

export async function recentDeliveries(businessId) {
  await ensureIntegrationsSchema();
  return sql().query('SELECT event, target, ok, status, detail, created_at FROM integration_log WHERE business_id = $1 ORDER BY created_at DESC LIMIT 12', [businessId]);
}

const EMAIL_RE = /[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
export function contactFrom(text) {
  const t = String(text || '');
  const e = t.match(EMAIL_RE); const p = t.match(PHONE_RE);
  return { email: e ? e[0].toLowerCase() : null, phone: p ? p[0] : null };
}

async function postWebhook(biz, body) {
  const i = integrationsOf(biz);
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac('sha256', i.webhook_secret || '').update(raw).digest('hex');
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(i.webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Squadron-Webhooks/1.0', 'X-Squadron-Event': body.type, 'X-Squadron-Signature': `sha256=${sig}` }, body: raw, signal: ctrl.signal, redirect: 'manual' });
    await log(biz.id, body.type, 'webhook', r.ok, r.status, r.ok ? null : (await r.text().catch(() => '')).slice(0, 200));
    return { ok: r.ok, status: r.status };
  } catch (e) {
    await log(biz.id, body.type, 'webhook', false, null, e.name === 'AbortError' ? 'No answer within 6 seconds' : e.message);
    return { ok: false, error: e.message };
  } finally { clearTimeout(t); }
}

async function hubspot(token, path, body, method) {
  const r = await fetch(`https://api.hubapi.com${path}`, { method: method || (body ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j && j.message) || `HubSpot ${r.status}`); e.status = r.status; throw e; }
  return j;
}

export async function checkHubspot(token) {
  await hubspot(token, '/crm/v3/objects/contacts?limit=1');
  let portal = null;
  try { const a = await hubspot(token, '/account-info/v3/details'); portal = a.portalId || null; } catch {}
  return { portal };
}

async function toHubspot(biz, ev) {
  const i = integrationsOf(biz);
  const c = ev.data.contact || {};
  if (!c.email && !c.phone) return;
  try {
    let id = null;
    for (const [prop, val] of [['email', c.email], ['phone', c.phone]]) {
      if (!val || id) continue;
      const s = await hubspot(i.hubspot_token, '/crm/v3/objects/contacts/search', { filterGroups: [{ filters: [{ propertyName: prop, operator: 'EQ', value: val }] }], limit: 1 });
      if (s.results && s.results[0]) id = s.results[0].id;
    }
    if (!id) {
      const [first, ...rest] = String(c.name || '').trim().split(/\s+/);
      const props = { ...(c.email ? { email: c.email } : {}), ...(c.phone ? { phone: c.phone } : {}), ...(first ? { firstname: first } : {}), ...(rest.length ? { lastname: rest.join(' ') } : {}) };
      const created = await hubspot(i.hubspot_token, '/crm/v3/objects/contacts', { properties: props });
      id = created.id;
    }
    const note = `Squadron: ${EVENT_TYPES[ev.type] || ev.type} (${ev.data.channel || 'chat'})\n\n${ev.data.message ? `Message: ${ev.data.message}\n\n` : ''}${ev.data.summary ? `Summary: ${ev.data.summary}\n\n` : ''}${ev.data.transcript_text || ''}${ev.data.hq_url ? `\n\nSquadron HQ: ${ev.data.hq_url}` : ''}`.slice(0, 60000);
    await hubspot(i.hubspot_token, '/crm/v3/objects/notes', { properties: { hs_timestamp: new Date().toISOString(), hs_note_body: note.replace(/\n/g, '<br>') }, associations: [{ to: { id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }] });
    await log(biz.id, ev.type, 'hubspot', true, 200, `Contact ${id}`);
  } catch (e) { await log(biz.id, ev.type, 'hubspot', false, e.status || null, e.message); }
}

// Sends one event to every connected tool. Never throws.
export async function emit(biz, type, data) {
  try {
    if (!biz) return;
    const i = integrationsOf(biz);
    if (!i.webhook_url && !i.hubspot_token) return;
    const ev = { id: `evt_${crypto.randomBytes(9).toString('hex')}`, type, created_at: new Date().toISOString(), business: { id: biz.id, website: biz.input_value }, data };
    const jobs = [];
    if (i.webhook_url) jobs.push(postWebhook(biz, ev));
    if (i.hubspot_token && type !== 'question.unanswered' && type !== 'test') jobs.push(toHubspot(biz, ev));
    await Promise.all(jobs);
  } catch (e) { console.error('[integrations emit]', e.message); }
}

// Runs the send after the response when the platform allows it.
export async function emitLater(biz, type, data) {
  try { const { waitUntil } = await import('@vercel/functions'); waitUntil(emit(biz, type, data)); }
  catch { await emit(biz, type, data); }
}

export function transcriptText(transcript) {
  return (transcript || []).filter((h) => h.type !== 'person_request').slice(-30).map((h) => `${h.role === 'customer' ? 'Customer' : (h.agent_name || 'AI team')}: ${h.text}`).join('\n');
}

export async function sendTest(biz) {
  const i = integrationsOf(biz);
  const out = {};
  if (i.webhook_url) out.webhook = await postWebhook(biz, { id: `evt_test_${Date.now()}`, type: 'test', created_at: new Date().toISOString(), business: { id: biz.id, website: biz.input_value }, data: { message: 'This is a test event from Squadron. Live events have the same shape, with the customer contact, message, channel, transcript and a link to Squadron HQ.', contact: { name: 'Test Customer', email: 'test@example.com', phone: null }, channel: 'chat' } });
  if (i.hubspot_token) { try { await checkHubspot(i.hubspot_token); out.hubspot = { ok: true }; await log(biz.id, 'test', 'hubspot', true, 200, 'Token works'); } catch (e) { out.hubspot = { ok: false, error: e.message }; await log(biz.id, 'test', 'hubspot', false, e.status, e.message); } }
  return out;
}

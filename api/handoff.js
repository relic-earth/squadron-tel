// /api/handoff — the human layer for the chat widget.
// GET  ?businessId=  → how this business shares work between AI and people.
// POST { businessId, conversationId, name, contact, message } → a customer
//   asks for a person: the request is stored on the conversation, marked as
//   an escalation in Squadron HQ, and emailed to the business. No AI model is
//   called, so a request to reach a person never costs the business credit
//   and works even when the prepaid balance is used.
import crypto from 'node:crypto';
import { ensureSchema, sql, newId, readJson, bad } from './_lib/db.js';
import { notifyOwner } from './_lib/email.js';
import { humanMode, HUMAN_MODES } from './_lib/human.js';
import { emitLater, contactFrom, integrationsOf } from './_lib/integrations.js';

async function loadPublic(id) {
  const rows = await sql().query('SELECT * FROM businesses WHERE id = $1', [String(id || '')]);
  const biz = rows[0];
  if (!biz || !(biz.channels && biz.channels.chat && biz.channels.chat.enabled)) return null;
  return biz;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    await ensureSchema();
    if (req.method === 'GET' && req.query?.site) {
      // House-account sites install the widget by domain (data-site).
      const host = String(req.query.site).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[\/?#].*$/, '');
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return bad(res, 400, 'site required');
      const rows = await sql().query("SELECT b.id, b.phone_number, b.channels FROM businesses b JOIN accounts a ON a.id = b.account_id WHERE a.email = 'house@squadron.tel' AND (b.input_value ILIKE $1 OR b.input_value ILIKE $2) AND (b.channels->'chat'->>'enabled') = 'true' ORDER BY b.created_at LIMIT 1", [`https://${host}/%`, `https://www.${host}/%`]);
      if (!rows[0]) return bad(res, 404, 'No team is installed for this site.');
      const ph = rows[0].channels && rows[0].channels.phone && rows[0].channels.phone.enabled ? rows[0].phone_number : null;
      return res.status(200).json({ businessId: rows[0].id, phone: ph || null });
    }
    if (req.method === 'GET') {
      const biz = await loadPublic(req.query?.businessId);
      if (!biz) return bad(res, 404, 'Chat is not turned on for this business.');
      const st = biz.settings || {};
      const mode = humanMode(st);
      return res.status(200).json({ mode, label: HUMAN_MODES[mode].label, person: st.on_call_name || null, hours: st.hours || null, booking: integrationsOf(biz).booking_url || null });
    }
    if (req.method !== 'POST') return bad(res, 405, 'GET or POST');
    const body = readJson(req);
    const biz = await loadPublic(body.businessId);
    if (!biz) return bad(res, 404, 'Chat is not turned on for this business.');
    const st = biz.settings || {};
    const name = String(body.name || '').trim().slice(0, 120);
    const contact = String(body.contact || '').trim().slice(0, 200);
    const message = String(body.message || '').trim().slice(0, 3000);
    if (!contact || contact.length < 5) return bad(res, 400, 'Add an email address or phone number so a person can reach you.');
    if (!message) return bad(res, 400, 'Tell us briefly what you need.');

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ipHash = crypto.createHash('sha256').update(ip + biz.id).digest('hex').slice(0, 24);
    await sql().query(`CREATE TABLE IF NOT EXISTS handoffs (
      id TEXT PRIMARY KEY, business_id TEXT NOT NULL, conversation_id TEXT, name TEXT, contact TEXT NOT NULL,
      message TEXT NOT NULL, ip_hash TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const recent = await sql().query("SELECT count(*)::int AS n FROM handoffs WHERE business_id = $1 AND ip_hash = $2 AND created_at > now() - interval '1 hour'", [biz.id, ipHash]);
    if (recent[0].n >= 5) return bad(res, 429, 'Your requests have reached the business. A person will reply.');

    // Attach to the chat conversation, or open one for a customer who asked
    // for a person before chatting with the AI team.
    let convo = null;
    if (body.conversationId) {
      const r = await sql().query('SELECT id, transcript FROM conversations WHERE id = $1 AND business_id = $2', [String(body.conversationId), biz.id]);
      convo = r[0] || null;
    }
    const now = new Date().toISOString();
    const entry = { role: 'customer', text: `Asked for a person. Name: ${name || 'not given'}. Contact: ${contact}. Message: ${message}`, type: 'person_request', at: now };
    if (convo) {
      const t = (convo.transcript || []).concat([entry]);
      await sql().query("UPDATE conversations SET transcript = $2, escalated = true, outcome = 'person requested' WHERE id = $1", [convo.id, JSON.stringify(t)]);
    } else {
      convo = { id: newId('cnv'), transcript: [entry] };
      await sql().query("INSERT INTO conversations (id, business_id, channel, transcript, escalated, outcome, summary, test) VALUES ($1,$2,'chat',$3,true,'person requested',$4,false)", [convo.id, biz.id, JSON.stringify([entry]), message.slice(0, 140)]);
    }
    const id = newId('hnd');
    await sql().query('INSERT INTO handoffs (id, business_id, conversation_id, name, contact, message, ip_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, biz.id, convo.id, name || null, contact, message, ipHash]);

    const history = (convo.transcript || []).filter((h) => h.type !== 'person_request').slice(-20)
      .map((h) => `${h.role === 'customer' ? 'Customer' : (h.agent_name || 'AI team')}: ${h.text}`).join('\n');
    let emailed = false;
    try {
      const r = await notifyOwner(biz.id, {
        subject: `A customer asked for a person: ${name || contact}`,
        text: `A customer on your website chat asked to talk with a person.\n\nName: ${name || 'not given'}\nContact: ${contact}\nMessage: ${message}${history ? `\n\nTheir chat with your AI team:\n${history}` : ''}\n\nReply to them directly. The conversation is marked as an escalation in Squadron HQ.`,
      });
      emailed = !!(r && r.sent);
    } catch (e) { console.error('[handoff email]', e.message); }

    const ct = contactFrom(contact);
    await emitLater(biz, 'person.requested', { channel: 'chat', conversation_id: convo.id, message, contact: { name: name || null, email: ct.email, phone: ct.phone || (ct.email ? null : contact) }, transcript_text: history });
    const who = st.on_call_name || 'A person at the business';
    return res.status(200).json({ ok: true, id, conversationId: convo.id, emailed, reply: `${who} has your message and will contact you at ${contact}.${st.hours ? ` Business hours are ${st.hours}.` : ''}` });
  } catch (e) {
    console.error('[handoff]', e);
    return bad(res, 500, 'Your request could not be sent. Please contact the business directly.');
  }
}

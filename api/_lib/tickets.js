// api/_lib/tickets.js — requests for a person at Squadron. One path for the
// Help Center form and for Ace: the request is stored with a reference
// number, the Squadron team is emailed (reply-to the customer), and the
// customer gets an email with the same reference.
import crypto from 'node:crypto';
import { ensureSchema, sql } from './db.js';
import { sendEmail } from './email.js';

export const TEAM = (process.env.SUPPORT_TO || 'info@squadron.tel,info@island.contact').split(',').map((s) => s.trim()).filter(Boolean);
export const TOPICS = ['Setup', 'Testing', 'Going live', 'Billing', 'Something is broken', 'Sales question', 'Other'];

let ready = null;
export async function ensureSupportSchema() {
  await ensureSchema();
  if (!ready) {
    ready = (async () => {
      await sql().query(`CREATE TABLE IF NOT EXISTS support_tickets (
        id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, topic TEXT, message TEXT NOT NULL, page TEXT,
        transcript JSONB, ip_hash TEXT, status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ)`);
      await sql().query(`CREATE TABLE IF NOT EXISTS help_votes (article TEXT NOT NULL, yes INTEGER NOT NULL DEFAULT 0, no INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (article))`);
      await sql().query('ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS account_id TEXT');
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export function ticketRef() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(6);
  return 'SQ-T-' + Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
}

export function ipHash(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return crypto.createHash('sha256').update(ip + (process.env.SESSION_SECRET || '')).digest('hex').slice(0, 24);
}

// Returns { reference, emailed } or throws with a customer-safe message.
export async function createTicket({ email, name, topic, message, page, transcript, ip, accountId, accountLine }) {
  await ensureSupportSchema();
  email = String(email || '').trim().toLowerCase().slice(0, 200);
  message = String(message || '').trim().slice(0, 5000);
  name = String(name || '').trim().slice(0, 120);
  topic = TOPICS.includes(topic) ? topic : 'Other';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { const e = new Error('Enter the email address where you want the reply.'); e.status = 400; throw e; }
  if (message.length < 5) { const e = new Error('Tell us what you need help with.'); e.status = 400; throw e; }
  const recent = await sql().query("SELECT count(*)::int AS n FROM support_tickets WHERE (ip_hash = $1 OR email = $2) AND created_at > now() - interval '1 hour'", [ip || '-', email]);
  if (recent[0].n >= 5) { const e = new Error('You have sent several requests in the last hour. We have them all, and a person will reply by email.'); e.status = 429; throw e; }
  const id = ticketRef();
  const tr = Array.isArray(transcript) ? transcript.slice(-30).map((t) => ({ role: t.role === 'user' ? 'user' : 'agent', text: String(t.text || '').slice(0, 1500) })) : null;
  await sql().query('INSERT INTO support_tickets (id, email, name, topic, message, page, transcript, ip_hash, account_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, email, name || null, topic, message, String(page || '').slice(0, 300) || null, tr ? JSON.stringify(tr) : null, ip || null, accountId || null]);
  const convo = tr && tr.length ? `\n\nChat with Ace before this request:\n${tr.map((t) => `${t.role === 'user' ? 'Customer' : 'Ace'}: ${t.text}`).join('\n')}` : '';
  const sent = { team: false, customer: false };
  for (const to of TEAM) {
    try { await sendEmail({ to, subject: `[${id}] ${topic}: ${message.slice(0, 60)}`, replyTo: email, text: `From: ${name || '(no name)'} <${email}>\nTopic: ${topic}\nPage: ${page || '(none)'}${accountLine ? `\nAccount: ${accountLine}` : ''}\n\n${message}${convo}\n\nReply to the customer at ${email} and keep ${id} in the subject.` }); sent.team = true; }
    catch (e) { console.error('[ticket team email]', to, e.message); }
  }
  try {
    await sendEmail({ to: email, replyTo: 'info@squadron.tel', subject: `We have your request (${id})`, text: `Hi${name ? ' ' + name : ''},\n\nSquadron received your request, and a person will reply to this address. Your reference is ${id}; keep it in the subject if you write again.\n\nWhat you sent:\n${message}\n\nMost answers are also in the Help Center: https://www.squadron.tel/help\n\nSquadron Support` });
    sent.customer = true;
  } catch (e) { console.error('[ticket customer email]', e.message); }
  return { reference: id, emailed: sent };
}

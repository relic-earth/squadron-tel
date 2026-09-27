// api/_lib/billing.js — Mercury wire billing. Squadron issues an invoice with
// a unique reference, the customer wires it to the Squadron account at
// Mercury, and a reconciler reads incoming transactions (read-only token) and
// marks the invoice paid when the amount matches and the reference appears.

import { sql } from './db.js';
import { ensureAuthSchema } from './auth.js';
import { newId } from './db.js';

const API = 'https://api.mercury.com/api/v1';

// Plan prices. Every item is paid before it is used. Extra minutes are sold
// in prepaid blocks of 100 at $0.25 a minute.
export const PRICES = {
  basic: { kind: 'plan', label: 'Basic plan, 30 days (250 voice minutes, and web chat)', cents: 3900 },
  pro: { kind: 'plan', label: 'Pro plan, 30 days (650 voice minutes, and web chat)', cents: 7900 },
  center: { kind: 'plan', label: 'Command Center plan, 30 days (2,000 voice minutes, and web chat)', cents: 19900 },
  battalion: { kind: 'plan', label: 'Battalion plan, 30 days (10,000 voice minutes, and web chat)', cents: 99900 },
  credit100: { kind: 'pack', label: '$100 Battalion overage credit (minutes beyond 10,000 at our cost plus 1 cent a minute)', cents: 10000, minutes: 0, credit: true },
  minutes100: { kind: 'pack', label: '100 extra voice minutes for the current period', cents: 2500, minutes: 100 },
};

export const BENEFICIARY = {
  name: process.env.MERCURY_BENEFICIARY_NAME || 'Island Global Company',
  address: process.env.MERCURY_BENEFICIARY_ADDRESS || '548 Market St PMB 35309, San Francisco, CA 94104',
  bank: 'Column N.A. (via Mercury)',
};

export async function ensureBillingSchema() {
  await ensureAuthSchema();
  await sql().query(`CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    item TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    reference TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    mercury_tx_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ,
    period_end TIMESTAMPTZ
  )`);
  await sql().query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS paid_through TIMESTAMPTZ');
  await sql().query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS notices JSONB NOT NULL DEFAULT \'{}\'::jsonb');
  await sql().query('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ');
  await sql().query("UPDATE invoices SET period_start = paid_at WHERE kind = 'plan' AND status = 'paid' AND period_start IS NULL AND period_end IS NOT NULL");
}

function headers() {
  const key = process.env.MERCURY_API_KEY;
  if (!key) throw new Error('MERCURY_API_KEY is not configured');
  return { Authorization: `Bearer ${key}`, Accept: 'application/json' };
}

let _acct = null;
export async function receivingAccount() {
  if (_acct) return _acct;
  const id = process.env.MERCURY_ACCOUNT_ID;
  const r = await fetch(`${API}/account/${id}`, { headers: headers() });
  const text = await r.text();
  if (!r.ok) throw new Error(`Mercury account lookup failed (${r.status}): ${text.slice(0, 200)}`);
  const a = JSON.parse(text);
  _acct = { routingNumber: a.routingNumber, accountNumber: a.accountNumber, name: a.name || a.nickname || 'Squadron' };
  return _acct;
}

export function newReference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8); crypto.getRandomValues(bytes);
  return 'SQ-' + [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

export async function wireInstructions(invoice) {
  const acct = await receivingAccount();
  return {
    reference: invoice.reference,
    amount: invoice.amount_cents / 100,
    bank: BENEFICIARY.bank,
    routingNumber: acct.routingNumber,
    accountNumber: acct.accountNumber,
    beneficiaryName: BENEFICIARY.name,
    beneficiaryAddress: BENEFICIARY.address,
    memo: `${invoice.reference} ${invoice.label}`.slice(0, 140),
  };
}

// Reads recent incoming Mercury transactions and marks matching invoices paid.
export async function reconcile() {
  await ensureBillingSchema();
  const pending = await sql().query("SELECT * FROM invoices WHERE status = 'pending' AND created_at > now() - interval '60 days'");
  if (!pending.length) return { checked: 0, paid: [] };
  const since = new Date(Math.min(...pending.map((p) => new Date(p.created_at).getTime())) - 86400000).toISOString().slice(0, 10);
  const r = await fetch(`${API}/account/${process.env.MERCURY_ACCOUNT_ID}/transactions?limit=500&start=${since}`, { headers: headers() });
  const text = await r.text();
  if (!r.ok) throw new Error(`Mercury transactions failed (${r.status}): ${text.slice(0, 200)}`);
  const txs = (JSON.parse(text).transactions || []).filter((t) => t.amount > 0 && t.status !== 'failed' && t.status !== 'cancelled');
  const paid = [];
  for (const inv of pending) {
    const ref = inv.reference.toUpperCase();
    const hit = txs.find((t) => {
      const hay = [t.externalMemo, t.note, t.bankDescription, t.counterpartyName, JSON.stringify(t.details || {})].join(' ').toUpperCase();
      return Math.round(t.amount * 100) === inv.amount_cents && hay.includes(ref);
    });
    if (!hit) continue;
    const used = await sql().query('SELECT 1 FROM invoices WHERE mercury_tx_id = $1', [hit.id]);
    if (used.length) continue;
    await markPaid(inv, hit.id);
    paid.push(inv.id);
  }
  return { checked: pending.length, paid };
}

// A paid plan opens the next 30-day period (starting when the current one
// ends, if it is still running). A paid pack joins the period it was paid in,
// or the next plan period if none is running.
export async function markPaid(inv, txId) {
  // Only the first confirmation of an invoice counts, so a payment seen twice
  // (for example by the redirect and by the sweep) never opens two periods.
  const won = await sql().query("UPDATE invoices SET status = 'paid', paid_at = now(), mercury_tx_id = $2 WHERE id = $1 AND status = 'pending' RETURNING id", [inv.id, txId]);
  if (!won.length) return false;
  if (inv.kind === 'plan') {
    const acc = (await sql().query('SELECT paid_through FROM accounts WHERE id = $1', [inv.account_id]))[0];
    const start = acc && acc.paid_through && new Date(acc.paid_through) > new Date() ? new Date(acc.paid_through) : new Date();
    const end = new Date(start.getTime() + 30 * 86400000);
    await sql().query('UPDATE invoices SET period_start = $2, period_end = $3 WHERE id = $1', [inv.id, start.toISOString(), end.toISOString()]);
    await sql().query('UPDATE accounts SET plan = $2, paid_through = $3 WHERE id = $1', [inv.account_id, inv.item, end.toISOString()]);
    await sql().query("UPDATE invoices SET period_start = $2, period_end = $3 WHERE account_id = $1 AND kind = 'pack' AND status = 'paid' AND period_start IS NULL", [inv.account_id, start.toISOString(), end.toISOString()]);
    try { const { afterPlanPaid } = await import('./care.js'); await afterPlanPaid({ ...inv, mercury_tx_id: txId }); } catch (e) { console.error('[care]', e.message); }
  } else {
    const cur = await sql().query("SELECT period_start, period_end FROM invoices WHERE account_id = $1 AND kind = 'plan' AND status = 'paid' AND period_start <= now() AND period_end > now() ORDER BY period_start DESC LIMIT 1", [inv.account_id]);
    if (cur[0]) await sql().query('UPDATE invoices SET period_start = $2, period_end = $3 WHERE id = $1', [inv.id, cur[0].period_start, cur[0].period_end]);
  }
  return true;
}

// Creates a pending invoice unless one for the same item is already open.
export async function createInvoice(accountId, item) {
  const p = PRICES[item];
  if (!p) throw new Error('Unknown item');
  const open = await sql().query("SELECT * FROM invoices WHERE account_id = $1 AND item = $2 AND status = 'pending'", [accountId, item]);
  if (open.length) return { invoice: open[0], created: false };
  const rows = await sql().query('INSERT INTO invoices (id, account_id, item, kind, label, amount_cents, reference) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [newId('inv'), accountId, item, p.kind, p.label, p.cents, newReference()]);
  return { invoice: rows[0], created: true };
}

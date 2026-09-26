// /api/billing-cron — hourly. Matches incoming Mercury wires to invoices, then
// bills ahead of need so no customer ever runs past what they prepaid:
// - five days before a paid period ends, a renewal invoice is issued;
// - when a period's prepaid balance or included minutes drop below 20%, a
//   100-minute top-up invoice is issued;
// - the owner is emailed once for each of these, when the team pauses, and
//   when a payment arrives.
import { sql } from './_lib/db.js';
import { reconcile, createInvoice, wireInstructions, PRICES } from './_lib/billing.js';
import { ledgerStatus, ensureLedgerSchema } from './_lib/ledger.js';
import { noticeOnce, sendEmail, accountEmail } from './_lib/email.js';
import { renewHouse } from './_lib/house.js';

const BILLING = 'https://www.squadron.tel/billing';

function wireText(inv, w) {
  return `Amount: $${(inv.amount_cents / 100).toFixed(2)}\nReference (put this in the wire memo): ${inv.reference}\nBank: ${w.bank}\nRouting number: ${w.routingNumber}\nAccount number: ${w.accountNumber}\nBeneficiary: ${w.beneficiaryName}, ${w.beneficiaryAddress}\n\nTo pay by card instead, which switches your team on at once, open Billing: ${BILLING}`;
}

export async function runBilling() {
  const rec = await reconcile();
  await ensureLedgerSchema();
  const out = { reconciled: rec, renewals: 0, topups: 0, notices: 0 };
  out.house = await renewHouse().catch((e) => { console.error('[house renew]', e.message); return false; });
  for (const id of rec.paid) {
    const inv = (await sql().query('SELECT * FROM invoices WHERE id = $1', [id]))[0];
    const to = inv && await accountEmail(inv.account_id);
    if (to) await sendEmail({ to, subject: `Payment received: ${inv.label}`, text: `Thank you. Your wire for ${inv.label} ($${(inv.amount_cents / 100).toFixed(2)}, reference ${inv.reference}) has arrived, and it is applied to your Squadron account.\n\nBilling: ${BILLING}` }).catch((e) => console.error('[billing-cron email]', e.message));
  }
  const accounts = await sql().query("SELECT id, plan, paid_through FROM accounts WHERE paid_through IS NOT NULL AND paid_through > now() - interval '2 days'");
  for (const a of accounts) {
    const st = await ledgerStatus(a.id);
    if (!st.active) {
      const r = await noticeOnce(a.id, `expired:${new Date(a.paid_through).toISOString()}`, { subject: 'Your Squadron plan has ended, so your team is paused', text: `Your prepaid Squadron period ended, so your team has stopped answering. Pay your renewal invoice in Billing to turn it back on: ${BILLING}` }).catch(() => ({}));
      if (r.sent) out.notices++;
      continue;
    }
    const daysLeft = (new Date(st.periodEnd) - Date.now()) / 86400000;
    if (daysLeft <= 5 && PRICES[st.planKey]) {
      const { invoice, created } = await createInvoice(a.id, st.planKey);
      if (created) out.renewals++;
      const w = await wireInstructions(invoice);
      const r = await noticeOnce(a.id, `renew:${new Date(st.periodEnd).toISOString()}`, { subject: `Your Squadron renewal invoice (${invoice.reference})`, text: `Your ${st.plan.name} period ends on ${new Date(st.periodEnd).toDateString()}. Squadron is prepaid, so please wire the renewal before then to keep your team answering without a pause.\n\n${wireText(invoice, w)}` }).catch(() => ({}));
      if (r.sent) out.notices++;
    }
    const lowBudget = st.remainingCents < st.budgetCents * 0.2;
    const lowMinutes = !st.metered && st.minutesRemaining < st.minutesIncluded * 0.2;
    if (lowBudget || lowMinutes) {
      const { invoice, created } = await createInvoice(a.id, st.metered ? 'credit100' : 'minutes100');
      if (created) out.topups++;
      const w = await wireInstructions(invoice);
      const r = await noticeOnce(a.id, `low:${new Date(st.periodStart).toISOString()}`, { subject: 'Your Squadron balance is running low', text: `Your team has used most of this period's prepaid ${lowMinutes ? 'voice minutes' : 'balance'}. Squadron never bills you after the fact, so your team pauses when the prepaid amount is used. To keep it answering, wire this ${st.metered ? '$100 overage credit' : '100-minute top-up'}.\n\n${wireText(invoice, w)}` }).catch(() => ({}));
      if (r.sent) out.notices++;
    }
    if (st.remainingCents < 3 || (!st.metered && st.minutesRemaining <= 0)) {
      const r = await noticeOnce(a.id, `paused:${new Date(st.periodStart).toISOString()}:${st.prepaidCents}`, { subject: 'Your Squadron team is paused', text: `Your team has used everything prepaid for this period${st.minutesRemaining <= 0 ? ' (all included voice minutes)' : ''}, so it has paused. A top-up invoice is waiting in Billing: ${BILLING}` }).catch(() => ({}));
      if (r.sent) out.notices++;
    }
  }
  return out;
}

export default async function handler(req, res) {
  const want = process.env.CRON_SECRET;
  if (!want || req.headers.authorization !== `Bearer ${want}`) return res.status(401).json({ error: 'unauthorized' });
  try { return res.status(200).json(await runBilling()); }
  catch (e) { console.error('[billing-cron]', e); return res.status(500).json({ error: e.message }); }
}

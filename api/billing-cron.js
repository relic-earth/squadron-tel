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
import { renewHouse, HOUSE_EMAIL } from './_lib/house.js';
import { careTick } from './_lib/care.js';
import { recordSpend } from './_lib/ledger.js';

// A phone number's monthly line rental, charged once per paid period from the
// prepaid balance (Twilio's published US local price).
const NUMBER_CENTS = Number(process.env.NUMBER_CENTS || 115);

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
    const nb = inv && (await sql().query('SELECT token, status FROM businesses WHERE account_id = $1 ORDER BY created_at LIMIT 1', [inv.account_id]))[0];
    const next = nb ? (['new', 'crawled'].includes(nb.status) ? `\n\nNext step: open this link to build your Business Profile and team now: https://www.squadron.tel/start?t=${encodeURIComponent(nb.token)}` : `\n\nYour team is back on. Squadron HQ: https://www.squadron.tel/hq?t=${encodeURIComponent(nb.token)}`) : '';
    if (to) await sendEmail({ to, subject: `Payment received: ${inv.label}`, text: `Thank you. Your wire for ${inv.label} ($${(inv.amount_cents / 100).toFixed(2)}, reference ${inv.reference}) has arrived, and it is applied to your Squadron account.${next}\n\nYour receipt: https://www.squadron.tel/api/billing?receipt=${inv.id}\nBilling: ${BILLING}` }).catch((e) => console.error('[billing-cron email]', e.message));
  }
  const accounts = await sql().query("SELECT id, email, plan, paid_through FROM accounts WHERE paid_through IS NOT NULL AND paid_through > now() - interval '2 days'");
  out.care = { weekly: 0, half: 0, rate: 0, first: 0 };
  for (const a of accounts) {
    const st = await ledgerStatus(a.id);
    if (!st.active) {
      const r = await noticeOnce(a.id, `expired:${new Date(a.paid_through).toISOString()}`, { subject: 'Your Squadron plan has ended, so your team is paused', text: `Your prepaid Squadron period ended, so your team has stopped answering. Pay your renewal invoice in Billing to turn it back on: ${BILLING}` }).catch(() => ({}));
      if (r.sent) out.notices++;
      continue;
    }
    // Line rental for each phone number, once per paid period.
    const nums = await sql().query('SELECT id FROM businesses WHERE account_id = $1 AND phone_number IS NOT NULL', [a.id]);
    for (const n of nums) {
      const ref = `num:${n.id}:${new Date(st.periodStart).toISOString().slice(0, 10)}`;
      const had = await sql().query('SELECT 1 FROM spend WHERE ref = $1', [ref]);
      if (!had.length) await recordSpend({ accountId: a.id, businessId: n.id, kind: 'number', cents: NUMBER_CENTS, ref });
    }
    if (a.email !== HOUSE_EMAIL) {
      try { const c = await careTick(a, st); for (const k in c) out.care[k] += c[k]; } catch (e) { console.error('[care tick]', a.id, e.message); }
    }
    const daysLeft = (new Date(st.periodEnd) - Date.now()) / 86400000;
    // The next period may already be paid (renewals start when this one ends).
    const nextPaid = (await sql().query("SELECT 1 FROM invoices WHERE account_id = $1 AND kind = 'plan' AND status = 'paid' AND period_start >= $2 LIMIT 1", [a.id, st.periodEnd])).length > 0;
    if (daysLeft <= 5 && PRICES[st.planKey] && !nextPaid && a.email !== HOUSE_EMAIL) {
      const { invoice, created } = await createInvoice(a.id, st.planKey);
      if (created) out.renewals++;
      const w = await wireInstructions(invoice);
      const r = await noticeOnce(a.id, `renew:${new Date(st.periodEnd).toISOString()}`, { subject: `Your Squadron renewal invoice (${invoice.reference})`, text: `Your ${st.plan.name} period ends on ${new Date(st.periodEnd).toDateString()}. Squadron is prepaid, so please wire the renewal before then to keep your team answering without a pause.\n\n${wireText(invoice, w)}` }).catch(() => ({}));
      if (r.sent) out.notices++;
      if (daysLeft <= 1.2 && invoice.status === 'pending') {
        const r1 = await noticeOnce(a.id, `renew1:${new Date(st.periodEnd).toISOString()}`, { subject: `Reminder: your Squadron period ends tomorrow (${invoice.reference})`, text: `Your ${st.plan.name} period ends on ${new Date(st.periodEnd).toDateString()}, and the renewal invoice is not paid yet. If it stays unpaid, your team pauses then, and nothing is charged. Paying by card in Billing takes a minute and keeps the team answering without a gap.

${wireText(invoice, w)}` }).catch(() => ({}));
        if (r1.sent) out.notices++;
      }
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
      const onlyVoice = st.remainingCents >= 3;
      const r = await noticeOnce(a.id, `paused:${new Date(st.periodStart).toISOString()}:${st.prepaidCents}`, onlyVoice
        ? { subject: 'Your Squadron voice minutes are used for this period', text: `Your team has used all of this period's included voice minutes, so phone and voice answering have stopped. Chat keeps answering. A 100-minute top-up ($25) is waiting in Billing, and paying it by card switches voice back on at once: ${BILLING}` }
        : { subject: 'Your Squadron team is paused', text: `Your team has used everything prepaid for this period, so it has paused, and nothing more is charged. A top-up invoice is waiting in Billing, and paying it by card switches the team back on at once: ${BILLING}` }).catch(() => ({}));
      if (r.sent) out.notices++;
    }
  }
  // Phone numbers on lapsed accounts: held for 30 days, a warning five days
  // before release, then released so no line rental runs unpaid.
  const lapsed = await sql().query("SELECT b.id, b.phone_number, a.id AS account_id, a.email, a.paid_through FROM businesses b JOIN accounts a ON a.id = b.account_id WHERE b.phone_number IS NOT NULL AND a.email <> $1 AND (a.paid_through IS NULL OR a.paid_through < now())", [HOUSE_EMAIL]);
  out.numbers = { held: 0, released: 0 };
  for (const b of lapsed) {
    const since = b.paid_through ? new Date(b.paid_through) : new Date();
    const days = (Date.now() - since.getTime()) / 86400000;
    const until = new Date(since.getTime() + 30 * 86400000).toDateString();
    if (days >= 30) {
      const { releaseNumbers } = await import('./_lib/numbers.js');
      const n = await releaseNumbers([b.id]).catch(() => 0);
      const ch = await sql().query('SELECT channels FROM businesses WHERE id = $1', [b.id]);
      const channels = { ...((ch[0] && ch[0].channels) || {}), phone: { enabled: false, changed_at: new Date().toISOString(), released: b.phone_number } };
      await sql().query('UPDATE businesses SET phone_number = NULL, channels = $2 WHERE id = $1', [b.id, JSON.stringify(channels)]);
      await noticeOnce(b.account_id, `numrel:${b.phone_number}`, { subject: `Your Squadron number ${b.phone_number} is released`, text: `Your Squadron plan ended more than 30 days ago, so the phone number ${b.phone_number} has been released. Your profile, team and conversations are still in your account, and you can pick a new number on the Deploy screen whenever you start a new period: ${BILLING}` }).catch(() => ({}));
      if (n) out.numbers.released++;
    } else if (days >= 25) {
      await noticeOnce(b.account_id, `numwarn:${b.phone_number}:${since.toISOString()}`, { subject: `Your Squadron number ${b.phone_number} is released on ${until}`, text: `Your Squadron plan has ended, and we have been holding your phone number ${b.phone_number} for you. It is released on ${until} unless a new period is paid before then. Pay in Billing to keep it: ${BILLING}` }).catch(() => ({}));
    } else {
      const r = await noticeOnce(b.account_id, `numhold:${b.phone_number}:${since.toISOString()}`, { subject: `Your Squadron number ${b.phone_number} is held for 30 days`, text: `Your Squadron period has ended, so your team has stopped answering ${b.phone_number}. We hold the number for you until ${until}. Pay for a new period in Billing before then, and the same number starts answering again: ${BILLING}` }).catch(() => ({}));
      if (r.sent) out.numbers.held++;
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

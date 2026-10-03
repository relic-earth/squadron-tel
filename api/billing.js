// /api/billing — the signed-in owner's plan, prepaid balance, invoices and
// wire instructions. POST { action: 'invoice', item } creates an invoice;
// { action: 'check' } asks Mercury whether any pending wire has arrived.
// { action: 'card', item, returnTo } starts a Stripe Checkout for the item and
// returns its URL; { action: 'confirm', session } confirms a finished card
// payment by reading the session back from Stripe.
// Top-ups can only be bought for a running paid period.
import { accepted, REFUSAL, recordAcceptance } from './_lib/terms.js';
import { sql, readJson, bad } from './_lib/db.js';
import { currentAccount, PLANS } from './_lib/auth.js';
import { ensureBillingSchema, PRICES, wireInstructions, reconcile, createInvoice, BENEFICIARY } from './_lib/billing.js';
import { ledgerStatus } from './_lib/ledger.js';
import { sendEmail } from './_lib/email.js';
import { startCheckout, confirmSession, stripeEnabled } from './_lib/stripe.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await ensureBillingSchema();
    const acc = await currentAccount(req);
    if (!acc) return bad(res, 401, 'Sign in first.');
    if (req.method === 'GET' && req.query && req.query.receipt) {
      // A printable receipt from Squadron for one paid invoice.
      const inv = (await sql().query("SELECT * FROM invoices WHERE id = $1 AND account_id = $2 AND status = 'paid'", [String(req.query.receipt), acc.id]))[0];
      if (!inv) return bad(res, 404, 'No paid invoice with that id on this account.');
      const e = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const tx = String(inv.mercury_tx_id || '');
      const method = tx.startsWith('stripe:') ? 'Card (Stripe)' : tx.startsWith('comp:') ? 'Complimentary, paid by Squadron' : 'Bank transfer (Mercury)';
      const d = (x) => x ? new Date(x).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt ${e(inv.reference)} — Squadron</title><style>body{font-family:Inter,Arial,sans-serif;color:#0B1E45;background:#F5F7FA;margin:0;padding:32px 16px}main{max-width:720px;margin:0 auto;background:#fff;border:1px solid #DCE4EF;border-radius:14px;padding:36px}h1{font-size:40px;margin:0 0 6px}p{font-size:18px;line-height:1.5;color:#3D4C68;margin:4px 0}table{width:100%;border-collapse:collapse;margin:24px 0;font-size:18px}td{padding:12px 0;border-bottom:1px solid #DCE4EF}td:last-child{text-align:right;font-weight:700;color:#0B1E45}.paid{display:inline-block;background:#E7F6EC;color:#127A3A;font-weight:800;padding:6px 12px;border-radius:999px;font-size:16px}button{font:inherit;font-size:17px;font-weight:700;padding:14px 24px;border-radius:999px;border:none;background:#0B1E45;color:#fff;cursor:pointer}@media print{button{display:none}body{background:#fff}main{border:none}}</style></head><body><main>
        <h1>Receipt</h1><p><span class="paid">Paid</span></p>
        <p style="margin-top:18px"><b style="color:#0B1E45">Island Global Co DBA Squadron</b><br>${e(BENEFICIARY.address)}<br>squadron.tel · info@squadron.tel</p>
        <p style="margin-top:14px">Billed to ${e(acc.email)}</p>
        <table><tr><td>Reference</td><td>${e(inv.reference)}</td></tr><tr><td>Date paid</td><td>${d(inv.paid_at)}</td></tr><tr><td>Item</td><td>${e(inv.label)}</td></tr>${inv.period_start ? `<tr><td>Service period</td><td>${d(inv.period_start)} to ${d(inv.period_end)}</td></tr>` : ''}<tr><td>Payment method</td><td>${method}</td></tr><tr><td>Amount paid</td><td>$${(inv.amount_cents / 100).toFixed(2)} USD</td></tr></table>
        <p>Squadron is prepaid. This payment covers the item above, and nothing renews by itself.</p>
        <p style="margin-top:22px"><button onclick="print()">Print or save as PDF</button></p></main></body></html>`);
    }
    const body = req.method === 'POST' ? readJson(req) : {};
    let notice = null;
    let st = await ledgerStatus(acc.id);
    if ((body.action === 'invoice' || body.action === 'card') && !accepted(body, { wire: body.action === 'invoice' })) return bad(res, 400, REFUSAL);
    if (body.action === 'invoice' || body.action === 'card') await recordAcceptance(req, { accountId: acc.id, email: acc.email, kind: 'checkout:' + body.action, body });
    if (body.action === 'invoice') {
      const p = PRICES[body.item];
      if (!p) return bad(res, 400, 'Unknown item');
      if (p.kind === 'pack' && !st.active) return bad(res, 400, 'Extra minutes are added to a running paid plan. Choose and pay for a plan first.');
      if (p.credit && !st.metered) return bad(res, 400, 'Overage credit is part of the Battalion plan. Other plans add minutes in blocks of 100.');
      const { invoice, created } = await createInvoice(acc.id, body.item);
      if (created) {
        const w = await wireInstructions(invoice);
        await sendEmail({ to: acc.email, subject: `Your Squadron invoice ${invoice.reference} ($${(invoice.amount_cents / 100).toFixed(2)})`, text: `Thank you for choosing Squadron. Squadron is prepaid, so your team starts as soon as this payment lands.\n\n${invoice.label}\nAmount: $${(invoice.amount_cents / 100).toFixed(2)}\nReference (put this in the wire or ACH memo): ${invoice.reference}\nBank: ${w.bank}\nRouting number: ${w.routingNumber}\nAccount number: ${w.accountNumber}\nBeneficiary: ${w.beneficiaryName}, ${w.beneficiaryAddress}\n\nWe email you as soon as the payment arrives. To pay by card instead, which switches your team on at once, open Billing: https://www.squadron.tel/billing` }).catch((e) => console.error('[billing email]', e.message));
      }
    } else if (body.action === 'card') {
      const p = PRICES[body.item];
      if (!p) return bad(res, 400, 'Unknown item');
      if (p.kind === 'pack' && !st.active) return bad(res, 400, 'Extra minutes are added to a running paid plan. Choose and pay for a plan first.');
      if (p.credit && !st.metered) return bad(res, 400, 'Overage credit is part of the Battalion plan. Other plans add minutes in blocks of 100.');
      const out = await startCheckout(acc, body.item, { returnTo: String(body.returnTo || '/billing') });
      return res.status(200).json({ url: out.url });
    } else if (body.action === 'confirm') {
      const r = await confirmSession(String(body.session || ''));
      if (r.paid && r.invoice && r.invoice.account_id === acc.id) {
        notice = `Payment received: ${r.invoice.label}. Your team is switched on.`;
        if (!r.already) await sendEmail({ to: acc.email, subject: `Payment received: ${r.invoice.label}`, text: `Thank you. Your card payment for ${r.invoice.label} ($${(r.invoice.amount_cents / 100).toFixed(2)}, reference ${r.invoice.reference}) is received, and it is applied to your Squadron account.\n\nYour receipt: https://www.squadron.tel/api/billing?receipt=${r.invoice.id}\nBilling: https://www.squadron.tel/billing` }).catch((e) => console.error('[billing email]', e.message));
      } else notice = 'The card payment is not complete yet. If you finished it, wait a moment and reload this page.';
      st = await ledgerStatus(acc.id);
    } else if (body.action === 'check') {
      const r = await reconcile();
      notice = r.paid.length ? `Payment received for ${r.paid.length} invoice${r.paid.length > 1 ? 's' : ''}.` : 'No matching wire has arrived yet. Wires usually land the same business day.';
      st = await ledgerStatus(acc.id);
    } else if (body.action === 'cancel' && body.id) {
      await sql().query("UPDATE invoices SET status = 'cancelled' WHERE id = $1 AND account_id = $2 AND status = 'pending'", [body.id, acc.id]);
    }
    const invoices = await sql().query('SELECT id, item, kind, label, amount_cents, reference, status, created_at, paid_at, period_start, period_end FROM invoices WHERE account_id = $1 AND status <> $2 ORDER BY created_at DESC LIMIT 50', [acc.id, 'cancelled']);
    const out = [];
    for (const inv of invoices) out.push(inv.status === 'pending' ? { ...inv, wire: await wireInstructions(inv) } : inv);
    return res.status(200).json({
      account: { email: acc.email },
      status: {
        active: st.active, plan: st.planKey, planInfo: st.plan, periodStart: st.periodStart, periodEnd: st.periodEnd,
        minutesIncluded: st.minutesIncluded, minutesUsed: st.minutesUsed, minutesRemaining: st.minutesRemaining,
        prepaidCents: st.prepaidCents, metered: st.metered, overageMinutes: st.overageMinutes, creditCents: st.creditCents, creditUsedCents: st.creditUsedCents, balancePercent: st.budgetCents ? Math.max(0, Math.round((st.remainingCents / st.budgetCents) * 100)) : 0,
      },
      plans: PLANS, prices: PRICES, invoices: out, notice, cards: stripeEnabled(),
    });
  } catch (e) {
    console.error('[billing]', e);
    return bad(res, 500, e.message);
  }
}

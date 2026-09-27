// api/_lib/care.js — proactive care for paying customers. Every email here is
// sent at most once per key (accounts.notices), so a retry or a second cron
// run never repeats it. None of it calls an AI model, so none of it spends
// provider credit.
//
// - welcome: after the first plan payment, with the three things to do first
// - first answer: when the team first answers a real (non-test) customer
// - weekly summary: conversations, unanswered questions, prepaid balance left
// - balance heads-up: at half of the prepaid balance or minutes (billing-cron
//   sends the low-balance notice at 20% and the pause notice at zero)
// - satisfaction check: one question after setup and after the first week
import { sql } from './db.js';
import { noticeOnce, sendEmail } from './email.js';
import { track } from './events.js';
import { weeklyOffToken, ensureLoginsSchema } from './auth.js';

const SITE = 'https://www.squadron.tel';
export const OWNER_TO = (process.env.SUPPORT_TO || 'info@squadron.tel,info@island.contact').split(',').map((s) => s.trim()).filter(Boolean);

async function firstBusiness(accountId) {
  const r = await sql().query('SELECT id, token, input_value, channels, settings, phone_number FROM businesses WHERE account_id = $1 ORDER BY created_at LIMIT 1', [accountId]);
  return r[0] || null;
}
const link = (path, b) => `${SITE}${path}${b ? `?t=${encodeURIComponent(b.token)}` : ''}`;

// Called once a plan invoice is marked paid.
export async function afterPlanPaid(inv) {
  try {
    const n = await sql().query("SELECT COUNT(*)::int AS n FROM invoices WHERE account_id = $1 AND kind = 'plan' AND status = 'paid'", [inv.account_id]);
    await track('plan_paid', { accountId: inv.account_id, meta: { item: inv.item, via: String(inv.mercury_tx_id || '').startsWith('stripe:') ? 'card' : String(inv.mercury_tx_id || '').startsWith('comp:') ? 'comp' : 'wire' } });
    if (n[0].n !== 1) return;
    const b = await firstBusiness(inv.account_id);
    await noticeOnce(inv.account_id, 'welcome', {
      subject: 'Welcome to Squadron: three things to do first',
      text: `Thank you for choosing Squadron. Your ${inv.label.split(',')[0]} is paid, and your team is being built from your website now.\n\nThree things to do first:\n\n1. Check your Business Profile. Every fact shows where it came from, and your team answers only from it. Correct anything that is wrong and add what your site does not say: ${b ? link('/start', b) : SITE + '/account'}\n\n2. Test your team. Ask the questions your customers ask, by chat and by voice. Anything it cannot answer goes to your knowledge queue: ${b ? link('/test', b) : SITE + '/account'}\n\n3. Turn chat on. Paste one line into your website, and your team starts answering: ${b ? link('/deploy', b) : SITE + '/account'}\n\nWhat to expect: your plan runs for 30 days and never renews by itself. Five days before it ends we email a renewal invoice, and you decide whether to pay it. If the prepaid amount runs out first, the team pauses, and we email you before that happens. Nothing is ever billed after the fact.\n\nIf anything is unclear, reply to this email or ask Ace in the chat on any Squadron page. A person reads every reply.`,
    });
  } catch (e) { console.error('[care welcome]', e.message); }
}

// Called when a live (non-test) conversation gets an answer, and from the
// hourly cron as a backstop for phone calls.
export async function firstRealAnswer(businessId) {
  try {
    const r = await sql().query("SELECT b.account_id, b.token, b.input_value, c.channel, c.summary, c.started_at FROM businesses b JOIN conversations c ON c.business_id = b.id WHERE b.id = $1 AND c.test = false ORDER BY c.started_at LIMIT 1", [businessId]);
    const row = r[0];
    if (!row || !row.account_id) return;
    const res = await noticeOnce(row.account_id, `first:${businessId}`, {
      subject: 'Your Squadron team just answered its first customer',
      text: `Your team answered its first real customer on ${row.channel === 'phone' ? 'the phone' : 'your website chat'}${row.summary ? `. The customer asked: "${row.summary}"` : ''}.\n\nRead the whole conversation, with the source behind every answer, in Squadron HQ: ${SITE}/hq?t=${encodeURIComponent(row.token)}\n\nWhen your team cannot answer something, the question lands in your knowledge queue in HQ. Answer it once, and the team answers it from then on.`,
    });
    if (res && res.sent) await track('first_answer', { accountId: row.account_id, businessId });
  } catch (e) { console.error('[care first]', e.message); }
}

function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

// Runs from the hourly billing cron for each account with a running period.
export async function careTick(a, st) {
  const out = { weekly: 0, half: 0, rate: 0, first: 0 };
  const now = new Date();
  const biz = await sql().query('SELECT id, token, input_value FROM businesses WHERE account_id = $1 ORDER BY created_at', [a.id]);
  // Backstop for the first-answer email (phone calls end outside /api/converse).
  for (const b of biz) {
    const done = await sql().query('SELECT notices ? $2 AS done FROM accounts WHERE id = $1', [a.id, `first:${b.id}`]);
    if (done[0] && !done[0].done) { await firstRealAnswer(b.id); out.first++; }
  }
  // Weekly summary: Mondays from 14:00 UTC (morning in the US), once a week,
  // and only after the account has had a full week.
  const ageDays = (now - new Date(st.periodStart)) / 86400000;
  await ensureLoginsSchema();
  const pref = await sql().query('SELECT prefs FROM accounts WHERE id = $1', [a.id]);
  const weeklyOn = !(pref[0] && pref[0].prefs && pref[0].prefs.weekly === false);
  if (weeklyOn && now.getUTCDay() === 1 && now.getUTCHours() >= 14 && biz.length) {
    const firstPaid = await sql().query("SELECT MIN(paid_at) AS t FROM invoices WHERE account_id = $1 AND kind = 'plan' AND status = 'paid'", [a.id]);
    if (firstPaid[0].t && (now - new Date(firstPaid[0].t)) / 86400000 >= 6) {
      const ids = biz.map((b) => b.id);
      const c = await sql().query("SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE escalated)::int AS esc, COUNT(*) FILTER (WHERE channel = 'phone')::int AS phone FROM conversations WHERE business_id = ANY($1) AND test = false AND started_at > now() - interval '7 days'", [ids]);
      const g = await sql().query("SELECT question FROM knowledge_gaps WHERE business_id = ANY($1) AND status = 'open' ORDER BY created_at DESC LIMIT 5", [ids]);
      const gn = await sql().query("SELECT COUNT(*)::int AS n FROM knowledge_gaps WHERE business_id = ANY($1) AND status = 'open'", [ids]);
      const pct = st.budgetCents ? Math.max(0, Math.round((st.remainingCents / st.budgetCents) * 100)) : 0;
      const end = new Date(st.periodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      const r = await noticeOnce(a.id, `weekly:${isoWeek(now)}`, {
        subject: `Your Squadron week: ${c[0].n} conversation${c[0].n === 1 ? '' : 's'}, ${gn[0].n} question${gn[0].n === 1 ? '' : 's'} to answer`,
        text: `Here is your team's last seven days.\n\nConversations with real customers: ${c[0].n}${c[0].phone ? ` (${c[0].phone} by phone)` : ''}.\nCustomers who asked for a person: ${c[0].esc}.\nQuestions your team could not answer, waiting for you: ${gn[0].n}.${g.length ? `\n${g.map((x) => `- ${x.question}`).join('\n')}` : ''}\n\nPrepaid balance left: ${pct}%${st.metered ? '' : `, and ${st.minutesRemaining.toLocaleString()} of ${st.minutesIncluded.toLocaleString()} voice minutes`}. Your ${st.plan.name} period runs through ${end}, and it does not renew by itself.\n\n${gn[0].n ? 'Answer the waiting questions once in Squadron HQ, and your team answers them from then on' : 'Squadron HQ has every conversation and its sources'}: ${SITE}/hq?t=${encodeURIComponent(biz[0].token)}\n\nTo stop these weekly emails, open this link, and you can switch them back on from your account page: ${SITE}/api/auth?weekly_off=${weeklyOffToken(a.id)}`,
      }).catch(() => ({}));
      if (r && r.sent) out.weekly++;
    }
  }
  // Heads-up at half the prepaid balance or minutes (no invoice yet).
  const halfBudget = st.budgetCents && st.remainingCents < st.budgetCents * 0.5;
  const halfMinutes = !st.metered && st.minutesIncluded && st.minutesRemaining < st.minutesIncluded * 0.5;
  if ((halfBudget || halfMinutes) && ageDays < 30) {
    const r = await noticeOnce(a.id, `half:${new Date(st.periodStart).toISOString()}`, {
      subject: 'Your Squadron team has used half of this period',
      text: `A heads-up, with nothing to pay today: your team has used half of this period's prepaid ${halfMinutes ? `voice minutes (${st.minutesRemaining.toLocaleString()} of ${st.minutesIncluded.toLocaleString()} left)` : 'balance'}, and the period runs through ${new Date(st.periodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.\n\nWhen 20% is left, we email a ${st.metered ? '$100 overage credit' : '100-minute top-up ($25)'} invoice. If nothing more is paid, your team pauses when the prepaid amount is used; it is never billed after the fact. Your usage is in Billing: ${SITE}/billing`,
    }).catch(() => ({}));
    if (r && r.sent) out.half++;
  }
  // Satisfaction check emails: after setup (chat turned on, or two days after
  // the first payment) and after the first week.
  const answered = await sql().query("SELECT stage FROM satisfaction WHERE account_id = $1", [a.id]).catch(() => []);
  const has = new Set(answered.map((x) => x.stage));
  const firstPaid = await sql().query("SELECT MIN(paid_at) AS t FROM invoices WHERE account_id = $1 AND kind = 'plan' AND status = 'paid'", [a.id]);
  const paidDays = firstPaid[0].t ? (now - new Date(firstPaid[0].t)) / 86400000 : 0;
  const b0 = biz[0];
  if (b0 && !has.has('setup') && paidDays >= 2) {
    const r = await noticeOnce(a.id, 'rate:setup', { subject: 'One question about your Squadron setup', text: rateText('setup', b0) }).catch(() => ({}));
    if (r && r.sent) out.rate++;
  }
  if (b0 && !has.has('week1') && paidDays >= 7) {
    const r = await noticeOnce(a.id, 'rate:week1', { subject: 'One question about your first week with Squadron', text: rateText('week1', b0) }).catch(() => ({}));
    if (r && r.sent) out.rate++;
  }
  return out;
}

function rateText(stage, b) {
  const q = stage === 'setup' ? 'How easy was it to set up your Squadron team?' : 'How satisfied are you with your Squadron team after its first week?';
  const links = [1, 2, 3, 4, 5].map((n) => `${n}: ${SITE}/hq?t=${encodeURIComponent(b.token)}&rate=${stage}&score=${n}`).join('\n');
  return `${q}\n\nPick a number from 1 (not at all) to 5 (completely). One click records it, and you can add a comment on the page that opens.\n\n${links}\n\nA person at Squadron reads every answer below 5 and gets back to you.`;
}

// Stores a satisfaction answer and emails the team at once when it is below 5.
export async function saveRating({ accountId, email, businessId, stage, score, comment }) {
  await ensureCareSchema();
  const s = Math.max(1, Math.min(5, Math.round(Number(score) || 0)));
  const st = stage === 'week1' ? 'week1' : 'setup';
  const c = String(comment || '').trim().slice(0, 2000) || null;
  const r = await sql().query(`INSERT INTO satisfaction (account_id, business_id, stage, score, comment) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (account_id, stage) DO UPDATE SET score = EXCLUDED.score, comment = COALESCE(EXCLUDED.comment, satisfaction.comment), business_id = COALESCE(EXCLUDED.business_id, satisfaction.business_id), updated_at = now()
    RETURNING id, (xmax = 0) AS inserted`, [accountId, businessId || null, st, s, c]);
  if (s < 5) {
    const ref = `SQ-R-${r[0].id}`;
    for (const to of OWNER_TO) {
      await sendEmail({ to, replyTo: email, subject: `[${ref}] Satisfaction ${s}/5 (${st === 'setup' ? 'after setup' : 'after week one'}) from ${email}`, text: `${email} rated Squadron ${s} out of 5 ${st === 'setup' ? 'after setup' : 'after the first week'}.\n\nComment: ${c || '(none yet)'}\n\nReply to this email to reach them directly. All answers are in BOSS: ${SITE}/boss` }).catch((e) => console.error('[rating email]', e.message));
    }
  }
  await track('rating', { accountId, businessId, meta: { stage: st, score: s } });
  return { ok: true, score: s, stage: st };
}

let _ready = null;
export function ensureCareSchema() {
  if (!_ready) _ready = sql().query(`CREATE TABLE IF NOT EXISTS satisfaction (
    id BIGSERIAL PRIMARY KEY, account_id TEXT NOT NULL, business_id TEXT, stage TEXT NOT NULL,
    score INTEGER NOT NULL, comment TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, stage))`).catch((e) => { _ready = null; throw e; });
  return _ready;
}

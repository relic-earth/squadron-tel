// /api/chat.js — Ace, Squadron's own support chat on squadron.tel.
// General answers come from the Help Center (help-kb.js) by keyword match.
// For a signed-in customer, Ace also reads their own account (plan, prepaid
// balance, minutes, renewal date, invoices, channels, knowledge queue) and
// answers with their real numbers. "Talk to a person" opens a ticket with a
// reference number from inside the chat. Nothing here calls an AI model, so
// every reply is instant and costs nothing. Rule: every reply answers with
// facts and never ends in a question; a follow-up goes in followUp.
import { ARTICLES, search } from '../help-kb.js';
import { sql } from './_lib/db.js';
import { currentAccount } from './_lib/auth.js';
import { ledgerStatus } from './_lib/ledger.js';
import { createTicket, ipHash } from './_lib/tickets.js';

const AGENT = { name: 'Ace', title: 'Squadron Support' };
const GREETING = `I'm **Ace**, Squadron's AI support agent. I answer from the Squadron Help Center, and I can hand you to a person at Squadron at any time.`;
const GREETING_ACC = (email) => `I'm **Ace**, Squadron's AI support agent. You are signed in as ${email}, so I can read your plan, balance, invoices and channels and answer with your real numbers. I can also hand you to a person at Squadron at any time.`;
const STARTERS = ['How does setup work?', 'How much does it cost?', 'How do I test my team?', 'The chat button is not showing', 'Talk to a person'];
const STARTERS_ACC = ['How many minutes do I have left?', 'When does my plan renew?', 'Is my chat live?', 'Why is my team paused?', 'Talk to a person'];
const byId = Object.fromEntries(ARTICLES.map((a) => [a.id, a]));
const SITE = 'https://www.squadron.tel';

function answer(article, extra) {
  return {
    reply: `**${article.q}**\n${article.a}`,
    link: `/help#${article.id}`,
    suggestions: extra.filter((x) => x.id !== article.id).slice(0, 3).map((x) => x.q),
  };
}

// ---- conversation state (only the pending hand-off and a short transcript) ----
let _ready = null;
async function ensureAce() {
  if (!_ready) _ready = sql().query(`CREATE TABLE IF NOT EXISTS ace_state (sid TEXT PRIMARY KEY, pending TEXT, draft TEXT, transcript JSONB NOT NULL DEFAULT '[]'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`).catch((e) => { _ready = null; throw e; });
  return _ready;
}
async function loadState(sid) {
  try { await ensureAce(); const r = await sql().query('SELECT pending, draft, transcript FROM ace_state WHERE sid = $1', [sid]); return r[0] || { pending: null, draft: null, transcript: [] }; }
  catch { return { pending: null, draft: null, transcript: [] }; }
}
async function saveState(sid, st) {
  try { await sql().query(`INSERT INTO ace_state (sid, pending, draft, transcript, updated_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT (sid) DO UPDATE SET pending = EXCLUDED.pending, draft = EXCLUDED.draft, transcript = EXCLUDED.transcript, updated_at = now()`, [sid, st.pending || null, st.draft || null, JSON.stringify((st.transcript || []).slice(-30))]); }
  catch (e) { console.error('[ace state]', e.message); }
}

// ---- the signed-in customer's own account ----
const MINE = /\b(my|mine|our|ours|i|me|we|am i|do i|have i)\b/i;
const INTENTS = [
  ['minutes', /\b(minutes?|balance|credit|usage|used|left|remaining|how much.*(left|remain)|run(ning)? (out|low))\b/i],
  ['renewal', /\b(renew\w*|expire\w*|expiry|paid through|period end|next (bill|invoice|payment)|when .*(end|pay|bill|charge))\b/i],
  ['invoices', /\b(invoice\w*|reference|owe|unpaid|wire (details|instructions)|bank details|pending payment|receipt)\b/i],
  ['paused', /\b(paus\w*|not answering|stopped|offline|not responding|isn'?t working|not working|down)\b/i],
  ['chat', /\b(chat|widget|snippet|embed|install code|script tag)\b.*\b(live|on|working|showing|code|snippet|install|status)\b|\bis my chat\b|\bmy (chat|widget|snippet)\b/i],
  ['phone', /\b(phone|number|calls?|line)\b/i],
  ['queue', /\b(queue|unanswered|gaps?|could ?n.?t answer|questions? (it|they) missed)\b/i],
  ['conversations', /\b(conversations?|how many (chats|calls|customers)|traffic)\b/i],
  ['plan', /\b(plan|tier|subscription)\b/i],
  ['email', /\b(email|login|log in|sign ?in) (address|is)\b|\bwhich email\b/i],
];
// Only questions about the account's current state read the account; "can
// I", "how do I" and "what happens if" questions get the Help Center answer.
const STATE = /\b(how many|how much|when (does|do|is|will) my|is my|are my|do i have|have i|what('?s| is| are) my|why (is|isn'?t|are|did|was)|which plan|show me|status|left|remaining|my balance|my invoices?|my plan|my number|my minutes)\b/i;
const GENERIC = /^(can|could|how do|how can|what happens|will you|do you|does|should)\b/i;
function accountIntent(text) {
  if (!MINE.test(text) || !STATE.test(text) || GENERIC.test(text.trim())) return null;
  for (const [k, re] of INTENTS) if (re.test(text)) return k;
  return null;
}
const money = (c) => `$${(c / 100).toFixed(2)}`;
const day = (d) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

async function accountAnswer(acc, intent) {
  const st = await ledgerStatus(acc.id);
  const biz = await sql().query('SELECT id, token, input_value, status, phone_number, channels FROM businesses WHERE account_id = $1 ORDER BY created_at', [acc.id]);
  const pending = await sql().query("SELECT label, amount_cents, reference, created_at FROM invoices WHERE account_id = $1 AND status = 'pending' ORDER BY created_at DESC", [acc.id]);
  const pct = st.budgetCents ? Math.max(0, Math.round((st.remainingCents / st.budgetCents) * 100)) : 0;
  const hq = biz[0] ? `${SITE}/hq?t=${encodeURIComponent(biz[0].token)}` : `${SITE}/account`;
  const noPlan = `Your account has no active paid plan right now, so your team is not answering. Squadron is prepaid: choose a plan in Billing and pay by card to switch it on at once, or by wire to switch it on when the transfer lands.${pending.length ? ` You have ${pending.length} open invoice${pending.length > 1 ? 's' : ''}, the latest being ${pending[0].reference} for ${money(pending[0].amount_cents)}.` : ''}`;
  const pendingLine = pending.length ? ` You have ${pending.length} open invoice${pending.length > 1 ? 's' : ''}: ${pending.map((p) => `${p.reference} for ${money(p.amount_cents)} (${p.label.split(' (')[0]})`).join('; ')}. Pay by card in Billing to apply it at once.` : '';
  switch (intent) {
    case 'minutes':
      if (!st.active) return { reply: noPlan, link: '/billing' };
      return { reply: `You are on **${st.plan.name}**. ${st.metered ? `You have used ${st.minutesUsed.toLocaleString()} voice minutes of the 10,000 included this period${st.overageMinutes ? `, plus ${st.overageMinutes.toLocaleString()} overage minutes` : ''}.` : `You have used ${st.minutesUsed.toLocaleString()} of ${st.minutesIncluded.toLocaleString()} voice minutes, so ${st.minutesRemaining.toLocaleString()} are left this period.`} ${pct}% of this period's prepaid balance is left, which covers chat and every other cost. The period runs through ${day(st.periodEnd)}. When 20% is left we email a top-up invoice, and if nothing more is paid the team pauses; it is never billed after the fact.${pendingLine}`, link: '/billing' };
    case 'renewal':
      if (!st.active) return { reply: noPlan, link: '/billing' };
      return { reply: `Your **${st.plan.name}** period is paid through **${day(st.periodEnd)}**, and it does not renew by itself. Five days before that date we email a renewal invoice for ${money((await planCents(st.planKey)))}; pay it by card or wire and the next 30 days start when this period ends, so there is no gap. If you do not pay it, the team pauses on ${day(st.periodEnd)} and nothing is charged.${pendingLine}`, link: '/billing' };
    case 'invoices':
      if (!pending.length) return { reply: `You have no open invoices.${st.active ? ` Your ${st.plan.name} period is paid through ${day(st.periodEnd)}.` : ''} Every paid invoice, with its reference, is listed in Billing.`, link: '/billing' };
      return { reply: `You have ${pending.length} open invoice${pending.length > 1 ? 's' : ''}: ${pending.map((p) => `**${p.reference}**, ${money(p.amount_cents)}, ${p.label}`).join('; ')}. Pay by card in Billing to apply it at once, or wire it with the reference in the memo; the bank details are in Billing and in the invoice email. Squadron issues renewal and top-up invoices ahead of need, an unpaid invoice is never charged, and you can cancel any open invoice in Billing.`, link: '/billing' };
    case 'paused': {
      if (!st.active) return { reply: noPlan, link: '/billing' };
      if (st.remainingCents < 3) return { reply: `Your team is paused because this period's prepaid balance is used. Pay the top-up invoice in Billing and it resumes right away when paid by card.${pendingLine}`, link: '/billing' };
      const live = biz.filter((b) => b.channels && b.channels.chat && b.channels.chat.enabled);
      const voiceOut = !st.metered && st.minutesRemaining <= 0;
      if (!live.length) return { reply: `Your plan is active and has ${pct}% of its prepaid balance left, but chat is not turned on for any of your teams yet, so the widget will not answer. Turn it on in Deploy and paste the one-line snippet into your site.`, link: biz[0] ? `/deploy?t=${encodeURIComponent(biz[0].token)}` : '/account' };
      return { reply: `Your team is not paused: your ${st.plan.name} plan is active through ${day(st.periodEnd)} with ${pct}% of its prepaid balance left, and chat is on for ${live.map((b) => b.input_value).join(', ')}.${voiceOut ? ' Voice minutes are used up for this period, so calls stop until you add 100 minutes in Billing; chat keeps answering.' : ''} If the chat button does not show on your site, the snippet is missing from that page or a content blocker is hiding it; the exact snippet is on the Deploy screen.`, link: `/deploy?t=${encodeURIComponent(live[0].token)}` };
    }
    case 'chat': {
      if (!biz.length) return { reply: `You have no team yet. Start at squadron.tel/start with your website, and chat can be turned on once the team is built.`, link: '/start' };
      const lines = biz.map((b) => `${b.input_value}: chat is ${b.channels && b.channels.chat && b.channels.chat.enabled ? '**live**' : '**off**'}`);
      return { reply: `${lines.join('. ')}. The snippet for your site is \`<script src="${SITE}/widget.js" data-business="${biz[0].id}" async></script>\`, pasted once before the closing body tag.${st.active ? '' : ' Your plan is not active, so live chat will not answer until a plan is paid.'}`, link: `/deploy?t=${encodeURIComponent(biz[0].token)}` };
    }
    case 'phone': {
      const withNum = biz.filter((b) => b.phone_number);
      if (withNum.length) return { reply: `${withNum.map((b) => `${b.input_value} answers on **${b.phone_number}**`).join('. ')}. Every call starts with the AI disclosure and a recording notice, and each call's transcript and recording are in Squadron HQ.${st.active && !st.metered ? ` ${st.minutesRemaining.toLocaleString()} voice minutes are left this period.` : ''}`, link: hq };
      return { reply: `None of your teams has a phone number yet. With an active plan, get one on the Deploy screen under Phone: pick a local number and your team answers it at once. The number's monthly line rental comes out of your prepaid balance, and it is shown before you confirm.`, link: biz[0] ? `/deploy?t=${encodeURIComponent(biz[0].token)}` : '/account' };
    }
    case 'queue': {
      if (!biz.length) return null;
      const g = await sql().query("SELECT COUNT(*)::int AS n FROM knowledge_gaps WHERE business_id = ANY($1) AND status = 'open'", [biz.map((b) => b.id)]);
      return { reply: `${g[0].n} question${g[0].n === 1 ? ' is' : 's are'} waiting in your knowledge queue. Open Squadron HQ, choose Knowledge queue, write the answer once and approve it, and your team answers it from then on.`, link: hq };
    }
    case 'conversations': {
      if (!biz.length) return null;
      const since = st.periodStart || new Date(Date.now() - 30 * 86400000);
      const c = await sql().query('SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE escalated)::int AS esc FROM conversations WHERE business_id = ANY($1) AND test = false AND started_at >= $2', [biz.map((b) => b.id), since]);
      return { reply: `Your team has had ${c[0].n} conversation${c[0].n === 1 ? '' : 's'} with real customers ${st.active ? 'this period' : 'in the last 30 days'}, and ${c[0].esc} of them asked for a person. Every transcript, with its sources, is in Squadron HQ.`, link: hq };
    }
    case 'plan':
      if (!st.active) return { reply: noPlan, link: '/billing' };
      return { reply: `You are on **${st.plan.name}**: ${st.plan.minutes.toLocaleString()} voice minutes and web chat for 30 days, prepaid, active through ${day(st.periodEnd)}. To change plan, pay for a different plan in Billing; it starts when the current period ends. Nothing upgrades automatically.`, link: '/billing' };
    case 'email':
      return { reply: `Your Squadron account uses ${acc.email}. Squadron's notices and invoices go there, and alerts about customer messages go to the notification email on the Deploy screen if you set one.` };
    default: return null;
  }
}
async function planCents(key) { const { PRICES } = await import('./_lib/billing.js'); return (PRICES[key] && PRICES[key].cents) || 0; }

const PERSON = /\b(talk|speak|chat|connect)( to| with)? (a |an )?(real )?(human|person|someone|representative|rep)\b|^(human|person|representative|agent)[?.!]*$|support ticket|contact (you|support|squadron)|escalate|^talk to a person$/i;
const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { message, sessionId, page } = req.body || {};
  if (typeof message !== 'string') return res.status(400).json({ error: 'message required' });
  const sid = /^[a-z0-9]{6,40}$/i.test(String(sessionId || '')) ? sessionId : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2, 8);
  const text = message.trim().slice(0, 1500);
  const base = { sessionId: sid, agent: AGENT };
  const acc = await currentAccount(req).catch(() => null);
  const state = await loadState(sid);
  const reply = async (out) => {
    state.transcript = (state.transcript || []).concat([{ role: 'user', text }, { role: 'agent', text: out.reply || '' }]);
    await saveState(sid, state);
    return res.status(200).json({ ...base, signedIn: !!acc, ...out });
  };
  try {
    if (!text || /^(hi|hello|hey|howdy|yo|start|help|menu)[!. ]*$/i.test(text)) {
      state.pending = null;
      return reply({ reply: acc ? GREETING_ACC(acc.email) : GREETING, suggestions: acc ? STARTERS_ACC : STARTERS });
    }
    if (/^(thanks|thank you|thx|ty|great|perfect|ok|okay|cool)[!. ]*$/i.test(text)) {
      state.pending = null;
      return reply({ reply: `You're welcome. I'm here whenever you need me, and the full Help Center is at squadron.tel/help.` });
    }
    // Finishing a hand-off: the message (and, for visitors, an email address).
    if (state.pending === 'handoff') {
      if (/^(cancel|never ?mind|no|stop)[!. ]*$/i.test(text)) { state.pending = null; state.draft = null; return reply({ reply: 'Understood. Nothing was sent, and I am still here for anything else.' }); }
      const found = text.match(EMAIL);
      const email = acc ? acc.email : found && found[0];
      const msg = [state.draft, text.replace(EMAIL, '').trim()].filter((x) => x && x.length > 1).join('\n');
      if (!email) { state.draft = msg; return reply({ reply: 'Add the email address where you want the reply, in your next message, and I will send your request to a person with a reference number.' }); }
      if (msg.length < 5) { return reply({ reply: 'Write what you need help with in one message, and I will send it to a person with a reference number.' }); }
      const t = await createTicket({ email, message: msg, topic: 'Other', page: page || 'Ace chat', transcript: state.transcript, ip: ipHash(req), accountId: acc && acc.id, accountLine: acc ? `${acc.email} (${acc.id})` : null });
      state.pending = null; state.draft = null;
      return reply({ reply: `Sent. A person at Squadron has your request, reference **${t.reference}**, and the confirmation is on its way to ${email}. They reply by email, and keeping the reference in the subject links any follow-up to it.`, ticket: t.reference });
    }
    // A request for a person.
    const aboutCustomers = /\b(customer|customers|caller|callers|visitor|visitors|client|clients|users)\b|\b(cost|costs|price|extra|charge|fee|how does|does it|how do)\b/i.test(text);
    if (!aboutCustomers && PERSON.test(text)) {
      state.pending = 'handoff'; state.draft = null;
      return reply({ reply: acc
        ? `I'm escalating you to a person at Squadron. Write what you need in your next message, and I will send it with your account details and this chat; you get a reference number right away and the reply comes to ${acc.email}.`
        : `I'm escalating you to a person at Squadron. Write what you need and your email address in your next message, and I will send it with this chat; you get a reference number right away and a person replies by email. You can also write to info@squadron.tel.`, handoff: true });
    }
    // The customer's own account.
    const intent = accountIntent(text);
    if (intent) {
      if (!acc) {
        const hits = search(text, 3);
        return reply({ reply: `I can read your plan, balance, invoices and channels once you are logged in. Log in at squadron.tel/account, then ask me again on any Squadron page.${hits.length && hits[0].score >= 2 ? `\n\n**${hits[0].q}**\n${hits[0].a}` : ''}`, link: '/account' });
      }
      const out = await accountAnswer(acc, intent);
      if (out) return reply({ ...out, suggestions: STARTERS_ACC.filter((s) => !s.toLowerCase().includes(intent)).slice(0, 3) });
    }
    const hits = search(text, 4);
    if (hits.length && hits[0].score >= 2) return reply(answer(hits[0], hits));
    if (hits.length) return reply({ reply: `I don't have an exact answer to that. These Help Center articles are the closest match.`, suggestions: hits.slice(0, 3).map((h) => h.q).concat(['Talk to a person']), followUp: `If none of them fits, I can hand you to a person at Squadron.`, handoffOffer: true });
    return reply({ reply: `I don't have an answer to that in the Help Center, so I won't guess. A person at Squadron can answer it: choose Talk to a person and I will send it with a reference number, or write to info@squadron.tel.`, suggestions: ['Talk to a person', byId['how-setup-works'].q, byId['pricing'].q] });
  } catch (e) {
    console.error('[ace]', e);
    return res.status(200).json({ ...base, reply: 'Something went wrong on my side. A person at Squadron answers at info@squadron.tel, and the Help Center is at squadron.tel/help.' });
  }
}

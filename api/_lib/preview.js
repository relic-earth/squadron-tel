// api/_lib/preview.js — the free site-read preview a visitor sees before
// paying. It reads the pages Squadron already fetched and finds facts with
// plain pattern matching (phone numbers, emails, prices, hours, policies,
// FAQ-style questions), lists what the site does not state, and sketches the
// team Squadron would build. No AI model is called, so the preview spends no
// provider credit. The paid build then reads the same pages with the model and
// may find more, or word things differently.
import { PERSONAS } from './personas.js';

const PHONE = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PRICE = /(?:\$|US\$|USD\s?)\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?(?:\s?(?:\/|per|a)\s?(?:mo|month|year|yr|hour|hr|night|person|session|visit|user))?/gi;
const DAYS = /\b(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|sat(urday)?|sun(day)?)\b[^\n]{0,40}?\b\d{1,2}(:\d{2})?\s?(am|pm|a\.m\.|p\.m\.)/gi;
const POLICY = [
  ['Returns', /\breturn(s| policy)\b/i], ['Refunds', /\brefund/i], ['Shipping', /\bshipping|delivery\b/i],
  ['Cancellation', /\bcancel(lation|ling)?\b/i], ['Warranty', /\bwarrant(y|ies)\b/i], ['Privacy', /\bprivacy\b/i],
  ['Booking', /\b(book|booking|appointment|reservation|schedule)\b/i], ['Payment', /\b(payment|we accept|visa|mastercard|financing)\b/i],
];

function uniq(list, n) { const seen = new Set(); const out = []; for (const x of list) { const k = x.toLowerCase().replace(/\s+/g, ' ').trim(); if (!k || seen.has(k)) continue; seen.add(k); out.push(x.replace(/\s+/g, ' ').trim()); if (out.length >= n) break; } return out; }

export function sitePreview(sources, host) {
  const text = sources.map((s) => s.content || '').join('\n');
  const phones = uniq((text.match(PHONE) || []).filter((p) => p.replace(/\D/g, '').length >= 10), 3);
  const emails = uniq((text.match(EMAIL) || []).filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/i.test(e) && !/example\.|sentry|wixpress|@2x/i.test(e)), 3);
  const prices = uniq(text.match(PRICE) || [], 8);
  const hours = uniq(text.match(DAYS) || [], 4);
  const questions = uniq(text.split(/\n+/).map((l) => l.replace(/^#+\s*/, '').trim()).filter((l) => /\?$/.test(l) && l.length > 12 && l.length < 140 && /^(how|what|when|where|can|do|does|is|are|will|why|who|which|should)\b/i.test(l)), 6);
  const policies = POLICY.filter(([, re]) => re.test(text)).map(([k]) => k);
  const facts = [];
  if (phones.length) facts.push({ kind: 'Phone', items: phones });
  if (emails.length) facts.push({ kind: 'Email', items: emails });
  if (hours.length) facts.push({ kind: 'Hours', items: hours });
  if (prices.length) facts.push({ kind: 'Prices', items: prices });
  if (policies.length) facts.push({ kind: 'Policies mentioned', items: policies });
  if (questions.length) facts.push({ kind: 'Customer questions answered on the site', items: questions });
  const gaps = [];
  if (!phones.length) gaps.push('A phone number');
  if (!emails.length) gaps.push('A contact email address');
  if (!hours.length) gaps.push('Opening or support hours');
  if (!prices.length) gaps.push('Prices');
  if (!policies.includes('Refunds') && !policies.includes('Returns')) gaps.push('A refund or returns policy');
  if (!questions.length) gaps.push('A FAQ page');

  // The team sketch: the Front Desk always, plus a specialist for each need
  // the pages show. The paid build designs the final team from the full
  // profile, with its own job descriptions and escalation rules.
  const has = (re) => re.test(text);
  const roles = [{ key: 'front_desk', title: 'Front Desk Manager', why: 'Greets every customer, answers general questions and routes the rest.', persona: 'Ace' }];
  if (has(/\b(book|booking|appointment|reservation|schedule|availability)\b/i)) roles.push({ key: 'scheduling', title: 'Scheduling Manager', why: 'Your pages mention booking or appointments.', persona: 'Tower' });
  if (prices.length || has(/\b(invoice|billing|payment|subscription|plan)\b/i)) roles.push({ key: 'billing', title: 'Billing Manager', why: 'Your pages list prices or payment terms.', persona: 'Ledger' });
  if (has(/\b(return|refund|exchange|shipping|delivery|order status|tracking)\b/i)) roles.push({ key: 'returns', title: 'Returns Manager', why: 'Your pages mention returns, refunds or shipping.', persona: 'Ricochet' });
  if (has(/\b(app|software|login|password|account|install|troubleshoot|device|setup|integration)\b/i)) roles.push({ key: 'technical', title: 'Technical Support Manager', why: 'Your pages describe a product customers set up or log in to.', persona: 'Torque' });
  if (prices.length >= 3 || has(/\b(compare|plans|packages|quote|pricing)\b/i)) roles.push({ key: 'sales', title: 'Sales Manager', why: 'Your pages compare plans or products that customers choose between.', persona: 'Wingman' });
  if (has(/\b(emergency|urgent|24\/7|same[- ]day|outage|leak|repair)\b/i)) roles.push({ key: 'dispatch', title: 'Dispatch Manager', why: 'Your pages mention urgent or same-day service.', persona: 'Scramble' });
  const team = roles.slice(0, 6).map((r) => { const p = PERSONAS.find((x) => x.name === r.persona) || PERSONAS[0]; return { ...r, persona: p.name, rank: p.rank, portrait: p.portrait, tone: p.tone, idx: p.idx }; });

  const chars = sources.reduce((n, s) => n + (s.content || '').length, 0);
  return {
    host: host || null,
    pages: sources.map((s) => ({ title: s.title || s.url, url: s.url })),
    pagesRead: sources.length,
    words: Math.round(chars / 6),
    facts, factCount: facts.reduce((n, f) => n + f.items.length, 0), gaps, team,
    note: 'Found by reading your pages for patterns, with no AI. After you pay, Squadron reads the same pages with AI to build the full Business Profile, with a source on every fact.',
  };
}

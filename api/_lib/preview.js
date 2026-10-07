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
  const kind = businessKind(text);
  const noRefunds = ['dental', 'medical', 'legal', 'restaurant', 'hotel', 'salon_fitness', 'home_services'].includes(kind.key);
  if (!prices.length) gaps.push(kind.key === 'legal' ? 'Fees or how payment works' : kind.key === 'dental' || kind.key === 'medical' ? 'Prices or insurance accepted' : 'Prices');
  if (noRefunds) { if (!policies.includes('Cancellation') && kind.key !== 'legal') gaps.push('A cancellation or no-show policy'); }
  else if (!policies.includes('Refunds') && !policies.includes('Returns')) gaps.push('A refund or returns policy');
  if (!questions.length) gaps.push('A FAQ page');

  const team = sketchTeam(text, { prices: prices.length }).map((r) => { const p = PERSONAS.find((x) => x.name === r.persona) || PERSONAS[0]; return { ...r, persona: p.name, rank: p.rank, portrait: p.portrait, tone: p.tone, idx: p.idx }; });

  const chars = sources.reduce((n, s) => n + (s.content || '').length, 0);
  return {
    host: host || null,
    pages: sources.map((s) => ({ title: s.title || s.url, url: s.url })),
    pagesRead: sources.length,
    words: Math.round(chars / 6),
    facts, factCount: facts.reduce((n, f) => n + f.items.length, 0), gaps, team, kind: kind.key, kindLabel: kind.label,
    note: 'Found by reading your pages for patterns, with no AI. After you pay, Squadron reads the same pages with AI to build the full Business Profile, with a source on every fact.',
  };
}

// ---- The team sketch -------------------------------------------------------
// First decide what kind of business this is, from words that only that kind
// of business uses a lot. Then pick the roles that kind of business needs,
// with titles its customers would recognise. A single passing word (an
// "account" link, a "technology" page) is not enough to add a role: a need
// has to show up several times. The paid build designs the final team from
// the full profile; this is the free sketch.
const KINDS = [
  { key: 'dental', label: 'Dental practice', re: /\b(dentist\w*|dental|teeth|tooth|orthodont\w*|invisalign|crowns?|implants?|hygienist|root canal|whitening|cerec)\b/gi },
  { key: 'medical', label: 'Medical practice', re: /\b(patients?|clinic|physician|doctor|medical|chiropract\w*|therap(y|ist)|pediatric\w*|dermatolog\w*|optometr\w*|veterinar\w*|vet clinic|urgent care|telehealth)\b/gi },
  { key: 'legal', label: 'Law firm', re: /\b(attorneys?|lawyers?|law firm|legal|injur(y|ies)|case evaluation|consultation|litigation|settlement|practice areas?|counsel)\b/gi },
  { key: 'restaurant', label: 'Restaurant', re: /\b(menu|restaurant|dine|dining|brunch|lunch|dinner|catering|takeout|take-out|reservations?|chef|kitchen|deli|bakery|cafe|bar)\b/gi },
  { key: 'hotel', label: 'Hotel', re: /\b(hotel|rooms?|suites?|check-?in|check-?out|guests?|stay|nightly|amenities|concierge|booking a room|bed and breakfast|resort)\b/gi },
  { key: 'home_services', label: 'Home services', re: /\b(plumb\w*|drain|sewer|hvac|heating|air conditioning|furnace|roof\w*|electrician|water heater|leaks?|technicians?|estimates?|service area|licensed and insured|cleaning service|pest|landscap\w*|garage door)\b/gi },
  { key: 'salon_fitness', label: 'Salon, spa or fitness studio', re: /\b(salon|spa|stylists?|haircuts?|blowouts?|manicure|massage|facials?|studio|classes|membership|workouts?|trainers?|yoga|pilates|gym)\b/gi },
  { key: 'software', label: 'Software or app', re: /\b(sign in|log ?in|sign up|free trial|dashboard|integrations?|api|download the app|app store|google play|workspace|admin|users|subscription|saas|platform)\b/gi },
  { key: 'retail', label: 'Online store', re: /\b(add to (cart|bag)|cart|checkout|free shipping|shipping|returns?|exchanges?|sizes?|in stock|shop (now|all)|orders?|collections?)\b/gi },
];
const count = (text, re) => (text.match(re) || []).length;

export function businessKind(text) {
  const words = Math.max(1, text.split(/\s+/).length);
  let best = { key: 'general', label: 'Business', score: 0 };
  for (const k of KINDS) {
    const score = count(text, k.re) * 1000 / words; // hits per thousand words
    if (score > best.score) best = { key: k.key, label: k.label, score };
  }
  if (best.score < 3) return { key: 'general', label: 'Business', score: best.score };
  return best;
}

// [key, title, why, persona, need] — need is a pattern that must appear at
// least `min` times (default 2) for the role to be added; no need = always.
const MENUS = {
  dental: [
    ['front_desk', 'Front Desk Manager', 'Greets every patient, answers general questions and routes the rest.', 'Ace'],
    ['scheduling', 'Appointments Manager', 'Books, moves and confirms visits, and handles new-patient questions.', 'Tower', /\b(appointments?|book|schedule|new patients?|visit)\b/gi],
    ['billing', 'Insurance & Billing Manager', 'Answers insurance, payment plan and pricing questions.', 'Ledger', /\b(insurance|ppo|financing|payment|care ?credit|cost|price|\$\d)/gi, 1],
    ['care', 'Patient Care Coordinator', 'Explains treatments and what to expect, in plain words, without giving medical advice.', 'Medic', /\b(treatments?|procedures?|implants?|crowns?|whitening|invisalign|cleanings?|exam)\b/gi],
    ['after_hours', 'After-Hours Manager', 'Takes urgent messages at night and tells patients what to do until the office opens.', 'Redeye', /\b(emergenc\w*|urgent|after[- ]hours|toothache|pain)\b/gi, 1],
    ['languages', 'Languages Manager', 'Helps patients who speak another language.', 'Rosetta', /\b(espa[nñ]ol|se habla|spanish|bilingual|multilingual)\b/gi, 1],
  ],
  medical: [
    ['front_desk', 'Front Desk Manager', 'Greets every patient, answers general questions and routes the rest.', 'Ace'],
    ['scheduling', 'Appointments Manager', 'Books, moves and confirms visits.', 'Tower', /\b(appointments?|book|schedule|new patients?|visit)\b/gi],
    ['billing', 'Insurance & Billing Manager', 'Answers insurance, payment and pricing questions.', 'Ledger', /\b(insurance|copay|payment|cost|price|billing|\$\d)/gi, 1],
    ['care', 'Patient Care Coordinator', 'Explains services and what to expect, without giving medical advice.', 'Medic', /\b(treatments?|services?|procedures?|conditions?|care)\b/gi],
    ['after_hours', 'After-Hours Manager', 'Takes urgent messages at night and points people to emergency services when needed.', 'Redeye', /\b(emergenc\w*|urgent|after[- ]hours)\b/gi, 1],
    ['languages', 'Languages Manager', 'Helps patients who speak another language.', 'Rosetta', /\b(espa[nñ]ol|se habla|spanish|bilingual)\b/gi, 1],
  ],
  legal: [
    ['front_desk', 'Intake Manager', 'Greets every caller, takes the details of their matter and routes it.', 'Ace'],
    ['scheduling', 'Consultations Manager', 'Books free or paid consultations with the right attorney.', 'Tower', /\b(consultations?|case evaluation|appointment|schedule|meet)\b/gi, 1],
    ['matters', 'Practice Areas Manager', 'Explains what the firm handles and what happens next, without giving legal advice.', 'Gavel', /\b(practice areas?|cases?|injur(y|ies)|accidents?|divorce|estate|criminal|immigration)\b/gi],
    ['billing', 'Billing Manager', 'Answers fee, retainer and payment questions.', 'Ledger', /\b(fees?|retainer|contingency|payment|billing|no fee|cost)\b/gi],
    ['languages', 'Languages Manager', 'Helps clients who speak another language.', 'Rosetta', /\b(espa[nñ]ol|se habla|spanish|bilingual)\b/gi, 1],
  ],
  restaurant: [
    ['front_desk', 'Host', 'Greets every guest, answers questions about hours, location and the menu.', 'Ace'],
    ['scheduling', 'Reservations Manager', 'Books, changes and confirms tables.', 'Tower', /\b(reservations?|reserve|book a table|opentable|resy|party of)\b/gi, 1],
    ['orders', 'Orders & Catering Manager', 'Handles takeout, delivery and catering questions.', 'Afterburner', /\b(order|takeout|take-out|delivery|catering|pickup|pick-up)\b/gi],
    ['events', 'Private Events Manager', 'Answers questions about private dining and events.', 'Envoy', /\b(private (dining|events?)|events?|parties|party room|buyouts?)\b/gi],
    ['menu', 'Menu Specialist', 'Answers questions about dishes, ingredients and allergies.', 'Briefer', /\b(allerg\w*|gluten|vegan|vegetarian|dairy|nut-free|ingredients?)\b/gi, 1],
  ],
  hotel: [
    ['front_desk', 'Front Desk Manager', 'Greets every guest, answers questions about the hotel and routes the rest.', 'Ace'],
    ['scheduling', 'Reservations Manager', 'Answers questions about rooms, rates, dates and bookings.', 'Tower', /\b(book|booking|reservations?|rates?|availability|dates)\b/gi],
    ['guest', 'Guest Services Manager', 'Handles requests before and during a stay: parking, amenities, special requests.', 'Envoy', /\b(amenities|parking|spa|gym|breakfast|concierge|pets?|room service)\b/gi],
    ['events', 'Events Manager', 'Answers questions about meetings, weddings and group stays.', 'Brass', /\b(events?|meetings?|weddings?|groups?|venue)\b/gi],
    ['billing', 'Billing Manager', 'Answers deposit, cancellation and payment questions.', 'Ledger', /\b(cancellation|deposit|refund|payment|charge)\b/gi],
  ],
  home_services: [
    ['front_desk', 'Front Desk Manager', 'Greets every caller, answers general questions and routes the rest.', 'Ace'],
    ['dispatch', 'Dispatch Manager', 'Handles urgent problems and gets a technician on the way.', 'Scramble', /\b(emergenc\w*|24\/7|same[- ]day|urgent|leaks?|burst|flood\w*|no heat|outage)\b/gi, 1],
    ['scheduling', 'Scheduling Manager', 'Books, moves and confirms service visits.', 'Tower', /\b(schedule|appointments?|book|service call|visit)\b/gi, 1],
    ['quotes', 'Estimates Manager', 'Answers pricing questions and sets up quotes and estimates.', 'Wingman', /\b(estimates?|quotes?|pricing|free inspection|financing|cost)\b/gi],
    ['billing', 'Billing Manager', 'Answers invoice, payment and warranty questions.', 'Ledger', /\b(invoice|payment|warrant(y|ies)|guarantee|billing)\b/gi],
  ],
  salon_fitness: [
    ['front_desk', 'Front Desk Manager', 'Greets every client, answers general questions and routes the rest.', 'Ace'],
    ['scheduling', 'Bookings Manager', 'Books, moves and confirms appointments and classes.', 'Tower', /\b(book|booking|appointments?|schedule|classes|reserve)\b/gi, 1],
    ['memberships', 'Memberships Manager', 'Answers membership, package and pricing questions.', 'Ledger', /\b(membership|packages?|pricing|prices?|class packs?|\$\d|intro offer)\b/gi],
    ['services', 'Services Specialist', 'Explains services, classes and what to expect.', 'Briefer', /\b(services?|treatments?|classes|workouts?|styles?)\b/gi],
  ],
  software: [
    ['front_desk', 'Front Desk Manager', 'Greets every customer, answers general questions and routes the rest.', 'Ace'],
    ['technical', 'Technical Support Manager', 'Helps customers set up, sign in and fix problems.', 'Torque', /\b(sign in|log ?in|password|install|setup|set up|troubleshoot|error|integrations?|settings)\b/gi],
    ['billing', 'Account & Billing Manager', 'Answers plan, invoice and subscription questions.', 'Ledger', /\b(plans?|pricing|billing|invoice|subscription|upgrade|\$\d)/gi],
    ['sales', 'Sales Manager', 'Helps people compare plans and choose what fits.', 'Wingman', /\b(compare|plans?|enterprise|demo|free trial|pricing|teams?)\b/gi],
    ['onboarding', 'Onboarding Manager', 'Walks new customers through getting started, one step at a time.', 'Flightline', /\b(get started|getting started|onboarding|tutorials?|guides?|how to)\b/gi],
  ],
  retail: [
    ['front_desk', 'Front Desk Manager', 'Greets every shopper, answers general questions and routes the rest.', 'Ace'],
    ['orders', 'Orders & Shipping Manager', 'Answers where-is-my-order, shipping times and delivery questions.', 'Afterburner', /\b(orders?|shipping|delivery|tracking|ships)\b/gi],
    ['returns', 'Returns Manager', 'Explains returns and exchanges and starts them.', 'Ricochet', /\b(returns?|exchanges?|refunds?)\b/gi],
    ['products', 'Product Specialist', 'Answers sizing, materials and which product fits.', 'Wingman', /\b(sizes?|sizing|fit|materials?|colors?|compare|collections?)\b/gi],
    ['billing', 'Billing Manager', 'Answers payment, discount and gift card questions.', 'Ledger', /\b(payment|gift cards?|discount|promo|afterpay|klarna|billing)\b/gi],
  ],
  general: [
    ['front_desk', 'Front Desk Manager', 'Greets every customer, answers general questions and routes the rest.', 'Ace'],
    ['scheduling', 'Scheduling Manager', 'Books, moves and confirms appointments.', 'Tower', /\b(appointments?|book|booking|schedule|reservations?)\b/gi],
    ['billing', 'Billing Manager', 'Answers price, invoice and payment questions.', 'Ledger', /\b(prices?|pricing|invoice|billing|payment|\$\d)/gi],
    ['returns', 'Returns Manager', 'Explains returns, refunds and exchanges.', 'Ricochet', /\b(returns?|refunds?|exchanges?)\b/gi],
    ['sales', 'Sales Manager', 'Helps customers compare options and choose what fits.', 'Wingman', /\b(compare|packages?|quotes?|plans?)\b/gi],
  ],
};

export function sketchTeam(text, { prices = 0 } = {}) {
  const kind = businessKind(text);
  const roles = [];
  for (const [key, title, why, persona, need, min = 2] of MENUS[kind.key] || MENUS.general) {
    if (!need || count(text, need) >= min || (key === 'billing' && prices >= 2)) roles.push({ key, title, why, persona });
    if (roles.length >= 6) break;
  }
  return roles;
}

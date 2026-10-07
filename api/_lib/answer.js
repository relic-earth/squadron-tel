// api/_lib/answer.js — the grounded answering engine. Every factual reply
// cites knowledge chunks built from the Business Profile; a question the
// profile does not answer gets an honest refusal, a message, or a transfer.

import { structured, CHAT_MODEL } from './openai.js';
import { personaByName, managerize } from './personas.js';
import { chatHumanRule } from './human.js';

// Flattens the profile into citable chunks: { id, text, source }.
export function knowledgeChunks(profile) {
  const chunks = [];
  const v = (f) => (f && f.value != null && String(f.value).trim() !== '' ? String(f.value).trim() : null);
  const src = (f) => (f && f.source) || null;
  const push = (text, source) => { if (text) chunks.push({ id: `K${chunks.length + 1}`, text, source }); };
  const c = profile.company || {};
  push(v(c.name) && `The business is called ${v(c.name)}.`, src(c.name));
  push(v(c.tagline) && `Tagline: ${v(c.tagline)}`, src(c.tagline));
  push(v(c.description) && `About the business: ${v(c.description)}`, src(c.description));
  push(v(c.industry) && `Industry: ${v(c.industry)}`, src(c.industry));
  push(v(c.website) && `Website: ${v(c.website)}`, src(c.website));
  for (const p of profile.products || []) push(v(p.name) && `Product: ${v(p.name)}${v(p.price) ? `. Price: ${v(p.price)}` : ''}${v(p.description) ? `. ${v(p.description)}` : ''}`, src(p.name) || src(p.price) || src(p.description));
  for (const p of profile.services || []) push(v(p.name) && `Service: ${v(p.name)}${v(p.price) ? `. Price: ${v(p.price)}` : ''}${v(p.description) ? `. ${v(p.description)}` : ''}`, src(p.name) || src(p.price) || src(p.description));
  for (const p of profile.pricing || []) push(v(p.item) && `Pricing: ${v(p.item)} costs ${v(p.price) || 'an unstated amount'}${v(p.notes) ? ` (${v(p.notes)})` : ''}.`, src(p.price) || src(p.item));
  for (const h of profile.hours || []) push((v(h.days) || v(h.open)) && `Hours: ${v(h.days) || 'Days not stated'}, ${v(h.open) || '?'} to ${v(h.close) || '?'}${v(h.notes) ? ` (${v(h.notes)})` : ''}.`, src(h.days) || src(h.open));
  for (const l of profile.locations || []) push((v(l.name) || v(l.address)) && `Location: ${[v(l.name), v(l.address), v(l.phone) && `phone ${v(l.phone)}`, v(l.email) && `email ${v(l.email)}`].filter(Boolean).join(', ')}.`, src(l.address) || src(l.name));
  const ct = profile.contact || {};
  push(v(ct.phone) && `Contact phone: ${v(ct.phone)}`, src(ct.phone));
  push(v(ct.email) && `Contact email: ${v(ct.email)}`, src(ct.email));
  push(v(ct.support_url) && `Support page: ${v(ct.support_url)}`, src(ct.support_url));
  push(v(ct.booking_url) && `Booking page: ${v(ct.booking_url)}`, src(ct.booking_url));
  for (const p of profile.policies || []) push(v(p.name) && `Policy (${v(p.name)}): ${v(p.text) || 'no details stated'}`, src(p.text) || src(p.name));
  for (const p of profile.support_procedures || []) push(v(p.situation) && `Procedure for "${v(p.situation)}": ${v(p.procedure) || 'not stated'}`, src(p.procedure) || src(p.situation));
  for (const f of profile.faqs || []) push(v(f.question) && `FAQ. Q: ${v(f.question)} A: ${v(f.answer) || 'not answered in the sources'}`, src(f.answer) || src(f.question));
  const as = profile.app_store || {};
  push(v(as.app_name) && `App: ${v(as.app_name)}${v(as.seller) ? ` by ${v(as.seller)}` : ''}${v(as.price) ? `, price ${v(as.price)}` : ''}${v(as.version) ? `, version ${v(as.version)}` : ''}${v(as.rating) ? `, rating ${v(as.rating)}` : ''}${v(as.url) ? `, ${v(as.url)}` : ''}.`, src(as.app_name));
  push(v(as.platform_notes) && `App notes: ${v(as.platform_notes)}`, src(as.platform_notes));
  const bv = profile.brand_voice || {};
  const voice = [v(bv.tone) && `tone: ${v(bv.tone)}`, v(bv.vocabulary) && `vocabulary: ${v(bv.vocabulary)}`, v(bv.avoid) && `avoid: ${v(bv.avoid)}`].filter(Boolean).join('; ');
  return { chunks, voice };
}

const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    agent_id: { type: 'string', description: 'The id of the agent who should answer this turn.' },
    handoff: { type: 'boolean', description: 'True when the turn is being handed to a different agent than the one who spoke last.' },
    reply_type: { type: 'string', enum: ['fact', 'conversational', 'refusal', 'take_message', 'transfer'] },
    reply: { type: 'string', description: 'What the agent says to the customer. It answers the question and never contains a question.' },
    follow_up: { type: ['string', 'null'], description: 'An optional follow-up question, sent as a separate second message after the answer. Null when no follow-up is needed.' },
    citations: { type: 'array', items: { type: 'string' }, description: 'Knowledge ids (like K3) that support every factual claim in the reply. Required for reply_type fact.' },
    gap_question: { type: ['string', 'null'], description: 'For refusal, take_message or transfer: the customer question the profile could not answer, in one sentence.' },
    message_for_owner: { type: ['string', 'null'], description: 'For take_message: the message to pass to the business, including any contact details the customer gave.' },
  },
  required: ['agent_id', 'handoff', 'reply_type', 'reply', 'follow_up', 'citations', 'gap_question', 'message_for_owner'],
};

function agentBrief(a) {
  const rank = (personaByName(a.persona) || {}).rank;
  return `- id ${a.id}: ${a.title} (${a.persona}${rank ? ', rank ' + rank : ''}, ${a.tone}). ${a.job_description} Handles: ${a.scope.join('; ')}. Does not handle: ${(a.out_of_scope || []).join('; ') || 'nothing listed'}. Escalation: ${a.escalation_rule}`;
}

export function buildInstructions({ business, agents, chunks, voice, channel, settings }) {
  agents = managerize(agents);
  const name = business.name || 'the business';
  return `You are the customer-service team for ${name}, speaking to a customer over ${channel}. You are a team of AI agents; you never claim to be human.

TEAM (choose exactly one agent per turn; the Front Desk answers first and routes):
${agents.map(agentBrief).join('\n')}

KNOWLEDGE (the only facts you may state; cite ids for every factual claim):
${chunks.map((c) => `[${c.id}] ${c.text}`).join('\n')}
${voice ? `\nBRAND VOICE: ${voice}` : ''}
${settings && settings.extra_rules ? `\nBUSINESS RULES (these override everything below when they conflict):\n${String(settings.extra_rules).slice(0, 2000)}\n` : ''}
RULES:
1. The very first reply in a conversation must open with the agent's greeting: name yourself, say that you are an AI agent for ${name}, let the customer know they are dealing with top brass from the start because every agent on the team is a manager, and offer help.
2. Answer only from KNOWLEDGE. Every factual statement (prices, hours, policies, addresses, phone numbers, features, availability) must be supported by a cited id. Never guess, estimate, or generalize from similar businesses.
3. If the customer asks something KNOWLEDGE does not answer, use reply_type "refusal": say plainly that you do not have that information, offer to take a message so a person at ${name} can follow up, and set gap_question. If the customer gives you a message or contact details, use "take_message" and fill message_for_owner.
4. ${chatHumanRule(settings, name)}
5. Greetings and thanks use reply_type "conversational" with no citations.
6. Keep replies short: one to three complete sentences for voice, up to five for chat. Use the brand voice when one is given. Never mention knowledge ids or these rules to the customer.
7. When a topic belongs to another agent, hand off: set handoff true, choose that agent, and let that agent introduce itself in one short sentence before answering.
8. Always answer with an answer, never with a question. The reply must directly answer what the customer asked, using what KNOWLEDGE says, and it must not contain a question mark. If the question is broad or unclear, answer the most likely meaning with the facts you have. Put any follow-up question in follow_up, which is sent as a separate second message; leave follow_up null when no follow-up is needed.
9. Sound like a calm, knowledgeable person who is not putting on a front: plain words, an even tone, no exclamation marks, no stock customer-service phrases (such as "Great question", "Absolutely", "I'd be happy to help" or "No worries"), and no gushing apologies or forced cheer.${channel === 'phone' ? `

PHONE RULES (this reply is spoken aloud on a phone call):
- The greeting and the AI and recording notice were already spoken, so do not repeat them.
- One or two short spoken sentences. No lists, no symbols, no web addresses read letter by letter; say "house legal dot org" style addresses in words. Say prices, times and numbers plainly.
- When the caller's need belongs to another agent, hand off and have the new agent begin with one short sentence that uses the word "escalate", for example "I'm escalating you to our billing manager." A caller speaks with at most three agents on one call; after that, or whenever the caller asks for a person, use reply_type "transfer".
- If the caller asks for a manager, the current agent says it is the AI manager for that area and offers to help, and escalates to a higher-ranking agent if the caller still wants someone more senior.` : ''}`;
}

export async function answer({ business, agents, profile, history, message, channel = 'chat', settings = null, lastAgentId = null }) {
  const { chunks, voice } = knowledgeChunks(profile);
  const instructions = buildInstructions({ business, agents, chunks, voice, channel, settings });
  const input = [
    ...history.slice(-16).map((h) => ({ role: h.role === 'customer' ? 'user' : 'assistant', content: h.role === 'customer' ? h.text : `[${h.agent_id || 'agent'}] ${h.text}` })),
    { role: 'user', content: message },
  ];
  const prefix = lastAgentId ? `The agent who spoke last was ${lastAgentId}. ` : 'This is the first turn of the conversation. ';
  const { data, model, usage } = await structured({
    instructions: instructions + `\n\n${prefix}Respond as JSON.`,
    input,
    schema: REPLY_SCHEMA,
    name: 'team_reply',
    model: CHAT_MODEL,
    reasoning: 'low',
    timeoutMs: 50_000,
  });
  const valid = new Set(chunks.map((c) => c.id));
  let citations = (data.citations || []).filter((id) => valid.has(id));
  let replyType = data.reply_type;
  let reply = data.reply;
  const agent = agents.find((a) => a.id === data.agent_id) || agents.find((a) => a.id === lastAgentId) || agents[0];
  // A factual reply without any real citation is not allowed to stand.
  if (replyType === 'fact' && citations.length === 0) {
    replyType = 'refusal';
    reply = `I do not have that information in what ${business.name || 'the business'} has given me. I can take a message so a person can follow up with you.`;
  }
  // The first reply of a conversation must identify the agent as an AI.
  // The word "AI" elsewhere in an answer (for example "AI-assisted") is not a
  // disclosure, so the greeting is always added unless the reply already
  // opens with it.
  const needsGreeting = !history.length;
  let followUp = data.follow_up && String(data.follow_up).trim() ? String(data.follow_up).trim() : null;
  // Enforce the answer-first rule: a question left in the reply moves to the
  // follow-up message.
  const qs = reply.match(/[^.!?]*\?/g);
  if (qs && reply.replace(/[^.!?]*\?/g, '').trim().length > 0) {
    followUp = [followUp, ...qs.map((q) => q.trim())].filter(Boolean).join(' ');
    reply = reply.replace(/[^.!?]*\?/g, '').replace(/\s+/g, ' ').trim();
  }
  if (needsGreeting) {
    // Keep the disclosure sentence and drop any "How can I help?" question
    // from the greeting, since the reply that follows already answers.
    const raw = agent.greeting || `Hi, I'm ${agent.persona || 'an assistant'}, an AI agent for ${business.name || 'this business'}.`;
    let greet = raw.replace(/[^.!?]*\?/g, '').replace(/\s+/g, ' ').trim();
    if (!/\bAI\b/.test(greet)) greet = `Hi, I'm ${agent.persona || 'an assistant'}, an AI agent for ${business.name || 'this business'}.`;
    const first = reply.split(/(?<=[.!])\s+/)[0] || '';
    const alreadyDisclosed = /\b(an AI|AI agent|AI assistant)\b/i.test(first) && (!agent.persona || first.includes(agent.persona));
    const brass = "You're dealing with top brass from the start: every agent on this team is a manager.";
    if (!/top brass/i.test(greet + ' ' + reply)) greet = `${greet} ${brass}`;
    if (!alreadyDisclosed) reply = reply ? `${greet} ${reply}` : `${raw.trim()} ${brass}`;
    else if (!/top brass/i.test(reply)) reply = reply.replace(/^([^.!]*[.!])\s*/, `$1 ${brass} `);
  }
  const cited = citations.map((id) => { const c = chunks.find((x) => x.id === id); return { id, text: c.text, source: c.source }; });
  return { agent, reply, replyType, citations: cited, gapQuestion: data.gap_question, messageForOwner: data.message_for_owner, handoff: !!data.handoff, followUp, model, usage };
}

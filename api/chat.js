// /api/chat.js — Ace, Squadron's own support chat on squadron.tel.
// Answers come from the Help Center (help-kb.js) by keyword match, so every
// reply is instant, consistent and costs nothing. Rule: every reply answers
// with facts and never ends in a question; a follow-up, when useful, goes in
// followUp and shows as a separate second message.
import { ARTICLES, search } from '../help-kb.js';

const AGENT = { name: 'Ace', title: 'Squadron Support' };
const GREETING = `I'm **Ace**, Squadron's AI support agent. I answer from the Squadron Help Center, and I can hand you to a person at Squadron at any time.`;
const STARTERS = ['How does setup work?', 'How much does it cost?', 'How do I test my team?', 'The chat button is not showing', 'Talk to a person'];
const byId = Object.fromEntries(ARTICLES.map((a) => [a.id, a]));

function answer(article, extra) {
  return {
    reply: `**${article.q}**\n${article.a}`,
    link: `/help#${article.id}`,
    suggestions: extra.filter((x) => x.id !== article.id).slice(0, 3).map((x) => x.q),
  };
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { message, sessionId } = req.body || {};
  if (typeof message !== 'string') return res.status(400).json({ error: 'message required' });
  const sid = sessionId || Math.random().toString(36).slice(2);
  const text = message.trim().slice(0, 500);
  const base = { sessionId: sid, agent: AGENT };

  if (!text || /^(hi|hello|hey|howdy|yo|start|help|menu)[!. ]*$/i.test(text)) {
    return res.status(200).json({ ...base, reply: GREETING, suggestions: STARTERS });
  }
  if (/^(thanks|thank you|thx|ty|great|perfect|ok|okay|cool)[!. ]*$/i.test(text)) {
    return res.status(200).json({ ...base, reply: `You're welcome. I'm here whenever you need me, and the full Help Center is at squadron.tel/help.` });
  }
  const aboutCustomers = /\b(customer|customers|caller|callers|visitor|visitors|client|clients|users)\b|\b(cost|costs|price|extra|charge|fee|how does|does it|how do)\b/i.test(text);
  if (!aboutCustomers && /\b(talk|speak|chat|connect)( to| with)? (a |an )?(real )?(human|person|someone|representative|rep)\b|^(human|person|representative|agent)[?.!]*$|support ticket|contact (you|support|squadron)|^talk to a person$/i.test(text)) {
    return res.status(200).json({ ...base, reply: `I'm escalating you to a person at Squadron. Send your question with the contact form linked here, and you get a reference number right away; a person replies by email. You can also write to info@squadron.tel.`, link: '/help#contact', handoff: true });
  }
  const hits = search(text, 4);
  if (hits.length && hits[0].score >= 2) {
    return res.status(200).json({ ...base, ...answer(hits[0], hits) });
  }
  if (hits.length) {
    return res.status(200).json({ ...base, reply: `I don't have an exact answer to that. These Help Center articles are the closest match.`, suggestions: hits.slice(0, 3).map((h) => h.q), followUp: `If none of them fits, I can hand you to a person at Squadron.`, handoffOffer: true });
  }
  return res.status(200).json({ ...base, reply: `I don't have an answer to that in the Help Center, so I won't guess. A person at Squadron can answer it: send it with the form at squadron.tel/help#contact or write to info@squadron.tel.`, link: '/help#contact', suggestions: [byId['how-setup-works'].q, byId['pricing'].q, byId['contact-person'].q] });
}

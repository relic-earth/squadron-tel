// api/_lib/human.js — the human layer. Each business chooses how its AI team
// and its people share the work, and every channel (chat, browser voice,
// phone) follows the same choice.

import { directoryOf } from './directory.js';

export const HUMAN_MODES = {
  ai_first: {
    label: 'AI first, a person on request',
    detail: 'The AI team answers everything it can. A customer who asks for a person, is upset, or needs something your profile does not cover is passed to your on-call person or leaves a message.',
  },
  choice: {
    label: 'Customer chooses: a person or the AI team',
    detail: 'Every conversation starts by offering the customer a person at your business or the AI team. Customers who choose the AI team can still ask for a person at any time.',
  },
  person_first: {
    label: 'A person first, AI as the receptionist',
    detail: 'The AI greets the customer, takes their name, contact details and reason, and passes them straight to your on-call person. If nobody is available, it takes a message. It answers a question only when the customer asks it to.',
  },
  ai_only: {
    label: 'AI only',
    detail: 'The AI team handles every conversation. When a customer asks for a person, the team says no one is available live and takes a message for you. Nothing is ever transferred.',
  },
};

export function humanMode(settings) {
  const m = settings && settings.human_mode;
  return HUMAN_MODES[m] ? m : 'ai_first';
}

function target(settings) {
  const who = settings && settings.on_call_name ? settings.on_call_name : 'a person at the business';
  const phone = settings && settings.on_call_phone ? settings.on_call_phone : null;
  return { who, phone };
}

// Rule text for the chat model (reply types: transfer, take_message).
export function chatHumanRule(settings, name) {
  const mode = humanMode(settings);
  const { who } = target(settings);
  if (mode === 'ai_only') {
    return `HUMAN LAYER (AI only): no person is available live. If the customer asks for a person, is angry, or describes an emergency, say plainly that no one at ${name} is available live in this chat, then use reply_type "take_message" and offer to pass a message to ${who}. Never use reply_type "transfer". For an emergency, tell the customer to call emergency services.`;
  }
  if (mode === 'person_first') {
    return `HUMAN LAYER (person first): you are the receptionist for ${name}. In your first reply, say you are an AI receptionist and that you will pass the customer to ${who}, and ask for their name, the best way to reach them, and what they need, in that one reply as statements plus a follow_up. As soon as the customer gives a reason, use reply_type "transfer" and fill message_for_owner with their name, contact details and reason. Answer a factual question only when the customer asks you to answer it yourself.`;
  }
  if (mode === 'choice') {
    return `HUMAN LAYER (customer chooses): in your first reply, after the greeting, state that the customer can talk with ${who} or continue with the AI team. If the customer chooses a person, asks for a person, is angry, or describes an emergency, use reply_type "transfer", say you are passing them to ${who}, and fill message_for_owner with their request and any contact details they gave.`;
  }
  return `HUMAN LAYER (AI first): if the customer asks for a person, is angry, describes an emergency, or the agent's escalation rule says to transfer, use reply_type "transfer": say you are passing them to ${who}, and fill message_for_owner with their request and any contact details they gave.`;
}

// Extra instructions for spoken sessions (browser voice test and phone).
export function voiceHumanRules(settings, name) {
  const mode = humanMode(settings);
  const { who, phone } = target(settings);
  const canTransfer = !!phone || directoryOf(settings).some((d) => d.phone);
  const noLine = `If the transfer cannot go through, say that ${who} is not available right now and take a message with take_message.`;
  if (mode === 'ai_only') {
    return `- HUMAN LAYER, AI ONLY: no person is available live on this line. Never call request_transfer. If the caller asks for a person, say plainly that no one at ${name} is available live on this line and offer to take a message with take_message. For an emergency, tell the caller to hang up and call emergency services.`;
  }
  if (mode === 'person_first') {
    return `- HUMAN LAYER, PERSON FIRST: you are the AI receptionist. After the greeting, say you will connect the caller to ${who}, then ask for their name and what the call is about. As soon as they answer, say "I'm going to escalate your call to ${who} now" and call request_transfer with their name and reason. ${noLine} Answer a question yourself only when the caller asks you to.`;
  }
  if (mode === 'choice') {
    return `- HUMAN LAYER, CALLER CHOOSES: right after the greeting, say: "You can talk with ${who}, or stay with our AI team. Say 'person' or tell me what you need." If the caller chooses a person at any point, say "I'm going to escalate your call to ${who}" and call request_transfer. ${noLine}`;
  }
  return `- HUMAN LAYER, AI FIRST: when the caller asks for a person, is upset, describes an emergency, or has been through three agents, say "I'm going to escalate your call to ${who}" and call request_transfer. ${canTransfer ? '' : 'No on-call number is set, so take a message with take_message instead of transferring. '}${noLine}`;
}

export function allowsTransfer(settings) { return humanMode(settings) !== 'ai_only'; }

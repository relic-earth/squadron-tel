// /api/gather.js — handles speech input from <Gather>
const VOICE = 'Polly.Joanna-Generative';

const RESPONSES = {
  billing: { match: /bill|charge|invoice|payment|refund|cost|price|subscription|pay|credit/i, say: `For billing questions, email hello at squadron dot tel and a person will reply. Is there anything else I can help with?` },
  setup: { match: /setup|install|deploy|start|configure|connect|integrate|phone number|get started/i, say: `You enter your business, a website or App Store listing or documents. Squadron builds a profile you review, generates your team, and lets you test it before you deploy. Do you need help with a specific step?` },
  agents: { match: /agent|voice|personality|alex|maya|choose|switch|change agent/i, say: `Squadron has a library of 24 voices, each with a distinct personality, and assigns them to the agents it builds for your business. You can preview them on squadron dot tel.` },
  escalate: { match: /human|person|real|transfer|manager|supervisor|speak to someone/i, say: `Of course. Connecting you with a team member now.` },
  cancel: { match: /cancel|quit|stop|end|close account/i, say: `I'm sorry to hear that. Let me connect you with a person who can help.` },
  hours: { match: /hour|open|available|when|schedule/i, say: `Squadron AI agents answer around the clock. For a person, email hello at squadron dot tel.` },
  pricing: { match: /price|plan|tier|basic|pro|command|enterprise/i, say: `Plans are prepaid for thirty days. Basic is 39 dollars with 250 voice minutes. Pro is 79 dollars with 650 minutes. Command Center is 199 dollars with 2,000 minutes. Every plan includes web chat. Want me to walk you through which fits your volume?` },
  trial: { match: /trial|free|try|test|demo/i, say: `There is no free trial. Squadron is prepaid with no contract, starting at 39 dollars for thirty days. Start at squadron dot tel.` }
};

const FOLLOWUP = `Anything else I can help with?`;
const FALLBACK = `Got it. Let me connect you with a specialist who can go deeper on this.`;

export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/xml');
  const body = req.body || {};
  const speech = (body.SpeechResult || req.query?.SpeechResult || '').toLowerCase();
  const confidence = parseFloat(body.Confidence || req.query?.Confidence || '0');

  let responseText = null;
  let shouldEscalate = false;

  for (const [key, rule] of Object.entries(RESPONSES)) {
    if (rule.match.test(speech)) {
      responseText = rule.say;
      if (key === 'escalate' || key === 'cancel') shouldEscalate = true;
      break;
    }
  }

  if (!responseText || confidence < 0.3) { responseText = FALLBACK; shouldEscalate = true; }

  let twiml;
  if (shouldEscalate) {
    twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${VOICE}">${responseText}</Say><Say voice="${VOICE}">Please hold for just a moment.</Say><Play digits="wwwww"/><Dial><Number>+1${process.env.ESCALATION_PHONE || '8005551234'}</Number></Dial></Response>`;
  } else {
    twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${VOICE}">${responseText}</Say><Gather input="speech" action="/api/gather" speechTimeout="auto" language="en-US"><Say voice="${VOICE}">${FOLLOWUP}</Say></Gather><Say voice="${VOICE}">Thanks for calling Squadron. Have a great day!</Say><Hangup/></Response>`;
  }

  res.status(200).send(twiml);
}

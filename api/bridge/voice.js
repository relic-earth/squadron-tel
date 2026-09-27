// /api/bridge/voice — Twilio's voice webhook for every Squadron number.
// Squadron checks Twilio's signature, finds the business and places the
// prepaid hold, then connects the call's audio to the phone bridge with a
// signed stream ticket. The bridge therefore needs only BRIDGE_SECRET.
import crypto from 'node:crypto';
import { callContext } from './context.js';

const PUBLIC = (process.env.PUBLIC_ORIGIN || 'https://www.squadron.tel').replace(/\/$/, '');
function xml(s) { return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }

function validTwilio(url, params, signature) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  let data = url;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  const want = crypto.createHmac('sha1', token).update(data).digest('base64');
  return want.length === signature.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(signature));
}

function ticket(businessId, callSid, demo, exp, limit, hold) {
  return crypto.createHmac('sha256', process.env.BRIDGE_SECRET || '').update(`${businessId}|${callSid}|${demo}|${exp}|${limit}|${hold}`).digest('base64');
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/xml');
  const say = (t) => res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xml(t)}</Say><Hangup/></Response>`);
  const params = typeof req.body === 'object' && req.body ? req.body : Object.fromEntries(new URLSearchParams(String(req.body || '')));
  const raw = String(req.url || '');
  const url = `${PUBLIC}/api/bridge/voice${raw.includes('?') ? raw.slice(raw.indexOf('?')) : ''}`;
  if (!validTwilio(url, params, req.headers['x-twilio-signature'])) return res.status(403).send('<Response/>');
  const host = process.env.BRIDGE_HOST;
  if (!host) return say('This line is not connected yet. Please try again later. Goodbye.');
  let ctx = null;
  try { ctx = await callContext(String(params.To || ''), String(params.CallSid || '')); } catch (e) { console.error('[bridge/voice]', e); }
  if (!ctx || !ctx.ok) return say(ctx && ctx.reason === 'paused' ? 'This business has reached its plan allowance, so its assistant is paused right now. Please try again later.' : 'This number is not assigned to a business right now. Goodbye.');
  const demo = ctx.demo ? '1' : '0';
  const exp = String(Date.now() + 5 * 60 * 1000);
  const limit = String(Math.max(0, Math.floor(Number(ctx.limitSeconds) || 0)));
  const hold = String(ctx.holdRef || '');
  const tk = ticket(ctx.businessId, params.CallSid, demo, exp, limit, hold);
  const notice = `This call is answered by an A I agent for ${ctx.businessName}. It is recorded for quality.`;
  const p = { businessId: ctx.businessId, callSid: params.CallSid, from: params.From, to: params.To, demo, exp, limit, hold, ticket: tk };
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xml(notice)}</Say><Connect><Stream url="wss://${xml(host)}/media">${Object.entries(p).map(([k, v]) => `<Parameter name="${k}" value="${xml(v || '')}"/>`).join('')}</Stream></Connect></Response>`);
}

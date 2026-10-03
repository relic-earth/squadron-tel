// /api/signup.js — collect deploy form submissions
import { accepted, TERMS_VERSION, TERMS_TEXT } from './_lib/terms.js';
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!accepted(req.body, { cert: false })) return res.status(400).json({ error: 'Please agree to the Terms of Use and Privacy Policy.', code: 'terms_required' });
  const { firstName, lastName, email, company, callVolume, useCase, plan, ts } = req.body || {};
  console.log('[SIGNUP]', JSON.stringify({ name: `${firstName} ${lastName}`, email, company, callVolume, useCase, plan, ts, acceptance: { version: TERMS_VERSION, at: new Date().toISOString(), ip: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(), ua: String(req.headers['user-agent'] || '').slice(0, 300), text: TERMS_TEXT } }));
  return res.status(200).json({ ok: true, message: 'Request received for ' + email, plan });
}

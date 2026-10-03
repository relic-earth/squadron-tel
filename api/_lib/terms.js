// Terms acceptance: version, exact clickwrap text, enforcement and the record.
import crypto from 'node:crypto';
import { sql } from './db.js';

export const TERMS_VERSION = '2026-10-03';
export const TERMS_TEXT = 'I am 18 or older and I agree to the Terms of Use (including binding individual arbitration, a class action and jury trial waiver, and a limitation of liability) and the Privacy Policy.';
export const CERT_TEXT = 'I have obtained all consents required by law (including TCPA, call-recording and AI-disclosure consents) for every person my agents contact and I will comply with those laws.';
export const WIRE_TEXT = 'I understand that bank transfers and wires are final, that the plan is prepaid and does not renew automatically, and that payments are not refundable except where the law requires.';

export function accepted(body, { cert = true, wire = false } = {}) {
  if (!body || body.terms !== true || body.termsVersion !== TERMS_VERSION) return false;
  if (cert && body.cert !== true) return false;
  if (wire && body.wire !== true) return false;
  return true;
}
export const CODE = 'terms_required';
export const REFUSAL = 'Please tick the boxes to agree to the Terms of Use and Privacy Policy and to confirm your consents before continuing.';

export async function recordAcceptance(req, { accountId = null, email = null, kind, body }) {
  try {
    await sql().query(`CREATE TABLE IF NOT EXISTS terms_acceptances (
      id BIGSERIAL PRIMARY KEY, account_id TEXT, email TEXT, kind TEXT, version TEXT, accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ip TEXT, user_agent TEXT, terms_text TEXT, cert_text TEXT, wire_text TEXT, cert BOOLEAN, wire BOOLEAN)`);
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
    await sql().query(
      'INSERT INTO terms_acceptances (account_id, email, kind, version, ip, user_agent, terms_text, cert_text, wire_text, cert, wire) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [accountId, email, kind, TERMS_VERSION, ip, String(req.headers['user-agent'] || '').slice(0, 400), TERMS_TEXT,
        body.cert === true ? CERT_TEXT : null, body.wire === true ? WIRE_TEXT : null, body.cert === true, body.wire === true]);
  } catch (e) { console.error('[terms] record failed', e.message); }
}

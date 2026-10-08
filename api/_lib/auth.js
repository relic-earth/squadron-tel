// api/_lib/auth.js — accounts and sessions. Passwords are hashed with scrypt;
// the session is an HMAC-signed cookie. No third-party auth service is used.

import crypto from 'node:crypto';
import { sql, ensureSchema, newId } from './db.js';

const COOKIE = 'sq_session';

// Accounts allowed into BOSS (/admin). They can also sign in with an emailed
// link instead of a password.
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'info@island.contact,h@squadron.tel,info@squadron.tel,h@relic.earth')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const DAYS = 30;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not configured');
  return s;
}

export async function ensureAuthSchema() {
  await ensureSchema();
  const q = sql();
  await q.query(`CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'none',
    trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await q.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS account_id TEXT`);
  await q.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await q.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS phone_number TEXT`);
  await q.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS channels JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await q.query(`CREATE INDEX IF NOT EXISTS businesses_account_idx ON businesses(account_id)`);
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const want = Buffer.from(hash, 'hex');
  return test.length === want.length && crypto.timingSafeEqual(test, want);
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

// A colleague's login signs in to the owner's account: the session id is
// "<accountId>~<loginId>", so the account is shared and the person is known.
export function sessionCookie(accountId, loginId) {
  const exp = Date.now() + DAYS * 86400_000;
  const payload = `${accountId}${loginId ? '~' + loginId : ''}.${exp}`;
  const value = `${payload}.${sign(payload)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readSession(req) {
  const raw = req.headers?.cookie || '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const payload = `${id}.${exp}`;
  const want = sign(payload);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  if (+exp < Date.now()) return null;
  const [accountId, loginId] = id.split('~');
  return { accountId, loginId: loginId || null };
}

export async function currentAccount(req) {
  const s = readSession(req);
  if (!s) return null;
  await ensureAuthSchema();
  const rows = await sql().query('SELECT id, email, plan, trial_ends_at, created_at FROM accounts WHERE id = $1', [s.accountId]);
  const acc = rows[0] || null;
  if (!acc || !s.loginId) return acc;
  await ensureLoginsSchema();
  const m = await sql().query('SELECT id, email FROM logins WHERE id = $1 AND account_id = $2', [s.loginId, acc.id]);
  if (!m[0]) return null; // a removed colleague is signed out
  return { ...acc, member: { id: m[0].id, email: m[0].email } };
}

// One-click link in the weekly summary that switches it off.
export function weeklyOffToken(accountId) { return `${accountId}.${crypto.createHmac('sha256', secret()).update('weekly-off:' + accountId).digest('base64url').slice(0, 24)}`; }

let _logins = null;
export function ensureLoginsSchema() {
  if (!_logins) _logins = (async () => {
    await sql().query(`CREATE TABLE IF NOT EXISTS logins (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, email TEXT NOT NULL UNIQUE, pass_hash TEXT,
      invited_by TEXT, invite_hash TEXT, invite_expires TIMESTAMPTZ, accepted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await sql().query('CREATE INDEX IF NOT EXISTS logins_account_idx ON logins(account_id)');
    await sql().query("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS prefs JSONB NOT NULL DEFAULT '{}'::jsonb");
  })().catch((e) => { _logins = null; throw e; });
  return _logins;
}
export async function findLogin(email) {
  await ensureLoginsSchema();
  const r = await sql().query('SELECT * FROM logins WHERE email = $1', [String(email || '').toLowerCase()]);
  return r[0] || null;
}

export async function createAccount(email, password) {
  await ensureAuthSchema();
  const id = newId('acc');
  await sql().query('INSERT INTO accounts (id, email, pass_hash) VALUES ($1, $2, $3)', [id, email.toLowerCase(), hashPassword(password)]);
  return id;
}

export async function findAccount(email) {
  await ensureAuthSchema();
  const rows = await sql().query('SELECT * FROM accounts WHERE email = $1', [email.toLowerCase()]);
  return rows[0] || null;
}

// Plans. Everything is prepaid: a plan is active only for a paid 30-day
// period (see ledger.js). Chat has no conversation limit; voice minutes are
// included per plan and extra minutes are sold prepaid in blocks.
export const PLANS = {
  none: { name: 'No paid plan', price: 0, minutes: 0 },
  basic: { name: 'Basic', price: 39, minutes: 250 },
  pro: { name: 'Pro', price: 79, minutes: 650 },
  center: { name: 'Command Center', price: 199, minutes: 2000 },
  // Battalion: flat fee for 10,000 minutes; minutes beyond that draw on
  // prepaid overage credit at Squadron's measured cost plus 1 cent a minute.
  battalion: { name: 'Battalion', price: 999, minutes: 10000, metered: true },
  // House: Island Global Co's own businesses; a monthly spend cap, no invoice.
  house: { name: 'House', price: 0, minutes: 100000 },
};
// Earlier plan ids map to the current plans.
const ALIASES = { scout: 'basic', commander: 'pro', hq: 'center', trial: 'none' };
export function planKey(k) { return PLANS[k] ? k : (ALIASES[k] || 'none'); }

// Changing a team or reading its conversations needs the owner's session (or
// a colleague's), not just the business token: tokens travel in emailed links
// and setup addresses, so on their own they are not proof of who is asking.
// Before an account exists (the free preview) the token is enough.
export async function ownerGate(req, biz) {
  if (!biz || !biz.account_id) return null;
  const acc = await currentAccount(req).catch(() => null);
  if (acc && acc.id === biz.account_id) return null;
  return { status: 401, error: 'Log in to the account that owns this team to do that.', code: 'login_required' };
}

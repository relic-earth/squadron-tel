// /api/auth — signup, login, logout, "who am I", and password reset.
// A signup during onboarding attaches the current business (by token) to the
// new account. 'forgot' emails a one-hour reset link; 'reset' sets the new
// password. 'forgot' answers the same way whether or not the email exists.
import { accepted, REFUSAL, CODE, recordAcceptance } from './_lib/terms.js';
import { sql, loadBusiness, readJson, bad } from './_lib/db.js';
import crypto from 'node:crypto';
import { ADMIN_EMAILS, ensureAuthSchema, createAccount, findAccount, verifyPassword, hashPassword, sessionCookie, clearCookie, currentAccount, ensureLoginsSchema, findLogin, weeklyOffToken } from './_lib/auth.js';
import { newId } from './_lib/db.js';

const SITE = 'https://www.squadron.tel';
const EMAIL_OK = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

import { ledgerStatus } from './_lib/ledger.js';
import { sendEmail } from './_lib/email.js';
import { track } from './_lib/events.js';

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const body = req.method === 'GET' ? {} : readJson(req);
  const action = req.method === 'GET' ? (req.query?.signin ? 'signin' : req.query?.weekly_off ? 'weekly_off' : 'me') : body.action;
  try {
    await ensureAuthSchema();
    await ensureLoginsSchema();
    if (action === 'weekly_off') {
      const [id] = String(req.query.weekly_off).split('.');
      if (weeklyOffToken(id) === String(req.query.weekly_off)) await sql().query("UPDATE accounts SET prefs = prefs || '{\"weekly\": false}'::jsonb WHERE id = $1", [id]);
      res.setHeader('Location', '/account?weekly=off');
      return res.status(302).end();
    }
    if (action === 'prefs') {
      const acc = await currentAccount(req);
      if (!acc) return bad(res, 401, 'Log in first.');
      if (typeof body.weekly === 'boolean') await sql().query("UPDATE accounts SET prefs = prefs || jsonb_build_object('weekly', $2::boolean) WHERE id = $1", [acc.id, body.weekly]);
      const p = await sql().query('SELECT prefs FROM accounts WHERE id = $1', [acc.id]);
      return res.status(200).json({ ok: true, prefs: p[0].prefs || {} });
    }
    if (action === 'members' || action === 'invite' || action === 'remove_member') {
      // Colleagues share the owner's account with their own email and password.
      const acc = await currentAccount(req);
      if (!acc) return bad(res, 401, 'Log in first.');
      if (action !== 'members' && acc.member) return bad(res, 403, 'Only the account owner can add or remove colleagues.');
      if (action === 'invite') {
        const email = String(body.email || '').trim().toLowerCase();
        if (!EMAIL_OK(email)) return bad(res, 400, 'Enter your colleague\'s email address.');
        if (email === acc.email || await findAccount(email)) return bad(res, 409, 'That email already has its own Squadron account. Invite a different address.');
        const n = await sql().query('SELECT COUNT(*)::int AS n FROM logins WHERE account_id = $1', [acc.id]);
        if (n[0].n >= 10) return bad(res, 400, 'An account can have up to ten colleagues.');
        const token = crypto.randomBytes(32).toString('base64url');
        const existing = await findLogin(email);
        if (existing && existing.account_id !== acc.id) return bad(res, 409, 'That email already belongs to another Squadron team.');
        if (existing) await sql().query("UPDATE logins SET invite_hash = $2, invite_expires = now() + interval '7 days' WHERE id = $1", [existing.id, sha(token)]);
        else await sql().query("INSERT INTO logins (id, account_id, email, invited_by, invite_hash, invite_expires) VALUES ($1,$2,$3,$4,$5, now() + interval '7 days')", [newId('lgn'), acc.id, email, acc.email, sha(token)]);
        await sendEmail({ to: email, replyTo: acc.email, subject: `${acc.email} invited you to their Squadron team`, text: `${acc.email} added you to their Squadron account, so you can see conversations in Squadron HQ, answer the knowledge queue, test the team and change settings.\n\nOpen this link within seven days and choose your password:\n\n${SITE}/account?invite=${token}\n\nIf you were not expecting this, ignore this email.` });
      }
      if (action === 'remove_member') await sql().query('DELETE FROM logins WHERE id = $1 AND account_id = $2', [String(body.id || ''), acc.id]);
      const list = await sql().query('SELECT id, email, accepted_at, created_at FROM logins WHERE account_id = $1 ORDER BY created_at', [acc.id]);
      return res.status(200).json({ members: list, owner: acc.email, youAreOwner: !acc.member });
    }
    if (action === 'accept') {
      const token = String(body.token || ''); const password = String(body.password || '');
      if (password.length < 8) return bad(res, 400, 'Use a password of at least 8 characters.');
      if (!accepted(body)) return res.status(400).json({ error: REFUSAL, code: CODE });
      const r = await sql().query("UPDATE logins SET pass_hash = $2, accepted_at = COALESCE(accepted_at, now()), invite_hash = NULL WHERE invite_hash = $1 AND invite_expires > now() RETURNING id, account_id", [sha(token), hashPassword(password)]);
      if (!r[0]) return bad(res, 400, 'This invitation has expired or was already used. Ask the account owner to send a new one.');
      await recordAcceptance(req, { accountId: r[0].account_id, email: null, kind: 'invite', body });
      res.setHeader('Set-Cookie', sessionCookie(r[0].account_id, r[0].id));
      return res.status(200).json({ ok: true });
    }
    if (action === 'change_email') {
      const acc = await currentAccount(req);
      if (!acc) return bad(res, 401, 'Log in first.');
      if (acc.member) return bad(res, 403, 'Only the account owner can change the account email.');
      const email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL_OK(email)) return bad(res, 400, 'Enter a valid email address.');
      const full = await findAccount(acc.email);
      if (!verifyPassword(String(body.password || ''), full.pass_hash)) return bad(res, 401, 'That password is not correct.');
      if (email === acc.email) return res.status(200).json({ ok: true, email });
      if (await findAccount(email) || await findLogin(email)) return bad(res, 409, 'That email is already used by a Squadron account.');
      await sql().query('UPDATE accounts SET email = $2 WHERE id = $1', [acc.id, email]);
      const note = `The email address for your Squadron account changed from ${acc.email} to ${email}. Invoices, notices and sign-in now use ${email}. If you did not make this change, reply to this email right away.`;
      await sendEmail({ to: acc.email, subject: 'Your Squadron account email changed', text: note }).catch(() => {});
      await sendEmail({ to: email, subject: 'Your Squadron account email changed', text: note }).catch(() => {});
      return res.status(200).json({ ok: true, email });
    }
    if (action === 'signin') {
      // One-time sign-in link for BOSS admins, sent by 'admin_link'.
      await sql().query(`CREATE TABLE IF NOT EXISTS password_resets (
        token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      const rows = await sql().query('UPDATE password_resets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING account_id', [sha('signin:' + String(req.query.signin))]);
      if (!rows.length) { res.setHeader('Location', '/admin?link=expired'); return res.status(302).end(); }
      res.setHeader('Set-Cookie', sessionCookie(rows[0].account_id));
      res.setHeader('Location', '/admin');
      return res.status(302).end();
    }
    if (action === 'me') {
      const acc = await currentAccount(req);
      if (!acc) return res.status(200).json({ account: null });
      const businesses = await sql().query('SELECT id, token, input_kind, input_value, status, phone_number, channels, created_at FROM businesses WHERE account_id = $1 ORDER BY created_at DESC', [acc.id]);
      const st = await ledgerStatus(acc.id);
      const pr = await sql().query('SELECT prefs FROM accounts WHERE id = $1', [acc.id]);
      return res.status(200).json({ account: { id: acc.id, email: acc.email, member: acc.member || null, prefs: (pr[0] && pr[0].prefs) || {}, active: st.active, plan: st.planKey, planInfo: st.plan, paidThrough: st.periodEnd, minutesIncluded: st.minutesIncluded, minutesUsed: st.minutesUsed }, businesses });
    }
    if (action === 'claim') {
      // Attaches an onboarding business to the signed-in account (for owners
      // who were already logged in when they entered their website).
      const acc = await currentAccount(req);
      if (!acc) return bad(res, 401, 'Sign in first.');
      const biz = body.token ? await loadBusiness(body.token) : null;
      if (!biz) return bad(res, 404, 'Unknown business');
      if (biz.account_id && biz.account_id !== acc.id) return bad(res, 403, 'This team belongs to another account.');
      if (!biz.account_id) await sql().query('UPDATE businesses SET account_id = $2 WHERE id = $1 AND account_id IS NULL', [biz.id, acc.id]);
      return res.status(200).json({ ok: true });
    }
    if (action === 'delete') {
      // Permanently deletes the signed-in account: every team, profile,
      // conversation, recording and usage row. Paid invoice records are kept
      // for tax purposes, detached from any email address.
      const acc = await currentAccount(req);
      if (!acc) return bad(res, 401, 'Log in first.');
      if (acc.member) return bad(res, 403, 'Only the account owner can delete the account.');
      const full = await findAccount(acc.email);
      if (!full || !verifyPassword(String(body.password || ''), full.pass_hash)) return bad(res, 401, 'That password is not correct.');
      const ids = (await sql().query('SELECT id FROM businesses WHERE account_id = $1', [acc.id])).map((r) => r.id);
      if (ids.length && process.env.BLOB_READ_WRITE_TOKEN) {
        try {
          const { list, del } = await import('@vercel/blob');
          for (const id of ids) {
            let cursor;
            do {
              const page = await list({ prefix: `recordings/${id}/`, cursor, token: process.env.BLOB_READ_WRITE_TOKEN });
              if (page.blobs.length) await del(page.blobs.map((b) => b.url), { token: process.env.BLOB_READ_WRITE_TOKEN });
              cursor = page.hasMore ? page.cursor : undefined;
            } while (cursor);
          }
        } catch (e) { console.error('[auth delete blobs]', e.message); }
      }
      const q = async (text, params) => { try { await sql().query(text, params); } catch (e) { if (!/does not exist/.test(e.message)) throw e; } };
      if (ids.length) {
        try { const { releaseNumbers } = await import('./_lib/numbers.js'); await releaseNumbers(ids); } catch (e) { console.error('[auth delete numbers]', e.message); }
        await q('DELETE FROM calls WHERE business_id = ANY($1)', [ids]);
        await q('UPDATE demo_numbers SET business_id = NULL, expires_at = NULL, assigned_at = NULL WHERE business_id = ANY($1)', [ids]);
        await q('DELETE FROM businesses WHERE id = ANY($1)', [ids]);
      }
      await q('DELETE FROM spend WHERE account_id = $1 AND settled = true', [acc.id]);
      await q("UPDATE invoices SET status = 'cancelled' WHERE account_id = $1 AND status = 'pending'", [acc.id]);
      await q('DELETE FROM password_resets WHERE account_id = $1', [acc.id]);
      await q('DELETE FROM logins WHERE account_id = $1', [acc.id]);
      await sql().query('DELETE FROM accounts WHERE id = $1', [acc.id]);
      await sendEmail({ to: acc.email, subject: 'Your Squadron account is deleted', text: 'Your Squadron account, teams, conversations and call recordings have been permanently deleted. If you did not do this, reply to this email right away.' }).catch(() => {});
      res.setHeader('Set-Cookie', clearCookie());
      return res.status(200).json({ ok: true });
    }
    if (action === 'logout') { res.setHeader('Set-Cookie', clearCookie()); return res.status(200).json({ ok: true }); }
    await sql().query(`CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    if (action === 'reset') {
      const token = String(body.token || '');
      const password = String(body.password || '');
      if (password.length < 8) return bad(res, 400, 'Use a password of at least 8 characters.');
      const rows = await sql().query('UPDATE password_resets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING account_id', [sha(token)]);
      if (!rows.length) return bad(res, 400, 'This reset link has expired or was already used. Ask for a new one.');
      await sql().query('UPDATE password_resets SET used_at = now() WHERE account_id = $1 AND used_at IS NULL', [rows[0].account_id]);
      if (String(rows[0].account_id).startsWith('login:')) {
        const lid = String(rows[0].account_id).slice(6);
        const lg = await sql().query('UPDATE logins SET pass_hash = $2 WHERE id = $1 RETURNING account_id', [lid, hashPassword(password)]);
        if (!lg[0]) return bad(res, 400, 'This reset link is no longer valid.');
        res.setHeader('Set-Cookie', sessionCookie(lg[0].account_id, lid));
        return res.status(200).json({ ok: true });
      }
      await sql().query('UPDATE accounts SET pass_hash = $2 WHERE id = $1', [rows[0].account_id, hashPassword(password)]);
      res.setHeader('Set-Cookie', sessionCookie(rows[0].account_id));
      return res.status(200).json({ ok: true });
    }
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 400, 'Enter a valid email address.');
    if (action === 'admin_link') {
      // Admin addresses get a 15-minute sign-in link by email; no password is
      // involved. The account is opened on first use. Other addresses get the
      // same answer and no email.
      if (ADMIN_EMAILS.includes(email)) {
        let acc = await findAccount(email);
        if (!acc) { await createAccount(email, crypto.randomBytes(32).toString('base64url')); acc = await findAccount(email); }
        const recent = await sql().query("SELECT COUNT(*)::int AS n FROM password_resets WHERE account_id = $1 AND created_at > now() - interval '1 hour'", [acc.id]);
        if (recent[0].n < 8) {
          const token = crypto.randomBytes(32).toString('base64url');
          await sql().query("INSERT INTO password_resets (token_hash, account_id, expires_at) VALUES ($1, $2, now() + interval '15 minutes')", [sha('signin:' + token), acc.id]);
          await sendEmail({ to: acc.email, subject: 'Your BOSS sign-in link', text: `Open this link within 15 minutes to sign in to BOSS, Squadron's admin:\n\nhttps://www.squadron.tel/api/auth?signin=${token}\n\nIf you did not ask for this, ignore this email.` });
        }
      }
      return res.status(200).json({ ok: true, message: 'If that address is a BOSS admin, a sign-in link is on its way. It works for 15 minutes.' });
    }
    if (action === 'forgot') {
      let acc = await findAccount(email);
      if (!acc) { const lg = await findLogin(email); if (lg && lg.pass_hash) acc = { id: 'login:' + lg.id, email: lg.email }; }
      if (acc) {
        const recent = await sql().query("SELECT COUNT(*)::int AS n FROM password_resets WHERE account_id = $1 AND created_at > now() - interval '1 hour'", [acc.id]);
        if (recent[0].n < 5) {
          const token = crypto.randomBytes(32).toString('base64url');
          await sql().query("INSERT INTO password_resets (token_hash, account_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [sha(token), acc.id]);
          await sendEmail({ to: acc.email, subject: 'Reset your Squadron password', text: `Someone asked to reset the password for your Squadron account. To choose a new password, open this link within one hour:\n\nhttps://www.squadron.tel/reset?token=${token}\n\nIf you did not ask for this, you can ignore this email, and your password will stay the same.` });
        }
      }
      return res.status(200).json({ ok: true, message: 'If that email has a Squadron account, a reset link is on its way. It works for one hour.' });
    }
    if (action === 'signup') {
      if (password.length < 8) return bad(res, 400, 'Use a password of at least 8 characters.');
      if (!accepted(body)) return res.status(400).json({ error: REFUSAL, code: CODE });
      if (await findAccount(email) || await findLogin(email)) return bad(res, 409, 'An account with that email already exists. Log in instead.');
      const id = await createAccount(email, password);
      await sql().query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ');
      await sql().query("UPDATE accounts SET terms_accepted_at = now() WHERE id = $1", [id]);
      await recordAcceptance(req, { accountId: id, email, kind: 'signup', body });
      if (body.token) { const biz = await loadBusiness(body.token); if (biz && !biz.account_id) await sql().query('UPDATE businesses SET account_id = $2 WHERE id = $1', [biz.id, id]); }
      await track('account_created', { accountId: id });
      res.setHeader('Set-Cookie', sessionCookie(id));
      return res.status(200).json({ ok: true, accountId: id });
    }
    if (action === 'login') {
      const acc = await findAccount(email);
      if (!acc) {
        const lg = await findLogin(email);
        if (!lg || !lg.pass_hash || !verifyPassword(password, lg.pass_hash)) return bad(res, 401, 'That email and password do not match.');
        res.setHeader('Set-Cookie', sessionCookie(lg.account_id, lg.id));
        return res.status(200).json({ ok: true, accountId: lg.account_id });
      }
      if (!verifyPassword(password, acc.pass_hash)) return bad(res, 401, 'That email and password do not match.');
      if (body.token) { const biz = await loadBusiness(body.token); if (biz && !biz.account_id) await sql().query('UPDATE businesses SET account_id = $2 WHERE id = $1', [biz.id, acc.id]); }
      res.setHeader('Set-Cookie', sessionCookie(acc.id));
      return res.status(200).json({ ok: true, accountId: acc.id });
    }
    return bad(res, 400, 'Unknown action');
  } catch (e) {
    console.error('[auth]', e);
    return bad(res, 500, e.message);
  }
}

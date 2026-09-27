// api/_lib/events.js — privacy-friendly funnel events. No cookies, no ad
// trackers, no IP addresses and no user agents are stored. A browser visit is
// counted with a random id that lives only in that tab's sessionStorage, so it
// cannot follow anyone across visits or sites. Server-side steps (account
// created, plan paid, team built, chat deployed) are tied to the account.
import { sql } from './db.js';

export const STEPS = [
  ['landing', 'Visited the homepage'],
  ['url_entered', 'Entered a website'],
  ['site_read', 'Site read, free preview shown'],
  ['account_created', 'Created an account'],
  ['plan_paid', 'Paid for a plan'],
  ['team_built', 'Team built'],
  ['chat_deployed', 'Chat turned on'],
];
export const CLIENT_EVENTS = new Set(['landing', 'url_entered', 'site_read', 'pay_view', 'pay_click', 'start_view']);

let _ready = null;
export function ensureEventsSchema() {
  if (!_ready) {
    _ready = (async () => {
      await sql().query(`CREATE TABLE IF NOT EXISTS events (
        id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, visit TEXT, account_id TEXT, business_id TEXT,
        meta JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await sql().query('CREATE INDEX IF NOT EXISTS events_name_idx ON events(name, created_at)');
    })().catch((e) => { _ready = null; throw e; });
  }
  return _ready;
}

// Never throws: tracking must not break the product.
export async function track(name, { visit = null, accountId = null, businessId = null, meta = null } = {}) {
  try {
    await ensureEventsSchema();
    await sql().query('INSERT INTO events (name, visit, account_id, business_id, meta) VALUES ($1,$2,$3,$4,$5)',
      [String(name).slice(0, 40), visit ? String(visit).slice(0, 40) : null, accountId, businessId, meta ? JSON.stringify(meta) : null]);
  } catch (e) { console.error('[track]', e.message); }
}

// The funnel over the last `days` days. Browser steps count distinct visits;
// server steps count distinct accounts or businesses.
export async function funnel(days = 30) {
  await ensureEventsSchema();
  const d = Math.max(1, Math.min(365, Number(days) || 30));
  const rows = await sql().query(`SELECT name,
      COUNT(DISTINCT COALESCE(visit, account_id, business_id, id::text))::int AS n
    FROM events WHERE created_at > now() - ($1 || ' days')::interval AND NOT (name = 'plan_paid' AND meta->>'via' = 'comp') GROUP BY name`, [String(d)]);
  const by = Object.fromEntries(rows.map((r) => [r.name, r.n]));
  const first = await sql().query('SELECT MIN(created_at) AS t FROM events');
  // What the database already shows, from before tracking began.
  const db = await sql().query(`SELECT
      (SELECT COUNT(*)::int FROM businesses WHERE created_at > now() - ($1 || ' days')::interval) AS url_entered,
      (SELECT COUNT(*)::int FROM businesses WHERE created_at > now() - ($1 || ' days')::interval AND status <> 'new') AS site_read,
      (SELECT COUNT(*)::int FROM accounts WHERE created_at > now() - ($1 || ' days')::interval AND email NOT IN ('house@squadron.tel')) AS account_created,
      (SELECT COUNT(DISTINCT account_id)::int FROM invoices WHERE kind = 'plan' AND status = 'paid' AND paid_at > now() - ($1 || ' days')::interval AND COALESCE(mercury_tx_id,'') NOT LIKE 'comp:%') AS plan_paid,
      (SELECT COUNT(*)::int FROM teams t JOIN businesses b ON b.id = t.business_id WHERE t.created_at > now() - ($1 || ' days')::interval) AS team_built,
      (SELECT COUNT(*)::int FROM businesses WHERE (channels->'chat'->>'enabled') = 'true' AND updated_at > now() - ($1 || ' days')::interval) AS chat_deployed`, [String(d)]).catch(() => [{}]);
  return {
    days: d,
    trackingSince: first[0] && first[0].t,
    steps: STEPS.map(([key, label]) => ({ key, label, tracked: by[key] || 0, database: key === 'landing' ? null : (db[0][key] ?? null) })),
    extra: { pay_view: by.pay_view || 0, pay_click: by.pay_click || 0, first_answer: by.first_answer || 0 },
  };
}

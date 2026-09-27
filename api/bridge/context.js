// /api/bridge/context?number=+1... — tells the bridge which business answers
// an inbound number and what to say before the stream starts.
import { bad } from '../_lib/db.js';
import { loadProfile } from '../_lib/db.js';
import { checkSecret, ensureBridgeSchema, businessForNumber } from '../_lib/bridge.js';
import { applyCorrections } from '../_lib/profile.js';
import { usageFor } from '../_lib/usage.js';
import { placeHold, maxVoiceSeconds, ledgerStatus, settleHold } from '../_lib/ledger.js';

const CALL_CAP_SECONDS = 20 * 60;
const DEMO_CAP_SECONDS = 10 * 60;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!checkSecret(req)) return bad(res, 401, 'unauthorized');
  const number = String(req.query?.number || '');
  if (!number) return bad(res, 400, 'number required');
  try {
    const out = await callContext(number, String(req.query?.callSid || ''));
    if (out.error) return bad(res, 400, out.error);
    return res.status(200).json(out);
  } catch (e) {
    console.error('[bridge/context]', e);
    return bad(res, 500, e.message);
  }
}

// Which business answers a number, and the prepaid hold for this call.
export async function callContext(number, callSid) {
  {
    await ensureBridgeSchema();
    const hit = await businessForNumber(number);
    if (!hit) return { ok: false, reason: 'unassigned' };
    const prow = await loadProfile(hit.biz.id);
    const profile = prow ? applyCorrections(prow.profile, prow.corrections) : null;
    const name = profile?.company?.name?.value || hit.biz.input_value;
    if (!hit.demo && !(hit.biz.channels && hit.biz.channels.phone && hit.biz.channels.phone.enabled)) return { ok: false, reason: 'phone channel off' };
    // Prepaid only: a call starts only when the account's remaining prepaid
    // budget (and, for live calls, its included minutes) covers at least one
    // minute. The call is capped at what is left, and a hold for that worst
    // case is placed before the call is connected.
    const u = await usageFor(hit.biz.id);
    if (!u.active) return { ok: false, reason: 'paused' };
    const limit = maxVoiceSeconds(u, { capSeconds: hit.demo ? DEMO_CAP_SECONDS : CALL_CAP_SECONDS, countsMinutes: !hit.demo });
    if (limit < 60) return { ok: false, reason: 'paused' };
    if (!/^CA[0-9a-f]{32}$/i.test(callSid)) return { error: 'callSid required' };
    const ref = `call:${callSid}`;
    await placeHold({ accountId: u.accountId, businessId: hit.biz.id, kind: hit.demo ? 'phone-demo' : 'phone', maxSeconds: limit, countsMinutes: !hit.demo, ref });
    const after = await ledgerStatus(u.accountId);
    if (after.spentCents > after.budgetCents || (!hit.demo && after.minutesUsed > after.minutesIncluded)) {
      await settleHold(ref, { cents: 0, seconds: 0 });
      return { ok: false, reason: 'paused' };
    }
    return { ok: true, businessId: hit.biz.id, businessName: name, demo: hit.demo, limitSeconds: limit, holdRef: ref };
  }
}

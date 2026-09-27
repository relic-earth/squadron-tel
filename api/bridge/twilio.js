// /api/bridge/twilio — call controls for the bridge (start recording,
// transfer to the on-call person, hang up at the prepaid limit), so the
// bridge never holds Twilio credentials.
import { bad, readJson } from '../_lib/db.js';
import { checkSecret } from '../_lib/bridge.js';

const ORIGIN = (process.env.PUBLIC_ORIGIN || 'https://www.squadron.tel').replace(/\/$/, '');
function xml(s) { return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }

async function twilio(path, params) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
  const t = await r.text();
  if (!r.ok) throw new Error(`Twilio ${r.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!checkSecret(req)) return bad(res, 401, 'unauthorized');
  const b = readJson(req);
  const callSid = String(b.callSid || '');
  if (!/^CA[0-9a-f]{32}$/i.test(callSid)) return bad(res, 400, 'callSid required');
  try {
    if (b.action === 'record') {
      await twilio(`/Calls/${callSid}/Recordings.json`, { RecordingStatusCallback: `${ORIGIN}/api/bridge/recording?secret=${encodeURIComponent(process.env.BRIDGE_SECRET)}&businessId=${encodeURIComponent(String(b.businessId || ''))}`, RecordingStatusCallbackEvent: 'completed', RecordingChannels: 'dual' });
    } else if (b.action === 'transfer') {
      if (!/^\+?[0-9 ()-]{7,20}$/.test(String(b.target || ''))) return bad(res, 400, 'target required');
      await twilio(`/Calls/${callSid}.json`, { Twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Connecting you now.</Say><Dial>${xml(b.target)}</Dial></Response>` });
    } else if (b.action === 'hangup') {
      try { await twilio(`/Calls/${callSid}.json`, { Twiml: '<?xml version="1.0" encoding="UTF-8"?><Response><Say>This call has reached its time limit. Goodbye.</Say><Hangup/></Response>' }); }
      catch { await twilio(`/Calls/${callSid}.json`, { Status: 'completed' }); }
    } else return bad(res, 400, 'unknown action');
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[bridge/twilio]', e.message);
    return bad(res, 502, e.message);
  }
}

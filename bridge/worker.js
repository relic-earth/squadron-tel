// Squadron phone bridge for Cloudflare Workers (free plan).
// The Worker answers Twilio's voice webhook; each call's media stream is
// handled by a Durable Object so every audio event gets its own CPU budget.
// Behaviour matches server.js (the Node version): AI and recording notice
// before the stream, barge-in, and tools for knowledge lookup, messages,
// gaps and transfer.

function xml(s) { return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }

const enc = new TextEncoder();
function b64(buf) { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); }
async function hmac(alg, key, data) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: alg }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
function same(a, b) { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// Twilio signs each webhook: HMAC-SHA1 of the full URL plus the sorted POST
// parameters, keyed with the account auth token.
async function validTwilio(env, url, form, signature) {
  if (!env.TWILIO_AUTH_TOKEN || !signature) return false;
  const keys = [...new Set([...form.keys()])].sort();
  let data = url;
  for (const k of keys) for (const v of form.getAll(k)) data += k + v;
  return same(await hmac('SHA-1', env.TWILIO_AUTH_TOKEN, data), signature);
}

// A stream ticket proves the media stream was started by our own verified
// voice webhook, so nobody can open an AI session by connecting to /media.
async function ticket(env, businessId, callSid, demo, exp, limit, hold) {
  return hmac('SHA-256', env.BRIDGE_SECRET || '', `${businessId}|${callSid}|${demo}|${exp}|${limit}|${hold}`);
}

async function vercel(env, path, body) {
  const origin = (env.SQUADRON_ORIGIN || 'https://www.squadron.tel').replace(/\/$/, '');
  const r = await fetch(`${origin}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-bridge-secret': env.BRIDGE_SECRET }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function twilio(env, path, params) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) throw new Error('Twilio credentials are not configured');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}${path}`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Twilio ${path} ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, runtime: 'cloudflare-workers' });
    if (url.pathname === '/twilio/voice' && request.method === 'POST') {
      const form = new URLSearchParams(await request.text());
      if (!(await validTwilio(env, request.url, form, request.headers.get('X-Twilio-Signature')))) return new Response('Forbidden', { status: 403 });
      const to = form.get('To'), from = form.get('From'), callSid = form.get('CallSid');
      let ctx = null;
      try { ctx = await vercel(env, `/api/bridge/context?number=${encodeURIComponent(to)}&callSid=${encodeURIComponent(callSid)}`); } catch (e) { console.log('context failed', e.message); }
      const headers = { 'Content-Type': 'text/xml' };
      if (!ctx || !ctx.ok) {
        const why = ctx && ctx.reason === 'paused' ? 'This business has reached its plan allowance, so its assistant is paused right now. Please try again later.' : 'This number is not assigned to a business right now. Goodbye.';
        return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xml(why)}</Say><Hangup/></Response>`, { headers });
      }
      const demoFlag = ctx.demo ? '1' : '0';
      const exp = String(Date.now() + 5 * 60 * 1000);
      const limit = String(Math.max(0, Math.floor(Number(ctx.limitSeconds) || 0)));
      const hold = String(ctx.holdRef || '');
      const tk = await ticket(env, ctx.businessId, callSid, demoFlag, exp, limit, hold);
      const notice = `This call is answered by an A I agent for ${ctx.businessName}. It is recorded for quality.`;
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xml(notice)}</Say><Connect><Stream url="wss://${url.host}/media"><Parameter name="businessId" value="${xml(ctx.businessId)}"/><Parameter name="callSid" value="${xml(callSid)}"/><Parameter name="from" value="${xml(from)}"/><Parameter name="to" value="${xml(to)}"/><Parameter name="demo" value="${demoFlag}"/><Parameter name="exp" value="${exp}"/><Parameter name="limit" value="${limit}"/><Parameter name="hold" value="${xml(hold)}"/><Parameter name="ticket" value="${xml(tk)}"/></Stream></Connect></Response>`, { headers });
    }
    if (url.pathname === '/media') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const id = env.CALLS.newUniqueId();
      return env.CALLS.get(id).fetch(request);
    }
    return new Response('Not found', { status: 404 });
  },
};

export class CallSession {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, tw] = Object.values(pair);
    tw.accept();
    this.run(tw).catch((e) => console.log('call error', e.message));
    return new Response(null, { status: 101, webSocket: client });
  }

  async run(tw) {
    const env = this.env;
    const usage = { input_token_details: { text_tokens: 0, audio_tokens: 0, cached_tokens: 0, cached_tokens_details: { text_tokens: 0, audio_tokens: 0 } }, output_token_details: { text_tokens: 0, audio_tokens: 0 } };
    const addUsage = (u) => { if (!u) return; const i = u.input_token_details || {}, o = u.output_token_details || {}, c = i.cached_tokens_details || {}; usage.input_token_details.text_tokens += i.text_tokens || 0; usage.input_token_details.audio_tokens += i.audio_tokens || 0; usage.input_token_details.cached_tokens += i.cached_tokens || 0; usage.input_token_details.cached_tokens_details.text_tokens += c.text_tokens || 0; usage.input_token_details.cached_tokens_details.audio_tokens += c.audio_tokens || 0; usage.output_token_details.text_tokens += o.text_tokens || 0; usage.output_token_details.audio_tokens += o.audio_tokens || 0; };
    let verified = false, holdRef = null, limitMs = 0, limitTimer = null, model = env.REALTIME_MODEL || 'gpt-realtime-2.1-mini', streamSid = null, callSid = null, businessId = null, demo = false, ctx = null, oai = null, oaiReady = false, closed = false;
    const transcript = [], gaps = [], messages = [];
    let transferRequested = false;
    const startedAt = Date.now();
    let lastAssistantItem = null, responseStartTs = null, latestMediaTs = 0;
    const sendTw = (o) => { try { tw.send(JSON.stringify(o)); } catch {} };
    const sendOai = (o) => { if (oai && oaiReady) try { oai.send(JSON.stringify(o)); } catch {} };
    // Deepgram Aura voice (optional, per business): Realtime answers in text,
    // and Deepgram speaks it as 8 kHz mu-law straight into the phone line.
    let dg = null, ttsChars = 0, ttsModel = null;
    const sendDg = (o) => { if (dg) try { dg.send(JSON.stringify(o)); } catch {} };
    const openDeepgram = async (tts) => {
      const r = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(tts.model)}&encoding=mulaw&sample_rate=8000&container=none`, { headers: { Upgrade: 'websocket', Authorization: `Bearer ${tts.token}` } });
      const s = r.webSocket;
      if (!s) throw new Error(`Deepgram did not accept the WebSocket (${r.status})`);
      s.accept();
      s.addEventListener('message', (m) => {
        if (typeof m.data === 'string') return;
        if (streamSid) { sendTw({ event: 'media', streamSid, media: { payload: b64(m.data) } }); if (responseStartTs == null) responseStartTs = latestMediaTs; }
      });
      s.addEventListener('close', () => { if (dg === s) dg = null; });
      ttsModel = tts.model;
      return s;
    };

    // Opens an OpenAI Realtime session for the call. as = 'front' starts the
    // team at the Front Desk; as = 'manager' hands the live call to Overwatch,
    // the general manager, on a fresh session in its own voice.
    const openOpenAI = async (as = 'front', handoff = null) => {
      const next = await vercel(env, `/api/bridge/session?businessId=${encodeURIComponent(businessId)}&model=${encodeURIComponent(model)}${as === 'manager' ? '&as=manager' : ''}`);
      // Squadron issues a short-lived key per session; a worker-held OPENAI_API_KEY is only a fallback.
      const key = next.clientSecret || env.OPENAI_API_KEY;
      const resp = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, { headers: { Upgrade: 'websocket', Authorization: `Bearer ${key}` } });
      const sock = resp.webSocket;
      if (!sock) throw new Error(`OpenAI did not accept the WebSocket (${resp.status})`);
      sock.accept();
      const old = oai;
      oai = sock; oaiReady = true;
      if (old) { try { old.close(); } catch {} }
      if (ctx) { next.from = ctx.from; next.to = ctx.to; }
      ctx = next;
      if (!dg && ctx.tts && ctx.tts.provider === 'deepgram' && ctx.tts.token) {
        try { dg = await openDeepgram(ctx.tts); } catch (e) { console.log('deepgram failed, using the Realtime voice', e.message); dg = null; }
      }
      const input = { format: { type: 'audio/pcmu' }, transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'semantic_vad', eagerness: 'auto', interrupt_response: true } };
      sendOai({ type: 'session.update', session: dg
        ? { type: 'realtime', instructions: ctx.session.instructions, tools: ctx.session.tools, tool_choice: 'auto', output_modalities: ['text'], audio: { input } }
        : { type: 'realtime', instructions: ctx.session.instructions, tools: ctx.session.tools, tool_choice: 'auto', audio: { input, output: { format: { type: 'audio/pcmu' }, voice: ctx.session.audio.output.voice } } } });
      if (handoff) {
        const history = transcript.slice(-16).map((t) => `${t.role === 'customer' ? 'Caller' : (t.agent_name || 'Agent')}: ${t.text}`).join('\n');
        sendOai({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: `Escalation to you, Overwatch. Reason: ${handoff}\nThe call so far:\n${history || '(no transcript yet)'}` }] } });
      }
      sendOai({ type: 'response.create' });
      sock.addEventListener('message', (m) => {
        if (sock !== oai) return; // a replaced session stays silent
        let ev; try { ev = JSON.parse(typeof m.data === 'string' ? m.data : new TextDecoder().decode(m.data)); } catch { return; }
        switch (ev.type) {
          case 'response.output_audio.delta':
            if (streamSid) { sendTw({ event: 'media', streamSid, media: { payload: ev.delta } }); if (responseStartTs == null) responseStartTs = latestMediaTs; if (ev.item_id) lastAssistantItem = ev.item_id; }
            break;
          case 'response.output_text.delta':
            if (dg && ev.delta) { sendDg({ type: 'Speak', text: ev.delta }); ttsChars += ev.delta.length; }
            break;
          case 'response.output_text.done':
            if (dg) sendDg({ type: 'Flush' });
            if (ev.text) transcript.push({ role: 'agent', text: ev.text, agent_id: ctx.agent.id, agent_name: `${ctx.agent.persona} · ${ctx.agent.title}`, at: new Date().toISOString() });
            break;
          case 'response.done':
            addUsage(ev.response && ev.response.usage);
            break;
          case 'response.output_audio_transcript.done':
            if (ev.transcript) transcript.push({ role: 'agent', text: ev.transcript, agent_id: ctx.agent.id, agent_name: `${ctx.agent.persona} · ${ctx.agent.title}`, at: new Date().toISOString() });
            break;
          case 'conversation.item.input_audio_transcription.completed':
            if (ev.transcript && ev.transcript.trim()) transcript.push({ role: 'customer', text: ev.transcript.trim(), at: new Date().toISOString() });
            break;
          case 'input_audio_buffer.speech_started':
            if (dg) { sendOai({ type: 'response.cancel' }); sendDg({ type: 'Clear' }); }
            if (lastAssistantItem && responseStartTs != null) sendOai({ type: 'conversation.item.truncate', item_id: lastAssistantItem, content_index: 0, audio_end_ms: Math.max(0, latestMediaTs - responseStartTs) });
            if (streamSid) sendTw({ event: 'clear', streamSid });
            lastAssistantItem = null; responseStartTs = null;
            break;
          case 'response.function_call_arguments.done':
            this.state.waitUntil(handleTool(ev).catch((e) => console.log('tool error', e.message)));
            break;
          case 'error':
            console.log('openai error', JSON.stringify(ev.error || ev).slice(0, 300));
            break;
        }
      });
      sock.addEventListener('close', () => { if (sock === oai) oaiReady = false; });
    };
    let escalated = false;

    const handleTool = async (ev) => {
      let args = {}; try { args = JSON.parse(ev.arguments || '{}'); } catch {}
      let output = { ok: true };
      if (ev.name === 'lookup_knowledge') {
        try { const r = await vercel(env, '/api/bridge/event', { businessId, callSid, type: 'lookup', query: args.query }); output = { ok: true, results: r.results }; } catch (e) { output = { ok: false, note: e.message }; }
      } else if (ev.name === 'take_message') {
        messages.push({ message: args.message, contact: args.contact }); if (args.question) gaps.push(args.question);
        output = { ok: true, note: 'The message is recorded. Tell the caller a person will follow up.' };
      } else if (ev.name === 'log_gap') {
        if (args.question) gaps.push(args.question);
      } else if (ev.name === 'escalate_to_manager') {
        if (escalated) { output = { ok: false, note: 'Overwatch already has this call.' }; }
        else {
          escalated = true;
          // Swap the live call to Overwatch; the old session is closed, so no tool output goes back to it.
          lastAssistantItem = null; responseStartTs = null;
          try { await openOpenAI('manager', args.reason || 'The caller asked for a manager.'); return; }
          catch (e) { console.log('escalation failed', e.message); escalated = false; output = { ok: false, note: 'Overwatch could not be reached. Say so, then offer to escalate to a person or take a message.' }; }
        }
      } else if (ev.name === 'request_transfer') {
        transferRequested = true;
        const target = ctx.settings && ctx.settings.on_call_phone;
        if (target && !demo) {
          output = { ok: true, note: 'Say one short sentence that you are transferring now, then stop speaking.' };
          setTimeout(() => twilio(env, `/Calls/${callSid}.json`, { Twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Connecting you now.</Say><Dial>${xml(target)}</Dial></Response>` }).catch((e) => console.log('transfer failed', e.message)), 4000);
        } else {
          output = { ok: false, note: demo ? 'This is a demo call, so no transfer is possible. Say so and offer to take a message.' : 'No on-call number is set for this business. Say that no one is available to transfer to right now and offer to take a message.' };
        }
      }
      sendOai({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output: JSON.stringify(output) } });
      sendOai({ type: 'response.create' });
    };

    const endForLimit = async () => {
      if (closed || !callSid) return;
      try { await twilio(env, `/Calls/${callSid}.json`, { Twiml: '<?xml version="1.0" encoding="UTF-8"?><Response><Say>This call has reached its time limit. Goodbye.</Say><Hangup/></Response>' }); }
      catch (e) { console.log('limit hangup failed', e.message); try { await twilio(env, `/Calls/${callSid}.json`, { Status: 'completed' }); } catch {} }
      setTimeout(() => this.state.waitUntil(finish()), 12000);
    };

    const finish = async () => {
      if (closed) return; closed = true;
      if (limitTimer) clearTimeout(limitTimer);
      try { if (oai) oai.close(); } catch {}
      try { if (dg) { dg.send(JSON.stringify({ type: 'Close' })); dg.close(); } } catch {}
      if (!verified) return;
      try {
        await vercel(env, '/api/bridge/call-ended', { businessId, callSid, from: ctx && ctx.from, demo, transcript, gaps, messages, transferRequested, durationS: Math.round((Date.now() - startedAt) / 1000), holdRef, model, usage, ttsChars, ttsModel, agentId: ctx && ctx.agent.id, agentName: ctx && `${ctx.agent.persona} · ${ctx.agent.title}` });
      } catch (e) { console.log('call-ended failed', e.message); }
    };

    tw.addEventListener('message', (m) => {
      let msg; try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        const p = msg.start.customParameters || {};
        businessId = p.businessId; callSid = p.callSid || msg.start.callSid; demo = p.demo === '1';
        this.state.waitUntil(ticket(env, p.businessId, p.callSid, p.demo, p.exp, p.limit, p.hold).then((want) => {
          if (!env.BRIDGE_SECRET || !same(want, p.ticket) || !(Number(p.exp) > Date.now()) || p.callSid !== msg.start.callSid || !(Number(p.limit) >= 60)) throw new Error('invalid stream ticket');
          verified = true;
          holdRef = p.hold; limitMs = Number(p.limit) * 1000;
          // Hard stop at the prepaid limit: end the call even if nothing else does.
          limitTimer = setTimeout(() => { this.state.waitUntil(endForLimit()); }, Math.max(0, limitMs - 15000));
          return openOpenAI();
        }).then(() => {
          ctx.from = p.from; ctx.to = p.to;
          const origin = (env.SQUADRON_ORIGIN || 'https://www.squadron.tel').replace(/\/$/, '');
          return twilio(env, `/Calls/${callSid}/Recordings.json`, { RecordingStatusCallback: `${origin}/api/bridge/recording?secret=${encodeURIComponent(env.BRIDGE_SECRET)}&businessId=${encodeURIComponent(businessId)}`, RecordingStatusCallbackEvent: 'completed', RecordingChannels: 'dual' }).catch((e) => console.log('recording failed', e.message));
        }).catch((e) => { console.log('session failed', e.message); try { tw.close(1011, 'session failed'); } catch {} }));
      } else if (msg.event === 'media') {
        latestMediaTs = Number(msg.media.timestamp) || latestMediaTs;
        sendOai({ type: 'input_audio_buffer.append', audio: msg.media.payload });
      } else if (msg.event === 'stop') {
        this.state.waitUntil(finish());
      }
    });
    tw.addEventListener('close', () => this.state.waitUntil(finish()));
  }
}

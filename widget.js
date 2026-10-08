// Squadron chat widget. Include on any page:
// <script src="https://squadron.tel/widget.js" data-business="biz_..." async></script>
// The business's human layer (Deploy screen) decides whether customers see a
// "Talk to a person" option, a choice at the start, or the AI team only.
(function () {
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var business = script && script.getAttribute('data-business');
  // squadron.tel redirects to www, and a redirected preflight fails, so the API is always called on www.
  var origin = ((script && script.src || '').replace(/\/widget\.js.*$/, '') || 'https://www.squadron.tel').replace('https://squadron.tel', 'https://www.squadron.tel');
  var site = script && script.getAttribute('data-site');
  if (!business && site) {
    // Install by domain: look up the team, then load the widget with its ID.
    fetch(origin + '/api/handoff?site=' + encodeURIComponent(site))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.businessId) return;
        var s2 = document.createElement('script');
        s2.src = script.src; s2.async = true; s2.setAttribute('data-business', j.businessId);
        var c = script.getAttribute('data-color'); if (c) s2.setAttribute('data-color', c);
        document.body.appendChild(s2);
      })
      .catch(function () {});
    return;
  }
  if (!business) return;
  var accent = script.getAttribute('data-color') || '#1F5FD1';
  var conversationId = null, open = false, busy = false, agent = null, mode = 'ai_first', person = null, started = false, lastAsk = '';
  var greeting = null, starters = [], greeted = false, info = null, KEY = 'sqw:' + business, log = [];

  var css = '\
.sqw-btn{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:64px;height:64px;border-radius:50%;border:none;cursor:pointer;background:' + accent + ';box-shadow:0 8px 28px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center}\
.sqw-btn svg{width:30px;height:30px;fill:#fff}\
.sqw-box{position:fixed;right:20px;bottom:96px;z-index:2147483000;width:420px;max-width:calc(100vw - 40px);height:600px;max-height:calc(100vh - 120px);transition:height .35s ease,width .35s ease;background:#0B1E45;color:#fff;border-radius:6px;box-shadow:0 20px 60px rgba(0,0,0,0.5);display:none;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,sans-serif}\
.sqw-box.open{display:flex}\
.sqw-box.tall{height:880px;width:480px}\
.sqw-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.12)}\
.sqw-head img{width:40px;height:40px;border-radius:4px;object-fit:cover;background:#10295C}\
.sqw-head .sqw-id{flex:1;min-width:0}\
.sqw-head b{display:block;font-size:18px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.sqw-head small{display:block;font-size:14px;color:#D2D8EA;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.sqw-person{font:inherit;font-size:14px;font-weight:800;padding:9px 12px;border-radius:999px;border:1px solid rgba(255,255,255,0.45);background:transparent;color:#fff;cursor:pointer;white-space:nowrap}\
.sqw-person:hover{background:#fff;color:#0B1E45}\
.sqw-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}\
.sqw-m{max-width:88%;padding:11px 14px;border-radius:6px;font-size:17px;line-height:1.45;background:rgba(255,255,255,0.1);white-space:pre-wrap;word-break:break-word}\
.sqw-m.me{align-self:flex-end;background:' + accent + ';color:#fff;font-weight:600}\
.sqw-m.note{background:rgba(181,71,8,0.16);border:1px solid rgba(181,71,8,0.55);font-size:16px}\
.sqw-choice{display:flex;flex-direction:column;gap:8px}\
.sqw-choice button{font:inherit;font-size:17px;font-weight:800;padding:14px 16px;border-radius:6px;border:1px solid rgba(255,255,255,0.35);background:rgba(255,255,255,0.06);color:#fff;cursor:pointer;text-align:left}\
.sqw-choice button.pri{background:' + accent + ';color:#fff;border-color:' + accent + '}\
.sqw-choice small{display:block;font-size:14px;font-weight:600;opacity:0.85;margin-top:2px}\
.sqw-hf{display:flex;flex-direction:column;gap:8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.2);border-radius:6px;padding:14px}\
.sqw-hf b{font-size:17px}\
.sqw-hf input,.sqw-hf textarea{font:inherit;font-size:16px;padding:11px 12px;border-radius:4px;border:1px solid rgba(255,255,255,0.3);background:rgba(0,0,0,0.15);color:#fff;outline:none}\
.sqw-hf textarea{min-height:70px;resize:vertical}\
.sqw-hf button{font:inherit;font-weight:800;font-size:16px;padding:12px;border-radius:4px;border:none;background:' + accent + ';color:#fff;cursor:pointer}\
.sqw-hf .sqw-err{color:#FFB3AF;font-size:14px;font-weight:600;min-height:0}\
.sqw-form{display:flex;gap:8px;padding:12px;border-top:1px solid rgba(255,255,255,0.12)}\
.sqw-form input{flex:1;font:inherit;font-size:17px;padding:12px 14px;border-radius:4px;border:2px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.06);color:#fff;outline:none;min-width:0}\
.sqw-form button{font:inherit;font-weight:800;font-size:16px;padding:0 18px;border-radius:4px;border:none;background:' + accent + ';color:#fff;cursor:pointer}\
.sqw-m a{color:inherit;font-weight:800;text-decoration:underline}\
.sqw-x{font:inherit;font-size:26px;line-height:1;width:36px;height:36px;border-radius:50%;border:none;background:transparent;color:#fff;cursor:pointer;flex:none}\
.sqw-x:hover{background:rgba(255,255,255,0.12)}\
.sqw-m.typing{color:#C3CAE0;letter-spacing:2px}\
.sqw-chips{display:flex;flex-wrap:wrap;gap:8px}\
.sqw-chips button{font:inherit;font-size:15px;font-weight:700;padding:9px 13px;border-radius:999px;border:1px solid rgba(255,255,255,0.4);background:transparent;color:#fff;cursor:pointer;text-align:left}\
.sqw-chips button:hover{background:#fff;color:#0B1E45}\
@media(max-width:480px){.sqw-head{padding:12px 12px}.sqw-person{padding:8px 10px;font-size:13px}.sqw-box{right:10px;left:10px;width:auto;max-width:none;bottom:86px;height:calc(100vh - 106px)}.sqw-box.tall{width:auto;height:calc(100vh - 106px)}}\
.sqw-foot{font-size:13px;color:#C3CAE0;text-align:center;padding:0 12px 10px}';
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  var btn = document.createElement('button'); btn.className = 'sqw-btn'; btn.setAttribute('aria-label', 'Chat with us');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>';
  var box = document.createElement('div'); box.className = 'sqw-box'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Customer service chat');
  box.innerHTML = '<div class="sqw-head"><img alt="" id="sqw-avatar"><div class="sqw-id"><b id="sqw-name">Customer service</b><small id="sqw-sub">AI agent \u00b7 answers from what this business publishes</small></div><button type="button" class="sqw-person" id="sqw-person" hidden>Talk to a person</button><button type="button" class="sqw-x" id="sqw-x" aria-label="Close chat">\u00d7</button></div><div class="sqw-msgs" id="sqw-msgs" aria-live="polite"></div><form class="sqw-form" id="sqw-form"><input id="sqw-in" placeholder="Ask a question" autocomplete="off" aria-label="Your message"><button type="submit">Send</button></form><div class="sqw-foot" id="sqw-foot">Powered by Squadron. You are chatting with an AI agent.</div>';
  document.body.appendChild(btn); document.body.appendChild(box);
  var msgs = box.querySelector('#sqw-msgs'), input = box.querySelector('#sqw-in'), personBtn = box.querySelector('#sqw-person');

  function grow() { if (msgs.scrollHeight > msgs.clientHeight + 8) box.classList.add('tall'); }
  // Messages are plain text; web addresses become links that open in a new tab.
  function add(text, cls) {
    var d = document.createElement('div'); d.className = 'sqw-m ' + (cls || '');
    String(text).split(/(https?:\/\/[^\s<>"')]+)/).forEach(function (part, i) {
      if (i % 2) { var a = document.createElement('a'); a.href = part.replace(/[.,;:]+$/, ''); a.target = '_blank'; a.rel = 'noopener'; a.textContent = part; d.appendChild(a); }
      else if (part) d.appendChild(document.createTextNode(part));
    });
    msgs.appendChild(d); grow(); msgs.scrollTop = 1e9;
    if (cls !== 'typing') { log.push([String(text), cls || '']); save(); }
    return d;
  }
  // The conversation survives moving between pages of the business's site
  // (sessionStorage only: it ends when the tab closes, nothing is tracked).
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify({ c: conversationId, l: log.slice(-60), o: open, s: started, g: greeted, a: agent })); } catch (e) {} }
  function restore() {
    try {
      var x = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (!x || !x.l || !x.l.length) return false;
      conversationId = x.c || null; started = !!x.s; greeted = !!x.g; agent = x.a || null;
      x.l.forEach(function (m) { add(m[0], m[1]); });
      if (agent) showAgent(agent);
      if (x.o) { open = true; box.classList.add('open'); }
      return true;
    } catch (e) { return false; }
  }
  function showAgent(a) {
    box.querySelector('#sqw-name').textContent = a.persona + (a.title ? ' \u00b7 ' + a.title : '');
    if (a.portrait) box.querySelector('#sqw-avatar').src = (/cdn\.midjourney\.com\/([0-9a-f-]{36})\//.test(a.portrait) ? origin + '/portraits/' + RegExp.$1 + '.webp' : (/^\//.test(a.portrait) ? origin + a.portrait : a.portrait));
  }
  function chips(list) {
    var old = msgs.querySelector('.sqw-chips'); if (old) old.remove();
    if (!list || !list.length) return;
    var c = el('div', { 'class': 'sqw-chips' });
    list.forEach(function (q) { var b = el('button', { type: 'button' }, q); b.addEventListener('click', function () { c.remove(); send(q); }); c.appendChild(b); });
    msgs.appendChild(c); msgs.scrollTop = 1e9;
  }
  function el(tag, attrs, text) { var e = document.createElement(tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (text) e.textContent = text; return e; }

  function personForm(prefill) {
    var old = msgs.querySelector('.sqw-hf'); if (old) old.remove();
    var f = el('form', { 'class': 'sqw-hf' });
    f.appendChild(el('b', {}, 'Talk to ' + (person || 'a person')));
    var n = el('input', { placeholder: 'Your name', autocomplete: 'name', 'aria-label': 'Your name' });
    var c = el('input', { placeholder: 'Email or phone number', autocomplete: 'email', 'aria-label': 'Email or phone number', required: 'required' });
    var m = el('textarea', { placeholder: 'What do you need?', 'aria-label': 'What do you need?' }); m.value = prefill || '';
    var e = el('div', { 'class': 'sqw-err' });
    var b = el('button', { type: 'submit' }, 'Send to a person');
    f.appendChild(n); f.appendChild(c); f.appendChild(m); f.appendChild(e); f.appendChild(b);
    f.addEventListener('submit', function (ev) {
      ev.preventDefault(); e.textContent = ''; b.disabled = true; b.textContent = 'Sending';
      fetch(origin + '/api/handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: business, conversationId: conversationId, name: n.value, contact: c.value, message: m.value }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (!x.ok) { e.textContent = x.j.error || 'That did not send. Please try again.'; b.disabled = false; b.textContent = 'Send to a person'; return; }
          conversationId = x.j.conversationId || conversationId; f.remove(); add(x.j.reply, 'note');
          if (mode !== 'person_first') add('You can keep chatting with the AI team here while you wait.');
        })
        .catch(function () { e.textContent = 'Could not reach the business. Please try again.'; b.disabled = false; b.textContent = 'Send to a person'; });
    });
    msgs.appendChild(f); msgs.scrollTop = 1e9; c.focus();
  }

  function send(text, silent) {
    if (!text || busy) return;
    busy = true; var oc = msgs.querySelector('.sqw-chips'); if (oc) oc.remove(); if (!silent) { add(text, 'me'); lastAsk = text; } input.value = '';
    var typing = add('\u2026', 'typing');
    fetch(origin + '/api/converse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: business, conversationId: conversationId, message: text, channel: 'chat', greeted: greeted && !conversationId }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        typing.remove();
        if (!x.ok) {
          add(x.j.error || 'Something went wrong. Please try again.', 'note');
          if (mode !== 'ai_only') personForm(lastAsk);
          return;
        }
        conversationId = x.j.conversationId; save();
        if (x.j.agent) { agent = Object.assign({}, agent || {}, x.j.agent, { portrait: x.j.agent.portrait || (agent && agent.portrait) }); showAgent(agent); save(); }
        add(x.j.reply);
        var rt = x.j.replyType;
        var done = function () { if ((rt === 'transfer' && mode !== 'ai_only') || rt === 'take_message') personForm(x.j.messageForOwner || lastAsk); };
        if (x.j.followUp) { var fu = x.j.followUp; var t2 = add('\u2026', 'typing'); setTimeout(function () { t2.remove(); add(fu); done(); }, 900); } else done();
      })
      .catch(function () { typing.remove(); add('Could not reach the team. Please try again.', 'note'); })
      .then(function () { busy = false; });
  }

  function startAI() {
    started = true; var ch = msgs.querySelector('.sqw-choice'); if (ch) ch.remove();
    if (greeting) { greeted = true; if (info && info.agent) { agent = info.agent; showAgent(agent); } add(greeting); chips(starters); }
    else send('Hello', true); // greeting not loaded: fall back to asking the team
    input.focus();
  }
  function start() {
    if (started) return;
    if (mode === 'choice' || mode === 'person_first') {
      var box2 = el('div', { 'class': 'sqw-choice' });
      add(mode === 'person_first' ? 'You can reach ' + (person || 'a person at the business') + ' here. Leave your details and they will contact you, or ask our AI team a quick question.' : 'Choose how you want help. You can switch at any time.');
      var p = el('button', { type: 'button', 'class': mode === 'person_first' ? 'pri' : '' }); p.textContent = 'Talk to a person'; p.appendChild(el('small', {}, person ? person + ' will contact you.' : 'Someone from the business will contact you.'));
      var a = el('button', { type: 'button', 'class': mode === 'choice' ? 'pri' : '' }); a.textContent = 'Chat with the AI team'; a.appendChild(el('small', {}, 'Answers right away from what this business publishes.'));
      p.addEventListener('click', function () { started = true; box2.remove(); personForm(''); });
      a.addEventListener('click', startAI);
      if (mode === 'person_first') { box2.appendChild(p); box2.appendChild(a); } else { box2.appendChild(a); box2.appendChild(p); }
      msgs.appendChild(box2);
    } else startAI();
  }

  fetch(origin + '/api/handoff?businessId=' + encodeURIComponent(business))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return;
      info = j; mode = j.mode || 'ai_first'; person = j.person || null; greeting = j.greeting || null; starters = j.starters || [];
      if (j.agent && !agent) showAgent(j.agent);
      if (mode !== 'ai_only') personBtn.hidden = false;
      if (mode === 'person_first') box.querySelector('#sqw-sub').textContent = 'AI receptionist \u00b7 a person will contact you';
      if (mode === 'ai_only') box.querySelector('#sqw-foot').textContent = 'Powered by Squadron. You are chatting with an AI agent, and it can take a message for the business.';
    })
    .catch(function () {});

  personBtn.addEventListener('click', function () { started = true; var ch = msgs.querySelector('.sqw-choice'); if (ch) ch.remove(); personForm(lastAsk); });
  function setOpen(v) { open = v; box.classList.toggle('open', open); save(); if (open && !msgs.children.length) { if (info) start(); else setTimeout(start, 600); } if (open) setTimeout(function () { input.focus(); }, 50); }
  btn.addEventListener('click', function () { setOpen(!open); });
  box.querySelector('#sqw-x').addEventListener('click', function () { setOpen(false); btn.focus(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) { setOpen(false); btn.focus(); } });
  restore();
  box.querySelector('#sqw-form').addEventListener('submit', function (e) { e.preventDefault(); var v = input.value.trim(); if (!v) return; if (!started) { started = true; var ch = msgs.querySelector('.sqw-choice'); if (ch) ch.remove(); } send(v); });
})();

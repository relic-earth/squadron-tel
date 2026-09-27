// ace.js — Ace, Squadron's support chat, on every signed-in Squadron page.
// It answers from the Help Center and, for a signed-in customer, from their
// own account (plan, balance, invoices, channels). "Talk to a person" sends a
// request with a reference number from inside the chat. No AI model is used.
(function () {
  if (window.__ace) return; window.__ace = 1;
  var css = '#aceBtn{position:fixed;right:20px;bottom:20px;z-index:9998;display:flex;align-items:center;gap:10px;padding:14px 20px;border-radius:999px;border:none;background:#0B1E45;color:#fff;font:700 17px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(11,30,69,0.25)}' +
    '#aceBtn:hover{background:#1F5FD1}#aceBtn i{width:10px;height:10px;border-radius:50%;background:#4ADE80;display:inline-block}' +
    '#acePanel{position:fixed;right:20px;bottom:86px;z-index:9999;width:min(420px,calc(100vw - 32px));height:min(600px,calc(100vh - 120px));display:none;flex-direction:column;background:#fff;border:1px solid #DCE4EF;border-radius:16px;box-shadow:0 18px 48px rgba(11,30,69,0.22);overflow:hidden;font-family:Inter,system-ui,sans-serif}' +
    '#acePanel.open{display:flex}#aceHead{padding:16px 18px;background:#EAF2FC;border-bottom:1px solid #DCE4EF;display:flex;justify-content:space-between;align-items:center}' +
    '#aceHead b{font-size:18px;color:#0B1E45}#aceHead span{display:block;font-size:14px;color:#44536F;font-weight:500}#aceHead button{border:none;background:none;font-size:26px;line-height:1;color:#0B1E45;cursor:pointer;padding:4px 8px}' +
    '#aceMsgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}' +
    '.aceM{max-width:88%;padding:12px 14px;border-radius:14px;font-size:16px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}' +
    '.aceM.a{align-self:flex-start;background:#F5F7FA;color:#0B1E45;border:1px solid #DCE4EF}.aceM.u{align-self:flex-end;background:#1F5FD1;color:#fff}' +
    '.aceM a{color:#1F5FD1;font-weight:700}.aceM code{font-size:13px;background:#EAF2FC;padding:2px 4px;border-radius:4px;word-break:break-all}' +
    '.aceS{display:flex;flex-wrap:wrap;gap:8px}.aceS button{border:1px solid #DCE4EF;background:#fff;color:#0B1E45;border-radius:999px;padding:8px 12px;font:600 14px Inter,system-ui,sans-serif;cursor:pointer}.aceS button:hover{border-color:#1F5FD1;color:#1F5FD1}' +
    '#aceForm{display:flex;gap:8px;padding:12px;border-top:1px solid #DCE4EF}#aceIn2{flex:1;min-width:0;border:1px solid #DCE4EF;border-radius:999px;padding:12px 16px;font:500 16px Inter,system-ui,sans-serif;color:#0B1E45;outline:none}#aceIn2:focus{border-color:#1F5FD1}' +
    '#aceForm button{border:none;border-radius:999px;background:#0B1E45;color:#fff;font:700 16px Inter,system-ui,sans-serif;padding:0 18px;cursor:pointer}' +
    '@media (max-width:560px){#aceBtn{right:12px;bottom:12px;padding:12px 16px}#acePanel{right:8px;left:8px;width:auto;bottom:74px;height:calc(100vh - 100px)}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var btn = document.createElement('button'); btn.id = 'aceBtn'; btn.type = 'button'; btn.innerHTML = '<i></i>Ask Ace'; btn.setAttribute('aria-label', 'Open Squadron support chat');
  var panel = document.createElement('div'); panel.id = 'acePanel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Squadron support chat');
  panel.innerHTML = '<div id="aceHead"><div><b>Ace · Squadron Support</b><span>AI support agent. A person is one message away.</span></div><button type="button" aria-label="Close">×</button></div><div id="aceMsgs"></div><form id="aceForm"><input id="aceIn2" autocomplete="off" placeholder="Ask about your account or setup" aria-label="Your question"><button type="submit">Send</button></form>';
  document.body.appendChild(btn); document.body.appendChild(panel);
  var msgs = panel.querySelector('#aceMsgs'), sid = null, started = false, busy = false;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>'); }
  function add(text, who, link) {
    var d = document.createElement('div'); d.className = 'aceM ' + who; d.innerHTML = fmt(text);
    if (link) d.innerHTML += '\n<a href="' + esc(link) + '">' + (link.indexOf('billing') > -1 ? 'Open Billing' : link.indexOf('deploy') > -1 ? 'Open Deploy' : link.indexOf('/hq') > -1 ? 'Open Squadron HQ' : link.indexOf('account') > -1 ? 'Open your account' : 'Read more') + '</a>';
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
  }
  function chips(list) {
    if (!list || !list.length) return;
    var w = document.createElement('div'); w.className = 'aceS';
    list.forEach(function (s) { var b = document.createElement('button'); b.type = 'button'; b.textContent = s; b.onclick = function () { w.remove(); ask(s); }; w.appendChild(b); });
    msgs.appendChild(w); msgs.scrollTop = msgs.scrollHeight;
  }
  function ask(text, silent) {
    if (busy) return; busy = true;
    if (!silent) add(text, 'u');
    fetch('/api/chat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, sessionId: sid, page: location.pathname }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { sid = d.sessionId; add(d.reply, 'a', d.link); if (d.followUp) add(d.followUp, 'a'); chips(d.suggestions); })
      .catch(function () { add('I could not reach the server. A person answers at info@squadron.tel.', 'a'); })
      .then(function () { busy = false; });
  }
  function toggle() { panel.classList.toggle('open'); if (panel.classList.contains('open')) { if (!started) { started = true; ask('hi', true); } setTimeout(function () { panel.querySelector('#aceIn2').focus(); }, 50); } }
  btn.onclick = toggle; panel.querySelector('#aceHead button').onclick = toggle;
  panel.querySelector('#aceForm').onsubmit = function (e) { e.preventDefault(); var i = panel.querySelector('#aceIn2'); var v = i.value.trim(); if (!v) return; i.value = ''; ask(v); };
  window.openAce = function (q) { if (!panel.classList.contains('open')) toggle(); if (q) setTimeout(function () { ask(q); }, started ? 0 : 600); };
})();

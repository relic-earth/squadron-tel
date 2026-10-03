// funnel.js — privacy-friendly funnel events for squadron.tel. No cookies,
// no ad trackers and no fingerprinting: a random id lives only in this tab's
// sessionStorage, so a visit cannot be followed across visits or sites.
(function () {
  if (navigator.globalPrivacyControl) return;
  var visit = null;
  try { visit = sessionStorage.getItem('sqv'); if (!visit) { visit = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8); sessionStorage.setItem('sqv', visit); } } catch (e) { visit = null; }
  var sent = {};
  window.sqTrack = function (name, meta) {
    if (sent[name]) return; sent[name] = 1;
    try {
      var body = JSON.stringify({ name: name, visit: visit, meta: meta || null });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
      else fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
    } catch (e) {}
  };
  var auto = document.currentScript && document.currentScript.getAttribute('data-event');
  if (auto && !/[?&]nt=1/.test(location.search)) window.sqTrack(auto);
})();

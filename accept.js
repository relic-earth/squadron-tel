/* Squadron terms acceptance: unchecked clickwrap boxes, gated buttons, flags for the API. */
window.SQA = (function () {
  var V = '2026-10-03';
  var T = 'I am 18 or older and I agree to the <a href="/terms" target="_blank" rel="noopener" style="color:#1F5FD1;font-weight:800;text-decoration:underline">Terms of Use</a> (including binding individual arbitration, a class action and jury trial waiver, and a limitation of liability) and the <a href="/privacy" target="_blank" rel="noopener" style="color:#1F5FD1;font-weight:800;text-decoration:underline">Privacy Policy</a>.';
  var C = 'I have obtained all consents required by law (including TCPA, call-recording and AI-disclosure consents) for every person my agents contact and I will comply with those laws.';
  var W = 'Bank transfers and wires only: I understand a transfer is final, my plan is prepaid and does not renew by itself, and payments are not refunded except where the law requires.';
  var S = 'display:flex;gap:12px;align-items:flex-start;margin-top:14px;font-size:18px;line-height:1.5;color:#0B1E45;font-weight:600;cursor:pointer';
  var B = 'width:24px;height:24px;margin-top:2px;flex:none;accent-color:#1F5FD1';
  function box(id, txt) { return '<label style="' + S + '"><input type="checkbox" id="' + id + '" style="' + B + '"><span>' + txt + '</span></label>'; }
  function el(id) { return document.getElementById(id); }
  function on(id) { var e = el(id); return !!(e && e.checked); }
  return {
    V: V,
    html: function (p, o) { o = o || {}; return box(p + '_t', T) + (o.cert ? box(p + '_c', C) : '') + (o.wire ? box(p + '_w', W) : ''); },
    flags: function (p) { return { terms: on(p + '_t'), cert: on(p + '_c'), wire: on(p + '_w'), termsVersion: V }; },
    ok: function (p, o) { o = o || {}; return on(p + '_t') && (!o.cert || on(p + '_c')) && (!o.wire || on(p + '_w')); },
    bind: function (p, sel, o) {
      function u() { var ok = SQA.ok(p, o); document.querySelectorAll(sel).forEach(function (b) { b.disabled = !ok; b.style.opacity = ok ? '' : '.5'; }); }
      ['_t', '_c', '_w'].forEach(function (s) { var e = el(p + s); if (e) e.addEventListener('change', u); });
      u();
    }
  };
})();

/* brands.js — which product a visitor is using: Squadron, Frontdesk or
   Switchboard. All three run on the same engine; each can be a business of
   its own on its own domain. To give one its own website, add the domain to
   `domains` below and point the domain at this Vercel project.

   The brand is decided by, in order: the domain, a ?brand= link, the landing
   page the visitor came through (/frontdesk, /switchboard), and what this tab
   chose earlier. Squadron is the default. */
(function () {
  var BRANDS = {
    squadron: { key: 'squadron', name: 'Squadron', edition: null, accent: '#1F5FD1', domains: ['squadron.tel', 'www.squadron.tel'],
      tagline: 'Your website, turned into a customer-service team.' },
    frontdesk: { key: 'frontdesk', name: 'Frontdesk', edition: 'frontdesk', accent: '#0F7B5F', domains: [],
      tagline: 'An AI receptionist that answers every call and chat, books visits and takes messages.' },
    switchboard: { key: 'switchboard', name: 'Switchboard', edition: 'switchboard', accent: '#6B3FD1', domains: [],
      tagline: 'An AI operator that puts every caller through to the right department or person.' },
  };
  function pick() {
    var host = location.hostname.replace(/^www\./, '');
    for (var k in BRANDS) if (BRANDS[k].domains.some(function (d) { return d.replace(/^www\./, '') === host; }) && k !== 'squadron') return k;
    var q = (location.search.match(/[?&]brand=([a-z]+)/) || [])[1];
    if (q && BRANDS[q]) return q;
    var path = location.pathname.replace(/\/+$/, '');
    if (path === '/frontdesk' || path === '/switchboard') return path.slice(1);
    try { var s = sessionStorage.getItem('sqBrand'); if (s && BRANDS[s]) return s; } catch (e) {}
    return 'squadron';
  }
  var key = pick();
  try { sessionStorage.setItem('sqBrand', key); } catch (e) {}
  window.SQ_BRANDS = BRANDS;
  window.SQ_BRAND = BRANDS[key];
})();

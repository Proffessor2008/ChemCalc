const CACHE_NAME = 'chemcalc-v29';
const COMMUNITY_PACKAGE = './data/reaction-rules-community.json';
const CORE = [
  './', './index.html', './styles.css', './manifest.webmanifest', './icons/icon-192.svg', './icons/icon-512.svg',
  './js/auto-ui.js', './js/balancer.js', './js/checker.js', './js/clipboard.js', './js/community-ui.js', './js/dissociation.js', './js/electrolytes.js', './js/export.js', './js/history.js', './js/history-ui.js', './js/i18n.js', './js/internal-redox.js', './js/ionic.js', './js/onboarding.js', './js/parser.js', './js/periodic-card.js', './js/periodic-table.js', './js/predictor.js', './js/reaction-conditions.js', './js/redox.js', './js/redox-predictor.js', './js/redox-view.js', './js/reference-tables.js', './js/reference-ui.js', './js/stoichiometry.js', './js/stoichiometry-ui.js', './js/thermo.js', './js/thermo-panel.js', './js/ui.js',
  './data/elements.json', './data/redox-sites.json', './data/functional-groups.json', './data/solubility.json', './data/activity-series.json', './data/electronegativity.json', './data/acid-base-constants.json', './data/electrode-potentials.json', './data/thermo.json', './data/thermo-extra.json', './data/reaction-rules.json', './data/reaction-rules-final.json', './data/substances.json', COMMUNITY_PACKAGE
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('chemcalc-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname.endsWith('/data/reaction-rules-community.json')) {
    event.respondWith(fetch(request).then((response) => {
      if (!response.ok) throw new Error('Community package unavailable');
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(COMMUNITY_PACKAGE, copy)));
      return response;
    }).catch(() => caches.match(COMMUNITY_PACKAGE)));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
    }
    return response;
  }).catch(() => request.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});

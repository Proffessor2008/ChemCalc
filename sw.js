const CACHE_NAME = 'chemcalc-v34';
const COMMUNITY_PACKAGE = './data/reaction-rules-community.json';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest', './icons/icon-192.svg', './icons/icon-512.svg',
  './js/ui.js', './js/auto-ui.js', './js/community-ui.js', './js/balancer.js', './js/checker.js', './js/clipboard.js', './js/dissociation.js', './js/drafts.js', './js/electrolytes.js', './js/export.js', './js/history.js', './js/history-ui.js', './js/i18n.js', './js/internal-redox.js', './js/ionic.js', './js/onboarding.js', './js/parser.js', './js/physical-constants.js', './js/predictor.js', './js/reaction-conditions.js', './js/redox.js', './js/redox-predictor.js', './js/redox-view.js', './js/thermo-panel.js',
  './data/elements.json', './data/redox-sites.json', './data/functional-groups.json', './data/solubility.json', './data/activity-series.json', './data/acid-base-constants.json', './data/electrode-potentials.json', './data/substances.json', './data/reaction-rules.json', './data/reaction-rules-final.json', COMMUNITY_PACKAGE
];
const FULL = [
  './js/periodic-card.js', './js/periodic-table.js', './js/print-solution.js', './js/reference-tables.js', './js/reference-ui.js', './js/stoichiometry.js', './js/stoichiometry-ui.js', './js/thermo.js',
  './data/element-overrides.json', './data/electronegativity.json', './data/thermo.json', './data/thermo-extra.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

async function cacheFullSet() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.allSettled(FULL.map((url) => cache.add(url)));
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('chemcalc-') && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
    await cacheFullSet();
  })());
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

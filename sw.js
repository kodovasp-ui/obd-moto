// Service worker: offline λειτουργία + αυτόματες ενημερώσεις.
// Στρατηγική: network-first για αρχεία της εφαρμογής (πάντα φρέσκα όταν υπάρχει δίκτυο),
// fallback στην cache όταν είναι offline. Νέα έκδοση → skipWaiting + clients.claim.
importScripts('js/version.js');
const CACHE = 'obd-' + self.APP_VERSION;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/version.js', 'js/app.js', 'js/elm.js', 'js/pids.js', 'js/safety.js',
  'js/transport-ble.js', 'js/transport-sim.js', 'js/chart.js', 'js/session.js', 'js/db.js',
  'js/health.js', 'js/dtc-kb.js', 'js/assistant.js', 'js/ecu-db.js',
  'js/dtc-generic.js', 'js/ecu-scan.js', 'js/mode06.js', 'js/readiness.js',
  'js/units.js', 'js/garage.js', 'js/trip.js', 'js/alerts.js', 'js/theme.js', 'js/did-scan.js', 'js/protocols.js', 'js/vin.js', 'js/battery.js', 'js/dtc-user.js', 'js/dyno.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true }))
        || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
    }
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'version') e.source.postMessage({ version: self.APP_VERSION });
});

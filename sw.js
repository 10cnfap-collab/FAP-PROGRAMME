/* Service worker — Programme scientifique FAP
   · Coquille de l'application en cache : elle s'ouvre même sans réseau.
   · Pages : réseau d'abord, cache en secours. Fichiers statiques : cache puis mise à jour en arrière-plan.
   · Les appels /api (POST) ne passent jamais par le cache : le programme hors ligne est conservé par la page elle-même.
   Changer VERSION à chaque mise à jour importante force le renouvellement du cache. */
const VERSION = 'fapprog-v5';
const SHELL = ['/', '/config.js', '/lib/programme.js', '/manifest.webmanifest',
  '/assets/logo-fap-symbole.png', '/assets/logo-fap-blanc.png',
  '/assets/app/icon-192.png', '/assets/app/icon-512.png', '/assets/app/apple-touch-icon.png', '/assets/app/favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== VERSION + '-fonts').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api')) return;
  // Polices Google : cache d'abord
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(VERSION + '-fonts').then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // Pages : réseau d'abord (programme toujours à jour), cache si hors ligne
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => { const cp = res.clone(); caches.open(VERSION).then(c => c.put('/', cp)); return res; })
      .catch(() => caches.match('/').then(r => r || caches.match(req))));
    return;
  }
  // Fichiers statiques : réponse immédiate depuis le cache, mise à jour en arrière-plan
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});

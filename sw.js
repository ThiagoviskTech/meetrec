// Service worker minimo — so existe para tornar o app instalavel (Add to Home Screen).
// Nao faz cache agressivo, entao o app sempre busca a versao mais nova online.
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { self.clients.claim(); });
self.addEventListener('fetch', () => {});


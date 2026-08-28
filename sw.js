// Troque este número toda vez que publicar uma alteração no app.
// É essa mudança de versão que dispara a atualização automática.
const CACHE_VERSION = 'v9';
const CACHE_NAME = `rede-apoio-bv-${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './argo-navis-historico.jpg',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Lora:ital,wght@0,400;0,500;1,400&display=swap'
];

// INSTALAÇÃO: baixa os arquivos novos e já assume o controle,
// sem esperar todas as abas antigas fecharem.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ATIVAÇÃO: apaga qualquer cache de versão antiga e assume
// controle imediato de todas as abas abertas.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// FETCH: tenta buscar da rede primeiro (para pegar o mais novo);
// se estiver offline, cai para o cache.
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

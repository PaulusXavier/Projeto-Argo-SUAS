// Troque este número toda vez que publicar uma alteração no app.
// É essa mudança de versão que dispara a atualização automática.
const CACHE_VERSION = 'v22';
const CACHE_NAME = `rede-apoio-bv-${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './equipe-cras-cristiana.js',
  './app.js',
  './manifest.json',
  './favicon.ico',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './argo-navis-historico.jpg',
  './argo-constellation-bg.svg',
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

// FETCH: responde com o cache IMEDIATAMENTE quando existe (app abre na hora,
// sem esperar a rede) e, ao mesmo tempo, busca a versão nova em segundo
// plano para atualizar o cache — na próxima abertura, o usuário já vê a
// versão atualizada. Se não houver cache ainda (primeira visita) ou o
// recurso não estiver na lista, espera a rede normalmente; se a rede falhar
// e não houver cache, o pedido simplesmente falha (offline sem visita prévia).
// Só GET passa pelo cache — outros métodos vão direto para a rede.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request);

      const networkUpdate = fetch(event.request)
        .then(response => {
          if (response && response.ok) {
            cache.put(event.request, response.clone());
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkUpdate;
    })
  );
});

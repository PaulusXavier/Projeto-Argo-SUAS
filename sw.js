// Troque este número toda vez que publicar uma alteração no app.
// É essa mudança de versão que dispara a atualização automática.
const CACHE_VERSION = 'v55';
const CACHE_NAME = `rede-apoio-bv-${CACHE_VERSION}`;

// Cache separado e SEM número de versão, para conteúdo pesado de fora do
// domínio do app: bibliotecas de PDF (cdnjs, baixadas na 1ª vez que a aba
// "Unificar / Converter PDF" é usada), tiles do mapa (OpenStreetMap, usados
// em vila-jardim.html) e o SDK do Firebase (gstatic, baixado na 1ª vez que a
// aba "Agenda Boa Vista 2026" configura uma sincronização). Antes, esses
// arquivos entravam no mesmo cache versionado (CACHE_NAME) e eram apagados a
// cada publicação nova — mesmo sem terem mudado — obrigando a baixar tudo de
// novo (e precisar de internet) logo após qualquer atualização do app. Como
// esse cache não leva o número da versão no nome, ele NÃO é apagado no
// "ATIVAÇÃO" abaixo e sobrevive entre publicações; só cresce (fica com
// versões mais novas de cada arquivo, sempre que a rede responde) e nunca é
// limpo automaticamente.
const RUNTIME_CACHE_NAME = 'rede-apoio-bv-runtime';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './equipe-cras-cristiana.js',
  './data.js',
  './app.js',
  './manifest.json',
  './favicon.ico',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './argo-navis-historico.jpg',
  './argo-constellation-bg.svg',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Lora:ital,wght@0,400;0,500;1,400&family=Caveat:wght@600;700&display=swap'
];

// INSTALAÇÃO: baixa os arquivos novos e já assume o controle,
// sem esperar todas as abas antigas fecharem.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ATIVAÇÃO: apaga qualquer cache de versão antiga do APP (mantendo o cache
// de runtime, que não tem número de versão) e assume controle imediato de
// todas as abas abertas.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME && key !== RUNTIME_CACHE_NAME).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// FETCH: responde IMEDIATAMENTE com o que já estiver em cache (o app abre
// na hora, sem esperar a rede) e, em paralelo, busca a versão mais nova no
// servidor para atualizar o cache silenciosamente — a próxima abertura já
// usa o conteúdo atualizado. Antes o app esperava a resposta da rede antes
// de mostrar qualquer coisa, mesmo com tudo já salvo em cache; isso deixava
// a abertura lenta em conexão ruim (3G/4G fraco), já que cada carregamento
// dependia de uma ida e volta ao servidor mesmo sem nada novo para buscar.
// A rede só decide sozinha a resposta quando o arquivo ainda não está em
// cache (primeiro acesso) ou quando o dispositivo está offline e não há
// nada salvo. Requisições que não sejam GET (ex.: chamadas às APIs de
// tradução/geocodificação/Firestore) seguem direto para a rede, sem passar
// pelo cache.
//
// Pedidos de fora do domínio do app (cdnjs, tiles do OpenStreetMap, gstatic
// do Firebase etc.) usam o RUNTIME_CACHE_NAME acima, que não é apagado a
// cada publicação; pedidos do próprio app usam o cache versionado normal.
// Endereços que NUNCA devem sair do cache primeiro: o feed de notícias do
// gov.br e os repassadores usados para lê-lo. Sem isso, a aba "Notícias do
// MDS" continuaria mostrando a lista antiga mesmo online e mesmo depois de
// tocar em "Atualizar", porque o Service Worker responderia na hora com a
// cópia salva. Aqui a rede vem primeiro e o cache só entra como reserva
// quando não há internet.
const NETWORK_FIRST_HOSTS = ['www.gov.br', 'api.allorigins.win', 'corsproxy.io', 'firestore.googleapis.com'];

// Resposta de reserva para quando NEM a rede NEM o cache têm o recurso
// pedido (ex.: primeiro acesso, offline). Sem isso, respondWith() recebia
// `undefined` nesse cenário e o navegador lançava um TypeError em vez de
// simplesmente mostrar que o recurso está indisponível.
function offlineFallback() {
  return new Response(
    'Sem conexão com a internet e nenhuma cópia salva deste conteúdo.',
    { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  );
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const isSameOrigin = event.request.url.startsWith(self.location.origin);
  const targetCacheName = isSameOrigin ? CACHE_NAME : RUNTIME_CACHE_NAME;
  const isNetworkFirst = NETWORK_FIRST_HOSTS.some(host => event.request.url.includes('://' + host + '/'));

  if (isNetworkFirst) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || offlineFallback()))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request)
        .then(response => {
          // Só guarda respostas boas. Antes, um 404 ou um erro do servidor
          // também era gravado no cache e depois servido como se fosse o
          // arquivo certo.
          if (response && (response.ok || response.type === 'opaque')) {
            const clone = response.clone();
            caches.open(targetCacheName).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached || offlineFallback());

      return cached || networkFetch;
    })
  );
});

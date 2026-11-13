// Service Worker do Argo SUAS (cache offline). Precisa ficar na raiz do site.
// O CACHE_VERSION é carimbado sozinho pelo build (scripts/build.mjs) a cada deploy:
// essa mudança de versão é o que dispara a atualização nos aparelhos. Não precisa editar.
// Arquivo novo que o app precise offline: inclua em ASSETS (e em CRITICAL_ASSETS se o app não abre sem ele).
const CACHE_VERSION = 'dev';
const CACHE_NAME = `rede-apoio-bv-${CACHE_VERSION}`;
// Cache sem número de versão para conteúdo de fora do domínio (cdnjs, tiles do mapa, SDK do Firebase):
// sobrevive entre publicações para não baixar tudo de novo a cada atualização.
const RUNTIME_CACHE_NAME = 'rede-apoio-bv-runtime';

// Sem estes o app não abre: se falharem, a instalação falha e o aparelho continua com a versão anterior.
const CRITICAL_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/argo-cerebro.js',
  './js/argo-habilidades.js',
  './js/argo-mascot.js',
  './js/auth-config.js',
  './js/corretor.js',
  './js/data.js',
  './js/datas-cras-mds.js',
  './js/equipe-cras-cristiana.js',
  './js/grafia-link.js',
  './js/login-matrix.js',
  './js/paulus.v1.js',
  './js/prazos.js'
];

// Tudo que deve ficar disponível offline desde a instalação (os não críticos que falharem são ignorados).
// O dicionário do corretor (assets/spell/) fica de fora de propósito: o próprio corretor o guarda no cache do navegador.
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './apple-touch-icon.png',
  './css/styles.css',
  './js/app.js',
  './js/argo-cerebro.js',
  './js/argo-habilidades.js',
  './js/argo-mascot.js',
  './js/auth-config.js',
  './js/corretor.js',
  './js/data.js',
  './js/datas-cras-mds.js',
  './js/equipe-cras-cristiana.js',
  './js/grafia-link.js',
  './js/login-matrix.js',
  './js/paulus.v1.js',
  './assets/cid11.json',
  './assets/conhecimento.json',
  './assets/coordenadas.json',
  './assets/img/argo-constellation-bg.svg',
  './assets/img/argo-bg-stars.svg',
  './assets/img/argo-bg-waves.svg',
  './assets/img/argo-navis-historico.jpg',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png',
  './assets/img/icon-app-anona.png',
  './assets/img/icon-app-notas.png',
  './assets/img/icon-app-toth.png',
  './assets/img/icon-app-umbrela.png',
  './assets/img/icon-app-verbus.png',
  './assets/img/icon-app-vita.png',
  './assets/img/icon-maskable-512.png',
  './assets/municipios-rr.json',
  './assets/vendor/jszip.min.js',
  './assets/vendor/mammoth.browser.min.js',
  './assets/vendor/officecrypt.js',
  './assets/vendor/pdf-lib.min.js',
  './assets/vendor/pdf.min.js',
  './assets/vendor/pdf.worker.min.js',
  './assets/vendor/pdflibcrypt.js',
  './assets/vendor/zipaes.js',
  './ferramentas/calendario-pbf.html',
  './ferramentas/equipe-tecnica-cras.html',
  './ferramentas/mapa-vila-jardim.html',
  './ferramentas/pagamento-pbf.html',
  './ferramentas/registro-atendimento-planilha.html',
  './ferramentas/rma-formulario.html',
  './js/prazos.js',
  './assets/informes/cadunico-es.pdf',
  './assets/informes/cadunico-pt.pdf',
  './assets/informes/condicionalidades-es.pdf',
  './assets/informes/condicionalidades-pt.pdf',
  './assets/informes/consulta-pbf-pt.pdf',
  './assets/informes/endereco-cras-cristiana.pdf',
  './assets/informes/enderecos-cras-boa-vista.pdf'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(async cache => {
    const baixa = url => fetch(new Request(url, { cache: 'reload' })).then(res => {
      if (!res.ok) throw new Error('Falha ao baixar ' + url + ' (' + res.status + ')');
      return cache.put(url, res);
    });
    await Promise.all(CRITICAL_ASSETS.map(baixa));
    await Promise.all(ASSETS.filter(u => !CRITICAL_ASSETS.includes(u)).map(u => baixa(u).catch(() => {})));
  }));
  // Não chama skipWaiting aqui: o app mostra o aviso "Atualizar" e pede (mensagem SKIP_WAITING) quando for seguro.
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('rede-apoio-bv-') && k !== CACHE_NAME && k !== RUNTIME_CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Endereços em que a rede vem primeiro (notícias do gov.br e repassadores); o cache só entra sem internet.
const NETWORK_FIRST_HOSTS = ['www.gov.br', 'api.allorigins.win', 'corsproxy.io', 'api.codetabs.com'];

function offlineFallback() {
  return new Response('Sem conexão com a internet e nenhuma cópia salva deste conteúdo.',
    { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // O dicionário do corretor (≈5 MB) tem cache próprio e não passa por aqui.
  if (url.origin === self.location.origin && url.pathname.includes('/assets/spell/')) return;
  // Firestore usa conexão longa (streaming): passar pelo service worker (clone + cache) podia travar a escuta. Vai direto à rede.
  if (url.hostname === 'firestore.googleapis.com') return;
  const mesmaOrigem = url.origin === self.location.origin;
  const alvo = mesmaOrigem ? CACHE_NAME : RUNTIME_CACHE_NAME;

  if (NETWORK_FIRST_HOSTS.includes(url.hostname)) {
    event.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) { const cp = res.clone(); caches.open(RUNTIME_CACHE_NAME).then(c => c.put(req, cp)); }
        return res;
      }).catch(() => caches.match(req).then(c => c || offlineFallback()))
    );
    return;
  }

  // Resposta imediata do cache e, em paralelo, busca a versão nova para a próxima abertura.
  event.respondWith(
    caches.match(req).then(cached => {
      const rede = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(alvo).then(c => c.put(req, cp)); }
        return res;
      }).catch(() => cached || (req.mode === 'navigate' ? caches.match('./index.html') : null) || offlineFallback());
      return cached || rede;
    })
  );
});

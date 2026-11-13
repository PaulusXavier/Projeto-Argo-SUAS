// Teste do fluxo de atualização do app — roda em segundos, sem dependências.
//   npm run test:atualizacao
// Extrai o bloco ATUALIZACAO de js/app.js e o executa com um navegador simulado, e confere por leitura o sw.js, o
// build e o rodapé. Garante a regra principal: versão nova NUNCA entra no meio do trabalho (só com o app trancado,
// com a pessoa tocando em "Atualizar" ou na próxima vez que trancar) e que não há ciclo de recargas.
import fs from 'node:fs';

const app = fs.readFileSync('js/app.js', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const build = fs.readFileSync('scripts/build.mjs', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('✗ ' + m); } else console.log('✓ ' + m); };

// ---------- leitura estática ----------
ok((sw.match(/\bskipWaiting\(\)/g) || []).length === 1, 'sw.js: skipWaiting() só dentro do tratador da mensagem SKIP_WAITING');
ok(/tipo === 'SKIP_WAITING'\) self\.skipWaiting\(\)/.test(sw), 'sw.js: skipWaiting só quando o app pede');
ok(/GET_VERSION/.test(sw) && /type: 'VERSION'/.test(sw), 'sw.js: responde à pergunta de versão do rodapé');
ok(/const BUILD_DATA = '[^']*';/.test(sw), 'sw.js: tem BUILD_DATA para o build carimbar');
ok(/event\.waitUntil\(new Promise/.test(sw), 'sw.js: a busca da versão nova em segundo plano usa waitUntil');
ok(/BUILD_DATA/.test(build) && /America\/Boa_Vista/.test(build), 'build.mjs: carimba a data no fuso de Boa Vista');
ok(html.includes('id="footerVersion"') && html.includes('id="footerCheckUpdate"'), 'index.html: rodapé tem a versão e o botão Verificar atualização');
ok(!/function ativarAtualizacao|ativarAtualizacao\(/.test(app), 'app.js: não sobrou o caminho antigo que ativava a versão na hora');
ok(/__argoUpdatePending && typeof argoAplicarAtualizacao === 'function'\) argoAplicarAtualizacao\(\)/.test(app), 'app.js: ao trancar, ativa a versão que espera (não só recarrega a antiga)');
ok(/addEventListener\('click', \(\) => argoAplicarAtualizacao\(\)\)/.test(app), 'app.js: o botão Atualizar do aviso usa a ativação segura');

// ---------- comportamento ----------
const i = app.indexOf('// ATUALIZACAO:inicio');
const j = app.indexOf('// ATUALIZACAO:fim');
ok(i > 0 && j > i, 'app.js: bloco ATUALIZACAO encontrado');
const bloco = app.slice(i, j);

function cenario({ emUso, waiting, getRegistration, onLine = true, storage = {} }) {
  const log = { avisos: [], toasts: 0, reloads: 0, timers: [], posted: [] };
  const root = { dataset: { locked: emUso ? 'false' : 'true' } };
  const doc = { getElementById: id => (id === 'appRoot' ? root : null) };
  const win = { location: { reload: () => { log.reloads++; } } };
  const nav = { serviceWorker: { getRegistration }, onLine };
  const sess = { getItem: k => storage[k] ?? null, setItem: (k, v) => { storage[k] = v; } };
  const fab = new Function('document', 'window', 'navigator', 'sessionStorage', 'argoAviso', 'argoShowUpdateToast', 'setTimeout', 'clearTimeout', 'log',
    bloco + '\nreturn { ARGO_UPDATE, argoUpdateEncontrada, argoAplicarAtualizacao, argoVerificarAtualizacao, argoUpdateTextoVersao };');
  const api = fab(doc, win, nav, sess, (m, t) => log.avisos.push([m, t]), () => { log.toasts++; },
    (fn, ms) => { log.timers.push(ms); return 1; }, () => {}, log);
  const w = waiting || { state: 'installed', postMessage: m => log.posted.push(m.type), addEventListener() {} };
  return { api, log, w, win };
}

{ // a) app trancado: ativa na hora, sem aviso
  const { api, log, w } = cenario({ emUso: false });
  api.argoUpdateEncontrada(w);
  ok(log.posted.join() === 'SKIP_WAITING' && log.toasts === 0, 'trancado: ativa na hora e não mostra aviso');
}
{ // b) app em uso: só avisa; NÃO ativa
  const { api, log, w } = cenario({ emUso: true });
  api.argoUpdateEncontrada(w);
  ok(log.posted.length === 0 && log.toasts === 1, 'em uso: só mostra o aviso e NÃO ativa a versão nova');
  // c) a pessoa toca em Atualizar
  api.argoAplicarAtualizacao();
  ok(log.posted.join() === 'SKIP_WAITING' && api.ARGO_UPDATE.requested === true, 'toque em Atualizar: pede a troca uma vez');
  ok(log.timers.length === 1 && log.reloads === 0, 'plano B de recarga agendado, sem recarregar antes da hora');
}
{ // d) sem versão esperando (outra aba já ativou): só recarrega
  const { api, log } = cenario({ emUso: true });
  api.argoAplicarAtualizacao();
  ok(log.reloads === 1 && log.posted.length === 0, 'sem versão esperando: recarrega para pegar a que já está ativa');
}
{ // e) trava contra ciclo de recargas: segunda tentativa em menos de 1 min não agenda recarga
  const storage = {};
  const a = cenario({ emUso: false, storage });
  a.api.argoUpdateEncontrada(a.w);
  const b = cenario({ emUso: false, storage });
  b.api.argoUpdateEncontrada(b.w);
  ok(a.log.timers.length === 1 && b.log.timers.length === 0 && b.log.posted.length === 1, 'trava: nova tentativa em menos de 1 min não agenda recarga (sem ciclo)');
}
{ // f) verificar: sem internet
  const { api, log } = cenario({ emUso: true, onLine: false, getRegistration: async () => { throw new Error('não deveria chamar'); } });
  await api.argoVerificarAtualizacao(null);
  ok(log.avisos.length === 1 && /Sem internet/.test(log.avisos[0][0]), 'verificar sem internet: avisa e não consulta nada');
}
{ // g) verificar: nada novo
  const reg = { update: async () => {}, installing: null, waiting: null };
  const { api, log } = cenario({ emUso: true, getRegistration: async () => reg });
  await api.argoVerificarAtualizacao(null);
  ok(log.avisos[0][1] === 'success' && /mais recente/.test(log.avisos[0][0]), 'verificar sem novidade: "já está na versão mais recente"');
}
{ // h) verificar: versão nova baixada
  const wk = { state: 'installed', addEventListener() {}, postMessage() {} };
  const reg = { update: async () => {}, installing: wk, waiting: null };
  const { api, log } = cenario({ emUso: true, getRegistration: async () => reg });
  await api.argoVerificarAtualizacao(null);
  ok(/Baixei uma versão nova/.test(log.avisos[0][0]), 'verificar com novidade: avisa que baixou');
}
{ // i) verificar: falha ao instalar
  const wk = { state: 'redundant', addEventListener() {}, postMessage() {} };
  const reg = { update: async () => {}, installing: wk, waiting: null };
  const { api, log } = cenario({ emUso: true, getRegistration: async () => reg });
  await api.argoVerificarAtualizacao(null);
  ok(log.avisos[0][1] === 'error', 'verificar com instalação que falhou: avisa o erro');
}
{ // j) verificar: sem rede na consulta
  const { api, log } = cenario({ emUso: true, getRegistration: async () => ({ update: async () => { throw new Error('rede'); } }) });
  await api.argoVerificarAtualizacao(null);
  ok(log.avisos[0][1] === 'error', 'verificar com falha de rede na consulta: avisa o erro');
}
{ // k) texto da versão
  const { api } = cenario({ emUso: true });
  ok(api.argoUpdateTextoVersao('b3f2a1c9', '2026-11-13') === 'Versão 3f2a1c9 · 13/11/2026', 'rodapé: "Versão 3f2a1c9 · 13/11/2026"');
  ok(api.argoUpdateTextoVersao('dev', 'dev') === 'Versão de desenvolvimento', 'rodapé: cópia sem carimbo = desenvolvimento');
}


// ---------- service worker simulado ----------
{
  const handlers = {};
  const store = new Map();
  const self_ = { location: { origin: 'https://x.test' }, addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() { self_.skipped = (self_.skipped || 0) + 1; }, clients: { claim: async () => {} } };
  const caches = {
    match: async req => store.get(req.url),
    open: async () => ({ put: async (req, res) => { await new Promise(r => setTimeout(r, 30)); store.set(req.url, res); }, addAll: async () => {} }),
    keys: async () => [], delete: async () => true
  };
  let netOk = true;
  const fetch_ = async req => { if (!netOk) throw new Error('offline'); return { ok: true, type: 'basic', url: req.url, tag: 'novo', clone() { return { ok: true, type: 'basic', url: req.url, tag: 'novo' }; } }; };
  new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', sw)(self_, caches, fetch_, class { constructor(u) { this.url = u; } }, class { constructor(b, o) { Object.assign(this, o); } }, URL);

  let resposta = null;
  handlers.message({ data: { type: 'GET_VERSION' }, source: { postMessage: m => { resposta = m; } } });
  ok(resposta && resposta.type === 'VERSION' && resposta.version === 'dev' && resposta.buildData === 'dev', 'sw simulado: GET_VERSION responde versão e data');
  handlers.message({ data: { type: 'OUTRA' } });
  ok(!self_.skipped, 'sw simulado: outra mensagem não ativa a versão');
  handlers.message({ data: { type: 'SKIP_WAITING' } });
  ok(self_.skipped === 1, 'sw simulado: SKIP_WAITING ativa');

  const dispara = url => {
    const ext = []; let resp;
    handlers.fetch({ request: { method: 'GET', url, mode: 'no-cors' }, respondWith: p => { resp = p; }, waitUntil: p => ext.push(p) });
    return { resp, ext };
  };
  store.set('https://x.test/js/a.js', { tag: 'velho' });
  let t0 = Date.now(); let r = dispara('https://x.test/js/a.js');
  ok((await r.resp).tag === 'velho' && Date.now() - t0 < 20, 'sw simulado: com cache, responde a cópia guardada na hora');
  await Promise.all(r.ext);
  ok(store.get('https://x.test/js/a.js').tag === 'novo', 'sw simulado: a cópia nova é gravada antes do worker encerrar');
  t0 = Date.now(); r = dispara('https://x.test/js/b.js');
  ok((await r.resp).tag === 'novo' && Date.now() - t0 < 20, 'sw simulado: sem cache, a resposta não espera a gravação');
  await Promise.all(r.ext);
  ok(store.has('https://x.test/js/b.js'), 'sw simulado: sem cache, grava depois de responder');
  netOk = false;
  r = dispara('https://x.test/js/a.js'); const off = await r.resp; await Promise.all(r.ext);
  ok(off.tag === 'novo', 'sw simulado: offline com cache serve do cache e não trava o waitUntil');
  r = dispara('https://x.test/js/zzz.js'); const sem = await r.resp; await Promise.all(r.ext);
  ok(sem.status === 503, 'sw simulado: offline sem cache dá 503 amigável e não trava o waitUntil');
}

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
process.exit(falhas ? 1 : 0);

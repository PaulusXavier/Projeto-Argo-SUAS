// Teste da voz do mascote (falar a pergunta e ouvir a resposta).   npm run test:voz
// 1) Funções puras (texto falável, trechos): sempre rodam, sem dependências.
// 2) Integração no painel com microfone e voz FALSOS: roda só se o jsdom estiver instalado
//    (npm i --no-save jsdom). Sem ele, esta parte é pulada e avisa.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let ok = 0, falhas = 0;
const t = (nome, fn) => Promise.resolve().then(fn).then(() => { ok++; console.log('  ✓', nome); }, e => { falhas++; console.log('  ✗', nome, '\n     ', e.message); });

// ------------------------------------------------------------------ 1) funções puras
// argo-mascot.js é script de navegador (UMD); o package.json é "type: module", então carregamos com um `module` falso.
const mod = { exports: {} };
new Function('module', 'self', readFileSync(new URL('../js/argo-mascot.js', import.meta.url), 'utf8'))(mod, undefined);
const M = mod.exports;
const { falavel, partes } = M.voz;
console.log('Funções puras');
await t('tira negrito, marcadores e emoji', () => {
  assert.equal(falavel('**Atenção:** veja\n- item um\n- item dois 😀'), 'Atenção: veja. item um. item dois.');
});
await t('telefone com hífen não vira "menos"', () => {
  assert.match(falavel('Ligue (95) 3623-1234'), /3623 1234/);
});
await t('expande art., §, nº', () => {
  const f = falavel('Lei 8.742/1993, art. 20, § 3º e Portaria nº 12');
  assert.match(f, /artigo 20/); assert.match(f, /parágrafo 3º/); assert.match(f, /número 12/);
});
await t('remove link e mantém o texto do link', () => {
  const f = falavel('Veja [o decreto](https://x.gov.br/d) e https://exemplo.com/abc agora');
  assert.ok(!/http/.test(f)); assert.match(f, /o decreto/);
});
await t('texto longo corta no fim de uma frase', () => {
  const f = falavel('Frase completa número um. '.repeat(120));
  assert.ok(f.length <= 1500); assert.ok(/\.$/.test(f));
});
await t('vazio e nulo não quebram', () => { assert.equal(falavel(null), ''); assert.deepEqual(partes(''), []); });
await t('trechos respeitam o limite e não perdem texto', () => {
  const txt = 'Primeira frase curta. ' + 'palavra '.repeat(80) + '. Última frase.';
  const ps = partes(txt, 100);
  assert.ok(ps.every(p => p.length <= 101), 'trecho acima do limite: ' + ps.map(p => p.length));
  assert.equal(ps.join(' ').replace(/\s+/g, ' '), txt.replace(/\s+/g, ' ').trim());
});
await t('número com ponto de milhar não é cortado no meio', () => {
  const ps = partes('O valor é R$ 1.518,50 por mês. Outra frase.', 30);
  assert.ok(ps.some(p => p.includes('1.518,50')));
});

// ------------------------------------------------------------------ 2) integração (jsdom)
console.log('Painel (microfone e voz falsos)');
let JSDOM = null;
try { ({ JSDOM } = await import('jsdom')); } catch (e) { /* sem jsdom */ }
if (!JSDOM) {
  console.log('  (pulado: jsdom não instalado — npm i --no-save jsdom)');
} else {
  const src = readFileSync(new URL('../js/argo-mascot.js', import.meta.url), 'utf8');
  function montar({ comSR = true, comTTS = true, pref = null, confirma = true, ask } = {}) {
    const dom = new JSDOM('<!doctype html><body><div id="appRoot"></div></body>', { runScripts: 'outside-only', url: 'https://app.test/' });
    const w = dom.window;
    const falas = [], cancels = { n: 0 }, inst = [];
    if (pref) w.localStorage.setItem('argo_assistant_voice_v1', JSON.stringify(pref));
    if (comTTS) {
      w.SpeechSynthesisUtterance = function (txt) { this.text = txt; };
      w.speechSynthesis = { getVoices: () => [{ lang: 'en-US' }, { lang: 'pt-BR', localService: false, name: 'nuvem' }, { lang: 'pt-BR', localService: true, name: 'local' }],
        speak(u) { falas.push(u); setTimeout(() => u.onend && u.onend(), 0); }, cancel() { cancels.n++; } };
    }
    if (comSR) w.webkitSpeechRecognition = function () { inst.push(this); this.start = () => this.onstart && this.onstart(); this.stop = () => this.onend && this.onend(); this.abort = () => { this.abortou = true; this.onend && this.onend(); }; };
    const avisos = []; w.confirm = m => { avisos.push(m); return confirma; };
    w.requestAnimationFrame = f => setTimeout(f, 0);
    w.eval(src);
    const perguntas = [];
    const ctrl = w.ArgoMascot.mountAssistant({ greeting: 'Oi', ask: ask || (q => { perguntas.push(q); return { reply: '**Resposta** com art. 5 e 3623-1234, bem completa para ser lida.', mood: 'info', quickActions: [] }; }) });
    return { w, ctrl, doc: w.document, falas, cancels, inst, avisos, perguntas };
  }
  const espera = (ms = 30) => new Promise(r => setTimeout(r, ms));
  const $ = (e, id) => e.doc.getElementById(id);

  await t('sem suporte, os botões de voz ficam escondidos', () => {
    const e = montar({ comSR: false, comTTS: false });
    assert.equal($(e, 'argoAssistantMic').hidden, true); assert.equal($(e, 'argoAssistantSpeak').hidden, true);
  });
  await t('com suporte, aparecem e começam desligados', () => {
    const e = montar();
    assert.equal($(e, 'argoAssistantMic').hidden, false);
    assert.equal($(e, 'argoAssistantSpeak').getAttribute('aria-pressed'), 'false');
  });
  await t('1º uso do microfone mostra o aviso de privacidade; recusar não liga', () => {
    const e = montar({ confirma: false });
    $(e, 'argoAssistantMic').click();
    assert.equal(e.avisos.length, 1); assert.match(e.avisos[0], /não grava nem guarda/); assert.equal(e.inst.length, 0);
  });
  await t('aceitar liga o microfone, preenche o campo e NÃO envia sozinho', async () => {
    const e = montar();
    $(e, 'argoAssistantMic').click();
    assert.equal(e.inst.length, 1); assert.equal(e.inst[0].lang, 'pt-BR');
    e.inst[0].onresult({ results: [Object.assign([{ transcript: 'qual o telefone do CRAS' }], { isFinal: true })] });
    e.inst[0].onend();
    assert.equal($(e, 'argoAssistantInput').value, 'qual o telefone do CRAS');
    await espera(); assert.equal(e.perguntas.length, 0);
  });
  await t('aviso só na 1ª vez (preferência salva)', () => {
    const e = montar({ pref: { mic: true } });
    $(e, 'argoAssistantMic').click(); assert.equal(e.avisos.length, 0); assert.equal(e.inst.length, 1);
  });
  await t('microfone bloqueado mostra orientação e pede aviso de novo depois', () => {
    const e = montar({ pref: { mic: true } });
    $(e, 'argoAssistantMic').click(); e.inst[0].onerror({ error: 'not-allowed' }); e.inst[0].onend();
    assert.match($(e, 'argoAssistantLog').textContent, /microfone está bloqueado/);
    assert.equal(JSON.parse(e.w.localStorage.getItem('argo_assistant_voice_v1')).mic, false);
  });
  await t('leitura desligada por padrão: resposta não é falada', async () => {
    const e = montar();
    e.w.ArgoMascot; $(e, 'argoAssistantInput').value = 'oi tudo bem'; $(e, 'argoAssistantForm').dispatchEvent(new e.w.Event('submit', { cancelable: true }));
    await espera(400); assert.equal(e.falas.length, 0);
  });
  await t('leitura ligada: fala a resposta limpa, com voz pt-BR local', async () => {
    const e = montar({ pref: { read: true } });
    $(e, 'argoAssistantInput').value = 'oi tudo bem'; $(e, 'argoAssistantForm').dispatchEvent(new e.w.Event('submit', { cancelable: true }));
    await espera(400);
    assert.ok(e.falas.length >= 1); const f = e.falas[0];
    assert.ok(!f.text.includes('**')); assert.match(f.text, /artigo 5/); assert.match(f.text, /3623 1234/);
    assert.equal(f.voice && f.voice.name, 'local');
  });
  await t('fechar, nova conversa e nova pergunta cancelam a fala (trancar o app = fechar + nova conversa)', async () => {
    const e = montar({ pref: { read: true } });
    e.ctrl.open();
    for (const acao of [() => e.ctrl.close(), () => e.ctrl.reset(), () => e.ctrl.ask('outra pergunta')]) {
      e.falas.length = 0; e.w.speechSynthesis.speak = u => e.falas.push(u);   // fala que não termina sozinha
      e.ctrl.open(); e.w.ArgoMascot; $(e, 'argoAssistantSpeak').click();       // liga e fala "Voz ligada" (fica "falando")
      $(e, 'argoAssistantSpeak').click();                                      // desliga: cancela
      $(e, 'argoAssistantSpeak').click();
      const antes = e.cancels.n; acao(); assert.ok(e.cancels.n > antes, 'não cancelou');
    }
  });
  await t('resposta em streaming é lida inteira ao terminar; interrompida pelo usuário não é lida', async () => {
    const final = montar({ pref: { read: true }, ask: () => ({ reply: '', mood: 'info', badge: 'IA', stream: { run: (onDelta) => { onDelta('Resposta ', 'Resposta '); onDelta('em partes.', 'Resposta em partes.'); return Promise.resolve({ text: 'Resposta em partes completa.' }); } } }) });
    $(final, 'argoAssistantInput').value = 'pergunta aberta'; $(final, 'argoAssistantForm').dispatchEvent(new final.w.Event('submit', { cancelable: true }));
    await espera(400); assert.ok(final.falas.some(f => /Resposta em partes completa/.test(f.text)));
    const parada = montar({ pref: { read: true }, ask: () => ({ reply: '', mood: 'info', badge: 'IA', stream: { run: (onDelta, signal) => new Promise((_, rej) => { onDelta('Texto parcial bem longo o bastante para aparecer na tela', 'Texto parcial bem longo o bastante para aparecer na tela'); signal.addEventListener('abort', () => { const er = new Error('x'); er.partial = 'Texto parcial bem longo o bastante para aparecer na tela'; rej(er); }); }) } }) });
    $(parada, 'argoAssistantInput').value = 'pergunta aberta'; $(parada, 'argoAssistantForm').dispatchEvent(new parada.w.Event('submit', { cancelable: true }));
    await espera(400); $(parada, 'argoAssistantSend').click();   // Parar
    await espera(400); assert.equal(parada.falas.length, 0, 'leu resposta interrompida');
  });
  await t('botão "Ouvir" da mensagem fala mesmo com a leitura automática desligada', async () => {
    const e = montar();
    $(e, 'argoAssistantInput').value = 'oi tudo bem'; $(e, 'argoAssistantForm').dispatchEvent(new e.w.Event('submit', { cancelable: true }));
    await espera(400);
    const b = [...e.doc.querySelectorAll('.argo-assistant-msg-actions button')].find(x => /Ouvir/.test(x.textContent));
    assert.ok(b, 'botão Ouvir não apareceu'); b.click(); assert.ok(e.falas.length >= 1);
  });
  await t('alternador liga/desliga e guarda a preferência', () => {
    const e = montar(); const s = $(e, 'argoAssistantSpeak');
    s.click(); assert.equal(s.getAttribute('aria-pressed'), 'true'); assert.equal(JSON.parse(e.w.localStorage.getItem('argo_assistant_voice_v1')).read, true);
    s.click(); assert.equal(s.getAttribute('aria-pressed'), 'false');
  });
}

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);

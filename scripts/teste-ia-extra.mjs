// Teste dos pontos extras de IA do Argo:  npm run test:ia-extra
//  - menu "Escrever com o Paulus" (ARGO_TAREFAS_IA, argoTarefasComando, argoTarefasAsk em js/app.js)
//  - botão "✨ Explicar" nos prazos oficiais (js/prazos.js) e a pergunta montada (argoMascotePerguntaPrazo)
// Regra que o teste protege: nenhuma pergunta pronta leva dado de pessoa, e prazo próprio do usuário nunca vai à IA.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const lerArq = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const app = lerArq('js/app.js'), prazos = lerArq('js/prazos.js');
let ok = 0; const passa = n => { ok++; console.log('✓ ' + n); };
const corte = (src, de, ate) => { const i = src.indexOf(de), f = src.indexOf(ate, i); assert.ok(i > 0 && f > i, 'trecho não encontrado: ' + de); return src.slice(i, f); };

// Paulus (só para o filtro de dado pessoal)
const pctx = { console, setTimeout, clearTimeout, URL }; pctx.self = pctx; pctx.window = pctx; vm.createContext(pctx);
vm.runInContext(lerArq('js/paulus.v1.js'), pctx);
const P = pctx.Paulus; assert.ok(P && typeof P.temDadoPessoal === 'function');

// ---- trecho puro do app.js (limpar, prazo, tarefas, comando) + argoTarefasAsk ----
const chamadas = [];
const ctx = { Array, String, RegExp, console, navigator: { onLine: true },
  argoBrain: () => ({ aiOn: () => ctx.__ia }), argoAssistantAskInline: q => chamadas.push(['inline', q]),
  argoMascoteAsk: (q, o) => { chamadas.push(['ask', q, o]); return true; }, __ia: true };
vm.createContext(ctx);
vm.runInContext(corte(app, 'function argoMascoteLimpar(', 'function argoMascoteTextoSelecao(') +
  corte(app, '// Prazo oficial (texto público', '/* MASCOTE-IA:fim */') +
  corte(app, '// Menu "✍️ Escrever com o Paulus"', '// Casamento por palavra-chave (não é IA).') +
  '\nthis.T = ARGO_TAREFAS_IA; this.tarefas = argoTarefasIA; this.cmd = argoTarefasComando; this.menu = argoTarefasAsk; this.prazoQ = argoMascotePerguntaPrazo;', ctx);

// ---- tarefas ----
const T = Array.from(ctx.T);
assert.equal(new Set(T.map(t => t.id)).size, T.length); passa('ids das tarefas são únicos');
const grupos = ['Escrever', 'Preparar', 'Entender'];
assert.ok(T.every(t => grupos.includes(t.grupo))); passa('todo grupo é Escrever, Preparar ou Entender');
for (const g of grupos) assert.ok(T.filter(t => t.grupo === g).length >= 1 && T.filter(t => t.grupo === g).length <= 6, 'grupo ' + g);
passa('cada grupo tem de 1 a 6 tarefas (cabe nos 7 atalhos do painel com "Mais assuntos")');
for (const t of T) {
  assert.ok(t.pergunta.length >= 40 && t.pergunta.length <= 300, t.id + ': tamanho');
  assert.equal(P.temDadoPessoal(t.pergunta), false, t.id + ': a pergunta pronta não pode acionar o filtro de dado pessoal');
}
passa('nenhuma pergunta pronta aciona o filtro de dado pessoal');
const comCaso = ['registro', 'relatorio', 'oficio', 'paf', 'visita', 'caso', 'dados'];
for (const id of comCaso) assert.match(T.find(t => t.id === id).pergunta, /sem (nomes|dados)|só nomes de colunas/, id + ': precisa pedir "sem dados de pessoas"');
passa('tarefas que lidam com caso pedem, na própria pergunta, para não incluir dado de pessoa');

// ---- comando do menu: só frase inteira ----
assert.equal(ctx.cmd('tarefas do paulus'), 'menu');
assert.equal(ctx.cmd('  escrever com o paulus '), 'menu');
assert.equal(ctx.cmd('tarefas de escrever'), 'Escrever');
assert.equal(ctx.cmd('tarefas de preparar'), 'Preparar');
assert.equal(ctx.cmd('tarefas de entender'), 'Entender');
passa('os comandos do menu e dos três grupos são reconhecidos');
for (const x of ['me ajude a escrever um relatorio tecnico', 'quais tarefas do paulus voce faz', 'tarefas de dados', 'escrever', 'tarefas pendentes do cras', ''])
  assert.equal(ctx.cmd(x), '', 'não pode sequestrar: ' + x);
passa('pedido de verdade ("me ajude a escrever um relatório...") não vira menu: segue para a IA');

// ---- argoTarefasAsk ----
let r = ctx.menu('tarefas do paulus');
assert.equal(r.quickActions.length, 3); assert.match(r.reply, /não escreva nome/i); passa('menu principal: 3 grupos e o aviso de não escrever dado de pessoa');
r = ctx.menu('tarefas de escrever');
assert.equal(r.quickActions.length, T.filter(t => t.grupo === 'Escrever').length);
chamadas.length = 0; r.quickActions[0].run();
assert.deepEqual(JSON.parse(JSON.stringify(chamadas[0])), ['ask', T[0].pergunta, { forceAI: true }]); passa('botão de tarefa faz uma pergunta e vai direto à IA');
ctx.__ia = false; r = ctx.menu('tarefas do paulus');
assert.equal(r.quickActions.length, 0); assert.match(r.reply, /desligada|sem internet/); passa('IA desligada: avisa em vez de oferecer botões');
ctx.__ia = true; assert.equal(ctx.menu('oi'), null); passa('mensagem comum não é tratada pelo menu');

// ---- pergunta do prazo ----
let q = ctx.prazoQ('Fim do prazo da Revisão Cadastral REV26', 'Cadastro Único', '30/11/2026', true);
assert.match(q, /Revisão Cadastral REV26/); assert.match(q, /30\/11\/2026, data prevista/); assert.match(q, /Cadastro Único/); assert.match(q, /onde confiro a norma/);
assert.equal(P.temDadoPessoal(q), false); passa('pergunta do prazo traz texto, data, "prevista" e tema, e passa no filtro');
assert.equal(ctx.prazoQ('', 'x', '01/01/2026', false), ''); passa('prazo sem texto não gera pergunta');
q = ctx.prazoQ('Texto «com aspas» ' + 'palavra '.repeat(80), '', '', false);
assert.ok(!/[«»]{2}/.test(q) && q.length < 330); passa('texto longo é cortado e aspas internas não quebram a moldura');

// ---- botão no item do prazo ----
const pz = vm.createContext({ String, Number, Date, argoPrazosEsc: s => String(s == null ? '' : s), ArgoPrazos: { quando: () => 'em 3 dias' },
  argoMascoteAsk: () => true, argoMascotePerguntaPrazo: () => 'x' });
vm.runInContext(corte(prazos, 'function argoPrazosItemHtml(', 'function argoPrazosRenderAviso(') + '\nthis.item = argoPrazosItemHtml;', pz);
const base = { id: 'a1', d: '2026-11-30', faixa: 'mes', cat: 'cadunico', catNome: 'Cadastro Único', t: 'Fim da revisão', dias: 3, feito: false, prev: true };
assert.match(pz.item(base), /data-pz="explicar"/); passa('prazo oficial ganha o botão ✨ Explicar');
assert.doesNotMatch(pz.item(Object.assign({}, base, { proprio: true })), /data-pz="explicar"/); passa('"Meu prazo" (do usuário) não ganha o botão');
pz.argoMascoteAsk = undefined; assert.doesNotMatch(pz.item(base), /data-pz="explicar"/); passa('sem o painel do Argo, o botão não aparece');
assert.match(prazos, /alvoIA\.proprio\) return/); passa('o clique também recusa prazo próprio (dupla trava)');

console.log('\n' + ok + ' verificações ok');

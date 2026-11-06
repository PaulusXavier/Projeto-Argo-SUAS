// Teste do APRENDIZADO COM O USO do mascote (js/argo-cerebro.js → ArgoCerebro.aprender).
// Uso: node scripts/teste-aprendizado.mjs   (sem dependências; Node 18+)
import { readFileSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = f => readFileSync(join(RAIZ, f), 'utf8');
const mem = new Map();
const ctx = {
  console, setTimeout, clearTimeout, AbortController, navigator: { onLine: false },
  localStorage: { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) }
};
ctx.self = ctx; ctx.window = ctx;
createContext(ctx);
runInContext(ler('js/equipe-cras-cristiana.js'), ctx);
runInContext(ler('js/data.js'), ctx);
runInContext('this.DATA = (typeof DATA !== "undefined") ? DATA : [];', ctx);
runInContext(ler('js/argo-cerebro.js'), ctx);
const B = ctx.ArgoCerebro;
function novo() { B.init({ data: ctx.DATA, ia: { url: '' } }); B.reset(); }

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.error('✗ ' + m); } else console.log('✓ ' + m); };
const nomes = r => r.units.map(u => u.name);
const posicao = (r, id) => r.units.findIndex(u => u.id === id);

novo();
B.aprender.apagar();

// 1. Preferência: a unidade que a pessoa confirma sobe na lista da mesma pergunta
const P = 'psicologo para atendimento';
let r0 = B.directory(P);
ok(r0.units.length > 1, 'pergunta genérica devolve lista (' + r0.units.length + ' unidades)');
const alvo = r0.units[r0.units.length - 1];
const pos0 = posicao(r0, alvo.id);
for (let i = 0; i < 3; i++) {
  B.remember(P, 'resposta', [alvo]);
  B.aprender.feedback('bom');
  B.reset();
}
let r1 = B.directory(P);
const pos1 = posicao(r1, alvo.id);
ok(pos1 >= 0 && pos1 < pos0, 'unidade confirmada com 👍 sobe: posição ' + pos0 + ' → ' + pos1);
ok(r1.aprendido === true || pos1 === 0, 'resultado marca que veio do aprendizado');

// 2. 👎 desce
const topo = r1.units[0];
if (topo.id !== alvo.id || true) {
  const antes = posicao(B.directory(P), topo.id);
  for (let i = 0; i < 3; i++) { B.remember(P, 'resposta', [topo]); B.aprender.feedback('ruim'); B.reset(); }
  const depois = posicao(B.directory(P), topo.id);
  ok(depois === -1 || depois > antes, '👎 repetido desce a unidade recusada: ' + antes + ' → ' + depois);
}

// 3. Nome exato nunca é escondido pelo aprendizado
const caps = ctx.DATA.find(d => /CAPS AD/i.test(d.name));
if (caps) {
  for (let i = 0; i < 4; i++) { B.remember(caps.name, 'x', [{ id: caps.id, name: caps.name }]); B.aprender.feedback('ruim'); B.reset(); }
  const rx = B.directory(caps.name);
  ok(rx.units.length && rx.units[0].id === caps.id, 'nome exato continua em 1º mesmo com 👎 (' + (rx.units[0] || {}).name + ')');
}

// 4. Toque (ligar/ficha) conta como voto de confiança, uma vez por resposta
novo(); B.aprender.apagar();
const Q = 'cras para cadastro unico';
const rq = B.directory(Q);
const cand = rq.units[rq.units.length - 1];
B.remember(Q, 'x', [cand]);
ok(B.aprender.usou(cand) === true, 'toque em unidade da resposta é aceito');
ok(B.aprender.usou(cand) === false, 'segundo toque na mesma resposta não conta de novo');
ok(B.aprender.usou({ id: 999999 }) === false, 'unidade que não estava na resposta é ignorada');

// 5. Apelido aprendido: palavra desconhecida + reformulação confirmada
novo(); B.aprender.apagar();
const gir = 'xablauzinho';
let rg = B.directory(gir + ' de saude mental');
const sem = B.directory(gir);
ok(sem.units.length === 0, 'palavra desconhecida sozinha não acha nada');
B.remember(gir, 'não achei', []);
const alvoAl = ctx.DATA.find(d => /CAPS III/i.test(d.name)) || ctx.DATA[0];
B.remember('caps psicossocial', 'achei', [{ id: alvoAl.id, name: alvoAl.name }]);
B.aprender.feedback('bom');
const depoisAl = B.directory(gir);
ok(depoisAl.units.length > 0, 'depois de confirmar, a palavra nova vira apelido e acha: ' + nomes(depoisAl).slice(0, 2).join(' | '));

// 6. Mais perguntadas
novo(); B.aprender.apagar();
for (const pf of ['telefone do caps ad', 'telefone caps ad', 'qual o fone do caps ad']) { B.reset(); const rr = B.directory(pf); B.remember(pf, 'x', rr.units.slice(0, 1)); }
const fr = B.aprender.frequentes(3);
ok(fr.length === 1 && fr[0].vezes === 3, 'pergunta repetida 3 vezes vira atalho (' + (fr[0] ? fr[0].texto + ' ×' + fr[0].vezes : 'nenhuma') + ')');
B.remember('qual o fone do caps ad', 'x', B.directory('caps ad').units.slice(0, 1));
ok(B.aprender.frequentes(3)[0].vezes === 3, '"Refazer" imediato não conta como pergunta nova');

// 7. Dado pessoal não é aprendido
novo(); B.aprender.apagar();
B.remember('telefone da maria da silva cpf 123.456.789-00', 'x', [ctx.DATA[0]]);
ok(B.aprender.feedback('bom') === false, 'pergunta com dado pessoal não gera aprendizado');

// 8. Persistência e apagar
novo(); B.aprender.apagar();
B.remember(P, 'x', [alvo]); B.aprender.feedback('bom');
ok(mem.has('argo_aprendizado_v1'), 'aprendizado é guardado no aparelho');
const res = B.aprender.resumo();
ok(res.n === 1 && res.bons === 1, 'resumo conta 1 avaliação positiva');
B.aprender.apagar();
ok(!mem.has('argo_aprendizado_v1') && B.aprender.resumo().n === 0, 'apagar zera tudo');

console.log(falhas ? '\n' + falhas + ' falha(s)' : '\nTudo certo.');
process.exit(falhas ? 1 : 0);

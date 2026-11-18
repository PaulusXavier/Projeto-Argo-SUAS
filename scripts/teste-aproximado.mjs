// Teste do RECONHECIMENTO APROXIMADO de nomes do mascote (js/argo-cerebro.js): erros de digitação, letras trocadas,
// escrita pelo som, palavras coladas ou separadas, abreviações e o aviso "Entendi X como Y".
// Uso: npm run test:aproximado   (sem dependências; precisa de Node 18+)
import { readFileSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = f => readFileSync(join(RAIZ, f), 'utf8');
const ctx = { console, setTimeout, clearTimeout, navigator: { onLine: false } };
ctx.self = ctx; ctx.window = ctx; createContext(ctx);
runInContext(ler('js/equipe-cras-cristiana.js'), ctx);
runInContext(ler('js/data.js'), ctx);
runInContext('this.DATA = (typeof DATA !== "undefined") ? DATA : [];', ctx);
runInContext(ler('js/argo-cerebro.js'), ctx);
const B = ctx.ArgoCerebro;
B.init({ data: ctx.DATA, ia: { url: '' } });

let falhas = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) falhas++; };
const top = q => B.directory(q).units.map(u => u.id);

// [pergunta com erro, trecho esperado no nome da 1ª unidade]
const CASOS = [
  ['ubs vili brsail', 'vila brasil'], ['unidade mista do caorebe', 'caroebe'], ['ubs mecejnaa', 'mecejana'],
  ['cras bofnim', 'bonfim'], ['procno boa vista', 'procon'], ['setrabes', 'setrabes'],
  ['caps ad tres', 'caps ad'], ['cras caumae', 'caua'], ['creas', 'creas'], ['conselho tutelar', 'conselho tutelar'],
  ['telefone do cras cauame', 'caua'], ['ubs mesejana', 'mecejana'], ['cras bon fim', 'bonfim'], ['ubs vilabrasil', 'vila brasil'], ['ubs vila brazil', 'vila brasil'],
  ['hosp geral de roraima', 'hospital']
];
for (const [q, esperado] of CASOS) {
  const r = B.directory(q);
  const nome = r.units[0] ? (r.units[0].name + ' ' + r.units[0].fullName).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') : '';
  ok(nome.includes(esperado), `"${q}" → ${esperado} (veio ${r.units[0] ? r.units[0].name : 'nada'})`);
}

// nome certo: sem aviso de correção
const certo = B.directory('cras bonfim');
ok(!certo.corrige || certo.corrige.length === 0, 'nome certo: sem aviso de correção');
// nome errado: aviso
const errado = B.directory('cras bofnim');
ok(errado.corrige && errado.corrige.some(c => c.de === 'bofnim' && c.para === 'bonfim'), 'nome errado: avisa "Entendi bofnim como bonfim"');
const resp = B.compose ? null : null;
// frase comum não vira outra palavra
const comum = B.directory('quais os meus direitos no trabalho');
ok(!(comum.corrige || []).some(c => c.de === 'meus'), 'frase comum: "meus" não vira outra palavra');
// pedido de telefone com erro ainda responde o telefone
const tel = B.directory('telefone do cras bofnim');
ok(tel.contact && tel.units.length > 0, 'nome errado: ainda responde o telefone pedido');

// varredura: erros automáticos em todas as fichas (troca de vizinhas, letra a menos, letra dobrada) — o alvo tem de aparecer no top 3
let n = 0, acerto = 0;
const unicos = [...new Set(ctx.DATA.map(d => d.name))].filter(x => x && x.length >= 8);
function estraga(w, k) {
  if (w.length < 5) return w;
  const i = 1 + (k % (w.length - 3));
  if (k % 3 === 0) return w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);
  if (k % 3 === 1) return w.slice(0, i) + w.slice(i + 1);
  return w.slice(0, i) + w[i] + w.slice(i);
}
unicos.forEach((nome, k) => {
  const ws = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const j = ws.map((w, i) => [w, i]).filter(([w]) => w.length >= 6).sort((a, b) => b[0].length - a[0].length)[0];
  if (!j) return;
  const q = ws.map((w, i) => i === j[1] ? estraga(w, k) : w).join(' ');
  n++;
  const r = B.directory(q);
  if (r.units.slice(0, 3).some(u => u.name === nome)) acerto++;
});
const pct = Math.round(100 * acerto / n);
console.log(`varredura: ${acerto}/${n} (${pct}%) com o alvo no top 3`);
ok(pct >= 90, 'varredura automática ≥ 90%');

console.log(falhas ? falhas + ' falha(s)' : 'Tudo certo');
process.exit(falhas ? 1 : 0);

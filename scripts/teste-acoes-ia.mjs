// Teste da escolha das telas que a IA pode propor como botão (argoEscolherAcoesIA, js/app.js):  npm run test:acoes
// O Paulus só leva 20 ações ao Worker; a função escolhe as que combinam com a pergunta e a aba e completa com as abas de sempre.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const ini = app.indexOf('function argoEscolherAcoesIA(');
const fim = app.indexOf('/* ---------- Rotas (Paulus v0.12.0)');
assert.ok(ini > 0 && fim > ini, 'função não encontrada em js/app.js');
const ctx = { Set, Array, String };
vm.createContext(ctx);
vm.runInContext(app.slice(ini, fim) + '\nthis.escolher = argoEscolherAcoesIA;', ctx);

const abas = [
  { id: 'mapa', rotulo: 'Mapa dos Equipamentos', descricao: 'Mapa com a localização das unidades' },
  { id: 'agenda', rotulo: 'Agenda Argo', descricao: 'Agenda e compromissos' },
  { id: 'pdftools', rotulo: 'Central de PDF', descricao: 'Ferramentas para PDF' },
  { id: 'tradutor', rotulo: 'Tradutor', descricao: 'Tradutor Es/En/Fr' },
  { id: 'delegacias', rotulo: 'Segurança Pública', descricao: 'Delegacias, polícias e bombeiros' }
];
const ferr = [
  { id: 'ferr_renda', tool: 'renda', rotulo: 'Renda per capita', descricao: 'Ferramenta: Renda per capita', kw: 'calculadora salario minimo' },
  { id: 'ferr_qr', tool: 'qr', rotulo: 'Gerador de QR Code', descricao: 'Ferramenta: QR', kw: 'codigo' }
];
const lista = abas.concat(ferr);
let ok = 0; const passa = n => { ok++; console.log('✓ ' + n); };

let r = Array.from(ctx.escolher(lista, 'preciso calcular a renda per capita da família', 'all', 3), a => a.id);
assert.equal(r[0], 'ferr_renda'); passa('pergunta sobre renda propõe a ferramenta de renda primeiro');

r = Array.from(ctx.escolher(lista, 'onde ficam os bombeiros?', 'all', 3), a => a.id);
assert.ok(r.includes('delegacias') && !r.includes('ferr_qr')); passa('"bombeiros" casa com Segurança Pública; "bom" não casa com "bombeiros"');

r = Array.from(ctx.escolher(lista, 'oi', 'all', 4), a => a.id);
assert.equal(r.length, 4); assert.ok(r.every(id => !id.startsWith('ferr_'))); passa('sem palavra que case, completa só com as abas de sempre');

assert.equal(ctx.escolher(lista, 'qualquer coisa', 'all', 2).length, 2); passa('respeita o máximo');
console.log('\n' + ok + ' verificações ok');

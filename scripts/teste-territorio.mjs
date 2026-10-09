// Teste rápido do "cérebro" do mascote (js/argo-cerebro.js) com o diretório real (js/data.js).
// Uso: npm run test:territorio   (sem dependências; precisa de Node 18+)
import { readFileSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = f => readFileSync(join(RAIZ, f), 'utf8');

const ctx = { console, navigator: { onLine: false }, setTimeout, clearTimeout };
ctx.self = ctx; ctx.window = ctx;
createContext(ctx);
runInContext(ler('js/equipe-cras-cristiana.js'), ctx);
runInContext(ler('js/data.js'), ctx);
// "const" de script clássico não vira propriedade do objeto global: expõe para o teste
runInContext('this.DATA = (typeof DATA !== "undefined") ? DATA : []; this.EQUIPE_CRAS_CRISTIANA = (typeof EQUIPE_CRAS_CRISTIANA !== "undefined") ? EQUIPE_CRAS_CRISTIANA : null;', ctx);
runInContext(ler('js/argo-cerebro.js'), ctx);

const B = ctx.ArgoCerebro;
B.init({ data: ctx.DATA, ia: { url: '' } });

let falhas = 0;
function confere(nome, ok, detalhe) {
  if (!ok) { falhas++; console.log('✗ ' + nome + (detalhe ? ' → ' + detalhe : '')); }
  else console.log('✓ ' + nome);
}
const resp = q => { const p = B.plan(q, { tabCat: '' }); return { kind: p.kind, txt: String((p.result && p.result.reply) || '') }; };

confere('diretório carregado', ctx.DATA.length > 100, String(ctx.DATA.length));

let r = resp('qual CRAS atende o bairro Cauamé');
confere('bairro Cauamé → CRAS Cauamé', r.kind === 'directory' && /CRAS Cauamé/.test(r.txt), r.txt.slice(0, 80));
r = resp('qual cras atende o caimbé');
confere('erro de digitação (caimbé) é entendido', r.kind === 'directory' && /Caimbé/i.test(r.txt), r.txt.slice(0, 80));
r = resp('telefone do CAPS AD III');
confere('telefone do CAPS AD III vem da ficha', r.kind === 'directory' && /CAPS AD III/.test(r.txt) && /\d{4}/.test(r.txt), r.txt.slice(0, 80));
r = resp('o que é PAIF');
confere('conceito PAIF', r.kind === 'concept' && /PAIF/.test(r.txt));
r = resp('o que é RAPS');
confere('conceito RAPS', r.kind === 'concept' && /RAPS/.test(r.txt));
for (const q of ['quero morrer', 'estou sendo agredida', 'ela falou em suicídio']) confere('socorro: ' + q, !!B.crisis(q));
confere('"o inconsciente em Freud" não é socorro', !B.crisis('o inconsciente em Freud'));
for (const q of ['Nome: Maria Souza', 'meu RG 1234567', 'CPF 123.456.789-09']) confere('dado pessoal barrado: ' + q, !!B.piiBlock(q));
confere('pergunta técnica não é barrada', !B.piiBlock('qual CRAS atende o bairro Cauamé?'));
confere('telefone fora do diretório é detectado', B.verifyPhones('ligue para (95) 91111-2222') === true);
confere('intervalo de anos não é telefone', B.verifyPhones('vigência 2023-2026') === false);

console.log(falhas ? '\n' + falhas + ' falha(s).' : '\nTudo certo.');
process.exit(falhas ? 1 : 0);

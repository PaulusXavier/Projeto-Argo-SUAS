// Teste do módulo js/territorio-cras.js ("Qual CRAS atende este endereço?") com as unidades reais de js/app.js.
// Uso: npm run test:territorio-cras   (sem dependências; Node 18+)
import { readFileSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = f => readFileSync(join(RAIZ, f), 'utf8');

// UNITS_CRAS_CREAS é um "const" dentro do app.js (que mexe em DOM): extrai só o objeto.
const src = ler('js/app.js');
const ini = src.indexOf('const UNITS_CRAS_CREAS = {');
const fim = src.indexOf('\n};', ini) + 3;
if (ini < 0 || fim < 3) throw new Error('UNITS_CRAS_CREAS não encontrado em js/app.js');
const ctx = {}; ctx.window = ctx; createContext(ctx);
runInContext(src.slice(ini, fim) + '\nthis.UNITS = UNITS_CRAS_CREAS;', ctx);
runInContext(ler('js/territorio-cras.js'), ctx);
const T = ctx.ArgoTerritorio, U = ctx.UNITS;

let falhas = 0;
const confere = (nome, ok, det) => { if (!ok) { falhas++; console.log('✗ ' + nome + (det ? ' → ' + det : '')); } };
const nome = (kind, e) => U[kind][e.i].name;

// 1) Todo bairro de cada CRAS devolve aquele CRAS (vínculo bairro -> CRAS inteiro).
let n = 0;
U.cras.forEach((u, i) => {
  if (/itinerante/i.test(u.name)) return;
  u.bairros.split(',').map(b => b.trim()).forEach(b => {
    n++;
    const r = T.resolver({ candidatos: [b] }, U);
    confere('bairro ' + b, r.bairro && r.cras.some(e => e.i === i && e.modo === 'bairro'), JSON.stringify(r.cras));
  });
});

// 2) Nomes como o OpenStreetMap devolve.
const casos = [
  [['Caimbé'], 'CRAS Cristiana Vicente Nunes'],
  [['caimbe'], 'CRAS Cristiana Vicente Nunes'],
  [['Doutor Silvio Leite'], 'CRAS Dr. Silvio Leite'],
  [['Salomão'], 'CRAS Cauamé'],
  [['Nossa Senhora Aparecida'], 'CRAS São Francisco'],
  [['Bairro Pintolândia'], 'CRAS Pintolândia'],
  [['Quarteirão X', 'Mecejana'], 'CRAS São Francisco'],
  [['Centro'], 'CRAS São Francisco'],
];
casos.forEach(([c, esperado]) => {
  const r = T.resolver({ candidatos: c }, U);
  confere(c.join('/') + ' → ' + esperado, r.cras[0] && nome('cras', r.cras[0]) === esperado, r.cras[0] && nome('cras', r.cras[0]));
});

// 3) Bairro desconhecido -> estimativa pela distância (nunca "de referência").
const e1 = T.resolver({ candidatos: ['Bairro Inexistente'], lat: 2.8105, lon: -60.7449 }, U);
confere('desconhecido = estimativa', e1.cras[0] && e1.cras[0].modo === 'estimativa' && nome('cras', e1.cras[0]) === 'CRAS Pintolândia', JSON.stringify(e1.cras));
confere('estimativa nunca é Itinerante', !/Itinerante/.test(nome('cras', e1.cras[0])));
const e2 = T.resolver({ candidatos: [] }, U);
confere('sem bairro e sem ponto = vazio', e2.cras.length === 0 && e2.creas.length === 0);

// 4) CREAS acompanha o bairro.
const c1 = T.resolver({ candidatos: ['Centenário'] }, U);
confere('CREAS Centenário', c1.creas[0] && nome('creas', c1.creas[0]) === 'CREAS Centenário');
const c2 = T.resolver({ candidatos: ['Mecejana'] }, U);
confere('CREAS Centro', c2.creas[0] && nome('creas', c2.creas[0]) === 'CREAS Centro');

// 5) Zona rural / indígena -> CRAS Itinerante.
const z = T.resolver({ candidatos: [], textoLivre: 'Comunidade indígena Anzol, zona rural' }, U);
confere('itinerante', z.itinerante > -1 && /Itinerante/.test(U.cras[z.itinerante].name));
confere('Caimbé não aciona itinerante', T.resolver({ candidatos: ['Caimbé'] }, U).itinerante === -1);

// 6) Falso positivo: texto curto/solto não casa por "contém".
confere('"Boa Vista" sozinho não vira bairro', !T.resolver({ candidatos: ['Boa Vista'] }, U).bairro);


// 7) Entender o pedido do mascote.
const ent = (txt) => T.entender(txt, U);
const tipo = (txt) => { const r = ent(txt); return r ? r.tipo : null; };
confere('bairro: qual CRAS atende o Caimbé?', tipo('Qual CRAS atende o Caimbé?') === 'bairro' && ent('Qual CRAS atende o Caimbé?').bairro === 'Caimbé');
confere('bairro: moro no Pintolândia', tipo('moro no Pintolândia, qual é o meu CRAS?') === 'bairro');
confere('bairro composto', ent('qual cras atende o bairro Dr. Silvio Leite?') && /Silvio Leite/.test(ent('qual cras atende o bairro Dr. Silvio Leite?').bairro));
confere('bairro: 13 de Setembro', tipo('Em qual CRAS o bairro 13 de Setembro é atendido?') === 'bairro');
confere('endereço', tipo('Moro na Rua Santo Agostinho, 193, Centenário. Qual CRAS atende?') === 'endereco' && /Rua Santo Agostinho/.test(ent('Moro na Rua Santo Agostinho, 193, Centenário. Qual CRAS atende?').endereco));
confere('gps', tipo('qual CRAS atende onde estou?') === 'gps');
confere('pergunta sem lugar', tipo('de qual CRAS eu sou?') === 'pergunta' || tipo('qual o CRAS do meu bairro?') === 'pergunta');
confere('"Centro de Referência" não vira bairro Centro', tipo('qual o centro de referencia de assistencia social que atende idosos?') === null);
confere('não captura: o que é o CRAS', tipo('O que é o CRAS?') === null);
confere('não captura: CRAS atende idosos', tipo('Qual CRAS atende pessoas idosas?') === null);
confere('não captura: unidade citada', tipo('O CRAS Cauamé atende quais bairros?') === null);
confere('não captura: sem CRAS', tipo('qual UBS atende o Caimbé?') === null);

console.log(falhas ? `\n${falhas} falha(s) em ${n + casos.length + 20} verificações.` : `✓ territorio-cras: ${n} bairros + ${casos.length} casos de nomes + estimativa/CREAS/itinerante + 12 pedidos do mascote OK`);
process.exit(falhas ? 1 : 0);

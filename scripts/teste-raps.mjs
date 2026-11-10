// Teste da base da RAPS do mascote (js/argo-cerebro.js, bloco RAPS_BASE): cada pergunta cai no verbete certo,
// cada verbete cita a norma, as perguntas de continuação respondem, e consulta de unidade continua indo ao diretório.
// Uso: npm run test:raps   (sem dependências; Node 18+)
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
runInContext('this.DATA = (typeof DATA !== "undefined") ? DATA : [];', ctx);
runInContext(ler('js/argo-cerebro.js'), ctx);
const B = ctx.ArgoCerebro;
B.init({ data: ctx.DATA, ia: { url: '' } });

let falhas = 0;
function confere(nome, ok, detalhe) {
  if (!ok) { falhas++; console.log('✗ ' + nome + (detalhe ? ' → ' + detalhe : '')); } else console.log('✓ ' + nome);
}
const idDe = q => { B.reset(); const p = B.plan(q, { tabCat: 'all' }); return (p.result && p.result.psiId) || p.kind; };

const lista = B.rapsLista;
confere('há pelo menos 25 verbetes da RAPS', lista.length >= 25, String(lista.length));
confere('ids únicos (junto com psicólogo, PAIF e CadÚnico)', new Set(B.psiLista.map(e => e.id)).size === B.psiLista.length);
confere('todo verbete tem texto, norma citada, chaves e ids "raps-"', lista.every(e => /^raps-/.test(e.id) && e.text.length > 120 && e.base && e.keys.length >= 5));
confere('chaves com "+" usam só palavras soltas (o índice compara palavra a palavra)', lista.every(e => e.keys.every(k => k.indexOf('+') < 0 || k.split('+').every(w => w && w.indexOf(' ') < 0))));

const casos = [
  ['o que é a RAPS?', 'raps-o-que-e'], ['quais os componentes da RAPS', 'raps-o-que-e'],
  ['o que diz a 3.088 sobre a RAPS?', 'raps-norma'], ['qual a legislação de saúde mental', 'raps-norma'],
  ['o que é a reforma psiquiátrica?', 'raps-reforma'], ['luta antimanicomial', 'raps-reforma'],
  ['quais os direitos da pessoa com transtorno mental?', 'raps-direitos'],
  ['o que é o CAPS?', 'raps-caps-o-que-e'], ['para que serve o caps', 'raps-caps-o-que-e'],
  ['quais os tipos de CAPS?', 'raps-caps-tipos'], ['qual a diferença entre CAPS II e CAPS III', 'raps-caps-tipos'],
  ['como ter acesso ao CAPS?', 'raps-caps-acesso'], ['precisa de encaminhamento para o CAPS?', 'raps-caps-acesso'],
  ['o que é o projeto terapêutico singular?', 'raps-pts'],
  ['saúde mental na UBS', 'raps-atencao-basica'], ['onde tratar ansiedade', 'raps-atencao-basica'],
  ['quando encaminhar para o CAPS ou UBS?', 'raps-quando-encaminhar'],
  ['o que fazer em crise de saúde mental?', 'raps-crise'], ['pessoa em surto', 'raps-crise'],
  ['leitos de saúde mental em hospital geral', 'raps-hospitalar'],
  ['como funciona a internação psiquiátrica?', 'raps-internacao'], ['internação involuntária', 'raps-internacao'],
  ['como internar dependente químico?', 'raps-internacao-ad'], ['lei 13.840', 'raps-internacao-ad'],
  ['o que é uma comunidade terapêutica?', 'raps-comunidade-terapeutica'],
  ['o que é redução de danos?', 'raps-reducao-danos'],
  ['o que é a unidade de acolhimento?', 'raps-unidade-acolhimento'],
  ['o que são residências terapêuticas?', 'raps-srt'],
  ['programa de volta para casa', 'raps-volta-para-casa'],
  ['centro de convivência e cultura', 'raps-reabilitacao'],
  ['como o CRAS e o CAPS trabalham juntos?', 'raps-suas-raps'],
  ['BPC para quem tem transtorno mental', 'raps-bpc'],
  ['o que é curatela?', 'raps-curatela'],
  ['resolução CNJ 487', 'raps-justica'], ['medida de segurança', 'raps-justica'],
  ['lei 13.819', 'raps-lei-13819'],
  ['consultório na rua', 'raps-situacao-rua'],
  ['psicoterapia gratuita', 'raps-psicoterapia'], ['clínica escola de psicologia', 'raps-psicoterapia'],
  ['como a RAPS funciona em Boa Vista?', 'raps-boa-vista'],
  ['siglas da RAPS', 'raps-siglas']
];
for (const [q, esperado] of casos) { const got = idDe(q); confere('"' + q + '" → ' + esperado, got === esperado, got); }

// o que é de unidade continua indo ao diretório
for (const q of ['telefone do CAPS III', 'onde fica o CAPS AD III?', 'endereço do CAPS II']) {
  confere('"' + q + '" continua no diretório', idDe(q) === 'directory', idDe(q));
}
confere('risco de suicídio continua indo ao socorro', idDe('quero me matar') === 'crisis');
confere('verbete da RAPS mostra o selo da RAPS', (() => { B.reset(); return /RAPS/.test(B.plan('o que é o CAPS?', { tabCat: 'all' }).result.badge); })());

// as perguntas de continuação de cada verbete têm resposta
const semResposta = [];
for (const e of lista) for (const f of (e.follow || [])) { if (typeof f === 'string' && idDe(f) === 'none') semResposta.push(e.id + ': ' + f); }
confere('as perguntas de continuação respondem', semResposta.length === 0, semResposta.join(' | '));

// com IA, o verbete vai como base conferida do app
const BIA = (() => { const c = { console, navigator: { onLine: true }, setTimeout, clearTimeout, fetch: async () => { throw new Error('sem rede'); } }; c.self = c; c.window = c; createContext(c);
  for (const f of ['js/equipe-cras-cristiana.js', 'js/data.js']) runInContext(ler(f), c);
  runInContext('this.DATA = (typeof DATA !== "undefined") ? DATA : [];', c); runInContext(ler('js/argo-cerebro.js'), c);
  c.ArgoCerebro.init({ data: c.DATA, ia: { url: 'https://exemplo.workers.dev' } }); return c.ArgoCerebro; })();
const base = (BIA.buildPayload('Como funciona a internação psiquiátrica involuntária?', { tabCat: 'all', tabName: 'Todos' }).base) || [];
confere('a IA recebe o verbete da RAPS como base do app', base.some(b => /RAPS/.test(b.titulo || '')), JSON.stringify(base.map(b => b.titulo)));

console.log(falhas ? '\n' + falhas + ' falha(s)' : '\nTudo certo.');
process.exit(falhas ? 1 : 0);

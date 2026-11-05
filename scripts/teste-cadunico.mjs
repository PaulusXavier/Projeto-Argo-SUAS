// Teste da base do Cadastro Único do mascote (js/argo-cerebro.js, bloco CAD_BASE): cada pergunta cai no verbete certo,
// cada verbete cita a norma, as perguntas de continuação respondem, e consulta de unidade continua indo ao diretório.
// Uso: npm run test:cadunico   (sem dependências; precisa de Node 18+)
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

const lista = B.cadLista;
confere('há pelo menos 17 verbetes do CadÚnico', lista.length >= 17, String(lista.length));
confere('ids únicos (junto com psicólogo e PAIF)', new Set(B.psiLista.map(e => e.id)).size === B.psiLista.length);
confere('todo verbete tem texto, norma citada, chaves e ids "cad-"', lista.every(e => /^cad-/.test(e.id) && e.text.length > 120 && e.base && e.keys.length >= 6));
confere('as chaves também valem para "cadastro unico" e "cad unico"', lista.every(e => !e.keys.some(k => k.indexOf('cadunico') > -1) || (e.keys.some(k => k.indexOf('cadastro') > -1 && k.indexOf('unico') > -1) && e.keys.some(k => /cad[ +]unico/.test(k)))));
confere('o texto não promete CPF obrigatório para todos (a cartilha pede ao menos um documento de cada pessoa)', !lista.some(e => /CPF de todas as pessoas/i.test(e.text)));

const casos = [
  ['o que é o CadÚnico?', 'cad-o-que-e'], ['para que serve o cadastro único', 'cad-o-que-e'],
  ['quem pode se cadastrar no CadÚnico?', 'cad-quem-deve'], ['qual a renda para entrar no cadunico', 'cad-quem-deve'],
  ['quem é o responsável familiar?', 'cad-familia-responsavel'], ['o que é família no CadÚnico', 'cad-familia-responsavel'],
  ['quais documentos levar para o CadÚnico?', 'cad-documentos'], ['o que levar para fazer o cadastro único', 'cad-documentos'],
  ['como faço o cadastro único?', 'cad-passo-a-passo'], ['como me inscrever no CadÚnico', 'cad-passo-a-passo'],
  ['como funciona a entrevista do CadÚnico?', 'cad-entrevista'], ['quando a entrevista domiciliar é dispensada?', 'cad-entrevista'],
  ['o que é família unipessoal?', 'cad-unipessoal'], ['unipessoal no bolsa família', 'cad-unipessoal'],
  ['de quanto em quanto tempo atualizar o CadÚnico?', 'cad-atualizacao'], ['cadunico desatualizado', 'cad-atualizacao'],
  ['o que é averiguação cadastral?', 'cad-averiguacao-revisao'], ['o que é a revisão cadastral', 'cad-averiguacao-revisao'],
  ['o que acontece se não atualizar o cadastro?', 'cad-bloqueio'], ['o que é exclusão lógica', 'cad-bloqueio'],
  ['BPC e CadÚnico', 'cad-bpc'], ['formulário de impossibilidade do BPC', 'cad-bpc'],
  ['CadÚnico para indígenas', 'cad-gpte'], ['o que são grupos populacionais tradicionais e específicos', 'cad-gpte'],
  ['quais programas usam o CadÚnico?', 'cad-programas'],
  ['como consultar o CadÚnico?', 'cad-consulta'], ['como saber se estou no cadúnico', 'cad-consulta'],
  ['quem faz o CadÚnico?', 'cad-gestao'], ['papel do CRAS no CadÚnico', 'cad-gestao'],
  ['o CadÚnico é sigiloso?', 'cad-sigilo'],
  ['como funciona o Gás do Povo?', 'cad-gas-do-povo'], ['como funciona o Pé-de-Meia?', 'cad-pe-de-meia'], ['tarifa social de energia', 'cad-tarifa-social']
];
for (const [q, esperado] of casos) { const got = idDe(q); confere('"' + q + '" → ' + esperado, got === esperado, got); }

// o que é de unidade continua indo ao diretório
for (const q of ['onde fazer o CadÚnico?', 'telefone do posto do CadÚnico', 'qual CRAS atende o Caimbé?']) {
  confere('"' + q + '" continua no diretório', idDe(q) === 'directory', idDe(q));
}
confere('"quais documentos para o BPC?" não vira verbete do CadÚnico', !/^cad-/.test(idDe('quais documentos para o BPC?')));
confere('PAIF e CadÚnico continua no verbete de vigilância do PAIF', idDe('PAIF e CadÚnico') === 'paif-vigilancia');

// as perguntas de continuação de cada verbete têm resposta
const semResposta = [];
for (const e of lista) for (const f of (e.follow || [])) { if (typeof f === 'string' && idDe(f) === 'none') semResposta.push(e.id + ': ' + f); }
confere('as perguntas de continuação respondem', semResposta.length === 0, semResposta.join(' | '));

// com IA, o verbete vai como base conferida do app
const BIA = (() => { const c = { console, navigator: { onLine: true }, setTimeout, clearTimeout, fetch: async () => { throw new Error('sem rede'); } }; c.self = c; c.window = c; createContext(c);
  for (const f of ['js/equipe-cras-cristiana.js', 'js/data.js']) runInContext(ler(f), c);
  runInContext('this.DATA = (typeof DATA !== "undefined") ? DATA : [];', c); runInContext(ler('js/argo-cerebro.js'), c);
  c.ArgoCerebro.init({ data: c.DATA, ia: { url: 'https://exemplo.workers.dev' } }); return c.ArgoCerebro; })();
const base = (BIA.buildPayload('Quais documentos levar para atualizar o CadÚnico?', { tabCat: 'all', tabName: 'Todos' }).base) || [];
confere('a IA recebe o verbete do CadÚnico como base do app', base.some(b => /CadÚnico/.test(b.titulo || '')), JSON.stringify(base.map(b => b.titulo)));

console.log(falhas ? '\n' + falhas + ' falha(s)' : '\nTudo certo.');
process.exit(falhas ? 1 : 0);

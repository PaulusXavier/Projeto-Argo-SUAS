// Teste do "manual do app" do mascote (js/argo-cerebro.js) e do seu encaixe em js/app.js.
// Uso: npm run test:manual   (sem dependências; precisa de Node 18+)
import { readFileSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = f => readFileSync(join(RAIZ, f), 'utf8');

function novoCerebro(opts) {
  const ctx = { console, navigator: { onLine: false }, setTimeout, clearTimeout };
  ctx.self = ctx; ctx.window = ctx;
  createContext(ctx);
  runInContext(ler('js/equipe-cras-cristiana.js'), ctx);
  runInContext(ler('js/data.js'), ctx);
  runInContext('this.DATA = (typeof DATA !== "undefined") ? DATA : [];', ctx);
  runInContext(ler('js/argo-cerebro.js'), ctx);
  const B = ctx.ArgoCerebro;
  B.init(Object.assign({ data: ctx.DATA, ia: { url: '' } }, opts || {}));
  B.setMunicipios(JSON.parse(ler('assets/municipios-rr.json')));
  return { B, ctx };
}

let falhas = 0;
function confere(nome, ok, detalhe) {
  if (!ok) { falhas++; console.log('✗ ' + nome + (detalhe ? ' → ' + detalhe : '')); }
  else console.log('✓ ' + nome);
}

const { B } = novoCerebro();
const plano = q => B.plan(q, { tabCat: '' });
const manual = q => { const p = plano(q); return p.kind === 'manual' ? p.result : null; };
const txt = r => String((r && r.reply) || '');
const lista = B.manualLista;

// ---------- estrutura do manual
confere('manual carregado com muitos verbetes', Array.isArray(lista) && lista.length >= 50, String(lista && lista.length));
const ids = lista.map(e => e.id);
confere('ids dos verbetes são únicos', new Set(ids).size === ids.length);
confere('todo verbete tem nome, texto e palavras-chave', lista.every(e => e.nome && e.texto && Array.isArray(e.keys) && e.keys.length >= 2));

// botões "Abrir ...": só abas que existem na barra lateral
const html = ler('index.html');
const abasSidebar = [...new Set([...html.matchAll(/data-cat="([a-z0-9]+)"/g)].map(m => m[1]))];
const abasInvalidas = lista.filter(e => e.open && !abasSidebar.includes(e.open)).map(e => e.id + '→' + e.open);
confere('todo botão "Abrir" do manual aponta para uma aba que existe', abasInvalidas.length === 0, abasInvalidas.join(', '));

// cada verbete é alcançável pela sua frase mais específica
const inalcancaveis = [];
for (const e of lista) {
  const k = e.keys.map(x => x.replace(/^!/, '')).sort((a, b) => b.length - a.length)[0];
  const r = manual('como faço para usar ' + k);
  if (!r || r.badge !== 'Manual do Argo') { inalcancaveis.push(e.id + ' (' + k + ')'); continue; }
}
confere('cada verbete responde pela sua frase mais específica', inalcancaveis.length === 0, inalcancaveis.join('; '));

// ---------- perguntas reais → verbete certo
const casos = [
  ['como faço para juntar dois pdf', /Unificar PDFs e fotos/],
  ['como comprimir um pdf muito grande', /páginas viram imagens/],
  ['como colocar senha em um arquivo word', /Word, Excel e PowerPoint/],
  ['como faço backup das minhas anotações', /Backup de anotações/],
  ['onde fica o bloco de notas', /Bloco de notas/],
  ['o que tem na aba ferramentas', /16 cartões/],
  ['como uso a agenda', /Agenda Argo/],
  ['como funciona o tradutor', /português, espanhol, inglês e francês/],
  ['para que serve a calculadora de prazos', /dias úteis/],
  ['como calcular renda per capita no app', /linha do Bolsa Família/],
  ['como funciona o bloqueio automático', /sem uso/],
  ['como digitalizar um documento com a câmera', /cortar as bordas/],
  ['como limpar dados ocultos de um pdf', /autor/],
  ['o que o app faz', /diretório da rede/],
  ['quais são as abas do diretório', /RAPS/],
  ['como funciona o mapa', /Localizar agora/],
  ['como instalar o app no celular', /tela inicial/]
];
for (const [q, re] of casos) {
  const r = manual(q);
  confere('"' + q + '" → manual', !!r && re.test(txt(r)), r ? txt(r).slice(0, 70) : 'não respondeu');
}

// resposta traz botão de abrir a aba
let r = manual('como uso a central de pdf');
confere('Central de PDF → botão abre a aba pdftools', !!r && r.quickActions.some(a => a.cat === 'pdftools'));
r = manual('como assinar um pdf');
confere('Editar PDF → botão abre a Central de PDF', !!r && r.quickActions.some(a => a.cat === 'pdftools'));

// ---------- números vêm do app (não escritos à mão)
confere('padrão: bloqueio de 45 minutos', /45 minutos/.test(txt(manual('como funciona o bloqueio automático por inatividade'))));
const { B: B2 } = novoCerebro({ manual: { bloqueioMin: 20, lembrarHoras: 6, tentativas: 3 } });
const r2 = B2.plan('como funciona o bloqueio automático por inatividade', { tabCat: '' }).result;
confere('valor passado pelo app aparece no manual (20 minutos)', /20 minutos/.test(txt(r2)) && !/45 minutos/.test(txt(r2)), txt(r2).slice(0, 120));
const r3 = B2.plan('como funciona manter conectado', { tabCat: '' }).result;
confere('"manter conectado" usa as horas do app (6 horas)', /6 horas/.test(txt(r3)));
confere('nenhum marcador {…} sobra na resposta', lista.every(e => { const t = txt(B.plan('como usar ' + e.keys[0].replace(/^!/, ''), { tabCat: '' }).result); return !/\{\w+\}/.test(t); }));
confere('manual ignora valor inválido vindo do app', /45 minutos/.test(txt(novoCerebro({ manual: { bloqueioMin: 'abc' } }).B.plan('como funciona o bloqueio automático', { tabCat: '' }).result)));

// ---------- o manual NÃO sequestra o que é do diretório, da norma ou do socorro
const naoManual = [
  'qual o telefone do CAPS',
  'qual o endereço do CRAS do bairro Caimbé',
  'horário de funcionamento do hospital geral',
  'preciso de ajuda, quero me matar',
  'o que é PAIF',
  'quais os requisitos do BPC idoso',
  'qual o valor do bolsa família'
];
for (const q of naoManual) {
  const p = plano(q);
  confere('"' + q + '" não vai para o manual', p.kind !== 'manual', p.kind);
}
confere('socorro continua sendo socorro', plano('estou pensando em me matar, como faço pra usar o app').kind === 'crisis');
confere('frase vazia/curta não aciona o manual', !manual('oi') && !manual('pdf'));

// ---------- a IA recebe o manual como base nas perguntas sobre o app
const base = B.baseApp('como comprimir um pdf no app');
confere('baseApp inclui o verbete do manual', base.some(x => /Manual do app Argo/.test(x.titulo) && /Reduzir tamanho/.test(x.texto)));
confere('baseApp não passa de 4 itens', B.baseApp('como funciona o app e o bolsa família em Boa Vista Pacaraima').length <= 4);
confere('pergunta sem relação com o app não traz manual', !B.baseApp('qual a capital de Roraima').some(x => /Manual do app/.test(x.titulo)));

// ---------- encaixe em js/app.js
const app = readFileSync(join(RAIZ, 'js/app.js'));
const appTxt = app.toString('utf8');
confere('app.js responde plan.kind "manual" na hora', /plan\.kind === 'manual'/.test(appTxt));
confere('app.js passa ao cérebro os números do bloqueio/sessão/tentativas', /manual:\s*\{\s*bloqueioMin:\s*Math\.round\(AUTO_LOCK_IDLE_MS/.test(appTxt) && /tentativas:\s*AUTH_MAX_ATTEMPTS/.test(appTxt));
confere('resposta antiga de "Minhas Anotações" foi corrigida', !/Em "Minhas Anotações" você cria/.test(appTxt) && /Bloco de notas/.test(appTxt.slice(appTxt.indexOf("keys: ['anotacao', 'anotacoes'"), appTxt.indexOf("keys: ['anotacao', 'anotacoes'") + 700)));

// a IA pode propor TODAS as abas da barra lateral
const blocoIA = appTxt.slice(appTxt.indexOf('const ARGO_ACOES_IA'), appTxt.indexOf('function argoStreamIA'));
const catsIA = new Set([...blocoIA.matchAll(/cat: '([a-z0-9]+)'/g)].map(m => m[1]));
const faltam = abasSidebar.filter(c => !catsIA.has(c));
confere('ARGO_ACOES_IA cobre todas as abas da barra lateral (' + abasSidebar.length + ')', faltam.length === 0, 'faltam: ' + faltam.join(', '));
const idsIA = [...blocoIA.matchAll(/\{ id: '([a-z0-9]+)'/g)].map(m => m[1]);
confere('ids das ações da IA são únicos', new Set(idsIA).size === idsIA.length);

console.log('\n' + (falhas ? falhas + ' falha(s)' : 'Tudo certo'));
process.exit(falhas ? 1 : 0);

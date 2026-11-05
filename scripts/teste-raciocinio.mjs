// Teste do "raciocínio" do mascote (js/argo-cerebro.js): relato de violência contra criança, pergunta em partes,
// pergunta de caso e conferência da resposta da IA. Carrega o arquivo real, como o navegador.
// Uso: npm run test:raciocinio   (sem dependências; precisa de Node 18+)
import { readFileSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = f => readFileSync(join(RAIZ, f), 'utf8');

function novoAmbiente(ia) {
  const ctx = { console, setTimeout, clearTimeout, AbortController, TextDecoder, navigator: { onLine: true }, fetch: async () => { throw new Error('sem rede no teste'); } };
  ctx.self = ctx; ctx.window = ctx;
  createContext(ctx);
  runInContext(ler('js/equipe-cras-cristiana.js'), ctx);
  runInContext(ler('js/data.js'), ctx);
  runInContext('this.DATA = (typeof DATA !== "undefined") ? DATA : [];', ctx);
  runInContext(ler('js/argo-cerebro.js'), ctx);
  ctx.ArgoCerebro.init({ data: ctx.DATA, ia: ia ? { url: 'https://exemplo.workers.dev' } : {} });
  return ctx;
}

let falhas = 0;
function confere(nome, ok, detalhe) {
  if (!ok) { falhas++; console.log('✗ ' + nome + (detalhe ? ' → ' + detalhe : '')); } else console.log('✓ ' + nome);
}

const B = novoAmbiente(false).ArgoCerebro;
const BIA = novoAmbiente(true).ArgoCerebro;

// ---- 1) relato de violência contra criança/adolescente
B.reset();
const rel = B.planRelato('O padrasto mexe com ele quando a mãe sai, o menino tem 9 anos');
confere('relato sexual em fala natural vira resposta de proteção', !!rel && rel.relato.sexual === true, JSON.stringify(rel && rel.relato));
confere('o relato manda ligar 190/192 e traz o dever de comunicar', !!rel && /190/.test(rel.result.reply) && /192/.test(rel.result.reply));
confere('relato sexual traz a ficha do CAI 18 de Maio', !!rel && rel.result.units.length > 0, rel && String(rel.result.units.length));
confere('o relato deixa o bairro como pendência', B.session.pendente === 'relato-bairro');
const bairro = B.plan('Caimbé', {});
confere('o bairro dito depois do relato traz Conselho Tutelar/CREAS do território', bairro.kind !== 'none' && /Conselho Tutelar|CREAS/i.test((bairro.result && bairro.result.reply) || ''), bairro.kind + ' | ' + String(bairro.result && bairro.result.reply).slice(0, 120));
confere('depois do bairro a pendência é limpa', B.session.pendente !== 'relato-bairro');
const rel2 = B.planRelato('A mãe bate nos filhos com cinto, tem marcas roxas no corpo deles');
confere('violência física também é reconhecida', !!rel2 && rel2.relato.fisica === true);
confere('"o que é abuso sexual?" é pergunta de conceito, não relato', B.relato('o que é abuso sexual infantil e quais os tipos?') === null);
confere('"minha filha de 30 anos" não é criança', B.relato('minha filha de 30 anos apanha do marido todo dia, o que faço') === null);
confere('"bate ponto" não é agressão', B.relato('o filho do paciente bate ponto no CRAS toda manhã às 8 horas') === null);
confere('abuso de álcool não é relato de abuso', B.relato('o pai do menino tem abuso de álcool e a família está em acompanhamento') === null);

// ---- 2) perguntas em partes
const p = B.dividirPartes('Qual CRAS atende o bairro Caimbé e o que levo para o CadÚnico?');
confere('duas perguntas ligadas por "e" são divididas', p.length === 2, JSON.stringify(p));
confere('"Álcool e Drogas" não é dividido', B.dividirPartes('Quais serviços de Álcool e Drogas existem em Boa Vista?').length === 0);
confere('comparação não é dividida', B.dividirPartes('quando devo acionar o CT e quando o CREAS?').length === 0);
const falta = B.partesSemResposta('Qual CRAS atende o Caimbé e o que levo para o CadÚnico?', 'O CRAS de referência é o Cauamé, confira com a unidade.');
confere('parte sem resposta na IA é detectada', falta.length === 1 && /CadÚnico/i.test(falta[0]), JSON.stringify(falta));
const ok = B.partesSemResposta('Qual CRAS atende o Caimbé e o que levo para o CadÚnico?', 'O CRAS é o Cauamé. Para o CadÚnico leve documento com foto e CPF.');
confere('resposta completa não gera botão', ok.length === 0, JSON.stringify(ok));

// ---- 3) pergunta de caso
confere('"como organizo o atendimento de um idoso negligenciado?" é caso', B.ehCaso('Como organizo o atendimento de um idoso que está sendo negligenciado?'));
confere('consulta de telefone não é caso', !B.ehCaso('Qual o telefone do CRAS que atende a família do Caimbé?'));
confere('"o que é PAIF" não é caso', !B.ehCaso('o que é o PAIF e como funciona com a família?'));
const pc = B.planCaso('Como encaminho uma gestante em situação de rua?', null);
confere('roteiro de caso traz as 5 etapas', pc.result.reply.split('\n').filter(l => /^\d\. /.test(l)).length === B.metodoCaso.length);
const baseIA = BIA.buildPayload('Como encaminho uma gestante em situação de rua e quais documentos ela precisa?', { tabCat: 'all', tabName: 'Todos' }).base || [];
confere('a IA recebe o roteiro de caso e o das partes primeiro', baseIA.length >= 2 && /Roteiro/i.test(baseIA[0].titulo || ''), JSON.stringify(baseIA.map(b => b.titulo)));

// ---- 4) documentos: "quais documentos" sozinho não sequestra BPC/CadÚnico
confere('"quais documentos para o BPC?" não vira verbete do psicólogo', B.plan('quais documentos para o BPC?', {}).kind !== 'psi');
confere('"quais documentos o psicólogo pode emitir?" continua no verbete', B.plan('quais documentos o psicólogo pode emitir?', {}).kind === 'psi');

console.log(falhas ? '\n' + falhas + ' falha(s)' : '\nTudo certo.');
process.exit(falhas ? 1 : 0);

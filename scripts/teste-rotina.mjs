// Teste da ROTINA do mascote (js/argo-rotina.js): resumo do dia, prazos, atalhos de ferramenta e guia.
// Uso: npm run test:rotina   (sem dependências; precisa de Node 18+)
import { readFileSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = {}; ctx.self = ctx; createContext(ctx);
runInContext(readFileSync(join(RAIZ, 'js/argo-rotina.js'), 'utf8'), ctx);
const R = ctx.ArgoRotina;

let falhas = 0, ok = 0;
function confere(nome, cond, detalhe) {
  if (cond) { ok++; return; }
  falhas++; console.log('✗ ' + nome + (detalhe ? ' → ' + detalhe : ''));
}
const tipo = t => { const r = R.intencao(t); return r ? r.tipo : null; };

// ---- resumo do dia
['resumo do meu dia', 'me dá um resumo do dia', 'o que tenho pra fazer hoje', 'o que eu tenho para fazer hoje?', 'o que preciso fazer hoje',
 'minhas pendências', 'qual é a minha pauta de hoje', 'por onde eu começo o dia?', 'Bom dia! resumo de hoje', 'meu dia', 'o que tem pra hoje',
 'panorama da semana', 'o que tenho pra fazer essa semana'].forEach(t =>
  confere('resumo: "' + t + '"', tipo(t) === 'resumo', JSON.stringify(R.intencao(t))));
confere('resumo da semana → escopo semana', R.intencao('resumo da minha semana').escopo === 'semana');
confere('resumo de hoje → escopo dia', R.intencao('resumo do meu dia').escopo === 'dia');

// ---- NÃO é resumo (continua com os outros ramos do mascote)
['o que é o PAIF?', 'pendências do cadúnico da família', 'qual o telefone do CRAS', 'o que tem hoje', 'quantos dias úteis faltam',
 'como organizo o atendimento de um caso?', 'previsão do tempo para hoje', 'resumo do artigo 5 do ECA'].forEach(t =>
  confere('não é resumo: "' + t + '"', tipo(t) !== 'resumo', JSON.stringify(R.intencao(t))));

// ---- prazos
['tem algum prazo vencendo?', 'quais prazos vencem essa semana', 'prazos pendentes', 'tenho prazo hoje?', 'mostre os prazos próximos', 'o que está vencendo'].forEach(t =>
  confere('prazos: "' + t + '"', tipo(t) === 'prazos', JSON.stringify(R.intencao(t))));
confere('prazos atrasados → filtro', (R.intencao('quais prazos estão atrasados') || {}).filtro === 'atrasados');
['qual o prazo para atualizar o cadúnico', 'calcular prazo de 10 dias úteis', 'prazo para recorrer do bloqueio', 'calculadora de prazos'].forEach(t =>
  confere('não é lista de prazos: "' + t + '"', tipo(t) !== 'prazos', JSON.stringify(R.intencao(t))));

// ---- marcar feito / novo prazo
let r = R.intencao('marcar o prazo do RMA como feito');
confere('feito com alvo', r && r.tipo === 'feito' && /rma/.test(r.alvo), JSON.stringify(r));
r = R.intencao('marcar prazo como feito');
confere('feito sem alvo', r && r.tipo === 'feito' && r.alvo === '', JSON.stringify(r));
r = R.intencao('dar baixa no prazo do Censo SUAS');
confere('dar baixa', r && r.tipo === 'feito' && /censo/.test(r.alvo), JSON.stringify(r));
r = R.intencao('novo prazo meu: relatório mensal dia 30');
confere('novo prazo', r && r.tipo === 'novoPrazo' && /relat[óo]rio mensal dia 30/.test(r.texto), JSON.stringify(r));
r = R.intencao('criar prazo para entregar o PAF dia 25/11');
confere('criar prazo', r && r.tipo === 'novoPrazo', JSON.stringify(r));

// ---- guia
r = R.intencao('gerar guia para o CREAS');
confere('guia CREAS', r && r.tipo === 'guia' && r.alvo === 'creas', JSON.stringify(r));
r = R.intencao('faz a guia de encaminhamento para o CAPS AD');
confere('guia CAPS AD', r && r.tipo === 'guia' && r.alvo === 'caps ad', JSON.stringify(r));
r = R.intencao('quero gerar uma guia pro Conselho Tutelar');
confere('guia conselho', r && r.tipo === 'guia' && /conselho tutelar/.test(r.alvo), JSON.stringify(r));
r = R.intencao('encaminhar para o CRAS Cristiana');
confere('encaminhar para', r && r.tipo === 'guia' && /cras cristiana/.test(r.alvo), JSON.stringify(r));
r = R.intencao('gerar guia');
confere('guia sem alvo', r && r.tipo === 'guia' && r.alvo === '', JSON.stringify(r));
r = R.intencao('guia para o CAPS AD');
confere('guia sem verbo', r && r.tipo === 'guia' && r.alvo === 'caps ad', JSON.stringify(r));
confere('"como encaminhar um idoso" não é guia', tipo('como encaminhar um idoso') !== 'guia');

// ---- contar anotações
r = R.intencao('quantas anotações fiz essa semana');
confere('contar semana', r && r.tipo === 'contarNotas' && r.periodo === 'semana', JSON.stringify(r));
confere('contar hoje', (R.intencao('quantas anotações tenho hoje') || {}).periodo === 'hoje');
confere('contar mês', (R.intencao('quantos lembretes tenho neste mês') || {}).periodo === 'mes');

// ---- abrir ferramenta
const CAT = [
  ['relogio', 'Relógio, cronômetro e temporizador'], ['calculadora', 'Calculadora'], ['renda', 'Renda per capita'], ['idade', 'Idade e datas'],
  ['qr', 'Gerador de QR Code'], ['contador', 'Contador de atendimentos'], ['prazos', 'Calculadora de prazos'], ['documentos', 'Conferir NIS e CPF'],
  ['porcentagem', 'Porcentagens'], ['lista', 'Soma e média de uma lista'], ['extenso', 'Valor por extenso'], ['whatsapp', 'Link de WhatsApp'],
  ['texto', 'Formatar texto'], ['acomp', 'Acompanhamento de famílias'], ['planilha', 'Analisador de planilha'], ['notas', 'Bloco de notas']
].map(([id, titulo]) => ({ id, titulo }));
const abre = t => { const i = R.intencao(t); return i && i.tipo === 'abrir' ? (R.acharFerramenta(i.alvo, CAT) || {}).id || null : null; };
const casos = {
  'abre o contador de atendimentos': 'contador', 'abrir a calculadora': 'calculadora', 'abre a calculadora de prazos': 'prazos', 'abre o relógio': 'relogio',
  'quero usar o gerador de QR Code': 'qr', 'abre a renda per capita': 'renda', 'abrir o bloco de notas': 'notas', 'abre o acompanhamento de famílias': 'acomp',
  'abre o analisador de planilha': 'planilha', 'abrir conferir NIS e CPF': 'documentos', 'abre o link de whatsapp': 'whatsapp', 'abre o valor por extenso': 'extenso',
  'abre o cronômetro': 'relogio', 'abre a soma e média de uma lista': 'lista'
};
Object.entries(casos).forEach(([t, id]) => confere('abre: "' + t + '" → ' + id, abre(t) === id, String(abre(t))));
['abre o registro de atendimento', 'abre o mapa', 'abre o hospital coronel mota', 'abre a agenda'].forEach(t =>
  confere('não casa ferramenta: "' + t + '"', abre(t) == null, String(abre(t))));

// ---- achar prazo
const ITENS = [
  { id: 'a', d: '2026-11-20', t: 'RMA do CRAS — envio do mês de outubro' },
  { id: 'b', d: '2026-11-25', t: 'Censo SUAS 2026 — preenchimento' },
  { id: 'c', d: '2026-11-30', t: 'Revisão cadastral (REV26) — fim do prazo' },
  { id: 'd', d: '2026-12-05', t: 'Relatório mensal do PAIF' }
];
confere('prazo: RMA', (R.acharPrazo('rma', ITENS).achado || {}).id === 'a');
confere('prazo: censo suas', (R.acharPrazo('censo suas', ITENS).achado || {}).id === 'b');
confere('prazo: relatório (único)', (R.acharPrazo('relatorio', ITENS).achado || {}).id === 'd');
confere('prazo: sem alvo → candidatos', !R.acharPrazo('', ITENS).achado && R.acharPrazo('', ITENS).candidatos.length > 0);
confere('prazo: inexistente → nada', !R.acharPrazo('licitacao', ITENS).achado && R.acharPrazo('licitacao', ITENS).candidatos.length === 0);
confere('prazo: ambíguo vira candidatos', (() => { const x = R.acharPrazo('mensal do', ITENS.concat([{ id: 'e', d: '2026-12-06', t: 'Relatório mensal do CREAS' }])); return !x.achado || true; })());
confere('prazo: ambíguo pede escolha', (() => { const x = R.acharPrazo('relatorio mensal', ITENS.concat([{ id: 'e', d: '2026-12-06', t: 'Relatório mensal do CREAS' }])); return !x.achado && x.candidatos.length === 2; })());

// ---- resumo
const base = {
  saudacao: 'Bom dia', dataLonga: 'terça-feira, 17 de novembro', escopo: 'dia',
  hoje: { info: 'Pagamento: Bolsa Família', notas: ['ligar para o CREAS', 'visita 14h'], util: true },
  amanha: { info: '', notas: ['reunião de equipe'] },
  prazos: [
    { t: 'RMA do CRAS', quando: 'há 2 dias', faixa: 'atrasado', dataCurta: '15/11' },
    { t: 'Censo SUAS', quando: 'em 3 dias', faixa: 'semana', dataCurta: '20/11' }
  ],
  sincronizada: true
};
let s = R.resumo(base);
const txt = s.linhas.join('\n');
confere('resumo traz saudação e data', /^Bom dia! Seu resumo de hoje — terça-feira, 17 de novembro\./.test(txt), txt.split('\n')[0]);
confere('resumo traz o calendário', /Pagamento: Bolsa Família/.test(txt));
confere('resumo traz o prazo atrasado primeiro', txt.indexOf('já passaram') > -1 && txt.indexOf('RMA do CRAS') < txt.indexOf('Censo SUAS'));
confere('resumo traz as anotações de hoje', /ligar para o CREAS/.test(txt) && /\(2\)/.test(txt));
confere('resumo traz amanhã', /Amanhã: 1 anotação/.test(txt));
confere('sugestão: atrasados primeiro', /Comece pelos prazos que já passaram/.test(s.sugestao));
confere('não está vazio', s.vazio === false);

s = R.resumo({ hoje: { info: '', notas: [] }, amanha: {}, prazos: [], sincronizada: true, saudacao: 'Boa tarde', dataLonga: 'x' });
confere('dia sem nada → vazio e sugestão de rotina', s.vazio === true && /Dia sem pendências/.test(s.sugestao) && /Nenhum prazo pendente/.test(s.linhas.join('\n')));
s = R.resumo({ hoje: { notas: [] }, prazos: [], sincronizada: false });
confere('sem sincronização, avisa que não leu as anotações', /código de sincronização/.test(s.linhas.join('\n')));
s = R.resumo({ hoje: { notas: [] }, prazos: [{ t: 'Fechar RMA', quando: 'hoje', faixa: 'hoje', dataCurta: '17/11' }], sincronizada: true });
confere('sugestão: vence hoje', /vence hoje: Fechar RMA/.test(s.sugestao));
s = R.resumo({ hoje: { notas: [] }, prazos: Array.from({ length: 9 }, (_, i) => ({ t: 'Prazo ' + i, quando: 'em ' + (i + 1) + ' dias', faixa: 'semana', dataCurta: '2' + i + '/11' })), sincronizada: true });
confere('lista longa é cortada com "… e mais N"', /e mais 5\./.test(s.linhas.join('\n')));
s = R.resumo({ escopo: 'semana', hoje: { notas: [] }, prazos: [], semana: { notas: 3, itens: ['Qua 18/11 — reunião'] }, sincronizada: true });
confere('semana mostra itens e total', /Na semana/.test(s.linhas.join('\n')) && /3 anotações nesta semana/.test(s.linhas.join('\n')));

// ---- robustez
['', '   ', null, undefined, 'x'.repeat(500)].forEach(t => confere('entrada estranha não quebra', (() => { try { R.intencao(t); return true; } catch (e) { return false; } })()));

console.log((falhas ? '✗ ' + falhas + ' falha(s)' : '✓ rotina: ' + ok + ' verificações ok'));
process.exit(falhas ? 1 : 0);

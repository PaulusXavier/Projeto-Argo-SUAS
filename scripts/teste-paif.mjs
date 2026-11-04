// Teste da base PAIF do mascote (js/argo-cerebro.js, bloco PAIF_BASE): cada pergunta cai no verbete certo,
// os verbetes citam a norma, e perguntas de outros assuntos não são roubadas.
// Uso: npm run test:paif   (sem dependências; precisa de Node 18+)
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
  if (!ok) { falhas++; console.log('✗ ' + nome + (detalhe ? ' → ' + detalhe : '')); }
  else console.log('✓ ' + nome);
}
const lista = B.paifLista;
confere('há pelo menos 60 verbetes de PAIF', lista.length >= 60, String(lista.length));
confere('ids únicos (PAIF e psicólogo juntos)', new Set(B.psiLista.map(e => e.id)).size === B.psiLista.length);
confere('todo verbete tem texto, norma citada e chaves', lista.every(e => e.text && e.text.length > 80 && e.base && e.keys.length >= 3));
confere('nenhum verbete promete número que a norma nacional não fixa (sem "famílias por técnico" com número)', !lista.some(e => /\b\d[\d.]*\s+famílias por técnico/i.test(e.text)));

// pergunta → id esperado
const casos = [
  ['o que é o PAIF?', 'paif-o-que-e'], ['para que serve o paif', 'paif-o-que-e'],
  ['qual a base legal do PAIF?', 'paif-base-legal'], ['o PAIF é obrigatório no CRAS?', 'paif-base-legal'],
  ['quais são os objetivos do PAIF?', 'paif-objetivos'],
  ['quem é atendido no PAIF?', 'paif-usuarios'], ['quem tem direito ao paif', 'paif-usuarios'],
  ['como a família chega ao PAIF?', 'paif-acesso'],
  ['horário de funcionamento do paif', 'paif-funcionamento'],
  ['qual o trabalho social essencial do PAIF', 'paif-trabalho-essencial'],
  ['quais as aquisições dos usuários do PAIF', 'paif-aquisicoes'],
  ['o PAIF tem caráter terapêutico?', 'paif-nao-terapeutico'], ['grupo do paif é terapia?', 'paif-nao-terapeutico'],
  ['quais são as ações do PAIF?', 'paif-acoes'],
  ['o que é a acolhida?', 'paif-acolhida'], ['o que é acolhida particularizada', 'paif-acolhida-particularizada'],
  ['o que é estudo social?', 'paif-estudo-social'],
  ['como é a visita domiciliar?', 'paif-visita-domiciliar'], ['visita domiciliar é fiscalização?', 'paif-visita-domiciliar'],
  ['o que são oficinas com famílias?', 'paif-oficinas'], ['o que são ações comunitárias?', 'paif-acoes-comunitarias'],
  ['como funcionam os grupos de famílias?', 'paif-grupos'],
  ['o que é busca ativa?', 'paif-busca-ativa'],
  ['qual a diferença entre atendimento e acompanhamento?', 'paif-atend-x-acomp'],
  ['o que é acompanhamento familiar?', 'paif-acompanhamento'],
  ['quando propor acompanhamento familiar?', 'paif-quando-acompanhar'], ['quem tem prioridade no paif', 'paif-quando-acompanhar'],
  ['o que é o PAF?', 'paif-paf'], ['como fazer o PAF', 'paif-paf'], ['plano de acompanhamento familiar', 'paif-paf'],
  ['o que o PAF deve registrar?', 'paif-paf-conteudo'],
  ['como escrever boas metas no PAF?', 'paif-paf-metas'],
  ['quais os cinco momentos do acompanhamento familiar?', 'paif-momentos'],
  ['acompanhamento particularizado ou em grupo?', 'paif-particularizado-grupo'],
  ['o que são compromissos no PAF?', 'paif-compromissos'],
  ['quantos encontros tem o acompanhamento?', 'paif-mediacoes'],
  ['quando reavaliar o PAF?', 'paif-reavaliar'],
  ['quando encerrar o acompanhamento?', 'paif-encerrar'], ['quanto tempo dura o acompanhamento familiar', 'paif-encerrar'],
  ['a família pode recusar o acompanhamento?', 'paif-nao-adere'], ['família que falta ao paif', 'paif-nao-adere'],
  ['como saber que o acompanhamento deu certo?', 'paif-exito'],
  ['o PAF é obrigatório?', 'paif-paf-faq'], ['quantas famílias por técnico?', 'paif-paf-faq'],
  ['erros comuns do PAF', 'paif-erros-paf'],
  ['o que é o prontuário da família?', 'paif-prontuario'],
  ['como o PAIF entra no RMA?', 'paif-rma'],
  ['quem compõe a equipe do PAIF?', 'paif-equipe'],
  ['qual o papel da psicologia no PAIF?', 'paif-psicologia'], ['o que o psicólogo faz no PAIF', 'paif-psicologia'],
  ['diferença entre PAIF e PAEFI', 'paif-x-paefi'], ['quando encaminhar para o CREAS?', 'paif-x-paefi'],
  ['diferença entre PAIF e SCFV', 'paif-x-scfv'],
  ['PAIF e Bolsa Família', 'paif-bolsa-familia'], ['família em descumprimento no PAIF', 'paif-bolsa-familia'],
  ['PAIF e BPC', 'paif-bpc'],
  ['o que é matricialidade sociofamiliar?', 'paif-matricialidade'], ['o que é familismo', 'paif-matricialidade'],
  ['o que é trabalho social com famílias e territórios?', 'paif-tsft'],
  ['como o PAIF trabalha em rede?', 'paif-rede'],
  ['PAIF e vigilância socioassistencial', 'paif-vigilancia'],
  ['PAIF em território de baixa densidade', 'paif-baixa-densidade'], ['o que é CRAS itinerante?', 'paif-baixa-densidade'],
  ['PAF com famílias migrantes', 'paif-migrantes-indigenas'], ['paif com indígenas', 'paif-migrantes-indigenas'],
  ['PAIF coletivo em Boa Vista', 'paif-boa-vista'],
  ['glossário do PAIF', 'paif-glossario'],
  ['paif com cuidadora de idoso', 'paif-cuidadores'], ['paif para pessoa com deficiência', 'paif-cuidadores'],
  ['criança fora da escola, o que o CRAS faz?', 'paif-escola'], ['o PAIF é gratuito?', 'paif-gratuidade'],
  ['o paif respeita a diversidade das famílias?', 'paif-diversidade'], ['o que é referenciar ao CRAS?', 'paif-referenciamento'],
  ['o que é o SPSBD-GC?', 'paif-spsbd-gc'], ['o que substitui o Criança Feliz?', 'paif-spsbd-gc'],
  ['posso obrigar a família a ir no PAIF?', 'paif-nao-adere'], ['visita surpresa do cras', 'paif-visita-domiciliar'],
  ['como faço o paf de uma família?', 'paif-paf'], ['acompanhamento familiar quantos meses?', 'paif-encerrar'],
  ['família sem certidão, o que o PAIF faz?', 'paif-documentacao'], ['campanhas socioeducativas do PAIF', 'paif-campanhas'],
  ['descobri violência na família acompanhada', 'paif-notificacao'],
  // erros de digitação
  ['o que é o paiff', 'paif-o-que-e'], ['oq é acompanhamneto familiar', 'paif-acompanhamento'],
  ['como fazer o plano de acompanhamneto', 'paif-paf'], ['o que é acolhia particularizada', 'paif-acolhida-particularizada'],
  ['visita domicilar do cras', 'paif-visita-domiciliar'], ['quais os objetivus do paif', 'paif-objetivos'],
  ['oficinas com familais', 'paif-oficinas'], ['diferença entre paif e paefy', 'paif-x-paefi'],
  ['me fala do paif', 'paif-o-que-e'], ['o paif atende quem', 'paif-usuarios'], ['qual a diferença entre acolhida e atendimento', 'paif-acolhida']
];
for (const [q, id] of casos) {
  const p = B.plan(q, { tabCat: '' });
  const got = p.result && p.result.psiId;
  confere('"' + q + '" → ' + id, got === id, 'veio ' + (got || p.kind));
}

// o termo solto continua no glossário; o badge de PAIF aparece nos verbetes novos
const solto = B.plan('paif', { tabCat: '' });
confere('"paif" sozinho → glossário (visão geral com atalhos)', solto.kind === 'concept' && solto.result.glossId === 'paif', solto.kind);
const um = B.plan('quais são os objetivos do PAIF?', { tabCat: '' });
confere('verbete de PAIF traz selo "Base PAIF" e a norma', /^Base PAIF/.test(um.result.badge) && /Tipificação/.test(um.result.note), um.result.badge);

// não rouba perguntas de outros assuntos
const fora = [
  ['telefone do CRAS', 'directory'], ['onde fica o CREAS', 'directory'],
  ['posso fazer psicoterapia no SUAS?', 'psi'], ['psicólogo é obrigatório no SUAS?', 'psi'],
  ['quanto é o valor do bolsa família', null],
  ['qual o horário do CRAS Cauamé', 'directory'], ['onde fica a delegacia da mulher', 'directory'],
  ['quero a lista de unidades de saúde familiar', null], ['como instalar o aplicativo no celular', null],
  ['qual a previsão do tempo amanhã', null], ['quantas escolas tem no Caimbé', null]
];
for (const [q, kind] of fora) {
  const p = B.plan(q, { tabCat: '' });
  const roubou = p.result && p.result.psiId && String(p.result.psiId).indexOf('paif-') === 0;
  confere('"' + q + '" não vira verbete de PAIF', !roubou, String(p.result && p.result.psiId));
  if (kind) confere('  e continua como ' + kind, p.kind === kind, p.kind);
}

// todo botão de "pergunte também" leva a uma resposta (nada de beco sem saída)
const seguem = new Set(); lista.forEach(e => e.follow.forEach(f => seguem.add(f)));
for (const f of seguem) {
  const p = B.plan(f, { tabCat: '' });
  confere('botão "' + f + '" tem resposta', !!(p.result && (p.result.psiId || p.result.glossId || p.kind === 'directory' || p.kind === 'manual')), p.kind);
}

// a IA recebe o verbete de PAIF como base do app
const ba = B.baseApp('quais são os objetivos do PAIF?');
confere('baseApp envia o verbete de PAIF à IA', ba.length > 0 && /PAIF/.test(ba[0].titulo), JSON.stringify(ba[0] && ba[0].titulo));

console.log(falhas ? '\n' + falhas + ' falha(s)' : '\nTudo certo');
process.exit(falhas ? 1 : 0);

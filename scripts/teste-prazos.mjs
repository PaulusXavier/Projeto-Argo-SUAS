// Teste da aba "Prazos e alertas do SUAS":  npm run test:prazos
// Carrega o bloco "puro" de js/prazos.js (sem navegador) e confere faixas, filtros, contagem, resumo e a integração com o app.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const lerArq = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const src = lerArq('js/prazos.js');
const ini = src.indexOf('/* PRAZOS:puro-início */'), fim = src.indexOf('/* PRAZOS:puro-fim */');
assert.ok(ini >= 0 && fim > ini, 'bloco puro não encontrado em js/prazos.js');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src.slice(ini, fim) + '\nthis.P = ArgoPrazos;', ctx);
const P = ctx.P;

let falhas = 0;
const confere = (nome, ok, extra) => { console.log((ok ? '✅ ' : '❌ ') + nome + (!ok && extra ? ' → ' + extra : '')); if (!ok) falhas++; };
const hoje = new Date(2026, 10, 12); // 12/11/2026

// datas
confere('data válida', !!P.dataValida('2026-11-12') && !P.dataValida('2026-02-30') && !P.dataValida('12/11/2026') && !P.dataValida(null));
confere('diasAte: hoje=0, amanhã=1, ontem=-1', P.diasAte('2026-11-12', hoje) === 0 && P.diasAte('2026-11-13', hoje) === 1 && P.diasAte('2026-11-11', hoje) === -1);
confere('diasAte atravessa o fim do ano', P.diasAte('2027-01-01', hoje) === 50);
confere('quando()', P.quando(0) === 'hoje' && P.quando(1) === 'amanhã' && P.quando(5) === 'em 5 dias' && P.quando(-3) === 'há 3 dias');

// faixas
confere('faixa', P.faixa(-1, false) === 'atrasado' && P.faixa(-14, false) === 'atrasado' && P.faixa(-15, false) === 'antigo' && P.faixa(0, false) === 'hoje' && P.faixa(7, false) === 'semana' && P.faixa(8, false) === 'mes' && P.faixa(30, false) === 'mes' && P.faixa(31, false) === 'depois' && P.faixa(-5, true) === 'feito');

// dados do projeto de verdade
const mdsSrc = lerArq('js/datas-cras-mds.js');
const w = {}; vm.runInNewContext(mdsSrc, { window: w });
const meta = w.ARGO_MDS;
const itens = P.montar(meta, []);
confere('monta todas as datas do ARGO_MDS (' + meta.datas.length + ')', itens.length === meta.datas.length, itens.length + '');
confere('ordenado por data', itens.every((x, i) => i === 0 || itens[i - 1].d <= x.d));
confere('ids únicos', new Set(itens.map(x => x.id)).size === itens.length);

// entrada com erro é ignorada
const sujo = P.montar({ categorias: { a: 'A' }, fontes: {}, datas: [null, { d: '2026-13-01', t: 'x' }, { d: '2026-11-20', t: '' }, { d: '2026-11-20', t: 'Bom', cat: 'a' }, { d: '2026-11-21', t: 'Cat inexistente', cat: 'zzz' }] },
  [{ id: 'u1', d: '2026-11-15', t: 'Meu RMA', obs: 'x' }, { id: 5, d: '2026-11-15', t: 'sem id' }, { id: 'u2', d: 'ruim', t: 'data ruim' }]);
confere('ignora entradas inválidas e mantém as boas', sujo.length === 3 && sujo.some(x => x.proprio && x.t === 'Meu RMA') && sujo.find(x => x.t === 'Cat inexistente').cat === 'outro', JSON.stringify(sujo.map(x => x.t)));

// filtro padrão: atrasados recentes primeiro, nada além de 90 dias, nada com mais de 14 dias de atraso
const pad = P.filtrar(itens, {}, hoje, {});
confere('visão padrão: sem prazo com > 14 dias de atraso', pad.every(x => x.dias >= -14));
confere('visão padrão: sem prazo além de 90 dias', pad.every(x => x.dias <= 90));
confere('visão padrão: atrasados vêm antes', (() => { let viuNaoAtrasado = false; for (const x of pad) { if (x.faixa !== 'atrasado') viuNaoAtrasado = true; else if (viuNaoAtrasado) return false; } return true; })());
const hojeRev = pad.find(x => x.d === '2026-11-12' && /REV26/.test(x.t));
confere('prazo REV26 de hoje cai em "hoje"', hojeRev && hojeRev.faixa === 'hoje');
const ontem = P.filtrar(itens, {}, new Date(2026, 10, 13), {}).find(x => x.d === '2026-11-12' && /REV26/.test(x.t));
confere('no dia seguinte esse prazo vira "já passou"', ontem && ontem.faixa === 'atrasado');

// "Ano todo": prazo muito antigo não vira alarme e vai para o fim da lista
const ano = P.filtrar(itens, {}, hoje, { janela: 'ano' });
confere('ano todo: prazos com mais de 14 dias de atraso são "antigo", não "atrasado"', ano.filter(x => x.dias < -14).every(x => x.faixa === 'antigo') && ano.some(x => x.faixa === 'antigo'));
confere('ano todo: "antigo" fica depois de tudo que é para agir', (() => { let viu = false; for (const x of ano) { if (x.faixa === 'antigo') viu = true; else if (viu && x.faixa !== 'feito') return false; } return true; })());
confere('contagem não conta "antigo"', P.contagem(itens, {}, hoje).atrasados === ano.filter(x => x.faixa === 'atrasado').length);

// marcar como feito
const idRev = hojeRev.id;
confere('feito some por padrão', !P.filtrar(itens, { [idRev]: '2026-11-12' }, hoje, {}).some(x => x.id === idRev));
confere('feito aparece quando se pede', P.filtrar(itens, { [idRev]: '2026-11-12' }, hoje, { feitos: true }).find(x => x.id === idRev).faixa === 'feito');

// categoria, busca, janela
confere('filtro por categoria', P.filtrar(itens, {}, hoje, { cat: 'censo', janela: 'tudo' }).every(x => x.cat === 'censo'));
confere('busca por texto', P.filtrar(itens, {}, hoje, { busca: 'saúde', janela: 'tudo' }).length > 0 && P.filtrar(itens, {}, hoje, { busca: 'zzzzxx', janela: 'tudo' }).length === 0);
confere('janela "ano" só traz o ano corrente', P.filtrar(itens, {}, hoje, { janela: 'ano' }).every(x => x.d.startsWith('2026')));
confere('janela "tudo" traz mais que a padrão', P.filtrar(itens, {}, hoje, { janela: 'tudo' }).length > pad.length);

// contagem
const c = P.contagem(itens, {}, hoje);
confere('contagem: atenção = atrasados + hoje + semana', c.atencao === c.atrasados + c.hoje + c.semana);
confere('contagem: ao marcar feito diminui', P.contagem(itens, { [idRev]: 'x' }, hoje).hoje === c.hoje - 1);
const proprio = P.montar({ datas: [], categorias: {} }, [{ id: 'u1', d: '2026-11-14', t: 'Entregar RMA' }]);
confere('prazo próprio entra na contagem e no filtro "meu"', P.contagem(proprio, {}, hoje).semana === 1 && P.filtrar(proprio, {}, hoje, { cat: 'meu' }).length === 1);

// resumo para copiar
const r = P.resumo(itens, {}, hoje, 30);
confere('resumo traz cabeçalho, data e aviso de conferência', /Prazos do SUAS \(12\/11\/2026\)/.test(r) && /12\/11/.test(r) && /Conferir sempre/.test(r), r.slice(0, 120));
confere('resumo vazio é gentil', /Sem prazos pendentes/.test(P.resumo([], {}, hoje, 30)));
confere('frase da semana', /Prazos dos próximos 7 dias/.test(P.fraseSemana(itens, {}, hoje)) && /Nenhum prazo oficial/.test(P.fraseSemana([], {}, hoje)));

// ---- atualização anual: repetição, importação e aviso de datas acabando
const ocA = P.ocorrencias('2024-02-29', 'anual', hoje);
confere('repete todo ano (29/02 cai no último dia de fev. em ano comum)', ocA.join() === '2025-02-28,2026-02-28,2027-02-28', ocA.join());
const ocM = P.ocorrencias('2026-01-31', 'mensal', hoje);
confere('repete todo mês (dia 31 em mês curto vira o último dia)', ocM.includes('2026-11-30') && ocM.includes('2026-12-31') && ocM.includes('2027-02-28') && ocM.every(d => d >= '2026-01-31'), ocM.join());
confere('sem repetição é só a data', P.ocorrencias('2026-05-05', '', hoje).join() === '2026-05-05');
confere('anual não gera ocorrência antes da data de criação', P.ocorrencias('2026-03-10', 'anual', hoje).join() === '2026-03-10,2027-03-10');
const rec = P.montar({ datas: [], categorias: {} }, [{ id: 'u9', d: '2025-11-20', t: 'RMA mensal', rep: 'mensal' }], [], hoje);
confere('prazo mensal gera várias ocorrências com id próprio e a mesma base', rec.length > 10 && new Set(rec.map(x => x.id)).size === rec.length && rec.every(x => x.base === 'u9' && x.id.startsWith('u9@')));
const rf = P.filtrar(rec, { [rec.find(x => x.d === '2026-11-20').id]: 'x' }, hoje, {});
const rf0 = P.filtrar(rec, {}, hoje, {});
confere('filtrar mantém base, repetição e origem (usados na tela para excluir a série)', rf0.length > 0 && rf0.every(x => x.base === 'u9' && x.rep === 'mensal') && P.filtrar(P.montar({ datas: [], categorias: {} }, [], [{ d: '2026-11-25', t: 'Imp' }], hoje), {}, hoje, {})[0].importado === true);
confere('marcar uma ocorrência como feita não marca as outras', !rf.some(x => x.d === '2026-11-20') && rf.some(x => x.d === '2026-12-20'));

const imp = P.parseImport('﻿data;texto;categoria;prevista;observacao\r\n2027-01-15;Prazo A;rev;sim;obs A\r\n20/02/2027;Prazo B;Censo SUAS;nao;\r\n# comentário\r\nxx;Prazo ruim;rev;;\r\n2027-03-01;;rev;;\r\n', meta);
confere('importa CSV com ; (cabeçalho, DD/MM/AAAA, nome da categoria, comentário)', imp.itens.length === 2 && imp.itens[0].cat === 'rev' && imp.itens[0].prev === true && imp.itens[1].d === '2027-02-20' && imp.itens[1].cat === 'censo', JSON.stringify(imp));
confere('importação avisa as linhas com erro', imp.erros.length === 2 && /Linha \d+: data inválida/.test(imp.erros[0]) && /falta o texto/.test(imp.erros[1]), JSON.stringify(imp.erros));
const impJ = P.parseImport('{"datas":[{"d":"2027-04-01","t":"Do JSON","cat":"cond","prev":true},{"d":"2027-13-01","t":"ruim"}]}', meta);
confere('importa JSON {datas:[...]}', impJ.itens.length === 1 && impJ.itens[0].cat === 'cond' && impJ.erros.length === 1);
confere('importa CSV com vírgula e tab', P.parseImport('2027-05-05,Com vírgula,rev', meta).itens.length === 1 && P.parseImport('2027-05-05\tCom tab\trev', meta).itens.length === 1);
confere('arquivo vazio ou JSON quebrado não derruba', P.parseImport('', meta).itens.length === 0 && P.parseImport('{quebrado', meta).erros.length === 1);
confere('categoria desconhecida vira "outro"', P.parseImport('2027-05-05;X;inventada', meta).itens[0].cat === 'outro');

const comImp = P.montar(meta, [], imp.itens.concat([{ d: meta.datas[0].d, t: meta.datas[0].t, cat: 'cond' }]), hoje);
confere('datas importadas entram na lista, marcadas, sem duplicar as do app', comImp.length === meta.datas.length + 2 && comImp.filter(x => x.importado).length === 2);

const cobOk = P.cobertura({ datas: [{ d: '2027-09-09' }], atualizadoEm: '2026-11-06' }, [], hoje);
confere('cobertura ok quando há mais de 60 dias de datas', cobOk.nivel === 'ok');
confere('aviso "perto" quando faltam até 60 dias', P.cobertura({ datas: [{ d: '2026-12-30' }] }, [], hoje).nivel === 'perto');
confere('aviso "vencido" quando as datas já acabaram', P.cobertura({ datas: [{ d: '2026-10-01' }] }, [], hoje).nivel === 'vencido');
confere('importar datas do ano novo tira o aviso', P.cobertura({ datas: [{ d: '2026-12-30' }] }, [{ d: '2027-12-30' }], hoje).nivel === 'ok');
confere('aviso "velho" quando conferido há mais de 150 dias', P.cobertura({ datas: [{ d: '2027-12-30' }], atualizadoEm: '2026-05-01' }, [], hoje).nivel === 'velho');
confere('sem nenhuma data é "vazio"', P.cobertura({ datas: [] }, [], hoje).nivel === 'vazio');
const cobReal = P.cobertura(meta, [], hoje);
confere('dados reais do app: cobertura até ' + cobReal.ultima, cobReal.ultima >= '2026-12-01' && cobReal.nivel !== 'vazio');

// integração com o app
const html = lerArq('index.html'), app = lerArq('js/app.js'), sw = lerArq('sw.js'), build = lerArq('scripts/build.mjs');
confere('index.html tem o botão da aba e o script', /data-cat="prazos"/.test(html) && /js\/prazos\.js/.test(html));
confere('index.html carrega prazos.js depois dos dados e antes do app.js', html.indexOf('<script src="js/datas-cras-mds.js"') < html.indexOf('<script src="js/prazos.js"') && html.indexOf('<script src="js/prazos.js"') < html.indexOf('<script src="js/app.js"'));
confere('app.js registra a aba em PANEL_TABS', /prazos:\s*\{ rootId: 'prazosRoot', *render: renderPrazosCard, *init: initPrazosPanel/.test(app));
confere('sw.js guarda o arquivo (2 listas) e build.mjs o minifica', (sw.match(/js\/prazos\.js/g) || []).length === 2 && /js\/prazos\.js/.test(build));
confere('sem onclick inline na tela (usa delegação)', !/onclick=/.test(src));
confere('prazos próprios usam o armazenamento protegido (toolpad_)', /ARGO_PRAZOS_KEY = 'toolpad_prazos_v1'/.test(src) && /safeStorage\.(getJSON|set)/.test(src) && !/localStorage\./.test(src.slice(src.indexOf('var ARGO_PRAZOS_KEY'), src.indexOf('function argoPrazosEsc'))));
confere('app.js atualiza o número da aba ao destrancar', /argoPrazosAtualizarBadge\(\);\n      setTimeout/.test(app));
// o prefixo toolpad_ é de fato tratado como dado sensível pelo app (cifra, backup e "Apagar dados salvos")
confere('toolpad_ continua nos prefixos sensíveis do app', /SENSITIVE_DATA_PREFIXES = \[[^\]]*'toolpad_'/.test(app));

console.log('\n' + (falhas ? falhas + ' falha(s)' : 'Tudo certo'));
process.exit(falhas ? 1 : 0);

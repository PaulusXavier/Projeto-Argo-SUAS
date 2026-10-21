// Gera o detalhamento dos PSICÓLOGOS dos municípios do interior de Roraima (Censo SUAS 2025), a partir do pacote
// "Censo_SUAS_2025_Roraima_pacote_IA" (CSVs agregados: sem nomes, CPF nem identificador de unidade).
//
// Uso:  node scripts/gerar-censo-psi-rr.mjs <pasta-com-os-CSVs> <pasta-de-saida>
// Saída (na pasta de saída):
//   cp-perfil.js        blocos CP_PERFIL_MUN, CP_EQUIPE_MUN e CP_INTERIOR para colar em js/argo-cerebro.js
//   censo-interior.md   seções para knowledge/documentos/censo-suas-2025-roraima-psicologos.md (repositório paulus)
//   conferencia.txt     o que foi conferido (soma de cada dimensão x total de psicólogos; contagens x tabela principal)
//
// São contagens de REGISTROS de RH por módulo, nunca de pessoas únicas. Para atualizar quando sair um novo Censo:
// rode de novo com os CSVs novos e confira o conferencia.txt (qualquer "DIVERGE" precisa ser entendido antes de publicar).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [, , PASTA, SAIDA] = process.argv;
if (!PASTA || !SAIDA) { console.error('Uso: node scripts/gerar-censo-psi-rr.mjs <pasta-csv> <pasta-saida>'); process.exit(1); }

function csv(arq) {
  const txt = readFileSync(join(PASTA, arq), 'utf8').replace(/^﻿/, '');
  const linhas = []; let campo = '', lin = [], asp = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (asp) { if (c === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else asp = false; } else campo += c; }
    else if (c === '"') asp = true;
    else if (c === ',') { lin.push(campo); campo = ''; }
    else if (c === '\n') { lin.push(campo.replace(/\r$/, '')); linhas.push(lin); lin = []; campo = ''; }
    else campo += c;
  }
  if (campo || lin.length) { lin.push(campo.replace(/\r$/, '')); linhas.push(lin); }
  const cab = linhas.shift();
  return linhas.filter(l => l.length === cab.length).map(l => Object.fromEntries(cab.map((k, i) => [k, l[i]])));
}

const MOD = { 'CRAS': 'cras', 'CREAS': 'creas', 'Centro de Convivência': 'conv', 'Unidade de Acolhimento': 'acol', 'Família Acolhedora — equipe': 'fam', 'Gestão Municipal do SUAS': 'gest', 'Posto de Cadastramento do CadÚnico': 'posto', 'Fundo Municipal de Assistência Social': 'fundo', 'Centro POP': 'pop' };
const NOME_MOD = { cras: 'CRAS', creas: 'CREAS', conv: 'Centro de Convivência', acol: 'Unidade de Acolhimento', fam: 'Família Acolhedora (equipe)', gest: 'Gestão Municipal do SUAS', posto: 'Posto de Cadastramento do CadÚnico', fundo: 'Fundo Municipal de Assistência Social', pop: 'Centro POP' };
const ORD = ['cras', 'creas', 'conv', 'acol', 'fam', 'gest', 'posto', 'fundo'];
const BV = 'Boa Vista';

const principal = csv('roraima_psicologos_por_municipio_modulo.csv').filter(x => x.nivel_geografico === 'municipal' && x.municipio_ou_recorte !== BV && MOD[x.modulo_suas] && /^\d{6}$/.test(x.codigo_ibge_municipio_ou_uf));
const perfil = csv('roraima_perfil_agregado_psicologos.csv');
const prof = csv('roraima_profissoes_por_municipio_modulo.csv');
const MUNS = [...new Set(principal.map(x => x.municipio_ou_recorte))].sort((a, b) => a.localeCompare(b, 'pt'));
const conf = [];
const confere = (ok, msg) => conf.push((ok ? 'ok      ' : 'DIVERGE ') + msg);

// ---------- rótulos harmonizados (as respostas do Censo variam em maiúsculas, gênero e redação) ----------
const sem = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
const SEXO = s => /^fem/.test(sem(s)) ? 'f' : /^masc/.test(sem(s)) ? 'm' : 'x';
const ESCOL = s => { const t = sem(s); return /superior incompleto/.test(t) ? 'superior incompleto' : /superior completo/.test(t) ? 'superior completo' : /especializ/.test(t) ? 'especialização' : /mestrado/.test(t) ? 'mestrado' : /doutorado/.test(t) ? 'doutorado' : /fundamental/.test(t) ? 'fundamental completo' : /medio/.test(t) ? 'ensino médio' : t; };
const VINC = s => { const t = sem(s); return /estatut/.test(t) ? 'estat' : /temporari/.test(t) ? 'temp' : /comission/.test(t) ? 'comis' : /clt/.test(t) ? 'clt' : /nao permanente/.test(t) ? 'outro' : /terceiriz/.test(t) ? 'terc' : /voluntari/.test(t) ? 'vol' : /empresa|cooperativa|entidade/.test(t) ? 'empr' : t; };
const FUNC = s => { const t = sem(s); return /tecnic\w* de nivel superior/.test(t) ? 'tec' : /apoio administrativo/.test(t) ? 'apoio' : /coordenador/.test(t) ? 'coord' : /estagiari/.test(t) ? 'estag' : /servicos gerais/.test(t) ? 'gerais' : /cuidador/.test(t) ? 'cuid' : /outros/.test(t) ? 'outras' : t; };
const CARGA = s => String(s).replace(/^De /, 'de ').replace(/ horas semanais/, ' h semanais');
const SERV = s => { const t = sem(s); return /paif/.test(t) ? 'PAIF' : /beneficios eventuais/.test(t) ? 'Benefícios Eventuais' : /convivencia e fortalecimento/.test(t) ? 'Convivência e Fortalecimento de Vínculos' : /psb no domicilio/.test(t) ? 'Serviço de PSB no domicílio' : /bolsa familia/.test(t) ? 'Bolsa Família e condicionalidades' : /cadunico|cadastramento/.test(t) ? 'CadÚnico' : /crianca feliz/.test(t) ? 'Criança Feliz' : /nao informado/.test(t) ? 'não informado' : /outros/.test(t) ? 'outros serviços' : String(s); };
const ROT = {
  sexo: { f: ['mulher', 'mulheres'], m: ['homem', 'homens'] },
  vinc: { estat: ['estatutário', 'estatutários'], temp: ['temporário', 'temporários'], comis: ['comissionado', 'comissionados'], clt: ['celetista (CLT)', 'celetistas (CLT)'], outro: ['com outro vínculo não permanente', 'com outro vínculo não permanente'], terc: ['terceirizado', 'terceirizados'], vol: ['voluntário', 'voluntários'], empr: ['de empresa/cooperativa/entidade prestadora', 'de empresa/cooperativa/entidade prestadora'] },
  func: { tec: ['técnico de nível superior', 'técnicos de nível superior'], apoio: ['em apoio administrativo', 'em apoio administrativo'], coord: ['coordenador(a)/dirigente', 'coordenadores(as)/dirigentes'], estag: ['estagiário', 'estagiários'], gerais: ['em serviços gerais', 'em serviços gerais'], cuid: ['cuidador(a)', 'cuidadores(as)'], outras: ['em outras funções', 'em outras funções'] }
};
const lista = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1];
const pl = (n, r) => n + ' ' + (n === 1 ? r[0] : r[1]);
const ordem = (m, ord) => Object.entries(m).sort((a, b) => b[1] - a[1] || (ord ? ord.indexOf(a[0]) - ord.indexOf(b[0]) : 0));

// soma por dimensão com rótulo harmonizado → { dim: { cat: n } }
function dims(linhas) {
  const o = {};
  for (const x of linhas) {
    const f = { sexo: SEXO, escolaridade: ESCOL, vinculo: VINC, funcao: FUNC, carga_horaria_semanal: CARGA, servico_principal: SERV, segundo_servico: SERV }[x.dimensao];
    if (!f) continue;
    const c = f(x.categoria), q = Number(x.quantidade_psicologos);
    (o[x.dimensao] = o[x.dimensao] || {})[c] = ((o[x.dimensao] || {})[c] || 0) + q;
  }
  return o;
}
function frases(d, total, comServico) {
  const out = [];
  const soma = k => d[k] ? Object.values(d[k]).reduce((s, v) => s + v, 0) : 0;
  if (d.sexo) out.push('sexo: ' + lista(ordem(d.sexo).map(([k, v]) => k === 'x' ? v + ' não informado' : pl(v, ROT.sexo[k]))));
  if (d.escolaridade) out.push('escolaridade: ' + lista(ordem(d.escolaridade).map(([k, v]) => v + ' com ' + k)));
  if (d.vinculo) out.push('vínculo: ' + lista(ordem(d.vinculo).map(([k, v]) => ROT.vinc[k] ? (/^(com|de) /.test(ROT.vinc[k][0]) ? v + ' ' + ROT.vinc[k][0] : pl(v, ROT.vinc[k])) : v + ' ' + k)));
  if (d.funcao) out.push('função: ' + lista(ordem(d.funcao).map(([k, v]) => ROT.func[k] ? (/^em /.test(ROT.func[k][0]) ? v + ' ' + ROT.func[k][0] : pl(v, ROT.func[k])) : v + ' ' + k)));
  if (d.carga_horaria_semanal) {
    const e = ordem(d.carga_horaria_semanal);
    out.push('carga horária: ' + (e.length === 1 && e[0][1] > 1 ? 'todos ' + e[0][0] : lista(e.map(([k, v]) => v + ' ' + k))));
  }
  if (comServico && d.servico_principal) out.push('serviço principal: ' + ordem(d.servico_principal).map(([k, v]) => k + ' ' + v).join(', '));
  if (comServico && d.segundo_servico) out.push('segundo serviço: ' + ordem(d.segundo_servico).map(([k, v]) => k + ' ' + v).join(', '));
  return out;
}

// ---------- equipe de RH (todas as profissões), mesmo agrupamento já usado para Boa Vista ----------
const GRUPO = s => { const t = sem(s); return /nivel medio/.test(t) ? 'medio' : /assistente social/.test(t) ? 'as' : /sem formacao/.test(t) ? 'semform' : /psicolog/.test(t) ? 'psi' : /outr[ao]s? (\(o\) )?(profissional|formacao)/.test(t) || /outra\(o\) profissional|outro\(a\) profissional|outra formacao/.test(t) ? 'outrasup' : /pedagog/.test(t) ? 'ped' : /advogad/.test(t) ? 'adv' : 'outras'; };
const ROT_EQ = { medio: ['de nível médio', 'de nível médio'], as: ['assistente social', 'assistentes sociais'], semform: ['sem formação profissional', 'sem formação profissional'], psi: ['**psicólogo**', '**psicólogos**'], outrasup: ['de outra formação de nível superior', 'de outra formação de nível superior'], ped: ['pedagogo', 'pedagogos'], adv: ['advogado', 'advogados'], outras: ['de outras profissões', 'de outras profissões'] };
function equipe(linhas, rotulo) {
  const g = {}, total = linhas.reduce((s, x) => s + Number(x.quantidade_registros_RH), 0);
  for (const x of linhas) { const k = GRUPO(x.profissao_registrada); g[k] = (g[k] || 0) + Number(x.quantidade_registros_RH); }
  const ordemFixa = ['medio', 'as', 'semform', 'psi', 'outrasup', 'ped', 'adv', 'outras'];
  const e = Object.entries(g).sort((a, b) => b[1] - a[1] || ordemFixa.indexOf(a[0]) - ordemFixa.indexOf(b[0]));
  const bonito = e.map(([k, v]) => v + ' ' + (v === 1 ? ROT_EQ[k][0] : ROT_EQ[k][1]));
  return { total, g, texto: rotulo + ': ' + lista(bonito) + ' (de ' + total + ')' };
}

// ---------- montagem ----------
const PERFIL = {}, EQUIPE = {}, CONT = {};
for (const m of MUNS) {
  for (const l of principal.filter(x => x.municipio_ou_recorte === m)) {
    const k = MOD[l.modulo_suas];
    const nRH = Number(l.registros_de_trabalhadores_RH), nPsi = Number(l.registros_de_psicologos);
    if (nRH > 0) (CONT[m] = CONT[m] || {})[k] = [nRH, nPsi];   // módulo sem linha de RH no arquivo fica de fora (isso não prova que o serviço não exista)
    const lp = perfil.filter(x => x.municipio_ou_recorte === m && x.modulo_suas === l.modulo_suas);
    if (nPsi > 0) {
      const d = dims(lp);
      for (const dim of ['sexo', 'escolaridade', 'vinculo', 'funcao', 'carga_horaria_semanal']) {
        const s = d[dim] ? Object.values(d[dim]).reduce((a, b) => a + b, 0) : 0;
        if (s !== nPsi) confere(false, m + ' · ' + l.modulo_suas + ' · ' + dim + ': soma ' + s + ' ≠ ' + nPsi + ' psicólogos (dimensão incompleta na fonte)');
      }
      (PERFIL[m] = PERFIL[m] || {})[k] = frases(d, nPsi, k === 'cras');
    }
    const lq = prof.filter(x => x.municipio_ou_recorte === m && x.modulo_suas === l.modulo_suas);
    if (nRH > 0 && lq.length) {
      const e = equipe(lq, 'equipe de RH ' + (k === 'cras' || k === 'creas' ? 'do ' + NOME_MOD[k] : 'de ' + NOME_MOD[k]));
      confere(e.total === nRH, m + ' · ' + l.modulo_suas + ': equipe soma ' + e.total + ' × RH ' + nRH);
      confere((e.g.psi || 0) === nPsi, m + ' · ' + l.modulo_suas + ': psicólogos na equipe ' + (e.g.psi || 0) + ' × tabela principal ' + nPsi);
      if (k === 'cras' || k === 'creas') (EQUIPE[m] = EQUIPE[m] || {})[k] = e.texto.replace(/^equipe de RH do (CRAS|CREAS)/, 'equipe de RH dos $1');
    }
  }
}
// interior = todos os municípios exceto Boa Vista
const INT = { total: 0, mod: {}, perfil: {}, equipe: {}, semPsi: {}, semRH: {}, comPsi: {}, rank: [] };
for (const k of ['cras', 'creas']) {
  const nome = NOME_MOD[k], mod = Object.keys(MOD).find(x => MOD[x] === k);
  const linhas = perfil.filter(x => x.municipio_ou_recorte !== BV && x.modulo_suas === mod && MUNS.includes(x.municipio_ou_recorte));
  const n = MUNS.reduce((s, m) => s + (CONT[m]?.[k]?.[1] || 0), 0), rh = MUNS.reduce((s, m) => s + (CONT[m]?.[k]?.[0] || 0), 0);
  INT.mod[k] = [rh, n];
  INT.perfil[k] = frases(dims(linhas), n, k === 'cras');
  const lq = prof.filter(x => x.municipio_ou_recorte !== BV && x.modulo_suas === mod && MUNS.includes(x.municipio_ou_recorte));
  INT.equipe[k] = equipe(lq, 'equipe de RH dos ' + nome + ' dos 14 municípios do interior').texto;
  INT.comPsi[k] = MUNS.filter(m => (CONT[m]?.[k]?.[1] || 0) > 0).map(m => [m, CONT[m][k][1]]);
  INT.semPsi[k] = MUNS.filter(m => CONT[m]?.[k] && CONT[m][k][1] === 0);
  INT.semRH[k] = MUNS.filter(m => !CONT[m]?.[k]);
  confere(linhas.reduce((s, x) => s + (x.dimensao === 'sexo' ? Number(x.quantidade_psicologos) : 0), 0) === n, 'interior · ' + nome + ': soma do sexo × registros de psicólogos (' + n + ')');
}
INT.total = MUNS.reduce((s, m) => s + ORD.reduce((t, k) => t + (CONT[m]?.[k]?.[1] || 0), 0), 0);
INT.rank = MUNS.map(m => [m, ORD.reduce((t, k) => t + (CONT[m]?.[k]?.[1] || 0), 0)]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt'));
confere(MUNS.every(m => ['conv', 'acol', 'fam', 'gest', 'posto', 'fundo', 'pop'].every(k => !(CONT[m]?.[k]?.[1]))), 'interior: nenhum psicólogo fora de CRAS e CREAS (a seção de visão geral afirma isso)');
confere(INT.total === 26, 'interior: ' + INT.total + ' registros de psicólogos (esperado 26 = 69 em municípios identificados − 43 de Boa Vista)');

// ---------- saídas ----------
mkdirSync(SAIDA, { recursive: true });
const js = [];
js.push('  // Psicólogos dos 14 municípios do interior (Censo SUAS 2025): perfil agregado e composição da equipe de RH.');
js.push('  // GERADO por scripts/gerar-censo-psi-rr.mjs a partir dos CSVs do pacote do Censo; não edite à mão. Mesmo formato de CP_BV_PERFIL / CP_BV_EQUIPE.');
js.push('  var CP_PERFIL_MUN = ' + JSON.stringify(PERFIL, null, 1).replace(/\n\s*/g, ' ').replace(/\{ "/g, '{\n      "').replace(/\], "/g, '],\n      "').replace(/ \}, "/g, ' },\n    "') + ';');
js.push('  var CP_EQUIPE_MUN = ' + JSON.stringify(EQUIPE, null, 1).replace(/\n\s*/g, ' ').replace(/\{ "/g, '{\n      "').replace(/", "/g, '",\n      "').replace(/ \}, "/g, ' },\n    "') + ';');
js.push('  // Interior (14 municípios, sem Boa Vista): [registros de RH, registros de psicólogos] por módulo; perfil; equipe; quem tem e quem não tem psicólogo.');
js.push('  var CP_INTERIOR = ' + JSON.stringify({ total: INT.total, mod: INT.mod, perfil: INT.perfil, equipe: INT.equipe, comPsi: INT.comPsi, semPsi: INT.semPsi, semRH: INT.semRH, rank: INT.rank }) + ';');
writeFileSync(join(SAIDA, 'cp-perfil.js'), js.join('\n') + '\n');

// markdown para o Paulus (cada "##" vira um trecho; texto curto, porque o Argo corta em 900 caracteres)
const md = [];
const fim = s => s.replace(/\*\*/g, '');
const dig = (arr) => arr.map(x => x[0] + ' ' + x[1]).join(', ');
md.push('## Psicólogos nos 14 municípios do interior de Roraima: visão geral');
md.push('Fora de Boa Vista, os 14 municípios com município identificado somam ' + INT.total + ' registros de psicólogos no Censo SUAS 2025: ' + INT.mod.cras[1] + ' nos CRAS e ' + INT.mod.creas[1] + ' nos CREAS. Boa Vista tem 43 dos 69 registros em municípios identificados. Nos módulos de Gestão Municipal, Fundo Municipal e Posto de Cadastramento do interior não há registro de psicólogo, e nenhum município do interior tem Centro de Convivência, Família Acolhedora ou Unidade de Acolhimento com psicólogo no arquivo (o acolhimento com IBGE=14 não é de município algum). São registros de RH por módulo, não pessoas únicas.');
md.push('');
md.push('## Psicólogos dos municípios do interior de Roraima: ordem por número de registros');
md.push('Interior, soma dos módulos municipais: ' + INT.rank.map(([m, n]) => m + ' ' + n).join('; ') + '. Contagem de registros de RH no Censo SUAS 2025; não mede cobertura nem suficiência de equipe e não deve ser comparada sem considerar o porte do município.');
md.push('');
for (const k of ['cras', 'creas']) {
  md.push('## Psicólogos dos ' + NOME_MOD[k] + ' do interior de Roraima: perfil agregado');
  md.push('Nos ' + INT.mod[k][1] + ' registros de psicólogos dos ' + NOME_MOD[k] + ' dos municípios do interior (de ' + INT.mod[k][0] + ' registros de RH): ' + fim(INT.perfil[k].join('; ')) + '. Com psicólogo registrado: ' + dig(INT.comPsi[k]) + '.' + (INT.semPsi[k].length ? ' Sem psicólogo registrado no módulo: ' + INT.semPsi[k].join(', ') + '.' : '') + (INT.semRH[k].length ? ' Sem linhas de RH desse módulo no arquivo: ' + INT.semRH[k].join(', ') + '.' : '') + ' Categorias agregadas, sem pessoas identificadas.');
  md.push('');
  md.push('## Equipe de RH dos ' + NOME_MOD[k] + ' do interior de Roraima: composição por profissão');
  md.push(fim(INT.equipe[k]).replace(/^equipe/, 'Equipe') + '. Registros de RH do Censo SUAS 2025, não pessoas únicas.');
  md.push('');
}
for (const m of MUNS) {
  const c = CONT[m] || {}, partes = [];
  for (const k of ORD) if (c[k]) partes.push(NOME_MOD[k] + ': ' + c[k][1] + ' de ' + c[k][0]);
  let t = m + ' no Censo SUAS 2025, registros de psicólogos sobre registros de RH por módulo: ' + partes.join('; ') + '.';
  const pf = ['cras', 'creas'].filter(k => PERFIL[m]?.[k]).map(k => 'Perfil nos ' + NOME_MOD[k] + ' (' + c[k][1] + '): ' + PERFIL[m][k].join('; ') + '.');
  const eq = ['cras', 'creas'].filter(k => EQUIPE[m]?.[k]).map(k => fim(EQUIPE[m][k]) + '.');
  md.push('## ' + m + ': registros de psicólogos e perfil no Censo SUAS 2025');
  md.push(t + ' ' + pf.join(' ') + ' Registros de RH, não pessoas únicas; módulo ausente não prova que o serviço não exista.');
  md.push('');
  if (eq.length) {
    md.push('## ' + m + ': composição da equipe de RH dos CRAS e CREAS no Censo SUAS 2025');
    md.push(m + ': ' + eq.map(x => x.replace(/^equipe/, 'Equipe')).join(' ') + ' Registros de RH do Censo SUAS 2025, não pessoas únicas.');
    md.push('');
  }
}
writeFileSync(join(SAIDA, 'censo-interior.md'), md.join('\n'));
md.push('');
const longos = md.filter(l => !l.startsWith('##') && l.length > 900);
confere(longos.length === 0, 'trechos de markdown ≤ 900 caracteres (o Argo corta em 900): ' + longos.map(l => l.length + ' «' + l.slice(0, 40) + '»').join(' | '));
writeFileSync(join(SAIDA, 'conferencia.txt'), conf.join('\n') + '\n');
console.log(conf.filter(l => l.startsWith('DIVERGE')).join('\n') || 'Sem divergências.');
console.log('Municípios: ' + MUNS.length + ' · interior: ' + INT.total + ' registros de psicólogos.');

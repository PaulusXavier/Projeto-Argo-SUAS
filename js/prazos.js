/* ============================================================================
   PRAZOS E ALERTAS DO SUAS — aba "Prazos"
   ----------------------------------------------------------------------------
   Lê as datas de js/datas-cras-mds.js (window.ARGO_MDS: revisão/averiguação do
   CadÚnico, condicionalidades, Censo SUAS, base mensal) e mostra, em ordem de
   urgência, o que está atrasado, vence hoje, nesta semana, neste mês e depois.
   Além disso:
     • "Feito": marca o prazo como cumprido (guardado só neste aparelho);
     • "Meus prazos": você acrescenta os seus (RMA, relatório, reunião…);
     • "Copiar lista": texto pronto para colar no WhatsApp ou no e-mail;
     • número no botão da aba = quantos prazos pedem atenção (atrasados + 7 dias).
   Nada sai do aparelho. NÃO escreva nome de pessoa atendida nos seus prazos.
   Armazenamento: safeStorage 'toolpad_prazos_v1' (cifrado, entra no backup, some em "Apagar dados salvos") → { custom: [...], done: {id: 'AAAA-MM-DD'} }.

   A parte de CÁLCULO (bloco "puro") não usa o navegador e é testada em
   scripts/teste-prazos.mjs  (npm run test:prazos).
   ============================================================================ */

/* PRAZOS:puro-início */
var ArgoPrazos = (function () {
  var JANELA_PASSADO = 14;   // prazo que passou há até 14 dias ainda aparece como "já passou" (se não marcado)
  var JANELA_PADRAO = 90;    // visão padrão: próximos 90 dias

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(dt) { return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); }
  function dataValida(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]);
    return (d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2]) ? d : null;
  }
  function meiaNoite(dt) { return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()); }
  // Dias de "hoje" até a data (negativo = já passou).
  function diasAte(s, hoje) {
    var d = dataValida(s);
    if (!d) return NaN;
    return Math.round((d - meiaNoite(hoje)) / 86400000);
  }
  function idDe(d, t) { return 'm' + d + '|' + String(t).trim().slice(0, 140); }

  // Datas em que um prazo próprio cai. Sem repetição: só a data. "anual": o mesmo dia/mês do ano passado até o próximo;
  // "mensal": o mesmo dia de 2 meses atrás até 14 meses à frente (dia 31 em mês curto vira o último dia do mês).
  function ocorrencias(d, rep, hoje) {
    if (!rep) return [d];
    var p = d.split('-').map(Number), out = [];
    function no(ano, mes) { // mes 0-11
      var ult = new Date(ano, mes + 1, 0).getDate();
      return ano + '-' + pad(mes + 1) + '-' + pad(Math.min(p[2], ult));
    }
    if (rep === 'anual') {
      for (var a = hoje.getFullYear() - 1; a <= hoje.getFullYear() + 1; a++) if (a >= p[0]) out.push(no(a, p[1] - 1));
    } else {
      for (var k = -2; k <= 14; k++) {
        var dt = new Date(hoje.getFullYear(), hoje.getMonth() + k, 1);
        var s = no(dt.getFullYear(), dt.getMonth());
        if (s >= d) out.push(s);
      }
    }
    return out;
  }

  // Até quando as datas oficiais (do arquivo do app + importadas) cobrem, e se já é hora de atualizar.
  function cobertura(meta, importados, hoje) {
    var ult = '';
    var lista = (meta && Array.isArray(meta.datas) ? meta.datas : []).concat(Array.isArray(importados) ? importados : []);
    lista.forEach(function (it) { if (it && dataValida(it.d) && it.d > ult) ult = it.d; });
    var atual = meta && meta.atualizadoEm && dataValida(meta.atualizadoEm) ? meta.atualizadoEm : '';
    var r = { ultima: ult, atualizadoEm: atual, nivel: 'ok', msg: '' };
    if (!ult) { r.nivel = 'vazio'; r.msg = 'Não há datas oficiais cadastradas. Importe um arquivo ou edite js/datas-cras-mds.js.'; return r; }
    var dias = diasAte(ult, hoje);
    if (dias < 0) { r.nivel = 'vencido'; r.msg = 'As datas oficiais acabaram em ' + dataCurta(ult) + '/' + ult.slice(0, 4) + '. Atualize para o novo ano (veja “Atualizar datas oficiais”).'; }
    else if (dias <= 60) { r.nivel = 'perto'; r.msg = 'As datas oficiais vão só até ' + dataCurta(ult) + '/' + ult.slice(0, 4) + ' (' + quando(dias) + '). Quando o MDS publicar o calendário do próximo ano, atualize.'; }
    else if (atual && diasAte(atual, hoje) < -150) { r.nivel = 'velho'; r.msg = 'As datas foram conferidas em ' + dataCurta(atual) + '/' + atual.slice(0, 4) + '. Vale conferir se o MDS publicou mudanças.'; }
    return r;
  }

  // Lê um arquivo de datas (.json ou .csv/.txt) e devolve { itens:[{d,t,cat,prev,obs}], erros:[texto] }.
  // CSV: data;texto;categoria;prevista;observação  (separador ; , ou tab; data AAAA-MM-DD ou DD/MM/AAAA; cabeçalho opcional).
  // JSON: lista de objetos {d,t,cat,prev,obs} ou {datas:[...]}. Máx. 500 linhas.
  function lerData(s) {
    s = String(s == null ? '' : s).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) || null;
    if (m) return dataValida(s) ? s : '';
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (!m) return '';
    var r = m[3] + '-' + pad(Number(m[2])) + '-' + pad(Number(m[1]));
    return dataValida(r) ? r : '';
  }
  function chaveCat(txt, meta) {
    var t = String(txt || '').trim().toLowerCase(), cats = (meta && meta.categorias) || {};
    if (!t) return 'outro';
    for (var k in cats) if (k.toLowerCase() === t || String(cats[k]).toLowerCase() === t) return k;
    return 'outro';
  }
  function parseImport(texto, meta) {
    var itens = [], erros = [], bruto = String(texto == null ? '' : texto).replace(/^\uFEFF/, '').trim();
    if (!bruto) return { itens: itens, erros: ['O arquivo está vazio.'] };
    var linhas = [];
    if (bruto.charAt(0) === '[' || bruto.charAt(0) === '{') {
      var j;
      try { j = JSON.parse(bruto); } catch (e) { return { itens: itens, erros: ['O arquivo .json está com erro de formato.'] }; }
      var arr = Array.isArray(j) ? j : (j && Array.isArray(j.datas) ? j.datas : []);
      arr.forEach(function (o, i) { linhas.push({ n: i + 1, d: o && o.d, t: o && o.t, cat: o && o.cat, prev: o && o.prev, obs: o && o.obs }); });
    } else {
      var rows = bruto.split(/\r?\n/).filter(function (x) { return x.trim() && x.trim().charAt(0) !== '#'; });
      var sep = rows[0].indexOf(';') >= 0 ? ';' : (rows[0].indexOf('\t') >= 0 ? '\t' : ',');
      rows.forEach(function (row, i) {
        var c = row.split(sep).map(function (x) { return x.trim().replace(/^"(.*)"$/, '$1'); });
        if (i === 0 && !lerData(c[0])) return; // cabeçalho
        linhas.push({ n: i + 1, d: c[0], t: c[1], cat: c[2], prev: /^(s|sim|1|true|x|prev)/i.test(c[3] || ''), obs: c[4] });
      });
    }
    if (linhas.length > 500) { erros.push('Só as primeiras 500 linhas foram lidas.'); linhas = linhas.slice(0, 500); }
    linhas.forEach(function (l) {
      var d = lerData(l.d), t = String(l.t == null ? '' : l.t).trim();
      if (!d) { erros.push('Linha ' + l.n + ': data inválida (use AAAA-MM-DD ou DD/MM/AAAA).'); return; }
      if (!t) { erros.push('Linha ' + l.n + ': falta o texto do prazo.'); return; }
      itens.push({ d: d, t: t.slice(0, 140), cat: chaveCat(l.cat, meta), prev: !!l.prev, obs: l.obs ? String(l.obs).trim().slice(0, 240) : '' });
    });
    return { itens: itens, erros: erros.slice(0, 8) };
  }

  // Junta as datas oficiais (ARGO_MDS) e as do usuário em uma lista só, já ordenada.
  // Entrada inválida é ignorada: um erro de digitação nunca derruba a aba.
  function montar(meta, custom, importados, hoje) {
    hoje = hoje || new Date();
    var out = [], vistos = {};
    var cats = (meta && meta.categorias) || {};
    var fontes = (meta && meta.fontes) || {};
    var lista = meta && Array.isArray(meta.datas) ? meta.datas : [];
    lista.forEach(function (it) {
      if (!it || !dataValida(it.d) || typeof it.t !== 'string' || !it.t.trim()) return;
      out.push({
        id: idDe(it.d, it.t), d: it.d, t: it.t.trim(), cat: cats[it.cat] ? it.cat : 'outro',
        catNome: cats[it.cat] || 'MDS', prev: !!it.prev, obs: typeof it.obs === 'string' ? it.obs : '',
        fonte: it.f && fontes[it.f] ? fontes[it.f] : null, proprio: false, importado: false
      });
      vistos[out[out.length - 1].id] = 1;
    });
    // datas oficiais trazidas de arquivo (atualização do ano sem mexer no código); repetida do arquivo do app é ignorada
    (Array.isArray(importados) ? importados : []).forEach(function (it) {
      if (!it || !dataValida(it.d) || typeof it.t !== 'string' || !it.t.trim()) return;
      var id = idDe(it.d, it.t);
      if (vistos[id]) return;
      vistos[id] = 1;
      out.push({
        id: id, d: it.d, t: it.t.trim().slice(0, 140), cat: cats[it.cat] ? it.cat : 'outro', catNome: cats[it.cat] || 'MDS',
        prev: !!it.prev, obs: typeof it.obs === 'string' ? it.obs.slice(0, 240) : '', fonte: null, proprio: false, importado: true
      });
    });
    (Array.isArray(custom) ? custom : []).forEach(function (it) {
      if (!it || typeof it.id !== 'string' || !dataValida(it.d) || typeof it.t !== 'string' || !it.t.trim()) return;
      var rep = it.rep === 'anual' || it.rep === 'mensal' ? it.rep : '';
      ocorrencias(it.d, rep, hoje).forEach(function (d) {
        out.push({
          id: rep ? it.id + '@' + d : it.id, base: it.id, d: d, t: it.t.trim().slice(0, 140), cat: 'meu', catNome: 'Meu prazo', prev: false,
          obs: typeof it.obs === 'string' ? it.obs.slice(0, 240) : '', fonte: null, proprio: true, rep: rep
        });
      });
    });
    out.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.t < b.t ? -1 : 1); });
    return out;
  }

  // Faixa de urgência de um prazo. "feito" vence qualquer outra.
  //   atrasado: passou há até JANELA_PASSADO dias e não foi marcado; antigo: passou há mais tempo (sem alarme)
  function faixa(dias, feito) {
    if (feito) return 'feito';
    if (dias < -JANELA_PASSADO) return 'antigo';   // já passou faz tempo: só aparece em "Ano todo"/"Tudo", sem alarme
    if (dias < 0) return 'atrasado';
    if (dias === 0) return 'hoje';
    if (dias <= 7) return 'semana';
    if (dias <= 30) return 'mes';
    return 'depois';
  }

  // Aplica filtros e devolve [{...item, dias, faixa, feito}] na ordem certa:
  // atrasados (mais recentes primeiro depois dos mais urgentes), depois por data.
  // opts: { cat:'todas'|chave, janela:'padrao'|'ano'|'tudo', feitos:boolean, busca:'' }
  function filtrar(itens, done, hoje, opts) {
    opts = opts || {};
    var cat = opts.cat || 'todas', janela = opts.janela || 'padrao', busca = String(opts.busca || '').toLowerCase().trim();
    var res = [];
    itens.forEach(function (it) {
      var dias = diasAte(it.d, hoje);
      if (isNaN(dias)) return;
      var feito = !!(done && done[it.id]);
      if (cat !== 'todas' && it.cat !== cat) return;
      if (busca && (it.t + ' ' + it.obs + ' ' + it.catNome).toLowerCase().indexOf(busca) < 0) return;
      if (feito && !opts.feitos) return;
      if (janela === 'padrao') {
        if (dias > JANELA_PADRAO) return;
        if (dias < -JANELA_PASSADO && !(feito && opts.feitos)) return;
      } else if (janela === 'ano') {
        if (it.d.slice(0, 4) !== String(hoje.getFullYear())) return;
      }
      res.push({ id: it.id, d: it.d, t: it.t, cat: it.cat, catNome: it.catNome, prev: it.prev, obs: it.obs,
        fonte: it.fonte, proprio: it.proprio, base: it.base, rep: it.rep, importado: !!it.importado, dias: dias, faixa: faixa(dias, feito), feito: feito });
    });
    // atrasados primeiro, depois o restante por data, e os "antigos" (sem alarme) por último
    var peso = function (x) { return x.faixa === 'atrasado' ? 0 : (x.faixa === 'antigo' ? 2 : 1); };
    res.sort(function (a, b) {
      var pa = peso(a), pb = peso(b);
      if (pa !== pb) return pa - pb;
      return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.t < b.t ? -1 : 1);
    });
    return res;
  }

  // Quantos pedem atenção: atrasados recentes (não marcados) + vencem em até 7 dias (não marcados).
  function contagem(itens, done, hoje) {
    var c = { atrasados: 0, hoje: 0, semana: 0, mes: 0 };
    itens.forEach(function (it) {
      if (done && done[it.id]) return;
      var dias = diasAte(it.d, hoje);
      if (isNaN(dias)) return;
      if (dias < 0 && dias >= -JANELA_PASSADO) c.atrasados++;
      else if (dias === 0) c.hoje++;
      else if (dias >= 1 && dias <= 7) c.semana++;
      else if (dias >= 8 && dias <= 30) c.mes++;
    });
    c.atencao = c.atrasados + c.hoje + c.semana;
    return c;
  }

  function quando(dias) {
    if (dias === 0) return 'hoje';
    if (dias === 1) return 'amanhã';
    if (dias === -1) return 'ontem';
    return dias > 0 ? 'em ' + dias + ' dias' : 'há ' + (-dias) + ' dias';
  }
  function dataCurta(s) { return s.slice(8, 10) + '/' + s.slice(5, 7); }

  // Texto para colar (WhatsApp/e-mail): prazos não feitos dos próximos "dias" dias + atrasados recentes.
  function resumo(itens, done, hoje, dias) {
    dias = dias || 30;
    var linhas = [];
    itens.forEach(function (it) {
      if (done && done[it.id]) return;
      var n = diasAte(it.d, hoje);
      if (isNaN(n) || n > dias || n < -JANELA_PASSADO) return;
      linhas.push({ n: n, txt: '• ' + dataCurta(it.d) + (it.prev ? ' (prevista)' : '') + ' — ' + it.t + ' [' + quando(n) + ']' });
    });
    if (!linhas.length) return 'Sem prazos pendentes nos próximos ' + dias + ' dias.';
    var atras = linhas.filter(function (l) { return l.n < 0; }).map(function (l) { return l.txt; });
    var prox = linhas.filter(function (l) { return l.n >= 0; }).map(function (l) { return l.txt; });
    var s = 'Prazos do SUAS (' + dataCurta(iso(hoje)) + '/' + hoje.getFullYear() + ')\n';
    if (atras.length) s += '\nJá passaram — conferir:\n' + atras.join('\n') + '\n';
    if (prox.length) s += '\nPróximos ' + dias + ' dias:\n' + prox.join('\n') + '\n';
    s += '\nConferir sempre no normativo oficial.';
    return s;
  }

  // Frase curta para o mascote ("o que vence essa semana?").
  function fraseSemana(itens, done, hoje) {
    var lista = [];
    itens.forEach(function (it) {
      if (done && done[it.id]) return;
      var n = diasAte(it.d, hoje);
      if (!isNaN(n) && n >= 0 && n <= 7) lista.push({ n: n, it: it });
    });
    if (!lista.length) return 'Nenhum prazo oficial nos próximos 7 dias. Abra a aba Prazos para ver os próximos.';
    var s = lista.slice(0, 4).map(function (x) { return dataCurta(x.it.d) + ' (' + quando(x.n) + '): ' + x.it.t; }).join('\n');
    if (lista.length > 4) s += '\n… e mais ' + (lista.length - 4) + '.';
    return 'Prazos dos próximos 7 dias:\n' + s;
  }

  return { iso: iso, dataValida: dataValida, diasAte: diasAte, idDe: idDe, montar: montar, faixa: faixa,
    filtrar: filtrar, contagem: contagem, quando: quando, dataCurta: dataCurta, resumo: resumo,
    fraseSemana: fraseSemana, ocorrencias: ocorrencias, cobertura: cobertura, parseImport: parseImport, lerData: lerData, JANELA_PASSADO: JANELA_PASSADO, JANELA_PADRAO: JANELA_PADRAO };
})();
/* PRAZOS:puro-fim */

/* ---------------------------- tela da aba ---------------------------- */
var ARGO_PRAZOS_KEY = 'toolpad_prazos_v1'; // prefixo toolpad_: cifrado com a senha do app, entra no backup e some em "Apagar dados salvos"
var argoPrazosUI = { cat: 'todas', janela: 'padrao', feitos: false, busca: '' };

function argoPrazosLer() {
  try {
    var o = (typeof safeStorage !== 'undefined') ? safeStorage.getJSON(ARGO_PRAZOS_KEY, null) : null;
    if (!o || typeof o !== 'object') o = {};
    return { custom: Array.isArray(o.custom) ? o.custom : [], importados: Array.isArray(o.importados) ? o.importados : [], done: (o.done && typeof o.done === 'object' && !Array.isArray(o.done)) ? o.done : {} };
  } catch (e) { return { custom: [], importados: [], done: {} }; }
}
function argoPrazosGravar(st) {
  try {
    if (typeof safeStorage === 'undefined') return false;
    if (!st.custom.length && !(st.importados || []).length && !Object.keys(st.done).length) return safeStorage.remove(ARGO_PRAZOS_KEY);
    return safeStorage.set(ARGO_PRAZOS_KEY, JSON.stringify(st));
  } catch (e) { return false; }
}
function argoPrazosEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function argoPrazosMeta() { return (typeof window !== 'undefined' && window.ARGO_MDS) || { datas: [], categorias: {}, fontes: {} }; }
function argoPrazosItens(st) { st = st || argoPrazosLer(); return ArgoPrazos.montar(argoPrazosMeta(), st.custom, st.importados, new Date()); }

// Número no botão da aba: prazos que pedem atenção (atrasados recentes + até 7 dias).
function argoPrazosAtualizarBadge() {
  try {
    var el = document.getElementById('count-prazos');
    if (!el) return;
    var st = argoPrazosLer(), c = ArgoPrazos.contagem(argoPrazosItens(st), st.done, new Date());
    el.textContent = String(c.atencao);
    el.style.display = c.atencao ? '' : 'none';
    el.title = c.atencao + (c.atencao === 1 ? ' prazo pede atenção' : ' prazos pedem atenção') + ' (atrasados e próximos 7 dias)';
  } catch (e) { /* o número é só um aviso */ }
}

var ARGO_PRAZOS_ROTULO = {
  atrasado: 'Já passaram (conferir)', hoje: 'Hoje', semana: 'Próximos 7 dias', mes: 'Neste mês (até 30 dias)', depois: 'Mais adiante', antigo: 'Anteriores (sem alarme)', feito: 'Feitos'
};

function argoPrazosItemHtml(it) {
  var cls = 'prazos-item is-' + it.faixa + (it.proprio ? ' is-meu' : '');
  var badge = it.feito ? 'feito' : ArgoPrazos.quando(it.dias);
  var dataLonga = it.d.slice(8, 10) + '/' + it.d.slice(5, 7) + '/' + it.d.slice(0, 4);
  var h = '<li class="' + cls + '" data-id="' + argoPrazosEsc(it.id) + '" data-base="' + argoPrazosEsc(it.base || it.id) + '">';
  h += '<div class="prazos-data" aria-hidden="true"><b>' + argoPrazosEsc(it.d.slice(8, 10)) + '</b><span>' +
    ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(it.d.slice(5, 7)) - 1] + '</span></div>';
  h += '<div class="prazos-corpo"><div class="prazos-linha1"><span class="prazos-cat prazos-cat-' + argoPrazosEsc(it.cat) + '">' + argoPrazosEsc(it.catNome) + '</span>' +
    '<span class="prazos-quando"><span class="sr-only">' + dataLonga + ' — </span>' + argoPrazosEsc(badge) + (it.prev && !it.feito ? ' · prevista' : '') + (it.rep ? ' · ↻ ' + (it.rep === 'anual' ? 'todo ano' : 'todo mês') : '') + (it.importado ? ' · importada' : '') + '</span></div>';
  h += '<p class="prazos-texto">' + argoPrazosEsc(it.t) + '</p>';
  if (it.obs) h += '<p class="prazos-obs">' + argoPrazosEsc(it.obs) + '</p>';
  h += '<div class="prazos-acoes">';
  h += '<button type="button" class="prazos-btn' + (it.feito ? ' is-on' : '') + '" data-pz="feito" aria-pressed="' + (it.feito ? 'true' : 'false') + '">' + (it.feito ? '↩ Desmarcar' : '✓ Feito') + '</button>';
  if (it.d.slice(0, 4) === String(new Date().getFullYear())) h += '<button type="button" class="prazos-btn" data-pz="agenda">📅 Na agenda</button>';
  if (it.fonte && /^https:\/\//.test(it.fonte.url)) h += '<a class="prazos-btn" href="' + argoPrazosEsc(it.fonte.url) + '" target="_blank" rel="noopener noreferrer" title="' + argoPrazosEsc(it.fonte.nome) + '">Fonte ↗<span class="sr-only"> (abre em outra aba)</span></a>';
  if (it.proprio) h += '<button type="button" class="prazos-btn prazos-btn-del" data-pz="apagar">' + (it.rep ? 'Excluir a série' : 'Excluir') + '</button>';
  h += '</div></div></li>';
  return h;
}

function argoPrazosRenderAviso(st) {
  var el = document.getElementById('prazosAviso');
  if (!el) return;
  var cob = ArgoPrazos.cobertura(argoPrazosMeta(), st.importados, new Date());
  el.innerHTML = cob.nivel === 'ok' ? '' : '<div class="prazos-alerta is-' + cob.nivel + '" role="alert">⚠ ' + argoPrazosEsc(cob.msg) +
    ' <button type="button" class="prazos-btn" data-pz="abrir-atualizar">Como atualizar</button></div>';
}

function argoPrazosRenderLista() {
  var box = document.getElementById('prazosLista');
  if (!box) return;
  var st = argoPrazosLer(), hoje = new Date(), itens = argoPrazosItens(st);
  argoPrazosRenderAviso(st);
  var vis = ArgoPrazos.filtrar(itens, st.done, hoje, argoPrazosUI);
  var c = ArgoPrazos.contagem(itens, st.done, hoje);
  var set = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = String(v); };
  set('prazosNAtrasados', c.atrasados); set('prazosNHoje', c.hoje); set('prazosNSemana', c.semana); set('prazosNMes', c.mes);
  argoPrazosAtualizarBadge();
  if (!vis.length) {
    box.innerHTML = '<p class="prazos-vazio">Nenhum prazo neste filtro. ' + (argoPrazosUI.janela === 'padrao' ? 'Tente “Ano todo” ou “Tudo”.' : '') + '</p>';
    return;
  }
  var ordem = ['atrasado', 'hoje', 'semana', 'mes', 'depois', 'antigo', 'feito'], html = '';
  ordem.forEach(function (f) {
    var grupo = vis.filter(function (x) { return x.faixa === f; });
    if (!grupo.length) return;
    html += '<h3 class="prazos-grupo prazos-grupo-' + f + '">' + ARGO_PRAZOS_ROTULO[f] + ' <small>' + grupo.length + '</small></h3><ul class="prazos-lista">' + grupo.map(argoPrazosItemHtml).join('') + '</ul>';
  });
  box.innerHTML = html;
}

function argoPrazosFiltroHtml() {
  var meta = argoPrazosMeta(), cats = Object.keys(meta.categorias || {});
  var chips = [['todas', 'Todas']].concat(cats.map(function (k) { return [k, meta.categorias[k]]; })).concat([['meu', 'Meus prazos']]);
  return chips.map(function (p) {
    return '<button type="button" class="prazos-chip' + (argoPrazosUI.cat === p[0] ? ' is-active' : '') + '" data-pz-cat="' + argoPrazosEsc(p[0]) + '" aria-pressed="' + (argoPrazosUI.cat === p[0] ? 'true' : 'false') + '">' + argoPrazosEsc(p[1]) + '</button>';
  }).join('');
}

function renderPrazosCard() {
  var meta = argoPrazosMeta();
  var atualizado = meta.atualizadoEm && ArgoPrazos.dataValida(meta.atualizadoEm) ? ArgoPrazos.dataCurta(meta.atualizadoEm) + '/' + meta.atualizadoEm.slice(0, 4) : '';
  return '' +
  '<div class="tech-card prazos-card" id="prazosRoot">' +
    '<div class="card-top"><div style="display:flex;align-items:center;gap:0.55rem;"><span class="prazos-badge" aria-hidden="true">⏳</span><h2 style="margin:0;">Prazos e alertas do SUAS</h2></div>' +
    '<span class="subtitle">Revisão e averiguação do CadÚnico, condicionalidades do Bolsa Família, Censo SUAS e os seus próprios prazos</span></div>' +
    '<div class="card-body">' +
      '<div id="prazosAviso"></div>' +
      '<div class="prazos-resumo" role="group" aria-label="Resumo dos prazos">' +
        '<div class="prazos-num is-atrasado"><b id="prazosNAtrasados">0</b><span>já passaram</span></div>' +
        '<div class="prazos-num is-hoje"><b id="prazosNHoje">0</b><span>hoje</span></div>' +
        '<div class="prazos-num is-semana"><b id="prazosNSemana">0</b><span>em 7 dias</span></div>' +
        '<div class="prazos-num is-mes"><b id="prazosNMes">0</b><span>em 30 dias</span></div>' +
      '</div>' +
      '<div class="prazos-barra">' +
        '<input type="search" id="prazosBusca" class="prazos-busca" placeholder="Buscar prazo (ex.: REV26, Censo, saúde)" aria-label="Buscar prazo" autocomplete="off" value="' + argoPrazosEsc(argoPrazosUI.busca) + '">' +
        '<div class="prazos-seg" role="group" aria-label="Período">' +
          '<button type="button" data-pz-janela="padrao"' + (argoPrazosUI.janela === 'padrao' ? ' class="is-active"' : '') + '>Próximos 90 dias</button>' +
          '<button type="button" data-pz-janela="ano"' + (argoPrazosUI.janela === 'ano' ? ' class="is-active"' : '') + '>Ano todo</button>' +
          '<button type="button" data-pz-janela="tudo"' + (argoPrazosUI.janela === 'tudo' ? ' class="is-active"' : '') + '>Tudo</button>' +
        '</div>' +
      '</div>' +
      '<div class="prazos-chips" id="prazosChips" role="group" aria-label="Filtrar por tipo">' + argoPrazosFiltroHtml() + '</div>' +
      '<div class="prazos-ferramentas">' +
        '<label class="prazos-check"><input type="checkbox" id="prazosFeitos"' + (argoPrazosUI.feitos ? ' checked' : '') + '> Mostrar os já feitos</label>' +
        '<span class="prazos-espaco"></span>' +
        '<button type="button" class="prazos-btn" id="prazosCopiar">📋 Copiar prazos dos próximos 30 dias</button>' +
        '<button type="button" class="prazos-btn" id="prazosNovoBtn" aria-expanded="false" aria-controls="prazosForm">＋ Meu prazo</button>' +
      '</div>' +
      '<form class="prazos-form" id="prazosForm" hidden autocomplete="off">' +
        '<div class="prazos-form-linha"><label>Data<input type="date" id="prazosNovaData" required></label>' +
        '<label class="prazos-form-grande">O que vence<input type="text" id="prazosNovoTexto" maxlength="140" required placeholder="Ex.: entregar o RMA do mês"></label></div>' +
        '<div class="prazos-form-linha"><label class="prazos-form-grande">Observação (opcional)<input type="text" id="prazosNovaObs" maxlength="240" placeholder="Ex.: enviar para a coordenação"></label>' +
        '<label>Repetir<select id="prazosNovaRep"><option value="">Não repete</option><option value="anual">Todo ano</option><option value="mensal">Todo mês</option></select></label></div>' +
        '<p class="prazos-aviso">🔒 Fica só neste aparelho, cifrado com a senha do app. Não escreva nome, NIS ou CPF de pessoa atendida.</p>' +
        '<div class="prazos-form-linha"><button type="submit" class="prazos-btn prazos-btn-ok">Salvar prazo</button><button type="button" class="prazos-btn" id="prazosCancelar">Cancelar</button></div>' +
      '</form>' +
      '<p class="prazos-msg" id="prazosMsg" role="status" aria-live="polite"></p>' +
      '<div id="prazosLista"></div>' +
      '<details class="prazos-atualizar" id="prazosAtualizar"><summary>Atualizar datas oficiais (novo ano, nova instrução normativa)</summary>' +
        '<div class="prazos-atualizar-corpo">' +
          '<p><b>Sem mexer no código:</b> baixe o modelo, preencha uma linha por prazo (data, texto, tipo, se é prevista, observação) e importe o arquivo. Pode ser <code>.csv</code> (Excel, separado por ; ) ou <code>.json</code>. As datas importadas ficam neste aparelho, somam-se às do app e podem ser removidas quando quiser.</p>' +
          '<div class="prazos-ferramentas">' +
            '<button type="button" class="prazos-btn" id="prazosModelo">⬇ Baixar modelo (.csv)</button>' +
            '<button type="button" class="prazos-btn" id="prazosImportarBtn">⬆ Importar arquivo</button>' +
            '<button type="button" class="prazos-btn prazos-btn-del" id="prazosLimparImp">Remover datas importadas</button>' +
            '<input type="file" id="prazosArquivo" accept=".csv,.json,.txt,text/csv,application/json,text/plain" hidden>' +
          '</div>' +
          '<p id="prazosImpMsg" class="prazos-msg" role="status" aria-live="polite"></p>' +
          '<p><b>Para todos os aparelhos de uma vez:</b> edite <code>js/datas-cras-mds.js</code> (é só acrescentar linhas com o ano novo e trocar <code>atualizadoEm</code>) e publique. As linhas dos anos anteriores podem ficar.</p>' +
        '</div></details>' +
      '<p class="prazos-rodape">Datas oficiais conferidas em ' + (atualizado || '—') + '. Marcadas com “prevista” podem mudar; confira sempre no normativo (botão Fonte).</p>' +
    '</div>' +
  '</div>';
}

function argoPrazosMsg(txt) {
  var m = document.getElementById('prazosMsg');
  if (!m) return;
  m.textContent = txt || '';
  if (txt) setTimeout(function () { var x = document.getElementById('prazosMsg'); if (x && x.textContent === txt) x.textContent = ''; }, 4000);
}

function argoPrazosCopiar(texto) {
  var ok = function () { argoPrazosMsg('Lista copiada. É só colar.'); };
  var falhou = function () { argoPrazosMsg('Não consegui copiar sozinho. Selecione e copie o texto: ' + texto.split('\n').length + ' linhas.'); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(texto).then(ok, function () { argoPrazosCopiarAntigo(texto) ? ok() : falhou(); }); return; }
  } catch (e) { /* tenta o jeito antigo */ }
  argoPrazosCopiarAntigo(texto) ? ok() : falhou();
}
function argoPrazosCopiarAntigo(texto) {
  try {
    var ta = document.createElement('textarea');
    ta.value = texto; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta); ta.select();
    var r = document.execCommand('copy'); document.body.removeChild(ta); return !!r;
  } catch (e) { return false; }
}

function argoPrazosBaixarModelo() {
  var y = new Date().getFullYear() + 1, cats = Object.keys(argoPrazosMeta().categorias || {});
  var csv = '\uFEFFdata;texto;categoria;prevista;observacao\r\n' +
    y + '-01-15;Exemplo: apague esta linha e escreva o prazo;' + (cats[0] || 'outro') + ';nao;Observação opcional\r\n' +
    '15/02/' + y + ';Exemplo com data DD/MM/AAAA;' + (cats[1] || 'outro') + ';sim;\r\n' +
    '# categorias aceitas: ' + cats.join(', ') + ', outro. Apague as linhas de exemplo e esta.\r\n';
  try {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'modelo-prazos-suas.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  } catch (e) { argoPrazosMsg('Não consegui gerar o modelo neste navegador.'); }
}

function initPrazosPanel() {
  var root = document.getElementById('prazosRoot');
  if (!root) return;
  var $ = function (id) { return document.getElementById(id); };
  argoPrazosRenderLista();

  root.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('button');
    if (!t || !root.contains(t)) return;
    if (t.dataset.pzCat) {
      argoPrazosUI.cat = t.dataset.pzCat;
      root.querySelectorAll('.prazos-chip').forEach(function (b) { var on = b.dataset.pzCat === argoPrazosUI.cat; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      argoPrazosRenderLista(); return;
    }
    if (t.dataset.pzJanela) {
      argoPrazosUI.janela = t.dataset.pzJanela;
      root.querySelectorAll('.prazos-seg button').forEach(function (b) { b.classList.toggle('is-active', b.dataset.pzJanela === argoPrazosUI.janela); });
      argoPrazosRenderLista(); return;
    }
    var li = t.closest('li.prazos-item'), id = li && li.dataset.id;
    if (t.dataset.pz === 'feito' && id) {
      var st = argoPrazosLer();
      if (st.done[id]) delete st.done[id]; else st.done[id] = ArgoPrazos.iso(new Date());
      if (!argoPrazosGravar(st)) argoPrazosMsg('Este navegador não deixou guardar a marcação.');
      argoPrazosRenderLista();
      // o item pode ter saído da lista (ou mudado de grupo): devolve o foco ao botão dele, ou ao campo de busca
      var vol = Array.prototype.filter.call(root.querySelectorAll('li.prazos-item'), function (x) { return x.dataset.id === id; })[0];
      var alvo = vol && vol.querySelector('[data-pz="feito"]');
      (alvo || $('prazosBusca')).focus();
      argoPrazosMsg(st.done[id] ? 'Marcado como feito.' : 'Marcação desfeita.');
      return;
    }
    if (t.dataset.pz === 'agenda' && id) {
      var item = argoPrazosItens().filter(function (x) { return x.id === id; })[0];
      if (!item) return;
      var chip = document.querySelector('.filter-chip[data-cat="agenda"]');
      if (chip) chip.click();
      setTimeout(function () { try { if (typeof agendaJumpToDay === 'function') agendaJumpToDay(item.d); } catch (e) { /* abre só a agenda */ } }, 250);
      return;
    }
    if (t.dataset.pz === 'apagar' && id) {
      var base = li.dataset.base || id;
      if (!window.confirm('Excluir este prazo seu' + (id !== base ? ' (e todas as repetições)' : '') + '?')) return;
      var st2 = argoPrazosLer();
      st2.custom = st2.custom.filter(function (x) { return x.id !== base; });
      Object.keys(st2.done).forEach(function (k) { if (k === base || k.indexOf(base + '@') === 0) delete st2.done[k]; });
      argoPrazosGravar(st2); argoPrazosRenderLista(); argoPrazosMsg('Prazo excluído.'); return;
    }
    if (t.id === 'prazosCopiar') {
      var s = argoPrazosLer();
      argoPrazosCopiar(ArgoPrazos.resumo(argoPrazosItens(s), s.done, new Date(), 30)); return;
    }
    if (t.id === 'prazosNovoBtn') {
      var f = $('prazosForm'), abrir = f.hidden;
      f.hidden = !abrir; t.setAttribute('aria-expanded', abrir ? 'true' : 'false');
      if (abrir) { $('prazosNovaData').value = ArgoPrazos.iso(new Date()); $('prazosNovoTexto').focus(); }
      return;
    }
    if (t.dataset.pz === 'abrir-atualizar') { var det = $('prazosAtualizar'); det.open = true; det.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (t.id === 'prazosModelo') { argoPrazosBaixarModelo(); return; }
    if (t.id === 'prazosImportarBtn') { $('prazosArquivo').click(); return; }
    if (t.id === 'prazosLimparImp') {
      var s3 = argoPrazosLer();
      if (!s3.importados.length) { $('prazosImpMsg').textContent = 'Não há datas importadas.'; return; }
      if (!window.confirm('Remover as ' + s3.importados.length + ' datas importadas deste aparelho?')) return;
      s3.importados = []; argoPrazosGravar(s3); argoPrazosRenderLista(); $('prazosImpMsg').textContent = 'Datas importadas removidas.'; return;
    }
    if (t.id === 'prazosCancelar') { $('prazosForm').hidden = true; $('prazosNovoBtn').setAttribute('aria-expanded', 'false'); return; }
  });

  $('prazosArquivo').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0], msg = $('prazosImpMsg');
    e.target.value = '';
    if (!f) return;
    if (f.size > 1024 * 1024) { msg.textContent = 'Arquivo grande demais (máximo 1 MB).'; return; }
    var rd = new FileReader();
    rd.onerror = function () { msg.textContent = 'Não consegui ler o arquivo.'; };
    rd.onload = function () {
      var r = ArgoPrazos.parseImport(String(rd.result || ''), argoPrazosMeta());
      if (!r.itens.length) { msg.textContent = (r.erros[0] || 'Nenhuma data encontrada.') + (r.erros.length > 1 ? ' (+' + (r.erros.length - 1) + ' avisos)' : ''); return; }
      var st = argoPrazosLer(), ja = {};
      st.importados.forEach(function (x) { ja[ArgoPrazos.idDe(x.d, x.t)] = 1; });
      var novos = r.itens.filter(function (x) { return !ja[ArgoPrazos.idDe(x.d, x.t)]; });
      st.importados = st.importados.concat(novos).slice(0, 1000);
      if (!argoPrazosGravar(st)) { msg.textContent = 'Este navegador não deixou guardar as datas.'; return; }
      msg.textContent = novos.length + ' data(s) importada(s)' + (r.itens.length - novos.length ? ', ' + (r.itens.length - novos.length) + ' já existiam' : '') + (r.erros.length ? '. Ignoradas: ' + r.erros.join(' ') : '.');
      argoPrazosRenderLista();
    };
    rd.readAsText(f, 'utf-8');
  });
  $('prazosBusca').addEventListener('input', function (e) { argoPrazosUI.busca = e.target.value; argoPrazosRenderLista(); });
  $('prazosFeitos').addEventListener('change', function (e) { argoPrazosUI.feitos = e.target.checked; argoPrazosRenderLista(); });
  $('prazosForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var d = $('prazosNovaData').value, t = $('prazosNovoTexto').value.trim(), o = $('prazosNovaObs').value.trim();
    if (!ArgoPrazos.dataValida(d) || !t) { argoPrazosMsg('Preencha a data e o que vence.'); return; }
    var st = argoPrazosLer();
    if (st.custom.length >= 200) { argoPrazosMsg('Limite de 200 prazos próprios. Exclua algum antigo.'); return; }
    var rep = $('prazosNovaRep').value; rep = (rep === 'anual' || rep === 'mensal') ? rep : '';
    st.custom.push({ id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), d: d, t: t.slice(0, 140), obs: o.slice(0, 240), rep: rep });
    if (!argoPrazosGravar(st)) { argoPrazosMsg('Este navegador não deixou guardar o prazo.'); return; }
    $('prazosForm').reset(); $('prazosForm').hidden = true; $('prazosNovoBtn').setAttribute('aria-expanded', 'false');
    // mostra o que acabou de criar, mesmo que esteja fora da janela padrão
    argoPrazosUI.cat = 'todas'; if (argoPrazosUI.janela === 'padrao' && ArgoPrazos.diasAte(d, new Date()) > ArgoPrazos.JANELA_PADRAO) argoPrazosUI.janela = 'tudo';
    root.querySelectorAll('.prazos-chip').forEach(function (b) { var on = b.dataset.pzCat === 'todas'; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    root.querySelectorAll('.prazos-seg button').forEach(function (b) { b.classList.toggle('is-active', b.dataset.pzJanela === argoPrazosUI.janela); });
    argoPrazosRenderLista(); argoPrazosMsg('Prazo salvo.');
  });
}

// O número no botão da aba aparece já na abertura do app, sem precisar abrir a aba.
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function () { argoPrazosAtualizarBadge(); });
  // vira o dia com o app aberto: atualiza o número ao voltar para a janela
  document.addEventListener('visibilitychange', function () { if (!document.hidden) argoPrazosAtualizarBadge(); });
}

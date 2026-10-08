/*!
 * ArgoCerebro — o "cérebro" do mascote Argo (sem interface, sem DOM).
 *
 * O que ele faz, em ordem de prioridade:
 *   1. Segurança: reconhece pedidos de socorro (risco de vida, ideação suicida)
 *      e responde NA HORA, mesmo sem internet, com os telefones de emergência.
 *   2. Diretório: entende perguntas como "telefone do CAPS AD III", "onde fica
 *      o CRAS Cauamé" ou "escola estadual no Pintolândia" e responde com as
 *      fichas reais do diretório (nunca inventa endereço, telefone ou horário).
 *      Tolera erro de digitação, plural, sinônimos e siglas.
 *   3. Base SUAS: glossário offline (CRAS, CREAS, PAIF, BPC, CadÚnico, RAPS,
 *      Conselho Tutelar, fluxos de violência etc.) com a base normativa.
 *   4. Memória da conversa: entende "e o horário?", "e o telefone dele?".
 *   5. IA (opcional): só para o que as etapas acima não resolvem. Resposta em
 *      streaming (palavra por palavra), com histórico da conversa e fichas do
 *      diretório como contexto. Funciona com o Worker novo (SSE) e com o antigo
 *      (JSON), e confere se a IA não "inventou" telefones.
 *
 * Privacidade: nada daqui lê Bloco de notas, anotações ou dados de famílias.
 * Para a IA só saem: a pergunta (já filtrada), as últimas mensagens da conversa
 * e até 5 fichas do diretório público. A conversa vive só na memória da página.
 *
 * Uso (app.js):  ArgoCerebro.init({ data: DATA, ia: { url: '...' } });
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArgoCerebro = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CFG = {
    url: '',
    firstByteMs: 20000,     // espera máxima pela primeira resposta
    idleMs: 15000,          // silêncio máximo entre pedaços do streaming
    maxPergunta: 500,
    maxHistorico: 6,        // mensagens (3 trocas) enviadas à IA
    maxContexto: 7,         // fichas do diretório enviadas à IA (pergunta comum)
    maxContextoAmplo: 10,   // idem, para perguntas de panorama ("quantos", "todos", "liste"...)
    minGapMs: 1200,         // intervalo mínimo entre perguntas à IA
    porMinuto: 8            // limite local (o Worker também limita)
  };

  var data = [];
  var index = null;
  var vocab = null;         // { palavra: df }
  var bairros = [];

  // ---------------------------------------------------------------------
  // Texto
  // ---------------------------------------------------------------------
  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
  var ROMANO = { ii: '2', iii: '3', iv: '4' };
  function tok(s) { var n = norm(s); return n ? n.split(' ').map(function (t) { return ROMANO[t] || t; }) : []; }
  function uniq(a) { var o = {}, r = []; for (var i = 0; i < a.length; i++) if (!o[a[i]]) { o[a[i]] = 1; r.push(a[i]); } return r; }
  function asSet(a) { var o = {}; for (var i = 0; i < a.length; i++) o[a[i]] = 1; return o; }
  function cleanText(x) {
    if (Array.isArray(x)) x = x.join('; ');
    return String(x == null ? '' : x).replace(/<br\s*\/?>/gi, ' · ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; }

  function lev(a, b, max) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur[0] = i;
      var rowMin = cur[0];
      for (j = 1; j <= lb; j++) {
        var c = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      var t = prev; prev = cur; cur = t;
    }
    return prev[lb];
  }

  // ---------------------------------------------------------------------
  // Privacidade: nada de dados pessoais indo para a IA
  // ---------------------------------------------------------------------
  var AVISO_PII = 'Para proteger as famílias, não envio mensagens com nome, documento, telefone, e-mail ou endereço residencial para a IA. Reescreva a pergunta sem identificar ninguém.';
  var CAP = 'A-ZÁÉÍÓÚÂÊÔÃÕÇ', MIN = 'a-záéíóúâêôãõç';
  var RE_NOME = new RegExp('\\b(nome|chama|chamada|chamado|sobrenome)\\b[^.?!\\n]{0,25}\\b[' + CAP + '][' + MIN + ']+\\s+[' + CAP + '][' + MIN + ']+');
  var RE_TRAT = new RegExp('\\b([Dd]ona|[Dd]na|[Ss]r|[Ss]ra|[Ss]eu|[Ss]enhor|[Ss]enhora)\\.?\\s+[' + CAP + '][' + MIN + ']{2,}\\s+[' + CAP + '][' + MIN + ']{2,}');
  function piiBlock(texto) {
    var t = String(texto || '');
    if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(t)) return AVISO_PII;
    var seq = t.match(/\d[\d.\-\/\s]{6,}\d/g) || [];
    if (seq.some(function (s) { return s.replace(/\D/g, '').length >= 9; })) return AVISO_PII;
    if (RE_NOME.test(t) || RE_TRAT.test(t)) return AVISO_PII;
    if (/\b(mora|moram|moradora?|reside|residente|endere[cç]o)\b[^.?!\n]{0,40}\b(rua|av\.?|avenida|travessa|tv\.?|quadra|lote)\b[^.?!\n]{0,40}\d+/i.test(t)) return AVISO_PII;
    return '';
  }

  // ---------------------------------------------------------------------
  // Telefones
  // ---------------------------------------------------------------------
  var RE_FONE = /(?:\(?\d{2}\)?\s?)?\d{4,5}[-\s]?\d{4}|0800[\s\d]{7,9}/g;
  function telHref(str) {
    var m = String(str || '').match(/0800[\s\d]{7,9}|(?:\(?\d{2}\)?\s?)?\d{4,5}[-\s]?\d{4}/);
    var d;
    if (m) {
      d = m[0].replace(/\D/g, '');
      if (/^0800/.test(d)) return 'tel:' + d;
      if (d.length === 8 || d.length === 9) return 'tel:+5595' + d;
      if (d.length === 10 || d.length === 11) return 'tel:+55' + d;
    }
    d = String(str || '').replace(/\D/g, '');
    if (d.length === 3) return 'tel:' + d;
    return '';
  }
  var EMERGENCIA = ['190', '192', '193', '188', '180', '100', '135', '136', '156'];

  // ---------------------------------------------------------------------
  // Índice do diretório
  // ---------------------------------------------------------------------
  function phonesOf(d) {
    return (Array.isArray(d.phones) ? d.phones : []).map(cleanText).filter(function (p) { return /\d/.test(p); });
  }
  function stripNA(x) {
    x = cleanText(x).replace(/^N\/?A\s*[-–:.]*\s*/i, '').trim();
    return /^(n\/?a|-|—)?$/i.test(x) ? '' : x;
  }
  function slim(d) {
    return {
      id: d.id, name: d.name || '', fullName: d.fullName || '', group: d.group || '',
      cat: Array.isArray(d.cat) ? d.cat.slice() : [],
      address: stripNA(d.address), hours: stripNA(d.hours), phones: phonesOf(d),
      website: d.website || '', services: cleanText(d.services)
    };
  }

  function buildIndex() {
    var df = {}, N = data.length, bset = {};
    index = data.map(function (d) {
      var nameT = uniq(tok([d.name, d.fullName].join(' ')));
      var groupT = uniq(tok(d.group));
      var textT = uniq(tok([cleanText(d.services), cleanText(d.desc), cleanText(d.address)].join(' ')));
      var all = uniq(nameT.concat(groupT, textT));
      all.forEach(function (w) { df[w] = (df[w] || 0) + 1; });
      var addr = cleanText(d.address);
      var m = addr.match(/\s[-–]\s*([^,\-–]{3,40}?)\s*,/);
      if (m) { var b = norm(m[1].replace(/^bairro\s+/i, '')); if (b && b.length > 3) bset[b] = 1; }
      return {
        d: d, nameT: nameT, nameS: asSet(nameT), groupS: asSet(groupT), textS: asSet(textT),
        nameFull: ' ' + nameT.join(' ') + ' ', addrN: ' ' + norm(addr) + ' '
      };
    });
    vocab = df;
    vocab.__N = N;
    bairros = Object.keys(bset).filter(function (b) { return !/^(boa vista|centro)$/.test(b); });
  }
  function ensureIndex() { if (!index) buildIndex(); }
  function idf(w) { var N = vocab.__N || 1; return Math.log(1 + N / (1 + (vocab[w] || 0))); }

  // palavras do vocabulário que "contam" como a palavra digitada
  var expCache = {};
  function expand(q) {
    ensureIndex();
    if (expCache[q]) return expCache[q];
    var out = {}, n = 0;
    if (vocab[q]) out[q] = 1;
    var forms = [q];
    if (/s$/.test(q) && q.length > 3) forms.push(q.slice(0, -1));
    else if (q.length > 2) forms.push(q + 's');
    if (/oes$/.test(q)) forms.push(q.slice(0, -3) + 'ao');
    forms.forEach(function (f) { if (f !== q && vocab[f]) out[f] = 0.9; });
    if (q.length >= 4) {
      for (var w in vocab) {
        if (w === '__N' || out[w]) continue;
        if (w.length > q.length && w.length <= q.length + 6 && w.indexOf(q) === 0) { out[w] = 0.8; if (++n > 14) break; }
      }
    }
    if (!out[q] && q.length >= 5 && !/^\d+$/.test(q)) {
      var max = q.length >= 9 ? 2 : 1;
      for (var v in vocab) {
        if (v === '__N' || out[v] || v.length < 4) continue;
        if (Math.abs(v.length - q.length) <= max && lev(q, v, max) <= max) out[v] = 0.6;
      }
    }
    expCache[q] = out;
    return out;
  }
  function matchIn(set, ex) {
    var best = 0;
    for (var w in ex) if (set[w] && ex[w] > best) best = ex[w];
    return best;
  }
  // melhor "peso x raridade" entre as palavras que casaram (usa a palavra do diretório, não a digitada)
  function ms(set, ex) {
    var best = 0;
    for (var w in ex) if (set[w]) { var v = ex[w] * idf(w); if (v > best) best = v; }
    return best;
  }

  // ---------------------------------------------------------------------
  // Palavras que não identificam unidade
  // ---------------------------------------------------------------------
  var STOP = asSet(('de da do das dos e a o as os em no na nos nas num numa um uma uns umas para pra por pelo pela com sem ao aos ' +
    'que qual quais quem onde como quando porque pq fica ficam ficar esta estao ta tem ter tenho temos preciso precisa quero queria ' +
    'gostaria saber sabe me mim te diga diz dizer pode poderia ajudar ajuda favor pf se ja so mais muito tambem ou mas eu voce vc ' +
    'nos gente isso isto esse essa esses essas aquele aquela ele ela eles elas dele dela deles delas la ali aqui aca mesmo mesma ' +
    'unidade unidades lugar local rede existe existem algum alguma alguns algumas ha ver abrir mostrar mostra buscar busca procurar ' +
    'procuro achar encontrar localizar passar passa informar informe oi ola ok').split(' '));
  // intenção de contato (saem da busca por nome)
  var RE_FONE_Q = /\b(telefone|telefones|fone|contato|contatos|ligar|ligo|whatsapp|zap|numero|numeros|celular)\b/;
  var RE_END_Q = /\b(endereco|enderecos|localizacao|localiza|localizado|onde (fica|e|esta|ficam|tem|encontro|acho|posso|consigo)|como chegar|chego|rota)\b/;
  var RE_HORA_Q = /\b(horario|horarios|funcionamento|abre|abrem|aberto|aberta|fecha|fechado|expediente|24 ?h|24 horas|que horas?)\b|\bfunciona (hoje|amanha|aos|no|de|ate|sabado|domingo|24)\b/;
  var RE_SERV_Q = /\b(o que (faz|fazem|oferece|oferecem)|para que serve|servicos|oferece|ofertam|atende (quem|que)|quem (pode|atende)|publico)\b/;
  var INTENT_WORDS = asSet('telefone telefones fone contato contatos ligar ligo whatsapp zap numero numeros celular endereco enderecos localizacao localiza localizado rota chegar chego horario horarios funciona funcionamento abre abrem aberto aberta fecha fechado expediente'.split(' '));
  var SOFT = asSet('atendimento atende atendem servico servicos oferece oferecem faz fazem sobre informacao informacoes publico'.split(' '));
  // pedidos de navegação do app: o assistente de abas cuida deles
  var APP_WORDS = asSet(('noticia noticias novidade novidades portaria normativo normativos agenda calendario mapa tradutor traducao pdf backup ' +
    'favorito favoritos anotacao anotacoes tema escuro instalar offline senha login atalho atalhos teclado perto proximo proxima').split(' '));
  var SMALLTALK = asSet('oi ola opa bom boa dia tarde noite obrigado obrigada valeu brigado tchau ate logo tudo bem eae e ai blz beleza'.split(' '));

  // sinônimos de assunto → palavras que costumam aparecer nas fichas
  var SINONIMOS = [
    [/\b(posto|postinho)\b/, ['ubs', 'unidade', 'basica']],
    [/\b(policia|boletim|ocorrencia|delegado)\b/, ['delegacia']],
    [/\b(droga|drogas|alcool|alcoolismo|dependencia|dependente|vicio|crack)\b/, ['caps', 'ad', 'alcool', 'drogas']],
    [/\b(psicologo|psicologa|psiquiatra|psiquiatria|saude mental|sofrimento psiquico|depressao|ansiedade)\b/, ['caps', 'psicossocial', 'saude', 'mental']],
    [/\b(violencia|agressao|maus tratos|abuso|estupro)\b/, ['creas', 'conselho', 'tutelar', 'delegacia']],
    [/\b(maria da penha|violencia domestica|violencia contra a mulher)\b/, ['delegacia', 'mulher', 'casa']],
    [/\b(vacina|vacinas|vacinacao)\b/, ['ubs', 'saude']],
    [/\b(emergencia|urgencia|pronto socorro|pronto atendimento)\b/, ['upa', 'pronto', 'atendimento', 'hospital']],
    [/\b(deficiente|deficiencia|autismo|autista)\b/, ['tea', 'apae', 'ciapd', 'deficiencia']],
    [/\b(fome|comida|alimento|alimentos|cesta)\b/, ['cesta', 'alimentar']],
    [/\b(onibus|transporte|passe livre)\b/, ['terminal', 'passe', 'livre']],
    [/\b(identidade|rg|certidao|segunda via|carteira de identidade)\b/, ['identificacao', 'documentacao', 'cartorio']],
    [/\b(emprego|vaga|vagas|curriculo|desempregado)\b/, ['sine', 'trabalho', 'emprego']],
    [/\b(advogado|defensoria|processo|justica)\b/, ['defensoria', 'juridico', 'justica']],
    [/\b(aposentadoria|pericia|inss|pensao)\b/, ['inss', 'previdencia']],
    [/\b(creche|matricula|escola|colegio)\b/, ['escola', 'creche']],
    [/\b(venezuelano|venezuelana|refugiado|migrante|imigrante)\b/, ['migracao', 'acolhida', 'refugiados']],
    [/\b(idoso|idosa|velhinho|terceira idade)\b/, ['idosa', 'idoso']],
    [/\b(capsi|caps i|caps infantil|caps infantojuvenil)\b/, ['caps', 'infantojuvenil']],
    [/\b(promotoria|promotor|ministerio publico)\b/, ['ministerio', 'publico']],
    [/\b(cras|creas) (itinerante|volante)\b/, ['itinerante']]
  ];

  // ---------------------------------------------------------------------
  // Busca no diretório
  // ---------------------------------------------------------------------
  function parseQuery(text) {
    var n = norm(text);
    var all = n ? n.split(' ').map(function (t) { return ROMANO[t] || t; }) : [];
    var strong = [], soft = [];
    all.forEach(function (t) {
      if (STOP[t] || INTENT_WORDS[t]) return;
      if (t.length < 2 && !/\d/.test(t)) return;
      if (SOFT[t]) soft.push(t); else strong.push(t);
    });
    var syn = [];
    SINONIMOS.forEach(function (r) { if (r[0].test(n)) syn = syn.concat(r[1]); });
    return {
      norm: n, all: all, strong: uniq(strong), soft: uniq(soft), syn: uniq(syn),
      fone: RE_FONE_Q.test(n), end: RE_END_Q.test(n), hora: RE_HORA_Q.test(n), serv: RE_SERV_Q.test(n)
    };
  }
  function contactIntent(q) { return q.fone || q.end || q.hora; }

  function searchDirectory(q, tabCat) {
    ensureIndex();
    var strongEx = q.strong.map(expand);
    var synEx = q.syn.map(expand);
    var softEx = q.soft.map(expand);
    var bairro = '';
    bairros.forEach(function (b) { if (q.norm.indexOf(b) > -1 && b.length > bairro.length) bairro = b; });
    // a palavra mais rara da pergunta é a que mais distingue a unidade: quem não a tem perde força
    var rareI = -1, rareIdf = 0;
    if (q.strong.length >= 2) strongEx.forEach(function (ex, i) {
      var best = 0, any = false;
      for (var w in ex) { any = true; var v = idf(w); if (v > best) best = v; }
      if (any && best > rareIdf) { rareIdf = best; rareI = i; }
    });
    var rows = [];
    index.forEach(function (u) {
      var nameHits = 0, s = 0, rareHit = rareI < 0;
      strongEx.forEach(function (ex, i) {
        var nm = ms(u.nameS, ex);
        if (nm) { nameHits += 1; s += 3 * nm; if (i === rareI) rareHit = true; return; }
        var gm = ms(u.groupS, ex);
        if (gm) { s += 1.6 * gm; if (i === rareI) rareHit = true; return; }
        var tm = ms(u.textS, ex);
        if (tm) { s += tm; if (i === rareI) rareHit = true; }
      });
      softEx.forEach(function (ex) { if (matchIn(u.nameS, ex)) s += 0.6; else if (matchIn(u.textS, ex)) s += 0.3; });
      synEx.forEach(function (ex) {
        var nm = ms(u.nameS, ex) || ms(u.groupS, ex);
        if (nm) s += 1.4 * nm; else if (ms(u.textS, ex)) s += 0.4;
      });
      var inBairro = bairro && u.addrN.indexOf(' ' + bairro + ' ') > -1;
      if (inBairro) s += 2.5;
      if (!rareHit) s *= 0.3;
      if (tabCat && u.d.cat && u.d.cat.indexOf(tabCat) > -1) s *= 1.2;
      var nameCov = q.strong.length ? Math.min(1, nameHits / q.strong.length) : 0;
      if (s > 0) rows.push({ u: u, score: s, nameCov: nameCov, inBairro: !!inBairro });
    });
    rows.sort(function (a, b) {
      var ea = a.nameCov >= 0.99 ? 1 : 0, eb = b.nameCov >= 0.99 ? 1 : 0;
      return eb - ea || b.score - a.score;
    });
    return { rows: rows, bairro: bairro };
  }

  // Decide entre "uma unidade", "lista" ou nada, com um nível de confiança.
  function directory(text, session, tabCat) {
    var q = parseQuery(text);
    var res = { q: q, raw: text, units: [], mode: 'none', confidence: 0, contact: contactIntent(q), follow: false };
    if (!q.strong.length && !q.syn.length) {
      // "e o horário?", "qual o telefone dele?": usa a última unidade citada
      if (contactIntent(q) && session && session.units && session.units.length) {
        res.units = session.units.slice(0, 5); res.mode = res.units.length === 1 ? 'single' : 'list';
        res.confidence = 0.9; res.follow = true;
      }
      return res;
    }
    if (!q.strong.length && !contactIntent(q)) return res;
    if (q.strong.length && q.strong.every(function (t) { return SMALLTALK[t]; })) return res;
    // pedido de navegação do app ("mapa", "notícias"...): quem cuida é o assistente de abas
    if (!contactIntent(q) && q.all.some(function (t) { return APP_WORDS[t]; })) return res;
    var r = searchDirectory(q, tabCat);
    var rows = r.rows;
    if (!rows.length || rows[0].score < 2.5) return res;
    var exact = rows.filter(function (x) { return x.nameCov >= 0.99 && q.strong.length; });
    var picked;
    if (exact.length === 1) {
      picked = exact; res.mode = 'single'; res.confidence = 0.9;
    } else if (exact.length > 1) {
      // um nome igual ao que a pessoa digitou (ignorando palavras de ligação) vence os demais
      var qs = q.strong.slice().sort().join(' ');
      var same = exact.filter(function (x) {
        var nt = uniq(tok(x.u.d.name)).filter(function (t) { return !STOP[t]; }).sort().join(' ');
        return nt === qs;
      });
      if (same.length === 1) { picked = same; res.mode = 'single'; res.confidence = 0.95; }
      else { picked = exact.slice(0, 6); res.mode = 'list'; res.confidence = 0.55; res.total = exact.length; }
    } else if (rows[0].nameCov >= 0.6) {
      var top = rows.filter(function (x) { return x.nameCov >= 0.6; });
      picked = top.slice(0, 6); res.mode = 'list'; res.confidence = 0.5; res.total = top.length;
    } else {
      var best = rows[0].score;
      var keep = rows.filter(function (x) { return x.score >= best * 0.45; });
      picked = keep.slice(0, 6); res.mode = 'list'; res.confidence = best >= 4 ? 0.45 : 0.3; res.total = keep.length;
      if (picked.length === 1) res.mode = 'single';
    }
    if (res.mode === 'list' && r.bairro) {
      var inB = rows.filter(function (x) { return x.inBairro; });
      if (inB.length) {
        var topB = inB[0].score;
        inB = inB.filter(function (x) { return x.score >= topB * 0.4; });
        picked = inB.slice(0, 6); res.total = inB.length; res.confidence = Math.max(res.confidence, 0.5);
      }
    }
    res.units = picked.map(function (x) { return slim(x.u.d); });
    if (res.mode === 'list' && res.units.length === 1) res.mode = 'single';
    res.bairro = r.bairro;
    return res;
  }

  // ---------------------------------------------------------------------
  // Texto das respostas do diretório
  // ---------------------------------------------------------------------
  function first(a) { return a && a.length ? a[0] : ''; }
  function composeDirectory(res, session) {
    var q = res.q, u = res.units[0];
    var followups = [], lines = [], mood = 'success';
    if (res.mode === 'single') {
      var wantAny = q.fone || q.end || q.hora || q.serv;
      var title = '**' + u.name + '**' + (u.group ? ' · ' + u.group : '');
      if (res.follow) lines.push('Sobre ' + title + ':');
      else if (res.confidence < 0.85) lines.push('Encontrei esta unidade para "' + cut(String(res.raw || '').replace(/[?!.]+$/, '').trim(), 60) + '":');
      if (q.fone) lines.push(u.phones.length ? 'Telefone: ' + u.phones.join(' · ') : 'Não há telefone cadastrado no diretório para esta unidade. Confirme pelo endereço ou com a coordenação.');
      if (q.end) lines.push(u.address ? 'Endereço: ' + u.address : 'Não há endereço cadastrado no diretório para esta unidade.');
      if (q.hora) lines.push(u.hours ? 'Horário: ' + u.hours : 'Horário não informado no diretório. Confirme com a unidade antes de encaminhar.');
      if (q.serv) lines.push(u.services ? 'O que oferece: ' + cut(u.services, 320) : 'Os serviços desta unidade não estão detalhados no diretório.');
      if (!wantAny) {
        lines.push(title);
        if (u.address) lines.push('Endereço: ' + cut(u.address, 220));
        if (u.hours) lines.push('Horário: ' + cut(u.hours, 160));
        if (u.phones.length) lines.push('Telefone: ' + u.phones.slice(0, 2).join(' · '));
      } else if (!res.follow) {
        lines.unshift(title);
      }
      if (!q.fone) followups.push('Qual o telefone?');
      if (!q.end) followups.push('Como chegar?');
      if (!q.hora) followups.push('Qual o horário?');
      if (!q.serv && u.services) followups.push('O que essa unidade oferece?');
    } else {
      var n = res.total || res.units.length;
      var tema = cut(String(res.raw || '').replace(/[?!.]+$/, '').trim(), 60) || q.strong.join(' ');
      lines.push('Encontrei **' + n + '** ' + (n === 1 ? 'unidade' : 'unidades') + ' para "' + tema + '". Toque numa delas para ver o contato ou refine com o nome ou o bairro.');
      mood = res.confidence >= 0.45 ? 'success' : 'notfound';
      if (res.confidence < 0.45) lines[0] = 'Não achei uma unidade com esse nome, mas estas são as mais próximas do que você pediu. Se não for isso, tente o nome completo ou o bairro.';
    }
    return { reply: lines.join('\n'), mood: mood, followups: followups.slice(0, 3), badge: 'Diretório' };
  }

  // ---------------------------------------------------------------------
  // Base SUAS (glossário offline)
  // ---------------------------------------------------------------------
  var GLOSSARIO = [
    { id: 'cras', keys: ['cras', 'centro de referencia de assistencia social', 'protecao social basica'],
      text: 'O **CRAS** é a porta de entrada da Proteção Social Básica do SUAS e fica no território onde a família mora.\n- Oferta o **PAIF** (acompanhamento de famílias) e o **SCFV** (grupos de convivência).\n- Faz a referência para CadÚnico, BPC e benefícios eventuais.\n- Pode ser procurado direto pela família, sem encaminhamento.',
      base: 'Tipificação Nacional dos Serviços Socioassistenciais (Res. CNAS 109/2009) e PNAS/2004.',
      actions: [{ label: 'Ver CRAS e CREAS', cat: 'social' }], follow: ['Qual a diferença entre CRAS e CREAS?', 'O que é o PAIF?'] },
    { id: 'creas', keys: ['creas', 'centro de referencia especializado', 'protecao social especial', 'media complexidade'],
      text: 'O **CREAS** atende famílias e pessoas com direitos violados ou ameaçados (violência, abuso, negligência, trabalho infantil, situação de rua). É a Proteção Social Especial de média complexidade.\n- Oferta o **PAEFI**, abordagem social e medidas socioeducativas em meio aberto (LA e PSC).\n- Atende também pessoas com deficiência e pessoas idosas em situação de violação de direitos e suas famílias.\n- Trabalha em rede com Conselho Tutelar, Ministério Público, Defensoria, saúde e educação.',
      base: 'Tipificação Nacional (Res. CNAS 109/2009).',
      actions: [{ label: 'Ver CRAS e CREAS', cat: 'social' }], follow: ['O que é o PAEFI?', 'Como funciona o Conselho Tutelar?'] },
    { id: 'cras-creas', keys: ['cras+creas'],
      text: 'A diferença está no tipo de situação:\n- **CRAS** (Proteção Básica): **prevenção**. Famílias em vulnerabilidade, sem violação de direitos. Oferta PAIF e SCFV.\n- **CREAS** (Proteção Especial): **violação de direitos já ocorrida** (violência, abuso, negligência, situação de rua). Oferta PAEFI e medidas socioeducativas em meio aberto.\nO CRAS é porta de entrada; o CREAS costuma receber casos encaminhados pela rede, mas também atende demanda espontânea.',
      base: 'Tipificação Nacional (Res. CNAS 109/2009).',
      actions: [{ label: 'Ver CRAS e CREAS', cat: 'social' }], follow: ['O que é o PAIF?', 'O que é o PAEFI?'] },
    { id: 'paif', keys: ['paif', 'plano de acompanhamento familiar', 'paf', 'acompanhamento familiar'],
      text: 'O **PAIF** é o trabalho social com famílias do CRAS: acolhida, oficinas, ações comunitárias, encaminhamentos e **acompanhamento familiar**.\nNo acompanhamento, a equipe constrói com a família um **plano (PAF)**, com objetivos e prazos combinados, para fortalecer vínculos e a função protetiva da família e prevenir rupturas.',
      base: 'Tipificação Nacional (Res. CNAS 109/2009).',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['O que é o SCFV?', 'Como é a visita domiciliar?'] },
    { id: 'paefi', keys: ['paefi'],
      text: 'O **PAEFI** é o serviço do CREAS de apoio, orientação e acompanhamento **especializado** a famílias e pessoas com direitos violados.\nInclui escuta qualificada, estudo psicossocial, orientação sociojurídica, articulação com o sistema de garantia de direitos e acompanhamento do caso. A responsabilização do autor da violência cabe ao sistema de justiça.',
      base: 'Tipificação Nacional (Res. CNAS 109/2009).',
      actions: [{ label: 'Ver CREAS', cat: 'social' }], follow: ['Como notificar violência contra criança?'] },
    { id: 'scfv', keys: ['scfv', 'convivencia e fortalecimento de vinculos', 'servico de convivencia', 'grupos de convivencia'],
      text: 'O **SCFV** (Serviço de Convivência e Fortalecimento de Vínculos) são grupos organizados por ciclo de vida (crianças, adolescentes, adultos e pessoas idosas), com atividades de convivência, cultura e cidadania.\nÉ ofertado no CRAS ou em unidades parceiras referenciadas a ele; a participação é voluntária.',
      base: 'Tipificação Nacional (Res. CNAS 109/2009).',
      actions: [{ label: 'Ver unidades sociais', cat: 'social' }], follow: ['O que é o PAIF?'] },
    { id: 'bpc', keys: ['bpc', 'loas', 'beneficio de prestacao continuada'],
      text: 'O **BPC** garante **1 salário mínimo** por mês a pessoa com **65 anos ou mais**, ou **com deficiência** (impedimento de longo prazo), cuja renda familiar por pessoa seja **inferior a 1/4 do salário mínimo**.\n- Exige inscrição e atualização no **CadÚnico**.\n- O pedido é feito pelo Meu INSS (site/app) ou pela central 135.\n- No caso de deficiência há avaliação social e médica.\n- Não é aposentadoria, não paga 13º e não gera pensão por morte.\nCritérios de renda e exceções mudam: confira o normativo vigente.',
      base: 'LOAS, art. 20 (Lei 8.742/1993).',
      actions: [{ label: 'Ver Previdência/INSS', cat: 'previdencia' }, { label: 'Notícias do MDS', cat: 'noticias' }], follow: ['O que é o CadÚnico?'] },
    { id: 'cadunico', keys: ['cadunico', 'cad unico', 'cadastro unico'],
      text: 'O **Cadastro Único** identifica famílias de baixa renda: renda mensal por pessoa de até **1/2 salário mínimo** ou renda total de até **3 salários mínimos**. É a base de Bolsa Família, BPC, Tarifa Social, Passe Livre e outros programas.\n- Feito no CRAS ou posto de atendimento, pelo(a) responsável familiar, com CPF ou título de eleitor.\n- Deve ser atualizado **a cada 2 anos** ou quando algo mudar (endereço, renda, composição da família).',
      base: 'Decreto 11.016/2022.',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['Como funciona o Bolsa Família?', 'O que é o BPC?'] },
    { id: 'pbf', keys: ['bolsa familia', 'pbf', 'condicionalidades', 'condicionalidade', 'regra de protecao'],
      text: 'O **Bolsa Família** é o programa federal de transferência de renda para famílias inscritas no CadÚnico.\n- **Saúde:** vacinação, pré-natal e acompanhamento do crescimento das crianças.\n- **Educação:** frequência mínima de 60% (4 e 5 anos) e 75% (6 a 18 anos incompletos).\n- O descumprimento gera **efeitos graduais** (advertência, bloqueio e suspensão), com acompanhamento pelo CRAS antes de qualquer cancelamento.\n- A **Regra de Proteção** permite manter parte do benefício por um período quando a renda da família aumenta.\nValores e prazos mudam: veja as Notícias do MDS.',
      base: 'Lei 14.601/2023.',
      actions: [{ label: 'Notícias do MDS', cat: 'noticias' }, { label: 'Ver Educação', cat: 'educacao' }], follow: ['O que é o CadÚnico?'] },
    { id: 'ct', keys: ['conselho tutelar', 'eca', 'estatuto da crianca'],
      text: 'O **Conselho Tutelar** é órgão municipal, permanente e autônomo, que zela pelos direitos de crianças e adolescentes.\n- Recebe denúncias de violação de direitos, aplica medidas de proteção e requisita serviços (saúde, educação, assistência).\n- Não é órgão de punição nem substitui o CRAS/CREAS.\n- Em risco imediato, acione 190, 192 ou 193; denúncias também pelo **Disque 100**.',
      base: 'ECA (Lei 8.069/1990).',
      actions: [{ label: 'Ver Conselho Tutelar', cat: 'conselho' }], follow: ['Como notificar violência contra criança?'] },
    { id: 'viol-crianca', keys: ['violencia contra crianca', 'violencia contra adolescente', 'abuso sexual infantil', 'maus tratos', 'suspeita de violencia', 'escuta especializada', 'depoimento especial', 'lei 13431', 'negligencia infantil'],
      text: 'Suspeita ou confirmação de violência contra criança ou adolescente:\n- **Comunique ao Conselho Tutelar** (obrigatório para profissionais; ECA, art. 13).\n- Na saúde, faça a **notificação compulsória** (SINAN).\n- Registre de forma objetiva, sem interrogar a criança: a escuta é feita por profissional capacitado (escuta especializada e depoimento especial), para evitar revitimização.\n- Em risco imediato: **190** e **Disque 100**.\n- Acione também o CREAS para o acompanhamento da família.',
      base: 'ECA (Lei 8.069/1990) e Lei 13.431/2017.',
      actions: [{ label: 'Ver Conselho Tutelar', cat: 'conselho' }, { label: 'Ver CREAS', cat: 'social' }], follow: ['O que é o PAEFI?'] },
    { id: 'viol-mulher', keys: ['violencia contra a mulher', 'violencia contra mulher', 'violencia domestica', 'maria da penha', 'medida protetiva', 'medidas protetivas', 'feminicidio', 'ligue 180'],
      text: 'Violência contra a mulher:\n- Risco imediato: **190**. Orientação e denúncia 24h: **Ligue 180**.\n- A Delegacia Especializada (DEAM) registra a ocorrência e pode solicitar **medidas protetivas de urgência**.\n- Na saúde, a notificação é compulsória.\n- No CRAS/CREAS: acolhimento, escuta e acompanhamento, priorizando a segurança e a autonomia da mulher. Evite mediação ou conversa conjunta com o agressor.',
      base: 'Lei Maria da Penha (Lei 11.340/2006) e Lei 10.778/2003.',
      actions: [{ label: 'Ver rede de proteção à mulher', cat: 'mulher' }, { label: 'Ver Delegacias', cat: 'delegacias' }], follow: ['Quais os telefones de emergência?'] },
    { id: 'viol-idoso', keys: ['violencia contra idoso', 'violencia contra pessoa idosa', 'maus tratos idoso', 'abandono de idoso', 'estatuto do idoso', 'estatuto da pessoa idosa'],
      text: 'Violência contra pessoa idosa:\n- Denúncia pelo **Disque 100**; risco imediato: **190**.\n- Os casos suspeitos ou confirmados devem ser comunicados à autoridade policial, ao Ministério Público e ao Conselho da Pessoa Idosa, e notificados pela saúde.\n- O CREAS acompanha a pessoa idosa e a família; avalie acolhimento temporário se não houver proteção em casa.',
      base: 'Estatuto da Pessoa Idosa (Lei 10.741/2003).',
      actions: [{ label: 'Ver rede da pessoa idosa', cat: 'idoso' }, { label: 'Ver CREAS', cat: 'social' }], follow: ['O que é o PAEFI?'] },
    { id: 'raps', keys: ['raps', 'rede de atencao psicossocial', 'saude mental', 'reforma psiquiatrica'],
      text: 'A **RAPS** organiza o cuidado em saúde mental e em álcool e outras drogas no SUS, em liberdade e no território.\n- **Atenção básica:** UBS.\n- **Atenção psicossocial:** CAPS (I, II, III, AD, AD III e infantojuvenil).\n- **Urgência:** SAMU 192, UPA e pronto-socorro.\n- **Hospital geral** e residenciais terapêuticos.\nA internação é recurso excepcional, depois de esgotadas as alternativas em meio aberto.',
      base: 'Lei 10.216/2001 e Portaria 3.088/2011 (consolidada na Portaria de Consolidação nº 3/2017).',
      actions: [{ label: 'Abrir Saúde (RAPS)', cat: 'saude' }], follow: ['O que é o CAPS?', 'Quais os telefones de emergência?'] },
    { id: 'caps', keys: ['caps', 'centro de atencao psicossocial'],
      text: 'O **CAPS** é serviço aberto e comunitário da RAPS, para pessoas com sofrimento psíquico grave e persistente ou com necessidades decorrentes do uso de álcool e outras drogas.\n- **CAPS I/II/III:** transtornos mentais (adultos).\n- **CAPS AD / AD III:** álcool e drogas (o AD III funciona 24h).\n- **CAPS i:** crianças e adolescentes.\nO acesso pode ser direto ou por encaminhamento. Diga o bairro ou o nome que eu mostro a unidade.',
      base: 'Portaria de Consolidação nº 3/2017.',
      actions: [{ label: 'Ver CAPS', search: 'CAPS' }], follow: ['O que é a RAPS?', 'Quais os telefones de emergência?'] },
    { id: 'ubs', keys: ['ubs', 'unidade basica de saude', 'atencao basica', 'atencao primaria', 'posto de saude'],
      text: 'A **UBS** é a porta de entrada preferencial do SUS: consultas, vacinas, pré-natal, curativos, acompanhamento do Bolsa Família e cuidado em saúde mental na atenção básica, organizada pela Estratégia Saúde da Família.\nA unidade de referência depende do bairro e do território da equipe.',
      base: 'Política Nacional de Atenção Básica (Portaria GM/MS 2.436/2017).',
      actions: [{ label: 'Ver UBS', search: 'UBS' }], follow: ['O que é a RAPS?'] },
    { id: 'encaminhar', keys: ['como encaminhar', 'encaminhamento responsavel', 'contrarreferencia', 'contra referencia', 'fluxo de encaminhamento', 'referencia e contrarreferencia'],
      text: 'Um bom encaminhamento:\n- **Contato prévio** com a unidade de destino (telefone ou e-mail), para confirmar que o serviço atende aquela demanda.\n- **Ficha objetiva:** motivo, o que já foi feito e o que se espera do serviço, sem excesso de dados sensíveis.\n- **Orientar a pessoa:** local, horário e documentos.\n- Combinar a **contrarreferência** (retorno sobre o caso) e registrar tudo.\nNo app, abra o card da unidade e use "Gerar Guia".',
      base: 'Boas práticas do trabalho em rede (SUAS/SUS).',
      actions: [{ label: 'Buscar unidade', search: '' }], follow: ['O que é sigilo profissional?'] },
    { id: 'acolhimento', keys: ['acolhimento institucional', 'alta complexidade', 'abrigo', 'casa lar', 'familia acolhedora', 'republica', 'ilpi', 'casa abrigo'],
      text: 'Os serviços de **acolhimento** (Proteção Social Especial de Alta Complexidade) incluem abrigo institucional, casa-lar, república, família acolhedora, casa-abrigo e instituições de longa permanência para pessoas idosas.\nPara crianças e adolescentes é medida **provisória e excepcional**, aplicada pela Justiça ou pelo Conselho Tutelar; a prioridade é a reintegração familiar ou, se inviável, família substituta.',
      base: 'Tipificação Nacional (Res. CNAS 109/2009) e ECA, arts. 19 e 101.',
      actions: [{ label: 'Ver unidades sociais', cat: 'social' }], follow: ['Como funciona o Conselho Tutelar?'] },
    { id: 'eventuais', keys: ['beneficio eventual', 'beneficios eventuais', 'auxilio natalidade', 'auxilio funeral', 'vulnerabilidade temporaria'],
      text: 'Os **benefícios eventuais** atendem situações imprevistas: **natalidade**, **morte** (auxílio funeral), **vulnerabilidade temporária** e **calamidade pública**.\nSão regulados por lei do município e concedidos após **avaliação técnica**. A cesta básica costuma entrar como vulnerabilidade temporária.',
      base: 'LOAS, art. 22 (Lei 8.742/1993).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['O que é o CadÚnico?'] },
    { id: 'visita', keys: ['visita domiciliar', 'busca ativa'],
      text: 'A **visita domiciliar** é instrumento do trabalho social com famílias: tem objetivo definido, é combinada com a família sempre que possível e respeita sigilo e privacidade. Registre o objetivo, o observado e os encaminhamentos.\nA **busca ativa** identifica famílias em vulnerabilidade que ainda não acessam serviços e benefícios.',
      base: 'Orientações técnicas do PAIF (MDS).',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['O que é o PAIF?'] },
    { id: 'sigilo', keys: ['sigilo', 'sigilo profissional', 'confidencialidade', 'codigo de etica'],
      text: 'O **sigilo** protege as informações da pessoa atendida. Compartilhe só o necessário para o encaminhamento, com ciência da pessoa sempre que possível.\nHá exceções legais (risco de vida, notificação compulsória, determinação judicial). Consulte o código de ética da sua categoria (CFP, CFESS) e a orientação da coordenação. Isto não substitui parecer ético ou jurídico.',
      base: 'Códigos de ética profissionais e LGPD (Lei 13.709/2018).',
      actions: [], follow: ['Como encaminhar com responsabilidade?'] },
    { id: 'rma', keys: ['rma', 'registro mensal de atendimentos'],
      text: 'O **RMA** (Registro Mensal de Atendimentos) é o registro mensal de CRAS e CREAS enviado ao MDS, com o total de atendimentos, acompanhamentos e ações do período.\nNa aba Atendimento CRAS você encontra os atalhos e formulários de apoio.',
      base: 'Sistema de registro do SUAS (MDS).',
      actions: [{ label: 'Abrir Atendimento CRAS', cat: 'cras' }], follow: [] },
    { id: 'rua', keys: ['situacao de rua', 'pop rua', 'centro pop', 'abordagem social', 'morador de rua', 'moradores de rua', 'pessoa em situacao de rua'],
      text: 'Para pessoas em **situação de rua**, o SUAS oferece **abordagem social**, **Centro POP** (convivência, higiene, referência para documentos e encaminhamentos) e **acolhimento**. O acesso aos demais serviços (saúde, CadÚnico, documentação) é direito, mesmo sem endereço fixo.',
      base: 'Decreto 7.053/2009 (Política Nacional para a População em Situação de Rua).',
      actions: [{ label: 'Ver unidades sociais', cat: 'social' }], follow: ['Como funciona o CadÚnico?'] },
    { id: 'migrantes', keys: ['migrante', 'migrantes', 'refugiado', 'refugiados', 'imigrante', 'imigrantes', 'lei de migracao', 'operacao acolhida'],
      text: 'Migrantes e refugiados têm direito aos serviços do SUAS e do SUS **independentemente da situação migratória**.\nPara regularização e documentação, veja a rede de **Migração**; para atendimento em outros idiomas, use o Tradutor do app (espanhol, inglês e francês).',
      base: 'Lei de Migração (Lei 13.445/2017) e Lei do Refúgio (Lei 9.474/1997).',
      actions: [{ label: 'Ver Migração', cat: 'migracao' }, { label: 'Abrir Tradutor', cat: 'tradutor' }], follow: [] },
    { id: 'pcd', keys: ['pessoa com deficiencia', 'pessoas com deficiencia', 'lei brasileira de inclusao', 'lbi', 'autismo', 'espectro autista', 'berenice piana', 'tea'],
      text: 'Os direitos da pessoa com deficiência estão na **Lei Brasileira de Inclusão** e, no caso do autismo, na **Lei Berenice Piana**.\nNa rede: avaliação e acompanhamento em saúde, BPC (quando houver critério de renda), Passe Livre, educação inclusiva e serviços do CREAS para pessoas com deficiência e suas famílias.',
      base: 'Lei 13.146/2015 (LBI) e Lei 12.764/2012 (TEA).',
      actions: [{ label: 'Ver rede TEA/PcD', cat: 'tea' }], follow: ['O que é o BPC?'] },
    { id: 'socioeducativas', keys: ['medida socioeducativa', 'medidas socioeducativas', 'liberdade assistida', 'prestacao de servico a comunidade', 'ato infracional', 'sinase'],
      text: 'As medidas socioeducativas em meio aberto, **Liberdade Assistida (LA)** e **Prestação de Serviços à Comunidade (PSC)**, são determinadas pela Justiça a adolescentes em cumprimento de medida e acompanhadas pelo **CREAS**, com Plano Individual de Atendimento (PIA) construído com o adolescente e a família.',
      base: 'ECA (Lei 8.069/1990) e SINASE (Lei 12.594/2012).',
      actions: [{ label: 'Ver CREAS', cat: 'social' }], follow: [] },
    { id: 'emergencia', keys: ['telefones de emergencia', 'telefones uteis', 'numeros de emergencia', 'samu', 'disque 100', 'cvv'],
      text: 'Telefones úteis (gratuitos):\n- **192** SAMU · **193** Bombeiros · **190** Polícia Militar\n- **188** CVV: apoio emocional 24h\n- **180** Central de Atendimento à Mulher\n- **100** Disque Direitos Humanos (crianças, pessoas idosas, PcD)\n- **135** INSS · **136** Disque Saúde',
      base: 'Serviços públicos nacionais.',
      actions: [{ label: 'Ver Saúde/Urgência', cat: 'hospitalar' }, { label: 'Ver Delegacias', cat: 'delegacias' }], follow: [] }
  ];
  var gloIndex = null;
  function glossaryScore(text) {
    if (!gloIndex) gloIndex = GLOSSARIO.map(function (g) { return { g: g, keys: g.keys.map(function (k) { return k.indexOf('+') > -1 ? { all: k.split('+') } : { phrase: norm(k) }; }) }; });
    var n = norm(text), padded = ' ' + n + ' ', tokens = n ? n.split(' ') : [];
    for (var i = 0; i < tokens.length; i++) if (APP_WORDS[tokens[i]]) return { score: 0 };
    var best = null, bestScore = 0;
    gloIndex.forEach(function (e) {
      var s = 0;
      e.keys.forEach(function (k) {
        if (k.all) { if (k.all.every(function (w) { return tokens.indexOf(w) > -1; })) s += 6; return; }
        if (padded.indexOf(' ' + k.phrase + ' ') > -1) s += k.phrase.indexOf(' ') > -1 ? 4 : 3;
        else if (k.phrase.length >= 5 && k.phrase.indexOf(' ') < 0 && tokens.some(function (t) { return t.length >= 5 && (t.indexOf(k.phrase) === 0 || k.phrase.indexOf(t) === 0); })) s += 1.5;
      });
      if (s > bestScore) { best = e.g; bestScore = s; }
    });
    return { score: bestScore, entry: best };
  }
  function composeGlossary(entry) {
    return {
      reply: entry.text, mood: 'info', badge: 'Base SUAS',
      note: entry.base ? 'Base: ' + entry.base : '',
      quickActions: entry.actions || [], followups: (entry.follow || []).slice(0, 3), glossId: entry.id
    };
  }

  // ---------------------------------------------------------------------
  // Segurança: socorro e risco de vida (responde sem internet e sem IA)
  // ---------------------------------------------------------------------
  var RE_SUICIDIO = /\b(suicid\w*|me matar|se matar|ele se matar|ela se matar|quer(o|er|ia)? morrer|nao quer(o|er)? mais viver|tirar (a )?(minha |sua |propria )?vida|acabar com (a )?(minha |sua )?vida|autolesao|auto lesao|automutilac\w*|se cortando|se cortar|ideacao suicida|ideacao|tentativa de suicidio)\b/;
  var RE_PERIGO = /\b(risco de vida|risco iminente|em perigo|correndo perigo|estou sendo (agredid\w*|ameacad\w*)|sendo agredid\w*|socorro)\b/;
  function crisis(text) {
    var n = norm(text);
    if (RE_SUICIDIO.test(n)) {
      return {
        reply: '**Isto pede atenção imediata.**\n- Risco **imediato** (plano, meios ao alcance, tentativa em curso): ligue **192 (SAMU)** ou **193** e não deixe a pessoa sozinha.\n- Apoio emocional 24h, gratuito: **188 (CVV)**.\n- Cuidado continuado: CAPS e UPA da região (mostro as unidades abaixo).\n**Como abordar:** acolha sem julgar, pergunte diretamente sobre a ideia de morrer, avalie o risco e o acesso a meios, mobilize a rede de apoio e registre o encaminhamento.',
        mood: 'error', badge: 'Alerta', crisis: true,
        note: 'Este assistente não substitui avaliação clínica nem o serviço de urgência.',
        quickActions: [{ label: 'Ver CAPS', search: 'CAPS' }, { label: 'Ver Urgência/UPA', cat: 'hospitalar' }],
        followups: ['Quais os telefones de emergência?']
      };
    }
    if (RE_PERIGO.test(n)) {
      return {
        reply: '**Se há risco de vida agora, ligue:**\n- **190** Polícia Militar · **192** SAMU · **193** Bombeiros\n- **180** Central de Atendimento à Mulher · **100** Disque Direitos Humanos\nDepois de garantida a segurança, aciono a rede com você: me diga quem precisa de proteção (criança, mulher, pessoa idosa) e eu mostro o fluxo.',
        mood: 'error', badge: 'Alerta', crisis: true,
        quickActions: [{ label: 'Ver Delegacias', cat: 'delegacias' }, { label: 'Ver Conselho Tutelar', cat: 'conselho' }],
        followups: ['Violência contra a mulher', 'Violência contra criança']
      };
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Memória da conversa
  // ---------------------------------------------------------------------
  var session = { history: [], units: [], aiTimes: [], lastAi: 0 };
  function reset() { session.history = []; session.units = []; }
  function remember(userText, botText, units) {
    userText = String(userText || '').trim();
    if (userText && !piiBlock(userText)) session.history.push({ papel: 'usuario', texto: userText.slice(0, CFG.maxPergunta) });
    botText = String(botText || '').replace(/\*\*/g, '').trim();
    if (botText) session.history.push({ papel: 'argo', texto: botText.slice(0, 600) });
    while (session.history.length > 8) session.history.shift();
    if (units && units.length) session.units = units.slice(0, 5);
  }

  // ---------------------------------------------------------------------
  // IA: pedido, streaming e conferência
  // ---------------------------------------------------------------------
  function aiOn() { return !!CFG.url && (typeof navigator === 'undefined' || navigator.onLine !== false); }
  function aiGate() {
    var now = Date.now();
    if (now - session.lastAi < CFG.minGapMs) return 'Calma, já estou terminando a resposta anterior. Tente de novo em um instante.';
    session.aiTimes = session.aiTimes.filter(function (t) { return now - t < 60000; });
    if (session.aiTimes.length >= CFG.porMinuto) return 'Muitas perguntas seguidas. Aguarde um minuto e pergunte de novo.';
    return '';
  }
  // Pergunta de panorama: quantos / todos / liste / quais / comparar... A resposta depende de
  // VÁRIAS unidades (ou do total), não de uma só.
  var RE_AMPLA = /\b(quantos|quantas|quantidade|total|todos|todas|toda a rede|lista|listar|liste|relacao|quais|qual a diferenca|diferenca|diferencas|comparar|compare|comparacao|panorama|resumo da rede|cada um|cada uma|existem|existe algum|ha algum|tem algum|mais proximo|opcoes)\b/;
  function isAmpla(text) { return RE_AMPLA.test(norm(text)); }
  // Tira da pergunta as palavras de "quantidade/lista" (e o genérico "unidades", "rede"), que não
  // distinguem equipamento nenhum e só atrapalham a busca pelo assunto de verdade.
  var RE_AMPLA_LIMPA = new RegExp(RE_AMPLA.source.replace(/^\\b\(/, '\\b(unidade|unidades|equipamento|equipamentos|rede|atendem|atende|existem|') , 'g');
  function semPalavrasAmplas(text) { return norm(text).replace(RE_AMPLA_LIMPA, ' ').replace(/\s+/g, ' ').trim(); }

  var CAT_ROTULO = {
    bancos: 'Bancos (Caixa Econômica)', trabalho: 'Trabalho, emprego e qualificação', juridico: 'Justiça e defensoria',
    educacao: 'Educação', cultura: 'Cultura e lazer', saude: 'Saúde', hospitalar: 'Hospitais e urgência',
    social: 'Assistência social', alimentar: 'Segurança alimentar', delegacias: 'Delegacias e segurança',
    interior: 'Interior de Roraima', tea: 'TEA/PCD', idoso: 'Pessoa idosa', mulher: 'Proteção à mulher',
    conselho: 'Conselhos Tutelares', conselhosdireitos: 'Conselhos de direitos', documentacao: 'Documentação',
    migracao: 'Migração e refúgio', defesacivil: 'Defesa Civil', informes: 'Informes e benefícios',
    habitacao: 'Habitação', mobilidade: 'Mobilidade', previdencia: 'Previdência'
  };
  function grupoDe(d) {
    var g = cleanText(d.group);
    if (g) return g;
    var c = Array.isArray(d.cat) && d.cat.length ? d.cat[0] : '';
    return CAT_ROTULO[c] || 'Outros';
  }

  // Visão geral do diretório (contagem por grupo). Vai junto das perguntas de panorama para a IA
  // responder "quantos" com o número real, em vez de contar fichas soltas.
  var panoramaCache = null;
  function panorama() {
    if (panoramaCache && panoramaCache.n === data.length) return panoramaCache.txt;
    var cont = {}, ordem = [];
    data.forEach(function (d) { var g = grupoDe(d); if (!cont[g]) { cont[g] = 0; ordem.push(g); } cont[g]++; });
    var txt = 'O diretório tem ' + data.length + ' equipamentos, em ' + ordem.length + ' grupos: ' +
      ordem.map(function (g) { return g + ' (' + cont[g] + ')'; }).join('; ') + '.';
    panoramaCache = { n: data.length, txt: txt };
    return txt;
  }

  function aiContext(text, tabCat, ampla) {
    var q = parseQuery(ampla ? (semPalavrasAmplas(text) || text) : text);
    if (!q.strong.length && !q.syn.length) return { fichas: [], total: 0 };
    var r = searchDirectory(q, tabCat);
    if (!r.rows.length) return { fichas: [], total: 0 };
    var lim = ampla ? CFG.maxContextoAmplo : CFG.maxContexto;
    // Pergunta de panorama que cita uma sigla/tipo que é o nome do GRUPO (CAPS, UBS, CRAS, CREAS...):
    // as unidades desse grupo vêm primeiro, com a busca por palavra só para desempatar.
    if (ampla) {
      var fortes = asSet(q.strong);
      r.rows.forEach(function (x) {
        // só sigla escrita em MAIÚSCULAS no nome do grupo ("CAPS (Boa Vista)"), para "pessoa", "saúde"... não puxarem grupos
        var siglas = (cleanText(grupoDe(x.u.d)).match(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,6}\b/g) || []).map(norm);
        if (siglas.some(function (t) { return fortes[t]; })) x.score += 100;
      });
      r.rows.sort(function (a, b) { return b.score - a.score; });
    }
    var corte = r.rows[0].score * (ampla && r.rows[0].score > 100 ? 0.0 : 0.4);
    var todos = r.rows.filter(function (x) { return x.score >= corte; });
    if (ampla && r.rows[0].score > 100) todos = todos.filter(function (x) { return x.score > 100; });
    var fichas = todos.slice(0, lim).map(function (x) {
      var u = slim(x.u.d);
      return {
        nome: u.fullName || u.name, grupo: grupoDe(x.u.d), endereco: u.address, horario: u.hours,
        telefones: u.phones.join(', '), servicos: cut(u.services, ampla ? 200 : 320),
        descricao: cut(cleanText(x.u.d.desc), ampla ? 120 : 220)
      };
    });
    return { fichas: fichas, total: todos.length };
  }
  // Perguntas sobre território que o atalho local não resolveu (ex.: texto longo, vários casos): a IA recebe
  // a lista oficial de bairros de cada CRAS/CREAS como fichas e responde só com ela.
  function territorioFichas(text) {
    var n = norm(text);
    var kind = (/\bcreas\b/.test(n) && !/\bcras\b/.test(n)) ? 'CREAS' : (/\bcras\b|\bcreas\b/.test(n) ? 'CRAS' : '');
    if (!kind) {
      if (!(RE_COBERTURA.test(n) && RE_MORADIA.test(n))) return [];
      kind = 'CRAS';
    } else if (!(RE_COBERTURA.test(n) || RE_MORADIA.test(n) || /\b(perto|proximo|zona|onde|qual|quais)\b/.test(n))) return [];
    if (!terrAll) terrAll = {};
    if (!terrAll[kind]) terrAll[kind] = buildTerritory(kind);
    return terrAll[kind].list.filter(function (u) { return u.bairros.length; }).map(function (u) {
      var d = data.filter(function (x) { return x.id === u.id; })[0] || {};
      var sl = slim(d), lista = u.bairros.join(', '), a = lista, b = '';
      if (a.length > 255) { var cutAt = a.lastIndexOf(', ', 255); b = a.slice(cutAt + 2); a = a.slice(0, cutAt); }
      return {
        nome: sl.name, grupo: grupoDe(d), endereco: sl.address, horario: sl.hours,
        telefones: sl.phones.join(', '),
        servicos: 'BAIRROS ATENDIDOS (lista oficial): ' + a + (b ? ',' : '.'),
        descricao: b ? '(continuação dos bairros atendidos) ' + b + '.' : ''
      };
    });
  }
  function buildPayload(text, opts) {
    opts = opts || {};
    var hist = session.history.slice(-CFG.maxHistorico);
    // a pergunta atual já entra separada: não repete a última mensagem do usuário
    if (hist.length && hist[hist.length - 1].papel === 'usuario' && hist[hist.length - 1].texto === text.slice(0, CFG.maxPergunta)) hist = hist.slice(0, -1);
    var ampla = isAmpla(text);
    var ctx = aiContext(text, opts.tabCat, ampla);
    var terr = territorioFichas(text);
    if (terr.length) {
      var nomes = asSet(terr.map(function (f) { return f.nome; }));
      ctx = { fichas: terr.concat(ctx.fichas.filter(function (f) { return !nomes[f.nome]; })).slice(0, 10), total: ctx.total };
    }
    var pan = '';
    if (ampla) {
      pan = panorama();
      if (ctx.fichas.length) {
        pan += ' Para esta pergunta foram anexadas ' + ctx.fichas.length + ' fichas' +
          (ctx.total > ctx.fichas.length ? ' de cerca de ' + ctx.total + ' que combinam (lista parcial)' : ' (todas as que combinam)') + '.';
      }
    }
    return {
      v: 2, stream: true,
      pergunta: String(text).trim().slice(0, CFG.maxPergunta),
      contexto: ctx.fichas,
      panorama: pan,
      historico: hist,
      pagina: String(opts.tabName || '').slice(0, 80)
    };
  }

  // Todos os telefones do diretório (últimos 8 dígitos) para conferir a IA.
  var phoneIdx = null;
  function knownPhones() {
    if (phoneIdx) return phoneIdx;
    phoneIdx = {};
    data.forEach(function (d) {
      (Array.isArray(d.phones) ? d.phones : []).forEach(function (p) {
        (String(p).match(RE_FONE) || []).forEach(function (m) { var dg = m.replace(/\D/g, ''); if (dg.length >= 8) phoneIdx[dg.slice(-8)] = 1; });
      });
      var w = cleanText(d.desc).match(RE_FONE) || [];
      w.forEach(function (m) { var dg = m.replace(/\D/g, ''); if (dg.length >= 8) phoneIdx[dg.slice(-8)] = 1; });
    });
    return phoneIdx;
  }
  function verifyPhones(text) {
    var found = String(text || '').match(RE_FONE) || [], bad = false, idx = knownPhones();
    found.forEach(function (m) {
      var dg = m.replace(/\D/g, '');
      if (dg.length >= 8 && !idx[dg.slice(-8)]) bad = true;
    });
    return bad;
  }
  function cleanAI(text) {
    return String(text || '')
      .replace(/^\s*(argo|resposta)\s*:\s*/i, '')
      .replace(/<\/?(fichas|pergunta|historico)>/gi, '')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/^\s*\*\s+/gm, '- ')
      .replace(/\n{3,}/g, '\n\n')
      .trim().slice(0, 2400);
  }
  function mentionedUnits(text, ctxNames) {
    var n = ' ' + norm(text) + ' ', out = [];
    ensureIndex();
    index.forEach(function (u) {
      if (out.length >= 3) return;
      var nm = norm(u.d.name);
      if (nm.length >= 5 && n.indexOf(' ' + nm + ' ') > -1 && ctxNames.indexOf(norm(u.d.fullName || u.d.name)) > -1) out.push(slim(u.d));
    });
    return out;
  }

  // Lê a resposta da IA: SSE (Worker novo) ou JSON (Worker antigo).
  // Chama onDelta(pedaço) e resolve com o texto final.
  function streamAI(payload, hooks) {
    hooks = hooks || {};
    var ctl = new AbortController();
    var userSignal = hooks.signal;
    if (userSignal) {
      if (userSignal.aborted) ctl.abort(); else userSignal.addEventListener('abort', function () { ctl.abort(); });
    }
    var firstTimer = setTimeout(function () { ctl.abort(); }, CFG.firstByteMs);
    var idleTimer = null;
    function bump() { clearTimeout(idleTimer); idleTimer = setTimeout(function () { ctl.abort(); }, CFG.idleMs); }
    var full = '';
    function emit(t) { if (!t) return; full += t; if (hooks.onDelta) hooks.onDelta(t, full); }
    function done() { clearTimeout(firstTimer); clearTimeout(idleTimer); }

    session.lastAi = Date.now(); session.aiTimes.push(session.lastAi);
    return fetch(CFG.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream, application/json' },
      body: JSON.stringify(payload),
      signal: ctl.signal
    }).then(function (r) {
      clearTimeout(firstTimer);
      var ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          var e = new Error((j && j.erro) || 'HTTP ' + r.status);
          e.userMessage = (r.status === 429 && j && j.erro) ? j.erro : '';
          e.status = r.status;
          throw e;
        });
      }
      if (/text\/event-stream/i.test(ct) && r.body && r.body.getReader) {
        var reader = r.body.getReader(), dec = new TextDecoder('utf-8'), buf = '';
        bump();
        var pump = function () {
          return reader.read().then(function (x) {
            if (x.done) return;
            bump();
            buf += dec.decode(x.value, { stream: true });
            var parts = buf.split('\n');
            buf = parts.pop();
            for (var i = 0; i < parts.length; i++) {
              var line = parts[i].trim();
              if (line.indexOf('data:') !== 0) continue;
              var body = line.slice(5).trim();
              if (body === '[DONE]') return;
              try {
                var ev = JSON.parse(body);
                if (ev && ev.erro) { var er = new Error(ev.erro); er.partial = full; throw er; }
                if (ev && typeof ev.t === 'string') emit(ev.t);
              } catch (err) { if (err && err.partial !== undefined) throw err; }
            }
            return pump();
          });
        };
        return pump();
      }
      // Worker antigo: resposta inteira em JSON → revela aos poucos para a leitura ficar igual.
      return r.json().then(function (j) {
        var txt = (j && typeof j.resposta === 'string') ? j.resposta : '';
        if (!txt) throw new Error('vazia');
        return new Promise(function (resolve, reject) {
          var i = 0, step = Math.max(3, Math.ceil(txt.length / 90));
          (function tick() {
            if (ctl.signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
            if (i >= txt.length) return resolve();
            emit(txt.slice(i, i + step)); i += step;
            setTimeout(tick, 22);
          })();
        });
      });
    }).then(function () {
      done();
      var txt = cleanAI(full);
      if (!txt) throw new Error('vazia');
      return txt;
    }, function (err) {
      done();
      if (err && !err.partial) err.partial = full;
      throw err;
    });
  }

  // ---------------------------------------------------------------------
  // Território: "qual CRAS atende o bairro X?"
  // Lê a lista "Bairros atendidos:" / "Cobertura:" que já está na ficha de
  // cada CRAS (data.js) — nada é digitado em dobro. Responde só com o que
  // está nessa lista; bairro que não consta nela NÃO é adivinhado.
  // ---------------------------------------------------------------------
  var terrIdx = null, terrAll = null, KIND = 'CRAS';
  // prefixos que as pessoas costumam omitir ao falar o nome do bairro
  var BAIRRO_PREF = /^(dr|doutor|doutora|conjunto|jardim|governador|senador|professora|professor|nossa senhora de|nossa senhora)\s+/;
  function buildTerritory(kind) {
    var keys = {}, list = [], re = new RegExp('^' + kind + '\\b', 'i');
    data.forEach(function (d) {
      if (!re.test(d.group || '') && !re.test(d.name || '')) return;
      var txt = cleanText(d.desc);
      // a lista termina no ponto seguido de quebra de linha (cleanText troca <br> por "·"); "Dr." tem ponto no meio
      var m = txt.match(/(?:Bairros atendidos|Cobertura)\s*:\s*([\s\S]+?)\.\s*(?:·|⚖|$)/i);
      var unit = { id: d.id, name: d.name, nameN: norm(d.name), bairros: [] };
      if (m) m[1].split(/,|\se\s/).forEach(function (b) {
        b = b.trim();
        if (b.length < 3) return;
        var full = norm(b);
        unit.bairros.push(b);
        var item = { label: b, unit: unit, full: full };
        (keys[full] = keys[full] || []).push(item);
        var short = full.replace(BAIRRO_PREF, '');
        if (short !== full && short.length > 3) (keys[short] = keys[short] || []).push({ label: b, unit: unit, full: full, alias: true });
      });
      list.push(unit);
    });
    return { keys: keys, list: list, sorted: Object.keys(keys).sort(function (a, b) { return b.length - a.length; }) };
  }
  // distância de edição (para "caimbe", "cauame", "pintolandai"...)
  function lev(a, b) {
    var m = a.length, n2 = b.length, i, j, prev = [], cur;
    for (j = 0; j <= n2; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n2; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      prev = cur;
    }
    return prev[n2];
  }
  var FUZZ_IGNORA = asSet('cras bairro bairros atende atendem moro mora qual quais meu minha regiao comunidade cadunico cadastro unico bolsa familia paif'.split(' '));
  function fuzzyBairro(n) {
    var t = n.split(' ').filter(function (w) { return w && !STOP[w] && !FUZZ_IGNORA[w]; });
    var best = null, bestD = 99, tie = false;
    for (var len = 1; len <= 4; len++) {
      for (var i = 0; i + len <= t.length; i++) {
        var frase = t.slice(i, i + len).join(' ');
        if (frase.length < 5) continue;
        var lim = frase.length >= 10 ? 2 : 1;
        terrIdx.sorted.forEach(function (k) {
          if (Math.abs(k.length - frase.length) > lim) return;
          var d = lev(frase, k);
          if (d > lim) return;
          if (d < bestD) { bestD = d; best = k; tie = false; }
          else if (d === bestD && k !== best && terrIdx.keys[k][0].unit.id !== terrIdx.keys[best][0].unit.id) tie = true;
        });
      }
    }
    return best && !tie ? { key: best } : null;
  }
  // técnico(a) fixo(a) do CRAS Cristiana para aquele bairro (equipe-cras-cristiana.js)
  function tecnicoDe(label, unitId) {
    if (!label || unitId !== 'cras-cristiana-vicente-nunes') return '';
    var eq = (typeof EQUIPE_CRAS_CRISTIANA !== 'undefined') ? EQUIPE_CRAS_CRISTIANA : null;
    if (!eq || !eq.fixedTeam) return '';
    var alvo = ' ' + norm(label) + ' ', achou = '';
    eq.fixedTeam.forEach(function (t) { if (!achou && (' ' + norm(t.bairros) + ' ').indexOf(alvo) > -1) achou = t.name + ' (' + t.role + ')'; });
    return achou;
  }
  var RE_COBERTURA = /\b(atende|atendem|atendimento|atendido|atendida|atendo|referencia|abrange|abrangem|cobre|cobertura|territorio|pertence|pertencem|responsavel|jurisdicao)\b/;
  var RE_MORADIA = /\b(bairro|moro|mora|moramos|morador|moradora|moradores|residente|resido|reside|regiao|comunidade)\b/;
  function territory(text) {
    var n = norm(text);
    if (!n || n.length > 200) return null;
    KIND = (/\bcreas\b/.test(n) && !/\bcras\b/.test(n)) ? 'CREAS' : 'CRAS';
    var kw = KIND.toLowerCase();
    var hasCras = new RegExp('\\b' + kw + '\\b').test(n);
    var hasServico = /\b(cadunico|cad unico|cadastro unico|bolsa familia|paif|scfv|assistencia social)\b/.test(n);
    var meuBairro = /\b(meu bairro|minha regiao|minha casa|onde moro|moro aqui)\b/.test(n);
    if (!hasCras && !(RE_COBERTURA.test(n) && RE_MORADIA.test(n)) && !(hasServico && RE_MORADIA.test(n))) return null;
    if (!terrAll) terrAll = {};
    if (!terrAll[KIND]) terrAll[KIND] = buildTerritory(KIND);
    terrIdx = terrAll[KIND];
    // acha os bairros citados (o nome mais longo vence; um trecho já usado não conta de novo)
    var padded = ' ' + n + ' ', used = [], hits = [], citouUnidade = false;
    terrIdx.sorted.forEach(function (k) {
      var at = padded.indexOf(' ' + k + ' ');
      if (at < 0) return;
      var from = at, to = at + k.length + 2;
      if (used.some(function (u) { return from < u[1] && to > u[0]; })) return;
      // "CRAS Cauamé" é o nome da unidade, não uma pergunta sobre o bairro
      var before = padded.slice(0, at + 1).trim().split(' ').slice(-1)[0];
      if (before === kw && terrIdx.list.some(function (u) { return (' ' + u.nameN + ' ').indexOf(' ' + k + ' ') > -1; })) { citouUnidade = true; return; }
      used.push([from, to]);
      hits.push({ key: k, items: terrIdx.keys[k] });
    });
    var corrigido = '';
    if (!hits.length && !citouUnidade) {
      var fz = fuzzyBairro(n);
      if (fz) { hits.push({ key: fz.key, items: terrIdx.keys[fz.key] }); corrigido = fz.key; }
    }
    if (!hits.length) {
      // "quais bairros o CRAS Cauamé atende?": lista a cobertura daquela unidade
      var named = terrIdx.list.filter(function (u) {
        var nm = u.nameN.replace(/^(cras|creas)\s+/, '');
        var nm2 = nm.replace(BAIRRO_PREF, '');
        return u.bairros.length && nm && ((' ' + n + ' ').indexOf(' ' + kw + ' ' + nm + ' ') > -1 || (' ' + n + ' ').indexOf(' ' + kw + ' ' + nm2 + ' ') > -1);
      })[0];
      if (named && /\b(bairro|bairros|territorio|cobertura|atende|atendem|abrange|regiao|regioes)\b/.test(n)) {
        var fd = data.filter(function (d) { return d.id === named.id; })[0];
        return {
          reply: 'O **' + named.name + '** atende ' + named.bairros.length + ' bairros: ' + named.bairros.join(', ') + '.\nConfirme com a unidade antes de encaminhar: a divisão dos territórios pode mudar.',
          mood: 'success', followups: ['Qual o telefone?', 'Como chegar?'], badge: 'Território', units: [slim(fd)]
        };
      }
      // zona rural / comunidade indígena: quem atende é o CRAS Itinerante
      if (hasCras && /\b(indigena|indigenas|aldeia|rural|zona rural|interior|vicinal)\b/.test(n)) {
        var it = terrIdx.list.filter(function (u) { return /itinerante/.test(u.nameN); })[0];
        var du = it && data.filter(function (d) { return d.id === it.id; })[0];
        if (du) return {
          reply: 'Comunidades indígenas e a zona rural de Boa Vista são atendidas pelo **CRAS Itinerante**, que leva o CadÚnico e o PAIF até o território.\nO itinerário muda; confirme os dias e o local com a coordenação antes de orientar a família.',
          mood: 'success', followups: ['Ver o CRAS Itinerante'], badge: 'Território', units: [slim(du)]
        };
      }
      // "qual cras atende o meu bairro?" sem dizer o bairro: pergunta de volta
      var soPergunta = n.split(' ').filter(function (t) { return !STOP[t] && !/^(cras|bairro|atende|atendem|meu|minha|qual|quais|moro|mora|regiao|casa)$/.test(t); }).length === 0;
      if (hasCras && (meuBairro || soPergunta)) return {
        reply: 'Me diga o **nome do bairro** onde a família mora que eu mostro qual ' + KIND + ' é a referência.',
        mood: 'info', followups: ['Moro no Caimbé', 'Qual CRAS atende o Centro?'], badge: 'Território'
      };
      // pediu "o CRAS do bairro X" mas X não está na lista: não chuta
      if (hasCras && (/\bbairro\b/.test(n) || RE_MORADIA.test(n) || RE_COBERTURA.test(n))) {
        var lista = terrIdx.list.filter(function (u) { return u.bairros.length; }).map(function (u) { return u.name; });
        return {
          reply: 'Não encontrei esse bairro na lista de cobertura dos ' + KIND + ' de Boa Vista. Confira a grafia ou diga o nome de um bairro vizinho.\nOs ' + KIND + ' com território cadastrado são: ' + lista.join(', ') + '.',
          mood: 'notfound', followups: ['Quais bairros o CRAS Cauamé atende?'], badge: 'Território'
        };
      }
      return null;
    }
    var lines = [], units = [], seen = {}, aviso = false;
    hits.slice(0, 4).forEach(function (h) {
      // nome exato do bairro vence; se outro bairro tem o mesmo nome "curto", mostra os dois
      var exact = h.items.filter(function (i) { return !i.alias; });
      var alias = h.items.filter(function (i) { return i.alias; });
      var cands = exact.concat(alias.filter(function (a) { return !exact.some(function (e) { return e.full === a.full; }); }));
      var byUnit = {};
      cands.forEach(function (c) { (byUnit[c.unit.id] = byUnit[c.unit.id] || { unit: c.unit, labels: [] }).labels.push(c.label); });
      var groups = Object.keys(byUnit).map(function (k) { return byUnit[k]; });
      if (groups.length === 1) {
        var g = groups[0], lbl = g.labels[0];
        lines.push('**' + lbl + '** é atendido pelo **' + g.unit.name + '**.');
        if (!seen[g.unit.id]) { seen[g.unit.id] = 1; units.push(g.unit); }
      } else {
        lines.push('Há mais de um bairro com o nome "' + h.key + '" na lista, confirme qual é o seu:');
        groups.forEach(function (g) {
          lines.push('- **' + g.labels[0] + '** → **' + g.unit.name + '**');
          if (!seen[g.unit.id]) { seen[g.unit.id] = 1; units.push(g.unit); }
        });
        aviso = true;
      }
    });
    if (corrigido) lines.unshift('Entendi o bairro como **' + hits[0].items[0].label + '**.');
    var full = units.map(function (u) { return slim(data.filter(function (d) { return d.id === u.id; })[0]); });
    if (full.length === 1) {
      var f = full[0];
      if (f.address) lines.push('Endereço: ' + cut(f.address, 200));
      if (f.hours) lines.push('Horário: ' + cut(f.hours, 160));
      if (f.phones.length) lines.push('Telefone: ' + f.phones.slice(0, 2).join(' · '));
      var tec = tecnicoDe(hits.length === 1 ? hits[0].items[0].label : '', f.id);
      if (tec) lines.push('Técnico(a) de referência no bairro: ' + tec + '.');
    }
    lines.push('Confirme com a unidade antes de encaminhar: a divisão dos territórios pode mudar e algumas ruas ficam no limite entre dois ' + KIND + '.');
    var fu = [];
    if (full.length === 1) { fu.push(KIND === 'CRAS' ? 'Qual o CREAS do bairro ' + hits[0].items[0].label + '?' : 'Qual o CRAS do bairro ' + hits[0].items[0].label + '?'); fu.push('Quais outros bairros o ' + full[0].name + ' atende?'); fu.push('Qual o telefone?'); }
    return { reply: lines.join('\n'), mood: 'success', followups: fu.slice(0, 3), badge: 'Território', units: full.slice(0, 5), unitsAll: full };
  }

  // ---------------------------------------------------------------------
  // Plano: decide quem responde
  //   devolve { kind:'crisis'|'directory'|'concept'|'none', result?, dir?, con? }
  // ---------------------------------------------------------------------
  function plan(text, opts) {
    opts = opts || {};
    var c = crisis(text);
    if (c) return { kind: 'crisis', result: withCrisisUnits(c) };
    // "qual CRAS atende o bairro X?": responde pela lista de cobertura das fichas
    var terr = territory(text);
    if (terr) return { kind: 'directory', result: terr, dir: { units: terr.units || [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    var dir = directory(text, session, opts.tabCat);
    var con = glossaryScore(text);
    var out = { kind: 'none', dir: dir, con: con };
    // pergunta de contato sobre unidade(s) encontradas, ou nome bem identificado: o diretório responde
    if (dir.units.length && ((dir.contact && dir.confidence >= 0.3) || dir.confidence >= 0.85)) {
      if (!(con.score >= 6 && dir.confidence < 0.9)) {
        out.kind = 'directory';
        out.result = withUnits(composeDirectory(dir, session), dir);
        return out;
      }
    }
    if (con.score >= 3) {
      out.kind = 'concept';
      out.result = composeGlossary(con.entry);
      // quando o assunto também é nome de unidade (CRAS, CAPS...), oferece a lista
      if (dir.units.length && dir.confidence >= 0.45 && !dir.follow) {
        var tot = dir.total || dir.units.length;
        out.result.quickActions = (out.result.quickActions || []).filter(function (a) { return a.search === undefined; })
          .concat([{ label: 'Ver ' + tot + (tot === 1 ? ' unidade' : ' unidades'), search: String(text).replace(/^(o que (e|é)|como funciona|para que serve)\s+/i, '').replace(/[?!.]+$/, '').trim() }]);
      }
      return out;
    }
    // sem conceito: lista aproximada do diretório (a aplicação decide se usa)
    if (dir.units.length && dir.confidence >= 0.45) {
      out.kind = 'directory-weak';
      out.result = withUnits(composeDirectory(dir, session), dir);
    }
    return out;
  }
  function withUnits(result, dir) { result.units = dir.units.slice(0, 5); result.unitsAll = dir.units; return result; }
  function withCrisisUnits(r) {
    try {
      var d = directory('CAPS AD III', { units: [] }, null);
      var caps = d.units.filter(function (u) { return /24|AD III/i.test(u.name + u.hours); }).slice(0, 1);
      var up = directory('UPA pronto atendimento', { units: [] }, null).units.slice(0, 1);
      var all = caps.concat(up);
      if (all.length) r.units = all;
    } catch (e) { /* sem fichas: segue só com o texto */ }
    return r;
  }

  // ---------------------------------------------------------------------
  function init(opts) {
    opts = opts || {};
    data = Array.isArray(opts.data) ? opts.data : [];
    index = null; vocab = null; expCache = {}; gloIndex = null; phoneIdx = null; terrIdx = null; terrAll = null;
    if (opts.ia) for (var k in opts.ia) if (Object.prototype.hasOwnProperty.call(CFG, k)) CFG[k] = opts.ia[k];
  }

  return {
    init: init, norm: norm, piiBlock: piiBlock, crisis: crisis, plan: plan,
    directory: function (t, tabCat) { return directory(t, session, tabCat); },
    glossary: glossaryScore, compose: { directory: composeDirectory, glossary: composeGlossary },
    remember: remember, reset: reset, session: session,
    aiOn: aiOn, aiGate: aiGate, buildPayload: buildPayload, streamAI: streamAI,
    verifyPhones: verifyPhones, panorama: panorama, isAmpla: isAmpla, cleanAI: cleanAI, mentionedUnits: mentionedUnits, telHref: telHref, slim: slim,
    config: CFG, emergencia: EMERGENCIA, glossarioLista: GLOSSARIO
  };
});

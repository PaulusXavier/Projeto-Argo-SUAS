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
 *   2b. CID-11: pergunta por código (6A02) ou por nome ("CID de ansiedade") e responde
 *      direto da tabela do Capítulo 06 (assets/cid11.json), sem IA e sem internet.
 *   2c. Base do psicólogo no SUAS: respostas curadas, com a norma citada (documentos do CFP,
 *      sigilo, demandas do Sistema de Justiça, comunicação de violência, limites do papel).
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
 * e até 10 fichas do diretório público. A conversa vive só na memória da página.
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
    interpretaMs: 6000,     // espera máxima pela interpretação da pergunta (passa direto se demorar)
    firstByteMs: 20000,     // espera máxima pela primeira resposta
    idleMs: 15000,          // silêncio máximo entre pedaços do streaming
    maxPergunta: 1200,
    maxHistorico: 10,       // últimas mensagens (5 trocas) que vão inteiras à IA; as perguntas mais antigas vão como resumo (ver historicoParaIA)
    maxContexto: 7,         // fichas do diretório enviadas à IA (pergunta comum)
    maxContextoAmplo: 10,   // idem, para perguntas de panorama ("quantos", "todos", "liste"...)
    minGapMs: 1200,         // intervalo mínimo entre perguntas à IA
    porMinuto: 8            // limite local (o Worker também limita)
  };

  var data = [];
  var index = null;
  var vocab = null;         // { palavra: df }
  var bairros = [];
  var censoSuas = [];

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
  var RE_NOME = new RegExp('\\b([Nn]ome|[Cc]hama|[Cc]hamada|[Cc]hamado|[Ss]obrenome)\\b[^.?!\\n]{0,25}\\b[' + CAP + '][' + MIN + ']+\\s+[' + CAP + '][' + MIN + ']+');
  var RE_TRAT = new RegExp('\\b([Dd]ona|[Dd]na|[Ss]r|[Ss]ra|[Ss]eu|[Ss]enhor|[Ss]enhora)\\.?\\s+[' + CAP + '][' + MIN + ']{2,}\\s+[' + CAP + '][' + MIN + ']{2,}');
  function piiBlock(texto) {
    var t = String(texto || '');
    if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(t)) return AVISO_PII;
    var seq = t.match(/\d[\d.\-\/\s]{6,}\d/g) || [];
    if (seq.some(function (s) { return s.replace(/\D/g, '').length >= 9; })) return AVISO_PII;
    if (RE_NOME.test(t) || RE_TRAT.test(t)) return AVISO_PII;
    if (/\b(mora|moram|moradora?|reside|residente|endere[cç]o)\b[^.?!\n]{0,40}\b(rua|av\.?|avenida|travessa|tv\.?|quadra|lote)\b[^.?!\n]{0,40}\d+/i.test(t)) return AVISO_PII;
    // documento rotulado, mesmo curto: "RG 1234567", "CPF: 12345678"
    if (/\b(rg|cpf|nis|nit|pis|cnh|titulo de eleitor|cartao|matricula|prontuario)\b[^\d\n]{0,15}\d[\d.\-\/\s]{4,}\d/i.test(norm(t))) return AVISO_PII;
    // mesmo filtro do Paulus/Worker (nome depois de "paciente", "mãe"..., com lista de nomes de programas)
    if (typeof Paulus !== 'undefined' && Paulus.temDadoPessoal && Paulus.temDadoPessoal(t)) return AVISO_PII;
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
    'favorito favoritos recente recentes anotacao anotacoes tema escuro instalar offline senha login atalho atalhos teclado perto proximo proxima').split(' '));
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
      res.units.slice(0, 5).forEach(function (x) { var b = bairroBruto(x.address); lines.push('- **' + (x.name || '') + '**' + (b ? ' · ' + b : '')); });
      mood = res.confidence >= 0.45 ? 'success' : 'notfound';
      if (res.confidence < 0.45) lines[0] = 'Não achei uma unidade com esse nome, mas estas são as mais próximas do que você pediu. Se não for isso, tente o nome completo ou o bairro.';
    }
    return { reply: lines.join('\n'), mood: mood, followups: followups.slice(0, 3), badge: 'Diretório' };
  }

  // ---------------------------------------------------------------------
  // Base SUAS (glossário offline)
  // ---------------------------------------------------------------------
  var GLOSSARIO = [
    { id: 'suas', keys: ['o que e o suas', 'o que e suas', 'o que significa suas', 'sistema unico de assistencia social', 'como funciona o suas'],
      text: 'O **SUAS** (Sistema Único de Assistência Social) organiza, em todo o país, os serviços, programas, projetos e benefícios da assistência social, com gestão compartilhada entre União, estados, Distrito Federal e municípios.\n- **Proteção Social Básica** (prevenção): **CRAS**, PAIF e SCFV.\n- **Proteção Social Especial**: média complexidade (**CREAS**, PAEFI) e alta complexidade (acolhimento institucional, abrigos).\n- Funções: proteção social, **vigilância socioassistencial** e defesa de direitos; a participação é feita por conselhos e conferências.\nEm Boa Vista, a rede está no diretório do Argo: pergunte "panorama da assistência social".',
      base: 'LOAS (Lei 8.742/1993, alterada pela Lei 12.435/2011) e Tipificação Nacional (Res. CNAS 109/2009).',
      actions: [{ label: 'Ver CRAS e CREAS', cat: 'social' }], follow: ['Panorama da assistência social', 'Qual a diferença entre CRAS e CREAS?'] },
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
      text: 'O **Cadastro Único** identifica famílias de baixa renda: renda mensal de até **1/2 salário mínimo por pessoa**. Famílias com renda maior também podem se cadastrar quando algum programa ou serviço exigir. É a porta de entrada para mais de 40 programas (Bolsa Família, BPC, Tarifa Social, Pé-de-Meia, Gás do Povo e outros), cada um com a sua própria regra de renda.\n- Cadastro gratuito e presencial, no CRAS ou posto de atendimento, pelo(a) **responsável familiar** (16 anos ou mais, de preferência mulher). Leva o **CPF de todas as pessoas** da família e o comprovante de endereço (de preferência a conta de luz; na falta dela, declaração de residência assinada). Título de eleitor, certidões, RG e carteira de trabalho são facultativos.\n- Quem mora sozinho pode se cadastrar; para Bolsa Família e BPC, o cadastro costuma exigir entrevista no domicílio.\n- Deve ser atualizado **a cada 2 anos** ou quando algo mudar (endereço, renda, composição da família).',
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
      text: 'A **RAPS** organiza o cuidado em saúde mental e em álcool e outras drogas no SUS, em liberdade e no território.\n**Em geral (norma nacional):**\n- **Atenção básica:** UBS e Consultório na Rua.\n- **Atenção psicossocial:** CAPS (I, II, III, AD, AD III, AD IV e infantojuvenil).\n- **Urgência:** SAMU 192, UPA, pronto-socorro e leito de saúde mental em hospital geral.\n- **Acolhimento transitório:** Unidade de Acolhimento.\nA internação é recurso excepcional, depois de esgotadas as alternativas em meio aberto.\n**Em Boa Vista:**\n- **CAPS II, CAPS III e CAPS AD III** (os dois últimos são estaduais), além das **UBS** com acolhimento em saúde mental e do **Consultório de Rua**.\n- **Urgência:** SAMU 192 e **HGRR** (urgência psiquiátrica 24h). **Não há UPA em funcionamento** (a primeira foi autorizada em dez/2024).\n- **Acolhimento transitório:** UAA. Não há CAPS infantil.',
      base: 'Lei 10.216/2001 e Portaria 3.088/2011 (consolidada na Portaria de Consolidação nº 3/2017).',
      actions: [{ label: 'Abrir Saúde (RAPS)', cat: 'saude' }], follow: ['O que é o CAPS?', 'Quais os telefones de emergência?'] },
    { id: 'caps', keys: ['caps', 'centro de atencao psicossocial'],
      text: 'O **CAPS** é serviço aberto e comunitário da RAPS, para pessoas com sofrimento psíquico intenso, grave e persistente, ou com necessidades decorrentes do uso de álcool e outras drogas.\n**Em geral (norma nacional):**\n- **CAPS I/II/III:** transtornos mentais, todas as faixas etárias (o III funciona 24h).\n- **CAPS AD / AD III:** álcool e drogas (o AD III funciona 24h).\n- **CAPS i:** crianças e adolescentes.\n**Em Boa Vista:**\n- Há **CAPS II**, **CAPS III** e **CAPS AD III**; o III e o AD III são **estaduais**.\n- **Não há CAPS infantil:** o CAPS II atende crianças a partir de 4 anos.\n- Horário e endereço de cada unidade: veja a ficha.\nO acesso pode ser direto ou por encaminhamento. Diga o bairro ou o nome que eu mostro a unidade.',
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
  // Base do psicólogo no SUAS (respostas curadas, offline, com a norma citada)
  //
  // Cada verbete responde UMA dúvida prática e diz de onde vem. Só entra aqui o que foi
  // conferido em texto oficial (CFP, CNAS, leis). Onde a norma não diz algo, o verbete
  // também não diz. Para acrescentar: copie um verbete, troque id/keys/text/base e
  // atualize PSI_REV. "keys" aceitam frases (com ou sem acento) e "a+b" (as duas palavras).
  // Não substitui orientação do CRP, da coordenação ou da assessoria jurídica.
  // ---------------------------------------------------------------------
  var PSI_REV = 'out/2026';
  var PSI_BASE = [
    // ---- Papel e limites ----
    { id: 'psi-psicoterapia', cat: 'Papel e limites',
      keys: ['psicoterapia no suas', 'psicoterapia no cras', 'psicoterapia no creas', 'terapia no cras', 'terapia no creas', 'terapia no suas', 'atendimento clinico no suas', 'atendimento clinico no cras', 'atendimento clinico no creas', 'atendimento psicoterapico', 'posso fazer psicoterapia', 'fazer terapia com o usuario', 'clinica no suas'],
      text: 'No SUAS o foco é **psicossocial**, não psicoterápico.\n- **CRAS:** compreender os processos subjetivos ligados à vulnerabilidade, prevenir rupturas de vínculos familiares e comunitários, favorecer a autonomia e encaminhar à saúde quando for preciso. Evite patologizar ou categorizar os usuários.\n- **CREAS:** atuação psicossocial; o sofrimento psíquico é lido a partir dos contextos de vulnerabilidade e violência vividos. Os casos que exigem **psicoterapia** vão para a rede de saúde (UBS, CAPS).\n- Psicoterapia é modalidade da política de Saúde.',
      base: 'Referências Técnicas do CREPOP/CFP para atuação no CRAS e no CREAS (2013), a partir de orientações do MDS.',
      actions: [{ label: 'Ver UBS', search: 'UBS' }, { label: 'Ver CAPS', search: 'CAPS' }], follow: ['Quando encaminhar para a saúde?', 'O que o psicólogo faz no SUAS?'] },

    { id: 'psi-obrigatorio', cat: 'Papel e limites',
      keys: ['psicologo obrigatorio', 'psicologo e obrigatorio', 'psicologa obrigatoria', 'equipe de referencia', 'equipe minima', 'quantos psicologos', 'nob rh', 'nob rh suas', 'composicao da equipe', 'categorias profissionais do suas'],
      text: 'Pela **Resolução CNAS 17/2011**, que ratifica a equipe de referência da NOB-RH/SUAS, o **psicólogo é categoria obrigatória**:\n- **Proteção Social Básica (CRAS):** assistente social e psicólogo.\n- **Proteção Especial de média complexidade (CREAS):** assistente social, psicólogo e advogado.\n- **Proteção Especial de alta complexidade:** assistente social e psicólogo.\n**CRAS, por famílias referenciadas (NOB-RH/SUAS, 2006):** até 2.500 = 2 técnicos de nível superior; até 3.500 = 3; a cada 5.000 = 4 (dois assistentes sociais, um psicólogo e um profissional de outra categoria do SUAS). Confira a versão vigente da NOB-RH antes de usar o número em ofício ou pedido de contratação.',
      base: 'Res. CNAS 17/2011, art. 1º, parágrafo único; NOB-RH/SUAS (Res. CNAS 269/2006).',
      actions: [], follow: ['O que o psicólogo faz no SUAS?'] },

    { id: 'psi-funcao', cat: 'Papel e limites',
      keys: ['funcao privativa', 'atribuicao privativa', 'atribuicoes do psicologo no suas', 'o que o psicologo faz no suas', 'o que faz o psicologo no cras', 'o que faz o psicologo no creas', 'papel do psicologo no suas', 'papel do psicologo no cras', 'atuacao do psicologo no suas', 'atuacao do psicologo no cras'],
      text: 'No SUAS **não há função privativa** de uma categoria: as atividades da equipe de referência são compartilhadas, e cada profissional contribui com o seu saber (o mesmo vale para os benefícios eventuais).\nPara a Psicologia, as referências do CREPOP/CFP indicam atuação **psicossocial e não clínica**, com foco em vínculos, autonomia e território. Você mantém a **autonomia** para escolher o referencial teórico, técnico e metodológico, dentro da ciência psicológica, da ética e da legislação profissional.',
      base: 'Cartilha SUAS do CRP-MG (CRP 04) com base nas Orientações Técnicas do MDS; Referências Técnicas do CREPOP/CFP; Nota Técnica CFP 02/2023.',
      actions: [], follow: ['Posso fazer psicoterapia no SUAS?', 'Quais documentos posso emitir?'] },

    { id: 'psi-autonomia', cat: 'Papel e limites',
      keys: ['autonomia tecnica', 'autonomia profissional', 'desvio de funcao', 'a chefia pediu', 'a coordenacao pediu', 'o gestor mandou', 'a secretaria exige', 'pedido da coordenacao', 'pressao da gestao'],
      text: 'A **autonomia técnica** é protegida: a Nota Técnica CFP 02/2023 orienta preservar a liberdade para definir o referencial teórico, técnico e metodológico e as condições técnicas e éticas do trabalho.\nSe uma solicitação (da gestão, de outro órgão ou da Justiça) extrapola as atribuições do cargo ou do serviço, **informe por escrito** quais são essas atribuições e os limites que elas impõem à resposta, e encaminhe a demanda a quem couber.\nEm dúvida ética, procure a **Comissão de Orientação e Fiscalização do seu CRP**.',
      base: 'Nota Técnica CFP 02/2023 (seção de recomendações); Código de Ética Profissional (Res. CFP 10/2005).',
      actions: [], follow: ['E se o juiz pedir um relatório?'] },

    // ---- Documentos ----
    { id: 'psi-documentos', cat: 'Documentos',
      keys: ['quais documentos', 'que documentos posso emitir', 'documentos que o psicologo pode emitir', 'tipos de documento psicologico', 'tipos de documentos psicologicos', 'modalidades de documento', 'resolucao 06 2019', 'resolucao 6 2019', 'resolucao cfp 6 2019', 'resolucao cfp 06 2019', 'documentos escritos do psicologo', 'documentos psicologicos'],
      text: 'A **Resolução CFP 06/2019** prevê seis modalidades de documento escrito:\n- **Declaração:** comparecimento, acompanhamento e tempo/dias/horários. Sem sintomas nem estados psicológicos.\n- **Atestado psicológico:** certifica situação, estado ou funcionamento psicológico, com base em avaliação psicológica.\n- **Relatório psicológico:** descreve e detalha a atuação profissional; pode trazer orientações e encaminhamentos, mas **não tem finalidade de diagnóstico**.\n- **Relatório multiprofissional:** resulta de atuação em equipe, com profissionais de outras áreas.\n- **Laudo psicológico:** resulta de um processo de avaliação psicológica e subsidia decisões ligadas à demanda.\n- **Parecer psicológico:** análise técnica escrita que responde a uma questão ou a documentos questionados; não resulta de avaliação nem de intervenção.',
      base: 'Res. CFP 06/2019, arts. 8º a 14 (vigente; Manual Orientativo do CFP, nov/2025).',
      actions: [], follow: ['Qual a diferença entre relatório e laudo?', 'Quanto tempo guardar os documentos?'] },

    { id: 'psi-relatorio-laudo', cat: 'Documentos',
      keys: ['laudo+relatorio', 'laudo+parecer', 'relatorio+parecer', 'diferenca entre relatorio e laudo', 'diferenca entre laudo e relatorio', 'diferenca entre laudo e parecer', 'relatorio psicologico ou laudo', 'laudo ou relatorio', 'o que e laudo psicologico', 'o que e um laudo', 'o que e relatorio psicologico', 'o que e parecer psicologico', 'quando fazer laudo'],
      text: 'Pela Resolução CFP 06/2019:\n- **Relatório psicológico:** descreve e detalha a **sua atuação** (o que foi feito, com condicionantes históricos e sociais), podendo trazer orientações, recomendações e encaminhamentos. **Não visa diagnóstico.** É o documento típico do trabalho no SUAS.\n- **Laudo psicológico:** vem de um **processo de avaliação psicológica** e subsidia decisões da demanda. Exige avaliação formal, o que costuma estar fora das atribuições do serviço socioassistencial.\n- **Parecer psicológico:** análise técnica que responde a uma questão-problema ou a documentos já produzidos; não resulta de avaliação nem de intervenção.\nPara o Sistema de Justiça, a Nota Técnica CFP 02/2023 orienta **não elaborar laudo com afirmações categóricas ou conclusões definitivas**.',
      base: 'Res. CFP 06/2019, arts. 11, 13 e 14; Nota Técnica CFP 02/2023.',
      actions: [], follow: ['Quais documentos posso emitir?', 'E se o juiz pedir um laudo?'] },

    { id: 'psi-multi', cat: 'Documentos',
      keys: ['relatorio multiprofissional', 'relatorio em conjunto', 'relatorio conjunto', 'relatorio com a assistente social', 'relatorio com o assistente social', 'relatorio da equipe', 'relatorio em equipe', 'relatorio tecnico em conjunto'],
      text: 'O **relatório multiprofissional** resulta do trabalho em equipe e pode ser assinado em conjunto com profissionais de outras áreas (Res. CFP 06/2019, art. 12). Estrutura mínima:\n1. **Identificação:** título, pessoa ou instituição atendida, solicitante, finalidade e autores com categoria e registro.\n2. **Descrição da demanda:** o que motivou o trabalho, quem informou e o que levou à solicitação.\n3. **Procedimento:** raciocínio técnico-científico e procedimentos; os **privativos da Psicologia ficam separados** dos demais.\n4. **Análise:** cada profissional analisa **em separado**, com subtítulo (nome e categoria).\n5. **Conclusão:** pode ser conjunta; fecha com local, data, carimbo, rubrica das páginas e assinatura na última.\nColoque só o necessário à finalidade (Código de Ética, art. 12).',
      base: 'Res. CFP 06/2019, art. 12; Código de Ética Profissional, art. 12.',
      actions: [], follow: ['Quanto tempo guardar os documentos?'] },

    { id: 'psi-declaracao', cat: 'Documentos',
      keys: ['declaracao de comparecimento', 'declaracao psicologica', 'o que pode constar na declaracao', 'declaracao de acompanhamento', 'declaracao para o trabalho', 'declaracao para a escola'],
      text: 'A **declaração** é objetiva e sucinta: registra **comparecimento, acompanhamento** (em curso ou realizado) e **tempo, dias e horários**.\n**Não pode** registrar sintomas, situações ou estados psicológicos. Se a pessoa precisa de um documento que diga algo sobre o estado psicológico, a modalidade é outra (atestado ou relatório), e cada uma tem requisitos próprios.',
      base: 'Res. CFP 06/2019, art. 9º e § 1º.',
      actions: [], follow: ['Quais documentos posso emitir?'] },

    { id: 'psi-atestado', cat: 'Documentos',
      keys: ['atestado psicologico', 'atestado de saude mental', 'posso dar atestado', 'atestado para afastamento', 'atestado para o trabalho', 'dar atestado ao usuario', 'emitir atestado'],
      text: 'O **atestado psicológico** certifica uma situação, estado ou funcionamento psicológico **com base em avaliação psicológica**; pode justificar faltas, aptidão para atividades e afastamentos (Res. CFP 06/2019, art. 10).\nO CRP pode pedir, em até cinco anos, a **fundamentação técnico-científica** do atestado, então ela precisa estar no registro documental.\nNo SUAS, avalie antes se o serviço e o cargo comportam avaliação psicológica; a Nota Técnica CFP 02/2023 lembra que as atribuições do serviço limitam a resposta. Quando só for preciso comprovar presença, use a **declaração**.',
      base: 'Res. CFP 06/2019, art. 10 e §§ 2º a 4º; Nota Técnica CFP 02/2023.',
      actions: [], follow: ['O que pode constar na declaração?'] },

    { id: 'psi-guarda', cat: 'Documentos',
      keys: ['prazo de guarda', 'quanto tempo guardar', 'guardar prontuario', 'guarda de documentos', 'guarda dos documentos', 'arquivar prontuario', 'por quanto tempo guardar', 'tempo de guarda', 'guarda do registro', 'prazo do prontuario'],
      text: 'A guarda mínima é de **5 anos**, em meio físico ou digital, incluindo o material que fundamentou os documentos (Res. CFP 06/2019, art. 15). O prazo conta a partir do último registro e pode ser **ampliado** por lei, ordem judicial ou circunstância específica. A responsabilidade é sua **e da instituição**.\n- **Crianças e adolescentes:** o Manual Orientativo do CFP (nov/2025) recomenda **não usar os 5 anos como parâmetro**: preserve as informações até a maioridade e observe os prazos legais aplicáveis.\n- **Prontuário em saúde** (psicológico ou multiprofissional): até 20 anos (Lei 13.787/2018).\nSe o seu trabalho acaba (exoneração, fim do contrato, extinção do serviço), a Res. 06/2019 (art. 15, § 3º) trata do destino dos documentos.',
      base: 'Res. CFP 06/2019, art. 15; Res. CFP 01/2009, art. 4º; Manual Orientativo de Registro e Elaboração de Documentos Psicológicos (CFP, nov/2025).',
      actions: [], follow: ['O que registrar no atendimento?'] },

    { id: 'psi-registro', cat: 'Documentos',
      keys: ['o que registrar', 'registro documental', 'como registrar o atendimento', 'como registrar atendimento', 'o que deve constar no registro', 'prontuario do psicologo', 'prontuario psicologico', 'prontuario suas', 'evolucao do atendimento', 'registro do atendimento'],
      text: 'O **registro documental** (Res. CFP 01/2009, art. 2º) reúne:\n- identificação do usuário ou da instituição;\n- **avaliação da demanda** e definição dos objetivos do trabalho;\n- **evolução do trabalho** e procedimentos técnico-científicos adotados;\n- registro de **encaminhamento ou encerramento**;\n- cópia dos documentos que você emitiu (data, finalidade e destinatário);\n- documentos de avaliação psicológica, em pasta de acesso exclusivo seu.\nEm equipe multiprofissional, o prontuário é **único**, com só as informações indispensáveis aos demais profissionais. O **Prontuário SUAS** é padronizado e preenchido por profissionais de nível superior do CRAS e do CREAS; a família tem direito de conhecer o conteúdo.',
      base: 'Res. CFP 01/2009 (alterada pela 05/2010); Manual Orientativo do CFP (nov/2025), seções 3.5 e 6.5.',
      actions: [], follow: ['Quanto tempo guardar os documentos?'] },

    { id: 'psi-entrega', cat: 'Documentos',
      keys: ['entregar relatorio', 'entregar o relatorio', 'entrega de documento', 'entrega do documento', 'entrevista devolutiva', 'quem pode receber o relatorio', 'protocolo de entrega', 'a familia pode pedir o relatorio', 'usuario pedir o relatorio', 'entregar o laudo'],
      text: 'A entrega do documento é feita **diretamente** à pessoa atendida, ao responsável legal ou ao solicitante, de preferência em **entrevista devolutiva**, com **protocolo de entrega assinado**: quem recebe assume a responsabilidade pelo uso e pelo sigilo.\nOs envolvidos têm direito de receber informações sobre o serviço e de acessar o documento. Documento para outro órgão deve trazer só o necessário à finalidade e pode levar a cláusula de caráter sigiloso e uso restrito.',
      base: 'Res. CFP 06/2019, arts. 4º, § 4º, e 16, § 1º.',
      actions: [], follow: ['Posso quebrar o sigilo?'] },

    // ---- Sigilo ----
    { id: 'psi-sigilo-quebra', cat: 'Sigilo',
      keys: ['quebra de sigilo', 'quebrar sigilo', 'quebrar o sigilo', 'posso quebrar o sigilo', 'limites do sigilo', 'excecao ao sigilo', 'excecoes ao sigilo', 'quando posso revelar', 'revelar informacao do atendimento', 'sigilo profissional do psicologo', 'artigo 10 do codigo de etica'],
      text: 'No **Código de Ética do Psicólogo (Res. CFP 10/2005)**:\n- **Art. 9º:** o sigilo protege a intimidade das pessoas, grupos ou organizações atendidos.\n- **Art. 10:** nos casos **previstos em lei** (como a comunicação de violência contra criança ao Conselho Tutelar) o dever legal se cumpre. Fora deles, havendo conflito com os princípios fundamentais do Código, você **pode decidir pela quebra**, baseando a decisão na busca do **menor prejuízo**.\n- **Parágrafo único:** na quebra, restrinja-se às informações **estritamente necessárias**.\nDecida com calma, registre a justificativa e, havendo dúvida, consulte a Comissão de Orientação e Fiscalização do CRP.',
      base: 'Código de Ética Profissional do Psicólogo (Res. CFP 10/2005), arts. 9º e 10.',
      actions: [], follow: ['Preciso comunicar violência ao Conselho Tutelar?', 'Posso compartilhar com a rede?'] },

    { id: 'psi-sigilo-crianca', cat: 'Sigilo',
      keys: ['informar os pais', 'pais querem saber', 'o pai quer saber', 'a mae quer saber', 'responsaveis querem saber', 'sigilo com crianca', 'sigilo com adolescente', 'sigilo de crianca', 'sigilo de adolescente', 'o que dizer aos pais', 'pai pediu relatorio do filho', 'mae pediu relatorio do filho', 'pais pedem relatorio'],
      text: 'No atendimento de **criança, adolescente ou interdito**, aos responsáveis deve ser comunicado **apenas o essencial** para que se promovam medidas em benefício de quem foi atendido (Código de Ética, art. 13).\nIsso vale para o relatório pedido pelos pais: entregue o que for necessário à proteção e ao cuidado, sem repassar o conteúdo íntimo da escuta. Boa prática: combine o que será dito com a própria criança ou adolescente, sempre que possível, e registre. Se o próprio responsável é suspeito de violência, a comunicação segue o fluxo de proteção (Conselho Tutelar), não o pedido dele.',
      base: 'Código de Ética Profissional do Psicólogo (Res. CFP 10/2005), art. 13; Lei 13.431/2017.',
      actions: [], follow: ['Preciso comunicar violência ao Conselho Tutelar?'] },

    { id: 'psi-sigilo-rede', cat: 'Sigilo',
      keys: ['compartilhar com a rede', 'compartilhar informacao', 'compartilhar informacoes', 'passar informacao para outro servico', 'passar informacoes para a rede', 'sigilo na equipe', 'sigilo em equipe', 'sigilo na equipe multiprofissional', 'discussao de caso', 'estudo de caso', 'reuniao de rede', 'informacao para a escola', 'informacao para a ubs'],
      text: 'Com profissionais de outras áreas e com a rede:\n- **Compartilhe só o relevante** para qualificar o serviço, resguardando o caráter confidencial e **assinalando a responsabilidade de quem recebe** de preservar o sigilo (Código de Ética, art. 6º).\n- Nos registros de equipe multiprofissional, **só o necessário** para os objetivos do trabalho (art. 12).\n- Demandas fora do seu campo vão a quem seja habilitado para elas.\nBoa prática: contato prévio com o serviço, ficha objetiva (motivo, o que foi feito, o que se espera) e contrarreferência combinada.',
      base: 'Código de Ética Profissional do Psicólogo (Res. CFP 10/2005), arts. 6º e 12.',
      actions: [], follow: ['Como encaminhar com responsabilidade?'] },

    // ---- Sistema de Justiça ----
    { id: 'psi-oficio', cat: 'Sistema de Justiça',
      keys: ['oficio do juiz', 'oficio da promotoria', 'oficio judicial', 'oficio do ministerio publico', 'requisicao judicial', 'requisicao do ministerio publico', 'juiz pediu relatorio', 'juiz pediu um relatorio', 'juiz pedir um relatorio', 'juiz pedir relatorio', 'juiz pede relatorio', 'o juiz quer um relatorio', 'juiz quer relatorio', 'promotor pediu relatorio', 'ministerio publico pediu relatorio', 'vara da infancia pediu', 'pedido da justica', 'demanda do sistema de justica', 'demandas do sistema de justica', 'nota tecnica 02 2023', 'nota tecnica cfp 02 2023', 'justica pediu relatorio', 'defensoria pediu relatorio', 'recebi um oficio'],
      text: 'Para ofícios e requisições do Sistema de Justiça, a **Nota Técnica CFP 02/2023** orienta:\n- **Responda** quando a requisição vier da autoridade competente, a partir do seu campo de atuação.\n- **Avalie a demanda** pelo Código de Ética e **informe as atribuições** do serviço e do cargo, que limitam a resposta.\n- Se ainda **não há registro** sobre a família, busque primeiro a articulação com a rede.\n- **Você escolhe o documento técnico** (Res. CFP 06/2019), geralmente relatório. Informe o acompanhamento **sem julgamentos, diagnósticos, perícia, investigação de fatos ou medidas de responsabilização**.\n- **Converse com a família** sobre o pedido e sobre o que será informado.\n- Prazo curto: **peça mais prazo, com justificativa**.\n- Não cabe **assessorar a autoridade**: limite-se ao estritamente necessário.\nEm dúvida, procure o CRP ou o jurídico do órgão.',
      base: 'Nota Técnica CFP 02/2023 (seção de recomendações); Res. CFP 06/2019; Código de Ética Profissional.',
      actions: [], follow: ['E se pedirem um laudo ou perícia?', 'Fui intimado para audiência'] },

    { id: 'psi-pericia', cat: 'Sistema de Justiça',
      keys: ['pericia', 'perito', 'perita', 'nomeacao como perito', 'nomeada perita', 'nomeado perito', 'fazer pericia no suas', 'laudo pericial', 'laudo para a justica', 'juiz pediu laudo', 'juiz quer laudo', 'juiz pediu um laudo', 'o juiz quer um laudo', 'juiz pedir um laudo', 'juiz pedir laudo', 'juiz pede laudo', 'pedirem um laudo', 'pedirem pericia', 'pedirem um laudo ou pericia', 'pedido de laudo', 'avaliacao psicologica de usuario', 'avaliacao psicologica da familia', 'estudo psicologico para a justica'],
      text: 'Segundo a **Nota Técnica CFP 02/2023**:\n- **Não aceite nomeação como perito(a)** de pessoas ou famílias acompanhadas pelo serviço público em que você atua.\n- **Não elabore laudo com afirmações categóricas ou conclusões definitivas.**\n- A escuta no SUAS (e no SUS) tem **caráter protetivo**: não é prova pericial, nem serve para apurar fatos ou punir famílias.\nLaudos e avaliações que extrapolam o SUAS cabem a peritos e às equipes multiprofissionais do próprio Sistema de Justiça. Responda ao juízo informando o acompanhamento no serviço e justificando por escrito os limites técnicos e éticos.',
      base: 'Nota Técnica CFP 02/2023; Cartilha SUAS do CRP-MG (CONPAS/CFP, Demandas do Sistema de Justiça).',
      actions: [], follow: ['E se o juiz pedir um relatório?'] },

    { id: 'psi-inquirir', cat: 'Sistema de Justiça',
      keys: ['ouvir a vitima', 'inquirir crianca', 'inquirir a crianca', 'oitiva', 'perguntar detalhes do abuso', 'entrevistar a crianca sobre a violencia', 'perguntar sobre o abuso', 'investigar a violencia', 'apurar a violencia', 'ouvir o acusado', 'tomar depoimento', 'colher depoimento', 'fazer perguntas a crianca sobre abuso', 'devo perguntar a crianca'],
      text: 'A **Nota Técnica CFP 02/2023** orienta **não realizar inquirição ou oitiva** de vítimas ou acusados para fins judiciais, e não investigar fatos: a escuta do SUAS é protetiva.\nNa Lei 13.431/2017, a **escuta especializada** é entrevista sobre a situação de violência na rede de proteção, com o relato **limitado ao estritamente necessário** à finalidade de proteção; a oitiva para produzir prova é o **depoimento especial**, feito perante a autoridade policial ou judicial.\nNa prática: acolha o que a criança trouxer, **sem insistir nem pedir detalhes**, registre com as palavras dela e faça a comunicação ao Conselho Tutelar.',
      base: 'Nota Técnica CFP 02/2023; Lei 13.431/2017, arts. 7º, 8º e 14, § 1º (intervenção mínima).',
      actions: [{ label: 'Ver Conselho Tutelar', cat: 'conselho' }], follow: ['Qual a diferença entre escuta especializada e depoimento especial?', 'Preciso comunicar violência ao Conselho Tutelar?'] },

    { id: 'psi-audiencia', cat: 'Sistema de Justiça',
      keys: ['audiencia', 'fui intimado', 'fui intimada', 'intimacao', 'intimada para audiencia', 'intimado para audiencia', 'depor em juizo', 'depoimento em juizo', 'sou testemunha', 'convocada para depor', 'convocado para depor'],
      text: 'Se você foi convocado(a) a **depor ou a comparecer a audiência**:\n- Você participa pela **posição institucional** que ocupa, **não como testemunha** em caráter individual (Nota Técnica CFP 02/2023).\n- Preste **apenas as informações estritamente necessárias** e observe o sigilo profissional.\n- O Código de Ética (art. 11) permite prestar informações em juízo, nos limites do capítulo do sigilo.\n- O Manual Orientativo do CFP orienta não se recusar a responder e **buscar orientação jurídica ou do CRP** antes.\nAvise a coordenação e, se puder, converse antes com a família sobre o que será dito.',
      base: 'Nota Técnica CFP 02/2023; Código de Ética Profissional, arts. 10 e 11; Manual Orientativo do CFP (nov/2025), seção 6.4.',
      actions: [], follow: ['E se o juiz pedir um relatório?'] },

    // ---- Violência contra criança e adolescente ----
    { id: 'psi-comunicar', cat: 'Violência',
      keys: ['dever de comunicar', 'sou obrigada a comunicar', 'sou obrigado a comunicar', 'obrigatoriedade de comunicar', 'preciso comunicar o conselho tutelar', 'tenho que comunicar o conselho tutelar', 'comunicar o conselho tutelar', 'comunicar violencia', 'comunicar a violencia', 'comunicacao de violencia e sigilo', 'sigilo e violencia contra crianca', 'violencia e sigilo', 'suspeita de violencia o que fazer', 'denunciar violencia e sigilo', 'preciso notificar'],
      text: 'Sim, é dever previsto em lei:\n- **ECA, art. 13:** casos de suspeita ou confirmação de castigo físico, tratamento cruel ou degradante e maus-tratos contra criança ou adolescente são **obrigatoriamente comunicados ao Conselho Tutelar**.\n- **Lei 13.431/2017, art. 13:** quem souber ou presenciar violência contra criança ou adolescente deve comunicar **imediatamente** ao serviço de denúncias (Disque 100), ao Conselho Tutelar ou à polícia, que informam o Ministério Público.\nA **suspeita basta**: não é preciso ter prova. Relate só o necessário à proteção (Código de Ética, art. 10, parágrafo único) e registre no prontuário o que foi comunicado, quando e a quem. Não conduza investigação.',
      base: 'ECA (Lei 8.069/1990), art. 13; Lei 13.431/2017, art. 13; Código de Ética Profissional, art. 10.',
      actions: [{ label: 'Ver Conselho Tutelar', cat: 'conselho' }, { label: 'Ver CREAS', cat: 'social' }], follow: ['Qual a diferença entre escuta especializada e depoimento especial?', 'Quais são os tipos de violência?'] },

    { id: 'psi-escuta-depoimento', cat: 'Violência',
      keys: ['escuta especializada', 'depoimento especial', 'diferenca entre escuta especializada e depoimento especial', 'escuta especializada ou depoimento especial', 'o que e escuta especializada', 'o que e depoimento especial'],
      text: 'Pela **Lei 13.431/2017**:\n- **Escuta especializada (art. 7º):** entrevista sobre a situação de violência com criança ou adolescente, feita **perante órgão da rede de proteção**, com o relato **limitado ao estritamente necessário** para a finalidade de proteção.\n- **Depoimento especial (art. 8º):** oitiva da criança ou adolescente, vítima ou testemunha, **perante autoridade policial ou judicial**; tramita em segredo de justiça.\nO objetivo de ambos é **evitar a revitimização**. O psicólogo do SUAS acolhe e protege; **não inquire** (Nota Técnica CFP 02/2023).',
      base: 'Lei 13.431/2017, arts. 7º, 8º e 12, § 6º; Nota Técnica CFP 02/2023.',
      actions: [], follow: ['Posso perguntar detalhes do abuso?', 'Preciso comunicar violência ao Conselho Tutelar?'] },

    { id: 'psi-tipos-violencia', cat: 'Violência',
      keys: ['tipos de violencia', 'formas de violencia', 'tipos de violencia contra crianca', 'violencia psicologica', 'violencia institucional', 'violencia patrimonial', 'alienacao parental', 'o que e violencia psicologica', 'o que e violencia institucional', 'o que e abuso sexual', 'exploracao sexual comercial'],
      text: 'A **Lei 13.431/2017 (art. 4º)** define as formas de violência contra criança e adolescente:\n- **Física:** ofende a integridade ou a saúde corporal ou causa sofrimento físico.\n- **Psicológica:** discriminação, depreciação, ameaça, humilhação, isolamento, bullying; **alienação parental**; e **exposição a crime violento** contra membro da família.\n- **Sexual:** abuso sexual, **exploração sexual comercial** e tráfico de pessoas para fim sexual.\n- **Institucional:** praticada por instituição pública ou conveniada, inclusive quando **revitimiza**.\n- **Patrimonial:** retenção, subtração ou destruição de documentos, bens, valores ou recursos econômicos da criança (acrescentada pela Lei 14.344/2022).',
      base: 'Lei 13.431/2017, art. 4º (inciso V pela Lei 14.344/2022).',
      actions: [], follow: ['Preciso comunicar violência ao Conselho Tutelar?'] },

    // ---- Encaminhamento ----
    { id: 'psi-encaminhar-saude', cat: 'Encaminhamento',
      keys: ['quando encaminhar para a saude', 'quando encaminhar para psicoterapia', 'quando encaminhar para o caps', 'quando encaminhar para a ubs', 'encaminhar para psicoterapia', 'encaminhar para atendimento clinico', 'encaminhar para a saude', 'caso para psicoterapia', 'quando o caso e do caps', 'caso grave encaminhar'],
      text: 'No SUAS o acompanhamento é psicossocial; o caso que **exige psicoterapia** vai para a **rede de saúde**.\n- **UBS:** porta de entrada do SUS e cuidado em saúde mental na atenção básica.\n- **CAPS:** sofrimento psíquico intenso, grave e persistente, ou necessidades decorrentes do uso de álcool e outras drogas (CAPS AD).\n- **Crise ou risco de vida:** SAMU 192 e urgência psiquiátrica; em Boa Vista, o CAPS III e o HGRR.\nFaça **contato prévio**, ficha objetiva, oriente a pessoa sobre local e documentos e combine a **contrarreferência**. O acompanhamento no SUAS **continua** com a família.',
      base: 'Referências Técnicas do CREPOP/CFP (CRAS e CREAS, 2013); Portaria de Consolidação nº 3/2017 (RAPS).',
      actions: [{ label: 'Ver UBS', search: 'UBS' }, { label: 'Ver CAPS', search: 'CAPS' }], follow: ['O que é a RAPS?', 'Como encaminhar com responsabilidade?'] },

    // ---- Trabalho no PAIF ----
    { id: 'psi-acompanhamento', cat: 'Trabalho no CRAS',
      keys: ['o que e acompanhamento familiar', 'acompanhamento familiar', 'acompanhamento familiar no paif', 'plano de acompanhamento familiar', 'como montar o plano de acompanhamento', 'objetivos do plano de acompanhamento', 'como fazer o paf', 'o que e o paf', 'quando iniciar acompanhamento familiar'],
      text: 'No PAIF, o **acompanhamento familiar** é um conjunto de intervenções **continuadas**, feitas a partir de **compromissos entre a família e os profissionais**, com objetivos definidos.\nSua peça central é o **Plano de Acompanhamento Familiar (PAF)**, construído **junto com a família**, com objetivos e mediações periódicas, para a superação gradual das vulnerabilidades e o fortalecimento de vínculos e da função protetiva da família.\nOs critérios de inclusão e a metodologia detalhada estão nas Orientações Técnicas do PAIF (MDS, 2012) e no protocolo do seu município; confira-os com a coordenação do CRAS.',
      base: 'Tipificação Nacional (Res. CNAS 109/2009); Orientações Técnicas sobre o PAIF (MDS, 2012).',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['O que é o PAIF?', 'Como é a visita domiciliar?'] },

    // ---- Orientação ----
    { id: 'psi-crp', cat: 'Orientação',
      keys: ['duvida etica', 'onde tirar duvida etica', 'comissao de orientacao e fiscalizacao', 'cof do crp', 'orientacao do crp', 'falar com o crp', 'crp 20', 'quem orienta o psicologo', 'consultar o crp', 'o crp pode orientar'],
      text: 'Para dúvida ética ou técnica sobre o seu trabalho, a via oficial é a **Comissão de Orientação e Fiscalização (COF) do seu CRP**: ela orienta os profissionais. Para parâmetros de atuação em políticas públicas, há ainda as **Referências Técnicas do CREPOP/CFP** (CRAS, CREAS, gestores, rede de atenção psicossocial, entre outras) e as notas técnicas do CFP.\nEste app traz respostas de apoio, **não substitui parecer ético, jurídico ou a orientação da sua coordenação**.',
      base: 'Sistema Conselhos de Psicologia (CFP e CRPs); CREPOP.',
      actions: [], follow: ['E se o juiz pedir um relatório?'] }
  ];
  var psiIndex = null;
  function psiScore(text) {
    if (!psiIndex) psiIndex = PSI_BASE.map(function (g) { return { g: g, keys: g.keys.map(function (k) { return k.indexOf('+') > -1 ? { all: k.split('+').map(norm) } : { phrase: norm(k) }; }) }; });
    var n = norm(text), padded = ' ' + n + ' ', tokens = n ? n.split(' ') : [];
    for (var i = 0; i < tokens.length; i++) if (APP_WORDS[tokens[i]]) return { score: 0 };
    var best = null, bestScore = 0;
    psiIndex.forEach(function (e) {
      var s = 0;
      e.keys.forEach(function (k) {
        if (k.all) { if (k.all.every(function (w) { return tokens.indexOf(w) > -1; })) s += 6; return; }
        if (padded.indexOf(' ' + k.phrase + ' ') > -1) s += k.phrase.indexOf(' ') > -1 ? 4 : 3;
      });
      if (s > bestScore) { best = e.g; bestScore = s; }
    });
    return { score: bestScore, entry: best };
  }
  function composePsi(entry) {
    return {
      reply: entry.text, mood: 'info', badge: 'Base do psicólogo no SUAS · ' + entry.cat,
      note: 'Base: ' + entry.base + ' Conferido em ' + PSI_REV + '; normas mudam, confirme a versão vigente.',
      quickActions: entry.actions || [], followups: (entry.follow || []).slice(0, 3), psiId: entry.id
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
        reply: '**Isto pede atenção imediata.**\n- Risco **imediato** (plano, meios ao alcance, tentativa em curso): ligue **192 (SAMU)** ou **193** e não deixe a pessoa sozinha.\n- Apoio emocional 24h, gratuito: **188 (CVV)**.\n- Cuidado continuado: CAPS de referência e urgência psiquiátrica 24h no HGRR (mostro as unidades abaixo).\n**Como abordar:** acolha sem julgar, pergunte diretamente sobre a ideia de morrer, avalie o risco e o acesso a meios, mobilize a rede de apoio e registre o encaminhamento.',
        mood: 'error', badge: 'Alerta', crisis: true,
        note: 'Este assistente não substitui avaliação clínica nem o serviço de urgência.',
        quickActions: [{ label: 'Ver CAPS', search: 'CAPS' }, { label: 'Ver urgência e hospitais', cat: 'hospitalar' }],
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
  // ctx = o que a conversa já firmou (unidade, bairro, município, assunto, intenção). Vai junto à IA e à interpretação,
  // para "e o horário?", "e lá?", "esse bairro" valerem mesmo quando o dado foi dito há muitas mensagens.
  var session = { history: [], units: [], aiTimes: [], lastAi: 0, terrUlt: null, munUlt: null, pendente: '', ctx: novoCtx(), aguardando: false, turno: 0, ultContato: null };
  function novoCtx() { return { unidade: '', bairro: '', municipio: '', assunto: '', intencao: '', t: {} }; }
  // O que a conversa firmou envelhece: depois de alguns turnos sem ser reafirmado, deixa de ir à IA (a pessoa pode ter mudado de caso).
  var VALIDADE = { unidade: 12, bairro: 12, municipio: 12, assunto: 8, intencao: 4 };
  function firmar(campo, valor) { if (valor) { session.ctx[campo] = valor; session.ctx.t[campo] = session.turno; } }
  function reset() { session.history = []; session.units = []; session.terrUlt = null; session.munUlt = null; session.pendente = ''; session.ctx = novoCtx(); session.aguardando = false; session.turno = 0; session.ultContato = null; }
  var MAX_HIST_LOCAL = 40;    // mensagens guardadas na página (só na memória; apagadas ao trancar o app)
  function campoCtx(v, max) {
    v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return v && v.length <= max && !piiBlock(v) && /^[A-Za-zÀ-ÿ0-9 .,'\-ºª\/()]*$/.test(v) ? v : '';
  }
  // Pergunta que carrega assunto: tem pelo menos 3 palavras e não é só "e o horário?" ou um cumprimento.
  function carregaAssunto(t) {
    var n = norm(t);
    return n.split(' ').length >= 3 && !/^(e|mas|entao|ou|agora)\b/.test(n) && !/^(oi|ola|bom dia|boa tarde|boa noite|obrigad\w+|valeu)\b/.test(n);
  }
  function atualizarCtx(userText, units) {
    var c = session.ctx, v;
    if (units && units.length === 1) firmar('unidade', campoCtx(units[0].name, 90));
    // município e bairro vêm do último território consultado; só firma o que mudou (senão um dado velho pareceria novo a cada turno)
    if (session.munUlt && session.munUlt.nome) { v = campoCtx(session.munUlt.nome, 90); if (v && v !== c.municipio) firmar('municipio', v); }
    if (session.terrUlt && session.terrUlt.ref && !(session.munUlt && session.terrUlt.ref === session.munUlt.nome)) { v = campoCtx(session.terrUlt.ref, 90); if (v && v !== c.bairro) firmar('bairro', v); }
    if (userText && carregaAssunto(userText) && !piiBlock(userText)) firmar('assunto', String(userText).replace(/\s+/g, ' ').trim().slice(0, 200));
  }
  // O que a interpretação da IA descobriu (bairro, unidade, tipo de pedido). O novo vale mais; vazio não apaga o antigo.
  function notar(i) {
    if (!i) return;
    firmar('bairro', campoCtx(i.bairro, 90));
    firmar('unidade', campoCtx(i.unidade, 90));
    if (i.intencao && i.intencao !== 'saudacao' && i.intencao !== 'outro') firmar('intencao', String(i.intencao).slice(0, 20));
  }
  function estadoParaIA() {
    var c = session.ctx, o = {};
    ['unidade', 'bairro', 'municipio', 'assunto', 'intencao'].forEach(function (k) {
      if (c[k] && session.turno - (c.t[k] || 0) <= VALIDADE[k]) o[k] = c[k];
    });
    return o;
  }
  // A conversa inteira conta: as últimas mensagens vão inteiras; as perguntas mais antigas vão só como pergunta (curtas),
  // e o Worker monta com elas o resumo "o que já foi perguntado". A janela começa sempre numa pergunta da pessoa.
  function historicoParaIA() {
    var h = session.history, inicio = Math.max(0, h.length - CFG.maxHistorico), antigas = [], i;
    while (inicio > 0 && h[inicio].papel !== 'usuario') inicio--;
    for (i = 0; i < inicio; i++) if (h[i].papel === 'usuario') antigas.push({ papel: 'usuario', texto: cut(h[i].texto, 160) });
    return antigas.slice(-12).concat(h.slice(inicio));
  }
  // Só vale perguntar de volta quando o dado falta de verdade: não está na mensagem, no estado nem na conversa, e o pedido
  // é do tipo que depende dele. Conceito, norma, CID, contagem e o resto se respondem com a premissa mais provável.
  // (Mesma regra de shared/conversa.mjs do Paulus; aqui para o mascote funcionar mesmo sem o Paulus carregado.)
  var PRECISA_DE = { territorio: 'bairro', ubs_psicologo: 'bairro', diretorio: 'unidade' };
  function deveEsclarecer(i) {
    if (!i || !i.esclarecer) return false;
    var falta = PRECISA_DE[i.intencao];
    if (!falta) return false;
    var c = estadoParaIA();
    if (falta === 'bairro' && (i.bairro || c.bairro)) return false;
    if (falta === 'unidade' && (i.unidade || c.unidade)) return false;
    var ult = null, k;
    for (k = session.history.length - 1; k >= 0; k--) if (session.history[k].papel === 'argo') { ult = session.history[k]; break; }
    if (ult) {
      var a = asSet(tok(ult.texto).filter(function (t) { return t.length > 2; })), b = tok(i.esclarecer).filter(function (t) { return t.length > 2; });
      var comuns = b.filter(function (t) { return a[t]; }).length;
      if (b.length && comuns / b.length >= 0.6) return false;   // acabou de perguntar isto
    }
    return true;
  }
  function remember(userText, botText, units) {
    userText = String(userText || '').trim();
    if (userText && !piiBlock(userText)) session.history.push({ papel: 'usuario', texto: userText.slice(0, CFG.maxPergunta) });
    botText = String(botText || '').replace(/\*\*/g, '').trim();
    if (botText) session.history.push({ papel: 'argo', texto: botText.slice(0, 1200) });
    while (session.history.length > MAX_HIST_LOCAL) session.history.shift();
    session.turno++;
    // lembra o último pedido de contato ("telefone", "onde fica"...) para o seguimento "e do Conselho Tutelar?"
    var mc = norm(userText).match(RE_CONTATO_MULTI);
    if (mc) session.ultContato = { palavra: mc[1], t: session.turno };
    if (units && units.length) session.units = units.slice(0, 5);
    atualizarCtx(userText, units);
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
    // números já calculados de Boa Vista (capital): a IA repete estes, não conta fichas soltas
    try {
      var ix = contIndex(), nb = totalBairros(ix);
      txt += ' Em Boa Vista (capital, sem o interior), contados nas fichas: ' + CONT_TIPOS.filter(function (t) { return t.key !== 'BOMBEIROS'; }).map(function (t) {
        var it = contItens(ix, t); return it.length + ' ' + (it.length === 1 ? t.sing : t.plur) + contResumoSub(it, t);
      }).join('; ') + '; ' + nb + ' bairros aparecem nos endereços. O diretório NÃO tem população, famílias, matrículas, vagas nem atendimentos: nesses casos diga que não consta e cite a fonte oficial (IBGE, Censo Escolar/INEP, CNES/DataSUS, Relatório de Informações Sociais do MDS).';
    } catch (e) { /* sem índice: segue só com a contagem por grupo */ }
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
    var gasto = 0;
    var fichas = todos.slice(0, lim).map(function (x, i) {
      var u = slim(x.u.d);
      // as primeiras fichas levam os trechos do cartão que combinam com a pergunta; as demais, só o começo
      var orc = i === 0 ? 1600 : (ampla ? 240 : (i < 3 ? 900 : 240));
      if (gasto > 6500) orc = 240;
      var tr = trechosDa(x.u.d, text, orc, 1.2), sobre = textoTrechos(tr);
      if (!sobre) sobre = cut(cleanText(x.u.d.desc), ampla ? 120 : 220);
      gasto += sobre.length;
      return {
        nome: u.fullName || u.name, grupo: grupoDe(x.u.d), endereco: u.address, horario: u.hours,
        telefones: u.phones.join(', '), servicos: cut(u.services, ampla ? 200 : (i < 3 ? 480 : 320)),
        descricao: sobre
      };
    });
    return { fichas: fichas, total: todos.length };
  }
  // Perguntas sobre território que o atalho local não resolveu (ex.: texto longo, vários casos): a IA recebe
  // as fichas das unidades que cobrem o bairro citado (de qualquer tipo: CRAS, CREAS, Conselho Tutelar, DP,
  // CAPS, Restaurante Cidadão, UBS). Sem bairro identificado, recebe a lista oficial de bairros de cada
  // unidade do tipo citado, e responde só com ela.
  function territorioFichas(text) {
    var n = norm(text);
    var kinds = kindsDe(n), explicito = kinds.length > 0;
    var cob = RE_COBERTURA.test(n), mor = RE_MORADIA.test(n), pedeT = RE_TECNICO.test(n);
    var hasServico = /\b(cadunico|cad unico|cadastro unico|bolsa familia|paif|scfv|assistencia social)\b/.test(n);
    if (explicito) {
      var soLegado = kinds.every(function (k) { return k === 'CRAS' || k === 'CREAS'; });
      if (soLegado ? !(cob || mor || RE_PERGUNTA.test(n) || /\bzona\b/.test(n)) : !(cob || mor)) return [];
    } else {
      if (!((cob && mor) || ((cob || mor) && RE_EQUIP.test(n)) || (pedeT && (cob || mor || RE_PERGUNTA.test(n))))) return [];
      kinds = (hasServico || pedeT) ? ['CRAS'] : TERR_TODOS.slice();
    }
    var temLocal = kinds.some(function (k) { return tipoDe(k).modo === 'local'; });
    var idx = unionFor(temLocal ? uniq(kinds.concat(['CRAS', 'CREAS', 'CT', 'DP'])) : kinds);
    var achou = acharHits(n, idx), out = [];
    if (achou.hits.length) {
      achou.hits.slice(0, 3).forEach(function (h) {
        var lbl = h.items[0].label;
        kinds.forEach(function (k) {
          var tipo = tipoDe(k), g = gruposDe(itensDe(idxDe(k), h.key));
          if (!g.groups.length) {
            out.push({ nome: 'Sem cobertura (' + tipo.nome + ')', grupo: 'Aviso', endereco: '', horario: '', telefones: '', descricao: '',
              servicos: tipo.modo === 'local' ? 'Não há ' + tipo.nome + ' cadastrada no bairro ' + lbl + ' no diretório.' : 'O bairro ' + lbl + ' NÃO consta na lista oficial de bairros atendidos de ' + tipo.plural + ' no diretório.' });
            return;
          }
          g.groups.forEach(function (x) {
            var d = fichaDe(x.unit.id), sl = slim(d);
            out.push({
              nome: sl.name, grupo: grupoDe(d), endereco: sl.address, horario: sl.hours, telefones: sl.phones.join(', '), descricao: '',
              servicos: tipo.modo === 'local'
                ? 'FICA NO BAIRRO ' + lbl + ' (não há lista oficial de cobertura: a UBS de referência segue a área da equipe de saúde da família).'
                : 'O BAIRRO ' + lbl + ' CONSTA NA LISTA OFICIAL DE BAIRROS ATENDIDOS DESTA UNIDADE (' + tipo.nome + ').' + (k === 'CRAS' && pedeT ? ' EQUIPE TÉCNICA: ' + equipeDe(lbl, x.unit.id, n).replace(/\*\*/g, '') : '')
            });
          });
        });
      });
      return out;
    }
    if (!explicito) return [];
    kinds.forEach(function (k) {
      if (tipoDe(k).modo !== 'cobertura') return;
      idxDe(k).list.filter(function (u) { return u.bairros.length; }).forEach(function (u) {
        var d = fichaDe(u.id), sl = slim(d), a = u.bairros.join(', '), b = '';
        if (a.length > 255) { var cutAt = a.lastIndexOf(', ', 255); b = a.slice(cutAt + 2); a = a.slice(0, cutAt); }
        out.push({
          nome: sl.name, grupo: grupoDe(d), endereco: sl.address, horario: sl.hours, telefones: sl.phones.join(', '),
          servicos: 'BAIRROS ATENDIDOS (lista oficial): ' + a + (b ? ',' : '.'),
          descricao: b ? '(continuação dos bairros atendidos) ' + b + '.' : ''
        });
      });
    });
    return out;
  }
  // Município do interior citado na pergunta: a IA recebe os CRAS/CREAS dele com a área de abrangência.
  function municipioFichas(text) {
    var n = norm(text);
    if (!/\b(cras|creas|assistencia social|cadunico|cadastro unico|bolsa familia|paif)\b/.test(n)) {
      var rm = rr ? rrAchar(n)[0] : null;
      return rm && rm.id !== 'boa-vista' ? rrFichasIA(rm) : [];
    }
    if (!munIdx) munIdx = buildMunicipios();
    var padded = ' ' + n + ' ', chave = '';
    for (var i = 0; i < munIdx.keys.length; i++) if (padded.indexOf(' ' + munIdx.keys[i] + ' ') > -1) { chave = munIdx.keys[i]; break; }
    if (!chave) return [];
    var loc = munIdx.locais[chave], m = loc ? loc.mun : munIdx.by[chave], out = [];
    m.cras.concat(m.creas).forEach(function (x) {
      var sl = slim(x.d);
      out.push({
        nome: sl.name, grupo: grupoDe(x.d), endereco: sl.address, horario: sl.hours, telefones: sl.phones.join(', '),
        servicos: 'MUNICÍPIO: ' + m.nome + (x.abr ? ' | ÁREA DE ABRANGÊNCIA (lista oficial): ' + x.abr : '') + ' | ' + cut(sl.services, 120),
        descricao: ''
      });
    });
    if (!m.creas.length) out.push({ nome: 'Sem CREAS cadastrado em ' + m.nome, grupo: 'Aviso', endereco: '', horario: '', telefones: '', servicos: 'Não há CREAS cadastrado no diretório para ' + m.nome + '.', descricao: '' });
    return out;
  }
  function buildPayload(text, opts) {
    opts = opts || {};
    var hist = historicoParaIA();
    // a pergunta atual já entra separada: não repete a última mensagem do usuário
    if (hist.length && hist[hist.length - 1].papel === 'usuario' && hist[hist.length - 1].texto === text.slice(0, CFG.maxPergunta)) hist = hist.slice(0, -1);
    var ampla = isAmpla(text);
    var ctx = aiContext(text, opts.tabCat, ampla);
    var terr = municipioFichas(text), soMun = terr.length > 0;
    if (!soMun) terr = territorioFichas(text);
    if (terr.length) {
      var nomes = asSet(terr.map(function (f) { return f.nome; }));
      // município do interior: só as unidades dele (as outras fichas viram ruído)
      ctx = { fichas: soMun ? terr.slice(0, 10) : terr.concat(ctx.fichas.filter(function (f) { return !nomes[f.nome]; })).slice(0, 10), total: ctx.total };
    }
    var pan = '';
    if (ampla) {
      pan = panorama();
      var nq = norm(text);
      if (/\bbairros?\b/.test(nq) && /\b(quantos|quantas|quantidade|numero|total)\b/.test(nq)) {
        pan += ' ATENÇÃO: este contexto NÃO traz contagem por bairro. Não calcule, não estime e não some fichas: diga que a contagem por bairro é feita pelo app e peça para perguntar no formato "quantas escolas no Caimbé?" (ou "quantas UBS no Centro?").';
      }
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
      base: baseApp(text),
      historico: hist,
      estado: estadoParaIA(),
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
      if (/^(?:19|20)\d{2}[-\s]+(?:19|20)\d{2}$/.test(m.trim())) return; // "2023-2026" é intervalo de anos
      var dg = m.replace(/\D/g, '');
      if (dg.length >= 8 && !idx[dg.slice(-8)]) bad = true;
    });
    return bad;
  }
  function cleanAI(text) {
    return String(text || '')
      .replace(/^\s*(argo|resposta)\s*:\s*/i, '')
      .replace(/<\/?(fichas|normas|panorama|pergunta|historico)>/gi, '')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/^\s*\*\s+/gm, '- ')
      .replace(/\n{3,}/g, '\n\n')
      .trim().slice(0, 2400);
  }
  // A IA termina a resposta com "SUGESTÕES: a | b | c". Isso vira botões e não aparece no texto.
  var RE_SUG = /\n?[ \t]*(?:\*\*)?sugest(?:õ|o)es(?:\*\*)?[ \t]*:[ \t]*([\s\S]*)$/i;
  function separarSugestoes(text) {
    var t = String(text || ''), m = t.match(RE_SUG);
    if (!m) return { texto: t.trim(), sugestoes: [] };
    var sug = m[1].split(/\s*\|\s*|\n\s*[-•*]\s*/).map(function (x) { return x.replace(/^[\s\-•*"“]+|[\s"”]+$/g, '').trim(); })
      .filter(function (x) { return x.length >= 6 && x.length <= 60 && /[a-zà-ú]/i.test(x); });
    return { texto: t.slice(0, m.index).trim(), sugestoes: uniq(sug).slice(0, 3) };
  }
  // durante o streaming: esconde o rótulo "SUGESTÕES:" (inclusive parcial, como "SUGEST") no fim
  function ocultarSugestoes(full) {
    var t = String(full || ''), i = t.search(/\n?[ \t]*(?:\*\*)?sugest/i);
    if (i > -1) return t.slice(0, i).replace(/\s+$/, '');
    // rótulo ainda incompleto na última linha ("SUG", "**Suges"): também fica escondido
    var nl = t.lastIndexOf('\n'), ult = nl > -1 ? t.slice(nl + 1) : '';
    var alvo = ult.replace(/[*\s]/g, '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (alvo.length >= 3 && 'sugestoes:'.indexOf(alvo) === 0) return t.slice(0, nl).replace(/\s+$/, '');
    return t;
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
  // Interpretação: antes de procurar ou responder, a IA lê a pergunta com a conversa e a devolve
  // completa e autônoma ("e o horário?" -> "Qual o horário do CRAS Cauamé?"), no formato que as
  // regras abaixo sabem consultar com dados reais. Não responde nada ao profissional.
  // Qualquer problema (sem internet, Worker antigo, demora, resposta estranha) devolve null e o
  // mascote segue com a pergunta original: nunca fica pior do que sem este passo.
  // ---------------------------------------------------------------------
  var INTENCOES = ['ubs_psicologo', 'territorio', 'diretorio', 'contagem', 'cid', 'conceito', 'norma', 'navegar', 'agenda', 'saudacao', 'fora_do_escopo', 'outro'];
  function interpretar(text, opts) {
    opts = opts || {};
    text = String(text || '').trim().slice(0, CFG.maxPergunta);
    if (!text || !aiOn() || typeof fetch !== 'function') return Promise.resolve(null);
    if (piiBlock(text)) return Promise.resolve(null);
    var agora = Date.now();
    var recentes = session.aiTimes.filter(function (t) { return agora - t < 60000; });
    if (recentes.length >= CFG.porMinuto) return Promise.resolve(null);   // cota local: a resposta tem prioridade
    var hist = historicoParaIA();
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, CFG.interpretaMs);
    if (opts.signal && ctl) {
      if (opts.signal.aborted) ctl.abort(); else opts.signal.addEventListener('abort', function () { ctl.abort(); });
    }
    return fetch(CFG.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ v: 2, modo: 'interpretar', pergunta: text, historico: hist, estado: estadoParaIA(), pagina: String(opts.tabName || '').slice(0, 80) }),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      clearTimeout(timer);
      var i = j && j.interpretacao;
      if (!i || typeof i !== 'object' || typeof i.pergunta !== 'string') return null;
      var pergunta = i.pergunta.replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!pergunta || piiBlock(pergunta)) pergunta = text;
      var bairro = typeof i.bairro === 'string' ? i.bairro.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
      if (!/^[A-Za-zÀ-ÿ0-9 .'\-ºª]*$/.test(bairro) || piiBlock(bairro)) bairro = '';
      var unidade = typeof i.unidade === 'string' ? i.unidade.replace(/\s+/g, ' ').trim().slice(0, 90) : '';
      if (!/^[A-Za-zÀ-ÿ0-9 .,'\-ºª\/()]*$/.test(unidade) || piiBlock(unidade)) unidade = '';
      var esclarecer = typeof i.esclarecer === 'string' ? i.esclarecer.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
      if (piiBlock(esclarecer)) esclarecer = '';
      return {
        pergunta: pergunta,
        intencao: INTENCOES.indexOf(i.intencao) >= 0 ? i.intencao : 'outro',
        bairro: bairro,
        unidade: unidade,
        esclarecer: esclarecer,
        mudou: norm(pergunta) !== norm(text)
      };
    }).catch(function () { clearTimeout(timer); return null; });
  }

  // ---------------------------------------------------------------------
  // Território: "qual CRAS / CREAS / Conselho Tutelar / DP / CAPS / Restaurante
  // Cidadão atende o bairro X?", "qual UBS fica no bairro X?" e também
  // "qual equipamento atende o bairro X?" (mostra todos de uma vez).
  //
  // Lê a lista de bairros que JÁ está na ficha de cada unidade (data.js) —
  // nada é digitado em dobro. Cada tipo de equipamento escreve essa lista de
  // um jeito; a tabela TERR_TIPOS abaixo diz onde procurar em cada um.
  // Para incluir um tipo novo, basta acrescentar uma linha nela.
  // Responde só com o que está nas listas: bairro que não consta NÃO é
  // adivinhado. UBS é diferente: não há lista oficial de cobertura no
  // diretório, então o Argo só informa as UBS que FICAM no bairro e avisa
  // que a unidade de referência segue a área da equipe de saúde da família.
  // ---------------------------------------------------------------------
  var terrIdx = null, terrAll = null;
  // prefixos que as pessoas costumam omitir ao falar o nome do bairro
  var BAIRRO_PREF = /^(dr|doutor|doutora|conjunto|conj|jardim|governador|gov|senador|professora|professor|profa|prof|bairro|nossa senhora da|nossa senhora de|nossa senhora|nossa sra da|nossa sra de|nossa sra)\s+/;
  var RE_LISTA_CRAS = /(?:Bairros atendidos|Cobertura)\s*:\s*([\s\S]+?)\.\s*(?:·|⚖|$)/i;
  var ORDINAL = { 1: ['i', 'primeiro'], 2: ['ii', 'segundo'], 3: ['iii', 'terceiro'], 4: ['iv', 'quarto'], 5: ['v', 'quinto'] };
  function listaCras(txt) { var m = txt.match(RE_LISTA_CRAS); return m ? m[1].split(/,|\se\s/) : []; }
  var TERR_TIPOS = [
    { key: 'CRAS', nome: 'CRAS', plural: 'CRAS', modo: 'cobertura', det: /\bcras\b/,
      unidade: function (d) { return /^CRAS\b/i.test(d.group || '') || /^CRAS\b/i.test(d.name || ''); },
      bairros: listaCras },
    { key: 'CREAS', nome: 'CREAS', plural: 'CREAS', modo: 'cobertura', det: /\bcreas\b/,
      unidade: function (d) { return /^CREAS\b/i.test(d.group || '') || /^CREAS\b/i.test(d.name || ''); },
      bairros: listaCras },
    { key: 'CT', nome: 'Conselho Tutelar', plural: 'Conselhos Tutelares', modo: 'cobertura', det: /\bconselhos? tutelar(?:es)?\b|\bcts?\b/,
      unidade: function (d) { return /^Conselho Tutelar/i.test(d.name || ''); },
      bairros: function (txt) { var m = txt.match(/Território\s*:\s*([\s\S]+?)\.\s*(?:·|$)/i); return m ? m[1].split(';') : []; } },
    { key: 'DP', nome: 'Distrito Policial', plural: 'Distritos Policiais', modo: 'cobertura',
      det: /\b(dps?|distritos? policiais?|boletim de ocorrencia|b o)\b|\bdelegacias?\b(?!\s+(?:da mulher|especializad|da crianca|do idoso|de crimes|de homicidios))/,
      unidade: function (d) { return /Distritos Policiais/i.test(d.group || '') && /\bDP\b/.test(d.name || ''); },
      bairros: function (txt) { var m = txt.match(/Circunscrição \(bairros\)\s*:\s*([\s\S]+?)\.\s*(?:·|Atende|$)/i); return m ? m[1].split(/,|\se\s/) : []; } },
    { key: 'CAPS', nome: 'CAPS', plural: 'CAPS', modo: 'cobertura', det: /\bcaps\b/,
      nota: function (u) { return /\bAD\b/i.test(u.name) ? 'álcool e outras drogas' : 'transtornos mentais'; },
      unidade: function (d) { return /^CAPS \(Boa Vista\)/i.test(d.group || ''); },
      bairros: function (txt) { var m = txt.match(/(?:Bairros|macro[aá]reas \(1 a 8\))\s*:\s*([\s\S]+?)\.\s*(?:·|$)/i); return m ? m[1].replace(/\(M\d+\)/g, ',').split(/[,;]/) : []; } },
    { key: 'RESTAURANTE', nome: 'Restaurante Cidadão', plural: 'Restaurantes Cidadão', modo: 'cobertura', det: /\brestaurantes? cidada[oa]s?\b|\brestaurantes?\b/,
      unidade: function (d) { return /Restaurante Cidad/i.test(d.group || ''); },
      bairros: function (txt) { var m = txt.match(/dos bairros\s+([\s\S]+?)\.\s*(?:·|$)/i); return m ? m[1].split(/,|\se\s/) : []; } },
    // UBS: não há lista de cobertura; usa o bairro do endereço ("fica no bairro")
    { key: 'UBS', nome: 'UBS', plural: 'UBS', modo: 'local', det: /\bubs\b|\bposto de saude\b|\bpostinho\b|\bunidade basica\b|\bunidade de saude\b/,
      aviso: 'A UBS de referência da família segue a área da equipe de saúde da família e pode não ser a do bairro onde ela mora. Confirme com a UBS ou com a SEMSA antes de encaminhar.',
      unidade: function (d) { return /^UBS\b/i.test(d.name || '') && /Boa Vista/i.test(d.address || ''); },
      bairros: function (txt, d) {
        var a = cleanText(d.address), m = a.match(/\s-\s([^,]+?)\s*,\s*Boa Vista/i) || a.match(/,\s*([^,]+?)\s*,\s*Boa Vista/i);
        if (!m) return [];
        var lab = m[1].replace(/Trinta e Um de Março/i, '31 de Março'), par = lab.match(/\(([^)]*)\)/), out = [lab.replace(/\s*\([^)]*\)/, '').trim()];
        if (par) out.push(par[1].replace(/^Conj\.?\s*/i, '').trim());
        return out;
      } }
  ];
  var TERR_TODOS = TERR_TIPOS.map(function (t) { return t.key; });
  function tipoDe(key) { return TERR_TIPOS.filter(function (t) { return t.key === key; })[0]; }
  function kindsDe(n) { return TERR_TIPOS.filter(function (t) { return t.det.test(n); }).map(function (t) { return t.key; }); }

  // nomes pelos quais as pessoas citam a unidade ("CRAS Cauamé", "CT 2", "3º DP"...)
  function nomesDaUnidade(tipo, d) {
    var base = norm(d.name), out = [base], m;
    if (tipo.key === 'CRAS' || tipo.key === 'CREAS') {
      var rest = base.replace(/^(cras|creas)\s+/, '');
      out.push(tipo.key.toLowerCase() + ' ' + rest.replace(BAIRRO_PREF, ''));
    } else if (tipo.key === 'CT' && (m = String(d.id).match(/(\d)$/)) && ORDINAL[m[1]]) {
      out.push('conselho tutelar ' + m[1], 'ct ' + m[1], 'ct ' + ORDINAL[m[1]][0], 'conselho tutelar ' + ORDINAL[m[1]][1]);
    } else if (tipo.key === 'DP' && (m = String(d.name).match(/^(\d)/)) && ORDINAL[m[1]]) {
      out.push('dp ' + m[1], ORDINAL[m[1]][1] + ' dp', ORDINAL[m[1]][1] + ' distrito policial', m[1] + ' distrito policial');
    }
    return uniq(out);
  }

  function buildTerritory(kind) {
    var tipo = tipoDe(kind), keys = {}, list = [];
    data.forEach(function (d) {
      if (!tipo.unidade(d)) return;
      var txt = cleanText(d.desc);
      var unit = { id: d.id, name: d.name, nameN: norm(d.name), nomes: nomesDaUnidade(tipo, d), tipo: tipo, bairros: [] };
      function reg(k, label, canon, alias) {
        if (!k || k.length < 3) return;
        var arr = keys[k] = keys[k] || [];
        if (arr.some(function (i) { return i.unit.id === unit.id && i.label === label; })) return;
        arr.push({ label: label, unit: unit, full: canon, alias: alias });
      }
      tipo.bairros(txt, d).forEach(function (b0) {
        var b = b0.trim().replace(/\.$/, '');
        if (b.length < 3) return;
        unit.bairros.push(b);
        var canon = norm(b), vars = [];
        reg(canon, b, canon, false);
        vars.push(canon);
        // "05 de Outubro (Parque Caçari)" e "... (Distrito Industrial)": aceita com e sem o parêntese e só o conteúdo dele
        var semPar = b.replace(/\s*\([^)]*\)/g, '').trim(), par = b.match(/\(([^)]+)\)/);
        if (semPar !== b) { reg(norm(semPar), b, canon, true); vars.push(norm(semPar)); }
        if (par && norm(par[1]).length >= 5) { reg(norm(par[1]), b, canon, true); vars.push(norm(par[1])); }
        vars.forEach(function (v) {
          var short = v.replace(BAIRRO_PREF, '');
          if (short !== v && short.length > 3) reg(short, b, canon, true);
        });
      });
      list.push(unit);
    });
    return { keys: keys, list: list, sorted: Object.keys(keys).sort(function (a, b) { return b.length - a.length; }) };
  }
  function idxDe(kind) {
    if (!terrAll) terrAll = {};
    if (!terrAll[kind]) terrAll[kind] = buildTerritory(kind);
    return terrAll[kind];
  }
  // índice de vários tipos juntos (para achar o bairro citado na pergunta)
  function unionFor(kinds) {
    if (kinds.length === 1) return idxDe(kinds[0]);
    var ck = 'U:' + kinds.join('+');
    if (terrAll && terrAll[ck]) return terrAll[ck];
    var keys = {}, list = [];
    kinds.forEach(function (k) {
      var ix = idxDe(k);
      Object.keys(ix.keys).forEach(function (key) { keys[key] = (keys[key] || []).concat(ix.keys[key]); });
      list = list.concat(ix.list);
    });
    return (terrAll[ck] = { keys: keys, list: list, sorted: Object.keys(keys).sort(function (a, b) { return b.length - a.length; }) });
  }
  // itens de um tipo para a chave achada (aceita "dr silvio botelho" e "silvio botelho")
  function itensDe(idx, key) { return idx.keys[key] || idx.keys[key.replace(BAIRRO_PREF, '')] || []; }

  // distância de edição (para "caimbe", "cauame", "pintolandai"...): usa lev() do começo do arquivo, com limite
  var FUZZ_IGNORA = asSet(('cras creas bairro bairros atende atendem moro mora qual quais meu minha regiao comunidade cadunico cadastro unico bolsa familia paif ' +
    'conselho tutelar delegacia distrito policial restaurante cidadao equipamento equipamentos unidade unidades servico servicos rede referencia ubs caps perto proximo procuro procurar').split(' '));
  function unidadesDe(items) { return asSet(items.map(function (i) { return i.unit.id; })); }
  function fuzzyBairro(n, idx) {
    var t = n.split(' ').filter(function (w) { return w && !STOP[w] && !FUZZ_IGNORA[w]; });
    var best = null, bestD = 99, tie = false;
    function curto(k) { return k.replace(BAIRRO_PREF, ''); }
    function mesmaUnidade(a, b) { var ua = unidadesDe(idx.keys[a]); return idx.keys[b].some(function (i) { return ua[i.unit.id]; }); }
    for (var len = 1; len <= 4; len++) {
      for (var i = 0; i + len <= t.length; i++) {
        var frase = t.slice(i, i + len).join(' ');
        if (frase.length < 5) continue;
        var lim = frase.length >= 10 ? 2 : 1;
        idx.sorted.forEach(function (k) {
          if (Math.abs(k.length - frase.length) > lim) return;
          var d = lev(frase, k, lim);
          if (d > lim) return;
          if (d < bestD) { bestD = d; best = k; tie = false; }
          else if (d === bestD && k !== best && curto(k) !== curto(best) && !mesmaUnidade(k, best)) tie = true;
        });
      }
    }
    return best && !tie ? { key: best } : null;
  }
  // equipe técnica por bairro. Só há dado do CRAS Cristiana (equipe-cras-cristiana.js); nos demais CRAS
  // o diretório não traz a equipe e a resposta diz isso, sem inventar nome.
  // 'pergunta' = texto normalizado quando a pessoa perguntou pelo técnico (resposta completa); '' = só a linha curta.
  function equipeDe(label, unitId, pergunta) {
    if (!label) return '';
    var nomeU = slim(fichaDe(unitId)).name || 'CRAS';
    var eq = (typeof EQUIPE_CRAS_CRISTIANA !== 'undefined') ? EQUIPE_CRAS_CRISTIANA : null;
    if (unitId !== 'cras-cristiana-vicente-nunes' || !eq || !eq.fixedTeam) {
      return pergunta ? 'O diretório não traz a equipe técnica por bairro do **' + nomeU + '**. Confirme o(a) técnico(a) de referência de **' + label + '** diretamente com a unidade.' : '';
    }
    var alvo = ' ' + norm(label) + ' ';
    var tem = function (txt) { return (' ' + norm(txt) + ' ').indexOf(alvo) > -1; };
    var fmt = function (x) { return x.name + ' (' + x.role + ')'; };
    var fixos = eq.fixedTeam.filter(function (x) { return tem(x.bairros); });
    if (!pergunta) return fixos.length ? 'Técnico(a) de referência no bairro: ' + fixos.map(fmt).join(' e ') + '.' : '';
    var vol = !!(eq.volanteTeam && eq.volanteTeam.length && tem(eq.volanteCoverage || ''));
    var cobre = (eq.fixedCoverage || []).some(function (c) { return tem(c); });
    var txt = '';
    if (fixos.length) {
      txt = 'Técnico(a) de referência de **' + label + '** no **' + nomeU + '**: ' + fixos.map(fmt).join(' e ') + '.';
      var pedido = /psicolog/.test(pergunta) ? ['psicolog', 'psicólogo(a)'] : /assistente social|assistentes sociais/.test(pergunta) ? ['assistente social', 'assistente social'] : /pedagog/.test(pergunta) ? ['pedagog', 'pedagogo(a)'] : null;
      if (pedido && !fixos.some(function (x) { return norm(x.role).indexOf(pedido[0]) > -1; })) txt += ' Não consta ' + pedido[1] + ' de referência para esse bairro no diretório.';
    }
    if (vol) {
      txt += (fixos.length ? ' O bairro também recebe o atendimento itinerante (PAIF e CadÚnico) da equipe volante: '
        : 'Não há técnico fixo cadastrado para **' + label + '**; o atendimento itinerante (PAIF e CadÚnico) é feito pela equipe volante: ') + eq.volanteTeam.map(fmt).join(', ') + '.';
    } else if (!fixos.length && cobre) {
      txt = 'O bairro **' + label + '** consta na cobertura do **' + nomeU + '**, mas o diretório não traz técnico de referência para ele. Confirme com a unidade.';
    }
    return txt;
  }
  var RE_TECNICO = /\b(tecnico|tecnica|tecnicos|tecnicas|psicologo|psicologa|psicologos|psicologas|assistente social|assistentes sociais|pedagogo|pedagoga|referencia tecnica|equipe tecnica)\b/;
  var RE_COBERTURA = /\b(atende|atendem|atendimento|atendido|atendida|atendo|referencia|abrange|abrangem|cobre|cobertura|territorio|pertence|pertencem|responsavel|jurisdicao|circunscricao)\b/;
  var RE_MORADIA = /\b(bairro|moro|mora|moram|morando|morar|moramos|morador|moradora|moradores|moradia|vive|vivem|vivendo|residente|residindo|resido|reside|regiao|comunidade)\b/;
  var RE_PERGUNTA = /\b(qual|quais|onde|perto|proximo|procuro|procurar|fica|ficam)\b/;
  var RE_EQUIP = /\b(equipamento|equipamentos|unidade|unidades|servico|servicos|rede)\b/;
  var RE_GENERICAS = /^(cras|creas|conselho|tutelar|ct|cts|dp|dps|delegacia|distrito|policial|caps|ubs|restaurante|cidadao|posto|saude|bairro|atende|atendem|meu|minha|qual|quais|moro|mora|regiao|casa|equipamento|equipamentos|unidade|unidades|servico|servicos|rede|referencia|fica|ficam|onde)$/;

  // acha os bairros citados na pergunta (o nome mais longo vence; um trecho já usado não conta de novo)
  function acharHits(n, idx) {
    var padded = ' ' + n + ' ', used = [], hits = [], mencoes = [], citouUnidade = false;
    idx.list.forEach(function (u) {
      u.nomes.forEach(function (nm) { var at = padded.indexOf(' ' + nm + ' '); if (at > -1) mencoes.push([at, at + nm.length + 2]); });
    });
    idx.sorted.forEach(function (k) {
      var at = padded.indexOf(' ' + k + ' ');
      if (at < 0) return;
      var from = at, to = at + k.length + 2;
      if (used.some(function (u) { return from < u[1] && to > u[0]; })) return;
      // "CRAS Cauamé" é o nome da unidade, não uma pergunta sobre o bairro
      if (mencoes.some(function (m) { return from >= m[0] && to <= m[1]; })) { citouUnidade = true; return; }
      used.push([from, to]);
      hits.push({ key: k, items: idx.keys[k] });
    });
    var corrigido = '';
    if (!hits.length && !citouUnidade) {
      var fz = fuzzyBairro(n, idx);
      if (fz) { hits.push({ key: fz.key, items: idx.keys[fz.key] }); corrigido = fz.key; }
    }
    return { hits: hits, citouUnidade: citouUnidade, corrigido: corrigido };
  }

  // separa as unidades que cobrem o bairro; o nome exato do bairro vence o apelido curto
  function gruposDe(items) {
    var exact = items.filter(function (i) { return !i.alias; });
    var alias = items.filter(function (i) { return i.alias; });
    var cands = exact.concat(alias.filter(function (a) { return !exact.some(function (e) { return e.full === a.full; }); }));
    var byUnit = {}, ordem = [];
    cands.forEach(function (c) {
      if (!byUnit[c.unit.id]) { byUnit[c.unit.id] = { unit: c.unit, labels: [] }; ordem.push(c.unit.id); }
      byUnit[c.unit.id].labels.push(c.label);
    });
    return { groups: ordem.map(function (k) { return byUnit[k]; }), mesmoBairro: cands.every(function (c) { return c.full === cands[0].full; }) };
  }
  function fichaDe(id) { return data.filter(function (d) { return d.id === id; })[0] || {}; }
  function resumoUnidade(u, semNegrito) {
    var f = slim(fichaDe(u.id)), nota = u.tipo.nota ? ' (' + u.tipo.nota(u) + ')' : '', nm = f.name || u.name, p = [(semNegrito ? nm : '**' + nm + '**') + nota];
    if (f.address) p.push(cut(f.address, 80));
    if (f.phones.length) p.push(f.phones.slice(0, 2).join(' / '));
    return p.join(' · ');
  }

  function territory(text) {
    var n = norm(text);
    if (!n || n.length > 200) return null;
    var kinds = kindsDe(n), explicito = kinds.length > 0;
    var hasServico = /\b(cadunico|cad unico|cadastro unico|bolsa familia|paif|scfv|assistencia social)\b/.test(n);
    var meuBairro = /\b(meu bairro|minha regiao|minha casa|onde moro|moro aqui)\b/.test(n);
    var cob = RE_COBERTURA.test(n), mor = RE_MORADIA.test(n), pedeTecnico = RE_TECNICO.test(n);
    if (explicito) {
      // CRAS/CREAS: qualquer menção (como sempre foi); os demais exigem cara de pergunta sobre território
      var soLegado = kinds.every(function (k) { return k === 'CRAS' || k === 'CREAS'; });
      if (!soLegado && !(cob || mor || RE_PERGUNTA.test(n))) return null;
    } else {
      if (!((cob && mor) || (hasServico && mor) || ((cob || mor) && RE_EQUIP.test(n)) || (pedeTecnico && (cob || mor || RE_PERGUNTA.test(n))))) return null;
      kinds = (hasServico || pedeTecnico) ? ['CRAS'] : TERR_TODOS.slice();
    }
    var varios = kinds.length > 1;
    var tipos = kinds.map(tipoDe);
    var temLocal = tipos.some(function (t) { return t.modo === 'local'; });
    // para achar o bairro, "UBS" usa também as listas de cobertura (assim se sabe que o bairro existe mesmo sem UBS nele)
    var buscaKinds = temLocal ? uniq(kinds.concat(['CRAS', 'CREAS', 'CT', 'DP'])) : kinds;
    terrIdx = unionFor(buscaKinds);
    var rr = acharHits(n, terrIdx), hits = rr.hits, corrigido = rr.corrigido;
    var rotulo = varios ? 'equipamento' : tipos[0].nome;

    if (!hits.length) {
      var padded = ' ' + n + ' ';
      // "quais bairros o CRAS Cauamé atende?": lista a cobertura daquela unidade
      var named = terrIdx.list.filter(function (u) {
        return u.bairros.length && u.tipo.modo === 'cobertura' && u.tipo.key !== 'RESTAURANTE' && u.nomes.some(function (nm) { return padded.indexOf(' ' + nm + ' ') > -1; });
      })[0];
      if (named && kinds.indexOf(named.tipo.key) > -1 && /\b(bairro|bairros|territorio|cobertura|atende|atendem|abrange|regiao|regioes)\b/.test(n)) {
        return {
          reply: 'O **' + named.name + '** atende ' + named.bairros.length + ' bairros: ' + named.bairros.join(', ') + '.\nConfirme com a unidade antes de encaminhar: a divisão dos territórios pode mudar.',
          mood: 'success', followups: ['Qual o telefone?', 'Como chegar?'], badge: 'Território', units: [slim(fichaDe(named.id))]
        };
      }
      // zona rural / comunidade indígena: quem atende é o CRAS Itinerante
      if (explicito && kinds.indexOf('CRAS') > -1 && /\b(indigena|indigenas|aldeia|rural|zona rural|interior|vicinal)\b/.test(n)) {
        var it = idxDe('CRAS').list.filter(function (u) { return /itinerante/.test(u.nameN); })[0];
        var du = it && fichaDe(it.id);
        if (du && du.id) return {
          reply: 'Comunidades indígenas e a zona rural de Boa Vista são atendidas pelo **CRAS Itinerante**, que leva o CadÚnico e o PAIF até o território.\nO itinerário muda; confirme os dias e o local com a coordenação antes de orientar a família.',
          mood: 'success', followups: ['Ver o CRAS Itinerante'], badge: 'Território', units: [slim(du)]
        };
      }
      // sem tipo citado, só responde quando a pessoa fala em "bairro" (evita pegar "quem atende quem mora na rua")
      var podeResponder = explicito || meuBairro || /\bbairro\b/.test(n);
      // "qual cras atende o meu bairro?" sem dizer o bairro: pergunta de volta
      var soPergunta = n.split(' ').filter(function (t) { return !STOP[t] && !RE_GENERICAS.test(t); }).length === 0;
      if (podeResponder && (meuBairro || (soPergunta && (cob || mor)))) return {
        reply: 'Me diga o **nome do bairro** onde a família mora que eu mostro ' + (varios ? 'quais equipamentos são a referência' : 'qual ' + rotulo + ' é a referência') + '.',
        mood: 'info', followups: ['Moro no Caimbé', 'Qual ' + (varios ? 'equipamento' : rotulo) + ' atende o Centro?'], badge: 'Território'
      };
      // a pergunta cita o NOME de uma unidade ("quem atende no CRAS Cristiana Vicente Nunes?"): não é bairro; segue para o diretório/ficha
      var citouUnidade = terrIdx.list.some(function (u) { var nu = norm(u.name); return nu.length > 8 && (' ' + n + ' ').indexOf(' ' + nu + ' ') > -1; });
      if (citouUnidade && !/\bbairro\b/.test(n)) return null;
      // pediu "o CRAS do bairro X" mas X não está na lista: não chuta
      if (podeResponder && (/\bbairro\b/.test(n) || mor || cob)) {
        var msg;
        if (varios) msg = 'Não encontrei esse bairro nas listas de cobertura do diretório. Confira a grafia ou diga o nome de um bairro vizinho.';
        else {
          var nomesU = terrIdx.list.filter(function (u) { return u.bairros.length && u.tipo.key === tipos[0].key; }).map(function (u) { return u.name; });
          msg = 'Não encontrei esse bairro na lista de cobertura dos ' + tipos[0].plural + ' de Boa Vista. Confira a grafia ou diga o nome de um bairro vizinho.';
          if (nomesU.length && nomesU.length <= 10 && tipos[0].modo === 'cobertura') msg += '\nOs ' + tipos[0].plural + ' com território cadastrado são: ' + nomesU.join(', ') + '.';
        }
        return { reply: msg, mood: 'notfound', followups: ['Quais bairros o CRAS Cauamé atende?'], badge: 'Território' };
      }
      return null;
    }

    var lines = [], units = [], seen = {};
    function guarda(u) { if (!seen[u.id]) { seen[u.id] = 1; units.push(u); } }
    var rotuloHit = '';

    if (!varios) {
      // ---- um tipo só (CRAS, CREAS, Conselho Tutelar, DP, CAPS, Restaurante ou UBS) ----
      var tipo = tipos[0], ix = idxDe(tipo.key), local = tipo.modo === 'local';
      hits.slice(0, 4).forEach(function (h) {
        var lblBase = h.items[0].label, g = gruposDe(itensDe(ix, h.key));
        if (!g.groups.length) {
          lines.push(local
            ? 'No bairro **' + lblBase + '** não há ' + tipo.nome + ' cadastrada no diretório.'
            : 'O bairro **' + lblBase + '** não consta na lista de cobertura dos ' + tipo.plural + '. Confirme com a coordenação.');
          return;
        }
        if (g.groups.length === 1) {
          var u1 = g.groups[0].unit, lbl = g.groups[0].labels[0];
          lines.push(local ? 'No bairro **' + lbl + '** fica a **' + u1.name + '**.' : '**' + lbl + '** é atendido pelo **' + u1.name + '**' + (tipo.nota ? ' (' + tipo.nota(u1) + ')' : '') + '.');
          guarda(u1);
        } else if (g.mesmoBairro) {
          lines.push(local ? 'No bairro **' + g.groups[0].labels[0] + '** ficam estas unidades:' : '**' + g.groups[0].labels[0] + '** é atendido por mais de uma unidade:');
          g.groups.forEach(function (x) { lines.push('- ' + resumoUnidade(x.unit)); guarda(x.unit); });
        } else {
          lines.push('Há mais de um bairro com o nome "' + h.key + '" na lista, confirme qual é o seu:');
          g.groups.forEach(function (x) { lines.push('- **' + x.labels[0] + '** → **' + x.unit.name + '**'); guarda(x.unit); });
        }
      });
      rotuloHit = hits.length === 1 ? hits[0].items[0].label : '';
      session.terrUlt = hits.length === 1 ? { kind: tipo.key, ref: hits[0].items[0].label } : null;
      if (corrigido) lines.unshift('Entendi o bairro como **' + hits[0].items[0].label + '**.');
      var full = units.map(function (u) { return slim(fichaDe(u.id)); }), crJunto = false;
      if (full.length === 1 && !lines.some(function (l) { return /^- /.test(l); })) {
        var f = full[0];
        if (f.address) lines.push('Endereço: ' + cut(f.address, 200));
        if (f.hours) lines.push('Horário: ' + cut(f.hours, 160));
        if (f.phones.length) lines.push('Telefone: ' + f.phones.slice(0, 2).join(' · '));
        if (tipo.key === 'CRAS' && hits.length === 1) {
          var cr = itensDe(idxDe('CREAS'), hits[0].key).filter(function (i) { return !i.alias; });
          var crU = cr.length ? cr[0].unit : null, crD = crU && fichaDe(crU.id);
          if (crD && crD.id) { var cs = slim(crD); lines.push('CREAS de referência: **' + cs.name + '**' + (cs.address ? ' · ' + cut(cs.address, 90) : '') + (cs.phones.length ? ' · ' + cs.phones.slice(0, 2).join(' / ') : '')); crJunto = true; }
        }
        if (!pedeTecnico) { var tec = equipeDe(hits.length === 1 ? hits[0].items[0].label : '', f.id, ''); if (tec) lines.push(tec); }
      }
      if (pedeTecnico && tipo.key === 'CRAS') {
        var tl = [], vistos = {};
        hits.slice(0, 3).forEach(function (h) {
          gruposDe(itensDe(ix, h.key)).groups.forEach(function (x) {
            var tx = equipeDe(h.items[0].label, x.unit.id, n);
            if (tx && !vistos[tx]) { vistos[tx] = 1; tl.push(tx); }
          });
        });
        if (tl.length) lines = tl.concat(lines);
      }
      lines.push(local ? tipo.aviso : 'Confirme com a unidade antes de encaminhar: a divisão dos territórios pode mudar e algumas ruas ficam no limite entre dois ' + tipo.plural + '.');
      var fu = [];
      if (full.length === 1 && rotuloHit) {
        if (tipo.key === 'CRAS' && !crJunto) fu.push('Qual o CREAS do bairro ' + rotuloHit + '?');
        else if (tipo.key !== 'CRAS') fu.push('Qual o CRAS do bairro ' + rotuloHit + '?');
        if (!local) fu.push('Quais outros bairros o ' + full[0].name + ' atende?');
        fu.push('Qual o telefone?');
      } else if (rotuloHit) fu.push('Quais equipamentos atendem o bairro ' + rotuloHit + '?');
      return { reply: lines.join('\n'), mood: 'success', followups: fu.slice(0, 3), badge: 'Território', units: full.slice(0, 5), unitsAll: full };
    }

    // ---- vários tipos / "qual equipamento atende o bairro X?": uma linha por equipamento ----
    hits.slice(0, 2).forEach(function (h) {
      var lbl = h.items[0].label;
      lines.push('**' + lbl + '** — equipamentos de referência:');
      tipos.forEach(function (tipo) {
        var g = gruposDe(itensDe(idxDe(tipo.key), h.key)), local = tipo.modo === 'local';
        var rot = local ? 'UBS no bairro' : tipo.nome;
        if (!g.groups.length) {
          lines.push('- **' + rot + ':** ' + (local ? 'nenhuma UBS cadastrada neste bairro no diretório.' : 'o bairro não consta na lista.'));
          return;
        }
        g.groups.forEach(function (x) { lines.push('- **' + rot + ':** ' + resumoUnidade(x.unit, true)); guarda(x.unit); });
      });
    });
    session.terrUlt = hits.length === 1 ? { kind: 'equipamento', ref: hits[0].items[0].label } : null;
    if (corrigido) lines.unshift('Entendi o bairro como **' + hits[0].items[0].label + '**.');
    lines.push('Confirme com a unidade antes de encaminhar: a divisão dos territórios pode mudar e algumas ruas ficam no limite entre duas áreas.' + (temLocal ? ' A UBS de referência segue a área da equipe de saúde da família e pode não ser a do bairro.' : ''));
    var fullV = units.map(function (u) { return slim(fichaDe(u.id)); });
    var fuV = hits.length === 1 && fullV.length ? ['Qual o telefone do ' + fullV[0].name + '?', 'Quais bairros o ' + fullV[0].name + ' atende?'] : [];
    return { reply: lines.join('\n'), mood: 'success', followups: fuV.slice(0, 3), badge: 'Território', units: fullV.slice(0, 5), unitsAll: fullV };
  }


  // ---------------------------------------------------------------------
  // Interior: "qual CRAS/CREAS atende o município X?" (e vilas, como Vila São Silvestre)
  // Usa o grupo (município) e a "Área de abrangência" das fichas do interior.
  // ---------------------------------------------------------------------
  var munIdx = null;
  function buildMunicipios() {
    var by = {}, locais = {}, keys = [];
    data.forEach(function (d) {
      if (!/^CRE?AS\b/i.test(d.name || '') || !d.group || /^Boa Vista/i.test(d.group)) return;
      var k = norm(d.group);
      var m = by[k] = by[k] || { nome: d.group, key: k, cras: [], creas: [] };
      var kind = /^CREAS/i.test(d.name) ? 'creas' : 'cras';
      var ab = cleanText(d.desc).match(/Área de abrangência:\s*([^.]+)\./i);
      var abr = ab ? ab[1].trim() : '';
      m[kind].push({ d: d, abr: abr });
      var v = abr.match(/^(vila [^,]+?)(?:\s+e adjac[eê]ncias)?$/i);
      if (kind === 'cras' && v) locais[norm(v[1])] = { mun: m, unit: d, label: v[1] };
    });
    keys = Object.keys(by).concat(Object.keys(locais)).sort(function (a, b) { return b.length - a.length; });
    return { by: by, locais: locais, keys: keys };
  }
  function unitLine(x) {
    var sl = slim(x.d), partes = ['**' + sl.name + '**'];
    if (x.abr) partes.push(x.abr.charAt(0).toLowerCase() + x.abr.slice(1));
    if (sl.address) partes.push(cut(sl.address, 90));
    var raw = (Array.isArray(x.d.phones) ? x.d.phones : []).join(' ');
    if (sl.phones.length) partes.push(sl.phones.slice(0, 2).join(' / '));
    else if (/sem coordena/i.test(raw)) partes.push('sem coordenação no momento');
    else partes.push('telefone não cadastrado');
    return '- ' + partes.join(' · ');
  }
  function municipio(text) {
    var n = norm(text);
    if (!n || n.length > 200) return null;
    var temCras = /\bcras\b/.test(n), temCreas = /\bcreas\b/.test(n);
    var temServico = /\b(cadunico|cad unico|cadastro unico|bolsa familia|paif|assistencia social)\b/.test(n);
    var cue = temCras || temCreas || ((RE_COBERTURA.test(n) || RE_MORADIA.test(n) || /\b(municipio|cidade)\b/.test(n)) && temServico);
    if (!cue) return null;
    if (!munIdx) munIdx = buildMunicipios();
    var padded = ' ' + n + ' ', achou = null, chave = '';
    for (var i = 0; i < munIdx.keys.length; i++) {
      if (padded.indexOf(' ' + munIdx.keys[i] + ' ') > -1) { chave = munIdx.keys[i]; break; }
    }
    if (!chave) {
      // erro de digitação ("pacaraina", "rorainopoles"): só com 1 ou 2 letras de diferença e sem empate
      var tk = n.split(' ').filter(function (w) { return w && !STOP[w] && !FUZZ_IGNORA[w]; }), melhor = '', md = 99, emp = false;
      for (var len = 1; len <= 3; len++) for (var a = 0; a + len <= tk.length; a++) {
        var fr = tk.slice(a, a + len).join(' ');
        if (fr.length < 6) continue;
        var lim = fr.length >= 10 ? 2 : 1;
        munIdx.keys.forEach(function (k) {
          if (Math.abs(k.length - fr.length) > lim) return;
          var d = lev(fr, k, lim);
          if (d > lim) return;
          if (d < md) { md = d; melhor = k; emp = false; } else if (d === md && k !== melhor) emp = true;
        });
      }
      if (melhor && !emp) chave = melhor;
    }
    if (!chave) return null;
    var loc = munIdx.locais[chave], m = loc ? loc.mun : munIdx.by[chave];
    // "CRAS Bonfim" / "telefone do CREAS Caroebe": é o nome da unidade, quem responde é o diretório
    var cobre = RE_COBERTURA.test(n) || RE_MORADIA.test(n) || /\b(qual|quais|onde|municipio|cidade)\b/.test(n);
    var nomeUnidade = [temCras ? 'cras ' : '', temCreas ? 'creas ' : ''].filter(Boolean).some(function (pre) {
      return data.some(function (d) { return norm(d.name) === pre.trim() + ' ' + chave; });
    });
    if (nomeUnidade && !/\b(qual|quais|atende|atendem|moro|mora|bairro|municipio|cidade)\b/.test(n)) return null;
    var quer = temCras && !temCreas ? ['cras'] : (temCreas && !temCras ? ['creas'] : ['cras', 'creas']);
    var lines = [], units = [];
    if (loc) {
      lines.push('**' + loc.label + '** (' + m.nome + ') é atendida pelo CRAS abaixo:');
      lines.push(unitLine({ d: loc.unit, abr: '' }));
      units.push(loc.unit);
      quer = quer.filter(function (k) { return k === 'creas'; });
      if (quer.length) { lines.push('CREAS de ' + m.nome + ':'); }
    } else {
      lines.push('Em **' + m.nome + '**:');
    }
    quer.forEach(function (k) {
      var rot = k.toUpperCase();
      if (!m[k].length) {
        lines.push('- ' + rot + ': não há ' + rot + ' cadastrado no diretório para ' + m.nome + '. Confirme com a coordenação do SUAS qual é a referência da região.');
        return;
      }
      m[k].forEach(function (x) { lines.push(unitLine(x)); units.push(x.d); });
    });
    lines.push('Confirme com a unidade antes de encaminhar: horários e áreas de abrangência podem mudar.');
    session.terrUlt = { kind: quer.length === 1 ? quer[0].toUpperCase() : 'CRAS', ref: loc ? loc.label : m.nome };
    var full = units.slice(0, 5).map(slim);
    return { reply: lines.join('\n'), mood: 'success', followups: full.length ? ['Qual o telefone?', 'Como chegar?'] : [], badge: 'Território', units: full, unitsAll: units.map(slim) };
  }

  // ---------------------------------------------------------------------
  // MUNICÍPIOS DE RORAIMA: população, indígenas, área, CadÚnico/Bolsa Família/BPC e rede cadastrada.
  // Os números vêm de assets/municipios-rr.json (gerado por scripts/gerar-municipios-rr.mjs a partir da base
  // de normas do Paulus; cada valor é conferido contra o texto das fichas). Responde SEM IA e SEM inventar:
  // o que a base não tem, o mascote diz que não tem. Para pergunta aberta ("como está X?"), a mesma ficha
  // segue para a IA como "base do app" (baseApp) e as unidades do município vão como fichas (municipioFichas).
  // ---------------------------------------------------------------------
  var rr = null;            // { estado, municipios:[{...}], aviso, fonte, keys:[{key, m}] }
  function setMunicipios(json) {
    rr = null;
    if (!json || !Array.isArray(json.municipios) || !json.municipios.length) return;
    var keys = [];
    json.municipios.forEach(function (m) {
      [m.nome].concat(m.aliases || []).forEach(function (nm) { keys.push({ key: norm(nm), m: m }); });
    });
    keys.sort(function (a, b) { return b.key.length - a.key.length; });
    rr = { estado: json.estado || {}, municipios: json.municipios, aviso: json.aviso || '', fonte: json.fonte || '', keys: keys };
  }
  function rrNum(v, casas) {
    if (v == null || v === '') return '';
    if (typeof v === 'string') return v;
    var s = casas != null ? Number(v).toFixed(casas) : String(v);
    var p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return p.join(',');
  }
  function rrPct(parte, todo) { return rrNum(parte / todo * 100, 1) + '%'; }
  function rrOrd(m) { return m.posicao + 'º'; }
  // Municípios citados na pergunta, na ordem em que aparecem (aceita erro de digitação de 1 ou 2 letras).
  function rrAchar(n) {
    if (!rr) return [];
    var padded = ' ' + n + ' ', achados = [], vistos = {};
    rr.keys.forEach(function (k) {
      var i = padded.indexOf(' ' + k.key + ' ');
      if (i > -1 && !vistos[k.m.id]) {
        // "São Luiz do Anauá" já cobre "São Luiz": tira o trecho achado para não contar duas vezes
        vistos[k.m.id] = 1; achados.push({ m: k.m, at: i });
        padded = padded.slice(0, i) + new Array(k.key.length + 2).join(' ') + padded.slice(i + k.key.length + 1);
      }
    });
    if (!achados.length) {
      var tk = n.split(' ').filter(function (w) { return w && !STOP[w] && !FUZZ_IGNORA[w]; });
      var melhor = null, md = 99, emp = false;
      for (var len = 1; len <= 3; len++) for (var a = 0; a + len <= tk.length; a++) {
        var fr = tk.slice(a, a + len).join(' ');
        if (fr.length < 7) continue;
        var lim = fr.length >= 10 ? 2 : 1;
        rr.keys.forEach(function (k) {
          if (Math.abs(k.key.length - fr.length) > lim) return;
          var d = lev(fr, k.key, lim);
          if (d > lim) return;
          if (d < md) { md = d; melhor = k.m; emp = false; } else if (d === md && k.m !== melhor) emp = true;
        });
      }
      if (melhor && !emp) achados.push({ m: melhor, at: 0 });
    }
    return achados.sort(function (x, y) { return x.at - y.at; }).map(function (x) { return x.m; });
  }
  function rrUnidades(m) {
    var gs = {}; (m.grupos || []).forEach(function (g) { gs[norm(g)] = 1; });
    return data.filter(function (d) { return gs[norm(d.group)]; });
  }
  function rrTipo(d) {
    var c = Array.isArray(d.cat) ? d.cat : [];
    if (/^CRAS\b/i.test(d.name || '')) return 'CRAS';
    if (/^CREAS\b/i.test(d.name || '')) return 'CREAS';
    if (c.indexOf('social') > -1) return 'Assistência social';
    if (c.indexOf('hospitalar') > -1) return /^UBS|Centro de Sa|Posto/i.test(d.name || '') ? 'UBS' : 'Hospital/unidade mista';
    if (c.indexOf('saude') > -1) return /^CAPS/i.test(d.name || '') ? 'CAPS' : 'Saúde';
    if (c.indexOf('educacao') > -1) return 'Escola';
    return 'Outros';
  }
  function rrIndigena(m) {
    if (m.indPessoas != null && m.indPct != null) return rrNum(m.indPessoas) + ' pessoas indígenas (' + (m.indAprox ? 'cerca de ' : '') + rrNum(m.indPct, m.indPct % 1 ? (String(m.indPct).split('.')[1] || '').length : 0) + '% dos moradores)';
    if (m.indPessoas != null) return rrNum(m.indPessoas) + ' pessoas indígenas';
    if (m.indPct != null) return 'cerca de ' + rrNum(m.indPct, 1) + '% da população é indígena';
    return '';
  }
  function rrDens(m) { return m.areaKm2 ? rrNum(m.densidade != null ? m.densidade : m.pop / m.areaKm2, 1) + ' hab/km²' : ''; }
  function rrNotaFonte() { return 'Fonte: Censo 2022 (IBGE), SEPLAN-RR (Informativo 013/2023) e MDS (Diagnóstico Socioterritorial, 13/10/2026). Confira os dados oficiais antes de usar em documento.'; }
  function rrDiagLinhas(m) {
    var g = m.diagnostico;
    if (!g) return null;
    var L = [];
    L.push('**CadÚnico (12/12/2025):** ' + rrNum(g.cadFamilias) + ' famílias e ' + rrNum(g.cadPessoas) + ' pessoas; ' + rrNum(g.cadAtualizadas) + ' famílias com cadastro atualizado e ' + rrNum(g.cadDesatualizadas) + ' desatualizadas.');
    if (g.cadAte218 != null) L.push('Renda por pessoa de até R$ 218: ' + rrNum(g.cadAte218) + ' famílias.');
    if (g.cadIndigenas != null) L.push('Pessoas indígenas no CadÚnico: ' + rrNum(g.cadIndigenas) + '.');
    L.push('**Bolsa Família (01/01/2026):** ' + rrNum(g.pbfFamilias) + ' famílias e ' + rrNum(g.pbfPessoas) + ' pessoas.');
    if (g.pbfFamilias && g.cadFamilias) L.push('Cerca de ' + rrPct(g.pbfFamilias, g.cadFamilias) + ' das famílias do CadÚnico recebem Bolsa Família (conta feita com os números acima, nos mesmos setores).');
    L.push('**BPC no CadÚnico:** ' + rrNum(g.bpc) + ' beneficiários (' + rrNum(g.bpcDeficiencia) + ' com deficiência e ' + rrNum(g.bpcIdosos) + ' idosos).');
    L.push('**IVCAD:** ' + String(g.ivcad).replace('.', ',') + ' (quanto mais perto de 1, maior a vulnerabilidade); a dimensão mais alta é Trabalho e Qualificação de Adultos (' + String(g.ivcadTrabalho).replace('.', ',') + ').');
    L.push('_Atenção: são os ' + g.setores + ' setores censitários do relatório, que localizaram ' + String(g.georefPct).replace('.', ',') + '% das famílias do CadÚnico do município (não entram famílias em situação de rua). Não é o total oficial do município._');
    return L;
  }
  function rrSemDiag(m) {
    return 'Ainda não tenho o diagnóstico do CadÚnico **só de ' + m.nome + '**: os relatórios que recebi juntam mais de um município e a soma dos setores não dá para dividir. Os números oficiais estão no VIS Data / Relatório de Informações (MDS) e no Painel do CadÚnico.';
  }
  function rrLinhaPop(m) {
    var s = '**' + m.nome + '** tem **' + rrNum(m.pop) + ' habitantes** (Censo 2022, IBGE), o ' + rrOrd(m) + ' município mais populoso de Roraima, com ' + rrPct(m.pop, rr.estado.pop) + ' da população do estado.';
    return s;
  }
  // Texto curto para a IA (a base do app aceita até 1.500 caracteres por item).
  function rrFichaTexto(m) {
    var t = ['Município: ' + m.nome + (m.capital ? ' (capital de Roraima)' : '') + '. População (Censo 2022, IBGE): ' + rrNum(m.pop) + ', ' + rrOrd(m) + ' de 15 em Roraima (' + rrPct(m.pop, rr.estado.pop) + ' do estado).'];
    var ind = rrIndigena(m); if (ind) t.push('Indígenas (SEPLAN-RR, Censo 2022): ' + ind + '.');
    if (m.areaKm2) t.push('Área: ' + rrNum(m.areaKm2, 2) + ' km² (' + rrDens(m) + ').');
    if (m.nota) t.push(m.nota);
    var g = m.diagnostico;
    if (g) t.push('CadÚnico nos setores do relatório de dez/2025 (cobrem ' + String(g.georefPct).replace('.', ',') + '% das famílias do município): ' + rrNum(g.cadFamilias) + ' famílias, ' + rrNum(g.cadPessoas) + ' pessoas; Bolsa Família (jan/2026): ' + rrNum(g.pbfFamilias) + ' famílias; BPC: ' + rrNum(g.bpc) + '; IVCAD ' + String(g.ivcad).replace('.', ',') + '.');
    else t.push('Não há diagnóstico de CadÚnico só deste município na base.');
    var un = rrUnidades(m), cr = un.filter(function (d) { return /^CRE?AS\b/i.test(d.name || ''); }).map(function (d) { return d.name; });
    if (cr.length) t.push('CRAS/CREAS no diretório: ' + cr.join(', ') + '.');
    t.push('Use SOMENTE estes números; o que não estiver aqui, diga que não está na base. Não invente.');
    return t.join(' ').slice(0, 1480);
  }
  function rrFichasIA(m) {
    return rrUnidades(m).slice(0, 10).map(function (d) {
      var sl = slim(d);
      return { nome: sl.name, grupo: grupoDe(d), endereco: sl.address, horario: sl.hours, telefones: sl.phones.join(', '), servicos: 'MUNICÍPIO: ' + m.nome + ' | ' + cut(sl.services, 120), descricao: '' };
    });
  }
  function rrEstadoTexto() {
    var e = rr.estado;
    return 'Roraima (IBGE, Censo 2022): ' + rrNum(e.pop) + ' habitantes (estimativa 2025: ' + rrNum(e.popEstimada2025) + '), 15 municípios, capital Boa Vista; área ' + rrNum(e.areaKm2, 3) + ' km², densidade ' + String(e.densidade).replace('.', ',') + ' hab/km². Cresceu ' + String(e.crescimentoPct).replace('.', ',') + '% desde 2010. ' + rrNum(e.indigenas) + ' pessoas indígenas (' + String(e.indigenasPct).replace('.', ',') + '%, a maior proporção do Brasil). ' + String(e.ateQuatorzeAnosPct).replace('.', ',') + '% têm até 14 anos. Fronteiras: ' + e.fronteiras + '.';
  }
  var RE_CONTATO = /\b(telefone|fone|endereco|horario|whatsapp|ligar|como chegar|onde fica|email)\b/;
  var RR_POP = /\b(populacao|habitantes?|moradores|quantas pessoas|demografi\w*|censo)\b/;
  var RR_NEG = /\bpopulacao (de rua|em situacao|carceraria|prisional|idosa|infantil|migrante|refugiad\w+|venezuelan\w+|flutuante|atendida)\b/;
  var RR_IND = /\b(indigenas?)\b/;
  var RR_NUM = /\b(quantos?|quantas|percentual|porcentagem|proporcao|numero|total|qual a|qual o|maior|menor|mais|menos|dados|indicadores?)\b/;
  var RR_AREA = /\b(area|km2|km|extensao|densidade|distancia|tamanho)\b/;
  var RR_CAD = /\b(cadunico|cad unico|cadastro unico|familias cadastradas|bolsa familia|pbf|bpc|ivcad|vulnerabilidade)\b/;
  var RR_CADNUM = /\b(quantas?|quantos?|numero|total|dados|indicadores?|percentual|situacao|perfil|indice|beneficiari\w+|familias)\b/;
  var RR_FICHA = /\b(dados|perfil|ficha|panorama|informacoes?|numeros|indicadores|raio x|caracteristicas|fale sobre|fala sobre|conte sobre|me fale|resumo|sobre)\b/;
  var RR_REDE = /\b(unidades|equipamentos|rede|servicos|quant[ao]s? (ubs|escolas?|cras|creas|hospitais|caps|unidades))\b/;
  var RR_COMPARA = /\b(compar\w+|diferenca|versus|vs|x|entre|ou|maior|menor|mais|menos|que)\b/;
  function rrAsk(text) {
    if (!rr) return null;
    var n = norm(text);
    if (!n || n.length > 200 || RE_CONTATO.test(n)) return null;
    if (RR_NEG.test(n)) return null;
    var ms = rrAchar(n), e = rr.estado, seguimento = false;
    // continuação ("e o Bolsa Família?", "e a área?", "e dele?"): usa o último município da conversa
    if (!ms.length && session.munUlt && n.split(' ').length <= 7 && !/\broraima\b|\bmunicipios\b/.test(n) &&
        (/^e (o |a |os |as |de |do |da )?\w+/.test(n) || /\b(dele|dela|la|ai|nesse municipio|desse municipio|neste municipio)\b/.test(n))) ms = [session.munUlt]; seguimento = true;
    var temEstado = /\broraima\b|\bestado\b|\bmunicipios?\b|\bcidades?\b|\binterior\b/.test(n);
    var ctxCras = /\b(cras|creas|paif|paefi)\b/.test(n);
    var res = function (lines, extra) {
      var o = { reply: lines.join('\n'), mood: 'success', badge: 'Roraima', note: rrNotaFonte(), followups: [], units: [] };
      for (var k in extra) o[k] = extra[k];
      return o;
    };
    // --- lista dos municípios ---
    // municípios acima/abaixo de um número de habitantes ("mais de 15 mil habitantes")
    var lim = n.match(/\b(mais|menos|acima|abaixo) de ([\d ]+?)( mil)?( habitantes| pessoas| moradores)\b/);
    if (!ms.length && lim && (temEstado || /\bmunicipios?|cidades?\b/.test(n))) {
      var vl = Number(lim[2].replace(/ /g, '')) * (lim[3] ? 1000 : 1), acima = /mais|acima/.test(lim[1]);
      var fl = rr.municipios.filter(function (x) { return acima ? x.pop > vl : x.pop < vl; }).sort(function (a, b) { return b.pop - a.pop; });
      var Lm = [fl.length + (fl.length === 1 ? ' município' : ' municípios') + ' de Roraima ' + (acima ? 'com mais' : 'com menos') + ' de ' + rrNum(vl) + ' habitantes (Censo 2022):'];
      fl.forEach(function (x) { Lm.push('- **' + x.nome + '** · ' + rrNum(x.pop)); });
      return res(Lm, { followups: ['Quais são os municípios de Roraima?', 'Qual o maior município de Roraima?'] });
    }
    var soInterior = /\binterior\b/.test(n);
    // "quais municípios têm / não têm CREAS (CRAS, CAPS, hospital, UBS, escola)": cruza o diretório com os 15 municípios
    var mq = n.match(/\b(?:quais|que|quantos) municipios (?:do interior )?(nao tem|nao tinham|sem|tem|possuem|contam com|tem algum|tem um)\s*(?:um |uma |algum |alguma )?(cras|creas|caps|hospital|hospitais|ubs|escolas?)\b/);
    if (!ms.length && mq) {
      var tp = { cras: 'CRAS', creas: 'CREAS', caps: 'CAPS', hospital: 'Hospital/unidade mista', hospitais: 'Hospital/unidade mista', ubs: 'UBS', escola: 'Escola', escolas: 'Escola' }[mq[2]];
      var sem = /^(nao|sem)/.test(mq[1]);
      var com = [], sm = [];
      rr.municipios.filter(function (x) { return !x.capital; }).forEach(function (x) {
        var k = rrUnidades(x).filter(function (d) { return rrTipo(d) === tp; });
        (k.length ? com : sm).push({ x: x, k: k });
      });
      var alvo = sem ? sm : com;
      var Lq = [(sem ? 'Municípios do interior **sem ' + tp + '** no diretório do Argo' : 'Municípios do interior **com ' + tp + '** no diretório do Argo') + ' (' + alvo.length + ' de 14):'];
      alvo.forEach(function (o) { Lq.push('- **' + o.x.nome + '**' + (o.k.length ? ' · ' + o.k.map(function (d) { return d.name; }).join(', ') : '')); });
      Lq.push('_Conta só o que está cadastrado: o interior tem cobertura parcial no diretório. Confirme com a secretaria antes de afirmar que um município "não tem"._');
      return res(Lq, { followups: ['Quais municípios ' + (sem ? 'têm ' : 'não têm ') + tp + '?', 'Quais são os municípios de Roraima?'] });
    }
    if (!ms.length && /\b(quantos municipios|quais (sao )?os municipios|lista (de|dos) municipios|municipios de roraima|quantas cidades|cidades de roraima|quais (sao )?as cidades|populacao (de|dos|das) (todos |todas )?(os |as )?(municipios|cidades))\b/.test(n)) {
      var ordenados = rr.municipios.filter(function (x) { return !soInterior || !x.capital; }).sort(function (a, b) { return a.posicao - b.posicao; });
      var L = [soInterior ? 'Os **14 municípios do interior** de Roraima (população do Censo 2022, do maior ao menor):' : 'Roraima tem **15 municípios** (população do Censo 2022, do maior ao menor):'];
      ordenados.forEach(function (m) { L.push('- **' + m.nome + '** · ' + rrNum(m.pop) + (m.capital ? ' (capital)' : '')); });
      L.push(soInterior ? 'Somam **' + rrNum(e.pop - rr.municipios.filter(function (x) { return x.capital; })[0].pop) + '** pessoas (o estado tem ' + rrNum(e.pop) + ').' : 'Total do estado: **' + rrNum(e.pop) + '** pessoas.');
      return res(L, { followups: ['Qual município tem mais indígenas?', 'Compare Pacaraima e Bonfim', 'Dados de Alto Alegre'] });
    }
    // --- ranking: maior, menor, mais populosos, mais indígenas ---
    var depois = /\b(depois d[eo]|segund[ao]|logo apos)\b/.test(n) && ms.length === 1 && ms[0].capital;
    if ((!ms.length || depois) && (temEstado || depois || /\b(populos\w*|indigenas)\b/.test(n)) && /\b(maior|menor|mais|menos|ranking|do maior|ordem)\b/.test(n) && (RR_POP.test(n) || /\bpopulos\w*|indigenas|maior municipio|menor municipio|maior cidade|menor cidade\b/.test(n))) {
      var por = rr.municipios.slice();
      if (RR_IND.test(n)) {
        por = por.filter(function (m) { return m.indPct != null; }).sort(function (a, b) { return b.indPct - a.indPct; });
        var Li = ['Municípios de Roraima com mais indígenas, **em proporção** (SEPLAN-RR, Censo 2022):'];
        por.forEach(function (m) { Li.push('- **' + m.nome + '** · ' + (m.indAprox ? 'cerca de ' : '') + rrNum(m.indPct, m.indPct % 1 ? 1 : 0) + '%' + (m.indPessoas != null ? ' (' + rrNum(m.indPessoas) + ' pessoas)' : '')); });
        Li.push('Em **número de pessoas**, Boa Vista tem a maior população indígena do estado (20.410). Só tenho o percentual dos municípios listados acima.');
        return res(Li, { followups: ['Quantos indígenas vivem em Roraima?', 'Dados de Uiramutã'] });
      }
      var menor = /\b(menor|menos)\b/.test(n);
      var ord = por.sort(function (a, b) { return menor ? a.pop - b.pop : b.pop - a.pop; });
      if (depois) ord = ord.filter(function (x) { return !x.capital; });
      var top = ord[0];
      var Lr = [(menor ? 'O menor' : depois ? 'Depois de Boa Vista, o maior' : 'O maior') + ' município de Roraima em população é **' + top.nome + '**, com **' + rrNum(top.pop) + ' habitantes** (Censo 2022).'];
      Lr.push((menor ? 'Os cinco menores:' : 'Os cinco maiores:'));
      ord.slice(0, 5).forEach(function (m, i) { Lr.push((i + 1) + '. **' + m.nome + '** · ' + rrNum(m.pop)); });
      return res(Lr, { followups: ['Quais são os municípios de Roraima?', 'Dados de ' + top.nome] });
    }
    // --- comparação entre dois municípios ---
    if (ms.length >= 2 && !ctxCras && (RR_COMPARA.test(n) || RR_POP.test(n) || RR_IND.test(n) || RR_CAD.test(n) || RR_FICHA.test(n))) {
      var dois = ms.slice(0, 2), Lc = ['Comparando **' + dois[0].nome + '** e **' + dois[1].nome + '**:'];
      var linhas = [
        ['População (Censo 2022)', function (m) { return rrNum(m.pop) + ' (' + rrOrd(m) + ' do estado)'; }],
        ['Indígenas', function (m) { return rrIndigena(m) || 'sem dado na base'; }],
        ['Área', function (m) { return m.areaKm2 ? rrNum(m.areaKm2, 2) + ' km²' : 'sem dado na base'; }],
        ['CadÚnico (famílias, dez/2025)', function (m) { return m.diagnostico ? rrNum(m.diagnostico.cadFamilias) + ' nos setores do relatório' : 'sem diagnóstico só deste município'; }],
        ['Bolsa Família (famílias, jan/2026)', function (m) { return m.diagnostico ? rrNum(m.diagnostico.pbfFamilias) + ' nos setores do relatório' : 'sem diagnóstico só deste município'; }]
      ];
      linhas.forEach(function (l) { Lc.push('- **' + l[0] + ':** ' + dois[0].nome + ' ' + l[1](dois[0]) + ' · ' + dois[1].nome + ' ' + l[1](dois[1])); });
      return res(Lc, { followups: ['Dados de ' + dois[0].nome, 'Dados de ' + dois[1].nome] });
    }
    if (ms.length) {
      var m = ms[0], bv = m.id === 'boa-vista';
      var quer = null;
      if (RR_CAD.test(n) && (RR_CADNUM.test(n) || seguimento) && !(ctxCras && !/\b(quantas?|quantos?|numero|total)\b/.test(n))) quer = 'cad';
      else if (RR_IND.test(n) && (RR_NUM.test(n) || seguimento)) quer = 'ind';
      else if (RR_AREA.test(n) && !/\b(bairro|rua|avenida)\b/.test(n)) quer = 'area';
      else if (RR_POP.test(n)) quer = 'pop';
      else if (RR_REDE.test(n) && !bv && (!ctxCras || /\b(quantas?|quantos?)\b/.test(n))) quer = 'rede';
      else if (RR_FICHA.test(n) && !RR_CAD.test(n) && n.split(' ').length <= 9 && !(bv && /\b(panorama|perfil)\b/.test(n)) && !ctxCras) quer = 'ficha';
      if (!quer) return null;
      session.terrUlt = { kind: 'CRAS', ref: m.nome }; session.munUlt = m;
      var segue = ['Qual CRAS atende ' + m.nome + '?'];
      var extra = { followups: segue };
      if (quer === 'pop') {
        var Lp = [rrLinhaPop(m)];
        var ip = rrIndigena(m); if (ip) Lp.push('Indígenas: ' + ip + ' (SEPLAN-RR).');
        if (m.nota) Lp.push(m.nota);
        extra.followups = ['Dados de ' + m.nome, 'Quantos indígenas em ' + m.nome + '?'].concat(m.diagnostico ? [] : ['Qual o maior município de Roraima?']).slice(0, 3);
        return res(Lp, extra);
      }
      if (quer === 'ind') {
        var ii = rrIndigena(m), Li2;
        if (ii) { Li2 = ['Em **' + m.nome + '**: ' + ii + ' (SEPLAN-RR, Informativo 013/2023, sobre o Censo 2022).']; if (m.diagnostico && m.diagnostico.cadIndigenas != null) Li2.push('No CadÚnico, nos setores do relatório de dez/2025, há ' + rrNum(m.diagnostico.cadIndigenas) + ' pessoas indígenas cadastradas.'); }
        else {
          var tI = rr.municipios.filter(function (x) { return x.indPct != null && x.id !== 'boa-vista'; }).sort(function (a, b) { return b.indPct - a.indPct; })
            .map(function (x) { return x.nome + ' (' + (x.indAprox ? 'cerca de ' : '') + rrNum(x.indPct, x.indPct % 1 ? 1 : 0) + '%)'; }).join(', ');
          Li2 = ['Não tenho o dado de indígenas de **' + m.nome + '** na minha base. Tenho o percentual de ' + tI + ' e o número de pessoas de Boa Vista (20.410). No estado são **' + rrNum(e.indigenas) + '** indígenas (' + String(e.indigenasPct).replace('.', ',') + '%).'];
        }
        extra.followups = ['Qual município tem mais indígenas?', 'Dados de ' + m.nome];
        return res(Li2, extra);
      }
      if (quer === 'area') {
        var La;
        if (m.areaKm2) { La = ['**' + m.nome + '** tem **' + rrNum(m.areaKm2, 2) + ' km²** e densidade de cerca de ' + rrDens(m) + '.']; if (m.nota) La.push(m.nota); }
        else {
          var tem = rr.municipios.filter(function (x) { return x.areaKm2; }).map(function (x) { return x.nome; });
          La = ['Não tenho a área de **' + m.nome + '** na minha base (tenho de ' + tem.join(', ') + '). Confira no IBGE Cidades.'];
          if (m.nota) La.push(m.nota);
        }
        extra.followups = ['Quantos habitantes tem ' + m.nome + '?', 'Dados de ' + m.nome];
        return res(La, extra);
      }
      if (quer === 'cad') {
        var Ld = rrDiagLinhas(m);
        var Lh = Ld ? ['**' + m.nome + '** · CadÚnico, Bolsa Família e BPC:'].concat(Ld) : [rrSemDiag(m)];
        extra.followups = ['Dados de ' + m.nome, 'Qual CRAS atende ' + m.nome + '?'];
        return res(Lh, extra);
      }
      if (quer === 'rede') {
        var un = rrUnidades(m);
        if (!un.length) return res(['Não há unidades de **' + m.nome + '** cadastradas no diretório do Argo.'], { mood: 'notfound', followups: ['Dados de ' + m.nome] });
        var cont = {}, ordem = [];
        un.forEach(function (d) { var t = rrTipo(d); if (!cont[t]) { cont[t] = []; ordem.push(t); } cont[t].push(d); });
        // "quantas UBS / escolas / CRAS em X": conta só o tipo pedido (nunca o número de Boa Vista)
        var pedido = /\bubs\b/.test(n) ? 'UBS' : /\bescolas?\b/.test(n) ? 'Escola' : /\bcreas\b/.test(n) ? 'CREAS' : /\bcras\b/.test(n) ? 'CRAS' : /\bhospitais\b|\bhospital\b/.test(n) ? 'Hospital/unidade mista' : /\bcaps\b/.test(n) ? 'CAPS' : '';
        if (pedido) {
          var lt = cont[pedido] || [], Lq;
          if (!lt.length) Lq = ['No diretório do Argo **não há ' + pedido + '** cadastrada(o) em **' + m.nome + '**. O interior tem cobertura parcial: confirme com a secretaria do município.'];
          else Lq = ['No diretório do Argo constam **' + lt.length + ' ' + pedido + '** em **' + m.nome + '**: ' + lt.map(function (d) { return d.name; }).join(', ') + '.', '_O interior tem cobertura parcial no diretório: pode haver unidades ainda não cadastradas._'];
          return res(Lq, { mood: lt.length ? 'success' : 'notfound', followups: ['Unidades de ' + m.nome, 'Dados de ' + m.nome], units: lt.slice(0, 5).map(slim), unitsAll: lt.map(slim), badge: 'Roraima · Rede' });
        }
        var Lu = ['O diretório do Argo tem **' + un.length + ' unidades** cadastradas em **' + m.nome + '**:'];
        ordem.forEach(function (t) { Lu.push('- **' + t + '** (' + cont[t].length + '): ' + cont[t].map(function (d) { return d.name; }).join(', ')); });
        Lu.push('_O interior tem cobertura parcial no diretório: pode haver unidades que ainda não foram cadastradas._');
        return res(Lu, { followups: segue.concat(['Dados de ' + m.nome]), units: un.slice(0, 5).map(slim), unitsAll: un.map(slim), badge: 'Roraima · Rede' });
      }
      // ficha completa
      var Lf = ['**' + m.nome + '**' + (m.capital ? ' (capital)' : '') + ' · ficha do município:'];
      Lf.push('- **População:** ' + rrNum(m.pop) + ' (Censo 2022) · ' + rrOrd(m) + ' de 15 · ' + rrPct(m.pop, e.pop) + ' do estado');
      var ifi = rrIndigena(m); if (ifi) Lf.push('- **Indígenas:** ' + ifi);
      if (m.areaKm2) Lf.push('- **Área:** ' + rrNum(m.areaKm2, 2) + ' km² · ' + rrDens(m));
      if (m.nota) Lf.push('- ' + m.nota);
      var Lg = rrDiagLinhas(m);
      if (Lg) Lg.forEach(function (x) { Lf.push(/^_/.test(x) ? x : '- ' + x); });
      else Lf.push('- **CadÚnico:** ' + rrSemDiag(m));
      var un2 = rrUnidades(m), crs = un2.filter(function (d) { return /^CRE?AS\b/i.test(d.name || ''); });
      if (crs.length) Lf.push('- **CRAS/CREAS no diretório:** ' + crs.map(function (d) { return d.name; }).join(', '));
      return res(Lf, { followups: ['Unidades de ' + m.nome, 'Qual CRAS atende ' + m.nome + '?', 'Compare ' + m.nome + ' e ' + (m.id === 'boa-vista' ? 'Pacaraima' : 'Boa Vista')], units: crs.slice(0, 5).map(slim), unitsAll: crs.map(slim) });
    }
    // --- estado de Roraima (sem município na pergunta) ---
    if (/\broraima\b/.test(n) || /\b(estado)\b/.test(n)) {
      if (RR_IND.test(n) && RR_NUM.test(n)) {
        return res(['Roraima tem **' + rrNum(e.indigenas) + '** pessoas indígenas (Censo 2022), **' + String(e.indigenasPct).replace('.', ',') + '%** da população, a maior proporção do Brasil. Em 2010 eram 55.922.', rrNum(e.indigenasEmTerras) + ' moram em terras indígenas e ' + rrNum(e.indigenasForaTerras) + ' fora delas.'], { followups: ['Qual município tem mais indígenas?', 'Quais são os municípios de Roraima?'] });
      }
      if (RR_POP.test(n) || RR_AREA.test(n) || /\b(cresc\w+|jovens?|fronteiras?)\b/.test(n) || (RR_FICHA.test(n) && n.split(' ').length <= 9)) {
        var Le = ['**Roraima** · números do estado:',
          '- **População:** ' + rrNum(e.pop) + ' (Censo 2022); estimativa do IBGE para 2025: ' + rrNum(e.popEstimada2025),
          '- **Municípios:** 15; capital Boa Vista (' + rrPct(rr.municipios.filter(function (x) { return x.id === 'boa-vista'; })[0].pop, e.pop) + ' da população)',
          '- **Área:** ' + rrNum(e.areaKm2, 3) + ' km² · ' + String(e.densidade).replace('.', ',') + ' hab/km²',
          '- **Crescimento:** +' + String(e.crescimentoPct).replace('.', ',') + '% entre 2010 e 2022, o maior do país',
          '- **Jovens:** ' + String(e.ateQuatorzeAnosPct).replace('.', ',') + '% têm até 14 anos',
          '- **Indígenas:** ' + rrNum(e.indigenas) + ' (' + String(e.indigenasPct).replace('.', ',') + '%)',
          '- **Fronteiras:** ' + e.fronteiras];
        return res(Le, { followups: ['Quais são os municípios de Roraima?', 'Qual o maior município de Roraima?', 'Qual município tem mais indígenas?'] });
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Encaminhamento por perfil, para toda a aba de assistência social:
  // acolhimento, violência, pessoa idosa, benefícios eventuais, CAS.
  // Só aponta unidades que existem no diretório e usa o que a ficha diz.
  // ---------------------------------------------------------------------
  function porId(ids) {
    return ids.map(function (id) { return data.filter(function (d) { return d.id === id; })[0]; }).filter(Boolean);
  }
  function encaminhar(text, dir) {
    var n = norm(text);
    if (!n || n.length > 260) return null;
    if (/^(o que|oque|que e|qual a diferenca|como funciona|para que serve|defina)\b/.test(n) || /\b(o que (e|sao|significa)|oque (e|sao)|que sao|significa|definicao|conceito|direitos)\b/.test(n)) return null;
    // resposta curta a uma pergunta anterior ("14 anos, menina"): junta com o assunto pendente
    if (session.pendente === 'acolhimento') {
      if (n.length <= 70 && !/\b(acolh|abrig)/.test(n) && /\b(crianca|bebe|menin\w*|adolescente|jovem|idos\w*|rua|adulto|adultos|homem|mulher|filh\w*|garot\w*|rapaz|\d+\s*anos?)\b/.test(n)) n = 'preciso de acolhimento ' + n;
      else if (!/\b(acolh|abrig)/.test(n)) session.pendente = '';
    }
    // nome de unidade bem identificado ("endereço da Casa de Passagem"): quem responde é o diretório
    if (dir && dir.mode === 'single' && dir.confidence >= 0.85) return null;
    var idade = (n.match(/\b(\d{1,3})\s*(anos|ano|a)\b/) || [])[1]; idade = idade ? parseInt(idade, 10) : null;
    var acolh = /\b(acolh\w*|abrig\w*|vaga|casa de passagem|desabrig\w*)\b/.test(n);
    var rua = /\b(situacao de rua|morador de rua|moradora de rua|em situacao de rua|dormindo na rua|vivendo na rua)\b/.test(n);
    var enc = /\b(encaminh\w*|onde|para onde|preciso|precisa|tem|existe|quero|caso|familia|atendimento|levar|mandar|procurar)\b/.test(n);
    var crianca = /\b(crianca|criancas|bebe|menininho|menininha|infantil)\b/.test(n) || (idade !== null && idade < 12);
    var adolesc = /\b(adolescente|adolescentes|menor|jovem)\b/.test(n) || (idade !== null && idade >= 12 && idade < 18);
    var fem = /\b(menina|feminino|feminina|filha|garota|mulher)\b/.test(n), masc = /\b(menino|masculino|masculina|filho|garoto|rapaz|homem)\b/.test(n);
    var idoso = /\b(idoso|idosa|idosos|idosas|pessoa idosa|terceira idade|velhinho|velhinha)\b/.test(n) || (idade !== null && idade >= 60);
    var violencia = /\b(violencia|agredid\w*|agress\w*|ameac\w*|apanh\w*|maria da penha|espanc\w*)\b/.test(n);
    var sexual = /\b(sexual|abuso sexual|estupro|abusad\w*|escuta especializada)\b/.test(n);
    var mulher = /\b(mulher|mulheres|esposa|companheira|namorada|ex mulher|agredida|ameacada|espancada|violentada|abusada|perseguida)\b/.test(n);
    var r = null;

    if ((crianca || adolesc) && sexual) {
      r = { ids: ['cai-18-de-maio'], t: 'crianças e adolescentes vítimas ou testemunhas de violência sexual' };
    } else if (mulher && violencia && !(crianca && !mulher)) {
      r = { ids: ['casa-da-mulher-brasileira'], t: 'mulher em situação de violência', extra: 'Em risco imediato, ligue 190. O 180 orienta e registra denúncia.' };
    } else if (idoso && (acolh || rua)) {
      r = { ids: ['ciapi'], t: 'pessoa idosa', extra: 'Não há abrigo para pessoa idosa cadastrado no diretório. O CIAPI é a unidade de atenção à pessoa idosa; confirme com ele ou com o CREAS a referência para acolhimento.', semAbrigo: true };
    } else if (acolh && (crianca || adolesc) && enc) {
      var ids;
      if (crianca && !adolesc) ids = ['casa-acolhimento-infantil-viva-crianca', 'abrigo-pedra-pintada'];
      else if (fem && !masc) ids = ['abrigo-feminino-pastor-josue'];
      else if (masc && !fem) ids = ['abrigo-masculino-setrabes'];
      else ids = ['abrigo-feminino-pastor-josue', 'abrigo-masculino-setrabes'];
      r = { ids: ids, t: crianca && !adolesc ? 'acolhimento de criança' : 'acolhimento de adolescente', extra: 'O acolhimento de crianças e adolescentes é feito sob medida protetiva. Confirme o fluxo e a existência de vaga com a unidade antes de encaminhar.' };
    } else if (acolh && (rua || /\b(adulto|adultos|homem|mulher|pessoa)\b/.test(n)) && enc) {
      r = { ids: ['casa-de-passagem-setrabes'], t: 'adulto em situação de rua (acolhimento temporário)', extra: 'Confirme critérios e vaga com a unidade antes de encaminhar.' };
    } else if (idoso && enc) {
      r = { ids: ['ciapi'], t: 'pessoa idosa' };
    } else if (/\b(beneficio eventual|beneficios eventuais|cesta da familia|cesta basica|passe livre|auxilio funeral|colo de mae|auxilio natalidade)\b/.test(n)) {
      r = { ids: ['ceac'], t: 'benefícios eventuais e programas sociais do Estado' };
    } else if (/\b(capoeira|jiu jitsu|futsal|bale|ritbox|ginastica ritmica)\b/.test(n)) {
      r = { ids: ['cas-cidade-satelite'], t: 'atividades esportivas e culturais' };
    }
    if (!r && (crianca || adolesc) && violencia && !mulher && enc && !/\b(o que fazer|como (denunciar|proceder|agir|atuar)|denunciar|denuncia|fluxo|procedimento|notificar|notificacao)\b/.test(n)) {
      session.pendente = 'violencia-crianca';
      return { reply: 'Para indicar a unidade certa, preciso saber: a violência foi **sexual**?\n- **Sim:** o CAI 18 de Maio atende crianças e adolescentes vítimas ou testemunhas de violência sexual.\n- **Não** (física, psicológica, negligência...): a referência é o CREAS do bairro, junto com o Conselho Tutelar.', mood: 'info', followups: ['Foi violência sexual', 'Foi outro tipo de violência'], badge: 'Rede socioassistencial', units: [], unitsAll: [] };
    }
    if (!r && acolh && enc && !(crianca || adolesc || rua || idoso || mulher || violencia)) {
      session.pendente = 'acolhimento';
      return { reply: 'Para indicar o acolhimento certo, preciso saber o perfil de quem precisa:\n- **criança** ou **adolescente** (diga a idade e se é menino ou menina)\n- **adulto em situação de rua**\n- **pessoa idosa**\n- **mulher em situação de violência**', mood: 'info', followups: ['Menina de 14 anos', 'Criança de 6 anos', 'Adulto em situação de rua'], badge: 'Rede socioassistencial', units: [], unitsAll: [] };
    }
    if (!r) return null;
    session.pendente = '';
    var us = porId(r.ids);
    if (!us.length) return null;
    var lines = ['Para **' + r.t + '**, a referência no diretório ' + (us.length > 1 ? 'são:' : 'é:')];
    us.forEach(function (d) {
      var sl = slim(d);
      lines.push('- **' + sl.name + '**' + (sl.address ? ' · ' + cut(sl.address, 90) : '') + (sl.phones.length ? ' · ' + sl.phones.slice(0, 2).join(' / ') : ''));
      if (sl.services && !r.semAbrigo) lines.push('  ' + cut(sl.services, 140));
    });
    if (r.extra) lines.push(r.extra);
    return { reply: lines.join('\n'), mood: 'success', followups: ['Qual o telefone?', 'Qual o horário?'], badge: 'Rede socioassistencial', units: us.map(slim).slice(0, 5), unitsAll: us.map(slim) };
  }

  // Respostas curtas a uma pergunta que o Argo acabou de fazer (violência contra criança/adolescente)
  function seguimentoPendente(text) {
    var n = norm(text);
    if (!session.pendente || !n || n.length > 80) return null;
    if (session.pendente === 'violencia-crianca') {
      if (/\b(sexual|abuso sexual|estupro|sim|foi sim)\b/.test(n) && !/\b(nao|outro|outra|fisica|negligencia|psicologica)\b/.test(n)) {
        session.pendente = '';
        return encaminhar('crianca vitima de violencia sexual', null);
      }
      if (/\b(nao|outro|outra|fisica|negligencia|psicologica|abandono|maus tratos)\b/.test(n)) {
        session.pendente = 'creas-bairro';
        return { reply: 'Para outras violências contra criança ou adolescente, a referência é o **CREAS** do território (Proteção Social Especial), junto com o **Conselho Tutelar**.\nDiga o **bairro** onde a família mora que eu mostro o CREAS.', mood: 'info', followups: ['Moro no Caimbé', 'Moro no Centro'], badge: 'Rede socioassistencial', units: [], unitsAll: [] };
      }
      return null;
    }
    if (session.pendente === 'creas-bairro') {
      var r = municipio('qual creas atende ' + text) || territory('qual creas atende ' + text);
      if (r && r.mood !== 'notfound' && r.mood !== 'info') { session.pendente = ''; return r; }
    }
    return null;
  }

  // "e o CREAS?", "e no Alvorada?", "e em Bonfim?": continua o último assunto de território
  function seguimentoTerr(text) {
    var ult = session.terrUlt, n = norm(text);
    if (!ult || !ult.ref || !n || n.length > 60) return null;
    var q = parseQuery(text);
    if (q.fone || q.end || q.hora || q.serv) return null;
    var troca = n.match(/^(?:e\s+)?(?:o\s+|a\s+|no\s+|na\s+|se\s+for\s+(?:o\s+|a\s+)?)?(cras|creas|ct|conselho tutelar|dp|distrito policial|delegacia|caps|ubs|posto de saude|restaurante cidadao|restaurante)(?:\s+de\s+referencia|\s+dele|\s+dela|\s+la|\s+dai)?$/);
    var cand = troca ? 'qual ' + troca[1] + ' atende ' + ult.ref : null;
    if (!cand) {
      var o = n.match(/^e\s+(?:se\s+(?:for|fosse|moram?)\s+)?(?:o\s+|a\s+|no\s+|na\s+|em\s+|de\s+|do\s+|da\s+)?(.{3,40})$/);
      if (!o) return null;
      cand = 'qual ' + ult.kind.toLowerCase() + ' atende ' + o[1];
    }
    var r = municipio(cand) || territory(cand);
    return r && r.mood !== 'notfound' && r.mood !== 'info' ? r : null;
  }

  // ---------------------------------------------------------------------
  // CID-11 (Capítulo 06, transtornos mentais): código → transtorno e nome → código.
  // Resposta direta da tabela (assets/cid11.json), sem IA e sem internet: nunca inventa código.
  // ---------------------------------------------------------------------
  var cid = null; // { map, kids, list, grupos, fonte, aviso }
  var CID_STOP = asSet(('qual quais o a os as de do da dos das no na nos nas em por para que e eh um uma ao com ' +
    'codigo codigos cid cid11 11 numero cod diagnostico classificacao internacional doenca doencas ' +
    'me diga diz dizer quero saber mostre mostrar buscar busca procurar procure ver tem existe seria significa significado ' +
    'esse essa este esta isso aqui ali como se ficou fica sao ser eu voce favor pode podem consulta consultar').split(' '));
  var CID_GENERICAS = asSet(['transtorno', 'transtornos', 'disturbio', 'disturbios', 'desordem', 'desordens', 'perturbacao', 'sindrome']);
  // siglas usadas no dia a dia, que não aparecem nos títulos
  var CID_SIGLAS = {
    tea: 'espectro autismo', tdah: 'deficit atencao hiperatividade', toc: 'obsessivo compulsivo',
    tept: 'estresse pos traumatico', tag: 'ansiedade generalizada', tdi: 'identidade dissociativo', tpb: 'personalidade borderline'
  };
  // CID-10 → agrupamento da CID-11 (quadro de comparação do Guia de Referência da CID-11, OMS)
  var CID10_BLOCOS = [
    ['F00', 'F09', 'Transtornos neurocognitivos'],
    ['F10', 'F19', 'Transtornos decorrentes do uso de substâncias ou comportamentos aditivos'],
    ['F20', 'F29', 'Esquizofrenia ou outros transtornos psicóticos primários'],
    ['F30', 'F39', 'Transtornos do humor'],
    ['F40', 'F48', 'Transtornos de ansiedade ou relacionados ao medo'],
    ['F60', 'F69', 'Transtornos de personalidade e traços relacionados'],
    ['F70', 'F79', 'Transtornos do neurodesenvolvimento'],
    ['F80', 'F89', 'Transtornos do neurodesenvolvimento'],
    ['F90', 'F98', 'Transtornos do neurodesenvolvimento']
  ];
  function cidStem(w) { return w.length > 5 ? w.slice(0, 5) : w; }
  function setCid(json) {
    cid = null;
    if (!json || !Array.isArray(json.itens) || !json.itens.length) return;
    var map = {}, kids = {}, list = [];
    json.itens.forEach(function (it) {
      var c = String(it[0]).toUpperCase(), t = String(it[1]);
      var toks = tok(t).map(cidStem);
      map[c] = t;
      list.push({ c: c, t: t, tk: toks });
      if (c.length > 4) { var cat = c.slice(0, 4); (kids[cat] = kids[cat] || []).push(c); }
    });
    cid = { map: map, kids: kids, list: list, grupos: json.grupos || {}, fonte: json.fonte || '', aviso: json.aviso || '' };
  }
  function cidNota() {
    return 'Fonte: ' + (cid && cid.fonte ? cid.fonte : 'OMS, CID-11, Capítulo 06') +
      '. Os títulos podem estar imprecisos: confirme em icd.who.int antes de registrar.';
  }
  function cidPai(c) {
    // 6A20.0Z → 6A20.0 → 6A20
    var p = c;
    while (p.length > 4) { p = p.length > 6 ? p.slice(0, -1) : p.slice(0, p.indexOf('.')); if (cid.map[p] && p !== c) return p; }
    return '';
  }
  function cidLinhaCodigo(c) {
    if (!cid.map[c]) return null;
    var pai = c.length > 4 ? cidPai(c) : '';
    var cat = c.slice(0, 4);
    var linhas = ['**' + c + '** — ' + cid.map[c]];
    var g = cid.grupos[c.slice(0, 3)];
    if (pai) linhas.push('- Dentro de **' + pai + '** — ' + cid.map[pai]);
    else if (c.length > 4 && cid.map[cat]) linhas.push('- Dentro de **' + cat + '** — ' + cid.map[cat]);
    if (g) linhas.push('- Grupo: ' + g);
    var filhos = c.length === 4 ? (cid.kids[c] || []) : [];
    if (filhos.length) {
      var diretos = filhos.filter(function (k) { return !/^.{4}\.[0-9A-Z]{2,}/.test(k); });
      var mostrar = (diretos.length ? diretos : filhos).slice(0, 10);
      linhas.push('- Subcódigos (' + (diretos.length || filhos.length) + '):');
      mostrar.forEach(function (k) { linhas.push('  - **' + k + '** — ' + cut(cid.map[k], 160)); });
      if ((diretos.length || filhos.length) > mostrar.length) linhas.push('  - … e mais ' + ((diretos.length || filhos.length) - mostrar.length) + '. Pergunte pelo subcódigo para ver o nome.');
    }
    return linhas.join('\n');
  }
  function cidResultado(reply) {
    return { reply: reply, mood: 'info', badge: 'CID-11', note: cidNota(), quickActions: [], followups: [], units: [] };
  }
  function cidBuscaPorNome(n) {
    var q = n.split(' ').filter(function (t) { return t && !CID_STOP[t]; });
    var exp = [];
    q.forEach(function (t) { if (CID_SIGLAS[t]) exp = exp.concat(CID_SIGLAS[t].split(' ')); else exp.push(t); });
    q = exp;
    if (q.some(function (t) { return !CID_GENERICAS[t]; })) q = q.filter(function (t) { return !CID_GENERICAS[t]; });
    q = uniq(q);
    if (!q.length) return { vazio: true };
    var qs = q.map(cidStem);
    var min = Math.max(1, Math.ceil(q.length * 0.75));
    var achados = [];
    cid.list.forEach(function (it) {
      var hit = 0;
      qs.forEach(function (w) { if (it.tk.some(function (t) { return t === w || (w.length >= 4 && t.indexOf(w) === 0); })) hit++; });
      if (hit >= min) achados.push({ it: it, hit: hit });
    });
    achados.sort(function (a, b) {
      return (b.hit - a.hit) || (a.it.c.length - b.it.c.length) || (a.it.t.length - b.it.t.length) || (a.it.c < b.it.c ? -1 : 1);
    });
    return { achados: achados, termos: q };
  }
  function cidAsk(text) {
    var n = norm(text);
    var temCid = /(^| )cid( |$)/.test(n) || /(^| )cid ?11( |$)/.test(n);
    var temCodigo = /(^| )codigos?( |$)/.test(n);
    var upper = String(text).toUpperCase();
    var codigos = [], m, re = /(^|[^0-9A-Z])(6[A-E][0-9A-Z]{2}(?:\.[0-9A-Z]{1,3})?)(?![0-9A-Z])/g;
    while ((m = re.exec(upper))) if (codigos.indexOf(m[2]) < 0) codigos.push(m[2]);
    if (codigos.length) {
      if (!cid) return cidResultado('A tabela da CID-11 ainda não carregou neste aparelho. Abra o Argo uma vez com internet e tente de novo.');
      var partes = [], faltou = [];
      codigos.slice(0, 4).forEach(function (c) { var l = cidLinhaCodigo(c); if (l) partes.push(l); else faltou.push(c); });
      if (faltou.length) {
        faltou.forEach(function (c) {
          var cat = c.slice(0, 4);
          if (cid.map[cat] && c.length > 4) partes.push('Não achei o subcódigo **' + c + '** na tabela. A categoria **' + cat + '** existe:\n' + cidLinhaCodigo(cat));
          else partes.push('Não achei **' + c + '** na tabela do Capítulo 06 (transtornos mentais, comportamentais ou do neurodesenvolvimento). Confira o código ou consulte icd.who.int.');
        });
      }
      return cidResultado(partes.join('\n\n'));
    }
    var f = /(^|[^A-Z0-9])F([0-9]{2})(?:\.[0-9])?(?![0-9A-Z])/.exec(upper);
    if (f && (temCid || temCodigo || /^\s*F[0-9]{2}(\.[0-9])?\s*[?.!]?\s*$/i.test(text))) {
      var num = Number(f[2]);
      var bloco = CID10_BLOCOS.filter(function (b) { return num >= Number(b[0].slice(1)) && num <= Number(b[1].slice(1)); })[0];
      return cidResultado('**F' + f[2] + '** é código da **CID-10**; esta consulta é da **CID-11** (códigos 6A00 a 6E8Z).' +
        (bloco ? '\n- Na CID-11, o bloco **' + bloco[0] + '-' + bloco[1] + '** corresponde a "' + bloco[2] + '" (quadro de comparação do Guia de Referência da CID-11).' : '') +
        '\nPara achar o código novo, pergunte pelo nome. Exemplo: "CID de episódio depressivo".');
    }
    if (!(temCid || temCodigo)) return null;
    // "o que é a CID-11?" é dúvida de conteúdo: segue para a base de normas/IA
    if (/^(o que (e|eh)|para que serve|como funciona|qual a diferenca|o que mudou)\b/.test(n)) return null;
    if (!cid) return cidResultado('A tabela da CID-11 ainda não carregou neste aparelho. Abra o Argo uma vez com internet e tente de novo.');
    var r = cidBuscaPorNome(n);
    // só a palavra "código" (sem "CID") não basta para sequestrar a pergunta: sem achado, segue o fluxo normal
    if (r.vazio) {
      if (!temCid) return null;
      return cidResultado('Digite um **código** da CID-11 (ex.: 6A02) para ver o transtorno, ou o **nome** (ex.: "CID de ansiedade generalizada") para ver o código.\nA tabela cobre o Capítulo 06: transtornos mentais, comportamentais e do neurodesenvolvimento.');
    }
    if (!r.achados.length) {
      if (!temCid) return null;
      return cidResultado('Não achei "' + r.termos.join(' ') + '" na tabela do Capítulo 06. Tente outra palavra do nome (ex.: "depressivo", "ansiedade", "autismo") ou consulte icd.who.int.');
    }
    var topo = r.achados.slice(0, 8);
    var txt = ['Códigos da CID-11 que combinam com "' + r.termos.join(' ') + '":'];
    topo.forEach(function (a) { txt.push('- **' + a.it.c + '** — ' + cut(a.it.t, 110)); });
    if (r.achados.length > topo.length) txt.push('Mostrando ' + topo.length + ' de ' + r.achados.length + '. Acrescente mais uma palavra do nome para refinar.');
    txt.push('Para ver os detalhes de um deles, pergunte pelo código (ex.: ' + topo[0].it.c + ').');
    return cidResultado(txt.join('\n'));
  }

  // ---------------------------------------------------------------------
  // Contagem por bairro: "quantas escolas tem no Caimbé?", "quantas UBS em Boa Vista?"
  // O NÚMERO É CALCULADO AQUI, em código, sobre as fichas do diretório (data.js). A IA nunca conta:
  // ela só recebia 7-10 fichas soltas e totais por grupo, por isso errava "quantas ... no bairro".
  // A resposta sempre diz que é a contagem do diretório (não um censo oficial).
  // ---------------------------------------------------------------------
  var ESPECIAL_RE = /^(CAP-DVRR|CADAHS|CAS|CAEBV)$|^Centro Mun\. Integrado/i;
  var AVISO_ESCOLA = 'Conta só as escolas estaduais e municipais cadastradas no diretório do Argo: escolas particulares e unidades ainda não cadastradas não entram. Para o número oficial, consulte o Censo Escolar (INEP), a SEED ou a SMEC.';
  var AVISO_DIR = 'Conta só o que está cadastrado no diretório do Argo; confirme com a rede antes de usar o número em relatório.';
  var CONT_TIPOS = [
    { key: 'ESCOLA', sing: 'escola', plur: 'escolas', fem: true, list: true, aviso: AVISO_ESCOLA, tambem: ['CRECHE', 'CENTRO'],
      det: /\b(escolas?|colegios?|ensino fundamental|ensino medio)\b/,
      match: function (d) { return /^(Rede Estadual|Rede Municipal - Escolas)$/.test(d.group || '') && !ESPECIAL_RE.test(d.name || ''); },
      sub: function (d) { return /Estadual/.test(d.group) ? 'estadual' : 'municipal'; } },
    { key: 'CRECHE', sing: 'creche', plur: 'creches', fem: true, list: true, aviso: AVISO_ESCOLA.replace('as escolas estaduais e municipais', 'as creches e unidades Proinfância municipais'),
      det: /\b(creches?|proinfancia|nucleos? de creche|casa mae)\b/,
      match: function (d) { return d.group === 'Rede Municipal - Creches e Proinfância'; } },
    { key: 'CENTRO', sing: 'centro de atendimento educacional especializado', plur: 'centros de atendimento educacional especializado', fem: false, list: true, aviso: AVISO_DIR,
      det: /\b(educacao especial|atendimento educacional especializado)\b/,
      match: function (d) { return /^(Rede Estadual|Rede Municipal - Escolas)$/.test(d.group || '') && ESPECIAL_RE.test(d.name || ''); } },
    { key: 'SUPERIOR', sing: 'instituição de ensino superior', plur: 'instituições de ensino superior', fem: true, list: true, aviso: AVISO_DIR,
      det: /\b(faculdades?|universidades?|ensino superior)\b/,
      match: function (d) { return d.group === 'Ensino Superior'; } },
    { key: 'UBS', sing: 'UBS', plur: 'UBS', fem: true, list: false, aviso: AVISO_DIR + ' A UBS de referência de uma família segue a área da equipe de saúde da família e pode não ser a do bairro onde ela mora.',
      det: /\bubs\b|\bpostos? de saude\b|\bpostinhos?\b|\bunidades? basicas? de saude\b/,
      match: function (d) { return /^UBS\b/i.test(d.name || ''); } },
    { key: 'CAPS', sing: 'CAPS', plur: 'CAPS', fem: false, list: false, aviso: AVISO_DIR,
      det: /\bcaps\b/, match: function (d) { return /^CAPS \(Boa Vista\)/i.test(d.group || ''); } },
    { key: 'CRAS', sing: 'CRAS', plur: 'CRAS', fem: false, list: false, aviso: AVISO_DIR,
      det: /\bcras\b/, match: function (d) { return d.group === 'CRAS (Boa Vista)'; } },
    { key: 'CREAS', sing: 'CREAS', plur: 'CREAS', fem: false, list: false, aviso: AVISO_DIR,
      det: /\bcreas\b/, match: function (d) { return d.group === 'CREAS (Boa Vista)'; } },
    { key: 'HOSPITAL', sing: 'hospital', plur: 'hospitais', fem: false, list: true, aviso: AVISO_DIR,
      det: /\bhospita(?:l|is)\b/, match: function (d) { return d.group === 'Hospitais'; } },
    { key: 'RESTAURANTE', sing: 'Restaurante Cidadão', plur: 'Restaurantes Cidadão', fem: false, list: false, aviso: AVISO_DIR,
      det: /\brestaurantes? cidada[oa]s?\b|\brestaurantes?\b/, match: function (d) { return /Restaurante Cidad/i.test(d.group || ''); } },
    { key: 'BOMBEIROS', sing: 'unidade do Corpo de Bombeiros', plur: 'unidades do Corpo de Bombeiros', fem: true, list: true, aviso: AVISO_DIR,
      det: /\bbombeiros?\b/, match: function (d) { return /^Corpo de Bombeiros/i.test(d.group || ''); } }
  ];
  function contTipo(key) { return CONT_TIPOS.filter(function (t) { return t.key === key; })[0]; }

  // Bairro do endereço: o trecho "- Bairro, Boa Vista" (ou "Bairro, Boa Vista"); ignora rua, número, campus, bloco etc.
  var NAO_BAIRRO = /^(rua|r|av|avenida|travessa|tv|praca|rodovia|br \d+|rr \d+|vicinal|lote|quadra|campus|andar|bloco|sala|casa|km|s n|n \d+|cep|endereco|atendimento|diversas|rede|sem|atuacao|cras|creas|ubs|antigo|esquina)\b|^\d+$/;
  function bairroBruto(addr) {
    var linhas = cleanText(addr).split(' · '), lin = '', i;
    for (i = 0; i < linhas.length; i++) if (/Boa Vista/i.test(linhas[i])) { lin = linhas[i]; break; }
    if (!lin) return '';
    var segs = lin.split(',').map(function (s) { return s.trim(); }), ib = -1;
    for (i = 0; i < segs.length; i++) if (/^Boa Vista/i.test(segs[i])) { ib = i; break; }
    if (ib < 1) return '';
    function ok(b) { var nb = norm(b); return b.length >= 3 && b.length <= 45 && !NAO_BAIRRO.test(nb); }
    for (var j = ib - 1; j >= 0; j--) {
      var seg = segs[j], partes = seg.split(/\s[-–]\s/);
      if (partes.length > 1) { var b = partes[partes.length - 1].trim(); if (ok(b)) return b; continue; }
      if (j === ib - 1 && ok(seg)) return seg;
    }
    return '';
  }
  // Nomes diferentes do mesmo bairro viram uma chave só (grafias do cadastro; "Conjunto Cidadão" e "Dr. Airton Rocha" constam
  // nas próprias fichas como parte de Laura Moreira e Nova Cidade).
  var BAIRRO_ALIAS = {
    'treze de setembro': '13 de setembro', 'trinta e um de marco': '31 de marco', 'santa teresa': 'santa tereza',
    'aquilino mota duarte': 'distrito industrial', 'nossa senhora aparecida': 'aparecida', 'cidadao': 'laura moreira',
    'airton rocha': 'nova cidade', 'p a nova amazonia': 'nova amazonia'
  };
  function bairroCanon(raw) {
    var s = cleanText(raw).replace(/^bairro\s+(?:(?:dos|das|do|da|de)\s+)?/i, '').replace(/\s*\([^)]*\)/g, '').trim();
    var k = norm(s);
    if (/^(zona rural|area rural|comunidade)\b/.test(k)) return { key: 'zona rural', label: 'Zona rural e comunidades', alias: false };
    var base = k, ant;
    do { ant = base; base = base.replace(/^(dr|doutor|doutora|conj|conjunto|sen|senador|gov|governador|prof|profa|professor|professora)\s+/, ''); } while (base !== ant);
    var key = BAIRRO_ALIAS[base] || BAIRRO_ALIAS[k] || base, via = !!(BAIRRO_ALIAS[base] || BAIRRO_ALIAS[k]);
    return { key: key, label: s, alias: via };
  }
  var contIdx = null;
  function buildContIdx() {
    var porKey = {}, keys = {}, unidades = [];
    data.forEach(function (d) {
      if ((d.cat || []).indexOf('interior') > -1 || !/Boa Vista/i.test(cleanText(d.address))) return;
      var bruto = bairroBruto(d.address), c = bruto ? bairroCanon(bruto) : null;
      unidades.push({ d: d, key: c ? c.key : '', nome: norm(d.name) });
      if (!c) return;
      var e = porKey[c.key] = porKey[c.key] || { key: c.key, vars: {}, n: 0, fb: c.label };
      e.n++;
      if (!c.alias) e.vars[c.label] = (e.vars[c.label] || 0) + 1;
      // formas que as pessoas digitam: a chave, a grafia original e a forma sem "Dr./Conj./Sen."
      [c.key, norm(c.label), norm(bruto)].forEach(function (v) {
        if (!v || v.length < 3) return;
        var arr = keys[v] = keys[v] || [];
        if (!arr.some(function (i) { return i.canon === c.key; })) arr.push({ canon: c.key, label: c.label, unit: { id: d.id } });
      });
    });
    // rótulo de exibição: a grafia com acento e mais frequente
    Object.keys(porKey).forEach(function (k) {
      var e = porKey[k], vs = Object.keys(e.vars);
      if (k === 'zona rural') { e.label = 'Zona rural e comunidades'; return; }
      vs.sort(function (a, b) {
        var ac = (a.match(/[^\x00-\x7f]/g) || []).length, bc = (b.match(/[^\x00-\x7f]/g) || []).length;
        return (bc - ac) || (e.vars[b] - e.vars[a]) || (a.length - b.length);
      });
      e.label = vs[0] || e.fb || k;
    });
    // "Treze de Setembro" e "13 de Setembro" apontam para a mesma chave; "Zona rural" aceita "rural", "comunidades"
    ['rural', 'zona rural', 'area rural', 'comunidades', 'comunidade', 'comunidades indigenas'].forEach(function (v) {
      if (porKey['zona rural']) keys[v] = [{ canon: 'zona rural', label: 'Zona rural e comunidades', unit: { id: 'zona-rural' } }];
    });
    Object.keys(BAIRRO_ALIAS).forEach(function (a) { if (a !== 'cidadao' && porKey[BAIRRO_ALIAS[a]] && !keys[a]) keys[a] = [{ canon: BAIRRO_ALIAS[a], label: porKey[BAIRRO_ALIAS[a]].label, unit: { id: 'alias-' + a } }]; });
    var sorted = Object.keys(keys).sort(function (a, b) { return b.length - a.length; });
    return { porKey: porKey, keys: keys, sorted: sorted, unidades: unidades };
  }
  function contIndex() { return contIdx || (contIdx = buildContIdx()); }

  var CONT_IGNORA = /\b(quantos|quantas|quantidade|numero|total|cidadao|escolas?|colegios?|creches?|faculdades?|universidades?|hospital|hospitais|bombeiros?|restaurantes?|estaduais|municipais|estadual|municipal|indigenas?|existem|temos|possui|possuem|ficam)\b/g;
  function contBairros(n, ix) {
    var padded = ' ' + n + ' ', used = [], hits = [];
    ix.sorted.forEach(function (k) {
      var at = padded.indexOf(' ' + k + ' ');
      if (at < 0) return;
      var from = at, to = at + k.length + 2;
      if (used.some(function (u) { return from < u[1] && to > u[0]; })) return;
      used.push([from, to]);
      var c = ix.keys[k][0].canon;
      if (!hits.some(function (h) { return h === c; })) hits.push(c);
    });
    if (hits.length) return { hits: hits, corrigido: false };
    var fz = fuzzyBairro(n.replace(CONT_IGNORA, ' ').replace(/\s+/g, ' ').trim(), { keys: ix.keys, sorted: ix.sorted });
    return fz ? { hits: [ix.keys[fz.key][0].canon], corrigido: true } : { hits: [], corrigido: false };
  }
  function contItens(ix, t, filtro) {
    var vistos = {}, out = [];
    ix.unidades.forEach(function (u) {
      if (!t.match(u.d) || (filtro && !filtro(u.d))) return;
      if (vistos[u.nome]) return;   // a mesma unidade cadastrada em duas redes conta uma vez
      vistos[u.nome] = 1;
      out.push(u);
    });
    return out;
  }
  function contResumoSub(itens, t) {
    if (!t.sub) return '';
    var c = {}; itens.forEach(function (u) { var s = t.sub(u.d); c[s] = (c[s] || 0) + 1; });
    var p = [];
    if (c.estadual) p.push(c.estadual + (c.estadual === 1 ? ' estadual' : ' estaduais'));
    if (c.municipal) p.push(c.municipal + (c.municipal === 1 ? ' municipal' : ' municipais'));
    return p.length > 1 ? ' (' + p.join(' e ') + ')' : '';
  }
  function contLinha(u, t) { return '- **' + (u.d.fullName && u.d.fullName.length < 70 ? u.d.fullName : u.d.name) + '**' + (t.sub ? ' (' + t.sub(u.d) + ')' : ''); }

  function contagem(text) {
    var n = norm(text);
    if (!n || n.length > 220 || !data.length) return null;
    var tipos = CONT_TIPOS.filter(function (t) { return t.det.test(n); });
    if (!tipos.length) return null;
    if (/\b(vagas?|alunos?|alunas?|matriculas?|professores?|professoras?|turmas?|criancas?|salas?|funcionarios?|pessoas|familias?|atendimentos?|casos?|notas?)\b/.test(n)) return null;
    // a palavra de contagem tem que vir logo antes do tipo ("quantas escolas", "total de creches", "tem quantas UBS")
    var mC = n.match(/\b(quantos|quantas|quantidade|numero|total)\b/), tipoPos = Math.min.apply(null, tipos.map(function (t) { return n.search(t.det); }));
    var ehContagem = !!mC && mC.index < tipoPos && n.slice(mC.index + mC[0].length, tipoPos).trim().split(/\s+/).filter(Boolean).length <= 4;
    var mL = n.match(/\b(quais|liste|listar|lista|mostre|mostrar|relacao)\b/);
    var ehLista = !ehContagem && !!mL && mL.index < tipoPos && n.slice(mL.index + mL[0].length, tipoPos).trim().split(/\s+/).filter(Boolean).length <= 3 && tipos.every(function (t) { return t.list; });
    var rankSem = /\b(sem|nenhum|nenhuma|nao (?:tem|possui|ha|existe))\b/.test(n);
    var ehRank = !ehLista && /\bbairros?\b/.test(n) && (rankSem || /\b(mais|maior|menos|menor)\b/.test(n)) && tipos.length === 1 && (!ehContagem || rankSem);
    if (ehRank) ehContagem = false;
    // "creche perto do Pricumã", "escola no Caimbé": lista o que há no bairro (e, se não houver, onde há)
    var brPre = contBairros(n, contIndex());
    var ehPerto = !ehContagem && !ehLista && !ehRank && brPre.hits.length > 0 && (!brPre.corrigido || /\bbairro\b/.test(n)) &&
      tipos.every(function (t) { return t.list; }) && !/\b(telefone|endereco|horario|contato|whatsapp|ligar|chegar)\b/.test(n) &&
      (/\b(perto|proxim\w*|arredores|redondezas|vizinh\w*)\b/.test(n) || n.split(' ').length <= 7);
    if (ehPerto) ehLista = true;
    if (!ehContagem && !ehLista && !ehRank) return null;

    // "quantos CRAS atendem o bairro X?" / "qual UBS atende quem mora em X?" é cobertura (territory()), não localização
    var COM_TERRITORIO = { CRAS: 1, CREAS: 1, CAPS: 1, UBS: 1, RESTAURANTE: 1 };
    if (tipos.some(function (t) { return COM_TERRITORIO[t.key]; }) && (RE_COBERTURA.test(n) || /\b(moro|mora|moram|morando|morar|moramos|residente|resido|reside|regiao)\b/.test(n))) return null;

    var ix = contIndex(), br = contBairros(n, ix), hits = br.hits;
    var soEstadual = /\bestaduais?\b|\bestadual\b|\bseed\b/.test(n), soMunicipal = /\bmunicipais?\b|\bmunicipal\b|\bsmec\b/.test(n), soIndigena = /\bindigenas?\b/.test(n);
    var porBairro = /\b(por bairro|cada bairro|bairro a bairro|distribuicao|bairros)\b/.test(n) && !hits.length;
    var pediuBairro = /\bbairro\b/.test(n);

    function filtroDe(t) {
      if (t.key !== 'ESCOLA') return null;
      return function (d) {
        if (soEstadual && !/Estadual/.test(d.group)) return false;
        if (soMunicipal && !/Municipal/.test(d.group)) return false;
        if (soIndigena && !/^E\.E\.I\./.test(d.name)) return false;
        return true;
      };
    }
    var lines = [], todas = [], seen = {};
    function guarda(itens) { itens.forEach(function (u) { if (!seen[u.d.id]) { seen[u.d.id] = 1; todas.push(slim(u.d)); } }); }
    function rotuloT(t, plural) {
      var adj = soIndigena ? (plural ? 'estaduais indígenas' : 'estadual indígena') : soEstadual ? (plural ? 'estaduais' : 'estadual') : soMunicipal ? (plural ? 'municipais' : 'municipal') : '';
      return (plural ? t.plur : t.sing) + (t.key === 'ESCOLA' && adj ? ' ' + adj : '');
    }

    // ---- bairro(s) citado(s) ----
    if (hits.length) {
      hits.slice(0, 3).forEach(function (hk) {
        var lbl = ix.porKey[hk] ? ix.porKey[hk].label : hk;
        var onde = hk === 'zona rural' ? 'Na **' + lbl + '**' : 'No bairro **' + lbl + '**';
        if (br.corrigido) lines.push('Entendi o bairro como **' + lbl + '**.');
        tipos.forEach(function (t) {
          var itens = contItens(ix, t, filtroDe(t)).filter(function (u) { return u.key === hk; });
          var c = itens.length;
          var nome = t.key === 'ESCOLA' && (soEstadual || soMunicipal || soIndigena) ? rotuloT(t, c !== 1) : (c === 1 ? t.sing : t.plur);
          if (!c) {
            lines.push(onde + ' não consta nenhum' + (t.fem ? 'a' : '') + ' ' + (t.key === 'ESCOLA' && (soEstadual || soMunicipal || soIndigena) ? rotuloT(t, false) : t.sing) + ' no diretório do Argo.');
            if (ehPerto) {
              var todosT = contItens(ix, t, filtroDe(t)), contT = {};
              todosT.forEach(function (u) { if (u.key) contT[u.key] = (contT[u.key] || 0) + 1; });
              var ordT = Object.keys(contT).sort(function (x, y) { return (contT[y] - contT[x]) || (ix.porKey[x].label < ix.porKey[y].label ? -1 : 1); });
              if (ordT.length) lines.push('O diretório não tem a distância entre bairros, então não sei dizer qual fica mais perto. Há ' + t.plur + ' em ' + ordT.length + ' bairros: ' +
                ordT.slice(0, 14).map(function (k) { return ix.porKey[k].label + (contT[k] > 1 ? ' (' + contT[k] + ')' : ''); }).join(', ') + (ordT.length > 14 ? ' e mais ' + (ordT.length - 14) : '') + '. Diga um desses bairros para eu listar.');
            }
          } else {
            lines.push(onde + ' ' + (c === 1 ? 'consta **1 ' : 'constam **' + c + ' ') + nome + '** no diretório do Argo' + contResumoSub(itens, t) + (t.list || c <= 6 ? ':' : '.'));
            if (t.list || c <= 6) itens.slice(0, 15).forEach(function (u) { lines.push(contLinha(u, t)); });
            if (c > 15) lines.push('…e mais ' + (c - 15) + '.');
            guarda(itens);
          }
          // creches e centros especializados ficam fora da conta de "escolas", mas aparecem em separado
          if (t.tambem) {
            var extras = [];
            t.tambem.forEach(function (k) {
              if (tipos.some(function (o) { return o.key === k; })) return;
              var tt = contTipo(k), it2 = contItens(ix, tt).filter(function (u) { return u.key === hk; });
              if (it2.length) { extras.push(it2.length + ' ' + (it2.length === 1 ? tt.sing : tt.plur) + ' (' + it2.map(function (u) { return u.d.name; }).join('; ') + ')'); guarda(it2); }
            });
            if (extras.length) lines.push('Fora dessa conta, no mesmo bairro: ' + extras.join('; ') + '.');
          }
        });
      });
      if (hits.length > 3) lines.push('Mostrei os 3 primeiros bairros citados; pergunte pelos demais separadamente.');
      lines.push(tipos[0].aviso);
      var h1 = hits.length === 1 ? (ix.porKey[hits[0]] || {}).label : '';
      var fu = [];
      if (h1) {
        if (tipos[0].key === 'ESCOLA') fu.push('Quantas creches no ' + h1 + '?');
        fu.push('Qual o CRAS do bairro ' + h1 + '?');
        fu.push('Quantas ' + rotuloT(tipos[0], true) + ' por bairro?');
      }
      return { reply: lines.join('\n'), mood: todas.length ? 'success' : 'notfound', badge: 'Contagem', followups: fu.slice(0, 3), units: todas.slice(0, 5), unitsAll: todas };
    }

    // "qual bairro tem mais escolas?" / "bairros sem UBS": ranking calculado nas fichas
    if (ehRank) {
      var tr = tipos[0], itR = contItens(ix, tr, filtroDe(tr)), contR = {};
      itR.forEach(function (u) { if (u.key) contR[u.key] = (contR[u.key] || 0) + 1; });
      var todosB = Object.keys(ix.porKey).filter(function (k) { return k !== 'zona rural'; });
      var lab = function (k) { return ix.porKey[k].label; };
      if (/\b(menos|menor|sem|nenhum|nenhuma|nao (?:tem|possui|ha|existe))\b/.test(n)) {
        var semT = todosB.filter(function (k) { return !contR[k]; }).sort(function (a, b) { return lab(a) < lab(b) ? -1 : 1; });
        lines.push(semT.length
          ? 'Dos ' + todosB.length + ' bairros que aparecem nos endereços do diretório, **' + semT.length + '** não têm nenhum' + (tr.fem ? 'a' : '') + ' ' + tr.sing + ' cadastrad' + (tr.fem ? 'a' : 'o') + ': ' + semT.map(lab).join(', ') + '.'
          : 'Todos os ' + todosB.length + ' bairros que aparecem nos endereços do diretório têm pelo menos ' + (tr.fem ? 'uma ' : 'um ') + tr.sing + ' cadastrad' + (tr.fem ? 'a' : 'o') + '.');
        lines.push('Isso vale só para o que está no diretório: bairros que ainda não têm nenhum equipamento cadastrado nem aparecem aqui.');
      } else {
        var ordR = Object.keys(contR).sort(function (a, b) { return (contR[b] - contR[a]) || (lab(a) < lab(b) ? -1 : 1); });
        if (!ordR.length) lines.push('Não há ' + tr.plur + ' com bairro identificado no diretório.');
        else {
          var topo = ordR.filter(function (k) { return contR[k] === contR[ordR[0]]; });
          lines.push(topo.length === 1
            ? 'O bairro com mais ' + tr.plur + ' no diretório é **' + lab(topo[0]) + '**, com ' + contR[topo[0]] + '.'
            : 'Há empate no topo: ' + topo.map(lab).join(', ') + ' (' + contR[topo[0]] + ' cada).');
          var resto = ordR.filter(function (k) { return topo.indexOf(k) < 0; }).slice(0, 5);
          if (resto.length) lines.push('Em seguida: ' + resto.map(function (k) { return lab(k) + ' (' + contR[k] + ')'; }).join(', ') + '.');
        }
      }
      lines.push(tr.aviso);
      return { reply: lines.join('\n'), mood: 'success', badge: 'Contagem', followups: ['Quantas ' + tr.plur + ' por bairro?'] };
    }

    // bairro pedido mas não encontrado nos endereços: não responde com o total da cidade por engano
    if (pediuBairro && !porBairro) {
      return { reply: 'Não encontrei esse bairro nos endereços do diretório, então não consigo contar. Confira a grafia ou diga o nome de um bairro vizinho (ex.: "quantas escolas no Caimbé?").', mood: 'notfound', badge: 'Contagem', followups: ['Quantas escolas por bairro?'] };
    }

    // ---- Boa Vista inteira (e, se pedido, bairro a bairro) ----
    tipos.forEach(function (t) {
      var itens = contItens(ix, t, filtroDe(t)), c = itens.length;
      if (!c) { lines.push('Não há ' + rotuloT(t, true) + ' cadastrad' + (t.fem ? 'as' : 'os') + ' em Boa Vista no diretório do Argo.'); return; }
      lines.push('No diretório do Argo constam **' + c + ' ' + (c === 1 ? rotuloT(t, false) : rotuloT(t, true)) + ' em Boa Vista**' + contResumoSub(itens, t) + '.');
      var cont = {}, sem = 0;
      itens.forEach(function (u) { if (u.key) cont[u.key] = (cont[u.key] || 0) + 1; else sem++; });
      var ordem = Object.keys(cont).sort(function (a, b) { return (cont[b] - cont[a]) || (ix.porKey[a].label < ix.porKey[b].label ? -1 : 1); });
      var lim = porBairro || ehLista ? 40 : 5;
      if (ordem.length > 1) {
        var maxN = cont[ordem[0]], todosUm = maxN === 1 && ordem.length <= 12;
        var rotLista = porBairro || ehLista ? 'Distribuídas em ' + ordem.length + ' bairros. Por bairro: ' : todosUm ? 'Ficam em: ' : 'Bairros com mais ' + t.plur + ': ';
        lines.push(rotLista + ordem.slice(0, lim).map(function (k) { return ix.porKey[k].label + (todosUm ? '' : ' (' + cont[k] + ')'); }).join(', ') + (ordem.length > lim ? ' e mais ' + (ordem.length - lim) + (ordem.length - lim === 1 ? ' bairro' : ' bairros') : '') + '.');
      }
      if (sem) lines.push(sem + (sem === 1 ? ' unidade está' : ' unidades estão') + ' sem bairro identificável no endereço cadastrado e só entra no total.');
      guarda(itens);
    });
    lines.push(tipos[0].aviso);
    var primeiro = tipos[0];
    return { reply: lines.join('\n'), mood: 'success', badge: 'Contagem', followups: ['Quantas ' + rotuloT(primeiro, true) + ' no Centro?', 'Quantas ' + rotuloT(primeiro, true) + ' por bairro?'].slice(0, porBairro ? 1 : 2), units: todas.slice(0, 5), unitsAll: todas };
  }

  // ---------------------------------------------------------------------
  // PAINEL DE BOA VISTA — assistência social, educação e saúde
  //   1. perfilBairro: "o que tem no bairro X?" (os 3 setores + CRAS/CREAS de referência)
  //   2. panoramaAreas: "panorama da saúde / da educação / da assistência social / de Boa Vista"
  //   3. necessidade: "onde faço o CadÚnico", "onde tem maternidade", "vaga em creche", "EJA"...
  //   4. semNumeros: pergunta de população/beneficiários/alunos, que o diretório NÃO tem (diz onde achar)
  // Tudo calculado nas fichas de js/data.js: nenhum número ou endereço vem da IA.
  // ---------------------------------------------------------------------
  var AREAS = [
    { key: 'social', rot: 'Assistência social', tipos: ['CRAS', 'CREAS', 'RESTAURANTE'] },
    { key: 'saude', rot: 'Saúde', tipos: ['UBS', 'CAPS', 'HOSPITAL'] },
    { key: 'educacao', rot: 'Educação', tipos: ['ESCOLA', 'CRECHE', 'CENTRO', 'SUPERIOR'] }
  ];
  function areaDe(d) {
    var c = Array.isArray(d.cat) ? d.cat : [];
    function tem(l) { return l.some(function (x) { return c.indexOf(x) > -1; }); }
    if (tem(['saude', 'hospitalar'])) return 'saude';
    if (tem(['educacao'])) return 'educacao';
    if (tem(['social', 'cras', 'cas', 'alimentar', 'idoso', 'mulher', 'conselho'])) return 'social';
    return '';
  }
  var TAG_GRUPO = {
    'Rede Estadual': 'escola estadual', 'Rede Municipal - Escolas': 'escola municipal',
    'Rede Municipal - Creches e Proinfância': 'creche', 'Ensino Superior': 'ensino superior',
    'UBS (Boa Vista)': 'UBS', 'Atenção Básica': 'UBS', 'CAPS (Boa Vista)': 'CAPS', 'Hospitais': 'hospital',
    'CRAS (Boa Vista)': 'CRAS', 'CREAS (Boa Vista)': 'CREAS'
  };
  function nomeCurto(d) { return d.fullName && d.fullName.length < 70 && !/^(CRAS|CREAS|CAPS|UBS)\b/.test(d.name || "") ? d.fullName : d.name; }
  function telOk(d) { return phonesOf(d).filter(function (p) { return !/9999-0000/.test(p); }); }
  function linhaFicha(d, comBairro) {
    var b = comBairro ? bairroBruto(d.address) : '', t = telOk(d)[0];
    return '- **' + nomeCurto(d) + '**' + (b ? ' · ' + b : '') + (t ? ' · ' + t : '');
  }
  function bairrosDistintos(itens) { var o = {}; itens.forEach(function (u) { if (u.key) o[u.key] = 1; }); return Object.keys(o); }
  function totalBairros(ix) { return Object.keys(ix.porKey).filter(function (k) { return k !== 'zona rural'; }).length; }
  function unicos(itens) { var v = {}; return itens.filter(function (u) { if (v[u.nome]) return false; v[u.nome] = 1; return true; }); }

  // ---- 1. perfil do bairro ----
  var RE_PERFIL = /\b(o que (?:tem|ha|existe|fica|funciona|temos)|perfil|panorama|resumo|visao geral|raio x|servicos|equipamentos|unidades|rede(?: de servicos| intersetorial| de apoio)?)\b/;
  function perfilBairro(text) {
    var n = norm(text);
    if (!n || n.length > 160 || !data.length || !RE_PERFIL.test(n)) return null;
    if (CONT_TIPOS.some(function (t) { return t.det.test(n); })) return null;   // "UBS do bairro X" fica com contagem/território
    if (/\b(telefone|endereco|horario|contato|whatsapp|ligar|como chegar|quantos|quantas)\b/.test(n)) return null;
    var ix = contIndex(), br = contBairros(n, ix);
    if (!br.hits.length || (br.corrigido && !/\bbairro\b/.test(n))) return null;
    var hk = br.hits[0], lbl = ix.porKey[hk] ? ix.porKey[hk].label : hk;
    var onde = hk === 'zona rural' ? 'Na **' + lbl + '**' : '**' + lbl + '**';
    var por = { social: [], saude: [], educacao: [], outros: [] };
    unicos(ix.unidades.filter(function (u) { return u.key === hk; })).forEach(function (u) { por[areaDe(u.d) || 'outros'].push(u); });
    var so = AREAS.filter(function (a) { return RE_AREA[a.key].test(n); });   // "unidades de saúde do Cauamé": só a área pedida
    var lines = [onde + ' — o que consta no diretório do Argo' + (so.length === 1 ? ' (' + so[0].rot.toLowerCase() + ')' : '') + ':'], todas = [];
    if (br.corrigido) lines.unshift('Entendi o bairro como **' + lbl + '**.');
    AREAS.concat(so.length === 1 ? [] : [{ key: 'outros', rot: 'Outros serviços e órgãos' }]).forEach(function (a) {
      if (so.length === 1 && so[0].key !== a.key) return;
      var it = por[a.key];
      if (!it.length) { if (a.key !== 'outros') lines.push('**' + a.rot + ':** nenhum equipamento com endereço neste bairro' + (a.key === 'social' ? ' (veja a referência do território abaixo)' : '') + '.'); return; }
      lines.push('**' + a.rot + '** (' + it.length + '):');
      it.slice(0, 8).forEach(function (u) {
        var tg = TAG_GRUPO[u.d.group] || '';
        lines.push('- **' + nomeCurto(u.d) + '**' + (tg ? ' (' + tg + ')' : ''));
        todas.push(slim(u.d));
      });
      if (it.length > 8) lines.push('…e mais ' + (it.length - 8) + '.');
    });
    // referência territorial: CRAS/CREAS/Conselho Tutelar que cobrem o bairro (lista de cobertura das fichas)
    if (!so.length || so[0].key === 'social') try {
      var tr = territory('equipamentos do bairro ' + lbl);
      if (tr && tr.reply) {
        var ref = tr.reply.split('\n').filter(function (l) { return /^- \*\*(CRAS|CREAS|Conselho Tutelar):/.test(l); });
        if (ref.length) { lines.push('**Referência do território** (quem atende quem mora aqui):'); ref.forEach(function (l) { lines.push(cut(l, 170)); }); }
        (tr.units || []).forEach(function (u) { if (!todas.some(function (x) { return x.id === u.id; })) todas.push(u); });
      }
    } catch (e) { /* sem território: segue só com as fichas do bairro */ }
    lines.push('Conta só o que está cadastrado no diretório; a UBS e a escola de referência de uma família seguem a área/zoneamento e podem não ser as do bairro onde ela mora.');
    var fu = ['Quantas escolas no ' + lbl + '?', 'Quantas UBS no ' + lbl + '?', 'Qual o CRAS do bairro ' + lbl + '?'];
    return { reply: lines.join('\n'), mood: todas.length ? 'success' : 'notfound', badge: 'Bairro', followups: fu, units: todas.slice(0, 5), unitsAll: todas };
  }

  // ---- 2. panorama por área ----
  var RE_PANO_FORTE = /\b(panorama|numeros|dados|indicadores|diagnostico|estatisticas?|retrato|raio x)\b/;
  var RE_PANO_FRACO = /\b(resumo|resuma|visao geral|como esta|como e a rede|situacao da rede|quanto temos)\b/;
  var RE_AREA = {
    social: /\b(assistencia social|suas|socioassistencial|protecao social)\b/,
    saude: /\b(saude|sus|raps)\b/,
    educacao: /\b(educacao|ensino|escolar|escolas e creches)\b/
  };
  function panoramaAreas(text) {
    var n = norm(text);
    if (!n || n.length > 200 || !data.length) return null;
    var forte = RE_PANO_FORTE.test(n), fraco = RE_PANO_FRACO.test(n);
    if (!forte && !fraco) return null;
    var cidade = /\b(boa vista|capital|municipio|cidade|rede|equipamentos?|unidades|diretorio)\b/.test(n);
    var quer = AREAS.filter(function (a) { return RE_AREA[a.key].test(n); });
    if (!quer.length && !cidade) return null;
    // só "resumo"/"visão geral": precisa dizer a cidade/rede ou a área (saúde ou educação; "resumo do SUAS" é conceito)
    if (!forte && !cidade && !quer.some(function (a) { return a.key !== 'social'; })) return null;
    if (/\b(bolsa familia|cadunico|bpc|paif|creas|cras|caps)\b/.test(n) && !quer.length) return null;   // é conceito, não panorama
    var ix = contIndex();
    if (contBairros(n, ix).hits.length && !/\bboa vista\b/.test(n)) return null;
    if (!quer.length) quer = AREAS;
    var lines = ['**Boa Vista no diretório do Argo**' + (quer.length === 1 ? ' — ' + quer[0].rot.toLowerCase() : '') + ':'], todas = [], nb = totalBairros(ix), usados = {};
    quer.forEach(function (a) {
      var linhas = [], total = 0;
      a.tipos.forEach(function (k) {
        var t = contTipo(k), it = contItens(ix, t);
        if (!it.length) return;
        it.forEach(function (u) { usados[u.nome] = 1; });
        total += it.length;
        var bs = bairrosDistintos(it).length;
        linhas.push('- **' + it.length + ' ' + (it.length === 1 ? t.sing : t.plur) + '**' + contResumoSub(it, t) + (bs > 1 ? ' em ' + bs + ' de ' + nb + ' bairros' : ''));
        if (todas.length < 5) it.slice(0, 1).forEach(function (u) { todas.push(slim(u.d)); });
      });
      // demais grupos da área (urgência, abrigos, clínicas-escola, saúde indígena, acolhimento...)
      var g = {}, ord = [];
      unicos(ix.unidades.filter(function (u) { return areaDe(u.d) === a.key && !usados[u.nome]; })).forEach(function (u) {
        var k = grupoDe(u.d); if (!g[k]) { g[k] = 0; ord.push(k); } g[k]++; total++;
      });
      ord.sort(function (x, y) { return g[y] - g[x]; }).slice(0, 7).forEach(function (k) { linhas.push('- ' + g[k] + ' · ' + k); });
      lines.push('**' + a.rot + '** (' + total + ' unidades):');
      lines = lines.concat(linhas);
    });
    lines.push('Conta só o que está cadastrado no diretório do Argo (Boa Vista, sem o interior); confirme com a rede antes de usar o número em relatório. Para indicadores de população, matrículas ou atendimentos, o diretório não tem dados: use IBGE, Censo Escolar (INEP), CNES/DataSUS e o Relatório de Informações Sociais do MDS.');
    return { reply: lines.join('\n'), mood: 'success', badge: 'Panorama', followups: ['Quais bairros não têm UBS?', 'Quantas escolas por bairro?', 'O que tem no bairro Pintolândia?'], units: todas.slice(0, 5), unitsAll: todas };
  }

  // ---- 3. necessidades (pergunta de quem precisa de algo, sem dizer o nome da unidade) ----
  function porIds(ids) { return ids.map(function (i) { return fichaDe(i); }).filter(function (d) { return d && d.id; }); }
  function bvDe(fn) { return unicos(contIndex().unidades.filter(function (u) { return fn(u.d); })).map(function (u) { return u.d; }); }
  var NECESS = [
    { k: 'parto', re: /\b(parto|maternidade|trabalho de parto|dar a luz|ganhar (?:o )?bebe)\b/,
      fichas: function () { return porIds(['hospital-materno-infantil-hminsn']); },
      intro: 'Para **parto e maternidade**, a referência cadastrada no diretório é:',
      nota: 'O pré-natal é acompanhado na UBS do território. Confirme o fluxo de encaminhamento com a UBS ou com a SESAU.',
      fu: ['Qual a UBS do meu bairro?', 'Quantas UBS por bairro?'] },
    { k: 'urgencia', re: /\b(pronto atendimento|pronto socorro|urgencia|emergencia|upa)\b/,
      fichas: function () { return porIds(['samu', 'hospital-cosme-silva', 'hgrr', 'hospital-materno-infantil-hminsn']); },
      intro: 'Para **urgência e emergência**, constam no diretório:',
      nota: 'Risco de vida: ligue **192** (SAMU) ou **190** (polícia). O HGRR é referência para urgência psiquiátrica; o HMINSN, para urgência materno-infantil.',
      fu: ['Quais hospitais tem em Boa Vista?'] },
    { k: 'vacina', re: /\b(vacinas?|vacinacao|vacinar|caderneta de vacina)\b/,
      fichas: function () { return []; },
      intro: 'A **vacinação de rotina** é ofertada, em geral, nas **UBS** (sala de vacina).',
      nota: 'O diretório não traz o horário da sala de vacina: confirme com a UBS antes de ir. Diga o bairro para eu indicar a UBS.',
      fu: ['Quantas UBS por bairro?', 'Qual a UBS do bairro Cauamé?'] },
    { k: 'capsi', re: /\bcaps ?i\b|\bcapsi\b|\bcaps infantil\b|\bcaps infantojuvenil\b|saude mental.*\b(crianca|adolescente|infantil)\b|\b(crianca|adolescente|infantil)\b.*saude mental/,
      fichas: function () { return porIds(['caps-ii', 'caps-iii']); },
      intro: 'No diretório **não consta CAPS i (infantojuvenil) em Boa Vista**. Os CAPS cadastrados são o CAPS II, o CAPS III (24h) e o CAPS AD III. Para saúde mental de criança ou adolescente, constam:',
      nota: 'Confirme com a SEMSA/SESAU qual serviço recebe crianças e adolescentes antes de encaminhar: o diretório não informa faixa etária de cada CAPS.',
      fu: ['O que é o CAPS?', 'Telefone do CAPS III'] },
    { k: 'cadunico', re: /\b(cadunico|cad unico|cadastro unico)\b/, extra: /\b(onde|aonde|local|fazer|tirar|atualizar|inscrever|inscricao|cadastrar|posto)\b/,
      fichas: function () { return bvDe(function (d) { return d.group === 'CRAS (Boa Vista)' || /Cadastro Único/.test(d.group || ''); }); },
      intro: 'O **CadÚnico** é feito no **CRAS** ou em posto de atendimento. No diretório constam:',
      nota: 'Cada família é atendida pelo CRAS do seu bairro: diga o bairro e eu indico. Para documentos e regras, pergunte "o que é o CadÚnico?".',
      fu: ['Qual o CRAS do bairro Pricumã?', 'O que é o CadÚnico?'] },
    { k: 'matricula', re: /\b(vagas?|matriculas?|matricular|inscricao)\b.*\b(creche|escola|ensino)\b|\b(creche|escola)\b.*\b(vagas?|matriculas?|matricular)\b/,
      fichas: function () { return []; },
      intro: 'O diretório **não traz vagas nem regras de matrícula**: isso muda a cada ano.',
      nota: 'Escola e creche **municipais**: SMEC. Escola **estadual**: SEED. Procure a unidade ou o órgão para vaga e prazo. Diga o bairro e eu mostro as escolas e creches cadastradas nele.',
      fu: ['Quantas creches por bairro?', 'Quantas escolas por bairro?'] },
    { k: 'eja', re: /\beja\b|educacao de jovens e adultos/,
      fichas: function () { return bvDe(function (d) { return areaDe(d) === 'educacao' && /\bEJA\b|jovens e adultos/i.test(cleanText([d.name, d.fullName, d.services].join(' '))); }); },
      intro: 'Com **EJA (Educação de Jovens e Adultos)** constam no diretório:',
      nota: 'Confirme turnos e vagas com a escola ou a SEED/SMEC.', fu: ['Quantas escolas por bairro?'] },
    { k: 'integral', re: /\b(tempo integral|escola integral)\b/,
      fichas: function () { return bvDe(function (d) { return areaDe(d) === 'educacao' && /tempo integral/i.test(cleanText([d.name, d.fullName, d.services].join(' '))); }); },
      intro: 'Com **tempo integral** constam no diretório:',
      nota: 'Confirme com a escola ou a SEED/SMEC.', fu: ['Quantas escolas por bairro?'] },
    { k: 'especial', re: /\b(educacao especial|atendimento educacional especializado|\baee\b)\b/,
      fichas: function () { return bvDe(function (d) { return CONT_TIPOS[2].match(d); }); },
      intro: 'Em **educação especial / atendimento educacional especializado** constam:',
      nota: 'Confirme público e encaminhamento com a SEED/SMEC.', fu: ['Quantas escolas por bairro?'] },
    { k: 'indigena', re: /\bescolas? indigenas?\b/,
      fichas: function () { return bvDe(function (d) { return /^E\.E\.I\./.test(d.name || '') && /Boa Vista/.test(d.address || ''); }); },
      intro: 'Escolas **estaduais indígenas** em Boa Vista no diretório:',
      nota: 'Fonte das fichas: Censo Escolar/INEP e SEED. Confirme com a SEED.', fu: ['Quantas escolas estaduais indígenas?'] },
    { k: 'idoso', re: /\b(idosos?|pessoa idosa|terceira idade)\b/, extra: /\b(onde|servicos?|atendimento|programa|projeto|centro|grupo|convivencia)\b/,
      fichas: function () { return bvDe(function (d) { return /Idos/.test(d.group || ''); }); },
      intro: 'Para **pessoas idosas**, constam no diretório:',
      nota: 'O SCFV para pessoas idosas é ofertado no CRAS ou em unidade referenciada a ele; diga o bairro e eu indico o CRAS.', fu: ['O que é o SCFV?', 'Qual o CRAS do bairro Pricumã?'] }
  ];
  function necessidade(text) {
    var n = norm(text);
    if (!n || n.length > 200 || !data.length) return null;
    var nec = null;
    for (var i = 0; i < NECESS.length; i++) {
      var e = NECESS[i];
      if (e.re.test(n) && (!e.extra || e.extra.test(n))) { nec = e; break; }
    }
    if (!nec) return null;
    // nome de unidade bem identificado, bairro citado ou contagem: quem responde é o diretório/contagem
    if (/\b(telefone|endereco|horario|whatsapp|ligar|quantos|quantas)\b/.test(n)) return null;
    var ix = contIndex(), br = contBairros(n, ix);
    if (br.hits.length && !br.corrigido) return null;
    var fichas = nec.fichas(), lines = [nec.intro];
    fichas.slice(0, 8).forEach(function (d) { lines.push(linhaFicha(d, true)); });
    if (fichas.length > 8) lines.push('…e mais ' + (fichas.length - 8) + '.');
    if (nec.nota) lines.push(nec.nota);
    return { reply: lines.join('\n'), mood: 'success', badge: 'Diretório', followups: nec.fu.slice(0, 3), units: fichas.slice(0, 5).map(slim), unitsAll: fichas.map(slim) };
  }

  // ---- 4. dados que o diretório não tem ----
  function semNumeros(text) {
    var n = norm(text);
    if (!n || n.length > 200) return null;
    if (!/\b(quantas?|quantos?|numero de|total de|taxa de|percentual|porcentagem|qual a populacao|populacao)\b/.test(n)) return null;
    var what = n.match(/\b(familias|pessoas|habitantes|populacao|beneficiari\w+|alunos|alunas|matriculas?|estudantes|criancas|idosos|casos|atendimentos|leitos|medicos|vagas|desempregados|analfabetos)\b/);
    if (!what) return null;
    if (!/\b(boa vista|roraima|bairro|municipio|cidade|rr|capital)\b/.test(n)) return null;
    var fontes = {
      familias: 'Relatório de Informações Sociais – RI / VIS Data (MDS) e o Painel do CadÚnico',
      beneficiari: 'Relatório de Informações Sociais – RI / VIS Data (MDS) e o Painel do CadÚnico',
      alunos: 'Censo Escolar (INEP), QEdu e a SEED/SMEC', alunas: 'Censo Escolar (INEP), QEdu e a SEED/SMEC', matriculas: 'Censo Escolar (INEP), QEdu e a SEED/SMEC', matricula: 'Censo Escolar (INEP), QEdu e a SEED/SMEC', estudantes: 'Censo Escolar (INEP), QEdu e a SEED/SMEC',
      leitos: 'CNES/DataSUS e a SESAU/SEMSA', medicos: 'CNES/DataSUS e a SESAU/SEMSA'
    };
    var w = what[1], fonte = fontes[w] || fontes[w.replace(/s$/, '')] || (/\b(populacao|habitantes|pessoas|idosos|criancas|desempregados|analfabetos)\b/.test(w) ? 'IBGE (Censo e IBGE Cidades)' : 'IBGE, Relatório de Informações Sociais do MDS, CNES/DataSUS ou Censo Escolar (INEP), conforme o tema');
    var r = 'O diretório do Argo guarda **equipamentos** (endereço, telefone, horário, serviços), **não** números de população, famílias, matrículas, vagas ou atendimentos. Por isso não vou estimar esse dado.\nOnde achar o número oficial: ' + fonte + '.\nO que eu consigo contar com segurança: unidades por tipo e por bairro (escolas, creches, UBS, CRAS, CREAS, hospitais...).';
    return { reply: r, mood: 'notfound', badge: 'Sem dado', followups: ['Panorama da assistência social', 'Panorama da saúde', 'Panorama da educação'] };
  }

  // ---------------------------------------------------------------------
  // TRECHOS DAS FICHAS, BASE DO APP E RESPOSTA DIRETA DA FICHA
  // O texto longo de cada ficha (desc em data.js: requisitos, documentos, valores, passo a passo,
  // lista de medicamentos...) era cortado nos primeiros 120-220 caracteres. Aqui ele vira "trechos"
  // e só os que combinam com a pergunta seguem para a IA (ou para a resposta direta, sem IA).
  // ---------------------------------------------------------------------
  var REFS = {};            // valores de referência do app (ex.: { sm: 1621, bf: 218 }), vindos de init({ refs })
  var passIdx = null;       // { byId: { id: [trecho] }, df: { palavra: n }, N }
  var PASS_STOP = asSet(('de da do das dos e a o as os em no na nos nas um uma para por pelo pela com sem ao aos que qual quais quem onde como quando ' +
    'e ou se ser sao foi tem ter ha mais ja so seu sua seus suas esse essa isso este esta voce preciso precisa quero queria posso pode ' +
    'quanto quantos quantas qual cras bpc').split(' ').filter(function (w) { return w !== 'cras' && w !== 'bpc'; }));
  var PASS_SIN = {
    remedio: ['medicamento', 'medicamentos', 'medicacao'], remedios: ['medicamento', 'medicamentos', 'medicacao'],
    idade: ['anos'], documento: ['documentos'], documentos: ['documento'], levar: ['apresentar', 'documentos'],
    requisito: ['requisitos'], requisitos: ['requisito'], direito: ['requisitos'], valor: ['r'], custa: ['valor', 'r'], preco: ['valor', 'r']
  };
  var INTENTS = [
    { id: 'requisitos', re: /\b(requisitos?|criterios?|quem (tem direito|pode)|tenho direito|elegivel|elegibilidade|condicoes?|exigencias?|exige)\b/, boost: /requisit|estar inscrito|possuir|ter renda|tem direito|podem|criteri|idade minima|\d+ anos|per capita/ },
    { id: 'documentos', re: /\b(documentos?|levar|apresentar|comprovantes?|papeis|o que (preciso )?levar)\b/, boost: /documento|rg|cpf|comprovante|certidao|carteira|apresent|levar|titulo/ },
    { id: 'valor', re: /\b(valor|valores|quanto (e|custa|paga|recebe|ganha)|preco|custa|teto|salario minimo|desconto)\b/, boost: /r\$|\d+ ?%|salario minimo|valor|teto|desconto/ },
    { id: 'como', re: /\b(como (solicit|pedir|dar entrada|fazer|tirar|conseguir|acess|requer|agend|funciona|obter|emitir|renovar|cadastr)\w*|passo a passo|processo|etapas?)\b/, boost: /como|passo|solicit|gov\.br|aplicativo|agend|presencial|etapa|1\.|dar entrada|requerimento|site/ },
    { id: 'lista', re: /\b(remedios|medicamentos|quais (sao )?os|lista)\b/, boost: /medicament|lista|relacao|exemplos?/ },
    { id: 'prazo', re: /\b(prazo|quanto tempo|demora|validade|vigencia|renov)\w*/, boost: /prazo|dias|meses|anos|validade|vigenc|renov/ }
  ];
  function intentsDe(n) { return INTENTS.filter(function (i) { return i.re.test(n); }); }
  function tokensPass(s) { return uniq(tok(s)).filter(function (t) { return !PASS_STOP[t] && (t.length > 1 || /\d/.test(t)); }); }

  function dividirDesc(d) {
    var out = [], raw = String(d.desc == null ? '' : d.desc);
    raw.split(/<br\s*\/?>|\n+/i).forEach(function (par) {
      var p = cleanText(par).replace(/^[·\s]+|[·\s]+$/g, '');
      if (!p) return;
      if (p.length <= 650) { out.push(p); return; }
      var partes = p.split(/\s*[•▪●]\s*/), rotulo = '';
      if (partes.length > 1 && partes[0].length <= 90) rotulo = partes.shift().replace(/[\s:]+$/, '');
      if (partes.length < 2) { // sem marcadores: parte por frases
        partes = p.split(/(?<=[.;!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9])/);
        rotulo = '';
      }
      var buf = '';
      partes.forEach(function (x) {
        x = x.replace(/^[;\s]+|[;\s]+$/g, '');
        if (!x) return;
        if (buf && (buf + ' ' + x).length > 650) { out.push((rotulo ? rotulo + ': ' : '') + buf); buf = ''; }
        buf = buf ? buf + '; ' + x : x;
      });
      if (buf) out.push((rotulo ? rotulo + ': ' : '') + buf);
    });
    return out;
  }
  function buildPass() {
    var byId = {}, df = {}, N = 0;
    data.forEach(function (d) {
      var lst = dividirDesc(d).map(function (t, i) {
        var tk = tokensPass(t); N++;
        tk.forEach(function (w) { df[w] = (df[w] || 0) + 1; });
        return { t: t, tk: asSet(tk), n: norm(t), ord: i };
      });
      if (lst.length) byId[d.id] = lst;
    });
    passIdx = { byId: byId, df: df, N: N || 1 };
  }
  function passagens() { if (!passIdx) buildPass(); return passIdx; }
  function pesoPass(w) { var P = passagens(); return Math.log(1 + P.N / (1 + (P.df[w] || 0))); }
  function casa(set, w) {
    if (set[w]) return 1;
    if (w.length >= 5) for (var k in set) if (k.length >= 5 && (k.indexOf(w.slice(0, 5)) === 0)) return 0.8;
    return 0;
  }
  // Pontua os trechos de UMA ficha para a pergunta. Devolve os melhores, na ordem em que aparecem na ficha.
  function trechosDa(d, text, orcamento, minimo) {
    var lst = passagens().byId[d.id];
    if (!lst || !lst.length) return { itens: [], melhor: 0 };
    var n = norm(text), qt = tokensPass(text), ints = intentsDe(n), extra = [];
    qt.forEach(function (w) { (PASS_SIN[w] || []).forEach(function (s) { extra.push(s); }); });
    var pontuados = lst.map(function (p) {
      var s = 0;
      qt.forEach(function (w) { var m = casa(p.tk, w); if (m) s += m * pesoPass(w); });
      extra.forEach(function (w) { if (p.tk[w]) s += 0.6 * pesoPass(w); });
      var ib = 0;
      ints.forEach(function (i) { if (i.boost.test(p.n)) ib += 1.6; });
      // o boost de intenção só vale se o trecho também tem relação com o assunto (ou a ficha é pequena)
      return { p: p, s: s + (s > 0 || lst.length <= 3 ? ib : 0) };
    });
    var melhor = pontuados.reduce(function (m, x) { return x.s > m ? x.s : m; }, 0);
    var corte = Math.max(minimo || 1.2, melhor * 0.45);
    var sel = pontuados.filter(function (x) { return x.s >= corte; }).sort(function (a, b) { return b.s - a.s; });
    var usado = 0, ficou = [];
    sel.forEach(function (x) {
      var t = x.p.t;
      if (usado + t.length > orcamento) { if (ficou.length) return; t = cut(t, orcamento); }
      usado += t.length; ficou.push({ ord: x.p.ord, t: t, s: x.s });
    });
    ficou.sort(function (a, b) { return a.ord - b.ord; });
    return { itens: ficou, melhor: melhor };
  }
  function textoTrechos(r) { return r.itens.map(function (x) { return x.t; }).join(' // '); }

  // Base do app: verbetes conferidos (glossário, base do psicólogo), valores de referência e calendário de pagamento do PBF.
  var PBF_NIS = { // ferramentas/pagamento-pbf.html (cópia; o teste:territorio confere se continua igual)
    1: [19, 12, 18, 16, 18, 17, 20, 18, 17, 19, 16, 10], 2: [20, 13, 19, 17, 19, 18, 19, 21, 18, 20, 17, 11],
    3: [21, 18, 20, 20, 20, 19, 20, 22, 21, 21, 18, 14], 4: [22, 19, 23, 22, 21, 22, 23, 22, 21, 22, 19, 15],
    5: [23, 20, 24, 23, 22, 23, 24, 24, 23, 23, 23, 16], 6: [26, 23, 25, 24, 25, 24, 27, 25, 24, 26, 24, 17],
    7: [27, 24, 26, 27, 26, 25, 28, 26, 25, 27, 25, 18], 8: [28, 25, 27, 28, 27, 26, 29, 27, 28, 28, 26, 21],
    9: [29, 26, 30, 29, 28, 29, 28, 30, 29, 29, 27, 22], 0: [30, 27, 31, 30, 29, 30, 31, 31, 30, 30, 30, 23]
  };
  var MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var MESES_BONITO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function dois(n) { return (n < 10 ? '0' : '') + n; }
  function brl(v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+,)/g, '.'); }
  function refsTexto() {
    if (!REFS.sm) return '';
    var t = 'Salário mínimo: ' + brl(REFS.sm) + ' (¼ = ' + brl(REFS.sm / 4) + '; ½ = ' + brl(REFS.sm / 2) + ').';
    if (REFS.bf) t += ' Linha de renda per capita do Bolsa Família: ' + brl(REFS.bf) + ' por pessoa.';
    return t;
  }
  var RE_REFS = /\b(salario minimo|meio salario|1 2 salario|1 4 salario|um quarto|um meio|renda per capita|linha de pobreza|valor do bolsa familia)\b/;
  var RE_PBF_PAG = /\b(pagamento|pagam|paga|pago|recebe|recebo|cai|data)\b.*\b(bolsa familia|pbf)\b|\b(bolsa familia|pbf)\b.*\b(pagamento|pagam|paga|pago|recebe|recebo|cai|data|calendario)\b|\bfinal (do )?nis\b|\bnis (final|terminad[oa]|termina)\b/;
  function pbfPagamento(text) {
    var n = norm(text);
    if (!RE_PBF_PAG.test(n)) return null;
    var m = n.match(/\b(?:final|terminad[oa]|termina|termina em|digito)(?: do| de| em| com)?(?: nis)?(?: em| de)? (\d)\b/) || n.match(/\bnis (?:final |terminad[oa] em |termina em )?(\d)\b(?!\d)/);
    var dig = m ? Number(m[1]) : null, mes = -1;
    MESES.forEach(function (x, i) { if (n.indexOf(x) > -1) mes = i; });
    if (mes < 0 && /\b(este mes|esse mes|mes atual|agora|hoje)\b/.test(n)) mes = new Date().getMonth();
    var cab = 'Calendário de pagamento do Bolsa Família 2026 (ferramenta do Argo, por último dígito do NIS).';
    if (dig !== null && mes >= 0) return cab + ' Final ' + dig + ' em ' + MESES_BONITO[mes] + ': dia ' + PBF_NIS[dig][mes] + '.';
    if (mes >= 0) return cab + ' Em ' + MESES_BONITO[mes] + ': ' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(function (k) { return 'final ' + k + ' dia ' + PBF_NIS[k][mes]; }).join('; ') + '.';
    if (dig !== null) return cab + ' Final ' + dig + ': ' + MESES_BONITO.map(function (x, i) { return x.slice(0, 3) + ' ' + PBF_NIS[dig][i]; }).join('; ') + '.';
    return cab + ' Em geral, os últimos 10 dias úteis do mês; em dezembro o calendário é antecipado (termina dia 23). Diga o mês e o final do NIS (0 a 9) para eu dar o dia.';
  }
  function limpaMd(s) { return String(s || '').replace(/\*\*/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim(); }
  var CENSO_STOP = asSet(['quantos', 'quantas', 'quanto', 'qual', 'quais', 'tem', 'tenho', 'temos', 'no', 'nos', 'na', 'nas', 'do', 'dos', 'da', 'das', 'de', 'em', 'ao', 'aos', 'e', 'o', 'a', 'os', 'as', 'um', 'uma', 'para', 'por', 'com', 'que', 'me', 'diga', 'informe', 'existe', 'sao', 'sobre']);
  function setCensoSuas(trechos) {
    censoSuas = Array.isArray(trechos) ? trechos.filter(function (t) {
      return t && t.doc === 'censo-suas-2025-roraima-psicologos' && t.tipo === 'apoio' && typeof t.texto === 'string' && t.texto.trim();
    }).slice(0, 160).map(function (t) {
      return { titulo: cut(cleanText(t.titulo), 160), referencia: cut(cleanText(t.referencia), 180), texto: cut(cleanText(t.texto), 900), origem: cut(cleanText(t.norma), 300) };
    }) : [];
    return censoSuas.length;
  }
  function censoBaseApp(text) {
    var n = norm(text);
    if (!censoSuas.length || !/\b(censo suas|psicolog\w*|recursos humanos|rh|trabalhador\w*|profission\w*|servidor\w*|carga horaria|vinculo\w*|escolaridade|atendimento coletivo|familias referenciadas|lotacao|capacidade|computador\w*|veiculo\w*|conselheir\w*|implantacao)\b/.test(n) && !(/\b(assistentes? sociais?|pedagog\w+|trabalham|cadastrador\w*|estatutari\w+|temporari\w+|nutricionist\w+|advogad\w+|equipes?)\b/.test(n) && /\b(boa vista|roraima|creas|convivencia|acolhimento)\b/.test(n))) return [];
    var termos = uniq(tok(text).filter(function (t) { return t.length > 2 && !CENSO_STOP[t]; }));
    var ranqueados = censoSuas.map(function (t) {
      var corpo = norm([t.titulo, t.referencia, t.texto].join(' ')), palavras = asSet(tok(corpo));
      var pontos = termos.reduce(function (soma, q) {
        var radical = /^psicologi/.test(q) ? 'psicolog' : q.replace(/(os|as|es|is|a|o|s)$/, '');
        if (palavras[q]) return soma + 2;
        if (radical.length >= 5 && Object.keys(palavras).some(function (p) { return p.indexOf(radical) === 0 || radical.indexOf(p) === 0; })) return soma + 1;
        return soma;
      }, 0);
      // o lugar e o módulo pedidos pesam: "Roraima" prefere o trecho do estado; "Boa Vista", o da capital; "CREAS" não puxa o de CRAS
      if (pontos > 0) {
        var ref = norm((t.referencia || '') + ' ' + (t.titulo || ''));
        // escopo do trecho, pelo título da seção (o título do documento tem "Roraima" em todos): interior, capital, um município ou o estado
        var refR = norm(t.referencia || ''), munRef = cpMunicipio(refR);
        var escopo = /\binterior\b/.test(refR) ? 'interior' : /\bboa vista\b/.test(refR) ? 'bv' : munRef ? 'municipio' : 'estado';
        var munCitado = cpMunicipio(n);
        if (munCitado && munCitado !== 'Boa Vista') { if (refR.indexOf(norm(munCitado)) > -1) pontos += 4; }
        else if (/\binterior\b/.test(n)) { if (escopo === 'interior') pontos += 3; }
        else if (/\bboa vista\b/.test(n)) { if (escopo === 'bv') pontos += 3; }
        else if (/\b(roraima|estado)\b/.test(n)) { if (escopo === 'estado') pontos += 3; }
        [['cras', /\bcras\b/], ['creas', /\bcreas\b/], ['convivencia', /\bconvivencia\b/], ['acolhimento', /\bacolhimento\b/], ['gestao', /\bgestao\b/]].forEach(function (m) {
          if (m[1].test(n) && m[1].test(ref)) pontos += 2;
        });
      }
      return { trecho: t, pontos: pontos };
    }).filter(function (x) { return x.pontos > 0; }).sort(function (a, b) { return b.pontos - a.pontos; });
    return ranqueados.slice(0, 2).map(function (x) {
      return { titulo: 'Censo SUAS 2025 — ' + (x.trecho.referencia || x.trecho.titulo), texto: x.trecho.texto, origem: x.trecho.origem || 'Censo SUAS 2025, dados agregados de Recursos Humanos e Dados Gerais de Roraima' };
    });
  }
  // ---------------------------------------------------------------------
  // MANUAL DO APP — o mascote sabe usar o Argo (abas, ferramentas, Central de PDF, segurança, backup)
  // Resposta direta, SEM IA e sem internet. Cada verbete foi conferido no código do app (js/app.js, index.html).
  // Os números que o app define (bloqueio por inatividade, "manter conectado", tentativas de senha) entram por
  // init({ manual: {...} }) e são lidos do próprio app, para o manual nunca ficar desatualizado.
  // Para acrescentar um verbete: um item em MANUAL (id, nome, keys sem acento, texto; open = aba que o botão abre).
  var MANUAL_VARS = { bloqueioMin: 45, lembrarHoras: 12, tentativas: 5 };
  var MANUAL = [
    { id: 'visao', nome: 'O que o Argo faz', keys: ['o que o app faz', 'o que o argo faz', 'para que serve o app', 'para que serve o argo', 'o que tem no app', 'quais abas', 'quais as abas', 'lista de abas', 'o que posso fazer', 'como funciona o app', 'como funciona o argo', 'tour', 'visao geral', 'menu lateral', 'barra lateral'],
      texto: 'O Argo SUAS reúne, num só lugar: o **diretório da rede** (hospitais, saúde mental, proteção social, educação, justiça, segurança, documentação, entre outros) com telefone, endereço e requisitos; os painéis de **Registro de Atendimento (CRAS e CAS)**; a **Agenda**; o **Mapa**; o **Tradutor**; as **Notícias** do MDS, MEC e Saúde; os **Aplicativos** do autor; a **Criptografia**; a **Central de PDF**; e as **Ferramentas** (relógio, calculadoras, bloco de notas, planilhas). A barra lateral organiza tudo por grupos. É só me dizer o que procura que eu abro a aba.' },
    { id: 'mascote', nome: 'O que o mascote sabe fazer', keys: ['o que voce sabe fazer', 'o que voce faz', 'quem e voce', 'como voce pode me ajudar', 'o que o mascote faz', 'como falar com o mascote', 'como usar o mascote', 'como usar o assistente', 'como funciona o assistente', 'como te usar'],
      texto: 'Eu respondo na hora, sem internet, sobre o **diretório** (telefone, endereço, horário, requisitos), **dúvidas de SUAS** (glossário e normas), **valores de referência**, **calendário do Bolsa Família**, **municípios de Roraima** e **como usar o app**. Também **abro abas** ("abre o mapa"), **busco no diretório**, **troco o tema** (claro/escuro) e **consulto a Agenda**. Quando a IA está ligada, ela aprofunda as respostas. Não guardo dados pessoais de ninguém: evite digitar nome, CPF ou NIS de quem foi atendido.' },
    { id: 'busca', nome: 'Busca no diretório', keys: ['como busco', 'como buscar', 'como pesquisar', 'como pesquiso', 'como procurar', 'como procuro', 'campo de busca', 'barra de busca', 'pesquisa do app', 'busca por proximidade', 'ordenar por proximidade', 'perto de mim'],
      texto: 'Digite na **barra de busca** do alto: nome do serviço, bairro, tipo de atendimento ou até um sintoma/assunto. A busca ignora acentos e maiúsculas. Em cada aba do diretório ela filtra só aquela categoria; na aba **Rede Intersetorial de Serviços** ela procura em tudo. Dá para **ordenar por proximidade** (usa a sua localização, se você permitir).', open: 'all', abrir: 'Rede Intersetorial' },
    { id: 'recentes', nome: 'Recentes', keys: ['aba recentes', '!recentes', 'ultimas unidades', 'unidades que abri', 'historico de unidades', 'o que abri'],
      texto: 'A aba **Recentes** guarda as últimas unidades que você abriu, para voltar a elas num toque.', open: 'recentes' },
    { id: 'cartao', nome: 'Cartão de uma unidade', keys: ['cartao da unidade', 'ficha da unidade', 'o que tem no cartao'],
      texto: 'Cada unidade aparece num **cartão** com endereço, telefones (toque para ligar), horário, descrição do serviço e, quando existem, requisitos e documentos. As fichas vêm do diretório do app e devem ser conferidas no órgão responsável quando a regra for importante.' },
    { id: 'abas-diretorio', nome: 'Abas do diretório', keys: ['abas do diretorio', 'quais abas do diretorio', 'aba hospitalar', 'aba raps', 'aba juridico', 'aba educacao', 'aba bancos', 'aba previdencia', 'categorias do diretorio', 'em que aba fica', 'em qual aba'],
      texto: 'As abas do diretório são: **Rede Hospitalar e Atenção Básica**, **RAPS** (saúde mental), **Pessoa com Deficiência e TEA**, **Proteção Social** (CRAS/CREAS), **Segurança Alimentar**, **Educação**, **Poder Judiciário**, **Conselho Tutelar**, **Segurança Pública**, **Rede de Enfrentamento à Violência contra a Mulher**, **Conselhos Municipais de Direitos**, **Documentação Civil**, **Rede Bancária**, **Previdência (INSS)**, **Serviço de Migração**, **Trabalho e Renda**, **Cultura, Esporte e Lazer**, **Habitação**, **Mobilidade**, **Defesa Civil** e **Programas, Projetos e Serviços**. Diga o assunto e eu abro a aba certa.' },
    { id: 'cras-registro', nome: 'Registro de Atendimento (CRAS)', keys: ['registro de atendimento cras', 'aba cras', 'atalhos do cras', 'painel do cras', 'rma', 'equipe tecnica do cras', 'consulta tecnica cras', 'registro mensal de atendimentos', 'registro de atendimento'],
      texto: 'A aba **Registro de Atendimento (CRAS)** é um painel de atalhos técnicos da equipe. Ela reúne páginas internas do app, como a **consulta técnica da equipe do CRAS**, o **RMA** (Registro Mensal de Atendimentos, formulário e planilha com soma) e os calendários do **Bolsa Família**.', open: 'cras', abrir: 'Registro CRAS' },
    { id: 'cas-registro', nome: 'Registro de Atendimento (CAS)', keys: ['registro de atendimento cas', 'aba cas', 'atalhos do cas', 'painel do cas', 'centro de atendimento social'],
      texto: 'A aba **Registro de Atendimento (CAS)** é o painel de atalhos técnicos do Centro de Atendimento Social, para uso interno da equipe.', open: 'cas', abrir: 'Registro CAS' },
    { id: 'agenda', nome: 'Agenda Argo', keys: ['!agenda', 'agenda argo', 'calendario', 'feriados', 'pontos facultativos', 'dia de pagamento', 'como uso a agenda', 'como usar a agenda'],
      texto: 'A **Agenda Argo** é um calendário com **feriados, pontos facultativos e dias de pagamento** marcados, mais as suas **anotações por dia**. Use **＋ Anotar** (ou a tecla **N**) para anotar rápido, por exemplo "14:30 reunião CRAS". As anotações só ficam disponíveis depois de definir um **código de sincronização**; o calendário funciona sem ele.', open: 'agenda' },
    { id: 'agenda-sync', nome: 'Sincronização da Agenda', keys: ['codigo de sincronizacao', 'sincronizar agenda', 'sincronizacao', 'anotacoes em outro aparelho', 'agenda no celular e no computador', 'firebase'],
      texto: 'Para ver as anotações da Agenda em **mais de um aparelho**, defina o mesmo **código de sincronização** em cada um (botão de sincronização da Agenda). O ponto colorido mostra se está conectado. Sem código, o calendário funciona normalmente, só as anotações ficam indisponíveis. Use um código difícil de adivinhar.', open: 'agenda' },
    { id: 'agenda-extras', nome: 'Notificações, estatísticas e calendário do celular', keys: ['notificacoes da agenda', 'lembrete da agenda', 'resumo da semana', 'estatisticas da agenda', 'estatisticas das atividades', 'baixar para o celular', 'exportar agenda', 'arquivo ics', 'ics'],
      texto: 'Na Agenda: o botão de **notificações** ativa o lembrete do resumo da semana (o navegador precisa permitir); o botão **📊** mostra as **estatísticas das atividades** (feitas, pendentes, atrasadas, por dia da semana e período), calculadas no próprio aparelho; e o menu tem **Baixar para o celular (.ics)**, que leva as datas de feriados e pagamentos para o calendário do aparelho. As suas anotações pessoais não entram no .ics.', open: 'agenda' },
    { id: 'mapa', nome: 'Mapa da Rede', keys: ['!mapa', 'mapa da rede', 'mapa dos equipamentos', 'localizar agora', 'pinos do mapa', 'mapa de unidades', 'ver no mapa'],
      texto: 'O **Mapa da Rede** mostra os equipamentos no mapa. Dá para escolher a **categoria**, a **distância** (raio a partir de você) e a base do mapa, e mostrar ou esconder **CRAS/CREAS**. Os pinos usam endereços já localizados e guardados neste aparelho; os que faltam podem ser localizados no botão **Localizar agora**.', open: 'mapa' },
    { id: 'tradutor', nome: 'Tradutor', keys: ['!tradutor', '!traduzir', 'traducao', 'venezuelano', 'espanhol', 'frances', 'ingles', 'estrangeiro', 'falar com estrangeiro', 'frases prontas'],
      texto: 'O **Tradutor** traduz entre português, espanhol, inglês e francês, com **texto e voz** (microfone e alto-falante). Há **frases prontas** de atendimento. A tradução usa um serviço online gratuito e precisa de internet; por isso **não digite nome, endereço, NIS ou outro dado** da pessoa atendida: prefira frases genéricas.', open: 'tradutor' },
    { id: 'noticias', nome: 'Notícias', keys: ['!noticias', 'aba noticias', 'normativos', 'portarias', 'feed', 'novidades do mds', 'noticias do mds', 'salvar noticia', 'noticias nao lidas'],
      texto: 'A aba **Notícias** traz as últimas publicações do **MDS, MEC e Saúde**, com os **normativos separados** das notícias. Você usa **temas rápidos** (ex.: Bolsa Família), filtra por ministério, tipo e período, escolhe a ordem (mais recentes ou mais relevantes para o SUAS), **salva** itens, marca **não lidas**, copia a lista e exporta as salvas em .txt. Precisa de internet para atualizar.', open: 'noticias' },
    { id: 'aplicativos', nome: 'Aplicativos do autor', keys: ['!aplicativos', 'aba aplicativos', '!toth', '!umbrela', '!anona', '!verbus', 'vita', 'caderno de campo', 'paif paf', 'condicionalidades', 'editor de documentos', 'apps do autor'],
      texto: 'A aba **Aplicativos** lista as outras ferramentas do autor, cada uma em seu endereço e com login próprio: **Toth** (caderno de campo), **Umbrela** (PAIF/PAF), **Anona** (condicionalidades do Bolsa Família 2026), **Verbus** (editor de documentos), **Bloco de Notas** e o site **Vita**. Abrem em outra aba e precisam de internet. No celular, use "Adicionar à tela inicial" para criar atalho.', open: 'appsext' },
    { id: 'cripto', nome: 'Criptografia', keys: ['!criptografia', 'aba criptografia', 'proteger com senha', 'senha em documento', 'senha em word', 'senha em excel', 'senha em zip', 'zip com senha', 'proteger arquivo', 'cifrar arquivo', 'criptografar'],
      texto: 'A aba **Criptografia** coloca **senha** em **PDF** (um, vários ou uma pasta), em **Word, Excel e PowerPoint** (padrão do Office, AES-256), em **texto (.txt)** e em **pasta .zip**. Tudo acontece no seu navegador: nenhum arquivo nem senha é enviado a servidor. **Anote a senha**: se for esquecida, não há como recuperar o arquivo. Você recebe uma cópia protegida; o original não é alterado.', open: 'criptografia' },
    { id: 'pdf', nome: 'Central de PDF', keys: ['central de pdf', 'ferramentas de pdf', 'o que tem na central de pdf', 'funcoes do pdf', 'mexer em pdf', 'trabalhar com pdf', 'aba pdf'],
      texto: 'A **Central de PDF** faz tudo no seu navegador, sem enviar arquivo a servidor: **Editar, Unir, Dividir, Excluir páginas, Girar, Numerar, Senha (leva à Criptografia), Marca d\'água, Dados ocultos, Texto, Reduzir, PDF ⇄ Word, PDF ⇄ JPG e Digitalizar (fotos → PDF)**. Na primeira vez que usa cada função, o app baixa uma pequena biblioteca (precisa de internet só nesse momento). Diga qual função quer e eu explico.', open: 'pdftools' },
    { id: 'pdf-editar', nome: 'Editar PDF', keys: ['editar pdf', 'escrever no pdf', 'escrevo no pdf', 'assinar pdf', 'assinatura no pdf', 'realcar pdf', 'cobrir informacao no pdf', 'preencher pdf', 'desenhar no pdf'],
      texto: 'Em **Editar PDF** (até 60 MB) você escreve textos, desenha, realça trechos, cobre informações e coloca uma imagem ou **assinatura** em qualquer página. O texto original não é alterado: as edições ficam por cima. Depois é só **Baixar PDF editado**.', open: 'pdftools', abrir: 'Central de PDF' },
    { id: 'pdf-unir', nome: 'Unir PDFs e fotos', keys: ['unir pdf', 'juntar pdf', 'unificar pdf', 'unir pdfs', 'juntar pdfs', 'juntar fotos em pdf', 'mesclar pdf', 'combinar pdf'],
      texto: 'Em **Unificar PDFs e fotos** você junta até **20 arquivos** (total de 50 MB), PDFs e fotos JPG/PNG, num só documento, na ordem que escolher (arraste ou use as setas). Em cada PDF dá para usar só algumas páginas, e qualquer item pode ser girado.', open: 'pdftools', abrir: 'Central de PDF' },
    { id: 'pdf-dividir', nome: 'Dividir / extrair páginas', keys: ['dividir pdf', 'separar pdf', 'extrair paginas', 'extrair pagina', 'cortar pdf', 'separar paginas', 'pegar so algumas paginas'],
      texto: 'Em **Dividir / extrair páginas** você fica só com as páginas que importam (ex.: **1-3, 5**) ou **separa cada página em um arquivo**, baixado em .zip.', open: 'pdftools', abrir: 'Central de PDF' },
    { id: 'pdf-excluir', nome: 'Excluir páginas', keys: ['excluir paginas', 'apagar paginas do pdf', 'remover paginas', 'tirar pagina do pdf', 'pagina em branco', 'deletar pagina'],
      texto: 'Em **Excluir páginas** você tira páginas em branco ou desnecessárias (há atalhos para ímpares, pares, primeira e última) e baixa o PDF com as demais, na mesma ordem.', open: 'pdftools', abrir: 'Central de PDF' },
    { id: 'pdf-girar', nome: 'Girar páginas', keys: ['girar pdf', 'girar paginas', 'pdf de lado', 'pdf de cabeca para baixo', 'rotacionar pdf', 'virar pagina'],
      texto: 'Em **Girar páginas** você corrige páginas escaneadas de lado ou de cabeça para baixo: 90° à direita, 180° ou 90° à esquerda. Deixe o campo vazio para girar todas ou informe algumas (ex.: **2, 4-6, pares**). O texto original é mantido.', open: 'pdftools', abrir: 'Central de PDF' },
    { id: 'pdf-numerar', nome: 'Numerar páginas', keys: ['numerar paginas', 'numerar pdf', 'numeracao de paginas', 'colocar numero nas paginas', 'paginar pdf', 'rodape com numero'],
      texto: 'Em **Numerar páginas** o app coloca o número de cada página no rodapé (formato "Página 1 de N" ou só o número; posição centro, direita ou esquerda; e o número inicial à sua escolha). Útil para relatórios, pareceres e processos.', open: 'pdftools', abrir: 'Central de PDF' },
    { id: 'pdf-marca', nome: "Marca d'água", keys: ['marca d agua', 'marca dagua', 'marcadagua', 'carimbo no pdf', 'confidencial no pdf', 'copia no pdf', 'uso interno pdf'],
      texto: 'Em **Marca d\'água** você escreve um texto em diagonal sobre todas as páginas (como CÓPIA, CONFIDENCIAL ou USO INTERNO) e escolhe a intensidade (suave, média ou forte). Útil antes de enviar documentos.', open: 'pdftools', abrir: 'Central de PDF' },
    { id: 'pdf-meta', nome: 'Dados ocultos do PDF', keys: ['dados ocultos', 'limpar dados ocultos', 'metadados', 'autor do pdf', 'remover autor do pdf', 'propriedades do pdf', 'anonimizar pdf'],
      texto: 'Em **Limpar dados ocultos** o app apaga título, autor, assunto, palavras-chave e o programa que criou o arquivo. É bom antes de enviar documentos para fora, porque esses dados podem revelar quem e onde o PDF foi feito. O conteúdo das páginas não muda.', open: 'pdftools', abrir: 'Central de PDF' },
    { id: 'pdf-texto', nome: 'Extrair texto do PDF', keys: ['extrair texto', 'pdf para txt', 'copiar texto do pdf', 'texto do pdf', 'pdf em texto'],
      texto: 'Em **Extrair texto (.txt)** o app copia todo o texto do PDF para um arquivo .txt, página por página. Só funciona em PDFs com texto selecionável: documentos escaneados (fotos) não têm texto para copiar.', open: 'pdftools', abrir: 'Central de PDF' },
    { id: 'pdf-reduzir', nome: 'Reduzir tamanho do PDF', keys: ['reduzir pdf', 'comprimir pdf', 'diminuir pdf', 'pdf muito grande', 'reduzir tamanho', 'compactar pdf', 'pdf pesado', 'limite de tamanho', 'reduzir tamanho do pdf'],
      texto: 'Em **Reduzir tamanho** o app diminui o arquivo para caber em sistemas com limite (e-mail, portais). Atenção: as **páginas viram imagens**, então o texto deixa de poder ser selecionado ou copiado. Escolha a qualidade e confira o resultado antes de usar.', open: 'pdftools', abrir: 'Central de PDF' },
    { id: 'pdf-word', nome: 'PDF ⇄ Word', keys: ['pdf para word', 'word para pdf', 'pdf em word', 'converter pdf', 'converter word', 'docx para pdf', 'pdf para docx', 'converter documento'],
      texto: 'A Central converte **PDF → Word** (extrai o texto para um .docx editável, até 60 MB; a conversão é baseada no texto do arquivo) e **Word → PDF** (de um .docx para PDF pronto para impressão, mantendo títulos e parágrafos). Confira o resultado antes de usar, principalmente a formatação.', open: 'pdftools', abrir: 'Central de PDF' },
    { id: 'pdf-jpg', nome: 'PDF → JPG e fotos → PDF', keys: ['pdf para jpg', 'pdf em imagem', 'pdf para imagem', 'jpg para pdf', 'imagem para pdf', 'foto para pdf', 'digitalizar documento', '!digitalizar', 'escanear documento', '!escanear', '!scanner', 'fotografar documento'],
      texto: '**PDF → JPG** transforma cada página em uma imagem (vários arquivos saem juntos num .zip). **Digitalizar: fotos → PDF** (até 20 imagens, total de 40 MB) deixa você fotografar ou escolher as páginas, **cortar as bordas (✂)**, limpar o papel e gerar um único PDF na ordem escolhida. Para várias páginas, toque em "Tirar foto" uma vez por página.', open: 'pdftools', abrir: 'Central de PDF' },
    { id: 'ferramentas', nome: 'Ferramentas', keys: ['aba ferramentas', 'o que tem nas ferramentas', 'quais ferramentas', 'lista de ferramentas', 'relogio calculos planilhas e notas', 'ferramentas do app'],
      texto: 'A aba **Ferramentas** tem 16 cartões: **Relógio** (cronômetro, temporizador e alarme), **Calculadora**, **Renda per capita**, **Idade e datas**, **Gerador de QR Code**, **Contador de atendimentos**, **Calculadora de prazos**, **Conferir NIS e CPF**, **Porcentagens**, **Soma e média de uma lista**, **Valor por extenso**, **Link de WhatsApp**, **Formatar texto**, **Acompanhamento de famílias**, **Analisador de planilha** e **Bloco de notas**. Há uma busca para achar o cartão pelo assunto.', open: 'ferramentas' },
    { id: 'relogio', nome: 'Relógio, cronômetro e alarme', keys: ['!relogio', '!cronometro', '!temporizador', 'timer', 'alarme', 'despertador', 'lembrete de horario', 'horario de boa vista'],
      texto: 'O **Relógio** mostra o horário de Boa Vista e tem **cronômetro**, **temporizador** e **alarme** (uma vez, todo dia ou segunda a sexta, com aviso digitado). O aviso toca (som e vibração) mesmo se você trocar de aba, **desde que o app continue aberto e destrancado**. Os alarmes ficam salvos, cifrados, neste aparelho.', open: 'ferramentas' },
    { id: 'calculadora', nome: 'Calculadora', keys: ['!calculadora', 'calcular', 'fazer conta', 'historico da calculadora', 'memoria da calculadora', 'teclado da calculadora'],
      texto: 'A **Calculadora** tem memória (M), histórico, botão **Copiar**, modo em **R$** e aceita o **teclado** (números, + − * /, Enter, Backspace, Esc limpa tudo, Del limpa o número). Ctrl+V cola um valor.', open: 'ferramentas' },
    { id: 'renda', nome: 'Renda per capita', keys: ['renda per capita', 'per capita', 'meio salario minimo', 'calcular renda', 'renda familiar', 'renda da familia', 'corte do cadunico'],
      texto: 'O cartão **Renda per capita** divide a renda da família pelo número de pessoas. Você informa o **salário mínimo** e a **linha do Bolsa Família** (valores de referência de 2026, editáveis), as **pessoas na família** e soma cada renda em **+ Adicionar renda**. Conte a renda bruta mensal de quem mora na casa; em geral não entram BPC, Bolsa Família e auxílios assistenciais. Os valores de referência eu também sei dizer. Confirme a regra vigente com o órgão responsável.', open: 'ferramentas' },
    { id: 'idade', nome: 'Idade e datas', keys: ['calcular idade', 'idade e datas', 'faixa etaria', 'idade em meses', 'data de nascimento', 'quantos anos tem'],
      texto: 'O cartão **Idade e datas** calcula a idade a partir da **data de nascimento** até uma data à sua escolha. Serve para checar a **faixa etária** de serviços (crianças, adolescentes, idosos) e a idade em meses de bebês.', open: 'ferramentas' },
    { id: 'qr', nome: 'Gerador de QR Code', keys: ['qr code', 'qrcode', 'gerar qr', 'codigo qr', 'qr de link'],
      texto: 'O **Gerador de QR Code** transforma um link (ou texto) em um QR Code que você pode baixar como imagem PNG.', open: 'ferramentas' },
    { id: 'contador', nome: 'Contador de atendimentos', keys: ['contador de atendimentos', 'contar atendimentos', 'contador rma', 'contagem mensal', 'contagem de atendimentos'],
      texto: 'O **Contador de atendimentos** conta os atendimentos **dia a dia** e gera o **resumo do mês** para copiar (botões Copiar resumo do mês e Zerar este dia). Guarda só contagens, sem nomes. Atenção: essas contagens ficam neste aparelho e **não entram no backup** nem saem em "Apagar dados salvos".', open: 'ferramentas' },
    { id: 'prazos', nome: 'Calculadora de prazos', keys: ['calculadora de prazos', 'calcular prazo', 'prazo em dias uteis', 'dias uteis', 'dias corridos', 'data de vencimento', 'somar dias'],
      texto: 'A **Calculadora de prazos** soma ou subtrai **dias corridos ou úteis** a partir de uma data (atalhos de 5, 10, 15, 30, 60 e 90 dias). A contagem começa no **dia seguinte** à data de partida; em dias úteis saem sábados, domingos, feriados e pontos facultativos cadastrados na Agenda. Confira a regra do prazo no normativo ou no ofício.', open: 'ferramentas' },
    { id: 'nis-cpf', nome: 'Conferir NIS e CPF', keys: ['conferir nis', 'conferir cpf', 'validar cpf', 'validar nis', 'digito verificador', 'nis esta certo', 'cpf esta certo', 'numero do nis', 'conferir tudo'],
      texto: 'O cartão **Conferir NIS e CPF** confere o **dígito verificador** (e as datas) do número digitado: botões Conferir tudo, Conferir NIS, Conferir CPF e Conferir datas. Ele só mostra se o número é **válido na forma**; não consulta nenhum cadastro.', open: 'ferramentas' },
    { id: 'porcentagem', nome: 'Porcentagens', keys: ['porcentagem', 'porcentagens', 'calcular percentual', 'percentual', 'acrescimo', 'desconto', 'reajuste', 'variacao percentual'],
      texto: 'O cartão **Porcentagens** faz cinco contas: quanto é X% de um valor, quanto uma parte representa do total, acréscimo, desconto e variação entre dois valores (aumento ou redução). Tem botão para copiar o resultado.', open: 'ferramentas' },
    { id: 'lista', nome: 'Soma e média de uma lista', keys: ['soma e media', 'somar lista', 'media de uma lista', 'mediana', 'somar valores', 'somar coluna', 'estatistica de lista'],
      texto: 'O cartão **Soma e média de uma lista** recebe valores (um por linha ou separados por ;) e calcula **soma, média, mediana, menor e maior**. Texto misturado é ignorado: só os números entram na conta. O que você cola fica só na tela.', open: 'ferramentas' },
    { id: 'extenso', nome: 'Valor por extenso', keys: ['valor por extenso', 'escrever valor', 'numero por extenso', 'valor em extenso', 'por extenso', 'recibo', 'beneficio eventual por extenso'],
      texto: 'O cartão **Valor por extenso** escreve um valor em reais por extenso (ex.: para recibos, ofícios e declarações de benefício eventual).', open: 'ferramentas' },
    { id: 'whatsapp', nome: 'Link de WhatsApp', keys: ['link de whatsapp', 'link do whatsapp', 'abrir whatsapp sem salvar', 'whatsapp sem salvar contato', 'wa me', 'mensagem no whatsapp'],
      texto: 'O cartão **Link de WhatsApp** monta o link para abrir uma conversa com um número (com DDD) e uma mensagem pronta, sem precisar salvar o contato.', open: 'ferramentas' },
    { id: 'texto', nome: 'Formatar texto', keys: ['formatar texto', 'maiuscula', 'minuscula', 'nome proprio', 'limpar espacos', 'contar palavras', 'padronizar texto', 'tirar acentos'],
      texto: 'O cartão **Formatar texto** muda maiúsculas/minúsculas e nome próprio, limpa espaços e acentos, conta palavras e padroniza textos colados.', open: 'ferramentas' },
    { id: 'acomp', nome: 'Acompanhamento de famílias e Analisador de planilha', keys: ['acompanhamento de familias', 'analisador de planilha', 'planilha de familias', 'duplicados na planilha', 'importar planilha', 'xlsx', 'csv', 'retorno vencido', 'visitas pendentes', 'achar repetidos'],
      texto: '**Acompanhamento de famílias** lê uma planilha (.xlsx ou .csv) e mostra retornos vencidos, pendências e situação por técnico ou bairro. O **Analisador de planilha** acha **duplicados** e conta repetições por coluna (por exemplo, NIS repetido). O processamento é feito no seu aparelho.', open: 'ferramentas' },
    { id: 'bloco', nome: 'Bloco de notas', keys: ['bloco de notas', '!anotacao', '!anotacoes', 'nova nota', 'modelo de nota', 'lista de tarefas', 'checklist', 'fixar nota', 'nota em pdf', 'anotar atendimento'],
      texto: 'O **Bloco de notas** (aba **Ferramentas**) guarda quantas notas você quiser: **+ Nova**, **Modelos** (Atendimento, Visita domiciliar, Contato por telefone, Acompanhamento familiar, Reunião de equipe, Tarefas do dia), **Data/hora**, **☐ Lista** (checklist), **Fixar**, **Copiar**, **Exportar** e **Esta nota em PDF**. As notas ficam cifradas neste aparelho. Para anotações por dia, com sincronização entre aparelhos, use a **Agenda**.', open: 'ferramentas', abrir: 'Ferramentas' },
    { id: 'senha', nome: 'Senha e entrada no app', keys: ['senha do app', 'esqueci a senha', 'trocar a senha', 'login', 'entrar no app', 'tela de login', 'senha errada', 'bloqueou depois de errar', 'tentativas de senha', 'app trancado'],
      texto: 'O app pede **senha** para abrir. Depois de **{tentativas} tentativas erradas**, ele bloqueia por um tempo que vai aumentando (começa em 30 segundos e chega a 10 minutos). A senha protege os dados salvos neste aparelho. Se a senha for trocada, faça o **backup antes**, troque e só então restaure.' },
    { id: 'conectado', nome: 'Manter-me conectado e bloqueio automático', keys: ['manter conectado', 'manter me conectado', 'bloqueio automatico', 'inatividade', 'trancou sozinho', 'app trancou', 'sessao expirou', 'por que pediu a senha de novo', 'sair do app', 'sair'],
      texto: '**Manter-me conectado nesta aba** evita digitar a senha de novo ao atualizar a página, mas só vale na mesma aba e **expira em {lembrarHoras} horas**; use só em aparelho seu. O app **tranca sozinho depois de {bloqueioMin} minutos sem uso** (ou ao voltar de uma aba escondida por esse tempo), para proteger os dados dos atendidos. **Sair** tranca na hora e apaga o "manter conectado".' },
    { id: 'backup', nome: 'Backup e restauração', keys: ['!backup', 'backup de anotacoes', 'fazer backup', 'importar backup', 'restaurar backup', 'restaurar dados', 'exportar dados', 'trocar de aparelho', 'passar dados para outro aparelho', 'perdi minhas anotacoes'],
      texto: 'No menu lateral há **Backup de anotações** (baixa um arquivo com os seus dados salvos) e **Importar backup** (restaura). O arquivo é **cifrado com a senha em uso** na hora de exportar; para restaurar, entre com a mesma senha. Use o backup antes de trocar de aparelho, de limpar o navegador ou de trocar a senha.' },
    { id: 'apagar', nome: 'Apagar dados do aparelho', keys: ['apagar dados', 'apagar dados salvos', 'limpar dados do aparelho', 'computador compartilhado', 'apagar tudo', 'limpar meus dados', 'emprestar computador'],
      texto: 'O botão **Apagar dados salvos neste dispositivo** (menu lateral) remove deste navegador nomes, endereços, anexos, notas e alarmes salvos. Use **antes de emprestar ou devolver um computador compartilhado**, porque a tela de login não protege o que já está no navegador. Faça o **backup** antes, se quiser guardar. A ação pede confirmação.' },
    { id: 'privacidade', nome: 'Privacidade e dados pessoais', keys: ['privacidade', 'dados pessoais', 'lgpd', 'o app guarda dados', 'onde ficam os dados', 'e seguro', 'e seguro usar', 'seguranca do app', 'dados dos atendidos'],
      texto: 'Os dados que você salva ficam **neste aparelho**, cifrados com a sua senha; a Central de PDF e a Criptografia trabalham no navegador, sem enviar arquivos. Exceções: o **Tradutor** e as **Notícias** usam serviços online, e a **sincronização da Agenda** guarda as anotações na nuvem sob o seu código. Evite digitar nome, CPF ou NIS de quem foi atendido no Tradutor e na conversa comigo.' },
    { id: 'offline', nome: 'Uso sem internet', keys: ['sem internet', 'offline', 'funciona sem internet', 'sem conexao', 'instalar o app', 'adicionar a tela inicial', 'instalar no celular', 'pwa'],
      texto: 'O diretório, a base SUAS e várias ferramentas funcionam **sem internet** depois de carregados. Precisam de internet: **Notícias**, **Tradutor**, **Aplicativos**, a **sincronização da Agenda** e, na primeira vez, cada função da Central de PDF. No celular, use "Adicionar à tela inicial" do navegador para ter o atalho.' },
    { id: 'tema', nome: 'Tema claro e escuro', keys: ['modo escuro', 'tema escuro', 'tema claro', 'modo claro', 'trocar o tema', 'mudar a cor do app'],
      texto: 'Para mudar o tema, é só pedir: **"modo escuro"** ou **"modo claro"**. Eu troco na hora.' }
  ];
  var manualIndex = null;
  function manualTexto(e) {
    return e.texto.replace(/\{(\w+)\}/g, function (m, k) { return MANUAL_VARS[k] != null ? MANUAL_VARS[k] : m; });
  }
  // palavra sem plural simples e sem as de ligação ("pdf de lado" ~ "pdfs lado")
  var MAN_LIGACAO = asSet(['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'e', 'ou', 'que', 'para', 'pra', 'por', 'com', 'se', 'ao']);
  function manualRaiz(w) { return w.length > 3 && w.charAt(w.length - 1) === 's' ? w.slice(0, -1) : w; }
  function manualToks(s) { return norm(s).split(' ').filter(function (w) { return w && !MAN_LIGACAO[w]; }).map(manualRaiz); }
  // chave que começa com "!" é nome de aba/ferramenta (ex.: "!mapa"): uma palavra só já basta. As demais precisam de 2+ palavras.
  function manualBuild() {
    manualIndex = MANUAL.map(function (e) {
      return { e: e, keys: e.keys.map(function (k) {
        var forte = k.charAt(0) === '!', toks = manualToks(forte ? k.slice(1) : k);
        return { toks: toks, forte: forte, peso: forte ? 4 : (toks.length > 1 ? 3 + toks.length : 2) };
      }).filter(function (k) { return k.toks.length; }) };
    });
  }
  // melhor verbete: vale a melhor chave (todas as suas palavras presentes na pergunta) + 1 por chave extra
  function manualAcha(text) {
    if (!manualIndex) manualBuild();
    var q = asSet(manualToks(text)), best = null;
    manualIndex.forEach(function (it) {
      var top = 0, extra = 0;
      it.keys.forEach(function (k) {
        for (var i = 0; i < k.toks.length; i++) if (!q[k.toks[i]]) return;
        if (k.peso > top) { if (top) extra++; top = k.peso; } else extra++;
      });
      var sc = top ? top + Math.min(extra, 3) : 0;
      if (sc && (!best || sc > best.score)) best = { entry: it.e, score: sc };
    });
    return best;
  }
  var RE_MAN_PERGUNTA = /\b(como|onde|qual|quais|que aba|o que|para que|pra que|serve|funciona|funcao|usar|uso|usa|abrir|abro|acho|achar|encontro|encontrar|fica|explica|ensina|aprender|tutorial|passo a passo|consigo|posso|da para|tem como|tem (alguma|algum)|existe|quero|preciso)\b/;
  var RE_MAN_DIRETORIO = /\b(telefone|fone|numero de contato|endereco|horario de funcionamento|atende|atendem|quem atende|bairro|cep|requisitos|documentos necessarios)\b/;
  function manualAsk(text) {
    var n = norm(text);
    if (n.length < 5 || n.length > 240) return null;
    if (!RE_MAN_PERGUNTA.test(n)) return null;
    if (RE_MAN_DIRETORIO.test(n)) return null;
    var b = manualAcha(text);
    if (!b || b.score < 3) return null;
    var e = b.entry, acts = [];
    if (e.open) acts.push({ label: 'Abrir ' + (e.abrir || e.nome), cat: e.open });
    return { reply: manualTexto(e), mood: 'info', badge: 'Manual do Argo',
      note: 'Resumo de como o app funciona hoje; se algo na tela estiver diferente, vale conferir lá.',
      quickActions: acts, followups: ['O que o app faz?', 'Quais ferramentas tem?'], units: [] };
  }
  // verbetes que acompanham a pergunta à IA (pergunta sobre o app): a IA não tem como adivinhar como o Argo funciona
  function manualBase(text) {
    var n = norm(text);
    if (n.length < 5 || RE_MAN_DIRETORIO.test(n)) return [];
    var b = manualAcha(text);
    if (!b || b.score < 3 || !RE_MAN_PERGUNTA.test(n)) return [];
    return [{ titulo: 'Manual do app Argo: ' + b.entry.nome, texto: limpaMd(manualTexto(b.entry)), origem: 'manual conferido no código do app' }];
  }

  // Itens (até 3) que acompanham a pergunta à IA: o que o app sabe e a IA não tem como adivinhar.
  function baseApp(text) {
    var out = [], n = norm(text);
    try {
      var ps = psiScore(text);
      if (ps.score >= 3 && ps.entry) out.push({ titulo: 'Base do psicólogo no SUAS: ' + ps.entry.cat, texto: limpaMd(ps.entry.text), origem: ps.entry.base });
      var gs = glossaryScore(text);
      if (gs.score >= 3 && gs.entry && out.length < 3) out.push({ titulo: 'Base SUAS (glossário do app)', texto: limpaMd(gs.entry.text), origem: gs.entry.base });
    } catch (e) { /* sem verbete */ }
    try {
      // município de Roraima citado: a IA recebe a ficha com os números reais (e a ordem de não inventar)
      if (rr) {
        var mm = rrAchar(n).slice(0, 2);
        mm.slice().reverse().forEach(function (x) { out.unshift({ titulo: 'Dados do município de ' + x.nome + ' (Roraima)', texto: rrFichaTexto(x), origem: 'assets/municipios-rr.json: Censo 2022 (IBGE), SEPLAN-RR e MDS' }); });
        if (!mm.length && /\broraima\b/.test(n) && /\b(populacao|habitantes|indigenas?|municipios?|area|crescimento)\b/.test(n)) out.unshift({ titulo: 'Dados do estado de Roraima', texto: rrEstadoTexto() + ' Use SOMENTE estes números.', origem: 'assets/municipios-rr.json: Censo 2022 (IBGE) e SEPLAN-RR' });
      }
    } catch (e2) { /* sem ficha */ }
    if (RE_REFS.test(n) && refsTexto()) out.push({ titulo: 'Valores de referência do app (2026)', texto: refsTexto(), origem: 'ferramenta de renda per capita do Argo' });
    var pg = pbfPagamento(text);
    if (pg && out.length < 4) out.push({ titulo: 'Calendário de pagamento do Bolsa Família', texto: pg, origem: 'ferramentas/pagamento-pbf.html (Argo)' });
    var man = manualBase(text);
    if (man.length) out = man.concat(out);
    var censo = censoBaseApp(text);
    if (censo.length) return censo.concat(out).slice(0, 4);
    return out.slice(0, 4);
  }

  // Resposta direta da ficha (sem IA) para "requisitos / documentos / valor / como solicitar" de um serviço que o diretório identifica bem.
  function casaSet(tokens) { var set = asSet(tokens); return function (w) { return casa(set, w) > 0; }; }
  function fichaAsk(text) {
    var n = norm(text);
    if (/^(o que (e|significa)|que e)\b/.test(n)) return null;       // definição: glossário
    var ints = intentsDe(n).filter(function (i) { return i.id !== 'lista' || /\b(remedios|medicamentos)\b/.test(n); });
    if (!ints.length) return null;
    var dir = directory(text, { units: [] }, null);
    if (!dir.units.length || dir.contact && !ints.length) return null;
    if (!(dir.mode === 'single' || dir.confidence >= 0.5)) return null;
    var top = dir.units[0], d = fichaDe(top.id);
    if (!d || !d.id) return null;
    // o nome da unidade precisa estar (quase todo) na pergunta: evita responder pela ficha errada ("passe livre do idoso" x "Passe Livre ... Deficiência")
    var qs = casaSet(tokensPass(text)), cobre = 0;
    [d.name, d.fullName].forEach(function (nm) {
      var nt = tokensPass(nm); if (!nt.length) return;
      var ok = nt.filter(function (w) { return qs(w); }).length / nt.length;
      if (ok > cobre) cobre = ok;
    });
    if (cobre < 0.75) return null;
    var tr = trechosDa(d, text, 1300, 2.2);
    if (!tr.itens.length || tr.melhor < 2.6) return null;
    // várias fichas de mesmo peso (ex.: BPC idoso x BPC pessoa com deficiência): deixa para a IA decidir com as duas
    if (dir.units.length > 1 && dir.mode === 'list') {
      var seg = fichaDe(dir.units[1].id), t2 = seg && seg.id ? trechosDa(seg, text, 1300, 2.2) : { melhor: 0 };
      if (t2.melhor >= tr.melhor * 0.9) return null;
    }
    var linhas = ['**' + (d.fullName && d.fullName.length < 70 ? d.fullName : d.name) + '** · do cartão no diretório:'];
    tr.itens.forEach(function (x) { linhas.push('- ' + cut(x.t, 520)); });
    return {
      reply: linhas.join('\n'), mood: 'info', badge: 'Ficha do diretório',
      note: 'Trechos copiados da ficha do diretório; confira a regra vigente no órgão responsável.',
      followups: ['Qual o telefone?', 'Qual o endereço?'], units: [top], fichaId: d.id
    };
  }
  function pbfOuRefsAsk(text) {
    var n = norm(text);
    var pg = pbfPagamento(text);
    if (pg) return { reply: pg, mood: 'info', badge: 'Calendário PBF', note: 'Confira o calendário oficial vigente no MDS ou na Caixa (121 / 111).', units: [] };
    if (RE_REFS.test(n) && refsTexto() && /\b(quanto|valor|qual)\b/.test(n)) return { reply: refsTexto(), mood: 'info', badge: 'Valores de referência', note: 'Valores usados na ferramenta de renda per capita do Argo; confira o decreto vigente.', units: [] };
    return null;
  }

  // ---------------------------------------------------------------------
  // PSICÓLOGOS NO CENSO SUAS 2025 — Boa Vista em detalhe, Roraima em totais
  // Resposta direta, SEM IA. Fonte: pacote "Censo SUAS 2025 Roraima" (RH agregado, sem nomes nem CPF).
  // O número é de REGISTROS de RH por módulo, não de pessoas: um profissional pode aparecer em mais de um módulo.
  // Cada módulo de CP_MUN: [registros de RH, registros de psicólogos, unidades com RH, unidades com psicólogo]
  // (null = o módulo não traz identificador de unidade). Módulo ausente = sem linhas de RH no arquivo
  // (isso NÃO prova que o serviço não exista). Para atualizar: troque os números, confira com os trechos de
  // knowledge/documentos/censo-suas-2025-roraima-psicologos.md (Paulus) e rode npm run test:territorio.
  // ---------------------------------------------------------------------
  var CP_ANO = 2025;
  var CP_MOD = { cras: 'CRAS', creas: 'CREAS', conv: 'Centro de Convivência', acol: 'Unidade de Acolhimento', fam: 'Família Acolhedora (equipe)', gest: 'Gestão Municipal do SUAS', posto: 'Posto de Cadastramento do CadÚnico', fundo: 'Fundo Municipal de Assistência Social', pop: 'Centro POP' };
  var CP_ORD = ['cras', 'creas', 'conv', 'acol', 'fam', 'gest', 'posto', 'fundo'];
  var CP_MUN = {
      'Alto Alegre': {cras: [24,2,2,1], creas: [9,1,1,1], fundo: [4,0,null,null], gest: [8,0,null,null], posto: [3,0,1,0]},
      'Amajari': {cras: [5,1,1,1], creas: [5,1,1,1], conv: [3,0,1,0], fundo: [2,0,null,null], gest: [2,0,null,null], posto: [4,0,1,0]},
      'Boa Vista': {cras: [323,19,8,8], creas: [77,13,2,2], conv: [91,4,5,3], fam: [5,1,1,1], fundo: [15,0,null,null], gest: [126,3,null,null], posto: [4,0,1,0], acol: [133,3,2,2]},
      'Bonfim': {cras: [19,2,1,1], creas: [6,1,1,1], fundo: [1,0,null,null], gest: [5,0,null,null]},
      'Cantá': {cras: [18,2,1,1], creas: [5,1,1,1]},
      'Caracaraí': {cras: [25,0,2,0], creas: [5,1,1,1], fundo: [1,0,null,null], gest: [6,0,null,null], posto: [3,0,1,0], acol: [14,0,1,0]},
      'Caroebe': {cras: [18,1,1,1], creas: [5,1,1,1], fundo: [1,0,null,null], gest: [3,0,null,null], posto: [4,0,1,0]},
      'Iracema': {cras: [23,1,1,1], creas: [3,1,1,1], fundo: [2,0,null,null], gest: [7,0,null,null], posto: [5,0,1,0]},
      'Mucajaí': {cras: [4,0,1,0], creas: [3,1,1,1], fundo: [1,0,null,null], gest: [1,0,null,null], posto: [3,0,1,0]},
      'Normandia': {cras: [19,1,1,1], creas: [9,1,1,1], fundo: [1,0,null,null], gest: [7,0,null,null]},
      'Pacaraima': {cras: [41,1,1,1], creas: [9,1,1,1], fundo: [1,0,null,null], gest: [12,0,null,null]},
      'Rorainópolis': {cras: [13,1,1,1], creas: [9,1,1,1], fundo: [3,0,null,null], gest: [5,0,null,null], posto: [6,0,1,0]},
      'São João da Baliza': {cras: [1,0,1,0], creas: [2,1,1,1], fundo: [1,0,null,null], gest: [2,0,null,null], posto: [2,0,1,0]},
      'São Luiz': {cras: [12,1,1,1], fundo: [1,0,null,null], gest: [3,0,null,null], posto: [5,0,1,0]},
      'Uiramutã': {cras: [2,0,1,0], creas: [2,1,1,1], fundo: [3,0,null,null], gest: [3,0,null,null], posto: [1,0,1,0]}
  };
  // Roraima: registros de psicólogos por módulo (município identificado + acolhimento sem município + esfera estadual)
  var CP_RR = { total: 161, identificados: 69, acolhSemMun: 41, estadual: 51, mod: { cras: 32, creas: 26, conv: 4, acol: 44, fam: 1, gest: 3 }, gestEst: 50, fundoEst: 1 };
  // Boa Vista: perfil agregado dos psicólogos por módulo e composição da equipe de RH (CRAS e CREAS)
  var CP_BV_PERFIL = {
    cras: ['sexo: 16 mulheres e 3 homens', 'escolaridade: 10 com superior completo e 9 com especialização', 'vínculo: 18 estatutários e 1 temporário', 'função: 18 técnicos de nível superior e 1 em apoio administrativo', 'carga horária: 17 de 21 a 30 h semanais e 2 de 31 a 40 h', 'serviço principal: PAIF 14, Serviço de PSB no domicílio 3, Convivência e Fortalecimento de Vínculos 1, Benefícios Eventuais 1', 'segundo serviço: PAIF 6, Bolsa Família e condicionalidades 5, Convivência e Fortalecimento de Vínculos 2, PSB no domicílio 2, CadÚnico 1, Benefícios Eventuais 1, Criança Feliz 1, não informado 1'],
    creas: ['sexo: 11 mulheres e 2 homens', 'escolaridade: 8 com superior completo e 5 com especialização', 'vínculo: 12 estatutários e 1 comissionado', 'função: 12 técnicos de nível superior e 1 coordenador(a)/dirigente', 'carga horária: todos de 21 a 30 h semanais'],
    conv: ['sexo: 3 mulheres e 1 homem', 'escolaridade: 4 com superior completo', 'vínculo: 2 estatutários, 1 temporário e 1 celetista (CLT)', 'função: 4 técnicos de nível superior', 'carga horária: todos de 21 a 30 h semanais'],
    acol: ['sexo: 3 mulheres', 'escolaridade: 2 com especialização e 1 com mestrado', 'vínculo: 3 estatutárias', 'função: 3 técnicas de nível superior', 'carga horária: todas de 21 a 30 h semanais'],
    fam: ['sexo: 1 mulher', 'escolaridade: especialização', 'vínculo: estatutária', 'função: técnica de nível superior'],
    gest: ['sexo: 3 mulheres', 'escolaridade: 2 com especialização e 1 com superior completo', 'vínculo: 3 estatutárias', 'função: 3 técnicas de nível superior', 'carga horária: todas de 21 a 30 h semanais']
  };
  var CP_BV_EQUIPE = {
    cras: 'equipe de RH dos CRAS: 209 de nível médio, 35 assistentes sociais, 28 sem formação profissional, **19 psicólogos**, 17 de outra formação de nível superior, 11 pedagogos e 4 de outras profissões (de 323)',
    creas: 'equipe de RH dos CREAS: 33 de nível médio, 17 assistentes sociais, **13 psicólogos**, 7 de outra formação de nível superior, 5 pedagogos, 1 advogado e 1 sem formação profissional (de 77)',
    conv: 'equipe de RH dos Centros de Convivência: 40 de nível médio, 12 sem formação profissional, 11 de outra formação de nível superior, 9 de administração/gestão pública, 8 assistentes sociais, 5 pedagogos, **4 psicólogos**, 1 advogado e 1 terapeuta ocupacional (de 91)',
    acol: 'equipe de RH das Unidades de Acolhimento: 80 de nível médio, 31 sem formação profissional, 10 de outra formação de nível superior, 4 assistentes sociais, **3 psicólogos**, 2 nutricionistas, 2 pedagogos e 1 enfermeiro (de 133)',
    fam: 'equipe de RH da Família Acolhedora: 2 assistentes sociais, **1 psicólogo**, 1 de nível médio e 1 sem formação profissional (de 5)',
    gest: 'equipe de RH da Gestão Municipal do SUAS: 79 de nível médio, 17 de outra formação de nível superior, 11 assistentes sociais, 9 sem formação profissional, **3 psicólogos**, 2 advogados, 2 pedagogos, 1 antropólogo, 1 nutricionista e 1 sociólogo (de 126)',
    fundo: 'equipe de RH do Fundo Municipal de Assistência Social: 6 de outra formação de nível superior, 2 administradores, 2 contadores, 2 de nível médio, 2 sem formação profissional e 1 economista (de 15); nenhum psicólogo',
    posto: 'equipe de RH do Posto de Cadastramento do CadÚnico: 3 de nível médio e 1 de outra formação de nível superior (de 4); nenhum psicólogo'
  };
  // Psicólogos dos 14 municípios do interior (Censo SUAS 2025): perfil agregado e composição da equipe de RH.
  // GERADO por scripts/gerar-censo-psi-rr.mjs a partir dos CSVs do pacote do Censo; não edite à mão. Mesmo formato de CP_BV_PERFIL / CP_BV_EQUIPE.
  var CP_PERFIL_MUN = {
      "Alto Alegre": {
      "cras": [ "sexo: 2 mulheres", "escolaridade: 2 com superior completo", "vínculo: 1 comissionado e 1 estatutário", "função: 2 técnicos de nível superior", "carga horária: 1 de 21 a 30 h semanais e 1 de 31 a 40 h semanais", "serviço principal: PAIF 2", "segundo serviço: Serviço de PSB no domicílio 2" ],
      "creas": [ "sexo: 1 mulher", "escolaridade: 1 com superior completo", "vínculo: 1 estatutário", "função: 1 técnico de nível superior", "carga horária: 1 de 31 a 40 h semanais" ] },
    "Amajari": {
      "cras": [ "sexo: 1 homem", "escolaridade: 1 com superior completo", "vínculo: 1 estatutário", "função: 1 técnico de nível superior", "carga horária: 1 de 21 a 30 h semanais", "serviço principal: PAIF 1", "segundo serviço: Convivência e Fortalecimento de Vínculos 1" ],
      "creas": [ "sexo: 1 homem", "escolaridade: 1 com superior completo", "vínculo: 1 com outro vínculo não permanente", "função: 1 técnico de nível superior", "carga horária: 1 de 21 a 30 h semanais" ] },
    "Bonfim": {
      "cras": [ "sexo: 2 homens", "escolaridade: 2 com superior completo", "vínculo: 2 temporários", "função: 2 técnicos de nível superior", "carga horária: todos de 21 a 30 h semanais", "serviço principal: PAIF 2", "segundo serviço: não informado 2" ],
      "creas": [ "sexo: 1 mulher", "escolaridade: 1 com superior completo", "vínculo: 1 temporário", "função: 1 técnico de nível superior", "carga horária: 1 de 21 a 30 h semanais" ] },
    "Cantá": {
      "cras": [ "sexo: 1 mulher e 1 homem", "escolaridade: 2 com superior completo", "vínculo: 2 temporários", "função: 2 técnicos de nível superior", "carga horária: 1 de 21 a 30 h semanais e 1 de 31 a 40 h semanais", "serviço principal: PAIF 2", "segundo serviço: não informado 2" ],
      "creas": [ "sexo: 1 homem", "escolaridade: 1 com superior completo", "vínculo: 1 temporário", "função: 1 técnico de nível superior", "carga horária: 1 de 31 a 40 h semanais" ] },
    "Caracaraí": {
      "creas": [ "sexo: 1 mulher", "escolaridade: 1 com superior completo", "vínculo: 1 temporário", "função: 1 técnico de nível superior", "carga horária: 1 de 21 a 30 h semanais" ] },
    "Caroebe": {
      "cras": [ "sexo: 1 homem", "escolaridade: 1 com superior completo", "vínculo: 1 temporário", "função: 1 técnico de nível superior", "carga horária: 1 de 21 a 30 h semanais", "serviço principal: PAIF 1", "segundo serviço: outros serviços 1" ],
      "creas": [ "sexo: 1 homem", "escolaridade: 1 com superior completo", "vínculo: 1 temporário", "função: 1 técnico de nível superior", "carga horária: 1 de 21 a 30 h semanais" ] },
    "Iracema": {
      "cras": [ "sexo: 1 homem", "escolaridade: 1 com superior completo", "vínculo: 1 comissionado", "função: 1 técnico de nível superior", "carga horária: 1 de 21 a 30 h semanais", "serviço principal: Convivência e Fortalecimento de Vínculos 1", "segundo serviço: Convivência e Fortalecimento de Vínculos 1" ],
      "creas": [ "sexo: 1 homem", "escolaridade: 1 com superior completo", "vínculo: 1 temporário", "função: 1 técnico de nível superior", "carga horária: 1 de 21 a 30 h semanais" ] },
    "Mucajaí": {
      "creas": [ "sexo: 1 mulher", "escolaridade: 1 com superior completo", "vínculo: 1 comissionado", "função: 1 técnico de nível superior", "carga horária: 1 de 31 a 40 h semanais" ] },
    "Normandia": {
      "cras": [ "sexo: 1 mulher", "escolaridade: 1 com superior completo", "vínculo: 1 temporário", "função: 1 técnico de nível superior", "carga horária: 1 de 21 a 30 h semanais", "serviço principal: PAIF 1", "segundo serviço: PAIF 1" ],
      "creas": [ "sexo: 1 mulher", "escolaridade: 1 com superior completo", "vínculo: 1 temporário", "função: 1 técnico de nível superior", "carga horária: 1 de 31 a 40 h semanais" ] },
    "Pacaraima": {
      "cras": [ "sexo: 1 mulher", "escolaridade: 1 com superior completo", "vínculo: 1 estatutário", "função: 1 técnico de nível superior", "carga horária: 1 de 21 a 30 h semanais", "serviço principal: outros serviços 1", "segundo serviço: outros serviços 1" ],
      "creas": [ "sexo: 1 mulher", "escolaridade: 1 com superior completo", "vínculo: 1 estatutário", "função: 1 técnico de nível superior", "carga horária: 1 de 21 a 30 h semanais" ] },
    "Rorainópolis": {
      "cras": [ "sexo: 1 mulher", "escolaridade: 1 com superior completo", "vínculo: 1 estatutário", "função: 1 técnico de nível superior", "carga horária: 1 de 31 a 40 h semanais", "serviço principal: PAIF 1", "segundo serviço: Bolsa Família e condicionalidades 1" ],
      "creas": [ "sexo: 1 mulher", "escolaridade: 1 com superior completo", "vínculo: 1 estatutário", "função: 1 técnico de nível superior", "carga horária: 1 de 31 a 40 h semanais" ] },
    "São João da Baliza": {
      "creas": [ "sexo: 1 mulher", "escolaridade: 1 com superior completo", "vínculo: 1 temporário", "função: 1 técnico de nível superior", "carga horária: 1 de 21 a 30 h semanais" ] },
    "São Luiz": {
      "cras": [ "sexo: 1 mulher", "escolaridade: 1 com superior completo", "vínculo: 1 comissionado", "função: 1 técnico de nível superior", "carga horária: 1 de 21 a 30 h semanais", "serviço principal: PAIF 1", "segundo serviço: Benefícios Eventuais 1" ] },
    "Uiramutã": {
      "creas": [ "sexo: 1 homem", "escolaridade: 1 com superior completo", "vínculo: 1 estatutário", "função: 1 técnico de nível superior", "carga horária: 1 de 21 a 30 h semanais" ] } };
  var CP_EQUIPE_MUN = {
      "Alto Alegre": {
      "cras": "equipe de RH dos CRAS: 13 de nível médio, 4 assistentes sociais, 2 **psicólogos**, 2 pedagogos, 2 de outras profissões e 1 sem formação profissional (de 24)",
      "creas": "equipe de RH dos CREAS: 4 de nível médio, 1 assistente social, 1 sem formação profissional, 1 **psicólogo**, 1 pedagogo e 1 advogado (de 9)" },
    "Amajari": {
      "cras": "equipe de RH dos CRAS: 2 de nível médio, 2 assistentes sociais e 1 **psicólogo** (de 5)",
      "creas": "equipe de RH dos CREAS: 2 de nível médio, 1 assistente social, 1 sem formação profissional e 1 **psicólogo** (de 5)" },
    "Bonfim": {
      "cras": "equipe de RH dos CRAS: 7 de nível médio, 4 sem formação profissional, 3 de outras profissões, 2 assistentes sociais, 2 **psicólogos** e 1 pedagogo (de 19)",
      "creas": "equipe de RH dos CREAS: 2 de nível médio, 2 sem formação profissional, 1 assistente social e 1 **psicólogo** (de 6)" },
    "Cantá": {
      "cras": "equipe de RH dos CRAS: 6 de nível médio, 6 sem formação profissional, 2 assistentes sociais, 2 **psicólogos** e 2 de outras profissões (de 18)",
      "creas": "equipe de RH dos CREAS: 2 assistentes sociais, 1 de nível médio, 1 sem formação profissional e 1 **psicólogo** (de 5)" },
    "Caracaraí": {
      "cras": "equipe de RH dos CRAS: 14 de nível médio, 4 assistentes sociais, 4 sem formação profissional e 3 pedagogos (de 25)",
      "creas": "equipe de RH dos CREAS: 2 de nível médio, 1 assistente social, 1 **psicólogo** e 1 de outras profissões (de 5)" },
    "Caroebe": {
      "cras": "equipe de RH dos CRAS: 10 de nível médio, 4 de outras profissões, 1 assistente social, 1 sem formação profissional, 1 **psicólogo** e 1 pedagogo (de 18)",
      "creas": "equipe de RH dos CREAS: 1 de nível médio, 1 assistente social, 1 sem formação profissional, 1 **psicólogo** e 1 pedagogo (de 5)" },
    "Iracema": {
      "cras": "equipe de RH dos CRAS: 11 de nível médio, 3 assistentes sociais, 3 sem formação profissional, 3 pedagogos, 2 de outras profissões e 1 **psicólogo** (de 23)",
      "creas": "equipe de RH dos CREAS: 1 assistente social, 1 **psicólogo** e 1 de outras profissões (de 3)" },
    "Mucajaí": {
      "cras": "equipe de RH dos CRAS: 3 assistentes sociais e 1 pedagogo (de 4)",
      "creas": "equipe de RH dos CREAS: 1 assistente social, 1 **psicólogo** e 1 de outras profissões (de 3)" },
    "Normandia": {
      "cras": "equipe de RH dos CRAS: 8 de nível médio, 6 sem formação profissional, 3 de outras profissões, 1 assistente social e 1 **psicólogo** (de 19)",
      "creas": "equipe de RH dos CREAS: 3 de nível médio, 2 sem formação profissional, 1 assistente social, 1 **psicólogo**, 1 advogado e 1 de outras profissões (de 9)" },
    "Pacaraima": {
      "cras": "equipe de RH dos CRAS: 23 de nível médio, 7 sem formação profissional, 6 de outras profissões, 4 assistentes sociais e 1 **psicólogo** (de 41)",
      "creas": "equipe de RH dos CREAS: 6 de nível médio, 2 sem formação profissional e 1 **psicólogo** (de 9)" },
    "Rorainópolis": {
      "cras": "equipe de RH dos CRAS: 5 de nível médio, 4 assistentes sociais, 1 sem formação profissional, 1 **psicólogo**, 1 pedagogo e 1 de outras profissões (de 13)",
      "creas": "equipe de RH dos CREAS: 2 assistentes sociais, 2 sem formação profissional, 2 de outras profissões, 1 de nível médio, 1 **psicólogo** e 1 advogado (de 9)" },
    "São João da Baliza": {
      "cras": "equipe de RH dos CRAS: 1 assistente social (de 1)",
      "creas": "equipe de RH dos CREAS: 1 assistente social e 1 **psicólogo** (de 2)" },
    "São Luiz": {
      "cras": "equipe de RH dos CRAS: 5 sem formação profissional, 3 de nível médio, 2 de outras profissões, 1 assistente social e 1 **psicólogo** (de 12)" },
    "Uiramutã": {
      "cras": "equipe de RH dos CRAS: 1 assistente social e 1 de outras profissões (de 2)",
      "creas": "equipe de RH dos CREAS: 1 **psicólogo** e 1 de outras profissões (de 2)" } };
  // Interior (14 municípios, sem Boa Vista): [registros de RH, registros de psicólogos] por módulo; perfil; equipe; quem tem e quem não tem psicólogo.
  var CP_INTERIOR = {"total":26,"mod":{"cras":[224,13],"creas":[72,13]},"perfil":{"cras":["sexo: 7 mulheres e 6 homens","escolaridade: 13 com superior completo","vínculo: 6 temporários, 4 estatutários e 3 comissionados","função: 13 técnicos de nível superior","carga horária: 10 de 21 a 30 h semanais e 3 de 31 a 40 h semanais","serviço principal: PAIF 11, Convivência e Fortalecimento de Vínculos 1, outros serviços 1","segundo serviço: não informado 4, Serviço de PSB no domicílio 2, Convivência e Fortalecimento de Vínculos 2, outros serviços 2, PAIF 1, Bolsa Família e condicionalidades 1, Benefícios Eventuais 1"],"creas":["sexo: 8 mulheres e 5 homens","escolaridade: 13 com superior completo","vínculo: 7 temporários, 4 estatutários, 1 com outro vínculo não permanente e 1 comissionado","função: 13 técnicos de nível superior","carga horária: 8 de 21 a 30 h semanais e 5 de 31 a 40 h semanais"]},"equipe":{"cras":"equipe de RH dos CRAS dos 14 municípios do interior: 102 de nível médio, 38 sem formação profissional, 33 assistentes sociais, 26 de outras profissões, 13 **psicólogos** e 12 pedagogos (de 224)","creas":"equipe de RH dos CREAS dos 14 municípios do interior: 22 de nível médio, 13 assistentes sociais, 13 **psicólogos**, 12 sem formação profissional, 7 de outras profissões, 3 advogados e 2 pedagogos (de 72)"},"comPsi":{"cras":[["Alto Alegre",2],["Amajari",1],["Bonfim",2],["Cantá",2],["Caroebe",1],["Iracema",1],["Normandia",1],["Pacaraima",1],["Rorainópolis",1],["São Luiz",1]],"creas":[["Alto Alegre",1],["Amajari",1],["Bonfim",1],["Cantá",1],["Caracaraí",1],["Caroebe",1],["Iracema",1],["Mucajaí",1],["Normandia",1],["Pacaraima",1],["Rorainópolis",1],["São João da Baliza",1],["Uiramutã",1]]},"semPsi":{"cras":["Caracaraí","Mucajaí","São João da Baliza","Uiramutã"],"creas":[]},"semRH":{"cras":[],"creas":["São Luiz"]},"rank":[["Alto Alegre",3],["Bonfim",3],["Cantá",3],["Amajari",2],["Caroebe",2],["Iracema",2],["Normandia",2],["Pacaraima",2],["Rorainópolis",2],["Caracaraí",1],["Mucajaí",1],["São João da Baliza",1],["São Luiz",1],["Uiramutã",1]]};

  function cpPerfil(mun, k) { return mun === 'Boa Vista' ? CP_BV_PERFIL[k] : (CP_PERFIL_MUN[mun] && CP_PERFIL_MUN[mun][k]) || null; }
  function cpEquipe(mun, k) { return mun === 'Boa Vista' ? CP_BV_EQUIPE[k] : (CP_EQUIPE_MUN[mun] && CP_EQUIPE_MUN[mun][k]) || null; }
  var CP_PSI = /\b(psicolog\w*|psis)\b/;
  var CP_INT = /\b(quantos?|quantas|numero|total|dados|censo|registros?|perfil|quadro|distribuic\w+|panorama|ranking|por municipio|quais municipios|que municipios|municipios (com|sem)|no interior|do interior|carga horaria|vinculos?|estatutari\w+|temporari\w+|escolaridade|especializacao|mestrado|sexo|mulheres|homens|proporcao|percentual|onde (estao|trabalham|atuam)|em quais|quem atua)\b/;
  var CP_NORMA = /\b(deve|devem|deveria|precisa|precisam|obrigatori\w*|minim\w*|exige|exigid\w*|equipe de referencia|nob|resolucao|tipificacao|lei|portaria)\b/;
  var CP_PERFIL = /\b(perfil|sexo|genero|mulheres|homens|escolaridade|especializacao|mestrado|vinculos?|estatutari\w+|temporari\w+|comissionad\w+|carga horaria|horas|funcao|servico principal|segundo servico|bolsa familia)\b/;
  var CP_EQUIPE = /\b(equipe|composicao|assistentes? sociais?|pedagog\w+|profissoes)\b/;
  var CP_UNIDADE = /\bcras (cauame|cristiana(?: vicente nunes)?|silvio leite|itinerante|nova cidade|pintolandia|sao francisco|uniao)\b/;
  function cpModulo(n) {
    var o = [];
    if (/\bcras\b/.test(n)) o.push('cras');
    if (/\bcreas\b/.test(n)) o.push('creas');
    if (/\b(centros? de convivencia|convivencia|scfv)\b/.test(n)) o.push('conv');
    if (/\bfamilia acolhedora\b/.test(n)) o.push('fam');
    else if (/\b(acolhimentos?|abrigos?|casa lar)\b/.test(n)) o.push('acol');
    if (/\b(gestao|secretaria|semads)\b/.test(n)) o.push('gest');
    if (/\b(posto de cadastramento|cadunico|cad unico)\b/.test(n)) o.push('posto');
    if (/\bcentro pop\b/.test(n)) o.push('pop');
    return o;
  }
  function cpMunicipio(n) {
    var padded = ' ' + n + ' ', melhor = null;
    Object.keys(CP_MUN).forEach(function (nome) {
      var k = norm(nome);
      if (padded.indexOf(' ' + k + ' ') > -1 && (!melhor || k.length > norm(melhor).length)) melhor = nome;
    });
    return melhor;
  }
  function cpPct(a, b) { return b ? (a / b * 100).toFixed(2).replace('.', ',') + '%' : ''; }
  function cpLinha(k, v) {
    var t = '**' + CP_MOD[k] + '**: ' + v[1] + (v[1] === 1 ? ' registro' : ' registros') + ' de psicólogo' + (v[1] === 1 ? '' : 's') + ' em ' + v[0] + ' registros de RH';
    if (v[0] && v[1]) t += ' (' + cpPct(v[1], v[0]) + ')';
    if (v[2] != null) t += '; ' + v[3] + ' de ' + v[2] + (v[2] === 1 ? ' unidade' : ' unidades') + ' com psicólogo registrado';
    return t;
  }
  function cpSoma(m) { return Object.keys(m).reduce(function (s, k) { return s + m[k][1]; }, 0); }
  function psiCensoAsk(text) {
    var n = norm(text);
    if (!n || n.length > 220 || !CP_PSI.test(n) || !CP_INT.test(n) || CP_NORMA.test(n) || RE_CONTATO.test(n)) return null;
    var mods = cpModulo(n), mun = cpMunicipio(n), unid = n.match(CP_UNIDADE);
    var estado = /\b(roraima|estado|interior|municipios|rr)\b/.test(n);
    var interiorQ = !mun && /\b(interior|demais municipios|outros municipios|fora de boa vista|cidades do interior)\b/.test(n);
    var rankQ = !mun && !interiorQ && /\b(ranking|por municipio|cada municipio|todos os municipios|quais municipios|que municipios|municipios (com|sem)|mais psicologos|menos psicologos|maior numero|menor numero|sem psicologos?|nenhum psicologo|nao (tem|possui|ha) psicologos?)\b/.test(n);
    if (!mun && !estado && !mods.length && !unid && !interiorQ && !rankQ) return null;
    if (/\bcapital\b/.test(n) && !mun && !rankQ) mun = 'Boa Vista';
    if (!mun && !estado) mun = 'Boa Vista';   // o app é de Boa Vista: "nos CRAS" sem lugar = Boa Vista (a resposta diz o município)
    var fonte = 'Censo SUAS ' + CP_ANO, L = [], fu = [];
    var nota = 'Contagem de registros de RH do ' + fonte + ' (MDS), não de pessoas únicas: um profissional pode aparecer em mais de um módulo. Não mede suficiência de equipe, carga real de trabalho nem cobertura.';
    var res = function (extra) { var o = { reply: L.join('\n'), mood: 'info', badge: fonte, note: nota, followups: fu.slice(0, 3), units: [] }; for (var k in (extra || {})) o[k] = extra[k]; return o; };
    var bv = CP_MUN['Boa Vista'];
    var kModMun = mods.filter(function (k) { return k === 'cras' || k === 'creas'; });
    // Ranking dos 15 municípios (todos os módulos municipais, ou só CRAS/CREAS quando o módulo é citado)
    if (rankQ) {
      var nomes = Object.keys(CP_MUN), k0 = kModMun[0];
      var ord = nomes.map(function (m) { return [m, k0 ? (CP_MUN[m][k0] ? CP_MUN[m][k0][1] : 0) : cpSoma(CP_MUN[m])]; })
        .sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0], 'pt'); });
      var totRk = ord.reduce(function (t, x) { return t + x[1]; }, 0);
      L.push('No **' + fonte + '**, os **' + totRk + ' registros de psicólogos** em municípios identificados de Roraima' + (k0 ? ' nos **' + CP_MOD[k0] + '**' : ' (módulos municipais)') + ' se distribuem assim: ' + ord.filter(function (x) { return x[1] > 0; }).map(function (x) { return x[0] + ' ' + x[1]; }).join('; ') + '.');
      if (k0) {
        var zero = nomes.filter(function (m) { return CP_MUN[m][k0] && CP_MUN[m][k0][1] === 0; });
        var semRh = nomes.filter(function (m) { return !CP_MUN[m][k0]; });
        L.push(zero.length ? '- **Sem psicólogo registrado nos ' + CP_MOD[k0] + ' (' + zero.length + '):** ' + zero.join(', ') + '. _Zero significa só que a categoria Psicólogo(a) não aparece entre os registros de RH do módulo._' : '- Todos os municípios com RH de ' + CP_MOD[k0] + ' no arquivo têm ao menos um registro de psicólogo.');
        if (semRh.length) L.push('- **Sem linhas de RH de ' + CP_MOD[k0] + ' no arquivo (' + semRh.length + '):** ' + semRh.join(', ') + '. Isso não prova que o serviço não exista.');
      } else {
        var semAlgum = nomes.filter(function (m) { return cpSoma(CP_MUN[m]) === 0; });
        L.push('- **Boa Vista** tem ' + cpSoma(bv) + ' e os **14 municípios do interior** somam ' + CP_INTERIOR.total + ', todos em CRAS e CREAS.' + (semAlgum.length ? ' Sem nenhum registro: ' + semAlgum.join(', ') + '.' : ' Todos os municípios têm ao menos um registro.'));
      }
      L.push('_Os ' + CP_RR.acolhSemMun + ' registros de acolhimento com IBGE=14 não são de município algum e ficam fora desta lista._');
      fu = ['Quantos psicólogos há no interior de Roraima?', 'Perfil dos psicólogos do interior de Roraima', k0 === 'creas' ? 'Quais municípios não têm psicólogo nos CRAS?' : 'Quais municípios não têm psicólogo nos CREAS?'];
      return res();
    }
    // Interior (14 municípios, sem Boa Vista): total, quem tem, perfil e equipe
    if (interiorQ) {
      var ks = kModMun.length ? kModMun : ['cras', 'creas'], I = CP_INTERIOR;
      L.push('Fora de Boa Vista, os **14 municípios do interior** somam **' + I.total + ' registros de psicólogos** no **' + fonte + '**: **' + I.mod.cras[1] + ' nos CRAS** (de ' + I.mod.cras[0] + ' registros de RH) e **' + I.mod.creas[1] + ' nos CREAS** (de ' + I.mod.creas[0] + '). Boa Vista tem ' + cpSoma(bv) + ' dos ' + CP_RR.identificados + ' registros em municípios identificados.');
      ks.forEach(function (k) {
        L.push('- **' + CP_MOD[k] + ' (' + I.mod[k][1] + '):** com psicólogo registrado: ' + I.comPsi[k].map(function (x) { return x[0] + ' ' + x[1]; }).join(', ') + '.' + (I.semPsi[k].length ? ' Sem psicólogo registrado: ' + I.semPsi[k].join(', ') + '.' : '') + (I.semRH[k].length ? ' Sem linhas de RH do módulo no arquivo: ' + I.semRH[k].join(', ') + '.' : ''));
        if (CP_PERFIL.test(n) || kModMun.length === 1) L.push('- **Perfil dos ' + I.mod[k][1] + ' registros nos ' + CP_MOD[k] + ':** ' + I.perfil[k].join('; ') + '.');
        if (CP_EQUIPE.test(n)) L.push('- **Equipe:** ' + I.equipe[k] + '.');
      });
      L.push('- **Outros módulos:** nenhum município do interior tem psicólogo registrado em Gestão Municipal, Fundo Municipal, Posto de Cadastramento, Centro de Convivência, Acolhimento ou Família Acolhedora.');
      L.push('- **Por município:** ' + I.rank.map(function (x) { return x[0] + ' ' + x[1]; }).join('; ') + '.');
      fu = ['Perfil dos psicólogos do interior de Roraima', 'Quais municípios não têm psicólogo nos CRAS?', 'Quantos psicólogos há em Pacaraima?'];
      return res();
    }
    // Roraima (sem município): totais por módulo
    if (!mun && mods.length && CP_RR.mod[mods[0]] != null) {
      var mk = mods[0], tk = CP_RR.mod[mk], bk = bv[mk] ? bv[mk][1] : 0;
      L.push('No **' + fonte + '**, Roraima registra **' + tk + ' registros de psicólogos** em **' + CP_MOD[mk] + '**: **' + bk + '** em Boa Vista' + (mk === 'acol' ? ' e ' + CP_RR.acolhSemMun + ' em unidades com IBGE=14 (sem município indicado), que não são de Boa Vista' : ' e ' + (tk - bk) + ' nos demais municípios') + '.');
      var sem = Object.keys(CP_MUN).filter(function (m) { return m !== 'Boa Vista' && CP_MUN[m][mk] && CP_MUN[m][mk][1] > 0; });
      if (mk === 'cras' || mk === 'creas') L.push('- **Demais municípios com psicólogo registrado em ' + CP_MOD[mk] + ' (' + sem.length + '):** ' + sem.map(function (m) { return m + ' ' + CP_MUN[m][mk][1]; }).join(', ') + '.');
      fu = ['Quantos psicólogos há em Boa Vista?', 'Quantos psicólogos há em Roraima?'];
      return res();
    }
    if (!mun) {
      L.push('No **' + fonte + '**, Roraima tem **' + CP_RR.total + ' registros de psicólogos** nas bases de RH analisadas: ' + (CP_RR.identificados + CP_RR.acolhSemMun) + ' em módulos municipais (' + CP_RR.identificados + ' em municípios identificados e ' + CP_RR.acolhSemMun + ' em unidades de acolhimento com IBGE=14, sem município indicado) e ' + CP_RR.estadual + ' em módulos estaduais (Gestão Estadual do SUAS, ' + CP_RR.gestEst + '; Fundo Estadual, ' + CP_RR.fundoEst + ').');
      L.push('- **Por módulo municipal:** CRAS ' + CP_RR.mod.cras + ', CREAS ' + CP_RR.mod.creas + ', Unidade de Acolhimento ' + CP_RR.mod.acol + ' (' + CP_RR.acolhSemMun + ' sem município), Centro de Convivência ' + CP_RR.mod.conv + ', Gestão Municipal ' + CP_RR.mod.gest + ', Família Acolhedora ' + CP_RR.mod.fam + '. Sem psicólogo no arquivo: Centro POP, Fundo Municipal e Posto de Cadastramento.');
      L.push('- **Boa Vista** concentra ' + cpSoma(bv) + ' dos ' + CP_RR.identificados + ' registros em municípios identificados (CRAS ' + bv.cras[1] + ' de ' + CP_RR.mod.cras + '; CREAS ' + bv.creas[1] + ' de ' + CP_RR.mod.creas + ').');
      L.push('_Os ' + CP_RR.acolhSemMun + ' registros de acolhimento sem município não são de Boa Vista nem de outro município._');
      fu = ['Quantos psicólogos há em Boa Vista?', 'Quantos psicólogos há nos CRAS de Roraima?', 'Quantos psicólogos há por município de Roraima?'];
      return res();
    }
    var d = CP_MUN[mun];
    // CRAS específico: o arquivo é agregado por município e módulo
    if (unid && mun === 'Boa Vista') {
      L.push('O Censo SUAS 2025 que o Argo tem é **agregado por município e módulo**: não informa quantos psicólogos há em cada CRAS. Nos **8 CRAS de Boa Vista** há **' + bv.cras[1] + ' registros de psicólogos** (em ' + bv.cras[2] + ' unidades com RH, e as ' + bv.cras[3] + ' registram ao menos um). Para a lotação de um CRAS, consulte a coordenação ou a SEMADS.');
      fu = ['Perfil dos psicólogos dos CRAS de Boa Vista', 'Onde estão os psicólogos na equipe dos CRAS de Boa Vista?'];
      return res();
    }
    var tot = cpSoma(d);
    if (mods.length) {
      var achou = 0;
      mods.forEach(function (k) {
        if (d[k]) { achou++; L.push('Em **' + mun + '**, ' + cpLinha(k, d[k]) + '.'); if (!d[k][1]) L.push('_Zero significa só que a categoria Psicólogo(a) não aparece entre os registros de RH desse módulo._'); }
        else L.push('Em **' + mun + '**, o arquivo do ' + fonte + ' **não traz registros de RH** do módulo ' + CP_MOD[k] + '. Isso não prova que o serviço não exista.');
        if (d[k] && d[k][1] > 0 && cpPerfil(mun, k) && (CP_PERFIL.test(n) || mods.length === 1)) L.push('- **' + (d[k][1] === 1 ? 'Perfil do registro' : 'Perfil dos ' + d[k][1] + ' registros') + ':** ' + cpPerfil(mun, k).join('; ') + '.');
        if (cpEquipe(mun, k) && CP_EQUIPE.test(n)) L.push('- **Equipe:** ' + cpEquipe(mun, k) + '.');
      });
      if (!achou && mods.length === 1 && !d[mods[0]]) { /* só o aviso acima */ }
    } else if (mun === 'Boa Vista') {
      L.push('**Boa Vista** tem **' + tot + ' registros de psicólogos** no ' + fonte + ', de ' + CP_RR.identificados + ' em municípios identificados de Roraima:');
      CP_ORD.forEach(function (k) { if (d[k] && (d[k][1] || k === 'posto' || k === 'fundo')) L.push('- ' + cpLinha(k, d[k])); });
      L.push('- O Centro POP não tem linhas de RH no arquivo. Os registros de acolhimento com IBGE=14 (' + CP_RR.acolhSemMun + ') não são de Boa Vista.');
      if (CP_PERFIL.test(n)) {
        L.push('- **Perfil nos CRAS (' + bv.cras[1] + '):** ' + CP_BV_PERFIL.cras.slice(0, 5).join('; ') + '.');
        L.push('- **Perfil nos CREAS (' + bv.creas[1] + '):** ' + CP_BV_PERFIL.creas.join('; ') + '.');
        ['conv', 'acol', 'fam', 'gest'].forEach(function (k) { if (CP_BV_PERFIL[k]) L.push('- **Perfil em ' + CP_MOD[k] + ' (' + bv[k][1] + '):** ' + CP_BV_PERFIL[k].join('; ') + '.'); });
      }
      if (CP_EQUIPE.test(n)) CP_ORD.forEach(function (k) { if (CP_BV_EQUIPE[k]) L.push('- **Equipe:** ' + CP_BV_EQUIPE[k] + '.'); });
    } else {
      L.push('Em **' + mun + '**, o ' + fonte + ' registra **' + tot + (tot === 1 ? ' registro' : ' registros') + ' de psicólogo' + (tot === 1 ? '' : 's') + '** nos módulos municipais:');
      CP_ORD.forEach(function (k) { if (d[k] && (k === 'cras' || k === 'creas' || d[k][1])) L.push('- ' + cpLinha(k, d[k])); });
      ['cras', 'creas'].forEach(function (k) {
        if (CP_PERFIL.test(n) && d[k] && d[k][1] > 0 && cpPerfil(mun, k)) L.push('- **Perfil nos ' + CP_MOD[k] + ' (' + d[k][1] + '):** ' + cpPerfil(mun, k).join('; ') + '.');
        if (CP_EQUIPE.test(n) && cpEquipe(mun, k)) L.push('- **Equipe:** ' + cpEquipe(mun, k) + '.');
      });
      L.push('_Módulo que não aparece não tem linhas de RH no arquivo, o que não prova que o serviço não exista._');
    }
    if (mun === 'Boa Vista') fu = ['Perfil dos psicólogos dos CREAS de Boa Vista', 'Quantos psicólogos há nos Centros de Convivência de Boa Vista?', 'Quantos psicólogos há em Roraima?'];
    else fu = ['Perfil dos psicólogos de ' + mun, 'Onde estão os psicólogos na equipe dos CRAS de ' + mun + '?', 'Quantos psicólogos há por município de Roraima?'];
    return res();
  }

  // ---------------------------------------------------------------------
  // BOA VISTA NO CENSO SUAS 2025 — equipes (todas as profissões), os 8 CRAS e o conselho municipal
  // Resposta direta, SEM IA. Mesma fonte e mesmos cuidados de CP_MUN: são REGISTROS de RH por módulo, não pessoas.
  // Conferir sempre com knowledge/documentos/censo-suas-2025-roraima-psicologos.md (Paulus).
  // ---------------------------------------------------------------------
  var BV_RH = {
    cras: { tot: 323, p: { 'profissionais de nível médio': 209, 'assistentes sociais': 35, 'sem formação profissional': 28, 'psicólogos': 19, 'outra formação de nível superior': 17, 'pedagogos': 11, 'outras profissões (administrador, analista de sistema, antropólogo, sociólogo)': 4 } },
    creas: { tot: 77, p: { 'profissionais de nível médio': 33, 'assistentes sociais': 17, 'psicólogos': 13, 'outra formação de nível superior': 7, 'pedagogos': 5, 'advogados': 1, 'sem formação profissional': 1 } },
    conv: { tot: 91, p: { 'profissionais de nível médio': 40, 'sem formação profissional': 12, 'outra formação de nível superior': 11, 'administração/gestão pública': 9, 'assistentes sociais': 8, 'pedagogos': 5, 'psicólogos': 4, 'advogados': 1, 'terapeutas ocupacionais': 1 } },
    acol: { tot: 133, p: { 'profissionais de nível médio': 80, 'sem formação profissional': 31, 'outra formação de nível superior': 10, 'assistentes sociais': 4, 'psicólogos': 3, 'nutricionistas': 2, 'pedagogos': 2, 'enfermeiros': 1 } },
    gest: { tot: 126, p: { 'profissionais de nível médio': 79, 'outra formação de nível superior': 17, 'assistentes sociais': 11, 'sem formação profissional': 9, 'psicólogos': 3, 'advogados': 2, 'pedagogos': 2, 'antropólogos': 1, 'nutricionistas': 1, 'sociólogos': 1 } },
    fam: { tot: 5, p: { 'assistentes sociais': 2, 'psicólogos': 1, 'profissionais de nível médio': 1, 'sem formação profissional': 1 } },
    fundo: { tot: 15, p: { 'outra formação de nível superior': 6, 'administradores': 2, 'contadores': 2, 'profissionais de nível médio': 2, 'sem formação profissional': 2, 'economistas': 1 } },
    posto: { tot: 4, p: { 'profissionais de nível médio': 3, 'outra formação de nível superior': 1 } }
  };
  var BV_PROF = [
    [/\bassistentes? sociais?\b/, 'assistentes sociais'], [/\bpedagog\w+\b/, 'pedagogos'], [/\badvogad\w+\b/, 'advogados'],
    [/\bnutricionist\w+\b/, 'nutricionistas'], [/\benfermeir\w+\b/, 'enfermeiros'], [/\bterapeutas? ocupaciona\w+\b/, 'terapeutas ocupacionais'],
    [/\bcontad\w+\b/, 'contadores'], [/\badministrador\w*\b/, 'administradores'], [/\beconomistas?\b/, 'economistas'],
    [/\bsociolog\w+\b/, 'sociólogos'], [/\bantropolog\w+\b/, 'antropólogos'], [/\bnivel medio\b/, 'profissionais de nível médio']
  ];
  var BV_CRAS_VINC = 'vínculo: 188 estatutários, 65 comissionados, 58 temporários, 6 celetistas (CLT), 4 terceirizados e 2 de outro vínculo não permanente';
  var BV_CRAS_ESC = 'escolaridade: 133 com superior completo, 103 com ensino médio completo, 42 com especialização, 32 com superior incompleto, 3 com mestrado, 5 com fundamental completo, 3 com médio incompleto, 1 com fundamental incompleto e 1 sem escolaridade';
  var BV_CRAS_FUNC = 'função: 72 cadastradores (de 89 em Roraima), 65 técnicos de nível superior (de 123), 59 educadores sociais (de 101), 50 técnicos de nível médio, 35 em outras funções, 26 em apoio administrativo, 8 coordenadores, 5 em serviços gerais e 3 estagiários';
  // [nome, bairro declarado, ano, famílias referenciadas (capacidade), imóvel, pessoas em atendimento coletivo do PAIF, computadores, com internet, veículos exclusivos]
  var BV_CRAS = [
    ['CRAS Cauamé', 'Jardim Floresta', 2012, 5000, 'alugado', 852, 24, 22, 0],
    ['CRAS Cristiana Vicente Nunes', 'Centenário', 2010, 5000, 'próprio', 720, 33, 33, 3],
    ['CRAS Dr. Sílvio Leite', 'Dr. Sílvio Leite', 2012, 5000, 'próprio', 26, 27, 27, 3],
    ['CRAS Itinerante', 'São Francisco', 2024, 3500, 'próprio', 991, 21, 21, 4],
    ['CRAS Nova Cidade', 'Nova Cidade', 2004, 5000, 'próprio', 1078, 23, 23, 3],
    ['CRAS Pintolândia', 'Pintolândia', 2010, 5000, 'alugado', 674, 26, 26, 2],
    ['CRAS São Francisco', 'Centro', 2012, 5000, 'alugado', 264, 26, 24, 4],
    ['CRAS União', 'União', 2010, 5000, 'próprio', 1144, 27, 26, 3]
  ];
  var BV_CONSELHO = 'O Conselho Municipal de Assistência Social de Boa Vista registra **20 conselheiros** (9 titulares, 8 suplentes, 1 presidente, 1 vice-presidente e 1 secretário executivo): 15 mulheres e 5 homens; 13 com superior completo, 3 com especialização, 2 com superior incompleto e 2 com ensino médio. Representação: 9 governamentais (Assistência Social 2, Saúde 2, outras áreas 5) e 11 da sociedade civil (entidades 4, usuários 2, organizações de usuários 2, organizações de trabalhadores 3). Conselheiros não são trabalhadores do SUAS e o arquivo não informa a profissão deles.';
  var BV_RE_RH = /\b(trabalhadores?|profissionais|equipe|equipes|rh|recursos humanos|servidores?|funcionarios?|vinculos?|escolaridade|estatutari\w+|temporari\w+|comissionad\w+|cadastrador\w*|educador\w* sociais?)\b/;
  var BV_RE_INFRA = /\b(capacidade|familias referenciadas|computador\w*|veiculo\w*|carro\w*|atendimento coletivo|implantacao|imovel|alugad\w+|proprio)\b/;
  var BV_SING = { 'psicólogos': 'psicólogo', 'assistentes sociais': 'assistente social', 'pedagogos': 'pedagogo', 'advogados': 'advogado', 'nutricionistas': 'nutricionista', 'enfermeiros': 'enfermeiro', 'terapeutas ocupacionais': 'terapeuta ocupacional', 'antropólogos': 'antropólogo', 'sociólogos': 'sociólogo', 'economistas': 'economista', 'contadores': 'contador', 'administradores': 'administrador' };
  function bvLista(o) { return Object.keys(o).map(function (k) { return o[k] + ' ' + (o[k] === 1 && BV_SING[k] ? BV_SING[k] : k); }).join(', '); }
  function boaVistaCensoAsk(text) {
    var n = norm(text);
    if (!n || n.length > 220 || CP_PSI.test(n) || CP_NORMA.test(n) || RE_CONTATO.test(n)) return null;
    var temBV = /\bboa vista\b|\bcapital\b/.test(n);
    var mods = cpModulo(n).filter(function (k) { return BV_RH[k]; });
    var prof = BV_PROF.filter(function (x) { return x[0].test(n); }).map(function (x) { return x[1]; });
    var fonte = 'Censo SUAS ' + CP_ANO, L = [], fu = [];
    var nota = 'Contagem de registros de RH do ' + fonte + ' (MDS) por módulo, não de pessoas únicas. Não mede suficiência de equipe nem cobertura.';
    var res = function (extra) { var o = { reply: L.join('\n'), mood: 'info', badge: fonte, note: nota, followups: fu.slice(0, 3), units: [] }; for (var k in (extra || {})) o[k] = extra[k]; return o; };
    // conselho municipal
    if (/\b(conselho municipal|conselheir\w+|cmas)\b/.test(n) && (temBV || /\bcmas\b/.test(n)) && !/\bconselho tutelar\b/.test(n)) {
      L.push(BV_CONSELHO); fu = ['Quantos psicólogos há em Boa Vista?', 'Quais os CRAS de Boa Vista e a capacidade de cada um?'];
      return res({ note: 'Composição do conselho no ' + fonte + ' (MDS). Confira com o CMAS para a composição atual.' });
    }
    var cras = /\bcras\b/.test(n) && !/\bcreas\b/.test(n);
    // os 8 CRAS: capacidade, bairro, ano, imóvel, atendimento coletivo, computadores, veículos
    if ((temBV || cras) && BV_RE_INFRA.test(n) && cras) {
      var CH = ['cauame', 'cristiana', 'silvio leite', 'itinerante', 'nova cidade', 'pintolandia', 'sao francisco', 'uniao'], un = [];
      CH.forEach(function (k, i) { if (n.indexOf(k) > -1 && !(k === 'sao francisco' && /\bitinerante\b/.test(n))) un.push(BV_CRAS[i]); });
      if (un.length === 1) {
        var c = un[0];
        L.push('**' + c[0] + '** (' + fonte + '): bairro declarado **' + c[1] + '**, implantado em **' + c[2] + '**, capacidade para referenciar **' + c[3].toLocaleString('pt-BR') + ' famílias**, imóvel ' + c[4] + '; **' + c[5].toLocaleString('pt-BR') + '** pessoas em atendimento coletivo do PAIF; **' + c[6] + '** computadores (' + c[7] + ' com internet) e ' + c[8] + (c[8] === 1 ? ' veículo' : ' veículos') + ' de uso exclusivo.');
      } else {
        L.push('Os **8 CRAS de Boa Vista** no ' + fonte + ' somam capacidade para referenciar **38.500 famílias**, **5.749** pessoas em atendimento coletivo do PAIF, **207** computadores (202 com internet) e **22** veículos de uso exclusivo; 5 imóveis próprios e 3 alugados:');
        BV_CRAS.forEach(function (c) { L.push('- **' + c[0] + '** (' + c[1] + ', ' + c[2] + '): ' + c[3].toLocaleString('pt-BR') + ' famílias; ' + c[5].toLocaleString('pt-BR') + ' no atendimento coletivo; ' + c[6] + ' computadores; ' + c[8] + ' veículos; imóvel ' + c[4]); });
      }
      L.push('_O bairro e os números são os declarados no Censo; o endereço e o contato atuais estão no diretório do Argo._');
      fu = ['Quantos psicólogos há nos CRAS de Boa Vista?', 'Qual a equipe dos CRAS de Boa Vista?'];
      return res();
    }
    if (!temBV && !mods.length && !cras) return null;
    var pedeRh = BV_RE_RH.test(n) || prof.length;
    if (!pedeRh || (!temBV && !mods.length)) return null;
    if (!temBV && mods.length && !BV_RE_RH.test(n)) return null;
    // vínculo, escolaridade e função da equipe dos CRAS
    if (cras && /\b(vinculos?|escolaridade|estatutari\w+|temporari\w+|comissionad\w+|cadastrador\w*|educador\w* sociais?|funcao|funcoes)\b/.test(n) && !prof.length) {
      var pedi = [];
      if (/\b(vinculos?|estatutari\w+|temporari\w+|comissionad\w+)\b/.test(n)) pedi.push(BV_CRAS_VINC);
      if (/\bescolaridade\b/.test(n)) pedi.push(BV_CRAS_ESC);
      if (/\b(cadastrador\w*|educador\w* sociais?|funcao|funcoes)\b/.test(n)) pedi.push(BV_CRAS_FUNC);
      L.push('Equipe dos **CRAS de Boa Vista** no ' + fonte + ' (323 registros de RH):');
      pedi.forEach(function (t) { L.push('- ' + t); });
      fu = ['Qual a equipe dos CRAS de Boa Vista?', 'Quantos psicólogos há nos CRAS de Boa Vista?'];
      return res();
    }
    // uma profissão: por módulo
    if (prof.length) {
      var p0 = prof[0], tot = 0, partes = [];
      Object.keys(BV_RH).forEach(function (k) {
        if (mods.length && mods.indexOf(k) < 0) return;
        var v = BV_RH[k].p[p0]; if (v) { tot += v; partes.push(CP_MOD[k] + ' ' + v); }
      });
      if (!tot) { L.push('No ' + fonte + ', o arquivo não traz registros de **' + p0 + '** em Boa Vista' + (mods.length ? ' no módulo ' + CP_MOD[mods[0]] : ' nos módulos municipais') + '. Isso só indica que a categoria não aparece nos registros de RH, não que não existam.'); }
      else L.push('No **' + fonte + '**, Boa Vista tem **' + tot + ' registros de ' + p0 + '** nos módulos municipais: ' + partes.join('; ') + '.');
      fu = ['Qual a equipe dos CRAS de Boa Vista?', 'Quantos psicólogos há em Boa Vista?'];
      return res();
    }
    // composição de um módulo ou visão geral
    if (mods.length) {
      mods.slice(0, 2).forEach(function (k) {
        L.push('**' + CP_MOD[k] + ' de Boa Vista** no ' + fonte + ': **' + BV_RH[k].tot + ' registros de RH**. ' + bvLista(BV_RH[k].p).replace(/^/, 'Por profissão: ') + '.');
      });
      if (mods[0] === 'cras') L.push('- ' + BV_CRAS_FUNC + '.');
      fu = ['Vínculo e escolaridade da equipe dos CRAS de Boa Vista', 'Quantos psicólogos há em Boa Vista?'];
      return res();
    }
    L.push('Boa Vista tem **774 registros de RH** nos módulos municipais do ' + fonte + ':');
    ['cras', 'acol', 'gest', 'conv', 'creas', 'fundo', 'fam', 'posto'].forEach(function (k) { L.push('- **' + CP_MOD[k] + '**: ' + BV_RH[k].tot + ' (psicólogos: ' + (BV_RH[k].p['psicólogos'] || 0) + '; assistentes sociais: ' + (BV_RH[k].p['assistentes sociais'] || 0) + ')'); });
    L.push('- O Centro POP não tem linhas de RH no arquivo.');
    fu = ['Qual a equipe dos CRAS de Boa Vista?', 'Quantos assistentes sociais há em Boa Vista?', 'Quantos psicólogos há em Boa Vista?'];
    return res();
  }

  // ---------------------------------------------------------------------
  // Plano: decide quem responde
  //   devolve { kind:'crisis'|'directory'|'concept'|'none', result?, dir?, con? }
  // ---------------------------------------------------------------------
  // CRAS e conselhos de assistência social FORA de Boa Vista (Censo SUAS 2025): resposta direta, tirada do trecho da base do Censo.
  // Sem isto, "quantos computadores tem o CRAS de Iracema?" cairia na resposta de Boa Vista.
  // Resposta curta e direta ao que foi perguntado (horas, salas, computadores...), tirada do texto do município; o trecho completo vem logo depois.
  function censoLead(n, textos, conselho) {
    var out = [];
    textos.forEach(function (tx) {
      if (conselho) {
        var m = /(?:Conselho Municipal de Assistência Social de|Conselho Estadual de Assistência Social de) ([^ ]+(?: [^ ]+)*?) registra (\d+) conselheiros/.exec(tx);
        var sx = /; (\d+ (?:mulher(?:es)?|homem|homens)(?: e \d+ (?:mulher(?:es)?|homem|homens))?);/.exec(tx);
        if (m && /\b(mulher\w*|homem|homens|feminin\w*|masculin\w*|sexo)\b/.test(n) && sx) out.push('**' + m[1] + '**: ' + sx[1] + ' entre ' + m[2] + ' conselheiros.');
        return;
      }
      var pos = [], re = /(?:^|\. |; )([^.;]*?) \(bairro /g, mm;
      while ((mm = re.exec(tx))) pos.push({ nome: mm[1].replace(/^.*?\) tem [^.]*\. /, ''), i: mm.index + mm[0].length - mm[1].length - 9 });
      var cab = /^([^ ]+(?: [^ ]+)*?) \(população/.exec(tx), mun = cab ? cab[1] : '';
      pos.forEach(function (p, k) {
        var seg = tx.slice(p.i, k + 1 < pos.length ? pos[k + 1].i : tx.length), r, f = [];
        if (/\b(horas?|funciona\w*|dias|horario)\b/.test(n) && (r = /(\d+) dias por semana e (\d+) horas por dia/.exec(seg))) f.push('funciona ' + r[1] + ' dias por semana, ' + r[2] + ' horas por dia');
        if (/\bsalas?\b/.test(n) && (r = /, ((?:de \d+ a \d+|8 ou mais) salas)/.exec(seg))) f.push('tem ' + r[1]);
        if (/\bbanheir\w*\b/.test(n) && (r = /(\d+ banheiros?)/.exec(seg))) f.push('tem ' + r[1]);
        if (/\b(computador\w*|internet)\b/.test(n) && (r = /(\d+ computadores?) \((\d+) com internet\)/.exec(seg))) f.push('tem ' + r[1] + ' (' + r[2] + ' com internet)');
        if (/\b(veiculo\w*|carro\w*)\b/.test(n) && (r = /(nenhum veículo exclusivo|\d+ veículos? exclusivos?) e (nenhum compartilhado|\d+ compartilhados?)/.exec(seg))) f.push('tem ' + r[1] + ' e ' + r[2]);
        if (/\b(capacidade|familias referenciadas|referenciar)\b/.test(n) && (r = /capacidade de ([\d.]+) famílias/.exec(seg))) f.push('tem capacidade para referenciar ' + r[1] + ' famílias');
        if (/\b(paif|atendimento coletivo)\b/.test(n) && (r = /PAIF coletivo ([^,.;]+)/.exec(seg))) f.push(r[1] === 'não informado' ? 'não informou o atendimento coletivo do PAIF' : 'teve ' + r[1] + ' pessoas no atendimento coletivo do PAIF');
        if (/\b(imovel|proprio|cedid\w+|alugad\w+|compartilhad\w*)\b/.test(n) && (r = /imóvel (próprio|cedido|alugado)(, compartilhado com outro equipamento)?/.exec(seg))) f.push('tem imóvel ' + r[1] + (r[2] ? ', compartilhado com outro equipamento' : ''));
        if (/\b(implantacao|implantado)\b/.test(n) && (r = /implantado em (\d{4})/.exec(seg))) f.push('foi implantado em ' + r[1]);
        if (/\b(rural|rurais|urbana?)\b/.test(n) && (r = /área (rural|urbana central)/.exec(seg))) f.push('fica em área ' + r[1]);
        if (f.length) out.push('**' + (pos.length > 1 ? p.nome.replace(/^CRAS -? ?/, 'CRAS ') : 'CRAS de ' + mun) + '** ' + f.join('; ') + '.');
      });
    });
    return out.join('\n');
  }
  function censoInteriorAsk(text) {
    var n = norm(text), padded = ' ' + n + ' ';
    if (!censoSuas.length || !n || n.length > 220 || CP_PSI.test(n) || CP_NORMA.test(n) || RE_CONTATO.test(n)) return null;
    if (/\bboa vista\b|\bcapital\b|\bconselho tutelar\b/.test(n)) return null;
    var muns = Object.keys(CP_MUN).filter(function (nome) { return nome !== 'Boa Vista' && padded.indexOf(' ' + norm(nome) + ' ') > -1; });
    var mun = muns.length ? cpMunicipio(n) : null;
    var interior = /\binterior\b/.test(n), estadual = /\b(conselho estadual|ceas)\b/.test(n);
    if (!muns.length && !interior && !estadual) return null;
    var conselho = /\b(conselho municipal|conselho estadual|conselheir\w+|cmas|ceas)\b/.test(n);
    var cras = /\bcras\b/.test(n) && !/\bcreas\b/.test(n);
    var EXTRA = /\b(rural|rurais|urbana?|compartilhad\w*|cedid\w+|salas?|banheir\w*|horas|dias|internet|estrutura|infraestrutura|funcionamento|funciona|paif)\b/;
    if (!(conselho || (cras && (BV_RE_INFRA.test(n) || BV_RE_RH.test(n) || EXTRA.test(n) || interior || muns.length > 1)))) return null;
    var ref = function (t) { return norm(t.referencia || ''); };
    var acha = function (re) { return censoSuas.filter(function (t) { return re.test(ref(t)); })[0] || null; };
    var doMun = function (m) {
      return conselho ? (censoSuas.filter(function (x) { return /conselho municipal/.test(ref(x)) && ref(x).indexOf(norm(m)) > -1; })[0] || null)
        : (censoSuas.filter(function (x) { return /\bcras\b.*estrutura e equipe/.test(ref(x)) && ref(x).indexOf(norm(m)) > -1; })[0] || null);
    };
    var textos = [], t = null;
    if (muns.length > 1) {
      // comparação entre municípios: junta o trecho de cada um (até 3)
      muns.slice(0, 3).forEach(function (m) { var x = doMun(m); if (x) textos.push(limpaMd(x.texto)); else if (conselho) textos.push(m + ': sem conselheiros registrados no arquivo do Censo SUAS 2025 (isso não prova que o conselho não exista).'); });
      if (!textos.length) return null;
    } else if (conselho) {
      if (estadual) t = acha(/conselho estadual/);
      else if (mun) t = doMun(mun) || acha(/totais de conselheiros/);
      else t = acha(/totais de conselheiros/);
    } else if (mun) {
      t = doMun(mun);
    } else if (/\b(vinculos?|escolaridade|estatutari\w+|temporari\w+|comissionad\w+)\b/.test(n)) t = acha(/equipe dos cras do interior.*vinculo/);
    else if (/\b(profissao|profissoes|assistentes? sociais?|pedagog\w+)\b/.test(n)) t = acha(/equipe dos cras do interior.*profissao/);
    else if (/\b(funcao|funcoes|cadastrador\w*|educador\w* sociais?)\b/.test(n)) t = acha(/equipe dos cras do interior.*funcao/);
    else if (/\b(veiculo\w*|carro\w*)\b/.test(n)) t = acha(/veiculos dos cras do interior/);
    else if (/\b(computador\w*|internet)\b/.test(n)) t = acha(/computadores dos cras do interior/);
    else if (/\b(capacidade|familias referenciadas|referenciar)\b/.test(n)) t = acha(/capacidade de familias referenciadas dos cras do interior/);
    else if (BV_RE_RH.test(n)) t = acha(/registros de trabalhadores nos cras do interior/);
    else if (/\b(atendimento coletivo|paif)\b/.test(n)) t = acha(/atendimento coletivo do paif nos cras do interior/);
    else if (/\b(imovel|alugad\w+|proprio|implantacao|rural|rurais|compartilhad\w*|cedid\w+|urbana?)\b/.test(n)) t = acha(/estrutura dos cras do interior/);
    else t = acha(/cras do interior de roraima.*visao geral/);
    if (t) textos.push(limpaMd(t.texto));
    if (!textos.length) return null;
    var fonte = 'Censo SUAS ' + CP_ANO;
    var lead = censoLead(n, textos, conselho);
    return { reply: (lead ? lead + '\n\n' : '') + textos.join('\n\n'), mood: 'info', badge: fonte, note: 'Dados declarados no ' + fonte + ' (MDS), agregados por município; não medem suficiência de equipe nem cobertura. Confira com a gestão municipal para a situação atual.', followups: conselho ? ['Quantos conselheiros tem o conselho estadual?'] : ['Qual a equipe dos CRAS do interior?', 'Quantos psicólogos há no interior de Roraima?'], units: [] };
  }
  function plan(text, opts) {
    opts = opts || {};
    var c = crisis(text);
    if (c) return { kind: 'crisis', result: withCrisisUnits(c) };
    // CID-11: código → transtorno e nome → código (tabela local, sem IA)
    var cd = cidAsk(text);
    if (cd) return { kind: 'directory', result: cd, dir: { units: [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    // manual do app: "como uso a Central de PDF?", "onde fica o backup?" (sem IA, sem internet)
    var ma = manualAsk(text);
    if (ma) return { kind: 'manual', result: ma, dir: { units: [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    // psicólogos no Censo SUAS 2025 (Boa Vista em detalhe, Roraima em totais): número fixo da base, nunca da IA
    var cp = psiCensoAsk(text);
    if (cp) return { kind: 'directory', result: cp, dir: { units: [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    var ci = censoInteriorAsk(text);
    if (ci) return { kind: 'directory', result: ci, dir: { units: [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    var bvc = boaVistaCensoAsk(text);
    if (bvc) return { kind: 'directory', result: bvc, dir: { units: [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    // "quantas escolas tem no bairro X?": número calculado nas fichas (nunca pela IA)
    if (rr && /\b(quantas?|quantos?)\b/.test(norm(text))) {
      var mi = rrAchar(norm(text))[0];
      if (mi && mi.id !== 'boa-vista') { var rc = rrAsk(text); if (rc) return { kind: 'directory', result: rc, dir: { units: rc.units || [], confidence: 1, mode: 'list' }, con: { score: 0 } }; }
    }
    var cont = contagem(text);
    if (cont) return { kind: 'directory', result: cont, dir: { units: cont.units || [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    // "qual CRAS atende o bairro X?": responde pela lista de cobertura das fichas
    var pend = seguimentoPendente(text);
    if (pend) return { kind: 'directory', result: pend, dir: { units: pend.units || [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    if (session.pendente === 'violencia-crianca' || session.pendente === 'creas-bairro') session.pendente = '';
    var seg = seguimentoTerr(text);
    if (seg) return { kind: 'directory', result: seg, dir: { units: seg.units || [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    // painel de Boa Vista: perfil do bairro, panorama por área, necessidades (parto, CadÚnico, EJA...) e dados que o diretório não tem
    // municípios de Roraima: população, indígenas, área, CadÚnico/PBF/BPC, comparação e ficha (assets/municipios-rr.json)
    var mr = rrAsk(text);
    if (mr) return { kind: 'directory', result: mr, dir: { units: mr.units || [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    var pb = perfilBairro(text) || panoramaAreas(text) || necessidade(text) || semNumeros(text);
    if (pb) return { kind: 'directory', result: pb, dir: { units: pb.units || [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    var pr = pbfOuRefsAsk(text);
    if (pr) return { kind: 'directory', result: pr, dir: { units: [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    var mun = municipio(text);
    if (mun) return { kind: 'directory', result: mun, dir: { units: mun.units || [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    var terr = territory(text);
    if (terr) return { kind: 'directory', result: terr, dir: { units: terr.units || [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    // requisitos / documentos / valor / como solicitar de um serviço bem identificado: o cartão da ficha responde (e a IA fica a um toque)
    if (psiScore(text).score < 3) {
      var fi = fichaAsk(text);
      if (fi) return { kind: 'ficha', result: fi, dir: { units: fi.units || [], confidence: 1, mode: 'single' }, con: { score: 0 } };
    }
    // "o que é o SUAS?" é conceito (o nome "SUAS" também aparece em fichas como "Criança Feliz no SUAS")
    if (/^(o que (?:e|significa)|como funciona|que e)( o| a)? (suas|sistema unico de assistencia social)$/.test(norm(text))) {
      var gs = glossaryScore(text);
      if (gs.entry) return { kind: 'concept', dir: { units: [], confidence: 0 }, con: gs, result: composeGlossary(gs.entry) };
    }
    var dir = directory(text, session, opts.tabCat);
    var enc = encaminhar(text, dir);
    if (enc) return { kind: 'directory', result: enc, dir: { units: enc.units || [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    var con = glossaryScore(text);
    var out = { kind: 'none', dir: dir, con: con };
    // Dúvida do psicólogo no SUAS (documentos, sigilo, Sistema de Justiça, violência...): verbete curado com a norma.
    // Só perde para uma consulta de contato a uma unidade bem identificada ("telefone do CREAS").
    var psi = psiScore(text);
    if (psi.score >= 3 && psi.score >= con.score && !(dir.units.length && dir.contact && dir.confidence >= 0.6)) {
      out.kind = 'psi';
      out.psi = psi;
      out.result = composePsi(psi.entry);
      return out;
    }
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
  // Pergunta com mais de uma parte de contato ("telefone do CRAS e do CREAS", "telefone do CAPS e horário do Conselho
  // Tutelar"): responde CADA parte com o diretório, em vez de acertar só uma (ou nenhuma). Só vale quando todas as partes
  // viram consulta ao diretório com unidades; se alguma não resolver, devolve null e o fluxo normal segue como antes.
  var RE_CONTATO_MULTI = /\b(telefone|fone|contato|endereco|horario|onde fica|localizacao)\b/;
  var RE_PREP_INICIO = /^(d[aeo]s?|n[aeo]s?|em|o|a|os|as)\b/;
  var RE_SIGLAS = /\b(cras|creas|caps|ubs|upa|pop|bpc|paif|paefi|scfv|sus|suas|ad|iii|ii|cadunico|cad[uú]nico)\b/gi;
  function tituloPedido(t) {
    t = String(t || '').replace(RE_SIGLAS, function (m) { return /^cad/i.test(m) ? 'CadÚnico' : m.toUpperCase(); });
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  // "e do Conselho Tutelar?" logo depois de um pedido de contato: herda o "telefone" / "onde fica" / "horário" da pergunta
  // anterior (sem IA, a conversa já entende o subentendido). Só vale se virar consulta ao diretório com unidades.
  var RE_SEGUE_ENTIDADE = /^(e|mas)\s+(d[aeo]s?|n[aeo]s?|o|a|os|as|para)\s+\S/;
  function planSeguimento(text, opts) {
    text = String(text == null ? '' : text).trim();
    if (!text || text.length > 80 || !session.ultContato || session.turno - session.ultContato.t > 2) return null;
    var n = norm(text);
    if (RE_CONTATO_MULTI.test(n) || !RE_SEGUE_ENTIDADE.test(n) || crisis(text) || piiBlock(text)) return null;
    var resto = text.replace(/^\s*(e|mas)\s+/i, '').replace(/[?!.]+\s*$/, '');
    var pendente = session.pendente, p;
    try { p = plan(session.ultContato.palavra + ' ' + resto, opts || {}); } finally { session.pendente = pendente; }
    if (!p || p.kind !== 'directory' || !p.result || !p.result.units || !p.result.units.length) return null;
    p.seguimento = true;
    return p;
  }
  function planMulti(text, opts) {
    text = String(text == null ? '' : text).trim();
    if (!text || text.length > 200) return null;
    var n = norm(text);
    if (!RE_CONTATO_MULTI.test(n) || /\b(quantos|quantas|diferenca|compar\w*|total)\b/.test(n)) return null;
    if (crisis(text) || piiBlock(text)) return null;
    var partes = text.replace(/[?!.]+\s*$/, '').split(/\s*[,;]\s+|\s+(?:e tamb[eé]m|al[eé]m disso|tamb[eé]m)\s+|\s+e\s+/i)
      .map(function (x) { return x.trim(); }).filter(Boolean);
    if (partes.length < 2 || partes.length > 3) return null;
    var pendente = session.pendente, intencao = '', pedidos = [], i;
    for (i = 0; i < partes.length; i++) {
      var pn = norm(partes[i]), m = pn.match(RE_CONTATO_MULTI);
      if (m) { intencao = m[1]; pedidos.push(partes[i]); continue; }
      // "do CREAS" herda o "telefone" da parte anterior
      if (!intencao || tok(partes[i]).length < 1) return null;
      pedidos.push(intencao + (RE_PREP_INICIO.test(pn) ? ' ' : ' de ') + partes[i]);
    }
    var resultados = [];
    try {
      for (i = 0; i < pedidos.length; i++) {
        var p = plan(pedidos[i], opts || {});
        if (p.kind !== 'directory' || !p.result || !p.result.units || !p.result.units.length) return null;
        resultados.push({ pedido: pedidos[i], r: p.result });
      }
    } finally { session.pendente = pendente; }
    // partes que acham as MESMAS unidades são um nome só cortado no \"e\" (\"Álcool e Drogas\"): não é pergunta dupla
    var topo = {};
    for (i = 0; i < resultados.length; i++) {
      var ids = resultados[i].r.units.slice(0, 3).map(function (u) { return u.id; });
      for (var j = 0; j < ids.length; j++) { if (topo[ids[j]]) return null; }
      ids.forEach(function (id) { topo[id] = 1; });
    }
    var vistos = {}, units = [], todas = [], blocos = [], seguimentos = [];
    resultados.forEach(function (x) {
      var titulo = tituloPedido(x.pedido);
      blocos.push('**' + titulo + '**\n' + x.r.reply);
      (x.r.units || []).slice(0, 3).forEach(function (u) { if (!vistos[u.id]) { vistos[u.id] = 1; units.push(u); } });
      (x.r.unitsAll || x.r.units || []).forEach(function (u) { todas.push(u); });
      if (Array.isArray(x.r.followups)) x.r.followups.forEach(function (f) { if (seguimentos.length < 4 && seguimentos.map(function (y) { return JSON.stringify(y); }).indexOf(JSON.stringify(f)) < 0) seguimentos.push(f); });
    });
    var first = resultados[0].r;
    var result = { reply: 'Você fez ' + resultados.length + ' perguntas numa só. Respondo cada uma:\n\n' + blocos.join('\n\n'), mood: first.mood || 'info', followups: seguimentos, badge: first.badge, units: units.slice(0, 6), unitsAll: todas, multi: true };
    return { kind: 'directory', result: result, dir: { units: units.slice(0, 6), confidence: 1, mode: 'list' }, con: { score: 0 }, multi: true };
  }
  function withUnits(result, dir) { result.units = dir.units.slice(0, 5); result.unitsAll = dir.units; return result; }
  function withCrisisUnits(r) {
    try {
      // Crise de saúde mental/ideação suicida: referência é o CAPS III (24h, saúde mental). O CAPS AD III é para álcool e outras drogas.
      var d = directory('CAPS III', { units: [] }, null);
      var caps = d.units.filter(function (u) { return u.id === 'caps-iii'; }).slice(0, 1);
      var up = directory('HGRR', { units: [] }, null).units.filter(function (u) { return u.id === 'hgrr'; }).slice(0, 1);
      var all = caps.concat(up);
      if (all.length) r.units = all;
    } catch (e) { /* sem fichas: segue só com o texto */ }
    return r;
  }

  // ---------------------------------------------------------------------
  function init(opts) {
    opts = opts || {};
    data = Array.isArray(opts.data) ? opts.data : [];
    REFS = (opts.refs && typeof opts.refs === 'object') ? opts.refs : {}; passIdx = null; panoramaCache = null;
    index = null; vocab = null; expCache = {}; gloIndex = null; psiIndex = null; phoneIdx = null; terrIdx = null; terrAll = null; munIdx = null; contIdx = null;
    if (opts.manual && typeof opts.manual === 'object') for (var mv in opts.manual) if (Object.prototype.hasOwnProperty.call(MANUAL_VARS, mv) && isFinite(opts.manual[mv])) MANUAL_VARS[mv] = opts.manual[mv];
    manualIndex = null;
    if (opts.ia) for (var k in opts.ia) if (Object.prototype.hasOwnProperty.call(CFG, k)) CFG[k] = opts.ia[k];
  }

  return {
    interpretar: interpretar, init: init, setCid: setCid, setMunicipios: setMunicipios, setCensoSuas: setCensoSuas, psiCenso: psiCensoAsk, psiCensoDados: function () { return { mun: CP_MUN, perfil: CP_PERFIL_MUN, equipe: CP_EQUIPE_MUN, interior: CP_INTERIOR, bvEquipe: CP_BV_EQUIPE }; }, bvCenso: boaVistaCensoAsk, municipiosRR: rrAsk, cid: cidAsk, norm: norm, piiBlock: piiBlock, crisis: crisis, plan: plan, planMulti: planMulti, planSeguimento: planSeguimento, contagem: contagem,
    directory: function (t, tabCat) { return directory(t, session, tabCat); },
    glossary: glossaryScore, compose: { directory: composeDirectory, glossary: composeGlossary },
    psi: psiScore, psiLista: PSI_BASE, manual: manualAsk, manualLista: MANUAL, baseApp: baseApp, fichaAsk: fichaAsk, trechosDa: trechosDa, pbfPagamento: pbfPagamento,
    remember: remember, reset: reset, session: session, notar: notar, estado: estadoParaIA, deveEsclarecer: deveEsclarecer, historicoParaIA: historicoParaIA,
    aiOn: aiOn, aiGate: aiGate, buildPayload: buildPayload, streamAI: streamAI,
    verifyPhones: verifyPhones, panorama: panorama, isAmpla: isAmpla, cleanAI: cleanAI, separarSugestoes: separarSugestoes, ocultarSugestoes: ocultarSugestoes, mentionedUnits: mentionedUnits, telHref: telHref, slim: slim,
    config: CFG, emergencia: EMERGENCIA, glossarioLista: GLOSSARIO
  };
});

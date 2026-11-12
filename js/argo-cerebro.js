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
    syn = syn.concat(aprApelidos(strong));   // palavras que a pessoa usa e que o Argo aprendeu com o uso
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
      // aprendizado com o uso: o que a pessoa já confirmou (👍, ligou, abriu a ficha) sobe; o que ela recusou (👎) desce
      var lb = 0;
      if (aprAtivo()) {
        var soma = aprSoma(q.strong, u.d.id);
        if (s > 0) { lb = aprBonus(soma) + aprPopular(u.d.id); s = Math.max(s * 0.3, s + lb); }
        else if (soma >= 3) { s = 2.6; lb = 2.6; }   // só pelo que aprendeu: entra na lista, sem ganhar de quem casa pelo nome
      }
      var nameCov = q.strong.length ? Math.min(1, nameHits / q.strong.length) : 0;
      if (s > 0) rows.push({ u: u, score: s, nameCov: nameCov, inBairro: !!inBairro, lb: lb });
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
    res.aprendido = picked.some(function (x) { return x.lb >= 0.3; });   // a ordem veio, em parte, do que o uso ensinou
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
    { id: 'nis', keys: ['o que e nis', 'o que e o nis', 'o que e numero nis', 'numero de identificacao social', 'para que serve o nis', 'nis+significa'],
      text: 'O **NIS** (Número de Identificação Social) é o número, de **11 dígitos**, que identifica a pessoa nos programas sociais do governo federal.\n- Cada pessoa tem **um** NIS; quem já tem PIS/PASEP já tem um número que pode servir.\n- Quem se inscreve no **CadÚnico** e ainda não tem NIS recebe um na inscrição.\n- Para consultar o seu: aplicativo **Meu CadÚnico**, o **CRAS** ou a central **121**.\nCuidado: o NIS é dado pessoal. Em registro de caso, prefira iniciais ou código.',
      base: 'Cadastro Único (Decreto 11.016/2022) e orientações do MDS.',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['Como consultar meu NIS?', 'Quais documentos para o CadÚnico?'] },
    { id: 'aluguel-social', keys: ['aluguel social', 'auxilio aluguel', 'bolsa aluguel'],
      text: '**Aluguel social** não é um benefício nacional único: em geral é concedido pelo **município ou pelo estado**, com regras próprias, muitas vezes como **benefício eventual** (vulnerabilidade temporária, calamidade) ou ligado à política de habitação.\n- **Não há ficha de aluguel social no diretório do Argo** para Boa Vista, então não vou citar valor, prazo nem critério.\n- Caminho: levar o caso ao **CRAS** de referência (que faz a análise social) e confirmar com a gestão municipal se há o benefício e como solicitar.',
      base: 'LOAS, art. 22 (benefícios eventuais; Lei 8.742/1993) e Decreto 6.307/2007.',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['O que são benefícios eventuais?', 'Qual CRAS atende o meu bairro?'] },
    { id: 'seguro-defeso', keys: ['seguro defeso', 'seguro-defeso', 'defeso', 'seguro desemprego do pescador', 'pescador artesanal'],
      text: 'O **seguro-defeso** é pago pelo **INSS** ao **pescador artesanal** nos meses em que a pesca é proibida para a reprodução das espécies (o **defeso**), no valor de **1 salário mínimo por mês**.\n- Exige **registro de pescador ativo** (RGP) e que a pesca seja a atividade principal e a fonte de renda da família.\n- O pedido é feito pelo **Meu INSS** ou pela central **135**.\nRegras e períodos mudam por região e por espécie: confirme no INSS.',
      base: 'Lei 10.779/2003 (seguro-desemprego do pescador artesanal).',
      actions: [{ label: 'Ver Previdência/INSS', cat: 'previdencia' }], follow: ['Como funciona o BPC?', 'Onde fica o INSS?'] },
    { id: 'documentos-civis', keys: ['rg+tirar', 'rg+fazer', 'rg+onde', 'rg+segunda', 'carteira de identidade', 'segunda via do rg', 'tirar rg', 'fazer rg', 'tirar cpf', 'fazer cpf', 'cpf+tirar', 'cpf+fazer', 'certidao de nascimento', 'segunda via da certidao', 'tirar certidao'],
      text: 'Sobre **documentos civis** (o que eu sei, sem inventar endereço):\n- **Certidão de nascimento:** é feita no **cartório de Registro Civil**; a primeira via do registro de nascimento é **gratuita**. O Registro Civil consta no diretório do Argo.\n- **CPF:** a inscrição é gratuita e pode ser feita pelo site da **Receita Federal** (a Receita Federal/CAC consta no diretório) ou em agências conveniadas.\n- **RG (carteira de identidade):** é emitido pelo órgão de identificação da **Secretaria de Segurança Pública do estado**. **Esse órgão não está no diretório do Argo**, então confirme o local e o agendamento antes de encaminhar.\nPara quem não tem **nenhum** documento, o CRAS ajuda a organizar o caminho (comece pela certidão).',
      base: 'Lei 9.534/1997 (gratuidade do registro civil) e orientações da Receita Federal.',
      actions: [{ label: 'Ver Documentação', cat: 'documentacao' }, { label: 'Ver CRAS', cat: 'social' }], follow: ['Onde fica o Registro Civil?', 'Como consultar meu NIS?'] },
    { id: 'agendar-cras', keys: ['como agendar no cras', 'agendar atendimento no cras', 'marcar atendimento no cras', 'como marcar no cras', 'como ser atendido no cras', 'como ser atendida no cras', 'agendar cras'],
      text: 'O **CRAS** pode ser procurado **direto**, sem encaminhamento: a família chega, é **acolhida** e a equipe vê o que fazer (acompanhamento no PAIF, grupos do SCFV, CadÚnico, benefícios).\n- Para **CadÚnico**, o agendamento varia: em geral por telefone/WhatsApp da unidade ou presencialmente.\n- Cada CRAS atende o **território** onde a família mora. Diga o **bairro** e eu mostro o CRAS de referência com telefone e horário.',
      base: 'Tipificação Nacional (Res. CNAS 109/2009) e PNAS/2004.',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['Qual CRAS atende o Caimbé?', 'Quais documentos levar ao CadÚnico?'] },
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
    { id: 'paif', keys: ['paif', 'paf', 'trabalho social com familias'],
      text: 'O **PAIF** é o trabalho social com famílias, de caráter continuado, ofertado no **CRAS**: acolhida, oficinas, ações comunitárias, encaminhamentos e **acompanhamento familiar**. Busca fortalecer a função protetiva da família e prevenir a ruptura de vínculos. Não tem caráter terapêutico.\nNo acompanhamento, a equipe constrói com a família um **plano (PAF)**, com objetivos e prazos combinados.\nPergunte por tema: objetivos, quem é atendido, acolhida, oficinas, PAF, equipe, registro, Bolsa Família, PAIF e PAEFI.',
      base: 'Tipificação Nacional (Res. CNAS 109/2009); LOAS, art. 24-A.',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['Quais são os objetivos do PAIF?', 'O que é o PAF?', 'Qual a diferença entre PAIF e PAEFI?'] },
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
      text: 'O **Cadastro Único** identifica famílias de baixa renda: renda mensal de até **1/2 salário mínimo por pessoa**. Famílias com renda maior também podem se cadastrar quando algum programa ou serviço exigir. É a porta de entrada para mais de 40 programas (Bolsa Família, BPC, Tarifa Social, Pé-de-Meia, Gás do Povo e outros), cada um com a sua própria regra de renda.\n- Cadastro gratuito e presencial, no CRAS ou posto de atendimento, pelo(a) **responsável familiar** (16 anos ou mais, de preferência mulher). Leva documento com foto, **CPF** e comprovante de endereço (na falta dele, declaração de residência assinada); das demais pessoas, **pelo menos um documento** de cada uma (o **CPF** é o mais importante). Pergunte também por documentos, entrevista, atualização e programas.\n- Quem mora sozinho pode se cadastrar; para Bolsa Família e BPC, o cadastro costuma exigir entrevista no domicílio.\n- Deve ser atualizado **a cada 2 anos** ou quando algo mudar (endereço, renda, composição da família).',
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
    // ---- Aprofundamento SUAS: marcos normativos, conceitos, gestão e financiamento ----
    { id: 'pnas', keys: ['pnas', 'pnas 2004', 'politica nacional de assistencia social', 'politica de assistencia social'],
      text: 'A **PNAS/2004** (Política Nacional de Assistência Social) materializa a LOAS e é a base do SUAS. Ela define:\n- o **público**: cidadãos e grupos em situação de vulnerabilidade e risco social;\n- os **níveis de proteção**: básica e especial (média e alta complexidade);\n- os **eixos estruturantes**: matricialidade sociofamiliar; descentralização político-administrativa e territorialização; novas bases para a relação entre Estado e sociedade civil; financiamento; controle social; participação do usuário; política de recursos humanos; informação, monitoramento e avaliação.\nO SUAS foi implantado pela NOB/SUAS 2005 e consolidado em lei em 2011.',
      base: 'Res. CNAS 145/2004 (PNAS); NOB/SUAS 2005 (Res. CNAS 130/2005); Lei 12.435/2011.',
      actions: [], follow: ['O que é a NOB/SUAS?', 'O que é matricialidade sociofamiliar?'] },
    { id: 'nob-suas', keys: ['nob suas', 'nob/suas', 'norma operacional basica', 'norma operacional basica do suas', 'nob 2012', 'nob suas 2012', 'cit', 'cib', 'comissao intergestores tripartite', 'comissao intergestores bipartite', 'pactuacao do suas'],
      text: 'A **NOB/SUAS 2012** disciplina a **gestão** do SUAS. Define:\n- as **competências** da União, dos estados, do DF e dos municípios;\n- as instâncias de **pactuação** (**CIT**, tripartite, e **CIB**, bipartite) e de **deliberação** (conselhos de assistência social);\n- o cofinanciamento **fundo a fundo**, a vigilância socioassistencial, a gestão do trabalho e a regionalização dos serviços;\n- o **Pacto de Aprimoramento** da gestão e o **IGD-SUAS** (índice que mede a qualidade da gestão e orienta repasses).\nA equipe de referência (quantos técnicos por CRAS/CREAS) está na NOB-RH/SUAS.',
      base: 'NOB/SUAS 2012 (Res. CNAS 33/2012), a partir da Lei 12.435/2011.',
      actions: [], follow: ['Como é o financiamento do SUAS?', 'Quantos psicólogos por CRAS?'] },
    { id: 'tipificacao', keys: ['tipificacao', 'tipificacao nacional', 'tipificacao dos servicos', 'servicos socioassistenciais', 'servicos do suas', 'quais sao os servicos do suas', 'lista de servicos do suas', 'quais servicos o suas oferece'],
      text: 'A **Tipificação Nacional** padroniza os serviços do SUAS:\n- **Proteção Social Básica:** PAIF; Serviço de Convivência e Fortalecimento de Vínculos (SCFV); Serviço de Proteção Social Básica no Domicílio para pessoas com deficiência e pessoas idosas.\n- **Média complexidade:** PAEFI; Abordagem Social; Medidas Socioeducativas em meio aberto (LA e PSC); Serviço para pessoas com deficiência, pessoas idosas e suas famílias; Serviço para Pessoas em Situação de Rua (Centro POP).\n- **Alta complexidade:** Acolhimento Institucional (abrigo, casa-lar, casa de passagem, residência inclusiva); Acolhimento em República; Família Acolhedora; Proteção em Situações de Calamidades Públicas e de Emergências.\nPergunte por um deles (por exemplo, "o que é o PAEFI?") para ver os detalhes.',
      base: 'Tipificação Nacional dos Serviços Socioassistenciais (Res. CNAS 109/2009) e suas alterações.',
      actions: [{ label: 'Ver CRAS e CREAS', cat: 'social' }], follow: ['Qual a diferença entre CRAS e CREAS?', 'O que é acolhimento institucional?'] },
    { id: 'segurancas', keys: ['segurancas afiancadas', 'segurancas socioassistenciais', 'seguranca de acolhida', 'seguranca de renda', 'seguranca de convivencia', 'seguranca de autonomia', 'o que o suas garante', 'o que o suas afianca'],
      text: 'O SUAS **afiança** (garante) seguranças sociais:\n- **Acolhida:** ser recebido com escuta, em condições dignas, inclusive com abrigo quando preciso.\n- **Renda:** acesso a benefícios e transferências de renda (BPC, Bolsa Família), em articulação com o CadÚnico.\n- **Convívio ou vivência familiar, comunitária e social:** fortalecer vínculos e combater o isolamento.\n- **Desenvolvimento da autonomia:** ampliar a capacidade de decidir e de acessar direitos.\n- **Apoio e auxílio:** benefícios eventuais em situações de risco circunstancial.',
      base: 'PNAS/2004 e NOB/SUAS 2012.',
      actions: [], follow: ['Qual a lista de serviços do SUAS?', 'O que são benefícios eventuais?'] },
    { id: 'principios-loas', keys: ['principios da assistencia social', 'principios da loas', 'diretrizes da assistencia social', 'objetivos da assistencia social', 'assistencia social e direito', 'constituicao e assistencia social', 'seguridade social', 'tripe da seguridade'],
      text: 'A assistência social é **política pública de seguridade social**, ao lado da saúde e da previdência: é **direito do cidadão e dever do Estado**, prestada a **quem dela necessitar, independentemente de contribuição**.\n- **Princípios (LOAS, art. 4º):** supremacia do atendimento às necessidades sociais sobre a rentabilidade econômica; universalização dos direitos; respeito à dignidade, à autonomia e à convivência familiar e comunitária, **vedada qualquer comprovação vexatória de necessidade**; igualdade de acesso; divulgação ampla dos benefícios e serviços.\n- **Diretrizes (art. 5º):** descentralização político-administrativa; participação da população; primazia da responsabilidade do Estado; **centralidade na família**.',
      base: 'Constituição Federal, arts. 194, 203 e 204; LOAS, arts. 1º a 5º (Lei 8.742/1993).',
      actions: [], follow: ['O que é o SUAS?', 'Como funciona o controle social?'] },
    { id: 'vigilancia', keys: ['vigilancia socioassistencial', 'vigilancia social', 'diagnostico socioterritorial', 'diagnostico territorial', 'diagnostico do territorio'],
      text: 'A **vigilância socioassistencial** é uma das funções do SUAS: analisar, **por território**, a capacidade protetiva das famílias e a ocorrência de vulnerabilidades, ameaças, vitimizações e danos, e também o **tipo e o volume de serviços ofertados**.\nAlimenta o planejamento e o **diagnóstico socioterritorial**, usando bases como CadÚnico, RMA e Censo SUAS. Na prática, ajuda a decidir onde instalar serviços, para quem e com que prioridade.',
      base: 'LOAS, art. 2º, II (Lei 8.742/1993) e NOB/SUAS 2012.',
      actions: [], follow: ['O que é o Censo SUAS?', 'O que é o RMA?'] },
    { id: 'censo-suas', keys: ['censo suas', 'cadsuas', 'cad suas', 'cadastro nacional do suas'],
      text: 'O **Censo SUAS** é a coleta anual, feita por questionários eletrônicos, sobre **estrutura, serviços, equipe e gestão** de CRAS, CREAS, Centro POP, unidades de acolhimento, conselhos e órgãos gestores. Os dados servem ao planejamento, ao monitoramento e à vigilância socioassistencial.\nO **CadSUAS** é o cadastro nacional das unidades, entidades e profissionais do SUAS: manter os dados atualizados é rotina da gestão e da coordenação.',
      base: 'Decreto 7.334/2010 (Censo SUAS).',
      actions: [], follow: ['O que é vigilância socioassistencial?', 'O que é o RMA?'] },
    { id: 'controle-social', keys: ['controle social', 'conselho municipal de assistencia social', 'conselho de assistencia social', 'cmas', 'cnas', 'ceas', 'conferencia de assistencia social', 'conferencias de assistencia social', 'fundo municipal de assistencia social', 'fmas', 'plano municipal de assistencia social', 'pmas'],
      text: 'O **controle social** do SUAS é feito pelos **conselhos de assistência social** (**CNAS**, **CEAS**, **CMAS**), instâncias **deliberativas e paritárias**: metade governo, metade sociedade civil (usuários, entidades e trabalhadores). Eles acompanham a política, aprovam o plano e fiscalizam o uso do fundo.\nAs **conferências** acontecem a cada **quatro anos** e propõem as diretrizes.\nPara receber repasses, o município precisa ter **Conselho, Fundo (FMAS) e Plano (PMAS)** de assistência social, além de recursos próprios no fundo.',
      base: 'LOAS, arts. 16 a 18 e 30 (Lei 8.742/1993).',
      actions: [], follow: ['Como é o financiamento do SUAS?', 'O que são entidades de assistência social?'] },
    { id: 'financiamento', keys: ['financiamento do suas', 'financiamento da assistencia social', 'cofinanciamento', 'fundo a fundo', 'fundo nacional de assistencia social', 'fnas', 'pisos de protecao', 'piso basico fixo', 'igd suas', 'igd-suas', 'recursos do suas', 'verba do suas', 'repasse do suas'],
      text: 'O SUAS é **cofinanciado** pela União, pelos estados, pelo DF e pelos municípios, com repasse **fundo a fundo** (do Fundo Nacional para os fundos estaduais e municipais), sem convênio por serviço.\n- Os recursos federais vêm organizados em **blocos**: Proteção Social Básica, Proteção Social Especial (média e alta complexidade) e Gestão (incluindo o IGD).\n- Cada município precisa de **Conselho, Fundo e Plano** de assistência social e de recursos próprios (LOAS, art. 30).\n- O **IGD-SUAS** repassa recursos conforme a qualidade da gestão local.\nValores, pisos e regras mudam por portaria: confirme no normativo vigente do MDS.',
      base: 'LOAS, arts. 28 a 30 (Lei 8.742/1993); Decreto 7.788/2012; Portaria MDS 113/2015 e normas posteriores.',
      actions: [{ label: 'Notícias do MDS', cat: 'noticias' }], follow: ['Como funciona o controle social?', 'O que é a NOB/SUAS?'] },
    { id: 'matricialidade', keys: ['matricialidade sociofamiliar', 'matricialidade', 'centralidade na familia', 'territorializacao', 'territorio no suas', 'referenciamento', 'referencia e contrarreferencia', 'contrarreferencia', 'contra referencia'],
      text: 'Conceitos-chave do SUAS:\n- **Matricialidade sociofamiliar:** a **família** é o núcleo central da proteção, mas ela também precisa ser **protegida** e apoiada para cuidar de seus membros.\n- **Territorialização:** os serviços são planejados a partir do **território**, com suas demandas e potencialidades. O CRAS **referencia** as famílias do seu território.\n- **Referência e contrarreferência:** o caso circula entre serviços (por exemplo, do CRAS ao CREAS, ou à saúde) com **retorno** da informação a quem encaminhou, sempre com o mínimo necessário e respeitando o sigilo.',
      base: 'PNAS/2004 e NOB/SUAS 2012.',
      actions: [], follow: ['Como encaminhar com responsabilidade?', 'O que é vulnerabilidade e risco social?'] },
    { id: 'vulnerabilidade-risco', keys: ['vulnerabilidade social', 'risco social', 'vulnerabilidade e risco', 'diferenca entre vulnerabilidade e risco', 'o que e vulnerabilidade', 'violacao de direitos', 'situacao de risco'],
      text: 'No SUAS, **vulnerabilidade** e **risco** não são sinônimos:\n- **Vulnerabilidade social:** fragilidade que ainda **não** configura violação. Inclui pobreza e privação, acesso precário a serviços, vínculos fragilizados e discriminação (por idade, etnia, gênero, deficiência). A resposta é **preventiva**, na Proteção Social Básica (CRAS).\n- **Risco pessoal e social, com violação de direitos:** o direito já foi **violado ou ameaçado** (violência, negligência, abandono, trabalho infantil, situação de rua). A resposta é da **Proteção Social Especial** (CREAS e acolhimento), em articulação com o sistema de garantia de direitos.\nA mesma família pode transitar entre as duas situações: por isso a rede trabalha integrada.',
      base: 'PNAS/2004 e Tipificação Nacional (Res. CNAS 109/2009).',
      actions: [{ label: 'Ver CRAS e CREAS', cat: 'social' }], follow: ['Qual a diferença entre CRAS e CREAS?', 'O que é matricialidade sociofamiliar?'] },
    { id: 'rede-osc', keys: ['entidades de assistencia social', 'entidade de assistencia social', 'organizacao da sociedade civil', 'organizacoes da sociedade civil', 'osc', 'cebas', 'rede socioassistencial', 'rede privada do suas', 'mrosc'],
      text: 'A **rede socioassistencial** reúne unidades **públicas** (CRAS, CREAS, Centro POP, acolhimentos governamentais) e **entidades e organizações privadas sem fins lucrativos** de assistência social.\n- A entidade precisa ser **inscrita no Conselho Municipal de Assistência Social** (CMAS) do município onde atua.\n- A parceria com o poder público segue o marco legal das organizações da sociedade civil (**Lei 13.019/2014**).\n- O **CEBAS** é a certificação federal que dá direito à isenção de contribuições sociais para entidades que cumprem os requisitos.\nOrganização conveniada deve ser **referenciada ao CRAS ou CREAS** do território.',
      base: 'LOAS, art. 9º (Lei 8.742/1993); Lei 13.019/2014; Lei Complementar 187/2021 (CEBAS).',
      actions: [{ label: 'Ver unidades sociais', cat: 'social' }], follow: ['Como funciona o controle social?'] },
    { id: 'beneficios-suas', keys: ['beneficios socioassistenciais', 'beneficios do suas', 'tipos de beneficio', 'transferencia de renda', 'protocolo de gestao integrada', 'gestao integrada de beneficios'],
      text: 'No SUAS há três frentes de **renda e benefícios**:\n- **BPC** (LOAS, art. 20): benefício individual, não contributivo, de 1 salário mínimo, para pessoa idosa ou com deficiência em situação de baixa renda.\n- **Benefícios eventuais** (art. 22): natalidade, morte, vulnerabilidade temporária e calamidade pública, regulados por lei do município.\n- **Transferência de renda** (Bolsa Família), com acompanhamento das condicionalidades pelo CRAS.\nO **Protocolo de Gestão Integrada** orienta a articulação entre serviços, benefícios e transferências de renda: a família que recebe benefício deve ter **acesso aos serviços** do CRAS.',
      base: 'LOAS, arts. 20 e 22; Protocolo de Gestão Integrada de Serviços, Benefícios e Transferências de Renda (Res. CIT 07/2009).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['O que é o BPC?', 'O que são benefícios eventuais?', 'Como funciona o Bolsa Família?'] },
    { id: 'porte-municipio', keys: ['porte de boa vista', 'porte da cidade', 'porte do municipio', 'porte de municipio', 'municipio de grande porte', 'pequeno porte', 'municipio de pequeno porte', 'metropole suas', 'classificacao dos municipios'],
      text: 'A PNAS classifica os municípios por **porte populacional**, o que orienta a rede de serviços e a equipe:\n- **Pequeno porte I:** até 20 mil habitantes · **Pequeno porte II:** de 20 mil a 50 mil\n- **Médio porte:** de 50 mil a 100 mil\n- **Grande porte:** de 100 mil a 900 mil\n- **Metrópole:** mais de 900 mil.\nBoa Vista está na faixa de **grande porte**. A classificação é feita com base nos dados populacionais oficiais mais recentes.',
      base: 'PNAS/2004 e NOB/SUAS 2012.',
      actions: [], follow: ['Quantos psicólogos por CRAS?'] },
    { id: 'acessuas', keys: ['acessuas', 'acessuas trabalho', 'acesso ao mundo do trabalho', 'inclusao produtiva', 'trabalho e assistencia social'],
      text: 'O **ACESSUAS Trabalho** é o Programa Nacional de Promoção do Acesso ao Mundo do Trabalho. Ele **não é um serviço tipificado**: é uma estratégia do SUAS que mobiliza e **encaminha usuários** (com prioridade para famílias do CadÚnico, Bolsa Família e BPC) a cursos de qualificação e oportunidades de trabalho, articulando o CRAS com outras políticas e com o setor produtivo.',
      base: 'Res. CNAS 18/2012.',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['O que é o PAIF?'] },
    { id: 'trabalho-infantil', keys: ['trabalho infantil', 'peti', 'erradicacao do trabalho infantil', 'menor trabalhando', 'crianca trabalhando'],
      text: 'O **trabalho infantil** é violação de direitos. **Idade mínima: 16 anos**, e a partir dos **14 anos apenas como aprendiz**; antes dos 18 é proibido o trabalho noturno, perigoso ou insalubre.\n- **Identificação:** busca ativa, CadÚnico, escola, saúde, denúncia.\n- **SUAS:** acompanhamento da família pelo **CREAS (PAEFI)**; crianças e adolescentes em trabalho infantil têm **prioridade no SCFV**; inclusão no CadÚnico e em programas de renda.\n- **Rede:** Conselho Tutelar, Ministério Público do Trabalho e auditoria fiscal do trabalho.\n- **Denúncia:** Disque 100 (também por WhatsApp e aplicativo).',
      base: 'CF, art. 7º, XXXIII; ECA, arts. 60 a 69 (Lei 8.069/1990).',
      actions: [{ label: 'Ver CREAS', cat: 'social' }], follow: ['Como funciona o Conselho Tutelar?', 'O que é o PAEFI?'] },
    { id: 'calamidade', keys: ['calamidade publica', 'calamidades publicas', 'situacao de emergencia', 'desastre', 'desabrigado', 'desabrigados', 'enchente', 'alagamento', 'incendio residencial'],
      text: 'Em **calamidade pública ou emergência**, o SUAS responde de duas formas:\n- **Serviço de Proteção em Situações de Calamidades Públicas e de Emergências** (alta complexidade): acolhimento provisório, provisão de necessidades básicas, apoio para reorganizar a vida e articulação com a Defesa Civil, a saúde e outras políticas.\n- **Benefício eventual** por calamidade pública, concedido pelo município conforme sua lei.\nFamílias desabrigadas devem procurar o **CRAS** ou a **Defesa Civil (199)**. Em risco de vida, **192** (SAMU) e **193** (Bombeiros).',
      base: 'Tipificação Nacional (Res. CNAS 109/2009); LOAS, art. 22 (Lei 8.742/1993).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['O que são benefícios eventuais?'] },
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
      // 'quais documentos' sozinho foi retirado: sequestrava "quais documentos para o BPC / para a gestante". Agora exige o contexto do psicólogo.
      keys: ['quais documentos posso emitir', 'quais documentos o psicologo pode emitir', 'documentos+psicologo', 'documentos+psicologa', 'documentos+psicologos', 'documentos+emitir', 'documentos+cfp', 'que documentos posso emitir', 'documentos que o psicologo pode emitir', 'tipos de documento psicologico', 'tipos de documentos psicologicos', 'modalidades de documento', 'resolucao 06 2019', 'resolucao 6 2019', 'resolucao cfp 6 2019', 'resolucao cfp 06 2019', 'documentos escritos do psicologo', 'documentos psicologicos'],
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
    { id: 'psi-crp', cat: 'Orientação',
      keys: ['duvida etica', 'onde tirar duvida etica', 'comissao de orientacao e fiscalizacao', 'cof do crp', 'orientacao do crp', 'falar com o crp', 'crp 20', 'quem orienta o psicologo', 'consultar o crp', 'o crp pode orientar'],
      text: 'Para dúvida ética ou técnica sobre o seu trabalho, a via oficial é a **Comissão de Orientação e Fiscalização (COF) do seu CRP**: ela orienta os profissionais. Para parâmetros de atuação em políticas públicas, há ainda as **Referências Técnicas do CREPOP/CFP** (CRAS, CREAS, gestores, rede de atenção psicossocial, entre outras) e as notas técnicas do CFP.\nEste app traz respostas de apoio, **não substitui parecer ético, jurídico ou a orientação da sua coordenação**.',
      base: 'Sistema Conselhos de Psicologia (CFP e CRPs); CREPOP.',
      actions: [], follow: ['E se o juiz pedir um relatório?'] }
  ];
  // ---------------------------------------------------------------------
  // Base do PAIF (trabalho social com famílias no CRAS): 61 verbetes curados, cada um com a norma citada.
  // Fontes: Tipificação (Res. CNAS 109/2009), LOAS art. 24-A, Orientações Técnicas do PAIF, guias de PAF,
  // trilhas do MDS (2024/2026), Referências do CFP/CREPOP e Censo SUAS 2025. Respondem sem internet e sem IA.
  // ---------------------------------------------------------------------
  var PAIF_REV = 'nov/2026';
  var PAIF_BASE = [
    { id: 'paif-o-que-e', cat: 'O serviço',
      keys: ['oq+e+paif', 'oq+paif', 'paif+oq', 'paif+significa', 'paif e o que', 'me fala do paif', 'me fala sobre o paif', 'fala sobre o paif', 'sobre o paif', 'o que voce sabe sobre o paif', 'me conta sobre o paif', 'o que e o paif', 'o que e paif', 'o que significa paif', 'paif significa', 'servico de protecao e atendimento integral a familia', 'conceito de paif', 'definicao de paif', 'explica o paif', 'me explica o paif', 'resumo do paif', 'para que serve o paif', 'qual a finalidade do paif', 'o que faz o paif', 'como funciona o paif'],
      text: 'O **PAIF** (Serviço de Proteção e Atendimento Integral à Família) é o **trabalho social com famílias, de caráter continuado**, ofertado no CRAS.\n- **Finalidade:** fortalecer a **função protetiva** das famílias, **prevenir a ruptura dos vínculos**, promover o acesso e o usufruto de direitos e melhorar a qualidade de vida.\n- **Caráter:** preventivo, protetivo e proativo; desenvolve potencialidades e aquisições das famílias.\n- **Na lei:** integra a proteção social básica e busca prevenir o rompimento dos vínculos familiares e a violência nas relações, garantindo o direito à convivência familiar e comunitária.\n- **Não é terapêutico:** as ações do PAIF não têm caráter terapêutico.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009); LOAS, art. 24-A (Lei 8.742/1993).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['Quais são os objetivos do PAIF?', 'Quem é atendido no PAIF?', 'Quais são as ações do PAIF?'] },

    { id: 'paif-base-legal', cat: 'O serviço',
      keys: ['base legal do paif', 'lei do paif', 'paif na loas', 'artigo 24-a', 'art 24-a da loas', 'legislacao do paif', 'normas do paif', 'qual norma regulamenta o paif', 'onde esta o paif na lei', 'paif e obrigatorio', 'o paif e obrigatorio no cras', 'quem criou o paif', 'quando surgiu o paif'],
      text: 'Onde o PAIF está previsto:\n- **LOAS, art. 24-A:** institui o PAIF como serviço da proteção social básica, de prestação continuada, **nos CRAS**, por meio do trabalho social com famílias em vulnerabilidade, para prevenir o rompimento de vínculos e a violência nas relações.\n- **Tipificação Nacional (Res. CNAS 109/2009):** descreve o serviço, usuários, objetivos, aquisições e funcionamento. Diz que é ofertado **necessariamente no CRAS** e que a implementação cabe exclusivamente ao Estado.\n- **Orientações Técnicas sobre o PAIF (MDS):** detalham as ações, o acompanhamento familiar e o PAF.\n- **Res. CNAS 17/2011:** assistente social e psicólogo compõem obrigatoriamente a equipe de referência da proteção social básica.',
      base: 'LOAS, art. 24-A (Lei 8.742/1993); Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009); Res. CNAS 17/2011.',
      actions: [], follow: ['O que é o PAIF?', 'Quem compõe a equipe do PAIF?'] },

    { id: 'paif-objetivos', cat: 'O serviço',
      keys: ['objetivos do paif', 'objetivo do paif', 'qual o objetivo do paif', 'quais os objetivos do paif', 'quais sao os objetivos do paif', 'paif+objetivos', 'paif+objetivo', 'metas do paif'],
      text: 'Objetivos do PAIF, segundo a Tipificação:\n- fortalecer a **função protetiva da família**, melhorando sua qualidade de vida;\n- **prevenir a ruptura dos vínculos** familiares e comunitários, superando fragilidades sociais;\n- promover **aquisições sociais e materiais**, potencializando o protagonismo e a autonomia de famílias e comunidades;\n- promover o **acesso a benefícios**, programas de transferência de renda e serviços socioassistenciais;\n- promover o acesso aos **demais serviços setoriais** (saúde, educação etc.), para o usufruto de direitos;\n- **apoiar famílias com membros que precisam de cuidados**, com espaços coletivos de escuta e troca de vivências.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, objetivos).',
      actions: [], follow: ['Quem é atendido no PAIF?', 'Quais são as aquisições dos usuários do PAIF?'] },

    { id: 'paif-usuarios', cat: 'O serviço',
      keys: ['o paif atende quem', 'paif atende quem', 'quem o paif atende', 'quem pode ser acompanhado no paif', 'quem e atendido no paif', 'quem pode participar do paif', 'quem tem direito ao paif', 'quem pode ser atendido no paif', 'publico do paif', 'publico alvo do paif', 'usuarios do paif', 'paif+publico', 'paif+usuarios', 'paif+usuario', 'para quem e o paif', 'quem participa do paif', 'quem frequenta o paif'],
      text: 'O público do PAIF são **famílias em situação de vulnerabilidade social** (por pobreza, acesso precário ou nulo a serviços públicos, fragilização de vínculos ou outra vulnerabilidade e risco) **que moram no território de abrangência do CRAS**. A Tipificação destaca:\n- famílias **beneficiárias de transferência de renda** (como o Bolsa Família) e de benefícios assistenciais (como o BPC);\n- famílias **elegíveis a esses programas que ainda não foram contempladas**;\n- famílias em vulnerabilidade por **dificuldades de algum membro**;\n- **pessoas com deficiência e/ou idosas** em vulnerabilidade e risco social.\nA prioridade orienta a busca ativa e a fila do acompanhamento; **não retira o direito** de nenhuma família do território ser atendida.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, usuários); Orientações Técnicas sobre o PAIF (MDS).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['Como a família chega ao PAIF?', 'Quando propor acompanhamento familiar?'] },

    { id: 'paif-acesso', cat: 'O serviço',
      keys: ['como a familia chega ao paif', 'como acessar o paif', 'como entrar no paif', 'formas de acesso ao paif', 'forma de acesso ao paif', 'como e o acesso ao paif', 'porta de entrada do paif', 'como a familia entra no paif', 'como inserir familia no paif', 'como incluir familia no paif', 'paif+acesso', 'paif+encaminhamento'],
      text: 'A Tipificação prevê quatro formas de acesso ao PAIF:\n- **procura espontânea**;\n- **busca ativa**;\n- **encaminhamento da rede socioassistencial**;\n- **encaminhamento das demais políticas públicas** (saúde, educação etc.).\nA família precisa ser **territorialmente referenciada** ao CRAS. O serviço dá atenção especial a famílias em reconstrução de autonomia ou de vínculos, com crianças, adolescentes, jovens e idosos em serviços socioassistenciais, com beneficiários do BPC e inseridas em programas de transferência de renda.\nA porta de entrada do trabalho social é a **acolhida**.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, condições e formas de acesso).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['O que é a acolhida no PAIF?', 'O que é busca ativa?'] },

    { id: 'paif-funcionamento', cat: 'O serviço',
      keys: ['horario de funcionamento do paif', 'funcionamento do paif', 'quantas horas funciona o cras', 'quantos dias o cras funciona', 'cras funciona sabado', 'periodo de funcionamento do cras', 'jornada do cras', 'paif+funcionamento', 'paif+abrangencia', 'abrangencia do paif', 'onde e ofertado o paif', 'onde o paif e ofertado'],
      text: 'Pela Tipificação, o PAIF é ofertado no **CRAS** (unidade pública estatal), com funcionamento **mínimo de 5 dias por semana e 8 horas diárias**, necessariamente no período diurno. Pode haver atividades complementares à noite e funcionamento em feriados e fins de semana.\nA **abrangência** é municipal; em metrópoles e municípios de médio e grande porte corresponde ao **território de abrangência do CRAS**, conforme a incidência da demanda.\nO CRAS é, por lei, unidade de base territorial localizada em áreas de maior vulnerabilidade e risco social (LOAS, art. 6º-C, § 1º).',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, unidade e funcionamento); LOAS, art. 6º-C.',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['Como funciona o PAIF em território de baixa densidade?'] },

    { id: 'paif-trabalho-essencial', cat: 'O serviço',
      keys: ['trabalho social essencial do paif', 'trabalho social essencial ao servico', 'o que o paif oferece', 'o que o paif inclui', 'o que o paif faz com a familia', 'atividades do paif', 'quais as atividades do paif', 'paif+atividades', 'paif+oferece', 'servicos oferecidos pelo paif'],
      text: 'O **trabalho social essencial** ao PAIF, segundo a Tipificação, inclui:\n- acolhida; estudo social; visita domiciliar;\n- orientação e encaminhamentos;\n- grupos de famílias; **acompanhamento familiar**;\n- atividades comunitárias e campanhas socioeducativas;\n- informação, comunicação e defesa de direitos; promoção do acesso à **documentação pessoal**;\n- mobilização e fortalecimento de redes sociais de apoio; convívio familiar e comunitário; mobilização para a cidadania;\n- conhecimento do território; cadastramento socioeconômico; elaboração de relatórios e/ou prontuários;\n- notificação de situações de vulnerabilidade e risco social; **busca ativa**.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, trabalho social essencial ao serviço).',
      actions: [], follow: ['Quais são as ações do PAIF?', 'O que é a acolhida no PAIF?'] },

    { id: 'paif-aquisicoes', cat: 'O serviço',
      keys: ['aquisicoes+usuarios', 'aquisicoes+paif', 'aquisicoes do paif', 'aquisicoes dos usuarios do paif', 'o que a familia ganha no paif', 'o que a familia adquire no paif', 'segurancas afiancadas no paif', 'seguranca de acolhida', 'seguranca de convivio familiar', 'seguranca de autonomia', 'seguranca de desenvolvimento da autonomia', 'paif+aquisicoes', 'paif+segurancas', 'paif+seguranca'],
      text: 'As **aquisições** esperadas dos usuários, organizadas nas seguranças afiançadas pela assistência social:\n- **Acolhida:** ter demandas e necessidades acolhidas; receber orientações e encaminhamentos a benefícios, transferência de renda e outros direitos; ambiência acolhedora; privacidade.\n- **Convívio familiar e comunitário:** experiências que fortaleçam vínculos e ampliem a capacidade protetiva; acesso a serviços de qualidade.\n- **Desenvolvimento da autonomia:** respeito a si e aos outros, participação cidadã, projetos individuais e coletivos, autoestima; **redução do descumprimento de condicionalidades do Bolsa Família**; acesso à **documentação civil**; informação sobre emprego, renda, associativismo e cooperativismo.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, aquisições dos usuários).',
      actions: [], follow: ['Quais são os objetivos do PAIF?'] },

    { id: 'paif-provisoes', cat: 'O serviço',
      keys: ['estrutura do paif', 'provisoes do paif', 'ambiente fisico do paif', 'recursos materiais do paif', 'o que o cras precisa ter para o paif', 'espaco fisico do cras', 'salas do cras', 'paif+provisoes', 'paif+ambiente', 'paif+estrutura'],
      text: 'Provisões previstas na Tipificação para o PAIF:\n- **Ambiente físico:** recepção, sala(s) de atendimento individualizado, sala(s) de atividades coletivas e comunitárias, sala administrativa e sanitários, com iluminação, ventilação, privacidade, salubridade e **acessibilidade** (normas da ABNT).\n- **Recursos materiais:** mobiliário, computadores, materiais socioeducativos (pedagógicos, culturais e esportivos).\n- **Bases de dados:** de usuários de benefícios e serviços, dos serviços socioassistenciais, o **Cadastro Único** e o cadastro de beneficiários do **BPC**.\n- **Recursos humanos:** conforme a NOB-RH/SUAS.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, provisões).',
      actions: [], follow: ['Quem compõe a equipe do PAIF?'] },

    { id: 'paif-impacto', cat: 'O serviço',
      keys: ['impacto do paif', 'impacto social esperado do paif', 'resultado esperado do paif', 'resultados do paif', 'para que serve o trabalho social com familias', 'paif+impacto', 'paif+resultados', 'como saber se o paif funciona'],
      text: 'O **impacto social esperado** do PAIF, segundo a Tipificação, é contribuir para:\n- reduzir a ocorrência de situações de **vulnerabilidade social** no território do CRAS;\n- **prevenir** riscos sociais, seu agravamento ou reincidência;\n- ampliar o acesso a serviços socioassistenciais e setoriais;\n- melhorar a qualidade de vida das famílias do território.\nÉ um serviço de **prevenção e fortalecimento**; quando já há violação de direitos, o caminho é o CREAS/PAEFI.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, impacto social esperado).',
      actions: [], follow: ['Qual a diferença entre PAIF e PAEFI?'] },

    { id: 'paif-nao-terapeutico', cat: 'O serviço',
      keys: ['paif+saude', 'paif+ubs', 'paif+caps', 'encaminhar+saude+paif', 'paif e terapia', 'paif tem carater terapeutico', 'paif e psicoterapia', 'o paif e terapeutico', 'carater terapeutico do paif', 'paif+terapeutico', 'paif+terapia', 'paif+psicoterapia', 'paif+clinico', 'paif+clinica', 'grupo do paif e terapia'],
      text: 'A Tipificação é direta: **as ações do PAIF não devem ter caráter terapêutico**. Grupos, oficinas e acompanhamento são **trabalho social**: escuta qualificada, reflexão sobre vulnerabilidades e potencialidades, acesso a direitos e fortalecimento de vínculos.\nQuando há sofrimento psíquico que pede cuidado clínico, o caminho é **articular com a rede de saúde** (UBS, CAPS), sem fazer psicoterapia no CRAS. Para a psicologia no PAIF, o foco é psicossocial: compreender os processos subjetivos ligados à vulnerabilidade e prevenir rupturas de vínculos.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, descrição); Referências Técnicas do CREPOP/CFP para atuação no CRAS (2021).',
      actions: [{ label: 'Ver UBS', search: 'UBS' }, { label: 'Ver CAPS', search: 'CAPS' }], follow: ['Qual o papel da psicologia no PAIF?', 'Quando encaminhar para a saúde?'] },

    { id: 'paif-acoes', cat: 'Ações do PAIF',
      keys: ['acoes do paif', 'quais as acoes do paif', 'quais sao as acoes do paif', 'tipos de acao do paif', 'paif+acoes', 'acoes individuais e coletivas do paif', 'acoes particularizadas', 'o que e acao particularizada'],
      text: 'Segundo as Orientações Técnicas, as ações do PAIF são:\n- **Individuais** (com a família ou um de seus membros): **acolhida**, **ações particularizadas** e **encaminhamentos**.\n- **Coletivas:** **oficinas com famílias** e **ações comunitárias**.\nO **acompanhamento familiar** reúne esse conjunto de ações em torno de um plano (o PAF) construído junto com a família. As trilhas do MDS orientam dar preferência às **ações coletivas**, sem negar o atendimento individual quando necessário.',
      base: 'Orientações Técnicas sobre o PAIF (MDS); Trilhas do PAIF (MDS, 2024 e 2026).',
      actions: [], follow: ['O que é a acolhida no PAIF?', 'O que são oficinas com famílias?', 'O que são ações comunitárias?'] },

    { id: 'paif-acolhida', cat: 'Ações do PAIF',
      keys: ['diferenca entre acolhida e atendimento', 'acolhida e atendimento', 'acolhida no paif', 'o que e a acolhida', 'o que e acolhida', 'o que e acolhida no paif', 'o que e a acolhida no paif', 'como e a acolhida no cras', 'como fazer a acolhida', 'acolhida em grupo', 'paif+acolhida', 'acolhida do paif', 'escuta qualificada no paif'],
      text: 'A **acolhida** é a escuta qualificada da demanda da família e a **porta de entrada do trabalho social** no PAIF.\nÉ nela que a equipe verifica, com o **estudo social** e o prontuário da família, se é preciso iniciar um **acompanhamento familiar** ou se o atendimento nas ações do PAIF já responde à demanda.\nPode ser **em grupo** (informações gerais, escuta coletiva) ou **particularizada** (a família ou um membro, com preenchimento do Prontuário).',
      base: 'Orientações Técnicas sobre o PAIF (MDS) (acolhida no PAIF).',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['O que é a acolhida particularizada?', 'Qual a diferença entre atendimento e acompanhamento?'] },

    { id: 'paif-acolhida-particularizada', cat: 'Ações do PAIF',
      keys: ['acolhida particularizada', 'o que e acolhida particularizada', 'o que e a acolhida particularizada', 'acolhida no domicilio', 'acolhida particularizada no domicilio', 'quando fazer acolhida no domicilio', 'paif+particularizada', 'paif+particularizado'],
      text: 'Na **acolhida particularizada**, o profissional preenche ou atualiza o **Prontuário da Família**, no CRAS ou no domicílio.\nA acolhida **no domicílio exige o consentimento da família** e é indicada, por exemplo, em **descumprimento reiterado de condicionalidades**, ou para crianças e adolescentes com deficiência, beneficiários do BPC e fora da escola.\nO atendimento particularizado também é indicado quando a situação pede proteção imediata, sigilo ou quando a família tem dificuldade de deslocamento.',
      base: 'Orientações Técnicas sobre o PAIF (MDS) (acolhida particularizada).',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['O que é o prontuário da família?', 'Como é a visita domiciliar?'] },

    { id: 'paif-estudo-social', cat: 'Ações do PAIF',
      keys: ['estudo social no paif', 'o que e estudo social', 'o que e o estudo social', 'estudo social do cras', 'como fazer estudo social', 'paif+estudo+social'],
      text: 'O **estudo social** é a leitura da situação da família e do território: suas vulnerabilidades, potencialidades, rede de apoio e acesso a direitos.\nEle é feito na acolhida e **orienta a decisão** de a família ser apenas atendida ou ser **acompanhada** (com PAF). Faz parte do trabalho social essencial do PAIF (Tipificação) e antecede o plano de acompanhamento (Referências do CFP/CREPOP).\nRegistre fatos e a escuta da família, sem rotular.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009); Orientações Técnicas sobre o PAIF (MDS); Referências Técnicas do CREPOP/CFP para atuação no CRAS (2021).',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['Quando propor acompanhamento familiar?'] },

    { id: 'paif-visita-domiciliar', cat: 'Ações do PAIF',
      keys: ['visita+surpresa', 'visita+sem+avisar', 'visita+agendada', 'visita+consentimento', 'visita+familia+recusa', 'visita+domiciliar+recusa', 'visita domiciliar', 'visita domiciliar no paif', 'como e a visita domiciliar', 'como fazer visita domiciliar', 'visita domiciliar do cras', 'visita domiciliar e obrigatoria', 'a visita domiciliar e obrigatoria', 'visita fiscalizatoria', 'visita domiciliar fiscaliza', 'paif+visita', 'paif+domicilio'],
      text: 'No PAIF, a **visita domiciliar** é uma ação possível do trabalho social e tem regras claras:\n- exige **consentimento da família** e é **agendada**;\n- **não tem caráter fiscalizatório**;\n- **não é obrigatória** para acompanhar uma família;\n- é feita pela equipe técnica; o nível médio pode apoiar.\nUm aviso sobre o futuro: segundo a trilha do MDS de 2026, a Resolução CIT nº 30/2025 dá papel estruturante à visita domiciliar na proteção social básica por meio do **SPSBD-GC** (gestantes e crianças), com início em **1º/1/2027**, substituindo o Programa Criança Feliz. Confira a nomenclatura e as regras no texto oficial.',
      base: 'Orientações Técnicas sobre o PAIF (MDS); Trilhas do PAIF (MDS, 2024 e 2026).',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['O que é a acolhida particularizada?', 'Qual a diferença entre PAIF e SCFV?'] },

    { id: 'paif-oficinas', cat: 'Ações do PAIF',
      keys: ['oficinas com familias', 'oficina com familias', 'o que sao oficinas com familias', 'o que e oficina com familias', 'oficinas do paif', 'oficina do paif', 'como fazer oficina com familias', 'quantas pessoas na oficina do paif', 'paif+oficinas', 'paif+oficina'],
      text: '**Oficinas com famílias** são encontros previamente organizados, com **objetivos de curto prazo**, conduzidos por **técnicos de nível superior**, para refletir sobre situações de vulnerabilidade e potencialidades.\n- A inserção é **por convite**; a oficina **não deve ser a única possibilidade** de atendimento da família.\n- As Orientações Técnicas sugerem **7 a 15 participantes** e **60 a 120 minutos**.\n- Uma oficina pode revelar uma família que precisa de acompanhamento ou de ação particularizada.\n- A metodologia é participativa, no ciclo **ação-reflexão-ação**; ludicidade e brincar ajudam o diálogo (trilhas do MDS).',
      base: 'Orientações Técnicas sobre o PAIF (MDS); Trilhas do PAIF (MDS, 2024 e 2026).',
      actions: [], follow: ['O que são ações comunitárias?', 'Como funcionam os grupos de famílias?'] },

    { id: 'paif-acoes-comunitarias', cat: 'Ações do PAIF',
      keys: ['acoes comunitarias', 'acao comunitaria', 'o que sao acoes comunitarias', 'o que e acao comunitaria', 'acoes comunitarias do paif', 'atividades comunitarias do paif', 'paif+comunitarias', 'paif+comunitaria', 'paif+comunitario'],
      text: '**Ações comunitárias** são coletivas, voltadas a **dinamizar as relações no território**, com mais participantes que as oficinas: palestras, campanhas e eventos comunitários.\nServem para enfrentar problemas coletivos (violência, trabalho infantil, falta de acessibilidade, de transporte, de espaços de lazer e cultura) e para **fortalecer a participação social e a defesa de direitos**.',
      base: 'Orientações Técnicas sobre o PAIF (MDS) (ações comunitárias).',
      actions: [], follow: ['O que são oficinas com famílias?', 'O que é o trabalho social com famílias e territórios?'] },

    { id: 'paif-grupos', cat: 'Ações do PAIF',
      keys: ['reuniao+grupo+paif', 'paif+reuniao', 'grupos de familias', 'grupo de familias', 'grupos do paif', 'grupo do paif', 'como organizar grupos no paif', 'grupos por tema', 'grupo de familias com condicionalidades', 'paif+grupos', 'paif+grupo', 'grupos de familias por tema'],
      text: 'Grupos de famílias são **ações coletivas** do PAIF. O guia de acompanhamento familiar sugere uma **agenda mensal** de grupos por afinidade temática, por exemplo:\n- famílias com **condicionalidades do Bolsa Família descumpridas**;\n- famílias com **pessoas que precisam de cuidados**;\n- famílias em **insegurança alimentar**;\n- famílias com **violência doméstica**;\n- famílias de **adolescentes fora da escola**.\nPrivilegie o trabalho coletivo, sem negar o atendimento individual quando necessário. Lembre que grupo do PAIF é trabalho social, **não terapia**.',
      base: 'Guia de acompanhamento familiar do PAIF; Trilhas do PAIF (MDS, 2024 e 2026).',
      actions: [], follow: ['O que são oficinas com famílias?', 'O que é acompanhamento em grupo?'] },

    { id: 'paif-busca-ativa', cat: 'Ações do PAIF',
      keys: ['busca ativa', 'o que e busca ativa', 'busca ativa no paif', 'como fazer busca ativa', 'busca ativa no cras', 'paif+busca', 'equipe volante busca ativa'],
      text: 'A **busca ativa** é a procura de famílias em vulnerabilidade e risco no território para **incluir ou atualizar o Cadastro Único** e garantir o acesso aos serviços do SUAS. Faz parte do trabalho social essencial do PAIF (Tipificação).\nNo Bolsa Família, a busca ativa deve **priorizar famílias ainda não inseridas no PAIF**, em especial as em descumprimento de condicionalidades (trilha de 2024).\nSegundo a trilha de 2026, as Resoluções CIT nº 18/2024 e CNAS/MDS nº 185/2025 orientam a busca ativa com prioridade para os **Grupos Populacionais Tradicionais e Específicos (GPTE)**; equipes volantes atendem e cadastram nas comunidades, inclusive de barco na Amazônia Legal.\nRegistre as tentativas de contato.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009); Trilhas do PAIF (MDS, 2024 e 2026).',
      actions: [], follow: ['Como funciona o PAIF em território de baixa densidade?', 'Como o PAIF atende famílias do Bolsa Família?'] },

    { id: 'paif-atend-x-acomp', cat: 'Acompanhamento e PAF',
      keys: ['diferenca entre atendimento e acompanhamento', 'atendimento e acompanhamento', 'atendimento x acompanhamento', 'atendimento ou acompanhamento', 'todo atendimento exige paf', 'toda familia atendida precisa de acompanhamento', 'toda familia precisa de paf', 'paif+atendimento+acompanhamento'],
      text: '- **Atendimento** é **pontual**: a família procura orientação sobre serviço, direito ou benefício e a demanda se resolve naquele contato ou com um encaminhamento.\n- **Acompanhamento** é um **processo**: tem plano (PAF), prazos, vários encontros e monitoramento.\n**Nem toda família atendida precisa ser acompanhada**: a decisão sai da acolhida, com o estudo social. Atendimento pontual **não exige PAF**.',
      base: 'Guia de acompanhamento familiar do PAIF; Orientações Técnicas sobre o PAIF (MDS).',
      actions: [], follow: ['Quando propor acompanhamento familiar?', 'O que é o PAF?'] },

    { id: 'paif-acompanhamento', cat: 'Acompanhamento e PAF',
      keys: ['o que e acompanhamento familiar', 'o que e o acompanhamento familiar', 'acompanhamento familiar', 'acompanhamento familiar no paif', 'como funciona o acompanhamento familiar', 'definicao de acompanhamento familiar', 'conceito de acompanhamento familiar', 'paif+acompanhamento'],
      text: 'O **acompanhamento familiar** é a inserção da família em um conjunto de intervenções **continuadas e particularizadas**, para **superar gradativamente as vulnerabilidades** e enfrentar riscos que limitam o exercício da cidadania.\n- Baseia-se em **compromissos** entre a família e os profissionais e **pressupõe o PAF**.\n- É feito por **técnicos de nível superior** (assistente social e psicólogo/a), com mais de um encontro.\n- A participação é **voluntária**: a família pode recusar sem perder o direito ao serviço.\n- Oferece à família um espaço para refletir sobre a própria realidade.',
      base: 'Orientações Técnicas sobre o PAIF (MDS); guia de acompanhamento familiar do PAIF; Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009).',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['O que é o PAF?', 'Quais são os cinco momentos do acompanhamento?', 'Quando propor acompanhamento familiar?'] },

    { id: 'paif-quando-acompanhar', cat: 'Acompanhamento e PAF',
      keys: ['quando+propor+acompanhamento', 'quando+iniciar+acompanhamento', 'quando+indicar+acompanhamento', 'quando propor acompanhamento familiar', 'quando iniciar acompanhamento familiar', 'quando acompanhar uma familia', 'quando indicar acompanhamento', 'quem deve ser acompanhado no paif', 'criterio para acompanhamento familiar', 'criterios de inclusao no acompanhamento', 'quem tem prioridade no paif', 'prioridade no paif', 'prioridade no acompanhamento familiar', 'paif+prioridade', 'paif+prioritarias'],
      text: 'A decisão sai da **acolhida e do estudo social**: indica-se o acompanhamento quando há vulnerabilidades ou riscos que um atendimento pontual não resolve e que limitam o exercício da cidadania.\n**Têm prioridade** (na busca ativa e na fila): famílias **beneficiárias de transferência de renda** e de benefícios socioassistenciais (inclusive em descumprimento de condicionalidades), famílias com membros em dificuldade, famílias elegíveis ainda não contempladas e famílias com **pessoas idosas ou com deficiência** em vulnerabilidade.\nPrioridade orienta a **ordem do trabalho**; não cria nem retira o direito de ser atendida.',
      base: 'Guia de acompanhamento familiar do PAIF; Orientações Técnicas sobre o PAIF (MDS); Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009).',
      actions: [], follow: ['Qual a diferença entre atendimento e acompanhamento?', 'O que é o PAF?'] },

    { id: 'paif-paf', cat: 'Acompanhamento e PAF',
      keys: ['paf+fazer', 'paf+faco', 'paf+escrever', 'paf+montar', 'paf+elaborar', 'paf+construir', 'paf+redigir', 'o que e o paf', 'o que e paf', 'o que e o plano de acompanhamento familiar', 'plano de acompanhamento familiar', 'plano de acompanhamento', 'como montar o plano de acompanhamento', 'como fazer o paf', 'como elaborar o paf', 'como construir o paf', 'para que serve o paf', 'paf+familiar', 'paf+plano', 'paf+acompanhamento', 'objetivos do plano de acompanhamento', 'sigla paf'],
      text: 'O **PAF (Plano de Acompanhamento Familiar)** é o planejamento **conjunto**, feito pela família e pelo profissional de referência, do acompanhamento no PAIF.\n- Define **objetivos**, estratégias para fortalecer a família e enfrentar vulnerabilidades, inserção em ações do PAIF e **mediações periódicas**, com **prazos** e data de retorno.\n- A família é **sujeito do plano, não objeto**: ele é construído com ela, não decidido pela técnica.\n- Pode ser **readequado** sempre que a situação mudar.\n- É o instrumento que transforma a decisão de acompanhar em um processo com começo, meio e fim e permite avaliar se a família avançou.',
      base: 'Orientações Técnicas sobre o PAIF (MDS); guia de acompanhamento familiar do PAIF.',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['O que o PAF deve registrar?', 'Como escrever boas metas no PAF?', 'O PAF é obrigatório?'] },

    { id: 'paif-paf-conteudo', cat: 'Acompanhamento e PAF',
      keys: ['o que o paf registra', 'o que o paf deve registrar', 'o que colocar no paf', 'o que tem no paf', 'conteudo do paf', 'campos do paf', 'estrutura do paf', 'modelo de paf', 'o que escrever no paf', 'paf+registra', 'paf+conteudo', 'paf+modelo', 'paf+campos', 'paf+estrutura'],
      text: 'Segundo as **Referências do CFP/CREPOP** para o CRAS (2021), no encontro inicial de construção do plano registram-se: **demandas, necessidades, vulnerabilidades, potencialidades**, recursos da rede e do território, **estratégias e percursos possíveis**, o **compromisso da família** e a **atuação do Estado**. Antes disso, há o estudo social.\nUm bom PAF costuma ter (prática sugerida): situação de partida em fatos, objetivos da família, metas com prazo, estratégias, compromissos da família/serviço/rede e data de retorno.\nRegistre fatos, sem rótulos como "desestruturada".',
      base: 'Referências Técnicas do CREPOP/CFP para atuação no CRAS (2021) (item 3.10); guia de acompanhamento familiar do PAIF.',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['Como escrever boas metas no PAF?', 'Quais são os erros comuns do PAF?'] },

    { id: 'paif-paf-metas', cat: 'Acompanhamento e PAF',
      keys: ['como escrever metas do paf', 'como escrever boas metas no paf', 'como formular metas do paf', 'metas do paf', 'meta do paf', 'exemplo de meta do paf', 'exemplos de meta do paf', 'exemplo de meta', 'como definir objetivos no paf', 'exemplos de estrategia do paf', 'paf+metas', 'paf+meta', 'paf+exemplos', 'paf+exemplo'],
      text: '**Boa meta** (prática sugerida): nasce do que a família quer mudar, é **pequena, observável e tem prazo**.\n- Ruim: "melhorar a vida da família".\n- Melhor: "até a data de retorno, os dois filhos em idade escolar estarão matriculados e frequentando".\n- Teste: dá para saber, no próximo encontro, se foi cumprida?\n- Limite o plano a **poucas metas por ciclo** (cerca de três é regra prática).\n- Meta que só depende de a família mudar, sem nada da rede, é sinal de **familismo**: o que é dever do Estado (vaga, atendimento, documento) entra como **compromisso do serviço e da rede**.\nTemas comuns: documentação civil, criança fora da escola, benefícios (conferir CadÚnico, sem prometer concessão), cuidado de idoso/pessoa com deficiência, trabalho e renda, isolamento.',
      base: 'Guia de acompanhamento familiar do PAIF (prática sugerida, não é norma); Referências Técnicas do CREPOP/CFP para atuação no CRAS (2021).',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['Quais são os erros comuns do PAF?', 'O que são compromissos no PAF?'] },

    { id: 'paif-momentos', cat: 'Acompanhamento e PAF',
      keys: ['momentos do acompanhamento familiar', 'cinco momentos do acompanhamento', 'quais os momentos do acompanhamento', 'etapas do acompanhamento familiar', 'etapas do paf', 'passo a passo do acompanhamento familiar', 'fluxo do acompanhamento familiar', 'fluxo do paif', 'passo a passo do paif', 'paif+etapas', 'paif+momentos', 'paif+fluxo', 'acompanhamento+etapas'],
      text: 'Os **cinco momentos** do acompanhamento familiar, nas Orientações Técnicas:\n1. **Encontro inicial:** a equipe apresenta objetivos e compromissos e a família escolhe com ela o tipo (particularizado ou em grupo).\n2. **Construção conjunta do PAF.**\n3. **Inserção em ações do PAIF:** acolhida, ações particularizadas, oficinas, ações comunitárias e encaminhamentos.\n4. **Mediações periódicas:** o profissional está junto da família durante o percurso.\n5. **Avaliação conjunta:** as vulnerabilidades que motivaram o acompanhamento foram superadas?\nUm guia complementar descreve o fluxo antes disso: busca ativa, demanda espontânea, acolhida em grupo, acolhida particularizada, visita (opcional e agendada) e agendamento para construir o PAF.',
      base: 'Orientações Técnicas sobre o PAIF (MDS); guia de acompanhamento familiar do PAIF.',
      actions: [], follow: ['O que é o PAF?', 'Quando reavaliar o PAF?'] },

    { id: 'paif-particularizado-grupo', cat: 'Acompanhamento e PAF',
      keys: ['acompanhamento particularizado', 'acompanhamento em grupo', 'acompanhamento particularizado ou em grupo', 'particularizado ou em grupo', 'quando fazer acompanhamento em grupo', 'quando fazer acompanhamento particularizado', 'diferenca entre acompanhamento particularizado e em grupo', 'acompanhamento coletivo'],
      text: 'O acompanhamento familiar pode ser:\n- **Particularizado** (uma só família): indicado quando a situação exige **proteção imediata ou sigilo**, há dificuldade de deslocamento, a família não se sente à vontade em grupo ou corre risco de recair em situação mais grave.\n- **Em grupo** (famílias com vulnerabilidades parecidas): indicado quando a vulnerabilidade tem forte relação com o **território**, tem objetivos de longo prazo e tempo determinado, e exige bom diagnóstico do território.\nUm não exclui o outro: uma família pode ter plano particularizado e também participar de grupo. A família escolhe o tipo com a equipe, no encontro inicial.',
      base: 'Orientações Técnicas sobre o PAIF (MDS) (acompanhamento particularizado e em grupo).',
      actions: [], follow: ['Quais são os cinco momentos do acompanhamento?'] },

    { id: 'paif-compromissos', cat: 'Acompanhamento e PAF',
      keys: ['compromissos no paf', 'compromisso no paf', 'o que sao compromissos do paf', 'compromissos do acompanhamento familiar', 'compromisso da familia no paf', 'compromisso e condicao para o beneficio', 'paf+compromissos', 'paf+compromisso', 'contrato do paf'],
      text: '**Compromisso** é a pactuação do que cada parte fará:\n- **Família:** o que ela quer e pode fazer, no seu ritmo.\n- **Serviço:** acolher, visitar, orientar, articular, informar prazos.\n- **Rede:** saúde, educação e outros serviços, com contrarreferência.\nCompromisso **não é condição para manter benefício** nem contrato punitivo: o descumprimento de uma etapa é motivo para **rever o plano e escutar a família**, não para sancionar. Registre em linguagem que a família entenda e ofereça cópia, se ela quiser.',
      base: 'Orientações Técnicas sobre o PAIF (MDS); Referências Técnicas do CREPOP/CFP para atuação no CRAS (2021); guia de acompanhamento familiar do PAIF.',
      actions: [], follow: ['A família pode recusar o acompanhamento?'] },

    { id: 'paif-mediacoes', cat: 'Acompanhamento e PAF',
      keys: ['registrar+atendimento+paif', 'registrar+encontros+paf', 'mediacoes periodicas', 'mediacao periodica', 'o que e mediacao no paif', 'como registrar encontros do paf', 'registro dos encontros do acompanhamento', 'como registrar o atendimento no paif', 'quantos encontros tem o acompanhamento', 'quantos encontros no paf', 'quantos atendimentos por familia', 'periodicidade do acompanhamento', 'frequencia dos encontros do paif', 'paf+encontros', 'paf+mediacoes', 'paf+periodicidade'],
      text: '**Mediação periódica** é a presença do profissional ao longo do plano: encontros, visitas, contatos e apoio nos momentos de decisão.\nA cada encontro, registre em ordem cronológica: **data, tipo** (CRAS, visita, telefone, grupo, reunião de rede), o que foi tratado e dito pela família, o que avançou e o que travou, e os **próximos passos com prazo**. Registro com fatos e sem juízo de valor: o prontuário pode ser lido por outros profissionais e pela própria família.\n**Quantos encontros?** Não há número fixado em norma nacional. Um guia consultado recomenda no mínimo seis por ano, mas **o município define**: confira o protocolo local.',
      base: 'Orientações Técnicas sobre o PAIF (MDS); guia de acompanhamento familiar do PAIF (recomendação, não é norma nacional).',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['Quando reavaliar o PAF?', 'O que é o prontuário da família?'] },

    { id: 'paif-reavaliar', cat: 'Acompanhamento e PAF',
      keys: ['quando reavaliar o paf', 'reavaliar o paf', 'readequar o paf', 'readequacao do paf', 'revisar o paf', 'quando revisar o paf', 'avaliacao do paf', 'avaliar o paf', 'e se a meta nao for alcancada', 'meta nao alcancada', 'objetivos nao foram alcancados', 'paf+reavaliar', 'paf+revisar', 'paf+readequar', 'paf+avaliacao'],
      text: 'Se os objetivos **não foram alcançados**, o caminho é **adequar o plano** às vulnerabilidades que persistem, **não encerrar nem culpar a família**.\nRevise o PAF quando a **situação mudar** (nova vulnerabilidade, mudança de composição, perda de renda, violência, mudança de território), quando a **meta for cumprida** e quando **travar**. Na revisão, pergunte: a meta ainda faz sentido para a família? O que a rede deixou de fazer? O que a família disse que não consegue?\nGuarde o **histórico**: o plano antigo e as datas das mudanças mostram a evolução. A avaliação é **conjunta** com a família (5º momento do acompanhamento).',
      base: 'Orientações Técnicas sobre o PAIF (MDS); guia de acompanhamento familiar do PAIF.',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['Quando e como encerrar o acompanhamento?'] },

    { id: 'paif-encerrar', cat: 'Acompanhamento e PAF',
      keys: ['acompanhamento+quantos+meses', 'quantos+meses+acompanhamento', 'acompanhamento+quantos+anos', 'quanto+tempo+acompanhamento', 'tempo+acompanhamento+familiar', 'quando+encerrar+acompanhamento', 'como+encerrar+acompanhamento', 'quando+desligar+familia', 'quando encerrar o acompanhamento', 'como encerrar o acompanhamento', 'encerrar o acompanhamento familiar', 'encerramento do acompanhamento', 'desligamento do acompanhamento', 'desligar familia do paif', 'quando desligar a familia', 'quando encerrar o paf', 'como encerrar o paf', 'tempo do acompanhamento familiar', 'quanto tempo dura o acompanhamento', 'duracao do acompanhamento', 'paf+encerrar', 'paf+desligamento', 'paif+encerramento'],
      text: 'O **desligamento** ocorre quando os objetivos do plano são alcançados, **depois da avaliação conjunta** com a família. Há outros desfechos legítimos: mudança de domicílio ou território, **encaminhamento ao CREAS** quando há violação de direitos, recusa da família, óbito e localização desconhecida após busca ativa sem êxito.\nAo encerrar, registre o que foi alcançado, o que segue em aberto e **para onde a família é referenciada** (SCFV, rede, outro serviço), e deixe claro que ela **pode voltar ao CRAS**.\n**Prazo:** não há duração nacional fixa. Um guia recomenda encerramento após um ano, salvo necessidade de manter o plano readequado; confira o protocolo do município. Encerrar não pode ser um modo de culpar a família.',
      base: 'Orientações Técnicas sobre o PAIF (MDS); guia de acompanhamento familiar do PAIF (prazo é recomendação, não norma nacional).',
      actions: [], follow: ['Quando reavaliar o PAF?', 'Qual a diferença entre PAIF e PAEFI?'] },

    { id: 'paif-nao-adere', cat: 'Acompanhamento e PAF',
      keys: ['o que fazer quando a familia falta', 'quando a familia nao adere', 'familia falta ou nao adere', 'paif+obrigar', 'paif+obrigada', 'paif+obrigado', 'paif+forcar', 'paif+impor', 'obrigar+familia', 'familia+nao+quer+acompanhamento', 'familia+nao+quer+paif', 'familia que falta', 'familia que nao adere', 'familia nao adere', 'familia nao quer participar do paif', 'familia recusa o acompanhamento', 'familia que some', 'familia nao comparece', 'baixa adesao no paif', 'familia nao vem ao cras', 'falta de adesao no paif', 'familia recusa paif', 'a familia pode recusar o paif', 'a familia pode recusar o acompanhamento', 'participacao no paif e obrigatoria', 'paif+recusa', 'paif+adesao', 'paif+faltas', 'paif+voluntario', 'paif+voluntaria'],
      text: 'A participação no PAIF é **voluntária**: a família pode recusar **sem perder o direito ao serviço**, e a participação **não pode ser condição para manter benefício**.\nFaltas e baixa adesão são **sinal para a equipe**, não motivo de punição. Procure entender os motivos (horário, transporte, cuidado de filhos, trabalho, desconfiança, vergonha, plano que não faz sentido para a família), tente nova abordagem, ajuste o plano e use a **busca ativa**. **Registre as tentativas.**\nSó depois de tentativas registradas e sem localização se justifica o encerramento por localização desconhecida.',
      base: 'Orientações Técnicas sobre o PAIF (MDS); Trilhas do PAIF (MDS, 2024 e 2026); guia de acompanhamento familiar do PAIF.',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['Quando e como encerrar o acompanhamento?', 'O que são compromissos no PAF?'] },

    { id: 'paif-exito', cat: 'Acompanhamento e PAF',
      keys: ['exito do acompanhamento', 'como saber que o acompanhamento deu certo', 'acompanhamento deu certo', 'o acompanhamento avalia a familia', 'avaliar a familia', 'o que o acompanhamento nao avalia', 'sucesso do acompanhamento', 'paif+exito', 'paif+sucesso', 'vulnerabilidade superada'],
      text: 'As **Referências do CFP/CREPOP** para o CRAS (2021) dizem que o acompanhamento **não visa avaliar a família**, sua organização interna, seu modo de vida ou sua dinâmica. O foco são as **seguranças afiançadas** pela assistência social e o **acesso da família a direitos**, para fortalecer sua capacidade protetiva a partir das respostas do Estado.\nFala-se em **êxito** quando se viabilizam e fortalecem as seguranças básicas e se materializa o direito da família à proteção social do Estado, facilitando o desenvolvimento de suas potencialidades.\nVulnerabilidade é expressão de **necessidades humanas decorrentes da desigualdade social**, não defeito da família.',
      base: 'Referências Técnicas do CREPOP/CFP para atuação no CRAS (2021) (p. 122-124).',
      actions: [], follow: ['Quais são os erros comuns do PAF?', 'Como o PAIF evita culpar a família?'] },

    { id: 'paif-paf-faq', cat: 'Acompanhamento e PAF',
      keys: ['o paf e obrigatorio', 'paf e obrigatorio', 'paf obrigatorio', 'quantas familias por tecnico', 'quantas familias cada tecnico acompanha', 'quantas familias um tecnico pode acompanhar', 'numero de familias por tecnico', 'quem elabora o paf', 'quem faz o paf', 'o paf precisa de visita domiciliar', 'paf sem visita domiciliar', 'duvidas sobre o paf', 'perguntas frequentes sobre o paf', 'paf+faq', 'paf+duvidas'],
      text: 'Respostas rápidas sobre o PAF:\n- **É obrigatório?** Para acompanhar uma família no PAIF, **sim**: o acompanhamento pressupõe o plano.\n- **Todo atendimento exige PAF?** **Não.** Atendimento pontual não exige.\n- **A família pode recusar?** **Sim**, a participação é voluntária.\n- **Quem elabora?** Técnicos de **nível superior** (assistente social e psicólogo/a), **com a família**.\n- **Precisa de visita domiciliar?** Não; a visita é uma ação possível, com consentimento.\n- **Quantas famílias por técnico? Quantos encontros? Quanto tempo?** Não há número único na norma nacional consultada: veja o **protocolo do município** e a NOB-RH/SUAS.',
      base: 'Orientações Técnicas sobre o PAIF (MDS); guia de acompanhamento familiar do PAIF; NOB-RH/SUAS.',
      actions: [], follow: ['O que é o PAF?', 'Quem compõe a equipe do PAIF?'] },

    { id: 'paif-erros-paf', cat: 'Acompanhamento e PAF',
      keys: ['erros comuns do paf', 'erros comuns ao elaborar o paf', 'erros no paf', 'erro no paf', 'o que evitar no paf', 'o que nao fazer no paf', 'paf mal feito', 'cuidados ao fazer o paf', 'paf+erros', 'paf+erro', 'paf+evitar'],
      text: 'Erros comuns ao elaborar o PAF:\n- meta **vaga ou sem prazo**; nenhuma **data de retorno**;\n- plano feito pela técnica e **só apresentado** à família; cópia do plano de outra família;\n- **só a mulher** como responsável por tudo (a trilha do MDS alerta que centralidade na família não pode virar centralidade na mulher);\n- descrição que **rotula** ("desestruturada", "negligente") em vez de descrever fatos;\n- potencialidades esquecidas; **nenhum compromisso do serviço ou da rede**;\n- falta de revisão quando a situação muda; excesso de anexos que não servem ao acompanhamento;\n- PAF usado como ficha de cadastro ou como **condição para benefício**.',
      base: 'Guia de acompanhamento familiar do PAIF (prática sugerida); Trilhas do PAIF (MDS, 2024 e 2026).',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['Como escrever boas metas no PAF?'] },

    { id: 'paif-prontuario', cat: 'Equipe e registro',
      keys: ['paif+registrar', 'prontuario da familia', 'o que e o prontuario da familia', 'prontuario no paif', 'prontuario suas', 'prontuario do cras', 'ficha de evolucao familiar', 'como registrar o acompanhamento', 'registro do acompanhamento familiar', 'sigilo do prontuario', 'paif+prontuario', 'paif+registro'],
      text: 'O **Prontuário da Família** é o registro do trabalho social com a família no PAIF. É **preenchido ou atualizado na acolhida particularizada** e acompanha o acompanhamento familiar.\nTodo acompanhamento e a participação da família em grupos e serviços devem ser registrados em prontuário específico (**ficha de evolução familiar**) e lançados nos relatórios e sistemas do SUAS.\nContém **informação sigilosa**: guarde e compartilhe só o necessário, conforme o sigilo profissional e a **LGPD**. As trilhas do MDS citam o Prontuário Eletrônico do SUAS, que tem ficha de encaminhamento intra e intersetorial.',
      base: 'Orientações Técnicas sobre o PAIF (MDS) (prontuário da família); Trilhas do PAIF (MDS, 2024 e 2026).',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['Como o PAIF entra no RMA?', 'Como registrar os encontros do PAF?'] },

    { id: 'paif-rma', cat: 'Equipe e registro',
      keys: ['rma do cras', 'rma no paif', 'o que e rma', 'o que e o rma', 'relatorio mensal de atendimentos', 'registro mensal de atendimentos', 'paif e rma', 'como preencher o rma', 'familias em acompanhamento no rma', 'novas familias no rma', 'paif+rma', 'rma+cras', 'rma+familias'],
      text: 'O **RMA (Registro/Relatório Mensal de Atendimentos)** do CRAS informa, entre outros itens, o **total de famílias em acompanhamento pelo PAIF** e as **novas famílias inseridas no mês**. Confira o formulário vigente para os campos exatos.\nRegistro completo e datado do PAF e das revisões é o que permite **contar corretamente** as famílias em acompanhamento e as novas inserções. Segundo o guia de acompanhamento, a equipe analisa mensalmente os relatórios da Vigilância Socioassistencial ou o RMA; **registro bem feito no dia a dia facilita o RMA**.',
      base: 'Guia de acompanhamento familiar do PAIF; Manual do RMA CRAS (MDS); confira o formulário vigente.',
      actions: [{ label: 'Abrir Anotações', cat: 'ferramentas' }], follow: ['O que é o prontuário da família?'] },

    { id: 'paif-equipe', cat: 'Equipe e registro',
      keys: ['estudo+de+caso', 'reuniao+de+equipe+paif', 'estudo+caso+paif', 'equipe do paif', 'quem compoe a equipe do paif', 'quem trabalha no paif', 'equipe de referencia do cras', 'equipe minima do cras', 'quem faz o que no paif', 'papeis na equipe do paif', 'papel do tecnico de nivel medio no paif', 'nivel medio no paif', 'tecnico de referencia no paif', 'composicao da equipe do cras', 'paif+equipe', 'paif+tecnicos'],
      text: 'Pela **Res. CNAS 17/2011**, a equipe de referência da proteção social básica tem, obrigatoriamente, **assistente social e psicólogo**. A composição por porte do município está na **NOB-RH/SUAS** (confira a tabela vigente).\nPapéis no PAIF, segundo o guia de acompanhamento:\n- **Nível superior:** acolhida particularizada, elabora e monitora o PAF, conduz encontros e avaliação, participa dos grupos.\n- **Nível médio:** apoia busca ativa, acolhida em grupo, execução das atividades e, com a equipe técnica, as visitas domiciliares.\n- **Gestão:** distribui as famílias entre os técnicos de referência, organiza reuniões de planejamento e estudo de caso e constrói o fluxo de referência e contrarreferência com o CREAS.',
      base: 'Res. CNAS 17/2011, art. 1º; NOB-RH/SUAS; guia de acompanhamento familiar do PAIF.',
      actions: [], follow: ['Qual o papel da psicologia no PAIF?', 'O psicólogo é obrigatório no SUAS?'] },

    { id: 'paif-psicologia', cat: 'Equipe e registro',
      keys: ['psicologia no paif', 'papel da psicologia no paif', 'psicologo no paif', 'psicologa no paif', 'o que o psicologo faz no paif', 'atuacao do psicologo no paif', 'atribuicoes do psicologo no paif', 'psicologo e o paf', 'a psicologia no paf', 'paif+psicologia', 'paif+psicologo', 'paif+psicologa', 'paf+psicologo', 'paf+psicologia'],
      text: 'O psicólogo ou a psicóloga do CRAS participa da **escuta qualificada**, da leitura da **dinâmica e dos vínculos** familiares e comunitários, da **construção do plano com a família** e da condução de **grupos e oficinas**, em trabalho **interdisciplinar** com o serviço social.\nO PAIF **não tem caráter terapêutico**: sofrimento psíquico que pede cuidado clínico é articulado com a rede de saúde (UBS, CAPS), sem psicoterapia no CRAS. Parecer sobre um caso é da equipe e fica dentro do **sigilo e do Código de Ética**; o plano é construído com a família, não decidido pela técnica.',
      base: 'Referências Técnicas do CREPOP/CFP para atuação no CRAS (2021); Orientações Técnicas sobre o PAIF (MDS).',
      actions: [{ label: 'Ver CAPS', search: 'CAPS' }], follow: ['Posso fazer psicoterapia no SUAS?', 'Quando encaminhar para a saúde?'] },

    { id: 'paif-x-paefi', cat: 'Articulação',
      keys: ['paif e paefi', 'paif x paefi', 'diferenca entre paif e paefi', 'diferenca do paif e paefi', 'paif ou paefi', 'paf e paefi', 'quando encaminhar para o creas', 'quando encaminhar ao creas', 'quando passar para o paefi', 'contrarreferencia', 'referencia e contrarreferencia', 'paif+paefi', 'paif+creas', 'paf+creas', 'paf+paefi'],
      text: '- **PAIF** (CRAS, proteção social básica): **prevenir** e fortalecer vínculos e ampliar acessos; o plano é o **PAF**.\n- **PAEFI** (CREAS, proteção social especial): acompanhamento **especializado** de famílias e pessoas com **direitos violados** (violência, abuso, exploração, trabalho infantil), com plano próprio.\nSe há **violação de direitos**, a família é encaminhada ao CREAS/PAEFI; o retorno ao território se dá pela **contrarreferência**. O CRAS pode continuar articulado com a família durante o acompanhamento no CREAS, **sem duplicar o plano**.\nNão confunda o PAF com o plano individual de atendimento do **acolhimento** de crianças e adolescentes, que é de outro serviço. Os fluxos devem prever acesso, unidade de referência, registro com sigilo e avaliação (trilhas do MDS).',
      base: 'Orientações Técnicas sobre o PAIF (MDS); Trilhas do PAIF (MDS, 2024 e 2026); Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009).',
      actions: [{ label: 'Ver CRAS e CREAS', cat: 'social' }], follow: ['O que é o PAEFI?', 'Como funciona o Conselho Tutelar?'] },

    { id: 'paif-x-scfv', cat: 'Articulação',
      keys: ['paif e scfv', 'paif x scfv', 'diferenca entre paif e scfv', 'diferenca do paif e scfv', 'paif ou scfv', 'paif e convivencia', 'paif e servico de convivencia', 'scfv e paif', 'scfv complementa o paif', 'paif+scfv', 'paif+convivencia'],
      text: '- **PAIF:** trabalho social **com a família**, de caráter continuado, no CRAS. É o serviço **central** da proteção social básica.\n- **SCFV:** serviço **em grupos**, organizado em percursos por **ciclo de vida** (crianças, adolescentes, jovens, adultos, idosos), que **complementa** o trabalho social com famílias do PAIF e previne riscos.\nPela Tipificação, os serviços da proteção social básica no território, **em especial o SCFV**, devem ser **referenciados ao CRAS** e articulados ao PAIF. É a partir do trabalho do PAIF que se organizam os serviços referenciados. Crianças de até 6 anos podem ser incluídas no SCFV (trilha do MDS).',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, referenciamento; SCFV); Trilhas do PAIF (MDS, 2024 e 2026).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['O que é o SCFV?', 'O que é matricialidade sociofamiliar?'] },

    { id: 'paif-bolsa-familia', cat: 'Articulação',
      keys: ['paif e bolsa familia', 'bolsa familia no paif', 'paif e condicionalidades', 'condicionalidades e paif', 'familia em descumprimento no paif', 'descumprimento de condicionalidades no paif', 'interrupcao temporaria dos efeitos', 'interrupcao dos efeitos no sicon', 'paif+bolsa', 'paif+condicionalidades', 'paif+condicionalidade', 'paif+sicon', 'paif+descumprimento', 'paif+pbf'],
      text: 'Como o PAIF se liga ao Bolsa Família (trilha do MDS de 2024 e Portaria MDS 1.058/2025):\n- Famílias do Bolsa Família, **sobretudo em descumprimento de condicionalidades**, têm **atenção prioritária**; a busca ativa deve priorizar as ainda **não inseridas no PAIF**.\n- Em **todas as fases de repercussão** (alerta, bloqueio, suspensão) o **trabalho social deve ser oferecido**.\n- A participação no PAIF é **voluntária** e **não pode ser imposta como condicionalidade**.\n- Famílias incluídas no **Trabalho Social com Famílias e Territórios** podem ter os **efeitos interrompidos temporariamente** (art. 22 da Portaria), o que se ativa no **Sicon**; o técnico de nível superior pode decidir pela interrupção, registrando no Sicon.\n- Acolha sem culpabilizar: a comunicação vexatória é vedada (art. 34).\nA Tipificação inclui entre as aquisições a **redução do descumprimento de condicionalidades**.',
      base: 'Trilhas do PAIF (MDS, 2024 e 2026); Portaria MDS 1.058/2025, arts. 22 e 34; Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009).',
      actions: [], follow: ['Como atender família em descumprimento no CRAS?', 'PAIF e BPC'] },

    { id: 'paif-bpc', cat: 'Articulação',
      keys: ['paif e bpc', 'bpc no paif', 'familia com beneficiario do bpc no paif', 'beneficiario do bpc no paif', 'paif+bpc', 'bpc+paif', 'paif e beneficio de prestacao continuada'],
      text: 'Famílias **com beneficiários do BPC** estão entre as condições de acesso destacadas pela Tipificação ao PAIF, e o **cadastro de beneficiários do BPC** é uma das bases de dados do serviço.\nNas Orientações Técnicas, a **acolhida no domicílio** (com consentimento) é indicada, por exemplo, para **crianças e adolescentes com deficiência, beneficiários do BPC e fora da escola**.\nNa NOB-SUAS (art. 17, XIV), cabe aos municípios a **gestão local do BPC**, garantindo aos beneficiários e famílias o acesso aos serviços da rede socioassistencial.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009); Orientações Técnicas sobre o PAIF (MDS); NOB-SUAS/2012, art. 17, XIV.',
      actions: [], follow: ['Quem tem direito ao BPC?'] },

    { id: 'paif-matricialidade', cat: 'Articulação',
      keys: ['matricialidade sociofamiliar', 'o que e matricialidade sociofamiliar', 'matricialidade', 'familismo', 'o que e familismo', 'como o paif evita culpar a familia', 'paif culpabiliza a familia', 'centralidade na familia', 'paif+matricialidade', 'paif+familismo', 'paif+culpabilizar', 'paif+culpar'],
      text: 'Pela PNAS, a **família é o núcleo central** dos serviços e benefícios (**matricialidade sociofamiliar**), mas a capacidade de proteger depende do **acesso a políticas públicas**: o Estado deve **apoiar** a família, não **penalizá-la** por suas dificuldades.\nA trilha do MDS alerta que a centralidade na família **não pode virar centralidade na mulher** nem **intervenção punitiva**, e recomenda olhar para **raça, gênero, renda e local de vivência**.\nPara a Tipificação, é a partir do trabalho do PAIF que se organizam os serviços referenciados ao CRAS, rompendo com o atendimento segmentado e descontextualizado.\n**Familismo** é pôr sobre a família o que é dever do Estado.',
      base: 'Trilhas do PAIF (MDS, 2024 e 2026); Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, matricialidade sociofamiliar).',
      actions: [], follow: ['Quais são os erros comuns do PAF?', 'O que é o trabalho social com famílias e territórios?'] },

    { id: 'paif-tsft', cat: 'Articulação',
      keys: ['trabalho social com familias e territorios', 'tsft', 'o que e tsft', 'trabalho social com familias e territorios no paif', 'trilhas do paif', 'trilha do paif', 'o que sao as trilhas do paif', 'colecao trilhas do paif', 'paif+territorios', 'paif+territorio', 'paif+trilhas', 'paif+trilha'],
      text: 'O **Trabalho Social com Famílias e Territórios (TSFT)** é o modo como as trilhas atuais do MDS (2024 e 2026) descrevem o trabalho do PAIF: olha também o **território como espaço de vida, pertencimento e relações**, não só como área de abrangência do CRAS.\nDeve reconhecer as famílias como **sujeitos de direitos** e romper com práticas **compensatórias, emergenciais e reativas**; é **proativo, preventivo** e com foco no **coletivo**. A trilha orienta preferir ações coletivas e valorizar saberes e práticas de cuidado não violentas, incentivando a participação de **homens e pais**.\nO TSFT articula PAIF, SCFV, SPSBD-GC, Bolsa Família, BPC, benefícios eventuais e as políticas de saúde, educação e demais setores.',
      base: 'Trilhas do PAIF (MDS, 2024 e 2026) (resumo de partes, não é o texto literal).',
      actions: [], follow: ['O que são ações comunitárias?', 'Como o PAIF atende famílias do Bolsa Família?'] },

    { id: 'paif-rede', cat: 'Articulação',
      keys: ['paif em rede', 'articulacao em rede do paif', 'intersetorialidade no paif', 'trabalho em rede no paif', 'rede do paif', 'com quem o paif se articula', 'paif+rede', 'paif+intersetorialidade', 'paif+intersetorial', 'paif+articulacao'],
      text: 'A Tipificação prevê que o PAIF se articule com:\n- serviços socioassistenciais da proteção social **básica e especial**;\n- serviços públicos locais de **educação, saúde, trabalho, cultura, esporte, segurança pública** e outros;\n- **conselhos** de políticas públicas e de defesa de direitos;\n- instituições de ensino e pesquisa; serviços de enfrentamento à pobreza; programas de **inclusão produtiva**;\n- **redes sociais locais**: associações de moradores, ONGs etc.\nAs trilhas do MDS lembram que o trabalho em rede **não é automático**: exige governança intersetorial, diagnóstico integrado, **fluxos pactuados de referência e contrarreferência**, comunicação com proteção de dados e formação das equipes.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, articulação em rede); Trilhas do PAIF (MDS, 2024 e 2026).',
      actions: [], follow: ['Qual a diferença entre PAIF e PAEFI?'] },

    { id: 'paif-vigilancia', cat: 'Articulação',
      keys: ['vigilancia socioassistencial no paif', 'paif e vigilancia socioassistencial', 'cadunico no paif', 'cadastro unico no paif', 'paif e cadunico', 'paif e cadastro unico', 'diagnostico socioterritorial do paif', 'paif+vigilancia', 'paif+cadunico', 'paif+ivcad', 'paif+diagnostico'],
      text: 'A **vigilância socioassistencial** identifica vulnerabilidades, riscos e **vazios protetivos** que afetam a capacidade protetiva das famílias; a NOB-SUAS (art. 12, XIX) é responsabilidade comum dos entes estruturá-la. O município organiza a oferta de forma **territorializada**, conforme o **diagnóstico socioterritorial** (art. 17, IX).\nO **Cadastro Único** é o principal instrumento para identificar a vulnerabilidade social. As trilhas citam o **Observatório do Cadastro Único, o Sicon e o IVCAD** como ferramentas.\nNo PAIF, esses dados orientam a **busca ativa** e a prioridade do acompanhamento.',
      base: 'Trilhas do PAIF (MDS, 2024 e 2026); NOB-SUAS/2012, art. 12, XIX e art. 17, IX.',
      actions: [], follow: ['O que é busca ativa?'] },

    { id: 'paif-baixa-densidade', cat: 'Território',
      keys: ['paif em territorio de baixa densidade', 'territorio de baixa densidade', 'baixa densidade demografica', 'equipes volantes', 'equipe volante', 'cras itinerante', 'paif em area rural', 'paif em comunidade indigena', 'paif em comunidades indigenas', 'paif na zona rural', 'paif+volante', 'paif+itinerante', 'paif+rural', 'paif+indigenas', 'paif+ribeirinhas', 'paif+quilombolas'],
      text: 'A Tipificação prevê que famílias em **territórios de baixa densidade demográfica**, com espalhamento ou dispersão populacional (**áreas rurais, comunidades indígenas, quilombolas, calhas de rios, assentamentos** etc.), sejam atendidas por **equipes volantes** ou por **CRAS itinerantes**.\nPara a busca ativa, as trilhas do MDS lembram que equipes volantes atendem e cadastram nas comunidades, **inclusive de barco na Amazônia Legal**.\nCom famílias indígenas, o respeito à organização social, à língua e à forma de decidir é parte do trabalho (veja também a orientação técnica do MDS sobre trabalho social com famílias indígenas).',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, territórios de baixa densidade); Trilhas do PAIF (MDS, 2024 e 2026).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['Como funciona o PAF com famílias migrantes e indígenas?'] },

    { id: 'paif-migrantes-indigenas', cat: 'Território',
      keys: ['paif+indigenas', 'paif+indigena', 'paif+migrante', 'paf com familias migrantes', 'paf com familias indigenas', 'paif com migrantes', 'paif com venezuelanos', 'paif com indigenas', 'paif com familias migrantes', 'paif com familias indigenas', 'acompanhamento familiar com migrantes', 'acompanhamento familiar com indigenas', 'paif e operacao acolhida', 'paf+migrantes', 'paf+indigenas', 'paif+migrantes', 'paif+venezuelanos', 'paif+imigrantes'],
      text: 'Orientações práticas para Boa Vista e Roraima (prática sugerida, construída com a família):\n- **Famílias migrantes** (inclusive em abrigos da Operação Acolhida): acolher **sem exigir comprovação migratória prévia**, cuidar da barreira do **idioma** e do luto migratório, mapear a situação documental (RNM, protocolo de refúgio, CPF) e acionar a rede específica (ACNUR, OIM, Pastoral do Migrante, quando houver).\n- **Famílias indígenas:** respeitar a organização social, a língua e a forma de decidir; contar com **intérprete ou liderança** quando a família quiser; articular com a saúde indígena (SESAI) e a FUNAI; **não impor modelo de família**.\nEm ambos os casos, meta e estratégia são construídas com a família, no ritmo e com os recursos dela.',
      base: 'Guia de PAF do Paulus (prática sugerida, não é norma); Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (diversidade).',
      actions: [], follow: ['Como funciona o PAIF em território de baixa densidade?'] },

    { id: 'paif-boa-vista', cat: 'Território',
      keys: ['paif em boa vista', 'paif coletivo em boa vista', 'atendimento coletivo do paif', 'paif coletivo no censo suas', 'quantas pessoas no paif coletivo', 'paif coletivo roraima', 'paif+boa+vista', 'paif+roraima', 'paif+censo', 'paif+coletivo', 'paif+cras+boa+vista'],
      text: 'Pelo **Censo SUAS 2025** (dados declarados pelos municípios, não medem a adequação da estrutura):\n- **Atendimento coletivo do PAIF:** 8.623 pessoas em Roraima, das quais **5.749 em Boa Vista**.\n- **Por CRAS de Boa Vista:** União 1.144; Nova Cidade 1.078; Itinerante 991; Cauamé 852; Cristiana Vicente Nunes 720; Pintolândia 674; São Francisco 264; Dr. Sílvio Leite 26.\n- **Psicólogos nos CRAS de Boa Vista:** 19 registros; o serviço principal é o PAIF para 14.\nSão indicadores de 2025 da planilha de resumo: não são estimativas populacionais nem o total de famílias acompanhadas.',
      base: 'Censo SUAS 2025 (MDS), planilhas de CRAS e RH de Roraima (assets/conhecimento.json).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['Quantos psicólogos há nos CRAS de Boa Vista?'] },

    { id: 'paif-glossario', cat: 'Glossário',
      keys: ['glossario do paif', 'glossario do acompanhamento familiar', 'siglas do paif', 'significado de acolhida', 'o que e referencia e contrarreferencia', 'o que e mediacao', 'o que e readequacao', 'termos do paif', 'vocabulario do paif', 'paif+glossario', 'paif+siglas', 'paif+termos'],
      text: 'Glossário rápido do PAIF:\n- **Acolhida:** escuta qualificada da demanda.\n- **Estudo social:** leitura da situação da família e do território.\n- **Acompanhamento familiar:** intervenção continuada com a família, com PAF.\n- **PAF:** plano construído com a família, com prazos e data de retorno.\n- **Compromisso:** pactuação do que cada parte fará (família, serviço, rede).\n- **Mediação:** presença do profissional ao longo do percurso.\n- **Readequação:** ajuste do plano quando a meta não é alcançada ou a situação muda.\n- **Busca ativa:** procura de famílias e situações no território.\n- **Referência e contrarreferência:** encaminhamento e retorno da família ao serviço de origem.\n- **Prontuário:** registro do trabalho social com a família.\n- **TSFT:** Trabalho Social com Famílias e Territórios.',
      base: 'Guia de acompanhamento familiar do PAIF; Orientações Técnicas sobre o PAIF (MDS); Trilhas do PAIF (MDS, 2024 e 2026).',
      actions: [], follow: ['O que é o PAIF?', 'O que é o PAF?'] },

    { id: 'paif-cuidadores', cat: 'O serviço',
      keys: ['paif com cuidadores', 'familias com pessoas que precisam de cuidado', 'paif e cuidado', 'apoio a cuidadora', 'apoio a cuidador', 'cuidadora de idoso no paif', 'familia com idoso no paif', 'familia com pessoa com deficiencia no paif', 'paif+cuidadores', 'paif+cuidadora', 'paif+cuidador', 'paif+cuidado', 'paif+cuidados', 'paif+idoso', 'paif+idosos', 'paif+deficiencia'],
      text: 'O PAIF tem um objetivo próprio para **famílias que têm membros que precisam de cuidado**: promover **espaços coletivos de escuta e troca de vivências**, com foco na troca de informações sobre primeira infância, adolescência, juventude, **envelhecimento e deficiências**, para expressar dificuldades, trocar experiências e reconhecer possibilidades.\nO público do PAIF inclui **pessoas idosas e pessoas com deficiência** em vulnerabilidade e risco social. No PAF, o apoio à cuidadora e a articulação com saúde, SCFV e serviço no domicílio são estratégias possíveis (prática sugerida).\nAs trilhas do MDS lembram que a centralidade na família não pode virar **sobrecarga da mulher**: incentive a participação de homens e pais nos espaços de cuidado.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, descrição e objetivos); Trilhas do PAIF (MDS, 2024 e 2026); guia de PAF (prática sugerida).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['Quem é atendido no PAIF?', 'O que são oficinas com famílias?'] },

    { id: 'paif-escola', cat: 'Articulação',
      keys: ['crianca fora da escola', 'criancas fora da escola', 'adolescente fora da escola', 'adolescentes fora da escola', 'paif e escola', 'paif e evasao escolar', 'baixa frequencia escolar', 'o que o cras faz com crianca fora da escola', 'paif+escola', 'paif+escolar', 'paif+evasao', 'paif+frequencia', 'paf+escola'],
      text: 'Criança ou adolescente **fora da escola** ou com baixa frequência, no PAIF:\n- **Escute os motivos** (transporte, documento, cuidado, trabalho, desinteresse, barreiras da escola) e **articule com a escola** e a busca ativa escolar; o plano pode incluir isso como compromisso do serviço e da rede (prática sugerida).\n- A **acolhida no domicílio**, com consentimento, é indicada para crianças e adolescentes com deficiência, beneficiários do BPC e fora da escola (Orientações Técnicas).\n- O guia de acompanhamento sugere **grupo de famílias de adolescentes fora da escola**.\n- No Bolsa Família, o MDS orienta **matricular de imediato** crianças e adolescentes fora da escola, manter a **escola e a série atualizadas no CadÚnico** e orientar a família a avisar a escola de que recebe o benefício (Informe nº 94/2025).\nO objetivo é garantir o direito, não punir a família.',
      base: 'Orientações Técnicas sobre o PAIF (MDS); guia de acompanhamento familiar do PAIF; Informe Bolsa Família nº 94/2025 (MDS).',
      actions: [], follow: ['PAIF e Bolsa Família', 'Como funcionam os grupos de famílias?'] },

    { id: 'paif-diversidade', cat: 'O serviço',
      keys: ['paif e diversidade', 'arranjos familiares no paif', 'tipos de familia no paif', 'o que e familia para o paif', 'conceito de familia no paif', 'cultura do dialogo no paif', 'paif e preconceito', 'paif+diversidade', 'paif+arranjos', 'paif+preconceito', 'paif+discriminacao', 'paif+valores'],
      text: 'Segundo a Tipificação, o PAIF é baseado no **respeito à heterogeneidade dos arranjos familiares**, aos **valores, crenças e identidades** das famílias.\nFundamenta-se no fortalecimento da **cultura do diálogo** e no **combate a todas as formas de violência, preconceito, discriminação e estigmatização** nas relações familiares.\nNa prática: nada de modelo único de família, descrição sem rótulos e plano construído com a família (as trilhas do MDS pedem olhar para **raça, gênero, renda e local de vivência**).',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, descrição); Trilhas do PAIF (MDS, 2024 e 2026).',
      actions: [], follow: ['O que é matricialidade sociofamiliar?', 'Quais são os erros comuns do PAF?'] },

    { id: 'paif-gratuidade', cat: 'O serviço',
      keys: ['paif e gratuito', 'o paif e gratuito', 'paif pode ser privado', 'paif pode ser ofertado por ong', 'quem pode ofertar o paif', 'quem oferta o paif', 'paif e estatal', 'paif pode ser terceirizado', 'universalidade do paif', 'paif+gratuito', 'paif+gratuidade', 'paif+estatal', 'paif+ong', 'paif+terceirizado', 'paif+universalidade'],
      text: 'Pela Tipificação, o PAIF tem como princípios norteadores a **universalidade e a gratuidade** do atendimento, e a sua implementação cabe **exclusivamente à esfera estatal**. É ofertado **necessariamente no CRAS**.\nOu seja: não se cobra da família e não é serviço de entidade privada; as entidades podem ofertar outros serviços da proteção social básica, que devem ser **referenciados ao CRAS** e articulados ao PAIF. **Universalidade** quer dizer que toda família do território pode ser atendida; a prioridade só organiza a ordem do trabalho.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, descrição); LOAS, art. 6º-C.',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['Qual a diferença entre PAIF e SCFV?', 'Quem é atendido no PAIF?'] },

    { id: 'paif-referenciamento', cat: 'Articulação',
      keys: ['o que e referenciar ao cras', 'o que e referenciar', 'referenciar+cras', 'referenciar+servico', 'referenciamento ao cras', 'servicos referenciados ao cras', 'o que significa referenciar ao cras', 'referenciar servico ao cras', 'organizacao da rede no territorio', 'paif organiza os servicos do territorio', 'paif+referenciamento', 'paif+referenciados', 'paif+referenciado', 'cras+referenciados'],
      text: 'Pela Tipificação, **todos os serviços da proteção social básica** desenvolvidos no território do CRAS, **em especial o SCFV** e o serviço de proteção social básica no domicílio para pessoas com deficiência e idosas, devem ser **referenciados ao CRAS** e manter **articulação com o PAIF**.\nÉ a partir do trabalho com famílias no PAIF que se organizam os serviços referenciados. Isso **organiza e hierarquiza a rede** no território (descentralização) e permite trabalhar a família como um todo, **rompendo com o atendimento segmentado e descontextualizado** das vulnerabilidades.\nPor lei, o CRAS articula os serviços socioassistenciais do seu território de abrangência (LOAS, art. 6º-C, § 1º).',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, referenciamento dos serviços ao CRAS); LOAS, art. 6º-C.',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['Qual a diferença entre PAIF e SCFV?', 'O que é matricialidade sociofamiliar?'] },

    { id: 'paif-spsbd-gc', cat: 'Articulação',
      keys: ['spsbd gc', 'spsbd-gc', 'o que e o spsbd', 'servico de protecao social basica no domicilio para gestantes e criancas', 'novo servico no lugar do crianca feliz', 'substituicao do crianca feliz', 'o que substitui o crianca feliz', 'crianca feliz acaba', 'fim do crianca feliz', 'resolucao cit 30 2025', 'paif+spsbd', 'paif+criancafeliz', 'spsbd+gestantes'],
      text: 'Segundo a **trilha do MDS de 2026**, a **Resolução CIT nº 30/2025** dá à **visita domiciliar** papel estruturante na proteção social básica por meio do **Serviço de Proteção Social Básica no Domicílio para Gestantes e Crianças (SPSBD-GC)**, com início em **1º de janeiro de 2027**, substituindo o **Programa Criança Feliz**.\nO serviço entra no conjunto articulado pelo Trabalho Social com Famílias e Territórios (PAIF, SCFV, SPSBD-GC, Bolsa Família, BPC, benefícios eventuais e políticas setoriais).\nÉ informação de trilha de capacitação, não o texto da resolução: **confira a nomenclatura e as regras no texto oficial** e o que o seu município definiu. A visita no PAIF continua exigindo **consentimento** e sem caráter fiscalizatório.',
      base: 'Trilhas do PAIF (MDS, 2024 e 2026) (resumo de parte da trilha de 2026; confira a Resolução CIT nº 30/2025).',
      actions: [], follow: ['Como é a visita domiciliar?', 'O que é o trabalho social com famílias e territórios?'] },

    { id: 'paif-documentacao', cat: 'Ações do PAIF',
      keys: ['paif e documentacao', 'documentacao civil no paif', 'familia sem documento', 'familia sem certidao', 'acesso a documentacao pessoal', 'promover acesso a documentos', 'meta de documentacao civil', 'paif+documentacao', 'paif+documentos', 'paif+certidao', 'paif+documento', 'paf+documentacao', 'paf+certidao'],
      text: 'A **promoção do acesso à documentação pessoal** faz parte do trabalho social essencial do PAIF, e o **acesso à documentação civil** está entre as aquisições esperadas dos usuários (Tipificação).\nNo PAF, uma meta típica (prática sugerida) é emitir certidão ou RG de quem não tem: **orientar o passo a passo**, acompanhar o agendamento e **articular com o serviço emissor**.\nCom famílias migrantes, mapeie a situação documental (RNM, protocolo de refúgio, CPF) e acolha **sem exigir comprovação migratória prévia**.\nDocumento faltando pode travar benefício e matrícula: trate como **meta de curto prazo** e compromisso do serviço e da rede, não só da família.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, trabalho social essencial e aquisições); guia de PAF (prática sugerida).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['Como escrever boas metas no PAF?', 'Como funciona o PAF com famílias migrantes e indígenas?'] },

    { id: 'paif-campanhas', cat: 'Ações do PAIF',
      keys: ['campanhas socioeducativas', 'campanha socioeducativa', 'campanhas do paif', 'informacao comunicacao e defesa de direitos', 'defesa de direitos no paif', 'mobilizacao para a cidadania', 'mobilizacao de redes sociais de apoio', 'redes sociais de apoio', 'paif+campanhas', 'paif+campanha', 'paif+cidadania', 'paif+mobilizacao', 'paif+direitos'],
      text: 'Entre as ações de trabalho social essencial do PAIF (Tipificação) estão as **campanhas socioeducativas**; **informação, comunicação e defesa de direitos**; **mobilização para a cidadania**; **mobilização e fortalecimento de redes sociais de apoio**; e o desenvolvimento do **convívio familiar e comunitário**.\nNas Orientações Técnicas, isso se concretiza em **ações comunitárias** (palestras, campanhas, eventos), que enfrentam problemas coletivos do território (violência, trabalho infantil, falta de transporte, acessibilidade, lazer e cultura) e fortalecem a **participação social**.\nA trilha do MDS pede que essas ações **reconheçam as famílias como sujeitos de direitos** e ajudem a organizar a defesa coletiva de direitos.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF, trabalho social essencial); Orientações Técnicas sobre o PAIF (MDS); Trilhas do PAIF (MDS, 2024 e 2026).',
      actions: [], follow: ['O que são ações comunitárias?', 'Qual o trabalho social essencial do PAIF?'] },

    { id: 'paif-notificacao', cat: 'Articulação',
      keys: ['descobri+violencia', 'violencia+familia+acompanhada', 'violencia+acompanhamento+familiar', 'violencia+durante+acompanhamento', 'notificacao de vulnerabilidade e risco', 'notificar situacao de risco no paif', 'notificacao no paif', 'notificar o creas', 'o que fazer se descobrir violencia no paif', 'violencia descoberta no acompanhamento', 'suspeita de violencia no paif', 'identifiquei violencia na familia acompanhada', 'paif+notificacao', 'paif+notificar', 'paif+violencia', 'paif+abuso', 'paf+violencia'],
      text: 'A **notificação da ocorrência de situações de vulnerabilidade e risco social** faz parte do trabalho social essencial do PAIF (Tipificação).\nSe, no acompanhamento, aparecer **violação de direitos** (violência, abuso, exploração, trabalho infantil), a situação **sai do alcance do PAIF**: a família é **encaminhada ao CREAS/PAEFI**, que acompanha com plano próprio. O CRAS pode seguir articulado, **sem duplicar o plano**, e a família volta ao território pela **contrarreferência**.\nRegistre o que foi dito e feito com **fatos e sigilo profissional**, e acione também a rede de proteção quando a lei exigir (Conselho Tutelar, em caso de criança ou adolescente). Se houver **risco imediato**, não espere o fluxo: acione os serviços de urgência.',
      base: 'Tipificação Nacional de Serviços Socioassistenciais (Res. CNAS 109/2009) (PAIF); Trilhas do PAIF (MDS, 2024 e 2026) (encaminhamento e contrarreferência); guia de PAF.',
      actions: [{ label: 'Ver CRAS e CREAS', cat: 'social' }, { label: 'Ver Saúde/Urgência', cat: 'hospitalar' }], follow: ['Qual a diferença entre PAIF e PAEFI?', 'Como funciona o Conselho Tutelar?'] }
  ];
  PAIF_BASE.forEach(function (e) { e.paif = true; });
  // ---------------------------------------------------------------------
  // BASE DO CADASTRO ÚNICO (CadÚnico): verbetes por tema, na mesma forma do PAIF_BASE (keys, text, base = norma citada).
  // Responde na hora, sem internet e sem IA, e vai à IA como "baseApp" quando a pergunta é sobre o CadÚnico.
  // Fontes conferidas em nov/2026: Decreto 11.016/2022; Lei 15.077/2024; Portaria MDS 1.145/2025 (alterada pela 1.199/2026);
  // IN SAGICAD/MDS 20/2026 (alterada pela 22/2026); IN Conjunta 2/2026 (Averiguação e Revisão, ed. ago/2026);
  // Informe do Cadastro Único 95 (08/06/2026); Cartilha "Noções básicas do Cadastro Único" (MDS).
  // Prazos e cronogramas do CadÚnico mudam várias vezes por ano: cada verbete diz a norma, e a nota da resposta manda conferir.
  // Para ajustar: edite o verbete (id cad-*). Chaves com "cadunico" já valem para "cadastro unico" e "cad unico" (ver expansão abaixo).
  // Testes: npm run test:cadunico
  // ---------------------------------------------------------------------
  var CAD_REV = 'nov/2026';
  var CAD_BASE = [
    { id: 'cad-o-que-e', cat: 'O que é',
      keys: ['o que e o cadunico', 'o que e cadunico', 'para que serve o cadunico', 'cadunico+serve', 'cadunico+significa', 'cadunico+sigla', 'explique o cadunico', 'cadunico+resumo'],
      text: 'O **Cadastro Único para Programas Sociais (CadÚnico)** é o instrumento que **identifica e caracteriza as famílias de baixa renda**: quem mora na casa, a renda, o trabalho, a escolaridade e as condições do domicílio.\n- É a **porta de entrada** de programas como Bolsa Família, BPC e Tarifa Social: cada programa usa os dados para selecionar quem atende.\n- Também orienta o **diagnóstico do território** (vigilância socioassistencial) e o planejamento do CRAS.\n- A gestão nacional é do **MDS**; o cadastramento é feito pelos **municípios que aderiram**, no CRAS ou em posto de atendimento.\n- Estar no cadastro **não garante** benefício: cada programa tem a própria regra.',
      base: 'Decreto 11.016/2022 (arts. 2º, 6º e 7º); Cartilha Noções básicas do Cadastro Único (MDS).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['Quem pode se cadastrar no CadÚnico?', 'Quais documentos levar para o CadÚnico?', 'Quais programas usam o CadÚnico?'] },

    { id: 'cad-quem-deve', cat: 'Quem se cadastra',
      keys: ['renda para entrar no cadunico', 'renda maxima do cadunico', 'limite de renda do cadunico', 'quem pode fazer o cadunico', 'quem pode se cadastrar no cadunico', 'quem deve se cadastrar no cadunico', 'quem tem direito ao cadunico', 'quem pode se inscrever no cadunico', 'quem pode entrar no cadunico', 'cadunico+renda+limite', 'cadunico+meio+salario', 'cadunico+renda+per+capita', 'renda para o cadunico', 'cadunico+quem+pode', 'cadunico+baixa+renda', 'familia de baixa renda'],
      text: 'Pelo decreto, **família de baixa renda** é a que tem **renda mensal por pessoa de até meio salário mínimo** (art. 5º, II). Essa é a regra para entrar no cadastro.\n- Famílias com **renda maior** podem ser incluídas quando forem **vinculadas à seleção de um programa social** cujo órgão tenha firmado termo de uso (art. 5º, parágrafo único, e art. 11).\n- **Não precisa ter parentesco**: família é quem mora no mesmo domicílio e contribui para a renda ou tem as despesas atendidas por ela.\n- **Quem mora sozinho** também se cadastra (família unipessoal).\n- Para calcular, use o cartão **Renda per capita** da aba Ferramentas. Cada programa (Bolsa Família, BPC, Tarifa Social) tem o **seu próprio limite de renda**.',
      base: 'Decreto 11.016/2022 (art. 5º, I e II, e parágrafo único; art. 11); Cartilha Noções básicas do Cadastro Único (MDS).',
      actions: [{ label: 'Abrir Ferramentas', cat: 'ferramentas' }, { label: 'Ver CRAS', cat: 'social' }], follow: ['Quem é o responsável familiar no CadÚnico?', 'Quais programas usam o CadÚnico?'] },

    { id: 'cad-familia-responsavel', cat: 'Família e responsável',
      keys: ['quem e o responsavel familiar', 'responsavel familiar no cadunico', 'responsavel familiar do cadunico', 'conceito de familia no cadunico', 'o que e familia no cadunico', 'o que e domicilio no cadunico', 'cadunico+responsavel', 'cadunico+representante+legal', 'cadunico+domicilio', 'quem pode ser responsavel familiar', 'responsavel familiar+16+anos', 'responsavel familiar+representante+legal'],
      text: 'No CadÚnico:\n- **Família:** unidade composta por uma ou mais pessoas que contribuem para o rendimento ou têm as despesas atendidas por ele; **domicílio** é o local que serve de moradia à família (Decreto, art. 5º).\n- **Responsável familiar (RF):** pessoa da família que **mora no domicílio**, com **16 anos ou mais**, de **preferência mulher**. É ele(a) quem comparece e declara os dados de todos. Pode ser qualquer pessoa de 16+ que more e divida renda e despesas com a família.\n- **Representante legal (RL):** na falta do RF, atua quem for legalmente designado (tutor, curador, guardião); **não precisa morar** no domicílio. Nos casos de tomada de decisão apoiada homologada, registra-se a opção de curatela no formulário (Informe 95).\nO RF responde pelas informações: orientar a família a declarar com precisão evita bloqueios depois.',
      base: 'Decreto 11.016/2022 (art. 5º, I, III e IV); Informe do Cadastro Único 95 (08/06/2026).',
      actions: [], follow: ['Quais documentos levar para o CadÚnico?', 'O que é família unipessoal no CadÚnico?'] },

    { id: 'cad-documentos', cat: 'Documentos',
      keys: ['documentos para o cadunico', 'documentos para fazer o cadunico', 'documentos para se cadastrar no cadunico', 'documentos para inscricao no cadunico', 'documentos para atualizar o cadunico', 'cadunico+documentos', 'cadunico+documento', 'o que levar para o cadunico', 'o que levar para fazer o cadunico', 'cadunico+levar', 'cadunico+comprovante+de+residencia', 'cadunico+comprovante+de+endereco', 'cadunico+cpf', 'cadunico+declaracao+de+residencia', 'que documentos o cadunico pede'],
      text: 'Para o cadastro, o **responsável familiar** leva:\n- **Documento com foto** (identidade ou carteira de trabalho);\n- **CPF**;\n- **Comprovante de residência**; se não tiver, pode fazer uma **declaração** informando onde mora.\nDas **demais pessoas** da família, leve **pelo menos um documento** de cada uma: **CPF** (o mais importante, levar sempre que tiver), certidão de nascimento ou de casamento, identidade, carteira de trabalho ou título de eleitor.\n- Na **Averiguação e na Revisão Cadastral de 2026**, a regularização pede o CPF do responsável e dos membros, documento com foto e comprovante de residência; **famílias unipessoais** levam documento com foto e **Termo de Responsabilidade**.\nQuem não tem algum documento não deve ser barrado na acolhida: o CRAS orienta como providenciar.',
      base: 'Cartilha Noções básicas do Cadastro Único (MDS); Decreto 11.016/2022 (art. 7º, IV, b: identificação e documentação civil de cada membro); IN Conjunta 2/2026 (Averiguação e Revisão, ed. ago/2026).',
      actions: [{ label: 'Ver Documentação Civil', cat: 'documentacao' }, { label: 'Ver CRAS', cat: 'social' }], follow: ['Como fazer o CadÚnico passo a passo?', 'Como funciona a entrevista do CadÚnico?'] },

    { id: 'cad-passo-a-passo', cat: 'Como fazer',
      keys: ['como fazer o cadunico', 'como faco o cadunico', 'como faco para fazer o cadunico', 'como faco para me cadastrar no cadunico', 'como me cadastro no cadunico', 'como fazer o cadastro no cadunico', 'como fazer cadunico', 'como me inscrever no cadunico', 'como se inscrever no cadunico', 'como se cadastrar no cadunico', 'como fazer a inscricao no cadunico', 'como entrar no cadunico', 'passo a passo do cadunico', 'cadunico+passo+a+passo', 'cadunico+inscricao', 'cadunico+inscrever'],
      text: 'Passo a passo da **inscrição** (o fluxo de agendamento varia por município; confirme no CRAS):\n1. O **responsável familiar** procura o **CRAS** ou o posto de atendimento do CadÚnico, com os documentos.\n2. Faz a **entrevista**: declara os dados de todas as pessoas da família (domicílio, renda, trabalho, escola). Em algumas situações a entrevista é **no domicílio** (veja "entrevista").\n3. A equipe **registra** os dados no sistema e emite o comprovante.\n4. A família **consulta** a situação pelo aplicativo ou site do Cadastro Único.\n5. A **seleção para benefícios** é feita por cada programa, com base no cadastro: entrar no CadÚnico não dá benefício automático.\n- **Atualize** a cada 2 anos ou quando algo mudar.\nO cadastro é **gratuito**: ninguém deve cobrar para fazê-lo.',
      base: 'Decreto 11.016/2022 (arts. 7º e 12); Cartilha Noções básicas do Cadastro Único (MDS).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['Quais documentos levar para o CadÚnico?', 'Como consultar o CadÚnico?'] },

    { id: 'cad-entrevista', cat: 'Entrevista',
      keys: ['entrevista do cadunico', 'entrevista no cadunico', 'cadunico+entrevista', 'entrevista domiciliar', 'cadastro domiciliar', 'cadastramento domiciliar', 'dispensa de entrevista', 'dispensa de entrevista domiciliar', 'visita do cadunico', 'cadunico+visita+domiciliar', 'cadunico+dispensa'],
      text: 'Na **entrevista**, o responsável familiar declara os dados de todos; o entrevistador registra no sistema. Em certos casos a entrevista é **no domicílio**.\nA **IN SAGICAD/MDS 20/2026** (alterada pela IN 22/2026, de 4/8/2026) **dispensa a entrevista domiciliar** quando a família está em:\n- área de **violência** ou localidade de **difícil acesso**;\n- município em **calamidade, emergência ou desastre**;\n- programa de **proteção** ou com **medida protetiva**;\n- **situação de rua**, **domicílio coletivo**;\n- família **indígena** ou **quilombola**, ou de outro **grupo popular tradicional e específico (GPTE)**.\nEssas famílias se cadastram nos **postos** ou em **mutirões** da gestão local; o município registra a situação no campo próprio e **guarda relatório circunstanciado** (5 anos, segundo a IN Conjunta 2/2026). Os programas observam esse registro.\nSobre **família unipessoal**, veja o verbete próprio: o cronograma mudou.',
      base: 'IN SAGICAD/MDS 20/2026, art. 1º, I a IX, e §3º (alterada pela IN 22/2026); IN Conjunta 2/2026 (ed. ago/2026).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['O que é família unipessoal no CadÚnico?', 'Como funciona o CadÚnico para indígenas e população em situação de rua?'] },

    { id: 'cad-unipessoal', cat: 'Entrevista',
      keys: ['familia unipessoal', 'familias unipessoais', 'unipessoal', 'unipessoais', 'cadunico+unipessoal', 'cadunico+mora+sozinho', 'cadunico+morar+sozinho', 'bpc+unipessoal', 'bolsa+familia+unipessoal', 'cadunico+uma+so+pessoa'],
      text: '**Família unipessoal** é a composta por **uma só pessoa**. Pela **Lei 15.077/2024** e pelo cronograma da **Portaria MDS 1.145/2025** (alterada pela **Portaria 1.199/2026**, de 15/7/2026):\n- a **entrevista no domicílio** passa a ser exigida, **a partir de 1º/7/2027**, nas atualizações de unipessoais do **Bolsa Família** e na inclusão e atualização de requerentes e beneficiários do **BPC**, com **exceções** definidas pelo MDS;\n- até lá, o MDS permite a **atualização presencial em posto** para unipessoais beneficiárias na Revisão Cadastral 2026.\nPela **IN 20/2026** (alterada pela 22/2026): unipessoal que **não** participa de programa federal de transferência de renda **não precisa** de cadastro domiciliar; se a renda está **no limite de elegibilidade**, a entrevista domiciliar é **obrigatória** (nos prazos da Portaria 1.145). As exceções (rua, indígena, quilombola, violência, difícil acesso etc.) continuam.\nEste cronograma **já mudou mais de uma vez**: confirme no Informe do Cadastro Único mais recente.',
      base: 'Lei 15.077/2024, art. 2º; Portaria MDS 1.145/2025, arts. 2º e 2º-A (redação da Portaria 1.199/2026); IN SAGICAD/MDS 20/2026, art. 1º, §§1º e 2º (alterada pela 22/2026).',
      actions: [], follow: ['Como funciona a entrevista do CadÚnico?', 'Como fica o BPC e o CadÚnico?'] },

    { id: 'cad-atualizacao', cat: 'Atualização',
      keys: ['atualizar o cadunico', 'atualizacao do cadunico', 'atualizacao cadastral', 'atualizar o cadastro unico', 'cadunico+atualizar', 'cadunico+atualizacao', 'cadunico+desatualizado', 'cadunico+prazo', 'quando atualizar o cadunico', 'de quanto em quanto tempo atualizar o cadunico', 'cadunico+dois+anos', 'validade do cadunico', 'cadunico+vence', 'cadunico+venceu'],
      text: 'O cadastro precisa ser **atualizado ou revalidado a cada 2 anos (24 meses)**, contados da inclusão ou da última atualização (Decreto, art. 12).\n- Atualize **antes**, sempre que algo mudar: **endereço, renda, trabalho, escola e quem mora na casa** (entrada ou saída de pessoas).\n- Quem atualiza é o **responsável familiar**, no CRAS ou posto, com os mesmos documentos.\n- **Cadastro desatualizado** pode levar ao **bloqueio e ao cancelamento** de benefícios (Bolsa Família, Tarifa Social, BPC).\n- Na Revisão Cadastral 2026, o cadastro **sem atualização por 48 meses** é **excluído** automaticamente.\nAtualizar **não é** abrir mão do benefício: é o que o mantém.',
      base: 'Decreto 11.016/2022, arts. 9º-A, 11-A e 12; IN Conjunta 2/2026 (Averiguação e Revisão, ed. ago/2026); Cartilha Noções básicas do Cadastro Único (MDS).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['O que é Averiguação e Revisão Cadastral?', 'O que acontece se não atualizar o cadastro?'] },

    { id: 'cad-averiguacao-revisao', cat: 'Atualização',
      keys: ['averiguacao cadastral', 'revisao cadastral', 'cadunico+averiguacao', 'cadunico+revisao', 'ave26', 'rev26', 'ave 2026', 'rev 2026', 'qualificacao do cadunico', 'acao de qualificacao do cadunico', 'acao de qualificacao cadastral', 'cadunico+convocacao', 'familia convocada no cadunico', 'cadunico+qualificacao', 'listas da averiguacao', 'listas da revisao', 'o que e averiguacao'],
      text: 'A **Ação de Qualificação do CadÚnico 2026** tem dois processos (IN Conjunta 2/2026, ed. ago/2026):\n- **Averiguação Cadastral (AVE26):** confere **inconsistências** (por exemplo, composição familiar ou renda divergente do CNIS). O público inicial reúne famílias **não beneficiárias** de Bolsa Família, BPC ou Tarifa Social, com renda de até meio salário mínimo per capita. A regularização exige entrevista domiciliar (com exceções).\n- **Revisão Cadastral (REV26):** atinge cadastros **sem atualização há mais de 24 meses** e os de beneficiários que ficariam desatualizados. São 16 públicos (15 de beneficiários, 1 de não beneficiários). A família regulariza **atualizando os dados depois da data de referência** do seu público.\nPapel do município e do CRAS: consultar **todo mês** as listas no **Portal de Gestão do Cadastro Único** ou no **SIGPBF** (e **salvar cópia**, pois só a última referência fica disponível), fazer as entrevistas e digitar antes do prazo, e orientar as famílias, que também recebem aviso por aplicativo, SMS, carta ou Caixa Tem.\nDúvidas dos técnicos: **Central 121** e chat do MDS para gestores.',
      base: 'IN Conjunta 2/2026 (Averiguação e Revisão, Anexo I, ed. ago/2026); Decreto 11.016/2022, art. 11-A.',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['O que acontece se não atualizar o cadastro?', 'Quais documentos levar para o CadÚnico?'] },

    { id: 'cad-bloqueio', cat: 'Atualização',
      keys: ['bloqueio por cadastro desatualizado', 'cadunico+bloqueio', 'cadunico+bloqueado', 'cadunico+cancelamento', 'cadunico+cancelado', 'cadunico+exclusao', 'cadunico+excluido', 'cadunico+exclusao+logica', 'exclusao logica', 'reversao de cancelamento', 'bolsa familia+cadastro+desatualizado', 'bolsa familia+bloqueado+cadastro', 'o que acontece se nao atualizar o cadastro', 'o que acontece se nao atualizar o cadunico', 'tarifa social+cadastro+desatualizado'],
      text: 'Se a família **não regulariza** o cadastro até a data-limite da Averiguação ou da Revisão (IN Conjunta 2/2026):\n- **Bolsa Família:** o benefício é **bloqueado por até 3 meses** após o prazo e, depois, **cancelado**. A **reversão** pode ser feita em até **6 meses** após o cancelamento; a **exclusão lógica** do cadastro **impede a reversão** e exige **novo cadastramento**. O município aplica o desbloqueio ou a reversão no **Sibec**, nos prazos do calendário do PBF.\n- **Tarifa Social de Energia:** o desconto é **cancelado**; para voltar, a família **solicita de novo à distribuidora**.\n- **BPC:** o INSS **notifica**; sem atualização, o valor é **bloqueado**, pode ser **suspenso** e, depois, **cessado**, com direito a **recurso**.\nNa averiguação (AVE26), a exclusão lógica ocorre se a família não regularizar até **12/8/2027**.\nNa prática: **busca ativa** das famílias listadas antes do prazo, com acolhida e orientação, sem culpabilizar.',
      base: 'IN Conjunta 2/2026 (Averiguação e Revisão, Anexo I, ed. ago/2026); Decreto 11.016/2022, art. 11-A.',
      actions: [{ label: 'Ver CRAS', cat: 'social' }, { label: 'Notícias do MDS', cat: 'noticias' }], follow: ['O que é Averiguação e Revisão Cadastral?', 'Como funciona o Bolsa Família?'] },

    { id: 'cad-bpc', cat: 'BPC',
      keys: ['bpc+cadunico', 'cadunico+bpc', 'bpc+cadastro+unico', 'bpc+inscricao+no+cadunico', 'bpc+atualizar+cadastro', 'formulario de impossibilidade', 'formulario de impossibilidade do bpc', 'bpc+representante+legal', 'bpc+responsavel+familiar', 'bpc+prazo+atualizacao', 'bpc+cadastro+desatualizado'],
      text: 'Pelo **Informe do Cadastro Único 95** (8/6/2026), com a **IN Conjunta SAGICAD/SNBA 1/2026**:\n- O **Formulário de Impossibilidade** foi **desativado em 13/5/2026**. Quem estava nele até 12/5/2026 precisa **se inscrever no CadÚnico até 31/12/2026**, sob risco de **indeferimento ou cessação** do BPC. Os registros podem ser consultados no **CECAD**.\n- **Busca ativa:** priorizar beneficiários do BPC que estavam no formulário e ainda não têm inscrição, e os cadastros desatualizados.\n- **RF x RL:** o responsável familiar mora e divide renda e despesas com o beneficiário; o representante legal (tutor, curador) **não precisa morar** na casa.\n- **Atualização a cada 24 meses:** o INSS notifica; o prazo para atualizar é de **45 dias** (municípios até 50 mil habitantes) ou **90 dias** (acima de 50 mil, caso de **Boa Vista**).\nFamília **unipessoal** no BPC: veja o verbete próprio (cronograma alterado pela Portaria 1.199/2026).',
      base: 'Informe do Cadastro Único 95 (08/06/2026); IN Conjunta SAGICAD/SNBA 1/2026; LOAS, art. 20 (BPC exige inscrição no CadÚnico).',
      actions: [{ label: 'Ver Previdência/INSS', cat: 'previdencia' }, { label: 'Ver CRAS', cat: 'social' }], follow: ['O que é família unipessoal no CadÚnico?', 'Quem tem direito ao BPC?'] },

    { id: 'cad-gpte', cat: 'Povos e grupos específicos',
      keys: ['grupos populacionais tradicionais e especificos', 'grupos tradicionais e especificos', 'gpte', 'cadunico+gpte', 'cadunico+indigena', 'cadunico+indigenas', 'cadunico+quilombola', 'cadunico+quilombolas', 'cadunico+situacao+de+rua', 'cadunico+ribeirinhos', 'cadunico+povos+tradicionais', 'cadunico+comunidades+tradicionais', 'cadunico+pessoa+em+situacao+de+rua', 'cadastrar indigenas no cadunico', 'cadastrar quilombolas no cadunico'],
      text: 'O decreto define **grupos populacionais tradicionais e específicos (GPTE)** como grupos, organizados ou não, com características **socioculturais, econômicas ou conjunturais** que pedem **estratégias diferenciadas de cadastramento** (art. 5º, V); os procedimentos são definidos pelo MDS (art. 7º, §6º).\n- **Indígenas, quilombolas, população em situação de rua**, domicílios coletivos e outros GPTE estão entre as situações em que a **entrevista domiciliar é dispensada** (IN 20/2026); o cadastro se faz em **postos** ou **mutirões**.\n- Em **áreas de baixa densidade** (rurais, comunidades indígenas, calhas de rios), a Tipificação prevê **equipes volantes** ou **CRAS itinerantes**, que atendem e cadastram nas comunidades, inclusive **de barco** na Amazônia Legal.\n- Respeite a **organização social e a língua**; com famílias indígenas, conte com **intérprete ou liderança** quando a família quiser.\nOs marcadores de GPTE no cadastro importam: os programas federais os observam.',
      base: 'Decreto 11.016/2022, art. 5º, V, e art. 7º, §6º; IN SAGICAD/MDS 20/2026, art. 1º (alterada pela 22/2026); Tipificação Nacional (Res. CNAS 109/2009); Trilhas do PAIF (MDS, 2024 e 2026).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['Como funciona o PAIF em território de baixa densidade?', 'Como funciona a entrevista do CadÚnico?'] },

    { id: 'cad-programas', cat: 'Programas',
      keys: ['programas que usam o cadunico', 'programas do cadunico', 'beneficios do cadunico', 'beneficios do cadastro unico', 'cadunico+programas', 'cadunico+beneficios', 'o que o cadunico da direito', 'o que da direito ter cadunico', 'quais beneficios o cadunico', 'cadunico+da+direito', 'para que usa o cadunico', 'programas+usam+cadastro+unico'],
      text: 'O CadÚnico é usado por **vários programas** (a cartilha do MDS cita, entre outros):\n- **Bolsa Família** e **BPC**;\n- **Tarifa Social de Energia Elétrica**;\n- **Minha Casa, Minha Vida** (Faixa 1);\n- **Isenção de taxa** em concursos públicos e no **Enem**;\n- **Carteira do Idoso** e **ID Jovem**.\nPode haver também programas estaduais e municipais: o decreto permite o uso do CadÚnico em políticas de **todas as esferas**, desde que o órgão aceite o **termo de uso** (arts. 2º, §3º, e 11).\n**Atenção:** estar no cadastro **não dá acesso automático**. Cada programa tem a **sua renda de corte**, os seus documentos e a sua seleção. Para valores e prazos, veja as Notícias do MDS.',
      base: 'Cartilha Noções básicas do Cadastro Único (MDS); Decreto 11.016/2022, arts. 2º e 11.',
      actions: [{ label: 'Notícias do MDS', cat: 'noticias' }], follow: ['Como funciona o Bolsa Família?', 'Quem tem direito ao BPC?'] },

    { id: 'cad-consulta', cat: 'Consulta',
      keys: ['consultar o cadunico', 'consultar cadunico', 'consultar o cadastro unico', 'cadunico+consulta', 'cadunico+consultar', 'cadunico+aplicativo', 'cadunico+comprovante+de+inscricao', 'cadunico+nis', 'consulta simples do cadunico', 'consulta completa do cadunico', 'ver meu cadunico', 'como saber se estou no cadunico', 'saber se estou no cadunico', 'como saber se o cadunico esta atualizado', 'cadunico+situacao+cadastral'],
      text: 'O cidadão consulta o próprio cadastro pelo **aplicativo Cadastro Único** ou pelo site **cadunico.dataprev.gov.br** (Dúvidas: **Central 121**, ligação gratuita).\n- **Consulta Simples:** sem login gov.br, informando **nome completo, data de nascimento, nome da mãe e UF/município**.\n- **Consulta Completa** (formulário, despesas, integrantes da família): exige **login gov.br** (nível Bronze, Prata ou Ouro).\n- Mostra **NIS, código familiar, situação cadastral e datas de atualização**, emite o **comprovante de inscrição** e localiza **postos de atendimento**.\nÓtimo para conferir se o cadastro está **em dia** antes de a família procurar o CRAS. A ficha do serviço está no diretório do app.',
      base: 'Cartilha Noções básicas do Cadastro Único (MDS); ficha "Consultar CadÚnico" do diretório do app (serviço oficial do MDS).',
      actions: [{ label: 'Abrir "Consultar CadÚnico"', search: 'Consultar CadÚnico' }], follow: ['Como atualizar o CadÚnico?', 'Quais documentos levar para o CadÚnico?'] },

    { id: 'cad-gestao', cat: 'Gestão e papéis',
      keys: ['quem faz o cadunico', 'quem e responsavel pelo cadunico', 'gestao do cadunico', 'gestao municipal do cadunico', 'cadunico+gestor+municipal', 'cadunico+competencia', 'cadunico+competencias', 'papel do cras no cadunico', 'papel do municipio no cadunico', 'papel do mds no cadunico', 'cadunico+gestao', 'cadunico+quem+cadastra', 'cadunico+entrevistador', 'cadunico+adesao'],
      text: 'Quem faz o quê no CadÚnico (Decreto, arts. 6º e 7º):\n- **União (MDS):** gere o cadastro em âmbito nacional, **edita as normas**, qualifica os dados e define cronogramas (Averiguação, Revisão).\n- **Municípios que aderiram:** fazem o **cadastramento** (inclusão e atualização), no **CRAS** ou em postos, por **entrevistadores** capacitados. A gestão municipal organiza a agenda, as entrevistas domiciliares e a **busca ativa**.\n- **Programas** (Bolsa Família, BPC, Tarifa Social) **usam** os dados para a própria seleção e notificam as famílias sobre bloqueios (art. 11-A).\n- **Vigilância socioassistencial:** usa o cadastro para o **diagnóstico do território** (veja também PAIF e vigilância).\nApoio aos técnicos: **Central 121** e chat do MDS para gestores.',
      base: 'Decreto 11.016/2022 (arts. 2º, 6º, 7º, 10 e 11-A); IN Conjunta 2/2026 (Averiguação e Revisão, ed. ago/2026).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['PAIF e vigilância socioassistencial', 'O que é Averiguação e Revisão Cadastral?'] },

    { id: 'cad-sigilo', cat: 'Sigilo',
      keys: ['sigilo do cadunico', 'cadunico+sigilo', 'cadunico+sigiloso', 'cadunico+sigilosos', 'cadunico+lgpd', 'dados do cadunico', 'cadunico+dados+sigilosos', 'quem pode ver o cadunico', 'quem pode ver os dados do cadunico', 'cadunico+acesso+aos+dados', 'cadunico+protecao+de+dados', 'compartilhar dados do cadunico', 'cadunico+privacidade', 'cadunico+cessao+de+dados'],
      text: 'Os **dados de identificação** das famílias no CadÚnico são **sigilosos** (Decreto, art. 13).\n- Só podem ser usados na **gestão de políticas públicas** e em **estudos e pesquisas**.\n- Uso fora disso sujeita o responsável às penalidades da **Lei de Acesso à Informação** (12.527/2011) e da **LGPD** (13.709/2018).\n- Trate **apenas o mínimo necessário** e **não ceda dados a terceiros** fora das regras do próprio decreto (art. 13, §4º).\nNo Argo, a regra é a mesma: **dados de famílias não vão à IA** nem saem do aparelho; ao perguntar, não digite nome, CPF, NIS ou endereço de ninguém.',
      base: 'Decreto 11.016/2022, art. 13 e §§1º, 2º e 4º; Lei 12.527/2011; Lei 13.709/2018.',
      actions: [], follow: ['Como o app protege os dados?', 'Quem faz o CadÚnico?'] },

    { id: 'cad-gas-do-povo', cat: 'Programas',
      keys: ['gas do povo', 'programa gas do povo', 'vale gas', 'auxilio gas', 'gas do povo+cadunico', 'gas do povo+quem+tem+direito', 'gas do povo+como+funciona', 'botijao gratis', 'botijao gratuito', 'recarga gratuita de gas', 'gas do povo+recargas', 'gas do povo+revenda'],
      text: 'O **Gás do Povo** dá **recarga gratuita do botijão de 13 kg** em revendas credenciadas e **substitui o Auxílio Gás** (pago em dinheiro).\n- **Quem tem direito:** família inscrita no **CadÚnico**, com **cadastro atualizado** e **renda por pessoa de até meio salário mínimo**; há **prioridade** para beneficiários do **Bolsa Família**.\n- **Beneficiário:** o vale sai em nome do **responsável familiar** do cadastro (preferencialmente a mulher, mas não é exclusivo).\n- **Quantidade:** família de **2 ou 3 pessoas**, até **4 recargas por ano** (cada vale vale 3 meses); de **4 ou mais**, até **6** (vale de 4 meses).\n- **Como retirar:** cartão do Bolsa Família, cartão de débito da Caixa, ou **CPF com código** no celular/aplicativo. A revenda **não pode cobrar** da família; vasilhame que a família não tem e frete, se houver, ficam fora da gratuidade.\n- **Atenção:** **CPF irregular** ou **inconsistência no cadastro** podem impedir a entrada ou a continuidade. Dúvidas: **121**.\nSe não há revenda credenciada no município, a família vai à cidade mais próxima que tenha.',
      base: 'FAQ do Programa Gás do Povo (MME); Lei 14.237/2021, arts. 2º, 3º e 4º-A (redação dada pela MP 1.313/2025 e pela lei de conversão).',
      actions: [{ label: 'Notícias do MDS', cat: 'noticias' }, { label: 'Ver CRAS', cat: 'social' }], follow: ['Como atualizar o CadÚnico?', 'Quais programas usam o CadÚnico?'] },

    { id: 'cad-pe-de-meia', cat: 'Programas',
      keys: ['pe de meia', 'pe-de-meia', 'programa pe de meia', 'pe de meia+cadunico', 'pe de meia+quem+tem+direito', 'pe de meia+valores', 'pe de meia+frequencia', 'pe de meia+requisitos', 'incentivo financeiro estudantil', 'poupanca do ensino medio'],
      text: 'O **Pé-de-Meia** é um incentivo financeiro-educacional do **MEC** para estudantes do **ensino médio** público, que usa o **CadÚnico** para checar a **renda por pessoa de até meio salário mínimo** (Portaria MEC 169/2026, art. 4º).\n- **Matrícula:** parcela única anual de **R$ 200**.\n- **Frequência:** **R$ 200** por parcela, até **9 por ano** no ensino médio regular (na **EJA**, **R$ 225**, até 4 por semestre), com **frequência mínima de 80%**.\n- **Conclusão:** **R$ 1.000** por ano concluído com aprovação, até **R$ 3.000** no ensino médio.\n- **Enem:** **R$ 200** para o concluinte que fizer os **dois dias** da prova.\n- A verificação usa a base do CadÚnico de 2026; **não há pagamento retroativo** de parcelas anteriores à habilitação.\nOs **valores e regras mudam por portaria**: confira o MEC. **Cadastro desatualizado** no CadÚnico pode barrar a habilitação: oriente a família a atualizar.',
      base: 'Portaria MEC 169/2026 (arts. 4º a 9º) e Lei 14.818/2024.',
      actions: [{ label: 'Ver Educação', cat: 'educacao' }, { label: 'Notícias do MDS', cat: 'noticias' }], follow: ['Como atualizar o CadÚnico?', 'Quais programas usam o CadÚnico?'] },

    { id: 'cad-tarifa-social', cat: 'Programas',
      keys: ['tarifa social de energia', 'tarifa social', 'tarifa social+cadunico', 'tarifa social+quem+tem+direito', 'tarifa social+desconto', 'desconto na conta de luz', 'conta de luz+cadunico', 'energia gratuita', 'gratuidade de energia', 'tarifa social+80+kwh', 'luz do povo', 'tarifa social+distribuidora'],
      text: 'A **Tarifa Social de Energia Elétrica (TSEE)** dá **desconto na conta de luz** a famílias de baixa renda **inscritas no CadÚnico** (e a beneficiários do BPC), e, desde **julho de 2025**, a **gratuidade de até 80 kWh por mês** para quem recebe a tarifa social (regulamentada pela **ANEEL**).\n- O benefício está **ligado à unidade consumidora** da distribuidora: confira se o **CadÚnico está atualizado** e com o **dado da conta de luz** correto.\n- Se o cadastro **não é regularizado** na Averiguação ou na Revisão Cadastral, o desconto é **cancelado**; para voltar, a família **solicita de novo à distribuidora**.\n- A **renda de corte**, as **faixas de consumo** e os procedimentos podem mudar: confirme com a **distribuidora** ou no site da ANEEL antes de orientar.',
      base: 'ANEEL e MME (gratuidade de até 80 kWh mensais para a Tarifa Social, a partir de jul/2025); IN Conjunta 2/2026 (Averiguação e Revisão, ed. ago/2026).',
      actions: [{ label: 'Notícias do MDS', cat: 'noticias' }], follow: ['O que acontece se não atualizar o cadastro?', 'Quais programas usam o CadÚnico?'] }

  ];
  CAD_BASE.forEach(function (e) {
    e.cad = true;
    // "cadunico" também vale como "cadastro unico" e "cad unico" (a pessoa escreve de várias formas)
    var extra = [];
    e.keys.forEach(function (k) {
      if (k.indexOf('cadunico') < 0) return;
      extra.push(k.replace(/cadunico/g, k.indexOf('+') > -1 ? 'cadastro+unico' : 'cadastro unico'));
      extra.push(k.replace(/cadunico/g, k.indexOf('+') > -1 ? 'cad+unico' : 'cad unico'));
    });
    e.keys = e.keys.concat(extra);
  });
  // ---------------------------------------------------------------------
  // BASE DA RAPS (Rede de Atenção Psicossocial): verbetes por tema, na mesma forma do PAIF_BASE e do CAD_BASE (keys, text, base = norma citada).
  // Responde na hora, sem internet e sem IA, e vai à IA como "baseApp" quando a pergunta é sobre saúde mental / RAPS.
  // Fontes: Lei 10.216/2001; Portaria MS 3.088/2011 (consolidada na Portaria de Consolidação nº 3/2017, Anexo V; alterações pelas
  // Portarias 3.588/2017 e 757/2023); Lei 10.708/2003; Lei 13.146/2015; Lei 13.819/2019; Lei 13.840/2019; Lei 11.343/2006;
  // Resolução CNJ 487/2023. Fatos de Boa Vista: fichas de js/data.js (CAPS II, CAPS III, CAPS AD III, UAA, HGRR, Consultório na Rua).
  // Número populacional de cada tipo de CAPS e valores de benefício NÃO entram aqui (mudam por portaria): o verbete remete à norma.
  // Para ajustar: edite o verbete (id raps-*) e atualize RAPS_REV. Testes: npm run test:raps
  // ---------------------------------------------------------------------
  var RAPS_REV = 'nov/2026';
  var RAPS_BASE = [
    { id: 'raps-o-que-e', cat: 'O que é a RAPS',
      keys: ['o que e a raps', 'o que e raps', 'raps+significa', 'raps+sigla', 'raps+componentes', 'componentes da raps', 'pontos de atencao da raps', 'rede de atencao psicossocial+componentes', 'explique a raps', 'raps+resumo', 'raps+serve', 'como funciona a raps', 'raps+o+que+e', 'oq e raps', 'o q e raps'],
      text: 'A **RAPS (Rede de Atenção Psicossocial)** é a rede do SUS para o cuidado de pessoas com **sofrimento ou transtorno mental** e com **necessidades decorrentes do uso de álcool e outras drogas**, em liberdade e no território.\n**Sete componentes:**\n- **Atenção básica:** UBS, Consultório na Rua, Centros de Convivência.\n- **Atenção psicossocial especializada:** os **CAPS**.\n- **Urgência e emergência:** SAMU 192, UPA, pronto-socorro.\n- **Atenção residencial de caráter transitório:** Unidade de Acolhimento e comunidades terapêuticas.\n- **Atenção hospitalar:** leitos de saúde mental em hospital geral.\n- **Desinstitucionalização:** Residências Terapêuticas e Programa de Volta para Casa.\n- **Reabilitação psicossocial:** trabalho, renda e cultura.\n O cuidado é feito **sem isolar a pessoa**, com Projeto Terapêutico Singular (PTS).',
      base: 'Portaria MS 3.088/2011 (consolidada na Portaria de Consolidação nº 3/2017, Anexo V) e Lei 10.216/2001.',
      actions: [{ label: 'Abrir Saúde (RAPS)', cat: 'saude' }], follow: ['O que é o CAPS?', 'Quais os tipos de CAPS?', 'Como a RAPS funciona em Boa Vista?'] },
    { id: 'raps-norma', cat: 'Normas',
      keys: ['3088', '3 088', 'consolidacao 3', 'raps+norma', 'raps+base legal', 'raps+legislacao', 'raps+portaria', 'raps+lei', 'legislacao de saude mental', 'normas da saude mental'],
      text: 'As normas que sustentam a RAPS:\n- **Lei 10.216/2001:** direitos da pessoa com transtorno mental e redirecionamento do modelo de cuidado (Reforma Psiquiátrica).\n- **Portaria MS 3.088/2011:** institui a RAPS; hoje consolidada na **Portaria de Consolidação nº 3/2017 (Anexo V)**, com alterações posteriores (como as Portarias 3.588/2017 e 757/2023).\n- **Lei 10.708/2003:** Programa de Volta para Casa.\n- **Lei 11.343/2006 e Lei 13.840/2019:** política sobre drogas, internação e acolhimento.\n- **Lei 13.819/2019:** prevenção da automutilação e do suicídio.\n- **Lei 13.146/2015:** Estatuto da Pessoa com Deficiência (curatela).\n- **Resolução CNJ 487/2023:** política antimanicomial do Judiciário.\nPortarias são alteradas com frequência: confira a versão vigente no site do Ministério da Saúde.',
      base: 'Textos oficiais das normas citadas (Planalto e Ministério da Saúde).',
      actions: [{ label: 'Abrir Saúde (RAPS)', cat: 'saude' }], follow: ['O que é a RAPS?', 'Quais os direitos da pessoa com transtorno mental?'] },
    { id: 'raps-reforma', cat: 'Reforma Psiquiátrica',
      keys: ['reforma psiquiatrica+o+que', 'o que e a reforma psiquiatrica', 'lei da reforma psiquiatrica', 'luta antimanicomial', 'desinstitucionalizacao', 'manicomio', 'manicomios', 'fim dos manicomios', 'modelo manicomial'],
      text: 'A **Reforma Psiquiátrica** brasileira trocou o modelo centrado no **hospital psiquiátrico** por um cuidado **em liberdade, no território**, com a pessoa no centro.\n- A **Lei 10.216/2001** garante direitos e diz que a internação só é indicada quando os recursos **extra-hospitalares** forem insuficientes; é vedada a internação em instituição com características asilares.\n- A **RAPS** (Portaria 3.088/2011) é a rede que sustenta esse modelo: CAPS, UBS, urgência, acolhimento, residências e reabilitação psicossocial.\n- **Desinstitucionalização** é fechar leitos asilares **e** criar serviços e moradia na comunidade para quem estava internado por muito tempo.',
      base: 'Lei 10.216/2001 (arts. 2º e 4º) e Portaria MS 3.088/2011.',
      actions: [{ label: 'Abrir Saúde (RAPS)', cat: 'saude' }], follow: ['O que é a RAPS?', 'O que são Residências Terapêuticas?', 'Quais os direitos da pessoa com transtorno mental?'] },
    { id: 'raps-direitos', cat: 'Direitos',
      keys: ['direitos da pessoa com transtorno mental', 'direitos do paciente psiquiatrico', 'direitos do usuario de saude mental', 'lei 10216+direitos', 'lei 10 216+direitos', 'lei 10216', 'lei 10 216', 'direitos em saude mental', 'transtorno mental+direitos'],
      text: 'A **Lei 10.216/2001** garante a toda pessoa com transtorno mental, sem discriminação:\n- **Acesso ao melhor tratamento** do sistema de saúde, adequado às suas necessidades.\n- **Tratamento com humanidade e respeito**, para a recuperação pela **inserção na família, no trabalho e na comunidade**.\n- **Proteção contra abuso e exploração.**\n- **Sigilo** nas informações prestadas.\n- **Presença médica** para esclarecer a necessidade ou não de internação involuntária.\n- **Ser informada** sobre a doença e o tratamento.\n- **Tratamento em ambiente terapêutico**, preferencialmente em serviços comunitários de saúde mental.\nO CRAS/CREAS pode orientar a família e **articular** o acesso; o tratamento é da saúde.',
      base: 'Lei 10.216/2001, art. 2º (parágrafo único).',
      actions: [{ label: 'Abrir Saúde (RAPS)', cat: 'saude' }], follow: ['O que é a Reforma Psiquiátrica?', 'Como funciona a internação psiquiátrica?'] },
    { id: 'raps-caps-o-que-e', cat: 'CAPS',
      keys: ['o que e o caps', 'o que e caps', 'para que serve o caps', 'caps+significa', 'caps+sigla', 'como funciona o caps', 'caps+funciona', 'explique o caps', 'caps+resumo', 'caps+serve', 'oq e caps', 'o q e caps'],
      text: 'O **CAPS (Centro de Atenção Psicossocial)** é o serviço de **saúde mental aberto e comunitário** do SUS, para pessoas com **sofrimento ou transtorno mental grave e persistente** e com necessidades decorrentes do **uso de álcool e outras drogas**, inclusive em crise.\n- Cuida **sem internar** como regra: atendimento **intensivo, semi-intensivo ou não intensivo**, conforme a necessidade.\n- Equipe **multiprofissional** (psiquiatra, enfermeiro, psicólogo, assistente social e outros).\n- Cada pessoa tem um **Projeto Terapêutico Singular (PTS)**, construído com ela e a família.\n- Faz também **apoio matricial** às UBS e articula a rede.\nNão é hospital nem pronto-socorro: é o serviço que **acompanha** a pessoa no território.',
      base: 'Portaria MS 3.088/2011 (Portaria de Consolidação nº 3/2017, Anexo V, arts. 7º e 8º).',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['Quais os tipos de CAPS?', 'Como ter acesso ao CAPS?', 'O que é o PTS?'] },
    { id: 'raps-caps-tipos', cat: 'CAPS',
      keys: ['tipos de caps', 'caps+tipos', 'caps+modalidades', 'qual a diferenca entre caps', 'diferenca entre caps', 'caps+diferenca', 'caps ad+diferenca', 'caps+24 horas', 'caps+24h', 'caps+noite', 'caps+madrugada', 'caps+feriado',  'caps+infantojuvenil+tipos', 'caps ad iv', 'caps+ad+iv', 'caps+ii+iii', 'caps+3+2', 'caps+para+quem'],
      text: 'Os **tipos de CAPS** (norma nacional):\n- **CAPS I, II e III:** pessoas com transtornos mentais graves e persistentes (o **CAPS I** atende **todas as faixas etárias**, inclusive álcool e outras drogas). O **III funciona 24h**, com acolhimento noturno.\n- **CAPS i (infantojuvenil):** crianças e adolescentes.\n- **CAPS AD:** necessidades decorrentes do uso de **álcool e outras drogas**. O **AD III funciona 24h** e o **AD IV** atua em cenas de uso, em grandes cidades.\nO tipo depende do **porte populacional** do município e da região (a portaria fixa os números; confira a versão vigente).\n**Em Boa Vista:** **CAPS II**, **CAPS III** (estadual, 24h) e **CAPS AD III** (estadual, 24h); no **interior**, há **CAPS I** em sete municípios. **Não há CAPS infantil**: o CAPS II atende crianças a partir de 4 anos.\n⚠ "24h" não é pronto-socorro: a porta aberta para novos casos costuma ser diurna.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V), alterada pelas Portarias 3.588/2017 e 757/2023; fichas do diretório (data.js).',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['Como ter acesso ao CAPS?', 'Como a RAPS funciona em Boa Vista?'] },
    { id: 'raps-caps-acesso', cat: 'CAPS',
      keys: ['como ter acesso ao caps', 'como ser atendido no caps', 'como entrar no caps', 'como conseguir atendimento no caps', 'caps+encaminhamento', 'precisa de encaminhamento para o caps', 'caps+porta aberta', 'caps+demanda espontanea', 'demanda espontanea+saude mental', 'como ser acompanhado no caps', 'caps+acesso'],
      text: 'Como a pessoa chega ao **CAPS**:\n- Pode ir **por conta própria** (demanda espontânea) ou ser **encaminhada** pela UBS, pelo hospital, pelo CRAS/CREAS, pela escola, pelo Judiciário ou por outro serviço. O encaminhamento ajuda, mas **não deve ser barreira**.\n- O primeiro passo é o **acolhimento**: escuta, avaliação da necessidade e definição do cuidado (e do **PTS**).\n- Leve **documento com foto**, cartão do SUS e, se houver, receitas, laudos e exames.\n- Em **crise**, o CAPS que tem acolhimento noturno ou a urgência hospitalar (HGRR; SAMU 192) são o caminho.\nPara endereço e telefone, use o botão "Ver CAPS".',
      base: 'Portaria de Consolidação nº 3/2017, Anexo V (acesso por demanda espontânea e referenciada); Lei 10.216/2001.',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['O que é o PTS?', 'O que fazer em crise de saúde mental?'] },
    { id: 'raps-pts', cat: 'CAPS',
      keys: ['projeto terapeutico singular', 'o que e o pts', 'pts+caps', 'pts+saude mental', 'tecnico de referencia', 'acolhimento em saude mental', 'acolhimento+caps'],
      text: 'O **Projeto Terapêutico Singular (PTS)** é o plano de cuidado **construído com a pessoa e a família**, a partir da história, das necessidades e dos desejos dela.\n- Reúne metas, atividades (consultas, oficinas, grupos, atendimento domiciliar), medicação e articulação com outros serviços.\n- Cada pessoa tem um **técnico de referência** que acompanha o caso e **revisa** o PTS.\n- Começa no **acolhimento** e inclui família, trabalho, escola, moradia e renda: por isso o CRAS/CREAS entra como parceiro.\nO PTS é **do serviço de saúde**; o PAF do PAIF é o plano da assistência social. Os dois se conversam, não se substituem.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V); diretrizes do Ministério da Saúde para os CAPS.',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['Como ter acesso ao CAPS?', 'Como o CRAS e o CAPS trabalham juntos?'] },
    { id: 'raps-atencao-basica', cat: 'Atenção básica',
      keys: ['saude mental+ubs', 'saude mental+atencao basica', 'ubs+ansiedade', 'ubs+depressao', 'ansiedade+tratamento', 'depressao+tratamento', 'ansiedade+onde+tratar', 'depressao+onde+tratar', 'ansiedade+onde', 'depressao+onde', 'insonia+ansiedade', 'insonia+onde', 'idoso+depressao', 'idoso+saude mental', 'estresse+onde', 'saude mental+posto', 'transtorno mental leve', 'sofrimento psiquico leve'],
      text: 'A **UBS** é a **porta de entrada** do cuidado em saúde mental para os casos **leves e moderados** (ansiedade, depressão, sofrimento ligado a perdas e conflitos) e para quem já está estável.\n- A equipe da UBS acolhe, acompanha e pode contar com **apoio matricial** do CAPS e de equipes multiprofissionais.\n- A UBS também **encaminha ao CAPS** os casos graves e persistentes ou em crise, e **continua cuidando** de quem volta do CAPS.\n- O **Consultório na Rua** leva o cuidado à população em situação de rua.\nPara indicar a UBS, diga o **bairro**; se houver risco para a vida, o caminho é **SAMU 192** ou o CVV **188**.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V, Atenção Básica em Saúde); Política Nacional de Atenção Básica.',
      actions: [{ label: 'Ver UBS', cat: 'saude' }], follow: ['Quando encaminhar para a UBS e quando para o CAPS?', 'O que é o CAPS?'] },
    { id: 'raps-quando-encaminhar', cat: 'Encaminhamento',
      keys: ['quando encaminhar para o caps', 'quando encaminhar para a ubs', 'quando encaminhar para o caps ou ubs', 'caps ou ubs', 'ubs ou caps', 'encaminhar+caps', 'encaminhar+saude mental', 'encaminhamento+raps', 'encaminhar para a raps', 'quando procurar o caps', 'quando procurar o caps ou a ubs'],
      text: 'Regra prática para **encaminhar** uma pessoa à saúde mental:\n- **Sofrimento leve ou moderado** (ansiedade, tristeza, insônia, luto): **UBS**.\n- **Transtorno grave e persistente**, sofrimento intenso que atrapalha a vida, ou **uso prejudicial de álcool e outras drogas**: **CAPS** (CAPS AD para álcool e drogas).\n- **Crise** (agitação, risco para si ou outros, surto): **urgência** (SAMU 192; HGRR em Boa Vista); depois, CAPS.\n- **Risco de vida iminente:** 192 (SAMU) ou 193.\nQuem avalia e decide o serviço é a **equipe de saúde**: o CRAS/CREAS **orienta, acompanha e articula**, e registra o encaminhamento, sem indicar tratamento nem internação.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V); Tipificação Nacional dos Serviços Socioassistenciais (Res. CNAS 109/2009).',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }, { label: 'Ver UBS', cat: 'saude' }], follow: ['O que fazer em crise de saúde mental?', 'Como o CRAS e o CAPS trabalham juntos?'] },
    { id: 'raps-crise', cat: 'Crise e urgência',
      keys: ['crise em saude mental', 'crise psiquiatrica', 'surto', 'surto psicotico', 'pessoa em crise', 'agitacao psicomotora', 'urgencia psiquiatrica', 'o que fazer em crise', 'surto+fazer', 'crise+fazer', 'urgencia em saude mental', 'emergencia psiquiatrica', 'samu+saude mental'],
      text: 'Em **crise de saúde mental** (agitação intensa, confusão, risco para si ou para outros):\n- **Risco imediato à vida ou violência:** ligue **192 (SAMU)**; se houver ameaça, **190** (polícia) ou **193** (bombeiros).\n- **Em Boa Vista**, a referência para urgência psiquiátrica é o **HGRR** (24h); o **SAMU** deve atender também às urgências em saúde mental. **Não há UPA em funcionamento.**\n- Mantenha a pessoa **em local seguro**, com poucas pessoas, fale com calma e **não discuta** o delírio; não deixe a pessoa sozinha.\n- Depois da crise, o **CAPS** (ou a UBS) faz o seguimento.\nO CRAS/CREAS **aciona a saúde** e acompanha a família; não conduz a crise sozinho.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V, componente Urgência e Emergência); fichas do diretório (SAMU e HGRR).',
      actions: [{ label: 'Ver Saúde/Urgência', cat: 'hospitalar' }, { label: 'Ver CAPS', cat: 'saude' }], follow: ['Como funciona a internação psiquiátrica?', 'Como ter acesso ao CAPS?'] },
    { id: 'raps-hospitalar', cat: 'Atenção hospitalar',
      keys: ['leitos de saude mental', 'leito de saude mental', 'leito psiquiatrico', 'leitos psiquiatricos', 'leitos+hgrr', 'hgrr+saude mental', 'hgrr+psiquiatria', 'atencao hospitalar+raps', 'hospital psiquiatrico', 'hospital geral+saude mental', 'enfermaria psiquiatrica', 'leito de saude mental em hospital geral'],
      text: 'Na **RAPS**, a atenção hospitalar é feita em **leitos de saúde mental em hospital geral** (e em CAPS III, com acolhimento noturno), para **internação breve**, só pelo tempo necessário para **estabilizar a crise**.\n- A porta de entrada é a **urgência**, e a alta deve ser **combinada com o CAPS/UBS** do território.\n- O leito hospitalar é **retaguarda** da rede, não o centro do cuidado.\n- **Em Boa Vista:** o **HGRR** tem urgência psiquiátrica 24h e leitos de saúde mental (confirme com a unidade o fluxo de entrada).',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V, Atenção Hospitalar); Lei 10.216/2001, art. 4º.',
      actions: [{ label: 'Ver Saúde/Urgência', cat: 'hospitalar' }], follow: ['Como funciona a internação psiquiátrica?', 'O que fazer em crise de saúde mental?'] },
    { id: 'raps-internacao', cat: 'Internação',
      keys: ['internacao psiquiatrica', 'internacao involuntaria', 'internacao compulsoria', 'internacao voluntaria', 'tipos de internacao', 'como internar', 'internar+familiar', 'internar+parente', 'internar+filho', 'internar+psiquiatrico', 'internar+forca', 'internar+contra+vontade', 'internar+sem+consentimento', 'internacao+saude mental', 'quem pode internar'],
      text: 'A **internação psiquiátrica** é recurso **excepcional**: só quando os recursos extra-hospitalares são insuficientes, e **só com laudo médico** que descreva os motivos. A Lei 10.216/2001 prevê três tipos:\n- **Voluntária:** a pessoa concorda.\n- **Involuntária:** **sem o consentimento** da pessoa, a **pedido de terceiro** (em geral a família). O hospital deve **comunicar ao Ministério Público em até 72 horas**.\n- **Compulsória:** **determinada pela Justiça**.\n**Para o CRAS/CREAS:** quem avalia a necessidade é a **equipe de saúde** (UBS, CAPS, urgência). O CRAS/CREAS **não indica** internação: orienta a família a procurar a saúde e acompanha o caso.',
      base: 'Lei 10.216/2001 (arts. 4º, 6º e 8º).',
      actions: [{ label: 'Ver Saúde/Urgência', cat: 'hospitalar' }, { label: 'Ver CAPS', cat: 'saude' }], follow: ['Como é a internação de quem usa drogas?', 'O que fazer em crise de saúde mental?'] },
    { id: 'raps-internacao-ad', cat: 'Internação',
      keys: ['internacao de dependente quimico', 'internar dependente quimico', 'internar+dependente', 'internar+quimico', 'internacao+drogas', 'internacao involuntaria+drogas', 'internacao+dependente', 'internar usuario de drogas', 'internar+drogas', 'lei 13840', 'lei 13 840', 'internar+alcool', 'internar+alcoolatra'],
      text: 'Para quem usa **álcool e outras drogas**, a **Lei 13.840/2019** (que alterou a Lei 11.343/2006) prevê:\n- **Internação voluntária**, com consentimento por escrito.\n- **Internação involuntária:** em **unidade de saúde ou hospital geral**, depois de avaliação por **médico**, a pedido de **familiar ou responsável legal** (ou de servidor público da saúde, da assistência social ou do Sisnad, exceto da segurança pública), com **duração máxima de 90 dias**, com término por determinação médica; a internação deve ser comunicada ao Ministério Público.\n- Vale a regra geral: só quando **os demais recursos extra-hospitalares são insuficientes**.\nO primeiro cuidado é o **CAPS AD**, com **redução de danos**. O CRAS/CREAS **não indica** internação.',
      base: 'Lei 13.840/2019 (Lei 11.343/2006, art. 23-A) e Lei 10.216/2001.',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['O que é redução de danos?', 'O que é uma comunidade terapêutica?'] },
    { id: 'raps-comunidade-terapeutica', cat: 'Acolhimento',
      keys: ['comunidade terapeutica', 'comunidades terapeuticas', 'clinica de recuperacao', 'fazenda de recuperacao', 'ct+drogas', 'ct+acolhimento'],
      text: 'As **comunidades terapêuticas** são entidades **privadas, em geral sem fins lucrativos**, de **acolhimento residencial transitório** para pessoas com problemas decorrentes do uso de drogas.\n- O acolhimento é **voluntário**, com **adesão formalizada por escrito**, e deve ser precedido de **avaliação médica**.\n- Não são **hospital** nem **CAPS**: a norma nacional as trata como **acolhimento**, não como serviço de saúde, e a pessoa **não pode ser mantida contra a vontade**.\n- A **Portaria 3.088/2011** as inclui entre os serviços de atenção residencial de caráter transitório.\n- O **CAPS AD** continua responsável pelo cuidado em saúde, e o **PTS** deve prever a saída e a volta ao território.\nDenúncia de maus-tratos: Disque 100 ou Ministério Público.',
      base: 'Lei 13.840/2019 (art. 26-A da Lei 11.343/2006); Portaria MS 3.088/2011.',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['O que é a Unidade de Acolhimento?', 'O que é redução de danos?'] },
    { id: 'raps-reducao-danos', cat: 'Álcool e drogas',
      keys: ['reducao de danos', 'o que e reducao de danos', 'politica de reducao de danos', 'abstinencia obrigatoria', 'caps ad+reducao', 'cuidado em alcool e drogas', 'tratamento+alcool+drogas', 'usuario de drogas+atendimento', 'dependencia quimica+tratamento', 'alcoolismo+tratamento', 'alcool e drogas+raps'],
      text: 'A **redução de danos** é uma **diretriz da RAPS** para o cuidado de quem usa álcool e outras drogas: reduzir os **riscos e danos à saúde e à vida** sem exigir, como condição, a **abstinência**.\n- O **CAPS AD** acolhe a pessoa **mesmo que ela continue usando**, constrói o PTS com ela e a família e oferece atendimento, oficinas, grupos e, quando preciso, **acolhimento noturno** (CAPS AD III).\n- A **UBS** e o **Consultório na Rua** também fazem redução de danos.\n- A abstinência pode ser **uma meta**, não um pré-requisito para ser atendido.\n**Em Boa Vista:** **CAPS AD III** (estadual, 24h) é a referência para todas as macroáreas.',
      base: 'Portaria MS 3.088/2011 (diretrizes) e Portaria de Consolidação nº 3/2017, Anexo V; Política Nacional sobre Drogas.',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['Como ter acesso ao CAPS?', 'Como é a internação de quem usa drogas?'] },
    { id: 'raps-unidade-acolhimento', cat: 'Acolhimento',
      keys: ['unidade de acolhimento', 'o que e a unidade de acolhimento', 'acolhimento transitorio', 'unidade de acolhimento adulto', 'unidade de acolhimento infantojuvenil', 'uaa+raps', 'ua+raps', 'acolhimento residencial transitorio'],
      text: 'A **Unidade de Acolhimento (UA)** é um serviço **residencial transitório** da RAPS para pessoas com **necessidades decorrentes do uso de álcool e outras drogas**, em **vulnerabilidade social e/ou familiar**, que precisam de acolhimento por um período.\n- **UA Adulto** (18 anos ou mais) e **UA Infantojuvenil** (adolescentes e jovens, 12 a 17 anos).\n- O acesso é **por encaminhamento do CAPS**, que acompanha a pessoa; a permanência é de **até 6 meses**, conforme o PTS.\n- Funciona **24 horas**.\n**Em Boa Vista:** consta a **Unidade de Acolhimento Adulto (UAA)**, no Bairro dos Estados, acessada pelo CAPS de referência.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V, Atenção Residencial de Caráter Transitório); ficha do diretório (UAA).',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['Como ter acesso ao CAPS?', 'O que é uma comunidade terapêutica?'] },
    { id: 'raps-srt', cat: 'Desinstitucionalização',
      keys: ['residencia terapeutica', 'residencias terapeuticas', 'servico residencial terapeutico', 'servicos residenciais terapeuticos', 'srt+raps', 'moradia+saude mental', 'o que e uma residencia terapeutica', 'o que sao residencias terapeuticas'],
      text: 'As **Residências Terapêuticas (SRT, Serviços Residenciais Terapêuticos)** são **casas na comunidade** para pessoas com transtorno mental que **saíram de internação de longa permanência** (hospital psiquiátrico ou de custódia) e **não têm suporte familiar ou social**.\n- Não são serviço de saúde "de passagem": são **moradia**, com cuidado de apoio e acompanhamento do **CAPS**.\n- Fazem parte do componente **Estratégias de Desinstitucionalização** da RAPS.\n- Costumam andar junto com o **Programa de Volta para Casa** e com a reconstrução de **vínculos e renda** (CadÚnico, BPC).\nO acesso é pela **saúde mental** do município.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V, Desinstitucionalização); Portaria MS 3.088/2011.',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['O que é o Programa de Volta para Casa?', 'BPC para quem tem transtorno mental'] },
    { id: 'raps-volta-para-casa', cat: 'Desinstitucionalização',
      keys: ['programa de volta para casa', 'volta para casa', 'lei 10708', 'lei 10 708', 'auxilio reabilitacao psicossocial', 'auxilio reabilitacao', 'auxilio+saude mental+egresso'],
      text: 'O **Programa de Volta para Casa** (Lei 10.708/2003) paga o **auxílio-reabilitação psicossocial** a pessoas com transtorno mental **egressas de internação de longa permanência** (em geral, dois anos ou mais), para apoiar a **reinserção social**.\n- O benefício é pago **por prazo de um ano, renovável** quando necessário.\n- O pedido é feito pela **equipe de saúde mental** do município, que acompanha a pessoa; o **valor** é fixado pelo Ministério da Saúde (confira o vigente).\n- Complementa, e não substitui, **BPC** ou outro benefício: cada um tem os seus critérios.\nA assistência social ajuda com **documentos, CadÚnico e vínculos**.',
      base: 'Lei 10.708/2003 (arts. 1º a 3º).',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['O que são Residências Terapêuticas?', 'BPC para quem tem transtorno mental'] },
    { id: 'raps-reabilitacao', cat: 'Reabilitação psicossocial',
      keys: ['centro de convivencia', 'centro de convivencia e cultura', 'ceco', 'reabilitacao psicossocial', 'geracao de renda+saude mental', 'trabalho+saude mental', 'cooperativa social', 'inclusao produtiva+saude mental', 'trabalho+transtorno mental', 'renda+transtorno mental'],
      text: 'A **reabilitação psicossocial** busca a **autonomia** da pessoa: trabalho, renda, cultura, moradia e laços sociais.\n- Os **Centros de Convivência e Cultura (CECO)** são espaços **abertos à comunidade**, de **arte, cultura e convivência**, sem exigir diagnóstico.\n- **Iniciativas de geração de trabalho e renda**, empreendimentos solidários e **cooperativas sociais** (Lei 9.867/1999) incluem pessoas com transtorno mental.\n- O **CAPS** monta oficinas e o PTS inclui essas metas.\n- O **SUAS** contribui com **CadÚnico, CRAS, SCFV, qualificação e inclusão produtiva**.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V, Reabilitação Psicossocial); Lei 9.867/1999.',
      actions: [{ label: 'Ver CRAS', cat: 'social' }, { label: 'Ver CAPS', cat: 'saude' }], follow: ['Como o CRAS e o CAPS trabalham juntos?', 'O que é o PTS?'] },
    { id: 'raps-suas-raps', cat: 'SUAS e RAPS',
      keys: ['suas+raps', 'cras+raps', 'creas+raps', 'cras e caps', 'creas e caps', 'cras ou caps', 'assistencia social+saude mental', 'articulacao suas e saude', 'articulacao+suas+raps', 'suas e saude mental', 'cras+saude mental', 'creas+saude mental', 'como o cras e o caps trabalham juntos'],
      text: 'Como **SUAS e RAPS** trabalham juntos:\n- **CRAS/CREAS não fazem tratamento clínico**: **acolhem, orientam, acompanham a família e articulam** a rede. O cuidado em saúde mental é do **SUS** (UBS, CAPS).\n- **Encaminhar à saúde:** registre o motivo, a situação familiar e o contato, indique a **UBS ou o CAPS** do território e, se possível, **acompanhe** o primeiro contato.\n- **Do CAPS ao SUAS:** documentos, **CadÚnico**, **BPC**, Bolsa Família, convivência (SCFV), acolhimento institucional e vínculos familiares.\n- **Discutam o caso** (reunião de rede, estudo de caso) e usem **PTS e PAF** em conjunto, sem expor mais do que o necessário (**sigilo**).\n- O CRAS/CREAS **não indica internação**.',
      base: 'Tipificação Nacional dos Serviços Socioassistenciais (Res. CNAS 109/2009); Portaria MS 3.088/2011; Lei 10.216/2001.',
      actions: [{ label: 'Ver CRAS e CREAS', cat: 'social' }, { label: 'Ver CAPS', cat: 'saude' }], follow: ['Quando encaminhar para a UBS e quando para o CAPS?', 'BPC para quem tem transtorno mental'] },
    { id: 'raps-bpc', cat: 'Benefícios',
      keys: ['bpc+transtorno mental', 'bpc+saude mental', 'bpc+esquizofrenia', 'bpc+psiquiatrico', 'bpc+psiquiatrica', 'bpc+depressao', 'bpc+bipolar', 'laudo+bpc', 'quem+emite+laudo', 'quem+faz+laudo', 'laudo psiquiatrico+bpc', 'beneficio+transtorno mental', 'beneficio+saude mental', 'aposentadoria+transtorno mental'],
      text: 'O **BPC** (Benefício de Prestação Continuada) pode ser pedido por pessoa com **transtorno mental** que se enquadre como **pessoa com deficiência**.\n- Exige **impedimento de longo prazo** (de natureza física, mental, intelectual ou sensorial, em geral de **2 anos ou mais**) que, em interação com barreiras, limite a participação na sociedade.\n- **Renda familiar per capita** dentro do limite legal e inscrição no **CadÚnico**.\n- A avaliação é **biopsicossocial** (perícia médica e avaliação social do INSS): **o diagnóstico sozinho não garante** o benefício; contam as limitações e as barreiras.\n- Leve **laudo atualizado** do CAPS/UBS (CID, descrição funcional, tratamento).\nO pedido é pelo **Meu INSS** ou **135**; o CRAS orienta e atualiza o CadÚnico.',
      base: 'Lei 8.742/1993 (LOAS, art. 20) e Lei 13.146/2015; Decreto 6.214/2007.',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['Como o CRAS e o CAPS trabalham juntos?', 'O que é curatela?'] },
    { id: 'raps-curatela', cat: 'Direitos',
      keys: ['curatela', 'interdicao', 'interditar', 'curatela+saude mental', 'curatela+transtorno mental', 'tomada de decisao apoiada', 'o que e curatela', 'capacidade civil+transtorno mental', 'curador'],
      text: 'A **curatela** é medida **judicial**, **excepcional e proporcional**, para quem precisa de apoio em atos da vida civil.\n- Pelo **Estatuto da Pessoa com Deficiência (Lei 13.146/2015)**, a curatela **afeta só os atos patrimoniais e negociais**: não alcança o **direito ao próprio corpo, à sexualidade, ao casamento, à privacidade, à educação, à saúde, ao trabalho e ao voto**.\n- Existe também a **Tomada de Decisão Apoiada** (Código Civil, art. 1.783-A): a pessoa escolhe apoiadores e **mantém a capacidade**.\n- O pedido é feito na **Justiça** (com advogado ou **Defensoria Pública**); o **CRAS/CREAS** orienta a família sobre onde procurar.\nTranstorno mental **não é sinônimo de incapacidade**.',
      base: 'Lei 13.146/2015 (arts. 84 e 85) e Código Civil, art. 1.783-A.',
      actions: [{ label: 'Ver Jurídico', cat: 'juridico' }], follow: ['BPC para quem tem transtorno mental', 'Quais os direitos da pessoa com transtorno mental?'] },
    { id: 'raps-justica', cat: 'Justiça',
      keys: ['medida de seguranca', 'resolucao cnj 487', 'resolucao 487', 'politica antimanicomial', 'antimanicomial+judiciario', 'hospital de custodia', 'manicomio judiciario', 'cnj+saude mental', 'pessoa com transtorno mental+crime', 'inimputavel'],
      text: 'A **Resolução CNJ 487/2023** institui a **Política Antimanicomial do Poder Judiciário**: pessoas com transtorno mental em conflito com a lei devem ter o cuidado feito **em meio aberto, pela RAPS**, em vez de **internação em hospital de custódia**.\n- A **medida de segurança** é aplicada ao **inimputável** (ou semi-imputável) que cometeu fato previsto como crime; a lógica é de **tratamento**, não de pena.\n- A **internação** vira **último recurso**, e a **saúde** (CAPS, UBS) é quem acompanha o cuidado.\n- O papel do **SUAS**: **vínculos, documentos, benefícios e acompanhamento da família**.\nDetalhes do caso são do **juízo da execução**; confirme na Vara responsável.',
      base: 'Resolução CNJ 487/2023; Código Penal (arts. 96 a 99); Lei 10.216/2001.',
      actions: [{ label: 'Ver Jurídico', cat: 'juridico' }], follow: ['O que é curatela?', 'Como funciona a internação psiquiátrica?'] },
    { id: 'raps-lei-13819', cat: 'Notificação',
      keys: ['lei 13819', 'lei 13 819', 'notificacao de violencia autoprovocada', 'violencia autoprovocada', 'politica nacional de prevencao da automutilacao', 'notificacao compulsoria+saude mental', 'notificar+violencia autoprovocada'],
      text: 'A **Lei 13.819/2019** institui a **Política Nacional de Prevenção da Automutilação e do Suicídio** e torna **compulsória** a notificação, pelos serviços de saúde (públicos e privados), dos casos suspeitos ou confirmados de **violência autoprovocada** (automutilação e tentativa de suicídio).\n- A notificação é **da saúde** e tem finalidade de **vigilância e cuidado**: o profissional do SUAS que souber de um caso **orienta e acompanha a família** e **aciona a saúde**.\n- O fluxo e o prazo constam no **protocolo de vigilância** do Ministério da Saúde e da SEMSA/SESAU: confirme a versão vigente.\n- Risco imediato: **192 (SAMU)**; apoio emocional 24h: **188 (CVV)**.',
      base: 'Lei 13.819/2019.',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['O que fazer em crise de saúde mental?', 'Como ter acesso ao CAPS?'] },
    { id: 'raps-situacao-rua', cat: 'Atenção básica',
      keys: ['consultorio na rua', 'consultorio de rua', 'equipe de consultorio na rua', 'saude mental+situacao de rua', 'situacao de rua+caps', 'morador de rua+saude mental', 'situacao de rua+drogas', 'ecr+raps', 'morador de rua+transtorno mental', 'morador de rua+surto', 'situacao de rua+transtorno mental', 'situacao de rua+surto', 'situacao de rua+usuario+alcool', 'situacao de rua+sem+documentos+saude'],
      text: 'O **Consultório na Rua (eCR)** é equipe da **atenção básica** que leva o cuidado à **população em situação de rua**, **no lugar onde a pessoa está**.\n- Cuida de saúde geral, **saúde mental** e **uso de álcool e outras drogas**, com **redução de danos**, e articula **UBS, CAPS e urgência**.\n- Atende **sem exigir endereço fixo nem documentos**.\n- Com o **Serviço de Abordagem Social** e o **Centro POP** do SUAS, faz **busca ativa**, orienta sobre documentos, CadÚnico e acolhimento.\n**Em Boa Vista:** a equipe atua **de forma itinerante**, sem endereço fixo; para acionar, procure a **SEMSA** ou o **CAPS**.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V, Atenção Básica); ficha do diretório (Consultório na Rua).',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['O que é redução de danos?', 'Como o CRAS e o CAPS trabalham juntos?'] },
    { id: 'raps-psicoterapia', cat: 'Psicoterapia',
      keys: ['psicoterapia gratuita', 'psicologo gratuito', 'terapia gratuita', 'psicologo pelo sus', 'atendimento psicologico gratuito', 'clinica escola', 'clinica escola de psicologia', 'psicologo no sus', 'psicologico+crianca', 'psicologo+crianca', 'terapia+crianca', 'psicologo+rede publica', 'atendimento psicologico+rede publica', 'psicoterapia no sus', 'terapia pelo sus', 'como fazer terapia de graca'],
      text: 'Onde buscar **psicoterapia gratuita**:\n- **UBS:** porta de entrada do SUS; a equipe avalia e encaminha. O psicólogo da rede atua conforme a equipe do município.\n- **CAPS:** para casos **graves e persistentes** ou com uso de álcool e outras drogas.\n- **Clínicas-escola** e serviços de universidades: atendimento por estagiários, com supervisão.\n**Em Boa Vista (diretório):** o **Ambulatório Psiquiátrico e Psicológico do Hospital Coronel Mota** é referência para psicoterapia de baixo e médio risco; o **SAP-UFRR** (Serviço de Atendimento Psicológico da Universidade Federal de Roraima) tem **plantão psicológico** por ordem de chegada, sem agendamento (a partir de 12 anos, com responsável legal).\nConfirme dias e horários antes de ir.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V); fichas do diretório (Ambulatório Coronel Mota e SAP-UFRR).',
      actions: [{ label: 'Abrir Saúde (RAPS)', cat: 'saude' }], follow: ['O que é o CAPS?', 'Quando encaminhar para a UBS e quando para o CAPS?'] },
    { id: 'raps-boa-vista', cat: 'Boa Vista',
      keys: ['raps+boa+vista', 'raps+em+roraima', 'raps+roraima', 'rede de saude mental+boa vista', 'rede de saude mental', 'saude mental em boa vista', 'servicos de saude mental+boa vista', 'como a raps funciona em boa vista', 'caps+macroarea', 'caps de referencia+bairro'],
      text: 'A **RAPS em Boa Vista** (conforme o diretório do app):\n- **CAPS II** (municipal): referência para as **macroáreas 1, 2, 3 e 6**; atende crianças a partir de 4 anos.\n- **CAPS III 24h** (estadual): macroáreas **4, 5, 7 e 8**; acolhimento noturno para quem já está em acompanhamento.\n- **CAPS AD III 24h** (estadual): álcool e outras drogas, **todas as macroáreas**.\n- **Atenção básica:** **UBS** nos bairros e **Consultório na Rua** (itinerante).\n- **Urgência:** **SAMU 192** e **HGRR** (urgência psiquiátrica 24h). **Não há UPA em funcionamento.**\n- **Acolhimento transitório:** **UAA**. **Não há CAPS infantil (CAPS i).**\n- **Psicoterapia:** Ambulatório do Coronel Mota e SAP-UFRR.\nO bairro define o **CAPS de referência**: use o botão ou pergunte "qual CAPS atende o bairro X?".',
      base: 'Fichas do diretório (js/data.js); Portaria de Consolidação nº 3/2017 (Anexo V).',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }, { label: 'Ver Saúde/Urgência', cat: 'hospitalar' }], follow: ['O que é o CAPS?', 'O que fazer em crise de saúde mental?'] },
    { id: 'raps-siglas', cat: 'Siglas',
      keys: ['siglas da raps', 'raps+siglas', 'o que e srt', 'o que e uaa', 'o que e ua', 'o que e ceco', 'o que e ecr', 'o que e caps ad', 'o que e caps i', 'significado de caps ad', 'significado das siglas da saude mental'],
      text: 'Siglas da **RAPS**:\n- **RAPS:** Rede de Atenção Psicossocial.\n- **CAPS:** Centro de Atenção Psicossocial (**I, II, III**: porte do serviço, e o III funciona 24h; **AD**: álcool e drogas; **i** minúsculo: infantojuvenil).\n- **PTS:** Projeto Terapêutico Singular.\n- **UA / UAA:** Unidade de Acolhimento / Unidade de Acolhimento Adulto.\n- **SRT:** Serviço Residencial Terapêutico.\n- **CECO:** Centro de Convivência e Cultura.\n- **eCR:** equipe de Consultório na Rua.\n- **UBS:** Unidade Básica de Saúde. **UPA:** Unidade de Pronto Atendimento. **SAMU:** Serviço de Atendimento Móvel de Urgência.\n- **HGRR:** Hospital Geral de Roraima.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V); fichas do diretório.',
      actions: [{ label: 'Abrir Saúde (RAPS)', cat: 'saude' }], follow: ['O que é a RAPS?', 'Quais os tipos de CAPS?'] }
    ,
    { id: 'raps-caps-faq', cat: 'CAPS',
      keys: ['o caps interna', 'caps+interna', 'caps+tem+psiquiatra', 'o caps e gratuito', 'caps+gratuito', 'caps+pagar', 'quem e atendido no caps', 'caps+para+quem+e', 'quem pode ser atendido no caps', 'quem e atendido no caps ad', 'caps+atende+depressao', 'caps+atende+crianca', 'caps+atende+adolescente', 'caps+atende+idoso', 'quanto tempo dura o tratamento no caps', 'caps+tempo+tratamento', 'caps+tratamento+dura', 'caps+atende+quem'],
      text: 'Dúvidas frequentes sobre o **CAPS**:\n- **É gratuito?** Sim, é serviço do **SUS**: sem pagamento e sem plano de saúde.\n- **Quem é atendido?** Pessoas com **sofrimento ou transtorno mental grave e persistente**; no **CAPS AD**, pessoas com **uso prejudicial de álcool e outras drogas** (sem exigir abstinência). Depressão e ansiedade **leves ou moderadas** começam na **UBS**; vão ao CAPS quando são graves, persistentes ou atrapalham muito a vida.\n- **Crianças e adolescentes:** a norma prevê o **CAPS i**; em Boa Vista **não há CAPS i** e o **CAPS II** atende crianças a partir de 4 anos.\n- **Interna?** Não é hospital: o cuidado é **em liberdade**. Os CAPS III e AD III têm **acolhimento noturno** (observação curta, não internação prolongada).\n- **Tem psiquiatra?** A equipe é **multiprofissional**, com médico (psiquiatra ou com formação em saúde mental), psicólogo, enfermeiro, assistente social e outros.\n- **Quanto tempo dura?** **Não há prazo fixo**: depende do **PTS** e da evolução da pessoa.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V); fichas do diretório (CAPS II, CAPS III, CAPS AD III).',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['Como ter acesso ao CAPS?', 'Quais os tipos de CAPS?'] },
    { id: 'raps-profissionais', cat: 'Profissionais',
      keys: ['diferenca entre psicologo e psiquiatra', 'psicologo ou psiquiatra', 'psicologo+psiquiatra+diferenca', 'quando procurar um psiquiatra', 'quando procurar psiquiatra', 'quando procurar um psicologo', 'psiquiatra+psicologo+qual+procurar', 'psiquiatra+psicologo+diferenca', 'encaminhar+psiquiatra', 'consulta+psiquiatra+sus', 'marcar+psiquiatra', 'psiquiatra+pelo+sus', 'como+consultar+psiquiatra'],
      text: 'A diferença entre **psicólogo** e **psiquiatra**:\n- **Psicólogo:** profissional de **Psicologia** (não é médico). Faz **escuta, psicoterapia, avaliação psicológica** e acompanhamento; **não prescreve medicamentos**.\n- **Psiquiatra:** **médico** especialista em saúde mental. Faz **diagnóstico clínico**, **prescreve medicação** e acompanha o tratamento.\n- Muitos casos precisam dos **dois**, junto com enfermagem, assistência social e terapia ocupacional: é a lógica da **equipe multiprofissional** do **CAPS**.\n- No SUS, a **consulta com psiquiatra** acontece no **CAPS** ou no **ambulatório** (em Boa Vista, o do Hospital Coronel Mota), em geral por **encaminhamento da UBS** e **regulação do município**: o CRAS/CREAS **orienta e encaminha à UBS**, e confirme o fluxo local.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V, equipe multiprofissional dos CAPS); Lei 4.119/1962 (Psicologia) e Lei 3.268/1957 (Medicina).',
      actions: [{ label: 'Abrir Saúde (RAPS)', cat: 'saude' }], follow: ['Psicoterapia gratuita: onde buscar?', 'O que é o CAPS?'] },
    { id: 'raps-parar-de-usar', cat: 'Álcool e drogas',
      keys: ['quero parar de beber', 'quero parar de usar drogas', 'quero largar as drogas', 'quero largar o alcool', 'como parar de beber', 'como parar de usar drogas', 'tratamento do alcoolismo', 'onde tratar alcoolismo', 'alcoolismo+tem+cura', 'dependencia quimica+tem+cura', 'tratamento+dependencia+quimica', 'usuario de crack', 'crack+tratamento', 'crack+tratar', 'crack+onde', 'crack+ajuda', 'usuario de alcool+tratamento', 'preciso de tratamento+drogas', 'quero me tratar+drogas', 'quero me tratar+alcool'],
      text: 'Para quem **quer parar de beber ou de usar drogas**, o caminho no SUS é:\n- **CAPS AD** (em Boa Vista, o **CAPS AD III**, 24h): **acolhimento gratuito**, **sem precisar de encaminhamento**, com **PTS**, atendimento individual, grupos, medicação e apoio à família.\n- **UBS:** avalia, acompanha casos leves e encaminha.\n- **Cuidado:** a **parada brusca do álcool** pode causar **abstinência grave** (tremores, convulsões, confusão). **Procure avaliação médica** antes de parar de vez, ou a urgência se houver sintomas fortes (SAMU **192**).\n- **Dependência** é uma condição **crônica e tratável**: **recaída** faz parte do processo e **não é fracasso**; o cuidado continua.\n- **Grupos de ajuda mútua** (Alcoólicos Anônimos, Narcóticos Anônimos) são gratuitos e complementam o tratamento.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V, CAPS AD); Política Nacional sobre Drogas; ficha do diretório (CAPS AD III).',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['O que é redução de danos?', 'Como é a internação de quem usa drogas?'] },
    { id: 'raps-familia-ad', cat: 'Família',
      keys: ['meu filho usa drogas', 'meu filho+bebe', 'minha filha usa drogas', 'filho+usa+drogas', 'filho+usando+drogas', 'familiar+usa+drogas', 'familiar+alcoolista', 'familiar+alcoolatra', 'familiar+dependente', 'marido+bebe', 'esposo+bebe', 'pai+bebe', 'familia+dependencia+quimica', 'como ajudar+usuario+drogas', 'al anon', 'nar anon'],
      text: 'Quando um **familiar usa álcool ou outras drogas**:\n- A **família também é cuidada**: o **CAPS AD** acolhe familiares, **mesmo que o usuário ainda não queira ir**, e orienta como conversar, como se proteger e como o cuidado funciona.\n- Evite **ameaças, humilhação e ultimatos**: reduzem a chance de procurar ajuda. Mantenha o **vínculo** e a **porta aberta**.\n- O tratamento **precisa da adesão** da pessoa; **internação** é exceção, só com **avaliação médica** e quando os outros recursos não bastam (Lei 10.216/2001 e Lei 13.840/2019).\n- **Risco de vida ou violência:** SAMU **192**, polícia **190**.\n- Existem grupos gratuitos de apoio a famílias, como **Al-Anon** e **Nar-Anon**.\nO CRAS/CREAS acompanha a **família** (PAIF/PAEFI) e articula com o CAPS AD.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V); Lei 13.840/2019; Lei 10.216/2001.',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }, { label: 'Ver CRAS', cat: 'social' }], follow: ['O que é redução de danos?', 'Como funciona a internação psiquiátrica?'] },
    { id: 'raps-recusa-tratamento', cat: 'Família',
      keys: ['se recusa a ir ao caps', 'nao aceita tratamento', 'nao quer se tratar', 'nao quer ir ao caps', 'nao aceita ajuda', 'recusa tratamento', 'recusa+tratamento+saude mental', 'paciente+recusa', 'resistencia ao tratamento', 'nao quer tomar remedio', 'nao quer ir ao psicologo', 'nao adere ao tratamento'],
      text: 'Quando a pessoa **recusa tratamento** em saúde mental:\n- **Autonomia:** em regra, o cuidado depende do **consentimento**. A pessoa não pode ser levada à força ao CAPS só porque a família ou o serviço quer.\n- **Construa vínculo**: escute o que ela quer, **sem julgar**, e ofereça algo **concreto e próximo** (uma consulta na UBS, um documento, uma oficina). A **busca ativa** e as **visitas domiciliares** ajudam.\n- **Peça ajuda ao CAPS/UBS**: a equipe pode fazer **visita** e **apoio à família**, mesmo sem a pessoa ir ao serviço.\n- **Exceção:** em **crise com risco** para si ou para outros, aciona-se a urgência (**192**); a **internação involuntária** só ocorre com **laudo médico** e quando os recursos extra-hospitalares são insuficientes (Lei 10.216/2001).\n- **Registre** o que foi tentado e **acompanhe a família** (PAIF/PAEFI).',
      base: 'Lei 10.216/2001 (arts. 2º, 4º e 6º); Portaria de Consolidação nº 3/2017 (Anexo V); Tipificação Nacional dos Serviços Socioassistenciais.',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['Como funciona a internação psiquiátrica?', 'Como o CRAS e o CAPS trabalham juntos?'] },
    { id: 'raps-familia-cuidador', cat: 'Família',
      keys: ['como lidar com familiar com transtorno mental', 'cuidador+transtorno mental', 'cuidador+saude mental', 'familia+esquizofrenia', 'familiar com esquizofrenia', 'familiar com transtorno mental', 'sobrecarga do cuidador', 'cuidar de pessoa com transtorno mental', 'grupo de familia+caps', 'familiar+bipolar', 'familiar+depressao+como ajudar'],
      text: 'Quem **cuida de uma pessoa com transtorno mental**:\n- A **família faz parte do cuidado**: o **CAPS** tem grupos e atendimento a familiares, e o **PTS** conta com ela.\n- Procure entender o **diagnóstico e a medicação** com a equipe de saúde; **não interrompa remédio** sem orientação médica.\n- **Cuide de quem cuida**: sobrecarga é comum. Peça **apoio na UBS/CAPS** e converse no **CRAS** (PAIF, grupos, SCFV).\n- Combine com a equipe um **plano para crises** (quem chamar, para onde ir, SAMU **192**).\n- Direitos e apoios: **BPC**, **CadÚnico**, Bolsa Família e orientação sobre **curatela** quando for o caso.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V); Lei 10.216/2001; Tipificação Nacional dos Serviços Socioassistenciais.',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }, { label: 'Ver CRAS', cat: 'social' }], follow: ['O que fazer em crise de saúde mental?', 'BPC para quem tem transtorno mental'] },
    { id: 'raps-medicamentos', cat: 'Medicamentos',
      keys: ['remedio+psiquiatrico', 'remedio controlado', 'remedios controlados', 'receita+controlado', 'medicamento controlado', 'medicamentos+saude mental', 'remedio de ansiedade', 'remedio para ansiedade', 'remedio para depressao', 'remedio+depressao+sus', 'psicotropicos', 'farmacia+saude mental', 'retirar medicamento+caps', 'receita azul', 'receita amarela', 'onde pegar remedio+psiquiatrico', 'remedio+graca+saude mental'],
      text: 'Medicamentos em **saúde mental** no SUS:\n- A **prescrição** é feita por **médico** (psiquiatra ou médico da UBS/CAPS). **Psicólogo não prescreve.**\n- Muitos psicotrópicos são **controlados** (Portaria SVS/MS 344/1998): exigem **receita especial** (notificação de receita, azul ou amarela, conforme a substância), guardada pela farmácia, e **têm prazo de validade**.\n- A **retirada gratuita** é feita na **farmácia do SUS** (UBS ou unidade indicada) ou no **CAPS**, conforme a lista de medicamentos do município (**REMUME**), que pode não ter todos os remédios.\n- **Não pare nem troque** a medicação por conta própria: converse com o médico. Efeito colateral forte: procure a equipe.\n- Se falta o medicamento, **registre** e informe a **UBS/CAPS** e a Secretaria de Saúde.',
      base: 'Portaria SVS/MS 344/1998; Portaria de Consolidação nº 3/2017.',
      actions: [{ label: 'Ver UBS', cat: 'saude' }], follow: ['Quando encaminhar para a UBS e quando para o CAPS?', 'O que é o CAPS?'] },
    { id: 'raps-matriciamento', cat: 'Atenção básica',
      keys: ['matriciamento', 'apoio matricial', 'o que e matriciamento', 'o que e apoio matricial', 'nasf', 'emulti', 'o que e nasf', 'o que e emulti', 'equipe multiprofissional+atencao basica', 'nucleo ampliado'],
      text: 'O **apoio matricial (matriciamento)** é o **suporte técnico** que uma equipe **especializada** (por exemplo, o **CAPS**) dá às equipes de **referência** da atenção básica (**UBS/ESF**), com **discussão de casos, atendimentos em conjunto e capacitação**.\n- Serve para a UBS **cuidar mais casos de saúde mental** e **encaminhar menos**, sem fila desnecessária.\n- As **equipes multiprofissionais** da atenção básica (antes **NASF-AB**) foram reorganizadas como **eMulti**, pela Portaria GM/MS 635/2023.\n- No **SUAS**, o paralelo é a **matricialidade sociofamiliar** e o trabalho em rede: reuniões de caso, **PTS e PAF** em conjunto.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V, art. 7º); Portaria GM/MS 635/2023 (eMulti).',
      actions: [{ label: 'Ver UBS', cat: 'saude' }, { label: 'Ver CAPS', cat: 'saude' }], follow: ['Como o CRAS e o CAPS trabalham juntos?', 'Saúde mental na UBS'] },
    { id: 'raps-contrarreferencia', cat: 'Encaminhamento',
      keys: ['contrarreferencia', 'contra referencia', 'o que e contrarreferencia', 'referencia e contrarreferencia', 'relatorio de encaminhamento', 'relatorio+encaminhamento', 'ficha de referencia', 'guia de encaminhamento+caps', 'como fazer encaminhamento+saude', 'encaminhamento+escrito+saude'],
      text: '**Referência e contrarreferência** são o fluxo de **ida e volta** entre os serviços:\n- **Referência:** encaminhar a pessoa para um serviço de **maior complexidade ou especialidade** (da UBS para o CAPS, do CRAS para a saúde).\n- **Contrarreferência:** o serviço que recebeu **devolve a informação e o cuidado** ao de origem (alta, plano, o que a família precisa acompanhar).\n**Relatório de encaminhamento** (CRAS/CREAS para saúde): coloque **identificação e contato**, **motivo do encaminhamento**, o que **já foi feito** e o **contato do técnico**. Registre **só o necessário** (sigilo): não repita diagnóstico nem detalhes que não são seus.\nPeça a **contrarreferência** e marque o **retorno** do caso na reunião de rede.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V); Tipificação Nacional dos Serviços Socioassistenciais (Res. CNAS 109/2009); código de ética do psicólogo (sigilo).',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['Quando encaminhar para a UBS e quando para o CAPS?', 'Como o CRAS e o CAPS trabalham juntos?'] },
    { id: 'raps-apoio-emocional', cat: 'Apoio emocional',
      keys: ['cvv', 'ligue 188', 'telefone 188', 'cvv+telefone', 'apoio emocional', 'preciso conversar com alguem', 'estou mal', 'estou muito triste', 'estou sofrendo', 'nao estou bem', 'preciso de ajuda emocional', 'preciso de ajuda psicologica', 'onde buscar ajuda psicologica', 'luto+ajuda', 'estou de luto', 'perdi alguem'],
      text: 'Se você está **mal** ou **precisa conversar**:\n- **CVV: ligue 188** (gratuito, **24 horas**), com **chat e e-mail** no site do CVV. É apoio emocional, **sigiloso**, sem julgamento.\n- **UBS:** acolhimento e acompanhamento do sofrimento (tristeza, ansiedade, insônia, luto). Diga o **bairro** e eu indico a mais próxima.\n- **CAPS:** quando o sofrimento é **intenso ou persistente**; pode ir **sem encaminhamento**.\n- **Risco de vida ou crise:** **SAMU 192**.\n- Para **luto e convivência**, o **CRAS** tem grupos e atividades.\nPedir ajuda **não é fraqueza**.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V); Lei 13.819/2019 (prevenção); CVV (188).',
      actions: [{ label: 'Ver UBS', cat: 'saude' }, { label: 'Ver CAPS', cat: 'saude' }], follow: ['Como ter acesso ao CAPS?', 'O que fazer em crise de saúde mental?'] },
    { id: 'raps-indigena', cat: 'Povos indígenas',
      keys: ['saude mental+indigena', 'indigena+saude mental', 'saude indigena+caps', 'indigena+caps', 'dsei', 'sesai', 'indigena+drogas', 'indigena+alcool', 'indigena+problema+saude+mental', 'povos indigenas+saude mental', 'indigena+psicologico'],
      text: 'A **saúde indígena** tem **subsistema próprio** no SUS (Lei 8.080/1990, arts. 19-A e seguintes), gerido pela **SESAI**, com os **Distritos Sanitários Especiais Indígenas (DSEI)**. Em Roraima atuam o **DSEI Leste** e o **DSEI Yanomami**.\n- **Indígena em aldeia:** o cuidado começa na **equipe do DSEI** (EMSI/polo-base).\n- **Indígena na cidade** (Boa Vista): **também tem direito** a **UBS, CAPS e urgência**, com atendimento **respeitoso à língua e à cultura**; use o **Tradutor** do app quando precisar.\n- **Uso de álcool e outras drogas** e **sofrimento psíquico** em comunidades pedem **articulação** entre DSEI, CAPS, CRAS/CREAS e liderança comunitária, **sem impor** modelo externo.\n- O **CadÚnico** tem campo para **povos e comunidades tradicionais** (indígenas).',
      base: 'Lei 8.080/1990 (arts. 19-A a 19-H); Lei 9.836/1999; Portaria de Consolidação nº 3/2017.',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }, { label: 'Ver CRAS', cat: 'social' }], follow: ['O que é o CAPS?', 'Como o CRAS e o CAPS trabalham juntos?'] },
    { id: 'raps-migrante', cat: 'Migrantes',
      keys: ['migrante+caps', 'migrante+saude mental', 'migrante+sus', 'venezuelano+saude', 'venezuelano+caps', 'estrangeiro+sus', 'estrangeiro+direito+sus', 'estrangeiro+saude mental', 'refugiado+saude mental', 'imigrante+saude mental', 'refugiado+sus', 'imigrante+sus', 'migrante+atendido', 'migrante+pode+ser+atendido'],
      text: 'O **SUS é universal**: **migrantes e refugiados** têm direito ao atendimento em **UBS, CAPS e urgência**, **mesmo sem documentos** ou em situação migratória irregular.\n- A **Lei de Migração (Lei 13.445/2017, art. 4º)** garante acesso a serviços públicos de saúde.\n- Na UBS, peça o **Cartão SUS**; a falta de documento **não deve ser motivo de recusa** (confirme o procedimento com a unidade).\n- **Idioma:** use o **Tradutor** do app e, se possível, **intérprete** ou mediador cultural.\n- Sofrimento psíquico ligado a **perdas, violência e deslocamento** é comum: o **CAPS** e a **UBS** acolhem; o **CRAS/CREAS** ajuda com **documentação, CadÚnico, acolhimento** e vínculos.',
      base: 'Lei 13.445/2017 (art. 4º); Constituição Federal (art. 196); Lei 8.080/1990.',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }, { label: 'Ver CRAS', cat: 'social' }], follow: ['Como ter acesso ao CAPS?', 'O que é o CAPS?'] },
    { id: 'raps-violencia', cat: 'Violência',
      keys: ['violencia+saude mental', 'vitima de violencia+psicologo', 'vitima de violencia+psicologica', 'trauma+violencia', 'violencia sexual+saude mental', 'estresse pos traumatico', 'tept', 'violencia+sofrimento psiquico', 'violencia+apoio psicologico', 'violencia+caps'],
      text: 'Pessoa que sofreu **violência** e tem **sofrimento psíquico**:\n- O cuidado começa pelo **acolhimento seguro** e pela **proteção**: ver se há **risco imediato** (190; 192 se houver lesão).\n- **Saúde:** UBS, CAPS (se houver sofrimento intenso ou persistente) e, em violência sexual, **serviço de referência** para atendimento imediato.\n- **Notificação:** casos suspeitos ou confirmados de violência contra **criança ou adolescente** devem ser comunicados ao **Conselho Tutelar** (ECA, art. 13); a violência contra a **mulher** atendida em serviço de saúde é de **notificação compulsória** (Lei 10.778/2003).\n- **SUAS:** o **CREAS** (PAEFI) acompanha a violação de direitos; o **CRAS** acompanha a família.\nO cuidado é **em rede**: saúde, assistência, Conselho Tutelar e sistema de justiça, com **sigilo** e **escuta sem revitimização**.',
      base: 'ECA (Lei 8.069/1990, art. 13); Lei 10.778/2003; Lei 13.431/2017; Portaria de Consolidação nº 3/2017.',
      actions: [{ label: 'Ver CREAS', cat: 'social' }, { label: 'Ver Conselho Tutelar', cat: 'conselho' }], follow: ['Como o CRAS e o CAPS trabalham juntos?', 'Como ter acesso ao CAPS?'] },
    { id: 'raps-tea-deficiencia', cat: 'Deficiência e TEA',
      keys: ['autismo+caps', 'tea+caps', 'tea+raps', 'autismo+raps', 'rede de cuidados da pessoa com deficiencia', 'rede de cuidados a pessoa com deficiencia', 'cer+reabilitacao', 'centro especializado em reabilitacao', 'deficiencia+raps', 'deficiencia intelectual+caps'],
      text: 'A **RAPS** e a **Rede de Cuidados à Pessoa com Deficiência** são **redes diferentes do SUS**, que se **articulam**:\n- **TEA (autismo)** e **deficiência** não são, por si, "doença mental": o cuidado é pela **UBS** e pelos serviços de **reabilitação** (Rede de Cuidados à Pessoa com Deficiência, Portaria GM/MS 793/2012, com os **CER** — Centros Especializados em Reabilitação).\n- O **CAPS** entra quando há **sofrimento psíquico, crise ou transtorno mental associado** (inclusive em criança e adolescente).\n- **Lei 12.764/2012:** a pessoa com TEA é considerada **pessoa com deficiência** para todos os efeitos legais.\n- Para serviços de **TEA** em Boa Vista, o app tem a aba **TEA** no diretório.\nO **CRAS** ajuda com **BPC**, CadÚnico e acompanhamento da família.',
      base: 'Lei 12.764/2012; Portaria GM/MS 793/2012 (Portaria de Consolidação nº 3/2017, Anexo VI); Lei 13.146/2015.',
      actions: [{ label: 'Ver TEA', cat: 'tea' }, { label: 'Ver CAPS', cat: 'saude' }], follow: ['O que é o CAPS?', 'BPC para quem tem transtorno mental'] },
    { id: 'raps-direitos-sociais', cat: 'Direitos',
      keys: ['quem tem esquizofrenia pode trabalhar', 'transtorno mental+pode+trabalhar', 'transtorno mental+trabalho+direito', 'afastamento+transtorno mental', 'auxilio doenca+transtorno mental', 'auxilio por incapacidade+transtorno mental', 'isencao+transtorno mental', 'passe livre+transtorno mental', 'bolsa familia+transtorno mental', 'beneficios+transtorno mental', 'cota pcd+transtorno mental', 'atestado+transtorno mental', 'atestado medico+transtorno',  'direitos sociais+transtorno mental'],
      text: 'Direitos e apoios de quem tem **transtorno mental**:\n- **Trabalho:** **pode trabalhar**, e transtorno mental **não é motivo para demissão ou recusa** por discriminação. Quem se enquadra como **pessoa com deficiência** (impedimento de longo prazo) pode concorrer às **vagas de cota** (Lei 8.213/1991, art. 93).\n- **Afastamento:** o **auxílio por incapacidade temporária** do **INSS** exige **perícia** e, em regra, **carência**; leve **laudo e atestado atualizados**.\n- **BPC:** para quem se enquadra como pessoa com deficiência e atende ao critério de renda.\n- **Bolsa Família:** depende da **renda per capita** e do **CadÚnico**, **não do diagnóstico**.\n- **Isenção de imposto de renda** por **alienação mental** (aposentados, Lei 7.713/1988, art. 6º, XIV) e **passe livre**/desconto no transporte: dependem de **laudo e regra local**; confirme na Receita e na prefeitura/estado.\nO **CRAS** orienta e atualiza o CadÚnico.',
      base: 'Lei 13.146/2015; Lei 8.213/1991 (art. 93); Lei 7.713/1988 (art. 6º, XIV); Lei 8.742/1993 (LOAS).',
      actions: [{ label: 'Ver CRAS', cat: 'social' }], follow: ['BPC para quem tem transtorno mental', 'O que é curatela?'] }
    ,
    { id: 'raps-cras-abordagem', cat: 'Abordagem no SUAS',
      keys: ['usuario agitado', 'usuario agitado+cras', 'usuaria agitada', 'o que nao fazer com pessoa em surto', 'nao+fazer+surto', 'abordagem+pessoa em crise', 'abordagem+surto', 'atendi+surto+cras', 'surto+cras', 'crise+cras', 'sofrimento psiquico+cras', 'acolhimento+sofrimento psiquico', 'acolher+sofrimento psiquico', 'pessoa com delirio', 'pessoa com alucinacao', 'alucinacao+fazer', 'delirio+fazer', 'pessoa falando sozinha', 'usuario desorganizado'],
      text: 'Pessoa **agitada, em surto ou com delírio** no CRAS/CREAS ou na rua:\n- **Segurança primeiro** (sua, da pessoa e de quem está perto): afaste curiosos, mantenha **saída livre** e um colega por perto.\n- **Um só profissional fala**: **voz baixa, frases curtas, tom calmo**, nome da pessoa, sem pressa. Ofereça água e um lugar sossegado.\n- **Não discuta nem confronte** delírio ou alucinação, e **não finja** que vê o que ela vê: diga que **acredita no medo e no sofrimento** dela e que quer ajudar.\n- **Não toque** sem necessidade e **evite contenção física**: contenção é ato de **equipe de saúde** treinada. Não ameace nem prometa o que não pode cumprir.\n- Veja **uso de álcool/drogas, medicação, familiar por perto**. A maioria das pessoas com sintomas psicóticos **não é violenta**.\n- **Risco para si ou para outros:** **SAMU 192** (e **190** se houver ameaça). Depois, **registre**, avise a família e **articule UBS/CAPS**.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V, Urgência e Emergência); Lei 10.216/2001; Política Nacional de Humanização do SUS.',
      actions: [{ label: 'Ver Saúde/Urgência', cat: 'hospitalar' }, { label: 'Ver CAPS', cat: 'saude' }], follow: ['Quando acionar o SAMU e quando a polícia?', 'O que fazer em crise de saúde mental?'] },
    { id: 'raps-samu-policia', cat: 'Crise e urgência',
      keys: ['quando acionar o samu', 'quando chamar o samu', 'quando ligar 192', 'samu ou policia', 'quando chamar a policia+crise', 'policia+saude mental', 'policia+crise', 'quando acionar o samu e quando a policia', 'chamar a policia+surto', 'bombeiros+saude mental'],
      text: 'Quando acionar cada um, em **crise de saúde mental**:\n- **SAMU 192:** agitação intensa, confusão, **risco de morte**, ferimento, **intoxicação** ou abstinência grave, **tentativa** de ferir a si. É o serviço de **saúde**: avalia e conduz ao HGRR ou ao serviço adequado.\n- **Polícia 190:** **violência em curso** ou **ameaça a terceiros**. **Polícia não é resposta de saúde**: peça que o **SAMU** seja acionado também, e deixe claro que é **crise em saúde mental**.\n- **Bombeiros 193:** resgate, incêndio, risco de queda ou afogamento.\n- Sem risco imediato: **UBS ou CAPS** no mesmo dia, ou **CAPS III** (acolhimento noturno só para quem já é acompanhado).\nNão tente **transportar** sozinho uma pessoa em crise: aguarde a equipe e **informe** idade, o que está acontecendo, uso de substância e medicação.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V); Política Nacional de Atenção às Urgências; fichas do diretório (SAMU e HGRR).',
      actions: [{ label: 'Ver Saúde/Urgência', cat: 'hospitalar' }], follow: ['O que fazer em crise de saúde mental?', 'Como funciona a internação psiquiátrica?'] },
    { id: 'raps-encaminhamento-recusado', cat: 'Encaminhamento',
      keys: ['ubs+nao+quer+receber', 'caps+recusou', 'recusou o encaminhamento', 'servico+recusa+atendimento', 'servico+negou+atendimento', 'fila de espera+caps', 'fila de espera+psiquiatra', 'demora+atendimento+saude mental', 'nao consegue vaga+psiquiatra', 'nao conseguiu atendimento+caps', 'ouvidoria+saude', 'disque saude', 'saude recusou', 'caps+nao+aceitou'],
      text: 'Se a **saúde recusa ou demora** a receber o encaminhamento:\n- Serviço do SUS **não pode negar acolhimento**: o caso é **avaliado e classificado**, ainda que o encaminhamento venha **incompleto**.\n- **1) Converse técnico a técnico** (telefone, reunião de rede, estudo de caso) e envie **relatório de encaminhamento** claro.\n- **2) Peça por escrito** o motivo da recusa e o **encaminhamento alternativo**; registre data, nome e resposta.\n- **3) Acione a coordenação**: gerência da UBS/CAPS e a **Secretaria de Saúde (SEMSA/SESAU)**.\n- **4) Ouvidoria do SUS: Disque Saúde 136**; também o **Conselho de Saúde**.\n- **5) Em último caso**, **Defensoria Pública** ou **Ministério Público**.\n- **Risco imediato:** não espere o fluxo: **SAMU 192**.\nA pessoa **não deve ficar sem cuidado** enquanto o fluxo se resolve: mantenha o **acompanhamento no CRAS/CREAS**.',
      base: 'Constituição Federal (art. 196); Lei 8.080/1990; Portaria de Consolidação nº 3/2017; Tipificação Nacional dos Serviços Socioassistenciais.',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }, { label: 'Ver Jurídico', cat: 'juridico' }], follow: ['O que é contrarreferência?', 'Quando encaminhar para a UBS e quando para o CAPS?'] },
    { id: 'raps-reuniao-sigilo', cat: 'SUAS e RAPS',
      keys: ['estudo de caso+caps', 'estudo de caso com o caps', 'reuniao de rede+caps', 'reuniao de rede+saude mental', 'caso compartilhado+saude', 'prontuario compartilhado', 'compartilhar informacoes+caps', 'sigilo+caps', 'passar informacoes+caps', 'informacoes do caps+cras', 'sigilo+saude mental+cras', 'caso em rede+saude'],
      text: 'Como **trabalhar o caso em rede** com o **CAPS/UBS**:\n- **Estudo de caso / reunião de rede:** defina **objetivo** (o que a rede decide), **quem participa** (técnicos de referência de cada serviço) e **quem faz o quê, até quando**; registre em ata.\n- **Compartilhe só o necessário** para o objetivo, **explique à pessoa** o que será compartilhado e, sempre que possível, com a **ciência dela**. **Diagnóstico e prontuário** são informação de **saúde**: não os repita fora do necessário.\n- **Sigilo profissional** vale entre os serviços: o código de ética e a **LGPD** pedem **finalidade, necessidade e cuidado**; exceções (risco à vida, determinação legal) seguem a norma.\n- Cada serviço tem **o seu registro** (prontuário da saúde, prontuário do SUAS); **não há prontuário único**: troque **relatórios**.\n- Combine **retorno** (contrarreferência) e quem **acompanha o PTS e o PAF**.',
      base: 'Lei 13.709/2018 (LGPD); Código de Ética Profissional do Psicólogo; Tipificação Nacional dos Serviços Socioassistenciais; Portaria de Consolidação nº 3/2017.',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }, { label: 'Ver CRAS', cat: 'social' }], follow: ['O que é contrarreferência?', 'Como o CRAS e o CAPS trabalham juntos?'] },
    { id: 'raps-transtornos', cat: 'Condições mais comuns',
      keys: ['o que e esquizofrenia', 'esquizofrenia+o+que', 'transtorno bipolar', 'bipolaridade', 'depressao+sintomas', 'sintomas de depressao', 'o que e depressao', 'o que e ansiedade', 'crise de ansiedade', 'crise de panico', 'sindrome do panico', 'transtorno de panico', 'o que e tdah', 'tdah+tratar', 'tdah+onde', 'tdah+tratamento', 'tdah+sintomas', 'transtorno de personalidade', 'borderline', 'psicose+o+que'],
      text: 'Condições mais comuns em saúde mental (**só o profissional de saúde diagnostica**; no SUAS, observe, acolha e **encaminhe sem rotular**):\n- **Depressão:** tristeza ou perda de interesse **quase todos os dias, por semanas**, com cansaço, alteração de sono e apetite, culpa. **Tratável**: UBS; CAPS se for grave.\n- **Ansiedade e pânico:** preocupação excessiva ou **crises súbitas de medo** com palpitação e falta de ar, que passam em minutos. Em **dor no peito**, procure urgência para descartar causa clínica.\n- **Transtorno bipolar:** alternância de episódios de **humor elevado** (muita energia, pouca necessidade de dormir) e de **depressão**.\n- **Esquizofrenia e psicoses:** **delírios, alucinações**, pensamento desorganizado e isolamento. Tem **tratamento e acompanhamento**; o **CAPS** é a referência.\n- **TDAH:** desatenção e agitação desde a infância; avaliação na **UBS/ambulatório** e escola; em geral **não** é porta do CAPS.\n- **Transtorno de personalidade (ex.: borderline):** instabilidade nas emoções e nos vínculos; precisa de **acompanhamento contínuo**.\nCasos leves e moderados: **UBS**. Graves, persistentes ou em crise: **CAPS** ou urgência (**192**).',
      base: 'CID-11 (OMS) e Portaria de Consolidação nº 3/2017 (Anexo V); Cadernos de Atenção Básica (Saúde Mental), Ministério da Saúde.',
      actions: [{ label: 'Ver UBS', cat: 'saude' }, { label: 'Ver CAPS', cat: 'saude' }], follow: ['Quando encaminhar para a UBS e quando para o CAPS?', 'O que fazer em crise de saúde mental?'] },
    { id: 'raps-idoso-demencia', cat: 'Pessoa idosa',
      keys: ['demencia+alzheimer', 'alzheimer+onde', 'alzheimer+ajuda', 'demencia+idoso', 'demencia+onde', 'o que e alzheimer', 'idoso+esquecimento', 'esquecimento+idoso', 'idoso+confuso', 'idoso+saude mental+cras', 'cuidador+idoso+demencia'],
      text: '**Esquecimento, confusão e perda de autonomia** em pessoa idosa podem ser **demência** (como a **doença de Alzheimer**), mas também **depressão, efeito de remédio, infecção** ou outras causas: **só a avaliação de saúde** esclarece.\n- **Procure a UBS**: avaliação clínica e encaminhamento para **geriatria, neurologia ou psiquiatria** pela regulação.\n- **Crise** (agitação, risco de queda ou de fuga): **SAMU 192**.\n- **SUAS (CRAS):** **SCFV para idosos**, orientação a **cuidadores**, **CadÚnico**, **BPC** (65 anos ou mais, ou pessoa com deficiência, com critério de renda). **Abandono, maus-tratos ou negligência**: **CREAS**, Disque 100 e Ministério Público (Estatuto da Pessoa Idosa).\n- **Cuide de quem cuida**: sobrecarga do cuidador é comum; peça apoio na UBS e no CRAS.',
      base: 'Lei 10.741/2003 (Estatuto da Pessoa Idosa); Lei 8.742/1993 (LOAS); Portaria de Consolidação nº 3/2017.',
      actions: [{ label: 'Ver UBS', cat: 'saude' }, { label: 'Ver CRAS', cat: 'social' }], follow: ['Como lidar com familiar com transtorno mental?', 'BPC para quem tem transtorno mental'] },
    { id: 'raps-perinatal', cat: 'Gestantes e puérperas',
      keys: ['depressao pos parto', 'depressao pos-parto', 'depressao puerperal', 'baby blues', 'puerperio+saude mental', 'puerpera+saude mental', 'gestante+saude mental', 'gestante+depressao', 'gestante+ansiedade', 'gestante+usuaria+drogas', 'gestante+drogas', 'gestante+alcool', 'luto perinatal', 'perda gestacional', 'aborto espontaneo+luto', 'mulher+depressao+pos+parto'],
      text: '**Saúde mental na gestação e no pós-parto:**\n- **"Baby blues":** tristeza e choro leve nos **primeiros dias após o parto**, que costumam **passar em cerca de duas semanas**. Se **passa disso**, é intenso ou atrapalha o cuidado, pode ser **depressão pós-parto**: **tem tratamento**.\n- **Procure a UBS** (pré-natal e consulta de puerpério) ou o **CAPS** se for grave. **Pensamentos de machucar a si ou ao bebê**: **urgência** (**192**) e **CVV 188**.\n- **Gestante que usa álcool ou outras drogas:** **mantenha o pré-natal** e o **vínculo**: a UBS e o **CAPS AD** cuidam juntos; **sem punição nem julgamento**. A proteção do bebê é decidida **caso a caso** pela rede (saúde, assistência, Conselho Tutelar), **sem presumir** incapacidade da mãe.\n- **Luto perinatal** (perda na gestação ou do bebê): merece **acolhimento e tempo**; UBS, grupos e CRAS.',
      base: 'Portaria de Consolidação nº 3/2017; Cadernos de Atenção Básica (Pré-natal de Baixo Risco e Saúde Mental), Ministério da Saúde; ECA (Lei 8.069/1990).',
      actions: [{ label: 'Ver UBS', cat: 'saude' }, { label: 'Ver CAPS', cat: 'saude' }], follow: ['Preciso conversar com alguém', 'O que é redução de danos?'] },
    { id: 'raps-escola', cat: 'Crianças e adolescentes',
      keys: ['escola+encaminha+aluno', 'aluno+ansiedade', 'aluno+ansioso', 'aluno+agressivo', 'crianca+agressiva', 'crianca+agressiva+procurar', 'adolescente+ideias', 'psicologo+escola', 'psicologo na escola', 'saude mental+escola', 'programa saude na escola', 'pse+saude mental', 'crianca+ansiosa', 'adolescente+isolado', 'adolescente+triste'],
      text: '**Criança ou adolescente com sofrimento psíquico** (ansiedade, agressividade, isolamento):\n- **Acolha e converse** com a família; evite rótulos ("problemático") e **não encaminhe só pelo comportamento**: escute o que acontece em casa, na escola e nas redes.\n- **UBS** (e o **Programa Saúde na Escola, PSE**, Decreto 6.286/2007): avaliação e encaminhamento. **Sofrimento grave ou persistente:** **CAPS**; em Boa Vista **não há CAPS infantil** e o **CAPS II** atende a partir de 4 anos.\n- **Suspeita de violência, negligência ou abuso:** **Conselho Tutelar** (ECA, art. 13) e **CREAS**.\n- **Risco de vida:** **SAMU 192**; apoio: **CVV 188**.\n- **Psicologia e serviço social na educação básica** estão previstos na **Lei 13.935/2019**; a escola, a UBS e o CRAS devem **atuar em rede**.',
      base: 'Decreto 6.286/2007 (PSE); Lei 13.935/2019; ECA (Lei 8.069/1990); Portaria de Consolidação nº 3/2017.',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }, { label: 'Ver Conselho Tutelar', cat: 'conselho' }], follow: ['Como ter acesso ao CAPS?', 'Como o CRAS e o CAPS trabalham juntos?'] },
    { id: 'raps-jogos-telas', cat: 'Álcool e drogas',
      keys: ['dependencia de jogos', 'vicio em apostas', 'vicio em jogos', 'jogo patologico', 'apostas+bets', 'bets+vicio', 'bets+tratamento', 'apostas+tratamento', 'apostas+onde+tratar', 'viciado em apostas', 'vicio em celular', 'dependencia de celular', 'dependencia de internet', 'vicio em internet', 'uso excessivo+celular', 'jogos eletronicos+vicio'],
      text: '**Apostas (bets) e jogos eletrônicos:**\n- O **transtorno de jogo** (apostas) e o **transtorno de jogos eletrônicos** constam na **CID-11**: perda de controle, prioridade ao jogo e **prejuízo** na vida, mesmo com dano.\n- **Uso de celular e internet** em excesso **não é diagnóstico por si**: o que conta é o **sofrimento e o prejuízo** (sono, escola, trabalho, vínculos).\n- **Onde buscar:** **UBS** (avaliação) e **CAPS** nos casos graves ou com depressão, ansiedade ou uso de drogas; em Boa Vista o diretório **não traz serviço específico** para isso.\n- **Apostas:** a **Lei 14.790/2023** regula as apostas e **proíbe menores de 18 anos**. **Endividamento**: o **CRAS** orienta sobre renda e benefícios; procure também o **Procon**.\n- **Jogadores Anônimos** é grupo gratuito de ajuda mútua.',
      base: 'CID-11 (OMS); Lei 14.790/2023; Portaria de Consolidação nº 3/2017.',
      actions: [{ label: 'Ver UBS', cat: 'saude' }, { label: 'Ver CAPS', cat: 'saude' }], follow: ['Como ter acesso ao CAPS?', 'O que é redução de danos?'] },
    { id: 'raps-alta-hospitalar', cat: 'Internação',
      keys: ['alta hospitalar psiquiatrica', 'alta do hospital psiquiatrico', 'alta+hospital+psiquiatrico', 'pos alta+psiquiatrica', 'pos alta+saude mental', 'depois da internacao psiquiatrica', 'saiu da internacao psiquiatrica', 'paciente teve alta+psiquiatrico', 'alta+hgrr+saude mental'],
      text: 'Depois da **alta de internação psiquiátrica**, as primeiras semanas pedem **mais cuidado**:\n- A **alta deve ser combinada** com o **CAPS/UBS** do território, com **consulta de seguimento marcada**, **receita e medicação** em mãos e **plano para crises**.\n- **Família orientada** sobre sinais de piora, medicação e **a quem recorrer** (CAPS; SAMU **192**).\n- Se a pessoa **faltar** ao primeiro retorno, faça **busca ativa** (telefone, visita compartilhada com o CAPS).\n- **SUAS:** documentos, **CadÚnico**, **BPC**, vínculos e moradia; se não há família ou moradia, veja **Residência Terapêutica** (egresso de longa internação) e **acolhimento**.\n- **Peça a contrarreferência** do hospital ao serviço de origem.',
      base: 'Lei 10.216/2001 (art. 4º); Portaria de Consolidação nº 3/2017 (Anexo V, Atenção Hospitalar e Desinstitucionalização).',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['O que são Residências Terapêuticas?', 'O que é contrarreferência?'] },
    { id: 'raps-caps-atividades', cat: 'CAPS',
      keys: ['caps+faz+visita', 'caps+visita+domiciliar', 'visita domiciliar do caps', 'atendimento domiciliar+caps', 'caps+domicilio', 'visita compartilhada+caps', 'oficina terapeutica', 'oficinas terapeuticas', 'arteterapia', 'terapia comunitaria', 'o que se faz no caps', 'atividades do caps', 'grupo terapeutico+caps', 'o que tem no caps'],
      text: 'O que o **CAPS** oferece (conforme o **PTS**):\n- **Atendimento individual**: psiquiatria, psicologia, enfermagem, serviço social e outros.\n- **Grupos e oficinas terapêuticas**: expressivas (arte, música, **arteterapia**), de **geração de renda**, de alfabetização e de convivência.\n- **Atendimento à família** e grupos de familiares.\n- **Atendimento domiciliar** e **visita**: o CAPS **pode ir até a casa** da pessoa, sobretudo na **busca ativa** de quem faltou ou na **crise**. O CRAS/CREAS pode fazer **visita compartilhada** com o CAPS.\n- **Ações comunitárias** e de **inclusão social**, como a **terapia comunitária** (roda de conversa), também comum em UBS e CRAS.\n- **Acolhimento noturno** (CAPS III e AD III) e **medicação**.',
      base: 'Portaria de Consolidação nº 3/2017 (Anexo V, art. 7º) e Portaria MS 336/2002 (atividades dos CAPS).',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['Como ter acesso ao CAPS?', 'O que é o PTS?'] },
    { id: 'raps-ordem-judicial', cat: 'Justiça',
      keys: ['juiz determinou tratamento', 'juiz determinou internacao', 'tratamento obrigatorio', 'tratamento compulsorio', 'ordem judicial+internacao', 'ordem judicial+tratamento', 'determinacao judicial+tratamento', 'internacao compulsoria+juiz', 'justica+mandou+tratamento', 'medida protetiva+saude mental', 'oficio+juiz+caps'],
      text: 'Quando a **Justiça determina tratamento ou internação**:\n- A **internação compulsória** é **determinada pelo juiz competente** (Lei 10.216/2001, art. 9º) e, como toda internação, exige **laudo médico** circunstanciado. O **serviço de saúde cumpre e informa** o juízo; **o SUAS não executa** a internação.\n- **Tratamento em meio aberto** (CAPS, UBS) é **a regra**, também nas decisões judiciais (Resolução CNJ 487/2023).\n- **Seu papel:** confirmar o **teor da decisão** (prazos e quem deve cumprir), **encaminhar** ao CAPS/UBS e **responder ofícios** do juízo **só com o necessário** (sigilo).\n- **Dúvida** sobre o cumprimento: **Vara responsável**, **Defensoria Pública** ou **Ministério Público**.\nO **juízo não substitui** a avaliação da saúde sobre **como** tratar.',
      base: 'Lei 10.216/2001 (arts. 6º e 9º); Resolução CNJ 487/2023; Lei 13.840/2019.',
      actions: [{ label: 'Ver Jurídico', cat: 'juridico' }, { label: 'Ver CAPS', cat: 'saude' }], follow: ['Como funciona a internação psiquiátrica?', 'O que é a Política Antimanicomial do Judiciário?'] },
    { id: 'raps-particular-plano', cat: 'Rede privada',
      keys: ['internacao em clinica particular', 'clinica particular+internacao', 'clinica particular+saude mental', 'plano de saude+internacao+psiquiatrica', 'plano de saude+saude mental', 'plano de saude+psicologo', 'convenio+saude mental', 'plano de saude+cobre+psiquiatrica', 'plano de saude+nega+internacao'],
      text: '**Plano de saúde e clínica particular** em saúde mental:\n- **Cobertura** depende do **contrato**, do **Rol de Procedimentos da ANS** e da **carência**: confirme na **operadora**. Se **negar**, peça a **negativa por escrito** e reclame à **ANS** (**Disque ANS 0800 701 9656**); a **Defensoria Pública** também orienta.\n- **Clínica particular** precisa de **licença da Vigilância Sanitária** e de **responsável técnico médico**. **Internação involuntária** exige **laudo médico** e **comunicação ao Ministério Público em até 72 horas**, **também na rede privada** (Lei 10.216/2001).\n- **Comunidade terapêutica** não é hospital: veja o verbete específico. **Maus-tratos ou cárcere:** **Disque 100** e **Ministério Público**.\n- O **SUS** continua disponível para quem tem plano: **CAPS e UBS** não exigem que a pessoa não tenha convênio.',
      base: 'Lei 9.656/1998 (planos de saúde); Lei 10.216/2001 (arts. 6º e 8º); Agência Nacional de Saúde Suplementar (ANS).',
      actions: [{ label: 'Ver Jurídico', cat: 'juridico' }], follow: ['Como funciona a internação psiquiátrica?', 'O que é uma comunidade terapêutica?'] },
    { id: 'raps-interior', cat: 'Roraima',
      keys: ['saude mental+interior', 'caps+interior', 'raps+interior', 'caps nos municipios', 'quantos caps+roraima', 'quantos caps tem em roraima', 'quais municipios tem caps', 'municipios+com+caps', 'caps+do+interior', 'saude mental+municipios+roraima', 'caps+cada+municipio'],
      text: 'A **RAPS no interior de Roraima** (conforme o diretório do app, dados CNES): constam **7 CAPS** nos municípios de **Alto Alegre, Bonfim, Cantá, Caracaraí, Mucajaí, Pacaraima e Rorainópolis**.\n- Quase todos são **CAPS I** (porte menor): atendem **transtornos mentais graves e persistentes** e **necessidades decorrentes do uso de álcool e outras drogas**, para **todas as faixas etárias**. Atenção: **CAPS I** (com "I" maiúsculo, o porte) **não é** o **CAPS i** (infantojuvenil).\n- **Pacaraima** e **Bonfim** ficam na **fronteira** (Venezuela e Guiana): veja também o verbete sobre **migrantes**.\n- Os **demais municípios** não constam no diretório com CAPS: o cuidado fica com a **UBS** e a **rede estadual** (Boa Vista). **Confirme** com a Secretaria de Saúde do município.\n- **Urgência:** **SAMU 192**; casos graves podem ser **regulados** para o **HGRR**, em Boa Vista.\nPara endereço e telefone, use **Ver CAPS** ou pergunte pelo município.',
      base: 'Fichas do diretório (js/data.js, dados CNES); Portaria de Consolidação nº 3/2017 (Anexo V).',
      actions: [{ label: 'Ver CAPS', cat: 'saude' }], follow: ['Quais os tipos de CAPS?', 'Como a RAPS funciona em Boa Vista?'] }
  ];
  RAPS_BASE.forEach(function (e) {
    e.raps = true;
    // chave "a b+c" vale como as palavras a, b e c juntas (o índice compara palavra por palavra)
    e.keys = e.keys.map(function (k) { return k.indexOf('+') > -1 ? k.split('+').join(' ').split(' ').filter(Boolean).join('+') : k; });
  });
  var PSI_E_PAIF = PSI_BASE.concat(PAIF_BASE, CAD_BASE, RAPS_BASE);
  var psiIndex = null;
  // Erro de digitação (comum no celular): se a pergunta não bateu em nenhum verbete, troca cada palavra desconhecida
  // pela palavra do vocabulário dos verbetes que está a 1 letra de distância (2 em palavras longas) e tenta de novo.
  var psiVocab = null;
  var SIGLAS_ERRADAS = { paiff: 'paif', paifs: 'paif', piaf: 'paif', paaif: 'paif', paef: 'paefi', paefy: 'paefi', paeffi: 'paefi', paefii: 'paefi', scvf: 'scfv', sfcv: 'scfv', scfvv: 'scfv', craz: 'cras', crass: 'cras', creaz: 'creas', paff: 'paf' };
  function distLetras(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (j = 1; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) {
      for (j = 1; j <= b.length; j++) {
        var c = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }
  function corrigeDigitacao(n) {
    if (!psiVocab) {
      psiVocab = {};
      PSI_E_PAIF.forEach(function (e) { e.keys.forEach(function (k) { norm(k.replace(/\+/g, ' ')).split(' ').forEach(function (w) { if (w.length >= 5) psiVocab[w] = 1; }); }); });
    }
    var lista = Object.keys(psiVocab), mudou = false;
    var out = n.split(' ').map(function (t) {
      if (SIGLAS_ERRADAS[t]) { mudou = true; return SIGLAS_ERRADAS[t]; }
      if (t.length < 6 || psiVocab[t] || APP_WORDS[t] || /^\d/.test(t)) return t;
      var max = t.length >= 9 ? 2 : 1, melhor = null, md = max + 1, empate = false;
      for (var i = 0; i < lista.length; i++) {
        var dd = distLetras(t, lista[i], max);
        if (dd < md) { md = dd; melhor = lista[i]; empate = false; } else if (dd === md && dd <= max && lista[i] !== melhor) empate = true;
      }
      if (melhor && md <= max && !empate) { mudou = true; return melhor; }
      return t;
    }).join(' ');
    return mudou ? out : n;
  }
  function psiScore(text) {
    var r = psiScoreBruto(text);
    if (r.score >= 3) return r;
    var n = norm(text), f = corrigeDigitacao(n);
    if (f !== n) { var r2 = psiScoreBruto(f); if (r2.score >= 3) return r2; }
    return r;
  }
  function psiScoreBruto(text) {
    if (!psiIndex) psiIndex = PSI_E_PAIF.map(function (g) { return { g: g, keys: g.keys.map(function (k) { return k.indexOf('+') > -1 ? { all: k.split('+').map(norm) } : { phrase: norm(k) }; }) }; });
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
      reply: entry.text, mood: 'info', badge: (entry.raps ? 'Base RAPS · ' : entry.cad ? 'Base CadÚnico · ' : entry.paif ? 'Base PAIF · ' : 'Base do psicólogo no SUAS · ') + entry.cat,
      note: 'Base: ' + entry.base + ' Conferido em ' + (entry.raps ? RAPS_REV : entry.cad ? CAD_REV : entry.paif ? PAIF_REV : PSI_REV) + '; normas mudam, confirme a versão vigente.',
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
  function reset() { session.history = []; session.units = []; session.terrUlt = null; session.munUlt = null; session.pendente = ''; session.ctx = novoCtx(); session.aguardando = false; session.turno = 0; session.ultContato = null; session.ult = null; session.aprPend = null; }
  var MAX_HIST_LOCAL = 40;    // mensagens guardadas na página (só na memória; apagadas ao trancar o app)
  function campoCtx(v, max) {
    v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return v && v.length <= max && !piiBlock(v) && /^[A-Za-zÀ-ÿ0-9 .,'\-ºª\/()]*$/.test(v) ? v : '';
  }
  // Pergunta que carrega assunto: tem pelo menos 3 palavras e não é só "e o horário?" ou um cumprimento.
  function carregaAssunto(t) {
    var n = norm(t);
    return n.split(' ').length >= 3 && !/^(e|mas|entao|ou|agora)\b/.test(n) && !/^(oi|ola|bom dia|boa tarde|boa noite|obrigad\w+|valeu)\b/.test(n) && !pedidoSobre(t);
  }
  // Pedido SOBRE a resposta que acabou de sair ("continue", "tem certeza?", "de onde tirou isso?"): quem sabe tratar é o Paulus (v0.11),
  // e só com as palavras da pessoa, por isso a IA de reescrita não pode tocar nele. Devolve 'continuar' | 'contestacao' | 'porque' | ''.
  // Sem o Paulus carregado devolve '' e tudo segue como antes.
  var RESPOSTA_FALSA = [{ papel: 'argo', texto: '-' }];
  function pedidoSobre(t, historico) {
    try {
      var P = typeof Paulus !== 'undefined' ? Paulus : null;
      return P && P.pedido && typeof P.pedido.sobreResposta === 'function' ? (P.pedido.sobreResposta(String(t || ''), historico || RESPOSTA_FALSA) || '') : '';
    } catch (e) { return ''; }
  }
  // Vale para a conversa em andamento: só com resposta anterior no histórico.
  function seguimento(text) { return pedidoSobre(text, session.history); }
  // A pergunta de verdade a que o pedido se refere: a última da pessoa que não seja outro pedido sobre a resposta.
  // As fichas do diretório, o panorama e a base do app dessa pergunta são os que a IA precisa para reconferir ou continuar.
  function assuntoAnterior() {
    for (var k = session.history.length - 1; k >= 0; k--) {
      var h = session.history[k];
      if (h.papel === 'usuario' && h.texto && h.texto.length >= 6 && !pedidoSobre(h.texto)) return h.texto;
    }
    return '';
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
    try { aprNota(userText, units); } catch (e) { /* aprender é opcional */ }
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
    // "continue", "tem certeza?", "de onde tirou isso?" não trazem assunto: fichas, panorama e base do app vêm da pergunta anterior
    // (a IA recebe a pergunta do jeito que a pessoa escreveu, em "pergunta").
    var tx = seguimento(text) ? (assuntoAnterior() || text) : text;
    var ampla = isAmpla(tx);
    var ctx = aiContext(tx, opts.tabCat, ampla);
    var terr = municipioFichas(tx), soMun = terr.length > 0;
    if (!soMun) terr = territorioFichas(tx);
    if (terr.length) {
      var nomes = asSet(terr.map(function (f) { return f.nome; }));
      // município do interior: só as unidades dele (as outras fichas viram ruído)
      ctx = { fichas: soMun ? terr.slice(0, 10) : terr.concat(ctx.fichas.filter(function (f) { return !nomes[f.nome]; })).slice(0, 10), total: ctx.total };
    }
    var pan = '';
    if (ampla) {
      pan = panorama();
      var nq = norm(tx);
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
      base: baseApp(tx),
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
  // ---------------------------------------------------------------------
  // ACABAMENTO DA RESPOSTA DA IA
  // Modelos pequenos escrevem marcação demais, repetem frases, abrem com enrolação ("Claro! Ótima pergunta!"),
  // fecham com fórmula pronta e, quando batem no limite de tokens, param no meio da frase. cleanAI conserta isso
  // sem mexer no conteúdo: só marcação, repetição, enrolação e ponta cortada. É idempotente (limpar duas vezes dá o mesmo).
  // A linha "SUGESTÕES: a | b | c" fica intacta no fim (quem a separa é separarSugestoes).
  // ---------------------------------------------------------------------
  var MAX_RESPOSTA = 2400;
  var RE_PICTO = /[\uD83C-\uD83E][\uDC00-\uDFFF]|[☀-➿⭐⭕️‍⃣]/g;
  var RE_ABERTURA = /^(?:claro|certo|certamente|com certeza|(?:[óo]tima|boa|excelente|interessante) pergunta|entendi|entendido|perfeito|[óo]timo|ok|okay|sem problemas?|pois n[ãa]o|ol[áa]|oi)\s*[!.,:;]+\s*/i;
  var RE_FECHO = /^(?:espero (?:ter )?ajudado|espero que (?:isso|essa resposta|esta resposta|tenha)[^.!?\n]{0,60}|(?:se|caso) (?:precisar|tiver|quiser|houver)[^.!?\n]{0,90}(?:perguntar|chamar|avisar|falar|ajudar|ajudo)[^.!?\n]{0,30}|fico [àa] disposi[çc][ãa]o[^.!?\n]{0,40}|estou [àa] disposi[çc][ãa]o[^.!?\n]{0,40}|qualquer d[úu]vida[^.!?\n]{0,60}|[ée] s[óo] (?:perguntar|chamar|avisar)[^.!?\n]{0,40})\s*[.!]*\s*(?:[\uD83C-\uD83E][\uDC00-\uDFFF]|[☀-➿])?\s*$/iu;
  var RE_PONTA_SOLTA = /(?:[,;(\-–—/]|\b(?:de|da|do|das|dos|e|ou|a|o|as|os|em|no|na|nos|nas|para|pra|por|com|sem|que|se|um|uma|ao|aos|à|às|como|ao|pelo|pela|entre|sobre|seu|sua|seus|suas|mais|muito|ser|foi|são|é|também|quando|onde|qual)) *$/i;

  function sentencasDe(linha) { return linha.match(/[^.!?]+[.!?]+["”)]*\s*|[^.!?]+$/g) || [linha]; }
  function chaveFrase(x) { return norm(x).replace(/\s+/g, ' ').trim(); }

  function cleanAI(text) {
    var t = String(text == null ? '' : text).replace(/\r/g, '');
    // a linha de sugestões (SUGESTÕES: a | b | c) sai antes e volta intacta no fim
    var tail = '', ms = t.match(/(?:^|\n)[ \t]*(?:\*\*)?sugest(?:õ|o)es(?:\*\*)?[ \t]*:/i);
    if (ms) { tail = t.slice(ms.index).replace(/^\n+/, ''); t = t.slice(0, ms.index); }

    // raciocínio vazado e rótulos de contexto
    t = t.replace(/<(think|thinking|reasoning|raciocinio|reflexao)>[\s\S]*?<\/\1>/gi, '')
      .replace(/<(think|thinking|reasoning)>[\s\S]*$/i, '');
    var fecha = t.search(/<\/(think|thinking|reasoning)>/i);
    if (fecha > -1) t = t.slice(t.indexOf('>', fecha) + 1);
    t = t.replace(/<\/?(?:fichas?|normas?|panorama|pergunta|historico|resposta|contexto|base|argo|paulus|assistant|answer)>/gi, '')
      .replace(/^\s*(?:argo|paulus|resposta|assistente)\s*:\s*/i, '')
      .replace(/^```[a-z]*\s*$/gim, '').replace(/`+/g, '');

    // emoji de enfeite (o tom do Paulus é sem emoji; o aviso ⚠ é mantido)
    t = t.replace(/⚠️?/g, '\u0001').replace(RE_PICTO, '').replace(/\u0001/g, '⚠️');

    var linhas = t.split('\n').map(function (ln) { return ln.replace(/[ \t]+$/, ''); });
    var out = [];
    linhas.forEach(function (ln) {
      if (/^\s*(?:[-*_=]\s*){3,}$/.test(ln)) return;                                   // linha horizontal
      if (/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(ln) && ln.indexOf('|') > -1) return;      // |---|---|
      var tb = ln.match(/^\s*\|(.+)\|?\s*$/);                                          // | a | b | → - a — b
      if (tb) { var cel = tb[1].split('|').map(function (c) { return c.trim(); }).filter(Boolean); if (!cel.length) return; ln = '- ' + cel.join(' — '); }
      var h = ln.match(/^\s*#{1,6}\s*(.+?)\s*#*\s*$/);                                 // título vira linha em negrito
      if (h) { var ht = h[1].replace(/\*\*/g, '').replace(/[:：]\s*$/, ''); ln = ht.length <= 80 ? '**' + ht + '**' : ht; }
      ln = ln.replace(/^\s*[•·▪◦‣–*+]\s+(?!\*)/, '- ').replace(/^\s+(?=-\s)/, '')       // marcadores variados → "- "
        .replace(/^\s*[—]\s+(?=\S)/, '- ')
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')                  // [texto](url) → texto (url)
        .replace(/__([^_\n]+)__/g, '**$1**')
        .replace(/(^|[^*\w])\*([^*\s][^*\n]*?[^*\s]|[^*\s])\*(?![*\w])/g, '$1$2');       // *itálico* → texto
      var n = (ln.match(/\*\*/g) || []).length;                                        // negrito aberto e não fechado
      if (n % 2) { var k = ln.lastIndexOf('**'); ln = ln.slice(0, k) + ln.slice(k + 2); }
      out.push(ln);
    });
    t = out.join('\n').replace(/[ \t]{3,}/g, '  ').replace(/\n{3,}/g, '\n\n').trim();

    // enrolação de abertura: só sai se a resposta tiver conteúdo depois dela
    var ab = t.match(RE_ABERTURA);
    if (ab && t.length - ab[0].length >= 40) t = t.slice(ab[0].length).replace(/^./, function (c) { return c.toUpperCase(); });
    // fecho de fórmula ("Espero ter ajudado!", "Se precisar, é só perguntar"): só sai se sobrar resposta
    var ls = t.split('\n');
    while (ls.length > 1 && !ls[ls.length - 1].trim()) ls.pop();
    if (ls.length > 1 && RE_FECHO.test(ls[ls.length - 1].trim()) && ls.slice(0, -1).join('\n').length >= 120) ls.pop();
    else if (ls.length >= 1) {                                                         // fecho na mesma linha, depois de um ponto
      var ult = ls[ls.length - 1], fr = sentencasDe(ult);
      if (fr.length > 1 && RE_FECHO.test(fr[fr.length - 1].trim()) && ls.join('\n').length - fr[fr.length - 1].length >= 120) ls[ls.length - 1] = fr.slice(0, -1).join('').trim();
    }
    t = ls.join('\n').trim();

    // repetição (laço do modelo): linha ou frase igual a uma já escrita, quando tem 30+ caracteres
    var vistas = {};
    t = t.split('\n').map(function (ln) {
      if (/^\s*(?:-|\d{1,2}[.)])\s/.test(ln)) {                                         // item de lista: compara o item inteiro
        var ki = chaveFrase(ln); if (ki.length >= 30) { if (vistas[ki]) return null; vistas[ki] = 1; }
        return ln;
      }
      var keep = sentencasDe(ln).filter(function (f) {
        var kf = chaveFrase(f); if (kf.length < 30) return true;
        if (vistas[kf]) return false; vistas[kf] = 1; return true;
      }).join('').trim();
      return keep;
    }).filter(function (ln, i, a) { return ln !== null && !(ln === '' && (i === 0 || a[i - 1] === '')); }).join('\n').trim();

    // limite de tamanho: corta no fim de um parágrafo ou frase, nunca no meio de uma palavra
    if (t.length > MAX_RESPOSTA) {
      var corte = t.slice(0, MAX_RESPOSTA), par = corte.lastIndexOf('\n'), fim = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('! '), corte.lastIndexOf('? '));
      var pos = Math.max(par, fim + 1);
      t = (pos >= MAX_RESPOSTA * 0.5 ? corte.slice(0, pos) : corte.replace(/\s+\S*$/, '') + '…').trim();
    }
    // ponta cortada pelo limite de tokens: some a frase pela metade (só com sinal forte, para não comer resposta completa)
    var lns = t.split('\n'), ultima = lns[lns.length - 1] || '';
    var abre = (ultima.match(/\(/g) || []).length > (ultima.match(/\)/g) || []).length;
    var sinal = t.length >= 80 && !/[.!?:…)”"»\]]\**$/.test(ultima) && (RE_PONTA_SOLTA.test(ultima) || abre || (t.length >= MAX_RESPOSTA - 150 && /[a-zà-ú]$/.test(ultima)));
    if (sinal) {
      var tm = ultima.match(/^([\s\S]*[.!?])["”)]*\s/), antes = lns.slice(0, -1).join('\n');
      var resto = tm ? (antes ? antes + '\n' : '') + tm[1] : antes;
      if (resto.trim().length >= 40) t = resto.trim();
    }
    return (t + (tail ? '\n' + tail.trim() : '')).trim();
  }
  // Texto PARCIAL durante o streaming: esconde o que o final vai tirar (sugestões, raciocínio) e a marcação que ainda
  // não faz sentido (# no começo, "* " de lista, ``` ), para o texto não "pular" quando a resposta termina.
  function cleanPartial(text) {
    var t = ocultarSugestoes(String(text == null ? '' : text).replace(/\r/g, ''));
    t = t.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').replace(/<(think|thinking|reasoning)>[\s\S]*$/i, '');
    var fecha = t.search(/<\/(think|thinking|reasoning)>/i);
    if (fecha > -1) t = t.slice(t.indexOf('>', fecha) + 1);
    t = t.replace(/<\/?[a-z]{2,10}>/gi, '').replace(/`+/g, '')
      .replace(/^\s*#{1,6}\s*/gm, '').replace(/^\s*[•·▪◦‣*+]\s+(?!\*)/gm, '- ')
      .replace(/^\s*[-*_=]{3,}\s*$/gm, '').replace(RE_PICTO, function (m) { return m === '⚠' ? m : ''; });
    // negrito aberto na última linha (ainda sendo escrito): some o "**" solto até fechar
    var nl = t.lastIndexOf('\n'), ult = t.slice(nl + 1);
    if ((ult.match(/\*\*/g) || []).length % 2) { var k = ult.lastIndexOf('**'); t = t.slice(0, nl + 1) + ult.slice(0, k) + ult.slice(k + 2); }
    return t.replace(/^\s+/, '');
  }

  // ---------------------------------------------------------------------
  // CONFERÊNCIA DA RESPOSTA DA IA (contra invenção)
  // verifyPhones já pegava telefone que não está no diretório. Aqui entram: nome de CRAS/CREAS/UBS/CAPS que não
  // existe no diretório e fatos de Boa Vista que a IA costuma errar. É aviso suave (a pessoa confere), nunca bloqueio.
  // ---------------------------------------------------------------------
  var nomesUnidIdx = null;
  var UNID_GENERICAS = asSet(('referencia territorio territorial basica saude social especializado especializada municipal estadual ' +
    'federal publica publico mais proximo proxima responsavel local regional itinerante volante conveniada geral infantil adulto ' +
    'adulta mulher idoso crianca adolescente unidade servico equipe equipamento equipamentos').split(' '));
  function indiceNomesUnidades() {
    if (nomesUnidIdx) return nomesUnidIdx;
    nomesUnidIdx = { CRAS: [], CREAS: [], UBS: [], CAPS: [] };
    data.forEach(function (d) {
      [d.name, d.fullName].forEach(function (nm) {
        var n = norm(nm || ''), m = n.match(/^(cras|creas|ubs|caps)\b\s*(.*)$/);
        if (!m) return;
        var toks = m[2].split(' ').filter(function (x) { return x && !STOP[x] && !/^(dr|dra|prof|profa|enf|sr|sra)$/.test(x); });
        nomesUnidIdx[m[1].toUpperCase()].push(asSet(toks));
      });
    });
    return nomesUnidIdx;
  }
  function unidadesDesconhecidas(text) {
    var idx = indiceNomesUnidades(), achados = [];
    var re = /\b(CRAS|CREAS|UBS|CAPS)\b((?:\s+(?:AD|III|II|I|IV|i|ad)\b)*)((?:\s+(?:(?:d[aeo]s?)\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9][\wÀ-ÿ.'º-]*){1,4})/g, m;
    var s = String(text || ''), ABREV = /^(dr|dra|prof|profa|enf|sr|sra)$/;
    while ((m = re.exec(s))) {
      var tipo = m[1], toks = [], bruto = [];
      var palavras = m[3].trim().split(/\s+/);
      for (var i = 0; i < palavras.length; i++) {
        var w = palavras[i], fim = /[.,;:!?]+$/.test(w), limpa = w.replace(/[.,;:!?]+$/, ''), nw = norm(limpa);
        if (/^(atende|fica|funciona|oferece|presta|realiza|possui|tem|esta|sao|foi|era)$/.test(nw)) break;
        bruto.push(limpa);
        if (nw && !STOP[nw] && !ABREV.test(nw) && !UNID_GENERICAS[nw]) toks.push(nw);
        // ponto final de frase encerra a menção; "Dr." / "Prof." não
        if (fim && !(ABREV.test(nw) && /\.$/.test(w)) && !/^(?:[A-Za-zÀ-ÿ]\.)+$/.test(w)) break;
      }
      if (!toks.length) continue;
      var lista = idx[tipo] || [];
      var subconjunto = lista.some(function (set) { return toks.every(function (x) { return set[x]; }); });
      if (subconjunto) continue;
      var primeiro = lista.some(function (set) { return set[toks[0]]; });
      // nome todo desconhecido, ou nome curto (1-2 palavras) que nenhuma unidade tem por inteiro; nome longo com sobra só se a 1ª palavra não existe
      if (!primeiro || toks.length <= 2) achados.push((tipo + ' ' + bruto.join(' ')).trim());
    }
    return uniq(achados).slice(0, 3);
  }
  // fatos de Boa Vista que a IA costuma errar (conferidos no prompt do Paulus: docs/PAULUS-PERSONALIDADE.md)
  var AVISOS_FATOS = [
    { id: 'upa', re: /\bUPAs?\b/, nega: /(?:^|[^\wÀ-ÿ])(?:n[ãa]o (?:h[áa]|existe|tem|funciona|est[áa])|sem|nenhuma|ainda n[ãa]o|inexistente|autorizad[ao]|prevista?)(?![\wÀ-ÿ])/i,
      nota: 'Em Boa Vista não há UPA em funcionamento: para urgência, o HGRR (urgência 24h) e o SAMU (192) são a referência.' },
    { id: 'capsi', re: /\bCAPS\s*i\b(?!\w)|\bCAPS\s+infantil\b|\bCAPSi\b/, nega: /(?:^|[^\wÀ-ÿ])(?:n[ãa]o (?:h[áa]|existe|tem)|sem|nenhum|inexistente)(?![\wÀ-ÿ])/i,
      nota: 'Em Boa Vista não há CAPS infantil (CAPS i): o CAPS II atende crianças a partir de 4 anos.' }
  ];
  function avisosFatos(text) {
    var s = String(text || ''), out = [];
    AVISOS_FATOS.forEach(function (f) {
      var m = f.re.exec(s);
      if (!m) return;
      var ao = s.slice(Math.max(0, m.index - 90), m.index + 90);
      if (!f.nega.test(ao)) out.push(f.nota);
    });
    return out;
  }
  // Resultado único para a interface: { fone: telefone fora do diretório, unidades: nomes que não constam, fatos: avisos }
  function conferir(text) {
    return { fone: verifyPhones(text), unidades: unidadesDesconhecidas(text), fatos: avisosFatos(text) };
  }

  // A IA termina a resposta com "SUGESTÕES: a | b | c". Isso vira botões e não aparece no texto.
  var RE_SUG = /(?:^|\n)[ \t]*(?:\*\*)?sugest(?:õ|o)es(?:\*\*)?[ \t]*:[ \t]*([\s\S]*)$/i;
  function separarSugestoes(text) {
    var t = String(text || ''), m = t.match(RE_SUG);
    if (!m) return { texto: t.trim(), sugestoes: [] };
    var sug = m[1].split(/\s*\|\s*|\n\s*[-•*]\s*/).map(function (x) { return x.replace(/^[\s\-•*"“]+|[\s"”]+$/g, '').trim(); })
      .filter(function (x) { return x.length >= 6 && x.length <= 60 && /[a-zà-ú]/i.test(x); });
    return { texto: t.slice(0, m.index).trim(), sugestoes: uniq(sug).slice(0, 3) };
  }
  // durante o streaming: esconde o rótulo "SUGESTÕES:" (inclusive parcial, como "SUGEST") no fim
  function ocultarSugestoes(full) {
    var t = String(full || ''), i = t.search(/(?:^|\n)[ \t]*(?:\*\*)?sugest/i);
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
    function emit(t) { if (!t) return; full += t; if (hooks.onDelta) hooks.onDelta(t, cleanPartial(full)); }
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
    var violencia = /\b(violencia|agredid\w*|agress\w*|ameac\w*|apanh\w*|maria da penha|espanc\w*|maltrat\w*|bate|bateu|batendo|batem|empurr\w*|enforc\w*)\b/.test(n.replace(RE_IDIOMA_BATER, ' '));
    var sexual = /\b(sexual|abuso sexual|estupro|abusad\w*|escuta especializada)\b/.test(n);
    var mulher = /\b(mulher|mulheres|esposa|companheira|namorada|ex mulher|agredida|ameacada|espancada|violentada|abusada|perseguida)\b/.test(n);
    // pessoa próxima que apanha ("meu pai bate na minha mãe", "minha vizinha apanha do marido"): mesma referência, desde que não seja criança
    if (!mulher && /\b(mae|mamae|vizinha|irma|amiga|tia|avo|sogra|colega|cunhada|prima)\b/.test(n) && !RE_MENOR.test(n)) mulher = true;
    var r = null;
    var drogas = /\b(usa|usando|usam|usuari\w*|dependen\w*|viciad\w*|vicio|bebe demais|bebendo demais|alcoolatra|alcoolismo|recaida)\b/.test(n) && /\b(drog\w*|alcool|bebida|crack|cocaina|maconha|entorpecente\w*)\b/.test(n);

    if (drogas && !(crianca || adolesc) && !/\b(filh[oa]|menin[oa]|garot[oa])\b/.test(n.replace(/\b(meu|minha) (filh[oa]|menin[oa])\b.*\b(adulto|anos)\b/, ''))) {
      r = { ids: ['caps-ad-iii'], t: 'uso problemático de álcool e outras drogas (adultos)', extra: 'Porta aberta: a pessoa pode ir ao CAPS AD III sem encaminhamento. A família também é acolhida. Para o cuidado no território, a UBS e o CRAS ajudam a articular.' };
    } else if (drogas) {
      r = { ids: ['caps-ad-iii'], t: 'uso de álcool e outras drogas', extra: 'Se a pessoa é criança ou adolescente, confirme com o CAPS AD III ou com a UBS o fluxo para a idade dela (em Boa Vista não há CAPS infantojuvenil cadastrado). Se houver violação de direitos, acione também o Conselho Tutelar e o CREAS.' };
    } else if ((crianca || adolesc) && sexual) {
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
    if (session.pendente === 'relato-bairro') { var rb = respostaBairroDoRelato(text); if (rb) session.pendente = ''; return rb; }
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
      texto: 'Eu respondo na hora, sem internet, sobre o **diretório** (telefone, endereço, horário, requisitos), **dúvidas de SUAS** (PNAS, NOB/SUAS, Tipificação, financiamento, controle social, vigilância e outros conceitos, sempre com a norma citada), **valores de referência**, **calendário do Bolsa Família**, **municípios de Roraima** e **como usar o app**. Também **abro abas** ("abre o mapa"), **busco no diretório**, **troco o tema** (claro/escuro), **consulto a Agenda** e **traço rotas** entre unidades ("traçar rota saindo do CRAS Cauamé: UBS X e CAPS II, de moto"). Quando a IA está ligada, ela aprofunda as respostas. Não guardo dados pessoais de ninguém: evite digitar nome, CPF ou NIS de quem foi atendido.' },
    { id: 'rota', nome: 'Traçar rota entre unidades', keys: ['como pedir uma rota', 'como pedir rota', 'como tracar rota', 'como tracar uma rota', 'voce traca rota', 'voce traca rotas', 'o mascote traca rota', 'como funciona a rota', 'como funciona o traçado de rota', 'rota de visita pelo mascote'],
      texto: 'Escreva a saída e as paradas, e eu **ordeno, meço e monto o link do mapa**: "traçar rota saindo do **CRAS Cauamé**: **UBS X**, **CAPS II** e **Conselho Tutelar**, voltando ao CRAS Cauamé, de moto, 30 minutos em cada". Entendo "melhor ordem para visitar A, B e C", "A -> B -> C" (na sua ordem), "saindo daqui" (se você ligou o **perto de mim**), a pé, bicicleta, moto e carro. A conta é feita **no aparelho, sem IA e sem internet**, e é **estimativa** (linha reta × 1,3, sem trânsito nem horário das unidades). Só traço rota **entre unidades, serviços e bairros**: endereço de residência de família eu recuso, de propósito. As unidades sem pino no mapa entram só como link, sem km nem tempo; localize-as na aba do mapa para entrarem na conta.' },
    { id: 'busca', nome: 'Busca no diretório', keys: ['como busco', 'como buscar', 'como pesquisar', 'como pesquiso', 'como procurar', 'como procuro', 'campo de busca', 'barra de busca', 'pesquisa do app', 'busca por proximidade', 'ordenar por proximidade', 'perto de mim'],
      texto: 'Digite na **barra de busca** do alto: nome do serviço, bairro, tipo de atendimento ou até um sintoma/assunto. A busca ignora acentos e maiúsculas. Em cada aba do diretório ela filtra só aquela categoria; na aba **Rede Intersetorial de Serviços** ela procura em tudo. Dá para **ordenar por proximidade** (usa a sua localização, se você permitir).', open: 'all', abrir: 'Rede Intersetorial' },
    { id: 'recentes', nome: 'Recentes', keys: ['aba recentes', '!recentes', 'ultimas unidades', 'unidades que abri', 'historico de unidades', 'o que abri'],
      texto: 'A aba **Recentes** guarda as últimas unidades que você abriu, para voltar a elas num toque.', open: 'recentes' },
    { id: 'cartao', nome: 'Cartão de uma unidade', keys: ['cartao da unidade', 'ficha da unidade', 'o que tem no cartao'],
      texto: 'Cada unidade aparece num **cartão** com endereço, telefones (toque para ligar), horário, descrição do serviço e, quando existem, requisitos e documentos. As fichas vêm do diretório do app e devem ser conferidas no órgão responsável quando a regra for importante.' },
    { id: 'abas-diretorio', nome: 'Abas do diretório', keys: ['abas do diretorio', 'quais abas do diretorio', 'aba hospitalar', 'aba raps', 'aba juridico', 'aba educacao', 'aba bancos', 'aba previdencia', 'categorias do diretorio', 'em que aba fica', 'em qual aba'],
      texto: 'As abas do diretório são: **Rede Hospitalar e Atenção Básica**, **RAPS** (saúde mental), **Pessoa com Deficiência e TEA**, **Proteção Social** (CRAS/CREAS), **Segurança Alimentar**, **Educação**, **Poder Judiciário**, **Conselho Tutelar**, **Segurança Pública**, **Rede de Enfrentamento à Violência contra a Mulher**, **Conselhos Municipais de Direitos**, **Documentação Civil**, **Rede Bancária**, **Previdência (INSS)**, **Serviço de Migração**, **Trabalho e Renda**, **Cultura, Esporte e Lazer**, **Habitação**, **Mobilidade**, **Defesa Civil** e **Programas, Projetos e Serviços**. Diga o assunto e eu abro a aba certa.' },
    { id: 'cras-registro', nome: 'Registro de Atendimento (CRAS)', keys: ['registro de atendimento cras', 'aba cras', 'atalhos do cras', 'painel do cras', 'rma formulario', 'registro mensal de atendimentos', 'registro de atendimento', '!sibec', '!sigpbf', 'bv cidadao', 'portal do cidadao', 'cidade social', 'banco de talentos', 'cedula c', 'carteira do idoso', 'portal cadunico', 'contracheque'],
      texto: 'A aba **Registro de Atendimento (CRAS)** é um painel de **atalhos técnicos** da equipe. Entre eles: **Consulta em Tela Cheia** (buscar por bairro), **BV Cidadão**, **Portal do Cidadão**, **Cidade Social**, **Contracheque (SIPWEB)**, **Banco de Talentos**, **Cédula C**, **SIBEC (Caixa)**, **SIGPBF**, **Carteira do Idoso**, **Portal CadÚnico**, **Calendário Condicionalidades**, **Calendário Pagamento**, **RMA (MDS)**, **Registro (Planilha)** e **RMA Imprimir**. Vários abrem sistemas externos, com o login de cada um.', open: 'cras', abrir: 'Registro CRAS' },
    { id: 'cas-registro', nome: 'Registro de Atendimento (CAS)', keys: ['registro de atendimento cas', 'aba cas', 'atalhos do cas', 'painel do cas', 'centro de atendimento social', 'assinar relatorio sei', 'registro diario', 'rma cas', 'pasta geral', 'perfil socioeconomico', 'matriculas'],
      texto: 'A aba **Registro de Atendimento (CAS)** é o painel de atalhos técnicos do Centro de Atendimento Social, para uso interno da equipe. Entre eles: **Assinar Relatório (SEI)**, **Dados Pessoais**, **Registro Diário**, **RMA (CAS)**, **Matrículas**, **Perfil Socioeconômico (Responsáveis/Família)**, **Pasta Geral** e o **Mapa do Território (Vila Jardim)**. Há também atalhos do **Cadastro Único (CadÚnico)**.', open: 'cas', abrir: 'Registro CAS' },
    { id: 'paginas-internas', nome: 'Páginas internas de ferramentas', keys: ['consulta tecnica cras', 'equipe tecnica do cras', 'registro mensal com soma', 'planilha do rma', 'mapa vila jardim', 'gestao pbf', 'rma com soma', 'rma formulario'],
      texto: 'O app traz páginas próprias na pasta de ferramentas: **Consulta Técnica da equipe do CRAS Cristiana Vicente Nunes**, **RMA – Registro Mensal de Atendimentos** (formulário), **RMA – Registro Mensal com Soma** (planilha que soma sozinha), **Gestão PBF 2026** (calendário), **Calendário Bolsa Família 2026** (pagamentos) e o **Mapa do Território da Vila Jardim**. Elas abrem pelos atalhos das abas **Registro CRAS** e **Registro CAS**.', open: 'cras', abrir: 'Registro CRAS' },
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
      texto: 'A aba **Notícias** traz as últimas publicações do **MDS, MEC, Saúde e de órgãos de Roraima** (SETRABES, Prefeitura de Boa Vista, Governo, SESAU e SEED), com os **normativos separados** das notícias. Você usa **temas rápidos** (ex.: Bolsa Família), filtra por ministério, tipo e período, escolhe a ordem (mais recentes ou mais relevantes para o SUAS), **salva** itens, marca **não lidas**, copia a lista e exporta as salvas em .txt. Precisa de internet para atualizar.', open: 'noticias' },
    { id: 'aplicativos', nome: 'Aplicativos do autor', keys: ['!aplicativos', 'aba aplicativos', '!toth', '!umbrela', '!anona', '!verbus', 'vita', 'caderno de campo', 'paif paf', 'condicionalidades', 'editor de documentos', 'apps do autor'],
      texto: 'A aba **Aplicativos** lista as outras ferramentas do autor, cada uma em seu endereço e com login próprio: **Toth** (caderno de campo), **Umbrela** (PAIF/PAF), **Anona** (condicionalidades do Bolsa Família 2026), **Verbus** (editor de documentos), **Bloco de Notas** e o site **Vita**. Abrem em outra aba e precisam de internet. No celular, use "Adicionar à tela inicial" para criar atalho.', open: 'appsext' },
    { id: 'cripto', nome: 'Criptografia', keys: ['!criptografia', 'aba criptografia', 'proteger com senha', 'senha em documento', 'senha em word', 'senha em excel', 'senha em zip', 'zip com senha', 'proteger arquivo', 'cifrar arquivo', 'criptografar'],
      texto: 'A aba **Criptografia** coloca **senha** em **PDF** (um, vários ou uma pasta), em **Word, Excel e PowerPoint** (padrão do Office, AES-256), em **texto (.txt)** e em **pasta .zip**. Tudo acontece no seu navegador: nenhum arquivo nem senha é enviado a servidor. **Anote a senha**: se for esquecida, não há como recuperar o arquivo. Você recebe uma cópia protegida; o original não é alterado.', open: 'criptografia' },
    { id: 'pdf', nome: 'Central de PDF', keys: ['central de pdf', 'ferramentas de pdf', 'o que tem na central de pdf', 'funcoes do pdf', 'mexer em pdf', 'trabalhar com pdf', 'aba pdf'],
      texto: 'A **Central de PDF** faz tudo no seu navegador, sem enviar arquivo a servidor: **Editar, Unir, Dividir, Excluir páginas, Girar, Numerar, Senha (leva à Criptografia), Marca d\'água, Dados ocultos, Remover senha, Texto, Reduzir, PDF ⇄ Word, PDF ⇄ JPG e Digitalizar (fotos → PDF)**. Dá para começar pelo arquivo: solte (ou cole com Ctrl+V) um PDF, fotos ou um .docx e o app mostra o que dá para fazer com ele, com páginas e tamanho, e avisa se o PDF pede senha. Na primeira vez que usa cada função, o app baixa uma pequena biblioteca (precisa de internet só nesse momento). Diga qual função quer e eu explico.', open: 'pdftools' },
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
    { id: 'pdf-senha', nome: 'Remover senha do PDF', keys: ['remover senha do pdf', 'tirar senha do pdf', 'tirar senha pdf', 'desbloquear pdf', 'destravar pdf', 'desproteger pdf', 'pdf com senha', 'pdf protegido', 'abrir pdf com senha', 'esqueci a senha do pdf'],
      texto: 'Em **Remover senha** você escolhe o PDF, digita a senha de abrir e o app gera uma cópia que abre sem senha. É preciso **saber a senha**: o app não adivinha nem quebra senhas, e se ela foi esquecida não há como recuperar. PDFs que abrem sem senha mas bloqueiam copiar ou imprimir também funcionam, sem digitar nada. A cópia tem as páginas como imagem com texto invisível por cima (dá para buscar e copiar) e pode ficar maior. Use só em arquivos seus ou que você tem autorização para usar.', open: 'pdftools', abrir: 'Central de PDF' },
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
      texto: 'O **Relógio** mostra o horário de Boa Vista e tem **cronômetro**, **temporizador** (de 30 segundos a 600 minutos, com tempos prontos ou o seu em minutos e segundos) e **alarme** (uma vez, todo dia ou segunda a sexta, com aviso digitado). O aviso toca (som e vibração) mesmo se você trocar de aba, **desde que o app continue aberto e destrancado**. Os alarmes ficam salvos, cifrados, neste aparelho. Enquanto o cronômetro ou o temporizador estão rodando, o app pede ao aparelho para manter a tela acesa (se ele permitir).', open: 'ferramentas' },
    { id: 'calculadora', nome: 'Calculadora', keys: ['!calculadora', 'calcular', 'fazer conta', 'historico da calculadora', 'memoria da calculadora', 'teclado da calculadora'],
      texto: 'A **Calculadora** tem memória (M), histórico, botão **Copiar**, modo em **R$** e aceita o **teclado** (números, + − * /, Enter, Backspace, Esc limpa tudo, Del limpa o número). Ctrl+V cola um valor; no celular use o botão **Colar**.', open: 'ferramentas' },
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
    { id: 'senha', nome: 'Senha e entrada no app', keys: ['senha do app', 'esqueci a senha', 'esqueci minha senha', 'recuperar a senha', 'senha da equipe', 'trocar a senha', 'login', 'entrar no app', 'tela de login', 'senha errada', 'bloqueou depois de errar', 'tentativas de senha', 'app trancado'],
      texto: 'O app pede **senha** para abrir. É **uma senha única, compartilhada por toda a equipe técnica**: não há contas individuais nem servidor, então **não existe recuperação automática**. Se esqueceu, procure a **coordenação da sua unidade** ou quem administra o Argo SUAS. Depois de **{tentativas} tentativas erradas**, o app bloqueia por um tempo que vai aumentando (começa em 30 segundos e chega a 10 minutos). A senha protege os dados salvos neste aparelho. Se a senha for trocada, faça o **backup antes**, troque e só então restaure.' },
    { id: 'conectado', nome: 'Manter-me conectado e bloqueio automático', keys: ['manter conectado', 'manter me conectado', 'bloqueio automatico', 'inatividade', 'trancou sozinho', 'app trancou', 'sessao expirou', 'por que pediu a senha de novo', 'sair do app', 'sair'],
      texto: '**Manter-me conectado nesta aba** evita digitar a senha de novo ao atualizar a página, mas só vale na mesma aba e **expira em {lembrarHoras} horas**; use só em aparelho seu. O app **tranca sozinho depois de {bloqueioMin} minutos sem uso** (ou ao voltar de uma aba escondida por esse tempo), para proteger os dados dos atendidos. **Sair** tranca na hora e apaga o "manter conectado".' },
    { id: 'backup', nome: 'Backup e restauração', keys: ['!backup', 'backup de anotacoes', 'fazer backup', 'importar backup', 'restaurar backup', 'restaurar dados', 'exportar dados', 'trocar de aparelho', 'passar dados para outro aparelho', 'perdi minhas anotacoes'],
      texto: 'No menu lateral há **Backup de anotações** (baixa um arquivo com os seus dados salvos) e **Importar backup** (restaura). O arquivo é **cifrado com a senha em uso** na hora de exportar; para restaurar, entre com a mesma senha. Use o backup antes de trocar de aparelho, de limpar o navegador ou de trocar a senha.' },
    { id: 'apagar', nome: 'Apagar dados do aparelho', keys: ['apagar dados', 'apagar dados salvos', 'limpar dados do aparelho', 'computador compartilhado', 'apagar tudo', 'limpar meus dados', 'emprestar computador'],
      texto: 'O botão **Apagar dados salvos neste dispositivo** (menu lateral) remove deste navegador nomes, endereços, anexos, notas e alarmes salvos e também o que o Paulus (o mascote) aprendeu aqui: estilo de resposta, perguntas frequentes e respostas aprovadas. Use **antes de emprestar ou devolver um computador compartilhado**, porque a tela de login não protege o que já está no navegador. Faça o **backup** antes, se quiser guardar. A ação pede confirmação.' },
    { id: 'privacidade', nome: 'Privacidade e dados pessoais', keys: ['privacidade', 'dados pessoais', 'lgpd', 'o app guarda dados', 'onde ficam os dados', 'e seguro', 'e seguro usar', 'seguranca do app', 'dados dos atendidos'],
      texto: 'Os dados que você salva ficam **neste aparelho**, cifrados com a sua senha; a Central de PDF e a Criptografia trabalham no navegador, sem enviar arquivos. Exceções: o **Tradutor** e as **Notícias** usam serviços online, e a **sincronização da Agenda** guarda as anotações na nuvem sob o seu código. Evite digitar nome, CPF ou NIS de quem foi atendido no Tradutor e na conversa comigo.' },
    { id: 'offline', nome: 'Uso sem internet', keys: ['sem internet', 'offline', 'funciona sem internet', 'sem conexao', 'instalar o app', 'adicionar a tela inicial', 'instalar no celular', 'pwa'],
      texto: 'O diretório, a base SUAS e várias ferramentas funcionam **sem internet** depois de carregados. Precisam de internet: **Notícias**, **Tradutor**, **Aplicativos**, a **sincronização da Agenda** e, na primeira vez, cada função da Central de PDF. No celular, use "Adicionar à tela inicial" do navegador para ter o atalho.' },
    { id: 'atalhos', nome: 'Atalhos de teclado', keys: ['atalhos de teclado', 'atalho do teclado', 'teclas de atalho', 'tecla de atalho', 'atalhos do app', 'atalhos da agenda', 'desfazer no pdf', 'ctrl k', 'trocar de aba pelo teclado'],
      texto: '**Em todo o app:** **/** foca a busca; **Ctrl/⌘ + K** vai para outra aba; **?** abre o mascote. **Na Agenda:** **T** vai para hoje, **N** anota rápido, **/** busca, **F** foco no calendário, **W** semana, **C** mostra/oculta concluídas, **E** estreita, **+** e **−** dão zoom, **PageUp/PageDown** trocam de mês; **Ctrl + Enter** salva a anotação e **Esc** fecha. **No Editar PDF:** **Ctrl + Z** desfaz e **Ctrl + Shift + Z** refaz. **No Bloco de notas:** **Ctrl + S** salva e **Ctrl + Enter** marca ou desmarca uma tarefa da lista. Os atalhos de letra não funcionam enquanto você digita num campo.' },
    { id: 'mascote-abrir', nome: 'Abrir e usar o mascote', keys: ['abrir o mascote', 'abrir o assistente', 'chamar o mascote', 'como falar com o argo', 'nova conversa', 'barquinho', 'conversar com o argo', 'aprofundar com a ia'],
      texto: 'O mascote abre pelo **botão do barquinho** ou pela tecla **?**. Escreva a pergunta e envie; use **Nova conversa** para recomeçar. Ele lembra do que você acabou de perguntar (unidade, bairro, assunto). Quando a IA está ligada, aparece **✨ Aprofundar com a IA** nas respostas prontas. Perguntas com documento, telefone, e-mail ou nome e sobrenome são barradas antes de ir à IA.' },
    { id: 'mascote-voz', nome: 'Voz do mascote', keys: ['voz do mascote', 'falar com o mascote', 'microfone do mascote', 'ouvir a resposta', 'leitura em voz alta', 'ler resposta em voz alta', 'ditar pergunta', 'perguntar por voz'],
      texto: 'O botão **🎤** transforma o que você fala em texto no campo de pergunta: **nada é enviado sozinho**, você confere e toca em enviar. O alternador **🔊** liga a leitura das respostas em voz alta, e cada resposta tem o botão **Ouvir**. Os botões somem em navegadores sem suporte. Atenção: em vários navegadores (Chrome, Edge) o áudio vai ao serviço de voz do fabricante; o Argo não grava nem guarda áudio.' },
    { id: 'favoritas', nome: 'Favoritas e recolher cartões nas Ferramentas', keys: ['favoritar ferramenta', 'ferramentas favoritas', 'fixar ferramenta', 'recolher cartao', 'ferramentas no topo', 'filtrar ferramentas', 'buscar ferramenta'],
      texto: 'Nas **Ferramentas**, cada cartão tem **☆** (favoritar: o cartão sobe para o topo) e **▾** (recolher). O filtro tem os grupos **Todas, ★ Favoritas, Tempo, Cálculos, Famílias, Atendimento, Dados e Notas**, e a tecla **/** foca a busca de ferramentas. Favoritas e cartões recolhidos ficam lembrados neste aparelho.', open: 'ferramentas' },
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
  var RE_MAN_PERGUNTA = /\b(como|onde|qual|quais|que aba|o que|para que|pra que|serve|funciona|funcao|usar|uso|usa|abrir|abro|acho|achar|encontro|encontrar|fica|explica|ensina|aprender|tutorial|passo a passo|consigo|posso|da para|tem como|tem (alguma|algum)|existe|quero|preciso|esqueci|perdi)\b/;
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
      if (ps.score >= 3 && ps.entry) out.push({ titulo: (ps.entry.raps ? 'Base RAPS (app): ' : ps.entry.cad ? 'Base CadÚnico (app): ' : ps.entry.paif ? 'Base PAIF (app): ' : 'Base do psicólogo no SUAS: ') + ps.entry.cat, texto: limpaMd(ps.entry.text), origem: ps.entry.base });
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
    try {
      var mt = matriculaAsk(text);
      if (mt) out.unshift({ titulo: 'Matrícula escolar (app, conferido nas fontes oficiais)', texto: limpaMd(mt.reply), origem: mt.note });
    } catch (e3) { /* sem verbete */ }
    var man = manualBase(text);
    if (man.length) out = man.concat(out);
    var censo = censoBaseApp(text);
    // roteiros do app (partes da pergunta, ordem de trabalho de um caso) vêm primeiro: orientam a FORMA da resposta
    return roteiroBase(text).concat(censo.length ? censo.concat(out) : out).slice(0, 4);
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

  // ---------------------------------------------------------------------
  // MATRÍCULA: rede estadual (SEED-RR) e rede municipal de Boa Vista (SMEC)
  // ---------------------------------------------------------------------
  // Conteúdo conferido nas publicações oficiais do ciclo 2026 (Governo de Roraima/SEED e Prefeitura de Boa Vista/SMEC; editais de
  // nov. a dez. de 2025 e jan. de 2026). O calendário de 2027 ainda não tinha sido localizado: datas só como referência do ano anterior.
  // Ao revisar: confira o edital mais recente (Diário Oficial do Município; site da SEED) e atualize MATRICULA_REV e as datas.
  var MATRICULA_REV = 'nov. de 2026 (ciclo 2026; calendário 2027 ainda não localizado)';
  var MATRICULA_AVISO = '\nAs **datas mudam todo ano**: as de 2026 foram citadas só como referência. Confirme o calendário e o edital do ano antes de orientar a família.';
  var MATRICULA = [
    { id: 'matricula-estadual', rede: 'estadual',
      text: 'Matrícula na **rede estadual de Roraima** (SEED):\n- **Onde:** na **secretaria da escola estadual mais próxima da casa**, de forma **presencial**. Em 2026 o atendimento foi das 8h às 11h30 e das 14h às 17h30. As notícias de 2026 não citam matrícula online.\n- **Vagas novas** (2026): **6º ano** do Ensino Fundamental, **1ª série do Ensino Médio** (inclui tempo integral, técnico e Ensino Médio Mais noturno) e **EJA** (2º e 3º segmentos). Escolas **indígenas** não têm limite de vagas.\n- **Documentos** (original e cópia): histórico escolar ou declaração de transferência; certidão de nascimento ou RG do aluno; CPF do aluno (se tiver); cartão de vacina atualizado; cartão do Bolsa Família (se for beneficiário); 2 fotos 3x4 recentes; RG e CPF do responsável; comprovante de residência atualizado, com CEP.\n- **Não conseguiu vaga?** A **Central de Matrículas** da SEED (Praça do Centro Cívico, 550, Centro) localiza uma vaga perto de casa e emite o encaminhamento para a escola (em 2026: das 7h30 às 13h30, depois do período regular).\n- **Sorteio público:** algumas escolas (militarizadas e três não militarizadas na capital) tiveram vagas sorteadas por edital.\n- **Em 2026:** matrículas novas de 6 a 19 de janeiro, Central de Matrículas de 21 a 30 de janeiro, aulas a partir de 29 de janeiro.' + MATRICULA_AVISO,
      base: 'Governo de Roraima/SEED (matrículas 2026; notícias de jan. 2026). Calendário e regras do ano: www.educacao.rr.gov.br.',
      follow: ['Como é a matrícula na rede municipal de Boa Vista?', 'Qual escola estadual fica perto do meu bairro?'] },
    { id: 'matricula-municipal', rede: 'municipal',
      text: 'Matrícula na **rede municipal de Boa Vista** (SMEC):\n- **Como:** é **online** pelo portal **matriculaonline.boavista.rr.gov.br**, pelo **aplicativo Matrícula Online** (Android e iOS) ou pela **Central Tele Matrícula: 0800-280-3536** (das 7h às 19h). **EJA, escolas indígenas e do campo** seguem **presenciais**, na escola.\n- **Creche** (2 e 3 anos no edital 2026): pré-inscrição online. Quem tem **prioridade** envia os comprovantes na própria plataforma. Prioridades: deficiência, autismo, violência doméstica, criança acolhida, família monoparental em vulnerabilidade, responsável idoso ou com deficiência e responsável economicamente ativo; depois, **ordem de solicitação**. Quem não é chamado entra na **lista de espera** (publicada no Diário Oficial do Município e no site).\n- **Vaga confirmada:** a Central Tele Matrícula entra em contato e o responsável tem **72 horas** para ir à escola efetivar a matrícula. No Ensino Fundamental, o prazo informado foi de **3 dias**.\n- **Documentos** (creche, 2026): certidão de nascimento ou RG; CPF e documentos do responsável; comprovante de residência; cartão de vacina; cartão SUS; 2 fotos 3x4; laudos, em casos específicos. Para Pré-escola e Ensino Fundamental, confira a lista no edital do ano.\n- **Quem já é da rede** faz **transferência** em período próprio (em dezembro, no ciclo 2026). Beneficiárias do programa **Família que Acolhe** têm cronograma próprio.\n- **Em 2026:** pré-escola de 2 a 7 de janeiro; 1º e 2º ano de 8 a 13; 3º ao 5º ano de 14 a 19. O edital saiu no Diário Oficial do Município em 28/11/2025.' + MATRICULA_AVISO,
      base: 'Prefeitura de Boa Vista/SMEC: Edital de Matrículas 2026 e comunicados (dez. 2025 e jan. 2026).',
      follow: ['Como é a matrícula na rede estadual?', 'Quais documentos para matricular na creche?'] },
    { id: 'matricula-geral', rede: 'geral',
      text: 'Em Boa Vista há **duas redes públicas**, com matrícula diferente:\n- **Rede municipal (SMEC):** pelo que as notícias de 2026 mostram, atende **creche, pré-escola, 1º ao 5º ano** e **EJA do 1º segmento**. A matrícula é **online** (portal, aplicativo ou **0800-280-3536**).\n- **Rede estadual (SEED):** **6º ano em diante, Ensino Médio e EJA (2º e 3º segmentos)**. A matrícula é **presencial**, na escola estadual mais próxima de casa, com a **Central de Matrículas** como segunda chance.\n- **Documentos básicos nas duas redes** (2026): certidão de nascimento ou RG do aluno, documento e CPF do responsável, comprovante de residência, cartão de vacina e fotos 3x4. A lista completa está no edital do ano.\nDiga **qual rede** (ou a idade/série do aluno) que eu detalho: documentos, prazos e o que fazer se faltar vaga.' + MATRICULA_AVISO,
      base: 'Governo de Roraima/SEED e Prefeitura de Boa Vista/SMEC (matrículas 2026).',
      follow: ['Como é a matrícula na rede municipal de Boa Vista?', 'Como é a matrícula na rede estadual?'] }
  ];
  function matriculaAsk(text) {
    var n = norm(text);
    if (!/\b(matricul\w*|rematricul\w*|pre matricula|vagas? (em|na|no|para) (creche|escola|colegio|ensino)|creche.*\b(vaga|inscri\w*)|vaga.*\bcreche|inscri\w+.*\bcreche|central de matriculas?|tele matricula|matricula online)\b/.test(n)) return null;
    // quem quer a LISTA de escolas/creches do bairro ou o contato de uma unidade segue com o diretório
    if (/\b(perto|bairro|onde (fica|tem|ha)|telefone|fone|endereco|horario|contato|quantas?|quantos?)\b/.test(n)) return null;
    var est = /\b(estadual|estaduais|seed|ensino medio|medio|6 ano|sexto ano|militarizad\w+|central de matriculas?)\b/.test(n);
    var mun = /\b(municipal|municipais|smec|creche|creches|pre escola|infantil|1 ano|2 ano|3 ano|4 ano|5 ano|fundamental|tele matricula|matricula online|proinfancia|educacao infantil)\b/.test(n);
    var rede = est && !mun ? 'estadual' : mun && !est ? 'municipal' : 'geral';
    var e = MATRICULA.filter(function (x) { return x.rede === rede; })[0];
    return {
      reply: e.text, mood: 'info', badge: 'Matrícula escolar',
      note: 'Base: ' + e.base + ' Conferido em ' + MATRICULA_REV + '. Confirme no edital vigente.',
      quickActions: [{ label: 'Ver Educação', cat: 'educacao' }], followups: e.follow.slice(), glossId: e.id
    };
  }

  // "o que é", "como funciona", "para que serve": pergunta de CONCEITO. Com verbete no glossário, ele responde antes das fichas e listas do diretório.
  var RE_CONCEITUAL = /^(o que (e|sao|significa)|oque (e|sao)|que (e|sao)|como funciona|para que serve|pra que serve|quem tem direito|qual a diferenca)\b/;
  function plan(text, opts) {
    opts = opts || {};
    var c = crisis(text);
    if (c) return { kind: 'crisis', result: withCrisisUnits(c) };
    // CID-11: código → transtorno e nome → código (tabela local, sem IA)
    var cd = cidAsk(text);
    if (cd) return { kind: 'directory', result: cd, dir: { units: [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    // manual do app: "como uso a Central de PDF?", "onde fica o backup?" (sem IA, sem internet)
    var ma = manualAsk(text);
    if (ma && psiScore(text).score < 6) return { kind: 'manual', result: ma, dir: { units: [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    // matrícula escolar (rede estadual SEED e rede municipal SMEC): verbete conferido nas fontes oficiais; responde na hora, mesmo com a IA ligada
    var mat = matriculaAsk(text);
    if (mat) return { kind: 'manual', result: mat, dir: { units: [], confidence: 1, mode: 'list' }, con: { score: 0 } };
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
    if (session.pendente === 'violencia-crianca' || session.pendente === 'creas-bairro' || session.pendente === 'relato-bairro') session.pendente = '';
    var seg = seguimentoTerr(text);
    if (seg) return { kind: 'directory', result: seg, dir: { units: seg.units || [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    // painel de Boa Vista: perfil do bairro, panorama por área, necessidades (parto, CadÚnico, EJA...) e dados que o diretório não tem
    // municípios de Roraima: população, indígenas, área, CadÚnico/PBF/BPC, comparação e ficha (assets/municipios-rr.json)
    var mr = rrAsk(text);
    if (mr) return { kind: 'directory', result: mr, dir: { units: mr.units || [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    // Dúvida de CONTEÚDO sobre o CadÚnico ("quem pode se cadastrar?", "de quanto em quanto tempo atualizar?"): o verbete curado responde antes
    // das listas de unidades (que só servem para "onde fazer", telefone, endereço, bairro).
    var psiCad = psiScore(text);
    if (psiCad.entry && (psiCad.entry.cad || psiCad.entry.raps) && psiCad.score >= 4 && !(psiCad.entry.id === 'raps-caps-faq' ? /\b(bairro|perto|endereco|telefone|fone|horario|onde fica|localizacao)\b/ : /\b(bairro|atende|perto|endereco|telefone|fone|horario|onde fica|localizacao)\b/).test(norm(text))) {
      return { kind: 'psi', psi: psiCad, result: composePsi(psiCad.entry), dir: { units: [], confidence: 0 }, con: { score: 0 } };
    }
    var pb = perfilBairro(text) || panoramaAreas(text), listaNec = false;
    if (!pb) { pb = necessidade(text); listaNec = !!pb; }
    if (!pb) pb = semNumeros(text);
    // lista: resposta que só LISTA unidades de um perfil (o app a desvia quando a pergunta é de caso: ver ehCaso)
    if (pb) return { kind: 'directory', result: pb, dir: { units: pb.units || [], confidence: 1, mode: 'list' }, con: { score: 0 }, lista: listaNec };
    var pr = pbfOuRefsAsk(text);
    if (pr) return { kind: 'directory', result: pr, dir: { units: [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    var mun = municipio(text);
    if (mun) return { kind: 'directory', result: mun, dir: { units: mun.units || [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    var terr = territory(text);
    if (terr) return { kind: 'directory', result: terr, dir: { units: terr.units || [], confidence: 1, mode: 'list' }, con: { score: 0 } };
    // requisitos / documentos / valor / como solicitar de um serviço bem identificado: o cartão da ficha responde (e a IA fica a um toque)
    if (psiScore(text).score < 3 && !(RE_CONCEITUAL.test(norm(text)) && glossaryScore(text).score >= 3)) {
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
    if (enc) return { kind: 'directory', result: enc, dir: { units: enc.units || [], confidence: 1, mode: 'list' }, con: { score: 0 }, lista: true };
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
      var conceitual = RE_CONCEITUAL.test(norm(text)) && !dir.contact;
      if (!(con.score >= 6 && dir.confidence < 0.9) && !(conceitual && con.score >= 3)) {
        out.kind = 'directory';
        out.result = withUnits(composeDirectory(dir, session), dir);
        out.lista = true;
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
  // RACIOCÍNIO: o mascote lê a pergunta ANTES de responder.
  // Quatro hábitos, todos locais (valem sem internet e antes de qualquer IA):
  //  1) relato de violência contra criança/adolescente em fala natural ("o padrasto mexe com ele"): proteção em primeiro
  //     lugar, montada com os verbetes JÁ curados (psi-comunicar e psi-inquirir); nenhum texto de lei é escrito aqui;
  //  2) pergunta com várias partes ("qual CRAS atende o Caimbé e o que levo para o CadÚnico?"): cada parte é respondida
  //     e o que não tem resposta pronta é DITO (nunca some em silêncio);
  //  3) pergunta de caso ("como encaminho uma gestante em situação de rua?"): roteiro de trabalho em ordem (proteção,
  //     direitos, serviço de referência, articulação, registro). Vai à IA como base e, sem IA, vira a resposta;
  //  4) conferência da resposta da IA: parte da pergunta que ficou sem resposta vira botão para perguntar só ela.
  // Para ajustar: palavras do relato em RE_ATO_*, forma das perguntas em RE_CASO_*, passos em METODO_CASO.
  // Testes: npm run test:raciocinio
  // ---------------------------------------------------------------------
  function entradaPsi(id) {
    for (var i = 0; i < PSI_E_PAIF.length; i++) if (PSI_E_PAIF[i].id === id) return PSI_E_PAIF[i];
    return null;
  }

  // ---- 1) relato de violência contra criança ou adolescente ----
  var RE_MENOR = /\b(crianca|criancas|bebe|menino|menina|meninos|meninas|menininho|menininha|filho|filha|filhos|filhas|enteado|enteada|neto|neta|sobrinho|sobrinha|adolescente|adolescentes|garoto|garota)\b/;
  var RE_ATO_SEXUAL = /\b(mexe|mexeu|mexendo|mexia) com (ele|ela|o menino|a menina|a crianca|o garoto|a garota)\b|\b(passa|passou|passando|passava) a mao\b|\b(toca|tocou|tocando|tocava|apalpa|apalpou|apalpando) (nele|nela|no corpo|nas partes|a crianca)\b|\b(abuso|abusa|abusou|abusando|abusava|abusam|abusaram|abusado|abusada|estupr\w+|molest\w+|bolin\w+|violentou|violentando|violentad[oa]|pornografi\w+|aliciad\w+|aliciou|aliciando|exploracao sexual|violencia sexual|abuso sexual)\b|\bfotos? (nua|nu|pelad\w+|intim\w+)\b|\bnudes?\b/;
  var RE_ATO_FISICO = /\b(bate|bateu|batendo|batia|batem|apanha|apanhou|apanhando|apanhava|espanca\w*|agride|agrediu|agredindo|agredid[oa]|surra\w*|queimou|queimad[oa]|machuca|machucou|machucad[oa]|hematomas?|marcas? (no corpo|roxas?|de cinto|de fio)|roxo|roxa)\b/;
  // "abuso de álcool/drogas" é outro assunto (família com uso de substâncias), não relato de abuso
  // negligência/abandono: também é violação de direitos e se comunica (ECA art. 13); "largado", "sem comer", "sozinho em casa"
  var RE_ATO_NEGLIG = /\b(negligenci\w*|negligente|maus tratos|maltrat\w+|abandon\w+|largad[oa]s?|passando fome|sem comer|sem cuidado\w*|trancad[oa]s? (em casa|no quarto)|sozinh[oa]s? em casa|deixad[oa]s? sozinh\w+|trabalhando na rua|pedindo (na rua|esmola))\b/;
  var RE_ABUSO_SUBST = /abus\w*\s+(de|com|do|da)\s+(alcool|drogas?|substancias?|poder|autoridade|medicamentos?|bebida)/g;
  // "bate ponto", "bate papo", "bateu na porta": expressões, não agressão
  var RE_IDIOMA_BATER = /\bbat\w+\s+(ponto|papo|bola|boca|cartao|na porta|a porta|o carro|de frente|palmas|o martelo|record\w*|meta)\b/g;
  function idadesNoTexto(n) {
    var out = [], re = /\b(\d{1,3})\s*(?:anos|ano)\b/g, m;
    while ((m = re.exec(n))) out.push(parseInt(m[1], 10));
    return out;
  }
  // Devolve { sexual, fisica } quando a pessoa DESCREVE uma situação (não quando pergunta o que é). Pura: não muda a conversa.
  function relatoViolencia(text) {
    var t = String(text == null ? '' : text);
    if (t.length < 20 || t.length > 600) return null;
    var n = norm(t);
    if (/^(o que (e|sao|significa)|qual a diferenca|defina|conceito|tipos? de|formas? de|como funciona)\b/.test(n)) return null;
    var idades = idadesNoTexto(n), menorPorIdade = idades.some(function (a) { return a < 18; });
    // idade adulta e nenhuma de menor ("minha filha de 30 anos"): não é caso de criança/adolescente
    if (idades.length && !menorPorIdade) return null;
    if (!menorPorIdade && !RE_MENOR.test(n)) return null;
    var sexual = RE_ATO_SEXUAL.test(n.replace(RE_ABUSO_SUBST, ' ')), fisico = RE_ATO_FISICO.test(n.replace(RE_IDIOMA_BATER, ' '));
    var negl = RE_ATO_NEGLIG.test(n);
    if (!sexual && !fisico && !negl) return null;
    // já existe verbete específico para a pergunta (tipos de violência, escuta, depoimento, perícia...): ele responde melhor
    var ps = psiScore(t);
    if (ps.score >= 4 && ps.entry && ps.entry.id !== 'psi-comunicar') return null;
    return { publico: 'crianca', sexual: sexual, fisica: fisico && !sexual, negligencia: negl && !sexual && !fisico };
  }
  function planRelato(text) {
    var rel = relatoViolencia(text);
    if (!rel || crisis(text) || piiBlock(text)) return null;
    var com = entradaPsi('psi-comunicar');
    if (!com) return null;
    var inq = entradaPsi('psi-inquirir'), pratica = '';
    if (inq) { var m = String(inq.text).match(/Na prática:[^\n]*/); pratica = m ? m[0] : ''; }
    var corpo = String(com.text).replace(/^Sim, é dever previsto em lei:/, 'A comunicação é um **dever previsto em lei**:');
    var linhas = ['**Isto pede cuidado e proteção em primeiro lugar.** Se a criança ou o adolescente corre risco agora, ligue **190** (polícia) ou **192** (SAMU).', corpo];
    if (pratica) linhas.push(pratica);
    var units = [];
    if (rel.sexual) {
      units = porId(['cai-18-de-maio']).map(slim);
      if (units.length) linhas.push('Em violência **sexual**, o **CAI 18 de Maio** atende crianças e adolescentes vítimas ou testemunhas (ficha abaixo).');
    }
    linhas.push('Diga o **bairro** da família que eu mostro o Conselho Tutelar e o CREAS de referência.');
    session.pendente = 'relato-bairro';
    return {
      kind: 'psi',
      result: {
        reply: linhas.join('\n'), mood: 'info', badge: 'Proteção em primeiro lugar',
        note: 'Base: ' + com.base + (inq ? ' ' + inq.base : '') + ' Conferido em ' + PSI_REV + '; normas mudam, confirme a versão vigente. Siga também o fluxo de proteção do seu município.',
        quickActions: [{ label: 'Ver Conselho Tutelar', cat: 'conselho' }, { label: 'Ver CREAS', cat: 'social' }],
        followups: rel.sexual ? ['Posso perguntar detalhes do abuso?', 'Qual a diferença entre escuta especializada e depoimento especial?'] : ['Quais são os tipos de violência?', 'Qual a diferença entre escuta especializada e depoimento especial?'],
        units: units, unitsAll: units, psiId: com.id
      },
      relato: rel
    };
  }
  // O bairro dito logo depois do relato ("Caimbé"): Conselho Tutelar e CREAS do território, juntos.
  function respostaBairroDoRelato(text) {
    var ct = municipio('qual conselho tutelar atende ' + text) || territory('qual conselho tutelar atende ' + text);
    var cr = municipio('qual creas atende ' + text) || territory('qual creas atende ' + text);
    var oks = [ct, cr].filter(function (r) { return r && r.mood !== 'notfound' && r.mood !== 'info'; });
    if (!oks.length) return null;
    var vistos = {}, units = [], todas = [];
    oks.forEach(function (r) {
      (r.units || []).forEach(function (u) { if (!vistos[u.id]) { vistos[u.id] = 1; units.push(u); } });
      (r.unitsAll || r.units || []).forEach(function (u) { todas.push(u); });
    });
    return { reply: oks.map(function (r) { return r.reply; }).join('\n\n'), mood: oks[0].mood, badge: oks[0].badge, followups: oks[0].followups, units: units.slice(0, 6), unitsAll: todas };
  }

  // ---- 2) pergunta com várias partes ----
  // Corta em "e" só quando o que vem depois é um novo pedido ("e o que levo...", "e como faço..."): "Álcool e Drogas" não se divide.
  var RE_CORTE_E = /(?:\s*[,;])?\s+e\s+(?=(?:o que|oque|quais|qual|quanto|quantos|quantas|quando|onde|como|quem|preciso|devo|posso|levo|fa[cç]o|fazer)\b)/i;
  function conteudo(s) { return tok(s).filter(function (t) { return !STOP[t] && t.length > 2; }); }
  // Devolve as partes (cada uma já com "?") ou [] quando a pergunta é uma só. Cada parte precisa se sustentar sozinha
  // (2+ palavras de conteúdo): "quando devo acionar o CT e quando o CREAS?" é uma comparação, não duas perguntas.
  function dividirPartes(text) {
    var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (t.length < 20 || t.length > 320) return [];
    var cru = (t.match(/\?/g) || []).length >= 2 ? (t.match(/[^?]+\?*/g) || []) : t.split(RE_CORTE_E);
    var partes = cru.map(function (p) { return p.replace(/^\s*(?:e|mas)\s+/i, '').replace(/[\s?!.;,]+$/, '').trim(); }).filter(Boolean);
    if (partes.length < 2 || partes.length > 4) return [];
    // Cada parte precisa se sustentar sozinha. Exceção: a parte que PEDE algo claro ("quais documentos ela precisa?", "qual o prazo?")
    // já é uma pergunta, mesmo com uma só palavra de conteúdo (as demais são vazias: "quais", "ela", "precisa").
    for (var i = 0; i < partes.length; i++) if (conteudo(partes[i]).length < 2 && !(i > 0 && conteudo(partes[i]).length >= 1 && pedeAlgoClaro(partes[i]))) return [];
    return partes.map(function (p) { return p + '?'; });
  }
  function pedeAlgoClaro(parte) {
    var n = norm(parte);
    return PEDIDOS.some(function (p) { return (p.id === 'documentos' || p.id === 'prazo' || p.id === 'direito') && p.re.test(n); });
  }
  var KINDS_RESPONDEM = { directory: 1, concept: 1, psi: 1, ficha: 1, manual: 1 };
  // Responde cada parte com o que o app já sabe (diretório, glossário, verbetes, ficha). Com IA, se alguma parte não tem
  // resposta pronta, devolve null: a IA recebe a pergunta inteira e o roteiro das partes. Sem IA, entrega o que há e diz o que falta.
  function planPartes(text, opts) {
    var partes = dividirPartes(text);
    if (partes.length < 2 || crisis(text) || piiBlock(text)) return null;
    var pendente = session.pendente, blocos = [], faltou = [], units = [], todas = [], vistos = {}, seg = [], i;
    try {
      for (i = 0; i < partes.length; i++) {
        var p = plan(partes[i], opts || {}), r = p && p.result;
        if (!p || !KINDS_RESPONDEM[p.kind] || !r || !r.reply || r.mood === 'notfound') { faltou.push(partes[i]); continue; }
        blocos.push('**' + tituloPedido(partes[i].replace(/\?$/, '')) + '**\n' + r.reply);
        (r.units || []).slice(0, 3).forEach(function (u) { if (!vistos[u.id]) { vistos[u.id] = 1; units.push(u); } });
        (r.unitsAll || r.units || []).forEach(function (u) { todas.push(u); });
        (r.followups || []).forEach(function (f) { if (seg.length < 4 && seg.map(function (y) { return JSON.stringify(y); }).indexOf(JSON.stringify(f)) < 0) seg.push(f); });
      }
    } finally { session.pendente = pendente; }
    if (!blocos.length || (faltou.length && aiOn())) return null;
    var reply = 'Você fez ' + partes.length + ' perguntas numa só. Respondo cada uma:\n\n' + blocos.join('\n\n');
    var acoes = [];
    if (faltou.length) {
      reply += '\n\n**Esta parte eu não tenho pronta:** ' + faltou.map(function (f) { return tituloPedido(f.replace(/\?$/, '')); }).join('; ') + '. Prefiro avisar a chutar.';
    }
    var result = { reply: reply, mood: 'info', followups: seg, badge: 'Perguntas em partes', units: units.slice(0, 6), unitsAll: todas, multi: true, quickActions: acoes };
    return { kind: 'directory', result: result, dir: { units: units.slice(0, 6), confidence: 1, mode: 'list' }, con: { score: 0 }, multi: true, partes: partes, faltou: faltou };
  }
  // Depois da IA: partes da pergunta sem NENHUMA palavra de conteúdo na resposta. Conferência por palavras (radical de 5 letras),
  // só para oferecer um botão "pergunte só isto"; não acusa a IA nem altera o texto.
  function radical(t) { return t.length > 5 ? t.slice(0, 5) : t; }
  function partesSemResposta(pergunta, resposta) {
    var partes = dividirPartes(pergunta);
    if (partes.length < 2) return [];
    var alias = function (s) { return norm(s).replace(/cadastro unico/g, 'cadunico'); };
    var vistas = asSet(alias(resposta).split(' ').map(radical));
    return partes.filter(function (p) {
      var cs = alias(p).split(' ').filter(function (t) { return t && !STOP[t] && t.length > 2; }).map(radical);
      return cs.length >= 2 && !cs.some(function (c) { return vistas[c]; });
    });
  }

  // ---- 3) pergunta de caso ----
  var RE_CASO_SUJEITO = /\b(caso|casos|familia|familias|usuario|usuaria|gestante|gestantes|idoso|idosa|pessoa idosa|crianca|adolescente|mulher|homem|pessoa em situacao de rua|migrante|refugiad\w+|jovem|adulto|morador\w*|paciente)\b/;
  var RE_CASO_VERBO = /\b(organiz\w+|conduz\w+|abord\w+|encaminh\w+|acompanh\w+|proceder|agir|atuar|por onde|comecar|o que fazer|o que faco|como faco|acionar|articul\w+|intervir|intervencao)\b/;
  // programas e consultas objetivas têm base própria (ficha, verbete, território): não são "caso"
  var RE_CASO_NAO = /\b(cadunico|cadastro unico|bolsa familia|bpc|nis|beneficios?|passe livre|inss|telefone|fone|contato|endereco|horario|onde fica|localizacao|bairro|quantos|quantas|diferenca|qual (cras|creas|caps|ubs|conselho tutelar))\b/;
  function ehCaso(text) {
    var n = norm(text);
    if (n.length < 20 || n.length > 400) return false;
    if (/^(o que (e|sao|significa)|qual a diferenca|defina|conceito)\b/.test(n)) return false;
    return RE_CASO_SUJEITO.test(n) && RE_CASO_VERBO.test(n) && !RE_CASO_NAO.test(n);
  }
  // Ordem de trabalho para organizar um caso. É MÉTODO, não norma: vem do próprio roteiro do Paulus (docs/PAULUS-PERSONALIDADE.md)
  // e do verbete psi-sigilo-rede (contato prévio, ficha objetiva, contrarreferência combinada).
  var METODO_CASO = [
    ['Proteção e urgência', 'há risco imediato (vida, violência em curso, criança desprotegida)? Se houver, a segurança vem antes de tudo.'],
    ['Direitos e documentos', 'o que falta para a pessoa acessar benefícios e serviços (documentos, CadÚnico).'],
    ['Serviço de referência do território', 'qual CRAS, CREAS ou UBS atende o endereço, conforme as fichas do diretório.'],
    ['Articulação', 'contato prévio com o serviço, ficha objetiva (motivo, o que foi feito, o que se espera) e contrarreferência combinada.'],
    ['Registro e acompanhamento', 'o que foi feito, quando e com quem, e o retorno combinado.']
  ];
  function metodoCasoTexto() {
    return 'Ordem de trabalho para organizar um caso (método de trabalho do app, não é norma). Siga esta ordem na resposta: ' +
      METODO_CASO.map(function (p, i) { return (i + 1) + ') ' + p[0] + ': ' + p[1]; }).join(' ') +
      ' Só indique serviços que estejam nas fichas; o que depende do município ou da equipe, diga que se confirma com a coordenação.';
  }
  // Resposta sem IA para pergunta de caso: o roteiro, com o que o diretório achou para o perfil logo abaixo.
  function planCaso(text, anterior) {
    var linhas = ['Para organizar um caso, este é o **roteiro de trabalho** que eu sigo, em ordem:'];
    METODO_CASO.forEach(function (p, i) { linhas.push((i + 1) + '. **' + p[0] + ':** ' + p[1]); });
    var r = anterior && anterior.result;
    if (r && r.reply && r.mood !== 'notfound') linhas.push('\n**No diretório, para este perfil:**\n' + r.reply);
    var units = r && r.units ? r.units : [];
    return {
      kind: 'caso',
      result: {
        reply: linhas.join('\n'), mood: 'info', badge: 'Roteiro de caso',
        note: 'Roteiro geral de trabalho (não é norma). Confirme o fluxo local com a coordenação e a supervisão.',
        quickActions: r && r.quickActions ? r.quickActions : [],
        followups: ['O que é contrarreferência?', 'Como compartilhar informações com a rede?'],
        units: units, unitsAll: r && r.unitsAll ? r.unitsAll : units
      }
    };
  }
  // ---- 4) leitura da pergunta ----
  // O app lê a pergunta com regras fixas ANTES de a IA responder e entrega a leitura junto: o que a pessoa PEDE (documentos,
  // quem tem direito, passo a passo, prazo/valor, onde, diferença), de que PROGRAMA, para que PÚBLICO e em que SITUAÇÃO.
  // Modelo pequeno tende a responder o ASSUNTO (a definição do BPC) em vez do PEDIDO (os documentos do BPC); a leitura aponta
  // o pedido, o que conferir e quando a regra depende do público. É leitura, não resposta: não acrescenta nenhum fato.
  // As diretrizes são MÉTODO de resposta. Fato continua vindo só das fichas, das normas e dos verbetes.
  var PEDIDOS = [
    { id: 'documentos', rotulo: 'a lista de documentos', re: /\b(documentos?|documentacao|papeis|laudos?|comprovantes?|o que (?:eu )?(?:preciso )?levar|o que levo)\b/,
      cobre: /\b(documento|laudo|rg|cpf|identidade|comprovante|certidao|carteira de trabalho)\w*/,
      diretriz: 'Liste os DOCUMENTOS em itens curtos, separando o que é da pessoa e o que é da família quando a base separar. Se a base não trouxer a lista, diga que não consta e indique onde confirmar; não monte a lista de memória.' },
    { id: 'prazo', rotulo: 'o prazo ou o valor', re: /\b(quanto tempo|prazo|demora|demorar|quando (?:sai|cai|libera|paga|comeca|termina)|valor|quanto (?:paga|recebe|custa|e o))\b/,
      cobre: /\b(prazo|dias|meses|mensal|valor|salario minimo|calendario|cronograma|reais)\b|r\$/,
      diretriz: 'Dê prazo, data ou valor SÓ se vier da base, da ficha ou dos valores de referência do app. Se não vier, diga que muda e que se confere no normativo vigente ou no órgão.' },
    { id: 'direito', rotulo: 'a regra de quem pode', re: /\b(quem (?:pode|tem direito|recebe|consegue|se enquadra)|tem direito|tenho direito|(?:pode|podem|posso|consegue|conseguem) (?:receber|ter|solicitar|pedir|acessar|entrar|se cadastrar|participar|fazer|tirar|se inscrever)|criterios?|requisitos?|elegiv\w+|se enquadra)\b/,
      cobre: /\b(renda|pode|podem|direito|criterio|requisito|idade|anos|exige|elegiv\w+|precisa)\w*/,
      diretriz: 'Abra com a resposta (sim, não ou depende) e só depois o critério principal e o que confirmar. Se a base não disser, a resposta é que não consta.' },
    { id: 'como', rotulo: 'o passo a passo', re: /\b(como (?:eu )?(?:faco|fazer|pedir|solicitar|dar entrada|requerer|conseguir|acessar|se inscrever|inscrever|tirar|regularizar|resolver)|passo a passo|por onde (?:comeco|comecar|iniciar))\b/,
      cobre: /\b(passo|procur\w+|solicit\w+|pedido|inscri\w+|cadastr\w+|leve|agende|atendimento|ligue|acesse|encaminh\w+|acion\w+)/,
      diretriz: 'Dê os PASSOS em ordem: por onde começar, o que levar, quem faz o quê e o que acontece depois.' },
    { id: 'onde', rotulo: 'o serviço de referência', re: /\b(onde|aonde|qual (?:unidade|servico|orgao|lugar)|a quem (?:recorrer|procurar|encaminhar)|quem atende)\b/,
      diretriz: 'Indique o serviço de referência SÓ pelas fichas e pelo bairro; sem ficha, diga que não consta.' },
    { id: 'diferenca', rotulo: 'a comparação', re: /\b(diferenca|diferentes?|e o mesmo que|mesma coisa)\b/,
      diretriz: 'Compare lado a lado: o que cada um é, para quem e quando acionar.' }
  ];
  var PUBLICOS = [
    { id: 'crianca', rotulo: 'criança ou adolescente', re: /\b(crianca|criancas|menino|menina|adolescentes?|bebe|recem nascido|menor de idade)\b/ },
    { id: 'idoso', rotulo: 'pessoa idosa', re: /\b(idos[oa]s?|terceira idade|velhinh[oa])\b/ },
    { id: 'gestante', rotulo: 'gestante', re: /\b(gestantes?|gravida|gravidez|puerpera)\b/ },
    { id: 'mulher', rotulo: 'mulher', re: /\b(mulher|mulheres)\b/ },
    { id: 'pcd', rotulo: 'pessoa com deficiência ou TEA', re: /\b(autis\w*|tea|deficien\w+|pcd|cadeirante|down|surd[oa]s?|cego|cega|paralisia|tdah)\b/, cobre: /\b(deficien|autis|tea|pcd)\w*/ },
    { id: 'migrante', rotulo: 'migrantes e refugiados', re: /\b(venezuelan\w*|migrantes?|imigrantes?|refugiad\w+|estrangeir\w+|haitian\w*|apatrida|warao)\b/, cobre: /\b(migrant|imigrant|refugiad|estrangeir|venezuel)\w*/ },
    { id: 'indigena', rotulo: 'povos indígenas', re: /\b(indigenas?|aldeia|aldeado\w*|macuxi|yanomami|wapichana|taurepang|warao|povos? originarios?)\b/, cobre: /\b(indigen|aldeia)\w*/ },
    { id: 'rua', rotulo: 'pessoa em situação de rua', re: /\b(situacao de rua|moradora? de rua|moradores de rua|sem teto)\b/ }
  ];
  var SITUACOES = [
    { id: 'violencia', rotulo: 'violência', re: /\b(violencia|agred\w+|abus\w+ (?:sexual|fisic\w+|psicolog\w+|infantil)|maus tratos|espanc\w+|estupr\w+|ameac\w+|tortur\w+|exploracao sexual|trabalho infantil|bat(?:e|eu|endo|em|i)(?! (?:ponto|papo|boca|o carro|o cartao|o ponto))|apanh\w+|surr[ao]\w*|machuc\w+|empurr\w+|chut\w+|hematoma\w*|marcas? roxas?|mexe com (?:ele|ela|a crianca|o menino|a menina))\b/ },
    { id: 'negligencia', rotulo: 'negligência ou abandono', re: /\b(negligenc\w+|abandon\w+|desprotegid\w+)\b/ },
    { id: 'drogas', rotulo: 'uso de álcool ou outras drogas', re: /\b(drogas?|alcool|alcoolis\w+|dependencia quimica|crack|maconha)\b/ },
    { id: 'documento', rotulo: 'documento perdido ou ausente', re: /\b(perdeu|perdi|perdemos|extraviou|nao tem|sem|falta)\b.{0,25}\b(documentos?|rg|cpf|nis|certidao|identidade|comprovante)\b/ },
    { id: 'desastre', rotulo: 'desastre ou perda da moradia', re: /\b(enchente|alagou|incendio|desabrig\w+|desastre|calamidade|perdeu a casa|perderam a casa|deslizamento|casa caiu)\b/ },
    { id: 'fome', rotulo: 'falta de alimento', re: /\b(fome|sem comida|inseguranca alimentar|cesta basica)\b/ },
    { id: 'renda', rotulo: 'falta de renda ou trabalho', re: /\b(desempregad\w+|sem trabalho|sem renda|sem emprego)\b/ }
  ];
  var PROGRAMAS = [
    ['BPC', /\b(bpc|beneficio de prestacao continuada)\b/], ['Bolsa Família', /\b(bolsa familia|pbf)\b/],
    ['CadÚnico', /\b(cadunico|cad unico|cadastro unico|nis)\b/], ['Passe Livre', /\bpasse livre\b/],
    ['Tarifa Social de Energia', /\btarifa social\b/], ['Minha Casa, Minha Vida', /\bminha casa minha vida\b/],
    ['benefícios eventuais', /\b(beneficios? eventua\w+|aluguel social|auxilio natalidade|auxilio funeral)\b/],
    ['PAIF', /\bpaif\b/], ['PAEFI', /\bpaefi\b/], ['SCFV', /\bscfv\b/], ['Pé-de-Meia', /\bpe de meia\b/]
  ];
  function acha(lista, n) { return lista.filter(function (x) { return x.re.test(n); }); }
  // Devolve { pedidos, publicos, situacoes, programas }; todos vazios quando a pergunta não traz nada reconhecível.
  function lerPergunta(text) {
    var n = norm(text);
    return {
      pedidos: acha(PEDIDOS, n),
      publicos: acha(PUBLICOS, n),
      situacoes: acha(SITUACOES, n),
      programas: PROGRAMAS.filter(function (p) { return p[1].test(n); }).map(function (p) { return p[0]; })
    };
  }
  // A resposta pronta (verbete, glossário) deixou de fora o que a pessoa pediu? Compara o PEDIDO e o PÚBLICO da pergunta com a resposta.
  // Devolve o rótulo do que falta ('a lista de documentos', 'a regra para migrantes e refugiados') ou ''.
  function facetaNaoCoberta(text, resposta) {
    var lei = lerPergunta(text), r = norm(resposta), i;
    for (i = 0; i < lei.pedidos.length; i++) if (lei.pedidos[i].cobre && !lei.pedidos[i].cobre.test(r)) return lei.pedidos[i].rotulo;
    for (i = 0; i < lei.publicos.length; i++) if (lei.publicos[i].cobre && !lei.publicos[i].cobre.test(r)) return 'a regra para ' + lei.publicos[i].rotulo;
    return '';
  }
  // Pergunta que só se entende com a anterior ("isso vale para indígena também?", "e para idoso?"). Sem conversa anterior não há do que falar.
  var RE_REFERENCIAL = /^(?:e |mas |entao )?(?:isso|isto|esse|essa|esses|essas|nesse caso|nessa situacao|disso|nisso|ele|ela|eles|elas|tambem|vale|e se|e para|e pra|e quando|e no caso)\b/;
  function referencial(text) {
    var n = norm(text);
    if (!n || n.split(' ').length > 9 || !RE_REFERENCIAL.test(n)) return false;
    var lei = lerPergunta(text);
    return !lei.programas.length && !lei.situacoes.length;   // "ela tem direito ao BPC?" e "ela apanha todo dia" trazem o próprio assunto
  }
  function juntaRotulos(l) { return l.map(function (x) { return x.rotulo; }).join(', '); }
  // O trecho de leitura que vai à IA. Só sai quando a pergunta trouxe algo reconhecível (senão não acrescenta nada).
  function leituraTexto(text) {
    var lei = lerPergunta(text), out = [], dir = [], pedidos = lei.pedidos.slice(0, 2);
    // só o nome de um programa não ensina nada à IA (e tomaria o lugar do verbete): a leitura precisa de pedido, público ou situação
    if (!pedidos.length && !lei.publicos.length && !lei.situacoes.length) return '';
    var lido = [];
    if (pedidos.length) lido.push('o pedido é ' + juntaRotulos(pedidos));
    if (lei.programas.length) lido.push('programa ou serviço: ' + lei.programas.join(', '));
    if (lei.publicos.length) lido.push('público: ' + juntaRotulos(lei.publicos));
    if (lei.situacoes.length) lido.push('situação: ' + juntaRotulos(lei.situacoes));
    out.push('Leitura da pergunta feita pelo app (' + lido.join('; ') + ').');
    pedidos.forEach(function (p) { dir.push(p.diretriz); });
    if (pedidos.length) dir.push('Responda ao PEDIDO primeiro; não responda só com a definição do programa.');
    var viol = lei.situacoes.some(function (s) { return s.id === 'violencia' || s.id === 'negligencia'; });
    if (viol) dir.push('Há violência ou negligência: a proteção vem antes de tudo (risco imediato: 190, 192 ou 193; depois a rede de proteção e a comunicação cabível para esse público).');
    if (lei.situacoes.some(function (s) { return s.id === 'desastre' || s.id === 'fome'; })) dir.push('Comece pela necessidade imediata (abrigo, alimento) e pelo que a rede oferece; cite só serviços das fichas.');
    if (lei.situacoes.some(function (s) { return s.id === 'documento'; })) dir.push('Foque em como regularizar o documento e em qual serviço do território ajuda; cite só o que as fichas e as normas sustentam.');
    var espec = lei.publicos.filter(function (p) { return p.cobre; });
    if (espec.length) dir.push('A pergunta é sobre ' + juntaRotulos(espec) + ': diga se a regra para esse público consta na base; se não constar, diga que não consta e quem confirma. Não conclua por analogia com outro público.');
    // premissa só quando há território em jogo (serviço de referência ou uma situação a encaminhar); em pergunta de regra, não
    if (pedidos.some(function (p) { return p.id === 'onde'; }) || lei.situacoes.length) dir.push('Se faltar o bairro ou o município e uma suposição razoável resolver, assuma Boa Vista, diga a premissa em uma frase e responda.');
    return out.concat(dir).join(' ');
  }
  // O que acompanha a pergunta à IA, num ÚNICO item de base (o Paulus leva no máximo 4 itens; assim sobram vagas para os verbetes):
  // leitura da pergunta, roteiro das partes e/ou roteiro de caso. Entra antes dos verbetes: orienta a FORMA e o FOCO da resposta.
  function roteiroBase(text) {
    var blocos = [], titulos = [], partes = dividirPartes(text), leitura = leituraTexto(text);
    if (leitura) { blocos.push(leitura); titulos.push('leitura da pergunta'); }
    if (partes.length >= 2) {
      blocos.push('A pergunta tem ' + partes.length + ' partes. Responda TODAS, nesta ordem: ' + partes.map(function (p, i) { return (i + 1) + ') ' + p; }).join(' ') +
        ' Para a parte que as fichas e as normas não sustentam, diga em uma frase que não consta, em vez de omiti-la.');
      titulos.push('partes');
    }
    if (ehCaso(text)) { blocos.push(metodoCasoTexto()); titulos.push('caso'); }
    if (!blocos.length) return [];
    var texto = blocos.join(' ');
    if (texto.length > 1480) texto = texto.slice(0, 1480).replace(/\s+\S*$/, '') + '…';
    return [{ titulo: 'Roteiro do app: ' + titulos.join(', '), texto: texto, origem: 'leitura e organização da pergunta feitas pelo app (método, não é norma)' }];
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


  // ---------------------------------------------------------------------
  // Aprendizado com o uso — só neste aparelho (localStorage), nada vai à nuvem.
  // O Argo fica melhor com o uso de quatro jeitos:
  //   1. Preferências: o que a pessoa confirma (👍, liga, abre a ficha, copia) reforça a ligação
  //      "palavras da pergunta → unidade"; o 👎 enfraquece. Na próxima busca parecida, a unidade
  //      confirmada sobe na lista e a recusada desce. Nunca esconde um acerto pelo nome.
  //   2. Apelidos: palavra que ele não conhecia ("postinho do bairro", "assistente social do cras")
  //      vira sinônimo quando a pessoa reformula e confirma a resposta.
  //   3. Mais perguntadas: as perguntas que se repetem viram atalhos.
  //   4. Transparência: "o que você aprendeu?" mostra tudo e "apagar" zera.
  // Só guarda palavras que existem no diretório (nunca nomes de pessoas) e perguntas que passaram
  // pelo filtro de dado pessoal. Os pesos envelhecem sozinhos (um erro antigo não vira regra).
  // ---------------------------------------------------------------------
  var APR_KEY = 'argo_aprendizado_v1';
  var apr = null;
  function aprVazio() { return { v: 1, t0: Date.now(), n: 0, up: 0, down: 0, tok: {}, uni: {}, alias: {}, freq: {} }; }
  function aprStore() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } }
  function aprLoad() {
    if (apr) return apr;
    apr = aprVazio();
    try {
      var st = aprStore(), raw = st && st.getItem(APR_KEY), j = raw && JSON.parse(raw);
      if (j && j.v === 1 && typeof j === 'object') {
        ['tok', 'uni', 'alias', 'freq'].forEach(function (k) { if (j[k] && typeof j[k] === 'object') apr[k] = j[k]; });
        ['n', 'up', 'down', 't0'].forEach(function (k) { if (isFinite(j[k])) apr[k] = j[k]; });
      }
    } catch (e) { /* arquivo corrompido: começa do zero */ }
    return apr;
  }
  function aprSave() {
    try { var st = aprStore(); if (st) st.setItem(APR_KEY, JSON.stringify(apr)); } catch (e) { /* sem espaço / modo privado: segue sem guardar */ }
  }
  function aprAtivo() { var L = aprLoad(); return L.n > 0 || Object.keys(L.alias).length > 0; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // soma dos pesos "palavra → unidade" para as palavras fortes da pergunta
  function aprSoma(tokens, id) {
    if (id == null) return 0;
    var L = aprLoad(), t = 0;
    for (var i = 0; i < tokens.length; i++) { var m = L.tok[tokens[i]]; if (m && m[id]) t += m[id]; }
    return t;
  }
  function aprBonus(soma) {
    if (!soma) return 0;
    return soma > 0 ? Math.min(2, 0.7 * Math.log(1 + soma) / Math.LN2) : -Math.min(2.5, 0.8 * Math.log(1 - soma) / Math.LN2);
  }
  // quem a pessoa mais usa ganha um empurrãozinho de desempate
  function aprPopular(id) {
    var u = id != null && aprLoad().uni[id];
    return u && u.u > 0 ? Math.min(0.4, 0.12 * Math.log(1 + u.u) / Math.LN2) : 0;
  }
  function aprApelidos(tokens) {
    var L = aprLoad(), out = [];
    tokens.forEach(function (t) {
      var a = L.alias[t];
      if (!a) return;
      Object.keys(a).sort(function (x, y) { return a[y] - a[x]; }).slice(0, 3).forEach(function (w) { out.push(w); });
    });
    return out;
  }

  // palavras fortes que existem no diretório (nomes de pessoas não entram)
  function aprTokens(q) {
    ensureIndex();
    return q.strong.filter(function (t) { return t.length >= 3 && !/^\d+$/.test(t) && vocab[t]; }).slice(0, 8);
  }
  // palavras que o Argo não conhece nem por aproximação: candidatas a apelido
  function aprDesconhecidos(q) {
    ensureIndex();
    return q.strong.filter(function (t) {
      return t.length >= 4 && t.length <= 24 && !/\d/.test(t) && !vocab[t] && !SMALLTALK[t] && !APP_WORDS[t] && !Object.keys(expand(t)).length;
    }).slice(0, 3);
  }

  function aprPoda(L) {
    var ks = Object.keys(L.tok);
    if (ks.length > 300) {
      ks.sort(function (a, b) { return aprPesoTotal(L.tok[a]) - aprPesoTotal(L.tok[b]); }).slice(0, ks.length - 300).forEach(function (k) { delete L.tok[k]; });
    }
    var us = Object.keys(L.uni);
    if (us.length > 200) us.sort(function (a, b) { return L.uni[a].t - L.uni[b].t; }).slice(0, us.length - 200).forEach(function (k) { delete L.uni[k]; });
    var fs = Object.keys(L.freq);
    if (fs.length > 40) fs.sort(function (a, b) { return (L.freq[a].n - L.freq[b].n) || (L.freq[a].t - L.freq[b].t); }).slice(0, fs.length - 40).forEach(function (k) { delete L.freq[k]; });
    var as = Object.keys(L.alias);
    if (as.length > 60) as.slice(0, as.length - 60).forEach(function (k) { delete L.alias[k]; });
  }
  function aprPesoTotal(m) { var t = 0; for (var k in m) t += Math.abs(m[k]); return t; }
  // a cada 40 interações os pesos encolhem 10%: o que não é reconfirmado vai sumindo
  function aprEnvelhece(L) {
    if (L.n % 40 !== 0) return;
    Object.keys(L.tok).forEach(function (t) {
      var m = L.tok[t];
      Object.keys(m).forEach(function (id) { m[id] = Math.round(m[id] * 90) / 100; if (Math.abs(m[id]) < 0.3) delete m[id]; });
      if (!Object.keys(m).length) delete L.tok[t];
    });
  }

  function aprReforca(tokens, ids, peso) {
    var L = aprLoad();
    tokens.forEach(function (t) {
      var m = L.tok[t] || (L.tok[t] = {});
      ids.forEach(function (id) { m[id] = Math.round(clamp((m[id] || 0) + peso, -6, 14) * 100) / 100; if (!m[id]) delete m[id]; });
      if (!Object.keys(m).length) delete L.tok[t];
    });
    ids.forEach(function (id) {
      var u = L.uni[id] || (L.uni[id] = { u: 0, t: 0 });
      if (peso > 0) u.u += 1; else u.u = Math.max(0, u.u - 1);
      u.t = Date.now();
    });
  }
  function aprConfirmaApelido(ult) {
    if (!ult || !ult.alias || !ult.alias.length || !ult.tokens.length) return;
    var L = aprLoad();
    ult.alias.forEach(function (a) {
      var m = L.alias[a] || (L.alias[a] = {});
      ult.tokens.forEach(function (w) { m[w] = (m[w] || 0) + 1; });
    });
    ult.alias = [];   // uma confirmação por resposta
  }

  // chamado por remember(): guarda o que foi perguntado/respondido para o 👍/👎 e os toques saberem a quê se referem
  function aprNota(userText, units) {
    userText = String(userText || '').trim();
    if (!userText || piiBlock(userText) || crisis(userText)) { session.ult = null; return; }
    var q = parseQuery(userText), ids = [];
    (units || []).forEach(function (u) { if (u && u.id != null) ids.push(u.id); });
    var toks = aprTokens(q), desc = aprDesconhecidos(q), alias = [];
    if (!ids.length) {
      session.aprPend = desc.length ? { tokens: desc, turno: session.turno } : (session.aprPend && session.turno - session.aprPend.turno <= 3 ? session.aprPend : null);
    } else if (session.aprPend && session.turno - session.aprPend.turno <= 3) {
      alias = session.aprPend.tokens; session.aprPend = null;
    }
    var antes = session.ult, repetida = !!(antes && norm(antes.texto) === norm(userText) && Date.now() - antes.t < 120000);   // "Refazer" não conta como pergunta nova
    session.ult = { texto: userText.slice(0, 80), tokens: toks, ids: ids.slice(0, 6), alias: alias, fb: '', usados: {}, t: Date.now() };
    // "mais perguntadas": só perguntas curtas que o Argo conseguiu responder com unidades
    if (!repetida && ids.length && toks.length && userText.length >= 6 && userText.length <= 70) {
      var L = aprLoad(), key = q.strong.slice().sort().join(' ');
      if (key) { var f = L.freq[key] || (L.freq[key] = { n: 0, t: 0, q: userText.slice(0, 70) }); f.n++; f.t = Date.now(); f.q = userText.slice(0, 70); aprPoda(L); aprSave(); }
    }
  }

  function aprFeedback(sinal) {
    var u = session.ult;
    if (!u || u.fb || (sinal !== 'bom' && sinal !== 'ruim')) return false;
    u.fb = sinal;
    var L = aprLoad();
    L.n++;
    if (sinal === 'bom') {
      L.up++;
      if (u.ids.length && u.tokens.length) aprReforca(u.tokens, u.ids, 3);
      aprConfirmaApelido(u);
    } else {
      L.down++;
      if (u.ids.length && u.tokens.length) aprReforca(u.tokens, u.ids, -3);
      Object.keys(L.freq).forEach(function (k) { if (norm(L.freq[k].q) === norm(u.texto)) L.freq[k].n = Math.max(0, L.freq[k].n - 2); });
    }
    aprEnvelhece(L); aprPoda(L); aprSave();
    return true;
  }
  // a pessoa ligou, abriu a ficha, abriu o mapa ou copiou os dados de uma unidade: voto de confiança nela
  function aprUsou(unit) {
    var u = session.ult, id = unit && unit.id;
    if (!u || id == null || u.ids.indexOf(id) < 0 || u.usados[id] || !u.tokens.length) return false;
    u.usados[id] = 1;
    var L = aprLoad();
    L.n++;
    aprReforca(u.tokens, [id], 2);
    aprConfirmaApelido(u);
    aprEnvelhece(L); aprPoda(L); aprSave();
    return true;
  }
  function aprFrequentes(k) {
    var L = aprLoad();
    return Object.keys(L.freq).map(function (key) { return L.freq[key]; })
      .filter(function (f) { return f.n >= 2; })
      .sort(function (a, b) { return b.n - a.n || b.t - a.t; })
      .slice(0, k || 3).map(function (f) { return { texto: f.q, vezes: f.n }; });
  }
  function aprResumo() {
    var L = aprLoad(), pref = [];
    var porUni = {};
    Object.keys(L.tok).forEach(function (t) { Object.keys(L.tok[t]).forEach(function (id) { porUni[id] = (porUni[id] || 0) + L.tok[t][id]; }); });
    Object.keys(porUni).filter(function (id) { return porUni[id] >= 2; }).sort(function (a, b) { return porUni[b] - porUni[a]; }).slice(0, 5).forEach(function (id) {
      var d = data.filter(function (x) { return String(x.id) === String(id); })[0];
      if (d) pref.push({ nome: d.name || d.fullName || String(id), peso: Math.round(porUni[id] * 10) / 10 });
    });
    var apel = Object.keys(L.alias).slice(0, 8).map(function (a) {
      var m = L.alias[a];
      return { de: a, para: Object.keys(m).sort(function (x, y) { return m[y] - m[x]; }).slice(0, 3) };
    });
    return { n: L.n, bons: L.up, ruins: L.down, desde: L.t0, preferidas: pref, apelidos: apel, frequentes: aprFrequentes(5) };
  }
  function aprApagar() {
    apr = aprVazio();
    try { var st = aprStore(); if (st) st.removeItem(APR_KEY); } catch (e) { /* ignora */ }
    if (session) { session.ult = null; session.aprPend = null; }
  }

  return {
    aprender: { feedback: aprFeedback, usou: aprUsou, resumo: aprResumo, frequentes: aprFrequentes, apagar: aprApagar, ativo: aprAtivo },
    interpretar: interpretar, init: init, setCid: setCid, setMunicipios: setMunicipios, setCensoSuas: setCensoSuas, psiCenso: psiCensoAsk, psiCensoDados: function () { return { mun: CP_MUN, perfil: CP_PERFIL_MUN, equipe: CP_EQUIPE_MUN, interior: CP_INTERIOR, bvEquipe: CP_BV_EQUIPE }; }, bvCenso: boaVistaCensoAsk, municipiosRR: rrAsk, cid: cidAsk, norm: norm, piiBlock: piiBlock, crisis: crisis, plan: plan, planMulti: planMulti, planSeguimento: planSeguimento, contagem: contagem,
    directory: function (t, tabCat) { return directory(t, session, tabCat); },
    glossary: glossaryScore, compose: { directory: composeDirectory, glossary: composeGlossary },
    psi: psiScore, psiLista: PSI_E_PAIF, paifLista: PAIF_BASE, cadLista: CAD_BASE, rapsLista: RAPS_BASE, manual: manualAsk, manualLista: MANUAL, baseApp: baseApp, fichaAsk: fichaAsk, trechosDa: trechosDa, pbfPagamento: pbfPagamento,
    relato: relatoViolencia, planRelato: planRelato, dividirPartes: dividirPartes, planPartes: planPartes, partesSemResposta: partesSemResposta,
    ehCaso: ehCaso, planCaso: planCaso, metodoCaso: METODO_CASO, lerPergunta: lerPergunta, facetaNaoCoberta: facetaNaoCoberta, referencial: referencial, roteiroBase: roteiroBase,
    remember: remember, reset: reset, session: session, notar: notar, estado: estadoParaIA, deveEsclarecer: deveEsclarecer, historicoParaIA: historicoParaIA,
    aiOn: aiOn, aiGate: aiGate, seguimento: seguimento, buildPayload: buildPayload, streamAI: streamAI,
    verifyPhones: verifyPhones, panorama: panorama, isAmpla: isAmpla, cleanAI: cleanAI, cleanPartial: cleanPartial, conferir: conferir, unidadesDesconhecidas: unidadesDesconhecidas, avisosFatos: avisosFatos, separarSugestoes: separarSugestoes, ocultarSugestoes: ocultarSugestoes, mentionedUnits: mentionedUnits, telHref: telHref, slim: slim,
    config: CFG, emergencia: EMERGENCIA, glossarioLista: GLOSSARIO
  };
});

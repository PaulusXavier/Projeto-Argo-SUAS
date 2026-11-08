/* ============================================================
   argo-habilidades.js — o mascote calcula, mede distância e traduz.

   Lógica pura (sem DOM, sem rede): lê o pedido escrito em português e devolve o resultado.
   A ligação com o app (de onde vêm as unidades e a posição, botões, serviços de tradução e de mapa)
   fica em js/app.js, bloco "HABILIDADES DO MASCOTE". Teste: npm run test:habilidades.

   Por que não é IA: modelo de linguagem erra conta e inventa distância. Aqui um programa executa a conta
   (sem eval) e as distâncias saem de coordenadas, então o resultado é conferível e funciona sem internet.

     ArgoHabilidades.calcular(texto, { hoje, sm, bf })   → { linhas, destaque, copiar, ferramenta, nota, faltando } | null
     ArgoHabilidades.lerDistancia(texto, pontos)          → { a, b, modo, tempo } | null
     ArgoHabilidades.resolver(nome, pontos)               → { ponto } | { ambiguos } | { nenhum }
     ArgoHabilidades.medir(a, b, modo)                    → { linhas, kmRua, kmReta, ... }
     ArgoHabilidades.planejarTraducao(texto)              → { texto, de, para, faltaTexto, soSeEstrangeiro } | null

   Sem lookbehind e sem BigInt de propósito (Safari/iOS antigos quebram o arquivo inteiro).
   ============================================================ */
(function (root) {
  'use strict';

  var H = {};

  /* ---------------------------------------------------------------- utilidades */

  function sem(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function limpa(v) { return Math.round(v * 1e10) / 1e10; }
  function fmt(v, max, min) {
    v = limpa(v);
    if (!isFinite(v)) return String(v);
    return v.toLocaleString('pt-BR', { maximumFractionDigits: max == null ? 6 : max, minimumFractionDigits: min || 0 });
  }
  function reais(v) { return 'R$ ' + fmt(v, 2, 2); }
  function plural(n, s, p) { return fmt(n) + ' ' + (Math.abs(n) === 1 ? s : p); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // Número escrito do jeito brasileiro ("1.518,50", "R$ 3.200", "15,04") ou com ponto decimal ("0.1504").
  var NUM_SRC = '(?:[1-9]\\d{0,2}(?:\\.\\d{3})+(?!\\d)(?:,\\d+)?|\\d+(?:[.,]\\d+)?)';
  function num(s) {
    s = String(s);
    if (s.indexOf(',') >= 0) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
    if (/^[1-9]\d{0,2}(?:\.\d{3})+$/.test(s)) return parseFloat(s.replace(/\./g, ''));
    return parseFloat(s);
  }

  /* ---------------------------------------------------------------- números por extenso */

  var UNID = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900 };
  function ehUnid(w) { return Object.prototype.hasOwnProperty.call(UNID, w); }

  // "3 mil" → "3000"; "vinte e cinco" → "25"; "dois mil e quinhentos" → "2500".
  function porExtenso(n) {
    n = n.replace(/(\d+(?:,\d+)?)\s*(milhoes|milhao|mil)\b/g, function (_, d, u) {
      var v = parseFloat(d.replace(',', '.')) * (u === 'mil' ? 1000 : 1e6);
      return String(Math.round(v));
    });
    var w = n.split(' '), out = [], i = 0;
    while (i < w.length) {
      if (!(ehUnid(w[i]) || w[i] === 'mil')) { out.push(w[i]); i++; continue; }
      var tot = 0, cur = 0, j = i, usou = false;
      while (j < w.length) {
        var p = w[j];
        if (ehUnid(p)) { cur += UNID[p]; usou = true; j++; }
        else if (p === 'e' && j > i && j + 1 < w.length && (ehUnid(w[j + 1]) || w[j + 1] === 'mil')) { j++; }
        else if (p === 'mil') { tot += (cur || 1) * 1000; cur = 0; usou = true; j++; }
        else if (p === 'milhao' || p === 'milhoes') { tot += (cur || 1) * 1e6; cur = 0; usou = true; j++; }
        else break;
      }
      if (!usou) { out.push(w[i]); i++; continue; }
      out.push(String(tot + cur));
      i = j;
    }
    return out.join(' ');
  }

  /* ---------------------------------------------------------------- avaliador de expressões (sem eval) */

  var FILLER = /\b(?:por favor|pf|pfv|me ajuda|me ajude|pode|poderia|voce|vc|calcule|calcula|calcular|calculo|quanto|qual|e|eh|o|a|os|as|de|do|da|resultado|que|conta|faz|fazer|faca|pra|para|mim|mascote|argo|ai|aqui|isso|ola|oi|valor|reais|real|soma|some|total|da|dar|da|fica|vale|sera|seria|sao|me|diz|diga|fala|fale)\b/g;
  var RE_INTENCAO = /\b(?:quanto|calcul\w*|conta|resultado|soma|some|subtraia|multiplique|divida|quanto da|quanto fica)\b/;

  function simbolizar(n) {
    return n
      .replace(/r\$/g, ' ')
      .replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–—]/g, '-')
      .replace(/(\d)\s*x\s*(?=\d|\()/g, '$1 * ')
      .replace(/\bmultiplicado (?:por|pela|pelo)\b|\bvezes\b/g, ' * ')
      .replace(/\bdividido (?:por|pela|pelo)\b|\bdividir (?:por|pela|pelo)\b/g, ' / ')
      .replace(/\bmais\b/g, ' + ').replace(/\bmenos\b/g, ' - ')
      .replace(/\bpor ?cento\b/g, '%')
      .replace(/%\s*(?:de|do|da|dos|das)\s+(?=\d|\()/g, '% * ')
      .replace(/\bao quadrado\b/g, ' ^ 2 ').replace(/\bao cubo\b/g, ' ^ 3 ')
      .replace(/\belevado (?:a|ao|na)\b|\bna potencia\b/g, ' ^ ')
      .replace(/\s+/g, ' ').trim();
  }

  // Quebra o texto simbolizado em fichas; devolve null se sobrar palavra que não seja enchimento.
  function tokenizar(s) {
    var toks = [], i = 0, m;
    var reNum = new RegExp('^' + NUM_SRC);
    while (i < s.length) {
      var c = s.charAt(i);
      if (c === ' ') { i++; continue; }
      if ((m = reNum.exec(s.slice(i)))) { toks.push({ t: 'num', v: num(m[0]), raw: m[0] }); i += m[0].length; continue; }
      if (c === '%') { toks.push({ t: 'pct' }); i++; continue; }
      if (c === '*' && s.charAt(i - 1) === ' ' && s.slice(i - 2, i - 1) === '%' ) { toks.push({ t: 'op', v: '*', de: true }); i++; continue; }
      if ('+-*/^'.indexOf(c) >= 0) { toks.push({ t: 'op', v: c }); i++; continue; }
      if (c === '(') { toks.push({ t: 'lp' }); i++; continue; }
      if (c === ')') { toks.push({ t: 'rp' }); i++; continue; }
      if (/[a-z]/.test(c)) {
        var w = /^[a-z]+/.exec(s.slice(i))[0];
        i += w.length;
        FILLER.lastIndex = 0;
        if (FILLER.test(w) && w.replace(FILLER, '') === '') continue;
        return null;
      }
      return null;
    }
    return toks;
  }

  function erroCalc(codigo) { var e = new Error(codigo); e.calc = codigo; return e; }

  // Precedência: ^ (direita) > * / > + -. "A + B%" e "A − B%" aplicam B% sobre A; "B% × A" é B/100 × A.
  function avaliar(toks) {
    var i = 0, ops = 0;
    function pk() { return toks[i]; }
    function ehOp(v) { var t = toks[i]; return t && t.t === 'op' && (v.indexOf(t.v) >= 0); }
    function expr() {
      var l = termo();
      while (ehOp('+-')) {
        var op = toks[i++].v, r = termo(), lv, rv;
        ops++;
        if (r.pct && !l.pct) { lv = l.v; rv = l.v * r.v / 100; }
        else { lv = l.pct ? l.v / 100 : l.v; rv = r.pct ? r.v / 100 : r.v; }
        l = { v: op === '+' ? lv + rv : lv - rv, pct: false };
      }
      return l;
    }
    function termo() {
      var l = pot();
      while (ehOp('*/')) {
        var op = toks[i++].v, r = pot();
        ops++;
        var lv = l.pct ? l.v / 100 : l.v, rv = r.pct ? r.v / 100 : r.v;
        if (op === '/' && rv === 0) throw erroCalc('div0');
        l = { v: op === '*' ? lv * rv : lv / rv, pct: false };
      }
      return l;
    }
    function pot() {
      var b = unario();
      if (ehOp('^')) {
        i++; ops++;
        var e = pot();
        var bv = b.pct ? b.v / 100 : b.v, ev = e.pct ? e.v / 100 : e.v;
        var v = Math.pow(bv, ev);
        if (!isFinite(v)) throw erroCalc('sintaxe');
        return { v: v, pct: false };
      }
      return b;
    }
    function unario() {
      if (ehOp('-')) { i++; var x = unario(); return { v: -x.v, pct: x.pct }; }
      if (ehOp('+')) { i++; return unario(); }
      return primario();
    }
    function primario() {
      var t = pk();
      if (!t) throw erroCalc('sintaxe');
      var r;
      if (t.t === 'num') { i++; r = { v: t.v, pct: false }; }
      else if (t.t === 'lp') {
        i++; r = expr();
        if (!pk() || pk().t !== 'rp') throw erroCalc('sintaxe');
        i++;
      } else throw erroCalc('sintaxe');
      if (pk() && pk().t === 'pct') { i++; r = { v: r.v, pct: true }; }
      return r;
    }
    if (toks.length > 80) throw erroCalc('sintaxe');
    var res = expr();
    if (i !== toks.length) throw erroCalc('sintaxe');
    if (res.pct) res = { v: res.v / 100, pct: false };
    if (!isFinite(res.v) || Math.abs(res.v) > 1e15) throw erroCalc('sintaxe');
    return { valor: res.v, ops: ops };
  }

  function mostrarConta(toks, cents) {
    var out = '';
    toks.forEach(function (t) {
      var s;
      if (t.t === 'num') s = fmt(t.v, 6, cents ? 2 : 0);
      else if (t.t === 'pct') { out += '%'; return; }
      else if (t.t === 'op') s = t.de ? 'de' : (t.v === '*' ? '×' : t.v === '/' ? '÷' : t.v === '-' ? '−' : t.v);
      else s = t.t === 'lp' ? '(' : ')';
      if (t.t === 'lp') out += (out && !/[(\s]$/.test(out) ? ' ' : '') + s;
      else if (t.t === 'rp') out += s;
      else out += (out && !/[(]$/.test(out) ? ' ' : '') + s;
    });
    return out;
  }

  function contaDireta(bruto, n) {
    n = n.replace(/[?!=.]+\s*$/, '').trim();
    var moeda = /r\$|\breais\b|\breal\b/.test(n);
    var intencao = RE_INTENCAO.test(n);
    // Telefone, lei, CEP, CPF/NIS: mesmo com números e traços, nada disso é conta.
    if (/\b(?:lei|decreto|portaria|artigo|art|cep|cpf|nis|rg|telefone|tel|cel|whatsapp|processo|oficio)\b/.test(n) && !/\bquanto e\b|\bcalcul/.test(n)) return null;
    if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(n)) return null; // data, não divisão
    var conv = porExtenso(n);
    if (!/\d/.test(conv)) return null;
    var s = simbolizar(conv);
    var toks = tokenizar(s);
    if (!toks || !toks.length) return null;
    var cents = /\d,\d{2}(?!\d)/.test(n);
    var temOp = toks.some(function (t) { return t.t === 'op'; });
    if (!temOp) return null;
    var pct = toks.some(function (t) { return t.t === 'pct'; });
    var forte = toks.some(function (t) { return t.t === 'op' && (t.v === '+' || t.v === '*' || t.v === '^' || t.v === '/' && /\s\/\s/.test(bruto)); });
    var menosForte = toks.some(function (t) { return t.t === 'op' && (t.v === '-' || t.v === '/'); });
    if (!forte && !(menosForte && (intencao || moeda || pct))) {
      if (!intencao) return null;
    }
    var r;
    try { r = avaliar(toks); }
    catch (e) {
      if (e && e.calc === 'div0') return { linhas: ['Não dá para dividir por zero. 🙂 Confira a conta.'], copiar: '', erro: true };
      return null;
    }
    var conta = mostrarConta(toks, cents && !moeda);
    var res = moeda ? reais(r.valor) : fmt(r.valor, 6, cents ? 2 : 0);
    return { destaque: res, linhas: [conta + ' = **' + res + '**'], copiar: moeda ? fmt(r.valor, 2, 2) : fmt(r.valor), ferramenta: 'calculadora' };
  }

  /* ---------------------------------------------------------------- percentuais em frase */

  function porcentagemEmFrase(n) {
    var moeda = /r\$|\breais\b|\breal\b/.test(n);
    var N = NUM_SRC, P = '(' + N + ')\\s*(?:%|por ?cento)';
    var fmtV = function (v) { return moeda ? reais(v) : fmt(v); };
    var m = new RegExp('\\b(desconto|abatimento|abater|descontar|descontando)\\b.*?' + P + '\\s*(?:em|sobre|no valor de|de|do valor de|num|na|no)?\\s*(?:r\\$\\s*)?(' + N + ')').exec(n);
    if (m) {
      var p = num(m[2]), v = num(m[3]), d = v * p / 100, r = v - d;
      return { destaque: fmtV(r), linhas: [fmt(v) + ' − ' + fmt(p) + '% = **' + fmtV(r) + '**', 'O desconto em si é de ' + fmtV(d) + '.'], copiar: fmt(r, 2), ferramenta: 'porcentagem' };
    }
    m = new RegExp('\\b(aumento|acrescimo|reajuste|acrescer|aumentar|reajustar)\\b.*?' + P + '\\s*(?:em|sobre|no valor de|de|do valor de|num|na|no)?\\s*(?:r\\$\\s*)?(' + N + ')').exec(n);
    if (m) {
      var p2 = num(m[2]), v2 = num(m[3]), a = v2 * p2 / 100, r2 = v2 + a;
      return { destaque: fmtV(r2), linhas: [fmt(v2) + ' + ' + fmt(p2) + '% = **' + fmtV(r2) + '**', 'O aumento em si é de ' + fmtV(a) + '.'], copiar: fmt(r2, 2), ferramenta: 'porcentagem' };
    }
    // "quanto por cento é 30 de 120" / "30 é quantos por cento de 120" / "qual a porcentagem de 30 em 120"
    var alvo = null;
    m = new RegExp('\\bquantos?\\s*(?:por ?cento|%)\\s*(?:e|eh|representa|equivale)?\\s*(?:r\\$\\s*)?(' + N + ')\\s*(?:de|do|em relacao a|em relacao ao|sobre)\\s*(?:r\\$\\s*)?(' + N + ')').exec(n)
      || new RegExp('(' + N + ')\\s*(?:e|eh|representa|equivale a)\\s*quantos?\\s*(?:por ?cento|%)\\s*(?:de|do)\\s*(?:r\\$\\s*)?(' + N + ')').exec(n)
      || new RegExp('\\b(?:porcentagem|percentual|percentagem)\\s*(?:de|que)\\s*(?:r\\$\\s*)?(' + N + ')\\s*(?:representa |e |eh )?(?:de|do|em|sobre)\\s*(?:r\\$\\s*)?(' + N + ')').exec(n);
    if (m) {
      var x = num(m[1]), y = num(m[2]);
      if (y === 0) return { linhas: ['Não dá para dividir por zero. 🙂 Confira os valores.'], copiar: '', erro: true };
      alvo = x / y * 100;
      return { destaque: fmt(alvo, 4) + '%', linhas: [fmt(x) + ' é **' + fmt(alvo, 4) + '%** de ' + fmt(y) + '.'], copiar: fmt(alvo, 4) + '%', ferramenta: 'porcentagem' };
    }
    // "variação de 100 para 130"
    m = new RegExp('\\b(?:variacao|diferenca percentual|crescimento|aumento percentual|reducao percentual|queda)(?: percentual)?\\s*(?:de|entre|do)?\\s*(?:r\\$\\s*)?(' + N + ')\\s*(?:para|a|e|ate)\\s*(?:r\\$\\s*)?(' + N + ')').exec(n);
    if (m) {
      var a1 = num(m[1]), b1 = num(m[2]);
      if (a1 === 0) return { linhas: ['Não dá para calcular a variação a partir de zero.'], copiar: '', erro: true };
      var vp = (b1 - a1) / Math.abs(a1) * 100;
      var txt = 'De ' + fmt(a1) + ' para ' + fmt(b1) + ': variação de **' + fmt(vp, 4) + '%** (' + (b1 >= a1 ? 'aumento' : 'redução') + ' de ' + fmt(Math.abs(b1 - a1)) + ').';
      return { destaque: fmt(vp, 4) + '%', linhas: [txt], copiar: fmt(vp, 4) + '%', ferramenta: 'porcentagem' };
    }
    return null;
  }

  /* ---------------------------------------------------------------- funções: lista, raiz, dobro... */

  function funcoes(n) {
    var moeda = /r\$|\breais\b|\breal\b/.test(n);
    var N = NUM_SRC, m;
    var fv = function (v, cts) { return moeda ? reais(v) : fmt(v, 6, cts); };
    // soma / média de uma lista: "média de 10, 20 e 30", "soma de 1.200, 800 e 450,50"
    m = /\b(media|soma|somar|total|maior|menor)\b(?: aritmetica)?\s*(?:de|dos|das|do|entre)?\s*(.+)$/.exec(n);
    if (m && /\d/.test(m[2])) {
      var resto = m[2].replace(/[?!.]+\s*$/, '').replace(/r\$/g, ' ').replace(/\breais\b/g, ' ').trim();
      var partes = resto.split(/\s*;\s*|\s+e\s+|,\s+/).map(function (x) { return x.trim(); }).filter(Boolean);
      var okNum = new RegExp('^' + N + '$');
      if (partes.length >= 2 && partes.every(function (x) { return okNum.test(x); })) {
        var vals = partes.map(num), cts = /,\d{2}(?!\d)/.test(resto) ? 2 : 0, v, nome;
        if (m[1] === 'media') { v = vals.reduce(function (s, x) { return s + x; }, 0) / vals.length; nome = 'Média'; }
        else if (m[1] === 'maior') { v = Math.max.apply(null, vals); nome = 'Maior valor'; }
        else if (m[1] === 'menor') { v = Math.min.apply(null, vals); nome = 'Menor valor'; }
        else { v = vals.reduce(function (s, x) { return s + x; }, 0); nome = m[1] === 'total' ? 'Total' : 'Soma'; }
        v = limpa(v);
        return { destaque: fv(v, cts), linhas: [nome + ' de ' + vals.map(function (x) { return fmt(x, 6, cts); }).join(', ') + ' = **' + fv(v, cts) + '**'], copiar: fmt(v, 6, cts), ferramenta: 'lista' };
      }
    }
    m = new RegExp('\\braiz\\s*(quadrada|cubica)?\\s*(?:de|do)?\\s*(' + N + ')').exec(n);
    if (m) {
      var x = num(m[2]), cubica = m[1] === 'cubica';
      if (x < 0 && !cubica) return { linhas: ['Não existe raiz quadrada real de número negativo.'], copiar: '', erro: true };
      var rv = cubica ? Math.cbrt(x) : Math.sqrt(x);
      return { destaque: fmt(rv, 6), linhas: ['Raiz ' + (cubica ? 'cúbica' : 'quadrada') + ' de ' + fmt(x) + ' = **' + fmt(rv, 6) + '**'], copiar: fmt(rv, 6), ferramenta: 'calculadora' };
    }
    m = new RegExp('\\b(dobro|triplo|quadruplo|quintuplo|metade|terco|quarta parte)\\s*(?:de|do|da)?\\s*(?:r\\$\\s*)?(' + N + ')').exec(n);
    if (m) {
      var f = { dobro: 2, triplo: 3, quadruplo: 4, quintuplo: 5, metade: 0.5, terco: 1 / 3, 'quarta parte': 0.25 }[m[1]];
      var base = num(m[2]), r = base * f;
      var nomeF = { dobro: 'Dobro', triplo: 'Triplo', quadruplo: 'Quádruplo', quintuplo: 'Quíntuplo', metade: 'Metade', terco: 'Terço', 'quarta parte': 'Quarta parte' }[m[1]];
      var ct = /,\d{2}(?!\d)/.test(m[2]) ? 2 : 0;
      return { destaque: fv(r, ct), linhas: [nomeF + ' de ' + fmt(base, 6, ct) + ' = **' + fv(r, ct) + '**'], copiar: fmt(r, 6, ct), ferramenta: 'calculadora' };
    }
    return null;
  }

  /* ---------------------------------------------------------------- referências do app */

  function refs(opc) {
    var sm = opc && isFinite(opc.sm) && opc.sm > 0 ? opc.sm : 1621;
    var bf = opc && isFinite(opc.bf) && opc.bf > 0 ? opc.bf : 218;
    return { sm: sm, bf: bf };
  }

  // "1/4 do salário mínimo", "meio salário mínimo", "3 salários mínimos", "30% do salário mínimo", "R$ 2.000 são quantos salários mínimos"
  function salarioMinimo(n, opc) {
    if (!/\bsalarios? minimos?\b/.test(n)) return null;
    var R = refs(opc), N = NUM_SRC, m;
    var ate = n.slice(0, n.search(/\bsalarios? minimos?\b/));
    var depois = n.slice(n.search(/\bsalarios? minimos?\b/));
    // valor em reais → quantos salários
    if (/\bquantos? salarios?\b/.test(n)) {
      var mr = new RegExp('(?:r\\$\\s*)?(' + N + ')\\s*(?:reais|real)?').exec(n.replace(/\bquantos? salarios? minimos?\b.*$/, ''));
      if (mr) {
        var vr = num(mr[1]);
        return { destaque: fmt(vr / R.sm, 2) + ' SM', linhas: [reais(vr) + ' ÷ ' + reais(R.sm) + ' = **' + fmt(vr / R.sm, 2) + ' salários mínimos**'], copiar: fmt(vr / R.sm, 2), nota: 'Salário mínimo de referência: ' + reais(R.sm) + ' (o mesmo da ferramenta Renda per capita).', ferramenta: 'renda' };
      }
    }
    var f = null, lbl = '';
    if ((m = /(\d+)\s*\/\s*(\d+)\s*(?:do |de |dos |das )?$/.exec(ate)) && +m[2] > 0) { f = +m[1] / +m[2]; lbl = m[1] + '/' + m[2]; }
    else if ((m = new RegExp('(' + N + ')\\s*(?:%|por ?cento)\\s*(?:do |de |dos |das )?$').exec(ate))) { f = num(m[1]) / 100; lbl = fmt(num(m[1])) + '%'; }
    else if (/\b(?:meio|meia|metade)\s*(?:do |de |dos |das )?$/.test(ate)) { f = 0.5; lbl = '½'; }
    else if (/\bum quarto\s*(?:do |de )?$/.test(ate)) { f = 0.25; lbl = '¼'; }
    else if (/\bum terco\s*(?:do |de )?$/.test(ate)) { f = 1 / 3; lbl = '⅓'; }
    else if (/\bdobro\s*(?:do |de )?$/.test(ate)) { f = 2; lbl = '2'; }
    else {
      var conv = porExtenso(ate.replace(/\s+/g, ' ').trim());
      if ((m = new RegExp('(' + N + ')\\s*(?:do |de |dos |das )?$').exec(conv))) { f = num(m[1]); lbl = fmt(f); }
    }
    if (f == null || !isFinite(f)) return null;
    var v = R.sm * f;
    var nome = f === 1 || (f < 1 && lbl.indexOf('/') >= 0 + 0 && false) ? 'salário mínimo' : (f > 1 ? 'salários mínimos' : 'do salário mínimo');
    if (f > 1 && f !== Math.round(f)) nome = 'salários mínimos';
    var titulo = f > 1 ? lbl + ' ' + nome : lbl + ' do salário mínimo';
    if (f === 1) titulo = '1 salário mínimo';
    void depois;
    return { destaque: reais(v), linhas: [titulo + ' = ' + reais(R.sm) + ' × ' + fmt(f, 4) + ' = **' + reais(v) + '**'], copiar: fmt(v, 2, 2), nota: 'Salário mínimo de referência: ' + reais(R.sm) + ' (o mesmo da ferramenta Renda per capita, editável lá).', ferramenta: 'renda' };
  }

  /* ---------------------------------------------------------------- renda per capita */

  function rendaPerCapita(n, opc) {
    if (!/\bper ?capita\b/.test(n)) return null;
    var R = refs(opc), N = NUM_SRC, m;
    var pessoas = null;
    var sobra = n;
    if ((m = /\b(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(?:pessoas?|membros?|moradores?|integrantes?)\b/.exec(n))) {
      pessoas = /^\d+$/.test(m[1]) ? +m[1] : UNID[m[1]];
      sobra = n.replace(m[0], ' ');
    } else if ((m = /\b(?:familia|casa|moram|composta)\s+(?:de|por|com)\s+(\d+)\b/.exec(n))) {
      pessoas = +m[1];
      sobra = n.replace(m[0], ' ');
    }
    var exemplo = 'Exemplo: "renda per capita de 4 pessoas com renda total de 2.400".';
    if (!pessoas || pessoas < 1 || pessoas > 99) {
      return { faltando: true, linhas: ['Para calcular a renda per capita preciso saber **quantas pessoas moram na casa** e **a renda de cada uma** (ou a renda total). ' + exemplo], copiar: '', ferramenta: 'renda' };
    }
    var corpo = sobra.replace(/\bper ?capita\b/g, ' ').replace(/r\$/g, ' ');
    var totalM = new RegExp('\\b(?:renda )?total\\s*(?:da familia|familiar)?\\s*(?:de|e|eh|:)?\\s*(' + N + ')').exec(corpo);
    var rendas = [];
    if (totalM) rendas = [num(totalM[1])];
    else {
      var re = new RegExp(N, 'g'), mm;
      while ((mm = re.exec(corpo))) rendas.push(num(mm[0]));
    }
    if (!rendas.length) {
      return { faltando: true, linhas: ['Entendi **' + pessoas + ' ' + (pessoas === 1 ? 'pessoa' : 'pessoas') + '**, mas faltou a renda. Diga o valor de cada renda ou a renda total. ' + exemplo], copiar: '', ferramenta: 'renda' };
    }
    var total = rendas.reduce(function (s, x) { return s + x; }, 0);
    var pc = total / pessoas;
    var meio = R.sm / 2, quarto = R.sm / 4;
    var dentro = function (b) { return b ? '✅ dentro' : '❌ fora'; };
    var linhas = [
      'Renda per capita: **' + reais(pc) + '**',
      'Entendi: ' + (rendas.length > 1 ? rendas.map(reais).join(' + ') + ' = ' + reais(total) : 'renda total de ' + reais(total)) + ' ÷ ' + pessoas + (pessoas === 1 ? ' pessoa.' : ' pessoas.'),
      '- ' + dentro(pc <= R.bf) + ': Bolsa Família (até ' + reais(R.bf) + ' por pessoa)',
      '- ' + dentro(pc > R.bf && pc <= meio) + ': Regra de Proteção (quem já recebe) (acima de ' + reais(R.bf) + ' e até ½ salário mínimo, ' + reais(meio) + ')',
      '- ' + dentro(pc <= meio || total <= 3 * R.sm) + ': CadÚnico, baixa renda (até ½ salário mínimo por pessoa, ' + reais(meio) + ', ou renda total até 3 salários, ' + reais(3 * R.sm) + ')',
      '- ' + dentro(pc <= quarto) + ': BPC (além do requisito de idade ou deficiência) (até ¼ do salário mínimo por pessoa, ' + reais(quarto) + ')'
    ];
    return { destaque: reais(pc), linhas: linhas, copiar: fmt(pc, 2, 2), nota: 'Referências (salário mínimo ' + reais(R.sm) + '; Bolsa Família ' + reais(R.bf) + ') iguais às da ferramenta Renda per capita. Em geral não entram BPC, Bolsa Família e auxílios assistenciais na renda. Confira a regra vigente antes de orientar a família.', ferramenta: 'renda' };
  }

  /* ---------------------------------------------------------------- datas e prazos */

  var DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  function dataBR(d) { return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function diaSemana(d) { return DIAS_SEMANA[d.getDay()]; }
  function mkData(a, m, d) {
    var x = new Date(a, m - 1, d);
    return (x.getFullYear() === a && x.getMonth() === m - 1 && x.getDate() === d) ? x : null;
  }
  function diasEntre(a, b) { return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000); }
  function somarDias(d, k) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k); }
  function somarMeses(d, k) {
    var x = new Date(d.getFullYear(), d.getMonth() + k, 1);
    var ultimo = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
    x.setDate(Math.min(d.getDate(), ultimo));
    return x;
  }
  function uteisEntre(a, b) { // dias úteis (seg–sex) depois de a, até b inclusive; sem feriados
    var sinal = b < a ? -1 : 1, x = a, n = 0, guarda = 0;
    while (diasEntre(x, b) !== 0 && guarda++ < 40000) { x = somarDias(x, sinal); var w = x.getDay(); if (w !== 0 && w !== 6) n++; }
    return n * sinal;
  }
  function somarUteis(d, k) {
    var sinal = k < 0 ? -1 : 1, x = d, faltam = Math.abs(k), guarda = 0;
    while (faltam > 0 && guarda++ < 40000) { x = somarDias(x, sinal); var w = x.getDay(); if (w !== 0 && w !== 6) faltam--; }
    return x;
  }
  function achaDatas(n) {
    var re = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}|\d{2})(?!\d)/g, m, out = [];
    while ((m = re.exec(n))) {
      var a = +m[3]; if (m[3].length === 2) a = a <= 30 ? 2000 + a : 1900 + a;
      var d = mkData(a, +m[2], +m[1]);
      if (d) out.push({ d: d, txt: m[0] });
    }
    return out;
  }
  function idadeExata(nasc, ref) {
    var anos = ref.getFullYear() - nasc.getFullYear(), meses = ref.getMonth() - nasc.getMonth(), dias = ref.getDate() - nasc.getDate();
    if (dias < 0) { meses--; dias += new Date(ref.getFullYear(), ref.getMonth(), 0).getDate(); }
    if (meses < 0) { anos--; meses += 12; }
    return { anos: anos, meses: meses, dias: dias };
  }

  function datas(n, opc) {
    var hoje = (opc && opc.hoje instanceof Date) ? opc.hoje : new Date();
    hoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    var ds = achaDatas(n), m;
    var uteis = /\bdias? uteis?\b/.test(n);
    var nota = 'Dias úteis = segunda a sexta, sem descontar feriados. Para prazo legal, confira o calendário oficial.';
    // idade
    if (/\b(?:idade|nasceu|nasci|nascimento|nascido|nascida|quantos anos)\b/.test(n) && ds.length === 1) {
      var nasc = ds[0].d;
      if (nasc > hoje) return { linhas: ['Essa data de nascimento (' + dataBR(nasc) + ') ainda não chegou.'], copiar: '', erro: true };
      var id = idadeExata(nasc, hoje);
      var prox = new Date(hoje.getFullYear(), nasc.getMonth(), nasc.getDate());
      if (prox <= hoje) prox = new Date(hoje.getFullYear() + 1, nasc.getMonth(), nasc.getDate());
      var txt = 'Nascimento em ' + dataBR(nasc) + ': **' + plural(id.anos, 'ano', 'anos') + ', ' + plural(id.meses, 'mês', 'meses') + ' e ' + plural(id.dias, 'dia', 'dias') + '** hoje (' + dataBR(hoje) + ').';
      return { destaque: plural(id.anos, 'ano', 'anos'), linhas: [txt, 'Próximo aniversário em ' + dataBR(prox) + ' (' + diaSemana(prox) + ', daqui a ' + plural(diasEntre(hoje, prox), 'dia', 'dias') + ').'], copiar: plural(id.anos, 'ano', 'anos'), ferramenta: 'idade' };
    }
    // dias entre duas datas
    if (ds.length >= 2 && /\b(?:dias?|quanto tempo|diferenca|intervalo|entre)\b/.test(n)) {
      var a = ds[0].d, b = ds[1].d, cor = diasEntre(a, b), ut = uteisEntre(a, b);
      var mesesC = Math.abs(b.getFullYear() * 12 + b.getMonth() - a.getFullYear() * 12 - a.getMonth()) - ((b >= a ? b.getDate() < a.getDate() : a.getDate() < b.getDate()) ? 1 : 0);
      var l = ['De ' + dataBR(a) + ' a ' + dataBR(b) + ': **' + plural(Math.abs(cor), 'dia corrido', 'dias corridos') + '**.', 'Dias úteis (seg–sex, sem feriados): ' + Math.abs(ut) + '.'];
      if (mesesC > 0) l.push('Em meses completos: ' + mesesC + '.');
      return { destaque: plural(Math.abs(uteis ? ut : cor), uteis ? 'dia útil' : 'dia', uteis ? 'dias úteis' : 'dias'), linhas: l, copiar: String(Math.abs(uteis ? ut : cor)) + (uteis ? ' dias úteis' : ' dias'), nota: nota, ferramenta: 'prazos' };
    }
    // quantos dias faltam / passaram em relação a uma data
    if (ds.length === 1 && /\b(?:faltam|falta|faltou|restam|resta|ate|desde|passaram|passou|faz|faz quantos|atras)\b/.test(n) && /\bdias?\b|\bquanto tempo\b/.test(n) && !/\b(?:depois|apos|antes|a partir|contad\w+)\b/.test(n)) {
      var alvo = ds[0].d, c = diasEntre(hoje, alvo), ut2 = uteisEntre(hoje, alvo);
      if (c === 0) return { destaque: 'hoje', linhas: ['A data ' + dataBR(alvo) + ' é **hoje** (' + diaSemana(alvo) + ').'], copiar: 'hoje', ferramenta: 'prazos' };
      var linhaP = c > 0
        ? 'Faltam **' + plural(c, 'dia', 'dias') + '** para ' + dataBR(alvo) + ' (' + diaSemana(alvo) + ').'
        : 'Passaram **' + plural(-c, 'dia', 'dias') + '** desde ' + dataBR(alvo) + ' (' + diaSemana(alvo) + ').';
      return { destaque: plural(Math.abs(c), 'dia', 'dias'), linhas: [linhaP, 'Dias úteis (seg–sex, sem feriados): ' + Math.abs(ut2) + '.'], copiar: String(Math.abs(c)) + ' dias', nota: nota, ferramenta: 'prazos' };
    }
    // somar/subtrair prazo: "30 dias depois de 10/11/2026", "prazo de 30 dias úteis a partir de ...", "daqui a 6 meses"
    m = /(\d+)\s*(dias? uteis?|dias?|semanas?|meses|mes|anos?)\b/.exec(n);
    if (m) {
      var qtd = +m[1], un = m[2];
      var antes = /\bantes\b|\batras\b/.test(n);
      var temDirecao = /\b(?:depois|apos|a partir|contad\w+|daqui a|dentro de|prazo|antes|atras|vence|vencimento)\b/.test(n);
      var baseHoje = /\bdaqui a\b|\bdentro de\b|\bhoje\b/.test(n);
      var base = ds.length ? ds[0].d : (baseHoje ? hoje : null);
      if (!temDirecao || !base) return null;
      var sinal = antes ? -1 : 1, res, rotulo;
      if (/uteis?/.test(un)) { res = somarUteis(base, sinal * qtd); rotulo = plural(qtd, 'dia útil', 'dias úteis'); }
      else if (/^dia/.test(un)) { res = somarDias(base, sinal * qtd); rotulo = plural(qtd, 'dia corrido', 'dias corridos'); }
      else if (/^semana/.test(un)) { res = somarDias(base, sinal * qtd * 7); rotulo = plural(qtd, 'semana', 'semanas'); }
      else if (/^mes/.test(un)) { res = somarMeses(base, sinal * qtd); rotulo = plural(qtd, 'mês', 'meses'); }
      else { res = somarMeses(base, sinal * qtd * 12); rotulo = plural(qtd, 'ano', 'anos'); }
      var baseTxt = ds.length ? dataBR(base) : 'hoje (' + dataBR(base) + ')';
      var linhaR = rotulo + ' ' + (antes ? 'antes de ' : 'depois de ') + baseTxt + ' é **' + dataBR(res) + '** (' + diaSemana(res) + ').';
      return { destaque: dataBR(res), linhas: [linhaR], copiar: dataBR(res), nota: /uteis?/.test(un) ? nota : '', ferramenta: 'prazos' };
    }
    return null;
  }

  /* ---------------------------------------------------------------- calcular: junta tudo */

  H.calcular = function (texto, opc) {
    var bruto = String(texto == null ? '' : texto);
    if (!bruto.trim() || bruto.length > 300) return null;
    var n = sem(bruto).replace(/\s+/g, ' ').trim();
    var pipeline = [
      function () { return rendaPerCapita(n, opc); },
      function () { return datas(n, opc); },
      function () { return salarioMinimo(porExtenso(n), opc); },
      function () { return porcentagemEmFrase(n); },
      function () { return funcoes(porExtenso(n)); },
      function () { return contaDireta(bruto, n); }
    ];
    for (var i = 0; i < pipeline.length; i++) {
      var r = null;
      try { r = pipeline[i](); } catch (e) { r = null; }
      if (r) return r;
    }
    return null;
  };

  /* ---------------------------------------------------------------- lugares e distância */

  // Sedes dos municípios de Roraima (coordenadas aproximadas, ~1 km): servem para distâncias sem internet.
  var MUNICIPIOS = [
    ['Alto Alegre', 2.9806, -61.3039], ['Amajari', 3.6522, -61.3689], ['Boa Vista', 2.8235, -60.6758], ['Bonfim', 3.3611, -59.8333],
    ['Cantá', 2.6097, -60.6061], ['Caracaraí', 1.8167, -61.1278], ['Caroebe', 0.8864, -59.6958], ['Iracema', 2.1819, -61.0472],
    ['Mucajaí', 2.4392, -60.9219], ['Normandia', 3.8903, -59.6256], ['Pacaraima', 4.4803, -61.1469], ['Rorainópolis', 0.9467, -60.4392],
    ['São João da Baliza', 0.9567, -59.9136], ['São Luiz', 1.0178, -60.0136], ['Uiramutã', 4.5983, -60.1892]
  ];
  H.municipios = function () {
    return MUNICIPIOS.map(function (x) { return { nome: x[0], lat: x[1], lng: x[2], tipo: 'municipio', aprox: true }; });
  };

  var BV = { south: 2.70, north: 2.95, west: -60.85, east: -60.55 };
  function dentroBV(p) { return p.lat >= BV.south && p.lat <= BV.north && p.lng >= BV.west && p.lng <= BV.east; }
  function haversine(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  H.haversine = haversine;

  var STOP_LUGAR = { o: 1, a: 1, os: 1, as: 1, de: 1, do: 1, da: 1, dos: 1, das: 1, ao: 1, aos: 1, no: 1, na: 1, em: 1, ate: 1, um: 1, uma: 1 };
  function tokensLugar(s) {
    return sem(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(function (w) { return w && !STOP_LUGAR[w]; });
  }

  // Acha o ponto citado pelo nome ("cras cauame", "pacaraima"). Várias unidades possíveis → ambiguos.
  H.resolver = function (nome, pontos) {
    var q = tokensLugar(nome);
    if (!q.length) return { nenhum: true };
    var cand = [], exatos = [];
    (pontos || []).forEach(function (p) {
      var nomes = [p.nome].concat(p.apelidos || []);
      var melhor = null;
      nomes.forEach(function (nm) {
        var t = tokensLugar(nm);
        if (!t.length) return;
        var cobre = q.every(function (w) { return t.some(function (x) { return x === w || (w.length >= 3 && x.indexOf(w) === 0); }); });
        if (!cobre) return;
        var exato = t.length === q.length && q.every(function (w) { return t.indexOf(w) >= 0; });
        if (exato || !melhor) melhor = { exato: exato, extra: t.length - q.length };
      });
      if (melhor) { cand.push({ p: p, extra: melhor.extra }); if (melhor.exato) exatos.push(p); }
    });
    if (exatos.length === 1) return { ponto: exatos[0] };
    if (exatos.length > 1) return { ambiguos: exatos };
    if (cand.length === 1) return { ponto: cand[0].p };
    if (!cand.length) return { nenhum: true };
    cand.sort(function (x, y) { return x.extra - y.extra; });
    if (cand[0].extra < cand[1].extra && q.length >= 2) return { ponto: cand[0].p };
    return { ambiguos: cand.map(function (c) { return c.p; }) };
  };

  var RE_AQUI = /^(?:aqui|daqui|de aqui|minha localizacao|minha posicao|onde estou|de onde estou|aqui onde estou|meu local|minha casa)$/;
  var MODOS = [
    ['moto', /\bde moto(?:cicleta)?\b|\bmoto\b/g], ['carro', /\bde carro\b|\bcarro\b|\bdirigindo\b/g],
    ['pe', /\ba pe\b|\bandando\b|\bcaminhando\b/g], ['bicicleta', /\bde bicicleta\b|\bde bike\b|\bbicicleta\b|\bbike\b/g],
    ['onibus', /\bde onibus\b|\bonibus\b/g]
  ];
  var SEPS = 'ate a|ate o|ate|para|pra|pro|ao|aos|a|de|do|da';

  function dividir(txt, seps) {
    var re = new RegExp('\\s(?:' + seps + ')\\s', 'g'), out = [], m;
    while ((m = re.exec(txt))) {
      var a = txt.slice(0, m.index).trim(), b = txt.slice(m.index + m[0].length).trim();
      if (a && b) out.push([a, b]);
      re.lastIndex = m.index + 1;
    }
    return out;
  }

  var RE_PEDE_DIST = /\b(?:distancia|quantos? (?:km|quilometros?|metros?)|a quantos (?:km|quilometros?|metros?)|quanto tempo|quanto demora|quanto falta|quantas horas|quantos minutos|quanto leva|longe|km de)\b/;

  // "distância entre A e B", "quantos km de A até B", "A fica a quantos km de B", "quanto falta daqui até B".
  H.lerDistancia = function (texto, pontos) {
    var n = sem(texto).replace(/\s+/g, ' ').trim();
    if (!n || n.length > 200 || !RE_PEDE_DIST.test(n)) return null;
    if (/\b(?:rota|trajeto|itinerario|roteiro)\b/.test(n)) return null;
    var modo = null, corpo = n;
    MODOS.forEach(function (mo) { mo[1].lastIndex = 0; if (!modo && mo[1].test(corpo)) modo = mo[0]; corpo = corpo.replace(mo[1], ' '); });
    corpo = corpo.replace(/\s+/g, ' ').trim()
      .replace(/[?!.]+\s*$/, '')
      .replace(/[,;]\s*(?:quantos?\s+(?:km|quilometros?|metros?|minutos|horas)|qual (?:e )?a distancia|quanto tempo)[^,;]*$/, '')
      .replace(/\s+(?:por favor|pf|pfv)$/, '').trim();
    var tempo = /\b(?:quanto tempo|quanto demora|quanto leva|quantas horas|quantos minutos)\b/.test(n);
    var cands = null, m;
    if ((m = /^(.+?)\s+fica\s+a\s+(?:quantos?|quantas?)\s+\w+(?:\s+\w+)?\s+(?:de|do|da)\s+(.+)$/.exec(corpo))) cands = [[m[1], m[2]]];
    else if ((m = /\bdistancia\s+(?:fica\s+|esta\s+|e\s+)?(?:(?:de|do|da)\s+)?(.+)$/.exec(corpo)) && dividir(m[1], SEPS).length) cands = dividir(m[1], SEPS);
    else if ((m = /\bentre\s+(.+)$/.exec(corpo)) && dividir(m[1], 'e').length) cands = dividir(m[1], 'e');
    else if ((m = /(?:^|\s)(?:daqui|de aqui)\s+(?:ate o|ate a|ate|a|ao|para|pra)\s+(.+)$/.exec(corpo))) cands = [['aqui', m[1]]];
    else if ((m = /\bquanto falta\s+(?:daqui\s+)?(?:ate o|ate a|ate|para o|para a|para|pra)\s+(.+)$/.exec(corpo))) cands = [['aqui', m[1]]];
    else if ((m = /(?:^|\s)(?:de|da|do|desde)\s+(.+)$/.exec(corpo)) && dividir(m[1], SEPS).length) cands = dividir(m[1], SEPS);
    if (!cands || !cands.length) return null;
    var limpar = function (s) { return s.replace(/^(?:o|a|os|as|do|da|de|ao|no|na)\s+/, '').replace(/\s+/g, ' ').trim(); };
    cands = cands.map(function (c) { return [limpar(c[0]), limpar(c[1])]; }).filter(function (c) { return c[0] && c[1]; });
    if (!cands.length) return null;
    var melhor = cands[0];
    if (pontos && cands.length > 1) {
      var nota = function (s) { if (RE_AQUI.test(s)) return 2; var r = H.resolver(s, pontos); return r.ponto ? 2 : r.ambiguos ? 1 : 0; };
      var best = -1;
      cands.forEach(function (c) { var sc = nota(c[0]) + nota(c[1]); if (sc > best) { best = sc; melhor = c; } });
    }
    return { a: melhor[0], b: melhor[1], modo: modo, tempo: tempo };
  };
  H.ehAqui = function (s) { return RE_AQUI.test(sem(s).replace(/\s+/g, ' ').trim()); };

  var VEL_URB = { carro: 30, moto: 30, bicicleta: 12, pe: 4.5, onibus: 20 };
  var VEL_ROD = { carro: 75, moto: 70, bicicleta: 15, pe: 4.5, onibus: 55 };
  var ROTULO_MODO = { carro: 'de carro', moto: 'de moto', pe: 'a pé', bicicleta: 'de bicicleta', onibus: 'de ônibus' };
  function fmtTempo(min) {
    min = Math.max(1, Math.round(min));
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), r = min % 60;
    return h + ' h' + (r ? ' ' + r + ' min' : '');
  }
  function fmtKm(km) { return km < 1 ? Math.round(km * 1000) + ' m' : fmt(km, km < 10 ? 1 : 0) + ' km'; }

  H.medir = function (a, b, modo) {
    var reta = haversine(a, b);
    var urbano = dentroBV(a) && dentroBV(b);
    var fator = urbano ? 1.3 : 1.2;
    var rua = reta * fator;
    var vel = urbano ? VEL_URB : VEL_ROD;
    var modos = modo && vel[modo] ? [modo] : (urbano ? (rua <= 8 ? ['carro', 'pe'] : ['carro']) : ['carro']);
    var linhas = [];
    if (reta < 0.05) {
      return { linhas: ['**' + a.nome + '** e **' + b.nome + '** são praticamente o mesmo lugar.'], kmRua: 0, kmReta: reta, urbano: urbano, modos: modos };
    }
    linhas.push('**' + a.nome + '** → **' + b.nome + '**: cerca de **' + fmtKm(rua) + '** por ' + (urbano ? 'rua' : 'estrada') + ' (em linha reta: ' + fmtKm(reta) + ').');
    var tempos = modos.map(function (mo) { return ROTULO_MODO[mo].replace(/^de /, '') === 'a pé' ? '' : ''; });
    void tempos;
    linhas.push(modos.map(function (mo) { return (mo === 'pe' ? 'A pé' : 'De ' + ROTULO_MODO[mo].replace(/^de /, '')) + ': ~' + fmtTempo(rua / vel[mo] * 60); }).join(' · ') + '.');
    var nota = 'Estimativa feita no aparelho: linha reta × ' + String(fator).replace('.', ',') + ' (' + (urbano ? 'ruas' : 'curvas da estrada') + ') a ' + modos.map(function (mo) { return vel[mo] + ' km/h ' + (mo === 'pe' ? '(a pé)' : '(' + ROTULO_MODO[mo] + ')'); }).join(' e ').replace(/\./g, ',') + ', sem trânsito nem paradas. Pode variar uns 10–20%: confira no app de mapas.';
    var aprox = (a.aprox || b.aprox);
    if (aprox) nota += ' A posição de ' + [a, b].filter(function (p) { return p.aprox; }).map(function (p) { return p.nome; }).join(' e ') + ' é aproximada.';
    return { linhas: linhas, kmRua: rua, kmReta: reta, urbano: urbano, modos: modos, nota: nota, a: a, b: b };
  };

  H.linkMapa = function (a, b, modo) {
    var tm = { carro: 'driving', moto: 'driving', pe: 'walking', bicicleta: 'bicycling', onibus: 'transit' }[modo] || 'driving';
    return 'https://www.google.com/maps/dir/?api=1&origin=' + a.lat.toFixed(6) + ',' + a.lng.toFixed(6) + '&destination=' + b.lat.toFixed(6) + ',' + b.lng.toFixed(6) + '&travelmode=' + tm;
  };

  /* ---------------------------------------------------------------- tradução (só a leitura do pedido) */

  var LANG_SRC = '(?:portugu[eê]s|brasileiro|espanhol|castelhano|venezuelano|ingl[eê]s|franc[eê]s)';
  var NOMES_IDIOMA = { pt: 'português', es: 'espanhol', en: 'inglês', fr: 'francês' };
  H.nomeIdioma = function (c) { return NOMES_IDIOMA[c] || c; };
  function idiomaPorNome(s) {
    var n = sem(s);
    if (/portugues|brasileiro/.test(n)) return 'pt';
    if (/espanhol|castelhano|venezuelano/.test(n)) return 'es';
    if (/ingles/.test(n)) return 'en';
    if (/frances/.test(n)) return 'fr';
    return null;
  }
  H.idiomaPorNome = idiomaPorNome;
  function limparTexto(s) {
    s = String(s == null ? '' : s).trim();
    var par = { '"': '"', '“': '”', '‘': '’', '«': '»', "'": "'" };
    if (s.length >= 2 && par[s.charAt(0)] === s.charAt(s.length - 1)) s = s.slice(1, -1).trim();
    return s.replace(/^[:,\-–—\s]+/, '').trim();
  }

  var RE_GATE_TRAD = /\b(?:traduz\w*|traduc\w+|como (?:eu )?se (?:diz|fala|escreve)|como (?:eu )?(?:digo|falo|escrevo|posso dizer)|como dizer|o que (?:significa|quer dizer)|significado de)\b/;
  var PRE = '^\\W*(?:por favor,?\\s*)?(?:pode\\s+|poderia\\s+|consegue\\s+|voc[eê] pode\\s+|vc pode\\s+|quero\\s+|preciso\\s+|como (?:eu )?)?(?:me\\s+)?';
  var TRAD = 'tradu[zcç][\\wãõ]*';

  H.planejarTraducao = function (texto) {
    var t = String(texto == null ? '' : texto).normalize('NFC').trim();
    if (!t || t.length > 1800) return null;
    if (!RE_GATE_TRAD.test(sem(t))) return null;
    var m, r;
    var pronto = function (txt, de, para, extra) {
      txt = limparTexto(txt);
      r = { texto: txt, de: de || null, para: para || null, faltaTexto: !txt };
      if (extra) for (var k in extra) r[k] = extra[k];
      return r;
    };
    // 1) "traduza [do X] para o Y: texto" (e "traduzir do espanhol para o português: ...")
    if ((m = new RegExp(PRE + TRAD + '\\s*(?:isso\\s+|esse texto\\s+|essa frase\\s+|um texto\\s+|uma frase\\s+|algo\\s+)?(?:do\\s+(' + LANG_SRC + ')\\s+)?(?:para|pro|pra|em|no|na|ao)\\s+(?:o\\s+|a\\s+)?(' + LANG_SRC + ')\\s*[:,\\-–—]?\\s*([\\s\\S]*)$', 'i').exec(t))) {
      return pronto(m[3], m[1] && idiomaPorNome(m[1]), idiomaPorNome(m[2]));
    }
    // 2) "tradução para venezuelano: texto"
    // (coberto acima: "tradução" casa com TRAD)
    // 3) "traduza "texto" para o inglês", "traduz Bom dia! pra inglês"
    if ((m = new RegExp(PRE + TRAD + '\\s*[:,\\-–—]?\\s*([\\s\\S]+?)\\s*[,:;\\-–—]?\\s+(?:para|pro|pra|em|no|na)\\s+(?:o\\s+|a\\s+)?(' + LANG_SRC + ')\\s*[.?!]*$', 'i').exec(t))) {
      return pronto(m[1], null, idiomaPorNome(m[2]));
    }
    // 4) "qual a tradução de X para Y"
    if ((m = new RegExp('\\bqual\\s+(?:[eé]\\s+)?a\\s+tradu[cç][aã]o\\s+(?:de|do|da)\\s+([\\s\\S]+?)\\s+(?:para|em|no|na|pro|pra)\\s+(?:o\\s+|a\\s+)?(' + LANG_SRC + ')\\s*[.?!]*$', 'i').exec(t))) {
      return pronto(m[1], null, idiomaPorNome(m[2]));
    }
    // 5) "como se diz X em Y", "como digo X em Y", "como se diz em espanhol: X"
    if ((m = new RegExp('\\bcomo\\s+(?:eu\\s+)?(?:se\\s+)?(?:diz|dizer|digo|falo|fala|escreve|escrevo|posso dizer|pode dizer)\\s+([\\s\\S]+?)\\s+(?:em|no|na|para o|para a|pro|pra)\\s+(?:o\\s+|a\\s+)?(' + LANG_SRC + ')\\s*[.?!]*$', 'i').exec(t))) {
      return pronto(m[1], null, idiomaPorNome(m[2]));
    }
    if ((m = new RegExp('\\bcomo\\s+(?:se\\s+)?(?:diz|fala|escreve)\\s+(?:em|no|na)\\s+(?:o\\s+|a\\s+)?(' + LANG_SRC + ')\\s*[:,\\-–—]?\\s*([\\s\\S]+)$', 'i').exec(t))) {
      return pronto(m[2], null, idiomaPorNome(m[1]));
    }
    // 6) "o que significa X" / "o que quer dizer X (em espanhol)": para o português; só vale se o texto for mesmo de outro idioma
    if ((m = /\bo\s+que\s+(?:significa|quer\s+dizer)\s+([\s\S]+)$/i.exec(t)) || (m = /\bsignificado\s+de\s+([\s\S]+)$/i.exec(t))) {
      var corpo = m[1].replace(/\s*[.?!]*$/, ''), de = null, mi;
      if ((mi = new RegExp('^([\\s\\S]+?)\\s+(?:em|no|na|do|da)\\s+(?:o\\s+|a\\s+)?(' + LANG_SRC + ')$', 'i').exec(corpo))) { corpo = mi[1]; de = idiomaPorNome(mi[2]); }
      return pronto(corpo, de, 'pt', { soSeEstrangeiro: !de });
    }
    // 7) "traduz: texto" / "traduzir texto" (sem idioma de destino)
    if ((m = new RegExp(PRE + TRAD + '\\s*[:,\\-–—]\\s*([\\s\\S]+)$', 'i').exec(t)) || (m = new RegExp(PRE + 'traduz\\w*\\s+([\\s\\S]+)$', 'i').exec(t))) {
      return pronto(m[1], null, null);
    }
    return null;
  };

  /* ---------------------------------------------------------------- saída */

  H.versao = 1;
  root.ArgoHabilidades = H;
})(typeof window !== 'undefined' ? window : globalThis);

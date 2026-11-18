/* ============================================================
   argo-rotina.js — o mascote ajuda na ROTINA de trabalho: resumo do dia, prazos, atalhos.

   Lógica pura (sem DOM, sem rede, sem armazenamento): lê o pedido escrito em português e devolve o que
   a pessoa quer; monta o texto do resumo a partir de dados que o app entrega. A ligação com o app (agenda,
   prazos, ferramentas, cards) fica em js/app.js, bloco "ROTINA DO MASCOTE". Teste: npm run test:rotina.

     ArgoRotina.intencao(texto)                      → { tipo, ... } | null
         tipo 'resumo'      { escopo: 'dia' | 'semana' }       "resumo do meu dia", "o que tenho pra fazer hoje"
         tipo 'prazos'      { filtro: 'todos'|'atrasados' }    "tem algum prazo vencendo?", "prazos atrasados"
         tipo 'feito'       { alvo }                            "marcar o prazo do RMA como feito"
         tipo 'novoPrazo'   { texto }                           "novo prazo meu: relatório mensal dia 30"
         tipo 'guia'        { alvo }                            "gerar guia para o CREAS"
         tipo 'contarNotas' { periodo: 'hoje'|'semana'|'mes' }  "quantas anotações fiz essa semana"
         tipo 'abrir'       { alvo }                            "abre o contador de atendimentos" (alvo = texto a casar com uma ferramenta)
     ArgoRotina.acharFerramenta(texto, catalogo)     → { id, titulo } | null      catalogo: [{ id, titulo }]
     ArgoRotina.acharPrazo(alvo, itens)              → { achado, candidatos }     itens: [{ id, t, d }]
     ArgoRotina.resumo(ctx)                          → { linhas, sugestao, vazio }

   Sem lookbehind e sem BigInt de propósito (Safari/iOS antigos quebram o arquivo inteiro).
   Nada daqui vai à IA: o resumo mistura anotações pessoais e prazos do usuário.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArgoRotina = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var R = {};

  function sem(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9$\/:.,\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  R.sem = sem;

  var STOP = { a: 1, o: 1, as: 1, os: 1, de: 1, do: 1, da: 1, dos: 1, das: 1, e: 1, em: 1, no: 1, na: 1, nos: 1, nas: 1, um: 1, uma: 1,
    para: 1, pra: 1, pro: 1, por: 1, com: 1, que: 1, meu: 1, minha: 1, seu: 1, sua: 1, ao: 1, aos: 1, me: 1, mim: 1, lista: 1, ai: 1 };
  function palavras(s) { return sem(s).split(' ').filter(function (w) { return w.length >= 2 && !STOP[w]; }); }
  function raiz(w) { return w.length > 5 ? w.slice(0, 5) : w; }

  /* ---------------------------------------------------------------- intenção */

  var VERBO_ABRIR = '(?:abrir|abre|abra|ir para|ir pra|va para|va pra|vai para|vai pra|vamos para|me leva para|leva|levar|mostra|mostre|mostrar|acessar|acessa|acesse|usar|quero usar|preciso usar|quero abrir|preciso abrir|quero ver|quero a|quero o|preciso da|preciso do)';

  R.intencao = function (texto) {
    var bruto = String(texto == null ? '' : texto);
    if (!bruto.trim() || bruto.length > 220) return null;
    var n = sem(bruto), m;
    n = n.replace(/^(?:(?:por favor|pode|poderia|consegue|argo|paulus|oi|ola|bom dia|boa tarde|boa noite)[ ,]+)+/, '');

    // quantas anotações
    if ((m = /\bquant[oa]s? (?:anotacoes|anotacao|lembretes?|notas)\b/.exec(n)) || /\b(?:numero|total) de (?:anotacoes|lembretes)\b/.test(n)) {
      var per = /\bhoje\b/.test(n) ? 'hoje' : (/\bsemana\b/.test(n) ? 'semana' : (/\b(mes|mensal)\b/.test(n) ? 'mes' : 'mes'));
      return { tipo: 'contarNotas', periodo: per };
    }

    // gerar guia / ficha de encaminhamento
    if (/\b(?:gerar|gera|gere|fazer|faz|faca|montar|monta|monte|preparar|prepara|emitir|emite|imprimir|imprime|criar|cria|crie|quero|preciso)\b.*\b(?:guia|ficha de encaminhamento|encaminhamento tecnico)\b/.test(n)
        || /^(?:encaminhar|encaminhe|encaminha)\b.*\b(?:para|pro|pra|ao|a)\b/.test(n)
        || /^(?:a |uma )?guia (?:de encaminhamento )?(?:para|pro|pra|do|da|de)\b/.test(n)) {
      var alvoG = null, limpo = n.replace(/\b(?:agora|por favor|ja|pra mim|para mim)\b/g, ' ').replace(/\s+/g, ' ').trim();
      if ((m = /^.*\b(?:para|pro|pra|ao|aos)\s+(?:o |a |os |as )?([a-z0-9][a-z0-9 \-\/.]{1,60})$/.exec(limpo))) alvoG = m[1].trim();
      else if ((m = /\b(?:guia|ficha)\s+(?:de encaminhamento\s+)?(?:do |da |de |no |na |ao )\s*(?:o |a )?([a-z0-9][a-z0-9 \-\/.]{1,60})$/.exec(limpo))) alvoG = m[1].trim();
      if (alvoG) alvoG = alvoG.replace(/^(?:guia|ficha|encaminhamento|tecnico|de|do|da)\s+/, '').trim();
      if (!alvoG || alvoG.length < 2 || /^(?:guia|ficha|encaminhamento)$/.test(alvoG)) alvoG = '';
      return { tipo: 'guia', alvo: alvoG };
    }

    // marcar prazo como feito
    if (/^(?:marcar|marca|marque|dar baixa|da baixa|conclui|concluir|conclua|baixa|riscar|risca)\b/.test(n) && /\b(?:prazo|prazos|feito|concluido|cumprido)\b/.test(n)) {
      var alvoF = n.replace(/^(?:marcar|marca|marque|dar baixa|da baixa|conclui|concluir|conclua|baixa|riscar|risca)\b/, ' ')
        .replace(/\b(?:como|o|a|os|as|prazo|prazos|feito|feita|concluido|concluida|cumprido|cumprida|ja|de|do|da|em|no|na|meu|minha|esse|essa|este|esta)\b/g, ' ')
        .replace(/\s+/g, ' ').trim();
      return { tipo: 'feito', alvo: alvoF };
    }

    // novo prazo próprio
    if (/\b(?:novo|nova|criar|crie|cadastrar|cadastre|adicionar|adicione|incluir|inclua|registrar|registre|anotar|anote|colocar|coloque)\b.*\bprazo\b/.test(n) && !/\b(?:calcul\w*|dias uteis|dias corridos)\b/.test(n)) {
      var t = bruto.replace(/^[\s\S]*?\bprazo\b(?:\s+(?:pr[óo]prio|meu|pessoal))*/i, '').replace(/^[\s:,\-–]+/, '').trim();
      return { tipo: 'novoPrazo', texto: t.slice(0, 200) };
    }

    // prazos: o que vence / atrasado / pendente
    if (/\bprazos?\b/.test(n) && !/\b(?:calcul\w*|dias uteis|dias corridos|para atualizar|para revalidar|para recorrer|para entregar|para renovar)\b/.test(n)) {
      if (/\b(?:atrasad\w+|vencid\w+|perdi|passaram|passou)\b/.test(n)) return { tipo: 'prazos', filtro: 'atrasados' };
      if (/\b(?:vencendo|vence|vencem|vencer|pendente|pendentes|proximos?|urgente|urgentes|a vencer|essa semana|esta semana|esse mes|este mes|hoje|amanha|tenho|tem algum|tem alguma|ha algum|ha alguma|quais|mostra|mostre|listar|lista|ver|conferir|confere|confira)\b/.test(n)) return { tipo: 'prazos', filtro: 'todos' };
    }
    if (/\bo que (?:esta |ta )?(?:vencendo|atrasado|pendente|vence)\b/.test(n)) return { tipo: 'prazos', filtro: /atrasad/.test(n) ? 'atrasados' : 'todos' };

    // resumo do dia / da semana
    var d = /\b(?:resumo|panorama|balanco|briefing|visao geral|pauta|roteiro|rotina)\b.*\b(?:dia|hoje|manha|tarde|semana|trabalho)\b/.test(n)
      || /\b(?:meu dia|minha semana|minha rotina|minhas pendencias|minhas tarefas|minha pauta|minha agenda de hoje)\b/.test(n)
      || /\bo que (?:eu )?(?:tenho|temos|preciso|devo|falta|falta eu|tem|ha|ta pendente|esta pendente)\b.*\b(?:pra|para|de)?\s*(?:fazer|resolver|ver|olhar)\b.*\b(?:hoje|agora|primeiro|amanha|semana|dia)\b/.test(n)
      || /\b(?:o que tenho|o que temos|o que preciso fazer|o que devo fazer)\s+(?:pra |para |de )?(?:fazer )?(?:hoje|amanha|essa semana|esta semana)\b/.test(n)
      || /\bpor onde (?:eu )?(?:comeco|comecar|devo comecar|começo)\b.*\b(?:dia|hoje|trabalho)\b/.test(n)
      || /\b(?:o que )?(?:tem|ha) (?:pra|para) (?:hoje|fazer hoje)\b/.test(n)
      || /\bpendencias (?:de hoje|do dia|da semana)\b/.test(n);
    if (d && !/\b(?:famil\w+|caso|paif|paefi)\b.*\bpendenc/.test(n)) {
      return { tipo: 'resumo', escopo: /\bsemana\b/.test(n) ? 'semana' : 'dia' };
    }

    // abrir uma ferramenta pelo nome
    if ((m = new RegExp('^' + VERBO_ABRIR + '\\s+(?:o |a |os |as |um |uma |ao |a )*(.+)$').exec(n))) {
      var alvoA = m[1].replace(/\b(?:agora|por favor|ja|pra mim|para mim|ai|obrigad[oa])\b/g, ' ').replace(/\s+/g, ' ').trim();
      if (alvoA.length >= 3) return { tipo: 'abrir', alvo: alvoA };
    }
    return null;
  };

  /* ---------------------------------------------------------------- ferramenta pelo nome */

  // catálogo: [{ id, titulo }]. Casa pelo nome (e não pelas palavras-chave): evita "abre o registro de atendimento" virar o Contador.
  R.acharFerramenta = function (texto, catalogo) {
    var q = palavras(texto).map(raiz);
    if (!q.length || !catalogo || !catalogo.length) return null;
    var melhor = null;
    catalogo.forEach(function (it) {
      var toks = palavras(it.titulo);
      if (!toks.length) return;
      var r = toks.map(raiz), casados = 0, primeiro = false;
      r.forEach(function (t, i) { if (q.indexOf(t) > -1) { casados++; if (i === 0) primeiro = true; } });
      if (!casados) return;
      if (casados < 2 && !(primeiro && q.length <= 2) && q.length !== 1) return;   // 1 palavra só vale se for a primeira do nome (pedido curto) ou se for o pedido inteiro
      var cobertura = casados / toks.length;
      var pontos = casados * 10 + cobertura * 5 - (q.length - casados);
      if (!melhor || pontos > melhor.pontos) melhor = { id: it.id, titulo: it.titulo, pontos: pontos, casados: casados };
    });
    return melhor ? { id: melhor.id, titulo: melhor.titulo } : null;
  };

  /* ---------------------------------------------------------------- prazo pelo nome */

  // Procura o prazo que a pessoa citou. itens: [{ id, t, d }] (só os não feitos). Devolve achado (um só) ou candidatos.
  R.acharPrazo = function (alvo, itens) {
    var q = palavras(alvo).map(raiz).filter(function (w) { return !/^\d+$/.test(w); });
    var lista = itens || [];
    if (!q.length) return { achado: null, candidatos: lista.slice(0, 4) };
    var pont = lista.map(function (it) {
      var tt = palavras(it.t).map(raiz), c = 0;
      q.forEach(function (w) { if (tt.indexOf(w) > -1) c++; });
      return { it: it, c: c };
    }).filter(function (x) { return x.c > 0; });
    if (!pont.length) return { achado: null, candidatos: [] };
    pont.sort(function (a, b) { return b.c - a.c || (a.it.d < b.it.d ? -1 : 1); });
    var topo = pont.filter(function (x) { return x.c === pont[0].c; });
    var cobre = pont[0].c >= Math.min(q.length, 2) || q.length === 1;
    if (topo.length === 1 && cobre) return { achado: topo[0].it, candidatos: [] };
    return { achado: null, candidatos: topo.slice(0, 4).map(function (x) { return x.it; }) };
  };

  /* ---------------------------------------------------------------- resumo */

  function cortar(s, max) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max - 1) + '…' : s; }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : b); }

  // ctx: { saudacao, dataLonga, escopo,
  //        hoje: { info, notas: [texto], util: bool }, amanha: { info, notas: [texto] },
  //        prazos: [{ t, quando, faixa: 'atrasado'|'hoje'|'semana', dataCurta }],
  //        semana: { notas: n, itens: [ 'Qua 18/11 — …' ] }, sincronizada: bool }
  R.resumo = function (ctx) {
    ctx = ctx || {};
    var L = [], hoje = ctx.hoje || {}, amanha = ctx.amanha || {};
    var prazos = ctx.prazos || [];
    var atras = prazos.filter(function (p) { return p.faixa === 'atrasado'; });
    var dia0 = prazos.filter(function (p) { return p.faixa === 'hoje'; });
    var sem7 = prazos.filter(function (p) { return p.faixa === 'semana'; });
    var notasHoje = hoje.notas || [], notasAmanha = amanha.notas || [];

    L.push((ctx.saudacao ? ctx.saudacao + '! ' : '') + (ctx.escopo === 'semana' ? 'Resumo da semana' : 'Seu resumo de hoje') + (ctx.dataLonga ? ' — ' + ctx.dataLonga : '') + '.');

    // 1) calendário
    if (hoje.info) L.push('📅 ' + hoje.info + (hoje.util === false ? '.' : '.'));
    else if (hoje.util === false) L.push('📅 Hoje não é dia útil.');
    // 2) prazos
    if (atras.length) {
      L.push('⚠️ Prazos que já passaram (conferir):');
      atras.slice(0, 4).forEach(function (p) { L.push('   – ' + p.dataCurta + ' ' + cortar(p.t, 90) + ' (' + p.quando + ')'); });
      if (atras.length > 4) L.push('   … e mais ' + (atras.length - 4) + '.');
    }
    if (dia0.length) {
      L.push('⏰ Vencem hoje:');
      dia0.slice(0, 4).forEach(function (p) { L.push('   – ' + cortar(p.t, 90)); });
    }
    if (sem7.length) {
      L.push('🗓️ Nos próximos 7 dias:');
      sem7.slice(0, 4).forEach(function (p) { L.push('   – ' + p.dataCurta + ' ' + cortar(p.t, 90) + ' (' + p.quando + ')'); });
      if (sem7.length > 4) L.push('   … e mais ' + (sem7.length - 4) + '.');
    }
    if (!atras.length && !dia0.length && !sem7.length) L.push('✅ Nenhum prazo pendente nos próximos 7 dias.');
    // 3) anotações
    if (notasHoje.length) {
      L.push('📝 Suas anotações de hoje (' + notasHoje.length + '):');
      notasHoje.slice(0, 4).forEach(function (t) { L.push('   – ' + cortar(t, 100)); });
      if (notasHoje.length > 4) L.push('   … e mais ' + (notasHoje.length - 4) + '.');
    } else if (ctx.sincronizada === false) {
      L.push('📝 Anotações: ative o código de sincronização da Agenda para eu ler as suas anotações.');
    } else {
      L.push('📝 Nenhuma anotação para hoje.');
    }
    // 4) amanhã
    var amanhaItens = [];
    if (amanha.info) amanhaItens.push(amanha.info);
    if (notasAmanha.length) amanhaItens.push(plural(notasAmanha.length, 'anotação', 'anotações'));
    if (amanhaItens.length) L.push('➡️ Amanhã: ' + amanhaItens.join(' · ') + '.');
    // 5) semana (só no escopo semana)
    if (ctx.escopo === 'semana' && ctx.semana) {
      if (ctx.semana.itens && ctx.semana.itens.length) {
        L.push('📆 Na semana:');
        ctx.semana.itens.slice(0, 6).forEach(function (t) { L.push('   – ' + cortar(t, 110)); });
      }
      if (typeof ctx.semana.notas === 'number') L.push('Você tem ' + plural(ctx.semana.notas, 'anotação', 'anotações') + ' nesta semana.');
    }

    // sugestão do primeiro passo (regra simples e explicável)
    var sug;
    if (atras.length) sug = 'Comece pelos prazos que já passaram: confira se foram cumpridos e marque como feitos.';
    else if (dia0.length) sug = 'O primeiro passo é o prazo que vence hoje: ' + cortar(dia0[0].t, 80) + '.';
    else if (notasHoje.length) sug = 'Siga pelas suas anotações de hoje; depois olhe os prazos da semana.';
    else if (sem7.length) sug = 'Hoje está livre: adiante o próximo prazo (' + cortar(sem7[0].t, 70) + ').';
    else sug = 'Dia sem pendências registradas. Bom momento para atualizar o acompanhamento das famílias ou os registros do mês.';
    L.push('👉 ' + sug);

    var vazio = !atras.length && !dia0.length && !sem7.length && !notasHoje.length && !hoje.info && !amanhaItens.length;
    return { linhas: L, sugestao: sug, vazio: vazio };
  };

  return R;
});

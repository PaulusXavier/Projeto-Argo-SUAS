/* ============================================================
   argo-entende.js — o mascote ENTENDE melhor o que a pessoa escreve.

   Lógica pura (sem DOM, sem rede, sem armazenamento, nada vai à IA). Roda ANTES dos roteadores do mascote
   (abas, rotina, diretório, manual, glossário) e faz três coisas, nesta ordem:

     1. Fala do dia a dia → palavra que o app conhece
        "pq", "vc", "oq", "tbm", "qro", "zap", "bf", "ct", "c r a s"…
     2. Erro de digitação → palavra certa, só quando a palavra digitada NÃO existe no app e há UMA candidata
        clara ("compimir" → "comprimir", "asistente" → "assistente", "cadunico" ok, "craz" → "cras").
     3. Pedido de comando → forma curta que os roteadores já sabem ler
        "dá pra abrir a agenda pra mim?", "preciso ir no mapa", "me leva pra ferramentas" → "abre a agenda…".

   Além disso monta a versão "com associação de palavras" (consulta): acrescenta, no FIM do texto, palavras
   que a pessoa não escreveu mas que significam o mesmo no app ("diminuir o pdf que tá pesado" → + "reduzir
   comprimir tamanho"; "meu cad único venceu" → + "cadunico"; "tô sem wifi" → + "offline sem internet").
   Só acrescenta, nunca tira: se a associação estiver errada, a pergunta original continua inteira.

     ArgoEntende.entender(texto, { vocab })  → { original, comando, consulta, mudou, trocas, associadas, tipo }
         comando   texto com as correções dos passos 1 a 3 (mantém acentos, datas, números e pontuação)
         consulta  comando + palavras associadas no fim (use só como 2ª tentativa)
         tipo      'comando' quando virou "abre X"; senão ''
     ArgoEntende.tentar(fn, texto, fraco, opts) → resultado de fn com o texto original, depois com comando,
         depois com consulta, parando na primeira resposta que não for "fraca" (fraco(r) true = sem resposta útil)
     ArgoEntende.usarVocabulario({ alvo: [palavras], conhecidas: { palavra: n } })  → palavras do app para a correção
     ArgoEntende.sem(texto)                   → minúsculas, sem acento, só letras e números

   Nunca mexe em pedido de socorro nem em dado pessoal: quem chama passa o texto original a esses filtros.
   Sem lookbehind e sem BigInt de propósito (Safari/iOS antigos quebram o arquivo inteiro). Teste: npm run test:entende.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArgoEntende = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var E = {};
  var MAX_TEXTO = 400;       // acima disso é um relato/pedido de texto: vai como está
  var MAX_ASSOC = 12;        // no máximo tantas palavras acrescentadas na consulta
  var N_GRUPOS_APP = 23;     // quantos grupos (do começo de GRUPOS) são de uso do app

  function sem(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  E.sem = sem;

  // ---------------------------------------------------------------------
  // 1. Fala do dia a dia (palavra por palavra)
  // ---------------------------------------------------------------------
  var GIRIAS = {
    pq: 'porque', pqe: 'porque', vc: 'voce', vcs: 'voces', voce: 'voce', tb: 'tambem', tbm: 'tambem', tbem: 'tambem', tmb: 'tambem',
    q: 'que', qm: 'quem', qdo: 'quando', qnd: 'quando', qto: 'quanto', qtos: 'quantos', qtas: 'quantas', qta: 'quanta',
    nn: 'nao', naum: 'nao', num: 'num', td: 'tudo', tds: 'todos', tdo: 'todo', msm: 'mesmo', mesm: 'mesmo', hj: 'hoje', amanha: 'amanha',
    mt: 'muito', mto: 'muito', mta: 'muita', mtos: 'muitos', pfv: 'por favor', pfvr: 'por favor', plz: 'por favor', pls: 'por favor',
    obg: 'obrigado', obgd: 'obrigado', obgda: 'obrigada', vlw: 'valeu', blz: 'beleza', dps: 'depois', ctz: 'certeza', vdd: 'verdade',
    aq: 'aqui', cmg: 'comigo', ctg: 'contigo', dnv: 'de novo', oq: 'o que', oque: 'o que', pra: 'pra', pro: 'pro',
    qro: 'quero', qero: 'quero', qria: 'queria', preciso: 'preciso', precizo: 'preciso', presiso: 'preciso', prciso: 'preciso',
    fzr: 'fazer', fzer: 'fazer', fazr: 'fazer', ond: 'onde', ondi: 'onde', cm: 'como', cmo: 'como', ke: 'que', ki: 'que',
    info: 'informacao', infos: 'informacoes', doc: 'documento', docs: 'documentos', cel: 'celular', tel: 'telefone', fone: 'fone',
    hosp: 'hospital', wpp: 'whatsapp', whats: 'whatsapp', zapzap: 'whatsapp', whatsap: 'whatsapp', watsapp: 'whatsapp', uatsapp: 'whatsapp',
    bf: 'bolsa familia', ct: 'conselho tutelar', cts: 'conselhos tutelares', bpc: 'bpc', pdfs: 'pdfs',
    nao: 'nao', ta: 'esta', tao: 'estao', tou: 'estou', tava: 'estava', cade: 'cade', cadee: 'cade',
    vo: 'vou', vamo: 'vamos', bora: 'vamos', pdf: 'pdf', pedeefe: 'pdf', pdef: 'pdf', pfd: 'pdf', pdff: 'pdf',
    xau: 'tchau', flw: 'tchau', tchauu: 'tchau', oii: 'oi', oie: 'oi', oiee: 'oi', olaa: 'ola', boadia: 'bom dia', bomdia: 'bom dia',
    backap: 'backup', bakup: 'backup', bekap: 'backup', becape: 'backup', bckup: 'backup',
    cadunico: 'cadunico', cadunic: 'cadunico', cadunnico: 'cadunico',
    sus: 'sus', suas: 'suas', ubs: 'ubs', caps: 'caps', cras: 'cras', creas: 'creas'
  };
  // "n" sozinho é "não" (mas "n 5" é número)
  function giria(w, prox, ant) {
    if (w === 'n') return (/^[0-9]/.test(prox || '') || prox === 'a' || ant === 's') ? null : 'nao';     // "n 5" e "s/n" não são "não"
    if (w === 'c' && prox && /^(esta|ta|quer|pode|sabe|tem|consegue)$/.test(prox)) return 'voce';
    if (w === 'vc') return 'voce';
    return Object.prototype.hasOwnProperty.call(GIRIAS, w) ? GIRIAS[w] : null;
  }

  // ---------------------------------------------------------------------
  // 2. Vocabulário (para corrigir digitação)
  // ---------------------------------------------------------------------
  // Palavras que o mascote já sabe ler: verbos de comando e termos do app/SUAS. O app acrescenta as dele (chaves do manual,
  // do glossário, das bases curadas) por usarVocabulario(); as palavras do diretório entram como "conhecidas" (não se corrige o que existe).
  var BASE = ('abrir abre abra acessar acesse entrar entre mostrar mostre exibir ver veja ir leva levar voltar fechar trancar bloquear sair ' +
    'juntar unir unificar dividir separar extrair cortar girar rotacionar numerar editar escrever assinar preencher converter transformar comprimir reduzir diminuir compactar ' +
    'salvar guardar apagar excluir deletar remover limpar restaurar importar exportar baixar imprimir copiar colar instalar atualizar trocar mudar recuperar ' +
    'calcular somar traduzir traduza buscar procurar pesquisar encontrar localizar marcar anotar lembrar ' +
    'telefone endereco horario documentos documento requisitos cadastro cadunico familia familias bolsa beneficio beneficios ' +
    'psicologo psicologa assistente social conselho tutelar delegacia hospital unidade ' +
    'agenda calendario mapa tradutor prazos prazo ferramentas ferramenta calculadora relogio noticias aplicativos criptografia backup senha tema escuro claro ' +
    'mascote assistente aplicativo ' +
    'violencia abuso maus tratos denuncia crianca adolescente idoso deficiencia gestante migrante refugiado ' +
    'paginas pagina arquivo arquivos foto fotos imagem imagens marca agua metadados texto ' +
    'sigilo laudo parecer relatorio atestado declaracao encaminhamento acolhimento atendimento acompanhamento ' +
    'cras creas paif paefi scfv caps ubs sus suas loas bpc pbf ' +
    'internet offline conectado inatividade privacidade atalhos versao').split(' ');
  var alvoExtra = {};       // palavras certas vindas do app
  var conhecidas = {};      // palavras que existem (diretório): não se "corrige"
  var baseSet = {};
  BASE.forEach(function (w) { baseSet[w] = 1; });

  E.usarVocabulario = function (v) {
    alvoExtra = {}; conhecidas = {};
    if (!v) return;
    (v.alvo || []).forEach(function (w) { w = sem(w); if (w && w.indexOf(' ') < 0 && w.length >= 4) alvoExtra[w] = 1; });
    if (v.conhecidas) for (var w in v.conhecidas) if (w !== '__N') conhecidas[w] = 1;
    alvoLista = null;
  };
  var alvoLista = null;
  function lista() {
    if (alvoLista) return alvoLista;
    var o = {}, k;
    for (k in baseSet) if (k.length >= 4) o[k] = 1;
    for (k in alvoExtra) o[k] = 1;
    alvoLista = Object.keys(o);
    return alvoLista;
  }
  function existe(w) { return !!(baseSet[w] || alvoExtra[w] || conhecidas[w] || GIRIAS[w] || PALAVRAS_COMUNS[w]); }

  // palavras comuns do português que não devem ser "corrigidas" para um termo do app
  var PALAVRAS_COMUNS = {};
  ('para pra pro por pelo pela como quando onde porque quem qual quais quanto quanta quantos quantas isso isto esse essa esses essas aquele aquela ' +
    'muito muita muitos muitas tambem ainda depois antes sempre nunca agora hoje ontem amanha semana mes ano dias anos horas minutos ' +
    'preciso precisa precisam quero queria quer querem gostaria posso pode podem podemos poderia devo deve fazer faco faz fazem feito feita ' +
    'tenho tem temos tinha ter tive esta estou estao estava foi fui sao ser sendo fica ficou ficar fico ' +
    'meu minha meus minhas seu sua seus suas nosso nossa dele dela deles delas ' +
    'tudo todo toda todos todas nada algo alguem ninguem outro outra outros outras mesmo mesma ' +
    'bom boa bons boas bem mal melhor pior maior menor mais menos ' +
    'casa vida mundo gente pessoa pessoas homem mulher filho filha filhos filhas mae pai irmao irma ' +
    'trabalho trabalhar dinheiro pagamento pagar receber recebo recebe valor valores renda ' +
    'ajuda ajudar ajuste dificuldade problema problemas duvida duvidas pergunta perguntas resposta respostas ' +
    'caso casos pedido pedidos ' +
    'lado cima baixo frente atras dentro fora perto longe aqui ali la aca ' +
    'obrigado obrigada valeu ola tchau ' +
    'grande pequeno pequena grandes pesado pesada leve rapido rapida devagar ' +
    'novo nova novos novas velho velha primeiro segunda terceira ultimo ultima ' +
    'saber sabe sei sabia entender entendo entendi explicar explica ensina ensinar aprender ' +
    'vai vou vamos vem vir veio ' +
    'dar da dou dao dado dados ' +
    'tela telas botao botoes opcao opcoes menu lista listas ' +
    'sobre entre contra desde ate apos durante sem com ' +
    'jeito forma maneira modo tipo tipos ' +
    'vez vezes parte partes lugar lugares ' +
    'servico servicos programa programas projeto projetos ' +
    'tarde manha noite madrugada').split(' ').forEach(function (w) { PALAVRAS_COMUNS[w] = 1; });

  // Damerau-Levenshtein limitado (troca de letras vizinhas conta 1)
  function dist(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) d[i] = [i];
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
  // Digitação típica do português: letra repetida ("preciiso"), cedilha/ss/c/s/z trocados, "x" por "ch".
  function foneticaChave(w) {
    return w.replace(/(.)\1+/g, '$1').replace(/ch/g, 'x').replace(/ss|c(?=[ei])|ç/g, 's').replace(/z$/g, 's').replace(/qu/g, 'k').replace(/h/g, '');
  }
  function corrige(w) {
    if (w.length < 5 || /[0-9]/.test(w) || existe(w)) return null;
    var max = w.length >= 9 ? 2 : 1, L = lista(), i, melhor = null, md = max + 1, empate = false;
    for (i = 0; i < L.length; i++) {
      var c = L[i];
      if (Math.abs(c.length - w.length) > max) continue;
      var d = dist(w, c, max);
      if (d < md) { md = d; melhor = c; empate = false; } else if (d === md && c !== melhor) empate = true;
    }
    if (melhor && md <= max && !empate) return melhor;
    // 2ª chance: mesma "cara" quando escrita sem as letras repetidas e com as trocas c/s/ss/ç/x/ch
    var fw = foneticaChave(w), achados = [];
    for (i = 0; i < L.length; i++) if (L[i].length >= 5 && foneticaChave(L[i]) === fw) achados.push(L[i]);
    return achados.length === 1 ? achados[0] : null;
  }

  // ---------------------------------------------------------------------
  // Texto em itens: { sep, raw, n } para manter acentos, datas e pontuação do que não muda
  // ---------------------------------------------------------------------
  function itens(texto) {
    var out = [], re = /([^A-Za-zÀ-ÿ0-9]*)([A-Za-zÀ-ÿ0-9]+)/g, m, fim = 0;
    while ((m = re.exec(texto))) { out.push({ sep: m[1], raw: m[2], n: sem(m[2]) }); fim = re.lastIndex; }
    return { lista: out, resto: texto.slice(fim) };
  }
  function junta(it) {
    var s = '';
    it.lista.forEach(function (x) { s += x.sep + x.raw; });
    return s + it.resto;
  }
  function troca(it, i, qtd, novo, trocas, de) {
    // substitui qtd itens a partir de i por palavras de "novo" (string com espaços), mantendo o separador do primeiro
    var sep = it.lista[i].sep, ws = novo.split(' '), arr = [];
    ws.forEach(function (w, k) { arr.push({ sep: k === 0 ? sep : ' ', raw: w, n: w }); });
    Array.prototype.splice.apply(it.lista, [i, qtd].concat(arr));
    if (trocas) trocas.push([de, novo]);
    return arr.length;
  }

  // siglas escritas com espaço: "c r a s" → "cras"
  function juntaSiglas(it, trocas) {
    var i = 0;
    while (i < it.lista.length) {
      var j = i;
      while (j < it.lista.length && it.lista[j].n.length === 1 && /[a-z]/.test(it.lista[j].n)) j++;
      if (j - i >= 3 && j - i <= 8) {
        var junto = it.lista.slice(i, j).map(function (x) { return x.n; }).join('');
        if (existe(junto) || SIGLAS[junto]) { var de = it.lista.slice(i, j).map(function (x) { return x.raw; }).join(' '); troca(it, i, j - i, junto, trocas, de); }
      }
      i = Math.max(j, i + 1);
    }
  }
  var SIGLAS = { cras: 1, creas: 1, paif: 1, paefi: 1, scfv: 1, caps: 1, ubs: 1, suas: 1, loas: 1, bpc: 1, pbf: 1, rma: 1, cadunico: 1, pdf: 1 };

  // expressões do dia a dia (várias palavras) → forma que o app conhece
  var EXPRESSOES = [
    [/^(cad unico|cad. unico|cadastro unico|cadastro do governo)$/, 'cadunico'],
    [/^(bolsa familiar|bolsa familia)$/, 'bolsa familia'],
    [/^(pe de meia)$/, 'pe de meia'],
    [/^(copia de seguranca|back up)$/, 'backup'],
    [/^(wi fi|wi-fi|wifi)$/, 'wifi'],
    [/^(por que|porque|por quê)$/, 'porque']
  ];
  function expressoes(it, trocas) {
    var i, k, n2, n3;
    for (i = 0; i < it.lista.length; i++) {
      n2 = i + 1 < it.lista.length ? it.lista[i].n + ' ' + it.lista[i + 1].n : '';
      n3 = i + 2 < it.lista.length ? n2 + ' ' + it.lista[i + 2].n : '';
      for (k = 0; k < EXPRESSOES.length; k++) {
        if (n3 && EXPRESSOES[k][0].test(n3)) { if (n3 !== EXPRESSOES[k][1]) troca(it, i, 3, EXPRESSOES[k][1], trocas, n3); break; }
        if (n2 && EXPRESSOES[k][0].test(n2)) { if (n2 !== EXPRESSOES[k][1]) troca(it, i, 2, EXPRESSOES[k][1], trocas, n2); break; }
      }
    }
  }

  function palavraAPalavra(it, trocas) {
    var i, w, g, c;
    for (i = 0; i < it.lista.length; i++) {
      w = it.lista[i].n;
      if (!w) continue;
      g = giria(w, i + 1 < it.lista.length ? it.lista[i + 1].n : '', i > 0 ? it.lista[i - 1].n : '');
      if (g && g !== w) { i += troca(it, i, 1, g, trocas, w) - 1; continue; }
      c = corrige(w);
      if (c) { troca(it, i, 1, c, trocas, w); }
    }
  }

  // ---------------------------------------------------------------------
  // 3. Pedido de comando
  // ---------------------------------------------------------------------
  // Toda forma de "abrir" vira "abre", que os roteadores de abas, cards e ferramentas já leem.
  var VERBO_ABRIR = '(?:abrir|abre|abra|abri|abrindo|acessar|acessa|acesse|entrar|entra|entre|ir|va|vai|vamos|leva|leve|levar|levem|mostrar|mostra|mostre|exibir|exibe|exiba|ver|veja|visualizar|chamar|chama|chame|colocar|coloca|ponha|poe|joga|jogar|mexer)';
  var RE_CORTESIA = '(?:(?:por favor|oi|ola|ei|ai|entao|bom dia|boa tarde|boa noite|agora|ja|so|mascote|argo|amigo|vamos|bora)\\s+)*';
  var RE_DESEJO = '(?:(?:tem como|teria como|da pra|da para|daria pra|daria para|consegue|consegues|pode|podes|poderia|podia|pode me|voce pode|voce consegue|sera que (?:voce )?(?:pode|consegue)|quero|queria|quer|gostaria de|gostaria|preciso|precisava|precisamos|necessito|vou querer|me ajuda a|me ajude a|favor)\\s+(?:de\\s+|que\\s+voce\\s+)?(?:me\\s+|nos\\s+)?)?';
  var RE_ABRE = new RegExp('^' + RE_CORTESIA + RE_DESEJO + '(?:me\\s+|nos\\s+)?' + VERBO_ABRIR + '\\s+(?:(?:para|pra|pro|na|no|nas|nos|a|o|as|os|em|de|da|do|das|dos|ate)\\s+)*(.+?)(?:\\s+(?:pra mim|para mim|por favor|agora|ja|ai|obrigado|obrigada))*$');
  var RE_CADE = /^(?:(?:por favor|oi|ola|ei)\s+)*cade\s+(?:a\s+|o\s+|as\s+|os\s+)?((?:aba|tela|ferramenta|botao|opcao|pagina|menu)\s+.+|agenda|mapa|calendario|tradutor|prazos|noticias|aplicativos|ferramentas|backup|calculadora|relogio|criptografia)$/;
  var PERGUNTA_APP = /^(como|o que|qual|quais|onde|porque|por que|quando|quem|posso|consigo|da pra|tem como|existe)\b/;
  var PERGUNTA = /^(como|o que|oque|qual|quais|quando|onde|porque|por que|quem|quanto|quantos|quantas|existe|tem|ha)\b/;
  // "preciso/quero" + verbo no infinitivo de uma tarefa do app → "como <verbo>" (o manual só responde a pergunta)
  var TAREFAS = '(?:juntar|unir|unificar|dividir|separar|cortar|extrair|diminuir|reduzir|comprimir|compactar|encolher|girar|rotacionar|numerar|editar|assinar|preencher|converter|transformar|salvar|apagar|excluir|remover|instalar|atualizar|trocar|mudar|recuperar|restaurar|proteger|criptografar|imprimir|baixar|calcular|gerar|fazer backup|tirar a senha|tirar senha|usar|escrever|colocar|marcar|criar|traduzir|medir|somar|contar)';
  var RE_TAREFA = new RegExp('^' + RE_CORTESIA + '(?:quero|queria|quer|gostaria de|gostaria|preciso|precisava|precisamos|necessito|vou querer|tem como|teria como|da pra|da para|daria pra|consegue|consigo|posso|pode|podemos|me ensina a|me ensine a|me explica como|me explique como|me diz como|me diga como|como que|como q|como eu|como faz pra|como faz para|como faco pra|como faco para)\\s+(?:eu\\s+|voce\\s+)?(?:de\\s+)?(' + TAREFAS + '\\b.*)$');

  function comandoAbrir(nTexto) {
    var m;
    if (PERGUNTA.test(nTexto)) return null;
    if (/^(abre|abra|abrir) /.test(nTexto)) return null;      // já está na forma que os roteadores leem
    m = nTexto.match(RE_CADE);
    if (m) return 'abre ' + m[1];
    m = nTexto.match(RE_ABRE);
    if (!m) return null;
    var rest = m[1];
    if (!rest || rest.split(' ').length > 8) return null;
    return 'abre ' + rest;
  }
  function comandoTarefa(nTexto) {
    if (/^(como|o que|qual|quais|onde|porque|quem)\b/.test(nTexto)) return null;
    var m = nTexto.match(RE_TAREFA);
    if (!m) return null;
    return 'como ' + m[1].replace(/\s+(pra mim|para mim|por favor|ai)$/, '');
  }

  // ---------------------------------------------------------------------
  // 4. Associação de palavras (só acrescenta no fim)
  // ---------------------------------------------------------------------
  // [gatilhos, palavras acrescentadas, palavras de contexto exigidas (qualquer uma)]
  // Os 23 primeiros grupos (Central de PDF e recursos do app) valem como pergunta de "como fazer": se a pessoa só descreve o problema
  // ("pdf com páginas de cabeça pra baixo"), a consulta ganha "como" na frente, porque o manual do app só responde a pergunta.
  // Gatilho com * no fim vale como começo de palavra ("diminu*" = diminuir, diminuo, diminuindo).
  var GRUPOS = [
    // --- Central de PDF
    [['diminu*', 'encolh*', 'compact*', 'comprim*', 'reduz*', 'pesad*', 'pesa', 'leve', 'tamanho', 'mb', 'grande demais', 'muito grande', 'enorme', 'nao cabe', 'nao sobe', 'nao anexa', 'limite de tamanho'], ['reduzir', 'comprimir', 'tamanho', 'pdf'], ['pdf', 'pdfs', 'arquivo', 'arquivos']],
    [['junt*', 'mescl*', 'emend*', 'combin*', 'agrup*', 'unir', 'une', 'unam', 'unindo', 'unific*', 'anex*', 'colar'], ['unir', 'juntar', 'unificar', 'pdf'], ['pdf', 'pdfs', 'arquivo', 'arquivos', 'fotos', 'paginas']],
    [['dividir', 'divid*', 'separ*', 'fatiar', 'picar', 'cort*', 'extrair', 'extra*', 'partir'], ['dividir', 'separar', 'extrair', 'paginas', 'pdf'], ['pdf', 'pdfs', 'paginas', 'pagina']],
    [['apag*', 'delet*', 'remov*', 'exclu*', 'tirar', 'tire', 'retir*', 'elimin*', 'sobrando', 'em branco'], ['excluir', 'remover', 'paginas', 'pdf'], ['pagina', 'paginas', 'folha', 'folhas']],
    [['gir*', 'rotacion*', 'vira*', 'virad*', 'torto', 'torta', 'de lado', 'deitad*', 'invertid*', 'de cabeca para baixo', 'de ponta cabeca'], ['girar', 'rotacionar', 'pdf'], ['pdf', 'pdfs', 'pagina', 'paginas', 'folha']],
    [['numer*', 'enumer*', 'paginar', 'paginacao'], ['numerar', 'paginas', 'pdf'], ['pdf', 'pdfs', 'pagina', 'paginas']],
    [['edit*', 'escrev*', 'preench*', 'assin*', 'rabisc*', 'carimb*', 'digitar', 'complet*'], ['editar', 'escrever', 'assinar', 'pdf'], ['pdf', 'pdfs']],
    [['marca*', 'selo', 'confidencial', 'rascunho', 'copia'], ['marca d agua', 'pdf'], ['pdf', 'pdfs']],
    [['senha', 'desbloque*', 'destrav*', 'desprotege*', 'travad*', 'bloquead*', 'protegid*'], ['remover senha', 'desbloquear', 'pdf'], ['pdf', 'pdfs']],
    [['convert*', 'transform*', 'passar', 'virar', 'salvar como', 'exportar'], ['converter', 'pdf', 'word'], ['word', 'docx', 'doc']],
    [['foto', 'fotos', 'imagem', 'imagens', 'jpg', 'jpeg', 'png', 'print', 'camera', 'escane*', 'digitaliz*'], ['jpg', 'imagem', 'foto', 'pdf', 'converter'], ['pdf', 'pdfs']],
    // --- O app em si
    [['salvar', 'guardar', 'copia de seguranca', 'exportar', 'nao perder', 'perder tudo', 'trocar de celular', 'celular novo', 'novo celular', 'formatar', 'levar para outro'], ['backup', 'restaurar', 'importar'], ['dados', 'anotacoes', 'notas', 'agenda', 'tudo', 'aparelho', 'celular']],
    [['esqueci', 'perdi', 'nao lembro', 'nao consigo entrar', 'nao entra', 'trocar', 'mudar', 'recuperar', 'resetar', 'redefinir'], ['senha do app', 'esqueci a senha', 'recuperar a senha', 'trocar a senha'], ['senha', 'login', 'acesso']],
    [['fecha sozinho', 'fechou sozinho', 'trancou', 'trancando', 'travou', 'saiu sozinho', 'desconectou', 'deslogou', 'expirou', 'caiu a sessao', 'pede senha toda hora', 'pede a senha toda hora', 'sai do nada', 'saiu do nada'], ['bloqueio automatico', 'inatividade', 'manter conectado'], ['app', 'aplicativo', 'argo', 'sessao', 'senha', 'tela']],
    [['sem wifi', 'sem sinal', 'sem net', 'sem dados moveis', 'sem conexao', 'sem internet', 'internet caiu', 'nao tenho internet', 'off line', 'offline', 'sem rede de internet'], ['offline', 'sem internet', 'funciona sem internet']],
    [['escur*', 'dark', 'noturno', 'claro', 'claridade', 'cansa a vista', 'cansando a vista', 'brilho', 'branco demais', 'forte demais'], ['modo escuro', 'tema escuro', 'trocar o tema'], ['tela', 'app', 'aplicativo', 'modo', 'tema', 'fundo', 'cor', 'vista']],
    [['lembret*', 'avis*', 'alarm*', 'notific*', 'nao esquecer', 'esquecer', 'lembrar', 'despertar'], ['lembrete da agenda', 'notificacoes da agenda'], ['agenda', 'compromisso', 'compromissos', 'reuniao', 'visita', 'prazo']],
    [['instal*', 'baixar o app', 'tela inicial', 'icone', 'atalho no celular', 'colocar no celular', 'ter no celular'], ['instalar o app', 'adicionar a tela inicial', 'offline'], ['app', 'aplicativo', 'celular', 'argo']],
    [['atualiz*', 'nova versao', 'versao nova', 'desatualizado', 'ta velho', 'esta velho'], ['atualizar o app', 'nova versao', 'verificar atualizacao'], ['app', 'aplicativo', 'versao', 'argo']],
    [['voz', 'microfone', 'ditar', 'audio', 'ouvir', 'ler em voz alta', 'narrar', 'falar'], ['voz do mascote', 'microfone do mascote', 'ouvir a resposta'], ['mascote', 'assistente', 'argo', 'resposta', 'respostas']],
    [['renda por pessoa', 'ganha por pessoa', 'cada um ganha', 'dividir a renda', 'renda de cada', 'renda de cada pessoa', 'quanto sobra por pessoa'], ['renda per capita', 'calcular renda']],
    [['quantos dias', 'dias uteis', 'quando vence', 'vence quando', 'vencimento', 'data limite', 'prazo de quantos', 'conta de dias'], ['calculadora de prazos', 'dias uteis', 'prazo']],
    [['mandar mensagem sem salvar', 'falar com numero sem salvar', 'whatsapp sem adicionar', 'whatsapp sem salvar'], ['link de whatsapp', 'whatsapp sem salvar contato']],
    // --- SUAS: nomes que a equipe e as famílias usam
    [['bolsa familia', 'bolsa familiar', 'auxilio brasil', 'bolsao', 'auxilio do governo', 'ajuda do governo', 'dinheiro do governo', 'beneficio do governo', 'pbf'], ['bolsa familia', 'pbf']],
    [['cadunico', 'cad unico', 'cadastro unico', 'cadastro do governo', 'cadastro social', 'cadastrinho', 'cadastro de familia', 'cadastrar familia', 'fazer o cadastro', 'atualizar o cadastro'], ['cadunico', 'cadastro unico']],
    [['bpc', 'loas', 'beneficio de prestacao continuada', 'prestacao continuada', 'beneficio assistencial', 'um salario minimo para idoso', 'beneficio para deficiente'], ['bpc', 'beneficio de prestacao continuada']],
    [['bateu', 'bate', 'apanh*', 'agredi*', 'agressao', 'espanc*', 'surr*', 'machuc*', 'maltrat*', 'abus*', 'molest*', 'estupr*', 'ameac*', 'violent*', 'mexe com', 'mexeu com'], ['violencia', 'protecao']],
    [['depress*', 'ansied*', 'surto', 'surtou', 'crise nervosa', 'panico', 'pirou', 'pirando', 'esgotamento', 'burnout', 'insonia', 'nervos', 'tristeza profunda', 'sofrimento psiquico'], ['saude mental', 'caps']],
    [['maconha', 'cocaina', 'cachaca', 'bebe demais', 'bebendo muito', 'viciado', 'viciada', 'vicio', 'pedra', 'crack', 'alcoolatra', 'alcoolismo', 'drogado', 'drogada', 'dependente quimico'], ['drogas', 'alcool', 'caps ad']],
    [['passando fome', 'sem comer', 'sem comida', 'sem o que comer', 'faltando comida', 'falta comida', 'nao tem o que comer'], ['fome', 'cesta basica', 'alimentar']],
    [['morador de rua', 'moradora de rua', 'moradores de rua', 'situacao de rua', 'pop rua', 'mendigo', 'dormindo na rua', 'vive na rua', 'vivendo na rua'], ['situacao de rua', 'centro pop']],
    [['gravida', 'gestante', 'barriga', 'pre natal', 'prenatal', 'esperando bebe'], ['gestante', 'pre natal']],
    [['cesta basica', 'auxilio funeral', 'auxilio natalidade', 'ajuda de custo', 'ajuda emergencial', 'socorro de emergencia', 'beneficio emergencial'], ['beneficio eventual', 'beneficios eventuais']],
    [['segredo', 'confidencial*', 'guardar segredo', 'posso contar', 'quebrar sigilo', 'repassar informacao', 'passar informacao', 'revelar'], ['sigilo']],
    [['laudo', 'parecer', 'atestado', 'declaracao', 'relatorio psicologico', 'documento escrito'], ['documentos psicologo', 'laudo', 'parecer']],
    [['intimacao', 'oficio do juiz', 'mandado', 'juiz pediu', 'juiza pediu', 'promotor pediu', 'ministerio publico pediu', 'vara'], ['sistema de justica', 'oficio']],
    [['aposentar*', 'pensao', 'auxilio doenca', 'afastamento', 'pericia'], ['inss', 'previdencia']],
    [['identidade', 'carteira de identidade', 'segunda via', 'certidao', 'registro de nascimento', 'tirar documento', 'sem documento'], ['documentacao', 'identificacao']],
    [['creche', 'vaga na escola', 'matricular', 'matricula'], ['matricula', 'escola']],
    [['venezuelan*', 'refugiad*', 'imigrante', 'migrante', 'estrangeir*'], ['migracao', 'acolhida']],
    [['idoso', 'idosa', 'velhinho', 'velhinha', 'terceira idade', 'vovo', 'vovo'], ['idoso', 'idosa']],
    [['autis*', 'tea', 'deficien*', 'cadeirante', 'cego', 'surdo'], ['pessoa com deficiencia', 'tea']],
    [['conselho tutelar', 'conselho de crianca', 'denunciar maus tratos'], ['conselho tutelar']]
  ];

  // normaliza os gatilhos uma vez
  var GRUPOS_IDX = null;
  function indexaGrupos() {
    if (GRUPOS_IDX) return GRUPOS_IDX;
    GRUPOS_IDX = GRUPOS.map(function (g) { return { gat: g[0].map(padrao), dar: g[1], pre: (g[2] || []).map(padrao) }; });
    return GRUPOS_IDX;
  }
  function padrao(s) {
    return sem(s.replace(/\*/g, '')).split(' ').map(function (w, i, a) { return { w: w, pref: /\*$/.test(s) && i === a.length - 1 }; });
  }
  function casa(tokens, pad) {
    for (var i = 0; i + pad.length <= tokens.length; i++) {
      var ok = true;
      for (var j = 0; j < pad.length; j++) {
        var t = tokens[i + j], p = pad[j];
        if (!(t === p.w || (p.pref && t.indexOf(p.w) === 0 && t.length <= p.w.length + 8) || t === p.w + 's' || t === p.w + 'es')) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }
  function associar(tokens) {
    var G = indexaGrupos(), out = [], visto = ' ' + tokens.join(' ') + ' ', i, j, k;
    out.app = false;
    for (i = 0; i < G.length && out.length < MAX_ASSOC; i++) {
      var g = G[i], gatilho = false, contexto = !g.pre.length;
      for (j = 0; j < g.gat.length && !gatilho; j++) if (casa(tokens, g.gat[j])) gatilho = true;
      if (!gatilho) continue;
      for (j = 0; j < g.pre.length && !contexto; j++) if (casa(tokens, g.pre[j])) contexto = true;
      if (!contexto) continue;
      for (k = 0; k < g.dar.length; k++) {
        var add = g.dar[k];
        if (visto.indexOf(' ' + add + ' ') > -1 || out.indexOf(add) > -1) continue;
        out.push(add);
        visto += add + ' ';
        if (i < N_GRUPOS_APP) out.app = true;
      }
    }
    var res = out.slice(0, MAX_ASSOC);
    res.app = out.app;
    return res;
  }

  // ---------------------------------------------------------------------
  // Entrada principal
  // ---------------------------------------------------------------------
  E.entender = function (texto, opts) {
    texto = String(texto == null ? '' : texto);
    var vazio = { original: texto, comando: texto, consulta: texto, mudou: false, trocas: [], associadas: [], tipo: '' };
    if (!texto.trim() || texto.length > MAX_TEXTO) return vazio;
    if (opts && opts.vocab) E.usarVocabulario(opts.vocab);

    var it = itens(texto), trocas = [];
    juntaSiglas(it, trocas);
    expressoes(it, trocas);
    palavraAPalavra(it, trocas);

    var comando = junta(it), tipo = '';
    var n = it.lista.map(function (x) { return x.n; }).filter(Boolean).join(' ');
    var c = comandoAbrir(n);
    if (c) { comando = c; tipo = 'comando'; trocas.push([n, c]); }
    else {
      var t = comandoTarefa(n);
      if (t) { comando = t; tipo = 'tarefa'; trocas.push([n, t]); n = sem(t); }
    }
    var tokens = sem(comando).split(' ').filter(Boolean).map(function (w) { return w === 'pra' ? 'para' : w; });
    var assoc = tipo === 'comando' ? [] : associar(tokens);
    var consulta = assoc.length ? comando.replace(/\s*$/, '') + ' ' + assoc.join(' ') : comando;
    if (assoc.app && !PERGUNTA_APP.test(sem(comando))) consulta = 'como ' + consulta;
    return { original: texto, comando: comando, consulta: consulta, mudou: comando !== texto || assoc.length > 0, trocas: trocas, associadas: assoc, tipo: tipo };
  };

  // Tenta a pergunta como foi escrita; se não deu resposta útil, com as correções; depois com as palavras associadas.
  // fn(texto) → resultado; fraco(resultado) → true quando não serve; opts.aceita(r0, r) → se o novo resultado r vale mais que o r0 (padrão: não é fraco).
  // Nunca piora: se nada servir, devolve o resultado do texto original.
  E.tentar = function (fn, texto, fraco, opts) {
    var r0 = fn(texto);
    if (!fraco(r0)) return r0;
    var aceita = (opts && opts.aceita) || function (a, b) { return !fraco(b); };
    var e = E.entender(texto, opts);
    if (!e.mudou) return r0;
    var tentativas = [];
    if (e.comando !== texto) tentativas.push(e.comando);
    if (e.consulta !== e.comando) tentativas.push(e.consulta);
    for (var i = 0; i < tentativas.length; i++) {
      var r = fn(tentativas[i]);
      if (aceita(r0, r)) return r;
    }
    return r0;
  };

  // Resposta do cérebro (ArgoCerebro.plan) que não serve: nada, lista aproximada do diretório ou lista de baixa confiança
  // (o diretório "achou" 4 unidades parecidas com "o app fecha sozinho").
  E.planoFraco = function (p) {
    if (!p || !p.kind || p.kind === 'none' || p.kind === 'directory-weak') return true;
    return p.kind === 'directory' && !!p.dir && p.dir.confidence < 0.5 && p.dir.mode === 'list';
  };
  // Só troca uma lista fraca do diretório por uma resposta curada (manual, base do psicólogo, glossário, ficha); nunca por outra lista.
  E.planoAceito = function (r0, r) {
    if (E.planoFraco(r)) return false;
    if (r0 && r0.kind === 'directory' && !E.planoFraco(r0)) return false;
    if (r0 && r0.kind === 'directory') return r.kind === 'manual' || r.kind === 'psi' || r.kind === 'concept' || r.kind === 'ficha';
    return true;
  };

  E.grupos = GRUPOS;
  return E;
});

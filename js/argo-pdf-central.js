/* ============================================================
   argo-pdf-central.js — o mascote entende pedidos para TODAS as ferramentas da Central de PDF.

   Lógica pura (sem DOM, sem rede, sem armazenamento): lê o pedido escrito em português e devolve quais ferramentas da
   Central devem agir, em que ordem e com quais opções. Quem executa é o app (js/app.js, bloco "CENTRAL DE PDF PELO CHAT"):
   ele entrega o arquivo à própria ferramenta da Central e aperta o botão dela, então chat e aba fazem sempre a mesma coisa.
   O que o Paulus (Paulus.pdf) já faz sozinho (juntar, dividir, excluir, girar, numerar, marca d'água, formulário) não é lido aqui.
   Teste: npm run test:pdf-central.

     ArgoPdfCentral.ler(texto, { temArquivo })  → null | { etapas, avisos, recusas }
         etapas  [{ ferramenta, modo, rotulo, opcoes, pos, resumo }]
                 ferramenta = chave de PDFHUB_TOOLS (Compress, Crop, Meta, Text, PdfWord, PdfJpg, Unlock, Protect, Edit,
                              Organize, Merge, WordPdf, JpgPdf)
                 modo 'auto'  → o app roda a ferramenta sozinho sobre o PDF (e entrega o arquivo como botão)
                 modo 'abrir' → depende da pessoa (senha, marcar na página, escolher fotos...): o app só deixa tudo pronto
         avisos  [texto]                 recados que acompanham a resposta
         recusas [{ codigo, texto }]     o que a Central não faz (quebrar senha, OCR, assinatura digital, achar página em branco)
     ArgoPdfCentral.instrucao(etapa, temArquivo) → texto do que a pessoa faz a seguir, nas ferramentas 'abrir'

   Pergunta de explicação ("como reduzir o tamanho de um pdf?") devolve null: segue para o manual do app.
   Senha NUNCA é lida do texto: a pessoa digita no campo da ferramenta.
   Sem lookbehind e sem BigInt de propósito (Safari/iOS antigos quebram o arquivo inteiro).
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArgoPdfCentral = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var C = {};

  // minúsculas, sem acento, setas viram "para", pontuação vira espaço (a "?" fica para reconhecer pergunta)
  function norm(s) {
    var t = String(s == null ? '' : s).toLowerCase();
    try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* sem normalize */ }
    return t.replace(/→|⇒|⇄|->|=>/g, ' para ').replace(/[^a-z0-9?.,\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function num(s) { var v = Number(String(s).replace(',', '.')); return isFinite(v) ? v : null; }

  // ---------------------------------------------------------------- ferramentas
  var ROTULO = {
    Compress: 'Reduzir tamanho', Crop: 'Recortar margens', Meta: 'Limpar dados ocultos', Text: 'Extrair texto',
    PdfWord: 'PDF → Word', PdfJpg: 'PDF → JPG', Unlock: 'Remover senha', Protect: 'Proteger com senha',
    Edit: 'Editar e assinar', Organize: 'Organizar', Merge: 'Unir', WordPdf: 'Word → PDF', JpgPdf: 'Fotos → PDF (Digitalizar)'
  };
  var AUTO = { Compress: 1, Crop: 1, Meta: 1, Text: 1, PdfWord: 1, PdfJpg: 1 };

  var TEXTOS = {
    'quebrar-senha': 'Não quebro, não adivinho e não recupero senha de PDF: isso seria abrir um arquivo que não é seu, e o app não tem como fazer. ' +
      'Se você **sabe** a senha, a ferramenta **Remover senha** (Central de PDF) gera uma cópia que abre sem senha; você digita a senha no campo dela. ' +
      'Se a senha foi esquecida, não há como recuperar: peça uma cópia nova a quem gerou ou enviou o arquivo.',
    'ocr': 'A Central de PDF não faz OCR (reconhecer o texto de um documento escaneado). **Extrair texto** só copia o texto de PDF que tem texto selecionável; ' +
      'página escaneada é uma foto e não tem texto para copiar. Para ter o texto, refaça o arquivo a partir do original (Word, Verbus) ou digite.',
    'paginas-branco': 'Ainda não sei achar páginas em branco sozinho. Em **Organizar** (Central de PDF) você vê todas as miniaturas e tira, gira ou duplica as páginas; ' +
      'ou diga quais páginas excluir, por exemplo: "excluir as páginas 3 e 7".',
    'assinatura-digital': 'Assinatura digital com certificado (ICP-Brasil, gov.br) eu não faço. Em **Editar e assinar** dá para colocar a imagem de uma assinatura escaneada ou desenhada ' +
      'na página, mas é só uma imagem e não tem a validade de um certificado digital.'
  };

  // ---------------------------------------------------------------- leitura
  var RE_PERGUNTA = /^(como|o que|oque|qual|quais|por ?que|porque|quando|onde|quem|existe|ha|o app|o argo)\b/;

  function falaDePdf(n, temArquivo) {
    return /\bpdfs?\b/.test(n) || /\b(paginas?|miniaturas?)\b/.test(n) || !!temArquivo;
  }

  function opcoesCompress(n) {
    var o = { nivel: 'media', modo: 'texto' };
    if (/\b(maxim\w*|o maximo|menor possivel|bem pequeno|bem leve|ao maximo)\b/.test(n)) o.nivel = 'maxima';
    else if (/\b(boa qualidade|alta qualidade|sem perder qualidade|qualidade alta|nitid\w*|pouco)\b/.test(n)) o.nivel = 'alta';
    if (/\b(paginas? (como|em|viram?|virar) imag(?:em|ens)|como imag(?:em|ens)|rasteriz\w*|modo imag(?:em|ens))\b/.test(n)) { o.modo = 'imagem'; if (o.nivel === 'media' && /\bmaxim/.test(n)) o.nivel = 'maxima'; }
    var m = /\b(?:ate|menos de|abaixo de|no maximo|maximo de|limite de|caber em|menor que|para)\s+(\d+(?:[.,]\d+)?)\s*(mb|megas?|megabytes?|m|kb|kbs|k)\b/.exec(n);
    if (m) {
      var v = num(m[1]);
      if (v) o.alvoMB = /^k/.test(m[2]) ? Math.max(0.01, Math.round(v / 1024 * 100) / 100) : v;
    }
    return o;
  }

  function opcoesCrop(n) {
    var pad = /\b(?:folga|sobra|deixando|deixe|margem de seguranca)\s+(?:de\s+|uma\s+|um\s+)*(\d+(?:[.,]\d+)?)\s*mm\b/.exec(n);
    if (pad && num(pad[1]) != null) return { modo: 'auto', pad: Math.min(50, num(pad[1])) };
    var MM = function (v, un) { return /^c/.test(un) ? v * 10 : v; };
    var lados = { t: null, b: null, l: null, r: null };
    var re = /(\d+(?:[.,]\d+)?)\s*(mm|milimetros?|cm|centimetros?)\s*(?:dos|das|nos|nas|de|do|da|em|na|no)?\s*(cima|topo|parte de cima|parte superior|superior|baixo|rodape|parte de baixo|inferior|esquerd\w*|direit\w*|lados?|laterais)?/g;
    var m, achou = false, sozinho = null;
    while ((m = re.exec(n))) {
      var v = num(m[1]); if (v == null) continue;
      v = MM(v, m[2]); achou = true;
      var lado = m[3] || '';
      if (/cima|topo|superior/.test(lado)) lados.t = v;
      else if (/baixo|rodape|inferior/.test(lado)) lados.b = v;
      else if (/esquerd/.test(lado)) lados.l = v;
      else if (/direit/.test(lado)) lados.r = v;
      else if (/lado|lateral/.test(lado)) { lados.l = v; lados.r = v; }
      else sozinho = v;
    }
    // "em cima 10 mm" (lado antes do número)
    var re2 = /\b(cima|topo|baixo|rodape|esquerd\w*|direit\w*)\s*(?:de|com|:)?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)\b/g;
    while ((m = re2.exec(n))) {
      var w = MM(num(m[2]), m[3]); achou = true;
      if (/cima|topo/.test(m[1])) lados.t = w; else if (/baixo|rodape/.test(m[1])) lados.b = w; else if (/esquerd/.test(m[1])) lados.l = w; else lados.r = w;
    }
    if (!achou) {
      var o = { modo: 'auto', pad: 6 };
      var p = /\b(?:folga|sobra|deixando|deixe|margem de)\s+(?:de\s+)?(\d+(?:[.,]\d+)?)\s*mm\b/.exec(n);
      if (p && num(p[1]) != null) o.pad = Math.min(50, num(p[1]));
      return o;
    }
    var algum = lados.t != null || lados.b != null || lados.l != null || lados.r != null;
    if (!algum && sozinho != null) lados = { t: sozinho, b: sozinho, l: sozinho, r: sozinho };
    else if (sozinho != null) { ['t', 'b', 'l', 'r'].forEach(function (k) { if (lados[k] == null) lados[k] = 0; }); }
    ['t', 'b', 'l', 'r'].forEach(function (k) { lados[k] = Math.min(200, Math.max(0, lados[k] == null ? 0 : lados[k])); });
    return { modo: 'manual', t: lados.t, b: lados.b, l: lados.l, r: lados.r };
  }

  // Qual ferramenta de "Editar e assinar" o pedido quer ('' = só abrir o editor)
  function lerEdit(n) {
    if (/\btarj\w*|\b(cobrir|cubra|cobre|esconder|escondam|ocultar|tapar|censurar)\b.{0,40}\b(nome|cpf|rg|nis|dados?|informacao|informacoes|trecho|numero|endereco|telefone)\b|\bapagar\b.{0,20}\b(nome|cpf)\b.{0,20}\bpdf\b/.test(n)) return { ferramenta: 'cover' };
    if (/\b(edit\w*|alter\w*|mud\w*|troc\w*|corrig\w*|reescrev\w*)\b.{0,25}\b(texto|palavra|frase|nome|valor)\b.{0,30}\b(do pdf|no pdf|ja existe|existente|que esta)\b|\beditar (o )?texto do pdf\b/.test(n)) return { ferramenta: 'edittext' };
    if (/\b(assin\w*|rubric\w*)\b/.test(n) && !/assinatura digital|certificado/.test(n)) return { ferramenta: 'img', assinatura: true };
    if (/\b(preench\w*|complet\w*)\b.{0,25}\b(formulario|campos?|ficha)\b/.test(n)) return { ferramenta: 'form' };
    if (/\b(sublinh\w*)\b/.test(n)) return { ferramenta: 'hl', realce: 'under' };
    if (/\b(riscad\w*|risque|riscar um trecho|tachar|taxar)\b/.test(n)) return { ferramenta: 'hl', realce: 'strike' };
    if (/\b(realc\w*|destac\w*|grifar|grife|marca texto|marcatexto|marcar o trecho|marcar trecho)\b/.test(n)) return { ferramenta: 'hl', realce: 'hl' };
    if (/\b(desenh\w*|rabisc\w*|caneta)\b/.test(n)) return { ferramenta: 'pen' };
    if (/\bcarimb\w*\b/.test(n)) return { ferramenta: 'stamp' };
    if (/\b(colocar|coloque|inserir|insira|adicionar|adicione|por|poe|ponha)\b.{0,20}\b(imagem|foto|logo|logotipo|figura)\b/.test(n)) return { ferramenta: 'img' };
    if (/\b(escrev\w*|digit\w*|adicion\w*|inser\w*|colocar|coloque)\b.{0,20}\btexto\b/.test(n)) return { ferramenta: 'text' };
    if (/\b(edit\w*)\b.{0,15}\bpdf\b|\bpdf\b.{0,15}\b(para|pra) edit\w*/.test(n)) return { ferramenta: '' };
    return null;
  }

  // ordem: [chave, regex de reconhecimento]. Cada uma casa no máximo uma vez; a posição do primeiro acerto decide a ordem das etapas.
  var REGRAS = [
    ['Compress', /\b(reduz\w*|comprim\w*|diminu\w*|compact\w*|aliger\w*|emagrec\w*|encolh\w*|enxug\w*)\b.{0,40}\b(tamanho|peso|pdf|pdfs|arquivo|mb|megas?|kb)\b|\b(deixa\w*|faca\w*|fazer|tornar|torne|ficar)\b.{0,25}\b(mais )?(leve|pequeno|menor)\b|\b(pdf|arquivo)\b.{0,15}\b(muito |bem )?(grande|pesado)\b.{0,25}\b(reduz\w*|diminu\w*|comprim\w*|enviar|mandar|caber)\b|\bca(?:ber|be|iba|ibam)\b.{0,25}\b(\d+ ?(mb|megas?)|limite|sistema|email)\b/],
    ['Crop', /\b(recort\w*|cort\w*|apar\w*|refil\w*|tir\w*|remov\w*|elimin\w*|diminu\w*|reduz\w*|limp\w*)\b.{0,50}\b(margens?|bordas?|bordinhas?|beiradas?|espaco em branco|espacos em branco)\b|\b(margens?|bordas?)\b.{0,20}\b(brancas?|em branco|sobrando)\b|\bdesperdicio de papel\b/],
    ['Meta', /\b(dados ocultos|dados escondidos|metadados?|informacoes ocultas|propriedades do (pdf|arquivo|documento))\b|\b(remov\w*|tir\w*|apag\w*|limp\w*|elimin\w*|anonimiz\w*)\b.{0,25}\b(autor|nome do autor|programa que criou)\b/],
    ['Text', /\b(extrair|extraia|extrai|copiar|copie|pegar|pegue|salvar|exportar|converter|transformar|passar|tirar|tire)\b.{0,25}\btexto\b.{0,25}\b(pdf|txt|arquivo)?|\bpdf\b.{0,10}\b(para|em|pra)\b.{0,6}\b(txt|texto)\b|\btexto d[oe]\b.{0,10}\bpdf\b.{0,15}\b(txt|arquivo)\b/],
    ['PdfWord', /\bpdf\b.{0,12}\b(para|em|pra)\b.{0,8}\b(word|docx|doc)\b|\b(converter|transformar|passar|salvar|gerar|exportar|mudar)\b.{0,25}\bpdf\b.{0,15}\b(word|docx)\b|\beditar\b.{0,15}\bpdf\b.{0,10}\bno word\b/],
    ['WordPdf', /\b(word|docx|doc)\b.{0,12}\b(para|em|pra)\b.{0,8}\bpdf\b|\b(converter|transformar|passar|salvar|gerar|exportar|mudar)\b.{0,25}\b(word|docx|documento do word)\b.{0,15}\bpdf\b/],
    ['PdfJpg', /\bpdf\b.{0,12}\b(para|em|pra)\b.{0,8}\b(jpg|jpeg|png|imag(?:em|ens)|fotos?)\b|\b(converter|transformar|salvar|exportar|gerar|extrair)\b.{0,25}\bpaginas?\b.{0,20}\b(jpg|jpeg|png|imag(?:em|ens)|fotos?)\b/],
    ['JpgPdf', /\b(digitalizar|digitalize|digitalizando|escanear|escaneie|escaneando|scanear)\b|\b(fotos?|imag(?:em|ens)|jpg|jpeg|png|prints?|capturas? de tela)\b.{0,25}\b(em|para|pra|num|no)\b.{0,8}\bpdf\b|\b(transformar|converter|montar|criar|fazer|gerar)\b.{0,25}\b(fotos?|imag(?:em|ens))\b.{0,25}\bpdf\b|\bcamera\b.{0,15}\bpdf\b/],
    ['Merge', /\b(unir|une|unifique|unificar|juntar|junte|mesclar|mescle|combinar|combine)\b.{0,25}\b(pdfs|arquivos|documentos|dois|duas|tres|varios|varias)\b|\bpdfs\b.{0,12}\b(em um|num|em so|em so um)\b/],
    ['Organize', /\b(organizar|organize|reorganizar|reorganize|reordenar|reordene|ordenar|reposicionar|mover|duplicar|duplique)\b.{0,25}\b(paginas?|folhas?)\b|\bminiaturas?\b|\bpaginas?\b.{0,25}\b(arrastando|arrastar|miniaturas?)\b/],
    ['Unlock', /\b(remov\w*|tir\w*|desbloque\w*|destrav\w*|desproteg\w*|libera\w*|abrir sem|retir\w*)\b.{0,30}\bsenha\b|\b(desbloque\w*|destrav\w*|desproteg\w*)\b.{0,20}\bpdf\b|\b(abrir|ler|editar|usar|mexer)\b.{0,20}\bpdf\b.{0,20}\b(com senha|protegido|travado|bloqueado)\b/],
    ['Protect', /\b(colocar|coloque|por|ponha|poe|criar|crie|definir|defina|adicionar|adicione|proteger|proteja|criptografar|criptografe|cifrar|cifre|trancar|tranque|travar|trave|bloquear|bloqueie)\b.{0,30}\b(senha|cadeado)\b|\b(proteger|proteja|criptografar|criptografe|cifrar|cifre)\b.{0,20}\b(pdf|arquivo|documento)\b/],
    ['Edit', null]   // lerEdit
  ];

  function resumoDe(chave, o) {
    switch (chave) {
      case 'Compress':
        return o.modo === 'imagem'
          ? 'reduzir o tamanho com as páginas como imagem (o texto deixa de poder ser copiado)'
          : 'reduzir o tamanho do arquivo mantendo o texto' + (o.alvoMB ? ' (meta: até ' + String(o.alvoMB).replace('.', ',') + ' MB)' : '');
      case 'Crop':
        return o.modo === 'manual'
          ? 'recortar as margens (em cima ' + o.t + ' mm, embaixo ' + o.b + ' mm, esquerda ' + o.l + ' mm, direita ' + o.r + ' mm)'
          : 'recortar automaticamente as bordas em branco (folga de ' + o.pad + ' mm)';
      case 'Meta': return 'apagar título, autor, assunto, palavras-chave e o programa que criou o arquivo';
      case 'Text': return 'copiar o texto do PDF para um arquivo .txt';
      case 'PdfWord': return 'converter o PDF em um documento Word (.docx)';
      case 'PdfJpg': return 'converter cada página do PDF em uma imagem JPG';
      case 'Unlock': return 'gerar uma cópia do PDF que abre sem senha (você digita a senha)';
      case 'Protect': return 'colocar senha no PDF (aba Criptografia)';
      case 'Organize': return 'reorganizar as páginas pelas miniaturas';
      case 'Merge': return 'unir PDFs e fotos em um só arquivo';
      case 'WordPdf': return 'converter um Word (.docx) em PDF';
      case 'JpgPdf': return 'montar um PDF a partir de fotos';
      case 'Edit':
        if (o.ferramenta === 'cover') return 'cobrir um trecho com tarja';
        if (o.ferramenta === 'edittext') return 'reescrever um texto que já existe no PDF';
        if (o.ferramenta === 'img') return o.assinatura ? 'colocar uma assinatura na página' : 'colocar uma imagem na página';
        if (o.ferramenta === 'form') return 'preencher os campos de formulário';
        if (o.ferramenta === 'hl') return o.realce === 'under' ? 'sublinhar um trecho' : (o.realce === 'strike' ? 'riscar um trecho' : 'realçar um trecho');
        if (o.ferramenta === 'pen') return 'desenhar à mão livre na página';
        if (o.ferramenta === 'stamp') return 'colocar um carimbo na página';
        if (o.ferramenta === 'text') return 'escrever um texto na página';
        return 'editar o PDF';
    }
    return ROTULO[chave] || chave;
  }

  C.ler = function (texto, opts) {
    var temArquivo = !!(opts && opts.temArquivo);
    var cru = String(texto == null ? '' : texto);
    if (!cru.trim() || cru.length > 400) return null;
    var n = norm(cru);
    if (RE_PERGUNTA.test(n)) return null;   // pergunta de explicação: segue para o manual do app

    var recusas = [];
    function recusa(codigo) { if (!recusas.some(function (r) { return r.codigo === codigo; })) recusas.push({ codigo: codigo, texto: TEXTOS[codigo] }); }

    var ctx = falaDePdf(n, temArquivo);
    if (/\b(quebr\w*|descobr\w*|recuper\w*|adivinh\w*|hackear|hackeie|crackear|forcar|burlar|furar)\b.{0,30}\bsenha\b|\besquec\w*\b.{0,20}\bsenha\b|\bsenha\b.{0,25}\b(esquecid\w*|perdid\w*)\b/.test(n) && (ctx || /\bsenha\b/.test(n))) recusa('quebrar-senha');
    if (/\bocr\b|\breconhec\w*\b.{0,15}\btexto\b|\b(pdf|documento|pagina)s? (escaneado|digitalizado)s?\b.{0,40}\b(texto|pesquis\w*|copiar|editar|ler)\b|\b(texto|ler)\b.{0,25}\b(foto|imagem|escaneado|digitalizado)\b.{0,15}\bpdf\b/.test(n)) recusa('ocr');
    if (ctx && /\b(paginas?|folhas?)\b.{0,6}\b(em branco|vazias?|brancas?)\b|\b(em branco|vazias?)\b.{0,10}\bpaginas?\b/.test(n) && /\b(remov\w*|exclu\w*|apag\w*|tir\w*|delet\w*|elimin\w*|achar|encontr\w*|detect\w*|ident\w*)\b/.test(n)) recusa('paginas-branco');
    if (/\bassinatura digital\b|\bassinar digitalmente\b|\bcertificado digital\b|\bicp ?brasil\b|\bgov ?br\b.{0,20}\bassin\w*/.test(n)) recusa('assinatura-digital');

    var etapas = [], jaTem = {};
    var forte = ctx || /\b(recort\w*|apar\w*|refil\w*)\b.{0,20}\b(margens?|bordas?)\b/.test(n) || /\b(word|docx|jpg|jpeg|png|fotos?|imag(?:em|ens)|digitalizar|escanear|scanear|senha|txt)\b/.test(n);
    if (forte) {
      REGRAS.forEach(function (r) {
        var chave = r[0], achou = null, o = {};
        if (chave === 'Edit') {
          if (!ctx || jaTem.Edit) return;
          var e = lerEdit(n);
          if (!e) return;
          // "assinar" só vale com contexto de PDF; "assinatura digital" já virou recusa
          var pe = n.search(/\b(tarj\w*|cobr\w*|cubr\w*|escond\w*|ocult\w*|tapar|censur\w*|assin\w*|rubric\w*|preench\w*|complet\w*|sublinh\w*|riscad\w*|risque|tachar|taxar|realc\w*|destac\w*|grif\w*|marca texto|marcatexto|desenh\w*|rabisc\w*|caneta|carimb\w*|edit\w*|escrev\w*|digit\w*|inser\w*|adicion\w*|colocar|coloque|reescrev\w*|alter\w*|corrig\w*|troc\w*)\b/);
          achou = { index: Math.max(0, pe) }; o = e;
        } else {
          var m = r[1].exec(n);
          if (!m) return;
          achou = m;
        }
        if (jaTem[chave]) return;
        if (chave === 'Compress' && (/\btamanho d[aoe]s? (fonte|letra|texto|tela|janela|icone)\b/.test(n) || (!/\bpdfs?\b/.test(n) && /\btamanho d[aoe]s? (foto|imag(?:em|ens))\b/.test(n)))) return;
        if (chave === 'Compress' && !ctx && !/\b(arquivo|tamanho|peso|mb|megas?)\b/.test(n)) return;
        if (chave === 'Unlock' && recusas.some(function (x) { return x.codigo === 'quebrar-senha'; })) return;
        if (chave === 'Protect' && jaTem.Unlock) return;
        if (chave === 'PdfJpg' && jaTem.Compress) return;           // "reduzir com as páginas como imagem" não é converter em JPG
        if (chave === 'Merge' && jaTem.JpgPdf) return;
        if (chave === 'Text' && recusas.some(function (x) { return x.codigo === 'ocr'; }) && !/\b(extrair|extraia|copiar|copie)\b/.test(n)) return;
        if (chave === 'Crop') o = opcoesCrop(n);
        else if (chave === 'Compress') o = opcoesCompress(n);
        jaTem[chave] = true;
        etapas.push({
          ferramenta: chave, modo: AUTO[chave] ? 'auto' : 'abrir',
          rotulo: chave === 'Edit' && o.ferramenta === 'cover' ? 'Editar e assinar (Tarja)' : ROTULO[chave],
          opcoes: o, pos: achou.index || 0, resumo: resumoDe(chave, o)
        });
      });
    }
    // Reduzir e Recortar são parentes ("tirar margens e reduzir"): a ordem é a da frase.
    etapas.sort(function (a, b) { return a.pos - b.pos; });

    if (!etapas.length && !recusas.length) return null;

    var avisos = [];
    var abrir = etapas.filter(function (e) { return e.modo === 'abrir'; });
    var autos = etapas.filter(function (e) { return e.modo === 'auto'; });
    if (abrir.length > 1) {
      avisos.push('Deixo pronta só uma ferramenta por vez: **' + abrir[0].rotulo + '**. Quando terminar, peça "' + abrir.slice(1).map(function (e) { return e.resumo; }).join('" e "') + '".');
      etapas = etapas.filter(function (e) { return e.modo === 'auto' || e === abrir[0]; });
    }
    if (abrir.length && autos.some(function (a) { return a.pos > abrir[0].pos; })) {
      avisos.push('Faço primeiro o que é automático (' + autos.map(function (a) { return a.resumo; }).join('; ') + ') e deixo **' + abrir[0].rotulo + '** pronta em seguida, para você terminar.');
    }
    var comp = autos.filter(function (a) { return a.ferramenta === 'Compress' && a.opcoes.modo === 'imagem'; })[0];
    if (comp) avisos.push('No modo "páginas como imagem" o arquivo fica menor, mas o texto deixa de poder ser copiado ou pesquisado.');
    if (autos.some(function (a) { return a.ferramenta === 'Crop' && a.opcoes.modo === 'manual'; })) {
      avisos.push('O recorte manual corta a mesma medida de todas as páginas: confira o resultado antes de usar.');
    }
    return { etapas: etapas, avisos: avisos, recusas: recusas };
  };

  // O que a pessoa faz a seguir, nas ferramentas deixadas prontas.
  C.instrucao = function (e, temArquivo) {
    var o = (e && e.opcoes) || {};
    switch (e && e.ferramenta) {
      case 'Unlock':
        return (temArquivo ? 'O PDF já está na ferramenta. ' : 'Escolha o PDF na ferramenta. ') +
          'Digite a senha de abrir no campo e toque em **Remover senha e baixar**. A senha nunca passa pelo chat. ' +
          'É preciso saber a senha: o app não adivinha nem quebra senhas. PDF que abre sem senha mas bloqueia copiar ou imprimir funciona sem digitar nada.';
      case 'Protect':
        return 'Escolha o PDF (ou vários, ou uma pasta), digite a senha nos dois campos e baixe a cópia protegida. **Anote a senha**: sem ela não há como recuperar o arquivo. A senha você digita no campo; ela nunca passa pelo chat.';
      case 'Edit':
        if (o.ferramenta === 'cover') return (temArquivo ? '' : 'Abra o PDF na ferramenta. ') + 'Escolhi **Tarja**: arraste sobre o trecho que quer cobrir. Atenção: a tarja só esconde, o texto de baixo continua no arquivo e dá para copiá-lo. Para sigilo de verdade, depois use **Reduzir tamanho** no modo "Páginas como imagem" e confira tentando selecionar o texto.';
        if (o.ferramenta === 'edittext') return (temArquivo ? '' : 'Abra o PDF na ferramenta. ') + 'Escolhi **Editar texto**: toque no texto que já existe na página e reescreva. Depois toque em **Baixar PDF editado**.';
        if (o.ferramenta === 'img') return (temArquivo ? '' : 'Abra o PDF na ferramenta. ') + 'Toque em **Escolher imagem...** (a foto da assinatura, de preferência com fundo branco), depois toque na página onde ela deve ficar. É só uma imagem: não tem validade de assinatura digital.';
        if (o.ferramenta === 'hl') return (temArquivo ? '' : 'Abra o PDF na ferramenta. ') + 'Arraste sobre o trecho na página. Depois baixe o PDF editado.';
        if (o.ferramenta === 'form') return (temArquivo ? '' : 'Abra o PDF na ferramenta. ') + 'Preencha os campos direto na página. Depois baixe o PDF editado.';
        return (temArquivo ? '' : 'Abra o PDF na ferramenta. ') + 'Escolhi a ferramenta certa na barra: marque na página o que quer fazer. Depois toque em **Baixar PDF editado**.';
      case 'Organize':
        return 'As miniaturas aparecem na ferramenta: arraste para reordenar e use os botões de cada página para girar, duplicar ou excluir. Depois baixe o PDF.';
      case 'Merge':
        return 'Escolha os PDFs e fotos (até 20 arquivos, 50 MB no total), ajuste a ordem arrastando e baixe o arquivo unido.';
      case 'WordPdf':
        return 'Escolha o arquivo .docx na ferramenta; o PDF é gerado e baixado no seu aparelho.';
      case 'JpgPdf':
        return 'Tire fotos ou escolha as imagens, ajuste a ordem e, se quiser, o filtro de digitalização (preto e branco, contraste) e o corte. Depois toque em **Gerar PDF**.';
    }
    return 'Siga os passos da ferramenta na tela.';
  };

  return C;
});

/*! Paulus v1 — gerado por scripts/build.mjs. Não edite: altere shared/ e client/. */
(function (root) {
'use strict';
// ---- shared/pii.mjs ----
// Filtro de dados pessoais. FONTE ÚNICA: o navegador (dist/paulus.js) e o Worker usam este arquivo.
// Barra e-mail, sequências longas de números (CPF, NIS, telefone), número depois de "RG/CPF/NIS...",
// "nome + sobrenome" depois de palavras como "nome/chama/paciente/criança", tratamento + nome
// ("dona Maria Souza") e endereço residencial.
// Limite conhecido: é um filtro por padrões, não uma garantia. Por isso a regra de ouro continua
// sendo "dados de famílias nunca chegam a este código".
// (Sem lookbehind de propósito: Safari/iOS antigos quebram o arquivo inteiro com ele.)

const CAP = 'A-ZÁÉÍÓÚÂÊÔÃÕÇ';
const MIN_L = 'a-záéíóúâêôãõç';
const FORA = '(?:^|[^A-Za-zÀ-ÿ])';
const NOME2 = '([' + CAP + '][' + MIN_L + ']+)\\s+([' + CAP + '][' + MIN_L + ']+)';
const GATILHOS = '[Nn]ome|[Cc]hama|[Cc]hamada|[Cc]hamado|[Ss]obrenome|[Pp]aciente|[Uu]su[aá]ri[oa]|[Bb]enefici[aá]ri[oa]|[Aa]tendid[oa]|[Cc]rian[cç]a|[Aa]dolescente|[Mm]enin[oa]|[Ff]ilh[oa]|[Mm][aã]e|[Pp]ai|[Ii]dos[oa]';

const RE_NOME = new RegExp(FORA + '(?:' + GATILHOS + ')(?![A-Za-zÀ-ÿ])[^.?!\\n]{0,25}?' + FORA + NOME2, 'g');
const RE_TRAT = new RegExp(FORA + '(?:[Dd]ona|[Dd]na|[Ss]r|[Ss]ra|[Ss]eu|[Ss]enhor|[Ss]enhora)\\.?\\s+[' + CAP + '][' + MIN_L + ']{2,}\\s+[' + CAP + '][' + MIN_L + ']{2,}');
const RE_ENDERECO = /\b(mora|moram|moradora?|reside|residente|endere[cç]o)\b[^.?!\n]{0,40}\b(rua|av\.?|avenida|travessa|tv\.?|quadra|lote)\b[^.?!\n]{0,40}\b\d+/i;
// "RG 1234567", "CPF: 12345678", "NIS nº 123456": o número curto também é dado pessoal quando vem rotulado.
const RE_DOC_ROTULADO = /\b(?:rg|cpf|nis|nit|pis|cnh|cnpj|titulo(?:\s+de\s+eleitor)?|t[ií]tulo(?:\s+de\s+eleitor)?|cart[aã]o|matr[ií]cula|prontu[aá]rio|sus|cns|c[oó]digo\s+familiar)\b[^\d\n]{0,15}\d[\d.\-\/\s]{4,}\d/i;

// Palavras que começam com maiúscula mas são instituições, não pessoas ("Bolsa Família", "Boa Vista").
const NAO_NOME = new Set(('bolsa familia programa cadastro unico centro conselho tutelar social assistencia nacional unidade casa lar ' +
  'servico servicos ministerio secretaria boa vista roraima brasil sistema saude educacao municipal estadual federal ' +
  'protecao basica especial referencia caps cras creas suas sus paif paefi scfv loas bpc cadunico previdencia ' +
  'defensoria publica delegacia policia hospital posto pronto socorro estatuto crianca adolescente idoso ' +
  'pessoa deficiencia saude mental rede acolhimento abrigo').split(' '));

function semAcentoMin(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function achouNome(t) {
  RE_NOME.lastIndex = 0;
  let m;
  while ((m = RE_NOME.exec(t)) !== null) {
    if (!NAO_NOME.has(semAcentoMin(m[1])) && !NAO_NOME.has(semAcentoMin(m[2]))) return true;
    RE_NOME.lastIndex = m.index + 1; // continua procurando logo depois do início deste achado
  }
  return false;
}

// Intervalo de anos ("2023-2026", "2023 2024 2025") não é documento nem telefone.
const SO_ANOS = /^(?:(?:19|20)\d{2}[\s\-\/]+)*(?:19|20)\d{2}$/;

function temDadoPessoal(texto) {
  const t = String(texto == null ? '' : texto);
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(t)) return true;
  const sequencias = t.match(/\d[\d.\-\/\s]{6,}\d/g) || [];
  if (sequencias.some(s => !SO_ANOS.test(s.trim()) && s.replace(/\D/g, '').length >= 9)) return true;
  if (RE_DOC_ROTULADO.test(t)) return true;
  if (achouNome(t) || RE_TRAT.test(t)) return true;
  return RE_ENDERECO.test(t);
}

function limparMarcacao(texto) {
  // tira <tag> e </tag>, inclusive com atributos, para a pergunta não fechar/abrir blocos do prompt
  return String(texto == null ? '' : texto).replace(/<\/?[A-Za-z][^<>]{0,40}>/g, '').trim();
}

// ---- shared/crise.mjs ----
// Pedidos de socorro: resposta imediata, no aparelho, mesmo sem internet e sem IA.
// Não faz triagem nem avaliação clínica: só mostra os telefones e pede para acionar o serviço.

const EMERGENCIAS = [
  { numero: '192', nome: 'SAMU' },
  { numero: '193', nome: 'Bombeiros' },
  { numero: '190', nome: 'Polícia Militar' },
  { numero: '188', nome: 'CVV (apoio emocional, 24h)' },
  { numero: '180', nome: 'Central de Atendimento à Mulher' },
  { numero: '100', nome: 'Disque Direitos Humanos' }
];



function semAcento(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}


// Sinais de ideação suicida que a palavra "suicídio" não cobre (texto já sem acento e em minúsculas).
// Servem a duas listas: o cartão de crise e o "nunca é pergunta técnica". Só entram expressões que quase não têm outro sentido
// no trabalho do SUAS ("não aguento mais a demanda" NÃO entra; "não aguento mais viver" entra).
const SINAIS_SUICIDIO = [
  'nao (?:aguento|suporto|consigo) mais (?:viver|essa vida|esta vida|continuar vivo|continuar viva)',
  '(?:minha|sua|a) vida nao tem (?:mais )?sentido',
  'nao (?:vejo|tenho) (?:mais )?(?:sentido em viver|sentido na vida|razao (?:pra|para) viver|motivo (?:pra|para) viver)',
  'quer(?:o|ia|endo)? (?:sumir|desaparecer) (?:de vez|para sempre|pra sempre|do mundo|deste mundo|dessa vida)',
  'quer(?:o|ia|endo)? (?:estar|ficar) morto|quer(?:o|ia|endo)? (?:estar|ficar) morta|quer(?:o|ia|endo)? nao ter nascido',
  'vontade de morrer|desejo de morrer|(?:seria|era|sera) melhor (?:se )?(?:eu |ela |ele )?(?:nao existisse|estivesse mort[oa]|sem mim)',
  '(?:dar|dando|por|pondo) fim (?:a |na |em )?(?:propria |minha |sua |a )?vida',
  '(?:me|se) (?:enforcar|enforcando|afogar|afogando|envenenar|envenenando)',
  '(?:me|se) jogar (?:da|do|de|embaixo|debaixo)',
  'pular (?:da|do|de) (?:ponte|predio|janela|viaduto|sacada|terraco|laje|cima)'
].join('|');

// Sinais de overdose e intoxicação além de "overdose" e "engoliu remédio".
const SINAIS_CLINICA = /\b(?:(?:tomou|tomei|tomaram|ingeriu|engoliu|bebeu) (?:varios|muitos|muitas|uma cartela|a cartela|todos os|todo o|um monte de)(?: \w+)? ?(?:comprimidos?|remedios?|medicamentos?|pilulas?|cartelas?)|(?:tomou|bebeu|ingeriu) (?:veneno|chumbinho|soda caustica))\b/;

// Frases que, em qualquer pergunta, indicam alguém em risco (e não dúvida técnica).
const FRASE_DE_RISCO_BASE = /\b(me matar|se matar|quer(?:o|endo|er|ia)? morrer|nao quer(?:o|er)? mais viver|tirar (?:a |minha |sua |propria )*vida|acabar com (?:a |minha |sua )*vida|acabar com tudo|pensando em morrer|se cortando|me cortando|se cortar|me cortar)\b/;
const SINAIS_SUICIDIO_RE = new RegExp('\\b(?:' + SINAIS_SUICIDIO + ')\\b');
function fraseDeRisco(t) { return FRASE_DE_RISCO_BASE.test(t) || SINAIS_SUICIDIO_RE.test(t); }
// Caso concreto, relato ou momento: "ela falou em suicídio", "tentou ontem", "a usuária está com ideação".
const CASO_OU_MOMENTO = /\b(disse|disseram|falou|falaram|fala em|contou|relatou|verbalizou|mencionou|ameac\w+|tentou|tentando|esta com|estao com|estou com|ficou com|esteve com|hoje|ontem|agora|neste momento|nesse momento|acabou de|esta semana|essa semana)\b/;
// Pedido de método, meio, dose ou letalidade nunca é pergunta técnica.
const PEDIDO_DE_METODO = /\b(metodos?|meios?|doses?|dosagem|comprimidos?|quantos|quantas|letal\w*|indolor\w*|jeito|maneira|forma de (?:se|me)|como (?:se|me) matar)\b/;
// Quem fala de si.
const PRIMEIRA_PESSOA = /\b(me matar|quero morrer|nao quero mais viver|(?:tirar|acabar com) minha vida|me cortando|me cortar|(?:estou|to|ando) pensando em (?:morrer|suicid\w*)|penso em (?:morrer|suicid\w*)|tenho (?:vontade|pensamentos?|ideias?) de (?:morrer|me matar))\b/;

// Pergunta TÉCNICA geral sobre suicídio ("como avaliar o risco?", "quais os mitos?", "o que é posvenção?"): vai para a IA e a cartilha.
// Na dúvida, é socorro: relato de caso, momento, primeira pessoa, pedido de método e a palavra solta mantêm o cartão de crise.
function ehPerguntaTecnicaSuicidio(texto) {
  const t = semAcento(texto);
  if (fraseDeRisco(t) || CASO_OU_MOMENTO.test(t) || PEDIDO_DE_METODO.test(t)) return false;
  return tipoDePerguntaSuicidio(t) !== null;
}

// Perguntas GERAIS ("o que fazer em caso de risco de vida?", "quantas crianças em perigo o CREAS atende?"): termos vagos
// como "em perigo" ou "risco de vida" não disparam o cartão, porque ali ninguém está pedindo socorro. Para ser geral, a frase
// precisa abrir como pergunta, trazer um sinal de generalidade E não ter marca de caso ou de momento ("hoje", "agora", "disse").
const GERAL_ABERTURA = /^(?:como|qual|quais|quanto|quantos|quantas|o que|quando|onde|existe|ha)\b/;
const GERAL_SINAL = /\b(?:caso de|casos de|em casos|fluxo|protocolo|procedimento|quantos?|quantas?|atende|atendem|quando (?:a |o |uma |um )?(?:crianca|adolescente|idos[oa]|mulher|pessoa|familia)s?)\b/;
// Relato de violência sexual ou de abuso só vira cartão quando há caso ("a criança relatou...", "hoje", "ontem"); sem caso é dúvida técnica.
const CASO_VIOLENCIA = new RegExp(CASO_OU_MOMENTO.source + '|\\b(?:revelou|relata|sofre|sofreu|sofrendo|vitima de)\\b');
function perguntaGeral(t) { return GERAL_ABERTURA.test(t.trim()) && GERAL_SINAL.test(t) && !CASO_OU_MOMENTO.test(t); }

const PADROES = [
  {
    tipo: 'suicidio',
    titulo: 'Risco de vida: acione ajuda agora',
    re: /\b(suicid\w*|me matar|se matar|ele se matar|ela se matar|quer(?:o|endo|er|ia)? morrer|nao quer(?:o|er)? mais viver|tirar (?:a |minha |sua |propria )*vida|acabar com (?:a |minha |sua )*vida|acabar com tudo|automutil\w*|autolesao|auto lesao|se cortando|me cortando|se cortar|me cortar|pensando em morrer|ideacao)\b/,
    extra: SINAIS_SUICIDIO_RE,
    numeros: ['192', '188', '193']
  },
  {
    tipo: 'violencia',
    titulo: 'Violência em andamento: acione ajuda agora',
    re: /\b((?:esta|estao|estou|estamos) (?:sendo )?(?:agredid|espancad|ameacad)\w*|sendo (?:agredid|espancad|ameacad)\w*|violencia (?:em curso|agora|em andamento)|abuso (?:em andamento|acontecendo agora))\b/,
    numeros: ['190', '180', '100']
  },
  {
    // termos vagos: só valem fora de pergunta geral; "socorro financeiro/social..." é pedido de benefício, não de ajuda
    tipo: 'violencia',
    titulo: 'Violência em andamento: acione ajuda agora',
    re: /\b(risco de vida|risco iminente|em perigo|correndo perigo|socorro(?! (?:financeiro|social|alimentar|emergencial|material|habitacional)))\b/,
    geral: true,
    numeros: ['190', '180', '100']
  },
  {
    // agressão física relatada (presente ou passado recente): "a vizinha apanha do marido", "ele bate na filha"
    tipo: 'violencia',
    titulo: 'Relato de violência: proteja a pessoa e acione a rede',
    re: /\b(?:apanh(?:a|am|ando|ou|aram|ei) (?:d[eoa]s?|em|muito|bastante|toda|todo|todos|todas|sempre|dele|dela)\b|espanc\w+|bat(?:e|eu|em|endo) (?:n[oa]s?|em) (?:filh\w*|espos\w*|mulher|marido|crianc\w*|menin\w*|adolescent\w*|mae|pai|net[oa]s?|namorad\w*|companheir\w*|idos\w*|avo\w*|irma\w*|bebe\w*|dela|dele)\b|bat(?:e|eu|em|endo) n(?:ele|ela|eles|elas)\b)/,
    texto: 'RELATO',
    numeros: ['190', '180', '100']
  },
  {
    // violência sexual e abuso: só com caso (ver CASO_VIOLENCIA)
    tipo: 'violencia',
    titulo: 'Relato de violência: proteja a pessoa e acione a rede',
    re: /\b(?:abuso sexual|abusad[oa]|abusou|estupr\w+|violencia sexual|violentad[oa]|molestad[oa]|molestou)\b/,
    exigeCaso: true,
    texto: 'RELATO',
    numeros: ['190', '180', '100']
  },
  {
    tipo: 'clinica',
    titulo: 'Emergência de saúde: acione ajuda agora',
    re: /\b(overdose|parou de respirar|(?:esta|ficou|estava|encontrei|encontramos) (?:\w+ )?(?:inconsciente|desacordad[oa])|desmaiou|convuls\w*|engoliu (?:remedio|veneno)s?)\b/,
    extra: SINAIS_CLINICA,
    numeros: ['192', '193']
  }
];

const TEXTO_PADRAO = 'Se há risco de vida agora, ligue primeiro para um destes números. Depois, acione o serviço de referência do território e a coordenação. Se a sua dúvida for sobre o fluxo de atendimento, reformule a pergunta e eu ajudo.';

// Para quem escreve sobre si mesmo: acolhe, sem validar o desejo de morrer, e aponta o CVV e o SAMU.
const TEXTO_PESSOAL = 'Sinto muito que você esteja passando por isso. Você não precisa enfrentar essa dor sozinho(a). Ligue agora para o CVV, 188 (gratuito, 24 horas), ou, se estiver em perigo neste momento, para o SAMU, 192. Se puder, fique perto de alguém de confiança e peça que alguém fique com você. Se você é profissional e escreveu sobre um caso, reformule em terceira pessoa, sem identificar a pessoa.';

// Para o profissional diante de um caso: só os cuidados imediatos da cartilha ABP/CFM (2014). Não lista meios nem classifica o risco.
const TEXTO_TERCEIRO = 'Se há risco imediato, não deixe a pessoa sozinha: fique com ela, converse com calma e sem julgamento, e ligue para o SAMU (192). Se o perigo for imediato, peça uma ambulância, em vez de levá-la por conta própria. Lembre que perguntar não aumenta o risco e costuma trazer alívio (cartilha ABP/CFM, 2014). Depois, acione o serviço de referência (UBS ou CAPS) e a coordenação. Eu não classifico o risco de uma pessoa específica: isso é avaliação da equipe. Se a sua dúvida for geral (como avaliar, abordar ou encaminhar), pergunte sem relatar um caso e eu respondo com a cartilha.';

// Relato de violência (ela apanha, a criança contou de um abuso): protege primeiro, depois a rede. Não classifica o caso nem fala em sigilo.
const TEXTO_RELATO = 'Se a pessoa corre risco agora, ligue 190. Violência contra a mulher: 180. Contra criança, adolescente ou pessoa idosa: Disque 100. A suspeita de violência contra criança ou adolescente deve ser comunicada ao Conselho Tutelar. Depois, acione o CREAS ou o serviço de referência e a coordenação, e registre o que foi relatado sem pedir que a pessoa conte tudo de novo. Se a sua dúvida for sobre o fluxo, reformule sem relatar um caso e eu ajudo.';

// Quem fala de si, além de PRIMEIRA_PESSOA. Fica de fora se a frase relata o que outra pessoa disse ("ela falou que queria sumir").
const PRIMEIRA_PESSOA_EXTRA = /\b(?:minha vida nao tem (?:mais )?sentido|nao (?:aguento|suporto|consigo) mais (?:viver|essa vida|esta vida)|nao (?:vejo|tenho) (?:mais )?(?:sentido em viver|sentido na vida|razao (?:pra|para) viver|motivo (?:pra|para) viver)|quer(?:o|ia) (?:sumir|desaparecer)|(?:vou|quero|pensando em|penso em|ia) me (?:jogar|enforcar|afogar|envenenar)|vou pular|queria estar morto|queria estar morta|queria nao ter nascido|(?:vou|quero) dar fim a minha vida)\b/;
const RELATA_TERCEIRO = /\b(?:disse|disseram|falou|falaram|contou|relatou|verbalizou|mencionou)\b/;

// Devolve null se não for pedido de socorro.
function detectarCrise(texto) {
  // "Pronto Socorro" é um serviço de saúde, não um pedido de socorro ("qual o endereço do pronto-socorro?")
  const t = semAcento(texto).replace(/pronto[ -]+socorro/g, 'pronto atendimento');
  for (const p of PADROES) {
    if (!p.re.test(t) && !(p.extra && p.extra.test(t))) continue;
    if (p.geral && perguntaGeral(t)) continue;
    if (p.exigeCaso && !CASO_VIOLENCIA.test(t)) continue;
    if (p.tipo === 'suicidio') {
      if (ehPerguntaTecnicaSuicidio(texto)) continue;
      const pessoal = PRIMEIRA_PESSOA.test(t) || (PRIMEIRA_PESSOA_EXTRA.test(t) && !RELATA_TERCEIRO.test(t));
      const numeros = pessoal ? ['188', '192'] : p.numeros;
      return {
        tipo: 'crise',
        subtipo: p.tipo,
        titulo: p.titulo,
        texto: pessoal ? TEXTO_PESSOAL : TEXTO_TERCEIRO,
        pessoal: pessoal,
        telefones: EMERGENCIAS.filter(e => numeros.includes(e.numero))
      };
    }
    return {
      tipo: 'crise',
      subtipo: p.tipo,
      titulo: p.titulo,
      texto: p.texto === 'RELATO' ? TEXTO_RELATO : TEXTO_PADRAO,
      telefones: EMERGENCIAS.filter(e => p.numeros.includes(e.numero))
    };
  }
  return null;
}

// ---- shared/busca.mjs ----
// Busca por palavras (BM25) na base de conhecimento. Roda no navegador (offline) e no Worker.
// Sem dependências. Cada "trecho" da base tem: { id, doc, titulo, norma, ano, referencia, texto }.

const STOP = new Set(('a o as os um uma uns umas de do da dos das em no na nos nas por para com sem sobre e ou que se ao aos ' +
  'qual quais como quem onde quando ser sao foi ha pelo pela pelos pelas seu sua seus suas ele ela eles elas isso essa esse este esta ' +
  'meu minha eu voce nos eh mais muito sao tem ter pode podem deve devem fazer faz quanto quanta fica ficam').split(' '));

// Siglas comuns viram também a forma por extenso (a base costuma escrever por extenso).
const SIGLAS = {
  cadunico: ['cadastro', 'unico'],
  pbf: ['programa', 'bolsa', 'familia'],
  bpc: ['beneficio', 'prestacao', 'continuada'],
  loas: ['lei', 'organica', 'assistencia', 'social'],
  cnas: ['conselho', 'nacional', 'assistencia', 'social'],
  cmas: ['conselho', 'municipal', 'assistencia', 'social'],
  cit: ['comissao', 'intergestores', 'tripartite'],
  cib: ['comissao', 'intergestores', 'bipartite'],
  igd: ['indice', 'gestao', 'descentralizada'],
  brc: ['beneficio', 'renda', 'cidadania'],
  bpi: ['beneficio', 'primeira', 'infancia'],
  bvf: ['beneficio', 'variavel', 'familiar'],
  bco: ['beneficio', 'complementar'],
  sicon: ['sistema', 'condicionalidades'],
  eca: ['estatuto', 'crianca', 'adolescente'],
  paif: ['protecao', 'atendimento', 'integral', 'familia'],
  paefi: ['protecao', 'atendimento', 'especializado', 'familias', 'individuos'],
  scfv: ['servico', 'convivencia', 'fortalecimento', 'vinculos'],
  cfp: ['conselho', 'federal', 'psicologia'],
  crp: ['conselho', 'regional', 'psicologia'],
  cid: ['classificacao', 'internacional', 'doencas'],
  cif: ['classificacao', 'internacional', 'funcionalidade', 'incapacidade', 'saude'],
  oms: ['organizacao', 'mundial', 'saude'],
  cras: ['centro', 'referencia', 'assistencia', 'social'],
  creas: ['centro', 'referencia', 'especializado', 'assistencia', 'social'],
  suas: ['sistema', 'unico', 'assistencia', 'social'],
  pnas: ['politica', 'nacional', 'assistencia', 'social'],
  peti: ['programa', 'erradicacao', 'trabalho', 'infantil'],
  nob: ['norma', 'operacional', 'basica'],
  fnas: ['fundo', 'nacional', 'assistencia', 'social'],
  fmas: ['fundo', 'municipal', 'assistencia', 'social'],
  caps: ['centro', 'atencao', 'psicossocial'],
  raps: ['rede', 'atencao', 'psicossocial'],
  pcd: ['pessoa', 'deficiencia'],
  mds: ['ministerio', 'desenvolvimento', 'social'],
  paf: ['plano', 'acompanhamento', 'familiar'],
  tsft: ['trabalho', 'social', 'familias', 'territorios'],
  rma: ['relatorio', 'mensal', 'atendimentos'],
  gpte: ['grupos', 'populacionais', 'tradicionais', 'especificos'],
  spsbd: ['servico', 'protecao', 'social', 'basica', 'domicilio']
};

// Quantos trechos da base vão para a IA e para a resposta offline.
const K_PADRAO = 4;

// Do texto de cada trecho, a IA só recebe os primeiros caracteres (worker/prompt.mjs). O Worker, por isso, guarda só esse começo
// (limite de tamanho do plano gratuito), e a assinatura do índice conta só até aqui para valer nas duas versões da base.
const MAX_TEXTO_TRECHO = 700;

// Na hora de ordenar, lei e decreto valem um pouco mais que orientação técnica, e esta mais que material de apoio
// (para "o que é o BPC?" a lei vem antes de um caderno de orientação). Só muda a ordem, não quem entra.
const PESO_TIPO = { norma: 1.2, referencia: 1, apoio: 0.85 };
// Evita as 4 fontes serem do mesmo documento (ex.: 4 incisos do mesmo artigo).
const MAX_POR_DOC = 3;

function normalizar(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Formas de "gerir" que as pessoas digitam; a norma costuma usar o infinitivo.
const ALIAS = { gere: 'gerir', gerem: 'gerir', gerencia: 'gerir', gerenciar: 'gerir', gerencie: 'gerir' };

// Raiz simples: tira o plural (-s, -es, -ões), as terminações de verbo e de substantivo (-ar, -er, -ir, -ção, -mento),
// a vogal final e corta em 6 letras. Assim "atuar", "atua" e "atuação" se encontram, "acolher" acha "acolhimento"
// e "município" e "municipal" também.
const CACHE_RAIZ = new Map();
function raiz(t) {
  // O vocabulário é pequeno (~12 mil palavras) e os trechos repetem as mesmas palavras centenas de milhares de vezes:
  // guardar o resultado corta o tempo de montar o índice (importante no Worker, que tem limite de partida).
  let r = CACHE_RAIZ.get(t);
  if (r === undefined) {
    if (CACHE_RAIZ.size > 60000) CACHE_RAIZ.clear();
    r = calcularRaiz(t);
    CACHE_RAIZ.set(t, r);
  }
  return r;
}

function calcularRaiz(t) {
  if (ALIAS[t]) t = ALIAS[t];
  if (t.length > 4) {
    if (t.endsWith('oes')) t = t.slice(0, -3) + 'ao';          // decisoes -> decisao
    else if (/(?:or|ar|er|ur)es$/.test(t)) t = t.slice(0, -2);  // valores -> valor, mulheres -> mulher
    else if (t.endsWith('s')) t = t.slice(0, -1);
  }
  const m = /^(.{3,}?)(?:acao|icao|amento|imento|ar|er|ir)$/.exec(t);
  if (m) t = m[1];
  else if (t.length > 3 && /[aeo]$/.test(t)) t = t.slice(0, -1);
  return t.length > 6 ? t.slice(0, 6) : t;
}

function tokenizar(s, { expandir = false } = {}) {
  const base = normalizar(s).split(' ').filter(Boolean);
  const saida = [];
  for (const t of base) {
    if (STOP.has(t)) continue;
    saida.push(raiz(t));
    if (expandir && SIGLAS[t]) for (const x of SIGLAS[t]) saida.push(raiz(x));
  }
  return saida;
}

// Termos da pergunta com peso: o que a pessoa escreveu vale 1; a forma por extenso de uma sigla vale PESO_EXTENSO
// (senão "BPC" favorece qualquer trecho que repita "Benefício de Prestação Continuada", mesmo sem falar do assunto).
const PESO_EXTENSO = 0.35;
function termosDaConsulta(consulta) {
  const pesos = new Map();
  for (const t of tokenizar(consulta)) pesos.set(t, 1);
  for (const t of normalizar(consulta).split(' ')) {
    if (STOP.has(t) || !SIGLAS[t]) continue;
    for (const x of SIGLAS[t]) { const r = raiz(x); if (!pesos.has(r)) pesos.set(r, PESO_EXTENSO); }
  }
  return pesos;
}

function trechosValidos(trechos) {
  return (Array.isArray(trechos) ? trechos : []).filter(function (c) { return c && c.texto; });
}

// Assinatura simples da base (quantidade de trechos e de caracteres): serve para saber se um índice
// pré-calculado ainda corresponde à base que está sendo usada.
function assinatura(validos) {
  let chars = 0;
  for (const c of validos) chars += Math.min(c.texto.length, MAX_TEXTO_TRECHO);
  return validos.length + ':' + chars;
}

// "pre" (opcional) é um índice já calculado por serializarIndice(). Montar o índice de uma base grande leva
// centenas de milissegundos; o Worker tem limite de partida, então ele recebe o índice pronto no pacote.
// Se "pre" não corresponder à base (assinatura diferente), o índice é calculado do zero.
// Parágrafo, inciso e alínea ("art. 20, § 3º") quase nunca repetem o assunto do artigo ("benefício de prestação continuada"):
// quem pergunta pelo assunto não os encontrava. Para a busca (e só para ela), o trecho "filho" herda o começo do texto do artigo (caput).
const MAX_HERANCA = 300;
const REF_FILHO = /^(art\. [0-9]+[º°o]?(?:-[A-Z])?),\s*\S/;
function mapaDeCaput(validos) {
  const m = new Map();
  for (const c of validos) {
    const r = String(c.referencia || '').trim();
    if (/^art\. [0-9]+[º°o]?(?:-[A-Z])?(?:, caput)?$/.test(r)) m.set(c.doc + '|' + r.replace(/, caput$/, ''), c);
  }
  return m;
}
function textoHerdado(c, caputs) {
  const f = REF_FILHO.exec(String(c.referencia || '').trim());
  const pai = f && caputs.get(c.doc + '|' + f[1]);
  return pai && pai !== c ? ' ' + pai.texto.slice(0, MAX_HERANCA) : '';
}

function criarIndice(trechos, pre) {
  const validos = trechosValidos(trechos);
  if (pre && pre.f === 2 && pre.sig === assinatura(validos) && Array.isArray(pre.v) && Array.isArray(pre.d) && pre.d.length === validos.length) {
    return restaurarIndice(validos, pre);
  }
  const docs = [];
  const df = Object.create(null);
  let soma = 0;
  const caputs = mapaDeCaput(validos);
  for (const c of validos) {
    // a referência ("art. 17, XV") e o título pesam o dobro
    const toks = tokenizar((c.referencia || '') + ' ' + (c.referencia || '') + ' ' + (c.titulo || '') + ' ' + c.texto + textoHerdado(c, caputs));
    const tf = Object.create(null);
    for (const t of toks) tf[t] = (tf[t] || 0) + 1;
    for (const t in tf) df[t] = (df[t] || 0) + 1;
    docs.push({ c, tf, len: toks.length });
    soma += toks.length;
  }
  return { docs, df, N: docs.length, avg: docs.length ? soma / docs.length : 0 };
}

// Índice em forma compacta, para guardar em arquivo: { f:2, sig, v:[termos], d:[[len, delta, vezes, delta, vezes, ...], ...] }
// O vocabulário vai ordenado do termo mais comum para o mais raro e os ids de cada trecho vão em ordem crescente, só pela
// diferença para o anterior: números pequenos e repetidos comprimem muito mais (importa porque o Worker tem limite de tamanho).
function serializarIndice(indice) {
  const termos = Object.keys(indice.df);
  termos.sort(function (a, b) { return indice.df[b] - indice.df[a]; }); // estável: empate mantém a ordem de inserção
  const id = new Map(termos.map(function (t, i) { return [t, i]; }));
  const d = indice.docs.map(function (x) {
    const pares = Object.keys(x.tf).map(function (t) { return [id.get(t), x.tf[t]]; });
    pares.sort(function (a, b) { return a[0] - b[0]; });
    const linha = [x.len];
    let ant = 0;
    for (const p of pares) { linha.push(p[0] - ant, p[1]); ant = p[0]; }
    return linha;
  });
  return { f: 2, sig: assinatura(indice.docs.map(function (x) { return x.c; })), v: termos, d: d };
}

function restaurarIndice(validos, pre) {
  const docs = [];
  const df = Object.create(null);
  let soma = 0;
  for (let i = 0; i < validos.length; i++) {
    const linha = pre.d[i];
    const tf = Object.create(null);
    let idTermo = 0;
    for (let j = 1; j < linha.length; j += 2) {
      idTermo += linha[j];
      const t = pre.v[idTermo];
      tf[t] = linha[j + 1];
      df[t] = (df[t] || 0) + 1;
    }
    docs.push({ c: validos[i], tf, len: linha[0] });
    soma += linha[0];
  }
  return { docs, df, N: docs.length, avg: docs.length ? soma / docs.length : 0 };
}

// Devolve [{ trecho, score, cobertura }] do melhor para o pior.
// cobertura = fração dos termos da pergunta que aparecem no trecho (filtra resultados "de sorte").
function buscar(indice, consulta, { k = 3, minScore = 1.2, minCobertura = 0.5 } = {}) {
  if (!indice || !indice.N) return [];
  const pesos = termosDaConsulta(consulta);
  const termos = Array.from(pesos.keys());
  if (!termos.length) return [];
  let pesoTotal = 0;
  for (const p of pesos.values()) pesoTotal += p;
  const k1 = 1.4, b = 0.75;
  const res = [];
  for (const d of indice.docs) {
    let score = 0, achou = 0;
    for (const t of termos) {
      const f = d.tf[t];
      if (!f) continue;
      const w = pesos.get(t);
      achou += w;
      const idf = Math.log(1 + (indice.N - (indice.df[t] || 0) + 0.5) / ((indice.df[t] || 0) + 0.5));
      score += w * idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / (indice.avg || 1)));
    }
    const cobertura = achou / pesoTotal;
    if (score >= minScore && cobertura >= minCobertura) res.push({ trecho: d.c, score, cobertura, ordem: score * (PESO_TIPO[d.c.tipo || 'norma'] || 1) });
  }
  res.sort((x, y) => y.ordem - x.ordem);
  // No máximo MAX_POR_DOC trechos do mesmo documento; se faltar resultado, completa com os que ficaram de fora.
  const escolhidos = [], sobras = [], porDoc = Object.create(null);
  for (const r of res) {
    if (escolhidos.length >= k) break;
    const n = porDoc[r.trecho.doc] || 0;
    if (n < MAX_POR_DOC) { porDoc[r.trecho.doc] = n + 1; escolhidos.push(r); } else sobras.push(r);
  }
  while (escolhidos.length < k && sobras.length) escolhidos.push(sobras.shift());
  escolhidos.sort((x, y) => y.ordem - x.ordem);
  return escolhidos;
}

// Pergunta curta de seguimento ("e o horário?", "e para adolescente?") sozinha não acha norma:
// junta a pergunta anterior do usuário (sem dado pessoal, o chamador já filtrou) para a busca.
function consultaComContexto(pergunta, historico) {
  if (tokenizar(pergunta).length > 2 || !Array.isArray(historico)) return pergunta;
  for (let i = historico.length - 1; i >= 0; i--) {
    const h = historico[i];
    if (h && h.papel === 'usuario' && h.texto) return String(h.texto).slice(0, 300) + ' ' + pergunta;
  }
  return pergunta;
}

// Como a fonte aparece para a pessoa (e como o Worker a devolve). "tipo" só vai quando NÃO é norma
// (orientação técnica e material de apoio não obrigam, e o app precisa poder dizer isso).
function fonteDe(trecho) {
  const f = { documento: trecho.titulo || trecho.doc, norma: trecho.norma, ano: trecho.ano, referencia: trecho.referencia };
  if (trecho.tipo && trecho.tipo !== 'norma') f.tipo = trecho.tipo;
  return f;
}

// ---- shared/sugestoes.mjs ----
// Sugestões de continuação. O modelo termina a resposta com uma linha "SUGESTÕES: a | b | c".
// Isso vira botões no mascote e NUNCA aparece no texto. Funciona no navegador e no Worker (sem DOM).

// O rótulo só vale no começo de uma linha ('Sugestões:'); uma frase como 'a sugestão do CRAS' não conta.
const RE_SUG = /(?:^|\n)[ \t]*(?:\*\*)?sugest(?:õ|o)es(?:\*\*)?[ \t]*:(?:\*\*)?[ \t]*([\s\S]*)$/i;

function separarSugestoes(texto) {
  const t = String(texto == null ? '' : texto);
  const m = t.match(RE_SUG);
  if (!m) return { texto: t.trim(), sugestoes: [] };
  const vistos = new Set();
  const sugestoes = m[1].split(/\s*\|\s*|\n\s*(?:[-•*]|\d+[.)])\s*/)
    .map(function (x) { return x.replace(/^[\s\-•*"“]+|[\s"”]+$/g, '').trim(); })
    .filter(function (x) { return x.length >= 6 && x.length <= 70 && /[a-zà-ú]/i.test(x) && /[?a-zà-ú]$/i.test(x); })
    .filter(function (x) { const k = x.toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true; })
    .slice(0, 3);
  return { texto: t.slice(0, m.index).trim(), sugestoes: sugestoes };
}

// Durante o streaming: esconde o rótulo (inclusive parcial, "SUG", "**Suges") e tudo que vem depois.
function ocultarSugestoes(parcial) {
  const t = String(parcial == null ? '' : parcial);
  const m = RE_SUG.exec(t);
  if (m) return t.slice(0, m.index).replace(/\s+$/, '');
  const nl = t.lastIndexOf('\n');
  const ult = nl > -1 ? t.slice(nl + 1) : '';
  const alvo = ult.replace(/[*\s]/g, '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (alvo.length >= 3 && 'sugestoes:'.indexOf(alvo) === 0) return t.slice(0, nl).replace(/\s+$/, '');
  return t;
}

// ---------------------------------------------------------------- ações propostas pela IA
// Quando o app informa o que sabe abrir ou fazer, o modelo pode terminar a resposta com UMA linha
// "AÇÕES NO APP: id1 | id2". Isso vira botões (a pessoa decide tocar) e NUNCA aparece no texto.
// A IA só escolhe ids que o app mandou: o que não estiver na lista é descartado aqui.
// O rótulo é composto de propósito ("ações no app"): "Ações:" sozinho aparece em respostas normais.

const RE_ACOES = /(?:^|\n)[ \t]*(?:\*\*)?a(?:ç|c)(?:õ|o)es[ \t]+no[ \t]+app[ \t]*(?:\*\*)?[ \t]*:(?:\*\*)?[ \t]*([^\n]*)/i;
const RE_ID_ACAO = /^[a-z0-9_-]{1,40}$/i;
const MAX_ACOES_PROPOSTAS = 2;

function separarAcoes(texto, permitidas) {
  const t = String(texto == null ? '' : texto);
  const m = RE_ACOES.exec(t);
  if (!m) return { texto: t.trim(), acoes: [] };
  const validas = {};
  (Array.isArray(permitidas) ? permitidas : []).forEach(function (id) { validas[String(id).toLowerCase()] = String(id); });
  const vistos = {};
  const acoes = [];
  m[1].split(/\s*[|,;]\s*/).forEach(function (bruto) {
    const id = bruto.replace(/^[\s`*"'“”(\[]+|[\s`*"'“”.)\]]+$/g, '').toLowerCase();
    if (!RE_ID_ACAO.test(id) || !validas[id] || vistos[id]) return;
    vistos[id] = true;
    acoes.push(validas[id]);
  });
  // Tira só a linha da marcação; o resto do texto (inclusive as SUGESTÕES depois dela) fica.
  const semLinha = t.slice(0, m.index) + t.slice(m.index + m[0].length);
  return { texto: semLinha.replace(/\n{3,}/g, '\n\n').trim(), acoes: acoes.slice(0, MAX_ACOES_PROPOSTAS) };
}

// Durante o streaming: esconde o rótulo (inclusive parcial, "AÇ", "**Ações no a") e tudo que vem depois.
function ocultarAcoes(parcial) {
  const t = String(parcial == null ? '' : parcial);
  const m = RE_ACOES.exec(t);
  if (m) return t.slice(0, m.index).replace(/\s+$/, '');
  const nl = t.lastIndexOf('\n');
  const ult = nl > -1 ? t.slice(nl + 1) : t;
  const alvo = ult.replace(/[*\s]/g, '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (alvo.length >= 3 && 'acoesnoapp:'.indexOf(alvo) === 0) return (nl > -1 ? t.slice(0, nl) : '').replace(/\s+$/, '');
  return t;
}

// Os dois rótulos de uma vez (a ordem em que o modelo os escreve não importa).
function ocultarControles(parcial) { return ocultarAcoes(ocultarSugestoes(parcial)); }

function separarControles(texto, permitidas) {
  const a = separarAcoes(texto, permitidas);
  const s = separarSugestoes(a.texto);
  return { texto: s.texto, sugestoes: s.sugestoes, acoes: a.acoes };
}

// ---- client/skins.mjs ----
// "Peles" do Paulus: só texto e configuração. O desenho do mascote continua em cada app
// (argo-mascot.js, anona-mascot.js...). Para o Paulus, o mascote é o rosto; aqui ficam o nome,
// a saudação e as sugestões de cada app.
// Para incluir outro app: adicione uma entrada aqui E em worker/apps.mjs (mesmo identificador).

const SKINS = {
  argo: {
    app: 'argo',
    mascote: 'Argo',
    saudacao: 'Oi! Eu sou o Paulus, e aqui no Argo SUAS apareço como o Argo. Posso achar unidades, abrir telas e tirar dúvidas do SUAS.',
    sugestoes: ['telefone do CAPS AD III', 'quem gere o Cadastro Único no município?', 'abrir mapa']
  },
  anona: {
    app: 'anona',
    mascote: 'Anona',
    saudacao: 'Oi! Eu sou o Paulus, aqui como Anona. Posso explicar o app, abrir cartões e tirar dúvidas sobre condicionalidades. Não tenho acesso às suas notas nem às planilhas das famílias.',
    sugestoes: ['como funciona o acompanhamento de condicionalidades?', 'o que é a repercussão?', 'abrir calendário']
  },
  toth: {
    app: 'toth',
    mascote: 'Toth',
    saudacao: 'Oi! Eu sou o Paulus, aqui como Toth. Posso explicar o app, abrir filtros e tirar dúvidas do SUAS e da prática da psicologia. Não tenho acesso aos seus registros.',
    sugestoes: ['como estruturar o registro de um atendimento?', 'o que o CFP orienta sobre sigilo no registro?', 'abrir acompanhamento']
  },
  grafia: {
    app: 'grafia',
    mascote: 'Grafia',
    saudacao: 'Oi! Eu sou o Paulus, aqui como Grafia. Posso explicar o app, abrir uma nova nota e tirar dúvidas do SUAS e da escrita técnica. Não tenho acesso às suas notas.',
    sugestoes: ['como estruturar uma anotação profissional?', 'o que o CFP orienta sobre sigilo e guarda de registros?', 'nova nota']
  },
  umbrella: {
    app: 'umbrella',
    mascote: 'Umbrella',
    saudacao: 'Oi! Eu sou o Paulus, aqui como Umbrella. Posso ajudar a usar o app, abrir telas e tirar dúvidas do PAIF e do SUAS. Não tenho acesso aos dados das famílias.',
    sugestoes: ['qual a diferença entre atendimento e acompanhamento?', 'como construir o PAF junto com a família?', 'abrir prioridades']
  }
};

// ---- client/paulus.mjs ----
// Paulus: copiloto do navegador. SEM DOM: quem desenha o chat/mascote é cada app.
//
// Ordem de cada pergunta (tudo no aparelho, exceto o passo 7):
//   1. dado pessoal na pergunta  -> bloqueia, nada sai do aparelho
//   2. pedido de socorro         -> telefones de emergência na hora
//   3. "abrir ..."               -> ação registrada pelo app (pede confirmação se mexe em dados)
//   4. "buscar ..."              -> busca registrada pelo app, executada AQUI; o resultado NÃO vai para a IA
//      (passos 3 e 4 são pulados com { semAcoes: true }, para apps que já tratam isso antes)
//   5. normas (base offline)     -> trechos com citação
//   6. (reservado para provedores locais do app, ver docs/INTEGRACAO.md)
//   7. IA (Worker), em streaming, só com: pergunta filtrada, últimas mensagens e fichas PÚBLICAS
//   8. se a IA falhar ou estiver offline -> resposta da base de normas ou "não encontrei"
//
// Este arquivo é concatenado com shared/*.mjs por scripts/build.mjs (dist/paulus.v1.js).
// Por isso: imports em UMA linha, e nomes de função sem repetir entre os módulos.







const AVISO_PESSOAL = 'Para proteger as famílias, não consigo analisar mensagens com nome, documento, telefone ou endereço residencial. Reescreva a pergunta sem identificar ninguém.';

// Igual ao limite do Worker (worker/prompt.mjs). Antes eram 5 aqui, e o Argo mandava até 10 (lista de bairros, "liste todos").
const MAX_FICHAS = 10;
const MAX_ACOES_ENVIADAS = 20;

const PADRAO = {
  app: '',
  endpoint: '',            // endereço do Worker; vazio = IA desligada
  maxPergunta: 1200,
  maxHistorico: 6,         // mensagens (3 trocas) enviadas à IA
  porMinuto: 8,            // limite local (o Worker também limita)
  minIntervaloMs: 1200,
  primeiroByteMs: 20000,
  silencioMs: 15000
};

let cfg = Object.assign({}, PADRAO);
const estado = {
  base: [],
  indice: null,
  acoes: [],
  buscas: [],
  historico: [],
  envios: [],
  fichas: null,
  pronto: Promise.resolve()
};

// ------------------------------------------------------------------ configuração

function definirBase(lista) {
  estado.base = Array.isArray(lista) ? lista : [];
  estado.indice = criarIndice(estado.base);
}

function init(opcoes) {
  const o = opcoes || {};
  cfg = Object.assign({}, PADRAO, o);
  cfg.app = String(o.app || '').toLowerCase();
  cfg.endpoint = String(o.endpoint || '').replace(/\/+$/, '');
  estado.fichas = typeof o.fichas === 'function' ? o.fichas : null;
  estado.historico = [];
  estado.envios = [];
  if (Array.isArray(o.conhecimento)) {
    definirBase(o.conhecimento);
  } else if (o.conhecimentoUrl && typeof fetch === 'function') {
    estado.pronto = fetch(o.conhecimentoUrl, { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(definirBase)
      .catch(function () { definirBase([]); });
  }
  return Paulus;
}

// Ação de navegação. { id, rotulos:['mapa','mapa de unidades'], titulo?:'Mapa de unidades', descricao?, executar(), confirmar?:true }
// Além de "abrir ...", a IA pode PROPOR a ação como botão (r.acoes); quem toca é a pessoa.
// Ações que alteram ou apagam dados DEVEM ter confirmar:true.
function registrarAcao(a) {
  if (!a || !a.id || typeof a.executar !== 'function' || !Array.isArray(a.rotulos) || !a.rotulos.length) {
    throw new Error('Paulus.registrarAcao: use { id, rotulos:[...], executar() }');
  }
  estado.acoes = estado.acoes.filter(function (x) { return x.id !== a.id; });
  estado.acoes.push({ id: a.id, titulo: String(a.titulo || a.rotulos[0] || a.id), rotulos: a.rotulos.map(normalizar).filter(Boolean), descricao: a.descricao || '', executar: a.executar, confirmar: !!a.confirmar });
}

// Busca dentro do app. { id, rotulos:['unidade','equipamento'], buscar(consulta) -> [{titulo, detalhe?, abrir?()}] }
// Roda no aparelho; o que ela devolve nunca é enviado à IA.
function registrarBusca(b) {
  if (!b || !b.id || typeof b.buscar !== 'function') throw new Error('Paulus.registrarBusca: use { id, rotulos:[...], buscar(consulta) }');
  estado.buscas = estado.buscas.filter(function (x) { return x.id !== b.id; });
  estado.buscas.push({ id: b.id, rotulos: (b.rotulos || []).map(normalizar).filter(Boolean), buscar: b.buscar });
}

function limpar() { estado.historico = []; }
function skin(app) { return SKINS[String(app || cfg.app).toLowerCase()] || null; }
function iaLigada() {
  return !!cfg.endpoint && (typeof navigator === 'undefined' || navigator.onLine !== false);
}

// ------------------------------------------------------------------ ações e buscas

const REG_ACAO = /^(abrir|abra|ir para|ir pra|va para|va pra|me leve|leve me|mostrar|mostre|navegar)\b\s*(.*)$/;
const REG_BUSCA = /^(buscar|busque|procurar|procure|achar|ache|encontrar|encontre)\b\s*(.*)$/;

function acharPorRotulo(lista, alvo) {
  const texto = ' ' + alvo + ' ';
  let melhor = null, tam = 0;
  for (const item of lista) {
    for (const r of item.rotulos) {
      if (r.length > tam && texto.indexOf(' ' + r + ' ') !== -1) { melhor = item; tam = r.length; }
    }
  }
  return melhor;
}

function tratarAcao(resto) {
  const a = acharPorRotulo(estado.acoes, resto);
  if (!a) {
    return {
      tipo: 'acao_desconhecida',
      texto: 'Não encontrei essa tela ou função neste app.',
      opcoes: estado.acoes.map(function (x) { return x.rotulos[0]; })
    };
  }
  if (a.confirmar) {
    return { tipo: 'acao', acao: a.id, texto: 'Posso fazer isso, mas preciso da sua confirmação.', pedeConfirmacao: true, confirmar: a.executar };
  }
  a.executar();
  return { tipo: 'acao', acao: a.id, texto: 'Pronto.', executada: true };
}

async function tratarBusca(resto) {
  const escolhidas = [];
  const alvo = acharPorRotulo(estado.buscas, resto);
  if (alvo) escolhidas.push(alvo); else Array.prototype.push.apply(escolhidas, estado.buscas);
  if (!escolhidas.length) return { tipo: 'sem_resposta', texto: 'Este app ainda não tem buscas ligadas ao Paulus.' };
  const itens = [];
  for (const b of escolhidas) {
    try {
      const r = await Promise.resolve(b.buscar(resto));
      if (Array.isArray(r)) Array.prototype.push.apply(itens, r);
    } catch (e) { /* uma busca com problema não derruba as outras */ }
  }
  const lista = itens.slice(0, 20);
  return {
    tipo: 'busca',
    texto: lista.length ? 'Encontrei ' + lista.length + ' resultado(s) neste aparelho.' : 'Não encontrei nada para essa busca.',
    itens: lista
  };
}

// ------------------------------------------------------------------ IA

function estourouLimiteLocal() {
  const agora = Date.now();
  estado.envios = estado.envios.filter(function (t) { return agora - t < 60000; });
  if (estado.envios.length >= cfg.porMinuto) return 'Muitas perguntas seguidas. Aguarde um minuto.';
  const ultimo = estado.envios[estado.envios.length - 1] || 0;
  if (agora - ultimo < cfg.minIntervaloMs) return 'Calma, uma pergunta de cada vez.';
  estado.envios.push(agora);
  return '';
}

function historicoParaEnvio(externo) {
  const lista = Array.isArray(externo) ? externo : estado.historico;
  return lista.slice(-cfg.maxHistorico).map(function (h) {
    return { papel: h.papel, texto: String(h.texto).slice(0, 1200) };
  });
}

function fichasPublicas(texto, aba, externas) {
  if (Array.isArray(externas)) return externas.slice(0, MAX_FICHAS);
  if (!estado.fichas) return [];
  try {
    const r = estado.fichas(texto, aba);
    return Array.isArray(r) ? r.slice(0, MAX_FICHAS) : [];
  } catch (e) { return []; }
}

function telefonesConhecidos(fichas) {
  const set = {};
  for (const f of fichas) {
    const t = String((f && f.telefones) || '');
    (t.match(/\d[\d\s().-]{6,}\d/g) || []).forEach(function (n) { set[n.replace(/\D/g, '').slice(-8)] = 1; });
  }
  return set;
}

// Confere se a IA citou telefone que não veio das fichas. Devolve a lista dos desconhecidos.
function telefonesDesconhecidos(texto, fichas) {
  const conhecidos = telefonesConhecidos(fichas);
  const achados = String(texto).match(/\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/g) || [];
  return achados.filter(function (n) {
    if (/^(?:19|20)\d{2}[-\s]+(?:19|20)\d{2}$/.test(n.trim())) return false; // "2023-2026" é intervalo de anos
    return !conhecidos[n.replace(/\D/g, '').slice(-8)];
  });
}

// Ações que a IA pode PROPOR neste app: as registradas ou as passadas na chamada (opcoes.acoes, para apps com o próprio cérebro).
// Cada uma: { id, rotulo|titulo, descricao?, confirmar?, executar? }. Só id, nome e descrição vão ao Worker; nada executa sozinho.
function acoesDisponiveis(externas) {
  const lista = Array.isArray(externas) ? externas : estado.acoes;
  const saida = [];
  for (const a of lista) {
    if (!a || !RE_ID_ACAO.test(String(a.id || ''))) continue;
    const rotulo = String(a.rotulo || a.titulo || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!rotulo) continue;
    saida.push({ id: String(a.id), rotulo: rotulo, descricao: String(a.descricao || '').replace(/\s+/g, ' ').trim().slice(0, 100), confirmar: !!a.confirmar, executar: a.executar });
  }
  return saida.slice(0, MAX_ACOES_ENVIADAS);
}

function lerSSE(resp, ganchos, controle) {
  return new Promise(function (resolve, reject) {
    const leitor = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '', acumulado = '', fontes = [], recebeu = false, fim = false;
    function ler() {
      leitor.read().then(function (r) {
        controle.tique();
        if (r.done) { fim = true; }
        else buf += dec.decode(r.value, { stream: true });
        const linhas = buf.split('\n');
        buf = fim ? '' : linhas.pop();
        for (const l of linhas) {
          const t = l.trim();
          if (t.indexOf('data:') !== 0) continue;
          const corpo = t.slice(5).trim();
          if (!corpo || corpo === '[DONE]') continue;
          let ev;
          try { ev = JSON.parse(corpo); } catch (e) { continue; }
          if (ev.erro) { reject(new Error(String(ev.erro))); return; }
          if (Array.isArray(ev.fontes)) { fontes = ev.fontes; if (ganchos.onFontes) ganchos.onFontes(fontes); }
          if (typeof ev.t === 'string') {
            recebeu = true;
            acumulado += ev.t;
            // Os rótulos "AÇÕES NO APP:" e "SUGESTÕES:" (e o que vem depois) nunca chegam à tela.
            if (ganchos.onToken) ganchos.onToken(ev.t, ocultarControles(acumulado));
          }
        }
        if (fim) {
          if (!recebeu) reject(new Error('Resposta vazia.')); else resolve({ texto: acumulado, fontes: fontes });
        } else ler();
      }).catch(reject);
    }
    ler();
  });
}

async function pedirIA(texto, opcoes) {
  const bloqueio = estourouLimiteLocal();
  if (bloqueio) return { tipo: 'erro', texto: bloqueio };

  const fichas = fichasPublicas(texto, opcoes.aba, opcoes.fichas);
  const corpo = {
    app: cfg.app,
    pergunta: texto,
    pagina: String(opcoes.aba || '').slice(0, 80),
    historico: historicoParaEnvio(opcoes.historico),
    fichas: fichas,
    stream: true
  };
  // O que o app sabe abrir/fazer: a IA só pode propor ids desta lista.
  const acoes = acoesDisponiveis(opcoes.acoes);
  if (acoes.length) corpo.acoes = acoes.map(function (a) { return { id: a.id, rotulo: a.rotulo, descricao: a.descricao }; });
  // Visão geral do diretório (totais por grupo), montada pelo app. Só vai quando o app a manda.
  if (typeof opcoes.panorama === 'string' && opcoes.panorama.trim()) corpo.panorama = opcoes.panorama.trim().slice(0, 3000);

  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const armar = function (ms) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);
  };
  const controle = { tique: function () { armar(cfg.silencioMs); } };
  armar(cfg.primeiroByteMs);
  if (opcoes.sinal && ctrl) {
    if (opcoes.sinal.aborted) ctrl.abort();
    else opcoes.sinal.addEventListener('abort', function () { ctrl.abort(); });
  }

  try {
    const resp = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream, application/json' },
      body: JSON.stringify(corpo),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: ctrl ? ctrl.signal : undefined
    });
    if (!resp.ok) {
      // O Worker explica a falha em { erro } (limite por minuto, cota do dia...). Guarda o motivo para o app poder mostrá-lo.
      let motivo = '';
      try { const j = await resp.json(); motivo = j && j.erro ? String(j.erro).slice(0, 200) : ''; } catch (e) { /* corpo sem JSON */ }
      const falha = new Error('IA indisponível (' + resp.status + ').');
      falha.status = resp.status;
      falha.motivo = motivo;
      throw falha;
    }
    const tipo = String(resp.headers.get('Content-Type') || '');
    let saida;
    if (tipo.indexOf('event-stream') !== -1 && resp.body && resp.body.getReader) {
      saida = await lerSSE(resp, opcoes, controle);
    } else {
      const j = await resp.json();
      if (!j || typeof j.resposta !== 'string' || !j.resposta) throw new Error(j && j.erro ? String(j.erro) : 'Resposta vazia.');
      saida = { texto: j.resposta, fontes: Array.isArray(j.fontes) ? j.fontes : [] };
      if (opcoes.onToken) opcoes.onToken(saida.texto, ocultarControles(saida.texto));
    }
    const partes = separarControles(saida.texto, acoes.map(function (a) { return a.id; }));
    saida.texto = partes.texto || saida.texto;
    const propostas = partes.acoes.map(function (id) {
      const a = acoes.filter(function (x) { return x.id === id; })[0];
      return { id: a.id, rotulo: a.rotulo, confirmar: a.confirmar, executar: a.executar };
    });
    const avisos = ['Resposta gerada por IA. Confira antes de usar em atendimento.'];
    if (telefonesDesconhecidos(saida.texto, fichas).length) {
      avisos.push('A IA citou um telefone que não consta no diretório. Confirme com a unidade antes de passar adiante.');
    }
    return { tipo: 'ia', texto: saida.texto, fontes: saida.fontes, sugestoes: partes.sugestoes, acoes: propostas, avisos: avisos, geradoPorIA: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ resposta offline

// Corta no fim de uma frase para o trecho caber numa resposta (a fonte completa segue citada).
function resumirTrecho(texto, max) {
  const t = String(texto || '');
  if (t.length <= max) return t;
  const corte = t.slice(0, max);
  const fim = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('; '));
  return (fim > max * 0.5 ? corte.slice(0, fim + 1) : corte.replace(/\s+\S*$/, '')) + ' [...]';
}

function respostaDasNormas(achados) {
  const melhor = achados[0].trecho;
  return {
    tipo: 'norma',
    texto: resumirTrecho(melhor.texto, 900),
    fontes: achados.map(function (a) { return fonteDe(a.trecho); }),
    avisos: [melhor.tipo && melhor.tipo !== 'norma'
      ? 'Trecho de ' + (melhor.tipo === 'apoio' ? 'material de apoio' : 'orientação técnica') + ' (não é norma legal: orienta, não obriga). Confira o documento original.'
      : 'Trecho da base de normas do Paulus. Confira o texto oficial vigente.']
  };
}

// ------------------------------------------------------------------ pergunta

async function perguntar(texto, opcoes) {
  const o = opcoes || {};
  const t = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim().slice(0, cfg.maxPergunta);
  if (!t) return { tipo: 'erro', texto: 'Escreva uma pergunta.' };

  // Socorro vem ANTES do filtro: "Maria Souza quer se matar" precisa mostrar os telefones, não só pedir para reescrever.
  // (Nada sai do aparelho neste passo.)
  const crise = detectarCrise(t);
  if (crise) return crise;

  if (temDadoPessoal(t)) return { tipo: 'bloqueio', texto: AVISO_PESSOAL };

  if (!o.semAcoes) {
    const alvo = normalizar(t);
    let m = REG_ACAO.exec(alvo);
    if (m) return tratarAcao(m[2]);
    m = REG_BUSCA.exec(alvo);
    if (m) return tratarBusca(m[2]);
  }

  await estado.pronto;
  const achados = estado.indice ? buscar(estado.indice, consultaComContexto(t, Array.isArray(o.historico) ? o.historico : estado.historico), { k: K_PADRAO }) : [];

  let motivo = '';
  if (iaLigada()) {
    try {
      const r = await pedirIA(t, o);
      if (r.tipo === 'ia' && !Array.isArray(o.historico)) {
        estado.historico.push({ papel: 'usuario', texto: t }, { papel: 'paulus', texto: r.texto });
        estado.historico = estado.historico.slice(-cfg.maxHistorico * 2);
      }
      return r;
    } catch (e) {
      // Quem apertou "Parar" não quer resposta nenhuma (nem a da base offline).
      if (o.sinal && o.sinal.aborted) return { tipo: 'erro', texto: 'Interrompido.' };
      // Limite de perguntas: a norma offline não resolve e o motivo importa (é só esperar).
      if (e && e.status === 429) return { tipo: 'erro', texto: e.motivo || 'Muitas perguntas seguidas. Aguarde um minuto.', limite: true };
      motivo = (e && e.motivo) || '';
      /* senão, cai para a base offline */
    }
  }

  if (achados.length) return respostaDasNormas(achados);
  return {
    tipo: 'sem_resposta',
    texto: iaLigada()
      ? 'Não consegui responder agora e não encontrei isso na base de normas. Tente de novo em instantes.' + (motivo ? ' (' + motivo + ')' : '')
      : 'Sem internet ou sem IA ligada, e não encontrei isso na base de normas.',
    motivo: motivo
  };
}

// Consulta SÓ a base de normas, no aparelho: sem IA, sem rede, sem ação/busca do app.
// Para apps que têm o próprio fluxo e só querem a norma quando não há IA (ex.: Argo, offline).
// Devolve o mesmo formato de perguntar() com tipo 'norma', ou null se nada na base sustenta a pergunta.
// Dado pessoal na pergunta → null (a norma não depende de identificar ninguém).
// opcoes.historico: conversa do app ({papel:'usuario'|..., texto}); sem ela usa a do Paulus.
async function consultarNormas(texto, opcoes) {
  const o = opcoes || {};
  const t = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim().slice(0, cfg.maxPergunta);
  if (!t || temDadoPessoal(t)) return null;
  await estado.pronto;
  if (!estado.indice) return null;
  const hist = Array.isArray(o.historico) ? o.historico : estado.historico;
  const achados = buscar(estado.indice, consultaComContexto(t, hist), { k: K_PADRAO });
  return achados.length ? respostaDasNormas(achados) : null;
}

const Paulus = { init, perguntar, consultarNormas, registrarAcao, registrarBusca, limpar, skin, iaLigada, temDadoPessoal, detectarCrise, versao: '0.4.0' };

root.Paulus = Paulus;
if (typeof module === 'object' && module.exports) module.exports = Paulus;
})(typeof self !== 'undefined' ? self : this);

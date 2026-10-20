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
const NOME2 = '([' + CAP + '][' + MIN_L + ']+)(?:\\s+d[aeo]s?)?\\s+([' + CAP + '][' + MIN_L + ']+)';
const GATILHOS = '[Nn]ome|[Cc]hama|[Cc]hamada|[Cc]hamado|[Ss]obrenome|[Pp]aciente|[Uu]su[aá]ri[oa]|[Bb]enefici[aá]ri[oa]|[Aa]tendid[oa]|[Cc]rian[cç]a|[Aa]dolescente|[Mm]enin[oa]|[Ff]ilh[oa]|[Mm][aã]e|[Pp]ai|[Ii]dos[oa]|[Ff]am[ií]lia d[aoe]s?|[Aa]tendi|[Aa]tendemos|[Aa]tendeu|[Aa]companho|[Aa]companhamos|[Vv]isitei|[Vv]isitamos|[Cc]aso d[aoe]';

const RE_NOME = new RegExp(FORA + '(?:' + GATILHOS + ')(?![A-Za-zÀ-ÿ])[^.?!\\n]{0,25}?' + FORA + NOME2, 'g');
const RE_TRAT = new RegExp(FORA + '(?:[Dd]ona|[Dd]na|[Ss]r|[Ss]ra|[Ss]eu|[Ss]enhor|[Ss]enhora)\\.?\\s+[' + CAP + '][' + MIN_L + ']{2,}\\s+[' + CAP + '][' + MIN_L + ']{2,}');
const RE_ENDERECO = /\b(mora|moram|moradora?|reside|residente|endere[cç]o)\b[^.?!\n]{0,40}\b(rua|av\.?|avenida|travessa|tv\.?|quadra|lote)(?![A-Za-zÀ-ÿ])[^?!\n]{0,40}\b\d+/i;
// "RG 1234567", "CPF: 12345678", "NIS nº 123456": o número curto também é dado pessoal quando vem rotulado.
const RE_DOC_ROTULADO = /\b(?:rg|cpf|nis|nit|pis|cnh|cnpj|titulo(?:\s+de\s+eleitor)?|t[ií]tulo(?:\s+de\s+eleitor)?|cart[aã]o|matr[ií]cula|prontu[aá]rio|sus|cns|c[oó]digo\s+familiar)\b[^\d\n]{0,15}\d[\d.\-\/\s]{4,}\d/i;

// "João Pedro faltou", "Francisca de Oliveira recebe": nome de duas palavras seguido de verbo que só se diz de pessoa.
const RE_NOME_VERBO = new RegExp(FORA + NOME2 + '\\s+(?:recebe|recebeu|recebia|faltou|faltaram|mora|moram|morava|nasceu|chegou|procurou|compareceu|relatou|abandonou|desistiu|engravidou|internou)(?![A-Za-zÀ-ÿ])', 'g');
// "José, 45 anos", "Maria, 8 anos": nome único seguido da idade.
const RE_NOME_IDADE = new RegExp(FORA + '([' + CAP + '][' + MIN_L + ']{2,}),\\s*\\d{1,3}\\s+anos', 'g');
const NAO_NOME_IDADE = new Set('hoje ontem amanha depois antes agora entao assim ainda nesse nessa neste nesta ha'.split(' '));

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

function achouNomeVerbo(t) {
  RE_NOME_VERBO.lastIndex = 0;
  let m;
  while ((m = RE_NOME_VERBO.exec(t)) !== null) {
    if (!NAO_NOME.has(semAcentoMin(m[1])) && !NAO_NOME.has(semAcentoMin(m[2]))) return true;
    RE_NOME_VERBO.lastIndex = m.index + 1;
  }
  return false;
}

function achouNomeIdade(t) {
  RE_NOME_IDADE.lastIndex = 0;
  let m;
  while ((m = RE_NOME_IDADE.exec(t)) !== null) {
    const n = semAcentoMin(m[1]);
    if (!NAO_NOME.has(n) && !NAO_NOME_IDADE.has(n)) return true;
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
  if (achouNome(t) || achouNomeVerbo(t) || achouNomeIdade(t) || RE_TRAT.test(t)) return true;
  return RE_ENDERECO.test(t);
}

function limparMarcacao(texto) {
  // tira <tag> e </tag>, inclusive com atributos, para a pergunta não fechar/abrir blocos do prompt.
  // Repete até estabilizar: numa passada só, "<</normas>/normas>" viraria "</normas>" depois da limpeza.
  let atual = String(texto == null ? '' : texto);
  for (let i = 0; i < 20; i++) {
    const novo = atual.replace(/<\/?[A-Za-z][^<>]{0,40}>/g, '');
    if (novo === atual) break;
    atual = novo;
  }
  return atual.trim();
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
  'nao (?:vejo|tenho|tem|ve|ha) (?:mais )?(?:sentido em viver|sentido na vida|razao (?:pra|para) viver|motivo (?:pra|para) viver)',
  'quer(?:o|ia|endo)? (?:sumir|desaparecer) (?:de vez|para sempre|pra sempre|do mundo|deste mundo|dessa vida)',
  'quer(?:o|ia|endo)? (?:estar|ficar) morto|quer(?:o|ia|endo)? (?:estar|ficar) morta|quer(?:o|ia|endo)? nao ter nascido',
  'vontade de morrer|desejo de morrer|(?:seria|era|sera) melhor (?:se )?(?:eu |ela |ele )?(?:nao existisse|estivesse mort[oa]|sem mim)',
  '(?:dar|dando|por|pondo) fim (?:a |na |em )?(?:propria |minha |sua |a )?vida',
  '(?:me|se) (?:enforcar|enforcando|afogar|afogando|envenenar|envenenando)',
  '(?:me|se) jogar (?:da|do|de|embaixo|debaixo)',
  'pular (?:da|do|de) (?:ponte|predio|janela|viaduto|sacada|terraco|laje|cima)',
  // ideação indireta (ampliação do detector): cansaço de viver, desejo de não acordar, peso para os outros, despedida, meio já à mão
  'cansad[oa] de viver|cansei de viver',
  '(?:dormir|adormecer) (?:e )?(?:nunca|nao) mais acordar|dormir (?:pra|para) sempre|nao acordar mais',
  'nao quer(?:o|er|ia)? mais (?:estar aqui|existir|ficar aqui)',
  'ninguem (?:sentiria|sentira|ia sentir) (?:a )?(?:minha |sua )?falta',
  'melhor (?:pra|para) (?:todo mundo|todos|a familia|eles) (?:se (?:eu|ela|ele) (?:morresse|nao existisse|sumisse)|sem mim)',
  '(?:acabar|acabando) com (?:a )?(?:minha |sua )?dor de uma vez',
  '(?:por|pondo) fim (?:a )?(?:tudo|dor)',
  'so a morte (?:resolve|acaba|ajuda|me ajuda)',
  '(?:me|se) (?:atirar|lancar|jogar) (?:na|no) frente (?:de|do|da|dos|das)',
  '(?:carro|onibus|caminhao|trem) (?:me )?(?:atropelasse|pegasse)',
  '(?:me|se) dar (?:um )?tiro|tiro (?:na|em) (?:propria |minha |sua )?(?:cabeca|boca|peito)',
  '(?:usar|usarei|vou usar) (?:a arma|ela|isso|o veneno) em mim|(?:arma|revolver|pistola|veneno|chumbinho)[^.?!]{0,30}\\b(?:usar|usarei|vou usar|uso)\\b[^.?!]{0,10}\\bem mim',
  '(?:carta|bilhete) de despedida|me despedindo de todos|deixei (?:um )?bilhete',
  // autolesão relatada sem a palavra "automutilação"
  '(?:se|me) cortou(?! (?:com|na|no|ao|fazendo|cortando|durante|enquanto)\\b)|me cortei(?! (?:com|na|no|ao|fazendo|cortando|durante|enquanto)\\b)|se cortaram|(?:se|me) machuc(?:a|ando|ou|ava) de proposito|(?:se|me) fer(?:e|indo|iu|i) de proposito|(?:se|me) queim(?:a|ando|ou|ei) de proposito'
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
function perguntaGeral(t, ignorarAmeaca) {
  // "ameaça" é marca de caso para suicídio e abuso, mas aqui é o próprio tema ("o que fazer em caso de ameaça de morte?")
  const base = ignorarAmeaca ? t.replace(/ameac\w+/g, ' ') : t;
  return GERAL_ABERTURA.test(t.trim()) && GERAL_SINAL.test(t) && !CASO_OU_MOMENTO.test(base);
}

// ---- ampliação: ameaça, violência relatada na primeira pessoa, agressão que o(a) cuidador(a) teme cometer, abandono e emergências clínicas ----
// Alguém ameaça MATAR a pessoa que escreve ou outra pessoa. Antes ia para o cartão de suicídio (\"vai me matar\" casava com \"me matar\").
const OBJETO_PESSOA = '(?:o|a|os|as|meu|minha|meus|minhas|seu|sua|seus|suas|ela|ele|elas|eles|alguem|todos|todas|esposa|marido|mulher|filh\\w+|crianc\\w+|menin\\w+|net[oa]s?|mae|pai)';
const NAO_E_PESSOA = '(?!(?:a |o )?(?:fome|sede|saudade|aula|tempo|curiosidade|vontade|barata|mosquito|rato|ratos|formiga|insetos?|servico|trabalho|charada|duvida|duvidas|pendencia|pendencias|demanda|demandas|fila|filas|vaga|vagas|processo|processos|ligacao|ligacoes|ansiedade|dor)\\b)';
const AMEACA_MATAR_ME = /\b(?:vai|vao|quer|querem|prometeu|jurou|ameaca|ameacou|ameacando|ameacam|tentou|tentaram|tenta) (?:de |em )?me (?:matar|esfaquear|espancar|estrangular)\b/;
const AMEACA_TERCEIRO = new RegExp('\\b(?:(?:ameac(?:a|ou|ando|am|aram)|prometeu|jurou|disse que (?:vai|vao|quer)|(?:vai|vao|quer|querem|ia|queria)) (?:de )?matar ' + NAO_E_PESSOA + OBJETO_PESSOA + '\\b|ameac(?:a|ou|ando|am|aram)s? (?:de )?morte|ameac(?:a|as) de morte|medo de (?:ser )?(?:morta|morto|assassinad[oa]|agredid[oa]|espancad[oa])|medo (?:pela|por) (?:minha|a minha) vida|temo pela minha vida)');
// Quem diz que VAI machucar alguém (raiva, esgotamento de cuidador): outra conduta, outro texto.
const INTENCAO_AGREDIR = new RegExp('\\b(?:(?:vou|quero|vontade de|estou com vontade de|tenho vontade de|ia|penso em|pensando em) (?:matar|machucar|espancar|esfaquear) ' + NAO_E_PESSOA + '(?:o|a|os|as|n[oa]s?|meu|minha|meus|minhas|alguem|ela|ele|elas|eles|crianc\\w+|filh\\w+|menin\\w+|marido|esposa|mulher|bebe)\\b|(?:vou|quero|vontade de|estou com vontade de|tenho vontade de|ia|penso em|pensando em) (?:bater|surrar) (?:n[oa]s?|em) ?(?:meu|minha|meus|minhas|o|a|os|as)? ?(?:filh\\w+|crianc\\w+|bebe|menin\\w+|marido|esposa|mulher|alguem|ela|ele)\\b|(?:estou|to|ando) (?:perdendo|sem) (?:o )?controle (?:com|d[eao]s?) (?:meu|minha|meus|minhas|a|o|os|as)? ?(?:filh\\w+|crianc\\w+|bebe|menin\\w+|marido|esposa)|nao (?:consigo|aguento) me controlar (?:com|d[eao]s?) (?:meu|minha|meus|minhas|a|o|os|as)? ?(?:filh\\w+|crianc\\w+|bebe|menin\\w+)|(?:bati|espanquei|machuquei|agredi) (?:n[oa]s?|em|o|a|os|as) ?(?:meu|minha|meus|minhas)? ?(?:filh\\w+|crianc\\w+|bebe|menin\\w+|esposa|marido|mulher))');
// Violência sofrida, dita por quem sofre, ou de um adulto contra criança/adolescente sem a palavra \"abuso\".
const VIOLENCIA_SOFRIDA = /\b(?:(?:me|nos) (?:bate|bateu|batem|espanca|espancou|agride|agrediu|estrangula|estrangulou|sufoca|sufocou|ameaca de morte)|(?:fui|foi|foram|fomos) (?:agredid|espancad|estuprad|abusad|violentad|molestad|ameacad)\w*|(?:padrasto|madrasta|pai|mae|tio|tia|avo|avos|primo|irmao|padrinho|vizinho|professor|pastor|patrao|marido|namorado|companheiro|ex) (?:me|nela|nele) (?:toca|tocou|forca|forcou)\b|(?:padrasto|madrasta|pai|mae|tio|tia|avo|avos|primo|irmao|padrinho|vizinho|professor|pastor|patrao|marido|namorado|companheiro|ex) (?:mexe|mexeu) comigo\b|(?:ele|ela) mexe com (?:a |o )?(?:sobrinh|filh|entead|net|menin|crianc)\w*|mexe com (?:a |o )?(?:sobrinh|filh|entead|net|menin|crianc)\w*|(?:abus|estupr|molest|violent)(?:ando|a|am) (?:a |o |as |os |da |do |das |dos |de )?(?:crianc\w*|menin\w*|filh\w*|sobrinh\w*|entead\w*|net[ao]s?|adolescent\w*|irma\w*|prim[ao]s?|mulher)\b|(?:sofrendo|sofre|sofreu|sofri) (?:abuso|violencia|maus tratos|agressao|agressoes)\b|(?:trancad[oa]|presa|preso) (?:em casa|no quarto|no comodo)|carcere privado|nao (?:deixa|deixou|deixam) (?:ela|ele|eu|a mulher|a menina|o menino) sair de casa)\b/;
// Criança, adolescente ou pessoa idosa em abandono, cárcere ou sem comida.
const ABANDONO = /\b(?:crianca|bebe|idos[oa]|menin[oa]|adolescent\w*)s?\b[^.?!]{0,40}?\b(?:abandonad[oa]s?|trancad[oa]s?|amarrad[oa]s?|acorrentad[oa]s?|sem (?:comer|comida) (?:ha|desde|por) (?:\w+ )?(?:dias|horas))\b/;
// Ferimento grave e emergência de saúde sem as palavras \"overdose\" ou \"desmaiou\".
// Ferimento por arma: saúde E polícia.
const FERIMENTO_ARMA = /\b(?:levou (?:um |dois |varios )?(?:tiros?|facadas?)|(?:foi|foram|esta|estao|ficou) (?:\w+ )?(?:balead|esfaquead)[oa]s?|balead[oa]|esfaquead[oa]|facada|tiroteio)\b/;
const CLINICA_AMPLA = /\b(?:(?:bebe|crianca|ele|ela|idos[oa]|ninguem|pessoa)?\s?nao (?:esta )?respira(?:ndo)?|sem respirar|parou de respirar|(?:esta|estava|ficou) (?:\w+ )?desmaiad[oa]|nao (?:acorda|acordou|desperta)(?! (?:cedo|de manha|para|pra|a tempo|no horario|sozinh\w*|facil|mais cedo))|nao (?:reage|reagiu|responde) (?:a nada|ao chamado|aos estimulos|quando chamo|quando chamamos)|sangrando (?:muito|bastante|sem parar)|sangramento (?:forte|intenso|que nao para)|hemorragia|(?:teve|esta tendo|estao tendo|sofreu) (?:um |uma )?(?:avc|derrame|infarto|ataque cardiaco|convulsao|parada cardiaca)|infartou|infartando|engasg(?:ou|ando|ada|ado)|afogou|afogando|afogad[oa]|(?:casa|barraco|quarto) (?:pegou|pegando) fogo|pegou fogo na (?:casa|barraco)|(?:foi|ficou|esta) (?:mordid|picad)[oa] (?:de|por|pela|pelo) (?:uma? )?(?:cobra|escorpiao)|levou choque eletrico)\b/;

const PADROES = [
  {
    // alguém ameaça matar quem escreve ("ele vai me matar"): proteção, não cartão de suicídio
    tipo: 'violencia',
    titulo: 'Ameaça de morte: proteja a pessoa e acione ajuda agora',
    re: AMEACA_MATAR_ME,
    geral: true,
    texto: 'AMEACA',
    numeros: ['190', '180', '100']
  },
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
    re: /\b((?:esta|estao|estou|estamos) (?:sendo )?(?:agredid|espancad|ameacad|estuprad|abusad|violentad|molestad)\w*|sendo (?:agredid|espancad|ameacad|estuprad|abusad|violentad|molestad)\w*|violencia (?:em curso|agora|em andamento)|abuso (?:em andamento|acontecendo agora))\b/,
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
  },
  {
    // ampliação: ameaça de morte a terceiros e violência relatada por quem sofre
    tipo: 'violencia',
    titulo: 'Ameaça de morte: proteja a pessoa e acione ajuda agora',
    re: AMEACA_TERCEIRO,
    geral: true,
    texto: 'AMEACA',
    numeros: ['190', '180', '100']
  },
  {
    tipo: 'violencia',
    titulo: 'Relato de violência: proteja a pessoa e acione a rede',
    re: VIOLENCIA_SOFRIDA,
    geral: true,
    texto: 'RELATO',
    numeros: ['190', '180', '100']
  },
  {
    tipo: 'violencia',
    titulo: 'Criança, adolescente ou pessoa idosa em risco: acione a rede agora',
    re: ABANDONO,
    geral: true,
    texto: 'RELATO',
    numeros: ['190', '100']
  },
  {
    // quem teme machucar alguém (cuidador esgotado, raiva): afastar, pedir apoio e proteger quem está perto
    tipo: 'agressao',
    titulo: 'Antes de machucar alguém: pare e peça apoio agora',
    re: INTENCAO_AGREDIR,
    texto: 'AGRESSAO',
    numeros: ['188', '190']
  },
  {
    tipo: 'clinica',
    titulo: 'Emergência de saúde: acione ajuda agora',
    re: CLINICA_AMPLA,
    geral: true,
    numeros: ['192', '193']
  },
  {
    tipo: 'clinica',
    titulo: 'Ferimento grave: acione ajuda agora',
    re: FERIMENTO_ARMA,
    geral: true,
    numeros: ['192', '190']
  }
];

const TEXTO_PADRAO = 'Se há risco de vida agora, ligue primeiro para um destes números. Depois, acione o serviço de referência do território e a coordenação. Se a sua dúvida for sobre o fluxo de atendimento, reformule a pergunta e eu ajudo.';

// Para quem escreve sobre si mesmo: acolhe, sem validar o desejo de morrer, e aponta o CVV e o SAMU.
const TEXTO_PESSOAL = 'Sinto muito que você esteja passando por isso. Você não precisa enfrentar essa dor sozinho(a). Ligue agora para o CVV, 188 (gratuito, 24 horas), ou, se estiver em perigo neste momento, para o SAMU, 192. Se puder, fique perto de alguém de confiança e peça que alguém fique com você. Se você é profissional e escreveu sobre um caso, reformule em terceira pessoa, sem identificar a pessoa.';

// Para o profissional diante de um caso: só os cuidados imediatos da cartilha ABP/CFM (2014). Não lista meios nem classifica o risco.
const TEXTO_TERCEIRO = 'Se há risco imediato, não deixe a pessoa sozinha: fique com ela, converse com calma e sem julgamento, e ligue para o SAMU (192). Se o perigo for imediato, peça uma ambulância, em vez de levá-la por conta própria. Lembre que perguntar não aumenta o risco e costuma trazer alívio (cartilha ABP/CFM, 2014). Depois, acione o serviço de referência (UBS ou CAPS) e a coordenação. Eu não classifico o risco de uma pessoa específica: isso é avaliação da equipe. Se a sua dúvida for geral (como avaliar, abordar ou encaminhar), pergunte sem relatar um caso e eu respondo com a cartilha.';

// Relato de violência (ela apanha, a criança contou de um abuso): protege primeiro, depois a rede. Não classifica o caso nem fala em sigilo.
const TEXTO_RELATO = 'Se a pessoa corre risco agora, ligue 190. Violência contra a mulher: 180. Contra criança, adolescente ou pessoa idosa: Disque 100. A suspeita de violência contra criança ou adolescente deve ser comunicada ao Conselho Tutelar. Depois, acione o CREAS ou o serviço de referência e a coordenação, e registre o que foi relatado sem pedir que a pessoa conte tudo de novo. Se a sua dúvida for sobre o fluxo, reformule sem relatar um caso e eu ajudo.';

// Ameaça de morte (a quem escreve ou a outra pessoa): protege primeiro, não confronta quem ameaça.
const TEXTO_AMEACA = 'Ameaça de morte é risco real e deve ser levada a sério. Se a pessoa ameaçada corre perigo agora, ligue 190. Violência contra a mulher: 180. Contra criança, adolescente ou pessoa idosa: Disque 100 e Conselho Tutelar, quando for criança ou adolescente. Não confronte quem ameaça e não deixe a pessoa ameaçada sozinha, se for possível. Depois, acione o CREAS ou o serviço de referência e a coordenação. Se a sua dúvida for sobre o fluxo, reformule sem relatar um caso e eu ajudo.';

// Quem diz que vai machucar alguém: acolhe sem julgar, pede para se afastar e protege quem está perto. Não dá sermão.
const TEXTO_AGRESSAO = 'Pare um instante: o mais importante agora é que ninguém se machuque. Se puder, afaste-se da situação (outro cômodo, a rua, um vizinho) e, se houver criança por perto, peça para outro adulto ficar com ela. Respire fundo e converse com alguém agora: CVV, 188 (gratuito, 24 horas). Se alguém estiver em perigo neste momento, ligue 190. Passada a crise, procure o CRAS, o CREAS ou a UBS: sentir esse limite é sinal de que você precisa de apoio, e a rede existe para isso. Se você é profissional e escreveu sobre um caso, reformule em terceira pessoa, sem identificar ninguém.';

// Quem fala de si, além de PRIMEIRA_PESSOA. Fica de fora se a frase relata o que outra pessoa disse ("ela falou que queria sumir").
const PRIMEIRA_PESSOA_EXTRA = /\b(?:minha vida nao tem (?:mais )?sentido|nao (?:aguento|suporto|consigo) mais (?:viver|essa vida|esta vida)|nao (?:vejo|tenho) (?:mais )?(?:sentido em viver|sentido na vida|razao (?:pra|para) viver|motivo (?:pra|para) viver)|quer(?:o|ia) (?:sumir|desaparecer)|(?:vou|quero|pensando em|penso em|ia) me (?:jogar|enforcar|afogar|envenenar)|vou pular|queria estar morto|queria estar morta|queria nao ter nascido|(?:vou|quero) dar fim a minha vida|(?:cansei|estou cansad[oa]|to cansad[oa]) de viver|nao quero mais (?:estar aqui|existir)|ninguem sentiria (?:a )?minha falta|melhor (?:pra|para) (?:todo mundo|todos) se eu (?:morresse|nao existisse)|(?:acabar|acabando) com (?:a )?minha dor de uma vez|(?:vou|quero) (?:por|pondo) fim a tudo|so a morte (?:me )?(?:resolve|ajuda)|(?:queria|quero) dormir (?:e nunca mais acordar|pra sempre|para sempre)|(?:vou|quero) me (?:atirar|lancar) na frente|me dar (?:um )?tiro|(?:vou|quero) usar (?:a arma|ela|isso) em mim|me atropelasse|usar [^.?!]{0,12}em mim|(?:queria|quero) [^.?!]{0,25}dormir (?:pra|para) sempre|(?:carta|bilhete) de despedida|me cortei(?! (?:com|na|no|ao|fazendo|cortando|durante|enquanto)\\b)|(?:me) (?:machuco|machucando|firo|ferindo) de proposito)\b/;
const RELATA_TERCEIRO = /\b(?:disse|disseram|falou|falaram|contou|relatou|verbalizou|mencionou)\b/;

// Devolve null se não for pedido de socorro.
function detectarCrise(texto) {
  // "Pronto Socorro" é um serviço de saúde, não um pedido de socorro ("qual o endereço do pronto-socorro?")
  const t = semAcento(texto).replace(/pronto[ -]+socorro/g, 'pronto atendimento');
  for (const p of PADROES) {
    if (!p.re.test(t) && !(p.extra && p.extra.test(t))) continue;
    if (p.geral && perguntaGeral(t, p.texto === 'AMEACA')) continue;
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
      texto: p.texto === 'RELATO' ? TEXTO_RELATO : p.texto === 'AMEACA' ? TEXTO_AMEACA : p.texto === 'AGRESSAO' ? TEXTO_AGRESSAO : TEXTO_PADRAO,
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

function fatorPreferido(preferir, doc) {
  const f = preferir && preferir[doc];
  return typeof f === 'number' && f > 1 ? Math.min(f, 1.3) : 1;
}

// Devolve [{ trecho, score, cobertura }] do melhor para o pior.
// cobertura = fração dos termos da pergunta que aparecem no trecho (filtra resultados "de sorte").
// preferir (opcional): { [doc]: fator } leve favorecimento dos documentos que a pessoa mais consulta (memória do Paulus).
// Só desempata a ORDEM entre trechos que já passaram nos cortes; nunca traz resultado que a busca não traria. Fator limitado a 1,3.
function buscar(indice, consulta, { k = 3, minScore = 1.2, minCobertura = 0.5, preferir = null } = {}) {
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
    if (score >= minScore && cobertura >= minCobertura) res.push({ trecho: d.c, score, cobertura, ordem: score * (PESO_TIPO[d.c.tipo || 'norma'] || 1) * fatorPreferido(preferir, d.c.doc) });
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

// ---- shared/pedido.mjs ----
// Leitura do PEDIDO: que tipo de mensagem é esta e, por isso, como o Paulus deve se comportar.
// Roda no navegador (para a busca offline e o histórico) e no Worker (para o prompt e os parâmetros da IA).
// Tudo aqui é regra simples e testável, sem chamar IA: não custa cota e não erra "de vez em quando".
//
// Modos:
//   saudacao     só cumprimento/agradecimento ("oi", "obrigado")   -> resposta curta, prompt mínimo, sem buscar norma
//   refinamento  ajuste da última resposta ("mais curto", "mais formal", "outro jeito") -> reescreve a resposta anterior
//   seguimento   pergunta que depende da anterior ("e para adolescente?", "e nesse caso?") -> busca com o assunto anterior
//   consulta     dado do diretório (telefone, endereço, horário, quantos) -> temperatura baixa, sem criatividade
//   normal       o resto



// ------------------------------------------------------------------ saudação

const PALAVRAS_SAUDACAO = new Set(('oi ola oie opa salve eai e ai bom boa dia tarde noite tudo bem beleza blz certo ok okay entendi entendido ' +
  'obrigado obrigada obg obrigadao valeu vlw show perfeito otimo legal combinado fechado tchau ate logo mais amanha ' +
  'por favor muito vc voce paulus argo anona toth grafia umbrella').split(' '));

// Só cumprimento puro: TODAS as palavras são de saudação. "oi, o que é CRAS?" não é saudação.
function ehSaudacao(texto) {
  const palavras = normalizar(texto).split(' ').filter(Boolean);
  if (!palavras.length || palavras.length > 7) return false;
  return palavras.every(function (p) { return PALAVRAS_SAUDACAO.has(p); });
}

// ------------------------------------------------------------------ refinamento

// Pedido de ajuste do que acabou de ser respondido. Só vale com resposta anterior e com mensagem curta;
// "reescreva o ofício para o CAPS com ..." (longa) é tarefa nova. Duas formas:
//   1) verbo de ajuste no começo: "deixe mais formal", "resuma", "inclua o horário", "explique melhor";
//   2) frase curta de ajuste, sozinha: "mais curto", "de outro jeito", "em tópicos", "com exemplo".
// "Explique o PAIF" e "resumo da LOAS" NÃO entram: são perguntas novas.
const VERBO_AJUSTE = /^(?:por favor )?(?:deixe|deixa|torne|reescreva|reescreve|refaca|refaz|resuma|resume|encurte|encurta|amplie|amplia|detalhe|simplifique|simplifica|melhore|melhora|ajuste|ajusta|adapte|adapta|transforme|transforma|converta|corrija|corrige|troque|troca|tire|tira|remova|retire|acrescente|inclua|adicione|organize|formate|traduza|explique melhor|explica melhor|explique de novo|explique de outro|explica de outro|escreva de outro|escreve de outro|diga de outro|fale de outro|me explique de outro|me explica de outro|de uma versao|faca uma versao|faca de outro|faz de outro)\b/;
const FRASE_AJUSTE = /^(?:(?:bem |um pouco |muito )?(?:mais|menos) (?:curto|curta|longo|longa|formal|simples|direto|direta|tecnico|tecnica|detalhado|detalhada|objetivo|objetiva|resumido|resumida|claro|clara|humano|humana|acolhedor|acolhedora|informal|pratico|pratica)|(?:de|em|numa|num) (?:outro jeito|outra forma|topicos|lista|passos|tres linhas|uma frase|um paragrafo|poucas linhas)|(?:com|um|me de um|me da um) exemplos?|outro jeito|outra forma|versao (?:curta|resumida|formal|simples)|resuma|resumir|encurte|simplifique|detalhe mais|explique melhor)$/;

// A mensagem, sozinha, tem cara de pedido de ajuste?
function pareceAjuste(texto) {
  const n = normalizar(texto);
  if (!n || n.split(' ').length > 12) return false;
  return FRASE_AJUSTE.test(n) || VERBO_AJUSTE.test(n);
}

function ehRefinamento(texto, historico) {
  return temRespostaAnterior(historico) && pareceAjuste(texto);
}

function ehResposta(h) {
  return !!h && (h.papel === 'paulus' || h.papel === 'argo' || h.papel === 'assistente') && !!h.texto;
}

function temRespostaAnterior(historico) {
  return Array.isArray(historico) && historico.some(ehResposta);
}

// ------------------------------------------------------------------ seguimento

// Palavras que só fazem sentido com a conversa por trás.
const ANAFORA = new Set('isso esse essa esses essas nisso nesse nessa nesses nessas disso desse dessa deles delas ele ela eles elas la ali tambem mesmo mesma anterior acima citado citada'.split(' '));

// Pergunta curta que cita um termo próprio do SUAS (CRAS, BPC, PAIF...) se sustenta sozinha: "como funciona o BPC?"
// não é seguimento, mesmo curta. Já "e o horário?" e "e para adolescente?" dependem da conversa.
function ehSeguimento(texto) {
  const n = normalizar(texto);
  if (!n) return false;
  const palavras = n.split(' ');
  if (palavras.some(function (p) { return SIGLAS[p]; })) {
    // com sigla, só é seguimento se deixar isso explícito ("e para o BPC?", "isso vale para o PAIF?")
    return /^(e|mas|entao|ou|agora|e se|e quanto|e quando|e como|e onde|e quem|e para|e pra)\b/.test(n) || palavras.some(function (p) { return ANAFORA.has(p); });
  }
  if (tokenizar(texto).length <= 3) return true;
  if (/^(e|mas|entao|ou|agora|nesse caso|e se|e quanto|e quando|e como|e onde|e quem|e para|e pra)\b/.test(n)) return true;
  return palavras.some(function (p) { return ANAFORA.has(p); }) && palavras.length <= 10;
}

// Texto usado na BUSCA de normas. Pergunta que depende da anterior herda o assunto dela; pedido de ajuste
// ("mais curto") não busca por si mesmo (as palavras dele só trariam trecho ao acaso), usa só o assunto anterior.
function consultaDoPedido(pergunta, historico, modo) {
  if (modo !== 'refinamento' && modo !== 'seguimento') return pergunta;
  const lista = Array.isArray(historico) ? historico : [];
  // Anda para trás pelas mensagens do(a) profissional até achar a pergunta que carrega o assunto: pula "oi" e "mais curto",
  // e junta os seguimentos em cadeia ("e para adolescente?" depois "e para idoso?" continuam no assunto da primeira).
  const partes = [];
  for (let i = lista.length - 1; i >= 0 && partes.length < 3; i--) {
    const h = lista[i];
    if (!h || h.papel !== 'usuario' || !h.texto) continue;
    const texto = String(h.texto).slice(0, 300);
    if (ehSaudacao(texto) || pareceAjuste(texto)) continue;
    partes.unshift(texto);
    if (!ehSeguimento(texto)) break;
  }
  if (!partes.length) return pergunta;
  return modo === 'refinamento' ? partes.join(' ') : partes.join(' ') + ' ' + pergunta;
}

// ------------------------------------------------------------------ classificação

const RE_CONSULTA = /\b(telefone|fone|contato|endereco|onde fica|horario|quantos|quantas|qual (?:cras|creas|ubs|caps|conselho|delegacia|centro pop)|que cras|que creas|bairro)\b/;

// Devolve 'saudacao' | 'refinamento' | 'seguimento' | 'consulta' | 'normal'.
function classificarPedido(pergunta, historico, { temFichas = false, temPanorama = false } = {}) {
  if (ehSaudacao(pergunta)) return 'saudacao';
  if (ehRefinamento(pergunta, historico)) return 'refinamento';
  if (ehSeguimento(pergunta) && Array.isArray(historico) && historico.some(function (h) { return h && h.papel === 'usuario'; })) return 'seguimento';
  if ((temFichas || temPanorama) && RE_CONSULTA.test(normalizar(pergunta))) return 'consulta';
  return 'normal';
}

// Quantos trechos de norma vão para a IA. Cumprimento não precisa de nenhum; pedido de ajuste só precisa do que a
// resposta anterior já usava; pergunta rica (várias ideias) merece um trecho a mais.
function trechosParaOPedido(modo, pergunta, padrao) {
  if (modo === 'saudacao') return 0;
  if (modo === 'refinamento') return Math.min(3, padrao);
  if (modo === 'consulta') return padrao;
  return tokenizar(pergunta).length >= 6 ? padrao + 1 : padrao;
}

// Parâmetros da IA por situação. Os valores "normais" são os de sempre (900 tokens, temperatura 0,4),
// para a resposta de rotina não mudar; o que muda é o que precisa mudar.
//   pref.tamanho === 'curto' (memória do aparelho) continua mandando no teto de respostas comuns.
function perfilDaIA({ modo, tema = false, comTextoPronto = false, pref = null }) {
  if (modo === 'saudacao') return { max_tokens: 160, temperature: 0.5 };
  if (tema) return { max_tokens: 900, temperature: 0.4 };
  if (comTextoPronto) return { max_tokens: 1400, temperature: 0.5 };
  if (modo === 'refinamento') return { max_tokens: pref && pref.tamanho === 'curto' ? 700 : 1200, temperature: 0.45 };
  if (pref && pref.tamanho === 'curto') return { max_tokens: 500, temperature: modo === 'consulta' ? 0.2 : 0.4 };
  if (modo === 'consulta') return { max_tokens: 900, temperature: 0.2 };
  return { max_tokens: 900, temperature: 0.4 };
}

// ---- shared/verificacao.mjs ----
// Conferência das citações da IA. O prompt já proíbe citar artigo ou lei que não esteja em <normas>, mas modelo erra.
// Aqui a regra é conferida por código: o Worker diz quais artigos e leis estavam nos trechos que a IA LEU (numerosCitaveis),
// e o navegador compara com o que a resposta citou (citacoesSemFonte). Citação fora da lista vira AVISO para a pessoa conferir;
// o texto da resposta não é alterado. Funciona no Worker e no navegador.

// "art. 17", "Art. 5º", "artigo 20", "arts. 17 e 18", "arts. 17, 18 e 19", "arts. 17 a 19"
const RE_ARTIGO = /\bart(?:igos?|s?\.)?\s*(\d{1,4})((?:\s*(?:,|e|a|ao)\s*\d{1,4})*)/gi;
// "Lei 8.742", "Lei nº 8.742/1993", "Decreto 7.053", "Resolução CFP nº 06/2019", "Resolução nº 109"
const RE_LEI = /\b([Ll]ei|LEI|[Dd]ecreto|[Rr]esolu[cç][aã]o|[Pp]ortaria|[Ii]nstru[cç][aã]o [Nn]ormativa)(?:\s+(?:[Ff]ederal|[Cc]omplementar|[Mm]unicipal|[Ee]stadual|[Cc]onjunta))?(?:\s+[A-Z]{2,8})?\s*(?:[Nn][ºo°.]{0,2}\s*)?(\d[\d.]{0,8})/g;

function semZeros(n) { return String(n).replace(/\./g, '').replace(/^0+(?=\d)/, ''); }

// Números de artigo citados no texto (conjunto de strings).
function artigosCitados(texto) {
  const achou = new Set();
  const t = String(texto == null ? '' : texto);
  let m;
  RE_ARTIGO.lastIndex = 0;
  while ((m = RE_ARTIGO.exec(t)) !== null) {
    achou.add(semZeros(m[1]));
    (m[2].match(/\d{1,4}/g) || []).forEach(function (n) { achou.add(semZeros(n)); });
  }
  return achou;
}

// Leis, decretos e resoluções citados: { chave: 'lei 8742', rotulo: 'Lei 8.742' }
function leisCitadas(texto) {
  const achou = new Map();
  const t = String(texto == null ? '' : texto);
  let m;
  RE_LEI.lastIndex = 0;
  while ((m = RE_LEI.exec(t)) !== null) {
    const numero = semZeros(m[2].replace(/\.+$/, ''));
    if (!numero) continue;
    const tipo = m[1].toLowerCase().replace('ç', 'c').replace('ã', 'a');
    achou.set(tipo + ' ' + numero, m[1] + ' ' + m[2].replace(/\.+$/, ''));
  }
  return achou;
}

// Do lado do Worker: o que a IA tinha diante de si. { a: ['17','20'], l: ['lei 8742'] }
// Olha o texto inteiro de cada trecho (referência, título, norma e texto), porque é isso que a IA leu.
function numerosCitaveis(achados) {
  const a = new Set(), l = new Set();
  for (const x of Array.isArray(achados) ? achados : []) {
    const t = x && x.trecho;
    if (!t) continue;
    const tudo = [t.referencia, t.titulo, t.norma, t.texto].join(' \n ');
    artigosCitados(tudo).forEach(function (n) { a.add(n); });
    // número solto na referência ("art. 20, § 3º") também vale: parágrafo e inciso não são tratados como artigo novo
    (String(t.referencia || '').match(/\d{1,4}/g) || []).forEach(function (n) { a.add(semZeros(n)); });
    leisCitadas(tudo).forEach(function (_, k) { l.add(k); });
  }
  return { a: Array.from(a).sort(), l: Array.from(l).sort() };
}

// Do lado do navegador. citaveis = { a, l } vindo do Worker; sem ele (Worker antigo), usa só as fontes que vieram.
// extras: textos que a IA já tinha visto na conversa (respostas anteriores), cujas citações já foram vistas pela pessoa.
// Devolve a lista de citações sem fonte, já escrita para mostrar: ['art. 99', 'Lei 12.345'].
function citacoesSemFonte(texto, citaveis, fontes, extras) {
  const arts = new Set(), leis = new Set();
  if (citaveis && Array.isArray(citaveis.a)) citaveis.a.forEach(function (n) { arts.add(String(n)); });
  if (citaveis && Array.isArray(citaveis.l)) citaveis.l.forEach(function (n) { leis.add(String(n)); });
  if (!citaveis) {
    (Array.isArray(fontes) ? fontes : []).forEach(function (f) {
      const tudo = [f && f.referencia, f && f.documento, f && f.norma].join(' \n ');
      artigosCitados(tudo).forEach(function (n) { arts.add(n); });
      (String((f && f.referencia) || '').match(/\d{1,4}/g) || []).forEach(function (n) { arts.add(semZeros(n)); });
      leisCitadas(tudo).forEach(function (_, k) { leis.add(k); });
    });
  }
  (Array.isArray(extras) ? extras : []).forEach(function (e) {
    artigosCitados(e).forEach(function (n) { arts.add(n); });
    leisCitadas(e).forEach(function (_, k) { leis.add(k); });
  });
  const saida = [];
  artigosCitados(texto).forEach(function (n) { if (!arts.has(n)) saida.push('art. ' + n); });
  leisCitadas(texto).forEach(function (rotulo, k) { if (!leis.has(k)) saida.push(rotulo); });
  return saida;
}

// ---- shared/suicidio.mjs ----
// Perguntas TÉCNICAS sobre suicídio: escolhe, na cartilha ABP/CFM (2014), os trechos que respondem a cada tipo de pergunta.
//
// Por que existe: a busca por palavras (busca.mjs) acha trechos soltos e, com o limite de 3 por documento, deixava de fora
// partes que andam juntas (as seis perguntas, as questões adicionais e os níveis de risco). Aqui cada tipo de pergunta
// puxa o conjunto certo; o que sobrar de vaga é completado pela busca normal.
//
// Os trechos são achados pelo INÍCIO da referência (o título do trecho no .md), não por número de posição:
// se a cartilha for reimportada, basta manter os títulos.



const DOC_SUICIDIO = 'abp-cfm-suicidio-2014';
const MAX_ROTA = 5;        // trechos da cartilha puxados pela rota
const TOTAL_COM_ROTA = 6;  // total de trechos (rota + busca) numa pergunta sobre suicídio

const TEMA = /\b(suicid\w*|ideacao|autolesa\w*|automutila\w*|tentativa de suicidio|tirar (a )?(propria )?vida|se matar|posvencao)\b/;

// A ordem importa: o primeiro tipo que combinar vale.
const TIPOS = [
  { tipo: 'posvencao', re: /\b(posvencao|luto|sobreviventes?|enlutad\w*|familiares? (de|apos)|apos (a )?morte)\b/ },
  { tipo: 'mitos', re: /\b(mitos?|tabu|estigma|aumenta\w* (o )?risco|piora\w*|chamar (a )?atencao|manipula\w*|fraqueza|covardia|egoismo|falar sobre|conversar sobre|perguntar (sobre|diretamente))\b/ },
  { tipo: 'rede', re: /\b(notific\w*|rede|caps|atencao (primaria|basica)|ubs|raps|competencia|compete|papel|equipe|capacitac\w*|treinamento|contrarreferencia|fluxo|protocolo)\b/ },
  { tipo: 'fatores', re: /\b(fatores?|sinais?|grupos? de risco|populacao|quem corre|mais risco|protecao|protetores?|idosos?|adolescentes?|jovens?|homens?|mulheres?|indigenas?|populacao de rua)\b/ },
  { tipo: 'avaliar', re: /\b(avali\w*|identific\w*|reconhec\w*|investig\w*|perguntas?|perguntar|triag\w*|nivel|niveis|classific\w*|baixo|medio|alto|escala|instrumento)\b/ },
  { tipo: 'abordar', re: /\b(abord\w*|acolh\w*|escuta|conversar com|falar com|lidar|como (conversar|dialogar))\b/ },
  { tipo: 'manejo', re: /\b(manej\w*|conduz\w*|conduta|encaminh\w*|o que fazer|como agir|como proceder|intervenc\w*|atender|atendimento|emergencia|urgencia|crise)\b/ }
];

// Referências (início do título do trecho) de cada tipo, na ordem de prioridade.
const ROTAS = {
  avaliar: [
    '7.1 As seis perguntas fundamentais',
    '7.1 Questões adicionais para avaliar o risco de suicídio: plano, meios e preparação (parte 1)',
    '7.3.1 Risco baixo',
    '7.3.2 Risco médio',
    '7.3.3 Risco alto'
  ],
  abordar: [
    '7.1 Como abordar o paciente com risco de suicídio (parte 1)',
    '7.1 Como abordar o paciente com risco de suicídio (parte 2)',
    '7.1 As seis perguntas fundamentais',
    '7.3.1 Risco baixo',
    '7.3.2 Risco médio (avaliação do risco de suicídio: caracterizar, manejar e encaminhar) (parte 1)'
  ],
  manejo: [
    '7.3.1 Risco baixo',
    '7.3.2 Risco médio (avaliação do risco de suicídio: caracterizar, manejar e encaminhar) (parte 1)',
    '7.3.3 Risco alto (avaliação do risco de suicídio: caracterizar, manejar e encaminhar) (parte 1)',
    '7.3.3 Risco alto (avaliação do risco de suicídio: caracterizar, manejar e encaminhar) (parte 2)',
    '7.3.4 Urgência/emergência (risco de suicídio) (parte 1)'
  ],
  mitos: [
    '4. Mitos sobre o suicídio, Tabela 1 (parte 1)',
    '4. Mitos sobre o suicídio, Tabela 1 (parte 2)',
    '4. Mitos sobre o suicídio, Tabela 1 (parte 3)',
    '4. Mitos sobre o suicídio, Tabela 1 (parte 4)',
    '3. Barreiras à detecção'
  ],
  fatores: [
    '6.1 Os dois principais fatores de risco',
    '6.2 Tabela 2: principais fatores de risco associados ao comportamento suicida (doenças mentais',
    '6.2 Tabela 2: principais fatores de risco associados ao comportamento suicida (aspectos psicológicos',
    '6.2 Fatores protetores'
  ],
  posvencao: [
    '8. Posvenção do suicídio (parte 1)',
    '8. Posvenção do suicídio (parte 2)',
    '8. Posvenção do suicídio (parte 3)'
  ],
  rede: [
    '9.2 O que compete à atenção primária',
    '9.3 O que compete à atenção secundária e terciária; notificação compulsória da tentativa de suicídio (parte 1)',
    '9.3 O que compete à atenção secundária e terciária; notificação compulsória da tentativa de suicídio (parte 3)',
    '9.1 O que compete à equipe de saúde como um todo (parte 1)',
    '9. O suicídio e a importância da rede de saúde (parte 1)'
  ]
};
// Quem pergunta por um grupo específico recebe também o trecho de idade (adolescentes, jovens e pessoas idosas).
const IDADE = /\b(idosos?|pessoas? idosas?|adolescentes?|jovens?|crianca\w*)\b/;
const REF_IDADE = '6.2 Idade como fator de risco';

// 'avaliar' | 'abordar' | 'manejo' | 'mitos' | 'fatores' | 'posvencao' | 'rede' | null (null: não é sobre suicídio, ou é só "suicídio" sem tipo)
function tipoDePerguntaSuicidio(consulta) {
  const t = normalizar(consulta);
  if (!TEMA.test(t)) return null;
  for (const x of TIPOS) if (x.re.test(t)) return x.tipo;
  return null;
}

// indice: o índice de busca (busca.mjs). Devolve os trechos da cartilha para a pergunta, na ordem de prioridade.
function trechosDaRota(indice, consulta) {
  const tipo = tipoDePerguntaSuicidio(consulta);
  if (!tipo || !indice || !Array.isArray(indice.docs)) return [];
  const cartilha = indice.docs.map(function (d) { return d.c; }).filter(function (c) { return c.doc === DOC_SUICIDIO; });
  if (!cartilha.length) return [];
  const refs = ROTAS[tipo].slice();
  if (tipo === 'fatores' && IDADE.test(normalizar(consulta))) refs.splice(1, 0, REF_IDADE);
  // "notificação" pergunta pelo trecho da portaria: ele vai para a frente
  if (tipo === 'rede' && /notific/.test(normalizar(consulta))) {
    const i = refs.findIndex(function (r) { return r.indexOf('(parte 3)') > -1; });
    if (i > 0) refs.unshift(refs.splice(i, 1)[0]);
  }
  const saida = [];
  for (const r of refs) {
    const c = cartilha.find(function (x) { return String(x.referencia || '').indexOf(r) === 0; });
    if (c && !saida.includes(c)) saida.push(c);
  }
  return saida.slice(0, MAX_ROTA);
}

// Junta rota e busca: a rota vem primeiro; a busca completa as vagas sem repetir trecho.
function combinarComBusca(rota, achados, total = TOTAL_COM_ROTA) {
  if (!rota.length) return achados;
  const saida = rota.map(function (trecho) { return { trecho: trecho, score: 0, cobertura: 1, ordem: 0, rota: true }; });
  for (const a of achados) {
    if (saida.length >= total) break;
    if (!saida.some(function (x) { return x.trecho === a.trecho || (x.trecho.id && x.trecho.id === a.trecho.id); })) saida.push(a);
  }
  return saida;
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

// ---- client/memoria.mjs ----
// Memória do Paulus: ele aprende com o uso, SÓ NO APARELHO. O Worker continua sem gravar nada.
//
// O que aprende (tudo vem de pergunta que já passou pelo filtro de dados pessoais):
//   estilo      respostas mais curtas / mais detalhadas / com exemplos (botões 👍 👎 "mais curto" "explicar de outro jeito")
//   temas       documentos da base que a pessoa mais consulta (favorecem a ordem da busca e escolhem exemplos)
//   perguntas   as que se repetem viram sugestões do mascote
//   apelidos    "abrir cadunico" -> a tela que a pessoa disse ser essa (ensinado uma vez, vale sempre)
//   aprovadas   respostas que a pessoa aprovou com 👍; servem quando a IA ou a internet falham
//   acoes       telas que a pessoa mais abre
//
// Regras: nada aqui contém dado de pessoa (cada texto passa de novo por temDadoPessoal ao gravar, ao ler e ao importar);
// tudo envelhece (a meia-vida faz o Paulus "esquecer" o que a pessoa deixou de usar); é pequeno (limites fixos);
// pode ser visto (resumo), levado (exportar/importar) e apagado (esquecer). Pergunta sobre suicídio/autolesão nunca é guardada.
//
// Este arquivo é concatenado por scripts/build.mjs: imports em UMA linha, nomes de função únicos (prefixo "mem").




const MEM_VERSAO = 1;
const MEM_CHAVE = 'paulus:memoria:v' + MEM_VERSAO;
const MEM_DIA = 86400000;
const MEM_MEIA_VIDA_ESTILO = 60 * MEM_DIA;   // o estilo muda devagar
const MEM_MEIA_VIDA_TEMAS = 45 * MEM_DIA;
const MEM_MEIA_VIDA_PERGUNTAS = 90 * MEM_DIA;
const MEM_VALIDADE_APROVADA = 180 * MEM_DIA; // resposta aprovada antiga pode ter perdido a validade (norma muda)
const MEM_LIM = { perguntas: 150, temas: 40, acoes: 40, apelidos: 40, aprovadas: 30, textoPergunta: 140, textoResposta: 1800, apelido: 40 };
const MEM_LIMIAR_ESTILO = 1.5;               // pontos (com decaimento) para o estilo mudar
const MEM_SINAIS = ['bom', 'ruim', 'mais_curto', 'mais_detalhe', 'outro_jeito', 'copiou'];
const MEM_RE_SENSIVEL = /suicid|ideacao|autolesao|automutil|me matar|tirar a propria vida/;
const MEM_RE_ID = /^[a-z0-9_-]{1,40}$/i;
const MEM_RE_DOC = /^[a-z0-9_.-]{1,100}$/i;
const MEM_RE_CHAVE_ACAO = /^[a-z0-9_-]{1,20}\/[a-z0-9_-]{1,40}$/i;

function memVazia() {
  return { v: MEM_VERSAO, criadoEm: 0, estilo: { curto: [0, 0], detalhe: [0, 0], exemplos: [0, 0] }, temas: {}, perguntas: {}, acoes: {}, apelidos: {}, aprovadas: [] };
}

// ------------------------------------------------------------------ peso com decaimento
// Um peso é [valor, quando]. O valor "de agora" é valor * 0.5^(dias / meia-vida).

function memPeso(par, agora, meiaVida) {
  if (!Array.isArray(par) || typeof par[0] !== 'number' || typeof par[1] !== 'number') return 0;
  const dt = Math.max(0, agora - par[1]);
  return par[0] * Math.pow(0.5, dt / meiaVida);
}

function memSomar(par, delta, agora, meiaVida) {
  return [Math.round((memPeso(par, agora, meiaVida) + delta) * 1000) / 1000, agora];
}

// ------------------------------------------------------------------ limpeza (usada ao ler, ao importar e ao gravar)

function memNum(v, min, max, padrao) {
  return typeof v === 'number' && isFinite(v) ? Math.min(max, Math.max(min, v)) : padrao;
}

function memPar(p) {
  return Array.isArray(p) ? [memNum(p[0], -20, 20, 0), memNum(p[1], 0, 4102444800000, 0)] : [0, 0];
}

// Texto livre só entra se for curto, sem dado pessoal e sem marcação.
function memTextoLimpo(v, max) {
  const t = String(v == null ? '' : v).replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return t && !temDadoPessoal(t) ? t : '';
}

function memLista(a) { return Array.isArray(a) ? a : []; }
function memObj(o) { return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }

// Reconstrói a memória campo a campo: nada do que vem de fora (armazenamento adulterado, arquivo importado) passa sem conferência.
function memSanear(bruto) {
  const b = memObj(bruto);
  const m = memVazia();
  if (b.v !== MEM_VERSAO) return m;
  m.criadoEm = memNum(b.criadoEm, 0, 4102444800000, 0);
  ['curto', 'detalhe', 'exemplos'].forEach(function (k) { m.estilo[k] = memPar(memObj(b.estilo)[k]); });
  Object.keys(memObj(b.temas)).slice(0, MEM_LIM.temas).forEach(function (doc) {
    if (MEM_RE_DOC.test(doc)) m.temas[doc] = memPar(b.temas[doc]);
  });
  Object.keys(memObj(b.perguntas)).slice(0, MEM_LIM.perguntas).forEach(function (k) {
    const p = memObj(b.perguntas[k]);
    const t = memTextoLimpo(p.t, MEM_LIM.textoPergunta);
    const app = String(k).split('|')[0];
    if (!t || !MEM_RE_ID.test(app) || MEM_RE_SENSIVEL.test(normalizar(t))) return;
    m.perguntas[app + '|' + normalizar(t)] = { t: t, n: memNum(p.n, 1, 9999, 1), p: memPar(p.p) };
  });
  Object.keys(memObj(b.acoes)).slice(0, MEM_LIM.acoes).forEach(function (k) {
    if (MEM_RE_CHAVE_ACAO.test(k)) m.acoes[k] = memPar(b.acoes[k]);
  });
  Object.keys(memObj(b.apelidos)).slice(0, MEM_LIM.apelidos).forEach(function (k) {
    const i = String(k).lastIndexOf('|');
    const alvo = String(b.apelidos[k] || '');
    const frase = i > 0 ? memTextoLimpo(String(k).slice(0, i), MEM_LIM.apelido) : '';
    if (frase && MEM_RE_CHAVE_ACAO.test(alvo) && String(k).slice(i + 1) === alvo) m.apelidos[normalizar(frase) + '|' + alvo] = alvo;
  });
  memLista(b.aprovadas).slice(0, MEM_LIM.aprovadas).forEach(function (x) {
    const a = memObj(x);
    const q = memTextoLimpo(a.q, MEM_LIM.textoPergunta);
    const r = String(a.r == null ? '' : a.r).replace(/[<>]/g, ' ').trim().slice(0, MEM_LIM.textoResposta);
    if (!q || !r || MEM_RE_SENSIVEL.test(normalizar(q))) return;
    const fontes = memLista(a.f).slice(0, 4).map(function (f) {
      const o = memObj(f);
      return { documento: memTextoLimpo(o.documento, 160), norma: memTextoLimpo(o.norma, 240), ano: memNum(o.ano, 0, 3000, 0) || undefined, referencia: memTextoLimpo(o.referencia, 200) };
    });
    m.aprovadas.push({ q: q, r: r, f: fontes, d: memLista(a.d).filter(function (d) { return MEM_RE_DOC.test(String(d)); }).slice(0, 6).map(String), app: MEM_RE_ID.test(String(a.app || '')) ? String(a.app) : '', ts: memNum(a.ts, 0, 4102444800000, 0) });
  });
  return m;
}

// ------------------------------------------------------------------ armazenamento

// Guarda em localStorage (por origem). Se não houver (modo privativo, bloqueio), a memória vale só enquanto a página está aberta.
function memArmazenamentoPadrao() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      localStorage.setItem('paulus:teste', '1');
      localStorage.removeItem('paulus:teste');
      return localStorage;
    }
  } catch (e) { /* bloqueado */ }
  const volatil = {};
  return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(volatil, k) ? volatil[k] : null; }, setItem: function (k, v) { volatil[k] = String(v); }, removeItem: function (k) { delete volatil[k]; } };
}

// criarMemoria({ app, perfil?, armazenamento?, agora?, ativa? }) -> objeto com a API. Uma por init().
function criarMemoria(cfgMem) {
  const o = cfgMem || {};
  const app = String(o.app || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'app';
  const agora = typeof o.agora === 'function' ? o.agora : function () { return Date.now(); };
  const depositos = o.armazenamento || memArmazenamentoPadrao();
  // perfil: identificador opaco da conta no app (nunca e-mail ou nome), para duas pessoas no mesmo navegador terem memórias separadas.
  const perfil = String(o.perfil || 'local').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'local';
  const chave = MEM_CHAVE + ':' + perfil;
  const chaveAtiva = chave + ':ativa';
  let dados = null;
  let ativa = true;

  function carregar() {
    if (dados) return dados;
    try { ativa = depositos.getItem(chaveAtiva) !== '0' && o.ativa !== false; } catch (e) { ativa = o.ativa !== false; }
    try { dados = memSanear(JSON.parse(depositos.getItem(chave) || 'null')); } catch (e) { dados = memVazia(); }
    if (!dados.criadoEm) dados.criadoEm = agora();
    return dados;
  }

  function gravar() {
    try { depositos.setItem(chave, JSON.stringify(dados)); } catch (e) { /* cota cheia: segue só em memória */ }
  }

  // Mantém a memória pequena: o que tem menos peso hoje sai primeiro.
  function podar() {
    const t = agora();
    const cortar = function (mapa, max, valor) {
      const chaves = Object.keys(mapa);
      if (chaves.length <= max) return;
      chaves.sort(function (x, y) { return valor(mapa[y]) - valor(mapa[x]); }).slice(max).forEach(function (k) { delete mapa[k]; });
    };
    cortar(dados.temas, MEM_LIM.temas, function (p) { return memPeso(p, t, MEM_MEIA_VIDA_TEMAS); });
    cortar(dados.perguntas, MEM_LIM.perguntas, function (p) { return p.n * Math.max(0.01, memPeso([1, p.p[1]], t, MEM_MEIA_VIDA_PERGUNTAS)); });
    cortar(dados.acoes, MEM_LIM.acoes, function (p) { return memPeso(p, t, MEM_MEIA_VIDA_TEMAS); });
    Object.keys(dados.temas).forEach(function (k) { if (memPeso(dados.temas[k], t, MEM_MEIA_VIDA_TEMAS) < 0.05) delete dados.temas[k]; });
    dados.aprovadas = dados.aprovadas.filter(function (a) { return t - a.ts < MEM_VALIDADE_APROVADA; }).slice(-MEM_LIM.aprovadas);
  }

  function mexer(fn) {
    carregar();
    if (!ativa) return;
    fn(carregar(), agora());
    podar();
    gravar();
  }

  const chaveAcao = function (id) { return app + '/' + id; };

  // ---------------------------------------------------------------- o que se aprende

  // Uma pergunta respondida (qualquer tipo). docs = ids dos documentos que a busca achou.
  function aprenderPergunta(texto, docs) {
    const t = memTextoLimpo(texto, MEM_LIM.textoPergunta);
    if (!t || MEM_RE_SENSIVEL.test(normalizar(t))) return;
    mexer(function (m, agoraMs) {
      const k = app + '|' + normalizar(t);
      const antiga = m.perguntas[k];
      m.perguntas[k] = { t: t, n: Math.min(9999, (antiga ? antiga.n : 0) + 1), p: [1, agoraMs] };
      memLista(docs).slice(0, 3).forEach(function (d) {
        if (MEM_RE_DOC.test(String(d))) m.temas[d] = memSomar(m.temas[d], 0.3, agoraMs, MEM_MEIA_VIDA_TEMAS);
      });
    });
  }

  function aprenderAcao(id) {
    if (!MEM_RE_ID.test(String(id || ''))) return;
    mexer(function (m, agoraMs) { m.acoes[chaveAcao(id)] = memSomar(m.acoes[chaveAcao(id)], 1, agoraMs, MEM_MEIA_VIDA_TEMAS); });
  }

  // Ensina "quando eu digitar esta frase, é esta tela".
  function vincular(frase, idAcao) {
    const f = memTextoLimpo(frase, MEM_LIM.apelido);
    const k = normalizar(f);
    if (!k || k.length < 2 || !MEM_RE_ID.test(String(idAcao || ''))) return false;
    mexer(function (m) {
      Object.keys(m.apelidos).forEach(function (x) { if (x.indexOf(k + '|' + app + '/') === 0) delete m.apelidos[x]; });
      m.apelidos[k + '|' + chaveAcao(idAcao)] = chaveAcao(idAcao);
    });
    return true;
  }

  function apelidoDe(textoNormalizado) {
    const m = carregar();
    if (!ativa) return '';
    const prefixo = textoNormalizado + '|' + app + '/';
    for (const k of Object.keys(m.apelidos)) {
      if (k.indexOf(prefixo) === 0) return k.slice(prefixo.length);
    }
    return '';
  }

  // Sinal da pessoa sobre uma resposta. r = { pergunta, texto, fontes, docs } (o resultado de Paulus.perguntar já traz isso).
  function avaliar(r, sinal) {
    if (MEM_SINAIS.indexOf(sinal) === -1) return false;
    const x = r || {};
    mexer(function (m, agoraMs) {
      const st = m.estilo;
      // Um sinal contrário só esfria o outro (até zero): não conta como ponto a favor do lado oposto.
      const somar = function (campo, d) { const n = memSomar(st[campo], d, agoraMs, MEM_MEIA_VIDA_ESTILO); st[campo] = [Math.max(0, n[0]), n[1]]; };
      const docs = memLista(x.docs).filter(function (d) { return MEM_RE_DOC.test(String(d)); }).slice(0, 3);
      const temas = function (d) { docs.forEach(function (doc) { m.temas[doc] = memSomar(m.temas[doc], d, agoraMs, MEM_MEIA_VIDA_TEMAS); }); };
      if (sinal === 'mais_curto') { somar('curto', 1); somar('detalhe', -0.5); }
      else if (sinal === 'mais_detalhe') { somar('detalhe', 1); somar('curto', -0.5); }
      else if (sinal === 'outro_jeito') { somar('exemplos', 1); }
      else if (sinal === 'copiou') { temas(0.5); }
      else if (sinal === 'bom') { temas(1.5); guardarAprovada(m, x, docs, agoraMs); }
      else if (sinal === 'ruim') { temas(-1); esquecerAprovada(m, x.pergunta); }
    });
    return true;
  }

  function guardarAprovada(m, x, docs, agoraMs) {
    const q = memTextoLimpo(x.pergunta, MEM_LIM.textoPergunta);
    const r = String(x.texto || '').slice(0, MEM_LIM.textoResposta);
    if (!q || !r || x.deMemoria || MEM_RE_SENSIVEL.test(normalizar(q))) return;
    const limpa = memSanear({ v: MEM_VERSAO, aprovadas: [{ q: q, r: r, f: memLista(x.fontes), d: docs, app: app, ts: agoraMs }] }).aprovadas[0];
    if (!limpa) return;
    m.aprovadas = m.aprovadas.filter(function (a) { return normalizar(a.q) !== normalizar(q) || a.app !== app; });
    m.aprovadas.push(limpa);
  }

  function esquecerAprovada(m, pergunta) {
    const k = normalizar(memTextoLimpo(pergunta, MEM_LIM.textoPergunta));
    if (k) m.aprovadas = m.aprovadas.filter(function (a) { return normalizar(a.q) !== k || a.app !== app; });
  }

  // ---------------------------------------------------------------- o que se usa do que foi aprendido

  function estilo() {
    const m = carregar();
    if (!ativa) return { tamanho: 'normal', exemplos: false };
    const t = agora();
    const saldo = memPeso(m.estilo.curto, t, MEM_MEIA_VIDA_ESTILO) - memPeso(m.estilo.detalhe, t, MEM_MEIA_VIDA_ESTILO);
    return {
      tamanho: saldo >= MEM_LIMIAR_ESTILO ? 'curto' : saldo <= -MEM_LIMIAR_ESTILO ? 'detalhado' : 'normal',
      exemplos: memPeso(m.estilo.exemplos, t, MEM_MEIA_VIDA_ESTILO) >= MEM_LIMIAR_ESTILO
    };
  }

  // Documentos preferidos, do mais ao menos consultado (só os que já têm peso de verdade).
  function temasTop(n) {
    const m = carregar();
    if (!ativa) return [];
    const t = agora();
    return Object.keys(m.temas)
      .map(function (d) { return { doc: d, peso: memPeso(m.temas[d], t, MEM_MEIA_VIDA_TEMAS) }; })
      .filter(function (x) { return x.peso >= 1; })
      .sort(function (x, y) { return y.peso - x.peso; })
      .slice(0, n || 3);
  }

  // { doc: fator } para buscar({ preferir }): de 1,0 a 1,3 conforme o peso.
  function preferencias() {
    const f = {};
    temasTop(5).forEach(function (x) { f[x.doc] = 1 + Math.min(0.3, x.peso * 0.06); });
    return f;
  }

  // O que vai ao Worker: códigos de uma lista fechada e ids públicos de documentos. Nenhum texto livre, nenhuma pergunta.
  function paraEnvio() {
    if (!ativa) return null;
    const e = estilo();
    const temas = temasTop(3).map(function (x) { return x.doc; });
    if (e.tamanho === 'normal' && !e.exemplos && !temas.length) return null;
    return { tamanho: e.tamanho, exemplos: e.exemplos, temas: temas };
  }

  // Sugestões personalizadas para o mascote: perguntas que se repetem (neste app) e telas mais abertas.
  function frequentes(n) {
    const m = carregar();
    if (!ativa) return [];
    const t = agora();
    return Object.keys(m.perguntas)
      .filter(function (k) { return k.indexOf(app + '|') === 0 && m.perguntas[k].n >= 2; })
      .map(function (k) { return { texto: m.perguntas[k].t, n: m.perguntas[k].n, peso: m.perguntas[k].n * Math.max(0.01, memPeso([1, m.perguntas[k].p[1]], t, MEM_MEIA_VIDA_PERGUNTAS)) }; })
      .sort(function (x, y) { return y.peso - x.peso; })
      .slice(0, n || 3);
  }

  function acoesFrequentes(n) {
    const m = carregar();
    if (!ativa) return [];
    const t = agora();
    return Object.keys(m.acoes)
      .filter(function (k) { return k.indexOf(app + '/') === 0; })
      .map(function (k) { return { id: k.slice(app.length + 1), peso: memPeso(m.acoes[k], t, MEM_MEIA_VIDA_TEMAS) }; })
      .filter(function (x) { return x.peso >= 2; })
      .sort(function (x, y) { return y.peso - x.peso; })
      .slice(0, n || 3);
  }

  // Resposta aprovada que combina com a pergunta (para quando a IA/internet falham). null se nada serve.
  function aprovadaPara(pergunta) {
    const m = carregar();
    if (!ativa) return null;
    const t = agora();
    const validas = m.aprovadas.filter(function (a) { return a.app === app && t - a.ts < MEM_VALIDADE_APROVADA; });
    if (!validas.length) return null;
    // A pergunta aprovada pesa mais que o texto da resposta: repetida três vezes no texto indexado.
    const trechos = validas.map(function (a, i) { return { id: 'ap' + i, doc: 'aprovada-' + i, titulo: a.q, norma: '', ano: 0, referencia: '', texto: a.q + ' ' + a.q + ' ' + a.q + ' ' + a.r }; });
    const achou = buscar(criarIndice(trechos), pergunta, { k: 1, minScore: 1.2, minCobertura: 0.6 });
    if (!achou.length) return null;
    return validas[Number(achou[0].trecho.id.slice(2))];
  }

  // ---------------------------------------------------------------- ver, levar, apagar

  function nomeDoc(doc, base) {
    const c = memLista(base).filter(function (x) { return x && x.doc === doc; })[0];
    return c ? String(c.titulo || doc) : doc;
  }

  // Texto em português do que o Paulus aprendeu (para uma tela "O que o Paulus aprendeu sobre mim").
  function resumo(base) {
    const m = carregar();
    const e = estilo();
    const linhas = [];
    if (e.tamanho === 'curto') linhas.push('Você costuma preferir respostas curtas.');
    if (e.tamanho === 'detalhado') linhas.push('Você costuma preferir respostas mais detalhadas.');
    if (e.exemplos) linhas.push('Você costuma pedir para explicar de outro jeito, então incluo exemplos práticos.');
    const temas = temasTop(3).map(function (x) { return nomeDoc(x.doc, base); });
    if (temas.length) linhas.push('Documentos que você mais consulta: ' + temas.join('; ') + '.');
    const freq = frequentes(3).map(function (x) { return '"' + x.texto + '"'; });
    if (freq.length) linhas.push('Perguntas que você repete: ' + freq.join('; ') + '.');
    const apelidos = Object.keys(m.apelidos).filter(function (k) { return m.apelidos[k].indexOf(app + '/') === 0; }).map(function (k) { return '"' + k.split('|')[0] + '"'; });
    if (apelidos.length) linhas.push('Apelidos que você me ensinou para telas: ' + apelidos.join(', ') + '.');
    const aprovadas = m.aprovadas.filter(function (a) { return a.app === app; }).length;
    if (aprovadas) linhas.push('Guardo ' + aprovadas + ' resposta(s) que você aprovou, para uso sem internet.');
    return { ativa: ativa, linhas: linhas, vazia: !linhas.length, estilo: e, desde: m.criadoEm };
  }

  function exportar() { return JSON.stringify(carregar()); }

  // Aceita só o que passa pela limpeza; o que o arquivo trouxer de fora dela é descartado.
  function importar(json) {
    let bruto;
    try { bruto = JSON.parse(String(json)); } catch (e) { return false; }
    if (memObj(bruto).v !== MEM_VERSAO) return false;
    const limpo = memSanear(bruto);
    dados = limpo;
    if (!dados.criadoEm) dados.criadoEm = agora();
    gravar();
    return true;
  }

  // esquecer() apaga tudo; esquecer('estilo'|'temas'|'perguntas'|'apelidos'|'aprovadas'|'acoes') apaga só aquela parte.
  function esquecer(parte) {
    const m = carregar();
    const vazia = memVazia();
    if (!parte) dados = vazia;
    else if (Object.prototype.hasOwnProperty.call(vazia, parte) && parte !== 'v' && parte !== 'criadoEm') m[parte] = vazia[parte];
    else return false;
    if (!dados.criadoEm) dados.criadoEm = agora();
    gravar();
    return true;
  }

  // Desligar não apaga o que já foi aprendido, só para de aprender e de usar. Fica salvo para o próximo carregamento.
  function ligar(sim) {
    carregar();
    ativa = !!sim;
    try { depositos.setItem(chaveAtiva, ativa ? '1' : '0'); } catch (e) { /* sem armazenamento */ }
  }

  return {
    aprenderPergunta: aprenderPergunta, aprenderAcao: aprenderAcao, vincular: vincular, apelidoDe: apelidoDe, avaliar: avaliar,
    estilo: estilo, temasTop: temasTop, preferencias: preferencias, paraEnvio: paraEnvio, frequentes: frequentes, acoesFrequentes: acoesFrequentes,
    aprovadaPara: aprovadaPara, resumo: resumo, exportar: exportar, importar: importar, esquecer: esquecer, ligar: ligar,
    ativa: function () { carregar(); return ativa; }
  };
}

// Pergunta que nunca deve virar memória nem sugestão (a regra é a mesma usada ao gravar).
function memEhSensivel(texto) { return MEM_RE_SENSIVEL.test(normalizar(texto)); }

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
  silencioMs: 15000,
  memoria: true,           // aprende com o uso, só no aparelho (veja client/memoria.mjs); false = desligada
  perfil: ''               // id opaco da conta no app (nunca e-mail/nome): memórias separadas por pessoa no mesmo navegador
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
  mem: criarMemoria({ app: '' }),
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
  estado.mem = criarMemoria({ app: cfg.app, perfil: o.perfil, armazenamento: o.armazenamento, agora: o.agora, ativa: o.memoria !== false });
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
  // Apelido que a pessoa ensinou ("cadunico" -> tela X) vale antes do rótulo cadastrado pelo app.
  const idApelido = estado.mem.apelidoDe(resto.trim());
  const a = (idApelido && estado.acoes.filter(function (x) { return x.id === idApelido; })[0]) || acharPorRotulo(estado.acoes, resto);
  if (!a) {
    return {
      tipo: 'acao_desconhecida',
      texto: 'Não encontrei essa tela ou função neste app.',
      opcoes: estado.acoes.map(function (x) { return x.rotulos[0]; }),
      // Para o app oferecer "era esta?": ao tocar numa opção, aprender(id) grava o apelido e da próxima vez o Paulus já sabe.
      opcoesAcoes: estado.acoes.map(function (x) { return { id: x.id, rotulo: x.titulo }; }),
      aprender: function (id) { return estado.mem.vincular(resto, id); }
    };
  }
  if (a.confirmar) {
    return { tipo: 'acao', acao: a.id, texto: 'Posso fazer isso, mas preciso da sua confirmação.', pedeConfirmacao: true, confirmar: function () { estado.mem.aprenderAcao(a.id); return a.executar(); } };
  }
  a.executar();
  estado.mem.aprenderAcao(a.id);
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

// Em pedido de ajuste ("mais curto"), a ÚLTIMA resposta vai maior (até 3000), senão a IA reescreve só o começo dela.
function historicoParaEnvio(externo, ajuste) {
  const lista = (Array.isArray(externo) ? externo : estado.historico).slice(-cfg.maxHistorico);
  let ultima = -1;
  lista.forEach(function (h, i) { if (h && h.papel !== 'usuario') ultima = i; });
  return lista.map(function (h, i) {
    return { papel: h.papel, texto: String(h.texto).slice(0, ajuste && i === ultima ? 3000 : 1200) };
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

// Telefone no texto da IA: com ou sem DDD, fixo (8 dígitos), celular (9) e 0800. Não casa dentro de número maior
// (protocolo, CPF). Sem lookbehind (Safari antigo): o caractere antes do número entra no padrão e é descartado.
const RE_TELEFONE = /(^|[^\d])(0800[\s.-]?\d{3}[\s.-]?\d{3,4}|(?:\(?\d{2}\)?[\s.-]?)?9?\d{4}[\s.-]?\d{4})(?!\d)/g;

function telefonesNoTexto(texto) {
  const achados = [];
  const t = String(texto);
  let m;
  RE_TELEFONE.lastIndex = 0;
  while ((m = RE_TELEFONE.exec(t)) !== null) {
    achados.push(m[2]);
    RE_TELEFONE.lastIndex = m.index + m[0].length; // o caractere seguinte (não-dígito) pode abrir o próximo
  }
  return achados;
}

// Confere se a IA citou telefone que não veio das fichas. Devolve a lista dos desconhecidos.
function telefonesDesconhecidos(texto, fichas) {
  const conhecidos = telefonesConhecidos(fichas);
  return telefonesNoTexto(texto).filter(function (n) {
    if (/^(?:19|20)\d{2}[-\s.]+(?:19|20)\d{2}$/.test(n.trim())) return false; // "2023-2026" é intervalo de anos
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
    let buf = '', acumulado = '', fontes = [], habilidades = [], citaveis = null, recebeu = false, fim = false;
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
          if (Array.isArray(ev.habilidades)) { habilidades = ev.habilidades.map(String).slice(0, 3); if (ganchos.onHabilidades) ganchos.onHabilidades(habilidades); }
          if (ev.citaveis && typeof ev.citaveis === 'object') citaveis = ev.citaveis;
          if (typeof ev.t === 'string') {
            recebeu = true;
            acumulado += ev.t;
            // Os rótulos "AÇÕES NO APP:" e "SUGESTÕES:" (e o que vem depois) nunca chegam à tela.
            if (ganchos.onToken) ganchos.onToken(ev.t, ocultarControles(acumulado));
          }
        }
        if (fim) {
          if (!recebeu) reject(new Error('Resposta vazia.')); else resolve({ texto: acumulado, fontes: fontes, habilidades: habilidades, citaveis: citaveis });
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
    historico: historicoParaEnvio(opcoes.historico, ehRefinamento(texto, Array.isArray(opcoes.historico) ? opcoes.historico : estado.historico)),
    fichas: fichas,
    stream: true
  };
  // O que o app sabe abrir/fazer: a IA só pode propor ids desta lista.
  const acoes = acoesDisponiveis(opcoes.acoes);
  if (acoes.length) corpo.acoes = acoes.map(function (a) { return { id: a.id, rotulo: a.rotulo, descricao: a.descricao }; });
  // O que o Paulus aprendeu sobre o estilo da pessoa: só códigos de lista fechada e ids públicos de documentos (nunca texto livre).
  const prefs = memEhSensivel(texto) ? null : estado.mem.paraEnvio();
  if (prefs) corpo.preferencias = prefs;
  // Visão geral do diretório (totais por grupo), montada pelo app. Só vai quando o app a manda.
  if (typeof opcoes.panorama === 'string' && opcoes.panorama.trim()) corpo.panorama = opcoes.panorama.trim().slice(0, 3000);

  // Base do app (verbetes, valores de referência, calendários): só texto público do próprio app, até 4 itens.
  if (Array.isArray(opcoes.baseApp) && opcoes.baseApp.length) {
    const base = opcoes.baseApp.slice(0, 4).map(function (b) {
      return { titulo: String((b && b.titulo) || '').slice(0, 100), texto: String((b && b.texto) || '').slice(0, 1500), origem: String((b && b.origem) || '').slice(0, 200) };
    }).filter(function (b) { return b.titulo && b.texto; });
    if (base.length) corpo.baseApp = base;
  }

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
      saida = { texto: j.resposta, fontes: Array.isArray(j.fontes) ? j.fontes : [], habilidades: Array.isArray(j.habilidades) ? j.habilidades.map(String).slice(0, 3) : [], citaveis: j.citaveis && typeof j.citaveis === 'object' ? j.citaveis : null };
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
    // Artigo ou lei na resposta que não estava nos trechos que a IA leu: avisa (o texto não é alterado).
    const vistos = (Array.isArray(opcoes.historico) ? opcoes.historico : estado.historico).filter(function (h) { return h && h.papel !== 'usuario'; }).map(function (h) { return String(h.texto); });
    const semFonte = citacoesSemFonte(saida.texto, saida.citaveis, saida.fontes, vistos);
    if (semFonte.length) {
      avisos.push('A IA citou ' + semFonte.slice(0, 3).join(', ') + ', que não aparece nas normas consultadas. Confira no texto oficial antes de usar.');
    }
    return { tipo: 'ia', texto: saida.texto, fontes: saida.fontes, sugestoes: partes.sugestoes, acoes: propostas, avisos: avisos, habilidades: saida.habilidades || [], geradoPorIA: true };
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

// Mesmo formato de uma resposta da IA (os apps já sabem mostrar), marcada como vinda da memória e com a data.
function respostaAprovada(a, pergunta) {
  let quando = '';
  try { quando = ' em ' + new Date(a.ts).toLocaleDateString('pt-BR'); } catch (e) { /* sem data */ }
  return {
    tipo: 'ia', texto: a.r, fontes: a.f, sugestoes: [], acoes: [], geradoPorIA: true, deMemoria: true, pergunta: pergunta, docs: a.d,
    avisos: ['Resposta que você aprovou' + quando + ', mostrada porque a IA não respondeu agora. Pode estar desatualizada: confira a norma antes de usar em atendimento.']
  };
}

// ------------------------------------------------------------------ memória (o que o Paulus aprende com o uso)

// O app chama quando a pessoa reage a uma resposta: 'bom' (👍), 'ruim' (👎), 'mais_curto', 'mais_detalhe', 'outro_jeito', 'copiou'.
// r é o resultado de perguntar() (ele já traz pergunta e docs). Para apps com o próprio cérebro: avaliar({ pergunta, texto, fontes }, sinal).
function avaliar(r, sinal) { return estado.mem.avaliar(r, sinal); }

// Sugestões para o mascote: o que a pessoa mais pergunta e abre, completado com as sugestões padrão do app.
function sugestoesPessoais(n) {
  const max = n || 3;
  const lista = estado.mem.frequentes(max).map(function (x) { return x.texto; });
  estado.mem.acoesFrequentes(max).forEach(function (x) {
    const a = estado.acoes.filter(function (y) { return y.id === x.id; })[0];
    if (a) lista.push('abrir ' + a.titulo.toLowerCase());
  });
  const padrao = (skin() || {}).sugestoes || [];
  padrao.forEach(function (p) { if (lista.indexOf(p) === -1) lista.push(p); });
  return lista.slice(0, max);
}

const memoria = {
  resumo: function () { return estado.mem.resumo(estado.base); },
  ativa: function () { return estado.mem.ativa(); },
  ligar: function (sim) { estado.mem.ligar(sim); },
  esquecer: function (parte) { return estado.mem.esquecer(parte); },
  exportar: function () { return estado.mem.exportar(); },
  importar: function (json) { return estado.mem.importar(json); },
  vincular: function (frase, idAcao) { return estado.mem.vincular(frase, idAcao); },
  registrarUsoAcao: function (id) { estado.mem.aprenderAcao(id); },
  frequentes: function (n) { return estado.mem.frequentes(n); }
};

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
  // O tipo do pedido (shared/pedido.mjs) decide a busca offline: cumprimento não busca norma; ajuste ("mais curto") e seguimento herdam o assunto anterior.
  const hist = Array.isArray(o.historico) ? o.historico : estado.historico;
  const modo = classificarPedido(t, hist);
  const achados = estado.indice && modo !== 'saudacao' ? buscar(estado.indice, consultaDoPedido(t, hist, modo), { k: trechosParaOPedido(modo, t, K_PADRAO), preferir: estado.mem.preferencias() }) : [];
  // Cumprimento, ajuste e seguimento não dizem nada sobre o assunto: não entram nas "perguntas frequentes" nem nos temas aprendidos.
  const aprende = modo === 'normal' || modo === 'consulta';
  const docs = achados.map(function (a) { return a.trecho.doc; }).filter(function (d, i, l) { return d && l.indexOf(d) === i; });

  let motivo = '';
  if (iaLigada()) {
    try {
      const r = await pedirIA(t, o);
      if (r.tipo === 'ia' && !Array.isArray(o.historico)) {
        estado.historico.push({ papel: 'usuario', texto: t }, { papel: 'paulus', texto: r.texto });
        estado.historico = estado.historico.slice(-cfg.maxHistorico * 2);
      }
      // pergunta e docs ficam no resultado para o app devolver em Paulus.avaliar(r, 'bom'|'ruim'|...)
      r.pergunta = t; r.docs = docs;
      if (aprende) estado.mem.aprenderPergunta(t, docs);
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

  // Sem IA, cumprimento e pedido de ajuste não têm o que responder da base de normas (um trecho de norma no lugar de "mais curto" confundiria).
  if (modo === 'saudacao' || modo === 'refinamento') {
    return { tipo: 'sem_resposta', texto: modo === 'saudacao' ? 'Oi! Estou sem a IA agora, mas a base de normas continua disponível: pergunte pelo assunto.' : 'Não consegui ajustar a resposta agora. Tente de novo em instantes ou copie o texto e edite à mão.', motivo: motivo };
  }

  // Sem IA: primeiro a resposta que a própria pessoa aprovou antes (se combina), depois o trecho da norma.
  const aprovada = estado.mem.aprovadaPara(t);
  if (aprovada) {
    estado.mem.aprenderPergunta(t, aprovada.d);
    return respostaAprovada(aprovada, t);
  }
  if (achados.length) {
    const rn = respostaDasNormas(achados);
    rn.pergunta = t; rn.docs = docs;
    estado.mem.aprenderPergunta(t, docs);
    return rn;
  }
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
  const modo = classificarPedido(t, hist);
  if (modo === 'saudacao') return null;
  const achados = buscar(estado.indice, consultaDoPedido(t, hist, modo), { k: trechosParaOPedido(modo, t, K_PADRAO), preferir: estado.mem.preferencias() });
  return achados.length ? respostaDasNormas(achados) : null;
}

const Paulus = { init, perguntar, consultarNormas, registrarAcao, registrarBusca, avaliar, sugestoesPessoais, memoria, limpar, skin, iaLigada, temDadoPessoal, detectarCrise, versao: '0.7.0' };

root.Paulus = Paulus;
if (typeof module === 'object' && module.exports) module.exports = Paulus;
})(typeof self !== 'undefined' ? self : this);

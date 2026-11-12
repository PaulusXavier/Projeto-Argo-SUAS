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
const RE_ENDERECO = /\b(mora|moro|moramos|moram|moradora?|reside|residente|endere[cç]o)\b[^.?!\n]{0,40}\b(rua|av\.?|avenida|travessa|tv\.?|quadra|lote)(?![A-Za-zÀ-ÿ])[^?!\n]{0,40}\b\d+/i;
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

// Conta escrita com operador entre espaços ("quanto é 1518 - 218 - 164 - 58"): somando tudo passa de 9 dígitos, mas cada número é curto.
// Só vale com palavra ou símbolo de conta na mensagem e operador COM espaços ("95-3623-1234" e "123.456.789-01" continuam barrados).
const RE_SINAL_DE_CONTA = /[+*×÷=%]|\b(?:calcul|quanto|soma\b|some\b|subtra|resultado|vezes|menos\b|dividid|media|média|percent|per capita)/i;
function ehContaComOperador(sequencia, texto) {
  if (!RE_SINAL_DE_CONTA.test(texto)) return false;
  const partes = sequencia.trim().split(/\s+[-\/]\s+/);
  return partes.length >= 2 && partes.every(function (p) { return p.replace(/\D/g, '').length <= 8; });
}

// E-mail em tempo linear: ancora em cada "@" e olha só a "palavra" de cada lado.
// (O regex antigo /[^\s@]+@[^\s@]+\.[a-z]{2,}/ era quadrático: 60 KB sem espaço levavam ~2,6 s.)
function temEmail(t) {
  let i = t.indexOf('@');
  while (i !== -1) {
    let a = i - 1;
    while (a >= 0 && !/[\s@]/.test(t.charAt(a))) a--;
    let b = i + 1;
    while (b < t.length && !/[\s@]/.test(t.charAt(b))) b++;
    if (a + 1 < i && /^[^\s@]+\.[a-z]{2,}/i.test(t.slice(i + 1, b))) return true;
    i = t.indexOf('@', i + 1);
  }
  return false;
}

// Telefone: com DDD entre parênteses, ou rotulado (\"tel\", \"whatsapp\"...), inclusive fixo de 8 dígitos (3623-1234), que a regra de 9 dígitos não pegava.
const RE_TEL_DDD = /\(\d{2}\)\s*\d{4,5}[-\s]?\d{4}(?!\d)/;
const RE_TEL_ROTULADO = /\b(?:tel(?:efone)?|fone|celular|cel|whats(?:app)?|zap|contato)\b[^\d\n]{0,15}(?:\(?\d{2}\)?[\s-]?)?\d{4,5}[\s-]?\d{4}(?!\d)/i;
// Data de nascimento (\"nasceu em 12/03/2015\", \"data de nascimento: 12-03-15\"): com o resto da conversa, identifica a criança.
const RE_NASCIMENTO = /\b(?:nasc\w*|data de nascimento|dn)\b[^\d\n]{0,20}\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/i;
// Nome escrito em minúsculas (celular): \"a criança chamada joão pedro\", \"o nome dela é maria souza\". Só com gatilho forte.
const PESSOA = 'crianca|menin[oa]|adolescente|usuari[oa]|idos[oa]|mae|pai|filh[oa]|senhora?|moca|moco|rapaz|homem|mulher|jovem|bebe|paciente|vizinh[oa]|beneficiari[oa]';
const PALAVRA_NOME = '([a-z]{3,})\\s+(?:d[aeo]s?\\s+)?([a-z]{3,})';
const RE_NOME_MINUSCULO = new RegExp('\\b(?:(?:' + PESSOA + ')\\s+(?:chamad[oa]|de nome)|nome\\s+(?:dele|dela|completo)\\s+e|se chama|chama-se)\\s+' + PALAVRA_NOME + '\\b', 'g');
const NAO_NOME_MINUSCULO = new Set('para pelo pela pelos pelas por com sem que uma uns umas aos nas nos dos das desde sobre entre quando como mais muito muita obrigatorio obrigatoria importante necessario nao tem ser esta foi'.split(' '));
function achouNomeMinusculo(t) {
  const x = semAcentoMin(t);
  RE_NOME_MINUSCULO.lastIndex = 0;
  let m;
  while ((m = RE_NOME_MINUSCULO.exec(x)) !== null) {
    if (![m[1], m[2]].some(function (w) { return NAO_NOME.has(w) || NAO_NOME_MINUSCULO.has(w); })) return true;
    RE_NOME_MINUSCULO.lastIndex = m.index + 1;
  }
  return false;
}

// Nome em CAIXA ALTA ("MARIA DA SILVA recebe bolsa"): só quando há 2+ palavras seguidas em maiúsculas, que viram "Maria Da Silva" para
// passar pelas mesmas regras de nome. Sigla isolada (CRAS, PAIF) não conta, e as siglas conhecidas estão em NAO_NOME.
function achouNomeCaixaAlta(t) {
  if (!/[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,}\s+(?:D[AEO]S?\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,}/.test(t)) return false;
  const suave = t.replace(/[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,}/g, function (w) { return w.charAt(0) + w.slice(1).toLowerCase(); }).replace(/\bD([AEO]S?)\b/g, function (m) { return m.toLowerCase(); });
  return achouNomeVerbo(suave) || achouNome(suave);
}

// Para texto que o APP manda (fichas do diretório, base do app, panorama): telefone, endereço e nome de unidade são esperados ali,
// então só vale o que identifica PESSOA: e-mail, documento rotulado, CPF formatado e nome depois de gatilho.
function temIdentificacaoPessoal(texto) {
  const t = String(texto == null ? '' : texto);
  if (temEmail(t) || RE_DOC_ROTULADO.test(t) || /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(t)) return true;
  return achouNome(t) || achouNomeIdade(t) || achouNomeMinusculo(t) || RE_TRAT.test(t);
}

function temDadoPessoal(texto) {
  const t = String(texto == null ? '' : texto);
  if (temEmail(t)) return true;
  if (RE_TEL_DDD.test(t) || RE_TEL_ROTULADO.test(t) || RE_NASCIMENTO.test(t)) return true;
  const sequencias = t.match(/\d[\d.\-\/\s]{6,}\d/g) || [];
  if (sequencias.some(s => !SO_ANOS.test(s.trim()) && s.replace(/\D/g, '').length >= 9 && !ehContaComOperador(s, t))) return true;
  if (RE_DOC_ROTULADO.test(t)) return true;
  if (achouNome(t) || achouNomeVerbo(t) || achouNomeIdade(t) || achouNomeMinusculo(t) || achouNomeCaixaAlta(t) || RE_TRAT.test(t)) return true;
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
  // revisão: ideação passiva, meio planejado e autolesão no presente
  'nao quer(?:o|ia|er)? mais acordar|(?:melhor|seria melhor) (?:eu )?nao estar mais aqui',
  '(?:vou|quero|ia|pensando em|penso em) tomar (?:todos|todo) (?:os |o )?(?:\\w+ )?(?:remedios?|comprimidos?|medicamentos?|cartela)',
  '(?:vou|quero|ia|pensando em|penso em) (?:me )?atirar em mim',
  '(?:me|se) (?:corto|corta|cortam)(?! (?:com|na|no|ao|fazendo|cortando|durante|enquanto)\\b)',
  '(?:vontade|desejo|impulso) de (?:me|se) (?:machucar|ferir|cortar|furar|queimar)',
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
const NAO_E_PESSOA = '(?!(?:a |o )?(?:fome|sede|saudade|aula|tempo|curiosidade|vontade|barata|mosquito|rato|ratos|formiga|insetos?|servico|trabalho|charada|duvida|duvidas|pendencia|pendencias|demanda|demandas|fila|filas|vaga|vagas|processo|processos|ligacao|ligacoes|ansiedade|dor|prazo|prazos|relatorio|relatorios|tarefa|tarefas|planilha|planilhas|atraso|atrasos|lista|listas|pauta|pautas|agenda|ata|oficio|oficios|backlog|problema|problemas)\\b)';
const AMEACA_MATAR_ME = /\b(?:vai|vao|quer|querem|prometeu|jurou|ameaca|ameacou|ameacando|ameacam|tentou|tentaram|tenta) (?:de |em )?me (?:matar|esfaquear|espancar|estrangular)\b/;
const AMEACA_TERCEIRO = new RegExp('\\b(?:(?:ameac(?:a|ou|ando|am|aram)|prometeu|jurou|disse que (?:vai|vao|quer)|(?:vai|vao|quer|querem|ia|queria)) (?:de )?matar ' + NAO_E_PESSOA + OBJETO_PESSOA + '\\b|ameac(?:a|ou|ando|am|aram)s? (?:de )?morte|ameac(?:a|as) de morte|medo de (?:ser )?(?:morta|morto|assassinad[oa]|agredid[oa]|espancad[oa])|medo (?:pela|por) (?:minha|a minha) vida|temo pela minha vida)');
// Quem diz que VAI machucar alguém (raiva, esgotamento de cuidador): outra conduta, outro texto.
const INTENCAO_AGREDIR = new RegExp('\\b(?:(?:vou|quero|vontade de|estou com vontade de|tenho vontade de|ia|penso em|pensando em) (?:matar|machucar|espancar|esfaquear) ' + NAO_E_PESSOA + '(?:o|a|os|as|n[oa]s?|meu|minha|meus|minhas|alguem|ela|ele|elas|eles|crianc\\w+|filh\\w+|menin\\w+|marido|esposa|mulher|bebe)\\b|(?:vou|quero|vontade de|estou com vontade de|tenho vontade de|ia|penso em|pensando em) (?:bater|surrar) (?:n[oa]s?|em) ?(?:meu|minha|meus|minhas|o|a|os|as)? ?(?:filh\\w+|crianc\\w+|bebe|menin\\w+|marido|esposa|mulher|alguem|ela|ele)\\b|(?:estou|to|ando) (?:perdendo|sem) (?:o )?controle (?:com|d[eao]s?) (?:meu|minha|meus|minhas|a|o|os|as)? ?(?:filh\\w+|crianc\\w+|bebe|menin\\w+|marido|esposa)|nao (?:consigo|aguento) me controlar (?:com|d[eao]s?) (?:meu|minha|meus|minhas|a|o|os|as)? ?(?:filh\\w+|crianc\\w+|bebe|menin\\w+)|(?:bati|espanquei|machuquei|agredi) (?:n[oa]s?|em|o|a|os|as) ?(?:meu|minha|meus|minhas)? ?(?:filh\\w+|crianc\\w+|bebe|menin\\w+|esposa|marido|mulher))');
// Violência sofrida, dita por quem sofre, ou de um adulto contra criança/adolescente sem a palavra \"abuso\".
const VIOLENCIA_SOFRIDA = /\b(?:abus(?:a|ou|am|aram|ando) de mim|(?:me|nos) (?:abus|molest|estupr)(?:a|ou|am|aram)|(?:me|nos) (?:bate|bateu|batem|espanca|espancou|agride|agrediu|estrangula|estrangulou|sufoca|sufocou|ameaca de morte)|(?:fui|foi|foram|fomos) (?:agredid|espancad|estuprad|abusad|violentad|molestad|ameacad)\w*|(?:padrasto|madrasta|pai|mae|tio|tia|avo|avos|primo|irmao|padrinho|vizinho|professor|pastor|patrao|marido|namorado|companheiro|ex) (?:me|nela|nele) (?:toca|tocou|forca|forcou)\b|(?:padrasto|madrasta|pai|mae|tio|tia|avo|avos|primo|irmao|padrinho|vizinho|professor|pastor|patrao|marido|namorado|companheiro|ex) (?:mexe|mexeu) comigo\b|(?:ele|ela) mexe com (?:a |o )?(?:sobrinh|filh|entead|net|menin|crianc)\w*|mexe com (?:a |o )?(?:sobrinh|filh|entead|net|menin|crianc)\w*|(?:abus|estupr|molest|violent)(?:ando|a|am) (?:a |o |as |os |da |do |das |dos |de )?(?:crianc\w*|menin\w*|filh\w*|sobrinh\w*|entead\w*|net[ao]s?|adolescent\w*|irma\w*|prim[ao]s?|mulher)\b|(?:sofrendo|sofre|sofreu|sofri) (?:abuso|violencia|maus tratos|agressao|agressoes)\b|(?:trancad[oa]|presa|preso) (?:em casa|no quarto|no comodo)|carcere privado|nao (?:deixa|deixou|deixam) (?:ela|ele|eu|a mulher|a menina|o menino) sair de casa)\b/;
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
const PRIMEIRA_PESSOA_EXTRA = /\b(?:minha vida nao tem (?:mais )?sentido|nao (?:aguento|suporto|consigo) mais (?:viver|essa vida|esta vida)|nao (?:vejo|tenho) (?:mais )?(?:sentido em viver|sentido na vida|razao (?:pra|para) viver|motivo (?:pra|para) viver)|quer(?:o|ia) (?:sumir|desaparecer)|(?:vou|quero|pensando em|penso em|ia) me (?:jogar|enforcar|afogar|envenenar)|vou pular|queria estar morto|queria estar morta|queria nao ter nascido|(?:vou|quero) dar fim a minha vida|(?:cansei|estou cansad[oa]|to cansad[oa]) de viver|nao quero mais (?:estar aqui|existir)|ninguem sentiria (?:a )?minha falta|melhor (?:pra|para) (?:todo mundo|todos) se eu (?:morresse|nao existisse)|(?:acabar|acabando) com (?:a )?minha dor de uma vez|(?:vou|quero) (?:por|pondo) fim a tudo|so a morte (?:me )?(?:resolve|ajuda)|(?:queria|quero) dormir (?:e nunca mais acordar|pra sempre|para sempre)|(?:vou|quero) me (?:atirar|lancar) na frente|me dar (?:um )?tiro|(?:vou|quero) usar (?:a arma|ela|isso) em mim|me atropelasse|usar [^.?!]{0,12}em mim|(?:queria|quero) [^.?!]{0,25}dormir (?:pra|para) sempre|(?:carta|bilhete) de despedida|me cortei(?! (?:com|na|no|ao|fazendo|cortando|durante|enquanto)\b)|(?:me) (?:machuco|machucando|firo|ferindo) de proposito|nao quer(?:o|ia) mais acordar|(?:melhor|seria melhor) eu nao estar mais aqui|(?:vou|quero|ia|pensando em|penso em) tomar (?:todos|todo) (?:os |o )?(?:\w+ )?(?:remedios?|comprimidos?|medicamentos?|cartela)|(?:vou|quero|ia|pensando em|penso em) (?:me )?atirar em mim|me corto(?! (?:com|na|no|ao|fazendo|cortando|durante|enquanto)\b)|(?:vontade|desejo|impulso) de me (?:machucar|ferir|cortar|furar|queimar))\b/;
const RELATA_TERCEIRO = /\b(?:disse|disseram|falou|falaram|contou|relatou|verbalizou|mencionou)\b/;

// Erro de digitação em duas palavras-chave ("me mattar", "vou me matr", "suisidio"). Distância de edição pequena e só nestes casos:
// "matar" só depois de "me"/"se" e a no máximo 1 letra; "suicídio/suicidar" a no máximo 2 letras e com 7+ letras. Outras palavras ("morrer",
// "cortar") ficam de fora de propósito: "correr" e "portar" virariam alarme falso.
function criseDistancia(a, b) {
  const m = a.length, n = b.length;
  let ant = [], atual = [];
  for (let j = 0; j <= n; j++) ant.push(j);
  for (let i = 1; i <= m; i++) {
    atual = [i];
    for (let j = 1; j <= n; j++) atual.push(Math.min(ant[j] + 1, atual[j - 1] + 1, ant[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)));
    ant = atual;
  }
  return ant[n];
}
function criseCorrigirGrafia(t) {
  const palavras = t.split(' ');
  let mudou = false;
  for (let i = 0; i < palavras.length; i++) {
    const w = palavras[i].replace(/[^a-z]/g, '');
    if (w.length >= 7 && w.length <= 10 && w !== 'suicidio' && w !== 'suicidar' && (criseDistancia(w, 'suicidio') <= 2 || criseDistancia(w, 'suicidar') <= 2) && /^su/.test(w)) { palavras[i] = 'suicidio'; mudou = true; }
    else if (i > 0 && /^(?:me|se)$/.test(palavras[i - 1]) && w.length >= 4 && w.length <= 6 && w !== 'matar' && criseDistancia(w, 'matar') <= 1 && /^m/.test(w) && /r$/.test(w)) { palavras[i] = 'matar'; mudou = true; }
  }
  return mudou ? palavras.join(' ') : t;
}

// Devolve null se não for pedido de socorro.
function detectarCrise(texto, jaCorrigido) {
  // "Pronto Socorro" é um serviço de saúde, não um pedido de socorro ("qual o endereço do pronto-socorro?")
  // Dígito entre letras vira a letra parecida ("su1c1dio" -> "suicidio"), para a grafia disfarçada não passar. Dígito solto fica como está.
  const t = semAcento(texto).replace(/([a-z])([013457])(?=[a-z])/g, function (_, l, d) { return l + ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' })[d]; }).replace(/pronto[ -]+socorro/g, 'pronto atendimento');
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
  if (!jaCorrigido) {
    const corrigido = criseCorrigirGrafia(t);
    if (corrigido !== t) return detectarCrise(corrigido, true);
  }
  return null;
}

// ---- shared/busca.mjs ----
// Busca por palavras (BM25) na base de conhecimento. Roda no navegador (offline) e no Worker.
// Sem dependências. Cada "trecho" da base tem: { id, doc, titulo, norma, ano, referencia, texto }.

const STOP = new Set(('a o as os um uma uns umas de do da dos das em no na nos nas por para com sem sobre e ou que se ao aos ' +
  'qual quais como quem onde quando ser sao foi ha pelo pela pelos pelas seu sua seus suas ele ela eles elas isso essa esse este esta ' +
  'meu minha eu voce nos eh mais muito sao tem ter pode podem deve devem fazer faz quanto quanta quantos quantas fica ficam').split(' '));

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
// Quanto vale a sigla quando o trecho a traz só por extenso (em relação a ela aparecer escrita).
const PESO_SIGLA_POR_EXTENSO = 0.8;
function termosDaConsulta(consulta) {
  const pesos = new Map();
  const siglas = []; // { t: raiz da sigla, exp: raízes da forma por extenso }
  for (const t of tokenizar(consulta)) pesos.set(t, 1);
  for (const t of normalizar(consulta).split(' ')) {
    if (STOP.has(t) || !SIGLAS[t]) continue;
    const exp = SIGLAS[t].map(raiz);
    for (const r of exp) if (!pesos.has(r)) pesos.set(r, PESO_EXTENSO);
    siglas.push({ t: raiz(t), exp: exp });
  }
  return { pesos, siglas };
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
// "O que é o BPC?": o trecho que DEFINE a coisa ("O benefício de prestação continuada é a garantia de...") deve vir antes dos que só a citam.
const RE_PERGUNTA_DEFINICAO = /^(?:o que e|o que sao|que e|oq e|defina|definicao de|conceito de|significado de|o que significa)\b/;
const PESO_DEFINICAO = 1.5;
function defineASigla(textoNormalizado, expansao) {
  // as palavras da forma por extenso, em ordem e perto do começo, seguidas de "e"/"sao"/"consiste" ("o beneficio de prestacao continuada e a garantia...")
  const p = textoNormalizado.split(' ', 24);
  let i = 0;
  for (const alvo of expansao) {
    const j = p.indexOf(alvo, i);
    if (j < 0 || j - i > 3) return false;
    i = j + 1;
  }
  return i < p.length - 1 && p.slice(i, i + 3).some(function (w) { return w === 'e' || w === 'sao' || w === 'consiste'; });
}


// ------------------------------------------------------------------ gíria do trabalho -> termo da norma
// Quem pergunta escreve "cesta básica", "pai bate nos filhos", "morador de rua"; a norma escreve "benefício eventual",
// "violência" e "situação de rua". Cada conceito abaixo liga a fala do dia a dia às palavras técnicas (só para a BUSCA; a IA não vê isto).
// O trecho que traz pelo menos metade dos termos técnicos conta a frase da pessoa como encontrada, como acontece com as siglas.
const CONCEITOS = [
  { re: /\b(?:cestas? basicas?|auxilio alimentacao|auxilio alimento|ajuda de alimento|vale alimento)\b/, exp: ['beneficio', 'eventual', 'seguranca', 'alimentar'] },
  { re: /\b(?:aluguel social|auxilio aluguel|bolsa aluguel|ajuda de aluguel|pagar o aluguel)\b/, exp: ['beneficio', 'eventual', 'vulnerabilidade', 'temporaria', 'moradia'] },
  { re: /\b(?:auxilio funeral|auxilio funerario|enterro|sepultamento|velorio|caixao)\b/, exp: ['beneficio', 'eventual', 'funeral', 'morte'] },
  { re: /\b(?:auxilio natalidade|enxoval|nascimento do bebe)\b/, exp: ['beneficio', 'eventual', 'natalidade', 'nascimento'] },
  { re: /\b(?:bate|batem|bateu|apanha|apanham|apanhou|espanca\w*|surra\w*|agride|agridem|agrediu|agressao|agressoes|maus tratos|castigo fisico|palmada)\b/, exp: ['violencia', 'maus', 'tratos', 'agressao', 'protecao'] },
  { re: /\b(?:abandono|abandonad[oa]s?|largad[oa]s?|jogad[oa]s? de lado)\b/, exp: ['negligencia', 'abandono'] },
  { re: /\b(?:morador(?:es)? de rua|mendig\w+|sem teto|dormindo na rua|vive na rua|vivem na rua)\b/, exp: ['situacao', 'rua', 'populacao'] },
  { re: /\b(?:drogad[oa]s?|viciad[oa]s?|crack|craqueir\w+|usuarios? de drogas|cheirando|bebe demais|alcoolatra)\b/, exp: ['uso', 'alcool', 'outras', 'drogas'] },
  { re: /\b(?:lou[ck][oa]s?|doid[oa]s?|surto|surtou|surtando|crise nervosa|crise de nervos|perturbad[oa]s?)\b/, exp: ['saude', 'mental', 'sofrimento', 'psiquico'] },
  { re: /\b(?:laudos?|pareceres?|atestados? psicologic\w+|declaracao psicologica)\b/, exp: ['documento', 'psicologico', 'relatorio', 'parecer', 'declaracao'] },
  { re: /\b(?:indios?|aldeias?|aldeados?|tribo|tribos)\b/, exp: ['indigena', 'povos', 'comunidade', 'tradicional'] },
  { re: /\b(?:venezuelan\w+|imigrantes?|estrangeir\w+|haitian\w+|refugiad\w+)\b/, exp: ['migrante', 'refugio', 'acolhida', 'migracao'] },
  { re: /\b(?:cortaram|cortado|cortou|suspenderam|suspenso|suspensa|travado|travada|bloqueado|bloqueada|bloquearam)\b.*\b(?:bolsa|beneficio|auxilio|pbf)\b|\b(?:bolsa|beneficio|auxilio|pbf)\b.*\b(?:cortaram|cortado|cortou|suspenderam|suspenso|suspensa|travado|travada|bloqueado|bloqueada|bloquearam)\b/, exp: ['bloqueio', 'suspensao', 'cancelamento', 'repercussao'] },
  { re: /\b(?:deficientes?|cadeirantes?|aleijad[oa]s?|invalid[oa]s?)\b/, exp: ['pessoa', 'deficiencia', 'bpc'] },
  { re: /\b(?:velhos?|velhinh[oa]s?|terceira idade|anciao|anciaos|melhor idade)\b/, exp: ['pessoa', 'idosa', 'idoso'] },
  { re: /\b(?:menores? de idade|menorzinho|pivetes?|meninos? de rua)\b/, exp: ['crianca', 'adolescente', 'estatuto'] },
  { re: /\b(?:passando fome|fome|sem comida|sem ter o que comer)\b/, exp: ['inseguranca', 'alimentar', 'seguranca', 'alimentacao'] },
  { re: /\b(?:desempregad[oa]s?|desemprego|sem emprego|sem trabalho|sem renda)\b/, exp: ['trabalho', 'renda', 'inclusao', 'produtiva'] },
  { re: /\b(?:briga em casa|brigas em casa|briga de familia|conflito familiar|conflitos familiares|familia brigando)\b/, exp: ['conflito', 'familiar', 'vinculos', 'familia'] },
  { re: /\b(?:menina gravida|gravidez na adolescencia|adolescente gravida|gravidez precoce)\b/, exp: ['gravidez', 'adolescencia', 'adolescente'] },
  { re: /\b(?:crianca trabalhando|menor trabalhando|trabalho de crianca|criancas trabalhando)\b/, exp: ['trabalho', 'infantil', 'erradicacao'] }
];
const PESO_CONCEITO = 0.6;

function conceitosDaConsulta(consultaNorm) {
  const saida = [];
  for (const c of CONCEITOS) {
    const m = c.re.exec(consultaNorm);
    if (!m) continue;
    const frase = tokenizar(m[0]);
    saida.push({ exp: c.exp.map(raiz), frase: frase, pesoFrase: Math.max(1, frase.length) });
  }
  return saida;
}

// ------------------------------------------------------------------ onde: município da pergunta x município do trecho
// A base tem um diagnóstico por município (e o Censo SUAS tem uma seção por município). Sem isto, "quantos CRAS tem em Boa Vista?"
// trazia o diagnóstico de Pacaraima. Regras: pergunta que cita município favorece os trechos dele e rebaixa os de outros;
// pergunta sem município assume Boa Vista (onde o Paulus trabalha) e rebaixa os dos outros municípios.
const MUNICIPIOS = ['boa vista', 'alto alegre', 'amajari', 'bonfim', 'canta', 'caracarai', 'caroebe', 'iracema', 'mucajai', 'normandia', 'pacaraima', 'rorainopolis', 'sao joao da baliza', 'sao luiz', 'uiramuta'];
const RE_DOC_LOCAL = /^(?:.*diagnostico-socioterritorial.*|censo-suas-2025-roraima-psicologos)$/;
const RE_DOC_DIAGNOSTICO = /diagnostico-socioterritorial/;
// "Quantas famílias..., renda, habitação, território": a pergunta quer dado do território. Sem isso o diagnóstico só atrapalha ("relatório de visita domiciliar").
// O Censo SUAS (equipes, unidades) só ajuda quando a pergunta fala de equipe, unidade ou psicólogo do SUAS.
const RE_QUER_CENSO = /\b(?:psicolog\w+|cras|creas|centro pop|censo|equipe|equipes|rh|profissionais|unidades?|capacidade|implantacao|equipamentos?|carga horaria|servidores?|trabalhadores?)\b/;
const RE_QUER_DADO_LOCAL = /\b(?:quantos|quantas|quantidade|numero|numeros|dados|diagnostico|setor|setores|indicador|indicadores|percentual|porcentagem|populacao|habitantes|censo|ivcad|estatistica|estatisticas|total|perfil|cadastrad\w+|renda|pobreza|vulnerabilidade|habitacao|habitacionais|territorio|territorial|bairros?|domicilios|moradia|alfabetizacao|escolaridade|equipe|equipes|psicolog\w+|capacidade|implantacao|cras|creas)\b/;

function municipiosEm(textoNormalizado) {
  const t = ' ' + textoNormalizado + ' ';
  return MUNICIPIOS.filter(function (m) { return t.indexOf(' ' + m + ' ') >= 0; });
}

function fatorLocal(trecho, municipiosPergunta, querDado, querCenso) {
  if (!RE_DOC_LOCAL.test(trecho.doc || '')) return 1;
  const quer = RE_DOC_DIAGNOSTICO.test(trecho.doc) ? querDado : querCenso;
  let f = quer ? 1 : 0.5;
  const doTrecho = municipiosEm(normalizar(trecho.referencia));
  if (!doTrecho.length) return f;
  // Citar o município só favorece o trecho dele quando a pergunta pede dado do território; fora disso, só rebaixa os de outros municípios.
  if (municipiosPergunta.length) return f * (doTrecho.some(function (m) { return municipiosPergunta.indexOf(m) >= 0; }) ? (quer ? 1.3 : 1) : 0.6);
  return f * (doTrecho.indexOf('boa vista') >= 0 ? (quer ? 1.25 : 1) : 0.65);
}

// Chave do assunto de um trecho de diagnóstico, sem o nome do município: os três diagnósticos que incluem Boa Vista repetem o mesmo assunto.
function assuntoDoDiagnostico(trecho) {
  let t = ' ' + normalizar(trecho.referencia) + ' ';
  for (const m of MUNICIPIOS) t = t.split(' ' + m + ' ').join(' ');
  // "Cantá, Boa Vista e Bonfim" deixa um "e" solto: sai de todas as chaves, para as chaves continuarem comparáveis
  return t.replace(/ e /g, ' ').replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------------ pistas por documento
// Pergunta que só um documento da base responde bem: ele sobe na ordem (nunca entra se a busca não o trouxe).
const PISTAS = [
  { todas: [/psicolog/, /\b(?:quantos|quantas|quantidade|equipe|equipes|rh|profissionais|censo|carga horaria|vinculo|vinculos|contratad\w+|concursad\w+|efetiv\w+|cobertura|lotad\w+)\b/], doc: 'censo-suas-2025-roraima-psicologos', fator: 1.6 },
  { todas: [/\bcenso suas\b/], doc: 'censo-suas-2025-roraima-psicologos', fator: 1.8 },
  { todas: [/\b(?:cras|creas)\b/, /\b(?:quantos|quantas|equipe|equipes|capacidade|implantacao|equipamentos?|unidades|estrutura)\b/], doc: 'censo-suas-2025-roraima-psicologos', fator: 1.4 },
  { todas: [/\bvenezuel\w+|\bacolhida\b|\bmigrantes?\b|\brefugi\w+/], doc: 'roraima-operacao-acolhida-2026', fator: 1.3 },
  // "Quem pode receber cesta básica / aluguel social" é pergunta sobre benefício eventual: o decreto sobe, senão os cadernos longos do PAIF, que repetem "cesta básica", ocupam todas as vagas.
  { todas: [/\b(?:cestas? basicas?|aluguel social|auxilio aluguel|auxilio funeral|auxilio natalidade|beneficios? eventua(?:l|is))\b/], doc: 'decreto-6307-2007', fator: 1.6 }
];

function fatorPista(doc, consultaNorm) {
  let f = 1;
  for (const p of PISTAS) if (p.doc === doc && p.todas.every(function (r) { return r.test(consultaNorm); })) f = Math.max(f, p.fator);
  return f;
}

function buscar(indice, consulta, { k = 3, minScore = 1.2, minCobertura = 0.5, preferir = null } = {}) {
  if (!indice || !indice.N) return [];
  const { pesos, siglas } = termosDaConsulta(consulta);
  const termos = Array.from(pesos.keys());
  if (!termos.length) return [];
  let pesoTotal = 0;
  for (const p of pesos.values()) pesoTotal += p;
  const k1 = 1.4, b = 0.75;
  // Pergunta de definição com sigla: formas por extenso (palavras normalizadas) cujo trecho de definição ganha prioridade.
  const consultaNorm = normalizar(consulta);
  const expansoesDefinicao = RE_PERGUNTA_DEFINICAO.test(consultaNorm)
    ? consultaNorm.split(' ').filter(function (t) { return SIGLAS[t] && !STOP.has(t); }).map(function (t) { return SIGLAS[t]; })
    : [];
  const conceitos = conceitosDaConsulta(consultaNorm);
  const municipiosPergunta = municipiosEm(consultaNorm);
  const querDado = RE_QUER_DADO_LOCAL.test(consultaNorm);
  const querCenso = RE_QUER_CENSO.test(consultaNorm);
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
    // Lei escreve "benefício de prestação continuada" por extenso e quem pergunta digita "BPC": quando o trecho traz TODAS as palavras
    // da forma por extenso, a sigla conta como encontrada (senão o artigo que define o BPC perde para quem só repete a sigla).
    for (const g of siglas) {
      if (d.tf[g.t]) continue;
      let menor = Infinity;
      for (const e of g.exp) menor = Math.min(menor, d.tf[e] || 0);
      if (!menor || menor === Infinity) continue;
      const idf = Math.log(1 + (indice.N - (indice.df[g.t] || 0) + 0.5) / ((indice.df[g.t] || 0) + 0.5));
      score += PESO_SIGLA_POR_EXTENSO * idf * (menor * (k1 + 1)) / (menor + k1 * (1 - b + b * d.len / (indice.avg || 1)));
      achou += pesos.get(g.t) || 1; // a sigla vale 1 na cobertura
    }
    // Gíria do trabalho ("cesta básica") achada pelos termos técnicos da norma ("benefício eventual"): ver CONCEITOS.
    for (const g of conceitos) {
      let achados = 0, s = 0;
      for (const e of g.exp) {
        const f = d.tf[e];
        if (!f) continue;
        achados++;
        const idf = Math.log(1 + (indice.N - (indice.df[e] || 0) + 0.5) / ((indice.df[e] || 0) + 0.5));
        s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / (indice.avg || 1)));
      }
      if (achados / g.exp.length < 0.5) continue;
      score += PESO_CONCEITO * s;
      let jaAchou = 0;
      for (const t of g.frase) if (d.tf[t]) jaAchou += pesos.get(t) || 1;
      achou += Math.max(0, g.pesoFrase - jaAchou);
    }
    const cobertura = Math.min(1, achou / pesoTotal);
    if (score >= minScore && cobertura >= minCobertura) {
      let ordem = score * (PESO_TIPO[d.c.tipo || 'norma'] || 1) * fatorPreferido(preferir, d.c.doc) * fatorLocal(d.c, municipiosPergunta, querDado, querCenso) * fatorPista(d.c.doc, consultaNorm);
      if (expansoesDefinicao.length) {
        const inicio = normalizar(String(d.c.texto).slice(0, 220));
        if (expansoesDefinicao.some(function (e) { return defineASigla(inicio, e); })) ordem *= PESO_DEFINICAO;
      }
      res.push({ trecho: d.c, score, cobertura, ordem });
    }
  }
  res.sort((x, y) => y.ordem - x.ordem);
  // O mesmo assunto de diagnóstico repetido em vários documentos (Boa Vista aparece em três): fica só o melhor.
  const assuntosVistos = new Set();
  for (let i = 0; i < res.length; i++) {
    if (!RE_DOC_DIAGNOSTICO.test(res[i].trecho.doc || '')) continue;
    const chave = assuntoDoDiagnostico(res[i].trecho);
    if (!chave) continue;
    if (assuntosVistos.has(chave)) { res.splice(i, 1); i--; } else assuntosVistos.add(chave);
  }
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

// "Qual a diferença entre CRAS e CREAS?": uma busca só mistura os dois assuntos e acaba trazendo trechos que citam um deles de passagem.
// Aqui cada lado é buscado separado (como pergunta de definição) e os resultados se alternam, para a IA receber os dois.
const RE_COMPARACAO = /\b(?:diferenca|diferencas|diferenciar|diferencia|difere|distincao|comparar|comparacao|compare)\s+(?:entre\s+|de\s+|do\s+|da\s+)?(.+?)\s+(?:e|x|vs|versus|ou|com|para)\s+(?:o\s+|a\s+|os\s+|as\s+)?(.+)$/;

function ladosDaComparacao(consulta) {
  const m = RE_COMPARACAO.exec(normalizar(consulta));
  if (!m) return null;
  const limpar = function (t) { return t.replace(/^(?:o|a|os|as)\s+/, '').trim(); };
  const lados = [limpar(m[1]), limpar(m[2])];
  // cada lado precisa ter assunto próprio, e os dois têm de ser diferentes
  if (lados.some(function (l) { return tokenizar(l).length === 0 || l.split(' ').length > 6; })) return null;
  if (lados[0] === lados[1]) return null;
  return lados;
}

function buscarPergunta(indice, consulta, opcoes = {}) {
  const lados = ladosDaComparacao(consulta);
  const k = opcoes.k || 3;
  if (!lados || k < 2) return buscar(indice, consulta, opcoes);
  const metade = Math.ceil(k / 2);
  const listas = lados.map(function (l) { return buscar(indice, 'o que e ' + l, Object.assign({}, opcoes, { k: metade })); });
  if (listas.some(function (l) { return !l.length; })) return buscar(indice, consulta, opcoes);
  const saida = [], vistos = new Set();
  for (let i = 0; saida.length < k && i < metade; i++) {
    for (const l of listas) {
      const r = l[i];
      if (r && !vistos.has(r.trecho) && saida.length < k) { vistos.add(r.trecho); saida.push(r); }
    }
  }
  // sobrou vaga (lados repetidos): completa com a busca da pergunta inteira
  if (saida.length < k) for (const r of buscar(indice, consulta, opcoes)) if (saida.length < k && !vistos.has(r.trecho)) { vistos.add(r.trecho); saida.push(r); }
  return saida;
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
//   continuar    "continue", "aprofunde", "tem mais?" -> segue de onde a última resposta parou, sem repetir
//   contestacao  "tem certeza?", "discordo", "mas eu li que..." -> reconfere a última resposta contra as fontes (corrige se errou, mantém se a fonte sustenta)
//   porque       "por quê?", "de onde tirou isso?", "qual a fonte?" -> explica o caminho e a fonte da última resposta
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

// ------------------------------------------------------------------ pedido sobre a última resposta

const RESPOSTA_FALSA = [{ papel: 'paulus', texto: '-' }];

// Perguntas SOBRE o que o Paulus acabou de dizer (não são assunto novo). Só valem com resposta anterior e mensagem curta.
const RE_CONTINUAR = /^(?:por favor )?(?:continue|continua|continuar|prossiga|prossegue|termine|termina|complete|completa|aprofunde|aprofunda|desenvolva|desenvolve|va mais fundo|pode continuar|pode seguir|pode aprofundar|pode completar|tem mais|o que mais|mais um pouco|mais detalhes|e o resto|e so isso|so isso)(?: (?:isso|a resposta|ai|de onde parou|mais|um pouco|por favor|essa resposta))*$/;
const RE_CONTESTACAO_CURTA = /^(?:(?:hum+|ah|ue|mas|olha|poxa) )?(?:tem certeza|certeza disso|voce tem certeza|sera mesmo|serio mesmo|confere isso|confira isso|confere de novo|confira de novo|verifique de novo|verifica de novo|revise isso|revisa isso|revise a resposta|isso esta certo|isso ta certo|isso e verdade|isso procede|nao concordo|discordo|nao e bem assim|nao e isso|nao e assim|nao foi isso|isso esta errado|isso ta errado|esta errado|ta errado|voce errou|acho que voce errou|acho que esta errado|acho que nao)(?: (?:disso|mesmo|isso|de novo|a resposta))*$/;
const RE_CONTESTACAO_FONTE = /^(?:mas |olha |ue )?(?:eu li|li|eu vi|vi|ouvi|me disseram|disseram|pelo que li|pelo que sei|na minha leitura|no meu municipio|aqui no municipio|aqui no meu municipio|na minha unidade|aqui na unidade) (?:que |nao |a |o |e |foi |aqui )?/;
const RE_PORQUE = /^(?:(?:e )?por ?que(?: isso| disso| sim| nao| assim)?|por que razao|como (?:voce )?chegou (?:nisso|nessa conclusao|a isso)|de onde (?:voce )?tirou isso|de onde veio isso|de onde vem isso|em que (?:voce )?se baseou|em que se baseia|qual (?:e )?a fonte|qual (?:e )?a base|qual norma|qual artigo|qual documento|onde esta escrito|onde diz isso|cite a fonte|mostre a fonte|me mostra a fonte|justifique|justifica|explique o raciocinio|explica o raciocinio|por que voce disse isso|por que voce acha isso)$/;

// Devolve 'continuar' | 'contestacao' | 'porque' | '' . Ordem: "por quê?" e "continue" são exatos; contestação aceita relato curto.
function pedidoSobreResposta(texto, historico) {
  if (!temRespostaAnterior(historico)) return '';
  const n = normalizar(texto);
  if (!n) return '';
  const palavras = n.split(' ').length;
  if (palavras <= 8) {
    if (RE_CONTINUAR.test(n)) return 'continuar';
    if (RE_PORQUE.test(n)) return 'porque';
    if (RE_CONTESTACAO_CURTA.test(n)) return 'contestacao';
  }
  if (palavras <= 30 && RE_CONTESTACAO_FONTE.test(n)) return 'contestacao';
  return '';
}

// Mensagem com 2 a 4 perguntas ("posso X? e se Y? e quando Z?"): cada uma vira uma parte, para a busca cobrir todas e a resposta responder todas.
function partesDaPergunta(texto) {
  const t = String(texto == null ? '' : texto).replace(/\s+/g, ' ');
  const frases = t.match(/[^.?!]*\?/g) || [];
  const partes = frases.map(function (f) { return f.replace(/^[\s,;:]+/, '').replace(/^e\s+/i, '').trim(); })
    .filter(function (f) { return f.split(' ').length >= 3 && tokenizar(f).length >= 2; });
  return partes.length >= 2 ? partes.slice(0, 4).map(function (f) { return f.slice(0, 220); }) : [];
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
  if (modo !== 'refinamento' && modo !== 'seguimento' && modo !== 'continuar' && modo !== 'porque' && modo !== 'contestacao') return pergunta;
  const lista = Array.isArray(historico) ? historico : [];
  // Anda para trás pelas mensagens do(a) profissional até achar a pergunta que carrega o assunto: pula "oi" e "mais curto",
  // e junta os seguimentos em cadeia ("e para adolescente?" depois "e para idoso?" continuam no assunto da primeira).
  const partes = [];
  for (let i = lista.length - 1; i >= 0 && partes.length < 3; i--) {
    const h = lista[i];
    if (!h || h.papel !== 'usuario' || !h.texto) continue;
    const texto = String(h.texto).slice(0, 300);
    if (ehSaudacao(texto) || pareceAjuste(texto) || pedidoSobreResposta(texto, RESPOSTA_FALSA)) continue;
    partes.unshift(texto);
    if (!ehSeguimento(texto)) break;
  }
  if (!partes.length) return pergunta;
  // Contestação traz palavras novas ("mas li que o limite é meio salário"): buscam junto com o assunto. Ajuste, continuar e "por quê?" só herdam.
  return (modo === 'seguimento' || modo === 'contestacao') ? partes.join(' ') + ' ' + pergunta : partes.join(' ');
}

// ------------------------------------------------------------------ classificação

const RE_CONSULTA = /\b(telefone|fone|contato|endereco|onde fica|horario|quantos|quantas|qual (?:cras|creas|ubs|caps|conselho|delegacia|centro pop)|que cras|que creas|bairro)\b/;

// Devolve 'saudacao' | 'refinamento' | 'continuar' | 'contestacao' | 'porque' | 'seguimento' | 'consulta' | 'normal'.
function classificarPedido(pergunta, historico, { temFichas = false, temPanorama = false } = {}) {
  if (ehSaudacao(pergunta)) return 'saudacao';
  if (ehRefinamento(pergunta, historico)) return 'refinamento';
  const sobre = pedidoSobreResposta(pergunta, historico);
  if (sobre) return sobre;
  if (ehSeguimento(pergunta) && Array.isArray(historico) && historico.some(function (h) { return h && h.papel === 'usuario'; })) return 'seguimento';
  if ((temFichas || temPanorama) && RE_CONSULTA.test(normalizar(pergunta))) return 'consulta';
  return 'normal';
}

// Quantos trechos de norma vão para a IA. Cumprimento não precisa de nenhum; pedido de ajuste só precisa do que a
// resposta anterior já usava; pergunta rica (várias ideias) merece um trecho a mais.
function trechosParaOPedido(modo, pergunta, padrao) {
  if (modo === 'saudacao') return 0;
  if (modo === 'refinamento' || modo === 'continuar') return Math.min(3, padrao);
  if (modo === 'porque' || modo === 'contestacao') return padrao;
  if (modo === 'consulta') return padrao;
  return tokenizar(pergunta).length >= 6 ? padrao + 1 : padrao;
}

// Parâmetros da IA por situação. Os valores "normais" são os de sempre (900 tokens, temperatura 0,4),
// para a resposta de rotina não mudar; o que muda é o que precisa mudar.
//   pref.tamanho === 'curto' (memória do aparelho) continua mandando no teto de respostas comuns.
function perfilDaIA({ modo, tema = false, comTextoPronto = false, pref = null, quantitativo = false, partes = 0 }) {
  if (modo === 'saudacao') return { max_tokens: 160, temperature: 0.5 };
  if (tema) return { max_tokens: 900, temperature: 0.4 };
  // Pergunta de conta: o número vem do programa, a IA só explica. Temperatura baixa para não reescrever o resultado.
  if (comTextoPronto) return { max_tokens: 1400, temperature: quantitativo ? 0.3 : 0.5 };
  if (quantitativo && modo !== 'refinamento') return { max_tokens: pref && pref.tamanho === 'curto' ? 600 : 1000, temperature: 0.2 };
  if (modo === 'refinamento') return { max_tokens: pref && pref.tamanho === 'curto' ? 700 : 1200, temperature: 0.45 };
  // Contestar e explicar a fonte pedem firmeza (pouca criatividade); continuar pede espaço; pergunta composta ganha espaço por parte.
  if (modo === 'contestacao' || modo === 'porque') return { max_tokens: 800, temperature: 0.2 };
  if (modo === 'continuar') return { max_tokens: pref && pref.tamanho === 'curto' ? 700 : 1100, temperature: 0.45 };
  if (partes >= 2 && !(pref && pref.tamanho === 'curto')) return { max_tokens: 1300, temperature: 0.4 };
  if (pref && pref.tamanho === 'curto') return { max_tokens: 500, temperature: modo === 'consulta' ? 0.2 : 0.4 };
  if (modo === 'consulta') return { max_tokens: 900, temperature: 0.2 };
  return { max_tokens: 900, temperature: 0.4 };
}

// ---- shared/conversa.mjs ----
// Memória da CONVERSA inteira, não só das últimas mensagens.
// Roda no navegador (cliente) e no Worker, com as mesmas regras.
//
// Problema que isto resolve: o histórico enviado à IA era de 6 mensagens (3 trocas). O que foi dito antes disso
// (o bairro da família, a unidade em foco, o assunto) sumia e o mascote voltava a pedir dado que a pessoa já tinha dado.
//
// Três peças, todas por regra (sem gastar cota de IA):
//   1) compactarHistorico   as últimas mensagens vão inteiras; as perguntas mais antigas viram um resumo curto.
//   2) estado da conversa   o que já está firmado (unidade, bairro, município, assunto) vai junto, em campos fechados.
//   3) deveEsclarecer       a pergunta de esclarecimento só passa quando o dado falta de verdade
//                           (não está na mensagem, no estado nem na conversa) e só para os tipos que dependem dele.





const RESPOSTA_FALSA_CONV = [{ papel: 'paulus', texto: '-' }];

const MENSAGENS_RECENTES = 10;      // últimas mensagens que vão inteiras (5 trocas)
const MAX_PERGUNTAS_ANTIGAS = 12;   // quantas perguntas mais antigas entram no resumo
const MAX_ANTIGA = 160;                    // caracteres de cada pergunta antiga
const MAX_RESUMO = 1100;

function ehRespostaConv(h) {
  return !!h && (h.papel === 'paulus' || h.papel === 'argo' || h.papel === 'assistente');
}

function limpoConv(texto, max) {
  return limparMarcacao(String(texto == null ? '' : texto)).replace(/\s+/g, ' ').trim().slice(0, max);
}

// Separa o histórico em "recentes" (vão inteiras) e "antigas" (viram resumo).
// A janela começa sempre numa mensagem da pessoa, para não separar uma pergunta da resposta dela.
function compactarHistorico(historico, opcoes = {}) {
  const recentes = Math.max(2, Number(opcoes.recentes) || MENSAGENS_RECENTES);
  const lista = (Array.isArray(historico) ? historico : []).filter(function (h) {
    return h && (h.papel === 'usuario' || ehRespostaConv(h)) && String(h.texto || '').trim();
  });
  let inicio = Math.max(0, lista.length - recentes);
  while (inicio > 0 && lista[inicio].papel !== 'usuario') inicio--;
  const janela = lista.slice(inicio);
  const antigas = [];
  for (const h of lista.slice(0, inicio)) {
    if (h.papel !== 'usuario') continue;
    const t = limpoConv(h.texto, MAX_ANTIGA);
    // Dado pessoal nunca entra; cumprimento e frase minúscula não dizem nada sobre o assunto.
    if (t.length < 6 || temDadoPessoal(t) || ehSaudacao(t) || pedidoSobreResposta(t, RESPOSTA_FALSA_CONV)) continue;
    antigas.push(t);
  }
  const ultimas = antigas.slice(-MAX_PERGUNTAS_ANTIGAS);
  let resumo = ultimas.map(function (t) { return '- ' + t; }).join('\n');
  if (resumo.length > MAX_RESUMO) resumo = resumo.slice(resumo.length - MAX_RESUMO).replace(/^[^\n]*\n/, '');
  return { recentes: janela, antigas: ultimas, resumo: resumo };
}

// ------------------------------------------------------------------ estado

const CAMPOS_NOME = ['unidade', 'bairro', 'municipio'];
const RE_NOME_CONV = /^[\p{L}\p{N} .,'\-ºª/()]*$/u;
const RE_INTENCAO = /^[a-z_]{3,20}$/;

// Aceita só campos fechados e curtos, sem dado pessoal. O Worker não confia em quem chama.
function sanearEstado(bruto) {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const saida = {};
  for (const campo of CAMPOS_NOME) {
    const v = limpoConv(bruto[campo], 91);
    // Nome longo demais não é nome (é texto solto): descarta em vez de cortar no meio.
    if (v && v.length <= 90 && RE_NOME_CONV.test(v) && !temDadoPessoal(v)) saida[campo] = v;
  }
  const assunto = limpoConv(bruto.assunto, 200);
  if (assunto && !temDadoPessoal(assunto)) saida.assunto = assunto;
  const intencao = limpoConv(bruto.intencao, 20);
  if (intencao && RE_INTENCAO.test(intencao)) saida.intencao = intencao;
  return Object.keys(saida).length ? saida : null;
}

// Junta o estado antigo com o que a última troca revelou. O que é novo vale mais; campo vazio não apaga o antigo.
function mesclarEstado(anterior, novo) {
  const base = sanearEstado(anterior) || {};
  const n = sanearEstado(novo) || {};
  return sanearEstado(Object.assign({}, base, n));
}

// Bloco que vai para o prompt (resposta e interpretação).
function estadoComoTexto(estado) {
  const e = sanearEstado(estado);
  if (!e) return '';
  const linhas = [];
  if (e.unidade) linhas.push('- Unidade em foco: ' + e.unidade);
  if (e.bairro) linhas.push('- Bairro em foco: ' + e.bairro);
  if (e.municipio) linhas.push('- Município em foco: ' + e.municipio);
  if (e.assunto) linhas.push('- Assunto em andamento: ' + e.assunto);
  return linhas.join('\n');
}

// ------------------------------------------------------------------ esclarecimento

// Só estes tipos dependem de um dado que a conversa pode não ter. Conceito, norma, CID, contagem e "outro" se respondem
// com uma premissa dita em voz alta; perguntar antes só atrasa.
const DEPENDE_DE = { territorio: 'bairro', ubs_psicologo: 'bairro', diretorio: 'unidade' };

function palavrasConv(texto) {
  return new Set(normalizar(texto).split(' ').filter(function (p) { return p.length > 2; }));
}

function semelhantesConv(a, b) {
  const A = palavrasConv(a), B = palavrasConv(b);
  if (!A.size || !B.size) return false;
  let comuns = 0;
  A.forEach(function (p) { if (B.has(p)) comuns++; });
  return comuns / Math.min(A.size, B.size) >= 0.6;
}

// true = vale perguntar de volta; false = siga e responda (com a premissa mais provável).
// Entradas: o que a interpretação devolveu (esclarecer, intencao, bairro, unidade), o estado e o histórico.
function deveEsclarecer({ esclarecer, intencao, bairro = '', unidade = '', estado = null, historico = [] } = {}) {
  if (!esclarecer || !String(esclarecer).trim()) return false;
  const falta = DEPENDE_DE[intencao];
  if (!falta) return false;
  const e = sanearEstado(estado) || {};
  if (falta === 'bairro' && (bairro || e.bairro)) return false;
  if (falta === 'unidade' && (unidade || e.unidade)) return false;
  // Já perguntou isto agora há pouco: não pergunta de novo (a pessoa responderia a mesma coisa).
  const lista = Array.isArray(historico) ? historico : [];
  const ultima = lista.slice().reverse().find(ehRespostaConv);
  if (ultima && semelhantesConv(String(ultima.texto || ''), String(esclarecer))) return false;
  return true;
}

// ------------------------------------------------------------------ resposta que só pergunta

// A resposta da IA é só uma pergunta de esclarecimento (sem nada útil)? Quando isso acontece com a conversa já em andamento,
// o app pede de novo uma vez, avisando a IA para assumir a premissa mais provável e responder.
function soPerguntou(texto) {
  const t = String(texto || '')
    .replace(/^\s*(SUGESTÕES|SUGESTOES|AÇÕES NO APP|ACOES NO APP)\s*:.*$/gim, '')
    .replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 280 || !/\?$/.test(t)) return false;
  if (/(^|\s)[-•]\s/.test(t)) return false;                  // lista: tem conteúdo
  const frases = (t.match(/[^.!?]+[.!?]+/g) || [t]).map(function (f) { return f.trim(); }).filter(Boolean);
  const perguntas = frases.filter(function (f) { return /\?$/.test(f); });
  // Só vale se a última frase é pergunta e a frase antes dela, quando houver, é só preâmbulo ("Para ajudar melhor, preciso saber."), não informação.
  const preambulo = /\b(preciso|para ajudar|para responder|para orientar|para te orientar|me diga|me conte|me informe|antes de)\b/i;
  return perguntas.length >= 1 && frases.length <= 2 && frases.slice(0, -1).every(function (f) { return f.length < 90 && preambulo.test(f); });
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

// "R$ 600", "R$ 1.518,00", "R$ 218,50", "R$ 142". Guardado na forma canônica: sem ponto de milhar e sem ",00" ("1518", "218.5").
const RE_VALOR = /R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/g;

function valorCanonico(bruto) {
  const n = Number(String(bruto).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? String(n) : '';
}

// Valores em reais citados no texto: conjunto de strings canônicas.
function valoresCitados(texto) {
  const achou = new Set();
  const t = String(texto == null ? '' : texto);
  let m;
  RE_VALOR.lastIndex = 0;
  while ((m = RE_VALOR.exec(t)) !== null) {
    const v = valorCanonico(m[1]);
    if (v) achou.add(v);
  }
  return achou;
}

// "R$ 1.518" para mostrar à pessoa.
function rotuloValor(canonico) {
  const [inteiro, dec] = canonico.split('.');
  return 'R$ ' + inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + (dec.length === 1 ? dec + '0' : dec) : '');
}

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
// extras (opcional): outros textos que a IA recebeu (fichas, base do app, panorama, a própria pergunta). Deles só se tiram os valores em R$.
function numerosCitaveis(achados, extras) {
  const a = new Set(), l = new Set(), v = new Set();
  for (const x of Array.isArray(achados) ? achados : []) {
    const t = x && x.trecho;
    if (!t) continue;
    const tudo = [t.referencia, t.titulo, t.norma, t.texto].join(' \n ');
    artigosCitados(tudo).forEach(function (n) { a.add(n); });
    // número solto na referência ("art. 20, § 3º") também vale: parágrafo e inciso não são tratados como artigo novo
    (String(t.referencia || '').match(/\d{1,4}/g) || []).forEach(function (n) { a.add(semZeros(n)); });
    leisCitadas(tudo).forEach(function (_, k) { l.add(k); });
    valoresCitados(tudo).forEach(function (n) { v.add(n); });
  }
  for (const e of Array.isArray(extras) ? extras : []) valoresCitados(e).forEach(function (n) { v.add(n); });
  return { a: Array.from(a).sort(), l: Array.from(l).sort(), v: Array.from(v).sort(function (x, y) { return Number(x) - Number(y); }) };
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
  // Valores em R$: só se confere quando o Worker informou a lista (Worker antigo não manda "v": nada a comparar).
  const valoresOk = citaveis && Array.isArray(citaveis.v) ? new Set(citaveis.v.map(String)) : null;
  (Array.isArray(extras) ? extras : []).forEach(function (e) {
    artigosCitados(e).forEach(function (n) { arts.add(n); });
    leisCitadas(e).forEach(function (_, k) { leis.add(k); });
    if (valoresOk) valoresCitados(e).forEach(function (n) { valoresOk.add(n); });
  });
  const saida = [];
  artigosCitados(texto).forEach(function (n) { if (!arts.has(n)) saida.push('art. ' + n); });
  leisCitadas(texto).forEach(function (rotulo, k) { if (!leis.has(k)) saida.push(rotulo); });
  if (valoresOk) valoresCitados(texto).forEach(function (n) { if (!valoresOk.has(n)) saida.push(rotuloValor(n)); });
  return saida;
}

// ---- shared/calculo.mjs ----
// Calculadora do Paulus: conta exata, sem IA e sem eval. FONTE ÚNICA: o navegador (dist/paulus.v1.js) e o Worker usam este arquivo.
//
// Por que existe: modelo de linguagem erra conta. Aqui a IA só ESCREVE a conta (ou nem isso, quando a pergunta já é uma conta)
// e um programa executa. O resultado volta para a IA explicar, e o verificador (shared/verificacao.mjs) sabe que o valor é conferido.
//
//   calcularExpressao('15% * 1200')            -> { ok, valor: 180, bool, ops, literais, refs, tokens }
//   extrairContas('quanto é 15% de 1200?')     -> { itens:[{ expressao, texto, valor... }], intencao, soConta, moeda }
//   contasConfiaveis(texto)                    -> o mesmo, mas só se a mensagem pede mesmo uma conta (senão null)
//   respostaDeConta(texto)                     -> { texto, itens } só quando a mensagem É a conta (resposta direta, sem IA)
//   pareceProblemaDeCalculo(texto, historico)  -> pergunta com números que pede uma conta em linguagem natural (vai para o passo de planejamento)
//
// Números: aceita o jeito brasileiro ("1.518,50", "R$ 3.200", "15,04%") e o ponto decimal ("0.1504").
// Sem lookbehind e sem BigInt de propósito (Safari/iOS antigos quebram o arquivo inteiro).
// No navegador os módulos viram um arquivo só: os nomes abaixo não podem repetir os de outros módulos (por isso o prefixo "calc").

const CALC_MAX_TEXTO = 400;
const CALC_MAX_TOKENS = 160;
const CALC_MAX_PROFUNDIDADE = 24;
const CALC_LIMITE = 1e15;

const CALC_FUNCOES = {
  raiz: 'raiz', sqrt: 'raiz', media: 'media', min: 'min', max: 'max', arred: 'arred', arredonda: 'arred', round: 'arred',
  teto: 'teto', ceil: 'teto', piso: 'piso', floor: 'piso', abs: 'abs', soma: 'soma', sum: 'soma'
};
const CALC_ROTULO_FUNCAO = { raiz: 'raiz', media: 'média', min: 'mín', max: 'máx', arred: 'arred', teto: 'teto', piso: 'piso', abs: 'abs', soma: 'soma' };
const CALC_ROTULO_CMP = { '<': '<', '<=': '≤', '>': '>', '>=': '≥', '==': '=', '!=': '≠' };

function calcSemAcentos(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Tira o ruído de ponto flutuante (0,1 + 0,2 = 0,30000000000000004).
function calcLimpar(x) {
  return Number(x.toPrecision(14));
}

// Arredondamento comercial (meio para cima, longe do zero), sem o erro de 1,005 -> 1,00 do toFixed.
function arredondarCasas(x, casas) {
  if (!isFinite(x)) return x;
  const n = Math.max(0, Math.min(10, casas | 0));
  const sinal = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const s = String(a);
  if (s.indexOf('e') !== -1) return sinal * Math.round(a * Math.pow(10, n)) / Math.pow(10, n);
  return sinal * Number(Math.round(Number(s + 'e' + n)) + 'e-' + n);
}

// ------------------------------------------------------------------ números

// Lê um número em s a partir de pos. ponto 'milhar' (padrão, texto de gente): "1.518" é 1518 e "2.5" é 2,5.
// ponto 'decimal' (conta escrita pela IA): o ponto é sempre decimal ("1.504" é 1,504); milhar só com vírgula decimal ("1.518,00").
function calcLerNumero(s, pos, ponto) {
  const resto = s.slice(pos, pos + 40);
  let m;
  if (ponto === 'decimal') m = /^[1-9]\d{0,2}(?:\.\d{3})+,\d+/.exec(resto);
  else m = /^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?(?!\d)/.exec(resto);
  if (m) return { v: Number(m[0].replace(/\./g, '').replace(',', '.')), len: m[0].length };
  m = /^\d+,\d+/.exec(resto);
  if (m) return { v: Number(m[0].replace(',', '.')), len: m[0].length };
  m = /^\d+(?:\.\d+)?/.exec(resto);
  if (m) return { v: Number(m[0]), len: m[0].length };
  return null;
}

// Todos os números de um texto, na forma canônica ("1.518,00" -> "1518", "15,04%" -> "15.04"), igual à de verificacao.mjs.
function numerosDoTexto(texto) {
  const t = String(texto == null ? '' : texto);
  const saida = new Set();
  let i = 0;
  while (i < t.length) {
    const c = t.charAt(i);
    if (c >= '0' && c <= '9') {
      const n = calcLerNumero(t, i, 'milhar');
      if (n && isFinite(n.v)) { saida.add(String(n.v)); i += n.len; continue; }
    }
    i++;
  }
  return saida;
}

// ------------------------------------------------------------------ leitura (tokens)

function calcPreparar(s) {
  return String(s)
    .replace(/R\$\s*/gi, '')
    .replace(/[−–]/g, '-').replace(/×/g, '*').replace(/÷/g, '/')
    .replace(/(\d|\)|%)\s*[xX]\s*(?=[\d(])/g, '$1 * ');
}

function calcTokens(s, opc) {
  const ponto = opc && opc.ponto;
  const tks = [];
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === ' ' || c === '\t' || c === '\n' || c === ' ') { i++; continue; }
    if (c >= '0' && c <= '9') {
      const n = calcLerNumero(s, i, ponto);
      if (n) {
        const prox = s.charAt(i + n.len);
        // "18h", "3º", "5a": número colado em letra não é quantidade
        const colado = /[A-Za-zÀ-ÿºª°]/.test(prox);
        tks.push({ t: colado ? 'out' : 'num', v: n.v, ini: i, fim: i + n.len });
        i += n.len;
        continue;
      }
    }
    const dois = s.substr(i, 2);
    if (dois === '<=' || dois === '>=' || dois === '==' || dois === '!=') { tks.push({ t: 'cmp', v: dois, ini: i, fim: i + 2 }); i += 2; continue; }
    if (dois === '**') { tks.push({ t: 'op', v: '^', ini: i, fim: i + 2 }); i += 2; continue; }
    if (c === '≤') { tks.push({ t: 'cmp', v: '<=', ini: i, fim: i + 1 }); i++; continue; }
    if (c === '≥') { tks.push({ t: 'cmp', v: '>=', ini: i, fim: i + 1 }); i++; continue; }
    if (c === '≠') { tks.push({ t: 'cmp', v: '!=', ini: i, fim: i + 1 }); i++; continue; }
    if (c === '<' || c === '>') { tks.push({ t: 'cmp', v: c, ini: i, fim: i + 1 }); i++; continue; }
    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '^') { tks.push({ t: 'op', v: c, ini: i, fim: i + 1 }); i++; continue; }
    if (c === '%') { tks.push({ t: 'pct', ini: i, fim: i + 1 }); i++; continue; }
    if (c === '(') { tks.push({ t: 'lp', ini: i, fim: i + 1 }); i++; continue; }
    if (c === ')') { tks.push({ t: 'rp', ini: i, fim: i + 1 }); i++; continue; }
    if (c === ';') { tks.push({ t: 'sep', ini: i, fim: i + 1 }); i++; continue; }
    if (c === ',' && /\s/.test(s.charAt(i + 1))) { tks.push({ t: 'sep', ini: i, fim: i + 1 }); i++; continue; }
    if (c === '#') {
      const m = /^#(\d{1,2})/.exec(s.slice(i, i + 4));
      if (m) { tks.push({ t: 'ref', v: Number(m[1]), ini: i, fim: i + m[0].length }); i += m[0].length; continue; }
    }
    const letras = /^[A-Za-zÀ-ÿ]+/.exec(s.slice(i, i + 30));
    if (letras) {
      tks.push({ t: 'id', v: calcSemAcentos(letras[0]).toLowerCase(), ini: i, fim: i + letras[0].length });
      i += letras[0].length;
      continue;
    }
    tks.push({ t: 'out', v: c, ini: i, fim: i + 1 });
    i++;
  }
  return tks;
}

// ------------------------------------------------------------------ cálculo

function calcErro(msg) {
  const e = new Error(msg);
  e.calc = true;
  return e;
}

function calcChecar(x) {
  if (!isFinite(x) || Math.abs(x) >= CALC_LIMITE) throw calcErro('resultado fora do limite');
  return x;
}

// Executa os tokens. vars: { 1: 800, 2: 1 } para #1, #2. Devolve { valor, bool, ops, literais, refs }.
// "ops" conta operadores, comparações e funções (porcentagem sozinha não conta): zero significa que não era uma conta.
function calcAvaliar(tokens, vars) {
  if (tokens.length > CALC_MAX_TOKENS) throw calcErro('conta longa demais');
  let p = 0, ops = 0, prof = 0;
  const literais = [], refs = [];
  const olhar = function () { return tokens[p]; };
  const exigir = function (tipo) {
    const t = tokens[p];
    if (!t || t.t !== tipo) throw calcErro('faltou fechar ou separar');
    p++;
    return t;
  };
  const numero = function (r) {
    if (r.bool) throw calcErro('resultado sim/não em conta');
    return r.v;
  };

  function comparacao() {
    const a = soma();
    const t = olhar();
    if (!t || t.t !== 'cmp') return a;
    p++;
    const b = soma();
    ops++;
    const x = numero(a), y = numero(b);
    const igual = Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
    let r;
    if (t.v === '<') r = x < y && !igual;
    else if (t.v === '<=') r = x < y || igual;
    else if (t.v === '>') r = x > y && !igual;
    else if (t.v === '>=') r = x > y || igual;
    else if (t.v === '==') r = igual;
    else r = !igual;
    if (olhar() && olhar().t === 'cmp') throw calcErro('comparação encadeada');
    return { v: r ? 1 : 0, bool: true };
  }

  function soma() {
    let a = termo();
    for (;;) {
      const t = olhar();
      if (!t || t.t !== 'op' || (t.v !== '+' && t.v !== '-')) return a;
      p++;
      let b = termo();
      ops++;
      numero(a); numero(b);
      // "1200 + 15%" e "1200 - 10%": a porcentagem é sobre o valor da esquerda
      if (b.pct) b = { v: a.v * b.v };
      a = { v: calcChecar(calcLimpar(t.v === '+' ? a.v + b.v : a.v - b.v)) };
    }
  }

  function termo() {
    let a = unario();
    for (;;) {
      const t = olhar();
      if (!t || t.t !== 'op' || (t.v !== '*' && t.v !== '/')) return a;
      p++;
      const b = unario();
      ops++;
      const x = numero(a), y = numero(b);
      if (t.v === '/' && y === 0) throw calcErro('divisão por zero');
      a = { v: calcChecar(t.v === '*' ? x * y : x / y) };
    }
  }

  function unario() {
    const t = olhar();
    if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) {
      p++;
      if (++prof > CALC_MAX_PROFUNDIDADE) throw calcErro('conta funda demais');
      const r = unario();
      prof--;
      return t.v === '-' ? { v: -numero(r) } : r;
    }
    return potencia();
  }

  function potencia() {
    const base = posfixo();
    const t = olhar();
    if (!t || t.t !== 'op' || t.v !== '^') return base;
    p++;
    const exp = unario();
    ops++;
    const b = numero(base), e = numero(exp);
    if (Math.abs(e) > 100) throw calcErro('expoente grande demais');
    return { v: calcChecar(Math.pow(b, e)) };
  }

  function posfixo() {
    let x = primario();
    while (olhar() && olhar().t === 'pct') {
      p++;
      x = { v: calcLimpar(numero(x) / 100), pct: true };
    }
    return x;
  }

  function primario() {
    const t = olhar();
    if (!t) throw calcErro('conta incompleta');
    if (++prof > CALC_MAX_PROFUNDIDADE) throw calcErro('conta funda demais');
    let r;
    if (t.t === 'num') { p++; literais.push(t.v); r = { v: t.v }; }
    else if (t.t === 'ref') {
      p++;
      const v = vars ? vars[t.v] : undefined;
      if (typeof v !== 'number' || !isFinite(v)) throw calcErro('a conta #' + t.v + ' não tem resultado');
      refs.push(t.v);
      r = { v: v };
    } else if (t.t === 'lp') {
      p++;
      r = comparacao();
      exigir('rp');
    } else if (t.t === 'id') {
      const f = CALC_FUNCOES[t.v];
      if (!f) throw calcErro('não conheço "' + t.v + '"');
      p++;
      exigir('lp');
      const args = [];
      if (olhar() && olhar().t !== 'rp') {
        for (;;) {
          args.push(numero(comparacao()));
          if (olhar() && olhar().t === 'sep') { p++; continue; }
          break;
        }
      }
      exigir('rp');
      ops++;
      r = { v: calcChecar(calcFuncao(f, args)) };
    } else throw calcErro('conta mal escrita');
    prof--;
    return r;
  }

  const r = comparacao();
  if (p !== tokens.length) throw calcErro('sobrou texto na conta');
  return { valor: r.bool ? r.v : calcLimpar(r.v), bool: !!r.bool, ops: ops, literais: literais, refs: refs };
}

function calcFuncao(f, a) {
  const um = function () { if (a.length !== 1) throw calcErro(f + ' pede 1 número'); return a[0]; };
  const varios = function () { if (!a.length) throw calcErro(f + ' pede números'); return a; };
  if (f === 'raiz') { const x = um(); if (x < 0) throw calcErro('raiz de número negativo'); return calcLimpar(Math.sqrt(x)); }
  if (f === 'abs') return Math.abs(um());
  if (f === 'teto') return Math.ceil(calcLimpar(um()));
  if (f === 'piso') return Math.floor(calcLimpar(um()));
  if (f === 'arred') {
    if (a.length < 1 || a.length > 2) throw calcErro('arred pede 1 ou 2 números');
    return arredondarCasas(a[0], a.length === 2 ? a[1] : 0);
  }
  if (f === 'min') return Math.min.apply(null, varios());
  if (f === 'max') return Math.max.apply(null, varios());
  const soma = varios().reduce(function (x, y) { return x + y; }, 0);
  return f === 'media' ? calcLimpar(soma / a.length) : calcLimpar(soma);
}

// Calcula uma conta escrita em texto. opc.ponto: 'milhar' (padrão) ou 'decimal'; opc.vars: { 1: 800 } para #1.
function calcularExpressao(texto, opc) {
  const o = opc || {};
  try {
    const s = calcPreparar(String(texto == null ? '' : texto)).trim();
    if (!s) return { ok: false, erro: 'conta vazia' };
    if (s.length > CALC_MAX_TEXTO) return { ok: false, erro: 'conta longa demais' };
    const tks = calcTokens(s, o);
    if (tks.some(function (t) { return t.t === 'out'; })) return { ok: false, erro: 'caractere que não entendi' };
    const r = calcAvaliar(tks, o.vars);
    return { ok: true, valor: r.valor, bool: r.bool, ops: r.ops, literais: r.literais, refs: r.refs, tokens: tks };
  } catch (e) {
    return { ok: false, erro: e && e.calc ? e.message : 'não consegui ler a conta' };
  }
}

// ------------------------------------------------------------------ apresentação

function calcMilhar(inteiro) {
  return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// 1234.5 -> "1.234,5"; moeda: "R$ 1.234,50" (inteiro fica "R$ 800"); número com resto longo vira "≈ 0,3333".
// opc: { moeda, casas } (casas: máximo de decimais fora de moeda, padrão 4).
function formatarNumero(x, opc) {
  const o = opc || {};
  if (!isFinite(x)) return String(x);
  const v = calcLimpar(x);
  let casas = o.moeda ? 2 : (o.casas != null ? o.casas : 4);
  let r = arredondarCasas(v, casas);
  if (!o.moeda && v !== 0 && r === 0) { casas = 8; r = arredondarCasas(v, casas); }
  const aprox = !o.moeda && Math.abs(r - v) > 1e-12;
  const neg = r < 0;
  const abs = Math.abs(r);
  let [inteiro, dec] = abs.toFixed(casas).split('.');
  if (o.moeda) { if (/^0+$/.test(dec || '')) dec = ''; } else if (dec) dec = dec.replace(/0+$/, '');
  const corpo = calcMilhar(inteiro) + (dec ? ',' + dec : '');
  return (aprox ? '≈ ' : '') + (neg ? '-' : '') + (o.moeda ? 'R$ ' : '') + corpo;
}

// A conta lida de volta para o(a) profissional: "15% de 1.200", "[1] ≤ 218".
function calcRenderizar(tokens) {
  let s = '';
  tokens.forEach(function (t, i) {
    const ant = tokens[i - 1];
    let x;
    if (t.t === 'num') x = (Number.isInteger(t.v) && t.v >= 1900 && t.v <= 2100) ? String(t.v) : formatarNumero(t.v, { casas: 10 });
    else if (t.t === 'op') x = t.v === '*' ? (ant && ant.t === 'pct' ? 'de' : '×') : t.v === '/' ? '÷' : t.v;
    else if (t.t === 'cmp') x = CALC_ROTULO_CMP[t.v];
    else if (t.t === 'pct') x = '%';
    else if (t.t === 'lp') x = '(';
    else if (t.t === 'rp') x = ')';
    else if (t.t === 'sep') x = ';';
    else if (t.t === 'ref') x = '[' + t.v + ']';
    else x = CALC_ROTULO_FUNCAO[CALC_FUNCOES[t.v]] || t.v;
    const grudaAntes = t.t === 'pct' || t.t === 'rp' || t.t === 'sep';
    const grudaDepois = ant && (ant.t === 'lp' || (ant.t === 'id' && t.t === 'lp'));
    const unarioAntes = ant && ant.t === 'op' && ant.v === '-' && (i < 2 || tokens[i - 2].t === 'op' || tokens[i - 2].t === 'lp' || tokens[i - 2].t === 'cmp' || tokens[i - 2].t === 'sep');
    s += (i === 0 || grudaAntes || grudaDepois || unarioAntes || (t.t === 'lp' && ant.t === 'id') ? '' : ' ') + x;
  });
  return s;
}

// Resultado escrito: "R$ 800", "25%", "3 pessoas", "sim"/"não". unidade: 'R$' | '%' | texto livre curto | ''.
function descreverResultado(r, unidade) {
  if (r.bool) return r.valor ? 'SIM' : 'NÃO';
  const u = String(unidade || '').trim().slice(0, 14);
  if (u === 'R$' || /^reais?$/i.test(u)) return formatarNumero(r.valor, { moeda: true });
  const num = formatarNumero(r.valor);
  if (u === '%') return num + '%';
  return u ? num + ' ' + u : num;
}

// Renderiza a conta lida (tokens de calcularExpressao) para mostrar.
function expressaoLegivel(tokens) {
  return calcRenderizar(Array.isArray(tokens) ? tokens : []);
}

// ------------------------------------------------------------------ contas em linguagem natural

const CALC_RE_INTENCAO = /\b(?:calcul\w*|quanto\s+(?:e|da|dao|fica|ficou|ficaria|sobra|sobrou|vai|vale|valeria|seria|serao|custa|recebe|receberia|ganha|paga|pagaria|falta|faltam|resta|restam|passa|deu)|da\s+quanto|qual\s+(?:e\s+)?(?:o\s+)?(?:resultado|total|valor\s+total|soma|media|percentual|porcentagem|saldo|diferenca)|resultado\s+d[ea]|some|soma|somar|subtra\w+|multipli\w+|divid\w+|media|percentual|porcentagem|por\s+cento|per\s*capita|dentro\s+do\s+limite|acima\s+do|abaixo\s+do)\b/;

// Palavras que sobram numa pergunta que É só a conta ("quanto é 15% de 1200 reais, por favor?").
const CALC_FILLER = new Set(('quanto e calcule calcula calcular calculo me ajuda ajude pode poderia voce vc por favor pfv pf qual o a os as resultado de do da dos das ' +
  'conta isso seria fica ficou ficaria total valor soma some somar uma um paulus ola oi bom dia tarde noite para pra em que sao deu reais real r sobre ' +
  'com aqui ai agora so apenas vale vai sera resolva resolve faca faz pro na no media entre cento percentual porcentagem hein ne').split(' '));

// Trechos que parecem conta mas não são: data, lei, artigo, parágrafo, horário.
function calcMascarar(n) {
  return n
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(/\b(?:lei|decreto|portaria|resolucao|instrucao normativa|nota tecnica|art|arts|artigo|artigos|paragrafo|inciso)\.?\s*[\d.]+(?:\/\d{2,4})?/g, ' ')
    .replace(/\bn[º°]\s*[\d.]+(?:\/\d{2,4})?/g, ' ')
    .replace(/§\s*\d+[º°]?/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ');
}

const CALC_NUM = '\\d[\\d.,]*';

function calcListaDe(lista) {
  return lista.split(/\s*(?:;|,\s+|\s+e\s+|\s+com\s+|\s*\+\s*)\s*/).map(function (x) { return x.trim().replace(/[.,]+$/, ''); }).filter(Boolean);
}

// Troca as palavras de conta por símbolos, só quando estão entre números ("300 mais 200", "15% de 1200", "reajuste de 15,04% sobre 143").
function calcNormalizarFrase(n) {
  let s = ' ' + n.replace(/r\$/g, ' ').replace(/\bpor cento\b/g, '%') + ' ';
  s = s.replace(new RegExp('\\b(?:aumento|reajuste|acrescimo|majoracao)\\s+(?:de\\s+)?(' + CALC_NUM + ')\\s*%\\s*(?:sobre|em|no valor de|do valor de|ao valor de|de)\\s+(?:o\\s+|a\\s+)?(' + CALC_NUM + ')', 'g'), ' $2 + $1% ');
  s = s.replace(new RegExp('\\b(?:desconto|abatimento|reducao|corte)\\s+(?:de\\s+)?(' + CALC_NUM + ')\\s*%\\s*(?:sobre|em|no valor de|do valor de|ao valor de|de)\\s+(?:o\\s+|a\\s+)?(' + CALC_NUM + ')', 'g'), ' $2 - $1% ');
  s = s.replace(new RegExp('(' + CALC_NUM + ')\\s*%\\s*(?:de|do|da)\\s+(?=[\\d(])', 'g'), '$1% * ');
  s = s.replace(new RegExp('\\bdiferenca\\s+entre\\s+(' + CALC_NUM + ')\\s+e\\s+(' + CALC_NUM + ')', 'g'), ' abs($1 - $2) ');
  s = s.replace(new RegExp('\\b(?:soma|some|somar|total)\\s+(?:de\\s+|dos\\s+|das\\s+)?(' + CALC_NUM + '(?:\\s*(?:;|,\\s+|\\s+e\\s+|\\s+com\\s+|\\+)\\s*' + CALC_NUM + ')+)', 'g'),
    function (_, lista) { return ' ' + calcListaDe(lista).join(' + ') + ' '; });
  s = s.replace(new RegExp('\\bmedia\\s+(?:de\\s+|dos\\s+|das\\s+|entre\\s+)?(' + CALC_NUM + '(?:\\s*(?:;|,\\s+|\\s+e\\s+|\\s+com\\s+)\\s*' + CALC_NUM + ')+)', 'g'),
    function (_, lista) { return ' media(' + calcListaDe(lista).join('; ') + ') '; });
  s = s.replace(new RegExp('\\braiz(?:\\s+quadrada)?\\s+de\\s+(' + CALC_NUM + ')', 'g'), ' raiz($1) ');
  s = s.replace(new RegExp('(' + CALC_NUM + ')\\s+ao\\s+quadrado', 'g'), '$1 ^ 2 ');
  s = s.replace(new RegExp('(' + CALC_NUM + ')\\s+ao\\s+cubo', 'g'), '$1 ^ 3 ');
  const entre = '(' + CALC_NUM + '%?|\\))\\s+';
  const prox = '\\s+(?=\\d|\\()';
  s = s.replace(new RegExp(entre + 'mais' + prox, 'g'), '$1 + ');
  s = s.replace(new RegExp(entre + 'menos' + prox, 'g'), '$1 - ');
  s = s.replace(new RegExp(entre + '(?:vezes|multiplicado\\s+por|multiplicado\\s+pela|multiplicada\\s+por)' + prox, 'g'), '$1 * ');
  s = s.replace(new RegExp(entre + '(?:dividido\\s+por|dividido\\s+pela|dividido\\s+entre|dividido\\s+em|dividida\\s+por)' + prox, 'g'), '$1 / ');
  s = s.replace(new RegExp(entre + '(?:elevado\\s+a|elevado\\s+ao|elevada\\s+a)' + prox, 'g'), '$1 ^ ');
  s = s.replace(new RegExp('(' + CALC_NUM + '%?|\\))\\s*[x×]\\s*(?=\\d|\\()', 'g'), '$1 * ');
  s = s.replace(new RegExp('(' + CALC_NUM + '%?|\\))\\s+[:÷]\\s+(?=\\d|\\()', 'g'), '$1 / ');
  return s.replace(/\s+/g, ' ');
}

function calcTokenValido(t) {
  return t.t === 'num' || t.t === 'op' || t.t === 'cmp' || t.t === 'pct' || t.t === 'lp' || t.t === 'rp' || t.t === 'sep' || t.t === 'ref'
    || (t.t === 'id' && !!CALC_FUNCOES[t.v]);
}

// Acha, nos tokens, as contas completas (a maior janela que fecha, da esquerda para a direita).
function calcJanelas(tokens) {
  const achados = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const abre = t.t === 'num' || t.t === 'lp' || t.t === 'id' || (t.t === 'op' && (t.v === '-' || t.v === '+'));
    if (!abre || !calcTokenValido(t)) { i++; continue; }
    let j = i;
    while (j < tokens.length && calcTokenValido(tokens[j])) j++;
    let achou = null;
    for (let f = j; f > i && !achou; f--) {
      const fatia = tokens.slice(i, f);
      if (!fatia.some(function (x) { return x.t === 'ref'; })) {
        try {
          const r = calcAvaliar(fatia, null);
          if (r.ops >= 1) achou = { i: i, f: f, r: r, fatia: fatia };
        } catch (e) { /* esta janela não fecha: tenta uma menor */ }
      }
    }
    if (achou) { achados.push(achou); i = achou.f; } else i++;
  }
  return achados;
}

// Procura contas em uma mensagem em linguagem natural. Não decide se ela DEVE ser respondida como conta: veja contasConfiaveis.
// intencao: a mensagem usa palavra de conta ("quanto é", "calcule", "soma"...). soConta: fora a conta só sobra enchimento ("por favor", "reais").
function extrairContas(texto) {
  const bruto = calcSemAcentos(String(texto == null ? '' : texto).slice(0, 600)).toLowerCase();
  const mascarado = calcMascarar(bruto);
  const moeda = /r\$|\breais\b|\breal\b/.test(mascarado);
  const frase = calcNormalizarFrase(mascarado);
  const tokens = calcTokens(frase, { ponto: 'milhar' });
  const janelas = calcJanelas(tokens);
  const itens = janelas.map(function (j) {
    const fonte = frase.slice(j.fatia[0].ini, j.fatia[j.fatia.length - 1].fim);
    const forte = j.fatia.some(function (x) { return x.t === 'id' || x.t === 'cmp' || (x.t === 'op' && x.v !== '-'); }) || /\s-\s/.test(fonte);
    return { expressao: calcRenderizar(j.fatia), valor: j.r.valor, bool: j.r.bool, ops: j.r.ops, moeda: moeda, forte: forte, ini: j.fatia[0].ini, fim: j.fatia[j.fatia.length - 1].fim, tokens: j.fatia };
  });
  // O que sobra depois de tirar as contas: só enchimento (sem letra de conteúdo, sem outro número)?
  let resto = frase;
  for (let k = itens.length - 1; k >= 0; k--) resto = resto.slice(0, itens[k].ini) + ' ' + resto.slice(itens[k].fim);
  const palavras = resto.replace(/[^a-z0-9$%]+/g, ' ').split(' ').filter(Boolean);
  const soConta = itens.length > 0 && palavras.every(function (w) { return CALC_FILLER.has(w); });
  return { itens: itens, intencao: CALC_RE_INTENCAO.test(bruto), soConta: soConta, moeda: moeda };
}

// extrairContas + a decisão de confiar: a mensagem pede conta (palavra de conta) ou é só uma conta com operador claro.
// Evita tratar "Lei 8.742/1993", "3 - 5 anos" ou "10-20" como aritmética.
function contasConfiaveis(texto) {
  let r;
  try { r = extrairContas(texto); } catch (e) { return null; }
  if (!r.itens.length) return null;
  if (r.intencao) return r;
  if (r.soConta && r.itens.every(function (i) { return i.forte; })) return r;
  return null;
}

// Linha escrita de uma conta: "15% de 1.200 = 180", "[1] ≤ 218 → NÃO".
function linhaDeConta(item) {
  const r = { valor: item.valor, bool: item.bool };
  const fim = descreverResultado(r, item.moeda ? 'R$' : item.unidade);
  return item.expressao + (item.bool ? ' → ' : ' = ') + fim;
}

// Resposta direta, sem IA e sem rede, SÓ quando a mensagem é a conta. Se há mais assunto na mensagem, devolve null (a IA responde com a conta pronta).
function respostaDeConta(texto) {
  const r = contasConfiaveis(texto);
  if (!r || !r.soConta) return null;
  const itens = r.itens.slice(0, 4).map(function (i) {
    return { expressao: i.expressao, valor: i.valor, bool: i.bool, moeda: i.moeda, texto: descreverResultado({ valor: i.valor, bool: i.bool }, i.moeda ? 'R$' : '') };
  });
  return { texto: r.itens.slice(0, 4).map(linhaDeConta).join('\n'), itens: itens };
}

// ------------------------------------------------------------------ pergunta que pede conta (para o passo de planejamento da IA)

const CALC_RE_NUM_EXTENSO = /\b(?:dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quinze|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|quinhentos|mil|milhao|milhoes)\b/g;
// Palavras do trabalho que costumam pedir conta, mas só valem com mais de um número, valor em reais ou porcentagem.
const CALC_RE_DOMINIO = /\b(?:renda|per\s*capita|frequencia|faltas?|faltou|faltaram|limite|teto|piso|beneficio|parcelas?|prazo|simul\w+|estimativa|custo|orcamento|repasse|cofinanciamento|valor\s+(?:total|mensal|anual)|quantos\s+(?:dias|meses|anos)|quantas\s+(?:pessoas|parcelas|faltas|aulas|semanas|vezes|familias|criancas))\b/;

function pareceProblemaDeCalculo(texto, historico) {
  const n = calcSemAcentos(String(texto == null ? '' : texto).slice(0, 800)).toLowerCase();
  const digitos = numerosDoTexto(n).size;
  const extenso = (n.match(CALC_RE_NUM_EXTENSO) || []).length;
  const quantos = digitos + extenso;
  if (!quantos) return false;
  if (CALC_RE_INTENCAO.test(n)) return true;
  if (CALC_RE_DOMINIO.test(n) && (quantos >= 2 || /r\$|%|\breais\b/.test(n))) return true;
  // seguimento curto de uma conta anterior: "e se forem 5 pessoas?", "e com renda de 4000?"
  if (digitos >= 1 && n.split(/\s+/).length <= 12 && /^(?:e|mas|entao|agora)\b|\be\s+se\b/.test(n) && Array.isArray(historico)) {
    for (let i = historico.length - 1; i >= 0; i--) {
      const h = historico[i];
      if (!h || h.papel !== 'usuario' || !h.texto) continue;
      const a = calcSemAcentos(String(h.texto)).toLowerCase();
      return CALC_RE_INTENCAO.test(a) || (CALC_RE_DOMINIO.test(a) && numerosDoTexto(a).size >= 1);
    }
  }
  return false;
}

// A pergunta usa número por extenso ("três mil", "quatro pessoas")? Nesse caso a IA converte para dígitos e o número "novo" não é invenção.
function temNumeroPorExtenso(texto) {
  const n = calcSemAcentos(String(texto == null ? '' : texto)).toLowerCase();
  return (n.match(CALC_RE_NUM_EXTENSO) || []).length > 0;
}

// ---- shared/rota.mjs ----
// Rotas do Paulus: ordem das paradas, distância, tempo e link do mapa. Sem IA, sem rede e sem eval. FONTE ÚNICA: navegador e Worker.
//
// Por que existe: modelo de linguagem inventa quilômetro e minuto. Aqui o programa lê o pedido, acha as unidades no diretório do app,
// escolhe a melhor ordem (busca exata, até 11 paradas), mede e monta o link. A IA, se entrar, só explica o resultado.
//
//   lerPedidoDeRota(texto)           -> o que a pessoa pediu (paradas escritas, volta, modo, tempo por parada...) ou null se não é pedido de rota
//   respostaDeRota(texto, opcoes)    -> { texto, links, svg, geojson, paradas, km, minutos, ... } ou null (aí a pergunta segue o caminho normal)
//        opcoes.pontos   [{ nome, lat, lng, endereco?, apelidos?[] }] (ou função que devolve a lista): o diretório do app. Só unidades PÚBLICAS.
//        opcoes.aparelho { lat, lng } ou null: posição de quem pergunta ("saindo daqui"). O Paulus nunca pede o GPS: quem passa é o app.
//        opcoes.cidade   'Boa Vista, RR': acrescentada ao nome quando o link do mapa é feito só com texto.
//   planejarRota(pontos, opcoes)     -> { ordem, trechos, km, minutos, links, geojson... } (pontos já com lat e lng)
//   textoDaRota(r), svgDaRota(r), distanciaKm(a, b)
//
// É ESTIMATIVA: linha reta × 1,3 (ruas) numa velocidade média por modo, sem trânsito, mão de rua nem horário das unidades.
// Endereço de residência de família não entra (o programa recusa): rota é entre unidades, bairros e serviços.
// Sem lookbehind e sem BigInt de propósito (Safari/iOS antigos quebram o arquivo inteiro). Nomes com prefixo "rota" por causa do arquivo único do navegador.

const ROTA_FATOR_RUA = 1.3;
const ROTA_VELOCIDADE = { carro: 30, moto: 30, bicicleta: 12, pe: 4.5 };
const ROTA_NOME_MODO = { carro: 'carro', moto: 'moto', bicicleta: 'bicicleta', pe: 'a pé' };
const ROTA_MODO_MAPA = { carro: 'driving', moto: 'driving', bicicleta: 'bicycling', pe: 'walking' };
const ROTA_MAX_PARADAS = 11;
const ROTA_MAX_TEXTO = 600;

// ------------------------------------------------------------------ texto

// Minúsculas e sem acento, MESMO comprimento do original (para cortar o original pelos índices do normalizado).
function rotaNorm(s) {
  const t = String(s == null ? '' : s);
  let o = '';
  for (let i = 0; i < t.length; i++) o += t.charAt(i).normalize('NFD').charAt(0).toLowerCase();
  return o;
}

function rotaEscapar(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function rotaKm(x) { return x.toFixed(1).replace('.', ',') + ' km'; }

function rotaTempo(min) {
  const m = Math.max(1, Math.round(min));
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return h + ' h' + (r ? ' ' + (r < 10 ? '0' : '') + r + ' min' : '');
}

// Corta de est (texto original + normalizado, sempre do mesmo tamanho) o que casa com re (feita sobre est.n).
// Devolve os grupos do ORIGINAL (com acento e maiúscula) ou null.
function rotaCortar(est, re) {
  const m = re.exec(est.n);
  if (!m) return null;
  const grupos = [];
  for (let i = 1; i < m.length; i++) {
    if (m[i] == null) { grupos.push(''); continue; }
    const p = m.index + m[0].lastIndexOf(m[i]);
    grupos.push(est.t.slice(p, p + m[i].length));
  }
  est.t = est.t.slice(0, m.index) + ' ' + est.t.slice(m.index + m[0].length);
  est.n = est.n.slice(0, m.index) + ' ' + est.n.slice(m.index + m[0].length);
  return grupos;
}

// Onde um nome de lugar termina: pontuação, fim, ou uma palavra que começa outra parte do pedido.
const ROTA_PARADA_FIM = '(?=[,;:.?!]|$|\\s(?:passando|voltando|retornando|terminando|finalizando|chegando|visitando|visitar|depois|ate|para|pra|rumo|de moto|de carro|de bike|de bicicleta|de viatura|a pe|andando|caminhando|com|usando|e volta|ida e volta|e depois|e passando|e voltando)\\b)';
const ROTA_NOME = '([^,;:.?!]+?)';
const ROTA_ARTIGO = '(?:(?:o|a|os|as|ao|aos|na|no|nas|nos|em|ate|para|pra|por|pelo|pela|de|do|da|dos|das)\\s+)';

const ROTA_MODOS = [
  ['moto', /\b(?:(?:de|com|na|usando|em)\s+(?:uma\s+)?)?(?:moto|motocicleta)\b/],
  ['bicicleta', /\b(?:(?:de|com|na|usando|em)\s+(?:uma\s+)?)?(?:bicicleta|bike)\b/],
  ['pe', /\b(?:a pe|andando|caminhando|de pe)\b/],
  ['carro', /\b(?:(?:de|com|no|usando|em)\s+(?:um\s+)?)?(?:carro|viatura|veiculo|automovel)\b/]
];

// A palavra sozinha não é lugar: "rota de CRAS e CREAS" é assunto, não pedido.
const ROTA_RUIDO = /^(?:uma|um|rota|rotas|trajeto|percurso|itinerario|dia|hoje|amanha|semana|saida|saidas)$/;
const ROTA_GENERICOS = /^(?:cras|creas|caps|ubs|upa|unidade|unidades|servico|servicos|rede|equipe|familia|familias|visita|visitas|atendimento|atendimentos|grupo|grupos|oficina|oficinas|reuniao|reunioes|territorio|bairro|bairros|fuga|acesso|encaminhamento|encaminhamentos|beneficio|beneficios|campo)$/;

// Só palavras de assunto ("oficinas da semana", "visitas"): não é lugar. Em pedido explícito, "CRAS" sozinho é lugar ambíguo e a pessoa será perguntada qual.
function rotaSoAssunto(nome, explicito) {
  const pal = rotaNorm(nome).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(function (w) { return w && !/^(?:de|do|da|dos|das|e|o|a|os|as|ao|na|no|em|para|pra|por)$/.test(w); });
  return !pal.length || pal.every(function (w) { return ROTA_RUIDO.test(w) || (!explicito && ROTA_GENERICOS.test(w)); });
}
const ROTA_CONCEITO = /^(?:o que (?:e|sao|significa)|qual (?:e )?a diferenca|para que serve|por que|porque|quem faz|como funciona)\b/;
// Pedido inequívoco (verbo de traçar, "como chegar", "melhor ordem"). "Rota de ..." sozinho é fraco: pode ser assunto ("rota de fuga").
const ROTA_EXPLICITO = /\b(?:tracar|trace|tracando|calcule|calcular|monte|montar|planeje|planejar|faca|fazer|me de|quero|preciso|gere|gerar)\b[^.?!]{0,30}\b(?:rota|rotas|trajeto|percurso|itinerario|ordem)\b|\bcomo (?:chegar|ir)\b|\b(?:melhor|menor|mais curta|mais rapida) (?:ordem|rota|caminho|trajeto|percurso)\b/;
const ROTA_GATILHO = /\b(?:rotas?|trajeto|percurso|itinerario|tracar|trace|melhor ordem|menor caminho|como chegar|como ir)\b/;
const ROTA_ENDERECO = /\b(?:rua|r|av|avenida|travessa|tv|alameda|beco|quadra|qd|lote|estrada|vicinal)\.?\s+[^,;]{0,40}?\b\d+/i;

const ROTA_INTROS = [
  /\bcomo (?:chegar|ir)(?: (?:a|ao|aos|as|na|no|nas|nos|em|ate|para|pra))?\b/,
  /\b(?:visitar|visitando|passar por|passando por|ir (?:a|ao|aos|as|na|no|nas|nos|em|para|pra))\b/,
  /\b(?:rotas?|trajeto|percurso|itinerario)(?: (?:de|do|da|dos|das|para|pra|ate|entre|em|ao|a|na|no))?\b/,
  /\b(?:melhor|menor|mais curta|mais rapida) (?:ordem|rota|caminho|trajeto|percurso)(?: (?:para|de|pra))?(?: (?:visitar|passar por))?\b/,
  /\bordem (?:de|das|dos|para|pra)(?: visitas?| paradas?)?\b/,
  /:/
];

function rotaLimparNome(s) {
  let x = String(s).replace(/\s+/g, ' ').trim();
  x = x.replace(/[.?!,;:\s]+$/, '').replace(/^[.?!,;:\s]+/, '');
  let ant;
  do {
    ant = x;
    x = x.replace(/^(?:o|a|os|as|ao|aos|à|às|na|no|nas|nos|em|até|ate|para|pra|por|pelo|pela|de|do|da|dos|das)\s+/i, '');
    x = x.replace(/\s+(?:por favor|pfv|pf|obrigado|obrigada)$/i, '');
  } while (x !== ant);
  return x.trim();
}

// Divide a lista de paradas ("A, B e C", "A -> B -> C", "A; B"). sequencia = a pessoa usou setas (ordem dela).
function rotaDividir(est, explicito) {
  const itens = [];
  let sequencia = false;
  const re = /\s*(?:->|=>|→|>|;|,|\se\s|\sdepois\s|\se depois\s|\sseguindo para\s)\s*/g;
  let ult = 0, m;
  const pedacos = [];
  while ((m = re.exec(est.n)) !== null) {
    if (/[>→]/.test(m[0])) sequencia = true;
    pedacos.push([ult, m.index]);
    ult = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  pedacos.push([ult, est.n.length]);
  pedacos.forEach(function (p) {
    const nome = rotaLimparNome(est.t.slice(p[0], p[1]));
    if (!nome || nome.length > 70 || nome.split(' ').length > 8) return;
    if (rotaSoAssunto(nome, explicito) || /\b(?:tracar|trace|rota|rotas|trajeto|percurso)\b/.test(rotaNorm(nome))) return;
    itens.push(nome);
  });
  return { itens: itens, sequencia: sequencia };
}

// ------------------------------------------------------------------ leitura do pedido

function lerPedidoDeRota(texto) {
  const original = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim().slice(0, ROTA_MAX_TEXTO);
  if (!original) return null;
  const est = { t: original, n: rotaNorm(original) };
  if (!ROTA_GATILHO.test(est.n)) return null;
  const explicito = ROTA_EXPLICITO.test(est.n);
  if (!explicito && ROTA_CONCEITO.test(est.n.trim())) return null;
  const comoChegar = /\bcomo (?:chegar|ir)\b/.test(est.n);

  // modo de deslocamento e tempo em cada parada
  let modo = '';
  ROTA_MODOS.forEach(function (x) { if (!modo && rotaCortar(est, x[1])) modo = x[0]; });
  let minutosPorParada = 0;
  let g = rotaCortar(est, /\b(\d{1,3})\s*(?:min|minutos?)\b(?:\s+(?:em cada(?: parada| visita| unidade)?|por (?:parada|visita|unidade)|cada|de atendimento|de conversa))/);
  if (g) minutosPorParada = Math.min(240, Number(g[0]));
  else {
    g = rotaCortar(est, /\b(\d{1,2})(?:[.,](\d))?\s*(?:h|hora|horas)\s+(?:em cada(?: parada| visita| unidade)?|por (?:parada|visita|unidade)|cada)\b/);
    if (g) minutosPorParada = Math.min(240, Math.round((Number(g[0]) + (g[1] ? Number(g[1]) / 10 : 0)) * 60));
  }

  // ordem: "nessa ordem" trava; "melhor ordem" libera
  let otimizar = 'auto';
  if (rotaCortar(est, /\b(?:nessa ordem|nesta ordem|sem reordenar|sem mudar a ordem|nao mude a ordem|na ordem (?:que|em que) (?:escrevi|digitei|citei|passei))\b/)) otimizar = 'nao';
  else if (rotaCortar(est, /\b(?:otimiz\w+|reorden\w+|minimiz\w+|economiz\w+|menor caminho)\b/)) otimizar = 'sim';
  else if (/\b(?:melhor|menor|mais curta|mais rapida) (?:ordem|rota|caminho|trajeto|percurso)\b/.test(est.n)) otimizar = 'sim';

  // volta ao início (ou a outro lugar, que vira o fim)
  let volta = false, fimNome = '';
  g = rotaCortar(est, new RegExp('\\b(?:volt(?:ando|ar|a)|retorn(?:ando|ar|o))\\b(?:\\s+(?:ao|aos|a|as|para|pro|pra|ate|no|na)\\s+' + ROTA_NOME + ')?' + ROTA_PARADA_FIM));
  if (g) { volta = true; fimNome = rotaLimparNome(g[0]); }
  if (rotaCortar(est, /\b(?:ida e volta|e volta|de volta)\b/)) volta = true;

  // saída
  let origem = '', origemAparelho = false;
  if (rotaCortar(est, /\b(?:(?:saindo|partindo|comecando|a partir)\s+(?:de\s+)?)?(?:daqui|de onde (?:eu )?estou|da minha (?:posicao|localizacao)(?: atual)?|de minha localizacao)\b/)) origemAparelho = true;
  if (!origemAparelho) {
    g = rotaCortar(est, new RegExp('\\b(?:saindo|partindo|comecando|iniciando|a partir)\\s+(?:(?:do|da|de|dos|das|no|na|em)\\s+)?' + ROTA_NOME + ROTA_PARADA_FIM));
    if (g) origem = rotaLimparNome(g[0]);
  }

  // fim fixo e paradas do meio
  let fim = '';
  g = rotaCortar(est, new RegExp('\\b(?:terminando|finalizando|chegando|encerrando)\\s+(?:no|na|em|ao|a|nos|nas)\\s+' + ROTA_NOME + ROTA_PARADA_FIM));
  if (g) fim = rotaLimparNome(g[0]);
  let meio = [];
  g = rotaCortar(est, /\bpassando\s+(?:por|pelo|pela|pelos|pelas)\s+([^.?!:]+?)(?=[.?!:]|$|\s(?:voltando|retornando|terminando|finalizando|chegando|e volta|ida e volta|com|usando)\b)/);
  if (g) {
    const sub = { t: g[0], n: rotaNorm(g[0]) };
    meio = rotaDividir(sub, explicito).itens;
  }

  // "rota de X até Y"
  let lista = { itens: [], sequencia: false };
  let deAte = false;
  g = rotaCortar(est, new RegExp('\\b(?:rota|trajeto|percurso|itinerario|caminho)\\s+(?:de|do|da)\\s+' + ROTA_NOME + '\\s+(?:ate|para|pra|a|ao)\\s+' + ROTA_NOME + ROTA_PARADA_FIM));
  if (g) {
    lista = { itens: [rotaLimparNome(g[0]), rotaLimparNome(g[1])], sequencia: false };
    deAte = true;
  } else {
    let inicio = -1;
    ROTA_INTROS.forEach(function (re) {
      const m = re.exec(est.n);
      if (m && m.index + m[0].length > inicio) inicio = m.index + m[0].length;
    });
    if (inicio >= 0) lista = rotaDividir({ t: est.t.slice(inicio), n: est.n.slice(inicio) }, explicito);
    if (!lista.itens.length) {
      // "A -> B -> C rota": a palavra vem depois da lista. Vale a frase inteira, se tiver ao menos duas paradas
      const limpo = { t: est.t, n: est.n };
      rotaCortar(limpo, /\b(?:rotas?|trajeto|percurso|itinerario|tracar|trace|tracando)\b/);
      const tentativa = rotaDividir(limpo, explicito);
      if (tentativa.itens.length >= 2) lista = tentativa;
    }
  }

  // monta: saída, o que foi listado (o do meio entra entre a primeira e a última), fim
  let itens = lista.itens.slice();
  if (meio.length && itens.length >= 2) itens = [itens[0]].concat(meio, itens.slice(1));
  else if (meio.length) itens = itens.concat(meio);
  const mesmo = function (a, b) { return rotaNorm(a) === rotaNorm(b); };
  if (origem && !(itens.length && mesmo(itens[0], origem))) itens.unshift(origem);
  if (fim && !(itens.length && mesmo(itens[itens.length - 1], fim))) itens.push(fim);
  let fimFixo = !!fim || deAte || (comoChegar && itens.length >= 2);
  if (fimNome && !(itens.length && mesmo(itens[0], fimNome))) { itens.push(fimNome); fimFixo = true; volta = false; }
  const inicioFixo = !!origem || deAte || (comoChegar && itens.length >= 2);
  if (!itens.length && !explicito && !origemAparelho) return null;
  if (otimizar === 'auto') {
    if (comoChegar || deAte || lista.sequencia || itens.length <= 2) otimizar = 'nao';
    else otimizar = 'sim';
  }
  return {
    explicito: explicito, comoChegar: comoChegar, paradas: itens, inicioFixo: inicioFixo, fimFixo: fimFixo,
    origemAparelho: origemAparelho, volta: volta, otimizar: otimizar, modo: modo, minutosPorParada: minutosPorParada, sequencia: lista.sequencia
  };
}

// ------------------------------------------------------------------ diretório do app

const ROTA_PALAVRAS_VAZIAS = { de: 1, do: 1, da: 1, dos: 1, das: 1, e: 1, o: 1, a: 1, os: 1, as: 1, ao: 1, aos: 1, na: 1, no: 1, nas: 1, nos: 1, em: 1, para: 1, pra: 1, por: 1 };

function rotaPalavras(s) {
  return rotaNorm(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(function (w) { return w && !ROTA_PALAVRAS_VAZIAS[w]; });
}

function rotaNumero(v) {
  if (v == null || v === '') return NaN;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return isFinite(n) ? n : NaN;
}

// Aceita { nome, lat, lng } e também latitude/longitude/lon. Ponto sem coordenada válida continua valendo para o link (por nome), mas sem distância.
function pontosDeRota(lista) {
  let l = lista;
  if (typeof l === 'function') { try { l = l(); } catch (e) { l = []; } }
  if (!Array.isArray(l)) return [];
  const saida = [];
  l.slice(0, 500).forEach(function (p) {
    if (!p || !p.nome) return;
    const lat = rotaNumero(p.lat != null ? p.lat : p.latitude);
    const lng = rotaNumero(p.lng != null ? p.lng : p.lon != null ? p.lon : p.long != null ? p.long : p.longitude);
    const ok = lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
    const nome = String(p.nome).replace(/\s+/g, ' ').trim().slice(0, 120);
    const nomes = [nome].concat(Array.isArray(p.apelidos) ? p.apelidos.slice(0, 6).map(String) : []);
    saida.push({ nome: nome, lat: ok ? lat : null, lng: ok ? lng : null, endereco: String(p.endereco || '').slice(0, 160), nomes: nomes.map(rotaPalavras).filter(function (x) { return x.length; }) });
  });
  return saida;
}

function rotaCombina(q, p) {
  if (q === p) return true;
  if (q.length >= 3 && p.indexOf(q) === 0) return true;
  return p.length >= 3 && q.indexOf(p) === 0 && q.length - p.length <= 2;
}

// Qual ponto do diretório é este texto? { ponto } | { ambiguos: [nomes] } | {}
function rotaAchar(texto, pontos) {
  const q = rotaPalavras(texto);
  if (!q.length) return {};
  let melhor = 0;
  let achados = [];
  pontos.forEach(function (p) {
    let nota = 0;
    p.nomes.forEach(function (pal) {
      if (q.every(function (w) { return pal.some(function (x) { return rotaCombina(w, x); }); })) nota = Math.max(nota, 1 + q.length / pal.length);
    });
    if (!nota) return;
    if (nota > melhor + 1e-9) { melhor = nota; achados = [p]; } else if (Math.abs(nota - melhor) < 1e-9) achados.push(p);
  });
  if (achados.length === 1) return { ponto: achados[0] };
  if (achados.length > 1) return { ambiguos: achados.slice(0, 5).map(function (p) { return p.nome; }) };
  return {};
}

// Cada texto vira { texto, ponto?, ambiguos? }. "CRAS Cauamé e Caranã" (nome com "e") é reunido quando as duas metades sozinhas não existem.
function resolverParadas(textos, pontos) {
  const saida = [];
  for (let i = 0; i < textos.length; i++) {
    const r = rotaAchar(textos[i], pontos);
    const prox = i + 1 < textos.length ? rotaAchar(textos[i + 1], pontos) : null;
    if (prox && ((!r.ponto && !r.ambiguos) || (!prox.ponto && !prox.ambiguos) || (r.ponto && r.ponto === prox.ponto))) {
      const junto = rotaAchar(textos[i] + ' ' + textos[i + 1], pontos);
      if (junto.ponto) { saida.push({ texto: textos[i] + ' e ' + textos[i + 1], ponto: junto.ponto }); i++; continue; }
    }
    saida.push({ texto: textos[i], ponto: r.ponto || null, ambiguos: r.ambiguos || null });
  }
  return saida;
}

// ------------------------------------------------------------------ planejamento

function distanciaKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

function rotaTrecho(a, b) { return distanciaKm(a, b) * ROTA_FATOR_RUA; }

// Custo de uma ordem (índices em pontos); com volta, soma o retorno ao primeiro.
function rotaCusto(ordem, D, volta) {
  let c = 0;
  for (let i = 1; i < ordem.length; i++) c += D[ordem[i - 1]][ordem[i]];
  if (volta && ordem.length > 1) c += D[ordem[ordem.length - 1]][ordem[0]];
  return c;
}

// Melhor ordem exata por programação dinâmica sobre subconjuntos (até 11 paradas: 2^11 × 11 × 11, instantâneo).
// inicio / fim: índices fixos ou -1. Com volta e inicio, o fim é o próprio início.
function rotaMelhorOrdem(D, n, inicio, fim, volta) {
  const livres = [];
  for (let i = 0; i < n; i++) if (i !== inicio && i !== fim) livres.push(i);
  const m = livres.length;
  const fechar = volta && fim < 0 && inicio >= 0 ? inicio : fim;
  if (m === 0) return [inicio].concat(fim >= 0 ? [fim] : []).filter(function (x) { return x >= 0; });
  const cheio = (1 << m) - 1;
  const dp = [], pai = [];
  for (let s = 0; s <= cheio; s++) { dp.push(new Array(m).fill(Infinity)); pai.push(new Array(m).fill(-1)); }
  for (let j = 0; j < m; j++) dp[1 << j][j] = inicio >= 0 ? D[inicio][livres[j]] : 0;
  for (let s = 1; s <= cheio; s++) {
    for (let j = 0; j < m; j++) {
      const atual = dp[s][j];
      if (!(s & (1 << j)) || atual === Infinity) continue;
      for (let k = 0; k < m; k++) {
        if (s & (1 << k)) continue;
        const nv = atual + D[livres[j]][livres[k]];
        const t = s | (1 << k);
        if (nv < dp[t][k] - 1e-12) { dp[t][k] = nv; pai[t][k] = j; }
      }
    }
  }
  let melhor = Infinity, ult = 0;
  for (let j = 0; j < m; j++) {
    const c = dp[cheio][j] + (fechar >= 0 ? D[livres[j]][fechar] : 0);
    if (c < melhor - 1e-12) { melhor = c; ult = j; }
  }
  const seq = [];
  let s = cheio, j = ult;
  while (j >= 0) { seq.unshift(livres[j]); const p = pai[s][j]; s &= ~(1 << j); j = p; }
  const ordem = (inicio >= 0 ? [inicio] : []).concat(seq);
  if (fim >= 0) ordem.push(fim);
  return ordem;
}

function rotaLinkMapa(pts, volta, modo, cidade, semOrigem) {
  const coord = function (p) { return p.lat != null ? p.lat.toFixed(6) + ',' + p.lng.toFixed(6) : p.nome + (p.endereco ? ', ' + p.endereco : cidade ? ', ' + cidade : ''); };
  const seq = pts.slice();
  if (volta && seq.length > 1) seq.push(seq[0]);
  if (!seq.length) return '';
  const destino = seq[seq.length - 1];
  const meio = seq.slice(semOrigem ? 0 : 1, -1);
  let url = 'https://www.google.com/maps/dir/?api=1';
  if (!semOrigem && seq.length > 1) url += '&origin=' + encodeURIComponent(coord(seq[0]));
  url += '&destination=' + encodeURIComponent(coord(destino));
  if (meio.length) url += '&waypoints=' + meio.map(function (p) { return encodeURIComponent(coord(p)); }).join('%7C');
  return url + '&travelmode=' + (ROTA_MODO_MAPA[modo] || 'driving');
}

// pontos: [{ nome, lat, lng }] na ordem em que a pessoa escreveu. opcoes: { otimizar, volta, inicioFixo, fimFixo, modo, minutosPorParada, cidade, semOrigemNoLink }
function planejarRota(pontos, opcoes) {
  const o = opcoes || {};
  const modo = ROTA_VELOCIDADE[o.modo] ? o.modo : 'carro';
  const n = Math.min(pontos.length, ROTA_MAX_PARADAS);
  const pts = pontos.slice(0, n);
  const D = pts.map(function (a) { return pts.map(function (b) { return rotaTrecho(a, b); }); });
  const fimFixo = !!o.fimFixo && n >= 2;
  const volta = !!o.volta && !fimFixo;
  const fim = fimFixo ? n - 1 : -1;
  const original = pts.map(function (_, i) { return i; });
  const kmOriginal = rotaCusto(original, D, volta);
  let ordem = original;
  if (o.otimizar && n > 2) ordem = rotaMelhorOrdem(D, n, o.inicioFixo || volta ? 0 : -1, fim, volta);
  const trechos = [];
  for (let i = 1; i < ordem.length; i++) {
    const km = D[ordem[i - 1]][ordem[i]];
    trechos.push({ de: pts[ordem[i - 1]].nome, para: pts[ordem[i]].nome, km: km, min: km / ROTA_VELOCIDADE[modo] * 60 });
  }
  if (volta && ordem.length > 1) {
    const km = D[ordem[ordem.length - 1]][ordem[0]];
    trechos.push({ de: pts[ordem[ordem.length - 1]].nome, para: pts[ordem[0]].nome, km: km, min: km / ROTA_VELOCIDADE[modo] * 60, volta: true });
  }
  const km = trechos.reduce(function (s, t) { return s + t.km; }, 0);
  const minutosViagem = trechos.reduce(function (s, t) { return s + t.min; }, 0);
  const minutosParadas = (o.minutosPorParada || 0) * pts.length;
  const ordenados = ordem.map(function (i) { return pts[i]; });
  const reordenou = ordem.some(function (v, i) { return v !== i; });
  return {
    ordem: ordenados, trechos: trechos, km: km, minutos: minutosViagem, minutosParadas: minutosParadas, modo: modo, volta: volta,
    kmOriginal: kmOriginal, economiaKm: reordenou ? Math.max(0, kmOriginal - km) : 0, reordenou: reordenou, minutosPorParada: o.minutosPorParada || 0,
    links: [{ rotulo: 'Abrir a rota no app de mapas', url: rotaLinkMapa(ordenados, volta, modo, o.cidade, !!o.semOrigemNoLink) }],
    geojson: {
      type: 'FeatureCollection',
      features: ordenados.map(function (p, i) { return { type: 'Feature', properties: { ordem: i + 1, nome: p.nome }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }; })
        .concat([{ type: 'Feature', properties: { km: Number(km.toFixed(2)), estimativa: true }, geometry: { type: 'LineString', coordinates: ordenados.concat(volta && ordenados.length > 1 ? [ordenados[0]] : []).map(function (p) { return [p.lng, p.lat]; }) } }])
    }
  };
}

// ------------------------------------------------------------------ texto e esquema

function textoDaRota(r) {
  const n = r.ordem.length;
  const nomeModo = ROTA_NOME_MODO[r.modo];
  const cab = (r.reordenou ? 'Ordem sugerida' : 'Rota na ordem pedida') + ' (' + nomeModo + ', ' + n + (n === 1 ? ' parada' : ' paradas') + (r.volta ? ', voltando ao início' : '') + '):';
  const linhas = [cab];
  r.ordem.forEach(function (p, i) {
    if (i === 0) { linhas.push('1. ' + p.nome + ' (saída)'); return; }
    const t = r.trechos[i - 1];
    linhas.push((i + 1) + '. ' + p.nome + ' — ' + rotaKm(t.km) + ' · ~' + rotaTempo(t.min));
  });
  if (r.volta && r.trechos.length) {
    const t = r.trechos[r.trechos.length - 1];
    linhas.push('Volta para ' + t.para + ' — ' + rotaKm(t.km) + ' · ~' + rotaTempo(t.min));
  }
  let total = 'Total: ' + rotaKm(r.km) + ', cerca de ' + rotaTempo(r.minutos) + ' de deslocamento';
  if (r.minutosParadas) total += ' (+ ' + rotaTempo(r.minutosParadas) + ' nas paradas, ' + rotaTempo(r.minutos + r.minutosParadas) + ' no dia)';
  linhas.push(total + '.');
  if (r.reordenou && r.economiaKm >= 0.05) linhas.push('Na ordem em que você escreveu seriam ' + rotaKm(r.kmOriginal) + '; esta economiza cerca de ' + rotaKm(r.economiaKm) + '. Se preferir a sua ordem, peça "nessa ordem".');
  linhas.push('É estimativa: linha reta × ' + String(ROTA_FATOR_RUA).replace('.', ',') + ' (ruas) a ' + String(ROTA_VELOCIDADE[r.modo]).replace('.', ',') + ' km/h, sem trânsito, mão de rua nem horário das unidades. Confira no app de mapas e ligue antes para quem fecha cedo.');
  return linhas.join('\n');
}

// Esquema em linha reta, SEM mapa de fundo (nada é baixado). Nomes escapados: o texto vem do diretório do app.
function svgDaRota(r) {
  const W = 360, H = 260, PAD = 34;
  const pts = r.ordem;
  if (!pts.length) return '';
  const lat0 = pts.reduce(function (s, p) { return s + p.lat; }, 0) / pts.length;
  const kx = Math.cos(lat0 * Math.PI / 180);
  const xs = pts.map(function (p) { return p.lng * kx; }), ys = pts.map(function (p) { return -p.lat; });
  const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  const esc = Math.min((W - 2 * PAD) / Math.max(maxX - minX, 1e-9), (H - 2 * PAD) / Math.max(maxY - minY, 1e-9));
  const ox = (W - (maxX - minX) * esc) / 2, oy = (H - (maxY - minY) * esc) / 2;
  const pos = pts.map(function (_, i) { return [ox + (xs[i] - minX) * esc, oy + (ys[i] - minY) * esc]; });
  const caminho = pos.concat(r.volta && pos.length > 1 ? [pos[0]] : []);
  let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Esquema da rota em linha reta, sem mapa de fundo" style="max-width:100%;height:auto;color:inherit">';
  s += '<polyline points="' + caminho.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="5 4" opacity="0.6"/>';
  pts.forEach(function (p, i) {
    const x = pos[i][0], y = pos[i][1];
    const nome = p.nome.length > 22 ? p.nome.slice(0, 21) + '…' : p.nome;
    const ancora = x > W / 2 ? 'end' : 'start';
    s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="9" fill="currentColor" opacity="0.15" stroke="currentColor"/>';
    s += '<text x="' + x.toFixed(1) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor">' + (i + 1) + '</text>';
    s += '<text x="' + (x + (ancora === 'end' ? -13 : 13)).toFixed(1) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="' + ancora + '" font-size="10" fill="currentColor">' + rotaEscapar(nome) + '</text>';
  });
  return s + '</svg>';
}

// ------------------------------------------------------------------ resposta pronta

const ROTA_EXEMPLO = 'Por exemplo: "traçar rota saindo do CRAS X: UBS Y, CAPS II e Conselho Tutelar, voltando ao CRAS X, de moto, 30 minutos em cada".';

function rotaResposta(texto, extra) {
  return Object.assign({ texto: texto, links: [], svg: '', geojson: null, paradas: [], km: 0, minutos: 0 }, extra || {});
}

function respostaDeRota(texto, opcoes) {
  const o = opcoes || {};
  const ped = lerPedidoDeRota(texto);
  if (!ped) return null;
  const pontos = pontosDeRota(o.pontos);
  const aparelho = o.aparelho && rotaNumero(o.aparelho.lat) === rotaNumero(o.aparelho.lat) && isFinite(rotaNumero(o.aparelho.lat)) && isFinite(rotaNumero(o.aparelho.lng))
    ? { nome: 'Sua posição', lat: rotaNumero(o.aparelho.lat), lng: rotaNumero(o.aparelho.lng) } : null;

  // endereço de residência: não trato (a regra do Paulus é proteger as famílias, e a conversa pode ser guardada pelo app)
  if (ped.paradas.some(function (p) { return ROTA_ENDERECO.test(p); })) {
    return rotaResposta('Não traço rota até endereço de residência: para proteger as famílias, só trabalho com unidades, serviços e bairros. Diga o nome da unidade ou do bairro. Para a casa de uma família, use o app de mapas direto, no aparelho.', { bloqueio: true });
  }
  if (!ped.paradas.length && !ped.origemAparelho) {
    return rotaResposta('Diga de onde sai e quais paradas quer. ' + ROTA_EXEMPLO + (pontos.length ? '' : ' (Este app ainda não me passou o diretório de unidades, então só consigo montar o link do mapa pelos nomes, sem km nem tempo.)'));
  }
  if (ped.paradas.length > ROTA_MAX_PARADAS) {
    return rotaResposta('Consigo ordenar até ' + ROTA_MAX_PARADAS + ' paradas por rota. Divida em duas saídas (por território ou por turno) e peça de novo.');
  }

  const res = resolverParadas(ped.paradas, pontos);
  // Fora do pedido explícito, só responde quem reconhece ao menos uma unidade do diretório e tem duas paradas ("rota de fuga" vai para a IA).
  const achadas = res.filter(function (r) { return r.ponto; }).length;
  if (!ped.explicito && !(achadas >= 1 && res.length + (ped.origemAparelho ? 1 : 0) >= 2)) return null;

  const duvida = res.filter(function (r) { return r.ambiguos; });
  if (duvida.length) {
    return rotaResposta('Mais de uma unidade combina com "' + duvida[0].texto + '": ' + duvida[0].ambiguos.join('; ') + '. Escreva o nome completo da que você quer.', { ambiguo: true });
  }
  const modo = ped.modo || 'carro';
  const cidade = o.cidade ? String(o.cidade) : '';
  const semCoord = res.filter(function (r) { return !r.ponto || r.ponto.lat == null; });
  let paradas = res.map(function (r) { return r.ponto ? { nome: r.ponto.nome, lat: r.ponto.lat, lng: r.ponto.lng, endereco: r.ponto.endereco } : { nome: r.texto, lat: null, lng: null, endereco: '' }; });
  let semOrigem = false;
  if (ped.origemAparelho) {
    if (aparelho) paradas.unshift(aparelho);
    else semOrigem = true;
  }
  const inicioFixo = ped.inicioFixo || (ped.origemAparelho && !!aparelho);

  // Alguma parada sem coordenada: só o link por nome, na ordem escrita, e digo isso.
  if (semCoord.length || !paradas.length) {
    const naoAchadas = res.filter(function (r) { return !r.ponto; }).map(function (r) { return r.texto; });
    const url = rotaLinkMapa(paradas, ped.volta, modo, cidade, semOrigem);
    const msg = (!pontos.length ? 'Este app não me passou o diretório de unidades com coordenadas. ' : naoAchadas.length ? 'Não encontrei no diretório deste app: ' + naoAchadas.join('; ') + '. ' : 'Faltam as coordenadas de: ' + semCoord.map(function (r) { return r.texto; }).join('; ') + '. ') +
      'Sem as coordenadas não calculo km, tempo nem a melhor ordem. Deixei o link do mapa pelos nomes, na ordem que você escreveu' + (cidade ? ' (busca em ' + cidade + ')' : '') + '; confira se o mapa achou o lugar certo.';
    return rotaResposta(msg, { links: url ? [{ rotulo: 'Abrir no app de mapas (por nome)', url: url }] : [], paradas: paradas.map(function (p) { return p.nome; }), semCoordenadas: semCoord.map(function (r) { return r.texto; }), aproximada: true });
  }

  // "como chegar ao X" sem saída: só o destino, o mapa parte da posição de quem pergunta
  if (paradas.length === 1) {
    const p = paradas[0];
    return rotaResposta('Abro o trajeto até ' + p.nome + ' a partir da sua posição atual. Não sei onde você está, então não estimo km nem tempo; o app de mapas mostra.', {
      links: [{ rotulo: 'Abrir a rota no app de mapas', url: rotaLinkMapa([p], false, modo, cidade, true) }], paradas: [p.nome]
    });
  }

  const r = planejarRota(paradas, { otimizar: ped.otimizar === 'sim', volta: ped.volta, inicioFixo: inicioFixo, fimFixo: ped.fimFixo, modo: modo, minutosPorParada: ped.minutosPorParada, cidade: cidade, semOrigemNoLink: semOrigem });
  let corpo = textoDaRota(r);
  if (semOrigem) corpo = 'Saída: a sua posição atual (o app de mapas usa o GPS). Os km abaixo contam só entre as paradas.\n' + corpo;
  return rotaResposta(corpo, { links: r.links, svg: svgDaRota(r), geojson: r.geojson, paradas: r.ordem.map(function (p) { return p.nome; }), km: Number(r.km.toFixed(2)), minutos: Math.round(r.minutos + r.minutosParadas), estimativa: true });
}

// ---- shared/pdf.mjs ----
// Edição de PDF do Paulus: lê o pedido em português e edita o arquivo NO APARELHO. Sem IA, sem rede para o arquivo e sem enviar nada a servidor.
//
// Por que existe: o PDF da pessoa (ficha, declaração, relatório) pode ter dado de família. Por isso ele nunca vai ao Worker nem à IA:
// o programa lê o pedido ("juntar os PDFs", "remover a página 2", "preencher o campo 'Nome' com 'Maria'"), a biblioteca pdf-lib edita
// o arquivo aqui mesmo e o app entrega o resultado para baixar. A IA só explica como pedir (habilidade pdf-editar-no-aparelho).
//
//   lerPedidoDePdf(texto, { temArquivo })   -> { operacoes, naoSuporta, saida } ou null (não é pedido de edição de PDF; a pergunta segue o caminho normal)
//   editarPdf(operacoes, arquivos, opcoes)  -> Promise<{ ok, texto, arquivos, avisos, campos }>   (opcoes.PDFLib = a biblioteca pdf-lib)
//   respostaDePdf(texto, arquivos, opcoes)  -> Promise<resultado | null>   (lê o pedido e, havendo arquivo, edita)
//   resolverPaginasPdf(spec, total)         -> { indices, erro }   (páginas escritas em português, 0-based)
//   listaPaginasPdf([1,2,3,5]) -> "1 a 3 e 5"
//
// arquivos: [{ nome, bytes: Uint8Array | ArrayBuffer }]. Aceita PDF, JPG e PNG (imagem vira página, ou carimbo se o pedido for de carimbo/assinatura).
//
// O que faz: juntar, dividir, extrair, remover, girar, inverter/reordenar, numerar páginas, marca d'água, escrever texto, carimbar imagem,
// preencher e marcar campos de formulário, achatar formulário, título/autor, listar campos, informações do arquivo, imagens em PDF.
// O que NÃO faz (e diz): alterar o texto que já está no PDF, tarjar de verdade, comprimir, OCR, senha, assinatura digital.
// Texto novo usa a fonte Helvetica (acentos do português funcionam; símbolos fora do alfabeto latino viram "?").
// Sem lookbehind e sem BigInt de propósito (Safari/iOS antigos quebram o arquivo inteiro). Nomes com "pdf" por causa do arquivo único do navegador.

const PDF_MAX_ARQUIVOS = 30;
const PDF_MAX_BYTES = 150 * 1048576;
const PDF_MAX_PAGINAS = 3000;
const PDF_MAX_PARTES = 200;
const PDF_MARGEM = 28;

const PDF_VERBOS = 'remov|exclu|apag|retir|elimin|descart|tire|tirar|gir|rotacion|vire|virar|numer|pagin|coloc|escrev|insir|adicion|inclu|marc|desmarc|carimb|preench|complet|achat|invert|reorden|mov|extra|separ|dividi|fatie|junt|unir|une |mescl|combin|defin|troc|mud|alter|salv|anot|aplic|renome|converta|transform|assin';

const PDF_COR = {
  preto: [0, 0, 0], preta: [0, 0, 0], vermelho: [0.8, 0.1, 0.1], vermelha: [0.8, 0.1, 0.1], azul: [0.1, 0.25, 0.75],
  verde: [0.05, 0.5, 0.2], cinza: [0.45, 0.45, 0.45], laranja: [0.9, 0.45, 0.05], roxo: [0.4, 0.15, 0.6]
};

const PDF_NAO_SUPORTA = {
  tarja: 'Tarjar (cobrir dado sensível) eu ainda não faço com segurança: um retângulo por cima não apaga o texto que está embaixo, e quem abrir o arquivo consegue copiá-lo. Para sigilo de verdade, tarje no arquivo de origem (Word, Verbus) e gere o PDF de novo, ou imprima e digitalize.',
  texto: 'Não consigo alterar o texto que já está dentro do PDF: ele guarda letras posicionadas, não parágrafos. Eu posso escrever um texto novo por cima, preencher campos de formulário, numerar, carimbar e mexer nas páginas. Para mudar o conteúdo, corrija no arquivo de origem (Word, Verbus) e gere o PDF de novo.',
  comprimir: 'Comprimir ou reduzir o tamanho do PDF eu ainda não faço aqui. Dá para gerar de novo com qualidade menor no programa de origem, ou usar um compressor offline.',
  senha: 'Não crio nem removo senha de PDF. Se o arquivo é seu e tem senha, abra no leitor com a senha e salve uma cópia (Imprimir > Salvar como PDF); aí eu edito a cópia.',
  ocr: 'Não faço OCR (reconhecer o texto de um PDF escaneado) nem leio o conteúdo do PDF.',
  assinatura: 'Assinatura digital com certificado eu não faço. Posso colocar a imagem de uma assinatura escaneada na página ("colocar a assinatura no canto inferior direito da última página", anexando a imagem), mas isso é só uma imagem e não tem validade de certificado digital.',
  branco: 'Ainda não sei achar páginas em branco sozinha. Diga quais páginas remover, por exemplo: "remover as páginas 3 e 7".',
  converter: 'Converter PDF para Word, Excel ou imagem eu não faço; eu edito PDFs. O contrário funciona: fotos JPG e PNG viram PDF.'
};

// ------------------------------------------------------------------ texto

// Minúsculas e sem acento, MESMO comprimento do original (para fatiar o original pelos índices do normalizado).
function pdfNorm(s) {
  const t = String(s == null ? '' : s);
  let o = '';
  for (let i = 0; i < t.length; i++) o += t.charAt(i).normalize('NFD').charAt(0).toLowerCase();
  return o;
}

// Texto entre aspas vira §0§, §1§... (o que vai escrito no PDF é sempre o que a pessoa pôs entre aspas, nunca adivinhado).
function pdfTirarAspas(texto) {
  const citados = [];
  const t = String(texto == null ? '' : texto).replace(/["“”«»]([^"“”«»]{1,400})["“”«»]|(^|[\s(:])'([^']{1,400})'(?=[\s.,;:)!?]|$)/g, function (m, a, pre, b) {
    citados.push(a != null ? a : b);
    return (pre || '') + '§' + (citados.length - 1) + '§';
  });
  return { texto: t, citados: citados };
}

function pdfDevolver(s, citados) {
  return String(s).replace(/§(\d+)§/g, function (m, i) { return citados[+i] != null ? citados[+i] : ''; });
}

function pdfNumero(w) {
  const t = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
  return /^\d+$/.test(w) ? +w : (t[w] || 0);
}

function pdfNome(s) {
  const t = String(s || 'documento').replace(/^.*[\\/]/, '').replace(/\.(pdf|jpe?g|png)$/i, '');
  const limpo = t.replace(/[^\wÀ-ÿ .()-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return limpo || 'documento';
}

function listaPaginasPdf(pags) {
  const p = (pags || []).slice().sort(function (a, b) { return a - b; });
  const partes = [];
  let i = 0;
  while (i < p.length) {
    let j = i;
    while (j + 1 < p.length && p[j + 1] === p[j] + 1) j++;
    partes.push(j - i >= 2 ? p[i] + ' a ' + p[j] : p.slice(i, j + 1).join(' e '));
    i = j + 1;
  }
  if (partes.length <= 1) return partes.join('');
  return partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1];
}

// ------------------------------------------------------------------ páginas

// Lê "páginas 1 a 3 e 5", "última página", "a partir da 4", "pares"... Devolve { itens:[{de,ate}], filtro:'par'|'impar'|'', todas } ou null.
// Número ≤ 0 conta do fim: 0 = última, -1 = penúltima.
function lerPaginasPdf(n) {
  const itens = [];
  let filtro = '';
  let todas = false;
  if (/\b(todas|todo o (pdf|documento|arquivo)|documento inteiro|arquivo inteiro)\b/.test(n)) todas = true;
  if (/\bpares\b/.test(n)) filtro = 'par'; else if (/\bimpares\b/.test(n)) filtro = 'impar';
  let m = /(?:a partir d[aeo]s?|depois d[aeo]s?|apos)\s*(?:pagina\s*)?(\d+)|(?:pagina\s*)?(\d+)\s*(?:em diante|pra frente|para frente|ate o fim|ate o final)/.exec(n);
  if (m) itens.push({ de: +(m[1] || m[2]), ate: 0 });
  m = /\bate\s+(?:a\s+)?pagina\s*(\d+)/.exec(n);
  if (m && !/\b(?:paginas?|pags?)\s*\d+\s*(?:a|ate|-)\b/.test(n)) itens.push({ de: 1, ate: +m[1] });
  m = /\b(\d+|duas|dois|tres|quatro|cinco)\s+primeiras\s+paginas?\b/.exec(n);
  if (m) itens.push({ de: 1, ate: pdfNumero(m[1]) });
  m = /\b(\d+|duas|dois|tres|quatro|cinco)\s+ultimas\s+paginas?\b|\bultimas?\s+(\d+)\s+paginas?\b/.exec(n);
  if (m) itens.push({ de: 1 - pdfNumero(m[1] || m[2]), ate: 0 });
  m = /\b(primeira|segunda|terceira|quarta|quinta|ultima|penultima)\s+(?:pagina|folha)\b|\b(capa|folha de rosto)\b/.exec(n);
  if (m) {
    const ord = { capa: 1, 'folha de rosto': 1, primeira: 1, segunda: 2, terceira: 3, quarta: 4, quinta: 5, ultima: 0, penultima: -1 };
    const v = ord[m[1] || m[2]];
    itens.push({ de: v, ate: v });
  }
  const re = /\b(?:paginas?|pags?|folhas?)\s*(?:n[o°º]\s*)?(?=\d|ultima|penultima|primeira)/g;
  let k;
  while ((k = re.exec(n))) {
    const resto = n.slice(re.lastIndex, re.lastIndex + 80);
    const tok = /\s*(?:(\d+)|(ultima|penultima|primeira)|(ate|ao|a|-)|(,|e|;))(?![a-z])/y;
    const seq = [];
    let pos = 0;
    for (;;) {
      tok.lastIndex = pos;
      const t = tok.exec(resto);
      if (!t) break;
      pos = tok.lastIndex;
      if (t[1] != null) seq.push({ v: +t[1] });
      else if (t[2]) seq.push({ v: t[2] === 'ultima' ? 0 : t[2] === 'penultima' ? -1 : 1 });
      else if (t[3]) seq.push({ c: 'a' });
      else seq.push({ c: 'e' });
    }
    let i = 0;
    while (i < seq.length) {
      if (seq[i].v == null) { i++; continue; }
      const de = seq[i].v;
      let j = i + 1;
      let faixa = false;
      while (j < seq.length && seq[j].v == null) { if (seq[j].c === 'a') faixa = true; j++; }
      if (faixa && j < seq.length) { itens.push({ de: de, ate: seq[j].v }); i = j + 1; } else { itens.push({ de: de, ate: de }); i = i + 1; }
    }
  }
  return itens.length || filtro || todas ? { itens: itens, filtro: filtro, todas: todas } : null;
}

// Converte o que a pessoa escreveu em índices (0-based) de um arquivo com "total" páginas. Devolve { indices, erro }.
function resolverPaginasPdf(spec, total) {
  const conv = function (v) { return v <= 0 ? total + v : v; };
  const out = [];
  const ver = function (v, orig) {
    if (v < 1 || v > total) return 'A página ' + (orig > 0 ? orig : v) + ' não existe: o arquivo tem ' + total + (total === 1 ? ' página.' : ' páginas.');
    return '';
  };
  if (!spec || (!spec.itens.length)) {
    for (let i = 1; i <= total; i++) out.push(i);
  } else {
    for (let k = 0; k < spec.itens.length; k++) {
      const it = spec.itens[k];
      let a = conv(it.de), b = conv(it.ate);
      const e = ver(a, it.de) || ver(b, it.ate);
      if (e) return { indices: [], erro: e };
      if (a > b) { const t = a; a = b; b = t; }
      for (let p = a; p <= b; p++) if (out.indexOf(p) === -1) out.push(p);
    }
  }
  const filtrada = out.filter(function (p) { return !spec || !spec.filtro || (spec.filtro === 'par' ? p % 2 === 0 : p % 2 === 1); });
  return { indices: filtrada.map(function (p) { return p - 1; }), erro: '' };
}

// ------------------------------------------------------------------ pedido

function pdfPosicao(n, padrao) {
  let v = padrao.v, h = padrao.h;
  if (/\b(superior|topo|cabecalho|em cima|parte de cima|alto da pagina)\b/.test(n)) v = 'sup';
  else if (/\b(inferior|rodape|embaixo|em baixo|parte de baixo|fim da pagina|pe da pagina)\b/.test(n)) v = 'inf';
  else if (/\b(no meio|meio da pagina|no centro|centro da pagina)\b/.test(n)) { v = 'meio'; h = 'centro'; }
  if (/\besquerd/.test(n)) h = 'esq';
  else if (/\bdireit/.test(n)) h = 'dir';
  else if (/\bcentralizad|\bao centro|\bno centro|\bno meio|\bcentro\b/.test(n)) h = 'centro';
  return { v: v, h: h };
}

function pdfCor(n) {
  const m = /\b(preto|preta|vermelh[oa]|azul|verde|cinza|laranja|roxo)\b/.exec(n);
  return m ? PDF_COR[m[1]] : null;
}

function pdfTamanho(n, padrao) {
  const m = /tamanho\s*(?:de\s*)?(\d{1,3})|\b(\d{1,3})\s*(?:pt|pontos)\b|fonte\s*(?:de\s*)?(\d{1,3})/.exec(n);
  const v = m ? +(m[1] || m[2] || m[3]) : padrao;
  return Math.max(6, Math.min(200, v));
}

function pdfNegrito(n) { return /\bnegrito\b/.test(n); }

function pdfPartesDe(n) {
  const m = /\bem\s+(\d+|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(?:partes|arquivos|pedacos|pdfs)\b/.exec(n);
  return m ? pdfNumero(m[1]) : 0;
}

function pdfClausula(o, n, citados) {
  const T = function (re) { return re.test(n); };
  const comAspas = /§\d+§/.test(n);
  const aspas = function () { const r = []; n.replace(/§(\d+)§/g, function (m, i) { r.push(citados[+i]); return m; }); return r; };

  // 1) o que não faz: diz com franqueza em vez de fingir
  if (T(/\b(tarj\w+|censur\w+|ocultar|esconder)\b/) && !T(/\bcampos?\b/)) return { nao: 'tarja' };
  if (T(/\b(comprim\w+|compactar|reduz\w+ (o )?(tamanho|peso)|diminu\w+ (o )?(tamanho|peso)|otimiz\w+ (o )?(pdf|arquivo))/)) return { nao: 'comprimir' };
  if (T(/\b(senha|criptograf\w+)\b/) && !T(/\bcampos?\b/)) return { nao: 'senha' };
  if (T(/\bocr\b|reconhec\w+ (de )?texto|extra\w+ (o )?texto|copiar (o )?texto|\b(ler|leia|resum\w+)\b/)) return { nao: 'ocr' };
  if (T(/assinatura digital|certificado digital|assinar digitalmente|assinar com certificado/)) return { nao: 'assinatura' };
  if (T(/\b(converter|converta|transformar|transforme|exportar|salvar)\b.*\b(em|para|como)\s+(word|docx|excel|xlsx|imagem|jpg|jpeg|png|txt|powerpoint|ppt)\b/)) return { nao: 'converter' };
  if (T(/\bem branco\b/) && T(/\b(remov\w+|exclu\w+|apag\w+|retir\w+|elimin\w+|detect\w+|achar|ache)\b/)) return { nao: 'branco' };

  // 2) metadados: título, autor, assunto, palavras-chave (valor entre aspas)
  if (comAspas && T(/\b(titulo|autor|autora|assunto|palavras? chave)\b/) && !T(/\b(pagina|topo|rodape|canto|cabecalho)\b/)) {
    const meta = {};
    const re = /\b(titulo|autor|autora|assunto|palavras? chave)\b[^§]{0,30}?§(\d+)§/g;
    let m;
    while ((m = re.exec(n))) {
      const k = m[1] === 'titulo' ? 'titulo' : m[1].indexOf('autor') === 0 ? 'autor' : m[1] === 'assunto' ? 'assunto' : 'palavras';
      meta[k] = citados[+m[2]];
    }
    if (Object.keys(meta).length) return { op: 'metadados', meta: meta };
  }

  // 3) olhar sem mexer
  if (!comAspas && T(/\b(list\w+|mostr\w+|quais|ver|exib\w+|quero ver)\b.*\bcampos?\b|\bcampos?\b.*\b(tem|existem|disponiveis|preenchiveis)\b/)) return { op: 'campos' };
  if (T(/quantas paginas|numero de paginas|informac(ao|oes)|propriedades|detalhes d[oa]|que tamanho|inspecion\w+|analis\w+ (o )?(pdf|arquivo)|dados do (pdf|arquivo)/)) return { op: 'info' };

  // 4) juntar
  if (T(/\b(junt\w+|uni[rt]\w*|une|mescl\w+|combin\w+|concaten\w+)\b/) && (T(/\b(pdfs?|arquivos|documentos|fichas|fotos|imagens|paginas|um so|num so|em um|em uma|numa|so arquivo|tudo|todos)\b/) || n.split(' ').length <= 2)) return { op: 'juntar' };
  if (T(/\b(converter|converta|transformar|transforme|gerar|crie|criar|montar|monte|fazer|faca)\b/) && T(/\b(fotos?|imagens?|jpg|jpeg|png|prints?)\b/) && T(/\bpdf\b/)) return { op: 'juntar' };

  // 5) dividir e extrair
  const spec = lerPaginasPdf(n.replace(/§\d+§/g, ' '));
  const temSpec = !!(spec && (spec.itens.length || spec.filtro));
  if (T(/\b(dividi\w*|fatiar|fatie|quebr\w+|particionar|desmembr\w+|picotar)\b/) || (T(/\bseparar?\b|\bseparem?\b|\bseparad\w+\b/) && !temSpec)) {
    const cada = /a cada\s+(\d+|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+paginas?/.exec(n);
    if (cada) return { op: 'dividir', cada: pdfNumero(cada[1]) };
    const partes = pdfPartesDe(n);
    if (partes) return { op: 'dividir', partes: partes };
    if (T(/cada pagina|pagina por pagina|uma por pagina|paginas? individua|uma pagina por arquivo|uma folha por arquivo|todas as paginas|em paginas/)) return { op: 'dividir', cada: 1 };
    const apos = /\b(?:na|depois d[aeo]|apos|a partir d[aeo]|em)\s*(?:pagina\s*)?(\d+)\b/.exec(n);
    if (apos && !/\b(pagina|paginas)\s*\d+\s*(a|ate|-)\s*\d+/.test(n) && (spec == null || spec.itens.length <= 1)) return { op: 'dividir', apos: +apos[1] };
    if (temSpec && spec.itens.length >= 2) return { op: 'dividir', intervalos: spec.itens };
    return { op: 'dividir', cada: 1 };
  }
  if (temSpec && T(/\b(extra\w+|manter|mantenha|ficar so|fique so|deixar so|deixe so|deixar apenas|deixe apenas|salv\w+ (so|apenas|somente)|guardar (so|apenas|somente)|separ\w+|so (as|a|o)|apenas (as|a|o)|somente (as|a|o)|aproveit\w+)\b/)) return { op: 'extrair', spec: spec };

  // 6) remover páginas
  if (T(/\b(remov\w+|exclu\w+|delet\w+|apag\w+|retir\w+|elimin\w+|descart\w+|tir[ae]\w*)\b/) && T(/\b(pagina|paginas|pag|pags|folha|folhas|capa)\b/)) {
    return temSpec ? { op: 'remover', spec: spec } : { op: 'erro', mensagem: 'Diga quais páginas remover, por exemplo: "remover as páginas 2 e 5".' };
  }

  // 7) girar
  if (T(/\b(gir\w+|rotacion\w+|vir[ae]\w*|rode\w*)\b/)) {
    let graus = 90;
    const g = /(?:^|\s)(90|180|270)(?:\s*(?:graus|°|º))?(?=\s|$)/.exec(n);
    if (g) graus = +g[1];
    else if (T(/esquerda|anti.?horario/)) graus = 270;
    else if (T(/cabeca para baixo|de ponta cabeca|meia.?volta/)) graus = 180;
    else if (T(/direita|horario/)) graus = 90;
    if (g && T(/esquerda|anti.?horario/) && graus === 90) graus = 270;
    const sp = lerPaginasPdf(n.replace(/\u00a7\d+\u00a7/g, ' ').replace(/(?:^|\s)(90|180|270)(?:\s*(?:graus|\u00b0|\u00ba))?(?=\s|$)/g, ' '));
    return { op: 'girar', graus: graus, spec: sp && (sp.itens.length || sp.filtro) ? sp : null };
  }

  // 8) reordenar
  if (T(/\binvert\w+\s+(a\s+)?(ordem|paginas)|ordem inversa|de tras (pra|para) frente/)) return { op: 'inverter' };
  const mv = /\bmov\w+\s+(?:a\s+)?pagina\s*(\d+)\s+(?:para|pra|pro)\s+(?:o\s+|a\s+)?(inicio|comeco|topo|fim|final|(?:depois|antes)\s+d[aeo]\s+(?:pagina\s*)?(\d+))/.exec(n);
  if (mv) {
    const alvo = mv[2];
    if (/^(inicio|comeco|topo)$/.test(alvo)) return { op: 'mover', pagina: +mv[1], destino: 'inicio' };
    if (/^(fim|final)$/.test(alvo)) return { op: 'mover', pagina: +mv[1], destino: 'fim' };
    return { op: 'mover', pagina: +mv[1], destino: /^antes/.test(alvo) ? 'antes' : 'depois', ref: +mv[3] };
  }
  const ord = /\b(?:reorden\w+|nova ordem|ordem)\b[^\d]{0,25}((?:\d+\s*(?:,|;|e|-)?\s*){2,})/.exec(n);
  if (ord) {
    const lista = ord[1].split(/[^\d]+/).filter(Boolean).map(Number);
    if (lista.length >= 2) return { op: 'ordem', ordem: lista };
  }

  // 9) numerar páginas
  if (T(/\b(numer\w+|paginar|paginacao|numeracao)\b|coloc\w+ (o )?numero (da|nas|em|de) paginas?/)) {
    const q = aspas()[0];
    let formato = 'Página {n} de {total}';
    if (q) formato = /\{n\}/.test(q) ? q : q + ' {n}';
    else if (T(/\bso (o )?numero\b|apenas (o )?numero|somente (o )?numero|\bsimples\b/)) formato = '{n}';
    const ini = /\b(?:comecand\w+|iniciand\w+|inicie|comece|a partir)\s*(?:em|do|de|no|na)?\s*(?:numero\s*)?(\d+)\b/.exec(n);
    return { op: 'numerar', formato: formato, pos: pdfPosicao(n, { v: 'inf', h: 'centro' }), tamanho: pdfTamanho(n, 10), spec: temSpec ? spec : null, inicio: ini && !/\bpagina\s*\d+/.test(n.slice(Math.max(0, ini.index - 12), ini.index + 14)) ? +ini[1] : 0 };
  }

  // 10) marca d'água
  if (T(/marca\s*d['’]?\s*agua|marca-d|carimbo diagonal|\bmarca\b.*\bdiagonal/)) {
    const q = aspas()[0];
    if (!q) return { op: 'erro', mensagem: 'Escreva o texto da marca d’água entre aspas, por exemplo: marca d’água "CÓPIA".' };
    const op = /(\d{1,3})\s*%/.exec(n);
    return { op: 'marca', texto: q, spec: temSpec ? spec : null, opacidade: op ? Math.max(0.05, Math.min(1, +op[1] / 100)) : 0.18, diagonal: !/\bhorizontal\b/.test(n), cor: pdfCor(n) || [0.5, 0.5, 0.5] };
  }

  // 11) carimbar imagem (assinatura escaneada, logo, selo): o app manda a imagem junto
  const verboColocar = /\b(coloc\w+|insir\w+|adicion\w+|inclu\w+|aplic\w+|carimb\w+|anex\w+|ponha|poe)\b/;
  if (!comAspas && T(verboColocar) && T(/\b(assinatura|carimbo|logo\w*|selo|imagem|foto|rubrica)\b/)) {
    const l = /largura\s*(?:de\s*)?(\d{2,3})|(\d{2,3})\s*(?:pt|pontos)\b/.exec(n);
    return { op: 'imagem', spec: temSpec ? spec : null, pos: pdfPosicao(n, { v: 'inf', h: 'dir' }), largura: l ? +(l[1] || l[2]) : T(/\bgrande\b/) ? 220 : T(/\bpequen/) ? 70 : 130 };
  }

  // 12) preencher campos de formulário (valores sempre entre aspas) e marcar caixas
  if (T(/\b(preench\w+|complet\w+|marc\w+|desmarc\w+|selecion\w+|desselecion\w+)\b/) && !T(/marca\s*d/)) {
    const pares = [];
    const marcas = [];
    const re = /(§\d+§|[a-z0-9][a-z0-9 _.\/-]{0,40}?)\s*(?:=|:|\bcom\b|\bcomo\b|\bpara\b|\bigual a\b|\bsendo\b)\s*(§\d+§)/g;
    let m;
    while ((m = re.exec(n))) {
      let nome = m[1];
      if (nome.charAt(0) !== '§') {
        let ant;
        do { ant = nome; nome = nome.replace(/^(preench\w+|complet\w+|marc\w+|campos?|caixas?|o|a|os|as|e|do|da|de|no|na|em|com|nome do campo|nome)\b\s*/, ''); } while (nome !== ant);
        nome = nome.trim();
        if (!nome && /\bnome\b/.test(m[1])) nome = 'nome';
      }
      const campo = nome.charAt(0) === '§' ? pdfDevolver(nome, citados) : nome;
      if (campo) pares.push({ campo: campo, valor: pdfDevolver(m[2], citados) });
    }
    if (!pares.length && comAspas && T(/\b(marc\w+|desmarc\w+|selecion\w+|desselecion\w+)\b/)) {
      const sim = !T(/\b(desmarc\w+|desselecion\w+)\b/);
      aspas().forEach(function (c) { marcas.push({ campo: c, valor: sim }); });
    }
    if (pares.length || marcas.length) return { op: 'preencher', pares: pares, marcas: marcas, achatar: T(/\b(e|depois)?\s*(achat\w+|trav\w+|bloque\w+)\b/) };
    return { op: 'erro', mensagem: 'Para preencher, escreva o nome do campo e o valor entre aspas, por exemplo: preencher o campo "Nome" com "Maria" e o campo "Cidade" com "Boa Vista". Se não souber os nomes, peça: "listar os campos do PDF".' };
  }

  // 13) achatar (travar o formulário preenchido)
  if (T(/\b(achat\w+|flatten|trav\w+|bloque\w+|fix\w+|congel\w+)\b.*\b(campos?|formulario|ficha|pdf|edicao|preenchimento)\b|nao editavel|somente leitura|so leitura/)) return { op: 'achatar' };

  // 14) escrever um texto novo na página
  if (comAspas && T(/\b(escrev\w+|insir\w+|adicion\w+|coloc\w+|inclu\w+|carimb\w+|anot\w+|digit\w+|imprim\w+|ponha|poe)\b/)) {
    return { op: 'texto', texto: aspas()[0], spec: temSpec ? spec : null, pos: pdfPosicao(n, { v: 'inf', h: 'dir' }), tamanho: pdfTamanho(n, 12), cor: pdfCor(n) || [0, 0, 0], negrito: pdfNegrito(n) };
  }

  // 15) nome do arquivo de saída
  const nm = /\b(?:salv\w+|chame|nome\w*|renome\w+|batiz\w+|intitul\w+)\b[^§]{0,40}\bcomo\s+(§\d+§)|\bcom o nome\s+(§\d+§)/.exec(n);
  if (nm) return { saida: pdfDevolver(nm[1] || nm[2], citados) };

  // 16) mudar o texto existente: não faz
  if (T(/\b(edit\w+|alter\w+|troc\w+|mud\w+|corrig\w+|substitu\w+)\b.*\b(texto|palavra|frase|paragrafo|nome|valor|data|endereco|conteudo)\b/) && !T(/\b(campo|caixa|pagina|autor|titulo)\b/)) return { nao: 'texto' };
  return null;
}

function lerPedidoDePdf(texto, opcoes) {
  const o = opcoes || {};
  const bruto = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim().slice(0, 1500);
  if (!bruto) return null;
  const sem = pdfTirarAspas(bruto.replace(/\b([pP]ags?)\./g, '$1'));
  const n = pdfNorm(sem.texto);
  // Pergunta sobre o assunto (não é um pedido): segue para a IA, que sabe explicar como pedir.
  if (/^(como|o que|oque|por que|porque|quando|onde|me explique|explique|ensine|existe|e possivel|tem como|qual a diferenca)\b/.test(n)) return null;
  if (/^(voce|vc|consegue|sabe|da pra|da para)\b/.test(n) && !o.temArquivo) return null;
  // Sem arquivo anexado só assume quando a mensagem fala em PDF; com arquivo, o pedido de edição basta.
  if (!o.temArquivo && !/\bpdfs?\b/.test(n)) return null;

  const pts = [];
  const re = new RegExp(';\\s*(?=(?:e\\s+)?(?:' + PDF_VERBOS + '))|\\.\\s*(?=(?:' + PDF_VERBOS + '))|\\b(?:depois|em seguida|logo apos|por fim|e entao)\\b|,\\s*(?=(?:e\\s+)?(?:' + PDF_VERBOS + '))|\\be\\s+(?=(?:tambem\\s+)?(?:' + PDF_VERBOS + '))', 'g');
  let m;
  while ((m = re.exec(n))) { pts.push([m.index, m.index + m[0].length]); if (m[0].length === 0) re.lastIndex++; }
  const trechos = [];
  let ini = 0;
  pts.forEach(function (p) { trechos.push([ini, p[0]]); ini = p[1]; });
  trechos.push([ini, n.length]);

  const operacoes = [];
  const naoSuporta = [];
  let saida = null;
  trechos.forEach(function (t) {
    const nn = n.slice(t[0], t[1]).trim();
    if (!nn) return;
    const r = pdfClausula(sem.texto.slice(t[0], t[1]), nn, sem.citados);
    if (!r) return;
    if (r.nao) { if (naoSuporta.indexOf(r.nao) === -1) naoSuporta.push(r.nao); } else if (r.saida) saida = r.saida; else operacoes.push(r);
  });
  if (!operacoes.length && !naoSuporta.length && !saida) return null;
  if (!operacoes.length && saida) operacoes.push({ op: 'copiar' });
  return { operacoes: operacoes, naoSuporta: naoSuporta, saida: saida, avisosDoPedido: naoSuporta.map(function (c) { return PDF_NAO_SUPORTA[c] || ''; }).filter(Boolean) };
}

// ------------------------------------------------------------------ edição (pdf-lib)

function pdfErro(msg) { const e = new Error(msg); e.pdf = true; return e; }

function pdfBytes(b) {
  if (b instanceof Uint8Array) return b;
  if (b && typeof b.byteLength === 'number') return new Uint8Array(b);
  throw pdfErro('Não consegui ler o arquivo.');
}

function pdfTipoDe(b) {
  const n = Math.min(b.length, 1024);
  let ini = '';
  for (let i = 0; i < n; i++) ini += String.fromCharCode(b[i]);
  if (ini.indexOf('%PDF-') !== -1) return 'pdf';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  return '';
}

function pdfKb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

// Letra que a fonte padrão do PDF não tem vira "?" em vez de derrubar o arquivo.
function pdfSeguro(fonte, texto) {
  let out = '';
  Array.from(String(texto).replace(/[\r\n\t]+/g, ' ')).forEach(function (ch) {
    try { fonte.encodeText(ch); out += ch; } catch (e) { out += '?'; }
  });
  return out;
}

// A página pode estar girada: tudo é desenhado no sistema "visual" (como a pessoa vê) e convertido para as coordenadas reais da página.
function pdfCaixa(page) {
  const cb = page.getCropBox ? page.getCropBox() : page.getMediaBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const w = cb.width, h = cb.height;
  return { x0: cb.x, y0: cb.y, w: w, h: h, rot: rot, vw: rot % 180 ? h : w, vh: rot % 180 ? w : h };
}

function pdfParaCru(c, vx, vy) {
  if (c.rot === 90) return { x: c.x0 + c.w - vy, y: c.y0 + vx };
  if (c.rot === 180) return { x: c.x0 + c.w - vx, y: c.y0 + c.h - vy };
  if (c.rot === 270) return { x: c.x0 + vy, y: c.y0 + c.h - vx };
  return { x: c.x0 + vx, y: c.y0 + vy };
}

function pdfPonto(c, pos, larg, alt) {
  const vx = pos.h === 'esq' ? PDF_MARGEM : pos.h === 'centro' ? (c.vw - larg) / 2 : c.vw - PDF_MARGEM - larg;
  const vy = pos.v === 'inf' ? PDF_MARGEM : pos.v === 'sup' ? c.vh - PDF_MARGEM - alt : (c.vh - alt) / 2;
  return { vx: vx, vy: vy };
}

async function pdfFonte(L, d, negrito) {
  const k = negrito ? 'fonteN' : 'fonteR';
  if (!d[k]) d[k] = await d.doc.embedFont(negrito ? L.StandardFonts.HelveticaBold : L.StandardFonts.Helvetica);
  return d[k];
}

function pdfDataHoje(agora) {
  const x = agora instanceof Date ? agora : new Date();
  const p = function (v) { return (v < 10 ? '0' : '') + v; };
  return p(x.getDate()) + '/' + p(x.getMonth() + 1) + '/' + x.getFullYear();
}

function pdfIndices(L, d, spec, padrao) {
  const total = d.doc.getPageCount();
  if (!spec) return padrao === 'ultima' ? [total - 1] : padrao === 'primeira' ? [0] : resolverPaginasPdf(null, total).indices;
  const r = resolverPaginasPdf(spec, total);
  if (r.erro) throw pdfErro((d.multi ? d.nome + ': ' : '') + r.erro);
  if (!r.indices.length) throw pdfErro('Nenhuma página combina com o pedido (' + (spec.filtro === 'par' ? 'pares' : spec.filtro === 'impar' ? 'ímpares' : 'as páginas pedidas') + ').');
  return r.indices;
}

async function pdfCopiar(L, d, ordem) {
  const novo = await L.PDFDocument.create();
  const cp = await novo.copyPages(d.doc, ordem);
  cp.forEach(function (p) { novo.addPage(p); });
  try { const t = d.doc.getTitle(), a = d.doc.getAuthor(); if (t) novo.setTitle(t); if (a) novo.setAuthor(a); } catch (e) { /* sem metadados */ }
  return novo;
}

function pdfTemCampos(d) {
  try { return d.doc.getForm().getFields().length; } catch (e) { return 0; }
}

function pdfTipoCampo(L, f) {
  if (L.PDFTextField && f instanceof L.PDFTextField) return 'texto';
  if (L.PDFCheckBox && f instanceof L.PDFCheckBox) return 'caixa de marcar';
  if (L.PDFRadioGroup && f instanceof L.PDFRadioGroup) return 'escolha única';
  if (L.PDFDropdown && f instanceof L.PDFDropdown) return 'lista suspensa';
  if (L.PDFOptionList && f instanceof L.PDFOptionList) return 'lista';
  if (L.PDFButton && f instanceof L.PDFButton) return 'botão';
  if (L.PDFSignature && f instanceof L.PDFSignature) return 'assinatura';
  return 'campo';
}

function pdfChave(s) { return pdfNorm(s).replace(/[^a-z0-9]+/g, ' ').trim(); }

function pdfAcharCampo(campos, consulta) {
  const q = pdfChave(consulta);
  if (!q) return { campo: null, motivo: 'nenhum' };
  const lista = campos.map(function (f) { return { f: f, k: pdfChave(f.getName()) }; });
  const exato = lista.filter(function (x) { return x.k === q; });
  if (exato.length === 1) return { campo: exato[0].f };
  const aprox = lista.filter(function (x) { return x.k && q.length >= 2 && (x.k.indexOf(q) !== -1 || (x.k.length >= 3 && q.indexOf(x.k) !== -1)); });
  if (aprox.length === 1) return { campo: aprox[0].f };
  if (aprox.length > 1 || exato.length > 1) return { campo: null, motivo: 'varios', opcoes: (aprox.length ? aprox : exato).map(function (x) { return x.f.getName(); }) };
  return { campo: null, motivo: 'nenhum' };
}

function pdfSim(v) { return /^(sim|s|x|true|1|marcad[oa]|ok|yes|check\w*)$/i.test(String(v).trim()); }
function pdfNao(v) { return /^(nao|não|n|false|0|desmarcad[oa]|no|vazio|uncheck\w*)$/i.test(String(v).trim()); }

function pdfOpcaoDe(opcoes, valor) {
  const q = pdfChave(valor);
  const ex = opcoes.filter(function (x) { return pdfChave(x) === q; });
  if (ex.length) return ex[0];
  const ap = opcoes.filter(function (x) { const k = pdfChave(x); return k && q && (k.indexOf(q) !== -1 || q.indexOf(k) !== -1); });
  return ap.length === 1 ? ap[0] : '';
}

function pdfPreencher(L, d, op, rel) {
  const form = d.doc.getForm();
  const campos = form.getFields();
  if (!campos.length) throw pdfErro((d.multi ? d.nome + ': ' : '') + 'Este PDF não tem campos de formulário preenchíveis. Eu consigo escrever um texto em qualquer ponto da página: escreva "texto" entre aspas e diga onde (ex.: escrever "Maria" no topo da página 1).');
  const feitos = [];
  const marcados = [];
  const pendencias = [];
  const nomes = function () { return campos.map(function (f) { return f.getName(); }).slice(0, 15).join(', ') + (campos.length > 15 ? '…' : ''); };
  (op.pares || []).concat((op.marcas || []).map(function (m) { return { campo: m.campo, valor: m.valor ? 'sim' : 'não', marca: true }; })).forEach(function (par) {
    const a = pdfAcharCampo(campos, par.campo);
    let f = a.campo;
    let opcaoDireta = '';
    if (!f && par.marca) {
      // "marcar 'Sim'": pode ser a opção de um grupo de escolha única ou de uma lista
      campos.forEach(function (c) {
        if (f || !((L.PDFRadioGroup && c instanceof L.PDFRadioGroup) || (L.PDFDropdown && c instanceof L.PDFDropdown) || (L.PDFOptionList && c instanceof L.PDFOptionList))) return;
        const opc = pdfOpcaoDe(c.getOptions(), par.campo);
        if (opc) { f = c; opcaoDireta = opc; }
      });
    }
    if (!f) {
      pendencias.push(a.motivo === 'varios' ? 'O campo "' + par.campo + '" combina com mais de um (' + a.opcoes.slice(0, 6).join(', ') + '). Use o nome completo.' : 'Não achei o campo "' + par.campo + '". Campos deste PDF: ' + nomes() + '.');
      return;
    }
    const tipo = pdfTipoCampo(L, f);
    try {
      if (tipo === 'texto') {
        if (par.marca) { pendencias.push('"' + par.campo + '" é um campo de texto, não uma caixa de marcar.'); return; }
        try { f.setText(par.valor); } catch (e1) {
          if (/max|length|exceed/i.test(String(e1 && e1.message))) { pendencias.push('O valor de "' + f.getName() + '" é maior do que o campo aceita.'); return; }
          f.setText(Array.from(String(par.valor)).map(function (ch) { try { return ch.charCodeAt(0) < 256 ? ch : '?'; } catch (e2) { return '?'; } }).join(''));
        }
      } else if (tipo === 'caixa de marcar') {
        if (pdfNao(par.valor)) f.uncheck(); else if (pdfSim(par.valor) || par.marca) f.check(); else { pendencias.push('Para a caixa "' + f.getName() + '" use "sim" ou "não".'); return; }
      } else if (tipo === 'escolha única' || tipo === 'lista suspensa' || tipo === 'lista') {
        const opc = opcaoDireta || pdfOpcaoDe(f.getOptions(), par.valor);
        if (!opc) { pendencias.push('"' + par.valor + '" não é uma opção de "' + f.getName() + '". Opções: ' + f.getOptions().slice(0, 10).join(', ') + '.'); return; }
        f.select(opc);
      } else { pendencias.push('O campo "' + f.getName() + '" é do tipo ' + tipo + ' e eu não preencho esse tipo.'); return; }
      feitos.push(f.getName());
      if (tipo !== 'texto') marcados.push(f.getName());
    } catch (e) {
      pendencias.push('Não consegui preencher "' + par.campo + '"' + (e && e.message ? ' (' + String(e.message).slice(0, 80) + ')' : '') + '.');
    }
  });
  const textos = feitos.filter(function (x) { return marcados.indexOf(x) === -1; });
  const pre = d.multi ? d.nome + ': ' : '';
  if (textos.length) rel.feito.push(pre + 'Preenchi ' + (textos.length === 1 ? 'o campo ' : 'os campos ') + textos.join(', ') + '.');
  if (marcados.length) rel.feito.push(pre + 'Marquei/escolhi ' + marcados.join(', ') + '.');
  pendencias.forEach(function (p) { rel.avisos.push(p); });
  if (!feitos.length) throw pdfErro(pendencias.join(' ') || 'Não consegui preencher nenhum campo.');
}

function pdfListarCampos(L, d, rel) {
  const campos = d.doc.getForm().getFields();
  const linhas = campos.map(function (f) {
    let extra = '';
    try { if (/escolha|lista/.test(pdfTipoCampo(L, f))) extra = ' (opções: ' + f.getOptions().slice(0, 8).join(', ') + ')'; } catch (e) { /* sem opções */ }
    return f.getName() + ' [' + pdfTipoCampo(L, f) + ']' + extra;
  });
  rel.campos.push({ arquivo: d.nome, campos: linhas });
  rel.leitura.push((d.multi ? d.nome + ': ' : '') + (campos.length ? 'campos preenchíveis (' + campos.length + '): ' + linhas.join('; ') + '.' : 'não tem campos de formulário preenchíveis.'));
}

function pdfInformar(d, bytes, rel) {
  const n = d.doc.getPageCount();
  const p = d.doc.getPage(0).getSize();
  const mm = function (v) { return Math.round(v * 25.4 / 72); };
  const a4 = Math.abs(p.width - 595) < 4 && Math.abs(p.height - 842) < 4;
  const carta = Math.abs(p.width - 612) < 4 && Math.abs(p.height - 792) < 4;
  let t = (d.multi ? d.nome + ': ' : '') + n + (n === 1 ? ' página' : ' páginas') + ', ' + (a4 ? 'A4' : carta ? 'Carta' : mm(p.width) + ' × ' + mm(p.height) + ' mm') + ', ' + pdfKb(bytes) + ', ' + pdfTemCampos(d) + ' campo(s) de formulário';
  try { if (d.doc.getTitle()) t += ', título "' + d.doc.getTitle() + '"'; if (d.doc.getAuthor()) t += ', autor "' + d.doc.getAuthor() + '"'; } catch (e) { /* sem metadados */ }
  rel.leitura.push(t + '.');
}

async function pdfAplicar(L, op, ctx) {
  const docs = ctx.docs, rel = ctx.rel, o = ctx.o;
  const dizer = function (d, t) { rel.feito.push((d.multi ? d.nome + ': ' : '') + t); };
  const marcar = function (d, s) { if (d.sufixos.indexOf(s) === -1) d.sufixos.push(s); };

  if (op.op === 'copiar' || op.op === 'erro') {
    if (op.op === 'erro') throw pdfErro(op.mensagem);
    return;
  }
  if (op.op === 'juntar') {
    const novo = await L.PDFDocument.create();
    let pags = 0, arqs = 0, comCampos = 0;
    for (let i = 0; i < ctx.fontes.length; i++) {
      const f = ctx.fontes[i];
      if (f.tipo === 'pdf') {
        const d = docs.filter(function (x) { return x.fonte === f; })[0];
        if (!d) continue;
        if (pdfTemCampos(d)) comCampos++;
        const cp = await novo.copyPages(d.doc, d.doc.getPageIndices());
        cp.forEach(function (p) { novo.addPage(p); });
        pags += cp.length; arqs++;
      } else if (!ctx.estampa) {
        await pdfPaginaDeImagem(L, novo, f);
        pags++; arqs++;
      }
    }
    if (arqs < 2 && !ctx.fontes.some(function (f) { return f.tipo !== 'pdf'; })) throw pdfErro('Para juntar, anexe dois ou mais PDFs (ou fotos).');
    const base = docs.length ? docs[0].nome : 'documento';
    ctx.docs = [{ nome: base, doc: novo, sufixos: ['-unido'], multi: false, fonte: null, juntado: true }];
    rel.feito.push('Juntei ' + arqs + (arqs === 1 ? ' arquivo' : ' arquivos') + ' em um só (' + pags + (pags === 1 ? ' página' : ' páginas') + ').');
    if (comCampos) rel.avisos.push('Ao juntar, os campos de formulário preenchíveis podem deixar de ser editáveis no arquivo final. Se for preencher, preencha antes de juntar ou peça para achatar.');
    return;
  }
  if (op.op === 'dividir') {
    const novos = [];
    for (let k = 0; k < docs.length; k++) {
      const d = docs[k];
      const total = d.doc.getPageCount();
      let blocos = [];
      if (op.cada) { for (let i = 0; i < total; i += op.cada) blocos.push(pdfFaixa(i, Math.min(total, i + op.cada))); }
      else if (op.partes) { const tam = Math.ceil(total / op.partes); for (let i = 0; i < total; i += tam) blocos.push(pdfFaixa(i, Math.min(total, i + tam))); }
      else if (op.apos) {
        if (op.apos < 1 || op.apos >= total) throw pdfErro('Para dividir depois da página ' + op.apos + ', o arquivo precisa ter mais páginas (tem ' + total + ').');
        blocos = [pdfFaixa(0, op.apos), pdfFaixa(op.apos, total)];
      } else if (op.intervalos) {
        for (let i = 0; i < op.intervalos.length; i++) {
          const r = resolverPaginasPdf({ itens: [op.intervalos[i]], filtro: '' }, total);
          if (r.erro) throw pdfErro(r.erro);
          blocos.push(r.indices);
        }
      }
      if (blocos.length > PDF_MAX_PARTES) throw pdfErro('Isso daria mais de ' + PDF_MAX_PARTES + ' arquivos. Divida em partes maiores.');
      if (blocos.length < 2) { rel.avisos.push((d.multi ? d.nome + ': ' : '') + 'O arquivo não tem páginas suficientes para dividir assim; mantive inteiro.'); novos.push(d); continue; }
      for (let i = 0; i < blocos.length; i++) {
        const b = blocos[i];
        const nd = await pdfCopiar(L, d, b);
        const sufixo = op.intervalos || op.apos ? '-p' + (b[0] + 1) + (b.length > 1 ? '-' + (b[b.length - 1] + 1) : '') : '-parte-' + (i + 1);
        novos.push({ nome: d.nome, doc: nd, sufixos: [sufixo], multi: true, fonte: null, parte: true });
      }
      dizer(d, 'Dividi em ' + blocos.length + ' arquivos.');
      if (pdfTemCampos(d)) rel.avisos.push('Ao dividir, os campos de formulário preenchíveis podem deixar de ser editáveis nas partes.');
    }
    ctx.docs = novos;
    return;
  }
  for (let k = 0; k < docs.length; k++) {
    const d = docs[k];
    const total = d.doc.getPageCount();
    if (op.op === 'extrair') {
      const idx = pdfIndices(L, d, op.spec);
      const cresc = idx.every(function (v, i) { return i === 0 || v > idx[i - 1]; });
      if (cresc) { for (let i = total - 1; i >= 0; i--) if (idx.indexOf(i) === -1) d.doc.removePage(i); }
      else d.doc = await pdfCopiar(L, d, idx);
      marcar(d, '-paginas-' + listaPaginasPdf(idx.map(function (i) { return i + 1; })).replace(/ e /g, '-e-').replace(/ a /g, '-a-').replace(/, /g, '-'));
      dizer(d, 'Deixei só ' + (idx.length === 1 ? 'a página ' : 'as páginas ') + listaPaginasPdf(idx.map(function (i) { return i + 1; })) + ' (' + idx.length + ').');
    } else if (op.op === 'remover') {
      const idx = pdfIndices(L, d, op.spec);
      if (idx.length >= total) throw pdfErro('Isso removeria todas as páginas. Se quer só uma parte, use "extrair".');
      idx.slice().sort(function (a, b) { return b - a; }).forEach(function (i) { d.doc.removePage(i); });
      marcar(d, '-editado');
      dizer(d, 'Removi ' + (idx.length === 1 ? 'a página ' : 'as páginas ') + listaPaginasPdf(idx.map(function (i) { return i + 1; })) + '. Agora são ' + d.doc.getPageCount() + '.');
    } else if (op.op === 'girar') {
      const idx = pdfIndices(L, d, op.spec);
      idx.forEach(function (i) {
        const p = d.doc.getPage(i);
        p.setRotation(L.degrees((((p.getRotation().angle + op.graus) % 360) + 360) % 360));
      });
      marcar(d, '-girado');
      dizer(d, 'Girei ' + (idx.length === total ? 'todas as páginas' : (idx.length === 1 ? 'a página ' : 'as páginas ') + listaPaginasPdf(idx.map(function (i) { return i + 1; }))) + ' ' + (op.graus === 90 ? '90° para a direita' : op.graus === 270 ? '90° para a esquerda' : '180°') + '.');
    } else if (op.op === 'inverter' || op.op === 'mover' || op.op === 'ordem') {
      let ordem = pdfFaixa(0, total);
      if (op.op === 'inverter') ordem.reverse();
      else if (op.op === 'mover') {
        const p = op.pagina - 1;
        if (p < 0 || p >= total) throw pdfErro('A página ' + op.pagina + ' não existe: o arquivo tem ' + total + '.');
        ordem.splice(p, 1);
        let pos = op.destino === 'inicio' ? 0 : op.destino === 'fim' ? ordem.length : 0;
        if (op.destino === 'antes' || op.destino === 'depois') {
          const r = op.ref - 1;
          if (r < 0 || r >= total || r === p) throw pdfErro('A página de referência ' + op.ref + ' não serve para esse movimento.');
          const at = ordem.indexOf(r);
          pos = op.destino === 'antes' ? at : at + 1;
        }
        ordem.splice(pos, 0, p);
      } else {
        const o2 = op.ordem.map(function (v) { return v - 1; });
        const ok = o2.length === total && pdfFaixa(0, total).every(function (i) { return o2.indexOf(i) !== -1; });
        if (!ok) throw pdfErro('A nova ordem precisa listar as ' + total + ' páginas, sem repetir nenhuma (ex.: 3, 1, 2).');
        ordem = o2;
      }
      if (pdfTemCampos(d)) rel.avisos.push((d.multi ? d.nome + ': ' : '') + 'Ao reordenar, os campos de formulário preenchíveis podem deixar de ser editáveis.');
      d.doc = await pdfCopiar(L, d, ordem);
      marcar(d, '-reordenado');
      dizer(d, op.op === 'inverter' ? 'Inverti a ordem das páginas.' : op.op === 'mover' ? 'Movi a página ' + op.pagina + ' (' + (op.destino === 'inicio' ? 'para o início' : op.destino === 'fim' ? 'para o fim' : op.destino + ' da página ' + op.ref) + ').' : 'Reordenei as páginas: ' + op.ordem.join(', ') + '.');
    } else if (op.op === 'numerar') {
      const idx = pdfIndices(L, d, op.spec);
      const fonte = await pdfFonte(L, d, false);
      idx.forEach(function (i, j) {
        const page = d.doc.getPage(i);
        const c = pdfCaixa(page);
        const n = (op.inicio || 0) ? op.inicio + j : i + 1;
        const texto = pdfSeguro(fonte, op.formato.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String((op.inicio || 0) ? op.inicio + idx.length - 1 : total)));
        const larg = fonte.widthOfTextAtSize(texto, op.tamanho);
        const pt = pdfPonto(c, op.pos, larg, op.tamanho * 0.75);
        const cru = pdfParaCru(c, pt.vx, pt.vy);
        page.drawText(texto, { x: cru.x, y: cru.y, size: op.tamanho, font: fonte, color: L.rgb(0.15, 0.15, 0.15), rotate: L.degrees(c.rot) });
      });
      marcar(d, '-numerado');
      dizer(d, 'Numerei ' + (idx.length === total ? 'todas as páginas' : (idx.length === 1 ? 'a página ' : 'as páginas ') + listaPaginasPdf(idx.map(function (i) { return i + 1; }))) + ' no ' + (op.pos.v === 'sup' ? 'topo' : op.pos.v === 'meio' ? 'meio' : 'rodapé') + ', ' + (op.pos.h === 'esq' ? 'à esquerda' : op.pos.h === 'dir' ? 'à direita' : 'ao centro') + ' (modelo "' + op.formato + '").');
    } else if (op.op === 'marca') {
      const idx = pdfIndices(L, d, op.spec);
      const fonte = await pdfFonte(L, d, true);
      const texto = pdfSeguro(fonte, op.texto).slice(0, 60);
      idx.forEach(function (i) {
        const page = d.doc.getPage(i);
        const c = pdfCaixa(page);
        const tw1 = fonte.widthOfTextAtSize(texto, 1) || 1;
        const alvo = op.diagonal ? Math.sqrt(c.vw * c.vw + c.vh * c.vh) * 0.62 : c.vw * 0.8;
        const tam = Math.max(10, Math.min(140, alvo / tw1));
        const tw = tw1 * tam;
        const ang = op.diagonal ? Math.atan2(c.vh, c.vw) : 0;
        const s = tam * 0.3;
        const ax = c.vw / 2 - ((tw / 2) * Math.cos(ang) - s * Math.sin(ang));
        const ay = c.vh / 2 - ((tw / 2) * Math.sin(ang) + s * Math.cos(ang));
        const cru = pdfParaCru(c, ax, ay);
        page.drawText(texto, { x: cru.x, y: cru.y, size: tam, font: fonte, color: L.rgb(op.cor[0], op.cor[1], op.cor[2]), opacity: op.opacidade, rotate: L.degrees(c.rot + ang * 180 / Math.PI) });
      });
      marcar(d, '-marca-dagua');
      dizer(d, 'Coloquei a marca d’água "' + texto + '" em ' + (idx.length === total ? 'todas as páginas' : (idx.length === 1 ? 'a página ' : 'as páginas ') + listaPaginasPdf(idx.map(function (i) { return i + 1; }))) + '.');
    } else if (op.op === 'texto') {
      const idx = pdfIndices(L, d, op.spec, 'primeira');
      const fonte = await pdfFonte(L, d, op.negrito);
      idx.forEach(function (i, j) {
        const page = d.doc.getPage(i);
        const c = pdfCaixa(page);
        const texto = pdfSeguro(fonte, op.texto.replace(/\{data\}/g, pdfDataHoje(o.agora)).replace(/\{n\}/g, String(i + 1)).replace(/\{total\}/g, String(total)));
        const larg = fonte.widthOfTextAtSize(texto, op.tamanho);
        const pt = pdfPonto(c, op.pos, larg, op.tamanho * 0.75);
        const cru = pdfParaCru(c, pt.vx, pt.vy);
        page.drawText(texto, { x: cru.x, y: cru.y, size: op.tamanho, font: fonte, color: L.rgb(op.cor[0], op.cor[1], op.cor[2]), rotate: L.degrees(c.rot) });
      });
      marcar(d, '-carimbado');
      dizer(d, 'Escrevi "' + pdfSeguro(fonte, op.texto.replace(/\{data\}/g, pdfDataHoje(o.agora)).replace(/\{n\}/g, String(idx[0] + 1)).replace(/\{total\}/g, String(total))) + '" na ' + (idx.length === 1 ? 'página ' : 'páginas ') + listaPaginasPdf(idx.map(function (i) { return i + 1; })) + ', ' + (op.pos.v === 'sup' ? 'no topo' : op.pos.v === 'meio' ? 'no meio' : 'no rodapé') + (op.pos.h === 'esq' ? ' à esquerda' : op.pos.h === 'dir' ? ' à direita' : ' ao centro') + '.');
    } else if (op.op === 'imagem') {
      const img = ctx.fontes.filter(function (f) { return f.tipo !== 'pdf'; })[0];
      if (!img) throw pdfErro('Para colocar assinatura, carimbo ou logo, anexe também a imagem (JPG ou PNG) junto com o PDF.');
      const idx = pdfIndices(L, d, op.spec, 'ultima');
      const emb = img.tipo === 'png' ? await d.doc.embedPng(img.bytes) : await d.doc.embedJpg(img.bytes);
      idx.forEach(function (i) {
        const page = d.doc.getPage(i);
        const c = pdfCaixa(page);
        const larg = Math.min(op.largura, c.vw * 0.8);
        const alt = larg * emb.height / emb.width;
        const pt = pdfPonto(c, op.pos, larg, alt);
        const cru = pdfParaCru(c, pt.vx, pt.vy);
        page.drawImage(emb, { x: cru.x, y: cru.y, width: larg, height: alt, rotate: L.degrees(c.rot) });
      });
      marcar(d, '-com-imagem');
      dizer(d, 'Coloquei a imagem na ' + (idx.length === 1 ? 'página ' : 'páginas ') + listaPaginasPdf(idx.map(function (i) { return i + 1; })) + ', ' + (op.pos.v === 'sup' ? 'no topo' : op.pos.v === 'meio' ? 'no meio' : 'no rodapé') + (op.pos.h === 'esq' ? ' à esquerda' : op.pos.h === 'dir' ? ' à direita' : ' ao centro') + (op.spec ? '' : ' (última página, porque você não disse qual)') + '.');
    } else if (op.op === 'preencher') {
      pdfPreencher(L, d, op, rel);
      marcar(d, '-preenchido');
      if (op.achatar) { d.doc.getForm().flatten(); dizer(d, 'Travei o formulário: os campos deixaram de ser editáveis.'); }
    } else if (op.op === 'achatar') {
      if (!pdfTemCampos(d)) throw pdfErro((d.multi ? d.nome + ': ' : '') + 'Este PDF não tem campos de formulário para travar.');
      d.doc.getForm().flatten();
      marcar(d, '-travado');
      dizer(d, 'Travei o formulário: o que estava preenchido ficou fixo no papel, sem edição.');
    } else if (op.op === 'metadados') {
      if (op.meta.titulo != null) d.doc.setTitle(op.meta.titulo);
      if (op.meta.autor != null) d.doc.setAuthor(op.meta.autor);
      if (op.meta.assunto != null) d.doc.setSubject(op.meta.assunto);
      if (op.meta.palavras != null) d.doc.setKeywords(String(op.meta.palavras).split(/\s*[,;]\s*/));
      marcar(d, '-editado');
      dizer(d, 'Atualizei ' + Object.keys(op.meta).map(function (c) { return c === 'palavras' ? 'as palavras-chave' : c === 'titulo' ? 'o título' : 'o ' + c; }).join(' e ') + ' do arquivo.');
    } else if (op.op === 'campos') {
      pdfListarCampos(L, d, rel);
      rel.soLeitura = true;
    } else if (op.op === 'info') {
      pdfInformar(d, d.tamanho, rel);
      rel.soLeitura = true;
    }
  }
}

function pdfFaixa(a, b) { const r = []; for (let i = a; i < b; i++) r.push(i); return r; }

async function pdfPaginaDeImagem(L, novo, f) {
  const emb = f.tipo === 'png' ? await novo.embedPng(f.bytes) : await novo.embedJpg(f.bytes);
  const paisagem = emb.width > emb.height;
  const W = paisagem ? 841.89 : 595.28, H = paisagem ? 595.28 : 841.89;
  const page = novo.addPage([W, H]);
  const esc = Math.min((W - 40) / emb.width, (H - 40) / emb.height);
  const w = emb.width * esc, h = emb.height * esc;
  page.drawImage(emb, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
}

async function editarPdf(operacoes, arquivos, opcoes) {
  const o = opcoes || {};
  const L = o.PDFLib;
  const rel = { feito: [], avisos: [], leitura: [], campos: [], soLeitura: false };
  const falha = function (texto) { return { ok: false, texto: texto, arquivos: [], avisos: rel.avisos, campos: rel.campos }; };
  if (!L || !L.PDFDocument) return falha('Não consegui carregar o editor de PDF neste aparelho. Ele baixa uma vez e depois funciona offline; confira a internet e tente de novo.');
  if (!Array.isArray(arquivos) || !arquivos.length) return falha('Anexe o PDF que você quer editar.');
  if (arquivos.length > PDF_MAX_ARQUIVOS) return falha('Muitos arquivos de uma vez (o limite é ' + PDF_MAX_ARQUIVOS + ').');
  const ops = Array.isArray(operacoes) ? operacoes.filter(Boolean) : [];
  const estampa = ops.some(function (x) { return x.op === 'imagem'; });

  const fontes = [];
  let somaBytes = 0;
  for (let i = 0; i < arquivos.length; i++) {
    const a = arquivos[i] || {};
    let bytes;
    try { bytes = pdfBytes(a.bytes); } catch (e) { rel.avisos.push('Não consegui ler "' + (a.nome || 'arquivo') + '".'); continue; }
    somaBytes += bytes.length;
    if (somaBytes > PDF_MAX_BYTES) return falha('Os arquivos somam mais de ' + Math.round(PDF_MAX_BYTES / 1048576) + ' MB; mande menos de uma vez.');
    let tipo = pdfTipoDe(bytes);
    if (!tipo && typeof o.converterImagem === 'function') {
      try { const conv = await o.converterImagem(bytes, a); if (conv) { bytes = pdfBytes(conv); tipo = pdfTipoDe(bytes); } } catch (e) { /* segue sem converter */ }
    }
    if (!tipo) { rel.avisos.push('Ignorei "' + (a.nome || 'arquivo') + '": só trabalho com PDF, JPG e PNG.'); continue; }
    const f = { nome: pdfNome(a.nome), tipo: tipo, bytes: bytes };
    if (tipo === 'pdf') {
      try { f.doc = await L.PDFDocument.load(bytes, { updateMetadata: false }); } catch (e) {
        const msg = String(e && e.message || '');
        rel.avisos.push(/encrypt/i.test(msg) ? '"' + f.nome + '.pdf" está protegido com senha; abra no leitor com a senha e salve uma cópia sem proteção.' : '"' + f.nome + '.pdf" não abriu: o arquivo pode estar corrompido.');
        continue;
      }
      if (f.doc.getPageCount() > PDF_MAX_PAGINAS) { rel.avisos.push('"' + f.nome + '.pdf" tem páginas demais (' + f.doc.getPageCount() + ').'); continue; }
    }
    fontes.push(f);
  }
  if (!fontes.length) return falha(rel.avisos.join(' ') || 'Não encontrei PDF para editar.');

  const pdfs = fontes.filter(function (f) { return f.tipo === 'pdf'; });
  const imgs = fontes.filter(function (f) { return f.tipo !== 'pdf'; });
  const docs = pdfs.map(function (f) { return { nome: f.nome, doc: f.doc, tamanho: f.bytes.length, sufixos: [], multi: pdfs.length > 1, fonte: f }; });
  const ctx = { docs: docs, fontes: fontes, estampa: estampa, rel: rel, o: o };

  let lista = ops.slice();
  if (!estampa && imgs.length && !lista.some(function (x) { return x.op === 'juntar'; })) {
    if (!pdfs.length) lista.unshift({ op: 'juntar' });
    else rel.avisos.push('Ignorei as imagens anexadas. Para incluí-las no PDF, peça "juntar".');
  }
  if (!lista.length) return falha('Entendi o arquivo, mas não entendi o que fazer com ele. Peça, por exemplo: "remover a página 2", "juntar", "numerar as páginas" ou "listar os campos".');
  if (estampa && !imgs.length) return falha('Para colocar assinatura, carimbo ou logo, anexe também a imagem (JPG ou PNG) junto com o PDF.');
  if (!pdfs.length && estampa) return falha('Anexe também o PDF em que a imagem deve entrar.');

  try {
    for (let i = 0; i < lista.length; i++) await pdfAplicar(L, lista[i], ctx);
  } catch (e) {
    if (e && e.pdf) return falha(e.message);
    return falha('Não consegui concluir a edição (' + String(e && e.message || e).slice(0, 120) + '). O arquivo original não foi alterado.');
  }

  const saidas = [];
  if (!rel.soLeitura || rel.feito.length) {
    const nomeFixo = o.saida ? pdfNome(o.saida) : '';
    for (let i = 0; i < ctx.docs.length; i++) {
      const d = ctx.docs[i];
      let bytes;
      try { bytes = await d.doc.save(); } catch (e) { return falha('Não consegui salvar o resultado (' + String(e && e.message || e).slice(0, 100) + ').'); }
      const suf = d.sufixos.length === 1 ? d.sufixos[0] : d.sufixos.length ? '-editado' : '';
      let nome = nomeFixo ? nomeFixo + (ctx.docs.length > 1 ? (d.sufixos[0] && d.parte ? d.sufixos[0] : '-' + (i + 1)) : '') : d.nome + suf;
      if (!nomeFixo && !suf) nome = d.nome + '-editado';
      saidas.push({ nome: nome + '.pdf', bytes: bytes, tipo: 'application/pdf', paginas: d.doc.getPageCount(), tamanho: bytes.length });
    }
  }

  const linhas = [];
  if (saidas.length) {
    linhas.push(saidas.length === 1 ? 'Pronto: o PDF editado está para baixar.' : 'Pronto: ' + saidas.length + ' arquivos para baixar.');
    rel.feito.forEach(function (t) { linhas.push('- ' + t); });
    saidas.slice(0, 12).forEach(function (s) { linhas.push('Arquivo: ' + s.nome + ' (' + s.paginas + (s.paginas === 1 ? ' página' : ' páginas') + ', ' + pdfKb(s.tamanho) + ')'); });
    if (saidas.length > 12) linhas.push('… e mais ' + (saidas.length - 12) + ' arquivos.');
  }
  rel.leitura.forEach(function (t) { linhas.push(t); });
  rel.avisos.forEach(function (t) { linhas.push('Atenção: ' + t); });
  return { ok: true, texto: linhas.join('\n'), arquivos: saidas, avisos: rel.avisos, campos: rel.campos };
}

// Lê o pedido e, havendo arquivo, edita. Sem arquivo anexado, devolve o que entendeu e pede o PDF. Não é pedido de PDF: null.
async function respostaDePdf(texto, arquivos, opcoes) {
  const o = opcoes || {};
  const temArquivo = Array.isArray(arquivos) && arquivos.length > 0;
  const pedido = lerPedidoDePdf(texto, { temArquivo: temArquivo });
  if (!pedido) return null;
  const avisosPedido = pedido.avisosDoPedido || [];
  if (!pedido.operacoes.length) {
    return { ok: false, texto: avisosPedido.join('\n\n'), arquivos: [], avisos: [], naoSuporta: pedido.naoSuporta, pedido: pedido };
  }
  if (!temArquivo) {
    return { ok: false, precisaArquivo: true, texto: 'Consigo fazer isso aqui no aparelho, mas preciso do PDF: anexe o arquivo e peça de novo.' + (avisosPedido.length ? '\n\n' + avisosPedido.join('\n\n') : ''), arquivos: [], avisos: [], naoSuporta: pedido.naoSuporta, pedido: pedido };
  }
  const r = await editarPdf(pedido.operacoes, arquivos, Object.assign({}, o, { saida: pedido.saida }));
  if (avisosPedido.length) { r.texto += (r.texto ? '\n\n' : '') + avisosPedido.join('\n\n'); r.avisos = r.avisos.concat(avisosPedido); }
  r.naoSuporta = pedido.naoSuporta;
  r.pedido = pedido;
  return r;
}

// ---- shared/visitas.mjs ----
// Ordem de visita domiciliar, no aparelho: sem IA, sem rede, sem coordenadas.
//
// Recebe endereços de texto ("Rua Santo Agostinho, nº 193 — Centenário") e devolve a ordem em que a equipe
// deve visitar. Regras (nesta ordem):
//   1. a rua de partida vem primeiro, depois as demais ruas do mesmo bairro, depois os outros bairros;
//   2. dentro do bairro, rua por rua (ordem alfabética: sem mapa, é o único critério estável);
//   3. dentro da rua, em serpentina: sobe pelos números ímpares e desce pelos pares (lados opostos da rua);
//      na rua de partida, começa pelo número mais próximo do de partida;
//   4. S/N e endereço sem número vão ao fim da rua; endereço ilegível ou vazio vai ao fim de tudo, na ordem original;
//   5. o mesmo endereço fica junto (famílias no mesmo imóvel).
// É uma aproximação por texto. Quem conhece o território pode e deve ajustar a ordem à mão.
//
// v0.15.0 — o que a ordem ganha, SEMPRE no aparelho e sem mandar endereço a lugar nenhum:
//   - nomes de rua normalizados ("Cap. Ene Garcez" = "Capitão Ene Garcez"; erro de digitação de uma letra não cria rua nova);
//   - ordem natural ("Rua 2" antes de "Rua 10"; antes era alfabética pura e a 10 vinha antes da 2);
//   - opcoes.geo: se o app tem as coordenadas das ruas/bairros, a ordem das ruas passa a ser a de MENOR DESLOCAMENTO (busca exata até 9 ruas,
//     vizinho mais próximo + 2-opt acima disso) e a resposta traz km estimado e a economia sobre a ordem alfabética;
//   - opcoes.vizinhanca: ruas que a equipe já visitou em sequência (aprendidas quando a pessoa ajusta a ordem) viram "perto" onde não há coordenada;
//   - opcoes.ordemDeRuas: uma IA (ou a pessoa) pode propor SÓ a ordem das ruas; o programa valida, põe as casas em ordem dentro de cada rua e confere o km.
//     Por isso a IA nunca precisa ver número de casa, e uma resposta inválida dela é descartada (cai na ordem do programa).
// Sem geo, sem vizinhança e sem ordemDeRuas o resultado é o de sempre (só com nome normalizado e ordem natural).
//
// Privacidade: função pura. O endereço de residência nunca sai da função (nem para IA, nem para a rede).

const TIPOS_VISITA = {
  rua: 'rua', r: 'rua', avenida: 'avenida', av: 'avenida', travessa: 'travessa', tv: 'travessa', alameda: 'alameda',
  estrada: 'estrada', br: 'br', rr: 'rr', rodovia: 'rodovia', beco: 'beco', praca: 'praca', vicinal: 'vicinal', via: 'via',
  passagem: 'passagem', largo: 'largo', loteamento: 'loteamento', conjunto: 'conjunto', residencial: 'residencial',
  quadra: 'quadra', ramal: 'ramal'
};

function semAcentoV(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function compactarV(s) { return semAcentoV(s).replace(/[^a-z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

// Abreviações de título no nome da rua: "Cap. Ene Garcez" e "Capitão Ene Garcez" são a mesma rua (o Cadastro Único e a digitação misturam).
const ABREV_NOME_V = { sto: 'santo', sta: 'santa', cap: 'capitao', cel: 'coronel', gal: 'general', mal: 'marechal', pres: 'presidente', prof: 'professor', profa: 'professora', dr: 'doutor', dra: 'doutora', eng: 'engenheiro', ten: 'tenente', sen: 'senador', dep: 'deputado', gov: 'governador' };
function canonicoNomeV(chave) { return String(chave).split(' ').map(function (w) { return ABREV_NOME_V[w] || w; }).join(' '); }
function limparBairroV(txt) { return compactarV(String(txt || '').replace(/\bcep\b.*$/i, '').replace(/\bbairro\b\s*:?/i, '').replace(/\b(?:boa vista|roraima|rr)\b.*$/i, '')); }

// Ordem natural: "rua 2" vem antes de "rua 10" (a comparação alfabética pura punha a 10 antes da 2).
const COLATOR_V = (function () { try { return new Intl.Collator('pt-BR', { numeric: true }); } catch (e) { return null; } })();
function compararV(a, b) { return COLATOR_V ? COLATOR_V.compare(a, b) : String(a).localeCompare(String(b), 'pt-BR'); }

function editaV(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let ant = []; for (let j = 0; j <= b.length; j++) ant.push(j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let menor = i;
    for (let j = 1; j <= b.length; j++) { const v = Math.min(ant[j] + 1, cur[j - 1] + 1, ant[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)); cur.push(v); if (v < menor) menor = v; }
    if (menor > max) return max + 1;
    ant = cur;
  }
  return ant[b.length];
}

function tituloV(s) { return String(s || '').split(' ').filter(Boolean).map(function (w, i) { return i > 0 && /^(?:de|da|do|das|dos|e)$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1); }).join(' '); }

// Complemento do imóvel (apto 3, casa 2, bloco B, qd 5, lt 12): não faz parte do nome da rua nem do número.
const KW_COMPL = '(?:apto|apt|ap|apartamento|casa|cs|bloco|bl|qd|quadra|lt|lote|sala|sl|torre|andar|fundos|frente)';
const RE_PARTE_COMPL = new RegExp('^(?:' + KW_COMPL + '(?: ?\\d+[a-z]?| [a-z])?\\s*)+$');
const RE_FIM_COMPL = new RegExp('(?:,|\\s)\\s*' + KW_COMPL + ' ?(?:\\d+[a-z]?|[a-z])$');
const RE_PARTE_NUM = /^(?:n |numero |num )?(?:\d{1,6}(?: ?[a-z])?|s ?\/ ?n|sn|sem numero)$/;

// "Rua Santo Agostinho, nº 193 — Centenário" -> { tipo, chave, numero, semNumero, bairro } ou null se ilegível
function analisarEnderecoVisita(texto) {
  const bruto = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim();
  if (!bruto) return null;
  // bairro: depois de travessão ou hífen com espaços ("... 193 — Centenário", "... 245 - 13 de Setembro")
  const partes = bruto.split(/\s+[—–-]\s+/);
  let via = partes[0];
  let bairroTxt = partes.slice(1).join(' ');
  // vírgulas: "Rua X, 12, casa 2, Bairro Y" / "Rua X, Bairro Y" (complemento sai; o que vem depois do número é bairro)
  const pc = via.split(/\s*,\s*/).filter((s) => s && !RE_PARTE_COMPL.test(compactarV(s)));
  const temVirgula = pc.length >= 2;
  if (temVirgula) {
    const k = pc.findIndex((s, i) => i > 0 && RE_PARTE_NUM.test(compactarV(s)));
    if (k > 0) { via = pc.slice(0, k + 1).join(', '); if (!bairroTxt) bairroTxt = pc.slice(k + 1).join(' '); }
    else if (!bairroTxt && !pc.slice(1).some((s) => /\d/.test(s))) { via = pc[0]; bairroTxt = pc.slice(1).join(' '); }
    else via = pc.join(', ');
  } else if (pc.length === 1) via = pc[0];
  const bairro = limparBairroV(bairroTxt);

  let v = compactarV(via);
  const mt = /^(r|av|tv|[a-z]+)\.? /.exec(v + ' ');
  let tipo = '';
  if (mt && TIPOS_VISITA[mt[1]]) { tipo = TIPOS_VISITA[mt[1]]; v = v.slice(mt[0].length - 1).trim(); }
  // sem tipo ("Santo Agostinho, 193"): só vale se houver vírgula e número; senão é texto solto, ilegível
  if (!tipo && !temVirgula) return null;
  while (RE_FIM_COMPL.test(v)) v = v.replace(RE_FIM_COMPL, '').trim();

  // número: "..., nº 193", "..., 193", "... 193", "10-A", "s/n"
  let numero = null; let semNumero = false;
  let m = /(?:,\s*|\s+)(?:n[o°º]?\.?\s*|numero\s*|num\s*)?(s\s*\/\s*n|sn|sem numero)$/.exec(v);
  if (m) { semNumero = true; v = v.slice(0, m.index).trim(); }
  else {
    m = /(?:,\s*|\s+)(?:n[o°º]?\.?\s*|numero\s*|num\s*)?(\d{1,6})(?: ?[a-z])?$/.exec(v);
    // "Rua 7 de Setembro" não tem número de imóvel; "Rua 7" (sem mais nada) também não: o 7 é o nome da rua
    if (m && v.slice(0, m.index).trim() && !/\b(?:de|da|do|das|dos|e)$/.test(v.slice(0, m.index).trim())) {
      numero = parseInt(m[1], 10); v = v.slice(0, m.index).trim();
    }
  }
  const chave = canonicoNomeV(v.replace(/,/g, ' ').replace(/\bn[o°º]?$/, '').replace(/\s+/g, ' ').trim());
  if (!chave) return null;
  if (!tipo && numero === null && !semNumero) return null;
  return { tipo, chave, numero, semNumero: semNumero || numero === null, bairro };
}

// ------------------------------------------------------------------ geografia (opcional)

const KM_RUA_V = 1.3;   // linha reta × 1,3, o mesmo fator de shared/rota.mjs
const MAX_EXATO_V = 9;  // até 9 ruas: ordem ótima exata; acima, vizinho mais próximo + 2-opt

function coordV(lat, lng) {
  const a = Number(lat), b = Number(lng);
  return isFinite(a) && isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180 && !(a === 0 && b === 0) ? [a, b] : null;
}

function kmV(a, b) {
  const rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(x)));
}

// "Rua Santo Agostinho" -> { tipo, chave } (mesma normalização do endereço da família)
function lerViaV(texto) {
  let v = compactarV(texto);
  if (!v) return null;
  const mt = /^(r|av|tv|[a-z]+)\.? /.exec(v + ' ');
  let tipo = '';
  if (mt && TIPOS_VISITA[mt[1]]) { tipo = TIPOS_VISITA[mt[1]]; v = v.slice(mt[0].length - 1).trim(); }
  return v ? { tipo, chave: canonicoNomeV(v) } : null;
}

// geo: { ruas: [{ rua: 'Rua Santo Agostinho', bairro: 'Centenário', lat, lng }], bairros: [{ bairro: 'Centenário', lat, lng }] }
// Só dado público do mapa (centro da rua ou do bairro), nunca ponto de residência de família.
function prepararGeo(geo) {
  const g = { ruas: new Map(), semBairro: new Map(), indef: new Map(), porBairro: new Map(), bairros: new Map(), n: 0 };
  if (!geo || typeof geo !== 'object') return g;
  (Array.isArray(geo.ruas) ? geo.ruas : []).slice(0, 20000).forEach((r) => {
    const ponto = r && coordV(r.lat, r.lng); const via = r && lerViaV(r.rua || r.nome);
    if (!ponto || !via) return;
    const b = limparBairroV(r.bairro); const k = via.tipo + ' ' + via.chave;
    g.ruas.set(k + '|' + b, ponto);
    if (!g.semBairro.has(k)) g.semBairro.set(k, []);
    g.semBairro.get(k).push(ponto);
    if (!b) { if (!g.indef.has(k)) g.indef.set(k, []); g.indef.get(k).push(ponto); }   // rua do mapa sem bairro informado: serve a qualquer bairro, se for a única de mesmo nome
    const kb = via.tipo + '|' + b;
    if (!g.porBairro.has(kb)) g.porBairro.set(kb, []);
    g.porBairro.get(kb).push({ chave: via.chave, ponto });
    g.n++;
  });
  (Array.isArray(geo.bairros) ? geo.bairros : []).slice(0, 2000).forEach((b) => {
    const ponto = b && coordV(b.lat, b.lng); const nome = b && limparBairroV(b.bairro || b.nome);
    if (ponto && nome) { g.bairros.set(nome, ponto); g.n++; }
  });
  return g;
}

// Onde fica esta rua? { ponto, nivel: 'rua' | 'bairro' } ou null. Aceita uma letra errada no nome (nomes com 8+ letras e sem número).
function pontoDaRuaV(g, tipo, chave, bairro) {
  if (!g || !g.n) return null;
  const k = tipo + ' ' + chave;
  let p = g.ruas.get(k + '|' + bairro);
  if (p) return { ponto: p, nivel: 'rua' };
  if (!bairro) { const l = g.semBairro.get(k); if (l && l.length === 1) return { ponto: l[0], nivel: 'rua' }; }
  else { const l = g.indef.get(k); if (l && l.length === 1 && (g.semBairro.get(k) || []).length === 1) return { ponto: l[0], nivel: 'rua' }; }
  if (chave.length >= 8 && !/\d/.test(chave)) {
    const lista = g.porBairro.get(tipo + '|' + bairro) || [];
    for (let i = 0; i < lista.length; i++) if (!/\d/.test(lista[i].chave) && editaV(chave, lista[i].chave, 1) <= 1) return { ponto: lista[i].ponto, nivel: 'rua' };
  }
  const b = bairro ? g.bairros.get(bairro) : null;
  return b ? { ponto: b, nivel: 'bairro' } : null;
}

// ------------------------------------------------------------------ vizinhança aprendida (ruas visitadas em sequência)

const VIZ_MAX_PARES = 1500, VIZ_MAX_CONTAGEM = 20, VIZ_SEP = ' <> ';
function chaveParV(a, b) { return a < b ? a + VIZ_SEP + b : b + VIZ_SEP + a; }
function vizinhancaVazia() { return { v: 1, pares: {} }; }

function vizinhancaPares(viz) {
  return viz && typeof viz === 'object' && viz.pares && typeof viz.pares === 'object' && !Array.isArray(viz.pares) ? viz.pares : null;
}

// Depois que a equipe ajusta a ordem à mão, guarda quais ruas ela pôs em sequência (só nome de rua e bairro, nunca número de casa nem nome de pessoa).
// Devolve um objeto NOVO; quem guarda (localStorage etc.) é o app. A próxima ordem usa isso onde não há coordenada.
function aprenderVizinhanca(viz, itensEmOrdem, partida) {
  const pares = Object.assign({}, vizinhancaPares(viz) || {});
  const P = prepararV(itensEmOrdem, partida);
  const seq = [];
  P.dados.forEach((d) => { if (d.a && (!seq.length || seq[seq.length - 1] !== d.unid)) seq.push(d.unid); });
  for (let i = 1; i < seq.length; i++) {
    if (seq[i - 1] === seq[i]) continue;
    const k = chaveParV(seq[i - 1], seq[i]);
    pares[k] = Math.min(VIZ_MAX_CONTAGEM, (Number(pares[k]) || 0) + 1);
  }
  const chaves = Object.keys(pares);
  if (chaves.length > VIZ_MAX_PARES) chaves.sort((x, y) => pares[y] - pares[x]).slice(VIZ_MAX_PARES).forEach((k) => { delete pares[k]; });
  return { v: 1, pares };
}

function resumoVizinhanca(viz) {
  const pares = vizinhancaPares(viz) || {}; const ruas = new Set();
  Object.keys(pares).forEach((k) => { k.split(VIZ_SEP).forEach((r) => ruas.add(r)); });
  return { ligacoes: Object.keys(pares).length, ruas: ruas.size };
}

// ------------------------------------------------------------------ agrupar em ruas

function prepararV(itens, partida) {
  const lista = Array.isArray(itens) ? itens : [];
  const p = analisarEnderecoVisita(partida);
  const dados = lista.map((item, i) => ({ item, i, a: analisarEnderecoVisita(item && item.endereco), unid: '' }));
  const legiveis = dados.filter((d) => d.a);
  const ilegiveis = dados.filter((d) => !d.a);

  // ruas: mesmo tipo + nome + bairro. "Rua 1" do Pintolândia e "Rua 1" do Caranã são ruas diferentes;
  // endereço sem bairro entra na única rua de mesmo nome, se houver só uma.
  const ruas = new Map();
  const idRua = (a) => a.tipo + ' ' + a.chave + '|' + a.bairro;
  legiveis.forEach((d) => {
    const id = idRua(d.a);
    let r = ruas.get(id);
    if (!r) { r = { id, tipo: d.a.tipo, chave: d.a.chave, bairro: d.a.bairro, primeiro: d.i, itens: [] }; ruas.set(id, r); }
    r.itens.push(d);
  });
  Array.from(ruas.values()).filter((r) => !r.bairro).forEach((r) => {
    const iguais = Array.from(ruas.values()).filter((x) => x !== r && x.tipo === r.tipo && x.chave === r.chave);
    if (iguais.length === 1) { iguais[0].itens = iguais[0].itens.concat(r.itens); iguais[0].primeiro = Math.min(iguais[0].primeiro, r.primeiro); ruas.delete(r.id); }
  });
  // uma letra errada no nome ("Santo Agostino") não cria rua nova: junta na grafia mais usada, no mesmo bairro
  const porTamanho = Array.from(ruas.values()).sort((x, y) => y.itens.length - x.itens.length || x.primeiro - y.primeiro);
  for (let i = 0; i < porTamanho.length; i++) {
    const r = porTamanho[i];
    if (!ruas.has(r.id) || r.chave.length < 8 || /\d/.test(r.chave)) continue;
    for (let j = 0; j < i; j++) {
      const k = porTamanho[j];
      if (!ruas.has(k.id) || k.tipo !== r.tipo || (k.bairro !== r.bairro && k.bairro && r.bairro) || /\d/.test(k.chave)) continue;
      if (editaV(r.chave, k.chave, 1) <= 1) { k.itens = k.itens.concat(r.itens); k.primeiro = Math.min(k.primeiro, r.primeiro); ruas.delete(r.id); break; }
    }
  }
  const arr = Array.from(ruas.values());
  arr.forEach((r) => { r.itens.forEach((d) => { d.unid = r.id; }); });
  const ehPartida = (r) => !!p && r.tipo === p.tipo && r.chave === p.chave && (!p.bairro || !r.bairro || r.bairro === p.bairro);
  return { lista, p, dados, ilegiveis, ruas: arr, ehPartida };
}

// Ordem de sempre: partida, bairro da partida, outros bairros na ordem em que aparecem, rua por rua em ordem natural.
function ordemLegadaV(P) {
  const { p, ruas, ehPartida } = P;
  const bairros = [];
  if (p && p.bairro) bairros.push(p.bairro);
  ruas.slice().sort((x, y) => x.primeiro - y.primeiro).forEach((r) => { if (r.bairro && bairros.indexOf(r.bairro) < 0) bairros.push(r.bairro); });
  const rang = (b) => (b ? bairros.indexOf(b) : bairros.length);
  return ruas.slice().sort((x, y) => {
    const px = ehPartida(x) ? 0 : 1; const py = ehPartida(y) ? 0 : 1;
    if (px !== py) return px - py;
    const bx = rang(x.bairro); const by = rang(y.bairro);
    if (bx !== by) return bx - by;
    return compararV(x.chave, y.chave) || compararV(x.tipo, y.tipo) || x.primeiro - y.primeiro;
  });
}

// As ruas de uma lista de visitas, SEM número de casa: é o que se pode mostrar a uma IA (ou à tela) para ela propor a ordem das ruas.
// ids: use-os em opcoes.ordemDeRuas.
function ruasDasVisitas(itens, partida) {
  const P = prepararV(itens, partida);
  return {
    ruas: ordemLegadaV(P).map((r) => ({ id: r.id, rotulo: tituloV((r.tipo ? r.tipo + ' ' : '') + r.chave) + (r.bairro ? ' — ' + tituloV(r.bairro) : ''), bairro: tituloV(r.bairro), quantidade: r.itens.length })),
    ilegiveis: P.ilegiveis.length
  };
}

// ------------------------------------------------------------------ menor caminho entre ruas

function custoCaminhoV(o, D) { let c = 0; for (let i = 1; i < o.length; i++) c += D[o[i - 1]][o[i]]; return c; }

// Busca exata (programação dinâmica sobre subconjuntos). inicio: índice fixo ou -1.
function caminhoExatoV(D, n, inicio) {
  const cheio = (1 << n) - 1; const dp = []; const pai = [];
  for (let m = 0; m <= cheio; m++) { dp.push(new Array(n).fill(Infinity)); pai.push(new Array(n).fill(-1)); }
  for (let j = 0; j < n; j++) if (inicio < 0 || j === inicio) dp[1 << j][j] = 0;
  for (let m = 1; m <= cheio; m++) {
    for (let j = 0; j < n; j++) {
      const a = dp[m][j];
      if (a === Infinity || !(m & (1 << j))) continue;
      for (let k = 0; k < n; k++) {
        if (m & (1 << k)) continue;
        const t = m | (1 << k); const nv = a + D[j][k];
        if (nv < dp[t][k] - 1e-12) { dp[t][k] = nv; pai[t][k] = j; }
      }
    }
  }
  let melhor = Infinity; let ult = 0;
  for (let j = 0; j < n; j++) if (dp[cheio][j] < melhor - 1e-12) { melhor = dp[cheio][j]; ult = j; }
  const seq = []; let m = cheio; let j = ult;
  while (j >= 0) { seq.unshift(j); const q = pai[m][j]; m &= ~(1 << j); j = q; }
  return seq;
}

function doisOptV(o, D, fixo) {
  const n = o.length;
  for (let volta = 0; volta < 60; volta++) {
    let melhorou = false;
    for (let i = fixo ? 1 : 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = i > 0 ? o[i - 1] : -1; const b = o[i]; const c = o[j]; const d = j < n - 1 ? o[j + 1] : -1;
        const delta = (a >= 0 ? D[a][c] - D[a][b] : 0) + (d >= 0 ? D[b][d] - D[c][d] : 0);
        if (delta < -1e-9) { for (let x = i, y = j; x < y; x++, y--) { const t = o[x]; o[x] = o[y]; o[y] = t; } melhorou = true; }
      }
    }
    if (!melhorou) break;
  }
  return o;
}

function caminhoHeuristicoV(D, n, inicio) {
  const comecos = [];
  if (inicio >= 0) comecos.push(inicio); else if (n <= 60) for (let i = 0; i < n; i++) comecos.push(i); else comecos.push(0);
  let melhor = null; let melhorC = Infinity;
  comecos.forEach((s) => {
    const o = [s]; const usado = new Array(n).fill(false); usado[s] = true;
    while (o.length < n) {
      const at = o[o.length - 1]; let prox = -1;
      for (let k = 0; k < n; k++) if (!usado[k] && (prox < 0 || D[at][k] < D[at][prox] - 1e-12)) prox = k;
      usado[prox] = true; o.push(prox);
    }
    doisOptV(o, D, inicio >= 0);
    const c = custoCaminhoV(o, D);
    if (c < melhorC - 1e-12) { melhorC = c; melhor = o; }
  });
  return melhor;
}

// Ordena as ruas pela menor distância. Empate (distância igual) mantém a ordem de entrada, que é a alfabética natural.
function otimizarRuasV(base, P, ctx) {
  const virtual = ctx.partidaPonto && !base.some((r) => P.ehPartida(r)) ? { id: '\u0000partida', ponto: ctx.partidaPonto, virtual: true } : null;
  const nos = (virtual ? [virtual] : []).concat(base);
  const n = nos.length;
  const pesoV = ctx.viz;
  const D = nos.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const u = nos[i]; const v = nos[j]; let d;
      if (u.ponto && v.ponto) d = kmV(u.ponto, v.ponto) * KM_RUA_V;
      else if (pesoV && pesoV[chaveParV(u.id, v.id)] > 0) d = 0.15;
      else if (u.bairro && u.bairro === v.bairro) d = 0.6;
      else d = 2.5;
      d += 1e-6 * (j - i);   // desempate: na dúvida, a ordem de entrada
      D[i][j] = d; D[j][i] = d;
    }
  }
  let inicio = virtual ? 0 : -1;
  if (!virtual) base.forEach((r, i) => { if (inicio < 0 && P.ehPartida(r)) inicio = i; });
  const ordem = n <= MAX_EXATO_V ? caminhoExatoV(D, n, inicio) : caminhoHeuristicoV(D, n, inicio);
  return ordem.map((i) => nos[i]).filter((r) => !r.virtual);
}

function kmDaOrdemV(rotas, partidaPonto, primeiraEhPartida) {
  if (rotas.length < 1 || rotas.some((r) => !r.ponto)) return null;
  let km = 0;
  if (partidaPonto && !primeiraEhPartida) km += kmV(partidaPonto, rotas[0].ponto) * KM_RUA_V;
  for (let i = 1; i < rotas.length; i++) km += kmV(rotas[i - 1].ponto, rotas[i].ponto) * KM_RUA_V;
  return km;
}

// ------------------------------------------------------------------ ordem

function ordenarCasasV(r, p, ehPartidaRua, serpentina) {
  const comNumero = r.itens.filter((d) => d.a.numero !== null).sort((x, y) => x.a.numero - y.a.numero || x.i - y.i);
  const semNum = r.itens.filter((d) => d.a.numero === null).sort((x, y) => x.i - y.i);
  let meio = comNumero;
  if (serpentina) {
    const impares = comNumero.filter((d) => d.a.numero % 2 === 1);
    const pares = comNumero.filter((d) => d.a.numero % 2 === 0);
    let subida = impares; let volta = pares.slice().reverse();
    // rua de partida: começa pelo lado e pelo número mais próximos do ponto de partida
    if (ehPartidaRua && p.numero !== null) {
      const lado = p.numero % 2 === 1 ? impares : pares;
      const outro = p.numero % 2 === 1 ? pares : impares;
      const ate = lado.filter((d) => d.a.numero >= p.numero);
      const antes = lado.filter((d) => d.a.numero < p.numero).reverse();
      subida = ate.concat(antes);
      volta = outro.slice().sort((x, y) => Math.abs(x.a.numero - p.numero) - Math.abs(y.a.numero - p.numero) || x.i - y.i);
    }
    meio = subida.concat(volta);
  }
  return meio.concat(semNum);
}

// itens: [{ endereco }]  ->  { itens (reordenados), indices (posição original de cada um), ilegiveis (quantos foram ao fim),
//   metodo: 'texto' | 'geografia' | 'aprendido' | 'ruas-informadas', ruas: [{ id, rotulo, quantidade }],
//   km, kmLegado, economiaKm, nivelGeo ('rua' | 'bairro' | ''), cobertura (0 a 1, parte das ruas com coordenada), ordemRuasInvalida?, ordemRuasIncompleta? }
// opcoes: { serpentina (padrão true), geo, partidaPonto: { lat, lng }, vizinhanca, ordemDeRuas: [ids] }
function ordenarVisitas(itens, partida, opcoes) {
  const o = Object.assign({ serpentina: true }, opcoes || {});
  const P = prepararV(itens, partida);
  const { p, ilegiveis, ehPartida } = P;
  const legado = ordemLegadaV(P);

  // coordenadas
  const g = prepararGeo(o.geo);
  let comPonto = 0; let soBairro = false;
  P.ruas.forEach((r) => {
    const x = pontoDaRuaV(g, r.tipo, r.chave, r.bairro);
    if (x) { r.ponto = x.ponto; comPonto++; if (x.nivel === 'bairro') soBairro = true; }
  });
  let partidaPonto = o.partidaPonto ? coordV(o.partidaPonto.lat, o.partidaPonto.lng) : null;
  if (!partidaPonto && p) { const x = pontoDaRuaV(g, p.tipo, p.chave, p.bairro); if (x) partidaPonto = x.ponto; }
  const viz = vizinhancaPares(o.vizinhanca);
  const ids = new Set(P.ruas.map((r) => r.id));
  let temVizinha = false;
  if (viz) { const l = P.ruas; for (let i = 0; i < l.length && !temVizinha; i++) for (let j = i + 1; j < l.length; j++) if (viz[chaveParV(l[i].id, l[j].id)] > 0) { temVizinha = true; break; } }

  let lista = legado; let metodo = 'texto'; let invalida = ''; let incompleta = 0;
  if (Array.isArray(o.ordemDeRuas)) {
    const vistos = new Set(); let erro = '';
    o.ordemDeRuas.forEach((id) => { if (!ids.has(id)) erro = erro || 'rua desconhecida'; else if (vistos.has(id)) erro = erro || 'rua repetida'; else vistos.add(id); });
    if (erro) invalida = erro;
    else {
      const porId = new Map(P.ruas.map((r) => [r.id, r]));
      const faltam = legado.filter((r) => !vistos.has(r.id));
      incompleta = faltam.length;
      lista = o.ordemDeRuas.map((id) => porId.get(id)).concat(faltam);
      metodo = 'ruas-informadas';
    }
  }
  if (metodo === 'texto' && (comPonto >= 2 || temVizinha) && legado.length > 1) {
    lista = otimizarRuasV(legado, P, { partidaPonto, viz: temVizinha ? viz : null });
    metodo = comPonto >= 2 ? 'geografia' : 'aprendido';
  }

  const ordem = [];
  lista.forEach((r) => { ordenarCasasV(r, p, ehPartida(r), o.serpentina).forEach((d) => ordem.push(d)); });
  ilegiveis.forEach((d) => ordem.push(d));

  const km = comPonto === P.ruas.length && comPonto >= 2 ? kmDaOrdemV(lista, partidaPonto, lista.length && ehPartida(lista[0])) : null;
  const kmLegado = km === null ? null : kmDaOrdemV(legado, partidaPonto, legado.length && ehPartida(legado[0]));
  const saida = {
    itens: ordem.map((d) => d.item), indices: ordem.map((d) => d.i), ilegiveis: ilegiveis.length, metodo,
    ruas: lista.map((r) => ({ id: r.id, rotulo: tituloV((r.tipo ? r.tipo + ' ' : '') + r.chave) + (r.bairro ? ' — ' + tituloV(r.bairro) : ''), quantidade: r.itens.length })),
    km: km === null ? null : Number(km.toFixed(2)), kmLegado: kmLegado === null ? null : Number(kmLegado.toFixed(2)),
    economiaKm: km === null ? 0 : Number(Math.max(0, kmLegado - km).toFixed(2)),
    nivelGeo: km === null ? '' : (soBairro ? 'bairro' : 'rua'), cobertura: P.ruas.length ? comPonto / P.ruas.length : 0
  };
  if (invalida) saida.ordemRuasInvalida = invalida;
  if (incompleta) saida.ordemRuasIncompleta = incompleta;
  return saida;
}

// A IA propõe a ordem das ruas; o programa confere. Sem coordenada não há como medir, e vale a proposta (a pessoa ligou a IA);
// com coordenada, a proposta só vale se não for mais longa que a do programa. Proposta inválida (rua que não existe, repetida) é descartada.
// -> { ...ordenarVisitas, origem: 'ia' | 'programa', motivo, verificada }
function ordenarComSugestao(itens, partida, sugestao, opcoes) {
  const base = Object.assign({}, opcoes || {}); delete base.ordemDeRuas;
  const programa = ordenarVisitas(itens, partida, base);
  if (!Array.isArray(sugestao) || !sugestao.length) return Object.assign(programa, { origem: 'programa', motivo: 'sem sugestão da IA', verificada: true });
  const ia = ordenarVisitas(itens, partida, Object.assign({}, base, { ordemDeRuas: sugestao }));
  if (ia.ordemRuasInvalida) return Object.assign(programa, { origem: 'programa', motivo: 'a IA propôs uma ordem inválida (' + ia.ordemRuasInvalida + ')', verificada: true });
  if (ia.km === null || programa.km === null) return Object.assign(ia, { origem: 'ia', motivo: 'sem coordenadas para conferir a distância', verificada: false });
  if (ia.km > programa.km * 1.02 + 0.05) return Object.assign(programa, { origem: 'programa', motivo: 'a ordem da IA daria ' + ia.km.toFixed(1).replace('.', ',') + ' km e a do programa ' + programa.km.toFixed(1).replace('.', ',') + ' km', verificada: true });
  return Object.assign(ia, { origem: 'ia', motivo: 'conferida pelas coordenadas', verificada: true });
}

const EXPLICACAO_VISITAS = 'O Paulus ordena no seu aparelho, sem enviar nada para a internet: começa pela rua de partida, depois as outras ruas do bairro (em ordem alfabética), e em cada rua sobe pelos números ímpares e volta pelos pares. Sem número ou sem endereço legível vai ao fim. É uma aproximação pelo texto do endereço, sem mapa: ajuste a ordem se você conhece um caminho melhor.';

// Texto que diz, sem exagero, COMO esta ordem saiu. Nunca promete mais que o método usado.
function explicacaoDaOrdem(r) {
  if (!r || r.metodo === 'texto') return EXPLICACAO_VISITAS;
  const km = (x) => x.toFixed(1).replace('.', ',') + ' km';
  if (r.metodo === 'geografia') {
    let t = 'O Paulus ordenou as ruas pela menor distância entre elas, usando as coordenadas guardadas neste app (nada foi enviado para a internet); em cada rua sobe pelos ímpares e volta pelos pares.';
    if (r.km !== null && r.kmLegado !== null) t += ' Estimativa: ' + km(r.km) + (r.economiaKm >= 0.1 ? ' (a ordem alfabética daria ' + km(r.kmLegado) + ')' : '') + ', em linha reta × 1,3, sem trânsito nem mão de rua' + (r.nivelGeo === 'bairro' ? ' e, como algumas ruas só têm a coordenada do bairro, com pouca precisão' : '') + '.';
    else t += ' Algumas ruas não têm coordenada, então não dá para estimar o quilômetro total.';
    return t + ' Se você conhece um caminho melhor, ajuste à mão: o app aprende com o seu ajuste.';
  }
  if (r.metodo === 'aprendido') return 'O Paulus ordenou as ruas juntando as que a sua equipe já costuma visitar em sequência (aprendido dos seus ajustes, guardado só neste aparelho). Sem coordenadas, é uma aproximação: ajuste à mão se preciso.';
  return 'A ordem das ruas veio da IA' + (r.verificada ? ' e foi conferida pelo programa' : ', sem como conferir a distância (faltam coordenadas das ruas)') + '; a ordem das casas dentro de cada rua (ímpares subindo, pares voltando) é do programa. Confira se faz sentido para quem conhece o território.';
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
  },
  verbus: {
    app: 'verbus',
    mascote: 'Verbus',
    saudacao: 'Oi! Eu sou o Paulus, aqui como Verbus. Posso explicar o editor, indicar a aba certa e ajudar com a estrutura de relatórios, ofícios e cartas. Não tenho acesso aos seus documentos.',
    sugestoes: ['como fazer referências no padrão ABNT?', 'como funciona a mala direta?', 'como estruturar um ofício de encaminhamento?']
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
//   4b. pedido de rota          -> ordem, km e tempo calculados no aparelho (shared/rota.mjs), sem IA
//   0b. pedido de edição de PDF  -> editado no aparelho com pdf-lib (shared/pdf.mjs); o arquivo NUNCA sai do aparelho. Roda logo após o socorro,
//      antes do filtro de dado pessoal, porque preencher uma ficha exige nome e o texto não vai a servidor nenhum.
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
  pdfLibUrl: '',           // onde está o pdf-lib.min.js (padrão: na mesma pasta do paulus.v1.js); carregado só no primeiro pedido de PDF
  cidade: '',              // 'Boa Vista, RR': acrescentada ao nome nos links de rota feitos só com texto
  maxHistorico: 10,        // últimas mensagens (5 trocas) que vão inteiras à IA; as perguntas mais antigas vão num resumo curto (shared/conversa.mjs)
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
  pontos: null,
  aparelho: null,
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
  // Rotas (shared/rota.mjs): diretório de unidades com coordenadas ([{nome, lat, lng}] ou função) e posição de quem pergunta (função ou {lat, lng}). O Paulus nunca pede o GPS.
  estado.pontos = Array.isArray(o.pontos) || typeof o.pontos === 'function' ? o.pontos : null;
  estado.aparelho = o.aparelho || null;
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

// A conversa inteira conta: as últimas mensagens vão inteiras e as perguntas mais antigas vão só como pergunta (curtas),
// para o Worker montar o resumo "o que já foi perguntado". Em pedido de ajuste ("mais curto"), a ÚLTIMA resposta vai maior (até 3000),
// senão a IA reescreve só o começo dela.
function historicoParaEnvio(externo, ajuste) {
  const c = compactarHistorico(Array.isArray(externo) ? externo : estado.historico, { recentes: cfg.maxHistorico });
  const lista = c.antigas.map(function (t) { return { papel: 'usuario', texto: t }; }).concat(c.recentes);
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
    historico: historicoParaEnvio(opcoes.historico, (function (h) { return ehRefinamento(texto, h) || !!pedidoSobreResposta(texto, h); })(Array.isArray(opcoes.historico) ? opcoes.historico : estado.historico)),
    fichas: fichas,
    stream: true
  };
  // O que a conversa já firmou (unidade, bairro, município, assunto), montado pelo app. Só campos fechados e curtos.
  const firmado = sanearEstado(opcoes.estado);
  if (firmado) corpo.estado = firmado;
  // Segunda tentativa depois de uma resposta que só perguntou: a IA assume a premissa mais provável e responde.
  if (opcoes.semPerguntar === true) corpo.semPerguntar = true;
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

// ------------------------------------------------------------------ PDF

// Endereço padrão do pdf-lib: a mesma pasta de onde veio este script (capturado na carga, quando document.currentScript existe).
const PDF_URL_PADRAO = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/[^\/]*([?#].*)?$/, 'pdf-lib.min.js') : '';
let pdfLibPromessa = null;

function pdfCarregarLib() {
  const g = typeof globalThis !== 'undefined' ? globalThis : self;
  if (cfg.PDFLib && cfg.PDFLib.PDFDocument) return Promise.resolve(cfg.PDFLib);
  if (g.PDFLib && g.PDFLib.PDFDocument) return Promise.resolve(g.PDFLib);
  if (pdfLibPromessa) return pdfLibPromessa;
  const url = cfg.pdfLibUrl || PDF_URL_PADRAO;
  if (!url || typeof document === 'undefined') return Promise.reject(new Error('pdf-lib indisponível'));
  pdfLibPromessa = new Promise(function (resolve, reject) {
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = function () { g.PDFLib && g.PDFLib.PDFDocument ? resolve(g.PDFLib) : reject(new Error('pdf-lib não carregou')); };
    s.onerror = function () { reject(new Error('pdf-lib não carregou')); };
    document.head.appendChild(s);
  }).catch(function (e) { pdfLibPromessa = null; throw e; });
  return pdfLibPromessa;
}

// Aceita File/Blob do navegador ou { nome, bytes }.
async function pdfLerArquivos(lista) {
  const saida = [];
  for (let i = 0; i < (lista || []).length; i++) {
    const a = lista[i];
    if (!a) continue;
    if (a.bytes) saida.push({ nome: a.nome || a.name || 'documento', bytes: a.bytes });
    else if (typeof a.arrayBuffer === 'function') saida.push({ nome: a.name || a.nome || 'documento', bytes: new Uint8Array(await a.arrayBuffer()) });
  }
  return saida;
}

// Foto em outro formato (WebP, HEIC que o navegador abre...) vira PNG para entrar no PDF.
async function pdfImagemParaPng(bytes) {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  const bmp = await createImageBitmap(new Blob([bytes]));
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  const blob = await new Promise(function (r) { c.toBlob(r, 'image/png'); });
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

async function pdfEditarNoAparelho(operacoes, arquivos, opcoes) {
  const lidos = await pdfLerArquivos(arquivos);
  const PDFLib = await pdfCarregarLib();
  return editarPdf(operacoes, lidos, Object.assign({ PDFLib: PDFLib, converterImagem: pdfImagemParaPng }, opcoes || {}));
}

function pdfBlob(arquivo) { return new Blob([arquivo.bytes], { type: 'application/pdf' }); }

// Baixa o arquivo editado (o app pode preferir mostrar um botão e chamar isto no clique).
function pdfBaixar(arquivo) {
  const url = URL.createObjectURL(pdfBlob(arquivo));
  const a = document.createElement('a');
  a.href = url; a.download = arquivo.nome; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}

// Pedido de edição de PDF ("juntar", "remover a página 2", "preencher o campo X com Y"): feito no aparelho, sem IA e sem rede para o arquivo.
// Nada do pedido entra no histórico que vai à IA (pode ter nome e dado de família): fica só uma marca neutra.
async function tratarPdf(t, o) {
  const arquivos = Array.isArray(o.arquivos) ? o.arquivos : [];
  if (!lerPedidoDePdf(t, { temArquivo: arquivos.length > 0 })) return null;
  let r = null;
  try {
    const lidos = await pdfLerArquivos(arquivos);
    let PDFLib = null;
    if (lidos.length) { try { PDFLib = await pdfCarregarLib(); } catch (e) { PDFLib = null; } }
    r = await respostaDePdf(t, lidos, { PDFLib: PDFLib, converterImagem: pdfImagemParaPng });
  } catch (e) { r = null; }
  if (!r) return null;
  if (!Array.isArray(o.historico)) {
    estado.historico.push({ papel: 'usuario', texto: '[pedido de edição de PDF, feito no aparelho]' }, { papel: 'paulus', texto: '[resposta sobre o PDF, feita no aparelho]' });
    estado.historico = estado.historico.slice(-cfg.maxHistorico * 4);
  }
  return { tipo: 'pdf', ok: !!r.ok, texto: r.texto, arquivos: r.arquivos || [], precisaArquivo: !!r.precisaArquivo, campos: r.campos || [], naoSuporta: r.naoSuporta || [], avisos: r.arquivos && r.arquivos.length ? ['Editado neste aparelho: o PDF não foi enviado a nenhum servidor. Confira o resultado antes de usar.'] : [], fontes: [], pergunta: '', docs: [] };
}

// ------------------------------------------------------------------ rota

async function tratarRota(t, o) {
  if (!lerPedidoDeRota(t)) return null;
  let aparelho = o.aparelho !== undefined ? o.aparelho : estado.aparelho;
  try { if (typeof aparelho === 'function') aparelho = await aparelho(); } catch (e) { aparelho = null; }
  let rota = null;
  try { rota = respostaDeRota(t, { pontos: o.pontos || estado.pontos, aparelho: aparelho, cidade: o.cidade || cfg.cidade }); } catch (e) { rota = null; }
  if (!rota) return null;
  if (!Array.isArray(o.historico)) {
    estado.historico.push({ papel: 'usuario', texto: t }, { papel: 'paulus', texto: rota.texto });
    estado.historico = estado.historico.slice(-cfg.maxHistorico * 4);
  }
  const avisos = rota.estimativa ? ['Rota estimada no aparelho, sem IA e sem trânsito. Confira no app de mapas.'] : rota.aproximada ? ['Sem coordenadas, o link do mapa segue a ordem que você escreveu.'] : [];
  return { tipo: 'rota', texto: rota.texto, links: rota.links, svg: rota.svg, geojson: rota.geojson, paradas: rota.paradas, km: rota.km, minutos: rota.minutos, bloqueio: !!rota.bloqueio, fontes: [], avisos: avisos, pergunta: t, docs: [] };
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

  // Edição de PDF: tudo no aparelho, por isso vem antes do filtro (preencher uma ficha exige nome e documento no texto do pedido).
  if (!o.semPdf) {
    const pdf = await tratarPdf(t, o);
    if (pdf) return pdf;
  }

  if (temDadoPessoal(t)) return { tipo: 'bloqueio', texto: AVISO_PESSOAL };

  // Mensagem que É só uma conta ("quanto é 15% de 1200?"): o programa resolve no aparelho, exato, sem rede e sem gastar a cota da IA.
  // Pergunta com mais assunto (\"renda per capita de 3200 / 4\") segue para a IA, que recebe a conta já feita.
  if (!o.semCalculo) {
    const conta = respostaDeConta(t);
    if (conta) {
      if (!Array.isArray(o.historico)) {
        estado.historico.push({ papel: 'usuario', texto: t }, { papel: 'paulus', texto: conta.texto });
        estado.historico = estado.historico.slice(-cfg.maxHistorico * 4);
      }
      return { tipo: 'calculo', texto: conta.texto, itens: conta.itens, fontes: [], avisos: ['Conta feita no aparelho, sem IA. Confira os números que você digitou.'], pergunta: t, docs: [] };
    }
  }

  if (!o.semAcoes) {
    const alvo = normalizar(t);
    let m = REG_ACAO.exec(alvo);
    if (m) return tratarAcao(m[2]);
    m = REG_BUSCA.exec(alvo);
    if (m) return tratarBusca(m[2]);
  }

  // Pedido de rota ("traçar rota saindo do CRAS X: A, B e C, voltando ao CRAS X"): o programa ordena e mede no aparelho; endereço de residência é recusado.
  if (!o.semRota) {
    const rota = await tratarRota(t, o);
    if (rota) return rota;
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
        estado.historico = estado.historico.slice(-cfg.maxHistorico * 4);
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
  if (modo === 'saudacao' || modo === 'refinamento' || modo === 'continuar' || modo === 'porque' || modo === 'contestacao') {
    return { tipo: 'sem_resposta', texto: modo === 'saudacao' ? 'Oi! Estou sem a IA agora, mas a base de normas continua disponível: pergunte pelo assunto.' : modo === 'refinamento' ? 'Não consegui ajustar a resposta agora. Tente de novo em instantes ou copie o texto e edite à mão.' : 'Não consegui retomar a resposta anterior agora (preciso da IA para isso). Tente de novo em instantes ou pergunte pelo assunto, que a base de normas continua disponível.', motivo: motivo };
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

const Paulus = { init, perguntar, rota: { ler: lerPedidoDeRota, responder: respostaDeRota },
  // PDF no aparelho (v0.14.0): ler(texto, { temArquivo }) -> pedido ou null; responder(texto, arquivos) -> resultado; editar(operacoes, arquivos); baixar(arquivo)
  pdf: { ler: lerPedidoDePdf, responder: function (t, arquivos, opc) { return pdfLerArquivos(arquivos).then(function (l) { return (l.length ? pdfCarregarLib() : Promise.resolve(null)).then(function (PDFLib) { return respostaDePdf(t, l, Object.assign({ PDFLib: PDFLib, converterImagem: pdfImagemParaPng }, opc || {})); }); }); }, editar: pdfEditarNoAparelho, baixar: pdfBaixar, blob: pdfBlob, paginas: resolverPaginasPdf, lista: listaPaginasPdf }, visitas: { ordenar: ordenarVisitas, analisar: analisarEnderecoVisita, explicacao: EXPLICACAO_VISITAS, comSugestao: ordenarComSugestao, ruas: ruasDasVisitas, aprender: aprenderVizinhanca, vizinhancaVazia: vizinhancaVazia, resumoVizinhanca: resumoVizinhanca, explicar: explicacaoDaOrdem }, consultarNormas, registrarAcao, registrarBusca, avaliar, sugestoesPessoais, memoria, limpar, skin, iaLigada, temDadoPessoal, detectarCrise, versao: '0.15.0',
  // Memória da conversa inteira (estado, resumo do que já foi perguntado e regra do esclarecimento), para os apps usarem do mesmo jeito.
  conversa: { sanearEstado, mesclarEstado, estadoComoTexto, deveEsclarecer, compactarHistorico, soPerguntou },
  // Para apps com cérebro próprio (Argo): reconhece "continue", "tem certeza?" e "de onde tirou isso?" ANTES de reescrever a pergunta,
  // porque esses pedidos só funcionam com as palavras da pessoa. Devolve 'continuar' | 'contestacao' | 'porque' | '' (sem resposta anterior no histórico, sempre '').
  pedido: { sobreResposta: pedidoSobreResposta } };

root.Paulus = Paulus;
if (typeof module === 'object' && module.exports) module.exports = Paulus;
})(typeof self !== 'undefined' ? self : this);

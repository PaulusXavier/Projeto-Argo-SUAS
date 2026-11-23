// Teste do módulo que lê pedidos de PDF para a Central (js/argo-pdf-central.js).
// Uso: npm run test:pdf-central   (sem dependências; precisa de Node 18+)
import { readFileSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = {}; ctx.self = ctx; createContext(ctx);
runInContext(readFileSync(join(RAIZ, 'js/argo-pdf-central.js'), 'utf8'), ctx);
const P = ctx.ArgoPdfCentral;

let falhas = 0, ok = 0;
function confere(nome, cond, detalhe) {
  if (cond) { ok++; return; }
  falhas++; console.log('✗ ' + nome + (detalhe !== undefined ? ' → ' + JSON.stringify(detalhe).slice(0, 400) : ''));
}
const ler = (t, arq) => P.ler(t, { temArquivo: !!arq });
const chaves = (t, arq) => { const r = ler(t, arq); return r ? r.etapas.map(e => e.ferramenta).join('+') : null; };
const etapa = (t, k, arq) => { const r = ler(t, arq); return r && r.etapas.find(e => e.ferramenta === k); };

// ---- cada pedido cai na ferramenta certa
const CASOS = [
  // Reduzir
  ['reduzir o tamanho do pdf', 'Compress'], ['comprimir esse pdf', 'Compress'], ['diminuir o pdf pesado', 'Compress'], ['reduza o tamanho do arquivo', 'Compress', 1],
  ['deixar o pdf mais leve', 'Compress'], ['compactar o pdf para enviar por email', 'Compress'], ['preciso que o pdf caiba em 2 mb', 'Compress'],
  ['reduzir o pdf com as páginas como imagem', 'Compress'], ['reduzir para até 2 MB', 'Compress', 1],
  // Recortar
  ['recortar as margens do pdf', 'Crop'], ['tirar as margens brancas do pdf escaneado', 'Crop'], ['aparar as margens', 'Crop'], ['corte 10 mm das margens do pdf', 'Crop'],
  ['remover as bordas em branco do pdf', 'Crop'],
  // Dados ocultos / texto
  ['limpar os dados ocultos do pdf', 'Meta'], ['limpar metadados', 'Meta', 1], ['remover o autor do pdf', 'Meta'], ['apagar as propriedades do pdf', 'Meta'],
  ['extrair o texto do pdf', 'Text'], ['copiar o texto do pdf para um txt', 'Text'], ['pdf para txt', 'Text'],
  // Conversões
  ['converter o pdf para word', 'PdfWord'], ['pdf em docx', 'PdfWord'], ['transformar esse pdf em word', 'PdfWord'],
  ['converter word para pdf', 'WordPdf'], ['docx para pdf', 'WordPdf'], ['transformar o documento word em pdf', 'WordPdf'],
  ['converter o pdf para jpg', 'PdfJpg'], ['pdf para imagem', 'PdfJpg'], ['transformar as páginas do pdf em fotos', 'PdfJpg'],
  ['transformar fotos em pdf', 'JpgPdf'], ['digitalizar documento em pdf', 'JpgPdf'], ['escanear com a câmera e gerar pdf', 'JpgPdf'], ['juntar as fotos num pdf', 'JpgPdf'],
  // Páginas pela Central
  ['juntar dois pdfs', 'Merge'], ['unir os pdfs em um só', 'Merge'], ['mesclar arquivos pdf', 'Merge'],
  ['organizar as páginas do pdf', 'Organize'], ['reordenar páginas pelas miniaturas', 'Organize'],
  // Senha
  ['remover a senha do pdf', 'Unlock'], ['desbloquear o pdf', 'Unlock'], ['tirar a senha desse pdf', 'Unlock'], ['destravar pdf', 'Unlock'],
  ['colocar senha no pdf', 'Protect'], ['proteger o pdf com senha', 'Protect'], ['criptografar o pdf', 'Protect'],
  // Editar e assinar
  ['quero tarjar o nome no pdf', 'Edit'], ['cobrir o cpf no pdf', 'Edit'], ['assinar o pdf', 'Edit'], ['colocar minha assinatura no pdf', 'Edit'],
  ['realçar um trecho do pdf', 'Edit'], ['sublinhar o texto no pdf', 'Edit'], ['desenhar no pdf', 'Edit'], ['editar o texto do pdf', 'Edit'],
  ['preencher o formulário do pdf', 'Edit'], ['colocar um carimbo no pdf', 'Edit'], ['editar o pdf', 'Edit']
];
CASOS.forEach(([t, k, arq]) => {
  const c = chaves(t, arq);
  confere('"' + t + '" → ' + k, c && c.split('+').indexOf(k) >= 0, c);
});

// ---- o que NÃO é pedido: pergunta de explicação e conversa comum seguem para o manual / IA
['como reduzir o tamanho de um pdf?', 'como faço para tirar a senha de um pdf', 'o que é um pdf', 'qual a diferença entre pdf e word', 'onde fica a central de pdf',
 'quais as margens do relatório', 'reduzir a pobreza no município', 'qual o endereço do CRAS', 'assinatura do técnico no relatório', 'aumentar o tamanho da fonte',
 'diminuir o tamanho da letra', 'oi', 'bom dia', 'como converter word para pdf?'
].forEach(t => confere('não é pedido: "' + t + '"', ler(t) === null, chaves(t)));
confere('"assinar" sem PDF nem arquivo não vira ferramenta', ler('o técnico vai assinar o relatório') === null, chaves('o técnico vai assinar o relatório'));
confere('"reduzir o tamanho da fonte do pdf" não é compressão', !/Compress/.test(chaves('reduzir o tamanho da fonte do pdf') || ''), chaves('reduzir o tamanho da fonte do pdf'));

// ---- modo: o que roda sozinho e o que fica pronto para a pessoa
['Compress', 'Crop', 'Meta', 'Text', 'PdfWord', 'PdfJpg'].forEach(k => {
  const ex = { Compress: 'reduzir o pdf', Crop: 'recortar margens do pdf', Meta: 'limpar dados ocultos do pdf', Text: 'extrair texto do pdf', PdfWord: 'pdf para word', PdfJpg: 'pdf para jpg' }[k];
  const e = etapa(ex, k);
  confere(k + ' roda sozinha (auto)', e && e.modo === 'auto', e);
});
['Unlock', 'Protect', 'Edit', 'Organize', 'Merge', 'WordPdf', 'JpgPdf'].forEach(k => {
  const ex = { Unlock: 'remover senha do pdf', Protect: 'colocar senha no pdf', Edit: 'assinar o pdf', Organize: 'organizar as páginas do pdf', Merge: 'juntar dois pdfs', WordPdf: 'converter word para pdf', JpgPdf: 'transformar fotos em pdf' }[k];
  const e = etapa(ex, k);
  confere(k + ' fica pronta para a pessoa (abrir)', e && e.modo === 'abrir', e);
});

// ---- opções lidas do pedido
let o = etapa('reduzir o pdf', 'Compress').opcoes;
confere('compress padrão: média, mantendo o texto', o.nivel === 'media' && o.modo === 'texto' && !o.alvoMB, o);
o = etapa('reduzir o pdf para até 2 MB', 'Compress').opcoes;
confere('compress meta "até 2 MB"', o.alvoMB === 2, o);
o = etapa('comprimir o pdf para menos de 1,5 mb', 'Compress').opcoes;
confere('compress meta "1,5 mb" com vírgula', o.alvoMB === 1.5, o);
o = etapa('reduzir o pdf para no máximo 500 kb', 'Compress').opcoes;
confere('compress meta em kb', o.alvoMB > 0.48 && o.alvoMB < 0.5, o);
o = etapa('reduzir o pdf ao máximo', 'Compress').opcoes;
confere('compress máxima', o.nivel === 'maxima' && o.modo === 'texto', o);
o = etapa('reduzir o pdf sem perder qualidade', 'Compress').opcoes;
confere('compress alta qualidade', o.nivel === 'alta', o);
o = etapa('reduzir o pdf com as páginas como imagem', 'Compress').opcoes;
confere('compress páginas como imagem', o.modo === 'imagem', o);
let r = ler('reduzir o pdf com as páginas como imagem');
confere('compress como imagem avisa que o texto deixa de ser copiável', r.avisos.some(a => /texto deixa de poder ser copiado/.test(a)) && /não pode ser copiado|deixa de poder ser copiado/.test(r.etapas[0].resumo), r);
confere('compress como imagem NÃO vira "PDF → JPG"', chaves('reduzir o pdf com as páginas como imagem') === 'Compress', chaves('reduzir o pdf com as páginas como imagem'));

o = etapa('recortar as margens do pdf', 'Crop').opcoes;
confere('crop automático, folga de 6 mm', o.modo === 'auto' && o.pad === 6, o);
o = etapa('recortar as margens do pdf deixando uma folga de 3 mm', 'Crop').opcoes;
confere('crop automático com folga pedida', o.modo === 'auto' && o.pad === 3, o);
o = etapa('corte 10 mm das margens do pdf', 'Crop').opcoes;
confere('crop manual: 10 mm em todos os lados', o.modo === 'manual' && o.t === 10 && o.b === 10 && o.l === 10 && o.r === 10, o);
o = etapa('cortar 2 cm das margens do pdf', 'Crop').opcoes;
confere('crop manual: cm vira mm', o.modo === 'manual' && o.t === 20, o);
o = etapa('recortar 15 mm em cima e 5 mm embaixo do pdf, as margens', 'Crop').opcoes;
confere('crop manual: cima e baixo, lados zerados', o.modo === 'manual' && o.t === 15 && o.b === 5 && o.l === 0 && o.r === 0, o);
o = etapa('aparar as margens do pdf 8 mm dos lados', 'Crop').opcoes;
confere('crop manual: "dos lados"', o.modo === 'manual' && o.l === 8 && o.r === 8 && o.t === 0, o);

o = etapa('tarjar o nome no pdf', 'Edit').opcoes;
confere('edit: tarja → cover', o.ferramenta === 'cover', o);
o = etapa('assinar o pdf', 'Edit').opcoes;
confere('edit: assinar → imagem', o.ferramenta === 'img' && o.assinatura === true, o);
o = etapa('sublinhar o texto no pdf', 'Edit').opcoes;
confere('edit: sublinhar → hl/under', o.ferramenta === 'hl' && o.realce === 'under', o);
o = etapa('riscar um trecho do pdf', 'Edit').opcoes;
confere('edit: riscar → hl/strike', o.ferramenta === 'hl' && o.realce === 'strike', o);
o = etapa('editar o texto do pdf', 'Edit').opcoes;
confere('edit: texto existente → edittext', o.ferramenta === 'edittext', o);
o = etapa('editar o pdf', 'Edit').opcoes;
confere('edit genérico: sem ferramenta escolhida', o.ferramenta === '', o);
confere('tarja usa rótulo próprio', etapa('tarjar o nome no pdf', 'Edit').rotulo === 'Editar e assinar (Tarja)');

// ---- encadeamento: a ordem é a da frase
confere('limpar e depois reduzir: Meta antes de Compress', chaves('limpar os dados ocultos do pdf e depois reduzir o tamanho') === 'Meta+Compress', chaves('limpar os dados ocultos do pdf e depois reduzir o tamanho'));
confere('reduzir e depois limpar: Compress antes de Meta', chaves('reduzir o tamanho do pdf e depois limpar os dados ocultos') === 'Compress+Meta', chaves('reduzir o tamanho do pdf e depois limpar os dados ocultos'));
confere('recortar, reduzir e extrair: três etapas na ordem', chaves('recortar as margens do pdf, reduzir o tamanho e extrair o texto') === 'Crop+Compress+Text', chaves('recortar as margens do pdf, reduzir o tamanho e extrair o texto'));
r = ler('reduzir o pdf e depois assinar');
confere('auto antes de abrir: ordem natural, sem aviso', r && r.etapas.length === 2 && r.etapas[0].ferramenta === 'Compress' && !r.avisos.some(a => /primeiro o que é automático/.test(a)), r);
r = ler('assinar o pdf e depois reduzir o tamanho');
confere('auto depois de abrir: avisa que o automático vai primeiro', r && r.etapas.length === 2 && r.avisos.some(a => /primeiro o que é automático/.test(a)), r);
r = ler('colocar senha no pdf e assinar');
confere('duas ferramentas de abrir: só uma fica pronta, a outra vira recado', r && r.etapas.filter(e => e.modo === 'abrir').length === 1 && r.avisos.some(a => /Deixo pronta só uma/.test(a)), r);

// ---- recusas: o que a Central não faz
r = ler('quebrar a senha do pdf');
confere('quebrar senha: recusa, sem etapa de remover', r && r.recusas.some(x => x.codigo === 'quebrar-senha') && !r.etapas.length && /Não quebro/.test(r.recusas[0].texto), r);
r = ler('esqueci a senha do pdf, recuperar');
confere('senha esquecida: recusa', r && r.recusas.some(x => x.codigo === 'quebrar-senha'), r);
r = ler('descobrir a senha desse pdf');
confere('descobrir senha: recusa', r && r.recusas.some(x => x.codigo === 'quebrar-senha') && !r.etapas.length, r);
r = ler('fazer ocr desse pdf escaneado');
confere('OCR: recusa explicada', r && r.recusas.some(x => x.codigo === 'ocr') && /OCR/.test(r.recusas[0].texto) && /não faz/.test(r.recusas[0].texto), r);
r = ler('reconhecer o texto do pdf escaneado');
confere('"reconhecer o texto": também é OCR', r && r.recusas.some(x => x.codigo === 'ocr'), r);
r = ler('remover as páginas em branco do pdf');
confere('páginas em branco: recusa e indica Organizar', r && r.recusas.some(x => x.codigo === 'paginas-branco') && /Organizar/.test(r.recusas[0].texto), r);
r = ler('assinar o pdf com certificado digital');
confere('assinatura digital: recusa; não vira "assinar" comum', r && r.recusas.some(x => x.codigo === 'assinatura-digital') && !r.etapas.some(e => e.ferramenta === 'Edit'), r);
r = ler('reduzir o pdf e fazer ocr');
confere('pedido misto: faz o que dá e recusa o resto', r && r.etapas.length === 1 && r.etapas[0].ferramenta === 'Compress' && r.recusas.length === 1, r);

// ---- senha nunca é lida do texto
r = ler('remover a senha 12345678 do pdf');
confere('senha escrita no chat não é guardada em nenhuma opção', r && !JSON.stringify(r).includes('12345678'), r);
r = ler('colocar a senha Abc@1234 no pdf');
confere('senha para proteger também não vai para as opções', r && !JSON.stringify(r).includes('Abc@1234'), r);

// ---- instruções do que a pessoa faz a seguir
const ins = (t, k, arq) => P.instrucao(etapa(t, k, arq), !!arq);
confere('instrução Unlock: senha nunca passa pelo chat', /nunca passa pelo chat/.test(ins('remover senha do pdf', 'Unlock')), ins('remover senha do pdf', 'Unlock'));
confere('instrução Unlock: avisa que precisa saber a senha', /saber a senha/.test(ins('remover senha do pdf', 'Unlock')));
confere('instrução Unlock com arquivo: "já está na ferramenta"', /já está na ferramenta/.test(ins('remover senha do pdf', 'Unlock', 1)));
confere('instrução Protect: anotar a senha', /Anote a senha/.test(ins('colocar senha no pdf', 'Protect')) && /nunca passa pelo chat/.test(ins('colocar senha no pdf', 'Protect')));
confere('instrução Tarja: avisa que só esconde', /só esconde/.test(ins('tarjar o nome no pdf', 'Edit')) && /Editar|Tarja/.test(ins('tarjar o nome no pdf', 'Edit')));
confere('instrução Assinatura: não é assinatura digital', /não tem validade/.test(ins('assinar o pdf', 'Edit')));
confere('instrução de ferramenta desconhecida não quebra', typeof P.instrucao({ ferramenta: 'X' }, false) === 'string' && typeof P.instrucao(null, false) === 'string');

// ---- robustez
confere('texto vazio → null', ler('') === null && ler('   ') === null && ler(null) === null && ler(undefined) === null);
confere('texto enorme → null (não é pedido)', ler('reduzir o pdf '.repeat(60)) === null);
confere('maiúsculas, acento e pontuação não atrapalham', chaves('REDUZIR O TAMANHO DO PDF!!!') === 'Compress' && chaves('Converta o PDF → Word') === 'PdfWord', chaves('Converta o PDF → Word'));
confere('"temArquivo" amplia o contexto (sem a palavra pdf)', chaves('assinar isso aqui', 1) === 'Edit' && ler('assinar isso aqui') === null);
confere('resultado tem sempre etapas, avisos e recusas', (() => { const x = ler('reduzir o pdf'); return Array.isArray(x.etapas) && Array.isArray(x.avisos) && Array.isArray(x.recusas); })());
confere('cada etapa tem ferramenta, modo, rótulo, opções, posição e resumo', (() => {
  const x = ler('recortar as margens, reduzir o tamanho e limpar os dados ocultos do pdf');
  return x.etapas.every(e => e.ferramenta && e.modo && e.rotulo && e.opcoes && typeof e.pos === 'number' && e.resumo);
})());

console.log(falhas ? '\n' + falhas + ' falha(s), ' + ok + ' ok' : '✓ ' + ok + ' conferências ok');
process.exit(falhas ? 1 : 0);

// Teste da fidelidade PDF ⇄ Word (js/app.js, bloco "Fidelidade PDF ⇄ Word") — npm run test:pdf-word
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.self = globalThis;
vm.runInThisContext(readFileSync(new URL('../assets/vendor/jszip.min.js', import.meta.url), 'utf8'));
vm.runInThisContext(readFileSync(new URL('../assets/vendor/pdf-lib.min.js', import.meta.url), 'utf8'));
const JSZip = globalThis.JSZip;
const PDFLib = globalThis.PDFLib;
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
function extrai(nome, tipo = 'function') {
  const i = app.indexOf(tipo + ' ' + nome);
  assert.ok(i >= 0, 'não encontrado no app.js: ' + nome);
  const j = tipo === 'const' ? app.indexOf(';\n', i) + 2 : app.indexOf('\n}\n', i) + 3;
  const pre = app.slice(i - 6, i) === 'async ' ? 'async ' : '';
  return pre + app.slice(i, j);
}
vm.runInThisContext(['pdftoolsEscapeXml', 'pdftoolsXmlUnescape', 'pdftoolsDocxText', 'pdftoolsTextoChave', 'pdftoolsSha256', 'pdftoolsCompareText',
  'pdftoolsPdfDate', 'pdftoolsCorePropsXml', 'pdftoolsContaAnotacoes', 'pdftoolsContaMarcadores', 'pdftoolsAddOutline', 'pdftoolsAddLinks', 'pdftoolsMontaOrigem', 'pdftoolsLeDocx', 'pdftoolsDecideWordPdf'].map(n => extrai(n)).join('\n')
  + '\nvar PDFTOOLS_ORIGEM_VERSAO = 1;');
const ok = n => console.log('✓ ' + n);

// texto do Word
const xml = '<w:p><w:r><w:t xml:space="preserve">Olá &amp; </w:t></w:r><w:r><w:tab/><w:t>mundo</w:t></w:r></w:p><w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="10"/></w:tabs></w:pPr><w:r><w:t>fim</w:t></w:r></w:p>';
assert.equal(pdftoolsDocxText(xml), 'Olá & \tmundo\nfim\n'); ok('texto do Word: tabulação real x parada de tabulação');
assert.equal(pdftoolsTextoChave(' a b\n c '), 'abc'); ok('texto-chave ignora espaços');

// conferência
let c = pdftoolsCompareText('Prefeitura de Boa Vista 12 relatório', 'relatório Prefeitura de Boa Vista');
assert.equal(c.pct, 100); ok('conferência: ordem/números de página não contam');
c = pdftoolsCompareText('um texto importante aqui', 'um texto aqui');
assert.equal(c.found, 3); assert.deepEqual(c.missing, ['importante']); ok('conferência: aponta palavra que faltou');

// datas e propriedades
assert.equal(pdftoolsPdfDate("D:20240131120000-04'00'"), '2024-01-31T16:00:00Z'); ok('data do PDF → Word');
assert.equal(pdftoolsPdfDate('lixo'), null);
const core = pdftoolsCorePropsXml({ title: 'A & B', author: 'Maria' });
assert.ok(core.includes('<dc:title>A &amp; B</dc:title>') && core.includes('<dc:creator>Maria</dc:creator>')); ok('core.xml com título e autor');

// anotações
const ex = { links: [], linksExtra: 0, linksInternos: 0, campos: 0, notas: 0 };
pdftoolsContaAnotacoes([{ subtype: 'Link', url: 'https://x.gov.br' }, { subtype: 'Link', dest: 'a' }, { subtype: 'Widget', fieldType: 'Tx' }, { subtype: 'Highlight' }, { subtype: 'Popup' }], ex, 2);
assert.deepEqual([ex.links.length, ex.linksInternos, ex.campos, ex.notas], [1, 1, 1, 1]); ok('contagem de links, campos e comentários');

// decisão Word → PDF
const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 1, 2, 3]);
const body = '<w:document><w:body><w:p><w:r><w:t>Texto original</w:t></w:r></w:p></w:body></w:document>';
async function monta(bodyXml, origemMudada) {
  const z = new JSZip();
  z.file('word/document.xml', bodyXml);
  z.file('docProps/core.xml', pdftoolsCorePropsXml({ title: 'Meu título', author: 'Ana' }));
  const o = pdftoolsMontaOrigem({ nome: 'rel.pdf', paginas: 1, bytes: pdf.length, pdfSha256: await pdftoolsSha256(pdf), textoSha256: await pdftoolsSha256(pdftoolsTextoChave(pdftoolsDocxText(body))) });
  z.file('attachments/original.pdf', origemMudada ? new Uint8Array([9, 9]) : pdf);
  z.file('attachments/argo-origem.json', JSON.stringify(o));
  return JSZip.loadAsync(await z.generateAsync({ type: 'uint8array' }));
}
let d = await pdftoolsDecideWordPdf(await monta(body));
assert.equal(d.modo, 'original'); assert.deepEqual(Array.from(d.original), Array.from(pdf)); assert.equal(d.props.title, 'Meu título'); ok('Word intacto → devolve o PDF original idêntico');
d = await pdftoolsDecideWordPdf(await monta(body.replace('original', 'EDITADO')));
assert.equal(d.modo, 'editado'); assert.equal(d.original, null); ok('Word com texto editado → refaz o PDF');
d = await pdftoolsDecideWordPdf(await monta(body, true));
assert.equal(d.modo, 'adulterado'); ok('PDF guardado que não confere (SHA-256) não é usado');
const z2 = new JSZip(); z2.file('word/document.xml', body);
d = await pdftoolsDecideWordPdf(await JSZip.loadAsync(await z2.generateAsync({ type: 'uint8array' })));
assert.equal(d.modo, 'novo'); ok('.docx comum segue a conversão normal');
// Word → PDF: marcadores e links
{
  const doc = await PDFLib.PDFDocument.create();
  doc.addPage(); doc.addPage();
  const n = pdftoolsAddOutline(doc, [
    { title: 'Capítulo 1', level: 1, pageIndex: 0, x: 56, y: 780 }, { title: 'Seção 1.1', level: 2, pageIndex: 0, x: 56, y: 700 },
    { title: 'Capítulo 2', level: 1, pageIndex: 1, x: 56, y: 780 }, { title: '   ', level: 1, pageIndex: 0, x: 0, y: 0 }]);
  assert.equal(n, 3); ok('marcadores: 3 (título vazio ignorado)');
  const l = pdftoolsAddLinks(doc, [{ page: doc.getPage(0), x: 10, y: 10, w: 50, h: 12, href: 'https://www.gov.br/mds' }, { page: doc.getPage(0), x: 1, y: 1, w: 5, h: 5, href: 'javascript:alert(1)' }]);
  assert.equal(l, 1); ok('links: só http(s)/mailto viram link clicável');
  const salvo = Buffer.from(await doc.save({ useObjectStreams: false })).toString('latin1');
  assert.ok(salvo.includes('/Outlines') && salvo.includes('/URI (https://www.gov.br/mds)') && salvo.includes('/UseOutlines'));
  const re = await PDFLib.PDFDocument.load(Buffer.from(salvo, 'latin1')); assert.equal(re.getPageCount(), 2); ok('PDF com marcadores e links reabre sem erro');
}
console.log('\nTudo certo');

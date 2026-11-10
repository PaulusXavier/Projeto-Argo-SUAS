// Teste da Central de PDF (js/app.js) — npm run test:pdf
// Usa a MESMA pdf-lib que o app carrega (assets/vendor/pdf-lib.min.js) e extrai do app.js as funções
// puras da aba PDF, sem navegador. Cobre os erros já encontrados nela:
//  - "Excluir páginas" e "Dados ocultos" deixavam o conteúdo apagado dentro do arquivo (objetos órfãos);
//  - nomes de arquivo reservados do Windows (CON, NUL...);
//  - o interpretador do campo "Páginas" (1-3, 5, pares, última...).
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.self = globalThis;
vm.runInThisContext(readFileSync(new URL('../assets/vendor/pdf-lib.min.js', import.meta.url), 'utf8'));
const PDFLib = globalThis.PDFLib;
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

// Extrai "function nome(...) { ... }" até o "}" que fecha na coluna 0.
function extrai(nome) {
  const i = app.indexOf('function ' + nome + '(');
  assert.ok(i >= 0, 'função não encontrada no app.js: ' + nome);
  const j = app.indexOf('\n}\n', i);
  return app.slice(i, j + 3);
}
vm.runInThisContext(['pdftoolsParsePageRange', 'pdftoolsSafeName', 'pdftoolsPruneOrphans'].map(extrai).join('\n'));

let ok = 0;
const passa = (nome) => { ok++; console.log('✓ ' + nome); };
const { PDFDocument, PDFName, StandardFonts } = PDFLib;

// Procura um texto (em claro ou em hexadecimal, como a pdf-lib grava) nos streams de um PDF.
function contem(bytes, texto) {
  const hex = Buffer.from(texto, 'latin1').toString('hex').toUpperCase();
  const buf = Buffer.from(bytes);
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  const s = buf.toString('latin1');
  let m;
  while ((m = re.exec(s))) {
    const raw = Buffer.from(m[1], 'latin1');
    let t; try { t = inflateSync(raw).toString('latin1'); } catch { t = raw.toString('latin1'); }
    if (t.includes(texto) || t.toUpperCase().includes(hex)) return true;
  }
  return s.includes(texto);
}

// 1) Interpretador de páginas.
{
  const r = (t, n) => { const x = pdftoolsParsePageRange(t, n); return x.error ? 'ERRO' : x.indices.map(i => i + 1).join(','); };
  assert.equal(r('1-3, 5', 10), '1,2,3,5');
  assert.equal(r('1–3', 10), '1,2,3');       // traço longo do teclado do celular
  assert.equal(r('3,1,2', 5), '3,1,2');      // respeita a ordem digitada
  assert.equal(r('8-', 10), '8,9,10');
  assert.equal(r('', 3), '1,2,3');
  assert.equal(r('pares', 5), '2,4');
  assert.equal(r('ímpares', 5), '1,3,5');
  assert.equal(r('última', 5), '5');
  for (const ruim of ['0', '6', '3-1', '1-99', 'abc', '1-3-5', '-3']) assert.equal(r(ruim, 5), 'ERRO', ruim);
  passa('campo "Páginas": formas aceitas e entradas inválidas');
}

// 2) Nome de arquivo seguro.
{
  assert.equal(pdftoolsSafeName('CON.pdf', 'x'), 'CON-arquivo');
  assert.equal(pdftoolsSafeName('nul', 'x'), 'nul-arquivo');
  assert.equal(pdftoolsSafeName('Relatório: final?.pdf', 'x'), 'Relatório final');
  assert.equal(pdftoolsSafeName('  ..a..  ', 'x'), 'a');
  assert.equal(pdftoolsSafeName('', 'documento'), 'documento');
  passa('nome de arquivo: reservados do Windows e caracteres proibidos');
}

// 3) Excluir páginas: o conteúdo da página excluída não pode ficar no arquivo.
{
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  d.setTitle('Titulo mantido');
  for (let k = 1; k <= 4; k++) d.addPage([300, 300]).drawText(k === 2 ? 'NIS 12345678901 SEGREDO' : 'pagina ' + k, { x: 20, y: 150, font: f, size: 14 });
  d.getForm().createTextField('nome').addToPage(d.getPage(0), { x: 20, y: 20, width: 100, height: 20 });
  const src = await d.save({ useObjectStreams: true });
  assert.ok(contem(src, 'SEGREDO'), 'o detector precisa achar o texto no original');

  const sem = await PDFDocument.load(src);
  sem.removePage(1);
  assert.ok(contem(await sem.save(), 'SEGREDO'), 'sem a limpeza o texto fica (comportamento da pdf-lib que o app corrige)');

  const doc = await PDFDocument.load(src);
  doc.removePage(1);
  const apagados = pdftoolsPruneOrphans(PDFLib, doc);
  const out = await doc.save();
  assert.ok(apagados > 0);
  assert.equal(contem(out, 'SEGREDO'), false, 'conteúdo da página excluída ainda está no arquivo');
  const b = await PDFDocument.load(out);
  assert.equal(b.getPageCount(), 3);
  assert.equal(b.getTitle(), 'Titulo mantido');
  assert.deepEqual(b.getForm().getFields().map(x => x.getName()), ['nome']);
  passa('Excluir páginas: conteúdo some do arquivo; título e formulário ficam');
}

// 4) Dados ocultos: o fluxo XMP apagado do catálogo não pode ficar como objeto solto.
{
  const d = await PDFDocument.create();
  d.addPage([200, 200]);
  d.setAuthor('Maria da Silva');
  const xmp = '<x:xmpmeta><dc:creator>Maria XMPSECRETO</dc:creator></x:xmpmeta>';
  d.catalog.set(PDFName.of('Metadata'), d.context.register(d.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' })));
  const src = await d.save({ useObjectStreams: false });
  const limpar = async (prune) => {
    const doc = await PDFDocument.load(src, { updateMetadata: false });
    const info = doc.getInfoDict(); info.keys().slice().forEach(k => info.delete(k));
    doc.catalog.delete(PDFName.of('Metadata'));
    if (prune) pdftoolsPruneOrphans(PDFLib, doc);
    return Buffer.from(await doc.save({ updateFieldAppearances: false })).toString('latin1');
  };
  assert.ok((await limpar(false)).includes('XMPSECRETO'));
  assert.equal((await limpar(true)).includes('XMPSECRETO'), false);
  passa('Dados ocultos: XMP não sobra dentro do arquivo');
}

// 5) copyPages (Dividir, Organizar, Unir) preserva atributos herdados da árvore de páginas.
{
  const d = await PDFDocument.create();
  d.addPage([400, 200]); d.addPage([400, 200]);
  const tree = d.catalog.lookup(PDFName.of('Pages'));
  d.getPages().forEach(p => p.node.delete(PDFName.of('MediaBox')));
  tree.set(PDFName.of('MediaBox'), d.context.obj([0, 0, 400, 200]));
  tree.set(PDFName.of('Rotate'), PDFLib.PDFNumber.of(90));
  const a = await PDFDocument.load(await d.save());
  const n = await PDFDocument.create();
  (await n.copyPages(a, [0, 1])).forEach(p => n.addPage(p));
  const o = await PDFDocument.load(await n.save());
  assert.deepEqual(o.getPage(0).getSize(), { width: 400, height: 200 });
  assert.equal(o.getPage(0).getRotation().angle, 90);
  passa('copyPages mantém tamanho e giro herdados');
}

console.log('\n' + ok + ' verificações ok');

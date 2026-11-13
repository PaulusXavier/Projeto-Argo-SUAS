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
  const asinc = app.slice(i - 6, i) === 'async ' ? 'async ' : '';
  return asinc + app.slice(i, j + 3);
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

// 6) Painel inicial (hub): cada ferramenta aponta para um bloco que existe, as ofertas do seletor e da
//    cadeia "Continuar com este arquivo" só citam ferramentas reais, e um PDF com senha é detectado.
{
  const tools = [...app.matchAll(/\{ key: '(\w+)', (?:tool: '(\w+)'|go: '(\w+)')/g)].map(m => ({ key: m[1], tool: m[2], go: m[3] }));
  assert.ok(tools.length >= 18, 'lista PDFHUB_TOOLS não encontrada');
  const keys = new Set(tools.map(t => t.key));
  for (const t of tools.filter(x => x.tool)) {
    assert.ok(app.includes('id="' + t.tool + '"'), 'bloco sem id no HTML: ' + t.tool);
  }
  const lista = (re) => (app.match(re) || [, ''])[1].match(/'(\w+)'/g).map(x => x.slice(1, -1));
  for (const k of lista(/keys = \['Edit', ([^\]]+)\]; hint = 'O que fazer com este PDF/)) assert.ok(keys.has(k), 'seletor cita ferramenta inexistente: ' + k);
  for (const k of lista(/const PDFHUB_NEXT = \[([^\]]+)\]/)) assert.ok(keys.has(k), 'cadeia cita ferramenta inexistente: ' + k);
  passa('hub: ferramentas, seletor e cadeia apontam para blocos existentes');

  // pdfhubInspect: mostra páginas/tamanho e troca as ofertas quando o PDF pede senha.
  vm.runInThisContext(['pdfhubDrawChooser', 'pdfhubInspect'].map(extrai).join('\n'));
  const mkBox = () => ({ hidden: true, innerHTML: '' });
  const rode = async (getDocument) => {
    const box = mkBox();
    const f = { name: 'a.pdf', size: 2048, arrayBuffer: async () => new ArrayBuffer(8) };
    globalThis.document = { getElementById: (id) => (id === 'pdfhubChooser' ? box : null) };
    globalThis.ICONS = { pdf: '' };
    globalThis.escapeHtmlAttr = (x) => String(x);
    globalThis.PDFHUB_TOOLS = tools.map(t => ({ ...t, name: t.key }));
    globalThis.pdftoolsFormatBytes = (n) => n + ' B';
    globalThis.ensurePdfJs = async () => ({ getDocument });
    globalThis.pdfhub = { files: [f], inspectTok: 0, chooser: { name: 'a.pdf', total: 2048, hint: 'O que fazer com este PDF?', keys: ['Edit', 'Compress'], skipped: 0, info: '' } };
    await pdfhubInspect(f);
    return box.innerHTML;
  };
  const normal = await rode(() => ({ promise: Promise.resolve({ numPages: 3, destroy() {} }) }));
  assert.match(normal, /3 páginas · 2048 B/);
  assert.match(normal, /pdfhubSendPicked\('Edit'\)/);
  const trancado = await rode(() => ({ promise: Promise.reject(Object.assign(new Error('x'), { name: 'PasswordException' })) }));
  assert.match(trancado, /pede senha/);
  assert.match(trancado, /pdfhubSendPicked\('Unlock'\)/);
  assert.doesNotMatch(trancado, /pdfhubSendPicked\('Edit'\)/);
  passa('hub: PDF com senha leva direto a "Remover senha"; PDF normal mostra páginas e tamanho');
}

// 8) Unificar/Dividir/Reorganizar: copyPages não leva os campos de formulário. O app tem de contá-los
//    (para avisar) e a contagem precisa acompanhar o que a pdf-lib realmente faz.
{
  vm.runInThisContext(['pdftoolsFormFieldCount', 'pdftoolsFormLostNote'].map(extrai).join('\n'));
  const d = await PDFDocument.create();
  const pg = d.addPage([300, 300]);
  const f = d.getForm();
  f.createTextField('nome').addToPage(pg, { x: 20, y: 200, width: 200, height: 24 });
  const cb = f.createCheckBox('ok'); cb.addToPage(pg, { x: 20, y: 150, width: 20, height: 20 });
  const origem = await PDFDocument.load(await d.save());
  assert.equal(pdftoolsFormFieldCount(origem), 2);
  const copia = await PDFDocument.create();
  (await copia.copyPages(origem, [0])).forEach(p => copia.addPage(p));
  const lida = await PDFDocument.load(await copia.save());
  assert.equal(pdftoolsFormFieldCount(lida), 0, 'se a pdf-lib passar a copiar os campos, o aviso deixa de ser necessário');
  assert.equal(pdftoolsFormFieldCount(await PDFDocument.create()), 0);
  assert.match(pdftoolsFormLostNote(1), /^1 campo de formulário deixa de ser/);
  assert.match(pdftoolsFormLostNote(3), /^3 campos de formulário deixam de ser/);
  passa('formulário: campos contados e avisados antes de Unificar/Dividir/Reorganizar');
}

// 9) pdf.js: nenhuma chamada de getDocument pode deixar o eval de fontes ligado (CVE-2024-4367).
{
  const chamadas = app.match(/getDocument\(\{[^}]*\}/g) || [];
  assert.ok(chamadas.length >= 14, 'getDocument não encontrado');
  for (const c of chamadas) assert.match(c, /isEvalSupported: false/, c);
  passa('pdf.js: ' + chamadas.length + ' chamadas de getDocument com isEvalSupported: false');
}

// 10) SRI do cdnjs: o hash de cada URL tem de ser o da cópia local de assets/vendor/ (mesma versão).
{
  const { createHash } = await import('node:crypto');
  const mapa = { 'pdf-lib.min.js': 'pdf-lib/1.17.1', 'pdf.min.js': 'pdf.js/3.11.174', 'jszip.min.js': 'jszip/3.10.1', 'mammoth.browser.min.js': 'mammoth/1.12.2' };
  for (const [arq, trecho] of Object.entries(mapa)) {
    const m = app.match(new RegExp("'https://cdnjs\\.cloudflare\\.com/ajax/libs/" + trecho.replace('.', '\\.') + "/[^']+': '(sha384-[^']+)'"));
    assert.ok(m, 'sem SRI para ' + arq);
    const h = 'sha384-' + createHash('sha384').update(readFileSync(new URL('../assets/vendor/' + arq, import.meta.url))).digest('base64');
    assert.equal(m[1], h, 'SRI de ' + arq + ' não confere com a cópia local');
  }
  assert.match(app, /s\.integrity = PDFTOOLS_SRI\[url\]/);
  passa('SRI: hashes do cdnjs conferem com assets/vendor/');
}

// 11) Proteger com senha: mínimo de 8 caracteres (as duas telas: um PDF e vários).
{
  assert.match(app, /const PDFTOOLS_PROTECT_MIN_LEN = 8;/);
  assert.equal((app.match(/pw\.length < PDFTOOLS_PROTECT_MIN_LEN/g) || []).length, 2);
  assert.doesNotMatch(app, /pw\.length < 4\) \{ pdftools/);
  passa('Proteger: senha de pelo menos 8 caracteres nas duas telas');
}

// 12) PDF → JPG: limite de páginas, conferido antes de gerar qualquer imagem.
{
  assert.match(app, /const PDFTOOLS_PDFJPG_MAX_PAGES = 150;/);
  const i = app.indexOf('async function pdftoolsRunPdfToJpg');
  const corpo = app.slice(i, app.indexOf('\n}\n', i));
  assert.ok(corpo.indexOf('PDFTOOLS_PDFJPG_MAX_PAGES') < corpo.indexOf('page.render'), 'o limite tem de vir antes de renderizar');
  passa('PDF → JPG: limite de 150 páginas antes de renderizar');
}

console.log('\n' + ok + ' verificações ok');

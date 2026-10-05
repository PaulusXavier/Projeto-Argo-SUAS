// Gera a pasta dist/ com uma versão "enxuta" do Argo SUAS, pronta para
// publicar no GitHub Pages: mesmos arquivos, só que os grandes (JS e CSS)
// saem sem comentários e sem espaços em branco supérfluos. Os arquivos-fonte
// (js/, css/ etc.) NÃO são alterados — continuam sendo os únicos que você
// edita normalmente.
//
// Rodar manualmente:  npm install   (só na 1ª vez)
//                     npm run build
// O workflow em .github/workflows/deploy.yml já roda isso sozinho a cada
// push na branch principal.
//
// IMPORTANTE sobre identificadores: os arquivos são carregados como
// <script src="..."> soltos (sem "type=module"), e várias variáveis de um
// arquivo são globais usadas por outro (ex.: DATA em data.js é lida por
// app.js). Por isso a minificação usa minifyIdentifiers:false — remove
// comentário e espaço em branco, mas NUNCA renomeia uma variável ou função
// de nível superior.
import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');

// Arquivos grandes que valem a pena minificar (caminhos relativos à raiz).
// Cada um é processado isoladamente (bundle:false), mantendo o mesmo endereço.
const JS_FILES = [
  'js/equipe-cras-cristiana.js',
  'js/data.js',
  'js/argo-mascot.js',
  'js/app.js'
];
const CSS_FILES = ['css/styles.css'];

// Fica FORA do site publicado: scripts/ (build e geradores de uso local),
// .github, package.json etc. Todo o resto é copiado como está para dist/.
const IGNORE = new Set([
  'dist', 'node_modules', 'package.json', 'package-lock.json',
  'scripts', '.github', '.git', '.gitignore', '.gitattributes',
  'README.md', 'docs', '.editorconfig'
]);

async function copyStatic() {
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue;
    await fs.cp(path.join(ROOT, entry.name), path.join(DIST, entry.name), { recursive: true });
  }
}

async function minify(file, options) {
  const result = await build({
    entryPoints: [path.join(ROOT, file)],
    bundle: false,
    write: false,
    logLevel: 'silent',
    ...options
  });
  const out = path.join(DIST, file);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, result.outputFiles[0].contents);
}

const minifyJs = files => Promise.all(files.map(f => minify(f, {
  minifyWhitespace: true,
  minifySyntax: true,
  minifyIdentifiers: false // ver comentário no topo do arquivo
})));

// CSS não tem "identificador global" para renomear — é seguro minificar tudo.
const minifyCss = files => Promise.all(files.map(f => minify(f, { minify: true })));

// Carimba o CACHE_VERSION do sw.js SÓ na cópia publicada (dist/): assim todo
// deploy invalida o cache offline dos aparelhos sozinho e você não precisa
// lembrar de trocar o número à mão. No GitHub usa o hash do commit; local,
// usa a data/hora. O sw.js do repositório não é alterado.
async function stampServiceWorker() {
  const file = path.join(DIST, 'sw.js');
  const src = await fs.readFile(file, 'utf8');
  const stamp = process.env.GITHUB_SHA
    ? process.env.GITHUB_SHA.slice(0, 7)
    : new Date().toISOString().replace(/\D/g, '').slice(0, 12);
  const out = src.replace(/const CACHE_VERSION = '[^']*';/, `const CACHE_VERSION = 'b${stamp}';`);
  if (out === src) throw new Error('Não achei "const CACHE_VERSION" no sw.js para carimbar.');
  await fs.writeFile(file, out);
  console.log(`  sw.js: CACHE_VERSION = b${stamp}`);
}

const fmtKB = bytes => (bytes / 1024).toFixed(1) + ' KB';

async function reportSizes(files) {
  for (const file of files) {
    const before = (await fs.stat(path.join(ROOT, file))).size;
    const after = (await fs.stat(path.join(DIST, file))).size;
    const pct = (100 - (after / before) * 100).toFixed(0);
    console.log(`  ${file}: ${fmtKB(before)} → ${fmtKB(after)} (-${pct}%)`);
  }
}

async function main() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });
  await copyStatic();
  await minifyJs(JS_FILES);
  await minifyCss(CSS_FILES);
  console.log('Build pronta em ./dist:');
  await stampServiceWorker();
  await reportSizes([...JS_FILES, ...CSS_FILES]);
}

main().catch(err => { console.error(err); process.exit(1); });

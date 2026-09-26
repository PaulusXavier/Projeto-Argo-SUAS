// Gera a pasta dist/ com uma versão "enxuta" do Argo SUAS, pronta para
// publicar no GitHub Pages: mesmos arquivos, só que os grandes (JS e CSS)
// saem sem comentários e sem espaços em branco supérfluos. Os arquivos-fonte
// na raiz do repositório (app.js, data.js, styles.css etc.) NÃO são
// alterados — continuam sendo os únicos que você edita normalmente.
//
// Rodar manualmente:  npm install   (só na 1ª vez)
//                     npm run build
// O workflow em .github/workflows/deploy.yml já roda isso sozinho a cada
// push na branch principal, então no dia a dia você não precisa rodar nada
// disso à mão — é só editar os arquivos-fonte e dar push.
//
// IMPORTANTE sobre identificadores: os arquivos são carregados como
// <script src="..."> soltos (sem "type=module"), e várias variáveis de um
// arquivo são globais usadas por outro (ex.: DATA em data.js é lida por
// app.js; EQUIPE_CRAS_CRISTIANA em equipe-cras-cristiana.js é lida por
// app.js e pela página avulso da equipe técnica). Por isso a minificação
// abaixo usa minifyIdentifiers:false — remove comentário e espaço em
// branco (que é de longe o que mais pesa neste projeto, dado o tanto de
// comentário explicativo no código-fonte), mas NUNCA renomeia uma variável
// ou função de nível superior, então nenhum desses vínculos entre arquivos
// quebra.
import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');

// Arquivos grandes que valem a pena minificar. Cada um é processado
// isoladamente (bundle:false) — não viram um arquivo único, porque
// index.html e sw.js esperam cada um no seu próprio endereço.
const JS_FILES = ['equipe-cras-cristiana.js', 'data.js', 'argo-mascot.js', 'app.js'];
const CSS_FILES = ['styles.css'];

// Tudo o que não precisa (ou não deve) ser minificado: HTML, ícones,
// manifesto, service worker, as ferramentas avulsas em .html e os próprios
// arquivos deste processo de build. Copiados para dist/ sem nenhuma
// alteração.
const IGNORE = new Set([
  'dist', 'node_modules', 'package.json', 'package-lock.json',
  'scripts', '.github', '.git', '.gitignore', '.gitattributes'
]);

async function copyStatic() {
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue;
    if (JS_FILES.includes(entry.name) || CSS_FILES.includes(entry.name)) continue;
    await fs.cp(path.join(ROOT, entry.name), path.join(DIST, entry.name), { recursive: true });
  }
}

async function minifyJs(files) {
  for (const file of files) {
    const result = await build({
      entryPoints: [path.join(ROOT, file)],
      outfile: path.join(DIST, file),
      bundle: false,
      minifyWhitespace: true,
      minifySyntax: true,
      minifyIdentifiers: false, // ver comentário no topo do arquivo
      write: false,
      logLevel: 'silent'
    });
    await fs.mkdir(DIST, { recursive: true });
    await fs.writeFile(path.join(DIST, file), result.outputFiles[0].contents);
  }
}

async function minifyCss(files) {
  for (const file of files) {
    const result = await build({
      entryPoints: [path.join(ROOT, file)],
      bundle: false,
      minify: true, // CSS não tem "identificador global" pra renomear — seguro usar tudo
      write: false,
      logLevel: 'silent'
    });
    await fs.mkdir(DIST, { recursive: true });
    await fs.writeFile(path.join(DIST, file), result.outputFiles[0].contents);
  }
}

function fmtKB(bytes) { return (bytes / 1024).toFixed(1) + ' KB'; }

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
  await reportSizes([...JS_FILES, ...CSS_FILES]);
}

main().catch(err => { console.error(err); process.exit(1); });

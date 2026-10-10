// Verificação rápida do repositório — roda em segundos, sem dependências.
//   npm run check
// Também roda no GitHub antes de cada deploy (.github/workflows/deploy.yml):
// se algo estiver quebrado, o deploy é bloqueado e o site no ar continua intacto.
//
// ERROS (bloqueiam):  arquivo referenciado que não existe, JS com erro de
//   sintaxe, IDs repetidos no index.html, CACHE_VERSION ausente no sw.js,
//   item de CRITICAL_ASSETS fora de ASSETS.
// AVISOS (não bloqueiam): arquivo do app que o sw.js não guarda para uso
//   offline, JS do index.html que o build/gerador de proteção não conhece.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const erros = [], avisos = [];
const read = f => readFileSync(path.join(ROOT, f), 'utf8');
const existe = f => existsSync(path.join(ROOT, f));
const erro = m => { if (!erros.includes(m)) erros.push(m); };
const aviso = m => avisos.push(m);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.posix.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...walk(rel)); else out.push(rel);
  }
  return out;
}

// Referências locais (src/href) de um HTML, resolvidas a partir da pasta dele.
function checarRefsHtml(arquivo) {
  const html = read(arquivo);
  const base = path.posix.dirname(arquivo);
  for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const ref = m[1].trim();
    if (!ref || /^(https?:|data:|mailto:|tel:|javascript:|#|\/\/)/i.test(ref)) continue;
    const alvo = path.posix.normalize(path.posix.join(base, ref.split(/[?#]/)[0]));
    if (alvo && !existe(alvo)) erro(`${arquivo}: referência quebrada → ${ref}`);
  }
}

// 1) HTML do app e ferramentas; IDs repetidos no index.
checarRefsHtml('index.html');
for (const f of walk('ferramentas').filter(f => f.endsWith('.html'))) checarRefsHtml(f);
const ids = [...read('index.html').matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
for (const id of new Set(ids.filter((v, i) => ids.indexOf(v) !== i))) erro(`index.html: id repetido "${id}"`);

// 2) Manifesto.
const manifest = JSON.parse(read('manifest.json'));
const iconesManifest = [...(manifest.icons || []), ...(manifest.shortcuts || []).flatMap(s => s.icons || [])];
for (const i of iconesManifest) if (!existe(i.src)) erro(`manifest.json: ícone inexistente → ${i.src}`);

// 3) CSS: url() locais, relativos ao arquivo CSS.
for (const f of walk('css').filter(f => f.endsWith('.css'))) {
  for (const m of read(f).matchAll(/url\(\s*['"]?([^)'"]+)['"]?\s*\)/g)) {
    const ref = m[1];
    if (/^(data:|https?:|#)/.test(ref)) continue;
    const alvo = path.posix.normalize(path.posix.join(path.posix.dirname(f), ref));
    if (!existe(alvo)) erro(`${f}: url() quebrada → ${ref}`);
  }
}

// 4) Links "ferramentas/xxx.html" citados no data.js e no app.js.
for (const f of ['js/data.js', 'js/app.js']) {
  for (const m of new Set([...read(f).matchAll(/ferramentas\/[\w.-]+\.html/g)].map(m => m[0]))) {
    if (!existe(m)) erro(`${f}: link para ferramenta inexistente → ${m}`);
  }
}

// 5) Service Worker.
const sw = read('sw.js');
if (!/const CACHE_VERSION = '[^']*';/.test(sw)) erro('sw.js: "const CACHE_VERSION = \'...\';" não encontrado (o build precisa dele).');
const bloco = nome => (sw.match(new RegExp(`const ${nome} = \\[([\\s\\S]*?)\\];`)) || [])[1] || '';
const locais = txt => [...txt.matchAll(/'\.\/([^']*)'/g)].map(m => m[1]);
const assets = locais(bloco('ASSETS')), criticos = locais(bloco('CRITICAL_ASSETS'));
for (const a of assets) if (a && !existe(a)) erro(`sw.js: ASSETS aponta para arquivo inexistente → ./${a}`);
for (const a of criticos) if (!assets.includes(a)) erro(`sw.js: CRITICAL_ASSETS tem "./${a}" que não está em ASSETS`);
const noApp = [...walk('css'), ...walk('js'), ...walk('assets'), ...walk('ferramentas'), 'index.html', 'manifest.json', 'favicon.ico', 'apple-touch-icon.png'];
for (const f of noApp) if (!assets.includes(f)) aviso(`sw.js: "${f}" não está em ASSETS (não ficará guardado para uso offline desde a instalação)`);

// 6) Sintaxe dos JS.
for (const f of [...walk('js'), 'sw.js', ...walk('scripts').filter(f => f.endsWith('.mjs'))]) {
  try { execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' }); }
  catch (e) { erro(`${f}: erro de sintaxe\n      ${String(e.stderr || e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}

// 7) JS carregados pelo index.html x build x gerador de proteção.
const scriptsIndex = [...read('index.html').matchAll(/<script[^>]*\bsrc="(js\/[^"]+)"/g)].map(m => m[1]);
const build = read('scripts/build.mjs');
const needed = (read('scripts/gerar-protecao.html').match(/const NEEDED = \[([^\]]*)\]/) || [])[1] || '';
for (const s of scriptsIndex) {
  if (!existe(s)) continue;
  // auth-config.js é minúsculo e é substituído pelo gerador de senha: fica sem minificar de propósito.
  if (!build.includes(`'${s}'`) && !s.endsWith('auth-config.js')) aviso(`build.mjs: "${s}" não está em JS_FILES (vai para o site sem minificar)`);
  if (!needed.includes(`'${path.posix.basename(s)}'`)) aviso(`gerar-protecao.html: "${path.posix.basename(s)}" não está em NEEDED (a versão protegida vai recusar gerar)`);
}

// 8) Base de normas do Paulus: o service worker a baixa em TODA instalação/atualização do app, então ela tem que ser a
// versão leve (conhecimento-geral.json do repositório paulus, ~0,4 MB). A base completa (~8 MB) trava o aparelho.
if (existe('assets/conhecimento.json')) {
  const mb = statSync(path.join(ROOT, 'assets/conhecimento.json')).size / 1048576;
  if (mb > 2) erro(`assets/conhecimento.json tem ${mb.toFixed(1)} MB: use o pacote leve (dist/conhecimento-geral.json do paulus), não o conhecimento.json inteiro.`);
}
// Nada de conhecimento*.json solto fora de assets/ (iria para o site sem ninguém usar).
for (const f of walk('assets')) if (/conhecimento.*\.json$/.test(f) && f !== 'assets/conhecimento.json') erro(`${f}: cópia solta da base de normas; apague (a única é assets/conhecimento.json).`);

// Resultado.
for (const a of avisos) console.log('⚠️  ' + a);
for (const e of erros) console.log('❌ ' + e);
console.log(erros.length
  ? `\n${erros.length} erro(s), ${avisos.length} aviso(s). Corrija antes de publicar.`
  : `✅ Tudo certo${avisos.length ? ` (${avisos.length} aviso(s))` : ''}.`);
process.exit(erros.length ? 1 : 0);

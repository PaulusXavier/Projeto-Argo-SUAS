# Desenvolvimento — como evoluir o Argo SUAS

Fluxo do dia a dia para um app que muda sempre. Complementa o [README](../README.md).

## Rotina de uma melhoria

1. Edite os arquivos-fonte (`js/`, `css/`, `index.html`, `ferramentas/`). Nunca edite `dist/`.
2. Teste localmente servindo a pasta (o Service Worker não funciona por `file://`):
   `python3 -m http.server 8000` e abra `http://localhost:8000`. Use `Ctrl+Shift+R` (ou *Application → Service Workers → Unregister*) para não ver cache antigo.
3. Rode `npm run check` (precisa de `npm install` na 1ª vez). Ele confere, em segundos, se há arquivo referenciado que não existe, erro de sintaxe em JS, IDs repetidos, e se o `sw.js`, o build e o gerador de proteção conhecem seus arquivos. Erros bloqueiam; avisos (⚠️) são só lembretes.
4. Faça o commit e o push na `main`. O workflow roda o `check`, depois o `build`, e publica. **Se o `check` falhar, o deploy é cancelado e o site no ar não muda.**
   - O `CACHE_VERSION` do `sw.js` é carimbado **automaticamente** no build (hash do commit). Não precisa mexer nele.

## Onde fica cada coisa

| Quero… | Mexo em… |
|---|---|
| Atualizar equipamentos/serviços da rede | `js/data.js` |
| Mudar a equipe do CRAS | `js/equipe-cras-cristiana.js` |
| Mudar lógica, abas ou telas | `js/app.js` (+ `index.html` se for estrutura) |
| Mudar visual | `css/styles.css` |
| Mexer na aparência do mascote/painel de conversa | `js/argo-mascot.js` |
| Mexer na inteligência do assistente (busca, glossário, IA) | `js/argo-cerebro.js` e o bloco "IA NO MASCOTE" no fim de `js/app.js` |
| Adicionar página avulsa | nova `.html` em `ferramentas/` |
| Adicionar ícone/imagem | `assets/img/` |

## Checklists

**Novo arquivo JS ou CSS**
- [ ] Referenciar no `index.html` (JS: depois de `data.js`, antes de `app.js` se o `app.js` depender dele).
- [ ] Incluir em `ASSETS` (e em `CRITICAL_ASSETS`, se o app não funciona sem ele) no `sw.js`.
- [ ] Se for grande, incluir em `JS_FILES`/`CSS_FILES` no `scripts/build.mjs` para ser minificado.
- [ ] Se usar a versão protegida: incluir o nome em `NEEDED` no `scripts/gerar-protecao.html`.

**Nova ferramenta em `ferramentas/`**
- [ ] Incluir em `ASSETS` do `sw.js` para abrir offline.
- [ ] Linkar no `data.js` (ou onde o app a abre) como `ferramentas/nome.html`.
- [ ] Se ler arquivo da raiz, usar caminho relativo com `../` (ex.: `../js/...`).

**Nova imagem/ícone**
- [ ] Se for usada pelo app offline, incluir em `ASSETS` do `sw.js`.
- [ ] Em CSS, o caminho é relativo ao arquivo: de `css/styles.css` use `../assets/img/...`.

## Cuidados que valem sempre

- Os JS são scripts clássicos (sem `type=module`) e compartilham variáveis globais. Não use `import`/`export`; o build não renomeia identificadores justamente por isso.
- Dados e senha: veja [SEGURANCA.md](SEGURANCA.md). Depois de editar `app.js`/`data.js`, quem usa a versão protegida precisa gerar o `argo.enc` de novo.

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
| Mexer na inteligência do assistente (busca, glossário, memória) | `js/argo-cerebro.js` e o bloco "IA NO MASCOTE" no fim de `js/app.js` |
| Ensinar o mascote a **usar o app** (nova aba, nova ferramenta, mudança numa função da Central de PDF, no backup ou na segurança) | `MANUAL` no bloco "MANUAL DO APP" de `js/argo-cerebro.js`: acrescente ou corrija um verbete (`id`, `nome`, `keys` sem acento e minúsculas, `texto`, e `open` com o `data-cat` da aba para o botão "Abrir"). Chave com `!` na frente (ex.: `'!mapa'`) é nome de aba e basta uma palavra; as demais precisam de 2+ palavras na pergunta. **Escreva só o que o código confirma.** Números que o app define (bloqueio por inatividade, "manter conectado", tentativas de senha) entram no texto como `{bloqueioMin}`, `{lembrarHoras}`, `{tentativas}` e são passados por `ArgoCerebro.init({ manual })` em `argoBrain()`; não escreva o número à mão. Aba nova também precisa entrar em `ARGO_ACOES_IA` (`js/app.js`) para a IA poder propô-la. Rode `npm run test:manual` (ele confere que cada verbete é alcançável, que todo botão aponta para uma aba da barra lateral e que `ARGO_ACOES_IA` cobre todas as abas) |
| Mexer nas respostas do mascote sobre **Boa Vista** (panorama por área, perfil de bairro, "onde faço o CadÚnico", maternidade, EJA, vaga em creche, dados que o diretório não tem) | bloco "PAINEL DE BOA VISTA" em `js/argo-cerebro.js` (`perfilBairro`, `panoramaAreas`, `NECESS`, `semNumeros`). Os números saem das fichas de `js/data.js`; para uma nova necessidade, copie um item de `NECESS` e aponte para ids reais de `data.js`. Rode `npm run test:territorio` |
| Acrescentar ou corrigir uma resposta da **base do psicólogo no SUAS** (documentos, sigilo, Sistema de Justiça, violência) | `PSI_BASE` em `js/argo-cerebro.js`: copie um verbete, troque `id`, `keys`, `text` e `base`, atualize `PSI_REV` e rode `npm run test:territorio` (ele confere que cada pergunta cai no verbete certo). Só inclua o que estiver em texto oficial e cite a norma |
| Mexer na IA, nas normas citadas ou no prompt | **repositório `paulus`** (`client/`, `worker/`, `knowledge/`). Depois: `npm run build` lá e copie `dist/paulus.v1.js` → `js/paulus.v1.js` e `dist/conhecimento-geral.json` → `assets/conhecimento.json` aqui (o pacote leve, ~0,4 MB; nunca o `conhecimento.json` inteiro). Se mudou `worker/` ou `knowledge/`, publique o Worker de novo; `assets/conhecimento.json` também alimenta a busca offline e os trechos agregados do Censo SUAS 2025 enviados ao mascote em perguntas sobre profissionais ou equipes. |
| Mexer nos dados/respostas dos **municípios de Roraima** (população, indígenas, área, CadÚnico/Bolsa Família/BPC, comparação, ficha) | `scripts/gerar-municipios-rr.mjs` (tabela fixa + leitura dos diagnósticos; **confere cada número contra `assets/conhecimento.json` e para se algo não bater**) → `npm run gerar:municipios` gera `assets/municipios-rr.json`. As respostas ficam no bloco "MUNICÍPIOS DE RORAIMA" de `js/argo-cerebro.js` (`rrAsk`); a mesma ficha vai para a IA como base do app (`baseApp`) e as unidades do município como fichas (`municipioFichas`). Para um município novo no diagnóstico, acrescente em `DIAG` só se o relatório for de **um** município; relatório que mistura municípios não se divide. Rode `npm run test:territorio` |
| Mexer nas respostas do mascote sobre **psicólogos no Censo SUAS 2025** (quantos em Boa Vista/Roraima/outro município, por módulo, perfil) | Resposta direta: bloco "PSICÓLOGOS NO CENSO SUAS 2025" em `js/argo-cerebro.js` (`CP_MUN`, `CP_RR`, `CP_BV_PERFIL`; função `psiCensoAsk`). Resposta da IA: trechos em `knowledge/documentos/censo-suas-2025-roraima-psicologos.md` no repositório `paulus` (depois `npm run build` lá e copie `dist/conhecimento-geral.json` → `assets/conhecimento.json`). Os dois precisam concordar: o teste `npm run test:territorio` confere o total de Boa Vista nos dois. São contagens de **registros**, nunca de pessoas únicas. **Interior (14 municípios):** perfil (sexo, escolaridade, vínculo, função, carga horária, serviço) e composição da equipe de RH ficam em `CP_PERFIL_MUN`, `CP_EQUIPE_MUN` e `CP_INTERIOR`, **gerados** por `node scripts/gerar-censo-psi-rr.mjs <pasta-dos-CSVs-do-Censo> <pasta-de-saída>` (não edite à mão: cole o `cp-perfil.js` no lugar do bloco antigo e leve o `censo-interior.md` para o mesmo documento do `paulus`). Leia o `conferencia.txt`: qualquer `DIVERGE` precisa ser entendido antes de publicar. Perguntas atendidas sem IA: perfil/equipe de qualquer município, "interior", ranking por município e "quais municípios não têm psicólogo nos CRAS/CREAS" |
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

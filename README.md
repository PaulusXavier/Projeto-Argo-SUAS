# Argo SUAS — Painel e Ferramentas da Rede de Políticas Públicas de Roraima

Conjunto de aplicativos web (PWA) e ferramentas offline desenvolvidos para apoiar o trabalho técnico de Referência, dentro do Sistema Único de Assistência Social (SUAS).

Todo o projeto foi criado por **Paulo Xavier, Psicólogo — CRP-20/09816**.

## 📱 Aplicativo principal: Argo SUAS

Um diretório técnico instalável (PWA) dos equipamentos socioassistenciais e da rede RAPS de Boa Vista/RR, com:

- Busca e filtros por tipo de serviço, categoria e território;
- Ficha de encaminhamento técnico para impressão, com dados da unidade e conduta profissional;
- Anexo de fotos e PDFs à ficha de encaminhamento;
- Aba **"Central de PDF"** (Ferramentas de Arquivo): **editar PDF** (ver a página, reescrever textos que já existem no PDF, escrever textos novos (com fonte Arial/Times/Courier, negrito, itálico, cor e tamanho), preenchimento dos campos de formulário do próprio PDF (texto, caixas de marcar, opções e listas, com opção de travar o formulário), carimbos (certo, errado, bolinha e data de hoje), sublinhado e riscado além do realce, toque numa linha para realçá-la inteira, desenhar com caneta, caixa e linha, realçar, cobrir trechos, inserir imagem ou assinatura — com opção de tornar o fundo branco da foto transparente —, apagar itens, desfazer/refazer, zoom e navegação entre páginas; as edições ficam por cima do conteúdo original); unificar até 20 arquivos entre PDFs e fotos JPG/PNG (até 50 MB no total), com escolha das páginas de cada PDF, giro de 90° e correção automática da orientação de fotos de celular; dividir/extrair, excluir e girar páginas (escolhendo-as tocando nas miniaturas ou digitando, com atalhos Ímpares/Pares/Primeira/Última), numerar, aplicar marca d'água, limpar dados ocultos (autor, título, programa criador), extrair o texto para .txt e reduzir o tamanho de um PDF; lembra no aparelho as últimas opções usadas; converter PDF ⇄ Word e PDF ⇄ JPG (JPG → PDF aceita foto tirada na hora com a câmera do celular, página A4 ou do tamanho da imagem e nome do arquivo à escolha) — tudo processado no próprio navegador, sem enviar arquivos a servidor algum;
- Aba **"Aplicativos"**: atalhos para os demais aplicativos do autor (Toth — Caderno de Campo, Umbrela — PAIF/PAF, Anona — Condicionalidades e Bloco de Notas) e para o site do autor (Vita), cada um hospedado em seu próprio endereço e aberto em nova aba, com login e sincronização independentes;
- Atalho para o site do autor (**Vita**) no painel de login, logo abaixo do formulário; o mascote Argo apresenta o aplicativo na tela de login e recomenda a visita ao site;
- **Navegação:** busca dentro do menu de categorias, faixa de *Acesso rápido* fixa (Agenda Argo, Mapa dos Equipamentos, Tradutor, Central de PDF, Aplicativos e Notícias — fora da grade lateral), seletor "Ir para…" e setas ‹ › na tela cheia, links diretos `index.html#aba=noticias` (também usados pelos atalhos do app instalado), e atalhos de teclado (`/` busca, `Ctrl/⌘+K` troca de aba, `Esc` fecha);
- **Mascote Argo:** barquinho com o comandante a bordo (boné com Ψ), que muda de pose e expressão conforme o aviso (info, sucesso, erro, não encontrado). O assistente abre com o botão do barquinho ou com a tecla `?`, é um assistente com IA opcional: responde no próprio aparelho (até sem internet) a pedidos de socorro, perguntas sobre unidades (telefone, endereço, horário, bairro, com cartões de ligar/mapa/ficha), dúvidas do SUAS com a base normativa e abertura de abas; lembra do que foi dito na conversa; e, com o Worker da Cloudflare ligado (`scripts/ia-worker`), responde perguntas abertas em streaming, conferindo telefones citados. Fica disponível também na tela cheia. Para trocar a aparência, ajuste `PILOT` (cores) ou preencha `CUSTOM_IMAGE_SRC` no topo de `argo-mascot.js`;
- **Aba Ferramentas — atendimento:** além do relógio, calculadora e bloco de notas, reúne renda per capita, idade e datas, QR Code, contador de atendimentos, prazos em dias úteis, **conferência de NIS e CPF** avulsos (formato e dígito verificador, sem salvar nada), **valor por extenso** em reais (para recibos, declarações e ofícios), **link de WhatsApp** (abre a conversa sem salvar o contato, aceita número de outro país com `+`, traz modelos de mensagem editáveis e gera QR Code) e **formatador de texto** (nome próprio, maiúsculas, limpar espaços, tirar acentos), com botões de copiar e de enviar por WhatsApp nos resultados (o envio de unidades, anotações e resultados trata texto longo demais e pop-up bloqueado copiando o texto, e a anotação pede confirmação antes de sair do app, por poder ter dados de pessoas atendidas), busca (atalho `/`), filtros por tipo, favoritas (★) e recolher. Tudo roda no aparelho.
- **Analisador de planilha** (aba **Ferramentas**): carrega a planilha da base de famílias (.csv, .xlsx ou .xls) e conta valores por coluna, acha duplicados, confere NIS, CPF e datas, lista campos vazios e conta linhas por filtro. Tudo é lido no aparelho, sem enviar nem salvar nada; NIS e CPF aparecem só com os 3 últimos dígitos. A conferência vê formato e dígito verificador, não a existência no CadÚnico. Em .xlsx/.xls baixa a biblioteca SheetJS do cdnjs no primeiro uso; CSV funciona offline.
- **IA no mascote (opcional, desligada por padrão):** o Argo responde primeiro com as respostas prontas, que funcionam offline. Só quando elas não entendem a pergunta, e havendo internet e o endereço do Worker em `ARGO_IA.url` (`js/app.js`), ele consulta a IA gratuita da Cloudflare (Workers AI, sem chave de API e sem cartão, dentro da cota diária do plano Workers Free) pelo **Paulus** (`js/paulus.v1.js` + Worker do repositório `paulus`, publicado conforme o `docs/DEPLOY.md` de lá). O Paulus acrescenta trechos de norma com citação (documento e artigo) e, se a IA falhar, responde com a base de normas offline (`assets/conhecimento.json`). O Worker antigo (`scripts/ia-worker/`) fica só como referência. Saem do aparelho apenas o texto da pergunta e até 4 fichas do diretório público; perguntas com documento, telefone, e-mail ou nome e sobrenome são barradas antes do envio. Se a IA falhar, vale a resposta pronta. Respostas de IA vêm com aviso para conferir com a unidade.
- Funcionamento offline via Service Worker, com ícones e manifesto para instalação no celular/desktop (as ferramentas de PDF acima baixam pequenas bibliotecas do cdnjs.cloudflare.com na primeira vez que são usadas, então essa aba precisa de internet nesse primeiro uso).

**Organização:** `index.html`, `manifest.json`, `sw.js` (precisa ficar na raiz), `favicon.ico` e `apple-touch-icon.png` ficam na raiz; estilos em `css/`, scripts em `js/` e ícones/imagens em `assets/img/`.

## 🧰 Ferramentas complementares

| Arquivo (pasta `ferramentas/`) | Função |
|---|---|
| `calendario-pbf.html` | Calendário do Programa Bolsa Família 2026, com sincronização em nuvem (Informe nº 105/2026 – MDS) |
| `pagamento-pbf.html` | Consulta rápida da data de pagamento do Bolsa Família pelo final do NIS |
| `equipe-tecnica-cras.html` | Consulta da equipe técnica de referência territorial e da equipe volante, com busca por bairro ou técnico (lê os dados de `equipe-cras-cristiana.js`) |
| `registro-atendimento-planilha.html` | Planilha de registro mensal de atendimentos (RMA) com soma automática por nacionalidade, sexo e faixa etária, pronta para impressão em A4 paisagem |
| `rma-formulario.html` | Formulário de Registro Mensal de Atendimentos do CRAS (blocos do PAIF), com salvamento local e impressão em A4 retrato |
| `mapa-vila-jardim.html` | Mapa interativo (Leaflet) do território de referência |

## 🗂️ Estrutura do repositório

```
/
├── index.html                  Aplicativo principal (Argo SUAS)
├── manifest.json               Manifesto do PWA
├── sw.js                       Service Worker (cache offline) — precisa ficar na raiz
├── favicon.ico, apple-touch-icon.png
├── css/
│   └── styles.css              Estilos
├── js/
│   ├── app.js                  Lógica do aplicativo
│   ├── data.js                 Fichas dos equipamentos (edite aqui para atualizar a rede)
│   ├── equipe-cras-cristiana.js  Equipe do CRAS (usada pelo app e por ferramentas/equipe-tecnica-cras.html)
│   ├── argo-mascot.js          Mascote e painel de conversa do Argo
│   ├── argo-cerebro.js         Cérebro do assistente (diretório, base SUAS, memória da conversa)
│   ├── paulus.v1.js            Cliente do Paulus (cópia gerada no repositório "paulus": ida à IA, filtro de dados pessoais e base de normas)
│   └── auth-config.js          Configuração da senha (ver "Senha forte")
├── assets/
│   ├── conhecimento.json       Base de normas do Paulus (offline; cópia gerada no repositório "paulus")
│   └── img/                    Ícones do PWA, ícones dos aplicativos, imagens de fundo
├── ferramentas/                Páginas avulsas (PBF, RMA, equipe técnica, mapa) — publicadas
├── docs/
│   ├── DESENVOLVIMENTO.md      Fluxo de trabalho e checklists para evoluir o app
│   └── SEGURANCA.md            Senha forte e versão protegida (cifrada)
├── scripts/                    Uso local, NÃO publicadas
│   ├── verificar.mjs           Confere o repositório antes do deploy (npm run check)
│   ├── build.mjs               Gera a pasta dist/ (minificada)
│   ├── gerar-senha-forte.html  Gera o js/auth-config.js
│   └── gerar-protecao.html     Gera a versão cifrada do app
├── .github/workflows/deploy.yml  Build + publicação automática no GitHub Pages
├── package.json, package-lock.json
└── .gitignore, .gitattributes, .editorconfig
```

> O `CACHE_VERSION` do `sw.js` é carimbado sozinho a cada build (deploy). Ao adicionar um arquivo novo que o app precise offline, inclua-o na lista `ASSETS` do `sw.js`. Checklists completos em [`docs/DESENVOLVIMENTO.md`](docs/DESENVOLVIMENTO.md).

## 🚀 Como usar

1. Clone ou baixe este repositório.
2. Para o app principal, ative o **GitHub Pages** em *Settings → Pages → Source: GitHub Actions*; o workflow `deploy.yml` faz o build e publica a cada push na `main`. Para testar localmente, sirva a pasta com qualquer servidor estático (o Service Worker não funciona via `file://`).
3. As páginas de `ferramentas/` podem ser abertas diretamente no navegador, sem necessidade de servidor. A pasta `scripts/` é só para uso local e não vai para o site publicado.

## 🛠️ Tecnologias

HTML, CSS e JavaScript puros (vanilla), com uso pontual de Tailwind CSS, Lucide Icons e Leaflet.js. PWA com `manifest.json` e Service Worker para instalação e uso offline.

## 🔐 Segurança

O app abre com uma senha da equipe. Por padrão ela usa um formato antigo e fraco; o passo a passo para ativar o formato forte (PBKDF2 + ChaCha20-Poly1305) e para gerar a versão cifrada do site está em [`docs/SEGURANCA.md`](docs/SEGURANCA.md).

## 👤 Autor

**Paulo Xavier** — Psicólogo, CRP-20/09816
 SUAS · Boa Vista/RR

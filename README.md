# Argo SUAS — Painel e Ferramentas da Rede de Políticas Públicas de Roraima

Conjunto de aplicativos web (PWA) e ferramentas offline desenvolvidos para apoiar o trabalho técnico de Referência, dentro do Sistema Único de Assistência Social (SUAS).

Todo o projeto foi criado por **Paulo Xavier, Psicólogo — CRP-20/09816**.

## 📱 Aplicativo principal: Argo SUAS

Um diretório técnico instalável (PWA) dos equipamentos socioassistenciais e da rede RAPS de Boa Vista/RR, com:

- Busca e filtros por tipo de serviço, categoria e território;
- Ficha de encaminhamento técnico para impressão, com dados da unidade e conduta profissional;
- Anexo de fotos e PDFs à ficha de encaminhamento;
- Aba **"Unificar / Converter PDF"** (Ferramentas de Arquivo): unificar até 20 arquivos entre PDFs e fotos JPG/PNG (até 50 MB no total), com escolha das páginas de cada PDF, giro de 90° e correção automática da orientação de fotos de celular; converter PDF ⇄ Word e PDF ⇄ JPG — tudo processado no próprio navegador, sem enviar arquivos a servidor algum;
- Aba **"Aplicativos"**: atalhos para os demais aplicativos do autor (Toth — Caderno de Campo, Umbrela — PAIF/PAF, Anona — Condicionalidades e Bloco de Notas) e para o site do autor (Vita), cada um hospedado em seu próprio endereço e aberto em nova aba, com login e sincronização independentes;
- Atalho para o site do autor (**Vita**) no painel de login, logo abaixo do formulário; o mascote Argo apresenta o aplicativo na tela de login e recomenda a visita ao site;
- **Navegação:** busca dentro do menu de categorias, faixa de *Acesso rápido* fixa (Agenda Argo, Mapa dos Equipamentos, Tradutor, Unificar / Converter PDF, Aplicativos e Notícias — fora da grade lateral), seletor "Ir para…" e setas ‹ › na tela cheia, links diretos `index.html#aba=noticias` (também usados pelos atalhos do app instalado), e atalhos de teclado (`/` busca, `Ctrl/⌘+K` troca de aba, `Esc` fecha);
- **Mascote Argo:** barquinho com o comandante a bordo (boné com Ψ), que muda de pose e expressão conforme o aviso (info, sucesso, erro, não encontrado). O assistente abre com o botão do barquinho ou com a tecla `?`, entende pedidos em linguagem natural, sugere abas e busca direto nos equipamentos, traz dicas da aba aberta e fica disponível também na tela cheia. Para trocar a aparência, ajuste `PILOT` (cores) ou preencha `CUSTOM_IMAGE_SRC` no topo de `argo-mascot.js`;
- Funcionamento offline via Service Worker, com ícones e manifesto para instalação no celular/desktop (as ferramentas de PDF acima baixam pequenas bibliotecas do cdnjs.cloudflare.com na primeira vez que são usadas, então essa aba precisa de internet nesse primeiro uso).

**Arquivos principais (na raiz):** `index.html`, `styles.css`, `app.js`, `data.js`, `equipe-cras-cristiana.js`, `argo-mascot.js`, `auth-config.js`, `manifest.json`, `sw.js`, `favicon.ico`, `apple-touch-icon.png`. Ícones e imagens ficam em `assets/img/`.

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
├── styles.css                  Estilos
├── app.js                      Lógica do aplicativo
├── data.js                     Fichas dos equipamentos (edite aqui para atualizar a rede)
├── equipe-cras-cristiana.js    Equipe do CRAS (usada pelo app e por ferramentas/equipe-tecnica-cras.html)
├── argo-mascot.js              Mascote/assistente Argo
├── auth-config.js              Configuração da senha (ver "Senha forte")
├── manifest.json               Manifesto do PWA
├── sw.js                       Service Worker (cache offline) — precisa ficar na raiz
├── favicon.ico, apple-touch-icon.png
├── assets/
│   └── img/                    Ícones do PWA, ícones dos aplicativos, imagens de fundo
├── ferramentas/                Páginas avulsas (PBF, RMA, equipe técnica, mapa) — publicadas
├── scripts/                    Uso local, NÃO publicadas
│   ├── build.mjs               Gera a pasta dist/ (minificada)
│   ├── gerar-senha-forte.html  Gera o auth-config.js
│   └── gerar-protecao.html     Gera a versão cifrada do app
├── .github/workflows/deploy.yml  Build + publicação automática no GitHub Pages
├── package.json
└── .gitignore
```

> Ao adicionar um arquivo novo que o app precise offline, inclua-o na lista `ASSETS` do `sw.js` e troque o `CACHE_VERSION`.

## 🚀 Como usar

1. Clone ou baixe este repositório.
2. Para o app principal, publique a pasta no **GitHub Pages** (ou abra `index.html` localmente) — o Service Worker cuidará do cache offline.
3. As páginas de `ferramentas/` podem ser abertas diretamente no navegador, sem necessidade de servidor. A pasta `scripts/` é só para uso local e não vai para o site publicado.

## 🛠️ Tecnologias

HTML, CSS e JavaScript puros (vanilla), com uso pontual de Tailwind CSS, Lucide Icons e Leaflet.js. PWA com `manifest.json` e Service Worker para instalação e uso offline.

## 👤 Autor

**Paulo Xavier** — Psicólogo, CRP-20/09816
 SUAS · Boa Vista/RR

## Senha forte (segurança)

O app abre com uma senha da equipe. Por padrão ele ainda usa o formato **antigo** (SHA-256 simples), que é fraco: quem baixar o site pode testar bilhões de senhas por segundo. Para ativar o formato **forte**:

1. Abra `scripts/gerar-senha-forte.html` direto da sua pasta (funciona offline; não acessa a internet).
2. Digite a senha (12+ caracteres) duas vezes e clique em **Gerar**.
3. Substitua o arquivo `auth-config.js` da raiz pelo gerado, e publique.

Com isso, a senha passa a ser conferida por PBKDF2 (600.000 iterações) e os dados salvos passam a usar ChaCha20-Poly1305, migrando sozinhos no primeiro login. A senha não pode ser recuperada; se for trocada, os dados salvos com a antiga ficam ilegíveis (faça o "Backup de anotações" antes).

Observação: o hash antigo continua no histórico do Git. Se a senha atual for curta ou comum, prefira trocá-la por uma nova ao ativar o modo forte.

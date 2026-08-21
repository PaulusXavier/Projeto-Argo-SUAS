# Argo SUAS — Painel e Ferramentas do CRAS Cristiana Vicente Nunes

Conjunto de aplicativos web (PWA) e ferramentas offline desenvolvidos para apoiar o trabalho técnico do **CRAS Cristiana Vicente Nunes**, da **SEMADS – Prefeitura de Boa Vista/RR**, dentro do Sistema Único de Assistência Social (SUAS).

Todo o projeto foi criado por **Paulo Xavier, Psicólogo — CRP-20/09816**.

## 📱 Aplicativo principal: Argo SUAS

Um diretório técnico instalável (PWA) dos equipamentos socioassistenciais e da rede RAPS de Boa Vista/RR, com:

- Busca e filtros por tipo de serviço, categoria e território;
- Ficha de encaminhamento técnico para impressão, com dados da unidade e conduta profissional;
- Anexo de fotos e PDFs à ficha de encaminhamento;
- Funcionamento offline via Service Worker, com ícones e manifesto para instalação no celular/desktop.

**Arquivos:** `index.html`, `manifest.json`, `sw.js`, `favicon.ico`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`

## 🧰 Ferramentas complementares

| Arquivo | Função |
|---|---|
| `PBF.HTML` | Calendário do Programa Bolsa Família 2026, com sincronização em nuvem (Informe nº 105/2026 – MDS) |
| `PagamentoPBF.html` | Consulta rápida da data de pagamento do Bolsa Família pelo final do NIS |
| `Divisão_Territorial___Equipe_Técnica_-_CRAS_Cristiana.html` | Consulta da equipe técnica de referência territorial e da equipe volante, com busca por bairro ou técnico |
| `Registro_de_Atendimento__Planilha_.html` | Planilha de registro mensal de atendimentos (RMA) com soma automática por nacionalidade, sexo e faixa etária, pronta para impressão em A4 paisagem |
| `RMA_Paulo_Xavier_2026.html` | Formulário de Registro Mensal de Atendimentos do CRAS (blocos do PAIF), com salvamento local e impressão em A4 retrato |
| `vila-jardim.html` | Mapa interativo (Leaflet) do território de referência |

## 🚀 Como usar

1. Clone ou baixe este repositório.
2. Para o app principal, publique a pasta no **GitHub Pages** (ou abra `index.html` localmente) — o Service Worker cuidará do cache offline.
3. As demais ferramentas (`.html`) podem ser abertas diretamente no navegador, sem necessidade de servidor.

## 🛠️ Tecnologias

HTML, CSS e JavaScript puros (vanilla), com uso pontual de Tailwind CSS, Lucide Icons e Leaflet.js. PWA com `manifest.json` e Service Worker para instalação e uso offline.

## 👤 Autor

**Paulo Xavier** — Psicólogo, CRP-20/09816
CRAS Cristiana Vicente Nunes · SEMADS · Boa Vista/RR

# Segurança — senha e versão protegida

Complementa o [README](../README.md).

## 1. Senha forte (formato PBKDF2)

O app abre com uma senha da equipe. Por padrão ele ainda usa o formato **antigo** (SHA-256 simples), que é fraco: quem baixar o site pode testar bilhões de senhas por segundo. Para ativar o formato **forte**:

1. Abra `scripts/gerar-senha-forte.html` direto da sua pasta (funciona offline; não acessa a internet).
2. Digite a senha (12+ caracteres) duas vezes e clique em **Gerar**.
3. Substitua o arquivo `js/auth-config.js` pelo gerado, e publique.

Com isso, a senha passa a ser conferida por PBKDF2 (600.000 iterações) e os dados salvos passam a usar ChaCha20-Poly1305, migrando sozinhos no primeiro login. A senha não pode ser recuperada; se for trocada, os dados salvos com a antiga ficam ilegíveis (faça o "Backup de anotações" antes).

Observação: o hash antigo continua no histórico do Git. Se a senha atual for curta ou comum, prefira trocá-la por uma nova ao ativar o modo forte.

## 2. Versão protegida (app inteiro cifrado)

Para que o código e os dados do app não fiquem legíveis no site publicado:

1. Abra `scripts/gerar-protecao.html` direto da sua pasta (funciona offline).
2. Selecione de uma vez os arquivos **originais**: `index.html` (raiz) e, de `js/`, `app.js`, `data.js`, `equipe-cras-cristiana.js`, `argo-mascot.js`, `argo-cerebro.js`, `paulus.v1.js` e `auth-config.js`.
3. Defina a senha (12+ caracteres) e clique em **Gerar versão protegida**.
4. Do ZIP gerado, publique `index.html`, `gate.js`, `argo.enc` e `sw.js` e **apague a pasta `js/`** do site. Mantenha `css/`, `assets/`, `ferramentas/` e `manifest.json`.
5. Publique em um repositório **novo** (ou privado): o histórico do Git antigo continua com os arquivos em texto aberto.

> Esse fluxo é alternativo ao deploy automático (`deploy.yml`), que publica a versão aberta. Use um ou outro.

## Voz no assistente (microfone e leitura em voz alta)

- **Desligada por padrão.** O microfone só liga depois de um aviso (uma vez) e de o usuário tocar no 🎤.
- **O áudio não é do Argo.** O reconhecimento de voz é feito pelo navegador; em vários (Chrome, Edge) o áudio vai ao serviço de voz do fabricante. O Argo não grava, não guarda e não envia áudio ao Worker. Em atendimento, **não fale nome, documento nem dado de pessoa atendida** (o mesmo cuidado de digitar).
- **O texto falado entra no campo e espera o toque em enviar.** Depois disso vale tudo que vale para pergunta digitada: filtro de dados pessoais, socorro e limite de tamanho (500 caracteres).
- **Leitura em voz alta:** usa a voz do aparelho, só do texto da resposta (sem fontes, notas ou cartões), e para ao trancar o app, fechar o painel, nova conversa ou nova pergunta. Em local com outras pessoas por perto, prefira deixar desligada: a resposta pode ter dado da rede ou de um caso descrito.
- **Salvo no aparelho:** apenas `argo_assistant_voice_v1` = `{ read, mic }` (ligado/desligado). Nenhum conteúdo.

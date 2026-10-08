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

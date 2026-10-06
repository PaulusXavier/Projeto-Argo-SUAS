# IA gratuita do mascote Argo (opcional)

O mascote funciona sem IA, só com as respostas prontas. Quando você publica este
Worker e coloca o endereço dele no app, o Argo passa a usar IA **só para perguntas
que as respostas prontas não entendem**, e só se houver internet. Se o Worker cair,
a cota do dia acabar ou estiver sem internet, o app volta ao comportamento de sempre.

## É gratuito mesmo?
Sim, enquanto você ficar no plano **Workers Free** da Cloudflare: não pede cartão e
não usa chave de API. O Workers AI dá 10.000 "neurons" por dia de graça, uma conta
que depende do modelo; uma pergunta curta como as do Argo gasta bem pouco, então a
cota deve dar para centenas de perguntas por dia. No plano gratuito não há cobrança
por excesso: acabando a cota, a IA para até 00:00 UTC (20h em Roraima) e o Argo usa
as respostas prontas. Os valores e limites da Cloudflare podem mudar; confira em
developers.cloudflare.com/workers-ai/platform/pricing.

## O que esperar da qualidade
O modelo gratuito (Llama 3.1 8B) é bem menor que os modelos pagos. Ele explica bem
o básico do SUAS e usa as fichas do diretório para endereço, telefone e horário, mas
pode errar em questões técnicas finas. Por isso toda resposta traz o aviso para
conferir. Para trocar de modelo, use a variável `MODELO` (veja a lista no painel,
em AI → Workers AI → Models).

## O que sai do aparelho
- O texto da pergunta (até 500 caracteres) e até 4 fichas do diretório público
  (nome, endereço, horário, telefone e serviços dos equipamentos), que passam pela
  Cloudflare.
- **Nunca** dados de famílias, planilhas ou o Bloco de notas.
- Antes de enviar, o app bloqueia perguntas com sequência longa de números
  (CPF, NIS, telefone), e-mail ou "nome + sobrenome". O Worker repete a conferência.

## Publicar (pelo painel, sem terminal)
1. Crie uma conta gratuita em cloudflare.com e abra **Workers & Pages → Create → Create Worker**.
2. Dê o nome `argo-ia`, clique em **Deploy** e depois em **Edit code**.
3. Apague o código de exemplo, cole o conteúdo de `worker.js` e clique em **Deploy**.
4. Em **Settings → Bindings → Add → Workers AI**, use o nome de variável `AI`.
5. Em **Settings → Variables and Secrets**, adicione `ALLOWED_ORIGIN` (Texto) com o endereço
   do app, sem barra no fim, por exemplo `https://paulusxavier.github.io`.
6. Copie o endereço do Worker (algo como `https://argo-ia.SEU-NOME.workers.dev`).
7. No app, abra `js/app.js`, procure `const ARGO_IA` e cole o endereço em `url`.
8. Se o endereço **não** terminar em `.workers.dev` (domínio próprio), acrescente-o ao `connect-src`
   da regra de segurança (CSP) no `index.html`.
9. Publique o app de novo.

## Limites de proteção
O Worker só aceita pedidos vindos do endereço do app (`ALLOWED_ORIGIN`) e limita 8
perguntas por minuto por pessoa (limite simples). Para proteção mais forte, crie uma
regra de Rate Limiting no painel da Cloudflare.

## Testar
Abra o app, pergunte ao Argo algo fora das respostas prontas (por exemplo: "como encaminho um
adolescente com sofrimento psíquico?") e confira se a resposta termina com o aviso de IA.
Desligue a internet e pergunte de novo: ele deve voltar a oferecer a busca no diretório.

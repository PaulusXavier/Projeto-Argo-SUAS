# IA gratuita do mascote Argo (opcional)

O mascote funciona sem IA. Ele responde sozinho (no próprio aparelho, até sem internet) a:

1. **Pedidos de socorro** (risco de vida, ideação suicida): telefones de emergência na hora.
2. **Perguntas sobre unidades**: "telefone do CAPS AD III", "onde fica o CRAS Cauamé", "UBS no Cauamé".
   Responde com as fichas reais do diretório, em cartões com ligar, mapa e ver ficha.
3. **Dúvidas do SUAS** (CRAS × CREAS, PAIF, BPC, CadÚnico, RAPS, fluxos de violência...) com a norma de referência.
4. **Abrir abas e ferramentas**.

Quando você publica este Worker e coloca o endereço dele no app, o Argo passa a usar IA **só para o que
as respostas acima não resolvem**, e só se houver internet. A resposta aparece aos poucos (streaming),
tem botão **Parar**, **Copiar** e **Refazer**, e a IA lembra das últimas mensagens da conversa. Se o Worker
cair, a cota do dia acabar ou estiver sem internet, o app volta ao comportamento de sempre.

## Atualizar de uma versão antiga do Worker
Cole o novo `worker.js` no painel (Workers & Pages → argo-ia → Edit code → Deploy). **Nada mais muda**:
mesmo endereço, mesmas variáveis. Enquanto você não atualizar, o app continua funcionando com o Worker
antigo, só que sem streaming e sem memória da conversa.

## É gratuito mesmo?
Sim, enquanto você ficar no plano **Workers Free** da Cloudflare: não pede cartão e não usa chave de API.
O Workers AI dá 10.000 "neurons" por dia de graça; uma pergunta curta gasta bem pouco, então a cota deve
dar para centenas de perguntas por dia. No plano gratuito não há cobrança por excesso: acabando a cota, a
IA para até 00:00 UTC (20h em Roraima) e o Argo usa as respostas prontas. Como o histórico e mais fichas
agora vão junto, cada pergunta gasta um pouco mais que antes. Confira os valores em
developers.cloudflare.com/workers-ai/platform/pricing.

## O que esperar da qualidade
O modelo gratuito (Llama 3.1 8B) é bem menor que os modelos pagos. Ele explica bem o básico do SUAS e usa
as fichas do diretório para endereço, telefone e horário, mas pode errar em questões técnicas finas. Por
isso toda resposta de IA vem marcada, traz o aviso para conferir e passa por uma **conferência de
telefones**: se a IA citar um número que não está no diretório, aparece um alerta.
Para trocar de modelo, use a variável `MODELO` (lista em AI → Workers AI → Models). `MODELO_RESERVA`
(opcional) é usado se o principal falhar.

## O que sai do aparelho
- O texto da pergunta (até 500 caracteres).
- As últimas mensagens da conversa (até 6, cortadas em 600 caracteres), só as que passaram no filtro.
- Até 5 fichas do diretório público (nome, endereço, horário, telefone e serviços dos equipamentos).
- O nome da aba aberta.
- **Nunca** dados de famílias, planilhas ou o Bloco de notas. A conversa fica só na memória da página e é
  apagada ao trancar o app ou tocar em "Nova conversa".
- Antes de enviar, o app bloqueia perguntas com sequência longa de números (CPF, NIS, telefone), e-mail,
  "nome + sobrenome", tratamento + nome ("dona Maria Souza") ou endereço residencial. O Worker repete a conferência.

## Publicar (pelo painel, sem terminal)
1. Crie uma conta gratuita em cloudflare.com e abra **Workers & Pages → Create → Create Worker**.
2. Dê o nome `argo-ia`, clique em **Deploy** e depois em **Edit code**.
3. Apague o código de exemplo, cole o conteúdo de `worker.js` e clique em **Deploy**.
4. Em **Settings → Bindings → Add → Workers AI**, use o nome de variável `AI`.
5. Em **Settings → Variables and Secrets**, adicione `ALLOWED_ORIGIN` (Texto) com o endereço do app, sem
   barra no fim, por exemplo `https://paulusxavier.github.io`.
6. Copie o endereço do Worker (algo como `https://argo-ia.SEU-NOME.workers.dev`).
7. No app, abra `js/app.js`, procure `const ARGO_IA` e cole o endereço em `url`.
8. Se o endereço **não** terminar em `.workers.dev` (domínio próprio), acrescente-o ao `connect-src` da regra
   de segurança (CSP) no `index.html`.
9. Publique o app de novo.

## Limites de proteção
O Worker só aceita pedidos vindos do endereço do app (`ALLOWED_ORIGIN`) e limita 8 perguntas por minuto por
pessoa (o app também limita no aparelho). Para proteção mais forte, crie uma regra de Rate Limiting no painel
da Cloudflare.

## Testar
1. Pergunte "telefone do CAPS AD III": deve responder na hora, com cartão da unidade (sem IA).
2. Pergunte algo fora das respostas prontas, por exemplo "Como conduzir uma reunião de equipe para discutir
   casos complexos com a rede?": o texto deve aparecer aos poucos, com a etiqueta "Resposta gerada por IA".
3. Faça uma pergunta de seguimento ("e se a equipe estiver reduzida?"): a IA deve entender o contexto.
4. Desligue a internet e pergunte de novo: ele volta às respostas prontas e a faixa do painel mostra "Sem internet".

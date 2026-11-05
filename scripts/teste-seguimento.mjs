// Teste da LIGAÇÃO entre o mascote (js/argo-cerebro.js) e o Paulus (js/paulus.v1.js) nos pedidos sobre a última resposta:
// "continue", "tem certeza?", "de onde tirou isso?". Carrega os dois arquivos reais, como o navegador.
// Uso: npm run test:seguimento   (sem dependências; precisa de Node 18+)
import { readFileSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = f => readFileSync(join(RAIZ, f), 'utf8');

function novoAmbiente(comPaulus) {
  const ctx = { console, setTimeout, clearTimeout, AbortController, TextDecoder, navigator: { onLine: true }, fetch: async () => { throw new Error('sem rede no teste'); } };
  ctx.self = ctx; ctx.window = ctx;
  createContext(ctx);
  runInContext(ler('js/equipe-cras-cristiana.js'), ctx);
  runInContext(ler('js/data.js'), ctx);
  runInContext('this.DATA = (typeof DATA !== "undefined") ? DATA : [];', ctx);
  runInContext(ler('js/argo-cerebro.js'), ctx);
  if (comPaulus) runInContext(ler('js/paulus.v1.js'), ctx);
  ctx.ArgoCerebro.init({ data: ctx.DATA, ia: { url: 'https://exemplo.workers.dev' } });
  return ctx;
}

let falhas = 0;
function confere(nome, ok, detalhe) {
  if (!ok) { falhas++; console.log('✗ ' + nome + (detalhe ? ' → ' + detalhe : '')); } else console.log('✓ ' + nome);
}

const ctx = novoAmbiente(true);
const B = ctx.ArgoCerebro;
confere('o Paulus copiado no Argo traz o reconhecimento de pedido sobre a resposta (v0.11+)', ctx.Paulus && ctx.Paulus.pedido && typeof ctx.Paulus.pedido.sobreResposta === 'function');

// ---- sem resposta anterior nada vale
B.reset();
confere('"continue" numa conversa nova não é pedido sobre resposta', B.seguimento('continue') === '');

// ---- com resposta anterior
const P1 = 'Qual o telefone do CRAS Cauamé?';
const cras = ctx.DATA.find(d => /^CRAS /.test(d.name));
B.reset();
B.remember('quem tem direito ao BPC do idoso?', 'Quem tem 65 anos ou mais e renda per capita de até 1/4 do salário mínimo.', []);
confere('"continue" é reconhecido', B.seguimento('continue') === 'continuar');
confere('"tem certeza?" é reconhecido', B.seguimento('tem certeza?') === 'contestacao');
confere('"de onde você tirou isso?" é reconhecido', B.seguimento('de onde você tirou isso?') === 'porque');
confere('pergunta nova não é pedido sobre a resposta', B.seguimento('qual o horário do ' + cras.name + '?') === '');

// ---- o assunto não é trocado pelo pedido
B.remember('tem certeza disso?', 'Sim, a fonte é a LOAS.', []);
confere('"tem certeza disso?" não vira o assunto da conversa', B.estado().assunto === 'quem tem direito ao BPC do idoso?', JSON.stringify(B.estado()));
B.remember('de onde você tirou isso?', 'Da Lei 8.742/1993.', []);
confere('"de onde você tirou isso?" também não', B.estado().assunto === 'quem tem direito ao BPC do idoso?', JSON.stringify(B.estado()));

// ---- fichas e base do app vêm da pergunta anterior; a pergunta enviada é a da pessoa
B.reset();
B.remember('onde fica o ' + cras.name + '?', 'Fica no endereço X, telefone Y.', []);
const solta = B.buildPayload('tem certeza?', { tabCat: 'all', tabName: 'Todos' });
const antes = B.buildPayload('onde fica o ' + cras.name + '?', { tabCat: 'all', tabName: 'Todos' });
confere('o pedido segue com as palavras da pessoa em "pergunta"', solta.pergunta === 'tem certeza?', solta.pergunta);
confere('a pergunta anterior tem fichas (ponto de partida do teste)', antes.contexto.length > 0);
confere('"tem certeza?" leva as mesmas fichas da pergunta anterior', JSON.stringify(solta.contexto) === JSON.stringify(antes.contexto), 'fichas: ' + solta.contexto.length + ' x ' + antes.contexto.length);
const continua = B.buildPayload('continue', { tabCat: 'all', tabName: 'Todos' });
confere('"continue" também', continua.contexto.length === antes.contexto.length && continua.pergunta === 'continue');

// ---- outro pedido sobre a resposta no meio não atrapalha: o assunto é a última pergunta de verdade
B.remember('tem certeza?', 'Sim, confere com a ficha.', []);
const depois = B.buildPayload('por quê?', { tabCat: 'all', tabName: 'Todos' });
confere('depois de um "tem certeza?", o "por quê?" ainda volta à pergunta de verdade', depois.contexto.length === antes.contexto.length);

// ---- pergunta nova NÃO herda contexto
const nova = B.buildPayload('quantos CAPS existem?', { tabCat: 'all', tabName: 'Todos' });
confere('pergunta nova monta o próprio contexto', nova.pergunta === 'quantos CAPS existem?' && JSON.stringify(nova.contexto) !== JSON.stringify(antes.contexto));

// ---- sem o Paulus carregado tudo segue como antes (o mascote não depende dele)
const sem = novoAmbiente(false).ArgoCerebro;
sem.reset();
sem.remember('quem tem direito ao BPC do idoso?', 'Quem tem 65 anos ou mais.', []);
confere('sem o Paulus, "continue" não é tratado como pedido sobre a resposta', sem.seguimento('continue') === '');
confere('sem o Paulus, o payload sai normal', sem.buildPayload('continue', {}).pergunta === 'continue');

if (falhas) { console.log('\n' + falhas + ' falha(s).'); process.exit(1); }
console.log('\nTudo certo.');

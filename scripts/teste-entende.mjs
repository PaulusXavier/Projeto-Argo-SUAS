// Teste do ENTENDIMENTO do mascote (js/argo-entende.js): gíria, digitação, comandos e associação de palavras.
// Uso: npm run test:entende   (sem dependências; precisa de Node 18+)
import { readFileSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = f => readFileSync(join(RAIZ, f), 'utf8');
const ctx = { console, navigator: { onLine: false }, setTimeout, clearTimeout };
ctx.self = ctx; ctx.window = ctx; createContext(ctx);
for (const f of ['js/equipe-cras-cristiana.js', 'js/data.js']) runInContext(ler(f), ctx);
runInContext('this.DATA = (typeof DATA !== "undefined") ? DATA : [];', ctx);
runInContext(ler('js/argo-cerebro.js'), ctx);
runInContext(ler('js/argo-entende.js'), ctx);
const B = ctx.ArgoCerebro, E = ctx.ArgoEntende;
B.init({ data: ctx.DATA, ia: { url: '' } });
B.setMunicipios(JSON.parse(ler('assets/municipios-rr.json')));
E.usarVocabulario(B.vocabularioEntende());

let falhas = 0, ok = 0;
const confere = (nome, c, d) => { if (c) ok++; else { falhas++; console.log('✗ ' + nome + (d ? ' → ' + d : '')); } };
const cmd = t => E.entender(t).comando;

// gíria e digitação
confere('pq/vc/tbm', /porque voce tambem/.test(cmd('pq vc tbm')), cmd('pq vc tbm'));
confere('sigla com espaço', /\bcras\b/.test(cmd('c r a s do caimbé')));
confere('typo vira palavra do app', /comprimir/.test(cmd('compimir pdf')) && /assistente/.test(cmd('asistente social')));
confere('cad único', /cadunico/.test(cmd('meu cad único venceu')));
confere('s/n e N/A não viram "não"', cmd('Rua X, s/n') === 'Rua X, s/n' && cmd('N/A - UBS') === 'N/A - UBS');
confere('datas e números intactos', cmd('prazo dia 25/11 relatório') === 'prazo dia 25/11 relatório');
confere('palavra que existe não é corrigida', cmd('Pintolândia e Caimbé') === 'Pintolândia e Caimbé');
confere('texto longo passa como está', cmd('a '.repeat(300)) === 'a '.repeat(300));

// comandos
['dá pra abrir a agenda pra mim?', 'preciso ir no mapa', 'me leva pra ferramentas', 'cade a aba de prazos', 'quero ver as notícias'].forEach(t =>
  confere('comando: ' + t, /^abre /.test(cmd(t)), cmd(t)));
confere('"abre o mapa" não muda', cmd('abre o mapa') === 'abre o mapa');
confere('pergunta não vira comando', !/^abre /.test(cmd('como abrir a agenda?')));
confere('quero + tarefa vira "como"', /^como juntar/.test(cmd('quero juntar dois pdf')));

// associação
const as = t => E.entender(t).associadas;
confere('pdf pesado → reduzir', as('meu pdf tá pesado').includes('reduzir'));
confere('sem wifi → offline', as('tô sem wifi').includes('offline'));
confere('BF → bolsa familia', /bolsa familia/.test(cmd('quem tem direito ao bf')));
confere('consulta mantém a frase e só acrescenta', E.entender('meu pdf tá pesado').consulta.indexOf('meu pdf') >= 0 && E.entender('meu pdf tá pesado').consulta.length > 'meu pdf tá pesado'.length);
confere('último grupo do app é o marcado', E.grupos[22][1].includes('whatsapp') === false && E.grupos[23][1].includes('bolsa familia'));

// integração com o cérebro: antes vs depois
const plano = q => B.plan(q, { tabCat: '' });
const resp = q => { const p = E.tentar(plano, q, E.planoFraco, { aceita: E.planoAceito }); return E.planoFraco(p) ? '' : String(p.result && p.result.reply); };
[['como compimir pdf', /Reduzir tamanho/], ['quero emendar dois pdf', /Unificar/], ['como salvo meus dados antes de trocar de celular', /backup/i],
 ['o app fecha sozinho, por quê?', /inatividade|bloqueio|conectado/i], ['dá pra usar sem wifi?', /internet|offline/i], ['como deixo a tela escura', /escuro/i],
 ['pdf com paginas de cabeça pra baixo', /Girar|gira/i], ['quem tem direito ao bf?', /Bolsa Fam|renda|Cad/i], ['psicólogo pode dar laudo?', /laudo|parecer|documento/i],
 ['o que faz o ct?', /Conselho Tutelar/]].forEach(([q, re]) => confere('responde: ' + q, re.test(resp(q)), resp(q).slice(0, 60)));

// nunca piora: o que já tinha resposta boa continua igual
['telefone do cras cauame', 'o que é paif', 'onde fica o creas', 'qual cras atende o caimbé'].forEach(q => {
  const p0 = plano(q);
  if (!E.planoFraco(p0)) { const p1 = E.tentar(plano, q, E.planoFraco, { aceita: E.planoAceito }); confere('inalterado: ' + q, p1.kind === p0.kind && String(p1.result.reply) === String(p0.result.reply)); }
});

// ligação com o app
const app = ler('js/app.js'), html = ler('index.html'), sw = ler('sw.js'), build = ler('scripts/build.mjs');
confere('app.js usa ArgoEntende', /ArgoEntende\.tentar/.test(app) && /function argoEntende\(/.test(app));
confere('index.html, sw.js e build carregam o módulo', html.includes('js/argo-entende.js') && sw.split('argo-entende.js').length === 3 && build.includes('js/argo-entende.js'));

console.log(falhas ? '\n' + falhas + ' falha(s)' : '\nTudo certo: ' + ok + ' verificações ok.');
process.exit(falhas ? 1 : 0);

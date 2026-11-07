// Teste do ACABAMENTO e da CONFERÊNCIA das respostas da IA no mascote (js/argo-cerebro.js):
// cleanAI (marcação, enrolação, repetição, ponta cortada), cleanPartial (texto durante o streaming)
// e conferir (nome de unidade inventado e fatos de Boa Vista que a IA costuma errar).
// Uso: npm run test:qualidade   (sem dependências; precisa de Node 18+)
import { readFileSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = f => readFileSync(join(RAIZ, f), 'utf8');

const ctx = { console, setTimeout, clearTimeout, AbortController, navigator: { onLine: true }, fetch: async () => ({ ok: false }) };
ctx.self = ctx; ctx.window = ctx;
createContext(ctx);
runInContext(ler('js/equipe-cras-cristiana.js'), ctx);
runInContext(ler('js/data.js'), ctx);
runInContext('this.DATA = (typeof DATA !== "undefined") ? DATA : [];', ctx);
runInContext(ler('js/argo-cerebro.js'), ctx);
const B = ctx.ArgoCerebro;
B.init({ data: ctx.DATA, ia: { url: 'https://exemplo.workers.dev' } });

let falhas = 0, total = 0;
function confere(nome, ok, detalhe) {
  total++;
  if (!ok) { falhas++; console.log('✗ ' + nome + (detalhe !== undefined ? ' → ' + JSON.stringify(detalhe) : '')); }
  else console.log('✓ ' + nome);
}
const limpa = B.cleanAI;

// ---- marcação
confere('tira <think>…</think> e o rótulo "Resposta:"', limpa('<think>vou pensar</think>Resposta: O CRAS faz a acolhida das famílias do território e organiza o PAIF.') === 'O CRAS faz a acolhida das famílias do território e organiza o PAIF.');
confere('<think> aberto e nunca fechado some até o fim', limpa('Início da resposta completa sobre o CRAS.<think>pensando sem parar') === 'Início da resposta completa sobre o CRAS.');
confere('título "##" vira linha em negrito', limpa('## Como encaminhar\nLigue antes.') === '**Como encaminhar**\nLigue antes.');
confere('marcadores *, •, – e + viram "- "', limpa('* um item\n• outro item\n– terceiro item\n+ quarto item') === '- um item\n- outro item\n- terceiro item\n- quarto item');
confere('negrito não deve ser lido como marcador', limpa('**CRAS** atende.') === '**CRAS** atende.');
confere('tabela vira lista', limpa('| Unidade | Telefone |\n|---|---|\n| CRAS Cauamé | 3623-1111 |') === '- Unidade — Telefone\n- CRAS Cauamé — 3623-1111');
confere('[texto](url) vira "texto (url)"', limpa('Veja [o portal](https://exemplo.gov.br) para detalhes.') === 'Veja o portal (https://exemplo.gov.br) para detalhes.');
confere('*itálico* perde os asteriscos', limpa('Isso é *muito* importante.') === 'Isso é muito importante.');
confere('negrito aberto e não fechado perde só o "**" solto', limpa('Procure o **CRAS e depois a UBS.') === 'Procure o CRAS e depois a UBS.');
confere('linha horizontal sai', limpa('Primeiro.\n---\nSegundo.') === 'Primeiro.\nSegundo.');
confere('emoji de enfeite sai, o aviso ⚠️ fica', limpa('Ótima notícia 😊! ⚠️ Confira com a unidade.') === 'Ótima notícia ! ⚠️ Confira com a unidade.', limpa('Ótima notícia 😊! ⚠️ Confira com a unidade.'));
confere('crases somem', limpa('Use `CadÚnico` sempre.') === 'Use CadÚnico sempre.');

// ---- enrolação
confere('abertura "Claro! Ótima pergunta!" sai quando há conteúdo', limpa('Claro! Ótima pergunta! O CREAS atende famílias com direitos violados.') === 'Ótima pergunta! O CREAS atende famílias com direitos violados.' || limpa('Claro! Ótima pergunta! O CREAS atende famílias com direitos violados.') === 'O CREAS atende famílias com direitos violados.', limpa('Claro! Ótima pergunta! O CREAS atende famílias com direitos violados.'));
confere('"Claro!" sai e a resposta começa maiúscula', limpa('Claro! o CREAS atende famílias com direitos violados e acompanha o caso.') === 'O CREAS atende famílias com direitos violados e acompanha o caso.');
confere('cumprimento curto sozinho é mantido', limpa('Olá!') === 'Olá!');
const base = 'O CRAS é a porta de entrada da proteção social básica. Ele acolhe, orienta e acompanha famílias do território, e faz o encaminhamento para a rede quando precisa.';
confere('fecho "Espero ter ajudado!" sai', limpa(base + '\n\nEspero ter ajudado!') === base);
confere('fecho "Se precisar de mais alguma coisa, é só perguntar!" sai', limpa(base + '\nSe precisar de mais alguma coisa, é só perguntar!') === base);
confere('fecho na mesma linha sai', limpa(base + ' Qualquer dúvida, estou à disposição!') === base, limpa(base + ' Qualquer dúvida, estou à disposição!'));
confere('próximo passo concreto não é tratado como fecho', limpa(base + '\nConfirme com a coordenação o fluxo do município.').endsWith('o fluxo do município.'));

// ---- repetição
const loop = 'Procure o CRAS do seu território para a acolhida inicial. Depois, combine o retorno. Procure o CRAS do seu território para a acolhida inicial. Combine o retorno por telefone com a família.';
const sl = limpa(loop);
confere('frase repetida é cortada', (sl.match(/Procure o CRAS do seu território/g) || []).length === 1, sl);
confere('item de lista repetido é cortado', (limpa('- Registre o atendimento no prontuário do serviço\n- Combine a contrarreferência\n- Registre o atendimento no prontuário do serviço').match(/Registre o atendimento/g) || []).length === 1);
confere('itens curtos iguais continuam (não são repetição)', limpa('- Sim\n- Não\n- Sim') === '- Sim\n- Não\n- Sim');

// ---- tamanho e ponta cortada
const longo = Array.from({ length: 80 }, (_, i) => 'Esta é a frase número ' + i + ' da resposta muito longa sobre o fluxo de atendimento.').join(' ');
const cl = limpa(longo);
confere('resposta enorme é cortada em fim de frase, dentro do limite', cl.length <= 2400 && /[.!?]$/.test(cl), cl.slice(-60));
const cortada = 'O CRAS é a porta de entrada da proteção social básica e acolhe as famílias do território. Para encaminhar a pessoa, ligue antes para a unidade e combine o horário com a equipe de referência para';
confere('frase cortada no meio (termina em "para") é aparada', limpa(cortada).endsWith('do território.'), limpa(cortada));
confere('termina em vírgula: apara a frase solta', limpa('O CRAS atende famílias do território todos os dias úteis, com acolhida e orientação. Se a família não conseguir ir à unidade, o CRAS pode,').endsWith('orientação.'));
const dado = 'Telefones do CRAS Cauamé, conforme o diretório, para contato com a equipe técnica da unidade:\n- **Telefone:** (95) 3623-1234';
confere('lista terminando em telefone (sem ponto) NÃO é cortada', limpa(dado) === dado, limpa(dado));
confere('resposta curta sem ponto final não é cortada', limpa('Não consta no diretório') === 'Não consta no diretório');
confere('resposta completa passa idêntica', limpa(base) === base);

// ---- sugestões e idempotência
const comSug = base + '\nSUGESTÕES: qual o telefone do CRAS? | qual o horário? | abrir mapa';
const rs = B.separarSugestoes(limpa(comSug));
confere('SUGESTÕES fica intacta para o separarSugestoes', rs.sugestoes.length === 3 && rs.texto === base, rs);
const amostras = [base, loop, longo, cortada, dado, comSug, '## T\n* a\n* b\n\nClaro! texto', '<think>x</think>Texto longo suficiente para passar pelos filtros de tamanho mínimo da limpeza das respostas.'];
confere('idempotente: limpar de novo não muda nada', amostras.every(a => limpa(limpa(a)) === limpa(a)), amostras.filter(a => limpa(limpa(a)) !== limpa(a)));
confere('entrada vazia/nula devolve texto vazio', limpa('') === '' && limpa(null) === '' && limpa(undefined) === '');

// ---- texto parcial (streaming)
confere('parcial esconde o rótulo "SUGESTÕES" inteiro e pela metade', B.cleanPartial('Texto da resposta.\nSUGESTÕES: a | b') === 'Texto da resposta.' && B.cleanPartial('Texto da resposta.\nSUGE') === 'Texto da resposta.');
confere('parcial esconde <think> aberto', B.cleanPartial('<think>raciocinando…') === '' && B.cleanPartial('Oi<think>raciocinando') === 'Oi');
confere('parcial tira "## " e "* " do começo', B.cleanPartial('## Título\n* item') === 'Título\n- item');
confere('parcial esconde "**" solto na última linha', B.cleanPartial('Procure o **CRA') === 'Procure o CRA' && B.cleanPartial('Procure o **CRAS** e') === 'Procure o **CRAS** e');
confere('parcial não troca palavra com "sugestão" no meio do texto', B.cleanPartial('Há uma sugestão do CRAS para a família.') === 'Há uma sugestão do CRAS para a família.');

// ---- conferência contra invenção
const tem = t => B.conferir(t);
confere('nome de unidade que existe não é alertado', tem('Procure o CRAS Cauamé ou o CREAS Centro; para saúde, a UBS Mecejana.').unidades.length === 0, tem('Procure o CRAS Cauamé ou o CREAS Centro; para saúde, a UBS Mecejana.').unidades);
confere('CAPS II, CAPS AD III e CAPS III não são alertados', tem('O CAPS II atende adultos; o CAPS AD III, álcool e drogas; o CAPS III funciona 24 horas.').unidades.length === 0);
confere('"CRAS de referência" (genérico) não é alertado', tem('Procure o CRAS de referência do território. Depois, a UBS Básica mais próxima.').unidades.length === 0);
confere('CRAS inventado é alertado', tem('Procure o CRAS Inventado Sul na zona oeste.').unidades.length === 1, tem('Procure o CRAS Inventado Sul na zona oeste.').unidades);
confere('UBS inventada é alertada', tem('Encaminhe à UBS Fantasma para o pré-natal.').unidades[0] === 'UBS Fantasma', tem('Encaminhe à UBS Fantasma para o pré-natal.').unidades);
confere('nome real + palavra de início de frase não gera alerta', tem('O CRAS Cauamé. Ele atende o bairro.').unidades.length === 0, tem('O CRAS Cauamé. Ele atende o bairro.').unidades);
confere('"CRAS Cauamé atende ..." (verbo em minúscula) não é alertado', tem('O CRAS Cauamé atende o bairro Caimbé.').unidades.length === 0);
// varredura: todo nome e nome completo do diretório, escrito numa frase, não pode gerar alerta falso
const falsos = [];
ctx.DATA.forEach(d => {
  [d.name, d.fullName].forEach(nm => {
    if (!nm || !/^(CRAS|CREAS|UBS|CAPS)\b/i.test(nm)) return;
    const frase = 'Procure o ' + nm.replace(/\s*\(.*$/, '') + ' para a acolhida, e confirme o horário.';
    const r = B.unidadesDesconhecidas(frase);
    if (r.length) falsos.push(nm + ' → ' + r.join(' | '));
  });
});
confere('nenhum nome do diretório (' + ctx.DATA.length + ' fichas) gera alerta falso', falsos.length === 0, falsos.slice(0, 5));
confere('UPA indicada como opção é alertada', tem('Em caso de urgência, leve a pessoa à UPA mais próxima.').fatos.length === 1);
confere('"não há UPA" não é alertado', tem('Em Boa Vista não há UPA em funcionamento; vá ao HGRR.').fatos.length === 0);
confere('CAPS infantil indicado é alertado; "não há CAPS infantil" não', tem('Leve a criança ao CAPS infantil.').fatos.length === 1 && tem('Não há CAPS infantil em Boa Vista.').fatos.length === 0);
confere('conferir devolve também a checagem de telefone', tem('Ligue para (95) 3000-0000.').fone === true && tem('Ligue para o CRAS.').fone === false);

console.log('\n' + (falhas ? falhas + ' de ' + total + ' verificações falharam.' : 'Tudo certo: ' + total + ' verificações ok.'));
process.exit(falhas ? 1 : 0);

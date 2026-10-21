// Teste rápido do "cérebro" do mascote (js/argo-cerebro.js) com o diretório real (js/data.js).
// Uso: npm run test:territorio   (sem dependências; precisa de Node 18+)
import { readFileSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = f => readFileSync(join(RAIZ, f), 'utf8');

const ctx = { console, navigator: { onLine: false }, setTimeout, clearTimeout };
ctx.self = ctx; ctx.window = ctx;
createContext(ctx);
runInContext(ler('js/equipe-cras-cristiana.js'), ctx);
runInContext(ler('js/data.js'), ctx);
// "const" de script clássico não vira propriedade do objeto global: expõe para o teste
runInContext('this.DATA = (typeof DATA !== "undefined") ? DATA : []; this.EQUIPE_CRAS_CRISTIANA = (typeof EQUIPE_CRAS_CRISTIANA !== "undefined") ? EQUIPE_CRAS_CRISTIANA : null;', ctx);
runInContext(ler('js/argo-cerebro.js'), ctx);

const B = ctx.ArgoCerebro;
B.init({ data: ctx.DATA, ia: { url: '' } });
const MUN_RR = JSON.parse(ler('assets/municipios-rr.json'));
B.setMunicipios(MUN_RR);
const BASE_CONHECIMENTO = JSON.parse(ler('assets/conhecimento.json'));
const TRECHOS_CENSO = BASE_CONHECIMENTO.filter(x => x.doc === 'censo-suas-2025-roraima-psicologos');
const TRECHOS_CENSO_CARREGADOS = B.setCensoSuas(TRECHOS_CENSO);

let falhas = 0;
function confere(nome, ok, detalhe) {
  if (!ok) { falhas++; console.log('✗ ' + nome + (detalhe ? ' → ' + detalhe : '')); }
  else console.log('✓ ' + nome);
}
const resp = q => { const p = B.plan(q, { tabCat: '' }); return { kind: p.kind, txt: String((p.result && p.result.reply) || '') }; };

confere('diretório carregado', ctx.DATA.length > 100, String(ctx.DATA.length));
confere('todos os trechos agregados do Censo SUAS foram carregados (Boa Vista + interior)', TRECHOS_CENSO_CARREGADOS === TRECHOS_CENSO.length && TRECHOS_CENSO.length >= 90, TRECHOS_CENSO_CARREGADOS + ' de ' + TRECHOS_CENSO.length);

// CRAS e conselhos fora de Boa Vista (Censo SUAS 2025): a resposta é do município pedido, nunca a de Boa Vista
let ri = resp('quantos computadores tem o CRAS de Iracema');
confere('CRAS de Iracema → dados de Iracema (4 computadores), não de Boa Vista', ri.kind === 'directory' && /Iracema/.test(ri.txt) && /4 computadores/.test(ri.txt) && !/Boa Vista/.test(ri.txt), ri.txt.slice(0, 80));
ri = resp('qual a capacidade de famílias do CRAS de Rorainópolis');
confere('CRAS de Rorainópolis → capacidade de 3.500 famílias', /3\.500 famílias/.test(ri.txt) && !/Boa Vista/.test(ri.txt), ri.txt.slice(0, 80));
ri = resp('quantos conselheiros tem em Caracaraí');
confere('conselheiros de Caracaraí → 18', /Caracaraí registra 18 conselheiros/.test(ri.txt), ri.txt.slice(0, 80));
ri = resp('quantos conselheiros tem o conselho estadual de Roraima');
confere('Conselho Estadual → 24 conselheiros', /Conselho Estadual de Assistência Social de Roraima registra 24/.test(ri.txt), ri.txt.slice(0, 80));
ri = resp('conselheiros de Bonfim');
confere('Bonfim sem conselheiros no arquivo → totais, sem inventar número', /Bonfim, Cantá e Mucajaí/.test(ri.txt), ri.txt.slice(0, 80));
ri = resp('quantos trabalhadores tem nos CRAS do interior');
confere('trabalhadores dos CRAS do interior → 224', /Total do interior, 224/.test(ri.txt), ri.txt.slice(0, 80));
ri = resp('qual município do interior tem mais computadores nos CRAS');
confere('mais computadores no interior → Cantá 20, lista por município', /Cantá 20/.test(ri.txt), ri.txt.slice(0, 80));
ri = resp('quais CRAS do interior são rurais');
confere('CRAS rurais do interior → São Silvestre e Maria Helena Olívio de Souza', /São Silvestre/.test(ri.txt) && /Olívio de Souza/.test(ri.txt), ri.txt.slice(0, 80));
ri = resp('quantos CRAS tem no interior de Roraima');
confere('CRAS no interior → 16', /têm 16 CRAS/.test(ri.txt), ri.txt.slice(0, 80));
ri = resp('compare CRAS de Pacaraima e Iracema');
confere('comparação Pacaraima x Iracema traz os dois', /Pacaraima/.test(ri.txt) && /Iracema/.test(ri.txt), ri.txt.slice(0, 80));
ri = resp('quantas horas por dia funciona o CRAS de Amajari');
confere('horas do CRAS de Amajari → 6 horas por dia (resposta direta)', /^\*\*CRAS de Amajari\*\* funciona 5 dias por semana, 6 horas por dia/.test(ri.txt), ri.txt.slice(0, 80));
ri = resp('quantas salas tem os CRAS de Caracaraí');
confere('salas dos 2 CRAS de Caracaraí → um por CRAS', /de 6 a 7 salas/.test(ri.txt) && /de 4 a 5 salas/.test(ri.txt), ri.txt.slice(0, 80));
ri = resp('quantos veículos tem o CRAS de Pacaraima');
confere('veículos de Pacaraima → 3 exclusivos e 1 compartilhado', /3 veículos exclusivos e 1 compartilhado/.test(ri.txt), ri.txt.slice(0, 80));
ri = resp('quantos veículos tem os CRAS do interior');
confere('veículos do interior → 7 exclusivos', /7 veículos exclusivos/.test(ri.txt) && !/38\.500/.test(ri.txt), ri.txt.slice(0, 80));
ri = resp('quantas pessoas teve no PAIF o CRAS de Caroebe');
confere('PAIF de Caroebe → 456', /teve 456 pessoas/.test(ri.txt), ri.txt.slice(0, 80));
ri = resp('quantos conselheiros mulheres tem em Iracema');
confere('mulheres no conselho de Iracema → 13 e 1 homem', /13 mulheres e 1 homem entre 14/.test(ri.txt), ri.txt.slice(0, 80));
ri = resp('capacidade dos CRAS de Boa Vista');
confere('Boa Vista continua com a própria resposta (38.500 famílias)', /38\.500/.test(ri.txt), ri.txt.slice(0, 80));

let r = resp('qual CRAS atende o bairro Cauamé');
confere('bairro Cauamé → CRAS Cauamé', r.kind === 'directory' && /CRAS Cauamé/.test(r.txt), r.txt.slice(0, 80));
r = resp('qual cras atende o caimbé');
confere('erro de digitação (caimbé) é entendido', r.kind === 'directory' && /Caimbé/i.test(r.txt), r.txt.slice(0, 80));
r = resp('telefone do CAPS AD III');
confere('telefone do CAPS AD III vem da ficha', r.kind === 'directory' && /CAPS AD III/.test(r.txt) && /\d{4}/.test(r.txt), r.txt.slice(0, 80));
r = resp('o que é PAIF');
confere('conceito PAIF', r.kind === 'concept' && /PAIF/.test(r.txt));
r = resp('o que é RAPS');
confere('conceito RAPS', r.kind === 'concept' && /RAPS/.test(r.txt));
for (const q of ['quero morrer', 'estou sendo agredida', 'ela falou em suicídio']) confere('socorro: ' + q, !!B.crisis(q));
confere('"o inconsciente em Freud" não é socorro', !B.crisis('o inconsciente em Freud'));
for (const q of ['Nome: Maria Souza', 'meu RG 1234567', 'CPF 123.456.789-09']) confere('dado pessoal barrado: ' + q, !!B.piiBlock(q));
confere('pergunta técnica não é barrada', !B.piiBlock('qual CRAS atende o bairro Cauamé?'));
confere('telefone fora do diretório é detectado', B.verifyPhones('ligue para (95) 91111-2222') === true);
confere('intervalo de anos não é telefone', B.verifyPhones('vigência 2023-2026') === false);


// ---- contagem por bairro: o número sai das fichas, não da IA ----
const semAcento = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ESPECIAIS = /^(CAP-DVRR|CADAHS|CAS|CAEBV)$|^Centro Mun\. Integrado/i;
const escolasBV = (() => {
  const vistos = new Set();
  return ctx.DATA.filter(d => /^(Rede Estadual|Rede Municipal - Escolas)$/.test(d.group || '') && /Boa Vista/.test(d.address) && !ESPECIAIS.test(d.name))
    .filter(d => { const k = semAcento(d.name); if (vistos.has(k)) return false; vistos.add(k); return true; });
})();
r = resp('quantas escolas tem em Boa Vista');
confere('total de escolas bate com a contagem independente (' + escolasBV.length + ')', r.kind === 'directory' && r.txt.includes('**' + escolasBV.length + ' escolas em Boa Vista**'), r.txt.slice(0, 90));
const noCentro = escolasBV.filter(d => /\s-\s*Centro,/.test(d.address) || /^Centro,/.test(d.address)).length;
r = resp('quantas escolas no Centro');
confere('escolas no Centro bate com a contagem independente (' + noCentro + ')', r.kind === 'directory' && r.txt.includes('**' + noCentro + ' escolas'), r.txt.slice(0, 90));
r = resp('quantas escolas tem no caimbe');
confere('escolas no Caimbé (sem acento) e mostra a lista', r.kind === 'directory' && /Caimbé/.test(r.txt) && /Mário David Andreazza/.test(r.txt), r.txt.slice(0, 90));
r = resp('quantas escolas no bairro Xanadu');
confere('bairro inexistente não vira total da cidade', /Não encontrei esse bairro/.test(r.txt), r.txt.slice(0, 90));
r = resp('quantas vagas tem na escola do Caimbé');
confere('"vagas" não é pergunta de contagem do diretório', !/Contagem|constam|consta/.test(r.txt), r.txt.slice(0, 90));
r = resp('quantos CRAS atendem o bairro Cauamé');
confere('cobertura continua com o território (CRAS Cauamé)', /CRAS Cauamé/.test(r.txt), r.txt.slice(0, 90));
r = resp('qual bairro tem mais escolas');
confere('ranking: bairro com mais escolas', /Centro/.test(r.txt) && /com mais escolas/.test(r.txt), r.txt.slice(0, 90));


// ---- municípios de Roraima: o número sai de assets/municipios-rr.json (conferido contra a base), nunca da IA ----
const baseNormas = JSON.parse(ler('assets/conhecimento.json'));
const textoBase = baseNormas.map(c => c.texto).join('\n');
const milhar = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
confere('15 municípios na base', MUN_RR.municipios.length === 15);
confere('a soma das populações é o total do estado', MUN_RR.municipios.reduce((a, m) => a + m.pop, 0) === MUN_RR.estado.pop);
for (const m of MUN_RR.municipios) confere('população de ' + m.nome + ' (' + milhar(m.pop) + ') está escrita na base de normas', textoBase.includes(milhar(m.pop)));
for (const m of MUN_RR.municipios) {
  r = resp('quantos habitantes tem ' + m.nome);
  confere('resposta direta de população: ' + m.nome, r.kind === 'directory' && r.txt.includes(milhar(m.pop)) && r.txt.includes('**' + m.nome + '**'), r.txt.slice(0, 80));
}
r = resp('população de Uiramutã');
confere('Uiramutã: 11º e 96,6% indígenas', /11º/.test(r.txt) && /96,6%/.test(r.txt), r.txt.slice(0, 120));
r = resp('qual o maior município de Roraima');
confere('maior município = Boa Vista', /\*\*Boa Vista\*\*/.test(r.txt) && /413\.486/.test(r.txt), r.txt.slice(0, 90));
r = resp('qual o menor município de Roraima');
confere('menor município = São Luiz', /\*\*São Luiz\*\*/.test(r.txt) && /7\.315/.test(r.txt), r.txt.slice(0, 90));
r = resp('quantos municípios tem Roraima');
confere('lista dos 15 municípios', /15 municípios/.test(r.txt) && /Uiramutã/.test(r.txt) && /São Luiz/.test(r.txt), r.txt.slice(0, 90));
r = resp('qual município tem mais indígenas');
confere('ranking de indígenas começa em Uiramutã', /Uiramutã.*96,6%/.test(r.txt.split('\n')[1] || ''), r.txt.slice(0, 120));
r = resp('percentual de indígenas em Normandia');
confere('Normandia: 12.144 e "cerca de 89%"', /12\.144/.test(r.txt) && /cerca de 89%/.test(r.txt), r.txt.slice(0, 120));
r = resp('quantos indígenas em Bonfim');
confere('indígenas de município sem dado: diz que não tem, não inventa', /Não tenho o dado/.test(r.txt) && !/\d+% dos moradores/.test(r.txt), r.txt.slice(0, 120));
r = resp('área de Cantá');
confere('área de Cantá (7.664,83 km²)', /7\.664,83/.test(r.txt), r.txt.slice(0, 90));
r = resp('qual a área de Bonfim');
confere('área sem dado: diz que não tem', /Não tenho a área/.test(r.txt), r.txt.slice(0, 90));
r = resp('quantas famílias no CadÚnico em Uiramutã');
confere('CadÚnico de Uiramutã: 886 famílias, com aviso de setores', /886 famílias/.test(r.txt) && /setores censitários/.test(r.txt) && /Não é o total oficial/.test(r.txt), r.txt.slice(0, 120));
r = resp('quantas famílias no Bolsa Família em Pacaraima');
confere('Bolsa Família de Pacaraima: 2.069', /2\.069/.test(r.txt), r.txt.slice(0, 120));
r = resp('quantas famílias no CadÚnico em Cantá');
confere('CadÚnico de município misturado: não divide', /Ainda não tenho o diagnóstico/.test(r.txt) && !/\d\.\d{3} famílias/.test(r.txt), r.txt.slice(0, 120));
r = resp('compare Pacaraima e Bonfim');
confere('comparação traz os dois', /19\.305/.test(r.txt) && /13\.923/.test(r.txt), r.txt.slice(0, 120));
r = resp('dados de Alto Alegre');
confere('ficha de Alto Alegre (2.292 famílias, 1.152 no PBF, CRAS)', /2\.292/.test(r.txt) && /1\.152/.test(r.txt) && /CRAS Azul/.test(r.txt), r.txt.slice(0, 120));
r = resp('quantas UBS em Alto Alegre');
confere('UBS de Alto Alegre não vira número de Boa Vista', /Alto Alegre/.test(r.txt) && !/em Boa Vista/.test(r.txt), r.txt.slice(0, 120));
r = resp('população de Pacaraina');
confere('erro de digitação (Pacaraina) é entendido', /19\.305/.test(r.txt), r.txt.slice(0, 90));
B.reset();
resp('dados de Pacaraima');
r = resp('e o bolsa família?');
confere('continuação: "e o bolsa família?" usa o último município', /Pacaraima/.test(r.txt) && /2\.069/.test(r.txt), r.txt.slice(0, 90));
r = resp('e a área?');
confere('continuação: "e a área?" também', /Pacaraima/.test(r.txt) && /Não tenho a área/.test(r.txt), r.txt.slice(0, 90));
B.reset();
r = resp('e o bolsa família?');
confere('continuação sem município anterior não inventa', !/Pacaraima|habitantes/.test(r.txt), r.txt.slice(0, 60));
r = resp('dados de Pacaraima');
confere('ficha mostra a parcela do CadÚnico no Bolsa Família (50,9%)', /50,9%/.test(r.txt), r.txt.slice(0, 80));
r = resp('Pacaraima é maior que Bonfim');
confere('comparação sem a palavra "compare"', /19\.305/.test(r.txt) && /13\.923/.test(r.txt), r.txt.slice(0, 80));
r = resp('qual a cidade mais populosa depois de Boa Vista');
confere('"depois de Boa Vista" = Rorainópolis', /Depois de Boa Vista/.test(r.txt) && /\*\*Rorainópolis\*\*/.test(r.txt) && !/1\. \*\*Boa Vista/.test(r.txt), r.txt.slice(0, 120));
r = resp('municípios com mais de 15 mil habitantes');
confere('filtro por habitantes: 7 acima de 15 mil', /^7 municípios/.test(r.txt) && /Mucajaí/.test(r.txt) && !/Normandia/.test(r.txt), r.txt.slice(0, 120));
r = resp('população dos municípios do interior');
confere('população do interior: 14 sem Boa Vista', /14 municípios do interior/.test(r.txt) && !/\*\*Boa Vista\*\* ·/.test(r.txt), r.txt.slice(0, 120));
r = resp('quais municípios têm CREAS');
confere('municípios com CREAS (interior)', /com CREAS/.test(r.txt) && /Alto Alegre/.test(r.txt) && /Pacaraima/.test(r.txt) && /cobertura parcial/.test(r.txt), r.txt.slice(0, 120));
r = resp('quais municípios não têm CREAS');
confere('municípios sem CREAS: lista com aviso de cobertura parcial', /sem CREAS/.test(r.txt) && /cobertura parcial/.test(r.txt) && !/Pacaraima/.test(r.txt), r.txt.slice(0, 120));
// o que NÃO pode mudar
r = resp('qual CRAS atende Pacaraima');
confere('qual CRAS atende Pacaraima continua pelo território', /CRAS Pacaraima/.test(r.txt) && !/habitantes/.test(r.txt), r.txt.slice(0, 90));
r = resp('telefone do CRAS Pacaraima');
confere('telefone continua pelo diretório', /\d{4}-\d{4}/.test(r.txt) && !/habitantes/.test(r.txt), r.txt.slice(0, 90));
r = resp('população de rua em Roraima');
confere('"população de rua" não é o Censo', !/habitantes/.test(r.txt), r.txt.slice(0, 90));
r = resp('quantas escolas tem em Boa Vista');
confere('contagem de Boa Vista continua igual', /escolas em Boa Vista/.test(r.txt), r.txt.slice(0, 90));
// IA: a ficha do município vai como base do app, e as unidades do município como fichas
{
  const pl = B.buildPayload('como está a assistência social em Pacaraima, o que priorizar?', { tabCat: '', tabName: '' });
  const b0 = (pl.base || [])[0] || { texto: '' };
  confere('IA recebe a ficha do município (base do app)', /Pacaraima/.test(b0.titulo || '') && /19\.305/.test(b0.texto) && /Não invente/.test(b0.texto) && b0.texto.length <= 1500, (b0.titulo || '') + ' ' + b0.texto.length);
  confere('IA recebe CRAS e CREAS de Pacaraima como fichas', pl.contexto.some(f => /CRAS Pacaraima/.test(f.nome)) && pl.contexto.some(f => /CREAS Pacaraima/.test(f.nome)));
  const pl2 = B.buildPayload('o que a rede de saúde de Uiramutã oferece', { tabCat: '', tabName: '' });
  confere('pergunta sobre saúde do interior leva as fichas do município (mesmo sem dizer CRAS)', pl2.contexto.length > 0 && pl2.contexto.every(f => /Uiramutã/.test(f.servicos)), pl2.contexto.map(f => f.nome).join('|'));
  const pl3 = B.buildPayload('como funciona o PAIF', { tabCat: '', tabName: '' });
  confere('pergunta sem município não leva ficha de município', !(pl3.base || []).some(x => /Roraima/.test(x.titulo)));
  const pl4 = B.buildPayload('quantos psicólogos tem nos CRAS de Boa Vista?', { tabCat: '', tabName: '' });
  const censoPsi = (pl4.base || []).filter(x => /Censo SUAS 2025/.test(x.origem || ''));
  confere('pergunta sobre psicólogos em Boa Vista envia dados do Censo ao Paulus', censoPsi.length > 0 && censoPsi.some(x => /19/.test(x.texto) && /Boa Vista/.test(x.texto)), censoPsi.map(x => x.titulo + ': ' + x.texto.slice(0, 100)).join(' | '));
  const pl5 = B.buildPayload('qual telefone do CRAS Pacaraima?', { tabCat: '', tabName: '' });
  confere('pergunta de telefone do diretório não recebe contexto Censo irrelevante', !(pl5.base || []).some(x => /Censo SUAS 2025/.test(x.origem || '')));
  const pl6 = B.buildPayload('quantos profissionais de psicologia há em Roraima?', { tabCat: '', tabName: '' });
  confere('variação “profissionais de psicologia” recupera o total estadual', (pl6.base || []).some(x => /Censo SUAS 2025/.test(x.origem || '') && /161 registros/.test(x.texto)));
}

// ---- Psicólogos nos municípios do interior (Censo SUAS 2025) ----
{
  const D = B.psiCensoDados();
  const num = (txt, re) => { const m = re.exec(txt); return m ? Number(m[1]) : NaN; };
  const interior = Object.keys(D.mun).filter(m => m !== 'Boa Vista');
  confere('há 14 municípios do interior na tabela', interior.length === 14, String(interior.length));
  const somaTodos = Object.keys(D.mun).reduce((t, m) => t + Object.keys(D.mun[m]).reduce((u, k) => u + D.mun[m][k][1], 0), 0);
  confere('os 15 municípios somam 69 registros de psicólogos (43 de Boa Vista + 26 do interior)', somaTodos === 69 && D.interior.total === 26, somaTodos + ' / ' + D.interior.total);
  let erros = [];
  for (const m of interior) for (const k of ['cras', 'creas']) {
    const c = D.mun[m][k]; if (!c) { if (D.perfil[m] && D.perfil[m][k]) erros.push(m + ' ' + k + ' perfil sem RH'); continue; }
    const per = D.perfil[m] && D.perfil[m][k], eq = D.equipe[m] && D.equipe[m][k];
    if (c[1] > 0) {
      if (!per) { erros.push(m + ' ' + k + ' sem perfil'); continue; }
      const sexo = per.find(x => /^sexo:/.test(x)) || '';
      const soma = (sexo.match(/\b(\d+) (mulher(?:es)?|homem|homens)/g) || []).reduce((t, x) => t + Number(x.split(' ')[0]), 0);
      if (soma !== c[1]) erros.push(m + ' ' + k + ' sexo soma ' + soma + ' ≠ ' + c[1]);
    } else if (per) erros.push(m + ' ' + k + ' tem perfil mas zero psicólogos');
    if (!eq) erros.push(m + ' ' + k + ' sem equipe');
    else {
      if (num(eq, /\(de (\d+)\)/) !== c[0]) erros.push(m + ' ' + k + ' equipe total ≠ RH ' + c[0]);
      const psi = num(eq, /(\d+) \*\*psic/) || 0;
      if (psi !== c[1]) erros.push(m + ' ' + k + ' psicólogos na equipe ' + psi + ' ≠ ' + c[1]);
    }
  }
  confere('perfil e equipe de cada município do interior batem com as contagens (sexo, total de RH, psicólogos)', erros.length === 0, erros.slice(0, 4).join(' | '));
  const somaInt = k => interior.reduce((t, m) => t + (D.mun[m][k] ? D.mun[m][k][1] : 0), 0);
  confere('agregado do interior bate com a soma dos municípios (CRAS 13, CREAS 13)', D.interior.mod.cras[1] === somaInt('cras') && D.interior.mod.creas[1] === somaInt('creas') && somaInt('cras') === 13 && somaInt('creas') === 13);

  let r2 = resp('qual o perfil dos psicólogos de Pacaraima?');
  confere('perfil dos psicólogos de município do interior', /Pacaraima/.test(r2.txt) && /Perfil nos CRAS \(1\)/.test(r2.txt) && /estatutário/.test(r2.txt) && /Perfil nos CREAS \(1\)/.test(r2.txt), r2.txt.slice(0, 120));
  r2 = resp('perfil dos psicólogos dos CRAS de Bonfim');
  confere('perfil por módulo no interior', /Bonfim/.test(r2.txt) && /2 homens/.test(r2.txt) && /temporários/.test(r2.txt), r2.txt.slice(0, 120));
  r2 = resp('quantos psicólogos há em Alto Alegre?');
  confere('contagem de município do interior continua direta', /Alto Alegre/.test(r2.txt) && /3 registros de psicólogos/.test(r2.txt) && !/Perfil/.test(r2.txt), r2.txt.slice(0, 120));
  r2 = resp('equipe do CRAS de Cantá: onde estão os psicólogos?');
  confere('equipe de RH do CRAS de município do interior', /Cantá/.test(r2.txt) && /6 de nível médio/.test(r2.txt) && /2 \*\*psicólogos\*\*/.test(r2.txt), r2.txt.slice(0, 160));
  r2 = resp('quantos psicólogos no CREAS de São Luiz?');
  confere('município sem RH do módulo: avisa que não prova ausência do serviço', /não traz registros de RH/.test(r2.txt) && /não prova/.test(r2.txt), r2.txt.slice(0, 120));
  r2 = resp('quantos psicólogos há no interior de Roraima?');
  confere('interior de Roraima: 26 registros (13 CRAS e 13 CREAS), sem misturar com Boa Vista', /26 registros de psicólogos/.test(r2.txt) && /13 nos CRAS/.test(r2.txt) && /13 nos CREAS/.test(r2.txt) && /São Luiz/.test(r2.txt), r2.txt.slice(0, 160));
  r2 = resp('perfil dos psicólogos do interior');
  confere('perfil agregado do interior', /7 mulheres e 6 homens/.test(r2.txt) && /8 mulheres e 5 homens/.test(r2.txt), r2.txt.slice(0, 160));
  r2 = resp('quais municípios não têm psicólogo nos CRAS?');
  confere('municípios sem psicólogo nos CRAS: Caracaraí, Mucajaí, São João da Baliza e Uiramutã', /Caracaraí, Mucajaí, São João da Baliza, Uiramutã/.test(r2.txt) && /Boa Vista 19/.test(r2.txt), r2.txt.slice(0, 200));
  r2 = resp('quantos psicólogos há por município de Roraima?');
  confere('ranking por município soma 69 e deixa o acolhimento IBGE=14 de fora', /69 registros/.test(r2.txt) && /Boa Vista 43; Alto Alegre 3/.test(r2.txt) && /IBGE=14/.test(r2.txt), r2.txt.slice(0, 200));
  r2 = resp('onde estão os psicólogos na equipe dos centros de convivência de Boa Vista?');
  confere('Boa Vista: equipe de RH dos Centros de Convivência (4 psicólogos de 91)', /40 de nível médio/.test(r2.txt) && /4 psicólogos/.test(r2.txt) && /de 91/.test(r2.txt), r2.txt.slice(0, 160));
  r2 = resp('perfil dos psicólogos de Boa Vista');
  confere('Boa Vista: perfil inclui convivência, acolhimento, família acolhedora e gestão', /Perfil em Centro de Convivência \(4\)/.test(r2.txt) && /Perfil em Gestão Municipal do SUAS \(3\)/.test(r2.txt) && /Perfil em Família Acolhedora/.test(r2.txt), r2.txt.slice(-300));
  r2 = resp('quantos psicólogos há em Roraima?');
  confere('total de Roraima continua 161', /161 registros/.test(r2.txt));
  const pa = B.buildPayload('como está a atuação dos psicólogos em Pacaraima?', { tabCat: '', tabName: '' });
  confere('pergunta sobre psicólogos de município do interior envia o trecho do município ao Paulus', (pa.base || []).some(x => /Censo SUAS 2025/.test(x.origem || '') && /Pacaraima/.test(x.titulo) && /41/.test(x.texto)), (pa.base || []).map(x => x.titulo).join(' | '));
  const pi = B.buildPayload('como é o perfil dos psicólogos no interior de Roraima', { tabCat: '', tabName: '' });
  confere('pergunta sobre o interior envia o perfil do interior', (pi.base || []).some(x => /interior/.test(x.titulo) && /7 mulheres e 6 homens|8 mulheres e 5 homens/.test(x.texto)), (pi.base || []).map(x => x.titulo).join(' | '));
}

console.log(falhas ? '\n' + falhas + ' falha(s).' : '\nTudo certo.');
process.exit(falhas ? 1 : 0);

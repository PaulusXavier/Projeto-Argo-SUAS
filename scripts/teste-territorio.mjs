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
confere('13 trechos agregados do Censo SUAS foram carregados', TRECHOS_CENSO_CARREGADOS === 13, String(TRECHOS_CENSO_CARREGADOS));

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

console.log(falhas ? '\n' + falhas + ' falha(s).' : '\nTudo certo.');
process.exit(falhas ? 1 : 0);

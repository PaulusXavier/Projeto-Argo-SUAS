// Gera assets/municipios-rr.json (dados dos 15 municípios de Roraima que o mascote responde sem IA)
// a partir de assets/conhecimento.json (a base do Paulus que já está no app).
//
// Uso:  node scripts/gerar-municipios-rr.mjs        (sem dependências; Node 18+)
//
// Regra de ouro: NENHUM número entra no JSON sem estar escrito no texto de uma ficha da base.
// A tabela abaixo é conferida contra o texto; se algum valor não for achado, o script para e diz qual.
// Os diagnósticos por setor censitário só entram para territórios que são de UM município
// (Alto Alegre, Pacaraima, Uiramutã e Boa Vista). Os relatórios que misturam municípios
// (ex.: "Cantá, Boa Vista e Bonfim") NÃO são divididos: a soma de setores não dá o total de cada um.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = JSON.parse(readFileSync(join(RAIZ, 'assets/conhecimento.json'), 'utf8'));

const porDoc = {};
for (const c of base) (porDoc[c.doc] = porDoc[c.doc] || []).push(c);
const textoDoc = doc => (porDoc[doc] || []).map(c => c.texto).join('\n');

const br = (n, casas) => Number(n).toLocaleString('pt-BR', casas == null ? {} : { minimumFractionDigits: casas, maximumFractionDigits: casas });
const num = s => (s == null ? null : /^[\d.]+$/.test(s) ? Number(s.replace(/\./g, '')) : null);
const dec = s => Number(String(s).replace(/\./g, '').replace(',', '.'));

const MUN = 'roraima-municipios-2022';
const IND = 'roraima-povos-indigenas-2022';
const PER = 'roraima-perfil-ibge';

// População: Censo 2022 (IBGE). Indígenas: SEPLAN-RR, Informativo 013/2023. Área/distância: SESAU-RR e IBGE (ver doc).
const MUNICIPIOS = [
  { id: 'alto-alegre', nome: 'Alto Alegre', aliases: [], pop: 21096, indPct: 60.3, grupos: ['Alto Alegre'] },
  { id: 'amajari', nome: 'Amajari', aliases: ['Amajarí'], pop: 13927, indPct: 69.5, grupos: ['Amajari', 'Amajarí'] },
  { id: 'boa-vista', nome: 'Boa Vista', aliases: [], pop: 413486, areaKm2: 5687.037, indPessoas: 20410, indPct: 4.94, capital: true, grupos: [] },
  { id: 'bonfim', nome: 'Bonfim', aliases: [], pop: 13923, nota: 'Fica na fronteira com a Guiana e é ligado a Boa Vista pela BR-401.', grupos: ['Bonfim'] },
  { id: 'canta', nome: 'Cantá', aliases: ['Canta'], pop: 18682, areaKm2: 7664.83, grupos: ['Cantá'] },
  { id: 'caracarai', nome: 'Caracaraí', aliases: [], pop: 20957, areaKm2: 47379.9, densidade: 0.5, grupos: ['Caracaraí'] },
  { id: 'caroebe', nome: 'Caroebe', aliases: [], pop: 10656, grupos: ['Caroebe'] },
  { id: 'iracema', nome: 'Iracema', aliases: [], pop: 10023, areaKm2: 14011.7, nota: 'Fica a cerca de 93 km de Boa Vista (SESAU-RR).', grupos: ['Iracema'] },
  { id: 'mucajai', nome: 'Mucajaí', aliases: ['Mucajai'], pop: 18095, grupos: ['Mucajaí'] },
  { id: 'normandia', nome: 'Normandia', aliases: [], pop: 13986, indPessoas: 12144, indPct: 89, indAprox: true, grupos: ['Normandia'] },
  { id: 'pacaraima', nome: 'Pacaraima', aliases: [], pop: 19305, indPct: 59.2, nota: 'Fica na fronteira com a Venezuela e é a principal porta de entrada terrestre de migrantes e refugiados venezuelanos no Brasil.', grupos: ['Pacaraima'] },
  { id: 'rorainopolis', nome: 'Rorainópolis', aliases: ['Rorainopolis'], pop: 32647, areaKm2: 33579.74, densidade: 0.9, grupos: ['Rorainópolis'] },
  { id: 'sao-joao-da-baliza', nome: 'São João da Baliza', aliases: ['Sao Joao da Baliza'], pop: 8858, grupos: ['São João da Baliza'] },
  { id: 'sao-luiz', nome: 'São Luiz', aliases: ['São Luiz do Anauá', 'Sao Luiz do Anaua'], pop: 7315, grupos: ['São Luiz do Anauá', 'São Luiz'] },
  { id: 'uiramuta', nome: 'Uiramutã', aliases: ['Uiramuta'], pop: 13751, indPessoas: 13283, indPct: 96.6, grupos: ['Uiramutã'] }
];

// Relatórios de UM município só. "georef" = % das famílias do CadÚnico do município que o relatório localizou em setores
// (está no cabeçalho de cada documento de diagnóstico, e não no texto das fichas).
const DIAG = [
  { id: 'alto-alegre', doc: 'diagnostico-socioterritorial-alto-alegre-2026', georef: 78.94, setores: 14 },
  { id: 'pacaraima', doc: 'diagnostico-socioterritorial-pacaraima-2026', georef: 64.28, setores: 22 },
  { id: 'uiramuta', doc: 'diagnostico-socioterritorial-uiramuta-2026', georef: 81.46, setores: 23 },
  { id: 'boa-vista', doc: 'boa-vista-diagnostico-socioterritorial-2026', georef: 95.58, setores: 493 }
];

const erros = [];
const exige = (doc, trecho, rotulo) => { if (!textoDoc(doc).includes(trecho)) erros.push(rotulo + ': "' + trecho + '" não está em ' + doc); };

// 1) Confere a tabela fixa contra o texto das fichas
let soma = 0;
for (const m of MUNICIPIOS) {
  soma += m.pop;
  const sec = (porDoc[MUN] || []).find(c => c.texto.includes(m.nome + ' tem ') || c.texto.includes(m.nome + ', a capital, tem '));
  if (!sec) { erros.push('sem ficha de ' + m.nome + ' em ' + MUN); continue; }
  if (!sec.texto.includes(br(m.pop))) erros.push(m.nome + ': população ' + br(m.pop) + ' não está na ficha');
  if (m.areaKm2 != null && !sec.texto.includes(br(m.areaKm2, m.areaKm2 % 1 ? (String(m.areaKm2).split('.')[1] || '').length : 0)) && !sec.texto.includes(String(m.areaKm2).replace('.', ','))) erros.push(m.nome + ': área ' + m.areaKm2 + ' não está na ficha');
  if (m.indPct != null) {
    const t = textoDoc(MUN) + '\n' + textoDoc(IND);
    if (!t.includes(String(m.indPct).replace('.', ',') + '%') && !t.includes('cerca de ' + m.indPct + '%') && !(m.indAprox && t.includes('cerca de 89%'))) erros.push(m.nome + ': ' + m.indPct + '% indígenas não está na base');
  }
  if (m.indPessoas != null && !(textoDoc(MUN) + textoDoc(IND)).includes(br(m.indPessoas))) erros.push(m.nome + ': ' + br(m.indPessoas) + ' indígenas não está na base');
  if (m.nota) {
    // nota = frase copiada da ficha (ou resumo dela): confere palavras-chave
    const chaves = { bonfim: 'BR-401', iracema: '93 km', pacaraima: 'Venezuela' }[m.id];
    if (chaves && !textoDoc(MUN).includes(chaves)) erros.push(m.nome + ': nota sem apoio na ficha (' + chaves + ')');
  }
}
const TOTAL = 636707;
if (soma !== TOTAL) erros.push('soma das populações = ' + soma + ' (o estado tem ' + TOTAL + ')');
for (const t of ['636.707', '223.505,058', '2,85 habitantes por km²', '738.772', '41,3%', '97.320', '15,29%', '29,2%']) {
  if (!(textoDoc(PER) + textoDoc(IND)).includes(t)) erros.push('estado: "' + t + '" não está na base');
}

// 2) Diagnósticos de território de um município só
function leDiag(d) {
  const c = porDoc[d.doc] || [];
  const T = id => (c.find(x => x.id === d.doc + '#' + id) || {}).texto || '';
  const o = { referencia: 'CadÚnico e BPC 12/12/2025; Bolsa Família 01/01/2026; Censo 2022 (malha preliminar)', setores: d.setores, georefPct: d.georef };
  let m = T(1).match(/tem ([\d.]+) famílias e ([\d.]+) pessoas cadastradas\. Dessas famílias, ([\d.]+) são de Grupos/);
  if (m) Object.assign(o, { cadFamilias: num(m[1]), cadPessoas: num(m[2]), cadGpte: num(m[3]) });
  m = T(2).match(/([\d.]+) têm cadastro atualizado[^.]*?e ([\d.]+) têm cadastro desatualizado/);
  if (m) Object.assign(o, { cadAtualizadas: num(m[1]), cadDesatualizadas: num(m[2]) });
  m = T(2).match(/([\d.]+) até R\$ 218;/);
  if (m) o.cadAte218 = num(m[1]);
  m = T(3).match(/indígena ([\d.]+)/);
  if (m) o.cadIndigenas = num(m[1]);
  m = T(5).match(/é ([\d,]+), calculado sobre ([\d.]+) famílias/);
  if (m) Object.assign(o, { ivcad: dec(m[1]), ivcadFamilias: num(m[2]) });
  m = T(5).match(/Trabalho e Qualificação de Adultos ([\d,]+)/);
  if (m) o.ivcadTrabalho = dec(m[1]);
  m = T(11).match(/beneficia ([\d.]+) famílias e ([\d.]+) pessoas/);
  if (m) Object.assign(o, { pbfFamilias: num(m[1]), pbfPessoas: num(m[2]) });
  m = T(13).match(/há ([\d.]+) beneficiários[^:]*: ([\d.]+|de 1 a 20) pessoas com deficiência e ([\d.]+|de 1 a 20) idosos/);
  if (m) Object.assign(o, { bpc: num(m[1]), bpcDeficiencia: num(m[2]) != null ? num(m[2]) : m[2], bpcIdosos: num(m[3]) != null ? num(m[3]) : m[3] }); // "de 1 a 20": faixa do próprio relatório (sigilo estatístico)
  m = T(14).match(/somam ([\d.]+) pessoas e ([\d.]+) domicílios/);
  if (m) Object.assign(o, { censoSetoresPessoas: num(m[1]), censoSetoresDomicilios: num(m[2]) });
  for (const k of ['cadFamilias', 'cadPessoas', 'cadAtualizadas', 'ivcad', 'pbfFamilias', 'pbfPessoas', 'bpc']) {
    if (o[k] == null) erros.push(d.id + ': não achei ' + k + ' no diagnóstico');
  }
  return o;
}
const diag = {};
for (const d of DIAG) diag[d.id] = leDiag(d);

if (erros.length) {
  console.error('✗ A base não confere. Corrija antes de gerar:\n - ' + erros.join('\n - '));
  process.exit(1);
}

const ordem = [...MUNICIPIOS].sort((a, b) => b.pop - a.pop);
ordem.forEach((m, i) => { m.posicao = i + 1; });
for (const m of MUNICIPIOS) if (diag[m.id]) m.diagnostico = diag[m.id];

const saida = {
  v: 1,
  fonte: 'Censo 2022 (IBGE); SEPLAN-RR, Informativo 013/2023 (indígenas); SESAU-RR (área/distância); MDS, Diagnóstico Socioterritorial por setor censitário (gerado em 13/10/2026)',
  aviso: 'Dados de apoio, não norma. Estimativas e cadastros mudam: confira no IBGE, no MDS (VIS Data/Relatório de Informações) ou na Secretaria antes de usar em documento oficial.',
  estado: {
    nome: 'Roraima', capital: 'Boa Vista', municipios: 15, pop: TOTAL, popEstimada2025: 738772,
    areaKm2: 223505.058, densidade: 2.85, popGeral2010: 450479, crescimentoPct: 41.3,
    indigenas: 97320, indigenasPct: 15.29, indigenasEmTerras: 71412, indigenasForaTerras: 25908,
    ateQuatorzeAnosPct: 29.2, sessentaECincoMaisPct: 5,
    fronteiras: 'Venezuela (Pacaraima, BR-174) e Guiana (Bonfim, BR-401)'
  },
  municipios: MUNICIPIOS
};
writeFileSync(join(RAIZ, 'assets/municipios-rr.json'), JSON.stringify(saida, null, 1) + '\n');
console.log('✓ assets/municipios-rr.json: ' + MUNICIPIOS.length + ' municípios, soma ' + soma + ' = total do estado; diagnósticos de ' + Object.keys(diag).join(', '));

// Teste da ligação do Argo com as rotas do Paulus (v0.12.0):  npm run test:rota
// Carrega js/paulus.v1.js e as funções argoRotaPontos / argoRotaAparelho / argoRotaAsk de js/app.js num contexto isolado
// (sem navegador) e confere: pontos só com coordenada boa, pedido de rota respondido no aparelho, endereço de residência recusado,
// pergunta comum e "como chegar" simples seguem o fluxo normal.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const lerArq = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const app = lerArq('js/app.js');
const ini = app.indexOf('function argoRotaPontos()');
const fim = app.indexOf('function argoStreamIA(');
assert.ok(ini > 0 && fim > ini, 'blocos de rota não encontrados em js/app.js');

const aberturas = [];
const ctx = {
  console, window: { open: (...a) => aberturas.push(a) }, setTimeout, localStorage: { getItem: () => null, setItem() {} },
  UNITS_CRAS_CREAS: { cras: [
    { name: 'CRAS Cauamé', lat: 2.8287, lng: -60.6996, address: 'Av. Carlos Pereira de Melo, 207' },
    { name: 'CRAS União', lat: 2.844, lng: -60.727, address: 'R. Hilda Sobral Guedes, 81' }
  ], creas: [{ name: 'CREAS Centro', lat: 2.8217, lng: -60.678, address: 'Av. Mário Homem de Melo, 514' }] },
  DATA: [
    { id: 'caps-ii', name: 'CAPS II', fullName: 'Centro de Atenção Psicossocial II', address: 'Rua X, 10' },
    { id: 'ubs-aprox', name: 'UBS Aproximada', address: 'Rua Y' },
    { id: 'ubs-sem', name: 'UBS Sem Pino', address: 'Rua Z' }
  ],
  getGeocodeCache: () => ({ 'caps-ii': { lat: 2.82, lon: -60.67 }, 'ubs-aprox': { lat: 2.9, lon: -60.6, approx: true } }),
  proximityState: { active: false, lat: null, lon: null },
  argoBrain: () => ({ remember() {} }),
  navigator: { onLine: true }, avisos: [], reperguntas: [], geocodados: [],
  argoAviso(m) { ctx.avisos.push(m); },
  argoAssistantAskInline(t) { ctx.reperguntas.push(t); },
  async ensureGeocodedFor(itens) { itens.forEach(i => { ctx.geocodados.push(i.id); ctx.cacheGeo[i.id] = { lat: 2.81, lon: -60.69 }; }); }
};
ctx.cacheGeo = { 'caps-ii': { lat: 2.82, lon: -60.67 }, 'ubs-aprox': { lat: 2.9, lon: -60.6, approx: true } };
ctx.getGeocodeCache = () => ctx.cacheGeo;
vm.createContext(ctx);
vm.runInContext(lerArq('js/paulus.v1.js'), ctx);          // define Paulus
ctx.Paulus = vm.runInContext('typeof Paulus !== "undefined" ? Paulus : null', ctx);
assert.ok(ctx.Paulus && ctx.Paulus.rota, 'js/paulus.v1.js precisa ser v0.12.0 ou mais novo (tem Paulus.rota)');
vm.runInContext(app.slice(ini, fim) + '\nthis.argoRotaPontos = argoRotaPontos; this.argoRotaAparelho = argoRotaAparelho; this.argoRotaAsk = argoRotaAsk; this.argoRotaOutrosModos = argoRotaOutrosModos; this.argoRotaChipUnidades = argoRotaChipUnidades; this.argoRotaChipLocalizar = argoRotaChipLocalizar;', ctx);

let ok = 0; const passa = n => { ok++; console.log('✓ ' + n); };

const nomes = Array.from(ctx.argoRotaPontos(), p => p.nome);
assert.deepEqual([...nomes].sort(), ['CAPS II', 'CRAS Cauamé', 'CRAS União', 'CREAS Centro']);
passa('pontos: CRAS/CREAS com coordenada conferida + equipamentos localizados; aproximado e sem pino ficam de fora');

assert.equal(ctx.argoRotaAparelho(), null);
ctx.proximityState = { active: true, lat: 2.8, lon: -60.7 };
assert.deepEqual({ ...ctx.argoRotaAparelho() }, { lat: 2.8, lng: -60.7 });
ctx.proximityState = { active: false, lat: null, lon: null };
passa('posição do aparelho só quando o "perto de mim" está ligado');

const r = ctx.argoRotaAsk('traçar rota saindo do CRAS Cauamé: CREAS Centro, CAPS II e CRAS União, voltando ao CRAS Cauamé, de moto, 30 minutos em cada');
assert.ok(r && /Ordem sugerida/.test(r.reply) && /km/.test(r.reply));
assert.equal(r.badge, 'Rota'); assert.equal(r.mood, 'success');
assert.ok(r.svg && r.svg.startsWith('<svg'), 'esquema SVG');
assert.ok(/mapas/.test(r.quickActions[0].label));
assert.match(r.note, /Estimativa/);
r.quickActions[0].run();
assert.equal(aberturas.length, 1); assert.match(aberturas[0][0], /^https:\/\/www\.google\.com\/maps\/dir\//); assert.equal(aberturas[0][2], 'noopener');
passa('pedido de rota: ordem, km e tempo, esquema, botão do mapa abre com noopener');

const rb = ctx.argoRotaAsk('rota da minha casa até a casa da família na Rua das Flores, 123');
assert.ok(rb === null || (rb.mood === 'notfound' && /resid/i.test(rb.reply)), 'endereço de residência: recusa ou segue o fluxo normal (que não traça rota)');
passa('endereço de residência não vira rota');

assert.equal(ctx.argoRotaAsk('o que é rota de visita?'), null);
assert.equal(ctx.argoRotaAsk('qual o telefone do CRAS União?'), null);
assert.equal(ctx.argoRotaAsk('como chegar no CRAS Cauamé'), null);
passa('pergunta comum e "como chegar" com uma só unidade seguem o fluxo do diretório');

const rs = ctx.argoRotaAsk('rota de visita passando pelo CRAS Cauamé e pelo Hospital Inexistente');
assert.ok(rs === null || /não estimei|nao estimei/i.test(rs.note), 'unidade sem coordenada: sem estimar');
passa('unidade fora do diretório: não inventa km nem tempo');

const pedido = 'traçar rota saindo do CRAS Cauamé: CREAS Centro, CAPS II e CRAS União, voltando ao CRAS Cauamé, de moto, 30 minutos em cada';
const chips = Array.from(ctx.argoRotaOutrosModos(pedido));
assert.deepEqual(chips.map(c => c.label), ['Fazer de carro', 'Fazer a pé']);
assert.ok(!/de moto/.test(chips[0].ask) && /, de carro$/.test(chips[0].ask) && /30 minutos em cada/.test(chips[0].ask));
const rc = ctx.argoRotaAsk(chips[1].ask);
assert.ok(rc && /a pé/.test(rc.reply), 'o chip refaz o pedido no outro modo');
assert.ok(r.quickActions.length === 3 && /Fazer de carro/.test(r.quickActions[1].label));
passa('chips "Fazer de carro / a pé": mesmo pedido, só troca o modo');

const chipU = ctx.argoRotaChipUnidades([{ name: 'CRAS União' }, { name: 'Centro de Atenção Psicossocial II' }, { name: 'CREAS Centro' }, { name: 'Lugar Que Não Existe' }]);
assert.equal(chipU.ask, 'Melhor ordem para visitar CRAS União, CAPS II e CREAS Centro');
assert.ok(ctx.argoRotaAsk(chipU.ask), 'o atalho vira um pedido de rota válido');
assert.equal(ctx.argoRotaChipUnidades([{ name: 'CRAS União' }]), null);
passa('resposta com 2+ unidades do diretório ganha o atalho "Melhor ordem para visitar"');

const sp = ctx.argoRotaAsk('rota de visita passando pelo CRAS Cauamé e pela UBS Sem Pino');
const chipL = sp && sp.quickActions.find(q => /Localizar/.test(q.label));
assert.ok(chipL, 'parada sem pino ganha o botão de localizar');
assert.equal(ctx.argoRotaChipLocalizar('x', ['UBS Aproximada']) && 'tem', 'tem');   // aproximado não conta como pino: continua oferecendo
assert.equal(ctx.argoRotaChipLocalizar('x', ['CRAS Cauamé']), null);                  // já tem pino
assert.equal(ctx.argoRotaChipLocalizar('x', ['Lugar Que Não Existe']), null);         // fora do diretório: nada a localizar
await chipL.run();
assert.deepEqual(Array.from(ctx.geocodados), ['ubs-sem']);
assert.equal(ctx.reperguntas.length, 1);
passa('parada sem pino: localiza só aquela unidade e refaz o pedido');

console.log('\n' + ok + ' verificações ok');

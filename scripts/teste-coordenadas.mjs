// Teste do carregador dos pinos prontos (assets/coordenadas.json) — roda em segundos, sem dependências.
//   npm run test:coordenadas
// Extrai mapaRedeLoadBaseCoords de js/app.js e o executa com um navegador simulado: confere que lê o arquivo uma
// única vez, descarta pino fora de Roraima ou inválido, não sobrescreve posição que o aparelho já tem e mantém a
// marca "aproximado" (as rotas do mascote ignoram pino aproximado).
import fs from 'node:fs';
const src = fs.readFileSync('js/app.js','utf8');
const i = src.indexOf('const MAPA_REDE_RORAIMA_BBOX');
const j = src.indexOf('// Leitura em segundo plano');
const trecho = src.slice(i,j);
const cnt = { n: 0 };
const store = {};
const cache = { 'ja-tem': { lat: 2.8, lon: -60.7, manual: true } };
const ctx = `
  const GEOCODE_CACHE_KEY='k';
  const getGeocodeCache=()=>cache;
  const localStorage={setItem:(k,v)=>{store[k]=v}};
  const fetch=async()=>{cnt.n++;return {ok:true,json:async()=>({
    'novo':{lat:2.82,lon:-60.67},
    'ja-tem':{lat:9,lon:9},
    'sp':{lat:-23.5,lon:-46.6},
    'lixo':{lat:'x',lon:null},
    'aprox':{lat:2.83,lon:-60.66,approx:true}})}};
  ${trecho}
  return mapaRedeLoadBaseCoords;`;
const load = new Function('cache','store','cnt',ctx)(cache,store,cnt);
// chamadas simultâneas
const [a,b] = [load(), load()];
await Promise.all([a,b]); await load();
const ok = (c,m)=>{ if(!c){console.log('FALHOU:',m);process.exitCode=1;} else console.log('ok -',m); };
ok(cnt.n===1,'lê o arquivo uma única vez (3 chamadas, 1 leitura)');
ok(cache.novo && cache.novo.lat===2.82,'entra pino novo dentro de Roraima');
ok(cache['ja-tem'].manual===true && cache['ja-tem'].lat===2.8,'não sobrescreve posição que o aparelho já tem');
ok(!cache.sp,'descarta pino fora de Roraima');
ok(!cache.lixo,'descarta lat/lon inválidos');
ok(cache.aprox && cache.aprox.approx===true,'mantém a marca "aproximado" (as rotas o ignoram)');
ok(Object.keys(store).length===1,'grava o cache uma vez');

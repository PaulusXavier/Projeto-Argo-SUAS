// Teste do gerador de .zip com senha (assets/vendor/zip-aes.js):  npm run test:zip
// Confere o AES-256 com o vetor oficial (FIPS-197) e abre os .zip gerados com um decodificador INDEPENDENTE,
// escrito só com node:crypto seguindo a especificação do WinZip AES (AE-2), e com o ZipCrypto clássico.
import { readFileSync } from 'node:fs';
import { createCipheriv, createHmac, pbkdf2Sync, createDecipheriv } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import assert from 'node:assert/strict';

globalThis.eval(readFileSync(new URL('../assets/vendor/zip-aes.js', import.meta.url), 'utf8'));
const Z = globalThis.ArgoZip;
let ok = 0;
const passa = (nome) => { ok++; console.log('✓ ' + nome); };

// 1) AES-256, vetor de teste do FIPS-197.
{
  const rk = Z._expandKey256(Uint8Array.from({ length: 32 }, (_, i) => i));
  const out = new Uint32Array(4);
  Z._encryptBlock(rk, 0x00112233, 0x44556677, 0x8899aabb, 0xccddeeff, out);
  assert.equal([...out].map(v => (v >>> 0).toString(16).padStart(8, '0')).join(''), '8ea2b7ca516745bfeafc49904b496089');
  passa('AES-256 confere com o vetor oficial');
}

// Lê as entradas do .zip pelo diretório central.
function entradas(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  assert.ok(eocd >= 0, 'fim do diretório central não encontrado');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const lista = [];
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const e = {
      flags: buf.readUInt16LE(p + 8), metodo: buf.readUInt16LE(p + 10), crc: buf.readUInt32LE(p + 16),
      csize: buf.readUInt32LE(p + 20), usize: buf.readUInt32LE(p + 24)
    };
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    e.nome = buf.toString('utf8', p + 46, p + 46 + nl);
    const ln = buf.readUInt16LE(off + 26), lx = buf.readUInt16LE(off + 28);
    e.dados = buf.subarray(off + 30 + ln + lx, off + 30 + ln + lx + e.csize);
    e.extra = buf.subarray(p + 46 + nl, p + 46 + nl + xl);
    lista.push(e);
    p += 46 + nl + xl + cl;
  }
  return lista;
}

function abrirAes(e, senha) {
  assert.equal(e.metodo, 99);
  assert.equal(e.extra.readUInt16LE(0), 0x9901);
  assert.equal(e.extra[8], 3, 'força AES-256');
  const real = e.extra.readUInt16LE(9);
  const salt = e.dados.subarray(0, 16);
  const k = pbkdf2Sync(Buffer.from(senha, 'utf8'), salt, 1000, 66, 'sha1');
  if (!k.subarray(64, 66).equals(e.dados.subarray(16, 18))) return null;           // senha errada
  const cif = e.dados.subarray(18, e.dados.length - 10);
  const mac = createHmac('sha1', k.subarray(32, 64)).update(cif).digest().subarray(0, 10);
  assert.ok(mac.equals(e.dados.subarray(e.dados.length - 10)), 'HMAC inválido');
  // keystream: AES-ECB de contadores little-endian 1, 2, 3...
  const ecb = createCipheriv('aes-256-ecb', k.subarray(0, 32), null); ecb.setAutoPadding(false);
  const blocos = Math.ceil(cif.length / 16), ctr = Buffer.alloc(blocos * 16);
  for (let i = 0; i < blocos; i++) ctr.writeUInt32LE(i + 1, i * 16);
  const ks = ecb.update(ctr);
  const claro = Buffer.from(cif.map((b, i) => b ^ ks[i]));
  return real === 8 ? inflateRawSync(claro) : claro;
}

function abrirZipCrypto(e, senha) {
  const T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  let k0 = 0x12345678, k1 = 0x23456789, k2 = 0x34567890;
  const upd = b => { k0 = (T[(k0 ^ b) & 255] ^ (k0 >>> 8)) >>> 0; k1 = (Math.imul((k1 + (k0 & 255)) >>> 0, 134775813) + 1) >>> 0; k2 = (T[(k2 ^ (k1 >>> 24)) & 255] ^ (k2 >>> 8)) >>> 0; };
  for (const b of Buffer.from(senha)) upd(b);
  const dec = c => { const t = (k2 | 2) & 0xffff; const p = c ^ (((t * (t ^ 1)) >>> 8) & 255); upd(p); return p; };
  const claro = Buffer.from(e.dados.map(dec));
  if (claro[11] !== e.crc >>> 24) return null;                                       // senha errada
  const corpo = claro.subarray(12);
  return e.metodo === 8 ? inflateRawSync(corpo) : corpo;
}

const grande = Buffer.alloc(300_000); for (let i = 0; i < grande.length; i++) grande[i] = (i * 31 + (i >> 7)) & 255;
const itens = [
  { path: 'pasta/a.txt', bytes: Buffer.from('olá mundo, acentuação! '.repeat(50)) },
  { path: 'pasta/sub/b.bin', bytes: grande },
  { path: 'pasta/a.txt', bytes: Buffer.from('nome repetido') },
  { path: 'vazio.txt', bytes: new Uint8Array(0) },
  { path: '../../fuga.txt', bytes: Buffer.from('x') }
];

for (const [metodo, abrir] of [['aes', abrirAes], ['zipcrypto', abrirZipCrypto]]) {
  const blob = await Z.build(itens, { password: 'Senha123', method: metodo });
  const lista = entradas(Buffer.from(await blob.arrayBuffer()));
  assert.deepEqual(lista.map(e => e.nome), ['pasta/a.txt', 'pasta/sub/b.bin', 'pasta/a (2).txt', 'vazio.txt', 'fuga.txt']);
  lista.forEach((e, i) => {
    const claro = abrir(e, 'Senha123');
    assert.ok(claro, 'senha certa deveria abrir ' + e.nome);
    assert.ok(Buffer.from(itens[i].bytes).equals(claro), 'conteúdo diferente em ' + e.nome);
    assert.equal(abrir(e, 'senha-errada'), null, 'senha errada deveria ser recusada');
  });
  passa(metodo + ': ' + lista.length + ' arquivos abrem com a senha certa e são recusados com a errada');
}

try { await Z.build(itens, { password: '' }); assert.fail('aceitou senha vazia'); } catch (e) { assert.equal(e.message, 'Senha vazia'); }
passa('senha vazia é recusada');
console.log('\nTudo certo (' + ok + ' verificações).');

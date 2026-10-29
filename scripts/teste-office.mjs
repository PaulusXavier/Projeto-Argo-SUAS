// Teste da senha em documentos (assets/vendor/officecrypt.js):  npm run test:office
// Abre o arquivo gerado com um leitor INDEPENDENTE (só node:crypto, seguindo MS-CFB e MS-OFFCRYPTO "Agile"):
// lê o contêiner OLE, confere a senha, confere o HMAC e decifra o pacote. Também testa o formato .argo.
import { readFileSync } from 'node:fs';
import { createHash, createHmac, createDecipheriv } from 'node:crypto';
import assert from 'node:assert/strict';
globalThis.eval(readFileSync(new URL('../assets/vendor/officecrypt.js', import.meta.url), 'utf8'));
const { ArgoOffice, ArgoSecret } = globalThis;
let ok = 0; const passa = n => { ok++; console.log('✓ ' + n); };

function lerCfb(buf) {
  assert.equal(buf.readBigUInt64LE(0), 0xe11ab1a1e011cfd0n, 'assinatura OLE');
  const nFat = buf.readUInt32LE(44), dirStart = buf.readUInt32LE(48), miniFatStart = buf.readUInt32LE(60), difStart = buf.readUInt32LE(68), nDif = buf.readUInt32LE(72);
  const sec = n => buf.subarray((n + 1) * 512, (n + 2) * 512);
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(buf.readUInt32LE(76 + 4 * i));
  let d = difStart;
  for (let k = 0; k < nDif; k++) { const s = sec(d); for (let i = 0; i < 127 && fatSecs.length < nFat; i++) fatSecs.push(s.readUInt32LE(4 * i)); d = s.readUInt32LE(508); }
  const fat = fatSecs.flatMap(n => Array.from({ length: 128 }, (_, i) => sec(n).readUInt32LE(4 * i)));
  const cadeia = (ini) => { const o = []; for (let n = ini; n < 0xfffffff0; n = fat[n]) o.push(n); return o; };
  const ler = ini => Buffer.concat(cadeia(ini).map(sec));
  const dir = ler(dirStart);
  const ent = [];
  for (let i = 0; i < dir.length / 128; i++) {
    const o = i * 128, nl = dir.readUInt16LE(o + 64);
    if (!nl) continue;
    ent.push({ nome: dir.toString('utf16le', o, o + nl - 2), tipo: dir[o + 66], ini: dir.readUInt32LE(o + 116), tam: dir.readUInt32LE(o + 120), esq: dir.readUInt32LE(o + 68), dir: dir.readUInt32LE(o + 72), filho: dir.readUInt32LE(o + 76) });
  }
  const mini = ler(ent[0].ini).subarray(0, ent[0].tam);
  const miniFat = ler(miniFatStart);
  const lerFluxo = e => {
    if (e.tam < 4096) { const o = []; for (let n = e.ini; n < 0xfffffff0; n = miniFat.readUInt32LE(4 * n)) o.push(mini.subarray(n * 64, n * 64 + 64)); return Buffer.concat(o).subarray(0, e.tam); }
    return ler(e.ini).subarray(0, e.tam);
  };
  return { ent, lerFluxo };
}

function abrirAgile(buf, senha) {
  const { ent, lerFluxo } = lerCfb(buf);
  const info = lerFluxo(ent.find(e => e.nome === 'EncryptionInfo'));
  const pacote = lerFluxo(ent.find(e => e.nome === 'EncryptedPackage'));
  assert.deepEqual([...info.subarray(0, 8)], [4, 0, 4, 0, 0x40, 0, 0, 0]);
  const xml = info.subarray(8).toString('utf8');
  const a = (tag, nome) => Buffer.from(new RegExp('<' + tag + '[^>]*? ' + nome + '="([^"]*)"').exec(xml)[1], 'base64');
  const spin = +/spinCount="(\d+)"/.exec(xml)[1];
  const sal = a('p:encryptedKey', 'saltValue'), salDados = a('keyData', 'saltValue');
  const sha = (...p) => { const h = createHash('sha512'); p.forEach(x => h.update(x)); return h.digest(); };
  let h = sha(sal, Buffer.from(senha, 'utf16le'));
  for (let i = 0; i < spin; i++) { const c = Buffer.alloc(4); c.writeUInt32LE(i); h = sha(c, h); }
  const dec = (chave, iv, dados) => { const d = createDecipheriv('aes-256-cbc', chave, iv); d.setAutoPadding(false); return Buffer.concat([d.update(dados), d.final()]); };
  const k = blk => sha(h, Buffer.from(blk)).subarray(0, 32);
  const verIn = dec(k([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]), sal, a('p:encryptedKey', 'encryptedVerifierHashInput'));
  const verVal = dec(k([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]), sal, a('p:encryptedKey', 'encryptedVerifierHashValue'));
  if (!sha(verIn).equals(verVal.subarray(0, 64))) return null;                   // senha errada
  const segredo = dec(k([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]), sal, a('p:encryptedKey', 'encryptedKeyValue'));
  // integridade
  const hk = dec(segredo, sha(salDados, Buffer.from([0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6])).subarray(0, 16), a('dataIntegrity', 'encryptedHmacKey'));
  const hv = dec(segredo, sha(salDados, Buffer.from([0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33])).subarray(0, 16), a('dataIntegrity', 'encryptedHmacValue'));
  assert.ok(createHmac('sha512', hk).update(pacote).digest().equals(hv), 'HMAC do pacote');
  const tam = Number(pacote.readBigUInt64LE(0));
  const partes = [];
  for (let i = 0, off = 8; off < pacote.length; i++, off += 4096) {
    const c = Buffer.alloc(4); c.writeUInt32LE(i);
    partes.push(dec(segredo, sha(salDados, c).subarray(0, 16), pacote.subarray(off, off + 4096)));
  }
  return Buffer.concat(partes).subarray(0, tam);
}

const zipFalso = (n, semente) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 131 + (i >> 5) + semente) & 255; b[0] = 0x50; b[1] = 0x4b; return b; };
for (const [rotulo, tam] of [['minúsculo (fluxo no mini stream)', 900], ['médio', 120_000], ['grande (precisa de DIFAT)', 7_500_000]]) {
  const original = zipFalso(tam, tam);
  const cifrado = Buffer.from(await ArgoOffice.encrypt(original, 'Senha123', { spinCount: 1000 }));
  assert.equal(cifrado.length % 512, 0);
  const aberto = abrirAgile(cifrado, 'Senha123');
  assert.ok(aberto && aberto.equals(original), 'conteúdo diferente: ' + rotulo);
  assert.equal(abrirAgile(cifrado, 'senha-errada'), null);
  passa('Office AES-256: ' + rotulo + ' abre com a senha certa e recusa a errada');
}
try { await ArgoOffice.encrypt(Buffer.from('texto qualquer'), 'x'); assert.fail(); } catch (e) { assert.match(e.message, /Office/); }
passa('arquivo que não é do Office é recusado');

const texto = Buffer.from('Atendimento de hoje: família 123, acentuação ção.');
const argo = await ArgoSecret.encrypt(texto, 'Senha123');
assert.ok(Buffer.from(await ArgoSecret.decrypt(argo, 'Senha123')).equals(texto));
await assert.rejects(ArgoSecret.decrypt(argo, 'errada'), /Senha incorreta/);
const adulterado = Uint8Array.from(argo); adulterado[adulterado.length - 1] ^= 1;
await assert.rejects(ArgoSecret.decrypt(adulterado, 'Senha123'), /Senha incorreta/);
passa('.argo: abre com a senha certa; senha errada e arquivo adulterado são recusados');
console.log('\nTudo certo (' + ok + ' verificações).');

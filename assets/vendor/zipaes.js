/*! ArgoZip — gera arquivos .zip com senha, no navegador (sem biblioteca externa, funciona offline).
 *
 *  Método "aes"       : WinZip AES-256 (AE-2). Criptografia forte; abre no 7-Zip, WinRAR, WinZip, Keka e The Unarchiver.
 *  Método "zipcrypto" : criptografia clássica do .zip. FRACA (só barra curiosos), mas abre no Explorer do Windows
 *                       e no Utilitário de Arquivos do Mac sem programa extra.
 *
 *  Usa só recursos do navegador: SubtleCrypto (PBKDF2 e HMAC-SHA1), CompressionStream (opcional) e Blob.
 *  O AES-256 em modo contador (CTR "little-endian" do WinZip) é implementado aqui, porque o SubtleCrypto
 *  só oferece contador big-endian.
 *
 *  Uso:  const blob = await ArgoZip.build([{ path: 'pasta/a.pdf', file: File }], { password, method: 'aes', onProgress(i, n) {} });
 */
(function (root) {
  'use strict';

  /* ---------------- AES-256 (só cifrar bloco; tabelas geradas na carga) ---------------- */
  const SBOX = new Uint8Array(256);
  const TE = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const xtime = a => ((a << 1) ^ ((a & 0x80) ? 0x11b : 0)) & 255;
  (function initTables() {
    let p = 1, q = 1;
    do {
      p = (p ^ (p << 1) ^ ((p & 0x80) ? 0x11b : 0)) & 255;      // p *= 3
      q ^= q << 1; q &= 255; q ^= q << 2; q &= 255; q ^= q << 4; q &= 255;
      if (q & 0x80) q ^= 0x09;                                   // q /= 3
      const rl = (v, n) => ((v << n) | (v >> (8 - n))) & 255;
      SBOX[p] = (q ^ rl(q, 1) ^ rl(q, 2) ^ rl(q, 3) ^ rl(q, 4) ^ 0x63) & 255;
    } while (p !== 1);
    SBOX[0] = 0x63;
    for (let x = 0; x < 256; x++) {
      const s = SBOX[x], s2 = xtime(s), s3 = s2 ^ s;
      const t = ((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0;
      TE[0][x] = t;
      TE[1][x] = ((t >>> 8) | (t << 24)) >>> 0;
      TE[2][x] = ((t >>> 16) | (t << 16)) >>> 0;
      TE[3][x] = ((t >>> 24) | (t << 8)) >>> 0;
    }
  })();

  function expandKey256(key) {            // key: Uint8Array(32) -> Uint32Array(60)
    const w = new Uint32Array(60);
    for (let i = 0; i < 8; i++) w[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
    const sub = t => ((SBOX[t >>> 24] << 24) | (SBOX[(t >>> 16) & 255] << 16) | (SBOX[(t >>> 8) & 255] << 8) | SBOX[t & 255]) >>> 0;
    let rcon = 1;
    for (let i = 8; i < 60; i++) {
      let t = w[i - 1];
      if (i % 8 === 0) { t = (sub(((t << 8) | (t >>> 24)) >>> 0) ^ (rcon << 24)) >>> 0; rcon = xtime(rcon); }
      else if (i % 8 === 4) t = sub(t);
      w[i] = (w[i - 8] ^ t) >>> 0;
    }
    return w;
  }

  // Cifra um bloco (4 palavras big-endian) e grava 4 palavras em out.
  function encryptBlock(rk, a, b, c, d, out) {
    const T0 = TE[0], T1 = TE[1], T2 = TE[2], T3 = TE[3];
    let s0 = a ^ rk[0], s1 = b ^ rk[1], s2 = c ^ rk[2], s3 = d ^ rk[3];
    let k = 4;
    for (let r = 1; r < 14; r++, k += 4) {
      const t0 = T0[s0 >>> 24] ^ T1[(s1 >>> 16) & 255] ^ T2[(s2 >>> 8) & 255] ^ T3[s3 & 255] ^ rk[k];
      const t1 = T0[s1 >>> 24] ^ T1[(s2 >>> 16) & 255] ^ T2[(s3 >>> 8) & 255] ^ T3[s0 & 255] ^ rk[k + 1];
      const t2 = T0[s2 >>> 24] ^ T1[(s3 >>> 16) & 255] ^ T2[(s0 >>> 8) & 255] ^ T3[s1 & 255] ^ rk[k + 2];
      const t3 = T0[s3 >>> 24] ^ T1[(s0 >>> 16) & 255] ^ T2[(s1 >>> 8) & 255] ^ T3[s2 & 255] ^ rk[k + 3];
      s0 = t0; s1 = t1; s2 = t2; s3 = t3;
    }
    out[0] = ((SBOX[s0 >>> 24] << 24) | (SBOX[(s1 >>> 16) & 255] << 16) | (SBOX[(s2 >>> 8) & 255] << 8) | SBOX[s3 & 255]) ^ rk[56];
    out[1] = ((SBOX[s1 >>> 24] << 24) | (SBOX[(s2 >>> 16) & 255] << 16) | (SBOX[(s3 >>> 8) & 255] << 8) | SBOX[s0 & 255]) ^ rk[57];
    out[2] = ((SBOX[s2 >>> 24] << 24) | (SBOX[(s3 >>> 16) & 255] << 16) | (SBOX[(s0 >>> 8) & 255] << 8) | SBOX[s1 & 255]) ^ rk[58];
    out[3] = ((SBOX[s3 >>> 24] << 24) | (SBOX[(s0 >>> 16) & 255] << 16) | (SBOX[(s1 >>> 8) & 255] << 8) | SBOX[s2 & 255]) ^ rk[59];
  }

  // AES-CTR do WinZip: bloco contador de 16 bytes, número em little-endian, começando em 1. Altera data no lugar.
  function aesCtrWinZip(key, data) {
    const rk = expandKey256(key);
    const ks = new Uint32Array(4);
    const n = data.length;
    let counter = 1;
    for (let i = 0; i < n; i += 16, counter++) {
      // os 4 primeiros bytes do bloco são o contador em little-endian; lidos como palavra big-endian:
      const w0 = (((counter & 255) << 24) | (((counter >>> 8) & 255) << 16) | (((counter >>> 16) & 255) << 8) | ((counter >>> 24) & 255)) >>> 0;
      encryptBlock(rk, w0, 0, 0, 0, ks);
      const lim = Math.min(16, n - i);
      for (let j = 0; j < lim; j++) data[i + j] ^= (ks[j >> 2] >>> (24 - 8 * (j & 3))) & 255;
    }
  }

  /* ---------------- CRC-32 e ZipCrypto ---------------- */
  const CRC_T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); CRC_T[n] = c >>> 0; }
  function crc32(data) { let c = 0xffffffff; for (let i = 0; i < data.length; i++) c = CRC_T[(c ^ data[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

  function zipCryptoEncrypt(data, passBytes, checkByte) {
    let k0 = 0x12345678, k1 = 0x23456789, k2 = 0x34567890;
    const upd = b => {
      k0 = CRC_T[(k0 ^ b) & 255] ^ (k0 >>> 8);
      k1 = (Math.imul((k1 + (k0 & 255)) >>> 0, 134775813) + 1) >>> 0;
      k2 = CRC_T[(k2 ^ (k1 >>> 24)) & 255] ^ (k2 >>> 8);
    };
    for (let i = 0; i < passBytes.length; i++) upd(passBytes[i]);
    const enc = b => { const t = (k2 | 2) & 0xffff; const ks = ((t * (t ^ 1)) >>> 8) & 255; const out = b ^ ks; upd(b); return out; };
    const header = new Uint8Array(12);
    crypto.getRandomValues(header);
    header[11] = checkByte;
    const out = new Uint8Array(12 + data.length);
    for (let i = 0; i < 12; i++) out[i] = enc(header[i]);
    for (let i = 0; i < data.length; i++) out[12 + i] = enc(data[i]);
    return out;
  }

  /* ---------------- utilidades ---------------- */
  const utf8 = s => new TextEncoder().encode(s);
  function u16(v) { return [v & 255, (v >>> 8) & 255]; }
  function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }

  function dosDateTime(ms) {
    const d = new Date(ms && ms > 315532800000 ? ms : Date.now());
    const y = Math.min(Math.max(d.getFullYear(), 1980), 2107);
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  function cleanPath(p) {
    const parts = String(p || 'arquivo').replace(/\\/g, '/').split('/').filter(s => s && s !== '.' && s !== '..');
    return parts.join('/') || 'arquivo';
  }

  async function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { return null; }
  }

  // PBKDF2-HMAC-SHA1 (1000 voltas) -> chave AES (32) + chave HMAC (32) + verificador (2)
  async function deriveAesKeys(password, salt) {
    const base = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-1', salt, iterations: 1000 }, base, 66 * 8));
    return { aesKey: bits.slice(0, 32), macKey: bits.slice(32, 64), verifier: bits.slice(64, 66) };
  }
  async function hmacSha1(macKey, data) {
    const k = await crypto.subtle.importKey('raw', macKey, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
  }

  /* ---------------- montagem do .zip ---------------- */
  // items: [{ path, file?: File, bytes?: Uint8Array|ArrayBuffer, mtime?: number }]
  async function build(items, opts) {
    opts = opts || {};
    const password = String(opts.password || '');
    if (!password) throw new Error('Senha vazia');
    const method = opts.method === 'zipcrypto' ? 'zipcrypto' : 'aes';
    const passBytes = utf8(password);
    const parts = [];          // pedaços do arquivo final (Blob aceita Uint8Array)
    const central = [];
    const used = new Set();
    let offset = 0;

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      if (opts.onProgress) opts.onProgress(idx, items.length, it);
      await new Promise(r => setTimeout(r, 0)); // deixa a tela respirar entre um arquivo e outro

      let name = cleanPath(it.path);
      const dot = name.lastIndexOf('.'), slash = name.lastIndexOf('/');
      const stem = dot > slash + 1 ? name.slice(0, dot) : name, ext = dot > slash + 1 ? name.slice(dot) : '';
      let n = 2;
      while (used.has(name.toLowerCase())) name = stem + ' (' + (n++) + ')' + ext;
      used.add(name.toLowerCase());
      const nameBytes = utf8(name);

      const raw = it.bytes ? new Uint8Array(it.bytes) : new Uint8Array(await it.file.arrayBuffer());
      const crc = crc32(raw);
      let comp = 0, body = raw;
      if (raw.length > 64) {
        const d = await deflateRaw(raw);
        if (d && d.length < raw.length) { comp = 8; body = d; }
      }
      const { time, date } = dosDateTime(it.mtime || (it.file && it.file.lastModified));
      let flags = 0x0801, version = 20, methodField = comp, crcField = crc, extra = [], payload;

      if (method === 'aes') {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const k = await deriveAesKeys(password, salt);
        const enc = body.slice();                      // cópia: body pode ser o próprio arquivo lido
        aesCtrWinZip(k.aesKey, enc);
        const mac = (await hmacSha1(k.macKey, enc)).slice(0, 10);
        payload = new Uint8Array(16 + 2 + enc.length + 10);
        payload.set(salt, 0); payload.set(k.verifier, 16); payload.set(enc, 18); payload.set(mac, 18 + enc.length);
        version = 51; methodField = 99; crcField = 0;          // AE-2: o CRC fica zerado
        extra = [0x01, 0x99, 0x07, 0x00, 0x02, 0x00, 0x41, 0x45, 0x03, ...u16(comp)];
      } else {
        payload = zipCryptoEncrypt(body, passBytes, crc >>> 24);
      }

      const local = new Uint8Array([
        ...u32(0x04034b50), ...u16(version), ...u16(flags), ...u16(methodField), ...u16(time), ...u16(date),
        ...u32(crcField), ...u32(payload.length), ...u32(raw.length), ...u16(nameBytes.length), ...u16(extra.length),
        ...nameBytes, ...extra
      ]);
      parts.push(local, payload);
      central.push(new Uint8Array([
        ...u32(0x02014b50), ...u16(version === 51 ? 63 : 20), ...u16(version), ...u16(flags), ...u16(methodField),
        ...u16(time), ...u16(date), ...u32(crcField), ...u32(payload.length), ...u32(raw.length),
        ...u16(nameBytes.length), ...u16(extra.length), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
        ...nameBytes, ...extra
      ]));
      offset += local.length + payload.length;
      if (offset > 0xf0000000) throw new Error('Arquivo .zip grande demais');
    }

    let cdSize = 0;
    for (const c of central) { parts.push(c); cdSize += c.length; }
    parts.push(new Uint8Array([
      ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length),
      ...u32(cdSize), ...u32(offset), ...u16(0)
    ]));
    if (opts.onProgress) opts.onProgress(items.length, items.length);
    return new Blob(parts, { type: 'application/zip' });
  }

  root.ArgoZip = { build, _aesCtrWinZip: aesCtrWinZip, _expandKey256: expandKey256, _encryptBlock: encryptBlock, _crc32: crc32 };
})(typeof window !== 'undefined' ? window : globalThis);

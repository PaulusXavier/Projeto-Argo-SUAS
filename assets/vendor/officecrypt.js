/*! officecrypt — senha em documentos, no navegador (sem biblioteca externa, funciona offline).
 *
 *  ArgoOffice.encrypt(bytes, senha)  → Uint8Array
 *     Põe senha de ABRIR em um arquivo do Office (.docx, .xlsx, .pptx) no padrão do próprio Office
 *     ("Agile Encryption", AES-256 + SHA-512, MS-OFFCRYPTO 2.3.4). O Word/Excel/PowerPoint e o LibreOffice pedem a
 *     senha ao abrir. O arquivo sai dentro de um contêiner OLE (MS-CFB), como o Office grava.
 *
 *  ArgoSecret.encrypt(bytes, senha) / ArgoSecret.decrypt(bytes, senha)
 *     Formato próprio do Argo (".argo") para texto e outros arquivos: AES-256-GCM, chave por PBKDF2-SHA256 (600 mil voltas).
 *     Só o Argo SUAS abre (aba Criptografia). Serve para .txt, que não tem senha padrão.
 */
(function (root) {
  'use strict';

  const te = new TextEncoder();
  const concat = (...parts) => {
    let n = 0; for (const p of parts) n += p.length;
    const out = new Uint8Array(n); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const u16 = v => new Uint8Array([v & 255, (v >>> 8) & 255]);
  const u32 = v => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
  const utf16 = s => { const o = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { o[2 * i] = s.charCodeAt(i) & 255; o[2 * i + 1] = s.charCodeAt(i) >> 8; } return o; };
  const rnd = n => crypto.getRandomValues(new Uint8Array(n));
  const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(s); };
  const sha512 = async (...parts) => new Uint8Array(await crypto.subtle.digest('SHA-512', concat(...parts)));
  const tick = () => new Promise(r => setTimeout(r, 0));

  /* ---------------- AES-CBC sem preenchimento (o SubtleCrypto sempre acrescenta um bloco; ele é descartado) ---------------- */
  async function cbcKey(key) { return crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']); }
  async function cbc(cryptoKey, iv, data) {
    const out = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, cryptoKey, data));
    return out.subarray(0, data.length);
  }

  /* ---------------- Agile Encryption ---------------- */
  const BLOCK = {
    verifierInput: Uint8Array.of(0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79),
    verifierValue: Uint8Array.of(0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e),
    keyValue: Uint8Array.of(0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6),
    hmacKey: Uint8Array.of(0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6),
    hmacValue: Uint8Array.of(0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33)
  };

  async function encryptAgile(pkg, password, opts) {
    opts = opts || {};
    const spin = opts.spinCount || 100000;
    const keySalt = rnd(16);       // sal dos dados (keyData)
    const pwSalt = rnd(16);        // sal da senha (keyEncryptor)
    const secret = rnd(32);        // chave que realmente cifra o documento
    const verifier = rnd(16);

    // 1) Hash da senha, com spin voltas
    let h = await sha512(pwSalt, utf16(password));
    const it = new Uint8Array(4), dv = new DataView(it.buffer);
    for (let i = 0; i < spin; i++) {
      dv.setUint32(0, i, true);
      h = await sha512(it, h);
      if (opts.onProgress && i % 10000 === 0) { opts.onProgress(i, spin); await tick(); }
    }
    const derive = async blk => (await sha512(h, blk)).subarray(0, 32);

    const kVerIn = await cbcKey(await derive(BLOCK.verifierInput));
    const kVerVal = await cbcKey(await derive(BLOCK.verifierValue));
    const kKey = await cbcKey(await derive(BLOCK.keyValue));
    const encVerifierInput = await cbc(kVerIn, pwSalt, verifier);
    const encVerifierValue = await cbc(kVerVal, pwSalt, await sha512(verifier));
    const encKeyValue = await cbc(kKey, pwSalt, secret);

    // 2) Documento cifrado em blocos de 4096 bytes
    const pkgKey = await cbcKey(secret);
    const nSeg = Math.ceil(pkg.length / 4096);
    const stream = new Uint8Array(8 + nSeg * 4096);
    new DataView(stream.buffer).setUint32(0, pkg.length >>> 0, true);
    new DataView(stream.buffer).setUint32(4, Math.floor(pkg.length / 4294967296), true);
    let used = 8;
    for (let i = 0; i < nSeg; i++) {
      const iv = (await sha512(keySalt, u32(i))).subarray(0, 16);
      const part = pkg.subarray(i * 4096, Math.min(pkg.length, (i + 1) * 4096));
      const padded = new Uint8Array(Math.ceil(part.length / 16) * 16); padded.set(part);
      const c = await cbc(pkgKey, iv, padded);
      stream.set(c, used); used += c.length;
      if (opts.onProgress && i % 512 === 0) { opts.onProgress(spin, spin, i / nSeg); await tick(); }
    }
    const encryptedPackage = stream.subarray(0, used);

    // 3) Integridade (HMAC-SHA512 do fluxo inteiro)
    const hmacKeyPlain = rnd(64);
    const ivHk = (await sha512(keySalt, BLOCK.hmacKey)).subarray(0, 16);
    const ivHv = (await sha512(keySalt, BLOCK.hmacValue)).subarray(0, 16);
    const encHmacKey = await cbc(pkgKey, ivHk, hmacKeyPlain);
    const hk = await crypto.subtle.importKey('raw', hmacKeyPlain, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', hk, encryptedPackage));
    const encHmacValue = await cbc(pkgKey, ivHv, hmac);

    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password" xmlns:c="http://schemas.microsoft.com/office/2006/keyEncryptor/certificate">' +
      '<keyData saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="' + b64(keySalt) + '"/>' +
      '<dataIntegrity encryptedHmacKey="' + b64(encHmacKey) + '" encryptedHmacValue="' + b64(encHmacValue) + '"/>' +
      '<keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">' +
      '<p:encryptedKey spinCount="' + spin + '" saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="' + b64(pwSalt) +
      '" encryptedVerifierHashInput="' + b64(encVerifierInput) + '" encryptedVerifierHashValue="' + b64(encVerifierValue) + '" encryptedKeyValue="' + b64(encKeyValue) + '"/>' +
      '</keyEncryptor></keyEncryptors></encryption>';
    const encryptionInfo = concat(Uint8Array.of(4, 0, 4, 0, 0x40, 0, 0, 0), te.encode(xml));
    return { encryptionInfo, encryptedPackage };
  }

  /* ---------------- DataSpaces (descrevem como o fluxo foi cifrado; o Office espera encontrá-los) ---------------- */
  const lp4 = s => { const b = utf16(s); const pad = (4 - (b.length % 4)) % 4; return concat(u32(b.length), b, new Uint8Array(pad)); };
  function dataSpaces() {
    const version = concat(lp4('Microsoft.Container.DataSpaces'), u16(1), u16(0), u16(1), u16(0), u16(1), u16(0));
    const entryBody = concat(u32(1), u32(0), lp4('EncryptedPackage'), lp4('StrongEncryptionDataSpace'));
    const map = concat(u32(8), u32(1), u32(entryBody.length + 4), entryBody);
    const info = concat(u32(8), u32(1), lp4('StrongEncryptionTransform'));
    const idPart = concat(u32(1), lp4('{FF9A3F03-56EF-4613-BDD5-5A41C1D07246}'));
    const primary = concat(u32(idPart.length + 4), idPart, lp4('Microsoft.Container.EncryptionTransform'),
      u16(1), u16(0), u16(1), u16(0), u16(1), u16(0), u32(0), u32(0), u32(4), u32(4));
    return { version, map, info, primary };
  }

  /* ---------------- Contêiner OLE / Compound File (versão 3, setores de 512 bytes) ---------------- */
  const SEC = 512, MINI = 64, CUTOFF = 4096, END = 0xfffffffe, FREE = 0xffffffff, FATSEC = 0xfffffffd, DIFSEC = 0xfffffffc, NONE = 0xffffffff;

  // Ordem do CFB: primeiro o nome mais curto; empate, comparação em maiúsculas.
  const cfbCmp = (a, b) => a.name.length - b.name.length || (a.name.toUpperCase() < b.name.toUpperCase() ? -1 : a.name.toUpperCase() > b.name.toUpperCase() ? 1 : 0);

  function buildCfb(rootDir) {
    // rootDir: { children: [{ name, data? , children? }] }
    const entries = [{ name: 'Root Entry', type: 5, children: rootDir.children }];
    function walk(node) {
      node.children.sort(cfbCmp);
      for (const c of node.children) { c.type = c.children ? 1 : 2; c.id = entries.length; entries.push(c); if (c.children) walk(c); }
    }
    entries[0].id = 0; walk(entries[0]);
    // árvore binária balanceada entre irmãos (vermelho só nas folhas do último nível)
    function tree(list, depth, redDepth) {
      if (!list.length) return NONE;
      const m = list.length >> 1, n = list[m];
      n.left = tree(list.slice(0, m), depth + 1, redDepth);
      n.right = tree(list.slice(m + 1), depth + 1, redDepth);
      n.red = redDepth >= 0 && depth === redDepth && n.left === NONE && n.right === NONE;
      return n.id;
    }
    for (const e of entries) {
      if (e.children && e.children.length) {
        const total = e.children.length;
        const perfect = ((total + 1) & total) === 0;
        e.child = tree(e.children.slice(), 0, perfect ? -1 : Math.floor(Math.log2(total)));
      } else e.child = NONE;
      if (e.left === undefined) e.left = NONE;
      if (e.right === undefined) e.right = NONE;
    }

    // fluxos pequenos vão para o "mini stream"
    const streams = entries.filter(e => e.type === 2);
    const miniParts = [], miniFat = [];
    let miniBytes = 0;
    for (const s of streams) {
      s.size = s.data.length;
      if (s.size === 0) { s.start = END; continue; }
      if (s.size < CUTOFF) {
        s.mini = true; s.start = miniFat.length;
        const n = Math.ceil(s.size / MINI);
        for (let i = 0; i < n; i++) miniFat.push(i === n - 1 ? END : miniFat.length + 1);
        const padded = new Uint8Array(n * MINI); padded.set(s.data); miniParts.push(padded); miniBytes += padded.length;
      }
    }
    const miniStream = concat(...miniParts);
    const dirSecs = Math.ceil(entries.length / 4);
    const miniFatSecs = Math.ceil(miniFat.length / 128);
    const miniStreamSecs = Math.ceil(miniStream.length / SEC);
    const bigs = streams.filter(s => s.size && !s.mini);
    const bigSecs = bigs.reduce((a, s) => a + Math.ceil(s.size / SEC), 0);
    const dataSecs = dirSecs + miniFatSecs + miniStreamSecs + bigSecs;
    let fatSecs = 1, difSecs = 0;
    for (;;) {
      const f = Math.ceil((dataSecs + fatSecs + difSecs) / 128);
      const d = f > 109 ? Math.ceil((f - 109) / 127) : 0;
      if (f === fatSecs && d === difSecs) break;
      fatSecs = f; difSecs = d;
    }
    const total = dataSecs + fatSecs + difSecs;
    const fat = new Uint32Array(fatSecs * 128).fill(FREE);
    let next = 0;
    const chain = (count) => { const first = next; for (let i = 0; i < count; i++) { fat[next] = i === count - 1 ? END : next + 1; next++; } return first; };
    const dirStart = chain(dirSecs);
    const miniFatStart = miniFatSecs ? chain(miniFatSecs) : END;
    const miniStart = miniStreamSecs ? chain(miniStreamSecs) : END;
    for (const s of bigs) s.start = chain(Math.ceil(s.size / SEC));
    const fatStart = next;
    for (let i = 0; i < fatSecs; i++) fat[next++] = FATSEC;
    const difStart = difSecs ? next : END;
    for (let i = 0; i < difSecs; i++) fat[next++] = DIFSEC;

    const out = new Uint8Array((total + 1) * SEC);
    const dvo = new DataView(out.buffer);
    out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
    dvo.setUint16(24, 0x3e, true); dvo.setUint16(26, 3, true); dvo.setUint16(28, 0xfffe, true);
    dvo.setUint16(30, 9, true); dvo.setUint16(32, 6, true);
    dvo.setUint32(44, fatSecs, true); dvo.setUint32(48, dirStart, true); dvo.setUint32(56, CUTOFF, true);
    dvo.setUint32(60, miniFatStart, true); dvo.setUint32(64, miniFatSecs, true);
    dvo.setUint32(68, difStart, true); dvo.setUint32(72, difSecs, true);
    for (let i = 0; i < 109; i++) dvo.setUint32(76 + 4 * i, i < fatSecs ? fatStart + i : FREE, true);
    const at = sec => (sec + 1) * SEC;

    // diretório
    entries[0].start = miniStreamSecs ? miniStart : END; entries[0].size = miniStream.length;
    entries.forEach((e, i) => {
      const o = at(dirStart) + i * 128;
      const nm = utf16(e.name);
      out.set(nm, o); dvo.setUint16(o + 64, nm.length + 2, true);
      out[o + 66] = e.type; out[o + 67] = e.red ? 0 : 1;
      dvo.setUint32(o + 68, e.left, true); dvo.setUint32(o + 72, e.right, true); dvo.setUint32(o + 76, e.child, true);
      dvo.setUint32(o + 116, e.start === undefined ? END : e.start, true);
      dvo.setUint32(o + 120, e.size || 0, true);
    });
    for (let i = entries.length; i < dirSecs * 4; i++) { const o = at(dirStart) + i * 128; dvo.setUint32(o + 68, NONE, true); dvo.setUint32(o + 72, NONE, true); dvo.setUint32(o + 76, NONE, true); }
    // mini FAT, mini stream, fluxos grandes, FAT, DIFAT
    for (let i = 0; i < miniFatSecs * 128; i++) dvo.setUint32(at(miniFatStart) + 4 * i, i < miniFat.length ? miniFat[i] : FREE, true);
    if (miniStreamSecs) out.set(miniStream, at(miniStart));
    for (const s of bigs) out.set(s.data, at(s.start));
    for (let i = 0; i < fat.length; i++) dvo.setUint32(at(fatStart) + 4 * i, fat[i], true);
    for (let d = 0; d < difSecs; d++) {
      const o = at(difStart + d);
      for (let i = 0; i < 127; i++) { const k = 109 + d * 127 + i; dvo.setUint32(o + 4 * i, k < fatSecs ? fatStart + k : FREE, true); }
      dvo.setUint32(o + 508, d === difSecs - 1 ? END : difStart + d + 1, true);
    }
    return out;
  }

  async function encrypt(bytes, password, opts) {
    if (!password) throw new Error('Senha vazia');
    const pkg = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (pkg.length < 4 || pkg[0] !== 0x50 || pkg[1] !== 0x4b) throw new Error('Não é um arquivo do Office (.docx, .xlsx, .pptx)');
    const { encryptionInfo, encryptedPackage } = await encryptAgile(pkg, String(password), opts);
    const ds = dataSpaces();
    return buildCfb({ children: [
      { name: 'EncryptionInfo', data: encryptionInfo },
      { name: 'EncryptedPackage', data: encryptedPackage },
      { name: '\u0006DataSpaces', children: [
        { name: 'Version', data: ds.version },
        { name: 'DataSpaceMap', data: ds.map },
        { name: 'DataSpaceInfo', children: [{ name: 'StrongEncryptionDataSpace', data: ds.info }] },
        { name: 'TransformInfo', children: [{ name: 'StrongEncryptionTransform', children: [{ name: '\u0006Primary', data: ds.primary }] }] }
      ] }
    ] });
  }

  /* ---------------- Formato .argo (texto e outros arquivos) ---------------- */
  const MAGIC = te.encode('ARGOENC1');
  const PBKDF2_ROUNDS = 600000;
  async function secretKey(password, salt, usage) {
    const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ROUNDS }, base, { name: 'AES-GCM', length: 256 }, false, [usage]);
  }
  const ArgoSecret = {
    async encrypt(bytes, password) {
      if (!password) throw new Error('Senha vazia');
      const salt = rnd(16), iv = rnd(12);
      const key = await secretKey(password, salt, 'encrypt');
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: MAGIC }, key, bytes));
      return concat(MAGIC, salt, iv, ct);
    },
    async decrypt(bytes, password) {
      const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (b.length < 8 + 16 + 12 + 16 || !MAGIC.every((v, i) => b[i] === v)) throw new Error('Não é um arquivo .argo');
      const key = await secretKey(password, b.subarray(8, 24), 'decrypt');
      try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(24, 36), additionalData: MAGIC }, key, b.subarray(36))); }
      catch (e) { throw new Error('Senha incorreta ou arquivo danificado'); }
    }
  };

  root.ArgoOffice = { encrypt, _buildCfb: buildCfb };
  root.ArgoSecret = ArgoSecret;
})(typeof window !== 'undefined' ? window : globalThis);

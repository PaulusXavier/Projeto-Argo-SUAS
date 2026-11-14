/* =====================================================================
   territorio-cras.js — "Qual CRAS atende este endereço?"

   Parte PURA (sem tela, sem rede) da busca por território: recebe os
   nomes de bairro que o serviço de mapas devolveu para um ponto (ou o
   que a pessoa digitou) e a lista de unidades (UNITS_CRAS_CREAS, em
   js/app.js) e diz qual CRAS/CREAS é a referência. Fica separada do
   app.js para poder ser testada sozinha (npm run test:territorio-cras).

   Regra: o vínculo oficial é BAIRRO -> unidade (campo "bairros" de cada
   unidade). Quando o bairro não é identificado, devolve a unidade mais
   próxima em linha reta, marcada como ESTIMATIVA.

   Usada por app.js: window.ArgoTerritorio
   ===================================================================== */
(function (root) {
  'use strict';

  // Minúsculas, sem acento, só letras/números. "Dr." e "Doutor" viram "dr";
  // "Nossa Senhora"/"N. Sra." viram "ns" para o OpenStreetMap casar com a lista oficial.
  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(doutor|doutora|dr|dra)\b/g, 'dr')
      .replace(/\b(nossa senhora|n sra|nsra|nsa senhora)\b/g, 'ns')
      .replace(/\b(de|da|do|das|dos|e)\b/g, ' ')
      .replace(/^bairro /, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Unidades que não entram na busca por bairro: o campo "bairros" delas descreve público/zona, não bairros.
  function ehItinerante(u) { return /itinerante/i.test(u && u.name || ''); }
  function ehAbrigo(u) { return /^abrigo/i.test(u && u.name || ''); }

  // Índice: bairro normalizado -> { label, units: [{kind, i}] }. Com 'so', indexa só esse tipo ('cras'/'creas').
  function indexar(units, so) {
    const idx = new Map();
    ['cras', 'creas'].forEach(kind => {
      if (so && so !== kind) return;
      (units[kind] || []).forEach((u, i) => {
        if (ehAbrigo(u) || ehItinerante(u)) return;
        String(u.bairros || '').split(',').map(x => x.trim()).filter(Boolean).forEach(b => {
          const k = norm(b);
          if (!k) return;
          if (!idx.has(k)) idx.set(k, { label: b, units: [] });
          const e = idx.get(k);
          if (!e.units.some(x => x.kind === kind && x.i === i)) e.units.push({ kind, i });
        });
      });
    });
    return idx;
  }

  function contemPalavras(maior, menor) { return (' ' + maior + ' ').indexOf(' ' + menor + ' ') > -1; }

  // Procura, nos candidatos (do mais confiável ao menos), um bairro da lista oficial.
  // 1) igualdade exata; 2) um contém o outro por palavras inteiras (ex.: "salomao" em "said salomao").
  // Devolve { key, label, exato } ou null.
  function acharBairro(candidatos, idx) {
    const lista = (candidatos || []).map(norm).filter(c => c && c.length >= 3);
    for (const c of lista) if (idx.has(c)) return { key: c, label: idx.get(c).label, exato: true };
    for (const c of lista) {
      let melhor = null;
      idx.forEach((e, k) => {
        if (k.length < 5 || c.length < 5) return;
        if (contemPalavras(c, k) || contemPalavras(k, c)) {
          if (!melhor || k.length > melhor.key.length) melhor = { key: k, label: e.label, exato: false };
        }
      });
      if (melhor) return melhor;
    }
    return null;
  }

  function km(lat1, lon1, lat2, lon2) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Unidade mais próxima em linha reta (sem Itinerante nem abrigo). { i, km } ou null.
  function maisProximo(lat, lon, units, kind) {
    if (!isFinite(lat) || !isFinite(lon)) return null;
    let melhor = null;
    (units[kind] || []).forEach((u, i) => {
      if (ehAbrigo(u) || ehItinerante(u) || !isFinite(u.lat) || !isFinite(u.lng)) return;
      const d = km(lat, lon, u.lat, u.lng);
      if (!melhor || d < melhor.km) melhor = { i, km: d };
    });
    return melhor;
  }

  // Texto que fala de zona rural / comunidade indígena: quem atende é o CRAS Itinerante.
  function pedeItinerante(texto) {
    const t = norm(texto);
    return /\b(zona rural|area rural|comunidade indigena|comunidades indigenas|terra indigena|aldeia|indigena)\b/.test(t);
  }

  // Junta tudo.
  //  entrada: { candidatos: [texto,...], lat, lon, textoLivre }
  //  devolve: { bairro: {key,label,exato}|null, itinerante: idx|-1,
  //             cras: [{i, modo:'bairro'|'estimativa', km?}], creas: [...] }
  function resolver(entrada, units) {
    const cands = entrada.candidatos || [];
    const out = { bairro: null, itinerante: -1, cras: [], creas: [] };

    if (pedeItinerante(cands.concat(entrada.textoLivre || '').join(' '))) {
      out.itinerante = (units.cras || []).findIndex(ehItinerante);
    }
    const temPonto = isFinite(entrada.lat) && isFinite(entrada.lon);
    // Cada tipo procura no próprio índice: o mesmo bairro pode estar escrito diferente nas listas
    // do CRAS e do CREAS (ex.: "Said Salomão" x "Salomão").
    ['cras', 'creas'].forEach(kind => {
      const idx = indexar(units, kind);
      const b = acharBairro(cands, idx);
      if (b && (!out.bairro || (b.exato && !out.bairro.exato))) out.bairro = b;
      if (b) {
        idx.get(b.key).units.forEach(u => {
          const un = units[kind][u.i];
          out[kind].push({ i: u.i, modo: 'bairro', km: temPonto ? km(entrada.lat, entrada.lon, un.lat, un.lng) : null });
        });
      } else {
        const p = maisProximo(entrada.lat, entrada.lon, units, kind);
        if (p) out[kind].push({ i: p.i, modo: 'estimativa', km: p.km });
      }
    });
    return out;
  }

  root.ArgoTerritorio = { norm, indexar, acharBairro, maisProximo, pedeItinerante, resolver, km };
})(typeof window !== 'undefined' ? window : this);

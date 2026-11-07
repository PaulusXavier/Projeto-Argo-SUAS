/* Argo SUAS — Corretor ortográfico (js/corretor.js)
   Mesmo corretor do Verbus, adaptado para os campos de texto do Argo (textarea e input de texto):
   • dicionário de português do Brasil (Hunspell + VERO/LibreOffice) em Web Worker, 100% offline depois da 1ª vez
     (arquivos em assets/spell/; ficam no Cache API do navegador);
   • sublinhado ondulado vermelho (ortografia) e azul duplo (estilo/pontuação) enquanto digita;
   • clique direito (ou toque na palavra, no celular) abre sugestões, "Ignorar" e "Adicionar ao dicionário";
   • autocorreção ao digitar: acentos esquecidos e letra maiúscula depois do ponto final (Ctrl+Z desfaz).
   Vale para todo textarea (e input de texto com spellcheck="true") que não tenha spellcheck="false".
   Preferências: argo_corretor (ligado/desligado), argo_corretor_auto (autocorreção), argo_corretor_dic (palavras suas).
   Este arquivo é independente do app.js: não usa variáveis dele e só observa o documento. */
(() => {
  'use strict';
  if (window.ArgoCorretor) return;
  if (!window.Worker || !window.CSS || !String.prototype.normalize) return;

  const LS = { on: 'argo_corretor', auto: 'argo_corretor_auto', dic: 'argo_corretor_dic' };
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  let ligado = lsGet(LS.on) !== '0';
  let autoOn = lsGet(LS.auto) !== '0';
  const userDic = () => { try { return JSON.parse(lsGet(LS.dic) || '[]'); } catch (e) { return []; } };

  // Termos do trabalho no SUAS que o dicionário geral não traz (além do que o usuário adicionar)
  const DIC_EXTRA = ('condicionalidade condicionalidades socioassistencial socioassistenciais socioeducativo socioeducativa socioeducativos socioeducativas ' +
    'intersetorial intersetoriais intersetorialidade pix emoji emojis podcast podcasts selfie selfies online offline smartphone smartphones wifi whatsapp ' +
    'instagram wi-fi app apps gov genograma genogramas ecomapa ecomapas déficit déficits psicoeducação matriciamento socioemocional socioemocionais ' +
    'neurodivergente neurodivergentes neurodivergência cisgênero heteroagressividade intrafamiliar intrafamiliares transgeracional transgeracionais ' +
    'contrarreferência contrarreferências referenciamento vulnerabilização revitimização parentalidade coparentalidade homoparental homoparentais cadúnico ' +
    'sociofamiliar sociofamiliares socioterritorial socioterritoriais psicossocial psicossociais biopsicossocial biopsicossociais territorialização ' +
    'socioassistenciais protetiva protetivas tipificação acolhimento visitação articulador articuladora paif paefi scfv cras creas caps bpc loas suas ' +
    'cadunico bolsa-família venezuelano venezuelanos venezuelana venezuelanas pbf nis cpf rg').split(' ');

  // Somente formas que não existem sem acento (evita falsos alertas como "esta/está", "pais/país")
  const ACENTOS = { nao: 'não', voce: 'você', voces: 'vocês', tambem: 'também', entao: 'então', ate: 'até', porem: 'porém', alem: 'além', atraves: 'através', tres: 'três', mes: 'mês', apos: 'após', ninguem: 'ninguém', alguem: 'alguém', estao: 'estão', irao: 'irão', familias: 'famílias', saude: 'saúde', beneficio: 'benefício', beneficios: 'benefícios', servico: 'serviço', servicos: 'serviços', orgao: 'órgão', orgaos: 'órgãos', relatorio: 'relatório', relatorios: 'relatórios', psicologica: 'psicológica', psicologico: 'psicológico', assistencia: 'assistência', experiencia: 'experiência', diferenca: 'diferença', necessario: 'necessário', necessaria: 'necessária', obrigatorio: 'obrigatório', basico: 'básico', basica: 'básica', juridico: 'jurídico', juridica: 'jurídica', numeros: 'números', unico: 'único', unica: 'única', facil: 'fácil', dificil: 'difícil', possivel: 'possível', responsavel: 'responsável', vulneravel: 'vulnerável', ola: 'olá' };
  const matchCase = (orig, rep) => {
    if (orig.length > 1 && orig === orig.toUpperCase()) return rep.toUpperCase();
    if (orig[0] !== orig[0].toLowerCase()) return rep[0].toUpperCase() + rep.slice(1);
    return rep;
  };
  const strip = x => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const spIgnore = new Set();   // "Ignorar tudo" (vale até recarregar a página)

  // ---------- Dicionário (Web Worker) ----------
  let aoAtualizar = () => {};
  function proxy(w) {
    const res = new Map(), want = new Map(), sent = new Set(); let tm = 0;
    const flush = () => {
      tm = 0; const plain = [], withSug = [];
      want.forEach((ns, x) => { if (!sent.has(x)) (ns ? withSug : plain).push(x); });
      want.clear();
      [plain, withSug].forEach((words, i) => { if (!words.length) return; words.forEach(x => sent.add(x)); w.postMessage({ t: 'check', words, sug: !!i }); });
    };
    w.onmessage = ev => {
      const m = ev.data;
      if (m.t === 'res') { m.out.forEach(([x, ok, sug]) => { res.set(x, { ok, sug }); sent.delete(x); }); aoAtualizar(); }
      else if (m.t === 'sug') { const r = res.get(m.w); if (r) { r.sug = m.sug; aoAtualizar(m.w); } }
    };
    return {
      look(x, ns) {   // undefined = o Worker ainda não respondeu (a conferência é refeita quando chegar)
        const r = res.get(x);
        if (r && (r.ok || !ns || r.sug)) return r.ok;
        if (!want.has(x) || ns) want.set(x, !!ns);
        if (!tm) tm = setTimeout(flush, 25);
        return r && r.ok;
      },
      correct(x) { const r = res.get(x); if (r) return r.ok; this.look(x); return !ACENTOS[x.toLowerCase()]; },
      suggest(x) { const r = res.get(x); return (r && r.sug) || []; },
      add(x) { res.set(x, { ok: true, sug: null }); w.postMessage({ t: 'add', w: x }); }
    };
  }
  let carga = null, pronto = null;
  function carregar() {
    if (carga) return carga;
    carga = new Promise((ok, no) => {
      let w; try { w = new Worker('assets/spell/spell-worker.js', { type: 'module' }); } catch (e) { return no(e); }
      const fim = setTimeout(() => { try { w.terminate(); } catch (_) {} no(new Error('o dicionário demorou')); }, 90000);
      w.onerror = () => { clearTimeout(fim); try { w.terminate(); } catch (_) {} no(new Error('worker')); };
      w.onmessage = ev => {
        if (ev.data.t === 'ready') { clearTimeout(fim); ok(proxy(w)); }
        else if (ev.data.t === 'fail') { clearTimeout(fim); try { w.terminate(); } catch (_) {} no(new Error(ev.data.e)); }
      };
      w.postMessage({ t: 'init', extra: DIC_EXTRA.concat(userDic()) });
    }).then(sp => { pronto = sp; return sp; }, e => { console.warn('Corretor: dicionário indisponível; fica o corretor do navegador.', e); carga = null; throw e; });
    return carga;
  }

  // ---------- Análise do texto ----------
  const RX_PALAVRA = /(?<![\p{L}\p{N}@\/._-])\p{L}+(?:-\p{L}+)*(?![\p{L}\p{N}@\/_]|\.\p{L})/gu;
  function ortografia(t, sp, sugestoes) {
    const out = []; let m; RX_PALAVRA.lastIndex = 0;
    while ((m = RX_PALAVRA.exec(t))) {
      const w = m[0];
      if (w.length < 2 || w === w.toUpperCase() || spIgnore.has(w)) continue;                        // siglas
      if (w[0] !== w[0].toLowerCase() && !/(^|[.!?…:]\s+|\n\s*)$/.test(t.slice(0, m.index))) continue;  // nomes próprios no meio da frase
      const ok = sp.look(w, sugestoes);
      if (ok === undefined || ok) continue;                                                            // ainda esperando o Worker (refaz quando chegar) ou palavra correta
      const sug = sugestoes ? sp.suggest(w).slice(0, 5).sort((a, b) => (strip(b) === strip(w)) - (strip(a) === strip(w))).slice(0, 4) : [];
      out.push({ start: m.index, len: w.length, kind: 'orto', text: w, sug, label: 'Ortografia: “' + w + '”' });
    }
    return out;
  }
  const tokenEm = (t, i) => t.slice(Math.max(0, t.lastIndexOf(' ', i) + 1), t.indexOf(' ', i) < 0 ? t.length : t.indexOf(' ', i));
  function gramatica(t) {   // erros comuns de digitação e pontuação
    const found = [], add = (kind, start, len, rep, label) => found.push({ kind, start, len, rep, label, text: t.substr(start, len), sug: [] });
    let m, rx;
    rx = /(^|[^\p{L}\p{N}])(\p{L}{2,})([ \t]+)\2(?![\p{L}\p{N}])/giu;                 // palavra repetida
    while ((m = rx.exec(t))) { const w = m[2]; if (/^(\p{Lu}+|\d+)$/u.test(w)) continue; add('rep', m.index + m[1].length, w.length * 2 + m[3].length, w, 'Palavra repetida'); rx.lastIndex = m.index + m[0].length - w.length; }
    rx = /(?<=\S) {2,}(?=\S)/g;                                                          // espaços duplos
    while ((m = rx.exec(t))) add('sp', m.index, m[0].length, ' ', 'Espaço duplo');
    rx = /(?<=[\p{L}\p{N})\]”"]) +(?=[,;:!?](?![.!?]))/gu;                               // espaço antes da pontuação
    while ((m = rx.exec(t))) { if (/\d$/.test(t.slice(0, m.index)) && t[m.index + m[0].length] === ':') continue; add('pre', m.index, m[0].length, '', 'Espaço antes de pontuação'); }
    rx = /(?<=\p{L}{2})([,;:!?])(?=\p{L})/gu;                                            // sem espaço depois
    while ((m = rx.exec(t))) { if (/[@\/]|https?:/.test(tokenEm(t, m.index))) continue; add('after', m.index, 1, m[1] + ' ', 'Falta espaço depois de “' + m[1] + '”'); }
    rx = /(?<=\p{Ll}{3})\.(?=\p{Lu}\p{Ll})/gu;
    while ((m = rx.exec(t))) { if (/[@\/]|https?:|www\./i.test(tokenEm(t, m.index))) continue; add('after', m.index, 1, '. ', 'Falta espaço depois do ponto'); }
    return found;
  }

  // ---------- Campos de texto: camada com o sublinhado por cima do campo ----------
  const estados = new WeakMap(), ativos = new Set();
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ehTexto = el => el && ((el.tagName === 'TEXTAREA') || (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'search')));
  function elegivel(el) {
    if (!ehTexto(el) || el.readOnly || el.disabled) return false;
    if (estados.has(el)) return true;
    const sc = el.getAttribute('spellcheck');
    if (el.tagName === 'INPUT' ? sc !== 'true' : sc === 'false') return false;
    if (el.lang && !/^pt/i.test(el.lang)) return false;
    if (el.id === 'tradutorInput') { const d = document.getElementById('tradutorFrom'); if (d && d.value && d.value !== 'pt') return false; }   // texto de origem em outro idioma
    return !el.closest('[data-sem-corretor]');
  }
  function criar(el) {
    let st = estados.get(el); if (st) return st;
    const m = document.createElement('div');
    m.className = 'ac-mirror'; m.setAttribute('aria-hidden', 'true');
    el.after(m);
    st = { el, m, itens: [], ign: new Set(), orig: el.spellcheck, texto: null, qtd: -1, sx: 0, sy: 0, key: '' };
    estados.set(el, st); ativos.add(el);
    if (window.ResizeObserver) { st.ro = new ResizeObserver(() => posicionar(st)); st.ro.observe(el); }
    return st;
  }
  function posicionar(st) {
    const el = st.el, m = st.m;
    if (!el.isConnected) { descartar(st); return; }
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') { m.style.display = 'none'; return; }
    const cs = getComputedStyle(el);
    const key = [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight, el.clientWidth, cs.font, cs.letterSpacing, cs.padding, cs.borderWidth, cs.textAlign, cs.lineHeight, cs.textIndent, cs.wordSpacing, cs.direction].join('|');
    if (key === st.key && m.style.display !== 'none') return;
    st.key = key;
    const bl = parseFloat(cs.borderLeftWidth) || 0, br = parseFloat(cs.borderRightWidth) || 0;
    const sb = el.tagName === 'TEXTAREA' ? Math.max(0, el.offsetWidth - el.clientWidth - bl - br) : 0;   // barra de rolagem
    const s = m.style;
    s.display = ''; s.left = el.offsetLeft + 'px'; s.top = el.offsetTop + 'px'; s.width = el.offsetWidth + 'px'; s.height = el.offsetHeight + 'px';
    s.font = cs.font; s.letterSpacing = cs.letterSpacing; s.wordSpacing = cs.wordSpacing; s.textAlign = cs.textAlign; s.textIndent = cs.textIndent; s.lineHeight = cs.lineHeight; s.direction = cs.direction; s.textTransform = cs.textTransform;
    s.padding = cs.paddingTop + ' ' + (parseFloat(cs.paddingRight) + sb) + 'px ' + cs.paddingBottom + ' ' + cs.paddingLeft;
    s.borderWidth = cs.borderTopWidth + ' ' + cs.borderRightWidth + ' ' + cs.borderBottomWidth + ' ' + cs.borderLeftWidth;
    s.borderRadius = cs.borderRadius;
    m.dataset.single = el.tagName === 'INPUT' ? '1' : '';
    sincRolagem(st);
  }
  function sincRolagem(st) { st.m.scrollTop = st.el.scrollTop; st.m.scrollLeft = st.el.scrollLeft; }
  function descartar(st) {
    ativos.delete(st.el); if (st.ro) st.ro.disconnect(); st.m.remove(); estados.delete(st.el);
  }

  function analisar(st) {
    const el = st.el, t = el.value;
    let itens = [];
    if (ligado && pronto) {
      const foco = document.activeElement === el && el.selectionStart === el.selectionEnd ? el.selectionStart : -1;   // palavra que ainda está sendo digitada não é marcada
      const sp = pronto;
      itens = ortografia(t, sp, false).concat(gramatica(t))
        .filter(o => !(foco >= o.start && foco <= o.start + o.len && o.kind === 'orto') && !(st.ign.has(o.text) && o.kind === 'orto'))
        .sort((a, b) => a.start - b.start || (a.kind === 'orto' ? -1 : 1));
      const livres = []; let fim = 0;                          // sem sobreposição (a ortografia tem prioridade)
      itens.forEach(o => { if (o.start >= fim) { livres.push(o); fim = o.start + o.len; } });
      itens = livres;
    }
    st.itens = itens;
    const sig = itens.map(o => o.start + ':' + o.len + o.kind).join(',') + '|' + t.length;
    if (st.texto !== t || st.sig !== sig) {
      st.texto = t; st.sig = sig;
      let html = '', pos = 0;
      itens.forEach((o, i) => {
        html += esc(t.slice(pos, o.start)) + '<span class="ac-' + (o.kind === 'orto' ? 's' : 'g') + '" data-k="' + i + '">' + esc(t.slice(o.start, o.start + o.len)) + '</span>';
        pos = o.start + o.len;
      });
      html += esc(t.slice(pos));
      st.m.innerHTML = html + (t.endsWith('\n') ? '​' : '');
    }
    posicionar(st); sincRolagem(st); chipAtualiza(st);
  }
  const fila = new Set(); let raf = 0;
  function agendar(el) { fila.add(el); if (!raf) raf = requestAnimationFrame(() => { raf = 0; const l = [...fila]; fila.clear(); l.forEach(e => { const s = estados.get(e); if (s) analisar(s); }); }); }
  aoAtualizar = (palavra) => {   // o Worker respondeu: refaz os campos e o menu aberto
    ativos.forEach(e => { if (!e.isConnected) { const s = estados.get(e); if (s) descartar(s); } else agendar(e); });
    if (menu && palavra && menu.dataset.w === palavra && menuCtx) abrirMenu(menuCtx.st, menuCtx.o, menuCtx.x, menuCtx.y, true);
  };

  function nativo(st, usarNativo) { try { st.el.spellcheck = usarNativo ? st.orig : false; } catch (e) {} }
  async function anexar(el) {
    if (!elegivel(el)) return;
    const st = criar(el);
    analisar(st);
    if (!ligado) { nativo(st, true); return; }
    if (pronto) { nativo(st, false); analisar(st); return; }
    try { await carregar(); } catch (e) { return; }   // sem dicionário: continua o corretor do navegador
    ativos.forEach(x => { const s = estados.get(x); if (s) { if (ligado) nativo(s, false); analisar(s); } });
  }

  // ---------- Indicador (como o ícone de revisão do Word) ----------
  let chip = null, chipSt = null;
  function chipCriar() {
    chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'ac-chip'; chip.setAttribute('aria-live', 'polite');
    chip.addEventListener('mousedown', e => e.preventDefault());
    chip.addEventListener('click', () => {
      if (!chipSt) return;
      if (!ligado) { definir(true); return; }
      irProximo(chipSt);
    });
    document.body.appendChild(chip);
  }
  function chipAtualiza(st) {
    if (document.activeElement !== st.el) return;
    if (!chip) chipCriar();
    chipSt = st;
    const r = st.el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) { chip.style.display = 'none'; return; }
    const n = st.itens.length;
    chip.style.display = '';
    chip.style.left = Math.max(4, Math.min(innerWidth - 30, r.right - 30)) + 'px';
    chip.style.top = Math.max(4, Math.min(innerHeight - 30, r.bottom - 28 - (st.el.tagName === 'TEXTAREA' ? 14 : 0))) + 'px';
    chip.dataset.s = !ligado ? 'off' : !pronto ? 'load' : n ? 'err' : 'ok';
    chip.textContent = !ligado ? 'ABC' : !pronto ? '…' : n ? String(n > 99 ? '99+' : n) : '✓';
    chip.title = !ligado ? 'Corretor desligado — clique para ligar'
      : !pronto ? 'Carregando o dicionário de português…'
      : n ? n + ' ponto(s) para revisar — clique para ir ao próximo' : 'Nenhum erro encontrado neste campo';
    chip.setAttribute('aria-label', chip.title);
  }
  function chipEsconde() { if (chip) chip.style.display = 'none'; }

  // ---------- Correção e navegação ----------
  function aplicar(st, o, txt) {
    const el = st.el; el.focus();
    el.setSelectionRange(o.start, o.start + o.len);
    let ok = false;
    try { ok = document.execCommand('insertText', false, txt); } catch (e) {}
    if (!ok || el.value.slice(o.start, o.start + txt.length) !== txt) {
      el.setRangeText(txt, o.start, o.start + o.len, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    agendar(el);
  }
  function irProximo(st) {
    analisar(st);
    if (!st.itens.length) return;
    const el = st.el, cur = el.selectionEnd || 0;
    const o = st.itens.find(x => x.start >= cur) || st.itens[0];
    el.focus(); el.setSelectionRange(o.start, o.start + o.len);
    const i = st.itens.indexOf(o), sp = st.m.querySelector('[data-k="' + i + '"]');
    if (sp && el.tagName === 'TEXTAREA') el.scrollTop = Math.max(0, sp.offsetTop - el.clientHeight / 2);
    sincRolagem(st);
    const r = (sp || el).getBoundingClientRect();
    abrirMenu(st, o, r.left, r.bottom + 4);
  }
  function itemEm(st, x, y) {   // palavra marcada sob o ponteiro (a camada fica com pointer-events:none; liga só por um instante)
    const m = st.m; m.style.pointerEvents = 'auto';
    const lista = document.elementsFromPoint(x, y); m.style.pointerEvents = '';
    const s = lista.find(e => e.dataset && e.dataset.k !== undefined && m.contains(e));
    return s ? st.itens[+s.dataset.k] : null;
  }

  // ---------- Menu de sugestões ----------
  let menu = null, menuCtx = null;
  function fecharMenu() { if (menu) { menu.remove(); menu = null; menuCtx = null; } }
  function abrirMenu(st, o, x, y, refresh) {
    fecharMenu();
    const mn = document.createElement('div');
    mn.className = 'ac-menu'; mn.setAttribute('role', 'menu'); mn.dataset.w = o.text;
    const add = (txt, fn, cls) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ac-it' + (cls ? ' ' + cls : ''); b.textContent = txt; b.setAttribute('role', 'menuitem');
      if (!fn) b.disabled = true; else b.addEventListener('click', () => { fecharMenu(); fn(); });
      mn.appendChild(b);
    };
    const sep = () => { const d = document.createElement('div'); d.className = 'ac-sep'; mn.appendChild(d); };
    if (o.kind === 'orto') {
      const sg = pronto ? pronto.suggest(o.text).slice(0, 5).sort((a, b) => (strip(b) === strip(o.text)) - (strip(a) === strip(o.text))).slice(0, 4) : [];
      if (!sg.length) { if (pronto) pronto.look(o.text, true); add(pronto && pronto.suggest(o.text).length === 0 ? 'Sem sugestões' : 'Procurando sugestões…', null, 'ac-dis'); }
      sg.forEach(s => add(s, () => aplicar(st, o, s), 'ac-b'));
      sep();
      add('Ignorar neste campo', () => { st.ign.add(o.text); agendar(st.el); });
      add('Ignorar tudo', () => { spIgnore.add(o.text); ativos.forEach(agendar); });
      add('Adicionar ao dicionário', () => {
        lsSet(LS.dic, JSON.stringify([...new Set(userDic().concat(o.text))]));
        if (pronto) pronto.add(o.text); ativos.forEach(agendar);
      });
    } else {
      add(o.label, null, 'ac-dis');
      add(o.rep === '' ? 'Excluir' : o.kind === 'after' ? 'Inserir espaço' : '“' + o.rep.trim() + '”', () => aplicar(st, o, o.rep), 'ac-b');
    }
    sep();
    add(autoOn ? 'Desligar autocorreção ao digitar' : 'Ligar autocorreção ao digitar', () => { autoOn = !autoOn; lsSet(LS.auto, autoOn ? '1' : '0'); });
    add('Desligar o corretor', () => definir(false));
    document.body.appendChild(mn);
    const w = mn.offsetWidth, h = mn.offsetHeight;
    mn.style.left = Math.max(6, Math.min(x, innerWidth - w - 6)) + 'px';
    mn.style.top = Math.max(6, (y + h > innerHeight - 6 ? y - h - 8 : y)) + 'px';
    menu = mn; menuCtx = { st, o, x, y };
    if (!refresh) { const f = mn.querySelector('.ac-it:not([disabled])'); if (f) f.focus({ preventScroll: true }); }
  }
  document.addEventListener('pointerdown', e => { if (menu && !menu.contains(e.target)) fecharMenu(); }, true);
  document.addEventListener('keydown', e => {
    if (!menu) return;
    if (e.key === 'Escape') { const el = menuCtx && menuCtx.st.el; fecharMenu(); if (el) el.focus(); e.preventDefault(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const bs = [...menu.querySelectorAll('.ac-it:not([disabled])')]; if (!bs.length) return;
      const i = bs.indexOf(document.activeElement), d = e.key === 'ArrowDown' ? 1 : -1;
      bs[(i + d + bs.length) % bs.length].focus(); e.preventDefault();
    }
  }, true);
  window.addEventListener('resize', fecharMenu);
  document.addEventListener('scroll', e => {
    if (menu && !menu.contains(e.target)) fecharMenu();
    const st = e.target && e.target.nodeType === 1 && estados.get(e.target);
    if (st) sincRolagem(st);
    if (chipSt && document.activeElement === chipSt.el) chipAtualiza(chipSt);
  }, true);

  // ---------- Ligar / desligar ----------
  function definir(on) {
    ligado = !!on; lsSet(LS.on, ligado ? '1' : '0');
    fecharMenu();
    if (!ligado) ativos.forEach(e => { const s = estados.get(e); if (s) { nativo(s, true); analisar(s); } });
    else { const a = document.activeElement; if (elegivel(a)) anexar(a); ativos.forEach(e => { const s = estados.get(e); if (s) { if (pronto) nativo(s, false); analisar(s); } }); }
    if (chipSt) chipAtualiza(chipSt);
  }

  // ---------- Eventos do documento ----------
  document.addEventListener('focusin', e => { if (elegivel(e.target)) anexar(e.target); }, true);
  document.addEventListener('focusout', e => {
    const st = estados.get(e.target);
    if (st) { agendar(st.el); setTimeout(() => { if (!ehTexto(document.activeElement) && document.activeElement !== chip) chipEsconde(); }, 150); }
  }, true);
  document.addEventListener('input', e => {
    const st = estados.get(e.target); if (!st) return;
    st.m.scrollTop = e.target.scrollTop; analisar(st);
    autocorrigir(e, st);
  }, true);
  ['keyup', 'click'].forEach(ev => document.addEventListener(ev, e => { const st = estados.get(e.target); if (st) agendar(st.el); }, true));
  window.addEventListener('resize', () => ativos.forEach(e => { const s = estados.get(e); if (s) { s.key = ''; agendar(e); } }));
  setInterval(() => { ativos.forEach(e => { const s = estados.get(e); if (!s) return; if (!e.isConnected) descartar(s); else posicionar(s); }); }, 700);   // o campo pode mudar de lugar sem mudar de tamanho

  document.addEventListener('contextmenu', e => {
    const st = estados.get(e.target); if (!st || !ligado || !pronto) return;
    const o = itemEm(st, e.clientX, e.clientY);
    if (!o) return;
    e.preventDefault(); abrirMenu(st, o, e.clientX, e.clientY);
  }, true);
  const toque = window.matchMedia && matchMedia('(pointer: coarse)');
  document.addEventListener('click', e => {   // no celular: tocar numa palavra marcada abre as sugestões
    const st = estados.get(e.target); if (!st || !ligado || !pronto || !(toque && toque.matches) || !e.detail) return;
    const o = itemEm(st, e.clientX, e.clientY);
    if (o) abrirMenu(st, o, e.clientX, e.clientY + 8);
  }, true);

  // ---------- Autocorreção ao digitar (como no Word): acentos esquecidos e maiúscula depois do ponto final ----------
  const ABREV = new Set('etc ex pág págs sr sra srs dr dra av tel obs art arts inc ltda cia prof profa cap fig vol ed org aprox nº resp dpto depto'.split(' '));
  function autoRep(w) {
    if (!pronto || pronto.correct(w)) return null;
    const lw = w.toLowerCase(); let r = ACENTOS[lw];
    if (!r && /[^c]cao$/.test(lw) && lw.length > 4) r = lw.replace(/cao$/, 'ção');
    if (!r && /coes$/.test(lw) && lw.length > 5) r = lw.replace(/coes$/, 'ções');
    return r ? matchCase(w, r) : null;
  }
  function autocorrigir(e, st) {
    const el = st.el;
    if (!ligado || !autoOn || !pronto || e.inputType !== 'insertText' || !e.data || e.data.length !== 1 || e.isComposing || !/[\s.,;:!?)\]”"]/.test(e.data)) return;
    if (el.selectionStart !== el.selectionEnd) return;
    const off = el.selectionStart, before = el.value.slice(0, off - 1), m = /\p{L}+$/u.exec(before); if (!m) return;
    const w = m[0], pre = before.slice(0, m.index);
    if (/[\p{N}@\/._-]$/u.test(pre)) return;
    let r = autoRep(w) || w;
    if (r[0] !== r[0].toUpperCase()) {
      const c = /(\p{L}*)[.!?…]\s+$/u.exec(pre);
      if (c && c[1].length > 1 && !ABREV.has(c[1].toLowerCase())) r = r[0].toUpperCase() + r.slice(1);
    }
    if (r === w) return;
    el.setSelectionRange(m.index, off);
    let ok = false; try { ok = document.execCommand('insertText', false, r + e.data); } catch (_) {}
    if (!ok) { el.setRangeText(r + e.data, m.index, off, 'end'); el.dispatchEvent(new Event('input', { bubbles: true })); }
  }

  // ---------- Campos que já estão na tela com texto (sem precisar clicar) ----------
  let varre = 0;
  function varrer() {
    varre = 0;
    if (!ligado || !pronto) return;
    document.querySelectorAll('textarea, input[spellcheck="true"]').forEach(el => {
      if (estados.has(el) || !el.value || !elegivel(el) || el.offsetParent === null) return;
      const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
      const st = criar(el); nativo(st, false); analisar(st);
    });
  }
  new MutationObserver(() => { if (!varre) varre = setTimeout(varrer, 400); }).observe(document.documentElement, { childList: true, subtree: true });

  window.ArgoCorretor = { ligar: () => definir(true), desligar: () => definir(false), estaLigado: () => ligado, revisar: el => { const st = estados.get(el); if (st) irProximo(st); } };
})();

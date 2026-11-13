/* =====================================================================
   grafia-link.js — liga o Grafia (bloco de notas) à Agenda Argo.

   O que faz: depois de entrar uma vez com o e-mail e a senha do Grafia
   (botão 📝 da agenda), as notas do Grafia aparecem nos dias do
   calendário (pela DATA da nota). Tocar numa delas abre o texto e há um
   botão para abrir a mesma nota dentro do Grafia.

   Como funciona: o Argo abre uma segunda conexão Firebase (nome "grafia")
   no projeto do Grafia, entra com Firebase Auth e LÊ users/{uid}/notes.
   Só leitura: o Argo nunca altera nem apaga notas do Grafia.

   Privacidade: as notas ficam só na memória da página. Nada é gravado no
   localStorage do Argo, e tudo some da memória quando o app é trancado.
   Funções globais usadas por app.js: grafiaDecorateGrid, grafiaRenderDayBox,
   grafiaOnLock, grafiaOpenPanel.
   ===================================================================== */
(function () {
  'use strict';

  // Projeto Firebase do Grafia ("bloco-notas-paulo-xavier"), o mesmo do firebase-config.js do Grafia.
  const GRAFIA_FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBpYDEdA7ydmNLHA3vPyfyO1uKxHkD8t-c',
    authDomain: 'bloco-notas-paulo-xavier.firebaseapp.com',
    projectId: 'bloco-notas-paulo-xavier',
    storageBucket: 'bloco-notas-paulo-xavier.firebasestorage.app',
    messagingSenderId: '407045081673',
    appId: '1:407045081673:web:5c4a65aab30a0058130d98'
  };
  // Endereço publicado do Grafia (se o repositório mudar de nome, troque aqui).
  const GRAFIA_URL = 'https://paulusxavier.github.io/Bloco-de-Notas-PX-/';
  const AUTH_CDN = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js';
  const FLAG = 'argo_grafia_linked';   // só lembra "já conectei"; não guarda nota nem senha

  let app = null, auth = null, db = null;
  let unsubNotes = null, unsubAuth = null;
  let starting = null;
  let user = null;
  let byDay = {};          // 'AAAA-MM-DD' -> [nota]
  let byId = {};
  let total = 0;
  let state = 'off';       // off | connecting | ok | error
  let lastFocus = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const unlocked = () => typeof sessionEncKey !== 'undefined' && !!sessionEncKey;
  const wasLinked = () => { try { return localStorage.getItem(FLAG) === '1'; } catch (e) { return false; } };
  const setLinked = (on) => { try { if (on) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG); } catch (e) { /* sem armazenamento */ } };

  function noteText(n) {
    if (Array.isArray(n.pages) && n.pages.length) return n.pages.join('\n');
    return n.content || '';
  }
  function fmtDate(iso) {
    const p = String(iso || '').split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : '';
  }
  function createdMs(n) { return (n.createdAt && n.createdAt.toMillis) ? n.createdAt.toMillis() : 0; }

  function refreshAgenda() {
    setState(state);
    if (typeof agendaRenderCalendar === 'function') { try { agendaRenderCalendar(); } catch (e) { console.error(e); } }
    const box = document.getElementById('agendaGrafiaBox');
    const m = document.getElementById('agendaNoteModal');
    if (box && m && m.style.display === 'flex' && typeof agendaSelectedKey === 'string' && agendaSelectedKey) grafiaRenderDayBox(agendaSelectedKey);
    renderPanel();
  }

  function setState(s) {
    state = s;
    const dot = document.getElementById('agendaGrafiaDot');
    if (dot) dot.className = 'agenda-sync-dot ' + (s === 'ok' ? 'agenda-sync-ok' : 'agenda-sync-off');
    const btn = document.getElementById('agendaGrafiaBtn');
    if (btn) {
      const t = s === 'ok' ? 'Notas do Grafia: conectado' : (s === 'connecting' ? 'Notas do Grafia: conectando…' : 'Notas do Grafia: conectar');
      btn.title = t; btn.setAttribute('aria-label', t);
    }
  }

  // ---------- conexão ----------
  async function loadSdk() {
    const fb = await agendaEnsureFirebase();        // app + firestore (compat), definido em app.js
    if (!(fb.auth)) await agendaLoadScript(AUTH_CDN);
    return window.firebase;
  }

  function stopNotes() {
    if (unsubNotes) { try { unsubNotes(); } catch (e) { /* já encerrada */ } unsubNotes = null; }
  }
  function clearData() { byDay = {}; byId = {}; total = 0; }

  function listen(u) {
    stopNotes();
    unsubNotes = db.collection('users').doc(u.uid).collection('notes').onSnapshot((snap) => {
      if (!unlocked()) return;
      const nd = {}, ni = {};
      let n = 0;
      snap.forEach((doc) => {
        const d = doc.data() || {};
        if (typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return;
        const note = {
          id: doc.id, title: d.title || '(sem título)', date: d.date,
          pages: Array.isArray(d.pages) ? d.pages.map((p) => String(p == null ? '' : p)) : null,
          content: typeof d.content === 'string' ? d.content : '',
          anexos: Array.isArray(d.attachments) ? d.attachments.length : 0,
          createdAt: d.createdAt || null
        };
        (nd[note.date] = nd[note.date] || []).push(note);
        ni[note.id] = note; n++;
      });
      Object.keys(nd).forEach((k) => nd[k].sort((a, b) => createdMs(a) - createdMs(b)));
      byDay = nd; byId = ni; total = n;
      setState('ok');
      refreshAgenda();
    }, (err) => {
      console.error(err);
      stopNotes();
      setState('error');
      renderPanel();
    });
  }

  // Liga tudo. Só é chamado se já houve login (FLAG) ou quando a pessoa clica em Conectar.
  function start() {
    if (starting) return starting;
    setState('connecting');
    starting = (async () => {
      try {
        const fb = await loadSdk();
        app = fb.apps.find((a) => a.name === 'grafia') || fb.initializeApp(GRAFIA_FIREBASE_CONFIG, 'grafia');
        auth = app.auth();
        db = app.firestore();
        if (unsubAuth) unsubAuth();
        unsubAuth = auth.onAuthStateChanged((u) => {
          user = u;
          if (u && unlocked()) listen(u);
          else { stopNotes(); clearData(); setState(u ? 'connecting' : 'off'); refreshAgenda(); }
        });
      } catch (e) {
        console.error(e);
        starting = null;
        setState('error');
        renderPanel();
      }
    })();
    return starting;
  }

  // ---------- chamadas do app.js ----------
  window.grafiaOnLock = function () {
    stopNotes(); clearData(); user = null;
    if (unsubAuth) { try { unsubAuth(); } catch (e) { /* ok */ } unsubAuth = null; }
    starting = null; app = null; auth = null; db = null;
    state = 'off';
    closeViewer(true); closePanel(true);
  };

  // Acrescenta as notas do Grafia dentro das células já desenhadas da grade.
  window.grafiaDecorateGrid = function (grid) {
    if (!unlocked()) return;
    if (!starting && wasLinked()) start();
    if (!grid || !total) return;
    grid.querySelectorAll('.agenda-day-cell[data-day]').forEach((cell) => {
      const key = agendaKeyFor(agendaCurrentMonth, Number(cell.dataset.day));
      const list = byDay[key];
      if (!list || !list.length) return;
      const wrap = document.createElement('div');
      wrap.className = 'agenda-grafia-notes';
      list.slice(0, 2).forEach((n) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'agenda-grafia-chip';
        b.dataset.id = n.id;
        b.title = 'Abrir nota do Grafia: ' + n.title;
        b.setAttribute('aria-label', 'Abrir nota do Grafia: ' + n.title);
        b.innerHTML = '<span aria-hidden="true">📝</span><span class="agenda-grafia-chip-t">' + esc(n.title) + '</span>';
        b.addEventListener('click', (ev) => { ev.stopPropagation(); openNote(n.id, b); });
        b.addEventListener('keydown', (ev) => { ev.stopPropagation(); });   // Enter/setas não devem acionar a célula
        wrap.appendChild(b);
      });
      if (list.length > 2) {
        const more = document.createElement('span');
        more.className = 'agenda-grafia-more';
        more.textContent = '+' + (list.length - 2) + ' no Grafia';
        wrap.appendChild(more);
      }
      cell.appendChild(wrap);
      cell.setAttribute('aria-label', (cell.getAttribute('aria-label') || '') + ', ' + list.length + (list.length === 1 ? ' nota do Grafia' : ' notas do Grafia'));
    });
  };

  // Seção "Do Grafia" dentro do modal do dia.
  window.grafiaRenderDayBox = function (key) {
    const box = document.getElementById('agendaGrafiaBox');
    if (!box) return;
    const list = (unlocked() && byDay[key]) || [];
    if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<div class="agenda-grafia-box-h">📝 Notas do Grafia neste dia</div>' + list.map((n) => {
      const t = noteText(n).replace(/\s+/g, ' ').trim();
      return '<button type="button" class="agenda-grafia-item" data-id="' + esc(n.id) + '">' +
        '<strong>' + esc(n.title) + '</strong>' +
        (t ? '<span>' + esc(t.slice(0, 110)) + (t.length > 110 ? '…' : '') + '</span>' : '') +
        '</button>';
    }).join('');
    box.querySelectorAll('.agenda-grafia-item').forEach((b) => b.addEventListener('click', () => openNote(b.dataset.id, b)));
  };

  // ---------- visualizador da nota ----------
  function ensureUi() {
    if (document.getElementById('grafiaViewer')) return;
    const w = document.createElement('div');
    w.innerHTML = `
      <div id="grafiaViewer" class="grafia-overlay" hidden>
        <div class="grafia-box" role="dialog" aria-modal="true" aria-labelledby="grafiaViewerTitle">
          <div class="grafia-head">
            <div><div class="grafia-kicker">📝 Nota do Grafia · <span id="grafiaViewerDate"></span></div>
              <h3 id="grafiaViewerTitle" class="grafia-title"></h3></div>
            <button type="button" class="grafia-x" id="grafiaViewerX" aria-label="Fechar">&times;</button>
          </div>
          <div id="grafiaViewerBody" class="grafia-body" tabindex="0"></div>
          <div id="grafiaViewerNav" class="grafia-nav" hidden>
            <button type="button" id="grafiaPrev">‹ Anterior</button><span id="grafiaPageLbl"></span><button type="button" id="grafiaNext">Próxima ›</button>
          </div>
          <div class="grafia-actions">
            <a id="grafiaOpenLink" class="grafia-btn grafia-btn-main" target="_blank" rel="noopener noreferrer">Abrir no Grafia ↗</a>
            <button type="button" class="grafia-btn" id="grafiaViewerClose">Fechar</button>
          </div>
        </div>
      </div>
      <div id="grafiaPanel" class="grafia-overlay" hidden>
        <div class="grafia-box grafia-box-sm" role="dialog" aria-modal="true" aria-labelledby="grafiaPanelTitle">
          <div class="grafia-head">
            <h3 id="grafiaPanelTitle" class="grafia-title">Notas do Grafia na agenda</h3>
            <button type="button" class="grafia-x" id="grafiaPanelX" aria-label="Fechar">&times;</button>
          </div>
          <div id="grafiaPanelBody"></div>
        </div>
      </div>
      <style>
        .grafia-overlay { position:fixed; inset:0; z-index:1200; background:rgba(20,16,10,.55); display:flex; align-items:center; justify-content:center; padding:16px; box-sizing:border-box; }
        .grafia-overlay[hidden] { display:none; }
        .grafia-box { background:#f8f2e4; color:#2c2620; width:100%; max-width:640px; max-height:92vh; display:flex; flex-direction:column; border-radius:6px 14px 14px 6px; border-left:8px solid #5c7a6b; box-shadow:0 16px 34px rgba(0,0,0,.3); padding:18px 20px 16px; box-sizing:border-box; font-family:'Lora', Georgia, serif; }
        .grafia-box-sm { max-width:420px; }
        .grafia-head { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:10px; }
        .grafia-kicker { font-size:13px; font-weight:700; color:#5c7a6b; }
        .grafia-title { margin:2px 0 0; font-size:21px; line-height:1.25; font-style:italic; overflow-wrap:anywhere; }
        .grafia-x { background:none; border:none; font-size:30px; line-height:1; cursor:pointer; color:#6f6551; padding:0 8px; border-radius:6px; }
        .grafia-x:hover { background:#efe4cb; }
        .grafia-body { flex:1 1 auto; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font-size:17px; line-height:1.5; padding:10px 12px; background:rgba(255,255,255,.55); border:1px solid #d3c495; border-radius:8px; min-height:90px; }
        .grafia-nav { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:8px; font-size:13px; color:#6f6551; }
        .grafia-nav button { font:inherit; background:none; border:1px solid #d3c495; border-radius:8px; padding:6px 12px; cursor:pointer; color:#2c2620; }
        .grafia-nav button:disabled { opacity:.4; cursor:default; }
        .grafia-actions { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
        .grafia-btn { font:inherit; font-size:15px; font-weight:700; text-decoration:none; text-align:center; cursor:pointer; padding:11px 16px; border-radius:8px; border:1px solid #1f3d33; background:transparent; color:#1f3d33; flex:1 1 auto; box-sizing:border-box; }
        .grafia-btn-main { background:#1f3d33; color:#fff; }
        .grafia-field { display:block; width:100%; box-sizing:border-box; font:inherit; font-size:16px; padding:10px; margin:4px 0 12px; border:1px solid #d3c495; border-radius:8px; background:rgba(255,255,255,.7); color:#2c2620; }
        .grafia-lbl { font-size:14px; font-weight:700; }
        .grafia-msg { font-size:14px; line-height:1.4; margin:0 0 12px; color:#4a4136; }
        .grafia-err { color:#b3413a; font-weight:700; margin:-4px 0 10px; font-size:14px; }
        .agenda-grafia-notes { display:flex; flex-direction:column; gap:2px; margin-top:3px; min-width:0; }
        .agenda-grafia-chip { display:flex; align-items:center; gap:3px; min-width:0; max-width:100%; font:inherit; font-size:.72em; line-height:1.25; text-align:left; cursor:pointer; padding:1px 4px; border-radius:5px; border:1px solid #9db8aa; background:#e6f0ea; color:#244536; }
        .agenda-grafia-chip:hover, .agenda-grafia-chip:focus-visible { background:#d3e6db; outline:2px solid #5c7a6b; outline-offset:1px; }
        .agenda-grafia-chip-t { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
        .agenda-grafia-more { font-size:.68em; color:#5c7a6b; font-weight:700; }
        .agenda-grafia-box { margin:0 0 10px; padding:8px 10px; background:#e6f0ea; border:1px solid #9db8aa; border-radius:10px; }
        .agenda-grafia-box[hidden] { display:none; }
        .agenda-grafia-box-h { font-size:14px; font-weight:700; color:#244536; margin-bottom:6px; }
        .agenda-grafia-item { display:block; width:100%; text-align:left; font:inherit; cursor:pointer; padding:8px 10px; margin-top:6px; border-radius:8px; border:1px solid #9db8aa; background:#f6fbf8; color:#2c2620; }
        .agenda-grafia-item:hover, .agenda-grafia-item:focus-visible { background:#fff; outline:2px solid #5c7a6b; }
        .agenda-grafia-item strong { display:block; font-size:16px; }
        .agenda-grafia-item span { display:block; font-size:13px; color:#6f6551; margin-top:2px; overflow-wrap:anywhere; }
      </style>`;
    while (w.firstChild) document.body.appendChild(w.firstChild);
    document.getElementById('grafiaViewerX').onclick = () => closeViewer();
    document.getElementById('grafiaViewerClose').onclick = () => closeViewer();
    document.getElementById('grafiaPanelX').onclick = () => closePanel();
    document.getElementById('grafiaViewer').addEventListener('click', (e) => { if (e.target.id === 'grafiaViewer') closeViewer(); });
    document.getElementById('grafiaPanel').addEventListener('click', (e) => { if (e.target.id === 'grafiaPanel') closePanel(); });
    // Esc fecha só o painel de cima (em fase de captura, antes dos atalhos da agenda).
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const v = document.getElementById('grafiaViewer'), p = document.getElementById('grafiaPanel');
      if (v && !v.hidden) { e.stopPropagation(); e.preventDefault(); closeViewer(); }
      else if (p && !p.hidden) { e.stopPropagation(); e.preventDefault(); closePanel(); }
    }, true);
  }

  let viewPages = [], viewIdx = 0;
  function showPage() {
    const body = document.getElementById('grafiaViewerBody');
    body.textContent = viewPages[viewIdx] || '';
    body.scrollTop = 0;
    const nav = document.getElementById('grafiaViewerNav');
    nav.hidden = viewPages.length < 2;
    document.getElementById('grafiaPageLbl').textContent = 'Página ' + (viewIdx + 1) + ' de ' + viewPages.length;
    document.getElementById('grafiaPrev').disabled = viewIdx === 0;
    document.getElementById('grafiaNext').disabled = viewIdx === viewPages.length - 1;
  }

  function openNote(id, opener) {
    const n = byId[id];
    if (!n) return;
    ensureUi();
    lastFocus = opener || document.activeElement;
    viewPages = (n.pages && n.pages.length) ? n.pages : [n.content || ''];
    viewIdx = 0;
    document.getElementById('grafiaViewerTitle').textContent = n.title;
    document.getElementById('grafiaViewerDate').textContent = fmtDate(n.date) + (n.anexos ? ' · 📎 ' + n.anexos + (n.anexos === 1 ? ' anexo (veja no Grafia)' : ' anexos (veja no Grafia)') : '');
    document.getElementById('grafiaOpenLink').href = GRAFIA_URL + '?nota=' + encodeURIComponent(n.id);
    document.getElementById('grafiaPrev').onclick = () => { if (viewIdx > 0) { viewIdx--; showPage(); } };
    document.getElementById('grafiaNext').onclick = () => { if (viewIdx < viewPages.length - 1) { viewIdx++; showPage(); } };
    showPage();
    document.getElementById('grafiaViewer').hidden = false;
    document.getElementById('grafiaViewerBody').focus();
  }
  function closeViewer(silent) {
    const v = document.getElementById('grafiaViewer');
    if (!v || v.hidden) return;
    v.hidden = true;
    document.getElementById('grafiaViewerBody').textContent = '';
    if (!silent && lastFocus && document.contains(lastFocus) && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ok */ } }
  }

  // ---------- painel de conexão ----------
  function authMsg(e) {
    const c = e && e.code || '';
    if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found' || c === 'auth/invalid-login-credentials') return 'E-mail ou senha do Grafia incorretos.';
    if (c === 'auth/invalid-email') return 'Esse e-mail não parece válido.';
    if (c === 'auth/too-many-requests') return 'Muitas tentativas. Espere alguns minutos e tente de novo.';
    if (c === 'auth/network-request-failed') return 'Sem conexão com a internet.';
    return 'Não foi possível entrar agora. Tente de novo.';
  }

  function renderPanel() {
    const body = document.getElementById('grafiaPanelBody');
    if (!body) return;
    if (user) {
      body.innerHTML = '<p class="grafia-msg">Conectado ao Grafia como <strong>' + esc(user.email || '') + '</strong>.<br>' +
        (state === 'ok' ? total + (total === 1 ? ' nota encontrada.' : ' notas encontradas.') + ' Elas aparecem nos dias da agenda; toque numa para abrir.' : (state === 'error' ? 'Não consegui ler as notas agora. Verifique a internet.' : 'Carregando notas…')) + '</p>' +
        '<div class="grafia-actions"><a class="grafia-btn grafia-btn-main" href="' + esc(GRAFIA_URL) + '" target="_blank" rel="noopener noreferrer">Abrir o Grafia ↗</a>' +
        '<button type="button" class="grafia-btn" id="grafiaLogout">Desconectar</button></div>';
      document.getElementById('grafiaLogout').onclick = disconnect;
      return;
    }
    if (state === 'error' && !auth) {
      body.innerHTML = '<p class="grafia-err">Não foi possível carregar a conexão (verifique a internet).</p><button type="button" class="grafia-btn" id="grafiaRetry">Tentar de novo</button>';
      document.getElementById('grafiaRetry').onclick = () => { starting = null; start().then(renderPanel); };
      return;
    }
    body.innerHTML = '<p class="grafia-msg">Entre com a mesma conta do Grafia. As notas pela data aparecem na agenda; o Argo só <strong>lê</strong>, nunca altera nem apaga notas. Fica salvo neste aparelho até você desconectar.</p>' +
      '<form id="grafiaForm" novalidate>' +
      '<label class="grafia-lbl" for="grafiaEmail">E-mail do Grafia</label>' +
      '<input class="grafia-field" id="grafiaEmail" type="email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false">' +
      '<label class="grafia-lbl" for="grafiaPass">Senha do Grafia</label>' +
      '<input class="grafia-field" id="grafiaPass" type="password" autocomplete="current-password">' +
      '<div id="grafiaErr" class="grafia-err" role="alert" hidden></div>' +
      '<button type="submit" class="grafia-btn grafia-btn-main" id="grafiaGo" style="width:100%">Conectar</button></form>';
    document.getElementById('grafiaForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const email = document.getElementById('grafiaEmail').value.trim();
      const pass = document.getElementById('grafiaPass').value;
      const err = document.getElementById('grafiaErr');
      const go = document.getElementById('grafiaGo');
      err.hidden = true;
      if (!email || !pass) { err.textContent = 'Digite o e-mail e a senha.'; err.hidden = false; return; }
      go.disabled = true; go.textContent = 'Entrando…';
      try {
        await start();
        if (!auth) throw new Error('sem-conexao');
        await auth.signInWithEmailAndPassword(email, pass);
        setLinked(true);
        closePanel();
      } catch (e) {
        err.textContent = authMsg(e); err.hidden = false;
        go.disabled = false; go.textContent = 'Conectar';
      }
    };
  }

  async function disconnect() {
    try { if (auth) await auth.signOut(); } catch (e) { console.error(e); }
    setLinked(false);
    stopNotes(); clearData(); user = null;
    setState('off');
    refreshAgenda();
    renderPanel();
  }

  window.grafiaOpenPanel = function () {
    ensureUi();
    lastFocus = document.activeElement;
    renderPanel();
    document.getElementById('grafiaPanel').hidden = false;
    const f = document.getElementById('grafiaEmail') || document.getElementById('grafiaLogout') || document.getElementById('grafiaPanelX');
    if (f) f.focus();
    if (!starting && wasLinked()) start();
  };
  function closePanel(silent) {
    const p = document.getElementById('grafiaPanel');
    if (!p || p.hidden) return;
    p.hidden = true;
    if (!silent && lastFocus && document.contains(lastFocus) && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ok */ } }
  }
})();

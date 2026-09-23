/*!
 * ArgoMascot — mascote-barquinho (tema Argo Navis) + sistema de avisos.
 * Sem dependências. Usa as mesmas variáveis de tema do app (--brand-primary,
 * --bg-card, --text-main, --radius-ui, --shadow-*) quando existirem, com
 * fallback para as mesmas cores caso seja usado fora do Argo SUAS.
 *
 * COMO USAR
 *   <script src="argo-mascot.js"></script>
 *
 *   // Toast flutuante (substitui alert() / agendaToast / etc.)
 *   ArgoMascot.notify('Não foi possível salvar. Tente de novo.', { type: 'error' });
 *   ArgoMascot.notify('Sincronizado com sucesso.', { type: 'success' });
 *   ArgoMascot.notify('Nenhum resultado para essa busca.', { type: 'notfound' });
 *   ArgoMascot.notify('Dados salvos neste aparelho.'); // type: 'info' (padrão)
 *
 *   // Com botão de ação (ex.: "Tentar de novo")
 *   ArgoMascot.notify('Sem conexão com o servidor.', {
 *     type: 'error', actionLabel: 'Tentar de novo', onAction: () => sync()
 *   });
 *
 *   // Estado vazio (troca direta do padrão `grid.innerHTML = '<div class="empty-state">…'`)
 *   grid.innerHTML = ArgoMascot.emptyStateHTML('Nenhum registro encontrado', {
 *     type: 'notfound',
 *     hint: 'Tente ajustar os termos da busca ou selecionar outra categoria.'
 *   });
 *
 * TIPOS: 'info' (padrão, azul) · 'error' (vermelho) · 'notfound' (dourado) · 'success' (verde)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArgoMascot = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var THEME = {
    info:     { color: 'var(--argo-mascot-info, #0091C2)' },
    error:    { color: 'var(--argo-mascot-error, #B91C1C)' },
    notfound: { color: 'var(--argo-mascot-notfound, #B45309)' },
    success:  { color: 'var(--argo-mascot-success, #15803D)' }
  };

  var STYLE_ID = 'argo-mascot-styles';
  var TOAST_ID = 'argo-mascot-toast';

  // ---------------------------------------------------------------------
  // Mascote (barco Argo) — casco/mastro compartilhados, "rosto" e bandeira
  // variam por humor (mood) conforme o tipo de aviso.
  // ---------------------------------------------------------------------
  function boatSVG(mood, size) {
    mood = mood || 'info';
    size = size || 40;
    var accent = (THEME[mood] || THEME.info).color;

    // Bandeirola no topo do mastro (muda de cor/símbolo por humor)
    var flagSymbol = {
      info: '<text x="63" y="30" font-size="11" font-weight="700" fill="#fff" text-anchor="middle" font-family="inherit">★</text>',
      error: '<text x="63" y="31" font-size="12" font-weight="800" fill="#fff" text-anchor="middle" font-family="inherit">!</text>',
      notfound: '<text x="63" y="31" font-size="11" font-weight="800" fill="#fff" text-anchor="middle" font-family="inherit">?</text>',
      success: '<text x="63" y="30" font-size="10" font-weight="800" fill="#fff" text-anchor="middle" font-family="inherit">✓</text>'
    }[mood];

    // Rosto do carneiro (proa grega) — olho e sobrancelha variam por humor
    var face = {
      info: '<circle cx="106" cy="49" r="2.2" fill="#0F172A"/>',
      error: '<circle cx="106" cy="50" r="2" fill="#0F172A"/><path d="M102.5 45.5 L109 44.5" stroke="#0F172A" stroke-width="1.6" stroke-linecap="round"/>',
      notfound: '<circle cx="107" cy="48" r="2" fill="#0F172A"/><path d="M103 44.5 Q106.5 42 110 44.5" stroke="#0F172A" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
      success: '<path d="M102 49 Q106 52.5 110 49" stroke="#0F172A" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
    }[mood];

    var bob = mood === 'error' ? '' : ' argo-mascot-bob';

    return (
      '<svg class="argo-mascot-icon' + bob + '" width="' + size + '" height="' + size +
      '" viewBox="0 0 130 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
        // onda
        '<path d="M6 96 Q22 88 38 96 T70 96 T102 96 T126 96" stroke="' + accent + '" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.55"/>' +
        // casco
        '<path d="M14 84 Q10 70 20 66 L96 62 Q108 62 100 76 L88 90 Q70 96 40 94 Q20 92 14 84 Z" fill="#0F172A" stroke="' + accent + '" stroke-width="2.5"/>' +
        // escudos no casco
        '<circle cx="34" cy="79" r="4" fill="none" stroke="' + accent + '" stroke-width="1.6"/>' +
        '<circle cx="48" cy="80" r="4" fill="none" stroke="' + accent + '" stroke-width="1.6"/>' +
        '<circle cx="62" cy="80" r="4" fill="none" stroke="' + accent + '" stroke-width="1.6"/>' +
        // voluta encaracolada na popa (traço grego clássico)
        '<path d="M16 82 Q6 76 9 66 Q11 58 19 60" fill="none" stroke="' + accent + '" stroke-width="2.2" stroke-linecap="round"/>' +
        // pescoço + cabeça de carneiro na proa (Argo/Velocino de Ouro)
        '<path d="M92 64 Q100 59 100 48" fill="none" stroke="' + accent + '" stroke-width="3.5" stroke-linecap="round"/>' +
        '<path d="M100 48 Q110 44 114 50 Q110 55 102 54 Q98 53 100 48 Z" fill="' + accent + '"/>' +
        '<path d="M104 46 Q112 40 108 32 Q105 26 98 30 Q94 33 98 38 Q101 41 105 39" fill="none" stroke="' + accent + '" stroke-width="2.2" stroke-linecap="round"/>' +
        face +
        // mastro
        '<line x1="63" y1="66" x2="63" y2="20" stroke="' + accent + '" stroke-width="3" stroke-linecap="round"/>' +
        // vela
        '<path d="M63 24 Q100 32 84 58 L63 62 Z" fill="#EFEAE0" stroke="' + accent + '" stroke-width="2" stroke-linejoin="round"/>' +
        // bandeirola
        '<path d="M63 20 L76 26 L63 32 Z" fill="' + accent + '"/>' +
        flagSymbol +
      '</svg>'
    );
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = '' +
      '.argo-mascot-icon{display:block;overflow:visible}' +
      '.argo-mascot-bob{animation:argoMascotBob 3.2s ease-in-out infinite}' +
      '@keyframes argoMascotBob{0%,100%{transform:translateY(0) rotate(-1.5deg)}50%{transform:translateY(-3px) rotate(1.5deg)}}' +
      '@media (prefers-reduced-motion: reduce){.argo-mascot-bob{animation:none}}' +

      '.argo-mascot-toast{position:fixed;left:50%;bottom:max(20px,env(safe-area-inset-bottom));transform:translate(-50%,14px);'+
        'display:flex;align-items:center;gap:12px;max-width:min(92vw,440px);padding:12px 16px 12px 10px;'+
        'background:var(--bg-card,#151F35);color:var(--text-main,#F1F5F9);border-radius:var(--radius-ui,12px);'+
        'box-shadow:var(--shadow-lg,0 24px 48px -12px rgba(0,0,0,0.4));border:1px solid rgba(127,127,127,0.18);'+
        'opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease;z-index:99999;font-family:inherit}' +
      '.argo-mascot-toast.argo-mascot-visible{opacity:1;transform:translate(-50%,0);pointer-events:auto}' +
      '.argo-mascot-toast-icon{flex:0 0 auto;width:38px;height:38px}' +
      '.argo-mascot-toast-body{flex:1;min-width:0;font-size:14px;line-height:1.4;font-weight:600}' +
      '.argo-mascot-toast-action{flex:0 0 auto;border:none;background:transparent;color:var(--argo-mascot-toast-accent,#29ABE2);'+
        'font-weight:800;font-size:13px;cursor:pointer;padding:6px 8px;border-radius:8px;white-space:nowrap}' +
      '.argo-mascot-toast-action:hover{background:rgba(127,127,127,0.14)}' +
      '.argo-mascot-toast-close{flex:0 0 auto;border:none;background:transparent;color:inherit;opacity:0.55;'+
        'cursor:pointer;font-size:15px;line-height:1;padding:4px 6px;border-radius:8px}' +
      '.argo-mascot-toast-close:hover{opacity:1;background:rgba(127,127,127,0.14)}' +

      '.argo-mascot-empty{display:flex;flex-direction:column;align-items:center;text-align:center;'+
        'gap:10px;padding:40px 20px;color:var(--text-muted,#A7B7CC)}' +
      '.argo-mascot-empty .argo-mascot-icon{width:64px;height:64px}' +
      '.argo-mascot-empty strong{color:var(--text-main,#F1F5F9);font-size:15px}' +
      '.argo-mascot-empty span{font-size:13px;max-width:320px}';

    var tag = document.createElement('style');
    tag.id = STYLE_ID;
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  // ---------------------------------------------------------------------
  // Toast (fila simples: um de cada vez, igual ao padrão já usado no app)
  // ---------------------------------------------------------------------
  var queue = [];
  var showing = false;
  var hideTimer = null;

  function renderToast(msg, opts) {
    ensureStyles();
    var type = (opts && opts.type) || 'info';
    var duration = (opts && opts.duration) || (type === 'error' ? 6500 : 4200);
    var accent = (THEME[type] || THEME.info).color;

    var el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      el.className = 'argo-mascot-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.style.setProperty('--argo-mascot-toast-accent', accent);

    var actionHtml = (opts && opts.actionLabel)
      ? '<button type="button" class="argo-mascot-toast-action" data-argo-action>' + opts.actionLabel + '</button>'
      : '';

    el.innerHTML =
      '<span class="argo-mascot-toast-icon">' + boatSVG(type, 38) + '</span>' +
      '<span class="argo-mascot-toast-body"></span>' +
      actionHtml +
      '<button type="button" class="argo-mascot-toast-close" aria-label="Fechar aviso" data-argo-close>✕</button>';

    el.querySelector('.argo-mascot-toast-body').textContent = msg;

    var closeBtn = el.querySelector('[data-argo-close]');
    closeBtn.onclick = function () { dismiss(); };

    if (opts && opts.actionLabel && opts.onAction) {
      var actionBtn = el.querySelector('[data-argo-action]');
      actionBtn.onclick = function () { dismiss(); opts.onAction(); };
    }

    requestAnimationFrame(function () { el.classList.add('argo-mascot-visible'); });

    clearTimeout(hideTimer);
    hideTimer = setTimeout(dismiss, duration);
  }

  function dismiss() {
    var el = document.getElementById(TOAST_ID);
    clearTimeout(hideTimer);
    if (el) el.classList.remove('argo-mascot-visible');
    showing = false;
    setTimeout(processQueue, 200);
  }

  function processQueue() {
    if (showing || queue.length === 0) return;
    showing = true;
    var next = queue.shift();
    renderToast(next.msg, next.opts);
  }

  /**
   * Mostra um aviso flutuante com o mascote.
   * @param {string} message
   * @param {{type?:'info'|'error'|'notfound'|'success', duration?:number, actionLabel?:string, onAction?:Function}} [options]
   */
  function notify(message, options) {
    queue.push({ msg: message, opts: options || {} });
    processQueue();
  }

  // ---------------------------------------------------------------------
  // Estado vazio (busca sem resultado, lista vazia etc.)
  // ---------------------------------------------------------------------
  /**
   * Retorna o HTML pronto para `algumElemento.innerHTML = ...`, no mesmo
   * formato do `.empty-state` já usado no app, mas com o mascote no lugar
   * do ícone de lupa.
   */
  function emptyStateHTML(title, options) {
    ensureStyles();
    var type = (options && options.type) || 'notfound';
    var hint = (options && options.hint) || '';
    return (
      '<div class="argo-mascot-empty">' +
        boatSVG(type, 64) +
        '<strong>' + escapeHtml(title) + '</strong>' +
        (hint ? '<span>' + escapeHtml(hint) + '</span>' : '') +
      '</div>'
    );
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  return {
    notify: notify,
    dismiss: dismiss,
    emptyStateHTML: emptyStateHTML,
    icon: boatSVG // ArgoMascot.icon('success', 48) → string SVG avulso, para usar em qualquer lugar
  };
});

/*!
 * ArgoMascot — mascote-barquinho (tema Argo Navis) + sistema de avisos.
 * Visual "tecnológico": antenas com LED piscando na cor do humor, régua do
 * casco e chip da bandeira com brilho neon, painel de circuito perto da
 * quilha e vela em estilo tela/holograma (gradiente + scanlines).
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
  function normalizeType(t) {
    return (t && Object.prototype.hasOwnProperty.call(THEME, t)) ? t : 'info';
  }

  var mascotUid = 0;

  function boatSVG(mood, size) {
    mood = normalizeType(mood);
    size = size || 40;
    var accent = THEME[mood].color;
    var INK = '#0F172A', GOLD = '#F2B84B', BLUSH = '#FF8FA3';

    // IDs únicos por chamada (defs/filter/gradient/clipPath): sem isso, dois
    // mascotes na mesma página (ex.: toast + estado vazio ao mesmo tempo)
    // teriam elementos com o mesmo id="argoMascotGlow" etc., e o navegador
    // resolve url(#id) pelo PRIMEIRO elemento com aquele id no documento
    // inteiro — o segundo mascote "roubaria" o filtro/gradiente do primeiro.
    mascotUid += 1;
    var uid = 'argoMascot' + mascotUid;
    var glowId = uid + 'Glow';
    var sailGradId = uid + 'SailGrad';
    var sailClipId = uid + 'SailClip';

    function eye(cx, cy) { // olho grande e brilhante
      return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="6.5" ry="7.5" fill="' + INK + '"/>' +
             '<circle cx="' + (cx + 2) + '" cy="' + (cy - 3) + '" r="2.4" fill="#fff"/>' +
             '<circle cx="' + (cx - 2) + '" cy="' + (cy + 3) + '" r="1.1" fill="#fff" opacity=".85"/>';
    }
    function happyEye(cx, cy) { // olho fechado sorrindo ^
      return '<path d="M' + (cx - 6) + ' ' + (cy + 3) + ' Q' + cx + ' ' + (cy - 7) + ' ' + (cx + 6) + ' ' + (cy + 3) +
             '" fill="none" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>';
    }
    function stroke(d, w) {
      return '<path d="' + d + '" fill="none" stroke="' + INK + '" stroke-width="' + (w || 2.4) + '" stroke-linecap="round" stroke-linejoin="round"/>';
    }

    // Expressão do rostinho no casco, por humor
    var face = {
      info:
        eye(46, 79) + eye(82, 79) + stroke('M57 89 Q64 96 71 89'),
      success:
        happyEye(46, 79) + happyEye(82, 79) +
        '<path d="M56 87 Q64 101 72 87 Z" fill="' + INK + '"/>' +
        '<path d="M60 94 Q64 98 68 94 Q64 91 60 94 Z" fill="' + BLUSH + '"/>',
      error:
        eye(46, 80) + eye(82, 80) +
        stroke('M39 68 L53 72', 2.6) + stroke('M89 68 L75 72', 2.6) +
        stroke('M58 94 Q64 87 70 94') +
        '<path d="M101 64 Q106 72 101 77 Q96 72 101 64 Z" fill="#7DD3FC" stroke="#38BDF8" stroke-width="1"/>',
      notfound:
        eye(47, 79) + eye(83, 79) +
        stroke('M39 69 Q46 65 53 69', 2.6) +
        '<ellipse cx="64" cy="91" rx="3.2" ry="3.8" fill="' + INK + '"/>'
    }[mood];

    var flagSymbol = {
      info: '★', error: '!', notfound: '?', success: '✓'
    }[mood];

    // Brilhinhos extras no humor de sucesso (com o mesmo brilho neon do
    // resto do barco, em vez de um dourado "seco")
    var sparkles = mood === 'success'
      ? '<path filter="url(#' + glowId + ')" d="M104 22 l2.2 5.8 5.8 2.2 -5.8 2.2 -2.2 5.8 -2.2 -5.8 -5.8 -2.2 5.8 -2.2 Z" fill="' + GOLD + '"/>' +
        '<path filter="url(#' + glowId + ')" d="M16 34 l1.6 4.2 4.2 1.6 -4.2 1.6 -1.6 4.2 -1.6 -4.2 -4.2 -1.6 4.2 -1.6 Z" fill="' + GOLD + '"/>'
      : '';

    var bob = mood === 'error' ? '' : ' argo-mascot-bob';

    return (
      '<svg class="argo-mascot-icon' + bob + '" width="' + size + '" height="' + size +
      '" viewBox="0 0 130 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
        '<defs>' +
          // Brilho neon suave, reaproveitado nas antenas, na régua do casco,
          // no chip da bandeira e (no humor de sucesso) nos brilhinhos —
          // dá o "ligado"/holográfico ao personagem, sem exagerar.
          '<filter id="' + glowId + '" x="-80%" y="-80%" width="260%" height="260%">' +
            '<feGaussianBlur stdDeviation="1.6" result="argoBlur"/>' +
            '<feMerge><feMergeNode in="argoBlur"/><feMergeNode in="SourceGraphic"/></feMerge>' +
          '</filter>' +
          // Vela como "tela"/holograma: gradiente do próprio tom do humor,
          // mais claro (translúcido) no topo e mais denso embaixo.
          '<linearGradient id="' + sailGradId + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="' + accent + '" stop-opacity="0.3"/>' +
            '<stop offset="100%" stop-color="' + accent + '" stop-opacity="0.78"/>' +
          '</linearGradient>' +
          '<clipPath id="' + sailClipId + '"><path d="M67 20 Q106 28 93 52 Q80 56 67 54 Z"/></clipPath>' +
        '</defs>' +
        // onda + "pulsos de dados" no lugar das bolhas redondas (mesmo
        // traçado de sempre, só que pontilhado — lê como sinal/sonar)
        '<path d="M4 102 Q19 93 34 102 T64 102 T94 102 T126 102" stroke="' + accent + '" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="1 9" opacity="0.5"/>' +
        '<rect x="15.5" y="108.5" width="3" height="3" fill="' + accent + '" opacity=".4"/><rect x="109.5" y="109.5" width="3" height="3" fill="' + accent + '" opacity=".4"/>' +
        // chifrinhos dourados de carneirinho (Velocino de Ouro) na proa e na
        // popa, agora também "antenas": ponta com um LED piscando na cor do
        // humor, como se cada chifre também captasse sinal.
        '<path d="M113 60 Q126 56 123 45 Q120 38 113 42" fill="none" stroke="' + GOLD + '" stroke-width="4.5" stroke-linecap="round"/>' +
        '<path d="M17 60 Q4 56 7 45 Q10 38 17 42" fill="none" stroke="' + GOLD + '" stroke-width="4.5" stroke-linecap="round"/>' +
        '<circle class="argo-mascot-led" filter="url(#' + glowId + ')" cx="113" cy="42" r="2.1" fill="' + accent + '"/>' +
        '<circle class="argo-mascot-led" filter="url(#' + glowId + ')" cx="17" cy="42" r="2.1" fill="' + accent + '"/>' +
        // casco rechonchudo (é o corpinho do personagem)
        '<path d="M13 66 Q13 58 21 58 H107 Q115 58 115 66 Q113 100 82 101 H46 Q15 100 13 66 Z" fill="#1B3358" stroke="' + accent + '" stroke-width="3.5" stroke-linejoin="round"/>' +
        // régua/borda do barco, com o mesmo brilho neon das antenas
        '<rect filter="url(#' + glowId + ')" x="10" y="54" width="108" height="9" rx="4.5" fill="' + accent + '"/>' +
        // trilha de circuito discreta perto da quilha — o "painel de
        // instrumentos" do casco, sem disputar espaço com o rosto
        '<path d="M28 97 H50 M78 97 H100" stroke="' + accent + '" stroke-width="1" stroke-linecap="round" opacity="0.55"/>' +
        '<rect x="37.5" y="95.5" width="3" height="3" fill="' + accent + '" opacity="0.6"/><rect x="64" y="95.5" width="3" height="3" fill="' + accent + '" opacity="0.6"/><rect x="89.5" y="95.5" width="3" height="3" fill="' + accent + '" opacity="0.6"/>' +
        // bochechas
        '<ellipse cx="33" cy="89" rx="6.5" ry="3.8" fill="' + BLUSH + '" opacity=".75"/>' +
        '<ellipse cx="95" cy="89" rx="6.5" ry="3.8" fill="' + BLUSH + '" opacity=".75"/>' +
        face +
        // mastro
        '<line x1="64" y1="56" x2="64" y2="14" stroke="' + accent + '" stroke-width="4" stroke-linecap="round"/>' +
        // vela-tela: o mesmo contorno de sempre, mas preenchida com o
        // gradiente holográfico e riscada por linhas finas de "scanline"
        // (recortadas para não vazar da forma da vela).
        '<g clip-path="url(#' + sailClipId + ')">' +
          '<path d="M67 20 Q106 28 93 52 Q80 56 67 54 Z" fill="url(#' + sailGradId + ')"/>' +
          '<path d="M60 27 H110" stroke="#fff" stroke-width="1" opacity="0.16"/>' +
          '<path d="M60 34 H110" stroke="#fff" stroke-width="1" opacity="0.13"/>' +
          '<path d="M60 41 H110" stroke="#fff" stroke-width="1" opacity="0.11"/>' +
          '<path d="M60 48 H110" stroke="#fff" stroke-width="1" opacity="0.09"/>' +
        '</g>' +
        '<path d="M67 20 Q106 28 93 52 Q80 56 67 54 Z" fill="none" stroke="' + accent + '" stroke-width="2.6" stroke-linejoin="round"/>' +
        // bandeirinha virou um "chip" digital: badge arredondado com o
        // símbolo do humor em fonte monoespaçada e um LED piscando no canto.
        '<rect filter="url(#' + glowId + ')" x="64" y="6" width="26" height="18" rx="4" fill="' + accent + '"/>' +
        '<rect x="64" y="6" width="26" height="18" rx="4" fill="none" stroke="#fff" stroke-opacity="0.28" stroke-width="1"/>' +
        '<text x="77" y="19" font-size="11" font-weight="800" fill="#fff" text-anchor="middle" font-family="\'SFMono-Regular\',Consolas,monospace" letter-spacing="0.4">' + flagSymbol + '</text>' +
        '<circle class="argo-mascot-led" cx="67.5" cy="9.5" r="1.3" fill="#fff"/>' +
        sparkles +
      '</svg>'
    );
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = '' +
      '.argo-mascot-icon{display:block;overflow:visible}' +
      '.argo-mascot-bob{animation:argoMascotBob 3.2s ease-in-out infinite}' +
      '@keyframes argoMascotBob{0%,100%{transform:translateY(0) rotate(-1.5deg)}50%{transform:translateY(-3px) rotate(1.5deg)}}' +
      // LED das antenas/chip da bandeira: pisca devagar, como um sinal
      // captado — cada instância começa num ponto diferente do ciclo
      // (animation-delay via nth-of-type não é confiável em SVG, então o
      // efeito "dessincronizado" fica por conta da duração levemente ímpar).
      '.argo-mascot-led{animation:argoMascotLed 1.9s ease-in-out infinite}' +
      '@keyframes argoMascotLed{0%,100%{opacity:1}50%{opacity:.25}}' +
      '@media (prefers-reduced-motion: reduce){.argo-mascot-bob{animation:none}.argo-mascot-led{animation:none}.argo-mascot-toast{transition:none}}' +
      '@media print{.argo-mascot-toast{display:none!important}}' +
      'body:has(#argoUpdateToast) .argo-mascot-toast{bottom:calc(76px + env(safe-area-inset-bottom,0px))}' +

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
    opts = opts || {};
    var type = normalizeType(opts.type);
    var duration = opts.duration || (type === 'error' ? 6500 : 4200);
    var accent = THEME[type].color;

    var el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      el.className = 'argo-mascot-toast';
      document.body.appendChild(el);
    }
    // Erros são anunciados na hora por leitores de tela; o resto, sem interromper.
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    el.style.setProperty('--argo-mascot-toast-accent', accent);

    // Monta com DOM (textContent) — nada do texto recebido é interpretado como HTML.
    el.textContent = '';
    var icon = document.createElement('span');
    icon.className = 'argo-mascot-toast-icon';
    icon.innerHTML = boatSVG(type, 38); // SVG gerado aqui dentro, sem dados externos
    var body = document.createElement('span');
    body.className = 'argo-mascot-toast-body';
    body.textContent = msg;
    el.appendChild(icon);
    el.appendChild(body);

    if (opts.actionLabel && typeof opts.onAction === 'function') {
      var actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'argo-mascot-toast-action';
      actionBtn.textContent = opts.actionLabel;
      actionBtn.onclick = function () { dismiss(); opts.onAction(); };
      el.appendChild(actionBtn);
    }

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'argo-mascot-toast-close';
    closeBtn.setAttribute('aria-label', 'Fechar aviso');
    closeBtn.textContent = '✕';
    closeBtn.onclick = dismiss;
    el.appendChild(closeBtn);

    // Pausa a contagem enquanto a pessoa lê (mouse em cima ou foco no aviso).
    function arm(ms) { clearTimeout(hideTimer); hideTimer = setTimeout(dismiss, ms); }
    el.onmouseenter = el.onfocusin = function () { clearTimeout(hideTimer); };
    el.onmouseleave = el.onfocusout = function () { arm(1800); };

    requestAnimationFrame(function () { el.classList.add('argo-mascot-visible'); });
    arm(duration);
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
  var lastMsg = null;
  function notify(message, options) {
    message = String(message == null ? '' : message);
    // Toques repetidos que gerariam o mesmo aviso em sequência viram um só.
    if (message === lastMsg && (showing || queue.length)) return;
    // Evita fila enorme (ex.: erro disparado em laço): mantém só os mais recentes.
    if (queue.length >= 3) queue.shift();
    lastMsg = message;
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
    var type = normalizeType((options && options.type) || 'notfound');
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

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && showing) dismiss();
    });
  }

  return {
    notify: notify,
    dismiss: dismiss,
    emptyStateHTML: emptyStateHTML,
    icon: boatSVG // ArgoMascot.icon('success', 48) → string SVG avulso, para usar em qualquer lugar
  };
});

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
      '.argo-mascot-empty span{font-size:13px;max-width:320px}' +

      // -----------------------------------------------------------------
      // Assistente (botão flutuante + painel de conversa). Fica no canto
      // esquerdo (o toast e o backToTop já ocupam o centro/direita), some
      // durante impressão, no modo destaque de aba (tela cheia) e enquanto
      // o app está trancado na tela de login (:has, já usado no toast).
      // -----------------------------------------------------------------
      '.argo-assistant-fab{position:fixed;left:max(16px,env(safe-area-inset-left));bottom:calc(16px + env(safe-area-inset-bottom));'+
        'width:56px;height:56px;border-radius:50%;background:var(--bg-card,#151F35);border:1px solid rgba(127,127,127,0.18);'+
        'box-shadow:var(--shadow-lg,0 24px 48px -12px rgba(0,0,0,.4));display:flex;align-items:center;justify-content:center;'+
        'padding:0;cursor:pointer;z-index:9997;transition:transform .18s ease}' +
      '.argo-assistant-fab:hover{transform:translateY(-2px) scale(1.04)}' +
      '.argo-assistant-fab[aria-expanded="true"]{transform:scale(.9)}' +
      '.argo-assistant-fab .argo-mascot-icon{width:34px;height:34px}' +

      '.argo-assistant-hint{position:fixed;left:calc(16px + env(safe-area-inset-left) + 64px);bottom:calc(30px + env(safe-area-inset-bottom));'+
        'display:flex;align-items:center;gap:8px;max-width:230px;background:var(--bg-card,#151F35);color:var(--text-main,#F1F5F9);'+
        'padding:10px 8px 10px 14px;border-radius:14px;box-shadow:var(--shadow-lg,0 24px 48px -12px rgba(0,0,0,.4));'+
        'border:1px solid rgba(127,127,127,0.18);font-size:13px;font-weight:600;line-height:1.35;z-index:9996;'+
        'animation:argoAssistantIn .25s ease}' +
      '.argo-assistant-hint-x{flex:0 0 auto;border:none;background:transparent;color:inherit;opacity:.55;cursor:pointer;'+
        'font-size:13px;padding:4px 6px;border-radius:8px}' +
      '.argo-assistant-hint-x:hover{opacity:1;background:rgba(127,127,127,.14)}' +

      '.argo-assistant-panel{position:fixed;left:max(16px,env(safe-area-inset-left));bottom:calc(82px + env(safe-area-inset-bottom));'+
        'width:min(340px,calc(100vw - 32px));max-height:min(70vh,520px);display:flex;flex-direction:column;overflow:hidden;'+
        'background:var(--bg-card,#151F35);color:var(--text-main,#F1F5F9);border-radius:var(--radius-ui,12px);'+
        'box-shadow:var(--shadow-lg,0 24px 48px -12px rgba(0,0,0,.4));border:1px solid rgba(127,127,127,0.18);'+
        'opacity:0;transform:translateY(10px) scale(.98);pointer-events:none;transition:opacity .18s ease,transform .18s ease;z-index:9998}' +
      '.argo-assistant-panel.argo-assistant-open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}' +

      '.argo-assistant-head{display:flex;align-items:center;gap:10px;padding:14px 8px 14px 14px;'+
        'border-bottom:1px solid rgba(127,127,127,.16);flex:0 0 auto}' +
      '.argo-assistant-head .argo-mascot-icon{width:32px;height:32px;flex:0 0 auto}' +
      '.argo-assistant-head-text{display:flex;flex-direction:column;flex:1;min-width:0}' +
      '.argo-assistant-head-text strong{font-size:14px}' +
      '.argo-assistant-head-text span{font-size:11px;color:var(--text-muted,#A7B7CC)}' +
      '.argo-assistant-close{flex:0 0 auto;border:none;background:transparent;color:inherit;opacity:.6;cursor:pointer;'+
        'font-size:15px;padding:6px 8px;border-radius:8px}' +
      '.argo-assistant-close:hover{opacity:1;background:rgba(127,127,127,.14)}' +

      '.argo-assistant-log{flex:1;overflow-y:auto;padding:12px 12px 4px;display:flex;flex-direction:column;gap:10px;min-height:70px}' +
      '.argo-assistant-msg{display:flex;gap:8px;max-width:94%}' +
      '.argo-assistant-msg-bot{align-self:flex-start}' +
      '.argo-assistant-msg-user{align-self:flex-end;flex-direction:row-reverse}' +
      '.argo-assistant-msg-icon{flex:0 0 auto;width:24px;height:24px;margin-top:3px}' +
      '.argo-assistant-msg-icon .argo-mascot-icon{width:24px;height:24px}' +
      '.argo-assistant-bubble{font-size:13px;line-height:1.45;padding:9px 12px;border-radius:14px;white-space:pre-line;word-break:break-word}' +
      '.argo-assistant-msg-bot .argo-assistant-bubble{background:rgba(127,127,127,.14);border-bottom-left-radius:4px}' +
      '.argo-assistant-msg-user .argo-assistant-bubble{background:var(--brand-primary,var(--argo-mascot-info,#0091C2));color:#fff;border-bottom-right-radius:4px}' +
      '.argo-assistant-typing .argo-assistant-bubble{display:flex;gap:4px;align-items:center;padding:12px 14px}' +
      '.argo-assistant-typing i{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.35;'+
        'animation:argoAssistantTyping 1s ease-in-out infinite;font-style:normal}' +
      '.argo-assistant-typing i:nth-child(2){animation-delay:.15s}.argo-assistant-typing i:nth-child(3){animation-delay:.3s}' +

      '.argo-assistant-quick{display:flex;flex-wrap:wrap;gap:6px;padding:6px 12px 10px;flex:0 0 auto}' +
      '.argo-assistant-chip{border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font-size:12px;font-weight:600;'+
        'padding:6px 11px;border-radius:20px;cursor:pointer;transition:background .15s ease,border-color .15s ease}' +
      '.argo-assistant-chip:hover{background:rgba(0,145,194,.14);border-color:var(--brand-primary,var(--argo-mascot-info,#0091C2))}' +

      '.argo-assistant-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid rgba(127,127,127,.16);flex:0 0 auto}' +
      '.argo-assistant-input{flex:1;min-width:0;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;'+
        'border-radius:20px;padding:8px 14px;font-size:13px;outline:none;font-family:inherit}' +
      '.argo-assistant-input:focus{border-color:var(--brand-primary,var(--argo-mascot-info,#0091C2))}' +
      '.argo-assistant-send{flex:0 0 auto;width:36px;height:36px;border-radius:50%;border:none;'+
        'background:var(--brand-primary,var(--argo-mascot-info,#0091C2));color:#fff;display:flex;align-items:center;'+
        'justify-content:center;cursor:pointer}' +
      '.argo-assistant-send:hover{filter:brightness(1.1)}' +

      '@keyframes argoAssistantIn{0%{opacity:0;transform:translateY(6px)}100%{opacity:1;transform:translateY(0)}}' +
      '@keyframes argoAssistantTyping{0%,60%,100%{opacity:.3}30%{opacity:1}}' +
      '@media (max-width:480px){.argo-assistant-panel{left:12px;right:12px;width:auto}}' +
      '@media print{.argo-assistant-fab,.argo-assistant-hint,.argo-assistant-panel{display:none!important}}' +
      'body.tab-focus .argo-assistant-fab,body.tab-focus .argo-assistant-hint,body.tab-focus .argo-assistant-panel{display:none}' +
      'body:has(#appRoot[data-locked="true"]) .argo-assistant-fab,'+
      'body:has(#appRoot[data-locked="true"]) .argo-assistant-hint,'+
      'body:has(#appRoot[data-locked="true"]) .argo-assistant-panel{display:none}' +
      '@media (prefers-reduced-motion:reduce){.argo-assistant-panel,.argo-assistant-fab{transition:none}'+
        '.argo-assistant-hint{animation:none}.argo-assistant-typing i{animation:none}}';

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

  // ---------------------------------------------------------------------
  // Assistente (botão flutuante + painel de conversa) — o mascote "quase
  // como um assistente dentro do app". Fica montado uma única vez e some
  // sozinho via CSS quando o app está trancado, em modo destaque ou na
  // impressão (ver ensureStyles). Tudo roda no aparelho: nenhuma pergunta
  // digitada aqui sai do navegador — quem decide as respostas é a função
  // `ask` fornecida por quem chama mountAssistant (normalmente app.js),
  // com uma base de respostas prontas sobre o próprio app.
  //
  // ArgoMascot.mountAssistant({
  //   greeting: () => 'Olá! Eu sou o Argo...',           // string ou função
  //   ask: (texto) => ({ reply, mood, quickActions }) | null,
  //   defaultQuickActions: () => [{ label, run, reply, mood }, ...]
  // })
  // → { open, close, toggle, ask(texto), say(texto, mood) }
  var assistantController = null;

  function mountAssistant(options) {
    if (assistantController) return assistantController;
    if (typeof document === 'undefined') return null;
    options = options || {};
    ensureStyles();

    var root = document.createElement('div');
    root.id = 'argoAssistantRoot';
    root.innerHTML =
      '<button type="button" id="argoAssistantFab" class="argo-assistant-fab" aria-haspopup="dialog" ' +
        'aria-expanded="false" aria-controls="argoAssistantPanel" aria-label="Abrir assistente Argo">' +
        boatSVG('info', 30) +
      '</button>' +
      '<div id="argoAssistantHint" class="argo-assistant-hint" hidden>' +
        '<span>Oi! Sou o Argo — clique aqui se precisar de ajuda 👋</span>' +
        '<button type="button" class="argo-assistant-hint-x" aria-label="Fechar dica">✕</button>' +
      '</div>' +
      '<div id="argoAssistantPanel" class="argo-assistant-panel" role="dialog" aria-modal="false" ' +
        'aria-labelledby="argoAssistantTitle" hidden>' +
        '<div class="argo-assistant-head">' +
          boatSVG('info', 32) +
          '<div class="argo-assistant-head-text"><strong id="argoAssistantTitle">Argo</strong>' +
            '<span>assistente do Argo SUAS</span></div>' +
          '<button type="button" class="argo-assistant-close" id="argoAssistantCloseBtn" aria-label="Fechar assistente">✕</button>' +
        '</div>' +
        '<div class="argo-assistant-log" id="argoAssistantLog" role="log" aria-live="polite"></div>' +
        '<div class="argo-assistant-quick" id="argoAssistantQuick"></div>' +
        '<form class="argo-assistant-form" id="argoAssistantForm">' +
          '<label for="argoAssistantInput" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap">Escreva sua pergunta para o Argo</label>' +
          '<input type="text" id="argoAssistantInput" class="argo-assistant-input" placeholder="Pergunte alguma coisa..." autocomplete="off">' +
          '<button type="submit" class="argo-assistant-send" aria-label="Enviar pergunta">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" ' +
              'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>' +
            '</svg>' +
          '</button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(root);

    var fab = root.querySelector('#argoAssistantFab');
    var hint = root.querySelector('#argoAssistantHint');
    var hintClose = root.querySelector('.argo-assistant-hint-x');
    var panel = root.querySelector('#argoAssistantPanel');
    var log = root.querySelector('#argoAssistantLog');
    var quick = root.querySelector('#argoAssistantQuick');
    var form = root.querySelector('#argoAssistantForm');
    var input = root.querySelector('#argoAssistantInput');
    var closeBtn = root.querySelector('#argoAssistantCloseBtn');

    var isOpen = false;
    var greeted = false;
    var HINT_KEY = 'argo_assistant_hint_seen_v1';

    function dismissHint() {
      hint.hidden = true;
      try { localStorage.setItem(HINT_KEY, '1'); } catch (e) { /* modo privado - ignora */ }
    }
    try {
      if (!localStorage.getItem(HINT_KEY)) {
        setTimeout(function () { if (!isOpen) hint.hidden = false; }, 1500);
        setTimeout(dismissHint, 10000);
      }
    } catch (e) { /* localStorage indisponível - sem dica, sem problema */ }
    hintClose.addEventListener('click', function (e) { e.stopPropagation(); dismissHint(); });

    function addMsg(text, who, mood) {
      if (!text) return;
      var row = document.createElement('div');
      row.className = 'argo-assistant-msg argo-assistant-msg-' + who;
      if (who === 'bot') {
        var ic = document.createElement('span');
        ic.className = 'argo-assistant-msg-icon';
        ic.innerHTML = boatSVG(mood || 'info', 24);
        row.appendChild(ic);
      }
      var bubble = document.createElement('span');
      bubble.className = 'argo-assistant-bubble';
      bubble.textContent = text; // nunca HTML: texto do usuário e respostas viram texto puro
      row.appendChild(bubble);
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
    }

    function renderQuick(actions) {
      quick.innerHTML = '';
      (actions || []).forEach(function (a) {
        if (!a || !a.label) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'argo-assistant-chip';
        btn.textContent = a.label;
        btn.addEventListener('click', function () { runAction(a); });
        quick.appendChild(btn);
      });
    }

    function runAction(a) {
      if (typeof a.run === 'function') {
        try { a.run(); } catch (e) { /* ação de navegação do app - ignora falha isolada */ }
      }
      if (a.reply) addMsg(a.reply, 'bot', a.mood);
    }

    // Pausa curtinha com "…" antes da resposta — dá a sensação de que o
    // Argo está lendo a pergunta, sem atrapalhar quem usa leitor de tela
    // (a bolha de digitação não tem texto, só é removida em seguida).
    function typingThen(cb) {
      var row = document.createElement('div');
      row.className = 'argo-assistant-msg argo-assistant-msg-bot argo-assistant-typing';
      row.innerHTML = '<span class="argo-assistant-msg-icon">' + boatSVG('info', 24) + '</span>' +
        '<span class="argo-assistant-bubble"><i></i><i></i><i></i></span>';
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
      setTimeout(function () { row.remove(); cb(); }, 380);
    }

    function defaultQuick() {
      return (typeof options.defaultQuickActions === 'function')
        ? options.defaultQuickActions()
        : (options.defaultQuickActions || []);
    }

    function ask(text) {
      text = String(text == null ? '' : text).trim();
      if (!text) return;
      addMsg(text, 'user');
      var result = (typeof options.ask === 'function') ? options.ask(text) : null;
      typingThen(function () {
        if (result && result.reply) {
          addMsg(result.reply, 'bot', result.mood);
          renderQuick(result.quickActions || defaultQuick());
        } else {
          addMsg('Não captei essa — mas posso ajudar com um destes assuntos:', 'bot', 'notfound');
          renderQuick(defaultQuick());
        }
      });
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      panel.hidden = false;
      hint.hidden = true;
      fab.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(function () { panel.classList.add('argo-assistant-open'); });
      if (!greeted) {
        greeted = true;
        var greet = (typeof options.greeting === 'function') ? options.greeting() : options.greeting;
        addMsg(greet || 'Oi! Eu sou o Argo. Como posso ajudar?', 'bot', 'success');
        renderQuick(defaultQuick());
      }
      setTimeout(function () { input.focus(); }, 180);
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      panel.classList.remove('argo-assistant-open');
      fab.setAttribute('aria-expanded', 'false');
      setTimeout(function () { if (!isOpen) panel.hidden = true; }, 200);
    }

    fab.addEventListener('click', function () { isOpen ? close() : open(); });
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) { close(); fab.focus(); }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value;
      input.value = '';
      ask(v);
    });

    assistantController = {
      open: open,
      close: close,
      toggle: function () { isOpen ? close() : open(); },
      ask: ask,
      say: function (text, mood) { addMsg(text, 'bot', mood); }
    };
    return assistantController;
  }

  return {
    notify: notify,
    dismiss: dismiss,
    emptyStateHTML: emptyStateHTML,
    mountAssistant: mountAssistant, // ArgoMascot.mountAssistant({...}) → botão flutuante + painel de conversa
    icon: boatSVG // ArgoMascot.icon('success', 48) → string SVG avulso, para usar em qualquer lugar
  };
});

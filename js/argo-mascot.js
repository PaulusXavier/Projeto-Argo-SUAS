/*!
 * ArgoMascot — mascote-barquinho (tema Argo Navis) + sistema de avisos.
 * Visual "fofinho de livro antigo": casco de madeira arredondado com friso
 * dourado, velas de pergaminho remendadas, olhos redondos com brilho,
 * bochechas rosadas, ondinhas e bandeirinha na cor do humor.
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

  // ---------------------------------------------------------------------
  // PERSONALIZAÇÃO DO COMANDANTE (o "eu dentro do barco")
  // Troque as cores abaixo para ajustar o personagem. Se tiver uma ilustração
  // pronta do mascote (PNG/SVG/WebP), coloque o arquivo na pasta do app, inclua
  // o nome dele em sw.js (lista de arquivos) e preencha CUSTOM_IMAGE_SRC —
  // o desenho abaixo passa a ser substituído pela sua imagem.
  // ---------------------------------------------------------------------
  var PILOT = { skin: '#C98E5F', skinDk: '#A8703F', hair: '#2B1B12', shirt: '#0F4A41', shirtLt: '#1C6A5C', capTop: '#FBF3DC' };
  var CUSTOM_IMAGE_SRC = ''; // ex.: 'argo-mascote.png'

  function boatSVG(mood, size) {
    mood = normalizeType(mood);
    size = size || 40;
    var accent = THEME[mood].color;
    var flagSymbol = { info: '★', error: '!', notfound: '?', success: '✓' }[mood];

    // Imagem própria (opcional): mantém só uma bolinha de humor no canto.
    if (CUSTOM_IMAGE_SRC) {
      return '<span class="argo-mascot-icon argo-mascot-bob" style="position:relative;width:' + size + 'px;height:' + size + 'px" aria-hidden="true">' +
        '<img src="' + CUSTOM_IMAGE_SRC + '" alt="" style="width:100%;height:100%;object-fit:contain;display:block">' +
        '<span style="position:absolute;right:-2px;top:-2px;min-width:38%;height:38%;border-radius:50%;background:' + accent +
        ';color:#fff;font:800 ' + Math.max(8, Math.round(size * 0.22)) + 'px/1 sans-serif;display:flex;align-items:center;justify-content:center">' + flagSymbol + '</span></span>';
    }

    // Paleta "de livro antigo": madeira quente, pergaminho, ouro envelhecido
    // e contornos em marrom-escuro (nada de neon, metal ou ângulos retos).
    var INK = '#5A3118', WOOD = '#C98A4B', WOOD_DK = '#8A5128', WOOD_LT = '#E0A767',
        GOLD = '#F2B84B', GOLD_DK = '#B9801F', PARCH = '#F8EACB', PARCH_DK = '#EBD3A0',
        BLUSH = '#FF8FA3', SEA = '#6EC1E4', EYE = '#3B2314', MOUTH = '#8E3B3B';

    // IDs únicos por chamada: dois mascotes na mesma página não podem
    // compartilhar o mesmo id de gradiente.
    mascotUid += 1;
    var hullGradId = 'argoMascot' + mascotUid + 'Hull';

    function stroke(d, w, col) {
      return '<path d="' + d + '" fill="none" stroke="' + (col || EYE) + '" stroke-width="' + (w || 2.2) + '" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    function eye(cx, cy, r) {
      return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + EYE + '"/>' +
             '<circle cx="' + (cx + r * 0.35) + '" cy="' + (cy - r * 0.38) + '" r="' + (r * 0.36) + '" fill="#fff"/>';
    }
    function hand(cx, cy) {
      return '<circle cx="' + cx + '" cy="' + cy + '" r="4.6" fill="' + PILOT.skin + '" stroke="' + INK + '" stroke-width="1.8"/>';
    }
    // Braço: contorno escuro + manga da camisa, do ombro até a mão.
    function arm(x1, y1, x2, y2) {
      var d = 'M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2;
      return '<path d="' + d + '" stroke="' + INK + '" stroke-width="9" stroke-linecap="round" fill="none"/>' +
             '<path d="' + d + '" stroke="' + PILOT.shirt + '" stroke-width="5.6" stroke-linecap="round" fill="none"/>' +
             hand(x2, y2);
    }

    // ---- Rosto e pose por humor ----
    var cheeks =
      '<ellipse cx="31.5" cy="44.2" rx="3.4" ry="2.2" fill="' + BLUSH + '" opacity=".7"/>' +
      '<ellipse cx="52.5" cy="44.2" rx="3.4" ry="2.2" fill="' + BLUSH + '" opacity=".7"/>';
    var face, arms, extra = '';

    if (mood === 'success') {
      face = stroke('M33.2 39.6 Q36.5 34.4 39.8 39.6', 2.2) + stroke('M44.2 39.6 Q47.5 34.4 50.8 39.6', 2.2) +
        '<path d="M36.8 43.6 Q42 54 47.2 43.6 Z" fill="' + MOUTH + '" stroke="' + EYE + '" stroke-width="1.8" stroke-linejoin="round"/>' +
        '<path d="M39.6 48.6 Q42 46.2 44.4 48.6 Q42 51 39.6 48.6 Z" fill="' + BLUSH + '"/>';
      arms = '<g class="argo-mascot-wave2">' + arm(24, 62, 13, 41) + '</g>' +
             '<g class="argo-mascot-wave">' + arm(60, 62, 71, 41) + '</g>';
      extra =
        '<path d="M14 18 Q15 23 20 24 Q15 25 14 30 Q13 25 8 24 Q13 23 14 18 Z" fill="' + GOLD + '" stroke="' + GOLD_DK + '" stroke-width="1" stroke-linejoin="round"/>' +
        '<path d="M78 5 Q79 9 83 10 Q79 11 78 15 Q77 11 73 10 Q77 9 78 5 Z" fill="' + GOLD + '" stroke="' + GOLD_DK + '" stroke-width="1" stroke-linejoin="round"/>';
    } else if (mood === 'error') {
      face = '<g class="argo-mascot-blink">' + eye(36.5, 39, 2.6) + eye(47.5, 39, 2.6) + '</g>' +
        stroke('M32 33.6 L39.6 35.8', 2) + stroke('M52 33.6 L44.4 35.8', 2) +
        stroke('M38 48.2 Q42 43.6 46 48.2', 2.2) +
        '<path d="M33 43.4 Q30.4 47 33 49.4 Q35.6 47 33 43.4 Z" fill="#8FD3F4" stroke="' + EYE + '" stroke-width="1" stroke-opacity=".5"/>';
      arms = arm(23, 63, 21, 61) + arm(61, 63, 63, 61);
      extra = '<path d="M58 22 Q55.6 26 58 28.6 Q60.4 26 58 22 Z" fill="#8FD3F4" stroke="' + EYE + '" stroke-width="1" stroke-opacity=".5"/>';
    } else if (mood === 'notfound') {
      face = '<g class="argo-mascot-blink">' + eye(36.5, 39, 2.3) + eye(47.5, 38.6, 3.2) + '</g>' +
        stroke('M44 32.6 Q47.6 29.4 51.6 32.6', 2) +
        '<ellipse cx="42" cy="46.4" rx="2.3" ry="2.9" fill="' + MOUTH + '" stroke="' + EYE + '" stroke-width="1.8"/>';
      arms = arm(23, 63, 21, 61) + arm(61, 62, 53.5, 50.5);
    } else { // info
      face = '<g class="argo-mascot-blink">' + eye(36.5, 39, 2.7) + eye(47.5, 39, 2.7) + '</g>' +
        stroke('M37.4 44.4 Q42 49.2 46.6 44.4', 2.2);
      arms = arm(23, 63, 21, 61) + '<g class="argo-mascot-wave">' + arm(60, 62, 70.5, 43) + '</g>';
    }

    // ---- Comandante: orelhas, cabeça, cabelo, rosto, boné com Ψ ----
    var pilot =
      // camisa (a parte de baixo fica escondida atrás do casco)
      '<path d="M18 74 Q18 53 42 52 Q66 53 66 74 Z" fill="' + PILOT.shirt + '" stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<path d="M34 52.6 Q42 60 50 52.6" fill="none" stroke="' + PILOT.shirtLt + '" stroke-width="3" stroke-linecap="round"/>' +
      // pescoço, orelhas e cabeça
      '<rect x="37.5" y="47" width="9" height="8" rx="3" fill="' + PILOT.skinDk + '"/>' +
      '<ellipse cx="27" cy="39.5" rx="2.6" ry="3.6" fill="' + PILOT.skin + '" stroke="' + INK + '" stroke-width="1.6"/>' +
      '<ellipse cx="57" cy="39.5" rx="2.6" ry="3.6" fill="' + PILOT.skin + '" stroke="' + INK + '" stroke-width="1.6"/>' +
      '<circle cx="42" cy="37" r="15" fill="' + PILOT.skin + '" stroke="' + INK + '" stroke-width="2.4"/>' +
      // costeletas sob o boné
      '<path d="M27.6 30 Q26.2 38 29.4 41 Q29.8 35 31.6 29.6 Z" fill="' + PILOT.hair + '"/>' +
      '<path d="M56.4 30 Q57.8 38 54.6 41 Q54.2 35 52.4 29.6 Z" fill="' + PILOT.hair + '"/>' +
      cheeks + face +
      // boné de comandante: copa clara, faixa, viseira e emblema Ψ dourado
      '<path d="M26 30 Q25.5 11 42 10 Q58.5 11 58 30 Q42 25.5 26 30 Z" fill="' + PILOT.capTop + '" stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<path d="M26.2 27.6 Q42 23.4 57.8 27.6 L58 30.6 Q42 26.6 26 30.6 Z" fill="' + PILOT.shirt + '" stroke="' + INK + '" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<path d="M26.5 31 Q42 36 57.5 31 Q58.5 28.6 56 28.4 Q42 24.6 28 28.4 Q25.5 28.6 26.5 31 Z" fill="' + WOOD_DK + '" stroke="' + INK + '" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<circle cx="42" cy="18.4" r="5.4" fill="' + GOLD + '" stroke="' + INK + '" stroke-width="1.6"/>' +
      '<path d="M39.2 14.6 Q39.2 20.6 42 20.6 Q44.8 20.6 44.8 14.6 M42 13.8 V22.6" fill="none" stroke="' + INK + '" stroke-width="1.35" stroke-linecap="round"/>' +
      arms;

    var bob = mood === 'error' ? '' : ' argo-mascot-bob';
    var wave = 'q7.5 -5 15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0';
    var HULL_DY = 8; // casco um pouco mais baixo: o comandante aparece da cintura para cima

    return (
      '<svg class="argo-mascot-icon' + bob + '" width="' + size + '" height="' + size +
      '" viewBox="0 0 130 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
        '<defs>' +
          '<linearGradient id="' + hullGradId + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="' + WOOD_LT + '"/>' +
            '<stop offset="100%" stop-color="' + WOOD + '"/>' +
          '</linearGradient>' +
        '</defs>' +
        // ondinha de fundo
        '<path d="M5 105 ' + wave + '" fill="none" stroke="' + SEA + '" stroke-width="3" stroke-linecap="round" opacity=".55"/>' +
        // mastro à direita, com bolinha dourada no topo
        '<line x1="104" y1="68" x2="104" y2="6" stroke="' + INK + '" stroke-width="5.4" stroke-linecap="round"/>' +
        '<line x1="104" y1="68" x2="104" y2="6" stroke="' + WOOD_DK + '" stroke-width="2.6" stroke-linecap="round"/>' +
        // vela grande (atrás do comandante) e vela pequena, de pergaminho remendado
        '<path d="M100 14 C82 16 70 30 72 54 Q87 59 100 55 Z" fill="' + PARCH + '" stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round"/>' +
        '<path d="M96 28 Q84 30 77 38" fill="none" stroke="' + WOOD_DK + '" stroke-width="1.2" stroke-dasharray="2 3" stroke-linecap="round" opacity=".6"/>' +
        '<path d="M108 18 Q119 32 121 52 L108 52 Z" fill="' + PARCH_DK + '" stroke="' + INK + '" stroke-width="2.2" stroke-linejoin="round"/>' +
        // remendo costurado na cor do humor
        '<rect x="82" y="34" width="12" height="12" rx="3" fill="' + accent + '" transform="rotate(-8 88 40)"/>' +
        '<rect x="83.6" y="35.6" width="8.8" height="8.8" rx="2" fill="none" stroke="#fff" stroke-width="1" stroke-dasharray="1.6 1.6" opacity=".85" transform="rotate(-8 88 40)"/>' +
        // o comandante
        pilot +
        // casco (proa/popa enroladinhas, madeira, friso dourado), deslocado para baixo
        '<g transform="translate(0 ' + HULL_DY + ')">' +
          '<path d="M14 60 Q2 58 4 44" fill="none" stroke="' + INK + '" stroke-width="7" stroke-linecap="round"/>' +
          '<path d="M14 60 Q2 58 4 44" fill="none" stroke="' + WOOD + '" stroke-width="3.6" stroke-linecap="round"/>' +
          '<path d="M116 60 Q128 58 126 44" fill="none" stroke="' + INK + '" stroke-width="7" stroke-linecap="round"/>' +
          '<path d="M116 60 Q128 58 126 44" fill="none" stroke="' + WOOD + '" stroke-width="3.6" stroke-linecap="round"/>' +
          '<circle cx="4" cy="42" r="3.6" fill="' + GOLD + '" stroke="' + INK + '" stroke-width="1.6"/>' +
          '<circle cx="126" cy="42" r="3.6" fill="' + GOLD + '" stroke="' + INK + '" stroke-width="1.6"/>' +
          '<path d="M11 60 H119 C118 82 106 99 86 101 H44 C24 99 12 82 11 60 Z" fill="url(#' + hullGradId + ')" stroke="' + INK + '" stroke-width="2.8" stroke-linejoin="round"/>' +
          '<path d="M15 71 H115 M20 82 H110 M30 92 H100" stroke="' + WOOD_DK + '" stroke-width="1.3" stroke-linecap="round" opacity=".55"/>' +
          '<rect x="8" y="54" width="114" height="10" rx="5" fill="' + GOLD + '" stroke="' + INK + '" stroke-width="2.4"/>' +
          '<path d="M16 57.4 H114" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".45"/>' +
          '<circle cx="22" cy="60" r="1.3" fill="' + GOLD_DK + '"/><circle cx="43" cy="60" r="1.3" fill="' + GOLD_DK + '"/>' +
          '<circle cx="87" cy="60" r="1.3" fill="' + GOLD_DK + '"/><circle cx="108" cy="60" r="1.3" fill="' + GOLD_DK + '"/>' +
        '</g>' +
        // ondinhas da frente com espuma
        '<path d="M5 106 ' + wave + ' C125 113 100 116 65 116 C30 116 5 113 5 106 Z" fill="' + SEA + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round" opacity=".92"/>' +
        '<path d="M10 108.4 q5 -3 10 0 M52 108.4 q5 -3 10 0 M96 108.4 q5 -3 10 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>' +
        // bandeirinha de ponta, balançando
        '<g class="argo-mascot-flag">' +
          '<path d="M106 3 H126 L121.5 8.5 L126 14 H106 Z" fill="' + accent + '" stroke="' + INK + '" stroke-width="1.8" stroke-linejoin="round"/>' +
          '<text x="114.5" y="11.6" font-size="8.5" font-weight="800" fill="#fff" text-anchor="middle" font-family="Trebuchet MS,Verdana,sans-serif">' + flagSymbol + '</text>' +
        '</g>' +
        '<circle cx="104" cy="6" r="3.2" fill="' + GOLD + '" stroke="' + INK + '" stroke-width="1.6"/>' +
        extra +
      '</svg>'
    );
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = '' +
      '.argo-mascot-icon{display:block;overflow:visible}' +
      '.argo-mascot-bob{animation:argoMascotBob 3.2s ease-in-out infinite}' +
      '@keyframes argoMascotBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}' +
      '.argo-mascot-flag{transform-origin:106px 8.5px;animation:argoMascotFlag 2.4s ease-in-out infinite}' +
      '.argo-mascot-wave{transform-origin:60px 62px;animation:argoMascotWave 1.8s ease-in-out infinite}' +
      '.argo-mascot-wave2{transform-origin:24px 62px;animation:argoMascotWave2 1.8s ease-in-out infinite .25s}' +
      '@keyframes argoMascotWave{0%,100%{transform:rotate(0)}50%{transform:rotate(-14deg)}}' +
      '@keyframes argoMascotWave2{0%,100%{transform:rotate(0)}50%{transform:rotate(14deg)}}' +
      '.argo-mascot-blink{transform-origin:42px 39px;animation:argoMascotBlink 5s infinite}' +
      '@keyframes argoMascotBlink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}' +
      '@keyframes argoMascotFlag{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}' +
      '@media (prefers-reduced-motion: reduce){.argo-mascot-bob,.argo-mascot-flag,.argo-mascot-wave,.argo-mascot-wave2,.argo-mascot-blink{animation:none}.argo-mascot-toast{transition:none}}' +
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
        'padding:0;cursor:pointer;z-index:9997;transition:transform .18s ease;touch-action:manipulation}' +
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
      // Área de toque maior (mínimo 36px) e touch-action:manipulation: sem
      // isso, alguns navegadores de celular esperam ~300ms antes de disparar
      // o clique (para diferenciar de duplo-toque/zoom), o que pode parecer
      // "o X não responde" quando na verdade só está atrasado. position:
      // relative + z-index garantem que o botão sempre fique por cima de
      // qualquer conteúdo do cabeçalho, mesmo que algo mude ali no futuro.
      '.argo-assistant-close{position:relative;z-index:2;flex:0 0 auto;min-width:36px;min-height:36px;'+
        'display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:inherit;'+
        'opacity:.6;cursor:pointer;font-size:15px;padding:6px 8px;border-radius:8px;touch-action:manipulation}' +
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

      // BUG do X que "não some": o balão e o painel têm display:flex, e uma regra de autor
      // com display vence o [hidden] padrão do navegador (display:none). Resultado: o JS
      // marcava hint.hidden = true, mas o balão continuava na tela. Esta regra devolve
      // ao atributo hidden a força que ele deveria ter.
      '.argo-assistant-hint[hidden],.argo-assistant-panel[hidden]{display:none!important}' +
      '@keyframes argoAssistantIn{0%{opacity:0;transform:translateY(6px)}100%{opacity:1;transform:translateY(0)}}' +
      '@keyframes argoAssistantTyping{0%,60%,100%{opacity:.3}30%{opacity:1}}' +
      '@media (max-width:480px){.argo-assistant-panel{left:12px;right:12px;width:auto}}' +
      '@media print{.argo-assistant-fab,.argo-assistant-hint,.argo-assistant-panel{display:none!important}}' +
      'body.tab-focus .argo-assistant-hint{display:none}' +
      'body.tab-focus .argo-assistant-fab{width:48px;height:48px}' +
      'body.tab-focus .argo-assistant-fab .argo-mascot-icon{width:30px;height:30px}' +
      'body.tab-focus .content-area{padding-bottom:calc(5.5rem + env(safe-area-inset-bottom))!important}' +
      '.argo-assistant-fab:focus-visible,.argo-assistant-chip:focus-visible,.argo-assistant-close:focus-visible{outline:3px solid var(--brand-primary,#0091C2);outline-offset:2px}' +
      '.argo-assistant-chip-menu{opacity:.85;border-style:dashed}' +
      '.argo-assistant-kbd{display:inline-block;border:1px solid rgba(127,127,127,.45);border-radius:5px;padding:0 5px;font-size:11px;font-weight:700;margin:0 1px}' +
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
  // impressão (ver ensureStyles). Este arquivo não envia nada para a rede:
  // quem decide as respostas é a função `ask` fornecida por quem chama
  // mountAssistant (normalmente app.js). Ela pode devolver o resultado na
  // hora ou uma Promise (resposta de IA opcional, ver "IA NO MASCOTE ARGO"
  // em app.js — lá está o que é enviado e o filtro de dados pessoais).
  //
  // ArgoMascot.mountAssistant({
  //   greeting: () => 'Olá! Eu sou o Argo...',           // string ou função
  //   ask: (texto) => ({ reply, mood, quickActions }) | null | Promise<mesmo formato>,
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
        '<span>Oi! Sou o Argo. Precisando achar algo, é só me chamar — ou tecle <b class="argo-assistant-kbd">?</b></span>' +
        '<button type="button" class="argo-assistant-hint-x" aria-label="Fechar dica">✕</button>' +
      '</div>' +
      '<div id="argoAssistantPanel" class="argo-assistant-panel" role="dialog" aria-modal="false" ' +
        'aria-labelledby="argoAssistantTitle" hidden>' +
        '<div class="argo-assistant-head">' +
          boatSVG('info', 32) +
          '<div class="argo-assistant-head-text"><strong id="argoAssistantTitle">Argo</strong>' +
            '<span>seu guia a bordo do Argo SUAS</span></div>' +
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
    // A dica só começa a contar depois que o app foi desbloqueado e o cartão de
    // saudação foi fechado. Antes, os 10 s corriam ainda na tela de login e a
    // dica era dada como "vista" sem ninguém ter visto.
    function armHint() {
      var poll = setInterval(function () {
        var r = document.getElementById('appRoot');
        if (r && r.dataset.locked === 'true') return;
        if (document.querySelector('.argo-greeting-overlay.visible')) return;
        clearInterval(poll);
        setTimeout(function () { if (!isOpen) hint.hidden = false; }, 1200);
        setTimeout(dismissHint, 10000);
      }, 500);
    }
    try {
      if (!localStorage.getItem(HINT_KEY)) armHint();
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
        btn.className = 'argo-assistant-chip' + (a.menu ? ' argo-assistant-chip-menu' : '');
        btn.textContent = a.label;
        btn.addEventListener('click', function () {
          if (a.menu) { addMsg('Claro! Por onde quer seguir?', 'bot', 'info'); renderQuick(defaultQuick()); return; }
          runAction(a);
        });
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

    // Mostra a resposta (ou o "não entendi") e os atalhos que a acompanham.
    function showAnswer(result) {
      if (result && result.reply) {
        addMsg(result.reply, 'bot', result.mood);
        var acts = (result.quickActions || defaultQuick()).slice();
        // Quando a resposta trouxe um atalho específico, oferece voltar ao menu.
        if (result.quickActions && result.quickActions.length) acts.push({ label: 'Mais assuntos', menu: true });
        renderQuick(acts);
      } else {
        addMsg('Hmm, essa eu não entendi bem. Tente com outras palavras ou escolha um destes caminhos:', 'bot', 'notfound');
        renderQuick(defaultQuick());
      }
    }

    // Igual ao typingThen, mas espera uma Promise (resposta de IA): o "…" fica
    // até a resposta chegar. Se a Promise falhar, cai no "não entendi".
    function typingWhile(promise, cb) {
      var row = document.createElement('div');
      row.className = 'argo-assistant-msg argo-assistant-msg-bot argo-assistant-typing';
      row.innerHTML = '<span class="argo-assistant-msg-icon">' + boatSVG('info', 24) + '</span>' +
        '<span class="argo-assistant-bubble"><i></i><i></i><i></i></span>';
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
      var done = false;
      function fin(res) { if (done) return; done = true; row.remove(); cb(res); }
      promise.then(fin, function () { fin(null); });
    }

    function ask(text) {
      text = String(text == null ? '' : text).trim();
      if (!text) return;
      addMsg(text, 'user');
      var result = (typeof options.ask === 'function') ? options.ask(text) : null;
      if (result && typeof result.then === 'function') {
        typingWhile(result, showAnswer);
      } else {
        typingThen(function () { showAnswer(result); });
      }
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
    closeBtn.addEventListener('click', function (e) { e.stopPropagation(); close(); try { fab.focus(); } catch (err) { /* ignora */ } });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) { close(); fab.focus(); }
    });
    // Reforço: tocar/clicar fora do painel também fecha (como já acontece
    // no cartão de saudação). Mesmo com o X funcionando, isso dá uma
    // segunda forma de fechar, útil se algum dia outro elemento acabar
    // sobrepondo o botão.
    document.addEventListener('click', function (e) {
      if (!isOpen) return;
      if (panel.contains(e.target) || fab.contains(e.target)) return;
      close();
    });
    var history = [], histPos = 0;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value;
      input.value = '';
      if (v.trim()) { history.push(v); histPos = history.length; }
      ask(v);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp' && history.length) {
        e.preventDefault(); histPos = Math.max(0, histPos - 1); input.value = history[histPos];
      } else if (e.key === 'ArrowDown' && history.length) {
        e.preventDefault(); histPos = Math.min(history.length, histPos + 1); input.value = history[histPos] || '';
      }
    });
    // Atalho "?" (fora de campos de texto) abre/fecha o assistente.
    document.addEventListener('keydown', function (e) {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable)) return;
      var r = document.getElementById('appRoot');
      if (r && r.dataset.locked === 'true') return;
      e.preventDefault();
      isOpen ? close() : open();
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
    icon: function (mood, size) { ensureStyles(); return boatSVG(mood, size); } // ArgoMascot.icon('success', 48) → string SVG avulso
  };
});

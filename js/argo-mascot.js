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
        'width:min(380px,calc(100vw - 32px));max-height:min(74vh,600px);display:flex;flex-direction:column;overflow:hidden;'+
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
      '.argo-assistant-msg{display:flex;gap:8px;max-width:96%;min-width:0}' +
      '.argo-assistant-msg-bot{align-self:flex-start}' +
      '.argo-assistant-msg-user{align-self:flex-end;flex-direction:row-reverse}' +
      '.argo-assistant-msg-icon{flex:0 0 auto;width:24px;height:24px;margin-top:3px}' +
      '.argo-assistant-msg-icon .argo-mascot-icon{width:24px;height:24px}' +
      '.argo-assistant-bubble{font-size:13px;line-height:1.45;padding:9px 12px;border-radius:14px;white-space:pre-line;word-break:break-word}' +
      '.argo-assistant-bubble.argo-md{white-space:normal}' +
      '.argo-md p{margin:0 0 6px}.argo-md p:last-child,.argo-md ul:last-child,.argo-md ol:last-child{margin-bottom:0}' +
      '.argo-md ul,.argo-md ol{margin:0 0 6px;padding-left:18px}.argo-md li{margin:2px 0}' +
      '.argo-assistant-col{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}' +
      '.argo-assistant-streaming::after{content:"";display:inline-block;width:6px;height:13px;margin-left:2px;vertical-align:-2px;background:currentColor;opacity:.5;animation:argoAssistantTyping 1s steps(2) infinite}' +
      '.argo-assistant-badge{align-self:flex-start;font-size:10.5px;font-weight:800;letter-spacing:.02em;padding:2px 8px;border-radius:20px;background:rgba(0,145,194,.14);color:var(--brand-primary,#0091C2)}' +
      '.argo-assistant-badge-alerta{background:rgba(185,28,28,.16);color:#DC2626}.argo-assistant-badge-basesuas{background:rgba(21,128,61,.16);color:#16A34A}' +
      '.argo-assistant-note{font-size:11px;color:var(--text-muted,#A7B7CC);padding:0 4px}' +
      '.argo-assistant-units{display:flex;flex-direction:column;gap:6px}' +
      '.argo-assistant-unit{border:1px solid rgba(127,127,127,.28);border-radius:12px;padding:8px 10px;display:flex;flex-direction:column;gap:3px;font-size:12px}' +
      '.argo-assistant-unit strong{font-size:13px}.argo-assistant-unit-group{font-size:10.5px;color:var(--text-muted,#A7B7CC)}' +
      '.argo-assistant-unit-line{line-height:1.35}' +
      '.argo-assistant-unit-actions,.argo-assistant-msg-actions{display:flex;flex-wrap:wrap;gap:5px;margin-top:3px}' +
      '.argo-assistant-mini{border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font:600 11.5px/1 inherit;padding:6px 9px;border-radius:16px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;min-height:28px}' +
      '.argo-assistant-mini:hover{background:rgba(0,145,194,.14);border-color:var(--brand-primary,#0091C2)}' +
      '.argo-assistant-mini-ghost{border-color:transparent;opacity:.75}.argo-assistant-mini-ghost:hover{opacity:1}.argo-assistant-mini.is-on{background:rgba(0,145,194,.2);opacity:1}' +
      '.argo-assistant-mini:disabled{cursor:default;opacity:.5}' +
      '.argo-assistant-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
      '.argo-assistant-tool{flex:0 0 auto;min-width:32px;min-height:32px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:inherit;opacity:.6;cursor:pointer;border-radius:8px;padding:6px;touch-action:manipulation}' +
      '.argo-assistant-tool:hover{opacity:1;background:rgba(127,127,127,.14)}' +
      '.argo-assistant-led{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;background:#16A34A;vertical-align:1px}' +
      '.argo-assistant-status-warn .argo-assistant-led{background:#D97706}.argo-assistant-status-off .argo-assistant-led{background:#9CA3AF}' +
      '.argo-assistant-head-text span em{font-style:normal}' +
      '.argo-assistant-dot{position:absolute;top:2px;right:2px;width:12px;height:12px;border-radius:50%;background:#DC2626;border:2px solid var(--bg-card,#151F35)}' +
      '.argo-assistant-fab{position:fixed}.argo-assistant-fab.argo-assistant-busy{box-shadow:0 0 0 3px rgba(0,145,194,.35),var(--shadow-lg,0 24px 48px -12px rgba(0,0,0,.4));animation:argoAssistantPulse 1.4s ease-in-out infinite}' +
      '@keyframes argoAssistantPulse{0%,100%{box-shadow:0 0 0 2px rgba(0,145,194,.2)}50%{box-shadow:0 0 0 7px rgba(0,145,194,.3)}}' +
      '.argo-assistant-panel.argo-assistant-wide{width:min(560px,calc(100vw - 32px));max-height:min(86vh,760px)}' +
      '.argo-assistant-field{position:relative;flex:1;min-width:0;display:flex}.argo-assistant-count{position:absolute;right:10px;bottom:-1px;font-size:10px;color:var(--text-muted,#A7B7CC);background:var(--bg-card,#151F35);padding:0 3px}' +
      '.argo-assistant-send.is-stop{background:#DC2626}' +
      '.argo-assistant-chip-ask{border-style:dotted}' +
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
        'border-radius:18px;padding:8px 14px;font-size:13px;line-height:1.35;outline:none;font-family:inherit;resize:none;max-height:96px;width:100%;box-sizing:border-box}' +
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
      '.argo-assistant-fab:focus-visible,.argo-assistant-chip:focus-visible,.argo-assistant-close:focus-visible,.argo-assistant-tool:focus-visible,.argo-assistant-mini:focus-visible,.argo-assistant-input:focus-visible{outline:3px solid var(--brand-primary,#0091C2);outline-offset:2px}' +
      '.argo-assistant-chip-menu{opacity:.85;border-style:dashed}' +
      '.argo-assistant-kbd{display:inline-block;border:1px solid rgba(127,127,127,.45);border-radius:5px;padding:0 5px;font-size:11px;font-weight:700;margin:0 1px}' +
      'body:has(#appRoot[data-locked="true"]) .argo-assistant-fab,'+
      'body:has(#appRoot[data-locked="true"]) .argo-assistant-hint,'+
      'body:has(#appRoot[data-locked="true"]) .argo-assistant-panel{display:none}' +
      '@media (prefers-reduced-motion:reduce){.argo-assistant-panel,.argo-assistant-fab{transition:none}'+
        '.argo-assistant-hint{animation:none}.argo-assistant-typing i,.argo-assistant-streaming::after,.argo-assistant-busy{animation:none}}';

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
  // mountAssistant (normalmente app.js, com o ArgoCerebro).
  //
  // ArgoMascot.mountAssistant({
  //   greeting: () => 'Olá! Eu sou o Argo...',           // string ou função
  //   ask: (texto, meta) => resultado | null | Promise<resultado>,
  //   defaultQuickActions: () => [{ label, run, reply, mood }, ...],
  //   onUnit: (unidade) => {},                           // botão "Ver ficha" dos cartões
  //   onReset: () => {},                                 // "Nova conversa"
  //   status: () => ({ text, level: 'ok' | 'warn' | 'off' })
  // })
  //
  // resultado = {
  //   reply, mood, badge,                // texto (mini-markdown: **negrito**, "- " listas)
  //   note,                              // linha pequena (base legal, aviso)
  //   units: [{ name, group, address, hours, phones, phoneLinks:[{label,href}], ... }],
  //   quickActions: [{ label, run, reply, mood, menu }],
  //   followups: ['pergunta sugerida', ...],
  //   stream: { run(onDelta, signal) → Promise<texto | {text, units, note, ...}>, fallback: resultado }
  // }
  // → { open, close, toggle, ask(texto), say(texto, mood), reset(), refreshStatus() }
  var assistantController = null;

  // Mini-markdown seguro: só **negrito**, listas "- " / "1. " e parágrafos.
  // Tudo vira nó de texto (nunca HTML), então nada vindo da IA executa.
  function renderMd(text, target) {
    target.textContent = '';
    var lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
    var list = null, listType = '';
    function inline(parent, str) {
      var parts = str.split(/(\*\*[^*]+\*\*)/);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (!p) continue;
        if (/^\*\*[^*]+\*\*$/.test(p)) { var b = document.createElement('strong'); b.textContent = p.slice(2, -2); parent.appendChild(b); }
        else parent.appendChild(document.createTextNode(p.replace(/\*\*/g, '')));
      }
    }
    function endList() { list = null; listType = ''; }
    lines.forEach(function (ln) {
      var m = ln.match(/^\s*(?:[-•]\s+|(\d{1,2})[.)]\s+)(.*)$/);
      if (m && m[2].trim()) {
        var type = m[1] ? 'ol' : 'ul';
        if (!list || listType !== type) { list = document.createElement(type); listType = type; target.appendChild(list); }
        var li = document.createElement('li'); inline(li, m[2].trim()); list.appendChild(li);
        return;
      }
      endList();
      if (!ln.trim()) return;
      var p = document.createElement('p'); inline(p, ln.trim()); target.appendChild(p);
    });
    if (!target.firstChild) target.textContent = String(text || '');
  }
  function plainText(text) {
    return String(text == null ? '' : text).replace(/\*\*/g, '').replace(/^\s*[-•]\s+/gm, '• ').trim();
  }

  function mountAssistant(options) {
    if (assistantController) return assistantController;
    if (typeof document === 'undefined') return null;
    options = options || {};
    ensureStyles();

    var svgSend = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
    var svgStop = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>';

    var root = document.createElement('div');
    root.id = 'argoAssistantRoot';
    root.innerHTML =
      '<button type="button" id="argoAssistantFab" class="argo-assistant-fab" aria-haspopup="dialog" ' +
        'aria-expanded="false" aria-controls="argoAssistantPanel" aria-label="Abrir assistente Argo">' +
        boatSVG('info', 30) + '<span class="argo-assistant-dot" hidden></span>' +
      '</button>' +
      '<div id="argoAssistantHint" class="argo-assistant-hint" hidden>' +
        '<span>Oi! Sou o Argo. Pergunte do seu jeito — unidades, fluxos, dúvidas do SUAS — ou tecle <b class="argo-assistant-kbd">?</b></span>' +
        '<button type="button" class="argo-assistant-hint-x" aria-label="Fechar dica">✕</button>' +
      '</div>' +
      '<div id="argoAssistantPanel" class="argo-assistant-panel" role="dialog" aria-modal="false" ' +
        'aria-labelledby="argoAssistantTitle" hidden>' +
        '<div class="argo-assistant-head">' +
          boatSVG('info', 32) +
          '<div class="argo-assistant-head-text"><strong id="argoAssistantTitle">Argo</strong>' +
            '<span id="argoAssistantStatus"><i class="argo-assistant-led" aria-hidden="true"></i><em>seu guia a bordo do Argo SUAS</em></span></div>' +
          '<button type="button" class="argo-assistant-tool" id="argoAssistantNew" aria-label="Nova conversa" title="Nova conversa">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/></svg></button>' +
          '<button type="button" class="argo-assistant-tool argo-assistant-wide-btn" id="argoAssistantWide" aria-label="Ampliar painel" aria-pressed="false" title="Ampliar">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>' +
          '<button type="button" class="argo-assistant-close" id="argoAssistantCloseBtn" aria-label="Fechar assistente">✕</button>' +
        '</div>' +
        '<div class="argo-assistant-log" id="argoAssistantLog" role="log" aria-live="off"></div>' +
        '<div class="argo-assistant-sr" id="argoAssistantSr" role="status" aria-live="polite"></div>' +
        '<div class="argo-assistant-quick" id="argoAssistantQuick"></div>' +
        '<form class="argo-assistant-form" id="argoAssistantForm">' +
          '<label for="argoAssistantInput" class="argo-assistant-sr">Escreva sua pergunta para o Argo</label>' +
          '<div class="argo-assistant-field">' +
            '<textarea id="argoAssistantInput" class="argo-assistant-input" rows="1" maxlength="500" placeholder="Pergunte alguma coisa..." autocomplete="off" enterkeyhint="send"></textarea>' +
            '<span class="argo-assistant-count" id="argoAssistantCount" hidden></span>' +
          '</div>' +
          '<button type="submit" class="argo-assistant-send" id="argoAssistantSend" aria-label="Enviar pergunta">' + svgSend + '</button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(root);

    var fab = root.querySelector('#argoAssistantFab');
    var dot = root.querySelector('.argo-assistant-dot');
    var hint = root.querySelector('#argoAssistantHint');
    var hintClose = root.querySelector('.argo-assistant-hint-x');
    var panel = root.querySelector('#argoAssistantPanel');
    var log = root.querySelector('#argoAssistantLog');
    var sr = root.querySelector('#argoAssistantSr');
    var quick = root.querySelector('#argoAssistantQuick');
    var form = root.querySelector('#argoAssistantForm');
    var input = root.querySelector('#argoAssistantInput');
    var count = root.querySelector('#argoAssistantCount');
    var sendBtn = root.querySelector('#argoAssistantSend');
    var closeBtn = root.querySelector('#argoAssistantCloseBtn');
    var newBtn = root.querySelector('#argoAssistantNew');
    var wideBtn = root.querySelector('#argoAssistantWide');
    var statusEl = root.querySelector('#argoAssistantStatus');

    var isOpen = false, greeted = false, busy = false, abortCtl = null, lastQuestion = '', runId = 0;
    var HINT_KEY = 'argo_assistant_hint_seen_v2', WIDE_KEY = 'argo_assistant_wide_v1';

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
      if (localStorage.getItem(WIDE_KEY) === '1') setWide(true);
    } catch (e) { /* localStorage indisponível - sem dica, sem problema */ }
    hintClose.addEventListener('click', function (e) { e.stopPropagation(); dismissHint(); });

    function setWide(on) {
      panel.classList.toggle('argo-assistant-wide', !!on);
      wideBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      wideBtn.setAttribute('aria-label', on ? 'Reduzir painel' : 'Ampliar painel');
      wideBtn.title = on ? 'Reduzir' : 'Ampliar';
    }

    // ---------- status (online/IA) ----------
    function refreshStatus() {
      var st = { text: 'seu guia a bordo do Argo SUAS', level: 'ok' };
      try { if (typeof options.status === 'function') st = options.status() || st; } catch (e) { /* mantém o padrão */ }
      statusEl.querySelector('em').textContent = st.text;
      statusEl.className = 'argo-assistant-status-' + (st.level || 'ok');
    }
    window.addEventListener('online', refreshStatus);
    window.addEventListener('offline', refreshStatus);

    // ---------- mensagens ----------
    function scrollDown() { log.scrollTop = log.scrollHeight; }
    function announce(text) { sr.textContent = ''; setTimeout(function () { sr.textContent = plainText(text).slice(0, 700); }, 30); }

    function makeBotRow(mood) {
      var row = document.createElement('div');
      row.className = 'argo-assistant-msg argo-assistant-msg-bot';
      var ic = document.createElement('span');
      ic.className = 'argo-assistant-msg-icon';
      ic.innerHTML = boatSVG(mood || 'info', 24);
      var col = document.createElement('div');
      col.className = 'argo-assistant-col';
      row.appendChild(ic); row.appendChild(col);
      return { row: row, col: col, icon: ic };
    }

    function addMsg(text, who, mood) {
      if (!text) return null;
      if (who === 'user') {
        var urow = document.createElement('div');
        urow.className = 'argo-assistant-msg argo-assistant-msg-user';
        var ub = document.createElement('span');
        ub.className = 'argo-assistant-bubble';
        ub.textContent = text; // nunca HTML: texto do usuário vira texto puro
        urow.appendChild(ub); log.appendChild(urow); scrollDown();
        return urow;
      }
      var b = makeBotRow(mood);
      var bub = document.createElement('div');
      bub.className = 'argo-assistant-bubble argo-md';
      renderMd(text, bub);
      b.col.appendChild(bub);
      log.appendChild(b.row); scrollDown();
      return b;
    }

    function copyText(txt, btn) {
      function ok() { var old = btn.textContent; btn.textContent = 'Copiado ✓'; setTimeout(function () { btn.textContent = old; }, 1500); }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(ok, function () { btn.textContent = 'Não consegui copiar'; }); return; }
      } catch (e) { /* cai no fallback */ }
      try {
        var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); ok();
      } catch (e2) { btn.textContent = 'Não consegui copiar'; }
    }

    function tinyBtn(label, cls, fn) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'argo-assistant-mini ' + (cls || ''); b.textContent = label;
      b.addEventListener('click', fn);
      return b;
    }

    function buildUnit(u) {
      var card = document.createElement('div');
      card.className = 'argo-assistant-unit';
      var t = document.createElement('strong'); t.textContent = u.name || u.fullName || 'Unidade'; card.appendChild(t);
      if (u.group) { var g = document.createElement('span'); g.className = 'argo-assistant-unit-group'; g.textContent = u.group; card.appendChild(g); }
      if (u.address) { var a = document.createElement('div'); a.className = 'argo-assistant-unit-line'; a.textContent = '📍 ' + (u.address.length > 130 ? u.address.slice(0, 129) + '…' : u.address); card.appendChild(a); }
      if (u.hours) { var h = document.createElement('div'); h.className = 'argo-assistant-unit-line'; h.textContent = '🕒 ' + (u.hours.length > 110 ? u.hours.slice(0, 109) + '…' : u.hours); card.appendChild(h); }
      var row = document.createElement('div'); row.className = 'argo-assistant-unit-actions';
      (u.phoneLinks || []).slice(0, 2).forEach(function (p) {
        if (!p || !p.href) return;
        var l = document.createElement('a'); l.className = 'argo-assistant-mini'; l.href = p.href; l.textContent = '📞 ' + p.label; row.appendChild(l);
      });
      if (u.address) {
        var m = document.createElement('a'); m.className = 'argo-assistant-mini'; m.target = '_blank'; m.rel = 'noopener noreferrer';
        m.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(u.address.replace(/<[^>]*>/g, ' ') + ' Boa Vista RR');
        m.textContent = '🗺️ Mapa'; row.appendChild(m);
      }
      if (typeof options.onUnit === 'function') row.appendChild(tinyBtn('📄 Ver ficha', '', function () { try { options.onUnit(u); } catch (e) { /* ação do app - ignora */ } }));
      row.appendChild(tinyBtn('Copiar', '', function (ev) {
        copyText([u.name, u.address, u.hours ? 'Horário: ' + u.hours : '', (u.phones || []).join(' · ')].filter(Boolean).join('\n'), ev.currentTarget);
      }));
      card.appendChild(row);
      return card;
    }

    // badge, nota, cartões e ações de uma resposta do Argo
    function decorate(b, result, plain) {
      if (result.badge) {
        var bd = document.createElement('span');
        bd.className = 'argo-assistant-badge argo-assistant-badge-' + String(result.badge).replace(/\s+/g, '').toLowerCase();
        bd.textContent = result.badge === 'IA' ? '✨ Resposta gerada por IA' : result.badge;
        b.col.insertBefore(bd, b.col.firstChild);
      }
      if (result.note) { var n = document.createElement('div'); n.className = 'argo-assistant-note'; n.textContent = result.note; b.col.appendChild(n); }
      if (result.units && result.units.length) {
        var wrap = document.createElement('div'); wrap.className = 'argo-assistant-units';
        result.units.slice(0, 5).forEach(function (u) { wrap.appendChild(buildUnit(u)); });
        b.col.appendChild(wrap);
      }
      var acts = document.createElement('div'); acts.className = 'argo-assistant-msg-actions';
      if (plain && plain.length > 60 && !result.crisis) acts.appendChild(tinyBtn('Copiar', 'argo-assistant-mini-ghost', function (ev) { copyText(plain, ev.currentTarget); }));
      if (result.badge === 'IA') {
        acts.appendChild(tinyBtn('Refazer', 'argo-assistant-mini-ghost', function () { if (!busy && lastQuestion) ask(lastQuestion, { regen: true, silent: true }); }));
        var up = tinyBtn('👍', 'argo-assistant-mini-ghost', function () { up.disabled = down.disabled = true; up.classList.add('is-on'); });
        up.setAttribute('aria-label', 'Resposta útil');
        var down = tinyBtn('👎', 'argo-assistant-mini-ghost', function () {
          up.disabled = down.disabled = true; down.classList.add('is-on');
          addMsg('Obrigado por avisar! Posso tentar de outro jeito, ou você pode buscar direto no diretório. Dica: quanto mais específica a pergunta (unidade, bairro, público), melhor a resposta.', 'bot', 'info');
          renderQuick([{ label: 'Refazer a resposta', run: function () { if (!busy && lastQuestion) ask(lastQuestion, { regen: true, silent: true }); } }, { label: 'Mais assuntos', menu: true }]);
        });
        down.setAttribute('aria-label', 'Resposta não ajudou');
        acts.appendChild(up); acts.appendChild(down);
      }
      if (acts.firstChild) b.col.appendChild(acts);
    }

    // ---------- atalhos ----------
    function renderQuick(actions) {
      quick.innerHTML = '';
      (actions || []).forEach(function (a) {
        if (!a || !a.label) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'argo-assistant-chip' + (a.menu ? ' argo-assistant-chip-menu' : '') + (a.ask ? ' argo-assistant-chip-ask' : '');
        btn.textContent = a.label;
        btn.addEventListener('click', function () {
          if (a.menu) { addMsg('Claro! Por onde quer seguir?', 'bot', 'info'); renderQuick(defaultQuick()); return; }
          if (a.ask) { ask(a.ask, a.force ? { forceAI: true, silent: true } : null); return; }
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
    function defaultQuick() {
      return (typeof options.defaultQuickActions === 'function') ? options.defaultQuickActions() : (options.defaultQuickActions || []);
    }

    function quickFor(result) {
      var acts = (result.quickActions || []).slice();
      (result.followups || []).forEach(function (q) { acts.push({ label: q, ask: q }); });
      if (!acts.length) return defaultQuick();
      acts.push({ label: 'Mais assuntos', menu: true });
      return acts.slice(0, 7);
    }

    // ---------- estados de "pensando" ----------
    function typingRow() {
      var b = makeBotRow('info');
      b.row.classList.add('argo-assistant-typing');
      var bub = document.createElement('span'); bub.className = 'argo-assistant-bubble';
      bub.innerHTML = '<i></i><i></i><i></i>';
      b.col.appendChild(bub); log.appendChild(b.row); scrollDown();
      return b.row;
    }
    function setBusy(on) {
      busy = on;
      fab.classList.toggle('argo-assistant-busy', on);
      sendBtn.innerHTML = on ? svgStop : svgSend;
      sendBtn.classList.toggle('is-stop', on);
      sendBtn.setAttribute('aria-label', on ? 'Parar resposta' : 'Enviar pergunta');
      log.setAttribute('aria-busy', on ? 'true' : 'false');
    }

    function finishUnread() { if (!isOpen) dot.hidden = false; }

    // Mostra a resposta pronta (ou o "não entendi") e os atalhos que a acompanham.
    function showAnswer(result) {
      if (result && result.reply) {
        var b = addMsg(result.reply, 'bot', result.mood);
        decorate(b, result, plainText(result.reply));
        renderQuick(quickFor(result));
        announce(result.reply);
      } else {
        addMsg('Hmm, essa eu não entendi bem. Tente com outras palavras ou escolha um destes caminhos:', 'bot', 'notfound');
        renderQuick(defaultQuick());
      }
      finishUnread();
    }

    // Resposta em streaming: o texto aparece aos poucos; "Parar" interrompe e mantém o que chegou.
    function showStream(result, myRun) {
      var typing = typingRow();
      var b = null, bub = null, raf = 0, acc = '';
      abortCtl = (typeof AbortController !== 'undefined') ? new AbortController() : { signal: undefined, abort: function () {} };
      var stopped = false, finished = false;
      abortCtl.signal && abortCtl.signal.addEventListener && abortCtl.signal.addEventListener('abort', function () { stopped = true; });

      function ensureBubble() {
        if (b) return;
        typing.remove();
        b = makeBotRow(result.mood || 'info');
        bub = document.createElement('div');
        bub.className = 'argo-assistant-bubble argo-md argo-assistant-streaming';
        b.col.appendChild(bub); log.appendChild(b.row);
      }
      function paint() { raf = 0; if (bub && !finished) { renderMd(acc, bub); scrollDown(); } }
      function onDelta(piece, full) {
        if (myRun !== runId) return;
        ensureBubble();
        acc = (typeof full === 'string') ? full : acc + piece;
        if (!raf) raf = (window.requestAnimationFrame || setTimeout)(paint, 16);
      }
      var p;
      try { p = result.stream.run(onDelta, abortCtl.signal); } catch (e) { p = Promise.reject(e); }
      return Promise.resolve(p).then(function (final) {
        finished = true;
        if (myRun !== runId) return;
        var f = (typeof final === 'string') ? { text: final } : (final || {});
        var text = f.text || acc;
        if (!b) { typing.remove(); b = makeBotRow(result.mood || 'info'); bub = document.createElement('div'); bub.className = 'argo-assistant-bubble argo-md'; b.col.appendChild(bub); log.appendChild(b.row); }
        bub.classList.remove('argo-assistant-streaming');
        renderMd(text, bub);
        var finalResult = { badge: result.badge || 'IA', note: f.note || '', units: f.units || [], quickActions: f.quickActions || result.quickActions, followups: f.followups || result.followups, mood: result.mood };
        decorate(b, finalResult, plainText(text));
        renderQuick(quickFor(finalResult));
        announce(text);
        scrollDown();
      }, function (err) {
        finished = true;
        if (myRun !== runId) return;
        var partial = (err && err.partial) || acc;
        if (b && partial && partial.length > 25) {
          bub.classList.remove('argo-assistant-streaming');
          renderMd(partial + (stopped ? '\n\n(resposta interrompida)' : '\n\n(a resposta foi cortada por falha de conexão)'), bub);
          decorate(b, { badge: 'IA' }, plainText(partial));
          renderQuick(quickFor({ quickActions: (result.stream.fallback && result.stream.fallback.quickActions) || [], followups: [] }));
          return;
        }
        if (b) b.row.remove();
        typing.remove();
        if (stopped) { addMsg('Resposta interrompida.', 'bot', 'info'); renderQuick(defaultQuick()); return; }
        var msg = err && err.userMessage;
        if (msg) { addMsg(msg, 'bot', 'notfound'); renderQuick(defaultQuick()); return; }
        showAnswer(result.stream.fallback || null);
      }).then(function () {
        if (myRun !== runId) return;
        abortCtl = null; setBusy(false); finishUnread(); refreshStatus();
      });
    }

    // ---------- fluxo principal ----------
    function ask(text, meta) {
      text = String(text == null ? '' : text).trim();
      if (!text || busy) return;
      meta = meta || {};
      lastQuestion = text;
      var myRun = ++runId;
      quick.innerHTML = '';
      if (!meta.silent) addMsg(text, 'user');
      setBusy(true);
      var result;
      try { result = (typeof options.ask === 'function') ? options.ask(text, meta) : null; }
      catch (e) { result = null; }
      var typing = null;
      function settle(res) {
        if (myRun !== runId) return;
        if (typing) typing.remove();
        if (res && res.stream && typeof res.stream.run === 'function') { showStream(res, myRun); return; }
        showAnswer(res);
        abortCtl = null; setBusy(false); refreshStatus();
      }
      if (result && typeof result.then === 'function') {
        typing = typingRow();
        result.then(settle, function () { settle(null); });
      } else {
        typing = typingRow();
        setTimeout(function () { settle(result); }, 320);
      }
    }

    function stop() {
      if (abortCtl && abortCtl.abort) abortCtl.abort();
    }

    function reset() {
      runId++; stop(); abortCtl = null; setBusy(false);
      log.textContent = ''; quick.innerHTML = ''; sr.textContent = ''; lastQuestion = ''; greeted = false;
      try { if (typeof options.onReset === 'function') options.onReset(); } catch (e) { /* ignora */ }
      if (isOpen) { greeted = true; greet(); }
    }

    function greet() {
      var g = (typeof options.greeting === 'function') ? options.greeting() : options.greeting;
      addMsg(g || 'Oi! Eu sou o Argo. Como posso ajudar?', 'bot', 'success');
      renderQuick(defaultQuick());
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      panel.hidden = false; hint.hidden = true; dot.hidden = true;
      fab.setAttribute('aria-expanded', 'true');
      refreshStatus();
      requestAnimationFrame(function () { panel.classList.add('argo-assistant-open'); });
      if (!greeted) { greeted = true; greet(); }
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
    newBtn.addEventListener('click', function (e) { e.stopPropagation(); reset(); });
    wideBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var on = !panel.classList.contains('argo-assistant-wide'); setWide(on);
      try { localStorage.setItem(WIDE_KEY, on ? '1' : '0'); } catch (err) { /* ignora */ }
      setTimeout(scrollDown, 60);
    });
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
      if (e.target && e.target.isConnected === false) return; // botão do próprio painel que foi removido do DOM
      close();
    });

    // ---------- campo de texto ----------
    var history = [], histPos = 0;
    function autosize() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 96) + 'px';
      var len = input.value.length;
      count.hidden = len < 400;
      if (len >= 400) count.textContent = len + '/500';
    }
    input.addEventListener('input', autosize);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) { stop(); return; }
      var v = input.value;
      input.value = ''; autosize();
      if (v.trim()) { history.push(v); histPos = history.length; }
      ask(v);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); return; }
      var atStart = input.selectionStart === 0 && input.selectionEnd === 0;
      if (e.key === 'ArrowUp' && history.length && (!input.value || atStart)) {
        e.preventDefault(); histPos = Math.max(0, histPos - 1); input.value = history[histPos]; autosize();
      } else if (e.key === 'ArrowDown' && history.length && input.value && histPos < history.length) {
        e.preventDefault(); histPos = Math.min(history.length, histPos + 1); input.value = history[histPos] || ''; autosize();
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
      say: function (text, mood) { addMsg(text, 'bot', mood); },
      reset: reset,
      refreshStatus: refreshStatus
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

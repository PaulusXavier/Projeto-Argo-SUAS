/*!
 * ArgoMascot — mascote-barquinho (tema Argo Navis) + sistema de avisos.
 * Visual "livro antigo" sobrio: casco de madeira com friso dourado, velas de
 * pergaminho (a pequena leva a constelacao Argo), olhos redondos que
 * acompanham o mouse, barco que balanca, ondinhas e bandeirinha na cor do humor.
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
 *        · 'thinking' (violeta: o Argo "pensando" — usado enquanto a IA responde)
 *
 * ÍCONE AVULSO: ArgoMascot.icon('info', 48). Abaixo de 48 px o desenho troca
 * sozinho para uma versão compacta (cabeça maior, menos detalhes) que continua
 * legível em avisos, chat e botão flutuante.
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
    success:  { color: 'var(--argo-mascot-success, #15803D)' },
    thinking: { color: 'var(--argo-mascot-thinking, #6D4FD0)' }
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
  var PILOT = { skin: '#D9A474', skinDk: '#B98152', hair: '#1D1511', shirt: '#8D9096', shirtLt: '#B7BABF', capTop: '#FBF3DC', frame: '#2A2A33', lens: '#8FE9FF' };
  var CUSTOM_IMAGE_SRC = ''; // ex.: 'argo-mascote.png'

  function boatSVG(mood, size) {
    mood = normalizeType(mood);
    size = size || 40;
    var accent = THEME[mood].color;
    var flagSymbol = { info: '★', error: '!', notfound: '?', success: '✓', thinking: '…' }[mood];

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
    // Navio Argo (casco azul-petróleo com friso dourado, escudos redondos, proa de
    // cavalo-marinho e vela clara) + toques "tech": LEDs ciano e chip na vela.
    var NAVY = '#0F2E3A', HULL = '#2B7380', HULL_DK = '#164755', HULL_LT = '#4BA7AE', CYAN = '#5EE6FF',
        SHIELD = '#3FA38C', MAST = '#A9742F';

    // IDs únicos por chamada: dois mascotes na mesma página não podem
    // compartilhar o mesmo id de gradiente.
    mascotUid += 1;
    var hullGradId = 'argoMascot' + mascotUid + 'Hull';
    var sailGradId = 'argoMascot' + mascotUid + 'Sail';
    var haloGradId = 'argoMascot' + mascotUid + 'Halo';
    var glossGradId = 'argoMascot' + mascotUid + 'Gloss';
    var waterGradId = 'argoMascot' + mascotUid + 'Water';
    var hullClipId = 'argoMascot' + mascotUid + 'Clip';
    var faceGradId = 'argoMascot' + mascotUid + 'Face';
    var shirtGradId = 'argoMascot' + mascotUid + 'Shirt';
    var sailShadeId = 'argoMascot' + mascotUid + 'SailShade';
    var hullShadeId = 'argoMascot' + mascotUid + 'HullShade';
    // Abaixo de 48 px o desenho vira a versão compacta: cabeça maior, escudos maiores
    // e sem filigranas (trilhas de circuito, pinos do chip, costuras) que viram só borrão.
    var compact = size < 48;
    var lite = size < 36; // ícones pequenos: sem enfeites animados (leve para listas/chat)
    var HULL_D = 'M9 49 Q36 63 65 63 Q94 63 121 47 Q121 82 98 97 Q86 103 65 103 Q44 103 32 97 Q9 82 9 49 Z';

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

    // Óculos aviador de armação fina (lentes levemente azuladas). Fica por cima
    // dos olhos em todos os humores; as hastes vão até as orelhas.
    var glasses =
      '<path d="M31 35.6 H41 Q41.4 43.8 36 44 Q31.2 43.8 31 35.6 Z" fill="' + PILOT.lens + '" fill-opacity=".3" stroke="' + PILOT.frame + '" stroke-width="1.3" stroke-linejoin="round"/>' +
      '<path d="M43 35.6 H53 Q52.8 43.8 48 44 Q42.6 43.8 43 35.6 Z" fill="' + PILOT.lens + '" fill-opacity=".3" stroke="' + PILOT.frame + '" stroke-width="1.3" stroke-linejoin="round"/>' +
      '<path d="M41 36.6 Q42 35.4 43 36.6 M31 36.2 L27.8 36.8 M53 36.2 L56.2 36.8" fill="none" stroke="' + PILOT.frame + '" stroke-width="1.2" stroke-linecap="round"/>' +
      '<path d="M33 37.6 L35.6 37 M45 37.6 L47.6 37" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".55"/>' +
      '<path d="M33.2 41.6 H38 M45.2 41.6 H50" stroke="' + CYAN + '" stroke-width=".8" stroke-linecap="round" opacity=".9"/>' +
      '<circle cx="28.4" cy="36.2" r="1.1" fill="' + CYAN + '" stroke="' + PILOT.frame + '" stroke-width=".5"/>' +
      '<path class="argo-fx argo-mascot-glint" d="M33.4 34.6 Q33.7 37 36 37.4 Q33.7 37.8 33.4 40.2 Q33.1 37.8 30.8 37.4 Q33.1 37 33.4 34.6 Z" fill="#fff"/>';

    // ---- Rosto e pose por humor ----
    function brow(d) { return '<path d="' + d + '" fill="none" stroke="' + PILOT.hair + '" stroke-width="2" stroke-linecap="round"/>'; }
    // narizinho discreto (dá volume ao rosto sem pesar)
    var nose = '<path d="M42.7 41 Q44.5 43.2 42.1 43.9" fill="none" stroke="#9A6038" stroke-width="1.3" stroke-linecap="round" opacity=".75"/>';
    var brows = '';
    var cheeks = '<ellipse cx="31.4" cy="46" rx="2.8" ry="1.8" fill="' + BLUSH + '" opacity=".6"/><ellipse cx="52.6" cy="46" rx="2.8" ry="1.8" fill="' + BLUSH + '" opacity=".6"/>';
    var face, arms, extra = '';

    if (mood === 'success') {
      brows = brow('M32.2 31.6 Q36.2 29.4 40.2 31.4') + brow('M43.8 31.4 Q47.8 29.4 51.8 31.6');
      face = stroke('M33.2 39.6 Q36.5 34.4 39.8 39.6', 2.2) + stroke('M44.2 39.6 Q47.5 34.4 50.8 39.6', 2.2) +
        '<path d="M36.8 43.6 Q42 54 47.2 43.6 Z" fill="' + MOUTH + '" stroke="' + EYE + '" stroke-width="1.8" stroke-linejoin="round"/>' +
        '<path d="M39.6 48.6 Q42 46.2 44.4 48.6 Q42 51 39.6 48.6 Z" fill="' + BLUSH + '"/>';
      arms = '<g class="argo-mascot-wave2">' + arm(24, 62, 13, 41) + '</g>' +
             '<g class="argo-mascot-wave">' + arm(60, 62, 71, 41) + '</g>';
      extra =
        '<g class="argo-fx">' + [[12, 0, GOLD, 0], [30, -4, '#FF8FA3', .35], [52, -6, SEA, .7], [74, -4, '#7ED9A0', 1.05], [96, -6, GOLD, 1.4], [118, 0, '#FF8FA3', .2], [104, 2, SEA, .9]].map(function (c) {
          return '<rect class="argo-mascot-confetti" x="' + c[0] + '" y="' + c[1] + '" width="3.2" height="5.4" rx="1" fill="' + c[2] + '" stroke="' + NAVY + '" stroke-width=".6" style="animation-delay:' + c[3] + 's"/>';
        }).join('') + '</g>' +
        '<path class="argo-mascot-pop" d="M14 18 Q15 23 20 24 Q15 25 14 30 Q13 25 8 24 Q13 23 14 18 Z" fill="' + GOLD + '" stroke="' + GOLD_DK + '" stroke-width="1" stroke-linejoin="round"/>' +
        '<path class="argo-mascot-pop" style="animation-delay:.5s" d="M78 5 Q79 9 83 10 Q79 11 78 15 Q77 11 73 10 Q77 9 78 5 Z" fill="' + GOLD + '" stroke="' + GOLD_DK + '" stroke-width="1" stroke-linejoin="round"/>';
    } else if (mood === 'error') {
      face = '<g class="argo-mascot-look"><g class="argo-mascot-blink">' + eye(36.5, 39, 2.6) + eye(47.5, 39, 2.6) + '</g></g>' +
        stroke('M32 33.6 L39.6 35.8', 2) + stroke('M52 33.6 L44.4 35.8', 2) +
        stroke('M38 48.2 Q42 43.6 46 48.2', 2.2) +
        '<path d="M33 43.4 Q30.4 47 33 49.4 Q35.6 47 33 43.4 Z" fill="#8FD3F4" stroke="' + EYE + '" stroke-width="1" stroke-opacity=".5"/>';
      arms = arm(23, 63, 21, 61) + arm(61, 63, 63, 61);
      extra = '<path class="argo-mascot-drip" d="M58 22 Q55.6 26 58 28.6 Q60.4 26 58 22 Z" fill="#8FD3F4" stroke="' + EYE + '" stroke-width="1" stroke-opacity=".5"/>';
    } else if (mood === 'notfound') {
      face = '<g class="argo-mascot-look"><g class="argo-mascot-blink">' + eye(36.5, 39, 2.3) + eye(47.5, 38.6, 3.2) + '</g></g>' +
        stroke('M44 32.6 Q47.6 29.4 51.6 32.6', 2) +
        '<ellipse cx="42" cy="46.4" rx="2.3" ry="2.9" fill="' + MOUTH + '" stroke="' + EYE + '" stroke-width="1.8"/>';
      arms = arm(23, 63, 21, 61) + arm(61, 62, 53.5, 50.5);
      extra = '<g class="argo-fx argo-mascot-qmark"><circle cx="63" cy="15.6" r="1.2" fill="#fff" stroke="' + NAVY + '" stroke-width=".8"/>' +
        '<circle cx="67" cy="11.4" r="1.8" fill="#fff" stroke="' + NAVY + '" stroke-width=".9"/>' +
        '<ellipse cx="76" cy="3" rx="7.4" ry="6" fill="#fff" stroke="' + NAVY + '" stroke-width="1.5"/>' +
        '<text x="76" y="6.6" font-size="9.4" font-weight="800" fill="' + accent + '" text-anchor="middle" font-family="Trebuchet MS,Verdana,sans-serif">?</text></g>';
    } else if (mood === 'thinking') {
      // olhar para cima e para o lado, sobrancelha levantada, mão no queixo e balão com "..." pulsando
      face = '<g class="argo-mascot-look"><g class="argo-mascot-blink">' + eye(37.8, 37.6, 2.6) + eye(48.8, 37.6, 2.6) + '</g></g>' +
        '<path d="M39.6 47.6 Q42.6 45.8 45.8 47.4" fill="none" stroke="' + EYE + '" stroke-width="2" stroke-linecap="round"/>';
      brows = brow('M32 34.2 Q36 33 40.4 34.2') + brow('M43.6 30.8 Q48 28.4 52.6 31.4');
      arms = arm(23, 63, 21, 61) + arm(61, 62, 52.4, 51.6);
      extra = '<g class="argo-mascot-think"><circle cx="63" cy="15.6" r="1.2" fill="#fff" stroke="' + NAVY + '" stroke-width=".8"/>' +
        '<circle cx="67" cy="11.4" r="1.8" fill="#fff" stroke="' + NAVY + '" stroke-width=".9"/>' +
        '<ellipse cx="78" cy="3" rx="10" ry="6.4" fill="#fff" stroke="' + NAVY + '" stroke-width="1.5"/>' +
        [72.8, 78, 83.2].map(function (x, i) { return '<circle class="argo-mascot-dot" style="animation-delay:' + (i * 0.22).toFixed(2) + 's" cx="' + x + '" cy="3" r="1.6" fill="' + accent + '"/>'; }).join('') + '</g>';
    } else { // info
      brows = '<g class="argo-mascot-brow">' + brow('M32 33.4 Q36 31.8 40.4 33.2') + brow('M43.6 33.2 Q48 31.8 52 33.4') + '</g>';
      face = '<g class="argo-mascot-look"><g class="argo-mascot-blink">' + eye(36.5, 39, 2.7) + '<g class="argo-mascot-eyeR">' + eye(47.5, 39, 2.7) + '</g></g></g>' +
        '<path d="M36.2 46.4 Q42 53.4 47.8 46.4 Q42 47.8 36.2 46.4 Z" fill="#fff" stroke="' + EYE + '" stroke-width="1.7" stroke-linejoin="round"/>';
      arms = arm(23, 63, 21, 61) + '<g class="argo-mascot-wave">' + arm(60, 62, 70.5, 43) + '</g>';
      // "Zzz": só aparece quando o app fica parado um tempo (classe argo-mascot-sleepy no <html>)
      extra = '<g class="argo-fx argo-mascot-zzz">' + [[60, 15, 6.5, 0], [66, 9, 8.5, .5], [73, 3, 10.5, 1]].map(function (z) {
        return '<text class="argo-mascot-z" style="animation-delay:' + z[3] + 's" x="' + z[0] + '" y="' + z[1] + '" font-size="' + z[2] + '" font-weight="800" fill="#fff" stroke="' + NAVY + '" stroke-width=".7" paint-order="stroke" font-family="Trebuchet MS,Verdana,sans-serif">z</text>';
      }).join('') + '</g>';
    }

    // ---- Comandante: orelhas, cabeça, cabelo, óculos, rosto, polo cinza com crachá ----
    var pilot =
      // camisa polo (a parte de baixo fica escondida atrás do casco)
      '<path d="M18 74 Q18 53 42 52 Q66 53 66 74 Z" fill="url(#' + shirtGradId + ')" stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round"/>' +
      // pescoço, orelhas e cabeça
      '<rect x="37" y="47" width="10" height="8" rx="3" fill="' + PILOT.skinDk + '"/>' +
      // gola da polo, botões e cordão do crachá
      '<path d="M32.6 53 Q36 49.6 40.4 52.4 L42 60.6 L34.2 57 Z" fill="' + PILOT.shirtLt + '" stroke="' + INK + '" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M51.4 53 Q48 49.6 43.6 52.4 L42 60.6 L49.8 57 Z" fill="' + PILOT.shirtLt + '" stroke="' + INK + '" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M42 60.6 V72" stroke="' + INK + '" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>' +
      '<circle cx="42" cy="64.6" r="1" fill="' + INK + '"/><circle cx="42" cy="68.6" r="1" fill="' + INK + '"/>' +
      '<path d="M35 51.6 L38.8 72 M49 51.6 L45.2 72" stroke="#1E1E24" stroke-width="2.2" stroke-linecap="round" fill="none"/>' +
      // pin Ψ dourado (psicologia) no peito
      '<circle cx="30.6" cy="60.4" r="3" fill="' + GOLD + '" stroke="' + INK + '" stroke-width="1.1"/>' +
      '<path d="M29.1 58.6 Q29.1 61.6 30.6 61.6 Q32.1 61.6 32.1 58.6 M30.6 58.2 V62.6" fill="none" stroke="' + INK + '" stroke-width=".9" stroke-linecap="round"/>' +
      '<g class="argo-mascot-head"><g transform="translate(42 54) scale(' + (compact ? 1.3 : 1.13) + ') translate(-42 -54)">' +
      '<ellipse cx="27.2" cy="39.5" rx="2.4" ry="3.6" fill="' + PILOT.skin + '" stroke="' + INK + '" stroke-width="1.6"/>' +
      '<ellipse cx="56.8" cy="39.5" rx="2.4" ry="3.6" fill="' + PILOT.skin + '" stroke="' + INK + '" stroke-width="1.6"/>' +
      // rosto um pouco alongado, com queixo firme e barba rala por baixo
      '<path d="M27.4 34 Q27.4 21.6 42 21.6 Q56.6 21.6 56.6 34 Q56.6 44 53 48.6 Q48 53.8 42 53.8 Q36 53.8 31 48.6 Q27.4 44 27.4 34 Z" fill="url(#' + faceGradId + ')" stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<path d="M31.4 47.6 Q36 52.4 42 52.6 Q48 52.4 52.6 47.6 Q50 52.6 42 53 Q34 52.6 31.4 47.6 Z" fill="' + PILOT.skinDk + '" opacity=".38"/>' +
      // sombra do queixo no pescoço/gola dá profundidade
      cheeks + nose + face + brows + glasses +
      // cabelo preto curto, com topete volumoso caído para o lado e costeletas
      '<g class="argo-mascot-hair">' +
      '<path d="M26.6 36 Q23.8 15.5 41 14.6 Q59.6 14 57.4 36 Q56.6 29 53.6 26.4 Q49.6 28.4 45.4 23.6 Q42.4 28.8 36.6 27.8 Q31 27.4 29.6 36 Q28.2 37 26.6 36 Z" fill="' + PILOT.hair + '" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M37.4 26.6 Q36.6 31.6 40.4 32.4 Q39 29.4 41.4 26.8 Z" fill="' + PILOT.hair + '"/>' +
      '<path d="M32.5 20.4 Q41 16.6 51.5 21" fill="none" stroke="#6B5646" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>' +
      '<path d="M45 18.4 Q51 18.6 54.4 24" fill="none" stroke="#6B5646" stroke-width="1" stroke-linecap="round" opacity=".55"/>' +
      '</g></g></g>' +
      arms;

    var bob = mood === 'error' ? '' : ' argo-mascot-bob';
    var wave = 'q7.5 -5 15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0';
    var HULL_DY = 8; // casco um pouco mais baixo: o comandante aparece da cintura para cima

    return (
      '<svg class="argo-mascot-icon' + bob + (lite ? ' argo-mascot-lite' : '') + ' argo-mascot-m-' + mood + '" width="' + size + '" height="' + size +
      '" viewBox="0 0 130 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
        '<defs>' +
          '<linearGradient id="' + hullGradId + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="' + HULL_LT + '"/>' +
            '<stop offset="45%" stop-color="' + HULL + '"/>' +
            '<stop offset="100%" stop-color="' + HULL_DK + '"/>' +
          '</linearGradient>' +
          '<linearGradient id="' + sailGradId + '" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0%" stop-color="#FFF6DC"/>' +
            '<stop offset="60%" stop-color="#F4EBD0"/>' +
            '<stop offset="100%" stop-color="#BFE3E4"/>' +
          '</linearGradient>' +
          '<radialGradient id="' + haloGradId + '" cx=".5" cy=".5" r=".5">' +
            '<stop offset="0%" style="stop-color:' + accent + ';stop-opacity:.34"/>' +
            '<stop offset="60%" style="stop-color:' + accent + ';stop-opacity:.10"/>' +
            '<stop offset="100%" style="stop-color:' + accent + ';stop-opacity:0"/>' +
          '</radialGradient>' +
          '<linearGradient id="' + glossGradId + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#fff" stop-opacity=".34"/><stop offset="42%" stop-color="#fff" stop-opacity=".08"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/>' +
          '</linearGradient>' +
          '<linearGradient id="' + waterGradId + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#9BE0F7"/><stop offset="100%" stop-color="#3C9FCB"/>' +
          '</linearGradient>' +
          '<radialGradient id="' + faceGradId + '" cx=".36" cy=".3" r=".85">' +
            '<stop offset="0%" stop-color="#EBBC8F"/><stop offset="55%" stop-color="' + PILOT.skin + '"/><stop offset="100%" stop-color="#BC8758"/>' +
          '</radialGradient>' +
          '<linearGradient id="' + shirtGradId + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#A2A5AB"/><stop offset="100%" stop-color="#6F7279"/>' +
          '</linearGradient>' +
          '<linearGradient id="' + sailShadeId + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#fff" stop-opacity=".45"/><stop offset="55%" stop-color="#fff" stop-opacity="0"/><stop offset="100%" stop-color="#0F2E3A" stop-opacity=".2"/>' +
          '</linearGradient>' +
          '<linearGradient id="' + hullShadeId + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="55%" stop-color="#0A1F28" stop-opacity="0"/><stop offset="100%" stop-color="#0A1F28" stop-opacity=".38"/>' +
          '</linearGradient>' +
          '<clipPath id="' + hullClipId + '"><path d="' + HULL_D + '"/></clipPath>' +
        '</defs>' +
        // aura suave na cor do humor + gaivota passando ao fundo
        '<ellipse class="argo-mascot-halo" cx="65" cy="64" rx="64" ry="50" fill="url(#' + haloGradId + ')"/>' +
        '<g class="argo-fx"><g class="argo-mascot-gull"><path d="M0 0 q3 -3.6 6 0 q3 -3.6 6 0" fill="none" stroke="#8FAFBF" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></g></g>' +
        // ondinha de fundo
        '<path class="argo-mascot-swell2" d="M5 105 ' + wave + '" fill="none" stroke="' + SEA + '" stroke-width="3" stroke-linecap="round" opacity=".55"/>' +
        '<g class="argo-mascot-rock">' +
        // cordame e vela grande do Argo (antes do mastro, que fica na frente)
        '<g class="argo-mascot-sail">' +
        '<path d="M104 8 L121 46" stroke="' + NAVY + '" stroke-width=".9" stroke-linecap="round" opacity=".55"/>' +
        '<path d="M75 22 L116 15.6 C119 30 118 42 113 52 C105 64 92 66 82 60 C70 52 68 34 75 22 Z" fill="url(#' + sailGradId + ')" stroke="' + NAVY + '" stroke-width="2.4" stroke-linejoin="round"/>' +
        '<path d="M75 22 L116 15.6 C119 30 118 42 113 52 C105 64 92 66 82 60 C70 52 68 34 75 22 Z" fill="url(#' + sailShadeId + ')"/>' +
        '<path d="M96 19 Q92 44 96 65 M85 22 Q80 42 86 60" fill="none" stroke="' + NAVY + '" stroke-width="1" opacity=".16" stroke-linecap="round"/>' +
        (compact ? '' : '<path d="M77.6 24.4 L114 18.6 C116.4 31 115.4 41 111.2 50 C104 60.6 93 62.4 84.4 57.6 C73.6 50 71.6 35 77.6 24.4" fill="none" stroke="' + NAVY + '" stroke-width=".7" stroke-dasharray="1.8 2.2" opacity=".28"/>') +
        '<path d="M72 21.4 L118 14.6" stroke="' + NAVY + '" stroke-width="4.6" stroke-linecap="round"/>' +
        '<path d="M72 21.4 L118 14.6" stroke="' + MAST + '" stroke-width="2.4" stroke-linecap="round"/>' +
        // constelação Argo Navis (estrelas ligadas por linhas de luz) na vela
        '<path d="M80 34 L87 28 L95 35 L90 42 M95 35 L100 29" fill="none" stroke="' + HULL + '" stroke-width="1" stroke-linecap="round" opacity=".6"/>' +
        [[80, 34, 1.7, 0], [87, 28, 2.1, .5], [95, 35, 2.3, 1], [90, 42, 1.6, 1.5], [100, 29, 1.5, 2]].map(function (t) {
          return '<circle class="argo-fx argo-mascot-glow" style="animation-delay:' + t[3] + 's" cx="' + t[0] + '" cy="' + t[1] + '" r="' + (t[2] * 2.6).toFixed(1) + '" fill="' + GOLD + '" opacity=".25"/>' +
                 '<circle class="argo-mascot-star" style="animation-delay:' + t[3] + 's" cx="' + t[0] + '" cy="' + t[1] + '" r="' + t[2] + '" fill="' + GOLD + '" stroke="' + GOLD_DK + '" stroke-width=".6"/>';
        }).join('') +
        // chip na cor do humor (o "remendo" virou um microchip com pinos)
        (compact ? '' : '<path d="M86 47 v-2.4 M89 47 v-2.4 M92 47 v-2.4 M86 58 v2.4 M89 58 v2.4 M92 58 v2.4 M83.4 50 h-2.4 M83.4 53 h-2.4 M83.4 56 h-2.4 M94.6 50 h2.4 M94.6 53 h2.4 M94.6 56 h2.4" stroke="' + NAVY + '" stroke-width="1.1" stroke-linecap="round"/>') +
        '<rect class="argo-mascot-chip" x="83.4" y="46.6" width="11.2" height="11.2" rx="2.6" fill="' + accent + '" stroke="' + NAVY + '" stroke-width="1.4"/>' +
        '<rect x="85.6" y="48.8" width="6.8" height="6.8" rx="1.6" fill="none" stroke="#fff" stroke-width=".9" stroke-dasharray="1.4 1.4" opacity=".85"/>' +
        '<circle cx="89" cy="52.2" r="1.3" fill="#fff"/>' +
        '</g>' +
        // mastro à direita, com bolinha dourada no topo
        '<line x1="104" y1="70" x2="104" y2="6" stroke="' + NAVY + '" stroke-width="5.4" stroke-linecap="round"/>' +
        '<line x1="104" y1="70" x2="104" y2="6" stroke="' + MAST + '" stroke-width="2.6" stroke-linecap="round"/>' +
        // o comandante (respira devagar)
        '<g class="argo-mascot-breathe">' + pilot + '</g>' +
        // casco do Argo: proa de cavalo-marinho, popa em voluta, escudos redondos e friso dourado com LED
        '<g transform="translate(0 ' + HULL_DY + ')">' +
          // proa: pescoço curvo + cabeça fofa com crina dourada
          '<g class="argo-mascot-prow">' +
          '<path d="M19 62 Q4 56 7 36 Q8 27 14 24" fill="none" stroke="' + NAVY + '" stroke-width="9.4" stroke-linecap="round"/>' +
          '<path d="M19 62 Q4 56 7 36 Q8 27 14 24" fill="none" stroke="' + HULL + '" stroke-width="6" stroke-linecap="round"/>' +
          '<path d="M16 60.4 Q3 54 5.6 36" fill="none" stroke="' + GOLD + '" stroke-width="1.3" stroke-linecap="round"/>' +
          '<path d="M14 15 Q19 7 23 12.4 Q19 11.6 19.6 16 Q16 13.4 14 18 Z" fill="' + GOLD + '" stroke="' + GOLD_DK + '" stroke-width="1" stroke-linejoin="round"/>' +
          '<path d="M13.6 14.8 L14.6 10 L18.4 14 Z" fill="' + HULL + '" stroke="' + NAVY + '" stroke-width="1.3" stroke-linejoin="round"/>' +
          '<ellipse cx="7.4" cy="23.4" rx="4.4" ry="3.3" fill="' + HULL_LT + '" stroke="' + NAVY + '" stroke-width="1.8"/>' +
          '<circle cx="12.4" cy="20" r="6.4" fill="' + HULL + '" stroke="' + NAVY + '" stroke-width="2"/>' +
          '<ellipse cx="8.2" cy="23.6" rx="3.6" ry="2.6" fill="' + HULL_LT + '"/>' +
          '<circle cx="5.8" cy="22.8" r=".8" fill="' + NAVY + '"/>' +
          '<circle cx="13.4" cy="18.4" r="2" fill="' + NAVY + '"/><circle cx="14" cy="17.7" r=".75" fill="#fff"/>' +
          '<ellipse cx="14.6" cy="22.4" rx="2" ry="1.2" fill="' + BLUSH + '" opacity=".75"/>' +
          '</g>' +
          // popa em voluta dourada
          '<g class="argo-mascot-stern"><path d="M115 52 Q127 50 126 38 Q125 31 119.4 33.4 Q117.6 36.6 120.8 38" fill="none" stroke="' + NAVY + '" stroke-width="6.4" stroke-linecap="round"/>' +
          '<path d="M115 52 Q127 50 126 38 Q125 31 119.4 33.4 Q117.6 36.6 120.8 38" fill="none" stroke="' + GOLD + '" stroke-width="3.2" stroke-linecap="round"/></g>' +
          // casco
          '<path d="M9 49 Q36 63 65 63 Q94 63 121 47 Q121 82 98 97 Q86 103 65 103 Q44 103 32 97 Q9 82 9 49 Z" fill="url(#' + hullGradId + ')" stroke="' + NAVY + '" stroke-width="2.8" stroke-linejoin="round"/>' +
          '<path d="' + HULL_D + '" fill="url(#' + glossGradId + ')"/>' +
          '<g class="argo-fx" clip-path="url(#' + hullClipId + ')"><path class="argo-mascot-shine" d="M-4 44 H8 L-6 108 H-18 Z" fill="#fff" opacity=".28"/></g>' +
          '<path d="' + HULL_D + '" fill="url(#' + hullShadeId + ')"/>' +
          (compact ? '' : '<g clip-path="url(#' + hullClipId + ')" fill="none" stroke="' + HULL_DK + '" stroke-width="1" opacity=".5" stroke-linecap="round">' +
            '<path d="M6 66 Q36 70 65 70.4 Q94 70.4 124 62"/><path d="M6 91 Q36 92.6 65 92.6 Q94 92.6 124 88"/>' +
            '<path d="M24 71 v-3 M58 71 v-2 M74 71 v-2 M108 68 v-3 M40 92 v3 M90 92 v3" stroke-width=".8"/></g>') +
          '<path d="M13 92 Q40 98 65 98 Q90 98 117 90" fill="none" stroke="' + HULL_LT + '" stroke-width="1.2" stroke-linecap="round" opacity=".45"/>' +
          // luz de contorno (rim light) à direita, como se o sol viesse da popa
          '<path d="M121 49 Q121 82 98 97" fill="none" stroke="#BFF3F2" stroke-width="1.3" stroke-linecap="round" opacity=".45"/>' +
          // trilhas de circuito (luz ciano) no casco
          (compact ? '' : '<path d="M22 91 H34 L37 88 H46 M84 88 H93 L96 91 H108" fill="none" stroke="' + CYAN + '" stroke-width=".9" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/>' +
          '<circle class="argo-mascot-led" cx="46" cy="88" r="1.2" fill="' + CYAN + '"/><circle class="argo-mascot-led" style="animation-delay:.9s" cx="84" cy="88" r="1.2" fill="' + CYAN + '"/>') +
          // escudos redondos ao longo do casco, com ferro dourado no centro
          (compact ? [34, 65, 96] : [30, 47.5, 65, 82.5, 100]).map(function (x, i) {
            var r = compact ? 9.6 : 7.4;
            return '<circle cx="' + x + '" cy="80" r="' + r + '" fill="' + SHIELD + '" stroke="' + NAVY + '" stroke-width="' + (compact ? 2.4 : 1.8) + '"/>' +
                   '<circle cx="' + x + '" cy="80" r="' + (r - 2) + '" fill="none" stroke="' + GOLD + '" stroke-width="1.2"/>' +
                   '<circle class="argo-mascot-boss" style="animation-delay:' + (i * 0.28).toFixed(2) + 's" cx="' + x + '" cy="80" r="' + (r * 0.32).toFixed(1) + '" fill="' + GOLD + '" stroke="' + GOLD_DK + '" stroke-width=".7"/>' +
                   '<path d="M' + (x - r * 0.62).toFixed(1) + ' ' + (80 - r * 0.4).toFixed(1) + ' Q' + (x - r * 0.43).toFixed(1) + ' ' + (80 - r * 0.68).toFixed(1) + ' ' + (x - r * 0.08).toFixed(1) + ' ' + (80 - r * 0.68).toFixed(1) + '" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".5"/>';
          }).join('') +
          // friso dourado no topo do casco, com fita de LED ciano
          '<path d="M9 49 Q36 63 65 63 Q94 63 121 47" fill="none" stroke="' + NAVY + '" stroke-width="6.6" stroke-linecap="round"/>' +
          '<path d="M9 49 Q36 63 65 63 Q94 63 121 47" fill="none" stroke="' + GOLD + '" stroke-width="3.8" stroke-linecap="round"/>' +
          '<path d="M14 52 Q38 65.4 65 65.4 Q92 65.4 116 50.6" fill="none" stroke="' + CYAN + '" stroke-width="1.3" stroke-linecap="round" opacity=".95" class="argo-mascot-ledstrip"/>' +
          '<path d="M20 50.4 Q40 60 62 60.4" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity=".5"/>' +
        '</g>' +
        '</g>' +
        // ondinhas da frente com espuma (vao de um lado a outro, bem de leve)
        '<g class="argo-mascot-swell">' +
        '<path d="M5 106 ' + wave + ' C125 113 100 116 65 116 C30 116 5 113 5 106 Z" fill="url(#' + waterGradId + ')" stroke="' + NAVY + '" stroke-width="2" stroke-linejoin="round" opacity=".92"/>' +
        '<path d="M10 108.4 q5 -3 10 0 M52 108.4 q5 -3 10 0 M96 108.4 q5 -3 10 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>' +
        '</g>' +
        '<g class="argo-fx">' + [[26, 103, 1.5, 0], [52, 106, 1.2, .9], [80, 104, 1.6, 1.7], [106, 106, 1.3, .4]].map(function (b) {
          return '<circle class="argo-mascot-bubble" style="animation-delay:' + b[3] + 's" cx="' + b[0] + '" cy="' + b[1] + '" r="' + b[2] + '" fill="#fff" fill-opacity=".75" stroke="#BFE9F7" stroke-width=".6"/>';
        }).join('') + '</g>' +
        // bandeirinha de ponta, balançando
        '<g class="argo-mascot-flag">' +
          '<path d="M106 3 H126 L121.5 8.5 L126 14 H106 Z" fill="' + accent + '" stroke="' + NAVY + '" stroke-width="1.8" stroke-linejoin="round"/>' +
          '<text x="114.5" y="11.6" font-size="8.5" font-weight="800" fill="#fff" text-anchor="middle" font-family="Trebuchet MS,Verdana,sans-serif">' + flagSymbol + '</text>' +
        '</g>' +
        '<circle cx="104" cy="6" r="3.2" fill="' + GOLD + '" stroke="' + NAVY + '" stroke-width="1.6"/>' +
        extra +
      '</svg>'
    );
  }

  // ---------------------------------------------------------------------
  // Olhar: os olhos do comandante acompanham o mouse (so em telas com mouse;
  // desligado com "reduzir movimento"). Mexe so nos olhos dos mascotes que
  // estao na pagina, em no maximo um quadro por vez — sem custo para a pagina.
  // ---------------------------------------------------------------------
  var lookBound = false;
  var NS_SVG = 'http://www.w3.org/2000/svg';
  var calmMotion = function () { return !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); };

  // Sobe um punhadinho de coração/estrela/confete do mascote (some sozinho).
  function burst(svg, glyph, color, n) {
    for (var i = 0; i < n; i++) {
      var t = document.createElementNS(NS_SVG, 'text');
      t.setAttribute('x', String(28 + i * (60 / Math.max(1, n - 1)) + (i % 2 ? 4 : -4)));
      t.setAttribute('y', '16');
      t.setAttribute('font-size', String(11 + (i % 3) * 2));
      t.setAttribute('fill', color);
      t.setAttribute('stroke', '#fff'); t.setAttribute('stroke-width', '.9'); t.setAttribute('paint-order', 'stroke');
      t.setAttribute('class', 'argo-mascot-float');
      t.setAttribute('text-anchor', 'middle');
      t.style.animationDelay = (i * 0.11).toFixed(2) + 's';
      t.textContent = glyph;
      svg.appendChild(t);
      (function (el) { setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1500); })(t);
    }
  }

  // Reação do mascote: 'hop' (pulinho + estrelas), 'wink' (piscadinha) ou 'love' (corações).
  // Cinco toques seguidos viram uma voltinha completa do barco (e dispara o evento
  // "argo-mascot:easter" no document, caso o app queira dar um prêmio).
  var pokeCount = 0, pokeTimes = [];
  function poke(svg, kind) {
    if (!svg || !svg.classList || calmMotion()) return;
    var kinds = ['hop', 'wink', 'love'];
    kind = kind || kinds[pokeCount++ % kinds.length];
    svg.classList.remove('argo-mascot-poked'); void svg.getBoundingClientRect(); svg.classList.add('argo-mascot-poked');
    setTimeout(function () { svg.classList.remove('argo-mascot-poked'); }, 650);
    var compactIcon = svg.classList.contains('argo-mascot-lite');
    if (kind === 'wink') { svg.classList.add('argo-mascot-winking'); setTimeout(function () { svg.classList.remove('argo-mascot-winking'); }, 900); }
    else if (!compactIcon && kind === 'love') burst(svg, '♥', '#E5486B', 3);
    else if (!compactIcon) burst(svg, '★', '#F2B84B', 3);
    var now = Date.now();
    pokeTimes.push(now);
    pokeTimes = pokeTimes.filter(function (t) { return now - t < 3500; });
    if (pokeTimes.length >= 5) {
      pokeTimes = [];
      svg.classList.add('argo-mascot-spun');
      if (!compactIcon) burst(svg, '✶', '#5EE6FF', 5);
      setTimeout(function () { svg.classList.remove('argo-mascot-spun'); }, 1100);
      try { document.dispatchEvent(new CustomEvent('argo-mascot:easter')); } catch (e) { /* navegador antigo */ }
    }
  }

  // Troca só o desenho (humor) dentro de um elemento que já contém um mascote.
  function swapMood(host, mood, sz) {
    var old = host && host.querySelector('svg.argo-mascot-icon');
    if (!old) return;
    var tmp = document.createElement('span');
    tmp.innerHTML = boatSVG(mood, sz);
    old.parentNode.replaceChild(tmp.firstChild, old);
  }

  // "Vida" do mascote (uma vez por página): cada mascote olha para o cursor a partir
  // da própria posição; no celular, olha para onde você tocou; reage a cliques; e cochila
  // (olhos fechados + Zzz) se o app ficar ~30 s parado. Tudo desligado com "reduzir movimento".
  function bindLook() {
    if (lookBound || typeof window === 'undefined' || !window.matchMedia) return;
    lookBound = true;
    if (calmMotion()) return;
    var root = document.documentElement;
    var raf = 0, mx = null, my = null, touchT = 0;

    function apply() {
      raf = 0;
      var els = document.querySelectorAll('.argo-mascot-icon:not(.argo-mascot-lite) .argo-mascot-look');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (mx === null) { el.style.transform = ''; continue; }
        var svg = el.ownerSVGElement; if (!svg) continue;
        var r = svg.getBoundingClientRect(); if (!r.width) continue;
        var dx = mx - (r.left + r.width * 0.32), dy = my - (r.top + r.height * 0.33);
        var d = Math.sqrt(dx * dx + dy * dy) || 1, k = Math.min(1, d / 150);
        el.style.transform = 'translate(' + (dx / d * k * 2.2).toFixed(2) + 'px,' + (dy / d * k * 1.6).toFixed(2) + 'px)';
      }
    }
    function aim(x, y) { mx = x; my = y; if (!raf) raf = window.requestAnimationFrame(apply); }
    function release() { mx = null; my = null; if (!raf) raf = window.requestAnimationFrame(apply); }

    window.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      aim(e.clientX, e.clientY);
    }, { passive: true });
    // Toque: olha para onde você tocou e volta ao centro depois de 2 s.
    window.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch') return;
      aim(e.clientX, e.clientY);
      clearTimeout(touchT); touchT = setTimeout(release, 2000);
    }, { passive: true });
    root.addEventListener('mouseleave', release);

    // Cochilo por inatividade.
    var sleepT = 0, lastAct = 0;
    function arm() { clearTimeout(sleepT); sleepT = setTimeout(function () { if (!document.hidden) root.classList.add('argo-mascot-sleepy'); }, 30000); }
    function wake() {
      var now = Date.now();
      var asleep = root.classList.contains('argo-mascot-sleepy');
      if (!asleep && now - lastAct < 700) return;
      lastAct = now;
      if (asleep) root.classList.remove('argo-mascot-sleepy');
      arm();
    }
    ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) { window.addEventListener(ev, wake, { passive: true }); });
    window.addEventListener('scroll', wake, { passive: true, capture: true });
    arm();

    // Clique/toque em qualquer mascote (ou botão que o contém) → reação.
    // Espera um instante porque quem clica pode trocar o desenho (ex.: login).
    document.addEventListener('click', function (e) {
      var host = e.target && e.target.closest ? e.target.closest('svg.argo-mascot-icon, button, .argo-mascot-toast-icon') : null;
      if (!host) return;
      setTimeout(function () {
        var svg = host.matches && host.matches('svg.argo-mascot-icon') ? host : host.querySelector('svg.argo-mascot-icon');
        if (svg) poke(svg);
      }, 40);
    });
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
      '.argo-mascot-rock{transform-origin:65px 104px;animation:argoMascotRock 4.2s ease-in-out infinite}' +
      '@keyframes argoMascotRock{0%,100%{transform:rotate(-1.3deg)}50%{transform:rotate(1.3deg)}}' +
      '.argo-mascot-swell{animation:argoMascotSwell 3.6s ease-in-out infinite}' +
      '@keyframes argoMascotSwell{0%,100%{transform:translateX(-2.5px)}50%{transform:translateX(2.5px)}}' +
      // ---- vida extra: respira, mexe a cabeça/cabelo, vela enfuna, estrelas brilham ----
      '.argo-mascot-breathe{transform-origin:42px 74px;animation:argoMascotBreathe 3.6s ease-in-out infinite}' +
      '@keyframes argoMascotBreathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.012,1.024)}}' +
      '.argo-mascot-head{transform-origin:42px 54px;animation:argoMascotHead 5.2s ease-in-out infinite}' +
      '@keyframes argoMascotHead{0%,100%{transform:rotate(-1.6deg)}50%{transform:rotate(1.6deg)}}' +
      '.argo-mascot-hair{transform-origin:42px 28px;animation:argoMascotHair 2.9s ease-in-out infinite .4s}' +
      '@keyframes argoMascotHair{0%,100%{transform:rotate(-1.8deg)}50%{transform:rotate(1.8deg)}}' +
      '.argo-mascot-prow{transform-origin:19px 62px;animation:argoMascotProw 3.4s ease-in-out infinite}' +
      '@keyframes argoMascotProw{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(2.6deg)}}' +
      '.argo-mascot-stern{transform-origin:115px 52px;animation:argoMascotStern 2.8s ease-in-out infinite}' +
      '@keyframes argoMascotStern{0%,100%{transform:rotate(2.4deg)}50%{transform:rotate(-3.4deg)}}' +
      '.argo-mascot-sail{transform-origin:104px 40px;animation:argoMascotSail 3.8s ease-in-out infinite}' +
      '@keyframes argoMascotSail{0%,100%{transform:scaleX(1) skewY(0)}50%{transform:scaleX(1.035) skewY(-.9deg)}}' +
      '.argo-mascot-star,.argo-mascot-glow,.argo-mascot-boss,.argo-mascot-bubble,.argo-mascot-pop,.argo-mascot-glint,.argo-mascot-confetti,.argo-mascot-halo{transform-box:fill-box;transform-origin:center}' +
      '.argo-mascot-star{animation:argoMascotTwinkle 2.4s ease-in-out infinite}' +
      '@keyframes argoMascotTwinkle{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.4);opacity:.85}}' +
      '.argo-mascot-glow{animation:argoMascotGlow 2.4s ease-in-out infinite}' +
      '@keyframes argoMascotGlow{0%,100%{opacity:.08;transform:scale(.8)}50%{opacity:.4;transform:scale(1.2)}}' +
      '.argo-mascot-chip{animation:argoMascotChip 1.8s ease-in-out infinite}' +
      '@keyframes argoMascotChip{0%,100%{opacity:1}50%{opacity:.62}}' +
      '.argo-mascot-ledstrip{animation:argoMascotLed 2.2s ease-in-out infinite}' +
      '.argo-mascot-led{animation:argoMascotLed 1.6s ease-in-out infinite}' +
      '@keyframes argoMascotLed{0%,100%{opacity:.5}50%{opacity:1}}' +
      '.argo-mascot-boss{animation:argoMascotBoss 3s ease-in-out infinite}' +
      '@keyframes argoMascotBoss{0%,65%,100%{transform:scale(1)}80%{transform:scale(1.55)}}' +
      '.argo-mascot-shine{animation:argoMascotShine 6.5s ease-in-out infinite}' +
      '@keyframes argoMascotShine{0%,45%{transform:translateX(-6px);opacity:0}55%{opacity:1}90%,100%{transform:translateX(164px);opacity:0}}' +
      '.argo-mascot-bubble{animation:argoMascotBubble 2.8s ease-in infinite}' +
      '@keyframes argoMascotBubble{0%{transform:translateY(0) scale(.5);opacity:0}20%{opacity:.9}100%{transform:translateY(-17px) scale(1.15);opacity:0}}' +
      '.argo-mascot-swell2{animation:argoMascotSwell2 4.4s ease-in-out infinite}' +
      '@keyframes argoMascotSwell2{0%,100%{transform:translateX(3px)}50%{transform:translateX(-3px)}}' +
      '.argo-mascot-halo{animation:argoMascotHalo 4s ease-in-out infinite}' +
      '@keyframes argoMascotHalo{0%,100%{opacity:.65;transform:scale(1)}50%{opacity:1;transform:scale(1.07)}}' +
      '.argo-mascot-gull{animation:argoMascotGull 16s linear infinite 2s;opacity:0}' +
      '@keyframes argoMascotGull{0%{transform:translate(-16px,14px);opacity:0}6%{opacity:.9}50%{transform:translate(66px,3px)}94%{opacity:.9}100%{transform:translate(148px,12px);opacity:0}}' +
      '.argo-mascot-glint{animation:argoMascotGlint 7s ease-in-out infinite 1s;transform:scale(0);opacity:0}' +
      '@keyframes argoMascotGlint{0%,86%,100%{transform:scale(0) rotate(0);opacity:0}92%{transform:scale(1.25) rotate(25deg);opacity:1}97%{transform:scale(.6) rotate(45deg);opacity:.6}}' +
      '.argo-mascot-pop{animation:argoMascotSpark 1.7s ease-in-out infinite}' +
      '@keyframes argoMascotSpark{0%,100%{transform:scale(.7) rotate(0);opacity:.7}50%{transform:scale(1.3) rotate(25deg);opacity:1}}' +
      '.argo-mascot-confetti{animation:argoMascotConfetti 2.6s ease-in infinite;opacity:0}' +
      '@keyframes argoMascotConfetti{0%{transform:translateY(-4px) rotate(0);opacity:0}15%{opacity:1}100%{transform:translateY(50px) rotate(280deg);opacity:0}}' +
      '.argo-mascot-drip{animation:argoMascotDrip 2.2s ease-in infinite;opacity:0}' +
      '@keyframes argoMascotDrip{0%{transform:translateY(0);opacity:0}15%{opacity:1}100%{transform:translateY(16px);opacity:0}}' +
      '.argo-mascot-qmark{animation:argoMascotQ 2.6s ease-in-out infinite}' +
      '@keyframes argoMascotQ{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-3px) scale(1.07)}}' +
      // sobrancelhas sobem de vez em quando; no humor "pensando" os pontinhos do balão pulsam
      '.argo-mascot-brow{animation:argoMascotBrow 6.5s ease-in-out infinite}' +
      '@keyframes argoMascotBrow{0%,86%,100%{transform:translateY(0)}91%{transform:translateY(-1.6px)}96%{transform:translateY(-.4px)}}' +
      '.argo-mascot-dot{animation:argoMascotDot 1.2s ease-in-out infinite}' +
      '@keyframes argoMascotDot{0%,70%,100%{opacity:.3}35%{opacity:1}}' +
      '.argo-mascot-think{animation:argoMascotQ 2.2s ease-in-out infinite}' +
      '.argo-mascot-m-thinking .argo-mascot-chip{animation-duration:.7s}.argo-mascot-m-thinking .argo-mascot-star{animation-duration:1.2s}.argo-mascot-m-thinking .argo-mascot-rock{animation-duration:5.5s}' +
      // ---- interatividade: reações a clique, hover, cochilo ----
      '.argo-mascot-poked{animation:argoMascotPoke .6s cubic-bezier(.3,1.4,.5,1)!important}' +
      '@keyframes argoMascotPoke{0%{transform:scale(1,1)}22%{transform:scale(1.1,.88) translateY(2px)}50%{transform:scale(.94,1.12) translateY(-9px)}75%{transform:scale(1.03,.97) translateY(0)}100%{transform:scale(1,1)}}' +
      '.argo-mascot-spun{transform-origin:50% 55%;animation:argoMascotSpin 1s cubic-bezier(.4,.1,.3,1)!important}' +
      '@keyframes argoMascotSpin{0%{transform:rotate(0) scale(1)}40%{transform:rotate(200deg) scale(1.15)}100%{transform:rotate(360deg) scale(1)}}' +
      '.argo-mascot-float{animation:argoMascotFloat 1.1s ease-out both;transform-box:fill-box;transform-origin:center;pointer-events:none}' +
      '@keyframes argoMascotFloat{0%{opacity:0;transform:translateY(6px) scale(.5)}20%{opacity:1}100%{opacity:0;transform:translateY(-26px) scale(1.25) rotate(14deg)}}' +
      '.argo-mascot-eyeR{transform-box:fill-box;transform-origin:center}' +
      '.argo-mascot-winking .argo-mascot-eyeR{transform:scaleY(.08);transition:transform .08s}' +
      '.argo-mascot-icon:not(.argo-mascot-lite):hover .argo-mascot-wave,.argo-mascot-icon:not(.argo-mascot-lite):hover .argo-mascot-wave2{animation-duration:.6s}' +
      '.argo-mascot-icon:not(.argo-mascot-lite):hover .argo-mascot-flag{animation-duration:1s}' +
      '.argo-mascot-zzz{opacity:0;transition:opacity .6s}' +
      '.argo-mascot-z{animation:argoMascotZ 2.6s ease-in-out infinite;transform-box:fill-box;transform-origin:center}' +
      '@keyframes argoMascotZ{0%,100%{transform:translate(0,2px) scale(.8);opacity:.4}50%{transform:translate(2px,-3px) scale(1.1);opacity:1}}' +
      '.argo-mascot-sleepy .argo-mascot-m-info .argo-mascot-zzz{opacity:1}' +
      '.argo-mascot-sleepy .argo-mascot-m-info .argo-mascot-blink{animation:none;transform:scaleY(.1)}' +
      '.argo-mascot-sleepy .argo-mascot-m-info .argo-mascot-wave{animation:none;transform:rotate(18deg)}' +
      '.argo-mascot-sleepy .argo-mascot-m-info .argo-mascot-brow{animation:none;transform:translateY(1px)}' +
      '.argo-mascot-sleepy .argo-mascot-m-info.argo-mascot-bob{animation-duration:6s}' +
      // erro: o barquinho treme de nervoso
      '.argo-mascot-m-error .argo-mascot-rock{animation-duration:.9s}' +
      // sucesso: balança mais animado
      '.argo-mascot-m-success .argo-mascot-rock{animation-duration:2.2s}.argo-mascot-m-success .argo-mascot-bob{animation-duration:1.6s}' +
      // ícones pequenos (chat/listas): só o essencial, bem leve
      '.argo-mascot-lite .argo-fx,.argo-mascot-lite .argo-mascot-halo,.argo-mascot-lite .argo-mascot-bubble,.argo-mascot-lite .argo-mascot-glow{display:none}' +
      '.argo-mascot-lite .argo-mascot-breathe,.argo-mascot-lite .argo-mascot-head,.argo-mascot-lite .argo-mascot-hair,.argo-mascot-lite .argo-mascot-prow,.argo-mascot-lite .argo-mascot-stern,.argo-mascot-lite .argo-mascot-sail,.argo-mascot-lite .argo-mascot-star,.argo-mascot-lite .argo-mascot-chip,.argo-mascot-lite .argo-mascot-ledstrip,.argo-mascot-lite .argo-mascot-led,.argo-mascot-lite .argo-mascot-boss,.argo-mascot-lite .argo-mascot-swell2{animation:none}' +
      // entrada animada do ícone no aviso e empolgação ao passar o mouse no botão do assistente
      '.argo-mascot-toast.argo-mascot-visible .argo-mascot-toast-icon{animation:argoMascotPopIn .7s cubic-bezier(.3,1.5,.5,1) both}' +
      '@keyframes argoMascotPopIn{0%{transform:scale(.3) rotate(-14deg)}60%{transform:scale(1.2) rotate(7deg)}100%{transform:scale(1) rotate(0)}}' +
      '.argo-assistant-fab:hover .argo-mascot-bob{animation:argoMascotHop .7s ease-in-out infinite}' +
      '@keyframes argoMascotHop{0%,100%{transform:translateY(0) scale(1,1)}40%{transform:translateY(-5px) scale(1.04,.97)}70%{transform:translateY(0) scale(.97,1.03)}}' +
      '.argo-assistant-fab:hover .argo-mascot-wave,.argo-assistant-fab:hover .argo-mascot-wave2{animation-duration:.55s}' +
      '.argo-assistant-fab:hover .argo-mascot-rock{animation-duration:1.4s}' +
      '.argo-mascot-look{transition:transform .14s ease-out}' +
      '@media (prefers-reduced-motion: reduce){.argo-mascot-icon,.argo-mascot-icon *,.argo-mascot-toast-icon{animation:none!important}.argo-mascot-bob,.argo-mascot-flag,.argo-mascot-wave,.argo-mascot-wave2,.argo-mascot-blink,.argo-mascot-rock,.argo-mascot-swell{animation:none}.argo-mascot-look{transition:none;transform:none!important}.argo-mascot-toast{transition:none}}' +
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
        'width:64px;height:64px;border-radius:50%;background:var(--bg-card,#151F35);border:1px solid rgba(127,127,127,0.18);'+
        'box-shadow:var(--shadow-lg,0 24px 48px -12px rgba(0,0,0,.4));display:flex;align-items:center;justify-content:center;'+
        'padding:0;cursor:pointer;z-index:9997;transition:transform .18s ease;touch-action:manipulation}' +
      '.argo-assistant-fab:hover{transform:translateY(-2px) scale(1.04)}' +
      '.argo-assistant-fab[aria-expanded="true"]{transform:scale(.9)}' +
      '.argo-assistant-fab .argo-mascot-icon{width:40px;height:40px}' +

      '.argo-assistant-hint{position:fixed;left:calc(16px + env(safe-area-inset-left) + 64px);bottom:calc(30px + env(safe-area-inset-bottom));'+
        'display:flex;align-items:center;gap:8px;max-width:230px;background:var(--bg-card,#151F35);color:var(--text-main,#F1F5F9);'+
        'padding:10px 8px 10px 14px;border-radius:14px;box-shadow:var(--shadow-lg,0 24px 48px -12px rgba(0,0,0,.4));'+
        'border:1px solid rgba(127,127,127,0.18);font-size:13px;font-weight:600;line-height:1.35;z-index:9996;'+
        'animation:argoAssistantIn .25s ease}' +
      '.argo-assistant-hint-x{flex:0 0 auto;border:none;background:transparent;color:inherit;opacity:.55;cursor:pointer;'+
        'font-size:13px;padding:4px 6px;border-radius:8px}' +
      '.argo-assistant-hint-x:hover{opacity:1;background:rgba(127,127,127,.14)}' +

      '.argo-assistant-panel{position:fixed;left:max(16px,env(safe-area-inset-left));bottom:calc(90px + env(safe-area-inset-bottom));'+
        'width:min(480px,calc(100vw - 32px));height:min(78vh,680px);max-height:calc(100vh - 100px);transform-origin:bottom left;display:flex;flex-direction:column;overflow:hidden;'+
        'background:var(--bg-card,#151F35);color:var(--text-main,#F1F5F9);border-radius:var(--radius-ui,12px);'+
        'box-shadow:var(--shadow-lg,0 24px 48px -12px rgba(0,0,0,.4));border:1px solid rgba(127,127,127,0.18);'+
        'opacity:0;transform:translateY(14px) scale(.85);pointer-events:none;transition:opacity .22s ease,transform .22s cubic-bezier(.2,.9,.3,1.1),width .22s ease,height .22s ease;z-index:9998}' +
      '.argo-assistant-panel.argo-assistant-open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}' +

      '.argo-assistant-head{display:flex;align-items:center;gap:10px;padding:14px 8px 14px 14px;'+
        'border-bottom:1px solid rgba(127,127,127,.16);flex:0 0 auto}' +
      '.argo-assistant-head .argo-mascot-icon{width:48px;height:48px;flex:0 0 auto}.argo-assistant-mascot-btn{flex:0 0 auto;border:none;background:transparent;padding:2px;margin:0;cursor:pointer;border-radius:50%;transition:transform .18s ease;touch-action:manipulation}.argo-assistant-mascot-btn:hover{transform:scale(1.1) rotate(-4deg)}.argo-assistant-mascot-btn:focus-visible{outline:3px solid var(--brand-primary,#0091C2);outline-offset:2px}' +
      '.argo-assistant-head-text{display:flex;flex-direction:column;flex:1;min-width:0}' +
      '.argo-assistant-head-text strong{font-size:16px}' +
      '.argo-assistant-head-text span{font-size:12px;color:var(--text-muted,#A7B7CC)}' +
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

      '.argo-assistant-log{flex:1;overflow-y:auto;padding:14px 16px 6px;display:flex;flex-direction:column;gap:12px;min-height:70px}' +
      '.argo-assistant-msg{display:flex;gap:8px;max-width:94%;min-width:0}' +
      '.argo-assistant-msg-bot{align-self:flex-start}' +
      '.argo-assistant-msg-user{align-self:flex-end;flex-direction:row-reverse}' +
      '.argo-assistant-msg-icon{flex:0 0 auto;width:28px;height:28px;margin-top:3px}' +
      '.argo-assistant-msg-icon .argo-mascot-icon{width:28px;height:28px}' +
      '.argo-assistant-bubble{font-size:14.5px;line-height:1.5;padding:10px 14px;border-radius:14px;white-space:pre-line;word-break:break-word}' +
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
      '.argo-assistant-panel.argo-assistant-wide{width:min(820px,calc(100vw - 32px));height:min(90vh,900px)}' +
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
      '.argo-assistant-chip{border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font-size:13px;font-weight:600;'+
        'padding:7px 13px;border-radius:20px;cursor:pointer;transition:background .15s ease,border-color .15s ease}' +
      '.argo-assistant-chip:hover{background:rgba(0,145,194,.14);border-color:var(--brand-primary,var(--argo-mascot-info,#0091C2))}' +

      '.argo-assistant-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid rgba(127,127,127,.16);flex:0 0 auto}' +
      '.argo-assistant-input{flex:1;min-width:0;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;'+
        'border-radius:20px;padding:10px 16px;font-size:14.5px;line-height:1.35;outline:none;font-family:inherit;resize:none;max-height:96px;width:100%;box-sizing:border-box}' +
      '.argo-assistant-input:focus{border-color:var(--brand-primary,var(--argo-mascot-info,#0091C2))}' +
      '.argo-assistant-send{flex:0 0 auto;width:42px;height:42px;border-radius:50%;border:none;'+
        'background:var(--brand-primary,var(--argo-mascot-info,#0091C2));color:#fff;display:flex;align-items:center;'+
        'justify-content:center;cursor:pointer}' +
      '.argo-assistant-send:hover{filter:brightness(1.1)}' +

      // BUG do X que "não some": o balão e o painel têm display:flex, e uma regra de autor
      // com display vence o [hidden] padrão do navegador (display:none). Resultado: o JS
      // marcava hint.hidden = true, mas o balão continuava na tela. Esta regra devolve
      // ao atributo hidden a força que ele deveria ter.
      '.argo-assistant-hint[hidden],.argo-assistant-panel[hidden]{display:none!important}' +
      // Fases da resposta: o Argo "ouve" enquanto você digita e "fala" (cabeça assente, mão acena) enquanto escreve.
      '.argo-assistant-listening .argo-mascot-head{animation:argoMascotListen 1.8s ease-in-out infinite}' +
      '@keyframes argoMascotListen{0%,100%{transform:rotate(-5deg) translateY(.4px)}50%{transform:rotate(-3deg) translateY(-.4px)}}' +
      '.argo-assistant-talking .argo-mascot-head{animation:argoMascotTalk .55s ease-in-out infinite}' +
      '@keyframes argoMascotTalk{0%,100%{transform:rotate(-1deg) translateY(0)}50%{transform:rotate(1.4deg) translateY(-1.6px)}}' +
      '.argo-assistant-talking .argo-mascot-wave{animation-duration:.9s}' +
      '#argoAssistantStatus.argo-assistant-status-busy .argo-assistant-led{background:#6D4FD0;animation:argoMascotLed 1s ease-in-out infinite}' +
      '.argo-assistant-src{font-size:11px;color:var(--text-muted,#A7B7CC);padding:0 4px}.argo-assistant-src summary{cursor:pointer;font-weight:700;padding:3px 0;list-style:none}' +
      '.argo-assistant-src summary::-webkit-details-marker{display:none}.argo-assistant-src summary::before{content:"\\25B8 ";display:inline-block;transition:transform .15s}.argo-assistant-src[open] summary::before{transform:rotate(90deg)}' +
      '.argo-assistant-src ul{margin:2px 0 4px;padding-left:16px}.argo-assistant-src li{margin:2px 0;line-height:1.35}.argo-assistant-src-hint{display:block;margin-top:2px;opacity:.85}' +
      '.argo-assistant-chip-retry{border-style:dashed;font-weight:700}' +
      '@keyframes argoAssistantIn{0%{opacity:0;transform:translateY(6px)}100%{opacity:1;transform:translateY(0)}}' +
      '@keyframes argoAssistantTyping{0%,60%,100%{opacity:.3}30%{opacity:1}}' +
      '@media (max-width:560px){.argo-assistant-panel,.argo-assistant-panel.argo-assistant-wide{left:8px;right:8px;width:auto;height:min(86dvh,calc(100dvh - 100px))}}' +
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
    bindLook();
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
  // O humor do Argo acompanha o que ele diz: "não consta" vira cara de dúvida, em vez de sorriso padrão.
  var RE_SEM_DADO = /\b(n[ãa]o consta|n[ãa]o encontrei|n[ãa]o tenho (essa|a) informa|n[ãa]o h[áa] (registro|informa)|sem informa[çc][ãa]o)/i;
  function moodFromText(text, bad) {
    if (bad) return 'error';
    return RE_SEM_DADO.test(String(text || '').slice(0, 400)) ? 'notfound' : 'info';
  }
  var RE_AGRADECE = /\b(obrigad[oa]|valeu|brigad[oa]|muito bom|perfeito|ajudou)\b/i;
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
          '<button type="button" class="argo-assistant-mascot-btn" id="argoAssistantMascot" aria-label="Ampliar ou reduzir o painel" title="Clique no Argo para ampliar">' + boatSVG('info', 48) + '</button>' +
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
      if (localStorage.getItem(WIDE_KEY) !== '0') setWide(true);
    } catch (e) { setWide(true); /* localStorage indisponível - abre ampliado */ }
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
    // Fase da resposta no cabeçalho ("consultando as normas…"): quem espera sabe o que o Argo está fazendo.
    var phaseT = 0;
    function setPhase(text) {
      clearTimeout(phaseT);
      if (!text) { refreshStatus(); return; }
      statusEl.querySelector('em').textContent = text;
      statusEl.className = 'argo-assistant-status-busy';
    }
    function phasesFor(kind) {
      // kind: 'procura' (antes de saber o caminho) | 'normas' (esperando o início do stream)
      setPhase(kind === 'procura' ? 'procurando no diretório…' : 'consultando as normas e o diretório…');
      phaseT = setTimeout(function () { if (busy) setPhase('ainda trabalhando nisso… (dá para parar)'); }, 7000);
    }
    window.addEventListener('online', refreshStatus);
    window.addEventListener('offline', refreshStatus);

    // ---------- mensagens ----------
    function scrollDown() { log.scrollTop = log.scrollHeight; }
    function announce(text) { sr.textContent = ''; setTimeout(function () { sr.textContent = plainText(text).slice(0, 700); }, 30); }

    function makeBotRow(mood) {
      if (busy) pendingMood = mood || null; else if (mood && mood !== 'info') reactMood(mood);
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
      var srcs = [], seen = {};
      (result.sources || []).forEach(function (f) {
        var nm = [f && f.documento, f && f.referencia].filter(Boolean).join(', ');
        if (nm && !seen[nm]) { seen[nm] = 1; srcs.push(nm); }
      });
      if (srcs.length) {
        var det = document.createElement('details'); det.className = 'argo-assistant-src';
        var sm = document.createElement('summary'); sm.textContent = 'Trechos de norma consultados (' + Math.min(srcs.length, 4) + ')';
        var ul = document.createElement('ul');
        srcs.slice(0, 4).forEach(function (x) { var li = document.createElement('li'); li.textContent = x; ul.appendChild(li); });
        var hn = document.createElement('span'); hn.className = 'argo-assistant-src-hint'; hn.textContent = 'São os trechos que a base achou para a pergunta; confira o texto oficial vigente.';
        det.appendChild(sm); det.appendChild(ul); det.appendChild(hn); b.col.appendChild(det);
      }
      if (result.units && result.units.length) {
        var wrap = document.createElement('div'); wrap.className = 'argo-assistant-units';
        result.units.slice(0, 5).forEach(function (u) { wrap.appendChild(buildUnit(u)); });
        b.col.appendChild(wrap);
      }
      var acts = document.createElement('div'); acts.className = 'argo-assistant-msg-actions';
      if (plain && plain.length > 60 && !result.crisis) acts.appendChild(tinyBtn('Copiar', 'argo-assistant-mini-ghost', function (ev) { copyText(plain, ev.currentTarget); }));
      if (result.badge === 'IA') {
        acts.appendChild(tinyBtn('Refazer', 'argo-assistant-mini-ghost', function () { if (!busy && lastQuestion) ask(lastQuestion, { regen: true, silent: true }); }));
        var up = tinyBtn('👍', 'argo-assistant-mini-ghost', function () {
          up.disabled = down.disabled = true; up.classList.add('is-on');
          poke(root.querySelector('#argoAssistantMascot svg.argo-mascot-icon'), 'love');
          announce('Que bom que ajudou!');
        });
        up.setAttribute('aria-label', 'Resposta útil');
        var down = tinyBtn('👎', 'argo-assistant-mini-ghost', function () {
          up.disabled = down.disabled = true; down.classList.add('is-on');
          addMsg('Obrigado por avisar! Posso tentar de outro jeito. Quanto mais específica a pergunta (unidade, bairro, público), melhor a resposta.', 'bot', 'notfound');
          renderQuick([
            { label: 'Explicar de outro jeito', ask: 'Explique de outro jeito, mais simples e com um exemplo.', force: true },
            { label: 'Mais curto, só o essencial', ask: 'Resuma em 2 ou 3 frases, só o essencial.', force: true },
            { label: 'Refazer a resposta', run: function () { if (!busy && lastQuestion) ask(lastQuestion, { regen: true, silent: true }); } },
            { label: 'Mais assuntos', menu: true }
          ]);
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
        btn.className = 'argo-assistant-chip' + (a.menu ? ' argo-assistant-chip-menu' : '') + (a.ask ? ' argo-assistant-chip-ask' : '') + (a.retry ? ' argo-assistant-chip-retry' : '');
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
    // Troca só o desenho do mascote (botão flutuante e cabeçalho) para o humor indicado.
    var moodT = 0, pendingMood = null;
    function setMascotMood(el, mood, sz) { swapMood(el, mood, sz); }
    // Fab e cabeçalho: "pensando" enquanto a IA responde; depois reagem ao humor da
    // resposta (sucesso, não achei, erro) por 4 s e voltam ao normal.
    function moodBoth(m) {
      setMascotMood(fab, m, 30);
      setMascotMood(root.querySelector('#argoAssistantMascot'), m, 48);
    }
    function reactMood(m) {
      clearTimeout(moodT);
      moodBoth(m);
      if (m !== 'info') moodT = setTimeout(function () { if (!busy) moodBoth('info'); }, 4000);
    }
    function mascotBtnEl() { return root.querySelector('#argoAssistantMascot'); }
    function setBusy(on) {
      if (busy !== on) {
        if (on) { clearTimeout(moodT); pendingMood = null; moodBoth('thinking'); }
        else { var m = pendingMood || 'info'; pendingMood = null; reactMood(m); }
      }
      busy = on;
      if (!on) { clearTimeout(phaseT); mascotBtnEl().classList.remove('argo-assistant-talking'); fab.classList.remove('argo-assistant-talking'); refreshStatus(); }
      fab.classList.toggle('argo-assistant-busy', on);
      sendBtn.innerHTML = on ? svgStop : svgSend;
      sendBtn.classList.toggle('is-stop', on);
      sendBtn.setAttribute('aria-label', on ? 'Parar resposta' : 'Enviar pergunta');
      log.setAttribute('aria-busy', on ? 'true' : 'false');
    }

    function finishUnread() { if (!isOpen) { dot.hidden = false; poke(fab.querySelector('svg.argo-mascot-icon'), 'hop'); } }

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
      var mascotBtn0 = root.querySelector('#argoAssistantMascot');
      function talking(on) { mascotBtn0.classList.toggle('argo-assistant-talking', on); fab.classList.toggle('argo-assistant-talking', on); }
      phasesFor('normas');
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
        if (!b) { setPhase('escrevendo a resposta…'); talking(true); }
        ensureBubble();
        acc = (typeof full === 'string') ? full : acc + piece;
        if (!raf) raf = (window.requestAnimationFrame || setTimeout)(paint, 16);
      }
      var p;
      try { p = result.stream.run(onDelta, abortCtl.signal); } catch (e) { p = Promise.reject(e); }
      return Promise.resolve(p).then(function (final) {
        finished = true; talking(false);
        if (myRun !== runId) return;
        var f = (typeof final === 'string') ? { text: final } : (final || {});
        var text = f.text || acc;
        if (!b) { typing.remove(); b = makeBotRow(result.mood || 'info'); bub = document.createElement('div'); bub.className = 'argo-assistant-bubble argo-md'; b.col.appendChild(bub); log.appendChild(b.row); }
        bub.classList.remove('argo-assistant-streaming');
        renderMd(text, bub);
        var endMood = f.mood || moodFromText(text, f.bad);
        if (endMood !== 'info') { pendingMood = endMood; swapMood(b.icon, endMood, 24); }
        var finalResult = { badge: f.badge || result.badge || 'IA', note: f.note || '', sources: f.sources || [], units: f.units || [], quickActions: f.quickActions || result.quickActions, followups: f.followups || result.followups, mood: result.mood };
        decorate(b, finalResult, plainText(text));
        renderQuick(quickFor(finalResult));
        announce(text);
        scrollDown();
      }, function (err) {
        finished = true; talking(false);
        if (myRun !== runId) return;
        var partial = (err && err.partial) || acc;
        if (b && partial && partial.length > 25) {
          bub.classList.remove('argo-assistant-streaming');
          renderMd(partial + (stopped ? '\n\n(resposta interrompida)' : '\n\n(a resposta foi cortada por falha de conexão)'), bub);
          decorate(b, { badge: 'IA' }, plainText(partial));
          renderQuick(quickFor({ quickActions: (result.stream.fallback && result.stream.fallback.quickActions) || [], followups: [] }).concat(retryChip(err)));
          return;
        }
        if (b) b.row.remove();
        typing.remove();
        if (stopped) { addMsg('Resposta interrompida.', 'bot', 'info'); renderQuick(defaultQuick().concat(retryChip(err))); return; }
        var msg = err && err.userMessage;
        if (msg) { addMsg(msg, 'bot', 'notfound'); renderQuick(defaultQuick().concat(retryChip(err))); return; }
        showAnswer(result.stream.fallback || null);
        var rc = retryChip(err);
        if (rc.length) renderQuick(quickFor(result.stream.fallback || {}).concat(rc));
      }).then(function () {
        if (myRun !== runId) return;
        abortCtl = null; setBusy(false); finishUnread(); refreshStatus();
      });
    }
    // "Tentar de novo" quando a ida à IA falhou (rede, limite, interrupção). Não aparece para aviso de dado pessoal nem socorro.
    function retryChip(err) {
      if ((err && err.noRetry) || !lastQuestion) return [];
      return [{ label: '↻ Tentar de novo', retry: true, run: function () { if (!busy && lastQuestion) ask(lastQuestion, { regen: true, silent: true }); } }];
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
      if (RE_AGRADECE.test(text) && text.length < 60) poke(mascotBtnEl().querySelector('svg.argo-mascot-icon'), 'love');
      mascotBtnEl().classList.remove('argo-assistant-listening');
      setBusy(true);
      phasesFor('procura');
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
    var mascotBtn = root.querySelector('#argoAssistantMascot');
    mascotBtn.addEventListener('click', function (e) { e.stopPropagation(); wideBtn.click(); });
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
    input.addEventListener('input', function () {
      autosize();
      mascotBtnEl().classList.toggle('argo-assistant-listening', !busy && input.value.trim().length > 0);
    });
    input.addEventListener('blur', function () { mascotBtnEl().classList.remove('argo-assistant-listening'); });
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
    poke: poke,           // ArgoMascot.poke(svgElement[, 'hop'|'wink'|'love']) → reação manual
    setMood: swapMood,    // ArgoMascot.setMood(elementoQueContémOMascote, 'success', 48)
    icon: function (mood, size) { ensureStyles(); return boatSVG(mood, size); } // ArgoMascot.icon('success', 48) → string SVG avulso
  };
});

(() => {
  'use strict';
  const canvas = document.querySelector('.login-matrix');
  const screen = document.getElementById('loginScreen');
  if (!canvas || !screen) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  // Eficiência: o brilho (shadowBlur) é a parte mais cara do canvas 2D e era refeito a cada
  // ponto, a cada quadro. Agora cada brilho é desenhado UMA vez num sprite e depois só
  // copiado com drawImage (barato, acelerado por GPU). O movimento usa o relógio (não a
  // contagem de quadros), limitado a ~30 fps: igual em telas de 60 e 120 Hz e mais leve.
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const lowEnd = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 2;
  const FRAME_MS = 1000 / 30;
  let width = 0, height = 0, dpr = 1, raf = 0, last = 0, t = 0, resizeRaf = 0;
  let stars = [], falling = [];

  // Sprites de brilho: [cor do núcleo, cor do halo, raio do núcleo, desfoque]
  const makeSprite = (core, halo, r, blur) => {
    const pad = Math.ceil(blur) + 2, size = Math.ceil((r + pad) * 2);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.shadowColor = halo; g.shadowBlur = blur;
    g.fillStyle = core;
    g.beginPath(); g.arc(size / 2, size / 2, r, 0, Math.PI * 2); g.fill();
    return { c, half: size / 2, r };
  };
  const sprites = {
    starS: makeSprite('#d3f6ff', '#53d9ff', 1.25, 7),
    starL: makeSprite('#d3f6ff', '#53d9ff', 2, 13),
    ice: makeSprite('#e2f8ff', 'rgba(83,217,255,.9)', 1, 8),
    gold: makeSprite('#ffe08a', 'rgba(255,200,70,.9)', 1, 8)
  };

  const resize = () => {
    const rect = screen.getBoundingClientRect();
    const w = Math.round(rect.width), h = Math.round(rect.height);
    if (!w || !h) return;
    const nd = Math.min(window.devicePixelRatio || 1, 1.5);
    if (w === width && h === height && nd === dpr) return; // barra de endereço do celular não deve recriar tudo
    width = w; height = h; dpr = nd;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = [
      [0.13,.27],[.22,.19],[.31,.32],[.42,.22],[.53,.35],[.64,.25],[.73,.39],[.84,.29],[.91,.43],
      [.18,.52],[.30,.58],[.44,.49],[.57,.61],[.69,.53],[.81,.65],[.25,.78],[.39,.73],[.54,.82],[.72,.77],[.88,.85]
    ].map(([x,y],i) => ({x:x*width,y:y*height,phase:i*1.7,big:i%5===0}));
    const max = lowEnd ? 32 : 64;
    falling = Array.from({length: Math.max(18, Math.min(max, Math.round(width / 24)))}, () => makeFalling(true));
    draw(true);
  };
  const scheduleResize = () => { if (!resizeRaf) resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; resize(); }); };

  // Pequenos pontos de luz que caem devagar e piscam. A maioria é azul-gelo; alguns são dourados.
  const makeFalling = (initial = false) => ({
    x: Math.random() * width,
    y: initial ? Math.random() * height : -6 - Math.random() * 40,
    speed: 0.3 + Math.random() * 0.9,   // px por passo de 1/30 s
    drift: -0.1 + Math.random() * 0.2,
    size: 0.6 + Math.random() * 1.1,
    phase: Math.random() * Math.PI * 2,
    gold: Math.random() < 0.18
  });
  const blit = (sp, x, y, scale, alpha) => {
    const d = sp.half * 2 * scale;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sp.c, x - d / 2, y - d / 2, d, d);
  };
  const draw = (still = false) => {
    ctx.clearRect(0, 0, width, height);
    // Delicadas conexões entre estrelas: desenho estilizado da constelação Argo.
    ctx.lineWidth = 1;
    for (let i = 0; i < stars.length - 1; i++) {
      const a = stars[i], b = stars[i + 1];
      const alpha = still ? .13 : .07 + .12 * (0.5 + 0.5 * Math.sin(t * .018 - a.phase));
      ctx.strokeStyle = `rgba(115,220,255,${alpha})`;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    }
    for (const s of stars) {
      const glow = still ? .48 : .3 + .58 * (0.5 + 0.5 * Math.sin(t * .035 - s.phase));
      blit(s.big ? sprites.starL : sprites.starS, s.x, s.y, 1, glow);
    }
    if (!still) {
      for (const s of falling) {
        s.y += s.speed; s.x += s.drift;
        const twinkle = .45 + .55 * (0.5 + 0.5 * Math.sin(t * .08 + s.phase));
        blit(s.gold ? sprites.gold : sprites.ice, s.x, s.y, s.size, twinkle);
        if (s.y > height + 10 || s.x < -20 || s.x > width + 20) Object.assign(s, makeFalling());
      }
    }
    ctx.globalAlpha = 1;
  };
  const canRun = () => !prefersReduced.matches && !screen.hidden && !document.hidden;
  const tick = (now) => {
    raf = 0;
    if (!canRun()) return;
    raf = requestAnimationFrame(tick);
    if (now - last < FRAME_MS - 2) return; // pula quadros: ~30 fps
    // t conta em "passos de 1/60 s" (mesma cadência de antes), mesmo se o aparelho engasgar
    t += Math.min(4, Math.max(1, Math.round((now - last) / (1000 / 60))));
    last = now;
    draw();
  };
  const start = () => { if (canRun() && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); } };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
  const reducedChange = () => { stop(); draw(prefersReduced.matches); start(); };
  const sync = () => {
    if (canRun()) { resize(); start(); return; }
    stop();
    // Login escondido (já entrou no app): devolve a memória do canvas; resize() recria ao reaparecer.
    if (screen.hidden && width) { canvas.width = canvas.height = 0; width = height = 0; }
  };
  window.addEventListener('resize', scheduleResize, { passive: true });
  document.addEventListener('visibilitychange', sync);
  prefersReduced.addEventListener?.('change', reducedChange);
  new MutationObserver(sync).observe(screen, {attributes:true,attributeFilter:['hidden']});
  resize(); start();
})();

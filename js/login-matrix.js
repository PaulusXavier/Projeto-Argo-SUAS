(() => {
  'use strict';
  const canvas = document.querySelector('.login-matrix');
  const screen = document.getElementById('loginScreen');
  if (!canvas || !screen) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let width = 0, height = 0, dpr = 1, frame = 0, raf = 0;
  let stars = [], falling = [];
  const resize = () => {
    const rect = screen.getBoundingClientRect();
    width = rect.width; height = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = [
      [0.13,.27],[.22,.19],[.31,.32],[.42,.22],[.53,.35],[.64,.25],[.73,.39],[.84,.29],[.91,.43],
      [.18,.52],[.30,.58],[.44,.49],[.57,.61],[.69,.53],[.81,.65],[.25,.78],[.39,.73],[.54,.82],[.72,.77],[.88,.85]
    ].map(([x,y],i) => ({x:x*width,y:y*height,phase:i*1.7,size:i%5===0?2:1.25}));
    falling = Array.from({length: Math.max(24, Math.min(64, Math.round(width / 24)))}, () => makeFalling(true));
    draw(true);
  };
  // Pequenos pontos de luz que caem devagar e piscam. A maioria é azul-gelo; alguns são dourados.
  const makeFalling = (initial = false) => ({
    x: Math.random() * width,
    y: initial ? Math.random() * height : -6 - Math.random() * 40,
    speed: 0.3 + Math.random() * 0.9,
    drift: -0.1 + Math.random() * 0.2,
    size: 0.6 + Math.random() * 1.1,
    phase: Math.random() * Math.PI * 2,
    gold: Math.random() < 0.18
  });
  const draw = (still = false) => {
    ctx.clearRect(0, 0, width, height);
    // Delicadas conexões entre estrelas: desenho estilizado da constelação Argo.
    ctx.lineWidth = 1;
    for (let i = 0; i < stars.length - 1; i++) {
      const a = stars[i], b = stars[i + 1];
      const alpha = still ? .13 : .07 + .12 * (0.5 + 0.5 * Math.sin(frame * .018 - a.phase));
      ctx.strokeStyle = `rgba(115,220,255,${alpha})`;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    }
    stars.forEach((s,i) => {
      const glow = still ? .48 : .3 + .58 * (0.5 + 0.5 * Math.sin(frame * .035 - s.phase));
      ctx.beginPath(); ctx.arc(s.x,s.y,s.size,0,Math.PI*2);
      ctx.fillStyle = `rgba(211,246,255,${glow})`;
      ctx.shadowColor = '#53d9ff'; ctx.shadowBlur = i%5===0?13:7; ctx.fill();
    });
    ctx.shadowBlur = 0;
    if (!still) falling.forEach((s) => {
      s.y += s.speed; s.x += s.drift;
      const twinkle = .45 + .55 * (0.5 + 0.5 * Math.sin(frame * .08 + s.phase));
      const core = s.gold ? '255,224,138' : '226,248,255';
      const halo = s.gold ? '255,200,70' : '83,217,255';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${core},${twinkle})`;
      ctx.shadowColor = `rgba(${halo},.9)`; ctx.shadowBlur = 6 + s.size * 2;
      ctx.fill();
      if (s.y > height + 10 || s.x < -20 || s.x > width + 20) Object.assign(s, makeFalling());
    });
    ctx.shadowBlur = 0;
  };
  const tick = () => {
    raf = 0;
    if (prefersReduced.matches || screen.hidden || document.hidden) return;
    frame++;
    if (frame % 2 === 0) draw();
    raf = requestAnimationFrame(tick);
  };
  const start = () => { if (!prefersReduced.matches && !screen.hidden && !document.hidden && !raf) raf = requestAnimationFrame(tick); };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
  const reducedChange = () => { stop(); draw(prefersReduced.matches); start(); };
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', start);
  prefersReduced.addEventListener?.('change', reducedChange);
  new MutationObserver(() => { if (screen.hidden) stop(); else start(); }).observe(screen, {attributes:true,attributeFilter:['hidden']});
  resize(); start();
})();

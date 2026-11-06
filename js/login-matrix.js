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
    falling = Array.from({length: Math.max(18, Math.min(48, Math.round(width / 28)))}, () => makeFalling(true));
    draw(true);
  };
  const makeFalling = (initial = false) => ({
    x: Math.random() * width,
    y: initial ? Math.random() * height : -8 - Math.random() * 50,
    speed: 0.35 + Math.random() * 1.05,
    drift: -0.12 + Math.random() * 0.24,
    size: 0.7 + Math.random() * 1.5,
    phase: Math.random() * Math.PI * 2,
    trail: 8 + Math.random() * 22
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
      const twinkle = .42 + .58 * (0.5 + 0.5 * Math.sin(frame * .08 + s.phase));
      const tailX = s.x - s.drift * s.trail * 2;
      const tailY = s.y - s.trail;
      const grad = ctx.createLinearGradient(s.x,s.y,tailX,tailY);
      grad.addColorStop(0, `rgba(240,252,255,${twinkle})`);
      grad.addColorStop(.22, `rgba(105,218,255,${twinkle*.58})`);
      grad.addColorStop(1, 'rgba(45,150,255,0)');
      ctx.strokeStyle = grad; ctx.lineWidth = s.size; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(s.x,s.y); ctx.lineTo(tailX,tailY); ctx.stroke();
      ctx.beginPath(); ctx.arc(s.x,s.y,s.size*.85,0,Math.PI*2);
      ctx.fillStyle = `rgba(238,251,255,${twinkle})`; ctx.shadowColor = '#65dfff'; ctx.shadowBlur = 11; ctx.fill();
      if (s.y > height + s.trail || s.x < -20 || s.x > width + 20) Object.assign(s, makeFalling());
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

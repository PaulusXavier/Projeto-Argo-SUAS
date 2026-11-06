(() => {
  'use strict';
  const canvas = document.querySelector('.login-matrix');
  const screen = document.getElementById('loginScreen');
  if (!canvas || !screen) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const glyphs = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ012345789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let width = 0, height = 0, dpr = 1, drops = [], frame = 0, raf = 0;
  let stars = [];
  const resize = () => {
    const rect = screen.getBoundingClientRect();
    width = rect.width; height = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const columns = Math.ceil(width / 23);
    drops = Array.from({ length: columns }, (_, i) => ({ x: i * 23 + 4, y: Math.random() * -height / 15, speed: 0.45 + Math.random() * 1.15, length: 5 + Math.random() * 12, phase: Math.random() * 100 }));
    stars = [
      [0.13,.27],[.22,.19],[.31,.32],[.42,.22],[.53,.35],[.64,.25],[.73,.39],[.84,.29],[.91,.43],
      [.18,.52],[.30,.58],[.44,.49],[.57,.61],[.69,.53],[.81,.65],[.25,.78],[.39,.73],[.54,.82],[.72,.77],[.88,.85]
    ].map(([x,y],i) => ({x:x*width,y:y*height,phase:i*1.7}));
    draw(true);
  };
  const draw = (still = false) => {
    ctx.clearRect(0, 0, width, height);
    // A rede estelar permanece sutil; os pontos acendem em sequência como Argo.
    ctx.lineWidth = 1;
    for (let i = 0; i < stars.length - 1; i++) {
      const a = stars[i], b = stars[i + 1];
      const alpha = still ? .12 : .08 + .12 * (0.5 + 0.5 * Math.sin(frame * .018 - a.phase));
      ctx.strokeStyle = `rgba(81,255,174,${alpha})`;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    }
    stars.forEach((s,i) => {
      const glow = still ? .45 : .28 + .55 * (0.5 + 0.5 * Math.sin(frame * .035 - s.phase));
      ctx.beginPath(); ctx.arc(s.x,s.y,i%5===0?2.2:1.35,0,Math.PI*2);
      ctx.fillStyle = `rgba(135,255,194,${glow})`; ctx.shadowColor = '#37ff91'; ctx.shadowBlur = i%5===0?12:6; ctx.fill();
    });
    ctx.shadowBlur = 0;
    if (!still) {
      ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      drops.forEach((d,i) => {
        if (i % 2 === 0 || d.phase < 60) {
          for (let n = 0; n < d.length; n++) {
            const y = (d.y - n * 17) % (height + d.length * 17);
            const yy = y < 0 ? y + height + d.length * 17 : y;
            const alpha = n === 0 ? .95 : Math.max(.035, .42 * (1 - n / d.length));
            ctx.fillStyle = n === 0 ? `rgba(220,255,231,${alpha})` : `rgba(53,255,125,${alpha})`;
            ctx.shadowColor = '#28ff78'; ctx.shadowBlur = n === 0 ? 10 : 3;
            ctx.fillText(glyphs[(Math.floor(frame/4) + i*13 + n*7) % glyphs.length], d.x, yy);
          }
        }
        d.y += d.speed;
        if (d.y - d.length * 17 > height) { d.y = -Math.random() * height * .45; d.speed = .45 + Math.random()*1.15; }
      });
      ctx.shadowBlur = 0;
    }
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

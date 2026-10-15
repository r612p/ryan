/* Scroll-in tunnel: black cards fly at you down a white corridor of grid paper while snow drifts past.
   anime.js onScroll() syncs the camera depth to the section's scroll; a canvas under the CSS 3D cards
   draws the floor and ceiling grid, the snow and the cards' shadows with the same 900px perspective.
   Works for every .tunnel on the page; data-rest="last" parks the last card in front of you at the end. */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  const P        = 900;   // CSS perspective of .tunnel-stage, so canvas and cards line up
  const SPACING  = 1100;  // depth gap between cards
  const START    = 900;   // first card's starting distance
  const FAR      = 4200;  // invisible beyond this depth
  const FADE_IN  = 1600;  // depth over which a card fades in
  const PASS_OUT = 600;   // depth past the camera over which it fades out
  const REST     = 260;   // how far in front of you the last card parks (data-rest="last")
  const GRID     = 240;   // corridor grid pitch (px at the card plane)
  const DEPTH    = 7000;  // snow volume depth

  document.querySelectorAll('.tunnel').forEach(initTunnel);

  function initTunnel(tunnel) {
    const stage  = tunnel.querySelector('.tunnel-stage');
    const fx     = tunnel.querySelector('.tunnel-fx'), g = fx.getContext('2d');
    const bar    = tunnel.querySelector('.tunnel-bar i');
    const hint   = tunnel.querySelector('.th-hint'), nowEl = tunnel.querySelector('.th-now');
    const cards  = [...tunnel.querySelectorAll('.tcard')];
    const n = cards.length;
    const rest = tunnel.dataset.rest === 'last';
    const totalEl = tunnel.querySelector('.th-total');
    if (totalEl) totalEl.textContent = String(n).padStart(2, '0');

    const layout = cards.map((card, i) => {
      const hero = card.classList.contains('hero');
      card.insertAdjacentHTML('beforeend', `<span class="of">${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}</span>`);
      return {
        card, shown: false, o: 0, z: 0, cx: 0, w: 0,
        depth: START + i * SPACING,
        xf: hero ? 0 : (i % 2 === 0 ? -1 : 1) * 0.22,
        yf: hero ? 0 : ((i * 37) % 3 - 1) * 0.08,
        parts: [...card.children].filter((el) => !el.classList.contains('wm')),   // the watermark keeps its own faint opacity
      };
    });
    const END = rest ? START + (n - 1) * SPACING - REST : START + (n - 1) * SPACING + PASS_OUT;
    const cam = { z: 0 };

    /* ---------------- cards ---------------- */
    function placeCards() {
      const w = stage.clientWidth, h = stage.clientHeight;
      let now = 0, best = Infinity;
      layout.forEach((l, i) => {
        const z = cam.z - l.depth;            // < 0 ahead of us, > 0 already passed
        let o;
        if (z < -FAR) o = 0;
        else if (z < -FAR + FADE_IN) o = (z + FAR) / FADE_IN;
        else if (z <= 0) o = 1;
        else o = Math.max(0, 1 - z / PASS_OUT);
        l.o = o; l.z = z;
        if (Math.abs(z + 500) < best && o > .2) { best = Math.abs(z + 500); now = i; }

        const el = l.card;
        if (o <= 0) { el.style.visibility = 'hidden'; return; }
        el.style.visibility = 'visible';
        el.style.opacity = o.toFixed(3);
        const cw = el.offsetWidth; l.w = cw;   // keep side cards inside a 16px margin on narrow screens
        const x = Math.max(-w / 2 + 16, Math.min(w / 2 - 16 - cw, l.xf * w - cw / 2));
        const y = l.yf * h - el.offsetHeight / 2;
        l.cx = x + cw / 2;
        el.style.transform = `translate3d(${x}px, ${y}px, ${z}px)`;
        // depth of field: far cards soften, a card rushing past blurs
        const blur = reduce ? 0 : z < -900 ? Math.min(3.2, (-z - 900) / 800) : z > 0 ? Math.min(5, z / 110) : 0;
        el.style.filter = blur > .05 ? `blur(${blur.toFixed(2)}px)` : 'none';
        // only cards that are close and sharp take clicks
        el.style.pointerEvents = z > -1600 && z < 120 ? 'auto' : 'none';

        // the card's text staggers in the first time it gets close
        if (!l.shown && z > -2600 && window.anime && !reduce) {
          l.shown = true;
          anime.animate(l.parts, { opacity: [0, 1], translateY: [18, 0], delay: anime.stagger(90), duration: 800, ease: 'out(3)' });
        }
      });
      bar.style.transform = `scaleX(${Math.min(1, cam.z / (rest ? END : END - PASS_OUT))})`;
      nowEl.textContent = String(now + 1).padStart(2, '0');
      hint.style.opacity = Math.max(0, 1 - cam.z / 500).toFixed(3);
    }

    /* ---------------- corridor, snow and shadows (canvas) ---------------- */
    let W = 0, H = 0, flakes = [];
    function size() {
      W = stage.clientWidth; H = stage.clientHeight;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      fx.width = Math.round(W * dpr); fx.height = Math.round(H * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(220, W * H / 6500));
      flakes = Array.from({ length: count }, () => ({
        x: (Math.random() * 2 - 1) * W * 1.3, y: (Math.random() * 2 - 1) * H * .9,
        z: Math.random() * DEPTH, r: .7 + Math.random() * 1.7, ph: Math.random() * 6.283,
      }));
    }
    const proj = (x, y, z) => { const s = P / (P - z); return [W / 2 + x * s, H / 2 + y * s, s]; };

    function drawCorridor() {
      const fy = H * .62, NX = Math.ceil(W / GRID) + 2;
      g.lineWidth = 1;
      for (const [y, k] of [[fy, 1], [-fy, .5]]) {            // floor, then a fainter ceiling
        // rails running away from you, fading into the distance
        for (let i = -NX; i <= NX; i++) {
          const [x1, y1] = proj(i * GRID, y, 400), [x2, y2] = proj(i * GRID, y, -8000);
          const gr = g.createLinearGradient(x1, y1, x2, y2);
          gr.addColorStop(0, `rgba(60,76,98,${.15 * k})`); gr.addColorStop(1, 'rgba(60,76,98,0)');
          g.strokeStyle = gr; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        }
        // cross lines that slide toward you as you scroll
        const off = ((cam.z % GRID) + GRID) % GRID;
        for (let j = -1; j < 34; j++) {
          const z = off - j * GRID;
          if (z > 600) continue;
          const fog = clamp01(1 - -z / 7800), near = clamp01((700 - z) / 300);
          const a = .15 * k * fog * fog * near;
          if (a < .004) continue;
          const [xa, ya] = proj(-NX * GRID, y, z), [xb] = proj(NX * GRID, y, z);
          g.strokeStyle = `rgba(60,76,98,${a.toFixed(3)})`;
          g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb, ya); g.stroke();
        }
      }
      // soft shadow on the floor under each card
      for (const l of layout) {
        if (l.o < .02) continue;
        const [sx, sy, s] = proj(l.cx, fy, Math.min(l.z, 500));
        const rx = l.w * .55 * s, ry = Math.max(2, rx * .12);
        g.save(); g.translate(sx, sy); g.scale(1, ry / rx);
        const sh = g.createRadialGradient(0, 0, 0, 0, 0, rx);
        sh.addColorStop(0, `rgba(12,14,17,${(.18 * l.o).toFixed(3)})`); sh.addColorStop(1, 'rgba(12,14,17,0)');
        g.fillStyle = sh; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    }

    function drawSnow(t, dt) {
      for (const f of flakes) {
        if (!reduce) {
          f.y += dt * (16 + f.r * 12);
          f.x += Math.sin(t * .0007 + f.ph) * dt * 10;
          if (f.y > H * .9) f.y -= H * 1.8;
        }
        const z = ((f.z + cam.z) % DEPTH) - (DEPTH - 700);     // -6300 (far) … 700 (just past you)
        const [sx, sy, s] = proj(f.x, f.y, z);
        const fog = clamp01(1 - -z / 6300), near = clamp01((820 - z) / 260);
        const a = (.2 + .55 * fog) * fog * near;
        if (a < .01) continue;
        g.fillStyle = `rgba(150,168,192,${a.toFixed(3)})`;
        g.beginPath(); g.arc(sx, sy, Math.max(.4, f.r * s * .9), 0, Math.PI * 2); g.fill();
      }
    }

    /* ---------------- loop (only while this tunnel is on screen) ---------------- */
    let raf = 0, last = performance.now();
    function frame(t) {
      const dt = Math.min(.05, (t - last) / 1000); last = t;
      placeCards();
      g.clearRect(0, 0, W, H);
      drawCorridor();
      drawSnow(t, dt);
      raf = requestAnimationFrame(frame);
    }
    new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf);
      if (e.isIntersecting) { last = performance.now(); raf = requestAnimationFrame(frame); }
    }).observe(tunnel);

    // a .tunnel-track (if there is one) sets how much scroll the cards get; anything after it is someone else's
    const track = tunnel.querySelector('.tunnel-track') || tunnel;
    if (window.anime) {
      anime.animate(cam, {
        z: [0, END], duration: 1000, ease: 'linear',
        autoplay: anime.onScroll({ target: track, enter: 'top top', leave: 'bottom bottom', sync: reduce ? true : .18 }),
      });
    } else {
      addEventListener('scroll', () => {
        const r = track.getBoundingClientRect();
        cam.z = clamp01(-r.top / (r.height - innerHeight)) * END;
      }, { passive: true });
    }

    addEventListener('resize', size);
    size();
    placeCards();
  }
})();

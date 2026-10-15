(() => {
  const TAU = Math.PI * 2, UP = -Math.PI / 2;
  const stage    = document.querySelector('.stage');
  const sceneBox = document.querySelector('.scene');
  const sceneCvs = document.getElementById('scene'), sctx = sceneCvs.getContext('2d');
  const snowCvs  = document.getElementById('snow'),  fctx = snowCvs.getContext('2d');
  const hero     = document.querySelector('.hero');
  const reduce   = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FOG      = '238,242,246';

  /* ============ helpers ============ */
  function rng(seed) {
    let s = seed % 2147483647; if (s <= 0) s += 2147483646;
    return () => (s = s * 16807 % 2147483647) / 2147483647;
  }
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  const nextSeed = r => 1 + Math.floor(r() * 1e9);

  // Terrain functions are periodic over the tile width T, so tiles repeat seamlessly.
  function hills(T, base, amp, seed, harm) {
    const r = rng(seed), k = T / 1400;
    const hs = harm.map(([n, a]) => [Math.max(1, Math.round(n * k)), a, r() * TAU]);
    const norm = hs.reduce((s, h) => s + h[1], 0);
    return x => base + amp * hs.reduce((s, [n, a, p]) => s + a * Math.sin(TAU * n * x / T + p), 0) / norm;
  }
  function ridges(T, base, amp, seed, harm) {
    const r = rng(seed), k = T / 1400;
    const hs = harm.map(([n, a]) => [Math.max(1, Math.round(n * k)), a, r() * Math.PI]);
    const norm = hs.reduce((s, h) => s + h[1], 0);
    return x => base - amp * hs.reduce((s, [n, a, p]) =>
      s + a * (1 - Math.abs(Math.sin(Math.PI * n * x / T + p))) ** 2, 0) / norm;
  }
  function groundPath(f, T, bottom) {
    const p = new Path2D(); p.moveTo(-4, bottom);
    for (let x = -4; x <= T + 4; x += 3) p.lineTo(x, f(x));
    p.lineTo(T + 4, bottom); p.closePath(); return p;
  }
  function crestPath(f, T) {
    const p = new Path2D(); p.moveTo(-4, f(-4));
    for (let x = -1; x <= T + 4; x += 3) p.lineTo(x, f(x));
    return p;
  }
  // soft shading just under a snow crest (inner shadow)
  function crestShade(g, f, T, bottom, color, blur, depth, dpr) {
    g.save();
    g.clip(groundPath(f, T, bottom));
    g.shadowColor = color; g.shadowBlur = blur * dpr; g.shadowOffsetY = depth * 2 * dpr;
    g.strokeStyle = '#000'; g.lineWidth = depth * 2;
    g.translate(0, -depth);
    g.stroke(crestPath(f, T));
    g.restore();
  }
  function crestLine(g, f, T, color, w) {
    g.strokeStyle = color; g.lineWidth = w; g.lineJoin = 'round'; g.stroke(crestPath(f, T));
  }

  /* ============ trees ============ */
  // trunk/limb proportions per species
  const KINDS = {
    oak:    { trunk:.30, w:.055, lean:.10, wob:.22, trop:.028, lat:.16, latA:.90, latL:.55, latW:.50, fork:.65, tri:.30, decay:.74, clear:.65, taper:.78, maxD:10 },
    elm:    { trunk:.36, w:.045, lean:.08, wob:.16, trop:.050, lat:.12, latA:.55, latL:.50, latW:.50, fork:.50, tri:.25, decay:.77, clear:.70, taper:.80, maxD:10 },
    maple:  { trunk:.42, w:.040, lean:.06, wob:.18, trop:.070, lat:.22, latA:.55, latL:.50, latW:.50, fork:.42, tri:.20, decay:.73, clear:.45, taper:.80, maxD:10 },
  };

  // Grows a tree into a flat segment list [x1,y1,x2,y2,width,depth,...] rooted at (0,0)
  function makeTree(seed, kind, height, minW) {
    const K = KINDS[kind], r = rng(seed), S = [];
    const segLen = Math.max(3, height * .03);
    const BUDGET = 6 * 40000;

    function grow(x, y, ang, len, w, depth) {
      if (S.length > BUDGET) return;
      const n = Math.min(8, Math.max(1, Math.round(len / segLen)));
      const step = len / n, wEnd = w * K.taper;
      let side = r() < .5 ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const t1 = (i + 1) / n;
        const wa = w + (wEnd - w) * (i + .5) / n;
        ang += (r() - .5) * K.wob;
        ang += (UP - ang) * K.trop;                       // reach for the light
        const nx = x + Math.cos(ang) * step, ny = y + Math.sin(ang) * step;
        S.push(x, y, nx, ny, wa, depth);
        x = nx; y = ny;
        // side shoots along the limb (not just at the tip) — this is what reads as "real tree"
        if (t1 < 1 && t1 > (depth === 0 ? K.clear : .12) && wa > minW * 2.4 && r() < K.lat) {
          const a = ang + side * (K.latA + (r() - .5) * .5);
          side = -side;
          grow(x, y, a, len * (1 - t1 * .5) * (K.latL + r() * .2), wa * K.latW, depth + 1);
        }
      }
      if (wEnd < minW || depth >= K.maxD) return;
      const k = r() < K.tri ? 3 : 2;
      const lead = Math.floor(r() * k);                   // one fork keeps the main direction
      for (let j = 0; j < k; j++) {
        const dom = j === lead;
        const off = (j - (k - 1) / 2) * K.fork * (.7 + r() * .6);
        grow(x, y,
             ang + off * (dom ? .45 : 1) + (r() - .5) * .15,
             len * K.decay * (.8 + r() * .3) * (dom ? 1.06 : .9),
             wEnd * (k === 3 ? .62 : .74) * (dom ? 1.12 : .9),
             depth + 1);
      }
    }

    const stems = K.stems ? K.stems[0] + Math.floor(r() * (K.stems[1] - K.stems[0] + 1)) : 1;
    for (let s = 0; s < stems; s++) {
      const a = UP + (stems > 1 ? ((s / (stems - 1)) - .5) * K.spread : 0) + (r() - .5) * K.lean;
      grow(0, 4, a, height * K.trunk * (stems > 1 ? .8 + r() * .4 : 1), height * K.w * (stems > 1 ? .6 : 1), 0);
    }

    // normalise to the exact requested height
    let minY = 0, minX = 0, maxX = 0;
    for (let i = 0; i < S.length; i += 6) {
      minY = Math.min(minY, S[i + 1], S[i + 3]);
      minX = Math.min(minX, S[i], S[i + 2]); maxX = Math.max(maxX, S[i], S[i + 2]);
    }
    const sc = height / -minY;
    for (let i = 0; i < S.length; i += 6) { S[i] *= sc; S[i+1] *= sc; S[i+2] *= sc; S[i+3] *= sc; S[i+4] *= sc; }
    return { S, left: minX * sc, right: maxX * sc, trunkW: height * K.w * sc * (stems > 1 ? .6 : 1) };
  }

  // Strokes a tree; widths are bucketed into a few Path2Ds so thousands of twigs draw fast
  function paintTree(g, tree, ox, oy, color, snowy) {
    const body = new Map(), snow = new Map();
    const add = (m, k, x1, y1, x2, y2) => { let p = m.get(k); if (!p) m.set(k, p = new Path2D()); p.moveTo(x1, y1); p.lineTo(x2, y2); };
    const S = tree.S;
    for (let i = 0; i < S.length; i += 6) {
      const x1 = S[i] + ox, y1 = S[i+1] + oy, x2 = S[i+2] + ox, y2 = S[i+3] + oy, w = S[i+4];
      add(body, w < 3 ? Math.round(w * 8) / 8 : Math.round(w * 2) / 2, x1, y1, x2, y2);
      if (!snowy || w < 1.3) continue;
      const dx = x2 - x1, dy = y2 - y1, steep = Math.abs(dy) / (Math.hypot(dx, dy) || 1);
      if (steep < .82) {                                   // snow resting on top of limbs
        const o = w * .34;
        add(snow, Math.round(w * .45 * 4) / 4, x1, y1 - o, x2, y2 - o);
      }
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = color;
    for (const [w, p] of body) { g.lineWidth = Math.max(w, .35); g.stroke(p); }
    if (!snowy) return;
    g.strokeStyle = '#ffffff';
    for (const [w, p] of snow) { g.lineWidth = w; g.stroke(p); }
  }

  // draw a tree at x, plus wrapped copies so it tiles seamlessly across the seam
  function plantTree(g, tree, x, y, T, color, snowy) {
    for (const off of [-T, 0, T]) {
      const px = x + off;
      if (px + tree.right < -2 || px + tree.left > T + 2) continue;
      paintTree(g, tree, px, y, color, snowy);
    }
  }

  // sparse, clumped placement: a few groves with gaps between, wrap-aware spacing
  function scatter(r, T, groves, size, spread, gap) {
    const xs = [];
    const dist = (a, b) => { const d = Math.abs(a - b) % T; return Math.min(d, T - d); };
    for (let g = 0; g < groves; g++) {
      const cx = r() * T, m = size[0] + Math.floor(r() * (size[1] - size[0] + 1));
      for (let j = 0; j < m; j++) for (let t = 0; t < 14; t++) {
        const x = ((cx + (r() - .5) * 2 * spread) % T + T) % T;
        if (xs.every(o => dist(o, x) >= gap)) { xs.push(x); break; }
      }
    }
    return xs;
  }

  function mound(g, x, y, w, h, fill) {
    g.beginPath();
    g.moveTo(x - w, y + 3);
    g.bezierCurveTo(x - w * .45, y + 2, x - w * .4, y - h, x, y - h);
    g.bezierCurveTo(x + w * .4, y - h, x + w * .45, y + 2, x + w, y + 3);
    g.closePath(); g.fillStyle = fill; g.fill();
  }

  function tuft(g, r, x, y, s, color) {
    const n = 4 + Math.floor(r() * 8);
    g.strokeStyle = color; g.fillStyle = color; g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a = UP + (r() - .5) * .9, len = s * (.4 + r() * .8), bend = (r() - .5) * .7;
      const bx = x + (r() - .5) * s * .5;
      const ex = bx + Math.cos(a) * len, ey = y + Math.sin(a) * len;
      g.lineWidth = .6 + r() * .5;
      g.beginPath(); g.moveTo(bx, y + 2);
      g.quadraticCurveTo(bx + Math.cos(a + bend) * len * .5, y + Math.sin(a + bend) * len * .5, ex, ey);
      g.stroke();
      if (r() < .22) { g.beginPath(); g.ellipse(ex, ey, .9, 2.2, a + Math.PI / 2, 0, TAU); g.fill(); }
    }
  }

  /* ============ layers ============ */
  function tile(T, H, top, dpr, draw) {
    top = Math.max(0, Math.floor(top));
    const c = document.createElement('canvas');
    c.width = Math.ceil(T * dpr); c.height = Math.ceil((H - top) * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, -top * dpr);
    draw(g);
    return { c, top };
  }

  function mistGradient(y0, y1, alpha, dpr) {
    const gr = sctx.createLinearGradient(0, y0 * dpr, 0, y1 * dpr);
    gr.addColorStop(0, `rgba(${FOG},0)`); gr.addColorStop(1, `rgba(${FOG},${alpha})`);
    return { fill: gr, y0 };
  }

  function buildLayers(W, H, dpr) {
    const T = Math.round(Math.max(W, 1100));
    const U = Math.min(H, W * .9);                      // tree scale unit (keeps phones sane)
    const layers = [];

    /* --- 0 · distant mountains --- */
    {
      const back  = ridges(T, H * .50,  H * .10, 101, [[2, 1], [3, .7], [7, .35], [15, .15]]);
      const front = ridges(T, H * .585, H * .13, 202, [[2, 1], [4, .7], [7, .4], [13, .2], [27, .08]]);
      let top = H; for (let x = 0; x < T; x += 2) top = Math.min(top, back(x), front(x));
      layers.push({ speed: 2, par: .45, mist: mistGradient(H * .44, H * .62, .75, dpr), ...tile(T, H, top - 4, dpr, g => {
        g.fillStyle = '#e4eaf0'; g.fill(groundPath(back, T, H));
        const fp = groundPath(front, T, H);
        const gr = g.createLinearGradient(0, H * .42, 0, H * .62);
        gr.addColorStop(0, '#ced8e3'); gr.addColorStop(1, '#e6ebf1');
        g.fillStyle = gr; g.fill(fp);
      })});
    }

    /* --- 1 · far hills with a thin tree line --- */
    {
      const f = hills(T, H * .645, H * .03, 303, [[2, 1], [3, .6], [6, .3], [13, .12]]);
      const r = rng(304);
      const trees = scatter(r, T, Math.round(T / 170), [2, 7], 55, 7)
        .map(x => ({ x, t: makeTree(nextSeed(r), pick(r, ['elm', 'oak', 'maple', 'elm']), U * (.035 + r() * .045), .3) }));
      let top = H; for (const o of trees) top = Math.min(top, f(o.x) - U * .09);
      for (let x = 0; x < T; x += 4) top = Math.min(top, f(x));
      layers.push({ speed: 5, par: .3, mist: mistGradient(H * .6, H * .72, .55, dpr), ...tile(T, H, top - 4, dpr, g => {
        for (const o of trees) plantTree(g, o.t, o.x, f(o.x) + 2, T, '#a9b4c2', false);
        const gr = g.createLinearGradient(0, H * .6, 0, H * .72);
        gr.addColorStop(0, '#e9eef3'); gr.addColorStop(1, '#f0f3f7');
        g.fillStyle = gr; g.fill(groundPath(f, T, H));
        crestLine(g, f, T, 'rgba(160,175,195,.35)', 1);
      })});
    }

    /* --- 2 · mid hills, small groves --- */
    {
      const f = hills(T, H * .75, H * .028, 404, [[1, 1], [2, .7], [5, .3], [11, .1]]);
      const r = rng(405);
      const trees = scatter(r, T, Math.round(T / 380), [1, 4], 80, 24)
        .map(x => ({ x, t: makeTree(nextSeed(r), pick(r, ['oak', 'elm', 'maple']), U * (.09 + r() * .08), .35) }));
      let top = H; for (const o of trees) top = Math.min(top, f(o.x) - U * .18);
      layers.push({ speed: 10, par: .15, mist: mistGradient(H * .72, H * .82, .35, dpr), ...tile(T, H, top - 4, dpr, g => {
        for (const o of trees) plantTree(g, o.t, o.x, f(o.x) + 3, T, '#7e8a99', true);
        const gr = g.createLinearGradient(0, H * .72, 0, H * .82);
        gr.addColorStop(0, '#f2f5f8'); gr.addColorStop(1, '#f8fafb');
        const p = groundPath(f, T, H);
        g.fillStyle = gr; g.fill(p);
        crestShade(g, f, T, H, 'rgba(130,152,180,.22)', 10, 5, dpr);
        crestLine(g, f, T, 'rgba(150,168,190,.4)', 1);
      })});
    }

    /* --- 3 · foreground: big trees, saplings, two snowdrifts, dry grass --- */
    {
      const A = hills(T, H * .865, H * .022, 505, [[1, 1], [2, .5], [4, .35], [9, .12]]);
      const B = hills(T, H * .94,  H * .02,  606, [[1, 1], [3, .5], [6, .25]]);
      const r = rng(507);
      const trees = scatter(r, T, Math.max(2, Math.round(T / 640)), [1, 2], 120, U * .26)
        .map(x => ({ x, t: makeTree(nextSeed(r), pick(r, ['oak', 'oak', 'elm', 'maple']), U * (.36 + r() * .2), .45) }));
      const saplings = scatter(r, T, Math.round(T / 520), [1, 2], 60, 70)
        .map(x => ({ x, t: makeTree(nextSeed(r), pick(r, ['maple', 'elm']), U * (.1 + r() * .08), .3) }));
      let top = H; for (const o of trees) top = Math.min(top, A(o.x) - U * .58);

      layers.push({ speed: 18, par: 0, ...tile(T, H, top - 6, dpr, g => {
        for (const o of trees) plantTree(g, o.t, o.x, A(o.x) + 6, T, '#22272e', true);

        const fillA = g.createLinearGradient(0, H * .84, 0, H * .93);
        fillA.addColorStop(0, '#f7f9fb'); fillA.addColorStop(1, '#ffffff');
        g.fillStyle = fillA; g.fill(groundPath(A, T, H));
        crestShade(g, A, T, H, 'rgba(120,145,178,.26)', 16, 7, dpr);
        crestLine(g, A, T, 'rgba(140,160,185,.3)', 1);
        for (const o of trees) for (const off of [-T, 0, T])
          mound(g, o.x + off, A(o.x), o.t.trunkW * 2.6, o.t.trunkW * .6, fillA);

        for (const o of saplings) plantTree(g, o.t, o.x, A(o.x) + 3, T, '#3a4048', true);
        const tr = rng(508);
        for (let i = 0, n = Math.round(T / 110); i < n; i++) {
          const x = 20 + tr() * (T - 40);
          tuft(g, tr, x, A(x), U * (.018 + tr() * .02), 'rgba(58,64,74,.8)');
        }

        // front drift — pure white, identical to the page so the header has no bottom edge
        g.fillStyle = '#ffffff'; g.fill(groundPath(B, T, H + 2));
        crestShade(g, B, T, H + 2, 'rgba(120,145,178,.18)', 18, 7, dpr);
        crestLine(g, B, T, 'rgba(150,170,195,.2)', 1);
        for (let i = 0, n = Math.round(T / 160); i < n; i++) {
          const x = 20 + tr() * (T - 40);
          tuft(g, tr, x, B(x), U * (.02 + tr() * .025), 'rgba(52,58,68,.85)');
        }
      })});
    }

    return { T, layers };
  }

  /* ============ snow ============ */
  const flakeSprite = (() => {
    const s = document.createElement('canvas'); s.width = s.height = 32;
    const g = s.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(178,192,212,1)');       // solid soft dot: reads on the light sky
    gr.addColorStop(.45, 'rgba(178,192,212,.8)');     // and still lighter than the dark trees
    gr.addColorStop(1, 'rgba(178,192,212,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return s;
  })();
  let flakes = [];
  const newFlake = (W, H, anyY) => ({ x: Math.random() * W, y: anyY ? Math.random() * H : -12, z: Math.random() ** 1.7, ph: Math.random() * TAU });

  /* ============ grain ============ */
  (() => {
    const c = document.createElement('canvas'); c.width = c.height = 140;
    const g = c.getContext('2d'), d = g.createImageData(140, 140);
    for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255 | 0; d.data[i] = d.data[i+1] = d.data[i+2] = v; d.data[i+3] = 255; }
    g.putImageData(d, 0, 0);
    document.querySelector('.grain').style.backgroundImage = `url(${c.toDataURL()})`;
  })();

  /* ============ render loop ============ */
  let W = 0, H = 0, dpr = 1, world = null, clock = 0, last = performance.now(), running = true, raf = 0;

  function rebuild() {
    W = stage.clientWidth; H = stage.clientHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    for (const c of [sceneCvs, snowCvs]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    world = buildLayers(W, H, dpr);
    flakes = Array.from({ length: Math.min(420, Math.round(W * H / 5200)) }, () => newFlake(W, H, true));
    sceneBox.classList.add('ready');
    draw(0);
  }

  function draw(dt) {
    const sy = Math.min(Math.max(scrollY, 0), H);

    // landscape layers, far → near, each panning at its own speed
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, sceneCvs.width, sceneCvs.height);
    for (const l of world.layers) {
      const yo = sy * l.par;                                   // scroll parallax
      const off = (clock * l.speed) % world.T;
      for (let x = -off; x < W; x += world.T)
        sctx.drawImage(l.c, x * dpr, (l.top + yo) * dpr);
      if (l.mist) {
        sctx.fillStyle = l.mist.fill;
        sctx.fillRect(0, (l.mist.y0 + yo) * dpr, sceneCvs.width, sceneCvs.height);
      }
    }

    // falling snow
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.clearRect(0, 0, W, H);
    const wind = 8 + 14 * Math.sin(clock * .11) + 6 * Math.sin(clock * .37);
    for (const f of flakes) {
      f.y += (12 + f.z * 46) * dt;
      f.x += (wind * (.3 + f.z) + Math.sin(clock * (.6 + f.z * .8) + f.ph) * 10 * (.4 + f.z)) * dt;
      if (f.y > H + 12) Object.assign(f, newFlake(W, H, false));
      if (f.x > W + 12) f.x -= W + 24; else if (f.x < -12) f.x += W + 24;
      const s = 1.4 + f.z * f.z * 5.5;
      fctx.globalAlpha = .35 + .6 * f.z;
      fctx.drawImage(flakeSprite, f.x - s / 2, f.y - s / 2, s, s);
    }
    fctx.globalAlpha = 1;

    hero.style.transform = `translate(-50%, calc(-50% + ${sy * .35}px))`;
    hero.style.opacity = Math.max(0, 1 - sy / (H * .7));
  }

  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    clock += dt;
    draw(dt);
    if (running) raf = requestAnimationFrame(frame);
  }

  rebuild();

  if (reduce) {
    addEventListener('scroll', () => draw(0), { passive: true });
  } else {
    // only animate while the header is on screen
    new IntersectionObserver(([e]) => {
      running = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (running) { last = performance.now(); raf = requestAnimationFrame(frame); }
    }).observe(stage);
  }

  let rt;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (stage.clientWidth !== W || stage.clientHeight !== H) rebuild(); }, 150);
  });
})();

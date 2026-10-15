/* The Qube full stack as an exploding 3D cube.
   - CSS 3D for the geometry (slabs, rails, tubes, packets)
   - one anime.js timeline synced to scroll drives the story (assemble → explode → tour → reassemble)
   - looping anime.js animations drive everything that "runs": requests, gears, LEDs, builds, deploys */
(() => {
  if (!window.anime) return;
  const { animate, createTimeline, onScroll, stagger, utils, svg, createAnimatable } = anime;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;

  const section  = document.getElementById('stack');
  const stage    = section.querySelector('.stack-stage');
  const viewport = section.querySelector('.viewport');
  const rig      = section.querySelector('.rig');
  const cam      = section.querySelector('.cam');
  const world    = section.querySelector('.world');
  const layers   = [...world.querySelectorAll('.layer')];
  const satAuth  = world.querySelector('#sat-auth');
  const satPm    = world.querySelector('#sat-postman');
  const satGit   = world.querySelector('#sat-git');

  /* ================= geometry ================= */
  const S = 320, T = 46, N = layers.length;   // 7 slabs × 46px ≈ a 320px cube
  const GAP = 62, P = T + GAP;                 // exploded spacing
  const zA = i => (N - i) * T;                 // assembled: top face of layer i
  const zE = i => (N - 1 - i) * P + T;         // exploded
  const BASE_PITCH = 56, BASE_YAW = -42;

  const REQ  = { x: 21.5, y: 300.5 };          // request (down) port
  const RESP = { x: 42.5, y: 300.5 };          // response (up) port
  const BLD  = { x: 298.5, y: 300.5 };         // build artifact port

  const el = (tag, cls, parent, style) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (style) Object.assign(e.style, style);
    if (parent) parent.appendChild(e);
    return e;
  };

  function addSides(block, label, meta) {
    for (const s of ['front', 'back', 'left', 'right']) {
      const d = el('div', `face side ${s}`, block);
      d.innerHTML = (s === 'front' || s === 'back')
        ? `<span>${label}</span><em>${meta}</em><span class="leds"><i></i><i></i><i></i></span>`
        : `<span>${label}</span>`;
    }
  }

  // vertical rail hanging under a layer, through the gap to the next one
  function rail(layer, at, cls) {
    const r = el('div', `rail3d ${cls || ''}`, layer, { left: at.x + 'px', top: at.y + 'px' });
    for (let k = 0; k < 2; k++) el('i', '', el('div', 'pl', r));
    return r;
  }

  // horizontal tube along x (dir = +1 / -1) at height z, two crossed planes
  function tubeH(parent, x, y, z, len, dir, cls) {
    const t = el('div', `tube ${cls}`, parent, { left: x + 'px', top: y + 'px', transform: `translateZ(${z}px)` });
    for (let k = 0; k < 2; k++) {
      const pl = el('div', 'pl', t, { left: (dir > 0 ? 0 : -len) + 'px', top: '-2px', width: len + 'px', height: '4px' });
      if (k) pl.style.transform = 'rotateX(90deg)';
      el('i', '', pl);
    }
    return t;
  }

  // vertical tube rising len px from (x, y, z)
  function tubeV(parent, x, y, z, len, cls) {
    const t = el('div', `tube v ${cls}`, parent, { left: x + 'px', top: y + 'px', transform: `translateZ(${z}px)` });
    for (let k = 0; k < 2; k++) {
      const pl = el('div', 'pl', t, { left: '-2px', top: '0', width: '4px', height: len + 'px', transformOrigin: '50% 0',
        transform: k ? 'rotateZ(90deg) rotateX(90deg)' : 'rotateX(90deg)' });
      el('i', '', pl);
    }
    return t;
  }

  // a glowing packet: .pk is placed, .mv is moved by anime, .dot faces the camera
  function packet(parent, x, y, z, cls) {
    const p = el('div', `pk ${cls || ''}`, parent, { left: x + 'px', top: y + 'px', transform: `translateZ(${z}px)` });
    const mv = el('div', 'mv', p);
    el('div', 'core', el('div', 'dot', mv));
    return mv;
  }

  const pingAt = (face, at, cls) => el('div', `ping ${cls || ''}`, face, { left: at.x + 'px', top: at.y + 'px' });

  /* ---- slabs ---- */
  const pings = [], bpings = [];
  layers.forEach((L, i) => {
    addSides(L, `${L.dataset.num} · ${L.dataset.name}`, L.dataset.meta);
    const top = L.querySelector('.top');
    pings[i] = pingAt(top, REQ);
    if (i < 5) { rail(L, REQ); rail(L, RESP, 'up'); }      // web → engine
    if (i >= 3 && i <= 5) rail(L, BLD, 'build up');         // maven → docker
  });
  bpings[3] = pingAt(layers[3].querySelector('.top'), BLD, 'build');
  bpings[6] = pingAt(layers[6].querySelector('.top'), BLD, 'build');

  /* ---- satellites (children carry their tubes so everything moves together) ---- */
  const SAT = [
    { el: satAuth, x: -238, y: 48,  of: 0 },
    { el: satPm,   x: 392,  y: 128, of: 1 },
    { el: satGit,  x: 392,  y: 108, of: 6 },
  ];
  for (const s of SAT) {
    addSides(s.el, s.el.dataset.name, s.el.dataset.meta);
    Object.assign(s.el.style, { left: s.x + 'px', top: s.y + 'px' });
  }
  tubeH(satAuth, 176, 62, -8, 62, 1, 'auth');                       // auth ↔ web
  const tokenMv = packet(satAuth, 176, 62, -8, 'white');
  tubeH(satPm, 0, 62, -8, 72, -1, '');                               // postman → api
  const pmMvs = [packet(satPm, 0, 62, -8), packet(satPm, 0, 62, -8, 'ok')];
  const DEPLOY_UP = zE(2) - T / 2 - zE(6);                           // git → render level
  tubeV(satGit, 20, 62, 0, DEPLOY_UP, 'build');
  tubeH(satGit, 20, 62, DEPLOY_UP, 92, -1, 'build');
  const deployMv = packet(satGit, 20, 62, 0, 'build');

  /* ---- packets inside the stack ---- */
  const DROP = zE(0) - zE(5);
  const reqMv   = packet(world, REQ.x,  REQ.y,  zE(5));
  const respMv  = packet(world, RESP.x, RESP.y, zE(5));
  const buildMv = packet(world, BLD.x,  BLD.y,  zE(6), 'build');

  /* ---- Mr. Qube: shell faces, axes, ring (visible while assembled) ---- */
  const CUBE = N * T;   // 322
  const shellFront = el('div', 'shell', world, { left: '0', top: S + 0.6 + 'px', width: S + 'px', height: CUBE + 'px',
    transformOrigin: '50% 0', transform: `translateZ(${CUBE}px) rotateX(-90deg)` });
  shellFront.innerHTML = `
    <svg viewBox="0 0 320 322">
      <path d="M160 8 C 104 72 104 250 160 314" stroke="rgba(255,255,255,.2)" stroke-width="2" fill="none"/>
      <path d="M160 8 C 216 72 216 250 160 314" stroke="rgba(255,255,255,.2)" stroke-width="2" fill="none"/>
      <g class="eye" style="transform-box:fill-box;transform-origin:50% 50%">
        <circle cx="104" cy="104" r="8" fill="#fff"/>
        <path d="M94 102 c 3 -11 20 -9 19 2 c -1 11 -18 11 -19 1 c 0 -6 11 -8 13 -2" stroke="#fff" stroke-width="2" fill="none"/>
      </g>
      <g class="eye" style="transform-box:fill-box;transform-origin:50% 50%">
        <circle cx="222" cy="98" r="6" fill="#fff"/>
        <path d="M213 97 c 4 -7 15 -6 14 1 c -1 6 -12 7 -13 0" stroke="#fff" stroke-width="2" fill="none"/>
      </g>
      <path class="mouth" d="M 136 236 Q 160 212 184 236" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none"
            style="transform-box:fill-box;transform-origin:50% 50%"/>
    </svg>`;
  const shellLeft = el('div', 'shell', world, { left: -(CUBE + 0.6) + 'px', top: '0', width: CUBE + 'px', height: S + 'px',
    transformOrigin: '100% 50%', transform: `translateZ(${CUBE}px) rotateY(-90deg)` });
  shellLeft.innerHTML = `
    <svg viewBox="0 0 322 320">
      <path d="M8 160 C 72 104 250 104 314 160" stroke="rgba(255,255,255,.2)" stroke-width="2" fill="none"/>
      <path d="M8 160 C 72 216 250 216 314 160" stroke="rgba(255,255,255,.12)" stroke-width="2" fill="none"/>
    </svg>`;
  const mid = CUBE / 2;
  const axes = [
    el('div', 'axis', world, { left: '-120px', top: '159px', width: '560px', transform: `translateZ(${mid}px)` }),
    el('div', 'axis', world, { left: '-120px', top: '159px', width: '560px', transform: `translateZ(${mid}px) rotateZ(90deg)` }),
    el('div', 'axis', world, { left: '-120px', top: '159px', width: '560px', transform: `translateZ(${mid}px) rotateY(-90deg)` }),
  ];
  const ring = el('div', 'ring', world, { left: '-80px', top: '-80px', width: '480px', height: '480px', transform: `translateZ(${mid + 30}px)` });
  const shellBits = [shellFront, shellLeft, ...axes, ring];
  const mouth = shellFront.querySelector('.mouth');

  /* ---- gears ---- */
  function gearPath(cx, cy, n, ro, ri) {
    const step = TAU / n; let d = '';
    for (let k = 0; k < n; k++) {
      const a = k * step;
      [[ri, a - step * .27], [ro, a - step * .13], [ro, a + step * .13], [ri, a + step * .27]].forEach(([r, g], j) => {
        d += (k || j ? 'L' : 'M') + (cx + r * Math.cos(g)).toFixed(2) + ' ' + (cy + r * Math.sin(g)).toFixed(2) + ' ';
      });
    }
    return d + 'Z';
  }
  const GEARSETS = [
    { box: '.gears-l', w: 130, h: 124, g: [{ x: 46, y: 70, n: 12, ro: 40, ri: 32, dir: 1 }, { x: 103, y: 36, n: 8, ro: 27, ri: 20, dir: -1 }] },
    { box: '.gears-e', w: 104, h: 80,  g: [{ x: 30, y: 46, n: 10, ro: 28, ri: 22, dir: -1 }, { x: 72, y: 30, n: 7, ro: 19, ri: 14, dir: 1 }] },
    { box: '.gears-m', w: 112, h: 116, g: [{ x: 54, y: 54, n: 14, ro: 46, ri: 38, dir: 1 }, { x: 96, y: 98, n: 8, ro: 19, ri: 14, dir: -1 }] },
  ];
  const gearEls = [];
  for (const set of GEARSETS) {
    const box = world.querySelector(set.box);
    let html = `<svg viewBox="0 0 ${set.w} ${set.h}" width="${set.w}" height="${set.h}" style="overflow:visible">`;
    for (const g of set.g) {
      const spokes = [0, 1, 2].map(k => {
        const a = k * TAU / 3;
        return `M${g.x} ${g.y} L${(g.x + g.ri * .7 * Math.cos(a)).toFixed(1)} ${(g.y + g.ri * .7 * Math.sin(a)).toFixed(1)}`;
      }).join(' ');
      html += `<g class="gear" data-n="${g.n}" data-dir="${g.dir}">
        <path d="${gearPath(g.x, g.y, g.n, g.ro, g.ri)}" fill="#151a21" stroke="#e9edf2" stroke-width="1.3" stroke-linejoin="round"/>
        <circle cx="${g.x}" cy="${g.y}" r="${(g.ri * .78).toFixed(1)}" fill="none" stroke="rgba(255,255,255,.25)"/>
        <path d="${spokes}" stroke="rgba(255,255,255,.5)" stroke-width="2"/>
        <circle cx="${g.x}" cy="${g.y}" r="${(g.ri * .22).toFixed(1)}" fill="#0c0e11" stroke="#e9edf2" stroke-width="1.3"/>
      </g>`;
    }
    box.innerHTML = html + '</svg>';
    gearEls.push(...box.querySelectorAll('.gear'));
  }

  /* ================= scroll story (one timeline, synced to scroll) ================= */
  const st = { t: 0, explode: 0, orbit: -30, focus: 0, spot: 0, shell: 1, sats: 0, smile: 0 };
  const TOTAL = 11000, TOUR = 2000, HOLD = 900, MOVE = 350;
  const story = createTimeline({
    autoplay: onScroll({ target: section, enter: 'top top', leave: 'bottom bottom', sync: reduce ? true : .14 }),
    defaults: { ease: 'inOut(3)' },
  })
    .add(st, { t: [0, 1], duration: TOTAL, ease: 'linear' }, 0)
    .add(st, { orbit: [-30, 0], duration: 900, ease: 'out(2)' }, 0)
    .add(st, { orbit: [0, 22], duration: TOTAL - 900, ease: 'linear' }, 900)
    .add(st, { explode: [0, 1], duration: 1000 }, 700)
    .add(st, { shell: [1, 0], duration: 380, ease: 'linear' }, 700)
    .add(st, { sats: [0, 1], duration: 700, ease: 'out(3)' }, 1300)
    .add(st, { spot: [0, 1], duration: 400 }, TOUR);
  for (let k = 0; k < N - 1; k++)
    story.add(st, { focus: [k, k + 1], duration: MOVE }, TOUR + HOLD * (k + 1) - MOVE);
  story
    .add(st, { spot: [1, 0], duration: 400 }, 8300)
    .add(st, { sats: [1, 0], duration: 500, ease: 'in(2)' }, 9600)
    .add(st, { explode: [1, 0], duration: 1000 }, 9600)
    .add(st, { shell: [0, 1], duration: 400, ease: 'linear' }, 10200)
    .add(st, { smile: [0, 1], duration: 500 }, 10450);

  /* ================= captions + layer rail ================= */
  const CAPS = [
    { k: 'Mr. Qube', h: 'This is Qube.', p: 'A quantum computer simulator, packed into one cube. Scroll to take it apart.' },
    { k: 'Exploded view', h: 'Seven layers, one round trip.', p: 'Every click on the site travels down this stack and back up. Blue is a live request. Amber is how the server gets built and shipped.',
      c: [['request', 'req'], ['build + deploy', 'build']] },
    { k: '01 · Web interface', h: 'The site', p: 'Static HTML, CSS and JS: home, research, outreach, a dashboard and the simulator. Every page pulls in a shared <code>header.html</code>. Google sign-in runs through Firebase Auth, right in the browser.',
      c: [['simulator.html'], ['header.html'], ['Firebase Auth']] },
    { k: '02 · HTTPS · REST', h: 'fetch() over HTTPS', p: 'The simulator sends JSON with <code>fetch()</code> and gets plain text back. Postman hits the same endpoints to test them without the UI.',
      c: [['POST /execute', 'req'], ['POST /execute-circuit', 'req'], ['/simulate-shor'], ['/simulate-grover'], ['Postman']] },
    { k: '03 · Render', h: 'Hosted on Render', p: 'The API lives at <code>qube-simulator.onrender.com</code> as a Docker web service. Free Render instances nap when idle, so the first request after a break wakes it up.',
      c: [['Docker runtime'], ['HTTPS'], ['cold starts']] },
    { k: '04 · Docker', h: 'Two-stage container', p: 'Stage one builds the JAR with Maven in <code>maven:3.9.4-eclipse-temurin-17</code>. Stage two copies only <code>app.jar</code> into a slim Temurin 17 Alpine image and runs it on port 8080.',
      c: [['multi-stage', 'build'], ['EXPOSE 8080'], ['java -jar app.jar']] },
    { k: '05 · Spring Boot', h: 'The controller', p: '<code>SimulatorController</code> is a <code>@RestController</code> with <code>@CrossOrigin</code>, so the site can call it from another domain. Qubits live in memory in a <code>ConcurrentHashMap</code>, keyed by id.',
      c: [['Spring Boot 3.5.3'], ['Java 17'], ['starter-web']] },
    { k: '06 · Quantum engine', h: 'Where the physics happens', p: 'Plain Java. A <code>Qubit</code> holds two complex amplitudes, α|0⟩ + β|1⟩. Gates rotate them and measuring collapses the state to 0 or 1. <code>MultiQubit</code>, Shor\'s (via gcd) and Grover\'s run here too.',
      c: [['gates'], ['MultiQubit'], ['Shor'], ['Grover']] },
    { k: '07 · Maven', h: 'The build', p: '<code>pom.xml</code> pulls in Spring Boot 3.5.3 on Java 17. <code>./mvnw clean package</code> compiles it all into one runnable JAR, the same file Docker ships. Push to GitHub and Render rebuilds it.',
      c: [['pom.xml', 'build'], ['mvnw'], ['spring-boot-maven-plugin'], ['GitHub → Render', 'build']] },
    { k: 'Round trip', h: 'Click, compute, collapse.', p: 'Run → JSON over HTTPS → Render → container → controller → engine → a 0 or a 1, then all the way back up to your screen.',
      c: [['request', 'req'], ['response', 'req']] },
    { k: 'Mr. Qube', h: "That's Qube.", p: "Seven layers, one cube, and he's a lot happier now that it all works. Drag him around." },
  ];
  const cap = section.querySelector('.caption');
  const capParts = { step: cap.querySelector('.step'), k: cap.querySelector('.k'), h: cap.querySelector('h3'), p: cap.querySelector('p'), c: cap.querySelector('.chips') };
  let capIdx = 0;

  function fillCaption(i) {
    const c = CAPS[i];
    capParts.step.textContent = `${String(i + 1).padStart(2, '0')}/${CAPS.length}`;
    capParts.k.textContent = c.k;
    capParts.h.textContent = c.h;
    capParts.p.innerHTML = c.p;
    capParts.c.innerHTML = (c.c || []).map(([t, cls]) => `<span class="${cls || ''}">${t}</span>`).join('');
  }
  function setCaption(i) {
    if (i === capIdx) return;
    capIdx = i;
    const parts = [capParts.k, capParts.h, capParts.p, capParts.c];
    if (reduce) { fillCaption(i); return; }
    animate(parts, {
      opacity: 0, translateY: -8, duration: 140, ease: 'in(2)',
      onComplete: () => {
        fillCaption(capIdx);
        animate(parts, { opacity: [0, 1], translateY: [12, 0], delay: stagger(55), duration: 520, ease: 'out(3)' });
        if (capParts.c.children.length)
          animate(capParts.c.children, { opacity: [0, 1], scale: [.85, 1], delay: stagger(40, { start: 200 }), duration: 400, ease: 'out(3)' });
      },
    });
  }
  fillCaption(0);

  const railNav = section.querySelector('.rail');
  const railBtns = layers.map((L, i) => {
    const b = el('button', '', railNav);
    b.innerHTML = `${L.dataset.num} ${L.dataset.name.split(' ')[0]}<i></i>`;
    b.addEventListener('click', () => jumpToLayer(i));
    return b;
  });
  function jumpToLayer(i) {
    const time = TOUR + HOLD * i + (i === 0 ? 300 : 150);
    const range = section.offsetHeight - innerHeight;
    scrollTo({ top: section.offsetTop + (time / TOTAL) * range, behavior: reduce ? 'auto' : 'smooth' });
  }

  /* ================= drag to rotate (createAnimatable smooths it) ================= */
  const drag = { yaw: 0, pitch: 0 };
  const dragA = createAnimatable(drag, { yaw: 600, pitch: 600, ease: 'out(3)' });
  let down = null, target = { yaw: 0, pitch: 0 };
  viewport.addEventListener('pointerdown', e => {
    down = { x: e.clientX, y: e.clientY, moved: false, yaw: target.yaw, pitch: target.pitch };
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) { down.moved = true; viewport.classList.add('dragging'); }
    target.yaw = down.yaw + dx * .35;
    target.pitch = Math.max(-30, Math.min(22, down.pitch - dy * .2));
    dragA.yaw(target.yaw); dragA.pitch(target.pitch);
  });
  const release = e => {
    if (!down) return;
    if (!down.moved) {                           // a click on a slab jumps to its chapter
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const L = hit && hit.closest('.layer');
      if (L) jumpToLayer(layers.indexOf(L));
    }
    down = null; viewport.classList.remove('dragging');
    target = { yaw: 0, pitch: 0 };
    dragA.yaw(0, 1400, 'outElastic(1, .6)'); dragA.pitch(0, 1400, 'outElastic(1, .6)');
  };
  viewport.addEventListener('pointerup', release);
  viewport.addEventListener('pointercancel', release);

  /* ================= per-frame layout ================= */
  let k = 1;
  function fit() {
    const w = stage.clientWidth, h = stage.clientHeight, mobile = w <= 820;
    const availW = mobile ? w - 48 : w * .54;
    const availH = mobile ? h * .56 : h - 130;
    k = Math.max(.3, Math.min(1.05, availW / 900, availH / 880));
  }
  fit(); addEventListener('resize', fit);

  const clamp01 = v => Math.max(0, Math.min(1, v));
  const zs = new Array(N), lits = new Array(N);
  let lastRail = -2;

  function render() {
    const e = st.explode;
    const pitch = BASE_PITCH + drag.pitch, yaw = BASE_YAW + st.orbit + drag.yaw;
    cam.style.transform = `rotateX(${pitch}deg) rotateZ(${yaw}deg)`;
    cam.style.setProperty('--yaw', yaw + 'deg');
    cam.style.setProperty('--pitch', pitch + 'deg');
    world.style.setProperty('--flow', clamp01((e - .82) / .18).toFixed(3));

    for (let i = 0; i < N; i++) {
      const b = Math.max(0, 1 - Math.abs(i - st.focus));
      zs[i] = zA(i) + (zE(i) - zA(i)) * e + st.spot * b * 24;
      lits[i] = 1 - st.spot * (1 - b) * .85;
      layers[i].style.transform = `translateZ(${zs[i].toFixed(2)}px)`;
      layers[i].style.setProperty('--lit', lits[i].toFixed(3));
    }
    for (let i = 0; i < N - 1; i++)
      layers[i].style.setProperty('--gap', Math.max(0, zs[i] - T - zs[i + 1]).toFixed(2) + 'px');

    const s = Math.max(.001, st.sats);
    for (const sat of SAT) {
      sat.el.style.transform = `translateZ(${zs[sat.of].toFixed(2)}px) scale3d(${s}, ${s}, ${s})`;
      sat.el.style.setProperty('--lit', lits[sat.of].toFixed(3));
      sat.el.style.visibility = st.sats < .01 ? 'hidden' : 'visible';
    }

    for (const b of shellBits) { b.style.opacity = st.shell.toFixed(3); b.style.visibility = st.shell < .01 ? 'hidden' : 'visible'; }
    mouth.style.transform = `scaleY(${(1 - 2 * st.smile).toFixed(3)})`;

    // keep the stack centred on screen as it grows and shrinks
    const offY = (zs[0] / 2) * Math.sin(pitch * Math.PI / 180) * k;
    rig.style.transform = `translate3d(0, ${offY.toFixed(1)}px, 0) scale(${k.toFixed(3)})`;

    // caption + rail state
    let ci;
    if (e < .5) ci = st.t < .5 ? 0 : 10;
    else if (st.spot < .5) ci = st.t < .5 ? 1 : 9;
    else ci = 2 + Math.round(st.focus);
    setCaption(ci);
    const ri = st.spot >= .5 ? Math.round(st.focus) : -1;
    if (ri !== lastRail) { railBtns.forEach((b, i) => b.classList.toggle('on', i === ri)); lastRail = ri; }
  }

  /* ================= things that run (looping anime.js animations) ================= */
  const loops = [];
  const loop = a => (loops.push(a), a);

  if (!reduce) {
    // dashed data flowing through rails and tubes
    loop(animate(world.querySelectorAll('.rail3d:not(.up) .pl i'), { translateY: [-12, 0], duration: 480, ease: 'linear', loop: true }));
    loop(animate(world.querySelectorAll('.rail3d.up .pl i, .tube.v .pl i'), { translateY: [0, -12], duration: 480, ease: 'linear', loop: true }));
    loop(animate(world.querySelectorAll('#sat-postman .tube .pl i, #sat-git .tube:not(.v) .pl i'), { translateX: [0, -12], duration: 480, ease: 'linear', loop: true }));
    loop(animate(world.querySelectorAll('#sat-auth .tube .pl i'), { translateX: [-12, 0], duration: 700, ease: 'linear', loop: true }));

    // meshing gears: fewer teeth = faster, neighbours turn opposite ways
    gearEls.forEach(g => loop(animate(g, { rotate: (+g.dataset.dir > 0 ? '1turn' : '-1turn'), duration: +g.dataset.n * 520, ease: 'linear', loop: true })));

    // engine: Bloch vector sweeps, a dot orbits the equator
    loop(animate(world.querySelector('.bloch-vec'), { rotate: [-38, 218], duration: 2600, ease: 'inOut(2)', loop: true, alternate: true }));
    loop(animate(world.querySelector('.eq-dot'), { ...svg.createMotionPath('#eq-path'), duration: 4200, ease: 'linear', loop: true }));

    // render: rack LEDs flicker, zzz drifts up
    loop(animate(world.querySelectorAll('.unit .leds i'), {
      opacity: [.18, 1], duration: () => utils.random(240, 900), delay: () => utils.random(0, 900),
      ease: 'inOut(4)', loop: true, alternate: true,
    }));
    loop(animate(world.querySelectorAll('.zzz span'), {
      translateY: [0, -44], translateX: [0, 14], scale: [.6, 1.25], opacity: [1, 0],
      delay: stagger(650), duration: 1950, ease: 'out(2)', loop: true,
    }));

    // docker: app.jar hops from the build stage to the run stage, port light breathes
    loop(animate(world.querySelector('.jar-hop'), { translateY: [-6, 24], opacity: [1, 0], duration: 1300, ease: 'in(2)', loop: true, loopDelay: 700 }));
    loop(animate(world.querySelector('.portlight i'), { scale: [1, 1.6], opacity: [1, .45], duration: 900, ease: 'inOut(2)', loop: true, alternate: true }));

    // maven: files ride the belt into the gears, the jar pulses, the caret blinks
    loop(animate(world.querySelectorAll('.belt .file'), { translateX: [-150, 220], duration: 4400, delay: stagger(1100), ease: 'linear', loop: true }));
    loop(animate(world.querySelector('.jar-out'), { scale: [1, 1.08], duration: 700, ease: 'inOut(2)', loop: true, alternate: true }));
    loop(animate(world.querySelector('.cmdline .caret'), { opacity: [1, 0], duration: 520, ease: 'inOut(8)', loop: true, alternate: true }));

    // build artifact climbs maven → docker
    loop(createTimeline({ loop: true, loopDelay: 500 })
      .add(bpings[6], { scale: [.3, 2], opacity: [1, 0], duration: 700, ease: 'out(2)' }, 0)
      .add(buildMv, { translateZ: [0, zE(3) - zE(6)], duration: 1700, ease: 'inOut(2)' }, 100)
      .add(bpings[3], { scale: [.3, 2], opacity: [1, 0], duration: 700, ease: 'out(2)' }, 1750));

    // deploy: a new commit on GitHub travels up the pipe into Render
    loop(createTimeline({ loop: true, loopDelay: 900 })
      .add(satGit.querySelector('.commits .new'), { scale: [.4, 1.5, 1], duration: 600, ease: 'out(3)' }, 0)
      .add(deployMv, { translateZ: [0, DEPLOY_UP], duration: 1900, ease: 'inOut(2)' }, 300)
      .add(deployMv, { translateX: [0, -92], duration: 700, ease: 'out(2)' }, 2200)
      .add(layers[2].querySelector('.status i'), { scale: [1, 2.2, 1], duration: 600, ease: 'out(2)' }, 2850));

    // postman fires test requests, the 200s light up
    loop(animate(pmMvs[0], { translateX: [0, -72], duration: 900, ease: 'inOut(2)', loop: true, loopDelay: 1200 }));
    loop(animate(pmMvs[1], { translateX: [-72, 0], duration: 900, ease: 'inOut(2)', delay: 1050, loop: true, loopDelay: 1200 }));
    loop(animate(satPm.querySelectorAll('.reqs b'), { opacity: [.2, 1], delay: stagger(700, { start: 1800 }), duration: 260, ease: 'out(2)', loop: true, alternate: true, loopDelay: 1400 }));

    // firebase auth: a token bounces between sign-in and the site; the key wiggles
    loop(animate(tokenMv, { translateX: [0, 62], duration: 1100, ease: 'inOut(3)', loop: true, alternate: true }));
    loop(animate(satAuth.querySelector('.key'), { rotate: [-8, 8], duration: 1100, ease: 'inOut(3)', loop: true, alternate: true }));

    // Mr. Qube blinks
    loop(createTimeline({ loop: true, loopDelay: 2600 })
      .add(shellFront.querySelectorAll('.eye'), { scaleY: [1, .1], duration: 80, ease: 'in(2)' }, 0)
      .add(shellFront.querySelectorAll('.eye'), { scaleY: [.1, 1], duration: 160, ease: 'out(2)' }, 80));

    /* ---- the request cycle: click Run → down the stack → measure → back up ---- */
    const web = layers[0];
    const gates = web.querySelectorAll('.circuit .g, .circuit .ctl, .circuit .cx');
    const run = web.querySelector('.run'), result = web.querySelector('.result'), log = web.querySelector('.log');
    const hl = layers[1].querySelector('.hl');
    const cells = layers[4].querySelectorAll('.cells i');
    const mOut = layers[5].querySelector('.m-out');
    const EP = [['/execute-circuit', 2], ['/execute', 1], ['/create-qubit', 0], ['/simulate-grover', 4], ['/simulate-shor', 3], ['/qubit/q0', 6]];
    let epN = 0, bit = '1';
    const DOWN = 1700, T0 = 1300, T1 = 3300;

    const cycle = createTimeline({ loop: true, defaults: { ease: 'out(3)' } })
      .add(gates, { opacity: [0, 1], translateY: [-14, 0], scale: [.6, 1], delay: stagger(70), duration: 420 }, 0)
      .call(() => {
        const [path, row] = EP[epN++ % EP.length];
        log.textContent = `${row === 6 ? 'GET' : 'POST'} ${path}`;
        result.textContent = '…';
        animate(hl, { translateY: row * 27, duration: 380, ease: 'out(3)' });
      }, 1180)
      .add(run, { scale: [1, .82], duration: 110, ease: 'in(2)' }, 1180)
      .add(run, { scale: [.82, 1], duration: 420, ease: 'outElastic(1, .5)' }, 1290)
      .add(reqMv, { translateZ: [DROP, 0], duration: DOWN, ease: 'inOut(2)' }, T0);
    for (let i = 0; i <= 5; i++)
      cycle.add(pings[i], { scale: [.3, 2.2], opacity: [1, 0], duration: 650, ease: 'out(2)' }, T0 + (DOWN / 5) * i * .92);
    cycle
      .add(cells[0], { backgroundColor: ['#5b8cff', '#12161b'], duration: 900, ease: 'out(2)' }, T0 + DOWN * .82)
      .call(() => { bit = Math.random() < .5 ? '0' : '1'; mOut.textContent = bit; }, T0 + DOWN + 80)
      .add(mOut, { scale: [1.7, 1], opacity: [0, 1], duration: 520, ease: 'outElastic(1, .6)' }, T0 + DOWN + 80)
      .add(respMv, { translateZ: [0, DROP], duration: DOWN, ease: 'inOut(2)' }, T1);
    for (let i = 5; i >= 0; i--)
      cycle.add(pings[i], { scale: [.3, 2.2], opacity: [1, 0], duration: 650, ease: 'out(2)' }, T1 + (DOWN / 5) * (5 - i) * .92 + 120);
    cycle
      .call(() => { result.textContent = `|${bit}⟩`; log.textContent = `q0 collapsed to ${bit}`; }, T1 + DOWN)
      .add(result, { scale: [1.5, 1], duration: 620, ease: 'outElastic(1, .6)' }, T1 + DOWN)
      .add(gates, { opacity: [1, 0], duration: 260, delay: stagger(25) }, T1 + DOWN + 900);
    loop(cycle);
  }

  /* ================= run only while the section is on screen ================= */
  let raf = 0;
  const frame = () => { render(); raf = requestAnimationFrame(frame); };
  new IntersectionObserver(([en]) => {
    cancelAnimationFrame(raf);
    if (en.isIntersecting) { raf = requestAnimationFrame(frame); loops.forEach(a => a.play()); }
    else loops.forEach(a => a.pause());
  }).observe(section);

  render();
})();

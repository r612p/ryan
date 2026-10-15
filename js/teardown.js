/* Envoy V1 teardown, inside the main page.
   A pinned stage (.td-stage) holds the three.js board and the story chapters scroll over it.
   Way in: the stage arrives as a black card with the to-scale blueprint drawn on it. As it pins, the card
   opens to full bleed and the camera swings out of a straight-down telephoto view (where the blueprint lines
   up with the real board) into the three-quarter hero view. Way out: the paper look fades into the page.
   Classic script with dynamic imports, so it also works when index.html is opened straight from disk. */
(async () => {
  const td = document.getElementById('teardown');
  if (!td || !window.anime) return;
  const {
    animate, createTimeline, createTimer, createAnimatable, onScroll, stagger,
    splitText, scrambleText, createDrawable, spring, utils,
  } = window.anime;

  const $ = (s, r = document) => r.querySelector(s);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrow = () => innerWidth <= 760;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const frameEl = $('#td-frame'), bpOverlay = $('#bp-overlay'), tickerEl = $('#ticker');

  // nothing heavy downloads until the section is close
  await new Promise((res) => {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); res(); } }, { rootMargin: '150% 0px' });
    io.observe(td);
  });
  const THREE = await import('three');
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');

  // ------------------------------------------------------------------ load the parts
  async function loadBlob() {
    const bar = $('#load-bar');
    try {
      const res = await fetch('envoy/envoy-model.bin');
      if (!res.ok || !res.body) throw new Error(res.status);
      const total = +res.headers.get('content-length') || 2771580;
      const reader = res.body.getReader(); const chunks = []; let got = 0;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        chunks.push(value); got += value.length; bar.style.transform = `scaleX(${Math.min(1, got / total)})`;
      }
      const out = new Uint8Array(got); let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      return out.buffer;
    } catch (err) {
      // opened straight from disk: fetch() is blocked on file://, the same bytes ship as a script
      await new Promise((ok, fail) => {
        const s = document.createElement('script'); s.src = 'envoy/envoy-model.js'; s.onload = ok; s.onerror = fail;
        document.head.append(s);
      });
      const bin = atob(window.ENVOY_MODEL_B64); const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      bar.style.transform = 'scaleX(1)';
      return out.buffer;
    }
  }

  let buf;
  try { buf = await loadBlob(); }
  catch (e) { $('#load-msg').textContent = 'Could not load envoy/envoy-model.bin.'; throw e; }

  const dv = new DataView(buf);
  const mlen = dv.getUint32(4, true);
  const M = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, mlen)));
  const BASE = 8 + mlen;

  // ------------------------------------------------------------------ renderer (sized to the stage, not the window)
  const canvas = $('#gl');
  let W = frameEl.clientWidth, H = frameEl.clientHeight;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
  catch (e) { $('#load-msg').textContent = 'This section needs WebGL, which this browser has turned off.'; throw e; }
  const DPR_MAX = Math.min(devicePixelRatio, 1.5);
  let dpr = DPR_MAX;
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 1, 6000);
  camera.layers.enable(2);          // edge lines live on layer 2, so the glow passes can skip them
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x0b0d12, 0.7); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(60, 140, 90); scene.add(key);
  const rim = new THREE.DirectionalLight(0x5b8cff, 3.2); rim.position.set(-90, 50, -130); scene.add(rim);

  const C = (hex) => new THREE.Color(hex);
  const NIGHT = C('#0c0e11'), PAPER = C('#f6f8fa'), INK = C('#f3f5f8'), PENCIL = C('#14171b'), RED = C('#ef2015'), ACCENT = C('#5b8cff');
  const SILK_ON_PAPER = C('#98a1ad'), PAPER_SHADE = PAPER.clone().multiplyScalar(.32);

  // board finish: black mask and laminate, white-grey traces that glow the portfolio's blue
  const GLOW = C('#7ea6ff');
  // knob caps and the master button cap: polished silver instead of gold and red plastic
  const FINISH = { mask: ['#0a0a0b', 0, .36], core: ['#151413', 0, .62], copper: ['#c4c7cc', .45, .32],
    knobTop: ['#e6e9ed', 1, .14], cap: ['#e6e9ed', 1, .12] };
  for (const [role, [hex, metal, rough]] of Object.entries(FINISH)) {
    const c = C(hex); Object.assign(M.materials[role], { color: [c.r, c.g, c.b], metal, rough });
  }

  // ------------------------------------------------------------------ trace glow targets (filled in after the parts load)
  const glowRT = { type: THREE.HalfFloatType };
  const glowA = new THREE.WebGLRenderTarget(1, 1, { ...glowRT, depthBuffer: true });
  const glowB = new THREE.WebGLRenderTarget(1, 1, { ...glowRT, depthBuffer: false });

  // ------------------------------------------------------------------ materials
  const mats = {};
  for (const [role, m] of Object.entries(M.materials)) {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(...m.color, THREE.LinearSRGBColorSpace),
      metalness: m.metal, roughness: m.rough, envMapIntensity: 0.9,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    mat.userData.base = { color: mat.color.clone(), metal: m.metal, rough: m.rough };
    mats[role] = mat;
  }
  const COLOURWAYS = { ember: C('#b8160c'), carbon: C('#26262a'), bone: C('#e6ddcf') };
  mats.enclosure.userData.base.color.copy(COLOURWAYS.carbon);   // Carbon is the default colourway

  // ------------------------------------------------------------------ build parts
  // Each part draws as one merged mesh per material plus one line set, whatever its piece count.
  // Pieces still move on their own: every vertex carries its piece index (pid) and the vertex
  // shader adds that piece's offset from a small uniform array.
  const world = new THREE.Group(); world.rotation.y = Math.PI / 2; scene.add(world);
  const parts = []; const byId = {}; const allMats = [];
  const LIFT = { module: 22, encoder: 30, button: 20, led: 18, resistor: 14, ic: 12, knob: 70, cap: 34 };
  const LAYER_OFF = { SILK: 14, MASK_T: 9, CU: 4.5, CORE: 0, MASK_B: -5 };
  const v3 = () => new THREE.Vector3();

  function withOffsets(mat, part) {
    mat.defines = { ...(mat.defines || {}), NP: part.np };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.pOff = part.offU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float pid;\nuniform vec3 pOff[NP];')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += pOff[int(pid + .5)];');
    };
    mat.customProgramCacheKey = () => 'poff' + part.np;
    return mat;
  }
  function partMat(role, part) {
    const src = mats[role];
    const m = withOffsets(src.clone(), part);
    m.userData.base = src.userData.base; m.userData.role = role;
    allMats.push(m);
    return m;
  }

  for (const pd of M.parts) {
    const g = new THREE.Group(); world.add(g);
    const part = {
      id: pd.id, name: pd.name, kind: pd.kind, blurb: pd.blurb, on: pd.on, g, pieces: [], meshes: [], lines: [], mats: {},
      s: { id: pd.id, lift: 0, dim: 0, dimI: 0, intro: 0 },
      min: v3().set(Infinity, Infinity, Infinity), max: v3().set(-Infinity, -Infinity, -Infinity),
    };
    // slot np-1 stays at zero for pieces that move by their own node (the encoder shafts)
    part.np = pd.pieces.length < 16 ? 16 : Math.ceil((pd.pieces.length + 1) / 8) * 8;
    part.offU = { value: Array.from({ length: part.np }, v3) };
    part.lineMat = withOffsets(new THREE.LineBasicMaterial({ color: INK.clone(), transparent: true, opacity: .16, depthWrite: false }), part);

    // decode every piece first
    const dec = pd.pieces.map((pc, idx) => {
      const q = new Uint16Array(buf, BASE + pc.p, pc.vc * 3);
      const pos = new Float32Array(pc.vc * 3);
      const [x0, y0, z0] = pc.min;
      const sx = (pc.max[0] - x0) / 65535, sy = (pc.max[1] - y0) / 65535, sz = (pc.max[2] - z0) / 65535;
      for (let i = 0, n = pc.vc * 3; i < n; i += 3) {
        pos[i] = x0 + q[i] * sx; pos[i + 1] = y0 + q[i + 1] * sy; pos[i + 2] = z0 + q[i + 2] * sz;
      }
      const IA = pc.i32 ? Uint32Array : Uint16Array;
      const mn = v3().fromArray(pc.min), mx = v3().fromArray(pc.max);
      part.min.min(mn); part.max.max(mx);
      const piece = { idx, tag: pc.tag || null, role: pc.m, min: mn, max: mx, center: mn.clone().add(mx).multiplyScalar(.5),
        base: v3(), dir: v3(), s: { k: 0, kI: 0 }, part, node: null };
      part.pieces.push(piece);
      return { pc, piece, pos, tri: new IA(buf, BASE + pc.i, pc.tc * 3), edge: pc.ec ? new IA(buf, BASE + pc.e, pc.ec * 2) : null };
    });

    // the shafts keep their own node so they can spin about their axis
    for (const d of dec.filter((d) => d.piece.tag === 'shaft')) {
      const { piece, pos } = d;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('pid', new THREE.BufferAttribute(new Float32Array(d.pc.vc).fill(part.np - 1), 1));
      geo.setIndex(new THREE.BufferAttribute(d.tri, 1));
      geo.computeVertexNormals();
      geo.translate(-piece.center.x, 0, -piece.center.z);
      piece.base.set(piece.center.x, 0, piece.center.z); piece.center.set(0, piece.center.y, 0);
      const node = new THREE.Group(); node.position.copy(piece.base);
      const mesh = new THREE.Mesh(geo, part.mats[piece.role] ||= partMat(piece.role, part));
      node.add(mesh); part.meshes.push(mesh);
      if (d.edge) {
        const eg = new THREE.BufferGeometry();
        eg.setAttribute('position', geo.getAttribute('position')); eg.setAttribute('pid', geo.getAttribute('pid'));
        eg.setIndex(new THREE.BufferAttribute(d.edge, 1));
        const ls = new THREE.LineSegments(eg, part.lineMat); ls.layers.set(2); node.add(ls); part.lines.push(ls);
      }
      piece.node = node; g.add(node);
    }

    // everything else merges into one vertex buffer for the part
    const rest = dec.filter((d) => !d.piece.node);
    if (rest.length) {
      const nv = rest.reduce((n, d) => n + d.pc.vc, 0);
      const pos = new Float32Array(nv * 3), pid = new Float32Array(nv);
      const triByRole = {}; const edges = [];
      let o = 0;
      for (const d of rest) {
        pos.set(d.pos, o * 3); pid.fill(d.piece.idx, o, o + d.pc.vc);
        (triByRole[d.piece.role] ||= []).push([d.tri, o]);
        if (d.edge) edges.push([d.edge, o]);
        o += d.pc.vc;
      }
      const join = (list) => {
        const n = list.reduce((a, [arr]) => a + arr.length, 0); const out = new Uint32Array(n); let w = 0;
        for (const [arr, off] of list) { for (let i = 0; i < arr.length; i++) out[w + i] = arr[i] + off; w += arr.length; }
        return out;
      };
      const Pa = new THREE.BufferAttribute(pos, 3), PID = new THREE.BufferAttribute(pid, 1);
      const all = new THREE.BufferGeometry(); all.setAttribute('position', Pa);
      all.setIndex(new THREE.BufferAttribute(join(Object.values(triByRole).flat()), 1));
      all.computeVertexNormals();
      const N = all.getAttribute('normal');
      for (const [role, list] of Object.entries(triByRole)) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', Pa); geo.setAttribute('normal', N); geo.setAttribute('pid', PID);
        geo.setIndex(new THREE.BufferAttribute(join(list), 1));
        const mesh = new THREE.Mesh(geo, part.mats[role] ||= partMat(role, part));
        mesh.frustumCulled = false;   // pieces fly outside the rest-pose bounds
        g.add(mesh); part.meshes.push(mesh);
      }
      if (edges.length) {
        const eg = new THREE.BufferGeometry(); eg.setAttribute('position', Pa); eg.setAttribute('pid', PID);
        eg.setIndex(new THREE.BufferAttribute(join(edges), 1));
        const lines = new THREE.LineSegments(eg, part.lineMat); lines.frustumCulled = false; lines.layers.set(2);
        g.add(lines); part.lines.push(lines);
      }
    }
    part.center = part.min.clone().add(part.max).multiplyScalar(.5);
    part.size = part.max.clone().sub(part.min);
    part.liftH = LIFT[pd.kind] || 0;
    part.layerOff = LAYER_OFF[pd.id] ?? 0;
    parts.push(part); byId[pd.id] = part;
  }
  const comps = parts.filter((p) => LIFT[p.kind] !== undefined);
  const refOf = (p) => (LIFT[p.kind] !== undefined ? p.id : '');

  // -------------------------------------------------- how each part comes apart into its pieces
  function rankExplode(part, step = 4.5) {
    const ps = part.pieces;
    const vol = (pc) => pc.max.clone().sub(pc.min).toArray().reduce((a, b) => a * b, 1);
    const base = ps.reduce((a, b) => (vol(b) > vol(a) ? b : a));
    const above = ps.filter((p) => p !== base && p.center.y >= base.center.y).sort((a, b) => a.center.y - b.center.y);
    const below = ps.filter((p) => p !== base && p.center.y < base.center.y).sort((a, b) => b.center.y - a.center.y);
    above.forEach((p, i) => p.dir.set((p.center.x - part.center.x) * .35, step * (i + 1), (p.center.z - part.center.z) * .35));
    below.forEach((p, i) => p.dir.set((p.center.x - part.center.x) * .6, -step * (i + 1) * .8, (p.center.z - part.center.z) * .6));
  }
  for (const p of comps) {
    if (p.kind === 'resistor') {
      const body = p.pieces.find((pc) => pc.role === 'resBody'); body.tag = 'body';
      const leads = p.pieces.filter((pc) => pc !== body).sort((a, b) => a.max.y - b.max.y);
      leads[0].tag = 'lead'; leads[0].dir.set(0, -8, 0);
      leads[1].tag = 'hairpin';
      const out = leads[1].center.clone().sub(body.center).setY(0).normalize();
      leads[1].dir.copy(out).multiplyScalar(7).setY(5);
      body.dir.set(0, 2, 0);
    } else if (p.kind === 'encoder') {
      const D = { legs: -9, body: 0, plate: 5, bushing: 10, nut: 16, shaft: 24 };
      for (const pc of p.pieces) pc.dir.set(0, D[pc.tag] ?? 0, 0);
    } else if (p.kind === 'module') {
      const D = { pin: [0, -16, 0], header: [0, -9, 0], pcb: [0, 0, 0], module: [0, 7, 0], soc: [0, 15, 0],
        shield: [0, 25, 0], usb: [0, 5, -12], btn: [0, 9, -4], uart: [0, 10, 0] };
      for (const pc of p.pieces) {
        if (D[pc.tag]) pc.dir.fromArray(D[pc.tag]);
        else pc.dir.set(utils.random(-1.5, 1.5, 2), utils.random(3.5, 11, 2), utils.random(-1.5, 1.5, 2));
      }
    } else rankExplode(p);
  }

  // ------------------------------------------------------------------ animated state
  const rig = { dist: 215, el: 50, az: -16, tx: 0, ty: 3, tz: 0, roll: 0, sx: 1, sy: 1, heroW: 1, fU1: 0, fSW2: 0, fR5: 0 };
  const ambient = { az: 0 };
  const user = { az: 0, el: 0 };
  const insp = { w: 0, x: 0, y: 0, z: 0, dist: 120 };
  const look = { paper: 0 };
  const enc = { up: 0, down: 0 };
  const lay = { spread: 0 };
  const comp = { extra: 0 };
  const glow = { k: 1 };
  const dims = { o: 0 };
  const leds = ['D2', 'D4', 'D3', 'D1'].map((id) => ({ id, v: 0 }));
  const knobs = ['SW1', 'SW2', 'SW4'].map((id) => ({ id, r: 0, shaft: byId[id].pieces.find((pc) => pc.tag === 'shaft'),
    knob: parts.find((p) => p.kind === 'knob' && p.on === id) }));
  for (const l of leds) l.mat = byId[l.id].mats.ledBody;

  // ------------------------------------------------------------------ trace glow (night scenes only)
  // The traces and LED bodies are drawn again, alone, into a quarter-size target behind a black depth
  // pass of the parts that can hide them. That image is blurred and added over the frame, and a
  // brighter band runs out from the ESP32 along the traces like a signal.
  const glowFx = { k: 1, wave: 0 };
  const waveU = { value: 0 }, centreU = { value: v3() };
  const glowMat = new THREE.MeshBasicMaterial({ color: GLOW });
  glowMat.onBeforeCompile = (sh) => {
    sh.uniforms.uWave = waveU; sh.uniforms.uCentre = centreU;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW;\nuniform float uWave;\nuniform vec3 uCentre;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );',
        'float dd = distance(vW.xz, uCentre.xz);\n' +
        'float band = exp(-pow((dd - uWave) / 7.0, 2.0)) + .55 * exp(-pow((dd - uWave + 40.0) / 7.0, 2.0));\n' +
        'vec4 diffuseColor = vec4(diffuse * (.4 + 1.6 * band), opacity);');
  };
  const occMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  for (const p of parts) if (LIFT[p.kind] !== undefined || p.kind === 'enclosure') for (const m of p.meshes) m.layers.enable(3);
  const traceMat = byId.CU.mats.copper;
  for (const m of byId.CU.meshes) if (m.material === traceMat) {
    const gm = new THREE.Mesh(m.geometry, glowMat); gm.layers.set(1); gm.frustumCulled = false; byId.CU.g.add(gm);
  }
  for (const l of leds) {
    const src = byId[l.id].meshes.find((m) => m.material === l.mat);
    l.glow = new THREE.MeshBasicMaterial({ color: RED.clone() });
    const gm = new THREE.Mesh(src.geometry, l.glow); gm.layers.set(1); gm.frustumCulled = false; byId[l.id].g.add(gm);
  }
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsGeo = new THREE.BufferGeometry();
  fsGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const fsVert = 'varying vec2 vUv; void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }';
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: null }, dir: { value: new THREE.Vector2() } }, vertexShader: fsVert,
    fragmentShader: `uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tex, vUv).rgb * .227;
        c += (texture2D(tex, vUv + dir * 1.385).rgb + texture2D(tex, vUv - dir * 1.385).rgb) * .316;
        c += (texture2D(tex, vUv + dir * 3.231).rgb + texture2D(tex, vUv - dir * 3.231).rgb) * .070;
        gl_FragColor = vec4(c, 1.);
      }`,
    depthTest: false, depthWrite: false,
  });
  const addMat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: null }, k: { value: 1 } }, vertexShader: fsVert,
    fragmentShader: 'uniform sampler2D tex; uniform float k; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tex, vUv).rgb * k, 1.); }',
    blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
  });
  const fsBlur = new THREE.Mesh(fsGeo, blurMat), fsAdd = new THREE.Mesh(fsGeo, addMat);
  fsBlur.frustumCulled = fsAdd.frustumCulled = false;
  function renderGlow(k) {
    const bg = scene.background, mask = camera.layers.mask, ac = renderer.autoClear;
    scene.background = null; renderer.autoClear = false;
    renderer.setRenderTarget(glowA); renderer.setClearColor(0x000000, 1); renderer.clear(true, true, false);
    camera.layers.set(3); scene.overrideMaterial = occMat; renderer.render(scene, camera);   // what can hide a trace
    camera.layers.set(1); scene.overrideMaterial = null; renderer.render(scene, camera);     // traces + LEDs, lit
    for (const step of [1, 2.2]) {
      blurMat.uniforms.tex.value = glowA.texture; blurMat.uniforms.dir.value.set(step / glowA.width, 0);
      renderer.setRenderTarget(glowB); renderer.render(fsBlur, fsCam);
      blurMat.uniforms.tex.value = glowB.texture; blurMat.uniforms.dir.value.set(0, step / glowA.height);
      renderer.setRenderTarget(glowA); renderer.render(fsBlur, fsCam);
    }
    renderer.setRenderTarget(null);
    addMat.uniforms.tex.value = glowA.texture; addMat.uniforms.k.value = k;
    renderer.render(fsAdd, fsCam);
    scene.background = bg; camera.layers.mask = mask; renderer.autoClear = ac;
  }

  // ------------------------------------------------------------------ look: night -> paper
  let lookDirty = true, lastPaper = -1;
  const tmpC = new THREE.Color();
  const paperGrid = $('#paper-grid');
  function applyLook() {
    const t = look.paper;
    scene.background = tmpC.copy(NIGHT).lerp(PAPER, t).clone();
    for (const m of allMats) setMat(m, t);
    key.intensity = 2.4 - 1.5 * t; hemi.intensity = .7 - .3 * t; rim.intensity = 3.2 * (1 - t);
    const fg = INK.clone().lerp(PENCIL, t), bg = NIGHT.clone().lerp(PAPER, t);
    td.style.setProperty('--fg', '#' + fg.getHexString());
    td.style.setProperty('--bg', '#' + bg.getHexString());
    paperGrid.style.opacity = t;
    lastPaper = t; lookDirty = false;
  }
  function setMat(m, t) {
    const b = m.userData.base;
    m.color.copy(b.color).lerp(PAPER_SHADE, t);
    m.emissive.copy(m.userData.role === 'silk' ? SILK_ON_PAPER : PAPER).multiplyScalar(.87 * t);
    m.metalness = b.metal * (1 - t);
    m.roughness = b.rough + (1 - b.rough) * t;
    m.envMapIntensity = .9 * (1 - t);
  }

  // ------------------------------------------------------------------ geometry helpers
  const _v = v3(), _w = v3();
  // a point given in a piece's rest coordinates, carried to where that piece is now
  function pieceToWorld(pc, local, out) {
    if (pc.node) return pc.node.localToWorld(out.copy(local));
    return pc.part.g.localToWorld(out.copy(local).add(pc.part.offU.value[pc.idx]));
  }
  // "U1" is a whole part, "U1:shield" the first of its pieces with that tag, "FRAME@loop" a named spot
  const SPOTS = {
    'FRAME@loop': (p, o) => o.set(p.min.x + 6.5, p.max.y, p.min.z + 4.5),   // the key loop
    'TRAY@rim': (p, o) => o.set(p.center.x, p.max.y, p.max.z - 1),        // front wall, top edge
  };
  function anchor(spec, out) {
    if (SPOTS[spec]) { const p = byId[spec.split('@')[0]]; return p.g.localToWorld(SPOTS[spec](p, out)); }
    const [id, tag] = spec.split(':'); const p = byId[id];
    if (!tag) return p.g.localToWorld(out.copy(p.center));
    const pc = p.pieces.find((x) => x.tag === tag) || p.pieces[0];
    return pieceToWorld(pc, pc.center, out);
  }
  // world point -> pixel position inside the stage
  function project(p, out) {
    _w.copy(p).project(camera);
    out.x = (_w.x * .5 + .5) * W; out.y = (-_w.y * .5 + .5) * H; out.z = _w.z;
    return out;
  }

  // ------------------------------------------------------------------ the way in: card -> full bleed, blueprint -> board
  let entry = 0, exitK = 0, tdOn = false;
  function entryUpdate() {
    const tr = td.getBoundingClientRect();
    const raw = clamp01((innerHeight - tr.top) / (innerHeight * 1.4));   // .71 when the stage pins, 1 at 40vh in
    entry = reduce ? raw : entry + (raw - entry) * .16;
    if (Math.abs(raw - entry) < .0005) entry = raw;
    exitK = smooth(0, 1, 1 - (tr.bottom - innerHeight) / (innerHeight * .35));   // 1 as the stage lets go at the end
    const k = 1 - smooth(.70, .97, entry);
    frameEl.style.clipPath = k > .001 ? `inset(${(k * H * .08).toFixed(1)}px ${(k * Math.max(16, W * .05)).toFixed(1)}px)` : 'none';
    canvas.style.opacity = smooth(.28, .7, entry).toFixed(3);
    bpOverlay.style.opacity = (1 - smooth(.66, .86, entry)).toFixed(3);
    tickerEl.style.opacity = (smooth(.92, 1, entry) * (1 - exitK)).toFixed(3);
    return smooth(.72, 1, entry);
  }
  // lay the blueprint's mm grid over the board exactly where the camera sees it
  const bpSvg = bpOverlay.querySelector('svg');
  const bpVB = bpSvg.viewBox.baseVal;
  const F = byId.FRAME;
  const _p0 = { x: 0, y: 0, z: 0 }, _px = { x: 0, y: 0, z: 0 }, _pz = { x: 0, y: 0, z: 0 };
  bpSvg.style.width = bpVB.width + 'px'; bpSvg.style.height = bpVB.height + 'px';
  function placeBlueprint() {
    const y = 3;
    project(world.localToWorld(_v.set(F.min.x, y, F.min.z)), _p0);
    project(world.localToWorld(_v.set(F.max.x, y, F.min.z)), _px);
    project(world.localToWorld(_v.set(F.min.x, y, F.max.z)), _pz);
    const ax = (_px.x - _p0.x) / (F.max.x - F.min.x), ay = (_px.y - _p0.y) / (F.max.x - F.min.x);
    const cx = (_pz.x - _p0.x) / (F.max.z - F.min.z), cy = (_pz.y - _p0.y) / (F.max.z - F.min.z);
    const tx = _p0.x + ax * (bpVB.x - F.min.x) + cx * (bpVB.y - F.min.z);
    const ty = _p0.y + ay * (bpVB.x - F.min.x) + cy * (bpVB.y - F.min.z);
    bpSvg.style.transform = `matrix(${ax},${ay},${cx},${cy},${tx},${ty})`;
  }

  // ------------------------------------------------------------------ per-frame
  const tgt = v3(), camPos = v3(), fa = v3();
  let fAcc = 0, fN = 0, lastT = performance.now();
  function frame() {
    if (!tdOn) return;                      // offscreen: no WebGL work at all
    // integrated GPUs: drop resolution a step if frames run long, take it back when there is headroom
    const now = performance.now(), dt = now - lastT; lastT = now;
    if (dt < 250) { fAcc += dt; fN++; }
    if (fN >= 90) {
      const avg = fAcc / fN; fAcc = fN = 0;
      const next = avg > 24 ? Math.max(.75, dpr - .25) : avg < 12 ? Math.min(DPR_MAX, dpr + .25) : dpr;
      if (next !== dpr) { dpr = next; renderer.setPixelRatio(dpr); resize(); }
    }
    if (lookDirty || look.paper !== lastPaper) applyLook();
    const blend = entryUpdate();

    const encUp = enc.up, encDn = enc.down;
    for (const p of parts) {
      let y = 0;
      if (p.id === 'FRAME') y = encUp + p.s.intro * 70;
      else if (p.id === 'TRAY') y = -encDn - p.s.intro * 50;
      else if (p.kind === 'layer') y = p.layerOff * lay.spread + (p.id === 'CU' ? .03 : 0);   // traces ride on the black mask
      else y = p.s.lift * (p.liftH + comp.extra) + p.s.intro * 55;
      p.g.position.y = y;
      // a ghosted part keeps faint edges and drops its fill, so the part in focus reads through it
      const dim = Math.max(p.s.dim, p.s.dimI);
      p.ghost = dim > .5;
      p.lineMat.opacity = (.16 + .74 * look.paper) * (1 - .94 * dim);
      if (!p.hover) p.lineMat.color.copy(INK).lerp(PENCIL, look.paper);
      for (const m of p.meshes) m.visible = !p.ghost;
      if (p.id === 'CU') for (const l of p.lines) l.visible = look.paper > .02;   // invisible on the night board
      for (const pc of p.pieces) {
        const k = Math.max(pc.s.k, pc.s.kI);
        if (pc.node) pc.node.position.copy(pc.base).addScaledVector(pc.dir, k);
        else p.offU.value[pc.idx].copy(pc.dir).multiplyScalar(k);
      }
    }
    for (const k of knobs) {
      k.shaft.node.rotation.y = k.r;
      if (!k.knob) continue;                       // the knob turns with its shaft, about the shaft axis
      const g = k.knob.g, c = k.knob.center, cs = Math.cos(k.r), sn = Math.sin(k.r);
      g.rotation.y = k.r;
      g.position.x = c.x - (c.x * cs + c.z * sn);
      g.position.z = c.z - (-c.x * sn + c.z * cs);
    }
    for (const l of leds) {
      const v = l.v * glow.k * (1 - look.paper);
      l.mat.emissive.copy(PAPER).multiplyScalar(.87 * look.paper).add(_ledC.copy(RED).multiplyScalar(v * 2.4));
      l.glow.color.copy(RED).multiplyScalar(v * 1.4);
    }
    const night = 1 - look.paper;
    traceMat.emissive.copy(PAPER).multiplyScalar(.87 * look.paper).add(_ledC.copy(GLOW).multiplyScalar(.16 * night));
    waveU.value = glowFx.wave;
    world.updateMatrixWorld(true);

    // camera
    const wf = rig.fU1 + rig.fSW2 + rig.fR5;
    tgt.set(rig.tx, rig.ty, rig.tz).multiplyScalar(Math.max(0, 1 - wf));
    if (rig.fU1) tgt.addScaledVector(anchor('U1', fa).add(_v.set(0, 3, 0)), rig.fU1);
    if (rig.fSW2) tgt.addScaledVector(anchor('SW2', fa).add(_v.set(0, 10, 0)), rig.fSW2);
    if (rig.fR5) tgt.addScaledVector(anchor('R5:body', fa).add(_v.set(0, 1, 0)), rig.fR5);
    let dist = rig.dist, az = rig.az + ambient.az * rig.heroW + user.az, el = rig.el + user.el;
    if (insp.w) {
      tgt.lerp(fa.set(insp.x, insp.y, insp.z), insp.w);
      dist += (insp.dist - dist) * insp.w;
    }
    // way in: a straight-down telephoto view (matches the blueprint) swinging into the hero view
    if (blend < 1) {
      el = 89 + (el - 89) * blend;
      az = 90 + (az - 90) * blend;
      dist = Math.exp(Math.log(1430) + (Math.log(dist) - Math.log(1430)) * blend);
    }
    camera.fov = 6 + 22 * blend;
    const aspect = W / H;
    dist *= Math.max(1, 1.3 / aspect);
    const e = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(el, -5, 89)), a = THREE.MathUtils.degToRad(az);
    camPos.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).multiplyScalar(dist).add(tgt);
    camera.position.copy(camPos); camera.up.set(0, 1, 0); camera.lookAt(tgt);
    camera.rotateZ(rig.roll * (1 - insp.w));
    // centre the board in the room the chapter's copy box leaves (and further right while looking straight down)
    const cp = secs[Math.max(0, chapter)].querySelector('.copy');
    const copyR = cp ? cp.getBoundingClientRect().right - frameEl.getBoundingClientRect().left : 0;
    const roomX = Math.max(W * .17, copyR * .5);
    const shiftX = narrow() ? 0 : (roomX * rig.sx + W * .1 * (1 - blend)) * (1 - insp.w * .6);
    const shiftY = narrow() ? -H * .1 * rig.sy : 0;
    camera.setViewOffset(W, H, -shiftX, shiftY, W, H);   // also refreshes the projection (fov above)
    camera.updateMatrixWorld();

    renderer.render(scene, camera);
    const gk = glowFx.k * (1 - look.paper);
    if (gk > .01) { anchor('U1', centreU.value); renderGlow(gk * 1.35); }
    if (+bpOverlay.style.opacity > .01) placeBlueprint();
    drawLeaders(); drawDims(); updateTicker(); updateChapter();
  }
  const _ledC = new THREE.Color();

  // ------------------------------------------------------------------ resize
  function resize() {
    W = frameEl.clientWidth; H = frameEl.clientHeight;
    renderer.setSize(W, H, false);
    const gw = Math.max(1, Math.round(W * dpr / 4)), gh = Math.max(1, Math.round(H * dpr / 4));
    glowA.setSize(gw, gh); glowB.setSize(gw, gh);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    $('#leaders').setAttribute('viewBox', `0 0 ${W} ${H}`);
  }
  addEventListener('resize', resize); resize();

  // ------------------------------------------------------------------ labels + leader lines
  const LABELS = {
    1: { l: [['FRAME@loop', 'Frame', 'bezel + key loop'], ['TRAY@rim', 'Tray', '18.0 mm deep']], r: [['CORE', 'Board', '50.4 × 91.0 mm']] },
    2: { l: [['K2', 'K1–K3', 'printed knobs'], ['SW1', 'SW1', 'encoder'], ['SW2', 'SW2', 'encoder'], ['SW4', 'SW4', 'encoder'],
             ['CAP', 'CAP', 'master cap'], ['SW3', 'SW3', 'master button'], ['D4', 'D1–D4', 'LEDs']],
         r: [['U1', 'U1', 'ESP32 DevKit V1'], ['U7', 'U7', 'DIP-16'], ['U2', 'U2', 'DIP-16'], ['R9', 'R3–R14', 'resistors ×12'], ['TRAY@rim', 'Tray', '']] },
    3: { l: [], r: [['SILK', 'Silkscreen', ''], ['MASK_T', 'Top mask', ''], ['CU', 'Copper', ''], ['CORE', 'FR-4 core', '1.6 mm'], ['MASK_B', 'Bottom mask', '']] },
    4: { l: [['U1:shield', 'RF shield', ''], ['U1:soc', 'ESP32 SoC', ''], ['U1:module', 'Module PCB', ''], ['U1:usb', 'Micro-USB', '']],
         r: [['U1:uart', 'USB-UART bridge', ''], ['U1:btn', 'EN · BOOT', ''], ['U1:header', 'Header', '2 × 15'], ['U1:pin', 'Pins', '×30'], ['U1:pcb', 'DevKit PCB', '']] },
    5: { l: [['SW2:shaft', 'Shaft', ''], ['SW2:nut', 'Nut', ''], ['SW2:bushing', 'Bushing', 'threaded']],
         r: [['SW2:plate', 'Top plate', ''], ['SW2:body', 'Body', ''], ['SW2:legs', 'Legs', '']] },
    6: { l: [['R5:body', 'Body', 'DIN0207']], r: [['R5:hairpin', 'Lead', 'hairpin'], ['R5:lead', 'Lead', 'short']] },
  };
  const SVGNS = 'http://www.w3.org/2000/svg';
  let live = [];   // {li, line, dot, spec, side}
  function clearLabels() {
    const old = live; live = [];
    if (!old.length) return;
    animate(old.map((o) => o.li), { opacity: 0, duration: 200, ease: 'out(2)', onComplete: () => old.forEach((o) => o.li.remove()) });
    animate(old.flatMap((o) => [o.line, o.dot]), { opacity: 0, duration: 200, onComplete: () => old.forEach((o) => { o.line.remove(); o.dot.remove(); }) });
  }
  function showLabels(ch) {
    clearLabels();
    const set = LABELS[ch]; if (!set) return;
    const made = [];
    for (const side of ['l', 'r']) {
      const ul = $('#labels-' + side);
      set[side].forEach(([spec, ref, name]) => {
        const li = document.createElement('li');
        li.innerHTML = side === 'l'
          ? `<span class="ref">${ref}</span><span class="nm">${name}</span>`
          : `<span class="nm">${name}</span><span class="ref">${ref}</span>`;
        ul.append(li);
        const line = document.createElementNS(SVGNS, 'polyline');
        const dot = document.createElementNS(SVGNS, 'circle'); dot.setAttribute('r', '2.5');
        $('#lead-lines').append(line, dot);
        made.push({ li, line, dot, spec, side, p: v3() });
      });
    }
    // the left column shares the screen with the chapter copy: start it below the copy if they would meet
    const copy = secs[ch].querySelector('.copy');
    const copyBottom = parseFloat(getComputedStyle(copy).top) + copy.offsetHeight + 18;
    for (const side of ['l', 'r']) {
      const ul = $('#labels-' + side);
      let top = H * .58 - ul.offsetHeight / 2;
      if (side === 'l') top = Math.max(top, copyBottom);
      ul.style.top = top + 'px';
    }
    live = made;
    drawLeaders();
    if (reduce) return;
    const spans = made.flatMap((o) => [...o.li.children]).filter((s) => s.textContent);
    animate(spans, { innerHTML: scrambleText({ chars: 'A-Z0-9·', settleDuration: 260 }), duration: 700, delay: stagger(35) });
    animate(createDrawable(made.map((o) => o.line)), { draw: ['0 0', '0 1'], duration: 750, delay: stagger(45), ease: 'inOut(3)' });
    animate(made.map((o) => o.dot), { scale: [0, 1], duration: 500, delay: stagger(45, { start: 500 }), ease: spring({ bounce: .5, duration: 400 }) });
  }
  const _p = { x: 0, y: 0, z: 0 };
  function drawLeaders() {
    if (!live.length) return;
    const fr = frameEl.getBoundingClientRect();
    for (const o of live) {
      anchor(o.spec, o.p); project(o.p, _p);
      const r = o.li.getBoundingClientRect();
      const y = r.top - fr.top + r.height / 2;
      const x0 = o.side === 'l' ? r.right - fr.left + 10 : r.left - fr.left - 10;
      const kneeX = o.side === 'l' ? Math.max(x0 + 12, _p.x - 40) : Math.min(x0 - 12, _p.x + 40);
      o.line.setAttribute('points', `${x0},${y} ${kneeX},${y} ${_p.x},${_p.y}`);
      o.dot.setAttribute('cx', _p.x); o.dot.setAttribute('cy', _p.y);
      o.dot.style.transformOrigin = `${_p.x}px ${_p.y}px`;
    }
  }

  // ------------------------------------------------------------------ R5 dimension callouts
  const dimG = $('#dims');
  dimG.innerHTML = `<line id="d1"/><line id="d1a"/><line id="d1b"/><text id="d1t"></text>
    <line id="d2"/><line id="d2a"/><line id="d2b"/><text id="d2t"></text>`;
  const r5body = byId.R5.pieces.find((pc) => pc.tag === 'body');
  const r5h = (r5body.max.y - r5body.min.y).toFixed(1), r5d = (r5body.max.x - r5body.min.x).toFixed(1);
  $('#d1t').textContent = `${r5h} mm`; $('#d2t').textContent = `Ø ${r5d} mm`;
  $('#r5-facts').innerHTML = `<li>Body ${r5h} mm tall</li><li>Ø ${r5d} mm</li>`;
  const dA = v3(), dB = v3(), pA = { x: 0, y: 0 }, pB = { x: 0, y: 0 };
  function setLine(id, a, b) { const l = $('#' + id); l.setAttribute('x1', a.x); l.setAttribute('y1', a.y); l.setAttribute('x2', b.x); l.setAttribute('y2', b.y); }
  function drawDims() {
    dimG.style.opacity = dims.o;
    if (dims.o < .01) return;
    const c = r5body.center;
    // height, measured beside the body
    pieceToWorld(r5body, _v.set(c.x, r5body.min.y, c.z), dA); pieceToWorld(r5body, _v.set(c.x, r5body.max.y, c.z), dB);
    project(dA, pA); project(dB, pB);
    const off = 46; const a = { x: pA.x + off, y: pA.y }, b = { x: pB.x + off, y: pB.y };
    setLine('d1', a, b); setLine('d1a', { x: pA.x + 8, y: pA.y }, { x: a.x + 8, y: a.y }); setLine('d1b', { x: pB.x + 8, y: pB.y }, { x: b.x + 8, y: b.y });
    const t1 = $('#d1t'); t1.setAttribute('x', a.x + 10); t1.setAttribute('y', (a.y + b.y) / 2 + 4);
    // diameter, across the top
    pieceToWorld(r5body, _v.set(r5body.min.x, r5body.max.y, c.z), dA); pieceToWorld(r5body, _v.set(r5body.max.x, r5body.max.y, c.z), dB);
    project(dA, pA); project(dB, pB);
    const up = 34; const a2 = { x: pA.x, y: pA.y - up }, b2 = { x: pB.x, y: pB.y - up };
    setLine('d2', a2, b2); setLine('d2a', pA, { x: a2.x, y: a2.y - 6 }); setLine('d2b', pB, { x: b2.x, y: b2.y - 6 });
    const t2 = $('#d2t'); t2.setAttribute('x', Math.min(a2.x, b2.x)); t2.setAttribute('y', Math.min(a2.y, b2.y) - 10);
  }

  // ------------------------------------------------------------------ ticker (progress through this section, not the page)
  const track = $('#tk-track'), head = $('#tk-head');
  const TICKS = 96;
  for (let i = 0; i < TICKS; i++) { const t = document.createElement('i'); if (i % 12 === 0) t.className = 'major'; track.insertBefore(t, head); }
  const tickEls = [...track.querySelectorAll('i')];
  let lastTick = -1;
  function updateTicker() {
    const tr = td.getBoundingClientRect();
    const max = td.offsetHeight - innerHeight;
    const p = max > 0 ? clamp01(-tr.top / max) : 0;
    head.style.transform = `translateX(${p * track.clientWidth}px)`;
    $('#tk-pct').textContent = `${Math.round(p * 100)}%`;
    const ti = Math.round(p * (TICKS - 1));
    if (ti !== lastTick && !reduce && +tickerEl.style.opacity > .05) {
      const near = tickEls.slice(Math.max(0, ti - 2), ti + 3);
      animate(near, { scaleY: [1, 2.1, 1], duration: 420, delay: stagger(26, { from: 'center' }), ease: 'inOutQuad' });
    }
    lastTick = ti;
  }

  // ------------------------------------------------------------------ chapters
  const story = $('#story');
  const secs = [...story.querySelectorAll('.ch')];
  let chapter = -1;
  function updateChapter() {
    let c = 0;
    for (let i = 0; i < secs.length; i++) if (secs[i].getBoundingClientRect().top <= innerHeight * .45) c = i;
    if (c === chapter) return;
    const prev = chapter; chapter = c;
    const name = secs[c].dataset.name;
    const lab = $('#tk-label');
    if (reduce) lab.textContent = name;
    else animate(lab, { innerHTML: scrambleText({ text: name.toUpperCase(), chars: 'A-Z0-9', settleDuration: 220 }), duration: 600 });
    showLabels(c);
    if (c !== secs.length - 1) closeInspect();
    if (prev >= 0 && c > prev && !reduce) enterCopy(secs[c]);
  }
  const splits = new Map();
  function enterCopy(sec) {
    const h = sec.querySelector('h1, h2'); if (!h) return;
    if (!splits.has(h)) splits.set(h, splitText(h, { words: { wrap: 'clip' } }));
    animate(splits.get(h).words, { y: ['105%', '0%'], duration: 750, delay: stagger(45), ease: 'out(4)' });
    const eb = sec.querySelector('.eyebrow');
    if (eb) animate(eb, { innerHTML: scrambleText({ chars: 'A-Z0-9·', settleDuration: 240 }), duration: 650 });
  }

  // ------------------------------------------------------------------ the scroll timeline
  const TT = 10000;
  function timeAt(y) { const d = story.offsetHeight - innerHeight; return THREE.MathUtils.clamp(y / d * TT, 0, TT); }
  function win(i, a = 0, b = 1) {
    const top = secs[i].offsetTop;
    const s = timeAt(top - innerHeight * .8), e = timeAt(top);
    return [s + (e - s) * a, Math.max(1, (e - s) * (b - a))];
  }
  const tl = createTimeline({
    autoplay: onScroll({ target: story, enter: 'top top', leave: 'bottom bottom', sync: reduce ? true : .55 }),
    defaults: { ease: 'inOutCubic' },
  });
  const add = (targets, props, [t, d]) => tl.add(targets, { duration: d, ...props }, t);
  const byZ = [...comps].sort((a, b) => b.center.z - a.center.z).map((p) => p.s);
  const allS = parts.map((p) => p.s);
  const u1Pieces = [...byId.U1.pieces].sort((a, b) => a.center.z - b.center.z).map((pc) => pc.s);
  const sw2Pieces = byId.SW2.pieces.map((pc) => pc.s), r5Pieces = byId.R5.pieces.map((pc) => pc.s);

  // 01 enclosure: tilt to three-quarter, shells part
  add(rig, { el: 24, az: 32, dist: 300, ty: 6, heroW: 0, sx: .45, sy: 0 }, win(1));
  add(glow, { k: 0 }, win(1, 0, .5));
  add(enc, { up: 46, down: 40 }, win(1, .15, 1));
  // 02 assembly: paper, parts rise in a wave from the front edge
  add(look, { paper: 1, ease: 'inOutSine' }, win(2, 0, .55));
  add(enc, { up: 92, down: 56 }, win(2, .1, .9));
  { const [t, d] = win(2, .15, 1); tl.add(byZ, { lift: 1, duration: d * .55, delay: stagger(d * .45 / byZ.length), ease: 'inOutCubic' }, t); }
  add(rig, { el: 22, az: 40, dist: 370, ty: 22, roll: -.3, sx: .2 }, win(2));
  // 03 board stack: layers peel apart, camera drops to the board edge
  add(lay, { spread: 1 }, win(3, .1, 1));
  add(comp, { extra: 18 }, win(3, .1, 1));
  add(enc, { up: 112, down: 66 }, win(3, .1, 1));
  add(rig, { el: 10, az: 64, dist: 300, ty: 15, roll: 0, sx: .25 }, win(3));
  // 04 U1 comes apart
  add(allS, { dim: (s) => (s.id === 'U1' ? 0 : 1) }, win(4, 0, .4));
  add(rig, { fU1: 1, dist: 165, el: 30, az: 22, sx: .45 }, win(4));
  { const [t, d] = win(4, .25, 1); tl.add(u1Pieces, { k: 1, duration: d * .6, delay: stagger(d * .4 / u1Pieces.length), ease: 'inOutQuad' }, t); }
  // 05 SW2
  { const [t, d] = win(5, 0, .45); tl.add(u1Pieces, { k: 0, duration: d * .7, delay: stagger(d * .3 / u1Pieces.length, { reversed: true }), ease: 'inOutQuad' }, t); }
  add(allS, { dim: (s) => (s.id === 'SW2' ? 0 : 1) }, win(5, .2, .6));
  add(rig, { fU1: 0, fSW2: 1, dist: 150, el: 16, az: 36 }, win(5));
  { const [t, d] = win(5, .4, 1); tl.add(sw2Pieces, { k: 1, duration: d * .7, delay: stagger(d * .3 / 6), ease: 'inOutCubic' }, t); }
  // 06 R5
  add(sw2Pieces, { k: 0 }, win(6, 0, .4));
  add(allS, { dim: (s) => (s.id === 'R5' ? 0 : 1) }, win(6, .2, .6));
  add(rig, { fSW2: 0, fR5: 1, dist: 58, el: 14, az: 40, sx: .45 }, win(6));
  { const [t, d] = win(6, .45, 1); tl.add(r5Pieces, { k: 1, duration: d * .75, delay: stagger(d * .25 / 3), ease: 'inOutCubic' }, t); }
  add(dims, { o: 1 }, win(6, .8, 1));
  // 07 explore: everything back on show, still apart
  add(dims, { o: 0, duration: 1 }, win(7, 0, .1));
  add(r5Pieces, { k: 0 }, win(7, 0, .5));
  add(allS, { dim: 0 }, win(7, .2, .7));
  add(rig, { fR5: 0, dist: 340, el: 27, az: 36, ty: 18, roll: -.12, sx: 1 }, win(7));
  tl.add({ end: 0 }, { end: 1, duration: 1 }, TT - 1);  // pins the timeline length to the scroll length

  // ------------------------------------------------------------------ ambient motion (anime.js, not scroll)
  if (!reduce) {
    animate(ambient, { az: [-9, 9], duration: 7000, loop: true, alternate: true, ease: 'inOutSine' });
    animate(leds, { v: [.15, 1], duration: 1100, delay: stagger(220), loop: true, alternate: true, ease: 'inOutSine' });
    animate(glowFx, { wave: [-6, 84], duration: 2800, loop: true, ease: 'linear' });
    const twist = () => animate(knobs, {
      r: () => `+=${utils.random(-1.6, 1.6, 2)}`, duration: 1400, delay: stagger(180), ease: 'outElastic(1, .55)',
    });
    twist(); createTimer({ duration: 3200, loop: true, onLoop: twist });
  } else { leds.forEach((l) => (l.v = .8)); glowFx.wave = 30; }

  // ------------------------------------------------------------------ hero copy: rises in when it comes into view
  const heroCopy = $('.ch-hero .copy');
  const heroTitle = splitText('#hero-title', { words: { wrap: 'clip' } });
  if (!reduce && heroCopy.getBoundingClientRect().top > innerHeight) {
    const bits = [...heroCopy.children].filter((el) => el.tagName !== 'H1');
    utils.set(heroTitle.words, { y: '110%' }); utils.set(bits, { opacity: 0 });
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      animate(heroTitle.words, { y: ['110%', '0%'], duration: 1000, delay: stagger(70, { start: 150 }), ease: 'out(4)' });
      animate(bits, { opacity: [0, 1], y: [14, 0], duration: 800, delay: stagger(90, { start: 400 }), ease: 'out(3)' });
    }, { rootMargin: '0px 0px -20% 0px' });
    io.observe(heroCopy);
  }

  // ------------------------------------------------------------------ colourways
  for (const b of document.querySelectorAll('.td .sw')) b.addEventListener('click', () => {
    document.querySelectorAll('.td .sw').forEach((x) => x.setAttribute('aria-pressed', x === b));
    const to = COLOURWAYS[b.dataset.cw];
    animate(mats.enclosure.userData.base.color, { r: to.r, g: to.g, b: to.b, duration: 700, ease: 'inOutQuad', onUpdate: () => (lookDirty = true) });
  });
  $('#cta').addEventListener('click', () => secs[1].scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }));

  // ------------------------------------------------------------------ explore: parts list
  const totals = { parts: parts.length, pieces: 0, tris: 0 };
  for (const pd of M.parts) for (const pc of pd.pieces) { totals.pieces++; totals.tris += pc.tc; }
  $('#totals').textContent = `${totals.parts} parts · ${totals.pieces} pieces · ${totals.tris.toLocaleString('en-US')} triangles`;
  const GROUPS = [
    ['Custom knobs', ['K1', 'K2', 'K3']],
    ['Master cap', ['CAP'], { CAP: 'Cap' }],
    ['Enclosure', ['FRAME', 'TRAY'], { FRAME: 'Frame', TRAY: 'Tray' }],
    ['Board layers', ['SILK', 'MASK_T', 'CU', 'CORE', 'MASK_B'], { SILK: 'Silk', MASK_T: 'Top mask', CU: 'Copper', CORE: 'Core', MASK_B: 'Back mask' }],
    ['ESP32 DevKit V1', ['U1']],
    ['Rotary encoders', ['SW1', 'SW2', 'SW4']],
    ['Master button', ['SW3']],
    ['5 mm LEDs', ['D1', 'D2', 'D3', 'D4']],
    ['DIP-16 ICs', ['U2', 'U7']],
    ['Axial resistors', ['R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'R13', 'R14']],
  ];
  $('#bom').innerHTML = GROUPS.map(([name, ids, alias = {}]) => {
    const pieces = ids.reduce((n, id) => n + byId[id].pieces.length, 0);
    return `<li><span class="bom-name">${name}</span><span class="bom-qty">×${ids.length} · ${pieces} pc</span>
      <span class="chips">${ids.map((id) => `<button class="chip" type="button" data-part="${id}" aria-pressed="false">${alias[id] || id}</button>`).join('')}</span></li>`;
  }).join('');
  for (const b of document.querySelectorAll('.td .chip')) {
    b.addEventListener('click', () => openInspect(byId[b.dataset.part]));
    b.addEventListener('mouseenter', () => setHover(byId[b.dataset.part]));
    b.addEventListener('mouseleave', () => setHover(null));
  }
  onScroll({ target: '#bom', enter: 'bottom top', onEnter: () => {
    if (!reduce) animate('.td .chip', { opacity: [0, 1], y: [8, 0], duration: 500, delay: stagger(14), ease: 'out(3)' });
  } });

  // ------------------------------------------------------------------ hover, click, drag (only while the stage fills the screen)
  const tip = $('#tip');
  let hovered = null, inspected = null;
  function setHover(p) {
    if (hovered === p) return;
    if (hovered) { hovered.hover = false; }
    hovered = p;
    if (p) { p.hover = true; p.lineMat.color.copy(ACCENT); }
  }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const localRay = new THREE.Ray(), inv = new THREE.Matrix4(), pbox = new THREE.Box3(), hitP = v3();
  // one box per piece, moved to where that piece is now; the enclosure is hollow, so it gets a real raycast
  function pick(x, y) {
    const fr = frameEl.getBoundingClientRect();
    ndc.set((x - fr.left) / W * 2 - 1, -((y - fr.top) / H) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let best = null, bd = Infinity;
    for (const id of ['FRAME', 'TRAY']) {
      const p = byId[id]; if (p.ghost) continue;
      const hit = ray.intersectObjects(p.meshes, false)[0];
      if (hit && hit.distance < bd) { bd = hit.distance; best = p; }
    }
    for (const p of parts) {
      if (p.ghost || p.kind === 'enclosure') continue;
      inv.copy(p.g.matrixWorld).invert(); localRay.copy(ray.ray).applyMatrix4(inv);
      for (const pc of p.pieces) {
        if (pc.node) { pbox.min.copy(pc.min).add(pc.node.position).sub(pc.base); pbox.max.copy(pc.max).add(pc.node.position).sub(pc.base); }
        else { const off = p.offU.value[pc.idx]; pbox.min.copy(pc.min).add(off); pbox.max.copy(pc.max).add(off); }
        if (!localRay.intersectBox(pbox, hitP)) continue;
        const d = p.g.localToWorld(hitP).distanceTo(ray.ray.origin);
        if (d < bd) { bd = d; best = p; }
      }
    }
    return best;
  }
  const pinned = () => { const fr = frameEl.getBoundingClientRect(); return tdOn && fr.top <= 1 && fr.bottom >= innerHeight - 1; };
  const exploring = () => chapter === secs.length - 1 && pinned();
  const onUI = (t) => t.closest && t.closest('button, a, .copy, .inspect, .ticker');
  let lastMove = null, drag = null;
  addEventListener('pointermove', (e) => {
    lastMove = e;
    if (drag) { orbit.az(drag.az - (e.clientX - drag.x) * .35); orbit.el(THREE.MathUtils.clamp(drag.el + (e.clientY - drag.y) * .2, -25, 45)); }
  });
  const orbit = createAnimatable(user, { az: 600, el: 600, ease: 'out(3)' });
  addEventListener('pointerdown', (e) => {
    if (!exploring() || e.pointerType === 'touch' || onUI(e.target)) return;
    drag = { x: e.clientX, y: e.clientY, az: user.az, el: user.el, moved: false };
  });
  addEventListener('pointerup', (e) => {
    const wasDrag = drag && (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 5);
    drag = null;
    if (!exploring() || wasDrag || onUI(e.target)) return;
    const p = pick(e.clientX, e.clientY);
    if (p) openInspect(p); else closeInspect();
  });
  createTimer({ onUpdate: () => {
    if (!lastMove) return;
    const e = lastMove; lastMove = null;
    if (!exploring() || drag || onUI(e.target)) { if (!inspected) { tip.hidden = true; if (!e.target.closest?.('.chip')) setHover(null); } return; }
    const p = pick(e.clientX, e.clientY);
    setHover(p);
    tip.hidden = !p;
    if (p) {
      const fr = frameEl.getBoundingClientRect();
      tip.innerHTML = `<b>${refOf(p)}</b>${p.name}`; tip.style.left = (e.clientX - fr.left) + 'px'; tip.style.top = (e.clientY - fr.top) + 'px';
    }
  } });

  // ------------------------------------------------------------------ inspect: split one part
  const card = document.createElement('aside');
  card.className = 'inspect'; card.hidden = true; card.setAttribute('aria-live', 'polite');
  frameEl.append(card);
  function openInspect(p) {
    if (!p) return;
    if (inspected && inspected !== p) inspected.pieces.forEach((pc) => (pc.s.kI = 0));
    inspected = p; tip.hidden = true;
    document.querySelectorAll('.td .chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.part === p.id));
    const sz = p.size;
    card.innerHTML = `<p class="eyebrow">${refOf(p) ? refOf(p) + ' · ' : ''}${p.pieces.length} piece${p.pieces.length > 1 ? 's' : ''}</p>
      <h3>${p.name}</h3><p>${p.blurb}</p>
      <dl><dt>Envelope</dt><dd>${sz.z.toFixed(1)} × ${sz.x.toFixed(1)} × ${sz.y.toFixed(1)} mm</dd>
      <dt>Triangles</dt><dd>${M.parts.find((x) => x.id === p.id).pieces.reduce((n, pc) => n + pc.tc, 0).toLocaleString('en-US')}</dd></dl>
      <button type="button" id="insp-close">Back to the board</button>`;
    card.hidden = false;
    $('#insp-close').addEventListener('click', closeInspect);
    if (!reduce) animate(card, { opacity: [0, 1], y: [16, 0], duration: 450, ease: 'out(3)' });
    const c = p.g.localToWorld(p.center.clone());
    const big = Math.max(p.size.x, p.size.y, p.size.z);
    animate(insp, { x: c.x, y: c.y + big * .35, z: c.z, dist: THREE.MathUtils.clamp(big * 4.2 + 26, 40, 420), w: 1, duration: 1100, ease: 'inOutQuart' });
    animate(parts.map((q) => q.s), { dimI: (s) => (s.id === p.id ? 0 : 1), duration: 500, ease: 'out(2)' });
    animate(p.pieces.map((pc) => pc.s), { kI: 1, duration: 1200, delay: stagger(Math.min(40, 600 / p.pieces.length)), ease: spring({ bounce: .32, duration: 700 }) });
  }
  function closeInspect() {
    if (!inspected) return;
    const p = inspected; inspected = null;
    document.querySelectorAll('.td .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    animate(p.pieces.map((pc) => pc.s), { kI: 0, duration: 700, ease: 'inOutQuad' });
    animate(parts.map((q) => q.s), { dimI: 0, duration: 500, ease: 'out(2)' });
    animate(insp, { w: 0, duration: 900, ease: 'inOutQuart' });
    if (reduce) card.hidden = true;
    else animate(card, { opacity: 0, y: 12, duration: 250, ease: 'in(2)', onComplete: () => (card.hidden = true) });
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInspect(); });

  // ------------------------------------------------------------------ go: render only while the section is on screen
  new IntersectionObserver(([e]) => {
    tdOn = e.isIntersecting;
    if (tdOn) { lastT = performance.now(); fAcc = fN = 0; }
    else { closeInspect(); tip.hidden = true; }
  }).observe(td);
  tdOn = td.getBoundingClientRect().top < innerHeight && td.getBoundingClientRect().bottom > 0;
  createTimer({ onUpdate: frame });
  window.envoy = { tl, rig, parts: byId, look, renderer, scene, camera, frame, entry: () => entry };   // handy from the console
  applyLook(); frame();
  const loading = $('#loading');
  animate(loading, { opacity: 0, duration: reduce ? 0 : 600, delay: 100, ease: 'out(2)', onComplete: () => loading.remove() });
})();

// ---------------------------------------------------------------------------
// Starry night valley with a large vintage CRT monitor in the foreground.
// A simple shadow-rendering pass casts soft shadows from a moon light source.
// The whole scene is intentionally dark / moonlit.
//
// Performance: everything that never moves (sky, moon, hills, desk, monitor)
// is pre-rendered into offscreen layers in buildScene() and only redrawn on
// resize. Each frame just blits those layers and draws the animated parts
// (stars, shooting stars, trees, power LED) plus the vignette, in the same order.
// ---------------------------------------------------------------------------

let stars = [];
let shootingStars = [];
let trees = [];
let hills = [];

// Wind is mostly calm with occasional gusts.
let windStrength = 0;
let windTarget = 0;
let nextGust = 0;

let groundY;          // valley floor
let deskTopY;         // surface the monitor sits on

// Global light source (the moon, upper right). Shadows fall away from it.
const LIGHT = { x: 0, y: 0 };

let moonImg = null;

// Cached static layers (p5.Graphics), rebuilt on resize.
let skyLayer, hillLayer, fgLayer, vignetteLayer;
let ledPos = null;    // where drawControlPanel put the power LED

// Pre-computed canvas colors (match the p5 fill()/stroke() values exactly).
const STAR_RGB = 'rgb(235,240,255)';
const BRANCH_COL = { 5: 'rgb(11,16,10)', 2: 'rgb(24,34,20)' };  // depth -> color
const LEAF_SHADOW = 'rgba(4,14,13,' + (210 / 255) + ')';
const LEAF_BASE   = 'rgba(10,28,22,' + (220 / 255) + ')';
const LEAF_LIT    = 'rgba(26,52,40,' + (140 / 255) + ')';

function preload() {
  // Place your moon photo next to index.html as "moon.png".
  // (transparent PNG looks best). If missing, a plain disc is drawn instead.
  moonImg = loadImage('moon.png', () => {}, () => { moonImg = null; });
}

function setup() {
  const cnv = createCanvas(windowWidth, windowHeight);
  // p5 appends the canvas inside the page's <main> element. Move it to <body>
  // so the CRT content's glitch transform (on .site-wrap) can't shift the
  // fixed-position canvas out of alignment with the #crt-screen overlay.
  document.body.appendChild(cnv.elt);
  // Portfolio outro: render at 1x. The scene is dark and soft, and on a high-DPI screen
  // this cuts the pixels drawn every frame by 4x (the page itself stays sharp).
  pixelDensity(1);
  buildScene();
  // Portfolio outro: start paused (one still frame); the page says when to run.
  noLoop();
  redraw();
  window.addEventListener('message', (e) => {
    if (e.data === 'play') loop();
    else if (e.data === 'pause') noLoop();
  });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  buildScene();
}

function buildScene() {
  groundY = height * 0.78;
  deskTopY = height * 0.93;   // desk lowered to leave room for the stand
  LIGHT.x = width * 0.95;   // moon on the far right, clear of the wide monitor
  LIGHT.y = height * 0.12;  // high in the sky, above the wide monitor

  // Stars (dimmer for a darker scene).
  stars = [];
  const starCount = Math.floor((width * height) / 2400);
  for (let i = 0; i < starCount; i++) {
    stars.push({
      x: random(width),
      y: random(height * 0.6) * random(0.2, 1),
      size: random(0.6, 2.2),
      base: random(55, 125),
      phase: random(TWO_PI),
      speed: random(0.01, 0.05),
      glistenAt: random(900, 3000),
      glistenTimer: random(3000)
    });
  }

  // Darker layered hills.
  hills = [
    { y: groundY - 70, amp: 38, len: 0.0042, off: random(1000), col: [12, 17, 31] },
    { y: groundY - 30, amp: 30, len: 0.0060, off: random(1000), col: [8, 13, 25] },
    { y: groundY,      amp: 24, len: 0.0085, off: random(1000), col: [5, 9, 18] }
  ];

  // Trees pushed to the sides so the big monitor owns center stage
  // (portfolio outro: a little further out, the monitor is bigger now).
  trees = [];
  const treeCount = Math.max(5, Math.floor(width / 200));
  for (let i = 0; i < treeCount; i++) {
    let t = random(1) < 0.5
      ? random(0, width * 0.16)
      : random(width * 0.84, width);
    const scale = random(0.55, 1.05);
    trees.push(makeTree(t, groundY - random(2, 18), scale, random(1000)));
  }
  trees.sort((a, b) => a.scale - b.scale);

  buildLayers();
}

// Render all static scenery into offscreen layers once.
function buildLayers() {
  for (const l of [skyLayer, hillLayer, fgLayer, vignetteLayer]) if (l) l.remove();
  skyLayer = createGraphics(width, height);
  hillLayer = createGraphics(width, height);
  fgLayer = createGraphics(width, height);
  vignetteLayer = createGraphics(width, height);

  drawSky(skyLayer);
  drawHills(hillLayer);
  // Portfolio outro: the tree shadows never move, so they're baked into the hill layer.
  for (const tree of trees) castGroundShadow(hillLayer, tree.x, tree.baseY + 4, 70 * tree.scale, 70);
  // When drawn live, the desk/monitor gradient lines inherited the stroke
  // weight of the last tree branch; keep that so the case shading matches.
  fgLayer.strokeWeight(Math.max(1, 1.4 * trees[trees.length - 1].scale));
  drawDesk(fgLayer);
  drawMonitor(fgLayer);
  // Portfolio outro: the vignette is 60 translucent full-screen strokes. Stacking them on a
  // transparent layer once and blitting it gives the same result as drawing them every frame.
  drawVignette(vignetteLayer);
  buildTreeSprites();
}

// Portfolio outro: each tree is painted once into its own small canvas. Every frame it's drawn
// as one image, leaned by the wind with a shear about its base, instead of ~1,000 needle clusters.
function buildTreeSprites() {
  for (const tree of trees) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const br of tree.branches) {
      x0 = Math.min(x0, br.x0, br.x1) - br.lw; x1 = Math.max(x1, br.x0, br.x1) + br.lw;
      y0 = Math.min(y0, br.y0, br.y1) - br.lw; y1 = Math.max(y1, br.y0, br.y1) + br.lw;
    }
    for (const lf of tree.leaves) {
      x0 = Math.min(x0, lf.x - lf.r); x1 = Math.max(x1, lf.x + lf.r + 2);
      y0 = Math.min(y0, lf.y - lf.r); y1 = Math.max(y1, lf.y + lf.r + 2);
    }
    x0 = Math.floor(x0 - 4); y0 = Math.floor(y0 - 4);
    const c = document.createElement('canvas');
    c.width = Math.ceil(x1 + 4 - x0); c.height = Math.ceil(y1 + 4 - y0);
    const ctx = c.getContext('2d');
    ctx.translate(-x0, -y0);
    paintTree(ctx, tree, 0);
    tree.sprite = { c, x: x0, y: y0 };
  }
}

// Conical evergreen (pine/spruce) with dense, drooping needle foliage.
function makeTree(x, baseY, scale, seed) {
  const tree = { x, baseY, scale, seed, swayPhase: random(TWO_PI), branches: [], leaves: [] };
  randomSeed(seed);

  const Htot = 165 * scale;
  const tiers = 20;

  // trunk
  let prevX = x, prevY = baseY;
  for (let i = 1; i <= tiers; i++) {
    const ty = baseY - Htot * (i / tiers);
    tree.branches.push({ x0: prevX, y0: prevY, x1: x, y1: ty,
      weight: (1 - i / tiers) * 6 * scale + 1, flex: (i / tiers) * 0.6, depth: 5 });
    prevX = x; prevY = ty;
  }

  // foliage tiers: a cone, widest at the bottom, branches droop outward/down
  for (let i = 0; i < tiers; i++) {
    const frac = i / tiers;                 // 0 top .. ~1 bottom
    const ty = baseY - Htot * (1 - frac);
    const halfW = (6 + frac * 64) * scale;
    const droop = halfW * 0.5;
    const branchesPerTier = 3 + Math.floor(frac * 4);
    for (let b = 0; b < branchesPerTier; b++) {
      const side = (b % 2 === 0) ? -1 : 1;
      const spread = random(0.45, 1.05);
      const tipX = x + side * halfW * spread;
      const tipY = ty + droop * random(0.6, 1.15);
      tree.branches.push({ x0: x, y0: ty, x1: tipX, y1: tipY,
        weight: 1.4 * scale, flex: 0.5 + frac * 0.8, depth: 2 });
      // dense needle clusters along the branch
      const clusters = 6 + Math.floor(frac * 7);
      for (let k = 0; k <= clusters; k++) {
        const t = k / clusters;
        const lx = lerp(x, tipX, t) + random(-5, 5) * scale;
        const ly = lerp(ty, tipY, t) + random(-4, 4) * scale;
        tree.leaves.push({ x: lx, y: ly, r: random(4, 9) * scale,
          flex: (0.35 + frac) * (0.5 + t) });
      }
    }
  }
  randomSeed();

  // Pre-compute the per-element sway factor (height above base * flex * 14 / 120)
  // so drawing only needs one multiply by the tree's current sway.
  for (const br of tree.branches) {
    br.k0 = (baseY - br.y0) / 120 * 14 * br.flex;
    br.k1 = (baseY - br.y1) / 120 * 14 * br.flex;
    br.col = BRANCH_COL[br.depth];
    br.lw = Math.max(1, br.weight);
  }
  for (const lf of tree.leaves) lf.k = (baseY - lf.y) / 120 * 14 * lf.flex;
  return tree;
}

function draw() {
  image(skyLayer, 0, 0, width, height);
  drawStars();
  updateShootingStars();
  updateWind();
  image(hillLayer, 0, 0, width, height);
  drawTrees();
  image(fgLayer, 0, 0, width, height);
  drawPowerLED();
  image(vignetteLayer, 0, 0, width, height);   // pre-stacked in buildLayers()
}

// =====================  SHADOW RENDERING SYSTEM  ===========================
// Soft ground shadow projected away from the moon light. Objects call this
// with their footprint; direction/length derive from the light position.
// `g` is the render target: a p5.Graphics layer, or `window` for the main canvas.
function castGroundShadow(g, x, y, w, strength) {
  const dx = x - LIGHT.x;
  const dy = (y - LIGHT.y);
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ox = (dx / len) * w * 0.5;   // horizontal lean of the shadow
  g.push();
  g.noStroke();
  // stack a few translucent ellipses for a soft penumbra
  for (let i = 4; i >= 1; i--) {
    g.fill(0, 0, 0, strength * (i / 4) * 0.5);
    g.ellipse(x + ox * 0.4, y, w * (1.1 - i * 0.12) + ox, (w * 0.12) * i / 2);
  }
  g.pop();
}

// =====================  SKY  ===============================================
function drawSky(g) {
  for (let y = 0; y < groundY; y++) {
    const t = y / groundY;
    g.stroke(lerp(2, 7, t), lerp(3, 9, t), lerp(8, 20, t));
    g.line(0, y, width, y);
  }
  // moon image (no glow rings)
  const moonD = 120;
  if (moonImg) {
    g.imageMode(CENTER);
    g.tint(205, 208, 218);   // realistic moon photo, only lightly dimmed
    g.image(moonImg, LIGHT.x, LIGHT.y, moonD, moonD);
    g.noTint();
    g.imageMode(CORNER);
  } else {
    g.noStroke();
    g.fill(155, 161, 182);
    g.circle(LIGHT.x, LIGHT.y, moonD * 0.8);
  }
}

// =====================  STARS  =============================================
function drawStars() {
  const ctx = drawingContext;
  ctx.save();
  ctx.fillStyle = STAR_RGB;
  ctx.strokeStyle = STAR_RGB;
  ctx.lineWidth = 0.8;
  for (const s of stars) {
    s.phase += s.speed;
    const tw = (Math.sin(s.phase) * 0.5 + 0.5);
    s.glistenTimer++;
    let flare = 0;
    if (s.glistenTimer > s.glistenAt) {
      const f = s.glistenTimer - s.glistenAt;
      if (f < 30) flare = Math.sin((f / 30) * PI);
      else { s.glistenTimer = 0; s.glistenAt = random(1500, 4500); }
    }
    const bright = s.base * (0.4 + 0.6 * tw) + flare * 110;
    ctx.globalAlpha = Math.min(230, bright) / 255;
    // a 1–2 px square reads the same as a circle at this size, and is much cheaper to fill
    ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
    if (flare > 0.15) {
      ctx.globalAlpha = Math.min(255, flare * 180) / 255;
      const len = s.size + flare * 7;
      ctx.beginPath();
      ctx.moveTo(s.x - len, s.y); ctx.lineTo(s.x + len, s.y);
      ctx.moveTo(s.x, s.y - len); ctx.lineTo(s.x, s.y + len);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// =====================  SHOOTING STARS  ====================================
function updateShootingStars() {
  if (random(1) < 0.006 && shootingStars.length < 3) {
    shootingStars.push({
      x: random(width * 0.2, width),
      y: random(height * 0.05, height * 0.38),
      vx: random(-9, -5), vy: random(2, 4),
      life: 0, maxLife: random(40, 70), len: random(80, 160)
    });
  }
  for (let i = shootingStars.length - 1; i >= 0; i--) {
    const ss = shootingStars[i];
    ss.x += ss.vx; ss.y += ss.vy; ss.life++;
    const fade = 1 - ss.life / ss.maxLife;
    const tailX = ss.x - ss.vx * (ss.len / 9);
    const tailY = ss.y - ss.vy * (ss.len / 9);
    for (let t = 0; t < 1; t += 0.08) {
      stroke(235, 240, 255, 200 * fade * (1 - t));
      strokeWeight((1 - t) * 2.2);
      point(lerp(ss.x, tailX, t), lerp(ss.y, tailY, t));
    }
    noStroke();
    fill(235, 240, 255, 220 * fade);
    circle(ss.x, ss.y, 2.2);
    if (ss.life >= ss.maxLife || ss.x < -ss.len) shootingStars.splice(i, 1);
  }
}

// =====================  WIND  ==============================================
function updateWind() {
  if (frameCount > nextGust) {
    windTarget = random(1) < 0.6
      ? random(0.4, 1.4) * (random(1) < 0.5 ? -1 : 1)
      : random(-0.2, 0.2);
    nextGust = frameCount + Math.floor(random(120, 360));
  }
  windStrength += (windTarget - windStrength) * 0.02;
}
function swayAmount(phase, flex) {
  const breeze = Math.sin(frameCount * 0.02 + phase) * 0.4;
  return (windStrength + breeze) * flex;
}

// =====================  HILLS  =============================================
function drawHills(g) {
  g.noStroke();
  for (const h of hills) {
    g.fill(h.col[0], h.col[1], h.col[2]);
    g.beginShape();
    g.vertex(0, height);
    for (let x = 0; x <= width; x += 12) {
      const y = h.y + Math.sin(x * h.len + h.off) * h.amp
                    + Math.sin(x * h.len * 2.3 + h.off) * h.amp * 0.3;
      g.vertex(x, y);
    }
    g.vertex(width, height);
    g.endShape(CLOSE);
  }
}

// =====================  TREES  =============================================
// Portfolio outro: each tree is one pre-rendered image (see buildTreeSprites), leaned by the
// wind with a shear about its base: the top moves most, like the per-needle sway it replaces.
// Its ground shadow is baked into the hill layer.
function drawTrees() {
  const ctx = drawingContext;
  for (const tree of trees) {
    const shear = swayAmount(tree.swayPhase, 1) * (14 / 120) * 0.85;
    const s = tree.sprite;
    ctx.save();
    ctx.transform(1, 0, -shear, 1, shear * tree.baseY, 0);   // x' = x + shear * (baseY - y)
    ctx.drawImage(s.c, s.x, s.y);
    ctx.restore();
  }
}

// Paints one tree into any 2D context, in the same order and colors as the original:
// branches, then each leaf's shadow/base/lit disc.
function paintTree(ctx, tree, sway) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const br of tree.branches) {
    ctx.strokeStyle = br.col;
    ctx.lineWidth = br.lw;
    ctx.beginPath();
    ctx.moveTo(br.x0 + sway * br.k0, br.y0);
    ctx.lineTo(br.x1 + sway * br.k1, br.y1);
    ctx.stroke();
  }
  for (const lf of tree.leaves) {
    const x = lf.x + sway * lf.k, y = lf.y, r = lf.r;
    // dark evergreen occlusion / shadow side
    ctx.fillStyle = LEAF_SHADOW;
    ctx.beginPath(); ctx.arc(x + 1.5, y + 1.5, r * 0.55, 0, TWO_PI); ctx.fill();
    // base needle color (deep blue-green)
    ctx.fillStyle = LEAF_BASE;
    ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, TWO_PI); ctx.fill();
    // moonlit side faces the light (upper right)
    ctx.fillStyle = LEAF_LIT;
    ctx.beginPath(); ctx.arc(x + r * 0.2, y - r * 0.2, r * 0.25, 0, TWO_PI); ctx.fill();
  }
  ctx.restore();
}

// =====================  DESK  ==============================================
function drawDesk(g) {
  const deskH = height - deskTopY;
  for (let y = 0; y < deskH; y++) {
    const t = y / deskH;
    g.stroke(lerp(13, 5, t), lerp(8, 3, t), lerp(5, 2, t)); // darker wood
    g.line(0, deskTopY + y, width, deskTopY + y);
  }
  g.noStroke();
  g.fill(60, 40, 24, 90);
  g.rect(0, deskTopY, width, 3);
}

// =====================  VINTAGE CRT MONITOR  ===============================
function drawMonitor(g) {
  // full-size monitor; its base is lifted just off the desk by the stand.
  // Portfolio outro: the screen keeps the window's aspect ratio, so the page can
  // zoom straight out of it (the screen is sW = W * 0.96 by sH = H * 0.82, below).
  const sHt = height * 0.6;    // bigger PC: the screen is 60% of the window's height
  const W = (sHt * (width / height)) / 0.96;
  const H = sHt / 0.82;
  const cx = width / 2;
  const bodyBottom = deskTopY - H * 0.06; // lifted off the desk by the stand
  const bodyTop = bodyBottom - H;
  const r = Math.min(W, H) * 0.03;  // less rounded corners

  // ---- cast shadow on the desk (from the stand base) ----
  castGroundShadow(g, cx, deskTopY + 4, W * 0.7, 150);
  g.push();
  g.drawingContext.save();
  g.drawingContext.filter = 'blur(10px)';
  g.noStroke();
  g.fill(0, 0, 0, 120);
  const sdx = (cx - LIGHT.x) > 0 ? 18 : -18;
  g.rect(cx - W / 2 + sdx, bodyTop + 14, W, H, r);
  g.drawingContext.restore();
  g.pop();

  // ---- stand (base plate on the desk + neck up to the monitor) ----
  drawMonitorStand(g, cx, W, bodyBottom, deskTopY);

  // ---- body (moonlit beige with light from upper-right) ----
  // base/foot
  g.noStroke();
  g.fill(58, 54, 44);
  g.rect(cx - W * 0.34, bodyBottom - 4, W * 0.68, 16, 6);
  g.fill(78, 73, 60);
  g.rect(cx - W * 0.34, bodyBottom - 6, W * 0.68, 6, 4);

  // main case as a horizontal gradient (lit right -> shadow left)
  for (let i = 0; i <= W; i += 2) {
    const t = i / W;                 // 0 left .. 1 right
    const lit = 1 - Math.abs(t - 0.78);
    const c = lerp(22, 68, constrain(lit, 0, 1));
    g.stroke(c, c * 0.95, c * 0.82);
    // approximate rounded body by clipping top/bottom corners
    let yTop = bodyTop, yBot = bodyBottom;
    const edge = Math.min(i, W - i);
    if (edge < r) {
      const dy = r - Math.sqrt(Math.max(0, r * r - (r - edge) * (r - edge)));
      yTop += dy; yBot -= dy;
    }
    g.line(cx - W / 2 + i, yTop, cx - W / 2 + i, yBot);
  }

  // soft top highlight + bottom shadow on the case for volume
  g.noStroke();
  g.fill(255, 252, 235, 22);
  g.rect(cx - W / 2 + r * 0.4, bodyTop + 3, W - r * 0.8, 10, 5);
  g.fill(0, 0, 0, 60);
  g.rect(cx - W / 2 + r * 0.4, bodyBottom - 14, W - r * 0.8, 12, 5);

  // ---- screen recess (thin beveled frame, large screen) ----
  const sMargX = W * 0.02;   // thinner side bezel
  const sTop = bodyTop + H * 0.025;  // thinner top bezel
  const sLeft = cx - W / 2 + sMargX;
  const sW = W - sMargX * 2;
  const sH = H * 0.82;   // taller screen; shorter control panel below
  const sr = W * 0.018;  // less rounded screen corners

  // outer bevel groove (darker beige) with inset shadow
  g.fill(40, 37, 30);
  g.rect(sLeft - 5, sTop - 5, sW + 10, sH + 10, sr + 3);
  g.fill(96, 90, 74);
  g.rect(sLeft - 3, sTop - 3, sW + 6, sH + 6, sr + 2);
  g.fill(28, 26, 21);
  g.rect(sLeft - 1.5, sTop - 1.5, sW + 3, sH + 3, sr + 1);

  drawCRTScreen(g, sLeft, sTop, sW, sH, sr);

  // ---- control panel (below screen) ----
  drawControlPanel(g, cx, bodyTop, W, H, sTop + sH);
}

// Stand that physically sits the monitor on the desk: an oval base plate
// resting on the table and a tapered neck rising to the monitor's foot.
function drawMonitorStand(g, cx, W, bodyBottom, deskY) {
  g.noStroke();

  // contact shadow of the base on the desk
  g.fill(0, 0, 0, 90);
  g.ellipse(cx, deskY + 6, W * 0.34, 16);

  // base plate (dark, lit slightly on the upper-right rim)
  g.fill(16, 15, 12);
  g.ellipse(cx, deskY + 2, W * 0.30, 20);
  g.fill(34, 31, 25);
  g.ellipse(cx, deskY - 1, W * 0.27, 16);
  g.fill(70, 65, 53, 120);
  g.ellipse(cx + W * 0.02, deskY - 3, W * 0.18, 8);

  // neck/column: a horizontal gradient so it catches the moonlight (right side)
  const neckW = W * 0.14;
  const neckTop = bodyBottom + 4;       // tucks just under the monitor foot
  for (let i = 0; i <= neckW; i += 2) {
    const t = i / neckW;
    const lit = 1 - Math.abs(t - 0.74);
    const c = lerp(18, 64, constrain(lit, 0, 1));
    g.stroke(c, c * 0.95, c * 0.82);
    g.line(cx - neckW / 2 + i, neckTop, cx - neckW / 2 + i, deskY - 2);
  }
  g.noStroke();
}

function drawCRTScreen(g, x, y, w, h, r) {
  // Expose the screen rectangle so a real website (e.g. an <iframe>) can be
  // positioned exactly over it: window.crtScreen = { x, y, w, h, r }.
  window.crtScreen = { x, y, w, h, r };
  // tell the portfolio page where the screen is, so it can line its content up with it
  if (window.parent !== window) window.parent.postMessage({ type: 'crt', x, y, w, h, r, W: width, H: height }, '*');

  // Completely blank black screen (the HTML overlay sits on top of this).
  g.push();
  g.noStroke();
  g.fill(0);
  g.rect(x, y, w, h, r);
  g.pop();

  // keep the website overlay aligned to the screen (only changes on resize)
  syncCRTOverlay(x, y, w, h, r);
}

// Position the #crt-screen HTML element exactly over the canvas screen.
function syncCRTOverlay(x, y, w, h, r) {
  const el = document.getElementById('crt-screen');
  if (!el) return;
  el.style.display = 'block';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.style.borderRadius = r + 'px';
}

function drawControlPanel(g, cx, bodyTop, W, H, panelTop) {
  const left = cx - W / 2;
  const py = panelTop + H * 0.04;
  const ph = (bodyTop + H) - py - H * 0.05;

  // recessed panel strip
  g.noStroke();
  g.fill(0, 0, 0, 50);
  g.rect(left + W * 0.08, py - 4, W * 0.84, ph + 8, 8);

  // --- left: ventilation grille (thin horizontal slots) ---
  const gx = left + W * 0.11;
  const gw = W * 0.22;
  const rows = 7;
  for (let i = 0; i < rows; i++) {
    const yy = py + 6 + i * (ph - 10) / rows;
    g.stroke(30, 28, 22);
    g.strokeWeight(2);
    g.line(gx, yy, gx + gw, yy);
    g.stroke(150, 144, 124, 90); // tiny highlight under each slot
    g.strokeWeight(1);
    g.line(gx, yy + 1.5, gx + gw, yy + 1.5);
  }

  // --- center: long thin disk/insert slot ---
  g.noStroke();
  const slotX = left + W * 0.40;
  const slotW = W * 0.30;
  const slotY = py + ph * 0.5;
  g.fill(18, 16, 13);
  g.rect(slotX, slotY - 5, slotW, 10, 4);
  g.fill(150, 144, 124, 120);
  g.rect(slotX, slotY + 4, slotW, 1.5);     // bottom lip highlight
  // little label notches above the slot
  g.fill(40, 37, 30);
  g.rect(slotX + slotW * 0.1, slotY - 16, slotW * 0.5, 3, 2);

  // tiny labels (the little marks near the bottom of the real unit)
  g.noStroke();
  g.fill(45, 42, 34);
  g.textSize(Math.max(6, W * 0.012));
  g.textAlign(LEFT, CENTER);
  g.text("•  ——  ▪  ▪▪  ——", slotX + slotW * 0.05, py + 6);

  // --- right: indicator LED (animated, drawn each frame by drawPowerLED) ---
  ledPos = { x: left + W * 0.80, y: slotY };

  // square power button (raised, beveled)
  const btn = W * 0.05;
  const btnX = left + W * 0.86;
  g.fill(36, 33, 27);
  g.rect(btnX - 2, slotY - btn / 2 - 2, btn + 4, btn + 4, 4);
  // lit top-right, shadow bottom-left
  g.fill(150, 144, 124);
  g.rect(btnX, slotY - btn / 2, btn, btn, 3);
  g.fill(90, 85, 70);
  g.triangle(btnX, slotY + btn / 2, btnX + btn, slotY + btn / 2, btnX + btn, slotY - btn / 2);
}

// dim power LED (faint glow) — the only animated part of the monitor
function drawPowerLED() {
  if (!ledPos) return;
  const pulse = 0.5 + 0.5 * Math.sin(frameCount * 0.05);
  noStroke();
  fill(40, 90, 60, 120 + pulse * 60);
  circle(ledPos.x, ledPos.y, 7);
  fill(120, 220, 150, 80 + pulse * 80);
  circle(ledPos.x, ledPos.y, 3.5);
}

// =====================  GLOBAL VIGNETTE (darkness)  ========================
function drawVignette(g) {
  g.push();
  g.noFill();
  for (let i = 0; i < 60; i++) {
    g.stroke(0, 0, 0, 3.6);
    g.strokeWeight(i * 3);
    g.rect(0, 0, width, height);
  }
  g.pop();
}

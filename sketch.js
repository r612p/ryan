// ---------------------------------------------------------------------------
// Starry night valley with a large vintage CRT monitor in the foreground.
// A simple shadow-rendering pass casts soft shadows from a moon light source.
// The whole scene is intentionally dark / moonlit.
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
  buildScene();
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

  // Trees pushed to the sides so the big monitor owns center stage.
  trees = [];
  const treeCount = Math.max(5, Math.floor(width / 200));
  for (let i = 0; i < treeCount; i++) {
    let t = random(1) < 0.5
      ? random(0, width * 0.22)
      : random(width * 0.78, width);
    const scale = random(0.55, 1.05);
    trees.push(makeTree(t, groundY - random(2, 18), scale, random(1000)));
  }
  trees.sort((a, b) => a.scale - b.scale);
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
  return tree;
}

function draw() {
  drawSky();
  drawStars();
  updateShootingStars();
  updateWind();
  drawHills();
  drawTrees();
  drawDesk();
  drawMonitor();
  drawVignette();
}

// =====================  SHADOW RENDERING SYSTEM  ===========================
// Soft ground shadow projected away from the moon light. Objects call this
// with their footprint; direction/length derive from the light position.
function castGroundShadow(x, y, w, strength) {
  const dx = x - LIGHT.x;
  const dy = (y - LIGHT.y);
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ox = (dx / len) * w * 0.5;   // horizontal lean of the shadow
  push();
  noStroke();
  // stack a few translucent ellipses for a soft penumbra
  for (let i = 4; i >= 1; i--) {
    fill(0, 0, 0, strength * (i / 4) * 0.5);
    ellipse(x + ox * 0.4, y, w * (1.1 - i * 0.12) + ox, (w * 0.12) * i / 2);
  }
  pop();
}

// Offset silhouette shadow cast onto a vertical-ish surface behind an object.
function castDropShadow(drawFn, ox, oy, alpha) {
  push();
  drawingContext.save();
  drawingContext.filter = 'blur(6px)';
  translate(ox, oy);
  // tint everything black by drawing into a low-alpha black overlay shape
  drawFn(alpha);
  drawingContext.restore();
  pop();
}

// =====================  SKY  ===============================================
function drawSky() {
  for (let y = 0; y < groundY; y++) {
    const t = y / groundY;
    stroke(lerp(2, 7, t), lerp(3, 9, t), lerp(8, 20, t));
    line(0, y, width, y);
  }
  // moon image (no glow rings)
  const moonD = 120;
  if (moonImg) {
    imageMode(CENTER);
    tint(205, 208, 218);   // realistic moon photo, only lightly dimmed
    image(moonImg, LIGHT.x, LIGHT.y, moonD, moonD);
    noTint();
    imageMode(CORNER);
  } else {
    noStroke();
    fill(155, 161, 182);
    circle(LIGHT.x, LIGHT.y, moonD * 0.8);
  }
}

// =====================  STARS  =============================================
function drawStars() {
  noStroke();
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
    fill(235, 240, 255, Math.min(230, bright));
    circle(s.x, s.y, s.size);
    if (flare > 0.15) {
      const a = flare * 180;
      stroke(235, 240, 255, a);
      const len = s.size + flare * 7;
      strokeWeight(0.8);
      line(s.x - len, s.y, s.x + len, s.y);
      line(s.x, s.y - len, s.x, s.y + len);
      noStroke();
    }
  }
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
function drawHills() {
  noStroke();
  for (const h of hills) {
    fill(h.col[0], h.col[1], h.col[2]);
    beginShape();
    vertex(0, height);
    for (let x = 0; x <= width; x += 12) {
      const y = h.y + Math.sin(x * h.len + h.off) * h.amp
                    + Math.sin(x * h.len * 2.3 + h.off) * h.amp * 0.3;
      vertex(x, y);
    }
    vertex(width, height);
    endShape(CLOSE);
  }
}

// =====================  TREES  =============================================
function drawTrees() {
  for (const tree of trees) {
    // ground shadow first
    castGroundShadow(tree.x, tree.baseY + 4, 70 * tree.scale, 70);
    drawTree(tree);
  }
}

function drawTree(tree) {
  for (const br of tree.branches) {
    const hf0 = (tree.baseY - br.y0) / 120;
    const hf1 = (tree.baseY - br.y1) / 120;
    const sway = swayAmount(tree.swayPhase, 1);
    const dx0 = sway * hf0 * 14 * br.flex;
    const dx1 = sway * hf1 * 14 * br.flex;
    const shade = map(br.depth, 0, 5, 46, 16); // darker
    stroke(shade * 0.7, shade, shade * 0.6);
    strokeCap(ROUND);
    strokeWeight(Math.max(1, br.weight));
    line(br.x0 + dx0, br.y0, br.x1 + dx1, br.y1);
  }
  noStroke();
  for (const lf of tree.leaves) {
    const hf = (tree.baseY - lf.y) / 120;
    const sway = swayAmount(tree.swayPhase, 1);
    const dx = sway * hf * 14 * lf.flex;
    const x = lf.x + dx, y = lf.y;
    // dark evergreen occlusion / shadow side
    fill(4, 14, 13, 210);
    circle(x + 1.5, y + 1.5, lf.r * 1.1);
    // base needle color (deep blue-green)
    fill(10, 28, 22, 220);
    circle(x, y, lf.r);
    // moonlit side faces the light (upper right)
    fill(26, 52, 40, 140);
    circle(x + lf.r * 0.2, y - lf.r * 0.2, lf.r * 0.5);
  }
}

// =====================  DESK  ==============================================
function drawDesk() {
  const deskH = height - deskTopY;
  for (let y = 0; y < deskH; y++) {
    const t = y / deskH;
    stroke(lerp(13, 5, t), lerp(8, 3, t), lerp(5, 2, t)); // darker wood
    line(0, deskTopY + y, width, deskTopY + y);
  }
  noStroke();
  fill(60, 40, 24, 90);
  rect(0, deskTopY, width, 3);
}

// =====================  VINTAGE CRT MONITOR  ===============================
function drawMonitor() {
  // full-size monitor; its base is lifted just off the desk by the stand
  // wide CRT, sized to fill most of the screen width
  const W = width * 0.80;
  const H = Math.min(height * 0.84, W * 0.5);
  const cx = width / 2;
  const bodyBottom = deskTopY - H * 0.06; // lifted off the desk by the stand
  const bodyTop = bodyBottom - H;
  const r = Math.min(W, H) * 0.03;  // less rounded corners

  // ---- cast shadow on the desk (from the stand base) ----
  castGroundShadow(cx, deskTopY + 4, W * 0.7, 150);
  push();
  drawingContext.save();
  drawingContext.filter = 'blur(10px)';
  noStroke();
  fill(0, 0, 0, 120);
  const sdx = (cx - LIGHT.x) > 0 ? 18 : -18;
  rect(cx - W / 2 + sdx, bodyTop + 14, W, H, r);
  drawingContext.restore();
  pop();

  // ---- stand (base plate on the desk + neck up to the monitor) ----
  drawMonitorStand(cx, W, bodyBottom, deskTopY);

  // ---- body (moonlit beige with light from upper-right) ----
  // base/foot
  noStroke();
  fill(58, 54, 44);
  rect(cx - W * 0.34, bodyBottom - 4, W * 0.68, 16, 6);
  fill(78, 73, 60);
  rect(cx - W * 0.34, bodyBottom - 6, W * 0.68, 6, 4);

  // main case as a horizontal gradient (lit right -> shadow left)
  for (let i = 0; i <= W; i += 2) {
    const t = i / W;                 // 0 left .. 1 right
    const lit = 1 - Math.abs(t - 0.78);
    const c = lerp(22, 68, constrain(lit, 0, 1));
    stroke(c, c * 0.95, c * 0.82);
    // approximate rounded body by clipping top/bottom corners
    let yTop = bodyTop, yBot = bodyBottom;
    const edge = Math.min(i, W - i);
    if (edge < r) {
      const dy = r - Math.sqrt(Math.max(0, r * r - (r - edge) * (r - edge)));
      yTop += dy; yBot -= dy;
    }
    line(cx - W / 2 + i, yTop, cx - W / 2 + i, yBot);
  }

  // soft top highlight + bottom shadow on the case for volume
  noStroke();
  fill(255, 252, 235, 22);
  rect(cx - W / 2 + r * 0.4, bodyTop + 3, W - r * 0.8, 10, 5);
  fill(0, 0, 0, 60);
  rect(cx - W / 2 + r * 0.4, bodyBottom - 14, W - r * 0.8, 12, 5);

  // ---- screen recess (thin beveled frame, large screen) ----
  const sMargX = W * 0.02;   // thinner side bezel
  const sTop = bodyTop + H * 0.025;  // thinner top bezel
  const sLeft = cx - W / 2 + sMargX;
  const sW = W - sMargX * 2;
  const sH = H * 0.82;   // taller screen; shorter control panel below
  const sr = W * 0.018;  // less rounded screen corners

  // outer bevel groove (darker beige) with inset shadow
  fill(40, 37, 30);
  rect(sLeft - 5, sTop - 5, sW + 10, sH + 10, sr + 3);
  fill(96, 90, 74);
  rect(sLeft - 3, sTop - 3, sW + 6, sH + 6, sr + 2);
  fill(28, 26, 21);
  rect(sLeft - 1.5, sTop - 1.5, sW + 3, sH + 3, sr + 1);

  drawCRTScreen(sLeft, sTop, sW, sH, sr);

  // ---- control panel (below screen) ----
  drawControlPanel(cx, bodyTop, W, H, sTop + sH);
}

// Stand that physically sits the monitor on the desk: an oval base plate
// resting on the table and a tapered neck rising to the monitor's foot.
function drawMonitorStand(cx, W, bodyBottom, deskY) {
  noStroke();

  // contact shadow of the base on the desk
  fill(0, 0, 0, 90);
  ellipse(cx, deskY + 6, W * 0.34, 16);

  // base plate (dark, lit slightly on the upper-right rim)
  fill(16, 15, 12);
  ellipse(cx, deskY + 2, W * 0.30, 20);
  fill(34, 31, 25);
  ellipse(cx, deskY - 1, W * 0.27, 16);
  fill(70, 65, 53, 120);
  ellipse(cx + W * 0.02, deskY - 3, W * 0.18, 8);

  // neck/column: a horizontal gradient so it catches the moonlight (right side)
  const neckW = W * 0.14;
  const neckTop = bodyBottom + 4;       // tucks just under the monitor foot
  for (let i = 0; i <= neckW; i += 2) {
    const t = i / neckW;
    const lit = 1 - Math.abs(t - 0.74);
    const c = lerp(18, 64, constrain(lit, 0, 1));
    stroke(c, c * 0.95, c * 0.82);
    line(cx - neckW / 2 + i, neckTop, cx - neckW / 2 + i, deskY - 2);
  }
  noStroke();
}

function drawCRTScreen(x, y, w, h, r) {
  // Expose the screen rectangle so a real website (e.g. an <iframe>) can be
  // positioned exactly over it: window.crtScreen = { x, y, w, h, r }.
  window.crtScreen = { x, y, w, h, r };

  // Completely blank black screen (the HTML overlay sits on top of this).
  push();
  noStroke();
  fill(0);
  rect(x, y, w, h, r);
  pop();

  // keep the website overlay aligned to the screen
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

function drawControlPanel(cx, bodyTop, W, H, panelTop) {
  const left = cx - W / 2;
  const py = panelTop + H * 0.04;
  const ph = (bodyTop + H) - py - H * 0.05;

  // recessed panel strip
  noStroke();
  fill(0, 0, 0, 50);
  rect(left + W * 0.08, py - 4, W * 0.84, ph + 8, 8);

  // --- left: ventilation grille (thin horizontal slots) ---
  const gx = left + W * 0.11;
  const gw = W * 0.22;
  const rows = 7;
  for (let i = 0; i < rows; i++) {
    const yy = py + 6 + i * (ph - 10) / rows;
    stroke(30, 28, 22);
    strokeWeight(2);
    line(gx, yy, gx + gw, yy);
    stroke(150, 144, 124, 90); // tiny highlight under each slot
    strokeWeight(1);
    line(gx, yy + 1.5, gx + gw, yy + 1.5);
  }

  // --- center: long thin disk/insert slot ---
  noStroke();
  const slotX = left + W * 0.40;
  const slotW = W * 0.30;
  const slotY = py + ph * 0.5;
  fill(18, 16, 13);
  rect(slotX, slotY - 5, slotW, 10, 4);
  fill(150, 144, 124, 120);
  rect(slotX, slotY + 4, slotW, 1.5);     // bottom lip highlight
  // little label notches above the slot
  fill(40, 37, 30);
  rect(slotX + slotW * 0.1, slotY - 16, slotW * 0.5, 3, 2);

  // tiny labels (the little marks near the bottom of the real unit)
  noStroke();
  fill(45, 42, 34);
  textSize(Math.max(6, W * 0.012));
  textAlign(LEFT, CENTER);
  text("•  ——  ▪  ▪▪  ——", slotX + slotW * 0.05, py + 6);

  // --- right: indicator LED + square power button ---
  const bx = left + W * 0.80;
  // dim power LED (faint glow)
  const pulse = 0.5 + 0.5 * Math.sin(frameCount * 0.05);
  noStroke();
  fill(40, 90, 60, 120 + pulse * 60);
  circle(bx, slotY, 7);
  fill(120, 220, 150, 80 + pulse * 80);
  circle(bx, slotY, 3.5);

  // square power button (raised, beveled)
  const btn = W * 0.05;
  const btnX = left + W * 0.86;
  fill(36, 33, 27);
  rect(btnX - 2, slotY - btn / 2 - 2, btn + 4, btn + 4, 4);
  // lit top-right, shadow bottom-left
  fill(150, 144, 124);
  rect(btnX, slotY - btn / 2, btn, btn, 3);
  fill(90, 85, 70);
  triangle(btnX, slotY + btn / 2, btnX + btn, slotY + btn / 2, btnX + btn, slotY - btn / 2);
}

// =====================  GLOBAL VIGNETTE (darkness)  ========================
function drawVignette() {
  push();
  noFill();
  for (let i = 0; i < 60; i++) {
    stroke(0, 0, 0, 3.6);
    strokeWeight(i * 3);
    rect(0, 0, width, height);
  }
  pop();
}

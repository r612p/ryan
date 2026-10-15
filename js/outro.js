/* The ending: after "Thanks for scrolling" settles, a little more scroll pulls the camera back and the whole
   white page turns out to have been on the CRT from Ryan's original site (outro/scene.html, his p5.js
   starry valley). Two seconds after it settles, "Activate Windows" flickers on. Scroll back up and it zooms
   back into the screen and the watermark goes away.

   The zoom is one camera move around a fixed point F: the scene scales by K about F, and the page's last
   screen (.screen) is laid exactly over the CRT's screen rect. At the start K = K0 = page width / screen
   width, which makes the CRT screen fill the window exactly, so nothing jumps when the zoom begins. */
(() => {
  const host = document.querySelector('.tunnel-contact');
  if (!host) return;
  const stage  = host.querySelector('.tunnel-stage');
  const screen = host.querySelector('.screen');
  const scene  = host.querySelector('.outro-scene');
  const crtFx  = host.querySelector('.crt-fx');
  const hud    = host.querySelector('.tunnel-hud');
  const act    = host.querySelector('.activate');
  const track  = host.querySelector('.outro-track');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  let crt = null;          // the CRT screen rect, reported by the scene: { x, y, w, h, r, W, H }
  let z = 0;               // smoothed zoom-out progress, 0 = page fills the window, 1 = whole desk in view
  let playing = false, watermark = false, wmTimer = 0, flicker = null, raf = 0;

  addEventListener('message', (e) => {
    if (e.source === scene.contentWindow && e.data && e.data.type === 'crt') crt = e.data;
  });

  // load the scene (p5 + the valley) when the contact section gets close, and run it only while it shows
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !scene.getAttribute('src')) scene.src = scene.dataset.src;
    cancelAnimationFrame(raf);
    if (e.isIntersecting) raf = requestAnimationFrame(tick);
  }, { rootMargin: '100% 0px' }).observe(host);

  function tick() {
    const r = track.getBoundingClientRect();
    // 0 when the cards' scroll is used up, 1 after 85% of the outro track (the rest is a hold)
    const raw = clamp01((innerHeight - r.top) / (r.height * .85));
    z = reduce ? raw : z + (raw - z) * .12;
    if (Math.abs(raw - z) < .0005) z = raw;
    apply();
    raf = requestAnimationFrame(tick);
  }

  let lastKey = '';
  function apply() {
    const W = stage.clientWidth, H = stage.clientHeight;
    const ready = crt && Math.abs(crt.W - W) < 2 && Math.abs(crt.H - H) < 2;
    // nothing moved since the last frame: don't touch the DOM at all
    const key = ready ? `${z.toFixed(4)}|${crt.x}|${crt.y}|${crt.w}|${W}|${H}` : 'rest';
    if (key === lastKey) { if (ready && z >= .0005) watermarkCheck(); return; }
    lastKey = key;
    if (!ready || z < .0005) { rest(); return; }

    const e = ease(z);
    const K0 = W / crt.w;                                  // = H / crt.h: the screen keeps the window's shape
    const K = Math.exp(Math.log(K0) * (1 - e));            // K0 → 1, even speed in zoom terms
    const Fx = K0 * crt.x / (K0 - 1), Fy = K0 * crt.y / (K0 - 1);   // the point that stays put

    scene.style.visibility = 'visible';
    scene.style.opacity = '1';
    scene.style.transformOrigin = `${Fx}px ${Fy}px`;
    scene.style.transform = `scale(${K})`;

    const s = K * crt.w / W;                               // page → screen scale
    screen.style.transform = `translate(${Fx + K * (crt.x - Fx)}px, ${Fy + K * (crt.y - Fy)}px) scale(${s})`;
    screen.style.borderRadius = `${(e * crt.r * W / crt.w).toFixed(1)}px`;
    crtFx.style.opacity = e.toFixed(3);
    hud.style.opacity = (1 - e).toFixed(3);

    if (!playing) { scene.contentWindow.postMessage('play', '*'); playing = true; }
    watermarkCheck();
  }

  // Activate Windows: two seconds after the zoom-out settles, gone the moment it starts back in
  function watermarkCheck() {
    if (z > .97) {
      if (!watermark && !wmTimer) wmTimer = setTimeout(showWatermark, 2000);
    } else hideWatermark();
  }

  function rest() {
    screen.style.transform = '';
    screen.style.borderRadius = '';
    crtFx.style.opacity = '0';
    hud.style.opacity = '';
    scene.style.opacity = '0';
    scene.style.visibility = 'hidden';
    if (playing && scene.contentWindow) { scene.contentWindow.postMessage('pause', '*'); playing = false; }
    hideWatermark();
  }

  function showWatermark() {
    wmTimer = 0; watermark = true;
    if (reduce || !window.anime) { act.style.opacity = '1'; return; }
    // a dodgy-CRT flicker on the way in
    flicker = anime.createTimeline({ defaults: { ease: 'linear' } })
      .add(act, { opacity: [0, .8], duration: 50 })
      .add(act, { opacity: [.8, .05], duration: 70 })
      .add(act, { opacity: [.05, .9], duration: 50 })
      .add(act, { opacity: [.9, .25], duration: 90 })
      .add(act, { opacity: [.25, 1], duration: 60 })
      .add(act, { opacity: [1, .55], duration: 120, delay: 140 })
      .add(act, { opacity: [.55, 1], duration: 80 });
  }
  function hideWatermark() {
    clearTimeout(wmTimer); wmTimer = 0;
    if (!watermark) return;
    watermark = false;
    if (flicker) { flicker.pause(); flicker = null; }
    act.style.opacity = '0';
  }
})();

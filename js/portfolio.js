/* Portfolio sections: scroll reveals, self-drawing project icons, hover sweeps (anime.js). */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!window.anime || reduce) return;
  const { animate, stagger, svg } = anime;
  document.documentElement.classList.add('reveal-ready');

  // each [data-rg] group reveals its [data-r] children together, once, when it scrolls into view
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      reveal(e.target);
    }
  }, { rootMargin: '0px 0px -12% 0px' });
  document.querySelectorAll('[data-rg]').forEach(g => io.observe(g));

  function reveal(group) {
    animate(group.querySelectorAll('[data-r]'), {
      opacity: [0, 1], translateY: [40, 0],
      duration: 950, ease: 'out(4)', delay: stagger(90),
    });
    // project icons draw themselves in
    group.querySelectorAll('.pcard').forEach((card, i) => drawIcon(card, 350 + i * 90));
  }

  // Envoy blueprint on the teardown card: lines draw in as the card scrolls up, then pins, labels, LEDs.
  // The knobs stay put here; teardown.js lays this drawing over the real board and fades it into the 3D view.
  const bp = document.querySelector('#bp-overlay .bp');
  if (bp) {
    const bpIO = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      bpIO.disconnect();
      const lines = bp.querySelectorAll('.bp-lines > :not(.pin), .knob > *, .dim path');
      animate(svg.createDrawable(lines), { draw: ['0 0', '0 1'], duration: 1400, ease: 'inOut(3)', delay: stagger(14, { start: 150 }) });
      animate(bp.querySelectorAll('.pin'), { opacity: [0, 1], duration: 300, delay: stagger(6, { start: 900 }) });
      animate(bp.querySelectorAll('text'), { opacity: [0, 1], duration: 500, delay: stagger(60, { start: 1300 }) });
      animate(bp.querySelectorAll('.led'), { opacity: [.15, .95], duration: 900, delay: stagger(220, { start: 1500 }), loop: true, alternate: true, ease: 'inOut(2)' });
    }, { rootMargin: '0px 0px -25% 0px' });
    bpIO.observe(document.getElementById('teardown'));
  }

  // project cards: icon strokes are anime.js drawables, re-drawn and swept on hover
  const drawables = new Map();
  function drawIcon(card, start = 0) {
    let d = drawables.get(card);
    if (!d) { d = svg.createDrawable(card.querySelectorAll('.ico svg > *')); drawables.set(card, d); }
    animate(d, { draw: ['0 0', '0 1'], duration: 1000, ease: 'inOut(3)', delay: stagger(45, { start }) });
  }
  document.querySelectorAll('.pcard').forEach(card => {
    const scan = document.createElement('span');
    scan.className = 'scan';
    card.appendChild(scan);
    card.addEventListener('mouseenter', () => {
      drawIcon(card);
      animate(scan, { translateY: [0, card.offsetHeight], opacity: [.7, 0], duration: 750, ease: 'out(2)' });
      animate(card.querySelectorAll('.tags span'), { translateY: [6, 0], opacity: [.4, 1], delay: stagger(40), duration: 420, ease: 'out(3)' });
    });
  });
})();

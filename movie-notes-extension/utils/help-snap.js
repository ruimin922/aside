// Only snap across the seam between pages; long pages retain normal scrolling.
export function nearestHelpPage(position, boundary, viewportHeight) {
  const upper = Math.max(0, boundary - viewportHeight);
  if (position <= upper || position >= boundary) return null;
  return position - upper < (boundary - upper) / 2 ? upper : boundary;
}

export function springProgress(progress) {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return 1 - Math.exp(-7 * progress) * Math.cos(9 * progress);
}

export function bindHelpSnap(scroller, dialog) {
  let timer, frame = 0, settling = false, touching = false;
  const stop = () => {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    frame = 0;
    settling = false;
  };
  const settle = () => {
    if (!dialog.open || touching) return;
    const tutorial = scroller.querySelector('.help-tutorial');
    const shortcuts = scroller.querySelector('.help-shortcuts');
    const boundary = shortcuts.offsetTop - tutorial.offsetTop;
    const start = scroller.scrollTop;
    const target = nearestHelpPage(start, boundary, scroller.clientHeight);
    if (target == null || Math.abs(target - start) < 1) return;
    settling = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      scroller.scrollTop = target;
      frame = requestAnimationFrame(() => { settling = false; });
      return;
    }
    const began = performance.now();
    const tick = now => {
      if (!dialog.open) { stop(); return; }
      const progress = Math.min(1, (now - began) / 440);
      scroller.scrollTop = start + (target - start) * springProgress(progress);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else frame = requestAnimationFrame(() => { settling = false; frame = 0; });
    };
    frame = requestAnimationFrame(tick);
  };
  const schedule = () => {
    if (settling || touching) return;
    clearTimeout(timer);
    timer = setTimeout(settle, 140);
  };
  scroller.addEventListener('scroll', schedule, { passive: true });
  scroller.addEventListener('wheel', () => { stop(); schedule(); }, { passive: true });
  scroller.addEventListener('keydown', stop);
  scroller.addEventListener('pointerdown', () => { stop(); touching = true; });
  window.addEventListener('pointerup', () => { if (touching) { touching = false; schedule(); } }, { passive: true });
  window.addEventListener('pointercancel', () => { touching = false; stop(); }, { passive: true });
  dialog.addEventListener('close', stop);
}

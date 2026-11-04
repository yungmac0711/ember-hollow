// Reliable taps on iOS Safari. The game cancels touchmove (anti-zoom / anti-scroll) and most HUD
// elements use touch-action: none, which makes iOS drop the synthesized `click` — so UI buttons
// must not rely on 'click'. onTap() fires on pointerup when the finger moved less than SLOP px since
// pointerdown (so a sideways swipe on a scrolling bar still scrolls and doesn't select), and stops
// propagation so the tap never reaches the look/joystick layer or counts as a placement.
// `pick(target)` (delegation) returns the element/value to act on, or null to ignore.
const SLOP = 10;

export function onTap(el, fn, pick = (t) => el) {
  if (!el) return;
  let start = null;
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
  });
  el.addEventListener('pointermove', (e) => { e.stopPropagation(); });
  el.addEventListener('pointercancel', () => { start = null; }); // the browser took it for a scroll
  el.addEventListener('pointerup', (e) => {
    e.stopPropagation();
    const s = start; start = null;
    if (!s || s.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP) return;
    if (Math.abs(el.scrollLeft - s.sl) + Math.abs(el.scrollTop - s.st) > SLOP) return;
    const target = pick(e.target);
    if (target == null) return;
    e.preventDefault();
    fn(target, e);
  });
  // keyboard / assistive activation (Enter/Space on a focused button) still works, without
  // double-firing after a pointer tap
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.detail !== 0) return; // real pointer clicks are handled above
    const target = pick(e.target);
    if (target != null) fn(target, e);
  });
}

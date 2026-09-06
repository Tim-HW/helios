// Small-screen controls.
//
// Two gaps make the app unusable on a phone, and they are different in kind.
//
// The layout one is cosmetic and the stylesheet handles it. The other is not:
// dragging already looks around, because the camera listens on pointer events
// rather than mouse events, but *flying* is bound to WASD -- so a phone can
// turn on the spot and do nothing else. The pad below fixes that by pushing
// key codes into the same Set the keyboard fills, so there is no second
// movement path to keep in step with the first.

const HOLD = [
  ['tm-fwd', 'KeyW'],
  ['tm-back', 'KeyS'],
];

export function initTouchUI({ flycam }) {
  const body = document.body;

  const menu = document.getElementById('ui-menu');
  const sidebar = document.getElementById('sidebar');
  if (menu && sidebar) {
    menu.addEventListener('click', () => body.classList.toggle('sheet-open'));
    // Choosing a destination is the usual reason the sheet was opened, so get
    // out of the way once one is chosen -- otherwise the sheet covers the thing
    // it just flew you to.
    sidebar.addEventListener('click', (e) => {
      if (e.target.closest('.target, #preset-list button, #moment-list button')) {
        body.classList.remove('sheet-open');
      }
    });
  }

  // The readout is collapsed to its heading on a phone; tapping it expands.
  const readout = document.getElementById('readout');
  const heading = readout?.querySelector('h2');
  if (heading) {
    heading.style.cursor = 'pointer';
    heading.addEventListener('click', () => body.classList.toggle('readout-open'));
  }

  for (const [id, code] of HOLD) {
    const el = document.getElementById(id);
    if (!el) continue;
    const press = (e) => {
      e.preventDefault();
      flycam.keys.add(code);
      // Matches what the keyboard handler does: any manual translation drops
      // out of orbit mode and cancels an in-flight travel, or the two fight.
      flycam.orbiting = false;
      flycam.travel = null;
      el.setPointerCapture?.(e.pointerId);
    };
    const release = (e) => {
      flycam.keys.delete(code);
      if (e && el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
    // A finger lifted while the tab is hidden never reports pointerup.
    window.addEventListener('blur', () => release());
  }
}

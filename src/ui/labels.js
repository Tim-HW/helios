import * as THREE from 'three';
import { formatShortDistance } from './format.js';

// Body names as an HTML overlay, projected from their world positions each
// frame. HTML rather than sprites because text stays crisp at any zoom and
// costs nothing to lay out.
//
// Labels track the same fade as the navigation markers: they belong to a body
// you cannot yet see properly, and they get out of the way once you can.

export class Labels {
  constructor(container, system, onSelect) {
    this.system = system;
    this.container = container;
    this.entries = [];
    this._v = new THREE.Vector3();
    this._rects = null;
    this._rectAge = 0;

    for (const b of system.bodies) {
      const el = document.createElement('button');
      el.className = b.kind === 'minor' ? 'label label-minor' : 'label';
      el.type = 'button';
      el.innerHTML = `<span class="label-name">${b.def.name}</span><span class="label-dist"></span>`;
      el.addEventListener('click', () => onSelect(b));
      container.appendChild(el);
      this.entries.push({ body: b, el, distEl: el.querySelector('.label-dist') });
    }
  }

  setVisible(v) {
    this.visible = v;
    this.container.style.display = v ? '' : 'none';
  }

  // Refreshed occasionally rather than every frame: panels barely move, and
  // getBoundingClientRect forces layout.
  _panelRects() {
    if (this._rects && this._rectAge++ < 30) return this._rects;
    this._rectAge = 0;
    // Filter on the rect, not offsetParent: that is null for position:fixed
    // elements in Firefox, which is every panel here -- so the obvious version
    // of this silently keeps no rects at all and avoids nothing.
    this._rects = [...document.querySelectorAll('.panel')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    return this._rects;
  }

  update(camera, resolution) {
    if (this.visible === false) return;
    const halfW = resolution.x / 2;
    const halfH = resolution.y / 2;
    const panels = this._panelRects();
    const placed = [];

    // Work out where every label wants to go, then decide which ones get to be
    // there. Without this the inner planets pile into an unreadable knot near
    // the Sun, and labels draw straight over the panels.
    const wants = [];
    for (const entry of this.entries) {
      const { body } = entry;
      const markerOpacity = body.marker
        ? body.marker.material.uniforms.uOpacity.value : 0;
      const opacity = Math.max(markerOpacity, body.apparentPx > 4 ? 0.65 : 0);
      if (opacity < 0.02) { entry.el.style.display = 'none'; continue; }

      this._v.copy(body.worldPos).project(camera);
      if (this._v.z > 1 || Math.abs(this._v.x) > 1.4 || Math.abs(this._v.y) > 1.4) {
        entry.el.style.display = 'none';
        continue;
      }
      wants.push({
        entry,
        opacity,
        x: (this._v.x * halfW) + halfW,
        y: -(this._v.y * halfH) + halfH,
        // Planets and the Sun outrank moons and minor planets; among equals,
        // whatever is closer wins the space.
        rank: (body.kind === 'planet' || body.kind === 'star' ? 0 : 1)
          + Math.min(body.distance / 1e9, 0.9),
      });
    }

    wants.sort((a, b) => a.rank - b.rank);

    for (const w of wants) {
      // Approximate box: the label sits up and to the right of its anchor.
      const width = w.entry.el.offsetWidth || 90;
      const box = { l: w.x + 6, r: w.x + 6 + width, t: w.y - 12, b: w.y + 4 };

      const clash = (r) => !(box.r < r.left || box.l > r.right
                          || box.b < r.top || box.t > r.bottom);
      const hidden = panels.some(clash)
        || placed.some((p) => !(box.r < p.l || box.l > p.r || box.b < p.t || box.t > p.b));

      if (hidden) { w.entry.el.style.display = 'none'; continue; }
      placed.push(box);

      const { entry, opacity } = w;
      entry.el.style.display = '';
      entry.el.style.opacity = opacity;
      entry.el.style.transform = `translate(${w.x.toFixed(1)}px, ${w.y.toFixed(1)}px)`;
      entry.distEl.textContent = formatShortDistance(entry.body.distance);
    }
  }
}

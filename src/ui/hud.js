import * as THREE from 'three';
import {
  PLANETS, MINOR_PLANETS, MOONS, SUN, CRAFT, AU, SOLAR_CONSTANT,
} from '../solar/data.js';
import { MAX_WARP } from '../core/clock.js';
import {
  formatDistance, formatShortDistance, lightTime, formatDate, angularDiameter,
} from './format.js';
import { MOMENTS, parseUtcDate, formatUtcInput } from './moments.js';

// The readouts, the destination list, and the scale bar.
//
// The numbers here are doing real work. At true scale the view often shows
// almost nothing, and what tells you where you are is not the picture but the
// figures beside it: how far, how long light takes to cross it, how big the
// thing actually looks from here, and how dim the Sun has become. The render
// makes the distances felt; the HUD makes them legible.

const EARTH_DIAMETER = 12756.274;

export class Hud {
  constructor({ clock, flycam, system, orbits, labels, belt, options, presets }) {
    this.clock = clock;
    this.flycam = flycam;
    this.system = system;
    this.orbits = orbits;
    this.labels = labels;
    this.belt = belt;
    this.options = options;

    this.el = {
      date: byId('date'),
      warpText: byId('warp-text'),
      warp: byId('warp'),
      focusName: byId('focus-name'),
      focusNote: byId('focus-note'),
      distance: byId('r-distance'),
      altitude: byId('r-altitude'),
      light: byId('r-light'),
      angular: byId('r-angular'),
      diameter: byId('r-diameter'),
      sun: byId('r-sun'),
      speed: byId('r-speed'),
      fov: byId('r-fov'),
      rock: byId('r-rock'),
      scaleText: byId('scale-text'),
      dateInput: byId('date-input'),
      exaggVal: byId('exagg-val'),
      exaggWarn: byId('exagg-warn'),
    };

    this._buildTargets();
    this._buildPresets(presets);
    this._buildMoments();
    this._bindControls();
    this._v = new THREE.Vector3();
  }

  // --- construction ---------------------------------------------------------

  _buildTargets() {
    const list = byId('target-list');
    this.targetButtons = new Map();

    const add = (def, isMoon) => {
      const record = this.system.byId.get(def.id);
      const btn = document.createElement('button');
      btn.className = `target${isMoon ? ' moon' : ''}`;
      btn.innerHTML =
        `<span class="swatch" style="background:${def.color}"></span>${def.name}`;
      btn.addEventListener('click', () => this.flycam.goTo(record));
      list.appendChild(btn);
      this.targetButtons.set(def.id, btn);
    };

    add(SUN, false);
    for (const p of PLANETS) {
      add(p, false);
      for (const m of MOONS) if (m.parent === p.id) add(m, true);
      // Craft are not bodies of the solar system, but they are places you can go.
      for (const c of CRAFT) {
        if (c.parent === p.id && this.system.byId.get(c.id)) add(c, true);
      }
      // The big four sit between Mars and Jupiter, so slot them in there.
      if (p.id === 'mars') for (const mp of MINOR_PLANETS) add(mp, true);
    }
  }

  _buildPresets(presets) {
    const list = byId('preset-list');
    for (const preset of presets) {
      const btn = document.createElement('button');
      btn.className = 'target';
      btn.textContent = preset.name;
      btn.addEventListener('click', () => preset.apply());
      list.appendChild(btn);
    }
  }

  // Dates the model reproduces, each paired with something to look at. Clicking
  // one sets the clock, pauses, and flies you there -- the point is to SEE it,
  // and at 1x real time you would wait hours for the geometry to change.
  _buildMoments() {
    const list = byId('moment-list');
    for (const m of MOMENTS) {
      const btn = document.createElement('button');
      btn.className = 'target';
      btn.title = m.note;
      btn.innerHTML = `<span>${m.name}</span>`
        + `<span class="when">${m.when.slice(0, 10)}</span>`;
      btn.addEventListener('click', () => {
        this.clock.setDate(new Date(m.when));
        this.clock.paused = true;
        byId('btn-pause').classList.add('on');
        this._syncDateInput();
        const record = this.system.byId.get(m.target);
        if (record) this.flycam.goTo(record);
        this.el.focusNote.textContent = m.note;
      });
      list.appendChild(btn);
    }
  }

  _syncDateInput() {
    const el = this.el.dateInput;
    if (el && document.activeElement !== el) el.value = formatUtcInput(this.clock.date);
  }

  _bindControls() {
    const o = this.options;

    // Warp runs on a log slider: 1x to 1e7x is seven decades, and a linear
    // control would spend all its travel in territory nobody wants.
    this.el.warp.addEventListener('input', () => {
      this.clock.warp = Math.pow(10, parseFloat(this.el.warp.value));
      this.clock.paused = false;
      byId('btn-pause').classList.remove('on');
    });
    this.el.warp.max = Math.log10(MAX_WARP);

    byId('btn-pause').addEventListener('click', (e) => {
      this.clock.paused = !this.clock.paused;
      e.currentTarget.classList.toggle('on', this.clock.paused);
    });
    byId('btn-reverse').addEventListener('click', (e) => {
      this.clock.direction *= -1;
      e.currentTarget.classList.toggle('on', this.clock.direction < 0);
    });
    byId('btn-now').addEventListener('click', () => {
      this.clock.setDate(new Date());
      this._syncDateInput();
    });

    // Jump to a date. UTC always: a local-time date would be a different sky.
    const dateInput = this.el.dateInput;
    const goToDate = () => {
      const parsed = parseUtcDate(dateInput.value);
      dateInput.classList.toggle('bad', !parsed && dateInput.value.trim() !== '');
      if (!parsed) return;
      this.clock.setDate(parsed);
      dateInput.blur();
    };
    byId('btn-goto-date').addEventListener('click', goToDate);
    dateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') goToDate();
      e.stopPropagation();           // typing must not fly the camera
    });
    dateInput.addEventListener('keyup', (e) => e.stopPropagation());
    this._syncDateInput();

    const help = byId('help');
    byId('btn-help').addEventListener('click', () => help.classList.toggle('hidden'));

    bindToggle('t-orbits', true, (v) => { o.showOrbits = v; this.orbits.setVisible(v); });
    bindToggle('t-labels', true, (v) => { o.showLabels = v; this.labels.setVisible(v); });
    bindToggle('t-markers', true, (v) => { o.showMarkers = v; });
    bindToggle('t-belt', true, (v) => { o.showBelt = v; this.belt.setVisible(v); });
    bindToggle('t-light', false, (v) => { o.realisticLight = v; });

    const exagg = byId('exagg');
    // Firefox changes a range input on mouse wheel, and the wheel is how you set
    // flight speed -- so scrolling with the pointer over this panel used to
    // enlarge every planet without the user ever touching the slider. Since the
    // camera then ends up inside the enlarged geometry, the planet appears to
    // vanish. Take the wheel away from it.
    exagg.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    exagg.addEventListener('input', () => {
      o.exaggeration = Math.pow(10, parseFloat(exagg.value));
      // Resize immediately rather than waiting for the next frame. The camera
      // navigates by the drawn radius, so a click on a destination in the gap
      // between the two would aim at the old size and fly inside the new one.
      this.system.setExaggeration(o.exaggeration);
      const on = o.exaggeration > 1.02;
      this.el.exaggVal.textContent = on ? `${Math.round(o.exaggeration)}×` : 'off';
      this.el.exaggWarn.classList.toggle('show', on);
    });
    // Browsers restore form state across a reload without firing `input`, so
    // adopt whatever the slider actually says rather than assuming it is zero.
    exagg.dispatchEvent(new Event('input'));

    byId('help-close').addEventListener('click', () => byId('help').classList.add('hidden'));

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'KeyP') { byId('btn-pause').click(); }
      if (e.code === 'BracketRight') this._nudgeWarp(0.5);
      if (e.code === 'BracketLeft') this._nudgeWarp(-0.5);
      if (e.code === 'KeyC') this.flycam.resetFov();
    });
  }

  _nudgeWarp(delta) {
    const next = Math.min(Math.max(Math.log10(this.clock.warp) + delta, 0), Math.log10(MAX_WARP));
    this.clock.warp = Math.pow(10, next);
    this.el.warp.value = next;
  }

  // --- per-frame ------------------------------------------------------------

  update(camera, resolution, now = 0) {
    const cam = this.flycam;
    this.el.date.textContent = formatDate(this.clock.date);
    this._syncDateInput();
    this.el.warpText.textContent = this.clock.describeWarp();

    // What the panel describes: the focused body, or failing that, whatever is
    // nearest -- which is almost always what you are looking at anyway.
    const subject = cam.target ?? cam.nearestBody;
    for (const [id, btn] of this.targetButtons) {
      btn.classList.toggle('active', cam.target?.def.id === id);
    }

    if (!subject) return;
    const def = subject.def;
    const dist = camera.position.distanceTo(subject.worldPos);
    const altitude = Math.max(dist - def.radius, 0);

    this.el.focusName.textContent = cam.target ? def.name : `Near ${def.name}`;
    this.el.focusNote.textContent = def.note ?? '';
    this.el.distance.textContent = formatDistance(dist);
    this.el.altitude.textContent = dist < def.radius
      ? 'inside'
      : formatDistance(altitude);
    this.el.light.textContent = lightTime(dist);
    this.el.angular.textContent = angularDiameter(def.radius, Math.max(dist, def.radius));

    const diameterKm = def.radius * 2;
    this.el.diameter.textContent = def.id === 'earth'
      ? `${Math.round(diameterKm).toLocaleString()} km`
      : `${Math.round(diameterKm).toLocaleString()} km · ${(diameterKm / EARTH_DIAMETER).toFixed(2)}× Earth`;

    // Sunlight where the camera is, not where the body is -- this is the number
    // that makes the outer system feel as dark as it is.
    const sunDist = camera.position.length();
    const rel = (AU / Math.max(sunDist, 1)) ** 2;
    this.el.sun.textContent = rel > 1e4
      ? '—'
      : `${rel >= 0.01 ? rel.toFixed(2) : rel.toExponential(1)}× Earth · ${
          (rel * SOLAR_CONSTANT).toFixed(rel < 0.1 ? 2 : 0)} W/m²`;

    this.el.speed.textContent = cam.describeSpeed();
    this.el.fov.textContent = cam.fov >= 10
      ? `${cam.fov.toFixed(0)}°`
      : `${cam.fov.toFixed(cam.fov < 1 ? 2 : 1)}°  (${(55 / cam.fov).toFixed(0)}× zoom)`;

    this._updateNearestRock(camera, now);
    this._updateScaleBar(camera, resolution, dist);
  }

  // The number that undoes every film's asteroid field.
  //
  // Fiction has everyone believing a belt is something you weave through. In
  // reality the nearest of these 22,491 catalogued rocks is usually millions of
  // km away, and you could fly straight across the belt and never come near
  // one. Rendering cannot show that -- an empty screen shows nothing -- so the
  // model reports it as a number instead.
  //
  // `now` matters: without it the throttle inside nearest() compares against
  // NaN, and the full 22,491-object sweep runs every single frame.
  _updateNearestRock(camera, now) {
    if (!this.options.showBelt) { this.el.rock.textContent = '—'; return; }
    const r = this.belt.nearest(camera.position, this.clock.jd, now);
    if (!r) { this.el.rock.textContent = '—'; return; }
    this.el.rock.textContent = formatDistance(r.distance);
  }

  // How much real distance 160 screen pixels covers at the subject's range.
  _updateScaleBar(camera, resolution, referenceDistance) {
    const pxPerRadian = (resolution.y * 0.5) / Math.tan(camera.fov * Math.PI / 360);
    const span = (160 / pxPerRadian) * referenceDistance;
    this.el.scaleText.textContent = `${formatShortDistance(span)} at this range`;
  }
}

function byId(id) { return document.getElementById(id); }

function bindToggle(id, initial, onChange) {
  const el = byId(id);
  el.checked = initial;
  el.addEventListener('change', () => onChange(el.checked));
  onChange(initial);
}

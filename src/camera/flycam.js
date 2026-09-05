import * as THREE from 'three';
import { Travel, viewpointFor, lookAtQuaternion } from './focus.js';
import { C_KM_S } from '../solar/data.js';

// Free flight through a true-scale solar system.
//
// Two ideas carry this whole file.
//
// ADAPTIVE SPEED. A fixed speed cannot work across ten decades of distance: fast
// enough to reach Neptune is fast enough to shoot straight through Earth. So
// speed is proportional to how much empty space is actually in front of you --
// the distance to the nearest body's surface. Hovering a metre above Europa you
// crawl; out in the dark between planets you cross AU in seconds. You never
// touch a setting, and the HUD reports the resulting speed in km/s and in
// multiples of c so the number stays honest.
//
// REFERENCE FRAMES. The camera's position is stored as an offset from a nearby
// body, not as an absolute point. At 100,000x time warp Earth moves 3 million km
// a second; without this, stepping back to admire it would leave you stranded in
// empty space the instant you let go. The frame body is just whatever is nearest,
// so it changes over as you travel, and because the offset is recomputed at the
// moment of the switch the camera never jumps.
//
// Orientation is yaw + pitch against ecliptic north, with no roll. Space has no
// "up", but the ecliptic is the one plane every orbit here is measured from, and
// keeping the horizon level to it is far easier to fly than free 6DOF tumbling.

const MIN_SPEED = 1e-5;    // 1 cm/s
const MAX_SPEED = 1e10;    // km/s
const DEFAULT_FOV = 55;
const MIN_FOV = 0.05;      // ~a long telephoto; Jupiter from Earth as a disc
const MAX_FOV = 90;
const PITCH_LIMIT = Math.PI / 2 - 0.001;
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

export class FlyCamera {
  constructor(camera, system, domElement) {
    this.camera = camera;
    this.system = system;
    this.dom = domElement;

    this.frameBody = system.byId.get('sun');
    // Opening shot: 400 million km out and a little above the ecliptic, looking
    // back down at the inner system. Mars's orbit fills the view; Earth is
    // already too small to see as anything but a marker.
    this.posInFrame = new THREE.Vector3(0, 3e7, 4e8);
    this.yaw = 0;
    this.pitch = -0.075;

    this.speedMultiplier = 1;
    this.boost = false;
    this.currentSpeed = 0;

    // Field of view is a genuine navigation tool here, not a gimmick. At 55
    // degrees the Sun seen from Earth is four pixels across and Jupiter from
    // Saturn is invisible; narrowing the field is the only way to actually look
    // at something far away. It is honest because it changes nothing physical --
    // the HUD keeps reporting the true angular size either way.
    this.fov = DEFAULT_FOV;
    camera.fov = DEFAULT_FOV;
    camera.updateProjectionMatrix();

    this.target = null;      // body we are focused on, if any
    this.orbiting = false;   // dragging orbits the target instead of looking around
    this.travel = null;

    this.keys = new Set();
    this._dragging = false;
    this._last = new THREE.Vector2();
    this._tmp = new THREE.Vector3();
    this._move = new THREE.Vector3();
    this._prevPos = new THREE.Vector3().copy(this.posInFrame);
    this._tmpQ = new THREE.Quaternion();

    this._bindInput();
    this._applyOrientation();
  }

  // --- input ----------------------------------------------------------------

  _bindInput() {
    const dom = this.dom;

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.boost = true;
      if (e.code === 'Escape') this.clearTarget();
      // Any translation input drops out of orbit mode and flies manually.
      if (MOVE_KEYS.has(e.code)) {
        this.orbiting = false;
        this.travel = null;
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.boost = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.boost = false; });

    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this._dragging = true;
      this._last.set(e.clientX, e.clientY);
      dom.setPointerCapture(e.pointerId);
      this.travel = null;
    });
    dom.addEventListener('pointerup', (e) => {
      this._dragging = false;
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._last.x;
      const dy = e.clientY - this._last.y;
      this._last.set(e.clientX, e.clientY);
      const k = 0.0032;
      if (this.orbiting && this.target) {
        this._orbitDrag(-dx * k, -dy * k);
      } else {
        this.yaw -= dx * k;
        this.pitch = clamp(this.pitch - dy * k, -PITCH_LIMIT, PITCH_LIMIT);
        this._applyOrientation();
      }
    });

    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0016);
      if (this.orbiting && this.target) {
        this._dolly(factor);
      } else {
        this.speedMultiplier = clamp(this.speedMultiplier * factor, 0.02, 5000);
      }
    }, { passive: false });
  }

  // --- targeting ------------------------------------------------------------

  goTo(record) {
    this._rebaseTo(record);
    const end = viewpointFor(record, this.posInFrame);
    const endQuat = lookAtQuaternion(end, this._tmpQ.clone());
    this.travel = new Travel(this.posInFrame, end, this.camera.quaternion, endQuat);
    this.target = record;
    this.orbiting = true;
  }

  clearTarget() {
    this.target = null;
    this.orbiting = false;
    this.travel = null;
  }

  // Move the camera's bookkeeping into another body's frame without moving the
  // camera itself: the offset is recomputed from the current world position.
  _rebaseTo(record) {
    if (this.frameBody === record) return;
    this._tmp.copy(this.camera.position).sub(record.worldPos);
    // Carry the previous sample into the new frame by shifting it by the same
    // change of origin. Simply resetting it would report a speed of zero on
    // every frame the reference body changes, which happens mid-flight.
    if (this._prevPos) {
      this._prevPos.add(this.frameBody.worldPos).sub(record.worldPos);
    }
    this.frameBody = record;
    this.posInFrame.copy(this._tmp);
  }

  _orbitDrag(dYaw, dPitch) {
    const offset = this.posInFrame;
    const radius = offset.length();
    // Spherical about the target, clamped off the poles.
    let theta = Math.atan2(offset.x, offset.z);
    let phi = Math.acos(clamp(offset.y / radius, -1, 1));
    theta += dYaw;
    phi = clamp(phi + dPitch, 0.02, Math.PI - 0.02);
    offset.set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta),
    );
    this._faceTarget();
  }

  _dolly(factor) {
    const surface = (this.target.renderRadius ?? this.target.def.radius) * 1.02;
    const len = clamp(this.posInFrame.length() / factor, surface, 1e11);
    this.posInFrame.setLength(len);
    this._faceTarget();
  }

  // Point the camera back at the focused body and resync yaw/pitch, so that
  // dropping out of orbit mode into free flight keeps the same view.
  _faceTarget() {
    const d = this._tmp.copy(this.posInFrame).negate();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = clamp(Math.asin(clamp(d.y / d.length(), -1, 1)), -PITCH_LIMIT, PITCH_LIMIT);
    this._applyOrientation();
  }

  _applyOrientation() {
    _euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(_euler);
  }

  // --- per-frame ------------------------------------------------------------

  update(dt) {
    if (this.keys.has('KeyZ')) this.zoomBy(Math.pow(0.25, dt));
    if (this.keys.has('KeyX')) this.zoomBy(Math.pow(4, dt));
    if (this.camera.fov !== this.fov) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // The frame body moved while the sim advanced; ride along with it.
    this.camera.position.copy(this.frameBody.worldPos).add(this.posInFrame);

    if (this.travel) {
      this.travel.advance(dt, this.posInFrame, this.camera.quaternion);
      if (this.travel.done) {
        this.travel = null;
        this._faceTarget();
      }
      this.camera.position.copy(this.frameBody.worldPos).add(this.posInFrame);
      this._measureSpeed(dt);
      return;
    }

    const near = this.system.nearestSurfaceDistance(this.camera.position);
    this.nearestBody = near.body;
    this.altitude = near.distance;

    // The core of the whole design: speed follows the emptiness ahead. If we
    // have blundered inside a body there is no space ahead at all, so fall back
    // to its radius -- otherwise you would be trapped at a crawl in the rock.
    const base = near.inside
      ? near.body.renderRadius * 0.35
      : clamp(near.distance * 0.35, MIN_SPEED, MAX_SPEED);
    const speed = base * this.speedMultiplier * (this.boost ? 8 : 1);

    const move = this._readMoveAxis();
    if (move.lengthSq() > 0) {
      move.normalize().applyQuaternion(this.camera.quaternion);
      this.posInFrame.addScaledVector(move, speed * dt);
    }
    // Sync the world position BEFORE any change of reference frame, because
    // _rebaseTo reads it to work out the new offset. Leaving this until after
    // the rebase silently throws away this frame's movement whenever the
    // nearest body changes -- which is exactly when you are travelling fastest.
    this.camera.position.copy(this.frameBody.worldPos).add(this.posInFrame);

    // Follow whatever is nearest now, so time warp cannot strand us.
    if (near.body && near.body !== this.frameBody && !this.orbiting) {
      this._rebaseTo(near.body);
    }
    if (this.orbiting && this.target) {
      this._rebaseTo(this.target);
    }

    this.camera.position.copy(this.frameBody.worldPos).add(this.posInFrame);
    this._measureSpeed(dt);
  }

  // Measured rather than assumed, so the readout stays truthful while a travel
  // animation is flying us somewhere or a drag is swinging us around a planet.
  // It is speed relative to the body we are riding with, which is the only
  // frame in which the number means anything out here.
  _measureSpeed(dt) {
    this.currentSpeed = dt > 0 ? this.posInFrame.distanceTo(this._prevPos) / dt : 0;
    this._prevPos.copy(this.posInFrame);
  }

  setFov(deg) {
    this.fov = clamp(deg, MIN_FOV, MAX_FOV);
  }

  zoomBy(factor) {
    this.setFov(this.fov * factor);
  }

  resetFov() {
    this.setFov(DEFAULT_FOV);
  }

  _readMoveAxis() {
    const k = this.keys;
    const v = this._move.set(0, 0, 0);
    if (k.has('KeyW') || k.has('ArrowUp')) v.z -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) v.z += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) v.x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) v.x += 1;
    if (k.has('KeyR') || k.has('Space')) v.y += 1;
    if (k.has('KeyF') || k.has('ControlLeft')) v.y -= 1;
    return v;
  }

  describeSpeed() {
    const s = this.currentSpeed;
    if (s === 0) return 'stopped';
    if (s < 1) return `${(s * 1000).toFixed(0)} m/s`;
    if (s < C_KM_S * 0.01) return `${formatNumber(s)} km/s`;
    return `${formatNumber(s)} km/s  (${formatNumber(s / C_KM_S)} c)`;
  }
}

const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'Space', 'ControlLeft',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function formatNumber(v) {
  if (v >= 1e6) return v.toExponential(2);
  if (v >= 1000) return Math.round(v).toLocaleString();
  if (v >= 10) return v.toFixed(0);
  return v.toFixed(2);
}

// Place the camera directly, used by the preset viewpoints. `offset` is
// relative to `record`, and the camera is aimed at `lookAt` (a world point).
FlyCamera.prototype.placeAt = function placeAt(record, offset, lookAt, fov = DEFAULT_FOV) {
  this.travel = null;
  this.setFov(fov);

  // Never place the camera inside the body it is anchored to. Viewpoints frame
  // themselves on real distances -- the Earth-Moon gap, a ring system -- and
  // with sizes exaggerated those distances can end up smaller than the drawn
  // body itself, which would leave the camera inside geometry whose back faces
  // are culled: the planet would simply be missing. Push out far enough to see.
  const clearance = (record.renderRadius ?? record.def.radius) * 1.1;
  if (offset.length() < clearance) offset.setLength(clearance);

  this._prevPos.copy(offset);
  this.frameBody = record;
  this.posInFrame.copy(offset);
  this.camera.position.copy(record.worldPos).add(offset);
  const d = new THREE.Vector3().subVectors(lookAt, this.camera.position);
  this.yaw = Math.atan2(-d.x, -d.z);
  this.pitch = clamp(Math.asin(clamp(d.y / d.length(), -1, 1)), -PITCH_LIMIT, PITCH_LIMIT);
  this._applyOrientation();
  this.target = record;
  this.orbiting = true;
};

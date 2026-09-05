import * as THREE from 'three';
import { PLANETS, MINOR_PLANETS, MOONS, AU, J2000 } from './data.js';
import { samplePlanetOrbit, sampleKeplerianOrbit, eclipticToWorld } from './kepler.js';

// Orbit paths.
//
// These are the one place in the app where float32 precision genuinely bites.
// Vertex buffers are float32, and Neptune's path reaches 4.5e9 km from the
// origin, so its vertices quantise to steps of roughly 270 km. Invisible from
// outside the solar system; a stair-stepping mess if you are parked on Triton.
//
// Two defences, and the pair covers the whole range:
//
//   1. A FLOATING ORIGIN. When the camera comes within ~0.1% of the orbit's
//      radius, the line's vertices are rewritten relative to an offset snapped
//      to the camera. Points near the camera then have small coordinates and
//      full precision; points on the far side keep their error, but they are
//      billions of km away where it cannot be seen.
//   2. A FADE. Closer still and the line dissolves entirely -- by then it is a
//      distracting streak across the view rather than useful context, so losing
//      it costs nothing and hides the last of the jitter.

// Scratch objects: these loops run every frame, so they allocate nothing.
const _v = new THREE.Vector3();
const _e = { x: 0, y: 0, z: 0 };

const SEGMENTS = 640;
const MOON_SEGMENTS = 256;

class OrbitPath {
  constructor(eclipticPoints, color, opacity, scaleRadius, floating) {
    this.absolute = eclipticPoints;           // Float64Array, ecliptic frame
    this.count = eclipticPoints.length / 3;
    this.scaleRadius = scaleRadius;
    this.floating = floating;
    this.offset = new THREE.Vector3();
    this.baseOpacity = opacity;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position', new THREE.BufferAttribute(new Float32Array(this.count * 3), 3),
    );
    this.material = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity,
      depthWrite: false,
    });
    this.line = new THREE.Line(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.line.renderOrder = -1;

    this._writeVertices();
  }

  // Rewrite the buffer as (absolute - offset), converting ecliptic to world.
  _writeVertices() {
    const dst = this.geometry.attributes.position.array;
    const src = this.absolute;
    const { x: ox, y: oy, z: oz } = this.offset;
    const v = _v, e = _e;
    for (let i = 0; i < this.count; i++) {
      e.x = src[i * 3]; e.y = src[i * 3 + 1]; e.z = src[i * 3 + 2];
      eclipticToWorld(e, v);
      dst[i * 3] = v.x - ox;
      dst[i * 3 + 1] = v.y - oy;
      dst[i * 3 + 2] = v.z - oz;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.line.position.copy(this.offset);
  }

  setPoints(eclipticPoints) {
    this.absolute = eclipticPoints;
    this._writeVertices();
  }

  // cameraLocal: the camera position expressed in the same frame the line's
  // parent object uses (world for planets, parent-relative for moons).
  update(cameraLocal) {
    const near = this._nearestDistance(cameraLocal);

    if (this.floating) {
      const engage = this.scaleRadius * 1e-3;
      if (near < engage) {
        // Snap in coarse steps so we are not re-uploading the buffer every
        // single frame while drifting.
        const step = Math.max(this.scaleRadius * 1e-5, 1);
        const snapped = new THREE.Vector3(
          Math.round(cameraLocal.x / step) * step,
          Math.round(cameraLocal.y / step) * step,
          Math.round(cameraLocal.z / step) * step,
        );
        if (!snapped.equals(this.offset)) {
          this.offset.copy(snapped);
          this._writeVertices();
        }
      } else if (this.offset.lengthSq() !== 0) {
        this.offset.set(0, 0, 0);
        this._writeVertices();
      }
    }

    const fade = smoothstep(this.scaleRadius * 2e-4, this.scaleRadius * 3e-3, near);
    this.material.opacity = this.baseOpacity * fade;
    this.line.visible = this.material.opacity > 0.004;
  }

  // Coarse sample of the path -- 64 probes is plenty to decide "am I near this
  // ellipse", and keeps this off the per-frame budget.
  _nearestDistance(p) {
    const src = this.absolute;
    const stride = Math.max(1, Math.floor(this.count / 64));
    let best = Infinity;
    const v = _v, e = _e;
    for (let i = 0; i < this.count; i += stride) {
      e.x = src[i * 3]; e.y = src[i * 3 + 1]; e.z = src[i * 3 + 2];
      eclipticToWorld(e, v);
      const d = v.distanceToSquared(p);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
}

export class OrbitLines {
  constructor(system) {
    this.system = system;
    this.paths = [];
    this.group = new THREE.Group();
    this.visible = true;
    this._lastRebuildJd = -Infinity;
    this._cameraLocal = new THREE.Vector3();

    for (const def of PLANETS) {
      const radius = def.elements.epoch[0] * AU;
      const path = new OrbitPath(
        samplePlanetOrbit(def.elements, J2000, SEGMENTS),
        def.color, 0.34, radius, true,
      );
      this.group.add(path.line);
      this.paths.push({ path, def, kind: 'planet' });
    }

    // Minor planets are heliocentric, so their paths live in world space and
    // need the same floating origin the planets get. Pallas's 35-degree
    // inclination makes it obvious these are not all in one plane.
    for (const def of MINOR_PLANETS) {
      const path = new OrbitPath(
        sampleKeplerianOrbit(def, SEGMENTS), def.color, 0.22, def.a, true,
      );
      this.group.add(path.line);
      this.paths.push({ path, def, kind: 'minor' });
    }

    for (const def of MOONS) {
      const record = system.byId.get(def.id);
      const anchor = record.orbitNode.parent;   // same frame the moon orbits in
      // Moon paths top out around 1.9e6 km, where float32 still resolves a
      // tenth of a kilometre, so they need no floating origin.
      const path = new OrbitPath(
        sampleKeplerianOrbit(def, MOON_SEGMENTS), def.color, 0.28, def.a, false,
      );
      anchor.add(path.line);
      this.paths.push({ path, def, kind: 'moon', record, anchor });
    }
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
    for (const p of this.paths) if (p.anchor) p.path.line.visible = v;
  }

  update(jd, cameraWorldPos) {
    if (!this.visible) return;

    // Elements drift with the per-century secular rates; once a simulated year
    // the ellipses are worth resampling.
    if (Math.abs(jd - this._lastRebuildJd) > 365) {
      this._lastRebuildJd = jd;
      for (const p of this.paths) {
        if (p.kind === 'planet') {
          p.path.setPoints(samplePlanetOrbit(p.def.elements, jd, SEGMENTS));
        }
      }
    }

    for (const p of this.paths) {
      if (p.anchor) {
        // Moons: their path hangs off the parent, so ask in the parent's frame.
        this._cameraLocal.copy(cameraWorldPos);
        p.anchor.worldToLocal(this._cameraLocal);
        p.path.update(this._cameraLocal);
      } else {
        p.path.update(cameraWorldPos);
      }
    }
  }
}

function smoothstep(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

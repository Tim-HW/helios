import * as THREE from 'three';
import { AU } from './data.js';
import { solveKepler } from './kepler.js';
import {
  ASTEROID_EPOCH, ASTEROID_COUNT, TROJAN_MIN_AU, decodeAsteroids,
} from './asteroids.js';

// The asteroid belt and the Jupiter Trojans: 22,491 real objects, propagated on
// the GPU.
//
// WHY THE GPU. Every one of these needs Kepler's equation solved every frame.
// On the CPU that is 22,491 Newton iterations per frame competing with
// everything else; in a vertex shader it is free, and the swarm then animates
// correctly at any time warp for nothing. The elements are uploaded once as
// vertex attributes and only the date changes.
//
// WHAT THIS RENDERING IS, AND ISN'T. An asteroid a few km across is invisible
// from any distance you would ever view it at. These dots are markers, exactly
// like the hollow rings on the planets -- drawn at a fixed small pixel size,
// not at a true angular size. What is honest is the geometry: every dot is a
// real catalogued object at its real position, so the structure is real. The
// Kirkwood gaps are there because Jupiter cleared them, and the two Trojan
// clouds are there because that is where the Lagrange points are.
//
// The belt's actual emptiness is reported rather than drawn -- see nearest(),
// which is the number that tells the truth a picture cannot.

// Gaussian gravitational constant: mean motion in RADIANS per day for a in AU.
const K_GAUSS = 0.01720209895;

// Objects examined per frame by nearest(); a full sweep is ~8 frames.
const SLICE = 3000;

const VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>

// NOTE: 'position' here is not a position. It carries the three shape
// elements -- a in AU,
// eccentricity, inclination in radians -- because three needs an attribute
// of that name to size the draw call, and filling a second 270 KB buffer
// with zeroes just to satisfy it would be silly.
attribute vec3 aOrbit;   // ascending node, argument of perihelion, mean anomaly at epoch
attribute float aMag;    // absolute magnitude

uniform float uDays;         // days since the element epoch
uniform float uPixelRatio;
uniform float uOpacity;

varying vec3 vTint;
varying float vFade;

void main() {
  float a = position.x;
  float e = position.y;
  float inc = position.z;

  // Mean anomaly now, wrapped before the solver so it starts near the root.
  float n = ${K_GAUSS} / (a * sqrt(a));
  float M = mod(aOrbit.z + n * uDays + PI, PI2) - PI;

  // Newton-Raphson on M = E - e sin E. Belt eccentricities top out near 0.41,
  // so four iterations is comfortably converged.
  float E = M + e * sin(M);
  for (int k = 0; k < 4; k++) {
    E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
  }

  float xp = a * (cos(E) - e);
  float yp = a * sqrt(1.0 - e * e) * sin(E);

  float cw = cos(aOrbit.y), sw = sin(aOrbit.y);
  float cn = cos(aOrbit.x), sn = sin(aOrbit.x);
  float ci = cos(inc),      si = sin(inc);

  vec3 ecl = vec3(
    (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp,
    (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp,
    (sw * si) * xp + (cw * si) * yp
  ) * ${AU.toFixed(1)};

  // Ecliptic (z-up) -> world (y-up), matching eclipticToWorld() on the CPU.
  // viewMatrix, not modelViewMatrix: the position computed above is already in
  // world space, so a model transform must not be applied on top of it. They
  // happen to be equal while this object sits unparented at the scene root,
  // which is exactly the kind of coincidence that breaks later.
  vec4 mv = viewMatrix * vec4(ecl.x, ecl.z, -ecl.y, 1.0);
  gl_Position = projectionMatrix * mv;

  // Slightly larger and brighter for the big ones. The spread is deliberately
  // narrow, so the swarm reads as one texture rather than as unrelated dots.
  float bright = clamp((14.5 - aMag) / 6.0, 0.0, 1.0);
  gl_PointSize = (1.05 + bright * 1.35) * uPixelRatio;

  // Trojans really are darker and redder than belt asteroids -- mostly D-type,
  // among the least reflective surfaces in the solar system. They are separable
  // by semi-major axis alone, since the belt ends well before they begin.
  vec3 beltTint   = vec3(0.80, 0.74, 0.63);
  vec3 trojanTint = vec3(0.66, 0.47, 0.37);
  vTint = mix(beltTint, trojanTint, step(${TROJAN_MIN_AU.toFixed(1)}, a));
  vFade = (0.30 + 0.70 * bright) * uOpacity;

  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */`
#include <logdepthbuf_pars_fragment>
varying vec3 vTint;
varying float vFade;

void main() {
  // A soft round dot; a hard square reads as noise at one pixel across.
  vec2 d = gl_PointCoord - 0.5;
  float alpha = exp(-dot(d, d) * 9.0) * vFade;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(vTint * alpha, alpha);
  #include <logdepthbuf_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class AsteroidBelt {
  constructor() {
    const el = decodeAsteroids();
    this.elements = el;
    this.count = el.count;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(el.elemA, 3));
    geometry.setAttribute('aOrbit', new THREE.BufferAttribute(el.elemB, 3));
    geometry.setAttribute('aMag', new THREE.BufferAttribute(el.mag, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uDays: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio ?? 1, 2) },
        uOpacity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geometry, this.material);
    // Positions exist only in the shader, so a CPU bounding sphere would be
    // meaningless -- and some of the swarm is on screen almost always anyway.
    this.points.frustumCulled = false;
    this.points.renderOrder = -2;

    this._nearest = null;
    this._cursor = 0;
  }

  setVisible(v) {
    this.points.visible = v;
    if (!v) { this._nearest = null; this._cursor = 0; }
  }

  get visible() { return this.points.visible; }

  update(jd) {
    this.material.uniforms.uDays.value = jd - ASTEROID_EPOCH;
  }

  // How far away the nearest catalogued asteroid actually is.
  //
  // This is the point of the whole feature. Fiction has taught everyone that a
  // belt is something you weave through; in reality the nearest of these is
  // typically millions of km away, and you could cross the belt and never come
  // close to one. A render cannot show that -- an empty screen shows nothing --
  // so the model reports it as a number instead.
  //
  // Swept in slices rather than all at once. The full pass is ~6 ms, which
  // would visibly hitch a 16 ms frame; a slice is well under one. The camera
  // position and date are snapshotted when a sweep starts so the answer stays
  // self-consistent even though it is gathered over several frames.
  nearest(cameraPos, jd) {
    if (!this.visible) return null;

    const { elemA, elemB, count } = this.elements;

    if (this._cursor === 0) {
      // Camera in ecliptic (z-up) coordinates, the frame the elements solve in.
      this._sweepX = cameraPos.x;
      this._sweepY = -cameraPos.z;
      this._sweepZ = cameraPos.y;
      this._sweepDays = jd - ASTEROID_EPOCH;
      this._sweepBest = Infinity;
      this._sweepIdx = -1;
    }

    const cx = this._sweepX, cy = this._sweepY, cz = this._sweepZ;
    const days = this._sweepDays;
    let best = this._sweepBest, bestIdx = this._sweepIdx;

    // First answer is computed in one pass so the readout is never blank; after
    // that the sweep is sliced, since by then there is a value to keep showing.
    const slice = this._nearest === null ? count : SLICE;
    const end = Math.min(this._cursor + slice, count);
    for (let k = this._cursor; k < end; k++) {
      const a = elemA[k * 3], e = elemA[k * 3 + 1], inc = elemA[k * 3 + 2];
      const nd = elemB[k * 3], w = elemB[k * 3 + 1], m0 = elemB[k * 3 + 2];

      const E = solveKepler(m0 + (K_GAUSS / (a * Math.sqrt(a))) * days, e);
      const xp = a * (Math.cos(E) - e);
      const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

      const cw = Math.cos(w), sw = Math.sin(w);
      const cn = Math.cos(nd), sn = Math.sin(nd);
      const ci = Math.cos(inc), si = Math.sin(inc);

      const x = ((cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp) * AU - cx;
      const y = ((cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp) * AU - cy;
      const z = ((sw * si) * xp + (cw * si) * yp) * AU - cz;

      const d2 = x * x + y * y + z * z;
      if (d2 < best) { best = d2; bestIdx = k; }
    }

    this._sweepBest = best;
    this._sweepIdx = bestIdx;
    this._cursor = end;

    if (this._cursor >= count) {
      this._cursor = 0;
      this._nearest = {
        distance: Math.sqrt(best),
        trojan: elemA[bestIdx * 3] >= TROJAN_MIN_AU,
        count,
      };
    }
    return this._nearest;
  }
}

export { ASTEROID_COUNT };

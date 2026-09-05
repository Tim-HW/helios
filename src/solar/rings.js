import * as THREE from 'three';
import { SATURN_RINGS } from './data.js';
import { NOISE_GLSL } from '../render/shaders/noise.js';

// Saturn's rings at their real radii. The structure below is the actual ring
// system: the translucent C ring, the dense B ring, the Cassini division (a
// genuine gap, not a shading trick), the A ring with the Encke gap cut through
// it, and the thin F ring strand outside everything.
//
// The rings also cast Saturn's shadow onto themselves, which is solved
// analytically in the fragment shader -- no shadow map could resolve a 140,000
// km disc that is only tens of metres thick.

const RING_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vLocal;
void main() {
  vLocal = position;                 // ring plane is local XY, spin axis is Z
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const RING_FRAG = /* glsl */`
#include <logdepthbuf_pars_fragment>
uniform vec3  uSunDir;        // toward the Sun, in ring-local space
uniform float uPlanetRadius;  // km
uniform float uInner;
uniform float uOuter;
uniform float uSunIntensity;
varying vec3 vLocal;

${NOISE_GLSL}

// Opacity as a function of distance from Saturn's centre, in km.
float ringDensity(float r) {
  float d = 0.0;
  d += 0.22 * smoothstep(74500.0, 77000.0, r) * (1.0 - smoothstep(90000.0, 92000.0, r));
  d += 0.92 * smoothstep(92000.0, 93500.0, r) * (1.0 - smoothstep(116500.0, 117580.0, r));
  d += 0.07 * smoothstep(117580.0, 118500.0, r) * (1.0 - smoothstep(121000.0, 122170.0, r));
  d += 0.62 * smoothstep(122170.0, 123500.0, r) * (1.0 - smoothstep(135500.0, 136775.0, r));
  d *= 1.0 - 0.85 * (smoothstep(133200.0, 133500.0, r) * (1.0 - smoothstep(133700.0, 134000.0, r)));
  d += 0.45 * smoothstep(140000.0, 140120.0, r) * (1.0 - smoothstep(140260.0, 140380.0, r));
  return d;
}

void main() {
  float r = length(vLocal.xy);
  if (r < uInner || r > uOuter) discard;

  float density = ringDensity(r);
  // Ringlets: fine radial banding, which is what the rings actually look like.
  density *= 0.72 + 0.42 * fbm(vec3(r * 0.0016, 0.0, 0.0), 5, 2.3, 0.55);
  if (density <= 0.004) discard;

  // Saturn's shadow: march from this particle toward the Sun and see whether
  // the planet gets in the way.
  vec3 p = vec3(vLocal.xy, 0.0);
  float tc = -dot(p, uSunDir);
  float shadow = 1.0;
  if (tc > 0.0) {
    float miss = length(p + tc * uSunDir);
    shadow = smoothstep(uPlanetRadius * 0.985, uPlanetRadius * 1.03, miss);
  }

  vec3 icy = mix(vec3(0.62, 0.56, 0.46), vec3(0.92, 0.88, 0.78),
                 smoothstep(0.2, 0.9, density));
  // Looking at the unlit face you see light filtered through the rings, so the
  // dense B ring goes dark while the thin C ring glows.
  float facing = abs(dot(vec3(0.0, 0.0, 1.0), uSunDir));
  float unlit = gl_FrontFacing ? 1.0 : mix(0.10, 0.45, 1.0 - density);
  vec3 col = icy * (0.25 + 0.75 * facing) * unlit * shadow * uSunIntensity;

  gl_FragColor = vec4(col, clamp(density, 0.0, 1.0));
  #include <logdepthbuf_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSaturnRings(planetRadius) {
  const { inner, outer } = SATURN_RINGS;
  const geometry = new THREE.RingGeometry(inner, outer, 256, 8);

  const material = new THREE.ShaderMaterial({
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uPlanetRadius: { value: planetRadius },
      uInner: { value: inner },
      uOuter: { value: outer },
      uSunIntensity: { value: 1 },
    },
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // RingGeometry is built in XY; the caller parents this to the planet's spin
  // frame, whose axis is +Y, so lay it flat.
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  return mesh;
}

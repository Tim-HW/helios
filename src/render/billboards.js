import * as THREE from 'three';

// Camera-facing quads, sized either in world units (the Sun's corona) or in
// screen pixels (the navigation markers).
//
// Both billboard in the vertex shader by transforming only the object's ORIGIN
// through the model-view matrix and then offsetting in view/clip space. That
// keeps the quad exactly camera-facing without any CPU-side lookAt, and it
// means the quad's own vertex coordinates stay tiny, which matters when the
// object itself sits 4.5 billion km from the origin.

const QUAD = new THREE.PlaneGeometry(2, 2);

// --- Sun corona -------------------------------------------------------------

const CORONA_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uSize;          // world-space half-width, km
varying vec2 vQuad;
void main() {
  vQuad = position.xy;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const CORONA_FRAG = /* glsl */`
#include <logdepthbuf_pars_fragment>
uniform float uCoreFraction;  // where the photosphere edge falls in the quad
varying vec2 vQuad;
void main() {
  float d = length(vQuad);
  if (d > 1.0) discard;
  // Two stacked falloffs: a tight bright halo just off the limb, and a broad
  // faint one for the outer corona.
  float inner = exp(-pow(max(d - uCoreFraction, 0.0) * 14.0, 1.1));
  float outer = exp(-pow(max(d - uCoreFraction, 0.0) * 3.4, 1.6));
  float a = clamp(inner * 0.85 + outer * 0.30, 0.0, 1.0);
  vec3 col = mix(vec3(1.0, 0.55, 0.20), vec3(1.0, 0.96, 0.88), inner);
  gl_FragColor = vec4(col * a, a);
  #include <logdepthbuf_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createCorona() {
  const material = new THREE.ShaderMaterial({
    vertexShader: CORONA_VERT,
    fragmentShader: CORONA_FRAG,
    uniforms: {
      uSize: { value: 1 },
      uCoreFraction: { value: 0.2 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(QUAD, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

// --- Navigation markers -----------------------------------------------------
//
// At true scale a planet is usually far smaller than one pixel, so without help
// the solar system is an empty black void that you cannot navigate.
//
// The marker is deliberately a HOLLOW RING, never a filled disc: a ring reads as
// an annotation pointing at something, while a disc would read as the body
// itself and would quietly undo the whole premise of the app. It fades in only
// as the true disc drops below a few pixels, and fades back out as you approach
// and the real body takes over.

const MARKER_VERT = /* glsl */`
#include <common>
uniform float uPixelRadius;
uniform vec2  uResolution;
varying vec2 vQuad;
void main() {
  vQuad = position.xy;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 clip = projectionMatrix * mv;
  // One pixel spans 2/resolution in NDC, and NDC = clip.xy / clip.w.
  clip.xy += position.xy * uPixelRadius * 2.0 / uResolution * clip.w;
  gl_Position = clip;
}
`;

const MARKER_FRAG = /* glsl */`
uniform vec3  uColor;
uniform float uOpacity;
varying vec2 vQuad;
void main() {
  float d = length(vQuad);
  float ring = smoothstep(0.55, 0.68, d) * (1.0 - smoothstep(0.84, 0.98, d));
  float a = ring * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export function createMarker(color) {
  const material = new THREE.ShaderMaterial({
    vertexShader: MARKER_VERT,
    fragmentShader: MARKER_FRAG,
    uniforms: {
      uPixelRadius: { value: 7 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,     // markers are annotations; they are never occluded
  });
  const mesh = new THREE.Mesh(QUAD, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 100;
  return mesh;
}

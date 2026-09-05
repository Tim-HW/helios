import * as THREE from 'three';

// A procedural sky. The stars sit on a shell that follows the camera and render
// before everything else with depth testing off, so they are always infinitely
// far away: never occluding a planet, always occluded by one.
//
// Brightness follows a rough magnitude distribution (many faint, few bright)
// and colour follows a blue-white-orange temperature spread, which is enough to
// stop the sky looking like uniform white confetti.

const VERT = /* glsl */`
uniform float uPixelRatio;
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
varying float vSize;
void main() {
  vColor = aColor;
  vSize = aSize;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio;
}
`;

const FRAG = /* glsl */`
varying vec3 vColor;
varying float vSize;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = exp(-r * r * 4.5) * (1.0 - smoothstep(0.75, 1.0, r));
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

export function createStarfield(count = 9000, radius = 5e8) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  // A deterministic generator, so the sky is the same every session.
  let seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) / 4294967296);
  };

  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // Uniform on the sphere: z uniform, longitude uniform.
    const z = rand() * 2 - 1;
    const t = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    positions[i * 3] = Math.cos(t) * r * radius;
    positions[i * 3 + 1] = z * radius;
    positions[i * 3 + 2] = Math.sin(t) * r * radius;

    // Steeply weighted toward the faint end, like a real magnitude count.
    const mag = Math.pow(rand(), 3.2);
    sizes[i] = 0.7 + mag * 3.0;

    const temp = rand();
    if (temp < 0.10) color.setRGB(0.72, 0.80, 1.00);       // hot blue-white
    else if (temp < 0.42) color.setRGB(0.95, 0.96, 1.00);  // white
    else if (temp < 0.78) color.setRGB(1.00, 0.95, 0.84);  // yellow-white
    else color.setRGB(1.00, 0.80, 0.62);                   // orange
    const b = 0.35 + mag * 0.75;
    colors[i * 3] = color.r * b;
    colors[i * 3 + 1] = color.g * b;
    colors[i * 3 + 2] = color.b * b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    // NOT flagged transparent, deliberately. three draws the entire opaque
    // queue before any transparent object, so a transparent starfield would
    // paint over every planet no matter what renderOrder says. Left opaque, it
    // sorts to the front of the opaque queue and everything covers it -- while
    // `blending` still applies, because that is independent of the queue.
    transparent: false,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -1000;   // drawn first; everything paints over it
  return points;
}

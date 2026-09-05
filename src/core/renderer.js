import * as THREE from 'three';

// The whole scene is measured in kilometres, spanning from a 6 km moonlet to a
// 4.5 billion km orbit. That is a depth range of about 1e10, which an ordinary
// depth buffer cannot resolve -- you get z-fighting everywhere at once.
//
// logarithmicDepthBuffer spreads precision evenly across the decades instead of
// concentrating it near the near plane, which is exactly the distribution this
// scene needs. Its cost is that every custom ShaderMaterial must splice in the
// logdepthbuf chunks (render/material.js does this) or that object will ignore
// depth entirely -- a confusing failure to debug if you hit it cold.

// 2 m. The ISS is 109 m long, so a 100 m near plane sliced it in half the
// moment you got close enough to look at it. A logarithmic depth buffer spreads
// precision evenly across the decades, so buying four more of them at the near
// end costs essentially nothing.
export const NEAR = 0.002;
export const FAR = 1e10;    // ~67 AU, comfortably past Pluto

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    logarithmicDepthBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 1);
  // Neutral rolls off the Sun's highlights without the desaturation ACES gives
  // the planets, which matters when the albedo colours are the whole point.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  if (!renderer.capabilities.logarithmicDepthBuffer) {
    console.warn('[helios] logarithmic depth buffer unavailable; expect z-fighting');
  }
  return renderer;
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    55, window.innerWidth / window.innerHeight, NEAR, FAR,
  );
  return camera;
}

export function handleResize(renderer, camera) {
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);
  return onResize;
}

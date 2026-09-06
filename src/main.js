import * as THREE from 'three';
import { createRenderer, createCamera, handleResize } from './core/renderer.js';
import { SimClock } from './core/clock.js';
import { runSelfCheck } from './core/selfcheck.js';
import { installDiagnostics } from './core/diagnostics.js';
import { SolarSystem } from './solar/bodies.js';
import { OrbitLines } from './solar/orbits.js';
import { AsteroidBelt } from './solar/belt.js';
import { Spacecraft } from './solar/spacecraft.js';
import { CRAFT } from './solar/data.js';
import { createStarfield } from './render/starfield.js';
import { FlyCamera } from './camera/flycam.js';
import { Labels } from './ui/labels.js';
import { initTouchUI } from './ui/touch.js';
import { Hud } from './ui/hud.js';
import { createViewpoints } from './ui/viewpoints.js';

// Before anything builds a shader, so a link failure is visible on screen
// rather than only in a console you would have had to be watching.
installDiagnostics();

const canvas = document.getElementById('view');
const renderer = createRenderer(canvas);
const camera = createCamera();
const scene = new THREE.Scene();

const system = new SolarSystem();
scene.add(system.root);

const orbits = new OrbitLines(system);
scene.add(orbits.group);

const belt = new AsteroidBelt();
scene.add(belt.points);

const craft = CRAFT.map((def) => new Spacecraft(system, scene, def));

const starfield = createStarfield();
scene.add(starfield);

const clock = new SimClock(new Date());
const flycam = new FlyCamera(camera, system, canvas);

// Phone-sized screens need a menu, a collapsible readout and a way to fly.
initTouchUI({ flycam });

const options = {
  showOrbits: true,
  showLabels: true,
  showMarkers: true,
  showBelt: true,
  realisticLight: false,
  exaggeration: 1,
  time: 0,
};

const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
const onResize = handleResize(renderer, camera);
window.addEventListener('resize', () => {
  resolution.set(window.innerWidth, window.innerHeight);
});
onResize();

const labels = new Labels(
  document.getElementById('labels'), system, (body) => flycam.goTo(body),
);

const hud = new Hud({
  clock, flycam, system, orbits, labels, belt, craft, options,
  presets: createViewpoints(system, flycam),
});

// --- frame ------------------------------------------------------------------

let last = performance.now();
let wall = 0;

// One simulation + render step. Order matters: bodies move, then the camera
// (which rides on a body) moves, then everything that depends on where the
// camera ended up is computed, and only then do we draw.
function step(dt) {
  wall += dt;
  options.time = wall;
  clock.advance(dt);

  system.updatePositions(clock.jd);
  // Craft move with the planets, not after the camera: they travel more than
  // their own length between frames, so being one frame stale is very visible.
  for (const c of craft) c.updatePosition(clock.jd);
  flycam.update(dt);
  // The renderer would refresh these itself, but not until render() -- and the
  // HUD and labels project world points through matrixWorldInverse before then.
  // Without this they run a frame behind, and on the very first frame they
  // project through an identity matrix and land in the wrong place entirely.
  camera.updateMatrixWorld(true);

  system.setExaggeration(options.exaggeration);
  system.updateAppearance(camera, resolution, options);
  orbits.update(clock.jd, camera.position);
  for (const c of craft) c.updateVisuals(camera.position);
  belt.update(clock.jd);
  starfield.position.copy(camera.position);

  labels.update(camera, resolution);
  hud.update(camera, resolution, wall);
  renderer.render(scene, camera);
}

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  step(dt);
  requestAnimationFrame(frame);
}

// Draw one frame synchronously before dismissing the loader, so the app never
// flashes black in the gap before the first animation frame.
step(0);
runSelfCheck();
document.getElementById('boot').classList.add('hidden');
requestAnimationFrame((t) => { last = t; frame(t); });

// Handy for poking at the model from the console.
window.helios = { system, flycam, clock, camera, renderer, options, scene, belt, craft };

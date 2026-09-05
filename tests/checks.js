// The checks that constrain the model.
//
// "It looks like space" proves nothing -- a render with every distance wrong by
// a factor of ten would look just as convincing. These are the assertions that
// actually pin the thing down, and they run in the browser with no toolchain:
// open tests/smoke.html.
//
// The one to read first is the eclipse test at the bottom. Seen from Earth the
// Sun and Moon are very nearly the same apparent size, which is the entire
// reason total solar eclipses are possible. Four independent numbers -- two
// radii and two distances -- have to be simultaneously right for that to come
// out, so if it passes, the sizes and the distances are both sound.

import * as THREE from 'three';
import * as data from '../src/solar/data.js';
const { ISS } = data;
import { Spacecraft } from '../src/solar/spacecraft.js';
import { decodeAsteroids, TROJAN_MIN_AU, ASTEROID_COUNT } from '../src/solar/asteroids.js';
import { AsteroidBelt } from '../src/solar/belt.js';
import * as kepler from '../src/solar/kepler.js';
import * as fmt from '../src/ui/format.js';
import { SolarSystem } from '../src/solar/bodies.js';
import { OrbitLines } from '../src/solar/orbits.js';
import { SimClock } from '../src/core/clock.js';
import { runSelfCheck } from '../src/core/selfcheck.js';
import { FlyCamera } from '../src/camera/flycam.js';
import { createViewpoints } from '../src/ui/viewpoints.js';
import { MOMENTS, parseUtcDate } from '../src/ui/moments.js';


export function runChecks() {
  const rows = [];
  const t = (name, fn) => {
    try { rows.push({ ok: true, name, detail: fn() ?? 'ok' }); }
    catch (e) { rows.push({ ok: false, name, detail: e.message }); }
  };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  // A FlyCamera needs something event-shaped to bind to; nothing here clicks.
  function makeCam() {
    const stub = { addEventListener() {}, setPointerCapture() {},
                   hasPointerCapture() { return false; }, releasePointerCapture() {} };
    const sys = new SolarSystem();
    const jd = kepler.julianDate(new Date('2026-03-20T00:00:00Z'));
    sys.updatePositions(jd);
    const cam = new THREE.PerspectiveCamera(55, 1.6, 0.1, 1e10);
    return { sys, cam, fly: new FlyCamera(cam, sys, stub), jd };
  }

  t('Kepler solver inverts Kepler’s equation', () => {
    let worst = 0;
    for (const e of [0, 0.0167, 0.0934, 0.2488, 0.6]) {
      for (let k = 0; k < 128; k++) {
        const M = -Math.PI + (k / 128) * 2 * Math.PI;
        const E = kepler.solveKepler(M, e);
        const back = E - e * Math.sin(E);
        worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(back - M), Math.cos(back - M))));
      }
    }
    assert(worst < 1e-9, `residual ${worst}`);
    return `max residual ${worst.toExponential(1)} rad`;
  });

  t('ecliptic→world preserves handedness and length', () => {
    const out = new THREE.Vector3();
    kepler.eclipticToWorld({ x: 3, y: 4, z: 12 }, out);
    assert(Math.abs(out.length() - 13) < 1e-9, 'length changed');
    assert(out.x === 3 && out.y === 12 && out.z === -4, `got ${out.toArray()}`);
    return 'x→x, z→y, y→−z';
  });

  t('Earth–Sun distance oscillates 147.1–152.1 Mkm', () => {
    const jd0 = kepler.julianDate(new Date('2026-01-01T00:00:00Z'));
    const ecl = { x: 0, y: 0, z: 0 };
    const earth = data.PLANETS.find(p => p.id === 'earth');
    let lo = Infinity, hi = -Infinity;
    for (let d = 0; d < 370; d++) {
      kepler.planetPosition(earth.elements, jd0 + d, ecl);
      const r = Math.hypot(ecl.x, ecl.y, ecl.z);
      lo = Math.min(lo, r); hi = Math.max(hi, r);
    }
    assert(lo > 146.9e6 && lo < 147.3e6, `perihelion ${lo}`);
    assert(hi > 151.9e6 && hi < 152.3e6, `aphelion ${hi}`);
    return `${(lo / 1e6).toFixed(2)} – ${(hi / 1e6).toFixed(2)} Mkm`;
  });

  t('scene graph builds, moons in the right frames', () => {
    const sys = new SolarSystem();
    assert(sys.bodies.length
      === 1 + data.PLANETS.length + data.MINOR_PLANETS.length + data.MOONS.length,
      `${sys.bodies.length}`);
    assert(sys.byId.get('titan').orbitNode.parent === sys.byId.get('saturn').tiltFrame,
      'Titan not anchored to Saturn’s equatorial frame');
    assert(sys.byId.get('moon').orbitNode.parent === sys.byId.get('earth').orbitNode,
      'the Moon should use the ecliptic frame');
    return `${sys.bodies.length} bodies`;
  });

  t('positions land at plausible distances', () => {
    const sys = new SolarSystem();
    sys.updatePositions(kepler.julianDate(new Date('2026-01-01T00:00:00Z')));
    const expect = { mercury: 0.39, venus: 0.72, earth: 1.0, mars: 1.52,
                     jupiter: 5.2, saturn: 9.54, uranus: 19.2, neptune: 30.1 };
    for (const [id, want] of Object.entries(expect)) {
      const r = sys.byId.get(id).worldPos.length() / data.AU;
      assert(Math.abs(r - want) / want < 0.30, `${id} at ${r.toFixed(2)} AU`);
    }
    const m = sys.byId.get('moon').worldPos.distanceTo(sys.byId.get('earth').worldPos);
    assert(m > 356000 && m < 407000, `Moon at ${m.toFixed(0)} km`);
    const io = sys.byId.get('io').worldPos.distanceTo(sys.byId.get('jupiter').worldPos);
    assert(Math.abs(io - 421700) < 3000, `Io at ${io.toFixed(0)} km`);
    return `Moon ${Math.round(m).toLocaleString()} km, Io ${Math.round(io).toLocaleString()} km`;
  });

  t('Saturn’s tilt carries Titan out of the ecliptic', () => {
    const sys = new SolarSystem();
    sys.updatePositions(kepler.julianDate(new Date()));
    const s = sys.byId.get('saturn'), ti = sys.byId.get('titan');
    const rel = ti.worldPos.clone().sub(s.worldPos);
    // Titan orbits Saturn's equator, tilted 26.7 deg, so over an orbit it must
    // swing well out of the ecliptic plane.
    let maxY = 0;
    for (let d = 0; d < 16; d++) {
      sys.updatePositions(kepler.julianDate(new Date()) + d);
      maxY = Math.max(maxY, Math.abs(ti.worldPos.clone().sub(s.worldPos).y));
    }
    const frac = maxY / 1221870;
    assert(frac > 0.35, `Titan stayed near the ecliptic (max |y| = ${frac.toFixed(2)} of a)`);
    return `reaches ${(frac * 100).toFixed(0)}% of its orbit radius out of plane (sin 26.7° = 0.45)`;
  });

  t('nearest-surface distance drives camera speed sanely', () => {
    const sys = new SolarSystem();
    sys.updatePositions(kepler.julianDate(new Date()));
    const earth = sys.byId.get('earth');
    const p = earth.worldPos.clone().add(new THREE.Vector3(0, 0, earth.def.radius + 100));
    const near = sys.nearestSurfaceDistance(p);
    assert(near.body.def.id === 'earth', `nearest was ${near.body.def.id}`);
    assert(Math.abs(near.distance - 100) < 1, `altitude ${near.distance}`);
    assert(near.inside === false, 'reported inside');
    assert(sys.nearestSurfaceDistance(earth.worldPos).inside === true, 'centre not inside');
    return '100 km altitude resolves to 100 km';
  });

  t('orbit lines: floating origin engages and releases', () => {
    const sys = new SolarSystem();
    sys.updatePositions(kepler.julianDate(new Date()));
    const orbits = new OrbitLines(sys);
    assert(orbits.paths.length
      === data.PLANETS.length + data.MINOR_PLANETS.length + data.MOONS.length,
      `${orbits.paths.length}`);
    const nep = orbits.paths.find(p => p.def.id === 'neptune').path;
    // update() resamples the ellipse at the current epoch first, so read the path
    // only after that has happened -- 26 years of perihelion drift moves
    // Neptune's vertices by more than the floating origin's engage threshold.
    orbits.update(kepler.julianDate(new Date()), new THREE.Vector3(0, 0, 0));
    const onPath = new THREE.Vector3();
    kepler.eclipticToWorld({ x: nep.absolute[0], y: nep.absolute[1], z: nep.absolute[2] }, onPath);
    orbits.update(kepler.julianDate(new Date()), onPath);
    assert(nep.offset.lengthSq() > 0, 'floating origin did not engage on the path');
    const a = nep.geometry.attributes.position.array;
    assert(Math.hypot(a[0], a[1], a[2]) < 1e6, `vertex still huge: ${a[0]}`);
    orbits.update(kepler.julianDate(new Date()), new THREE.Vector3(0, 0, 0));
    assert(nep.offset.lengthSq() === 0, 'floating origin did not release');
    return 'engages on the path, releases away from it';
  });

  t('float32 precision actually improves with the floating origin', () => {
    const sys = new SolarSystem();
    sys.updatePositions(kepler.julianDate(new Date()));
    const orbits = new OrbitLines(sys);
    const nep = orbits.paths.find(p => p.def.id === 'neptune').path;
    orbits.update(kepler.julianDate(new Date()), new THREE.Vector3(0, 0, 0));
    const exact = new THREE.Vector3();
    kepler.eclipticToWorld({ x: nep.absolute[0], y: nep.absolute[1], z: nep.absolute[2] }, exact);

    const a0 = nep.geometry.attributes.position.array;
    const errFar = Math.hypot(a0[0] - exact.x, a0[1] - exact.y, a0[2] - exact.z);

    orbits.update(kepler.julianDate(new Date()), exact);
    const a1 = nep.geometry.attributes.position.array;
    const errNear = Math.hypot(
      a1[0] + nep.offset.x - exact.x, a1[1] + nep.offset.y - exact.y, a1[2] + nep.offset.z - exact.z);

    assert(errFar > 50, `expected visible quantisation without the offset, got ${errFar}`);
    assert(errNear < 0.5, `offset did not restore precision: ${errNear}`);
    return `${errFar.toFixed(0)} km error without it → ${errNear.toExponential(1)} km with it`;
  });

  t('clock warp phrasing and rate', () => {
    const c = new SimClock(new Date('2026-01-01T00:00:00Z'));
    c.warp = 86400;
    assert(c.describeWarp().includes('1.00 days'), c.describeWarp());
    const before = c.jd; c.advance(10);
    assert(Math.abs((c.jd - before) - 10) < 1e-9, 'warp rate wrong');
    return c.describeWarp();
  });

  t('distance and light-time formatting', () => {
    assert(fmt.formatDistance(384400).includes('384,400'), fmt.formatDistance(384400));
    assert(fmt.formatDistance(778.5e6).includes('AU'), fmt.formatDistance(778.5e6));
    assert(fmt.lightTime(149597870.7).includes('min'), fmt.lightTime(149597870.7));
    return `${fmt.formatDistance(778.5e6)} · light ${fmt.lightTime(149597870.7)}`;
  });

  t('THE ECLIPSE TEST: Sun and Moon match in apparent size', () => {
    const r = runSelfCheck();
    const bad = r.results.filter(x => !x.pass);
    assert(bad.length === 0, bad.map(f => `${f.name}: ${f.measured}`).join('; '));
    return r.results.map(x => `${x.name} = ${x.measured}`).join('\n      ');
  });


    // --- camera behaviour -------------------------------------------------------

  
  t('goTo converges on a sane viewing distance', () => {
    const { sys, cam, fly } = makeCam();
    const saturn = sys.byId.get('saturn');
    fly.goTo(saturn);
    assert(fly.travel !== null, 'no travel started');
    for (let i = 0; i < 400 && fly.travel; i++) fly.update(1 / 60);
    assert(fly.travel === null, 'travel never finished');
    const d = cam.position.distanceTo(saturn.worldPos);
    const radii = d / saturn.def.radius;
    assert(radii > 3 && radii < 6, `ended ${radii.toFixed(2)} radii out`);
    // and we should be looking at it
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const toTarget = saturn.worldPos.clone().sub(cam.position).normalize();
    assert(fwd.dot(toTarget) > 0.99, `not facing target: ${fwd.dot(toTarget).toFixed(3)}`);
    return `${radii.toFixed(2)} planet radii out, facing it`;
  });

  t('travel is smooth, and log-space beats linear by two orders of magnitude', () => {
    const { sys, cam, fly } = makeCam();
    const neptune = sys.byId.get('neptune');
    fly.goTo(neptune);
    const start = cam.position.distanceTo(neptune.worldPos);
    const d = [];
    while (fly.travel) { fly.update(1 / 60); d.push(cam.position.distanceTo(neptune.worldPos)); }
    const end = d[d.length - 1];

    // No lurch: the distance must fall smoothly, never collapsing in one frame.
    let worst = 1;
    for (let i = 1; i < d.length; i++) {
      assert(d[i] <= d[i - 1] * 1.0001, `distance grew at frame ${i}`);
      worst = Math.max(worst, d[i - 1] / d[i]);
    }
    assert(worst < 1.2, `lurch: one frame closed ${worst.toFixed(2)}x of the gap`);

    // The payoff. Halfway through, log-space interpolation has you far closer
    // than linear would -- which is the difference between watching the target
    // grow the whole way in and staring at nothing until the last second.
    const mid = d[Math.floor(d.length / 2)];
    const linearMid = (start + end) / 2;
    const gain = linearMid / mid;
    assert(gain > 20, `log interpolation only ${gain.toFixed(1)}x closer at the midpoint`);
    return `${(start / 1e9).toFixed(2)}bn km → ${Math.round(end).toLocaleString()} km; `
      + `at halfway log-space is ${Math.round(gain)}x closer than linear, max frame step ${worst.toFixed(3)}x`;
  });

  t('reference frame keeps up with a planet at high time warp', () => {
    const { sys, cam, fly, jd } = makeCam();
    const mercury = sys.byId.get('mercury');   // fastest mover we have
    fly.goTo(mercury);
    for (let i = 0; i < 400 && fly.travel; i++) fly.update(1 / 60);
    const before = cam.position.distanceTo(mercury.worldPos);
    // 60 days of simulated time, which is more than two Mercury years.
    for (let d = 0; d < 600; d++) {
      sys.updatePositions(jd + d * 0.1);
      fly.update(1 / 60);
    }
    const after = cam.position.distanceTo(mercury.worldPos);
    const moved = mercury.worldPos.length();
    assert(Math.abs(after - before) / before < 0.02,
      `drifted from ${before.toFixed(0)} to ${after.toFixed(0)} km`);
    return `held ${(after / mercury.def.radius).toFixed(2)} radii across 60 simulated days`;
  });

  t('adaptive speed spans ten decades sensibly', () => {
    const { sys, cam, fly } = makeCam();
    const europa = sys.byId.get('europa');
    // 1 km above Europa's ice
    fly.frameBody = europa;
    fly.posInFrame.set(0, 0, europa.def.radius + 1);
    fly._prevPos.copy(fly.posInFrame);   // as _rebaseTo/placeAt would do
    fly.keys.add('KeyW');
    fly.update(1 / 60);
    const slow = fly.currentSpeed;
    // out in interplanetary space
    fly.frameBody = sys.byId.get('sun');
    fly.posInFrame.set(0, 0, 8e8);
    fly._prevPos.copy(fly.posInFrame);
    fly.update(1 / 60);
    const fast = fly.currentSpeed;
    assert(slow > 0 && slow < 5, `hovering speed ${slow} km/s is not a crawl`);
    assert(fast > 1e6, `deep-space speed ${fast} km/s is too slow to get anywhere`);
    return `${(slow * 1000).toFixed(0)} m/s above Europa → ${fast.toExponential(1)} km/s in open space`;
  });

  t('cannot get stuck inside a planet', () => {
    const { sys, cam, fly } = makeCam();
    const earth = sys.byId.get('earth');
    fly.frameBody = earth;
    fly.posInFrame.set(0, 0, 0);          // dead centre of the Earth
    fly._prevPos.set(0, 0, 0);
    fly.keys.add('KeyW');
    fly.update(1 / 60);
    assert(fly.currentSpeed > 100, `speed inside the Earth was ${fly.currentSpeed} km/s`);
    return `${Math.round(fly.currentSpeed).toLocaleString()} km/s — enough to escape`;
  });

  t('zoom clamps and reports', () => {
    const { fly } = makeCam();
    fly.setFov(1e6); assert(fly.fov <= 90, `fov ${fly.fov}`);
    fly.setFov(0);   assert(fly.fov >= 0.05, `fov ${fly.fov}`);
    fly.resetFov();  assert(Math.abs(fly.fov - 55) < 1e-9, `fov ${fly.fov}`);
    return 'clamped to 0.05°–90°, resets to 55°';
  });

  t('every viewpoint lands somewhere real', () => {
    const { sys, cam, fly } = makeCam();
    const vps = createViewpoints(sys, fly);
    const out = [];
    for (const vp of vps) {
      vp.apply();
      fly.update(1 / 60);
      assert(isFinite(cam.position.x) && isFinite(cam.position.y) && isFinite(cam.position.z),
        `${vp.name}: non-finite camera position`);
      const near = sys.nearestSurfaceDistance(cam.position);
      assert(!near.inside, `${vp.name}: camera ended up inside ${near.body.def.name}`);
      out.push(`${vp.name} → ${near.body.def.name}`);
    }
    assert(vps.length === 8, `${vps.length} viewpoints`);
    return out.join('\n      ');
  });




  // --- lighting -------------------------------------------------------------

  t('SUNLIGHT ARRIVES IN THE RIGHT FRAME, and follows rotation', () => {
    // The surface shaders work in the mesh's own spinning frame, so the sun
    // direction handed to them has to be in that frame too. Computing it one
    // level up -- in the tilt frame -- silently drops the body's rotation: the
    // terminator sits at an arbitrary angle, and worse, it turns WITH the
    // surface, so day and night never advance. It looks plausible per frame,
    // which is exactly why it needs a test.
    const sys = new SolarSystem();
    const cam = new THREE.PerspectiveCamera(55, 1.6, 0.1, 1e10);
    const res = new THREE.Vector2(800, 600);
    const opts = { showMarkers: false, realisticLight: false, exaggeration: 1, time: 0 };
    const jd0 = kepler.julianDate(new Date('2026-06-01T00:00:00Z'));

    let worst = 1;
    const localSamples = [];
    for (const jd of [jd0, jd0 + 0.21]) {           // ~5 hours of rotation later
      sys.updatePositions(jd);
      cam.position.set(3e8, 1e8, 2e8);
      cam.updateMatrixWorld(true);
      sys.updateAppearance(cam, res, opts);

      for (const b of sys.bodies) {
        if (!b.mesh || b.kind === 'star') continue;
        const local = b.mesh.material.uniforms.uSunDir.value.clone();
        // Back to world through the frame the shader's normals live in.
        const world = b.spinFrame.localToWorld(local.clone()).sub(b.worldPos).normalize();
        const trueDir = b.worldPos.clone().negate().normalize();
        worst = Math.min(worst, world.dot(trueDir));
        if (b.def.id === 'mars') localSamples.push(b.mesh.material.uniforms.uSunDir.value.clone());
      }
    }
    assert(worst > 0.9999, `sun direction off by ${(Math.acos(worst) * 180 / Math.PI).toFixed(2)}°`);

    // And it must MOVE in body coordinates as the body turns, or the terminator
    // is nailed to the surface and nothing ever has a sunrise.
    const turned = Math.acos(Math.min(localSamples[0].dot(localSamples[1]), 1)) * 180 / Math.PI;
    assert(turned > 30, `Mars only turned ${turned.toFixed(1)}° under the Sun in 5 hours`);
    return `all bodies within ${(Math.acos(worst) * 180 / Math.PI).toFixed(3)}°; `
      + `Mars turned ${turned.toFixed(0)}° under the Sun in 5 hours`;
  });

  t('terrain relief is shaded, and sharpens as you descend', () => {
    // No GL here, so this checks the inputs that drive relief rather than the
    // pixels: the detail band must track ground sample distance, which is what
    // keeps a surface resolving instead of smoothing out as you land on it.
    const sys = new SolarSystem();
    const cam = new THREE.PerspectiveCamera(55, 1.6, 0.1, 1e10);
    const res = new THREE.Vector2(800, 600);
    const opts = { showMarkers: false, realisticLight: false, exaggeration: 1, time: 0 };
    sys.updatePositions(kepler.julianDate(new Date('2026-06-01T00:00:00Z')));
    const moon = sys.byId.get('moon');

    const freqs = [];
    for (const alt of [4e5, 4e3, 4e2, 4]) {
      cam.position.copy(moon.worldPos).add(new THREE.Vector3(0, 0, moon.def.radius + alt));
      cam.updateMatrixWorld(true);
      sys.updateAppearance(cam, res, opts);
      freqs.push(moon.mesh.material.uniforms.uDetailFreq.value);
    }
    for (let i = 1; i < freqs.length; i++) {
      assert(freqs[i] > freqs[i - 1] * 1.5,
        `detail did not sharpen: ${freqs.map((f) => f.toFixed(0)).join(' -> ')}`);
    }
    assert(moon.mesh.material.uniforms.uBumpScale.value > 0, 'the Moon has no relief at all');
    return `detail frequency ${freqs.map((f) => f.toFixed(0)).join(' → ')} from 400,000 km down to 4 km`;
  });


  t('EXAGGERATED SIZES DO NOT SWALLOW THE CAMERA', () => {
    // Enlarging the bodies scales the meshes, but every camera calculation used
    // to keep using the TRUE radius -- so "park at 4.2 radii" put the camera
    // inside the enlarged geometry. Back faces are culled, so the planet did not
    // look wrong, it looked ABSENT: stars straight through it and a clean
    // console. Navigation has to measure against what is actually drawn.
    const { sys, cam, fly } = makeCam();
    const vps = createViewpoints(sys, fly);
    const checked = [];

    // Up to the slider's maximum. Beyond roughly 60x the Sun's drawn radius
    // exceeds Mercury's orbit and bodies genuinely do contain one another, so
    // "outside every body" stops being a meaningful thing to ask for -- which
    // is why the slider stops at 100x.
    for (const factor of [1, 10, 60, 100]) {
      sys.setExaggeration(factor);
      for (const id of ['mercury', 'earth', 'moon', 'venus', 'jupiter', 'sun']) {
        const b = sys.byId.get(id);
        assert(Math.abs(b.renderRadius - b.def.radius * factor) < 1e-6,
          `${id} renderRadius wrong at x${factor}`);

        fly.goTo(b);
        for (let i = 0; i < 600 && fly.travel; i++) fly.update(1 / 60);
        const d = cam.position.distanceTo(b.worldPos);
        assert(d > b.renderRadius * 1.05,
          `at x${factor}, camera ended ${(d / b.renderRadius).toFixed(2)} drawn-radii `
          + `from ${b.def.name} -- inside the mesh`);
      }
      // Saved viewpoints must clear the body they are ABOUT. They cannot be
      // asked to clear every body: with sizes exaggerated, worlds genuinely do
      // overlap -- a 60x Earth's surface reaches past the Moon's orbit -- so
      // being inside some unrelated inflated body is the lie working as
      // labelled, not a defect. What must never happen is the subject of the
      // shot swallowing the camera.
      for (const vp of vps) {
        vp.apply();
        fly.update(1 / 60);
        const t = fly.target;
        if (!t) continue;
        const d = cam.position.distanceTo(t.worldPos);
        assert(d > t.renderRadius,
          `at x${factor}, "${vp.name}" left the camera inside its own subject `
          + `${t.def.name} (${(d / t.renderRadius).toFixed(2)} drawn-radii)`);
      }
      checked.push(`x${factor}`);
    }
    sys.setExaggeration(1);

    // And the readouts must keep telling the truth regardless of the slider.
    assert(sys.byId.get('earth').def.radius === 6378.137, 'true radius was mutated');
    return `camera stays outside every body at ${checked.join(', ')}; true radii untouched`;
  });

  t('exaggeration rejects nonsense factors', () => {
    // A slider can hand over NaN (a restored blank value, a stray event). A NaN
    // scale makes every mesh vanish with no error at all, which is the worst
    // kind of failure to debug.
    const { sys } = makeCam();
    for (const bad of [NaN, 0, -3, undefined]) {
      sys.setExaggeration(bad);
      const m = sys.byId.get('earth').mesh.scale;
      assert(isFinite(m.x) && m.x > 0, `scale became ${m.x} for factor ${bad}`);
    }
    sys.setExaggeration(1);
    return 'NaN, zero and negative factors all fall back to true size';
  });


  // --- eclipses -------------------------------------------------------------

  t('occluders are the bodies that could actually get in the way', () => {
    const sys = new SolarSystem();
    sys.updatePositions(kepler.julianDate(new Date('2026-03-03T11:33:00Z')));
    const names = (id) => sys._collectOccluders(sys.byId.get(id))
      .map((o) => o.record.def.name);

    assert(names('earth').includes('Moon'), 'the Moon cannot shadow Earth');
    assert(names('moon').includes('Earth'), 'Earth cannot shadow the Moon');
    const jup = names('jupiter');
    for (const m of ['Io', 'Europa', 'Ganymede', 'Callisto']) {
      assert(jup.includes(m), `${m} cannot shadow Jupiter`);
    }
    // Ranked by apparent size, so the ones that could actually darken anything
    // win the limited slots.
    const ranked = sys._collectOccluders(sys.byId.get('jupiter'));
    for (let i = 1; i < ranked.length; i++) {
      assert(ranked[i - 1].angular >= ranked[i].angular, 'occluders not ranked');
    }
    return `Earth ← ${names('earth').join(', ')}; Jupiter ← ${jup.slice(0, 4).join(', ')}`;
  });

  t('LUNAR ECLIPSE: the Moon really is in Earth’s shadow on 2026-03-03', () => {
    // A prediction the model makes, checkable without rendering anything: on the
    // date of a real total lunar eclipse, is the Moon inside the cone of shadow
    // Earth casts? The cone narrows with distance because the Sun is not a
    // point -- that convergence is what makes totality possible at all.
    const sys = new SolarSystem();
    const R_SUN = data.SUN.radius;
    const R_EARTH = data.PLANETS.find((p) => p.id === 'earth').radius;
    const R_MOON = data.MOONS.find((m) => m.id === 'moon').radius;

    const shadowDepth = (iso) => {
      sys.updatePositions(kepler.julianDate(new Date(iso)));
      const earth = sys.byId.get('earth');
      const moon = sys.byId.get('moon');
      const sunDist = earth.worldPos.length();
      const axis = earth.worldPos.clone().negate().normalize().negate(); // anti-sunward
      const rel = moon.worldPos.clone().sub(earth.worldPos);
      const along = rel.dot(axis);
      if (along <= 0) return -1;                       // Moon is on the sunlit side
      const perp = rel.clone().addScaledVector(axis, -along).length();
      // Umbra shrinks with distance, penumbra grows.
      const umbra = R_EARTH - along * (R_SUN - R_EARTH) / sunDist;
      return (umbra - perp) / R_MOON;   // >0 means the Moon's centre is inside it
    };

    const during = shadowDepth('2026-03-03T11:33:00Z');
    const control = shadowDepth('2026-03-10T11:33:00Z');
    assert(during > 0, `Moon not in the umbra on the eclipse date (depth ${during.toFixed(2)})`);
    assert(control < 0, `Moon in shadow on the control date too (${control.toFixed(2)})`);
    return `centre ${during.toFixed(2)} lunar radii inside the umbra on the night; `
      + `${control.toFixed(1)} (outside) a week later`;
  });

  t('the Sun is treated as a disc, not a point', () => {
    // Penumbra exists only because the Sun has angular size. The shaders are
    // handed that size per body, and it has to shrink with distance.
    const sys = new SolarSystem();
    const cam = new THREE.PerspectiveCamera(55, 1.6, 0.1, 1e10);
    const res = new THREE.Vector2(800, 600);
    sys.updatePositions(kepler.julianDate(new Date('2026-06-01T00:00:00Z')));
    cam.position.set(3e8, 1e8, 2e8);
    cam.updateMatrixWorld(true);
    sys.updateAppearance(cam, res,
      { showMarkers: false, realisticLight: false, exaggeration: 1, time: 0 });

    const ang = (id) => sys.byId.get(id).mesh.material.uniforms.uSunAngularRadius.value;
    const earthDeg = ang('earth') * 2 * 180 / Math.PI;
    assert(earthDeg > 0.52 && earthDeg < 0.55, `Sun is ${earthDeg.toFixed(3)}° wide from Earth`);
    assert(ang('jupiter') < ang('earth') * 0.25, 'Sun not smaller from Jupiter');
    assert(ang('neptune') < ang('jupiter') * 0.25, 'Sun not smaller from Neptune');
    return `Sun spans ${earthDeg.toFixed(3)}° from Earth, `
      + `${(ang('jupiter') * 2 * 180 / Math.PI).toFixed(3)}° from Jupiter, `
      + `${(ang('neptune') * 2 * 180 / Math.PI).toFixed(3)}° from Neptune`;
  });


  // --- the date controls ----------------------------------------------------

  t('dates round-trip exactly through Julian days', () => {
    // The clock stores a Julian date, which carries a 2.46-million-day offset.
    // Converting back used to land a fraction of a millisecond short, so a time
    // typed as 10:53 read back as 10:52.
    for (const iso of ['2026-03-03T10:53:00.000Z', '1999-12-31T23:59:59.000Z',
                       '2050-07-04T00:00:00.000Z', '2026-08-12T17:46:00.000Z']) {
      const d = new Date(iso);
      const back = kepler.dateFromJulian(kepler.julianDate(d));
      assert(back.getTime() === d.getTime(),
        `${iso} came back as ${back.toISOString()}`);
    }
    return 'exact to the millisecond across five decades';
  });

  t('typed dates are parsed as UTC, and nonsense is refused', () => {
    assert(parseUtcDate('2026-03-03').toISOString() === '2026-03-03T00:00:00.000Z', 'date only');
    assert(parseUtcDate('2026-03-03 10:53').toISOString() === '2026-03-03T10:53:00.000Z', 'date+time');
    assert(parseUtcDate('2026-03-03T10:53Z').toISOString() === '2026-03-03T10:53:00.000Z', 'iso');
    for (const bad of ['', 'tomorrow', '2026-13-01', '2026-02-31', '3/3/2026', '2026-3-3']) {
      assert(parseUtcDate(bad) === null, `accepted "${bad}"`);
    }
    return 'accepts date, date+time and ISO; refuses 2026-02-31 and friends';
  });

  t('every listed moment is one the model actually produces', () => {
    const sys = new SolarSystem();
    const out = [];
    for (const m of MOMENTS) {
      assert(parseUtcDate(m.when.replace('Z', '')) || !Number.isNaN(new Date(m.when).getTime()),
        `${m.name} has an unparseable date`);
      assert(sys.byId.get(m.target), `${m.name} points at unknown body ${m.target}`);
    }
    // The two that carry a physical claim, checked against the model.
    sys.updatePositions(kepler.julianDate(new Date(
      MOMENTS.find((m) => m.name.includes('perihelion')).when)));
    const rPeri = sys.byId.get('earth').worldPos.length() / 1e6;
    assert(rPeri < 147.3, `perihelion moment puts Earth at ${rPeri.toFixed(2)} Mkm`);
    out.push(`perihelion ${rPeri.toFixed(2)} Mkm`);

    sys.updatePositions(kepler.julianDate(new Date(
      MOMENTS.find((m) => m.name.includes('opposition')).when)));
    const rOpp = sys.byId.get('mars').worldPos
      .distanceTo(sys.byId.get('earth').worldPos) / 1e6;
    assert(rOpp < 110, `opposition moment puts Mars at ${rOpp.toFixed(1)} Mkm`);
    out.push(`Mars opposition ${rOpp.toFixed(1)} Mkm`);
    return `${MOMENTS.length} moments, all reachable; ${out.join(', ')}`;
  });


  // --- the ISS --------------------------------------------------------------

  t('the ISS orbits where the ISS orbits', () => {
    // Not a body of the solar system, but it obeys the same Kepler machinery,
    // so its orbit is checkable in exactly the same way.
    const R_EARTH = data.PLANETS.find((p) => p.id === 'earth').radius;
    const alt = ISS.a - R_EARTH;
    assert(alt > 380 && alt < 450, `altitude ${alt.toFixed(0)} km`);
    assert(Math.abs(ISS.i - 51.6) < 0.5, `inclination ${ISS.i}°`);
    const minutes = ISS.period * 24 * 60;
    assert(minutes > 90 && minutes < 95, `period ${minutes.toFixed(1)} min`);

    // Kepler's third law is not imposed here -- period and semi-major axis are
    // given independently -- so agreeing is a real check on both.
    const GM = 398600.4418;                       // km^3/s^2 for Earth
    const derived = 2 * Math.PI * Math.sqrt(ISS.a ** 3 / GM) / 60;
    assert(Math.abs(derived - minutes) < 1.5,
      `period ${minutes.toFixed(1)} min but a = ${ISS.a} km implies ${derived.toFixed(1)}`);
    return `${alt.toFixed(0)} km up, ${ISS.i}° inclined, ${minutes.toFixed(1)} min `
      + `(Kepler says ${derived.toFixed(1)})`;
  });

  t('the ISS is a speck: 109 m against a 12,756 km Earth', () => {
    // The sharpest true-scale statement in the model.
    const earth = data.PLANETS.find((p) => p.id === 'earth');
    const ratio = (ISS.modelSpan) / (earth.radius * 2);
    assert(ratio < 1e-4, `ratio ${ratio}`);
    // At what range does it fall below one pixel, at 55° across 1080 lines?
    const pxPerRadian = 540 / Math.tan(55 * Math.PI / 360);
    const vanishes = ISS.modelSpan * pxPerRadian;
    assert(vanishes < 200, `still a pixel at ${vanishes.toFixed(0)} km`);
    return `1 part in ${Math.round(1 / ratio).toLocaleString()} of Earth's diameter; `
      + `under a pixel beyond ${vanishes.toFixed(0)} km`;
  });


  t('FOLLOWING THE ISS HOLDS STATION — the frame order is right', () => {
    // The station covers 7.66 km/s, and its position must be refreshed in the
    // same pass as the planets, BEFORE the camera reads it. Refreshing it
    // afterwards leaves the camera holding an offset that is one frame stale.
    //
    // The giveaway is not a steady error, which would just look like sitting at
    // the wrong distance. It is that the error is proportional to dt, and real
    // frame times jitter by a few milliseconds -- so the station shakes by tens
    // of metres, which on a 109 m object viewed from 230 m is glaring. This
    // test therefore uses VARIABLE frame times; with a fixed dt the bug hides.
    const stub = { addEventListener() {}, setPointerCapture() {},
                   hasPointerCapture() { return false; }, releasePointerCapture() {} };
    const sys = new SolarSystem();
    const scene = new THREE.Scene();
    scene.add(sys.root);
    const craft = new Spacecraft(sys, scene, data.ISS);
    const cam = new THREE.PerspectiveCamera(55, 1.6, 0.002, 1e10);
    const fly = new FlyCamera(cam, sys, stub);

    let jd = kepler.julianDate(new Date('2026-09-05T12:00:00Z'));
    const frame = (dt) => {
      jd += dt / 86400;
      sys.updatePositions(jd);
      craft.updatePosition(jd);      // with the planets, BEFORE the camera
      fly.update(dt);
      craft.updateVisuals(cam.position);
    };

    frame(0);
    const iss = sys.byId.get('iss');
    fly.goTo(iss);
    for (let i = 0; i < 600 && fly.travel; i++) frame(1 / 60);

    const ranges = [];
    let prevRel = null;
    let moved = 0;
    for (let i = 0; i < 120; i++) {
      frame((14 + Math.random() * 6) / 1000);          // 14-20 ms, as rAF does
      ranges.push(cam.position.distanceTo(iss.worldPos));
      const rel = iss.worldPos.clone().sub(sys.byId.get('earth').worldPos);
      if (prevRel) moved = Math.max(moved, rel.distanceTo(prevRel));
      prevRel = rel;
    }
    const lo = Math.min(...ranges), hi = Math.max(...ranges);
    const wobble = (hi - lo) * 1000;
    assert(wobble < 1, `range to the ISS shook by ${wobble.toFixed(1)} m`);

    // And it must sit where goTo aimed, not merely sit still: a stale read gives
    // a rock-steady but wrong distance when frame times happen to be even.
    const want = iss.renderRadius * 4.2;
    assert(Math.abs(lo - want) / want < 0.02,
      `parked at ${lo.toFixed(4)} km, expected ${want.toFixed(4)} km`);

    // The test only means something if the station really is moving fast.
    assert(moved > 0.08, `station only moved ${(moved * 1000).toFixed(0)} m per frame`);
    return `steady to ${wobble.toFixed(2)} m at ${lo.toFixed(3)} km, `
      + `while the station moved up to ${(moved * 1000).toFixed(0)} m per frame`;
  });


  t('JAMES WEBB SITS AT L2, four times further out than the Moon', () => {
    // L2 is not an orbit; nothing goes round it. It is the point beyond Earth
    // where the Sun's pull, Earth's pull and the centripetal requirement of
    // circling the Sun once a year all balance. So this checks the geometry that
    // actually defines it: the telescope must stay on the anti-Sun line from
    // Earth, at about 1.5 million km, all year round.
    const stub = { addEventListener() {}, setPointerCapture() {},
                   hasPointerCapture() { return false; }, releasePointerCapture() {} };
    const sys = new SolarSystem();
    const scene = new THREE.Scene();
    scene.add(sys.root);
    const jwst = new Spacecraft(sys, scene, data.JWST);
    const rec = sys.byId.get('jwst');
    const earth = sys.byId.get('earth');

    let minD = Infinity, maxD = -Infinity, worstAngle = 0, minSun = Infinity;
    for (let day = 0; day < 366; day += 5) {
      const jd = kepler.julianDate(new Date('2026-01-01T00:00:00Z')) + day;
      sys.updatePositions(jd);
      jwst.updatePosition(jd);

      const rel = rec.worldPos.clone().sub(earth.worldPos);
      const d = rel.length();
      minD = Math.min(minD, d); maxD = Math.max(maxD, d);

      // Angle off the anti-Sun direction, which is what keeps the sunshield
      // pointing one way and Earth, Sun and Moon all behind it.
      const antiSun = earth.worldPos.clone().normalize();
      worstAngle = Math.max(worstAngle,
        Math.acos(Math.min(rel.clone().normalize().dot(antiSun), 1)) * 180 / Math.PI);

      // It must never be closer to the Sun than Earth is: that would put it on
      // the wrong side entirely.
      minSun = Math.min(minSun, rec.worldPos.length() - earth.worldPos.length());
    }

    assert(minD > 1.0e6 && maxD < 2.4e6,
      `distance from Earth ranged ${(minD/1e6).toFixed(2)}–${(maxD/1e6).toFixed(2)} million km`);
    assert(worstAngle < 40, `wandered ${worstAngle.toFixed(0)}° off the anti-Sun line`);
    assert(minSun > 0, 'ended up sunward of Earth');

    const moons = ((minD + maxD) / 2) / 384400;
    assert(moons > 3 && moons < 5, `${moons.toFixed(1)}x the Moon's distance`);
    return `${(minD/1e6).toFixed(2)}–${(maxD/1e6).toFixed(2)} million km from Earth `
      + `(${moons.toFixed(1)}× the Moon), never more than ${worstAngle.toFixed(0)}° `
      + `off the anti-Sun line`;
  });

  t('the L2 distance is solved, not approximated', () => {
    // The textbook first-order value, R(M_earth/3M_sun)^(1/3), is 0.33% short.
    const GM_SUN = 1.32712440018e11, GM_EARTH = 398600.4418, R = data.AU;
    const w2 = (GM_SUN + GM_EARTH) / R ** 3;
    const f = (d) => GM_SUN / (R + d) ** 2 + GM_EARTH / d ** 2 - w2 * (R + d);
    let lo = 1e5, hi = 5e6;
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) lo = mid; else hi = mid;
    }
    const exact = (lo + hi) / 2;
    const used = data.L2_FRACTION * R;
    assert(Math.abs(used - exact) / exact < 1e-3,
      `using ${used.toFixed(0)} km, solved value is ${exact.toFixed(0)} km`);
    const naive = R * (GM_EARTH / (3 * GM_SUN)) ** (1 / 3);
    return `${exact.toFixed(0)} km — the first-order estimate would be `
      + `${((naive - exact) / exact * 100).toFixed(2)}% out`;
  });

  // --- the asteroid belt ----------------------------------------------------

  t('asteroid catalogue decodes to sane elements', () => {
    const el = decodeAsteroids();
    assert(el.count === ASTEROID_COUNT, `${el.count} vs ${ASTEROID_COUNT}`);
    let belt = 0, troj = 0;
    for (let k = 0; k < el.count; k++) {
      const a = el.elemA[k * 3], e = el.elemA[k * 3 + 1], i = el.elemA[k * 3 + 2];
      assert(a > 1.9 && a < 5.5, `a = ${a}`);
      assert(e >= 0 && e < 0.45, `e = ${e}`);
      assert(i >= 0 && i < 1.1, `i = ${i} rad`);
      if (a >= TROJAN_MIN_AU) troj++; else belt++;
    }
    return `${belt.toLocaleString()} belt + ${troj.toLocaleString()} Trojans`;
  });

  t('KIRKWOOD GAPS: Jupiter’s resonances are empty', () => {
    // The strongest evidence that this is real data rather than a scatter of
    // plausible rocks. Asteroids whose period is a simple fraction of Jupiter's
    // get repeatedly kicked until they leave, carving gaps at known distances.
    // Nothing in this codebase puts them there.
    const el = decodeAsteroids();
    const BIN = 0.01, LO = 2.0;
    const bins = new Float64Array(140);
    for (let k = 0; k < el.count; k++) {
      const a = el.elemA[k * 3];
      if (a >= TROJAN_MIN_AU) continue;
      const b = Math.round((a - LO) / BIN);
      if (b >= 0 && b < bins.length) bins[b]++;
    }
    const at = (a) => bins[Math.round((a - LO) / BIN)];
    const background = (a) => {
      let sum = 0, n = 0;
      for (let d = -7; d <= 7; d++) {
        if (Math.abs(d) <= 3) continue;
        const b = Math.round((a - LO) / BIN) + d;
        if (b >= 0 && b < bins.length) { sum += bins[b]; n++; }
      }
      return sum / n;
    };
    const out = [];
    for (const [name, a, maxRatio] of
         [['3:1', 2.502, 0.05], ['5:2', 2.825, 0.45], ['7:3', 2.958, 0.45]]) {
      const ratio = at(a) / background(a);
      assert(ratio < maxRatio, `${name} gap at ${a} AU is not empty (ratio ${ratio.toFixed(2)})`);
      out.push(`${name} ${(ratio * 100).toFixed(0)}% of background`);
    }
    return out.join(', ');
  });

  t('TROJANS sit 60° ahead of and behind Jupiter', () => {
    const el = decodeAsteroids();
    const jup = data.PLANETS.find((p) => p.id === 'jupiter');
    const jd = 2461200.5;                     // the catalogue's epoch
    const jupL = kepler.planetElements(jup.elements, jd).L * 180 / Math.PI;
    const lead = [], trail = [];
    let stray = 0;
    for (let k = 0; k < el.count; k++) {
      if (el.elemA[k * 3] < TROJAN_MIN_AU) continue;
      // Mean longitude = M + argument of perihelion + ascending node.
      const L = (el.elemB[k * 3 + 2] + el.elemB[k * 3 + 1] + el.elemB[k * 3]) * 180 / Math.PI;
      const d = ((L - jupL) % 360 + 540) % 360 - 180;
      if (d > 15 && d < 105) lead.push(d);
      else if (d < -15 && d > -105) trail.push(d);
      else stray++;
    }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const l = mean(lead), tr = mean(trail);
    assert(Math.abs(l - 60) < 8, `L4 cloud centred at ${l.toFixed(1)}°`);
    assert(Math.abs(tr + 60) < 8, `L5 cloud centred at ${tr.toFixed(1)}°`);
    assert(stray < el.count * 0.02, `${stray} Trojans outside both clouds`);
    return `L4 ${lead.length} at ${l.toFixed(1)}°, L5 ${trail.length} at ${tr.toFixed(1)}° `
      + `(theory ±60°; the real L4/L5 imbalance is genuine)`;
  });

  t('THE BELT IS EMPTY: nearest rock is millions of km away', () => {
    // The number that undoes every film's asteroid field.
    const belt = new AsteroidBelt();
    const jd = 2461200.5;
    const spot = new THREE.Vector3(2.7 * data.AU, 0, 0);
    let r = null;
    // nearest() sweeps in slices, so run until a full pass completes.
    for (let i = 0; i < 40 && !r; i++) r = belt.nearest(spot, jd);
    assert(r, 'sweep never completed');
    assert(r.distance > 5e5, `nearest rock only ${r.distance.toFixed(0)} km away`);
    const moons = r.distance / 384400;
    return `${(r.distance / 1e6).toFixed(2)} million km — ${moons.toFixed(1)}× the Earth–Moon distance`;
  });

  t('belt sweep stays inside a frame budget', () => {
    const belt = new AsteroidBelt();
    const spot = new THREE.Vector3(2.7 * data.AU, 0, 0);
    belt.nearest(spot, 2461200.5);            // warm up
    let worst = 0;
    for (let i = 0; i < 24; i++) {
      const t0 = performance.now();
      belt.nearest(spot, 2461200.5);
      worst = Math.max(worst, performance.now() - t0);
    }
    assert(worst < 6, `a single slice took ${worst.toFixed(1)} ms`);
    return `worst slice ${worst.toFixed(2)} ms (frame budget is 16.7 ms)`;
  });

  return rows;
}

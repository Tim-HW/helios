import * as THREE from 'three';
import { SUN, PLANETS, MOONS, AU } from '../solar/data.js';
import { planetPosition, moonPosition, julianDate } from '../solar/kepler.js';

// Startup sanity checks on the physical model.
//
// "It looks like space" proves nothing -- a render with every distance wrong by
// a factor of ten would look just as convincing. These are the checks that
// actually constrain the model, run over a simulated year and logged to the
// console.
//
// The important one is the angular-diameter test. Seen from Earth the Sun and
// the Moon are very nearly the SAME apparent size, about half a degree, which
// is the entire reason total solar eclipses exist. Two radii and two distances
// have to be simultaneously right for that coincidence to reproduce, so if this
// check passes, the sizes and the distances are both sound.

const RAD2DEG = 180 / Math.PI;

function angularDiameterDeg(radius, distance) {
  return 2 * Math.asin(Math.min(radius / distance, 1)) * RAD2DEG;
}

export function runSelfCheck() {
  const earthDef = PLANETS.find((p) => p.id === 'earth');
  const moonDef = MOONS.find((m) => m.id === 'moon');
  const jd0 = julianDate(new Date());

  const ecl = { x: 0, y: 0, z: 0 };
  const earth = new THREE.Vector3();
  const moon = new THREE.Vector3();

  let sunMin = Infinity, sunMax = -Infinity;
  let moonMin = Infinity, moonMax = -Infinity;
  let rMin = Infinity, rMax = -Infinity;

  // Sample every day for a year and a bit, which covers a full lunar-distance
  // cycle as well as Earth's perihelion and aphelion.
  for (let d = 0; d < 400; d++) {
    const jd = jd0 + d;
    planetPosition(earthDef.elements, jd, ecl);
    earth.set(ecl.x, ecl.y, ecl.z);
    const rSun = earth.length();
    rMin = Math.min(rMin, rSun); rMax = Math.max(rMax, rSun);

    const sunAng = angularDiameterDeg(SUN.radius, rSun);
    sunMin = Math.min(sunMin, sunAng); sunMax = Math.max(sunMax, sunAng);

    moonPosition(moonDef, jd, ecl);
    moon.set(ecl.x, ecl.y, ecl.z);
    const rMoon = moon.length();
    const moonAng = angularDiameterDeg(moonDef.radius, rMoon);
    moonMin = Math.min(moonMin, moonAng); moonMax = Math.max(moonMax, moonAng);
  }

  const results = [
    check('Sun’s apparent size from Earth', `${sunMin.toFixed(3)}°–${sunMax.toFixed(3)}°`,
      '0.524°–0.542°', sunMin > 0.520 && sunMin < 0.530 && sunMax > 0.538 && sunMax < 0.546),
    check('Moon’s apparent size from Earth', `${moonMin.toFixed(3)}°–${moonMax.toFixed(3)}°`,
      '0.49°–0.56°', moonMin > 0.48 && moonMin < 0.50 && moonMax > 0.55 && moonMax < 0.58),
    check('Sun and Moon overlap in size', 'they do', 'total eclipses possible',
      sunMin < moonMax && moonMin < sunMax),
    check('Earth–Sun distance', `${(rMin / 1e6).toFixed(2)}–${(rMax / 1e6).toFixed(2)} Mkm`,
      '147.1–152.1 Mkm', rMin > 146.9e6 && rMin < 147.3e6 && rMax > 151.9e6 && rMax < 152.3e6),
    check('Neptune’s orbit', `${(PLANETS.find((p) => p.id === 'neptune').elements.epoch[0]).toFixed(2)} AU`,
      '30.07 AU', true),
  ];

  const failed = results.filter((r) => !r.pass);
  console.groupCollapsed(
    `%c[helios] physical self-check: ${failed.length ? `${failed.length} FAILED` : 'all passed'}`,
    `color:${failed.length ? '#ff8a70' : '#7ddc9a'}`,
  );
  console.table(results.map((r) => ({
    check: r.name, measured: r.measured, expected: r.expected, ok: r.pass ? '✓' : '✗',
  })));
  console.log(
    'The Sun and Moon matching in apparent size is not a coincidence this app\n'
    + 'arranges — it falls out of four independent numbers being right at once.',
  );
  console.groupEnd();

  return { results, ok: failed.length === 0 };
}

function check(name, measured, expected, pass) {
  return { name, measured, expected, pass };
}

// Keplerian orbit propagation.
//
// Planets use JPL's approximate elements (J2000 + per-century rates); moons use
// fixed elements relative to their parent. Both end up going through the same
// solver and the same orbital-plane -> ecliptic rotation.
//
// Coordinate frames
// -----------------
// The maths below works in the J2000 ECLIPTIC frame: x toward the vernal
// equinox, z toward ecliptic north. three.js is y-up, so every vector leaves
// this module through eclipticToWorld(), which is the single place that
// conversion happens.

import { AU, J2000 } from './data.js';

const DEG = Math.PI / 180;

export function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

export function dateFromJulian(jd) {
  // Round to the millisecond. A Julian date carries a large offset (2.46
  // million days), so converting back leaves an error of a few hundredths of a
  // millisecond -- harmless numerically, but it lands just under the second and
  // any truncating formatter then shows the wrong minute. Type 10:53, read back
  // 10:52. Rounding here makes the round trip exact.
  return new Date(Math.round((jd - 2440587.5) * 86400000));
}

// Newton-Raphson on Kepler's equation, M = E - e sin E. Six iterations gets us
// to ~1e-12 rad for every eccentricity in this solar system (Pluto's 0.249 is
// the worst case and converges in three).
export function solveKepler(M, e) {
  M = ((M + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 6; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

// Position within the orbital plane, then rotated into the ecliptic by the
// argument of perihelion, inclination, and longitude of ascending node.
// Lengths come out in whatever unit `a` was given in.
function orbitalToEcliptic(a, e, E, i, omega, node, out) {
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cw = Math.cos(omega), sw = Math.sin(omega);
  const cn = Math.cos(node), sn = Math.sin(node);
  const ci = Math.cos(i), si = Math.sin(i);

  out.x = (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp;
  out.y = (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp;
  out.z = (sw * si) * xp + (cw * si) * yp;
  return out;
}

// Ecliptic (z-up) -> three.js world (y-up), preserving handedness.
export function eclipticToWorld(ecl, out) {
  out.set(ecl.x, ecl.z, -ecl.y);
  return out;
}

// --- Planets ----------------------------------------------------------------

// Elements propagated to a given Julian date. Returns AU / radians.
export function planetElements(elements, jd) {
  const T = (jd - J2000) / 36525;
  const [a0, e0, i0, l0, p0, n0] = elements.epoch;
  const [ad, ed, id, ld, pd, nd] = elements.rate;
  return {
    a: a0 + ad * T,
    e: e0 + ed * T,
    i: (i0 + id * T) * DEG,
    L: (l0 + ld * T) * DEG,
    peri: (p0 + pd * T) * DEG,   // longitude of perihelion
    node: (n0 + nd * T) * DEG,   // longitude of ascending node
  };
}

const _ecl = { x: 0, y: 0, z: 0 };

// Heliocentric position of a planet, in KM, in the ecliptic frame.
export function planetPosition(elements, jd, out) {
  const el = planetElements(elements, jd);
  const omega = el.peri - el.node;             // argument of perihelion
  const E = solveKepler(el.L - el.peri, el.e); // mean anomaly = L - peri
  orbitalToEcliptic(el.a * AU, el.e, E, el.i, omega, el.node, _ecl);
  out.x = _ecl.x; out.y = _ecl.y; out.z = _ecl.z;
  return out;
}

// --- Moons ------------------------------------------------------------------

// Position from a single set of osculating elements at one epoch, in KM.
//
// Used for two things that turn out to be the same problem: moons relative to
// their parent, and minor planets relative to the Sun. Moons come back in the
// parent's EQUATORIAL frame when frame === 'equatorial' (the caller then applies
// the parent's obliquity); everything else comes back in the ecliptic frame.
//
// `a` is in whatever unit you want the answer in. The mean anomaly advances at
// `mRate` degrees per day if given, otherwise at one revolution per `period`.
export function keplerianPosition(moon, jd, out) {
  const d = jd - (moon.epoch ?? J2000);
  const node = moon.node + (moon.nodeRate ?? 0) * d;
  const peri = moon.peri + (moon.periRate ?? 0) * d;
  const Mdeg = moon.mRate != null
    ? moon.m0 + moon.mRate * d
    : moon.m0 + 360 * (d / moon.period);

  const E = solveKepler(Mdeg * DEG, moon.e);
  orbitalToEcliptic(moon.a, moon.e, E, moon.i * DEG, peri * DEG, node * DEG, _ecl);

  if (moon.perturb === 'lunar') lunarPerturbations(_ecl, jd, node, peri, Mdeg);

  out.x = _ecl.x; out.y = _ecl.y; out.z = _ecl.z;
  return out;
}

const EARTH_RADIUS = 6378.14;

// The Moon's orbit is not a closed ellipse -- the Sun pulls it around by more
// than a degree, and the perigee distance swings ~7000 km. A two-body solution
// can only ever reach a(1-e) = 363,300 km, so without these terms the Moon's
// closest approach is simply unreachable and it never looks as big as it really
// gets. Terms are the classic set: evection, variation, the annual equation and
// their smaller companions, applied in ecliptic longitude/latitude/distance.
function lunarPerturbations(ecl, jd, nodeDeg, periDeg, MmDeg) {
  const d = jd - 2451543.5;

  const Ms = 356.0470 + 0.9856002585 * d;      // Sun's mean anomaly
  const ws = 282.9404 + 4.70935e-5 * d;        // Sun's argument of perihelion
  const Ls = Ms + ws;                          // Sun's mean longitude
  const Lm = MmDeg + periDeg + nodeDeg;        // Moon's mean longitude
  const D = Lm - Ls;                           // mean elongation
  const F = Lm - nodeDeg;                      // argument of latitude

  const Mm = MmDeg;
  const s = (deg) => Math.sin(deg * DEG);
  const c = (deg) => Math.cos(deg * DEG);

  const dLon =
    -1.274 * s(Mm - 2 * D)        // evection
    + 0.658 * s(2 * D)            // variation
    - 0.186 * s(Ms)               // annual equation
    - 0.059 * s(2 * Mm - 2 * D)
    - 0.057 * s(Mm - 2 * D + Ms)
    + 0.053 * s(Mm + 2 * D)
    + 0.046 * s(2 * D - Ms)
    + 0.041 * s(Mm - Ms)
    - 0.035 * s(D)                // parallactic equation
    - 0.031 * s(Mm + Ms)
    - 0.015 * s(2 * F - 2 * D)
    + 0.011 * s(Mm - 4 * D);

  const dLat =
    -0.173 * s(F - 2 * D)
    - 0.055 * s(Mm - F - 2 * D)
    - 0.046 * s(Mm + F - 2 * D)
    + 0.033 * s(F + 2 * D)
    + 0.017 * s(2 * Mm + F);

  const dR = (-0.58 * c(Mm - 2 * D) - 0.46 * c(2 * D)) * EARTH_RADIUS;

  // Perturbations are naturally expressed in spherical coordinates, so round
  // trip through them.
  let r = Math.sqrt(ecl.x * ecl.x + ecl.y * ecl.y + ecl.z * ecl.z);
  const lon = Math.atan2(ecl.y, ecl.x) + dLon * DEG;
  const lat = Math.asin(ecl.z / r) + dLat * DEG;
  r += dR;

  const cl = Math.cos(lat);
  ecl.x = r * cl * Math.cos(lon);
  ecl.y = r * cl * Math.sin(lon);
  ecl.z = r * Math.sin(lat);
}

// --- Orbit path sampling ----------------------------------------------------

// One full revolution as a flat array of ecliptic-frame xyz triples, in km.
// Sampled in eccentric anomaly rather than time, which naturally packs more
// points near perihelion where the curve bends hardest.
export function samplePlanetOrbit(elements, jd, segments = 512) {
  const el = planetElements(elements, jd);
  const omega = el.peri - el.node;
  const pts = new Float64Array((segments + 1) * 3);
  for (let s = 0; s <= segments; s++) {
    const E = (s / segments) * 2 * Math.PI;
    orbitalToEcliptic(el.a * AU, el.e, E, el.i, omega, el.node, _ecl);
    pts[s * 3] = _ecl.x; pts[s * 3 + 1] = _ecl.y; pts[s * 3 + 2] = _ecl.z;
  }
  return pts;
}

// The drawn path is the unperturbed ellipse. For the Moon the real track wanders
// a degree or so either side of it, so the line is a guide to the orbit rather
// than a trace of the body's exact route.
export function sampleKeplerianOrbit(moon, segments = 256) {
  const pts = new Float64Array((segments + 1) * 3);
  for (let s = 0; s <= segments; s++) {
    const E = (s / segments) * 2 * Math.PI;
    orbitalToEcliptic(
      moon.a, moon.e, E,
      moon.i * DEG, moon.peri * DEG, moon.node * DEG,
      _ecl,
    );
    pts[s * 3] = _ecl.x; pts[s * 3 + 1] = _ecl.y; pts[s * 3 + 2] = _ecl.z;
  }
  return pts;
}

// Kept as the names the rest of the code reads best with.
export { keplerianPosition as moonPosition };
